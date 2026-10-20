"""The tool gateway: the only path from an agent to a tool.

It validates arguments, enforces every budget, injects scheduled faults, enforces the per-call
timeout, and writes the trace. Agents get a ToolResponse or a ToolTimeoutError -- nothing else.
"""

from __future__ import annotations

import json
import random
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from dataclasses import dataclass
from typing import Any, Callable, Protocol

from pydantic import ValidationError

from app.config import Settings
from app.faults.base import FaultContext, FaultScheduler, ResolvedFault
from app.runner.trace import TraceWriter, clip, stable_hash
from app.tools.research_tools import ARG_SCHEMAS, TOOLS, ToolResponse, check_output_schema


class ToolTimeoutError(Exception):
    """Raised to the agent when a tool exceeds TOOL_TIMEOUT_MS."""


class BudgetExceeded(Exception):
    """The agent exhausted a harness budget. Counts as an agent failure."""


class RunCancelled(Exception):
    """A user cancelled the run."""


class HarnessError(Exception):
    """Our own machinery failed. The run is ERROR, not FAILED."""


class ReplayDivergence(HarnessError):
    """A replayed agent asked for a different call than the recording holds."""


class ToolBackend(Protocol):
    def execute(self, tool_name: str, arguments: dict[str, Any], call_index: int, input_hash: str) -> ToolResponse: ...


class FixtureBackend:
    """Runs the bundled fixture tools with seeded, small synthetic latency."""

    def __init__(self, seed: int):
        self._rng = random.Random(seed)
        self._lock = threading.Lock()

    def execute(self, tool_name: str, arguments: dict[str, Any], call_index: int, input_hash: str) -> ToolResponse:
        with self._lock:
            latency = self._rng.uniform(0.004, 0.020)
        time.sleep(latency)
        return TOOLS[tool_name](**arguments)


class ReplayBackend:
    """Serves recorded upstream outputs keyed by (tool, call_index); verifies inputs match."""

    def __init__(self, recorded: dict[tuple[str, int], dict[str, Any]]):
        self.recorded = recorded

    def execute(self, tool_name: str, arguments: dict[str, Any], call_index: int, input_hash: str) -> ToolResponse:
        rec = self.recorded.get((tool_name, call_index))
        if rec is None:
            raise ReplayDivergence(f"no recorded upstream output for {tool_name} call #{call_index}")
        if rec["input_hash"] != input_hash:
            raise ReplayDivergence(f"{tool_name} call #{call_index} arguments differ from the recording")
        return ToolResponse(rec["status_code"], rec["body"], rec.get("headers") or {})


@dataclass
class GatewayStats:
    tool_calls: int = 0
    agent_steps: int = 0
    model_requests: int = 0
    faults_injected: int = 0


