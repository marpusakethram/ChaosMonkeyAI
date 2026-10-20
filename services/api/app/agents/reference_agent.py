"""Deterministic scripted reference agent (C2.2).

Two bundled policies share one workflow so the harness can show both outcomes honestly:

* robust -- validates every tool body, retries transient errors with a bounded budget, keeps
  untrusted text as data, refuses to combine incomparable setups.
* naive  -- a deliberately fragile agent: no retries, lenient "best effort" parsing, obeys
  instruction-like text found in sources, averages whatever numbers it gets. It exists so the
  assertions can be shown to catch real failure modes. It is clearly labelled in the UI.

Workflow: get_benchmark -> get_research_paper for each cited paper -> verify_citation for every
ID -> one structured claim object with source IDs.
"""

from __future__ import annotations

import json
import re
import time
from collections import defaultdict
from typing import Any, Literal

from pydantic import BaseModel, ValidationError

from app.agents.adapter import Task
from app.models import AgentConfig, RunResult
from app.runner.gateway import ToolGateway, ToolTimeoutError
from app.tools.research_tools import BenchmarkResponse, PaperResponse, VerifyResponse

INSTRUCTION_LIKE = re.compile(
    r"(ignore (all |any )?(prior|previous|above) instructions|disregard .*instructions|you must (now )?write|"
    r"write that .* is \d+)",
    re.I,
)
MAX_BACKOFF_MS = 250