class ToolGateway:
    def __init__(
        self,
        *,
        run_id: str,
        trace: TraceWriter,
        settings: Settings,
        backend: ToolBackend,
        fault: ResolvedFault | None,
        cancel_event: threading.Event,
        deadline: float,
        max_tool_calls: int | None = None,
    ):
        self.run_id = run_id
        self.trace = trace
        self.settings = settings
        self.backend = backend
        self.scheduler = FaultScheduler(fault, settings.max_fault_injections_per_run)
        self.cancel_event = cancel_event
        self.deadline = deadline
        self.max_tool_calls = max_tool_calls or settings.max_tool_calls
        self.stats = GatewayStats()
        self.seed: int | None = None
        self._per_tool_calls: dict[str, int] = {}
        self._per_input_calls: dict[str, int] = {}
        self._pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix=f"tools-{run_id[:8]}")

    # ---- budget checks -----------------------------------------------------------------------

    def check_alive(self) -> None:
        if self.cancel_event.is_set():
            raise RunCancelled("run cancelled by user")
        if time.monotonic() > self.deadline:
            self._budget("MAX_RUN_SECONDS", f"run exceeded {self.settings.max_run_seconds}s")

    def _budget(self, name: str, message: str) -> None:
        self.trace.emit("budget_exceeded", message, exception_type="BudgetExceeded", data={"budget": name})
        raise BudgetExceeded(f"{name}: {message}")

    def step(self, description: str, **data: Any) -> None:
        """Agents call this once per reasoning step; enforces MAX_AGENT_STEPS."""
        self.check_alive()
        self.stats.agent_steps += 1
        if self.stats.agent_steps > self.settings.max_agent_steps:
            self._budget("MAX_AGENT_STEPS", f"agent exceeded {self.settings.max_agent_steps} steps")
        self.trace.emit("agent_step", description, data={"step": self.stats.agent_steps, **data})

    def count_model_request(self) -> None:
        self.check_alive()
        self.stats.model_requests += 1
        if self.stats.model_requests > self.settings.max_gemini_requests_per_run:
            self._budget(
                "MAX_GEMINI_REQUESTS_PER_RUN",
                f"agent exceeded {self.settings.max_gemini_requests_per_run} model requests",
            )

    def note(self, phase: str, message: str, **data: Any) -> None:
        """Agent-visible decision log (never chain-of-thought; short structured statements only)."""
        self.trace.emit(phase, message, data=data)

    @property
    def remaining_seconds(self) -> float:
        return max(0.0, self.deadline - time.monotonic())

    # ---- the tool call -----------------------------------------------------------------------

    def call(self, tool_name: str, arguments: dict[str, Any]) -> ToolResponse:
        self.check_alive()
        if tool_name not in TOOLS:
            self.trace.emit("tool_call_rejected", f"unknown tool {tool_name!r}", tool_name=str(tool_name)[:64])
            return ToolResponse(400, json.dumps({"error": "unknown_tool", "message": f"no tool named {tool_name!r}"}))
        try:
            args = ARG_SCHEMAS[tool_name].model_validate(arguments).model_dump()
        except ValidationError as exc:
            self.trace.emit(
                "tool_call_rejected", "arguments failed schema validation", tool_name=tool_name,
                data={"errors": [e["msg"] for e in exc.errors()][:5]},
            )
            return ToolResponse(400, json.dumps({"error": "invalid_arguments", "message": str(exc.errors()[0]["msg"])}))

        if self.stats.tool_calls >= self.max_tool_calls:
            self._budget("MAX_TOOL_CALLS", f"agent exceeded {self.max_tool_calls} tool calls")
        self.stats.tool_calls += 1

        input_hash = stable_hash({"tool": tool_name, "args": args})
        call_index = self._per_tool_calls.get(tool_name, 0) + 1
        self._per_tool_calls[tool_name] = call_index
        retry_index = self._per_input_calls.get(input_hash, 0)
        self._per_input_calls[input_hash] = retry_index + 1
        if retry_index > self.settings.max_retries_per_call:
            self._budget("MAX_RETRIES_PER_CALL", f"{tool_name} retried more than {self.settings.max_retries_per_call} times")

        invocation_id = str(uuid.uuid4())
        faulted = self.scheduler.match(tool_name, call_index)
        fault_id = self.scheduler.resolved.fault_id(call_index) if faulted else None
        common = dict(tool_name=tool_name, invocation_id=invocation_id, input_hash=input_hash, retry_index=retry_index)

        self.trace.emit(
            "tool_call_started", f"{tool_name}({_fmt_args(args)})", **common,
            data={"arguments": args, "call_index": call_index},
        )

        abandon = threading.Event()

        def upstream() -> ToolResponse:
            return self.backend.execute(tool_name, args, call_index, input_hash)

        def run() -> tuple[ToolResponse | None, ToolResponse | None, dict[str, Any]]:
            if not faulted:
                resp = upstream()
                return resp, resp, {}
            r = self.scheduler.resolved
            out = r.fault.inject(
                FaultContext(
                    tool_name=tool_name, arguments=args, call_index=call_index, upstream=upstream,
                    abandon=abandon, payload=self.scheduler.payload, severity=r.config.severity,
                )
            )
            return out.delivered, out.upstream, out.detail

        if faulted:
            self.scheduler.record()
            self.stats.faults_injected += 1
            r = self.scheduler.resolved
            self.trace.emit(
                "fault_injected", f"{r.fault.title} injected into {tool_name} call #{call_index}",
                fault_id=fault_id, **common,
                data={"fault_type": r.config.fault_type.value, "payload_ref": r.payload_ref,
                      "severity": r.config.severity.value, "call_index": call_index},
            )

        timeout_s = min(self.settings.tool_timeout_ms / 1000, max(0.05, self.remaining_seconds))
        started = time.perf_counter()
        future = self._pool.submit(run)
        try:
            delivered, upstream_resp, detail = future.result(timeout=timeout_s)
        except FutureTimeout:
            abandon.set()
            duration = (time.perf_counter() - started) * 1000
            self.trace.emit(
                "tool_call_failed", f"{tool_name} timed out after {self.settings.tool_timeout_ms} ms",
                fault_id=fault_id, exception_type="ToolTimeoutError", output_schema_status="timeout",
                duration_ms=round(duration, 3), **common,
                data={"call_index": call_index, "upstream": None},
            )
            raise ToolTimeoutError(f"{tool_name} exceeded {self.settings.tool_timeout_ms} ms") from None
        except HarnessError:
            raise
        except Exception as exc:  # the fixture tool or fault code itself broke: our bug
            raise HarnessError(f"tool backend failed: {type(exc).__name__}: {exc}") from exc

        duration = (time.perf_counter() - started) * 1000
        status = check_output_schema(tool_name, delivered)
        self.trace.emit(
            "tool_call_completed", f"{tool_name} -> HTTP {delivered.status_code} ({status})",
            fault_id=fault_id, output_schema_status=status, duration_ms=round(duration, 3), **common,
            data={
                "call_index": call_index,
                "status_code": delivered.status_code,
                "headers": delivered.headers,
                "body": clip(delivered.body),
                "body_hash": stable_hash(delivered.body),
                "upstream": None if upstream_resp is None else {
                    "status_code": upstream_resp.status_code,
                    "body": upstream_resp.body,
                    "headers": upstream_resp.headers,
                },
                "fault_detail": detail,
            },
        )
        return delivered

    def close(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)


def _fmt_args(args: dict[str, Any]) -> str:
    return ", ".join(f"{k}={v!r}" for k, v in args.items())


def recorded_upstreams(events: list) -> dict[tuple[str, int], dict[str, Any]]:
    """Extract (tool, call_index) -> upstream output from a recorded trace, for ReplayBackend."""
    out: dict[tuple[str, int], dict[str, Any]] = {}
    for ev in events:
        if ev.phase != "tool_call_completed":
            continue
        up = ev.data.get("upstream")
        if up is None:
            continue
        out[(ev.tool_name, ev.data["call_index"])] = {**up, "input_hash": ev.input_hash}
    return out


ToolCaller = Callable[[str, dict[str, Any]], ToolResponse]