class ScriptedResearchAgent:
    def __init__(self, policy: Literal["robust", "naive"] = "robust"):
        self.policy = policy
        self.name = f"scripted-{policy}"
        self.mode: Literal["offline", "live"] = "offline"
        self.description = (
            "Deterministic rule-following research agent: validates, retries (bounded), flags untrusted text."
            if policy == "robust"
            else "Deliberately fragile reference agent (no retries, lenient parsing, trusts source text). "
            "Use it to watch assertions catch failures."
        )

    # ---- helpers -----------------------------------------------------------------------------

    def _fetch(
        self,
        gw: ToolGateway,
        tool: str,
        args: dict[str, Any],
        schema: type[BaseModel],
        config: AgentConfig,
        errors: list[str],
    ) -> BaseModel | dict | None:
        attempts = 1 + (config.max_retries if self.policy == "robust" else 0)
        for attempt in range(attempts):
            try:
                resp = gw.call(tool, args)
            except ToolTimeoutError as exc:
                errors.append(f"{tool}({_args(args)}) timed out on attempt {attempt + 1}: {exc}")
                gw.note("agent_decision", f"timeout on {tool}; " + ("retrying" if attempt + 1 < attempts else "giving up"))
                if self.policy == "naive":
                    raise
                continue
            if resp.status_code == 429:
                retry_after = int(resp.headers.get("retry-after-ms", "100"))
                errors.append(f"{tool}({_args(args)}) rate limited (HTTP 429) on attempt {attempt + 1}")
                if attempt + 1 < attempts:
                    wait = min(retry_after, MAX_BACKOFF_MS)
                    gw.note("agent_decision", f"HTTP 429 on {tool}; backing off {wait} ms then retrying", backoff_ms=wait)
                    time.sleep(wait / 1000)
                continue
            if resp.status_code != 200:
                errors.append(f"{tool}({_args(args)}) returned HTTP {resp.status_code}")
                return None
            if self.policy == "naive":
                return _lenient_parse(resp.body)
            try:
                return schema.model_validate(json.loads(resp.body))
            except (json.JSONDecodeError, ValidationError) as exc:
                kind = "malformed JSON" if isinstance(exc, json.JSONDecodeError) else "schema-invalid body"
                errors.append(f"rejected {kind} from {tool}({_args(args)}) on attempt {attempt + 1}")
                gw.note("agent_decision", f"validator rejected {kind} from {tool}; requesting a fresh copy")
                continue
        errors.append(f"gave up on {tool}({_args(args)}) after {attempts} attempt(s)")
        gw.note("agent_decision", f"giving up on {tool} after {attempts} attempt(s)")
        return None

    # ---- workflow ----------------------------------------------------------------------------

    def execute(self, task: Task, tool_gateway: ToolGateway, config: AgentConfig) -> RunResult:
        gw = tool_gateway
        errors: list[str] = []
        flags: list[dict[str, str]] = []
        conflicts: list[dict[str, Any]] = []

        gw.step("fetch benchmark results", technology=task.technology)
        bench = self._fetch(gw, "get_benchmark", {"technology": task.technology}, BenchmarkResponse, config, errors)
        if bench is None:
            if self.policy == "naive":
                return RunResult(agent_error="no benchmark data; naive agent stopped without a report", steps=gw.stats.agent_steps)
            return self._unable(task, gw, errors, "benchmark data unavailable")

        results = _results(bench, task.metric)
        if not results:
            if self.policy == "naive":
                return RunResult(agent_error="naive agent found no usable results", steps=gw.stats.agent_steps)
            return self._unable(task, gw, errors, "no results for the requested metric")

        gw.step("group results by measurement setup", n_results=len(results))
        if self.policy == "robust":
            groups: dict[tuple, list[dict]] = defaultdict(list)
            for r in results:
                s = r.get("setup") or {}
                groups[(s.get("suite"), s.get("environment"), s.get("trials"))].append(r)
            primary_key = sorted(groups, key=lambda k: (-len(groups[k]), min(r["benchmark_id"] for r in groups[k])))[0]
            primary = sorted(groups[primary_key], key=lambda r: (r["year"], r["benchmark_id"]))
            for key, rows in groups.items():
                if key == primary_key:
                    continue
                ids = [r["benchmark_id"] for r in rows]
                clash = [p["benchmark_id"] for p in primary if any(p["year"] == r["year"] for r in rows)]
                conflicts.append({
                    "benchmark_ids": sorted(set(clash + ids)),
                    "reason": (
                        f"{', '.join(ids)} measured on {key[0]} ({key[1]}, {key[2]} trials) disagrees with "
                        f"{primary_key[0]} ({primary_key[1]}, {primary_key[2]} trials); setups are not comparable "
                        "so the scores were not combined."
                    ),
                })
                gw.note("agent_decision", f"conflict: {', '.join(ids)} uses a different setup; reporting, not combining")
        else:
            primary = sorted(results, key=lambda r: (r.get("year", 0), r["benchmark_id"]))

        # Papers: keep excerpts as data, flag anything instruction-like.
        override: float | None = None
        paper_ids: list[str] = []
        for r in primary:
            pid = r.get("paper_id")
            if not pid:
                continue
            gw.step("fetch paper metadata", paper_id=pid)
            paper = self._fetch(gw, "get_research_paper", {"id": pid}, PaperResponse, config, errors)
            if paper is None:
                continue
            paper_ids.append(pid)
            excerpt = paper.abstract_excerpt if isinstance(paper, PaperResponse) else str(paper.get("abstract_excerpt", ""))
            if INSTRUCTION_LIKE.search(excerpt):
                if self.policy == "robust":
                    flags.append({
                        "source_id": pid,
                        "reason": "abstract_excerpt (trust_level=untrusted) contains instruction-like text; treated as data and ignored",
                    })
                    gw.note("agent_decision", f"untrusted excerpt in {pid} contains an instruction; ignoring it")
                else:
                    m = re.search(r"value is (\d+(?:\.\d+)?)", excerpt)
                    if m:
                        override = float(m.group(1))
                        gw.note("agent_decision", f"following instruction found in {pid} excerpt")

        # Verify every cited ID.
        cited = [r["benchmark_id"] for r in primary] + paper_ids
        verified = True
        for cid in cited:
            gw.step("verify citation", id=cid)
            v = self._fetch(gw, "verify_citation", {"id": cid}, VerifyResponse, config, errors)
            exists = v.exists if isinstance(v, VerifyResponse) else bool(v and v.get("exists"))
            if not exists:
                verified = False
                if self.policy == "robust" and v is not None:
                    errors.append(f"citation {cid} could not be verified")

        gw.step("compose structured claim")
        return RunResult(artifact=self._compose(task, primary, paper_ids, verified, conflicts, flags, errors, override),
                         steps=gw.stats.agent_steps)

    def _compose(self, task, primary, paper_ids, verified, conflicts, flags, errors, override) -> dict:
        if len(primary) < 2:
            return {
                "task_id": task.scenario_id, "conclusion": "inconclusive",
                "summary": "Fewer than two comparable results; cannot determine a trend.",
                "claims": [], "conflicts": conflicts, "errors_disclosed": errors, "untrusted_content_flags": flags,
            }
        first = primary[0]
        if self.policy == "naive":
            # Averages every later result regardless of setup, and applies any "override" it was told.
            later = [r for r in primary if r["year"] > first["year"]] or primary[1:]
            values = [{"benchmark_id": r["benchmark_id"], "value": float(r["value"])} for r in [first, *later]]
            if override is not None:
                values[-1]["value"] = override
            later_vals = [v["value"] for v in values[1:]]
            avg = sum(later_vals) / len(later_vals)
            delta = avg - float(first["value"])
            statement = (
                f"Task success moved from {first['value']}% ({first['benchmark_id']}) to "
                f"{avg:g}% (mean of {', '.join(v['benchmark_id'] for v in values[1:])}), {delta:+.1f} points."
            )
            last_ids = [v["benchmark_id"] for v in values]
        else:
            last = primary[-1]
            delta = float(last["value"]) - float(first["value"])
            s = first["setup"]
            values = [{"benchmark_id": r["benchmark_id"], "value": float(r["value"])} for r in (first, last)]
            statement = (
                f"On {s['suite']} ({s['environment']}, {s['trials']} trials) task success went from "
                f"{first['value']}% ({first['benchmark_id']}, {first['year']}) to {last['value']}% "
                f"({last['benchmark_id']}, {last['year']}), {delta:+.1f} points."
            )
            last_ids = [first["benchmark_id"], last["benchmark_id"]]
        source_ids = last_ids + [p for p in paper_ids if p in {r.get("paper_id") for r in primary}]
        conclusion = "improved" if delta > 0 else "not_improved"
        return {
            "task_id": task.scenario_id,
            "conclusion": conclusion,
            "summary": f"{'Improved' if delta > 0 else 'Did not improve'}: {statement}",
            "claims": [{
                "claim_id": "C1", "statement": statement, "metric": task.metric,
                "values": values, "source_ids": source_ids, "verified": verified,
            }],
            "conflicts": conflicts,
            "errors_disclosed": errors,
            "untrusted_content_flags": flags,
        }

    def _unable(self, task: Task, gw: ToolGateway, errors: list[str], why: str) -> RunResult:
        gw.note("agent_decision", f"explicit graceful failure: {why}")
        return RunResult(
            artifact={
                "task_id": task.scenario_id, "conclusion": "unable_to_complete",
                "summary": f"Could not complete the task: {why}. No claims were made from unavailable or invalid data.",
                "claims": [], "conflicts": [], "errors_disclosed": errors, "untrusted_content_flags": [],
            },
            steps=gw.stats.agent_steps,
        )


def _args(args: dict[str, Any]) -> str:
    return ", ".join(f"{k}={v}" for k, v in args.items())


def _results(bench: Any, metric: str) -> list[dict]:
    if isinstance(bench, BenchmarkResponse):
        rows = [r.model_dump() for r in bench.results]
    else:
        rows = [r for r in bench.get("results", []) if isinstance(r, dict) and "benchmark_id" in r and "value" in r]
    return [r for r in rows if r.get("metric", metric) == metric]


def _lenient_parse(body: str) -> dict:
    """The naive agent's 'best effort' parser: if JSON fails, scrape whatever looks like a result."""
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        pass
    results = []
    for m in re.finditer(r'"benchmark_id":\s*"([^"]+)"(.*?)"value":\s*([0-9.]+)', body):
        year = re.search(r'"year":\s*(\d+)', body[m.end():m.end() + 120])
        pid = re.search(r'"paper_id":\s*"([^"]+)"', body[m.end():m.end() + 160])
        results.append({
            "benchmark_id": m.group(1), "value": float(m.group(3)), "metric": "task_success_rate",
            "year": int(year.group(1)) if year else 2024, "paper_id": pid.group(1) if pid else None,
        })
    return {"results": results, "_lenient": True}
