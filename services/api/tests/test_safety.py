"""Budgets, cancellation, redaction, trace limits (C6)."""

import json
import threading
import time

import pytest

from app.agents.reference_agent import ScriptedResearchAgent
from app.models import AgentConfig, RunKind, RunResult
from app.runner import orchestrator as orch_mod
from app.runner.orchestrator import orchestrator
from app.runner.redaction import REDACTED, redact
from app.runner.trace import TraceWriter, cleanup_old_traces, read_events, trace_path


class LoopingAgent:
    """Adversarial adapter: retries forever unless the harness stops it."""
    name, mode, description = "looping", "offline", "test only"

    def __init__(self, kind):
        self.kind = kind

    def execute(self, task, gw, config):
        while True:
            if self.kind == "tools":
                gw.call("verify_citation", {"id": f"BM-{100 + gw.stats.tool_calls % 9}"})
            elif self.kind == "retries":
                gw.call("verify_citation", {"id": "BM-101"})
            elif self.kind == "steps":
                gw.step("thinking")
            elif self.kind == "model":
                gw.count_model_request()
            elif self.kind == "sleep":
                time.sleep(0.05)
                gw.check_alive()


@pytest.fixture
def adapters(monkeypatch):
    def install(agent):
        monkeypatch.setattr(orch_mod, "available_adapters", lambda: {
            "scripted-robust": ScriptedResearchAgent(), agent.name: agent})
    return install


def _run(name):
    r = orchestrator.create_run(kind=RunKind.BASELINE, scenario_id="robotics-benchmark", agent=AgentConfig(adapter=name))
    return orchestrator.execute(r.run_id)


@pytest.mark.parametrize("kind,budget", [
    ("tools", "MAX_TOOL_CALLS"), ("retries", "MAX_RETRIES_PER_CALL"),
    ("steps", "MAX_AGENT_STEPS"), ("model", "MAX_GEMINI_REQUESTS_PER_RUN"),
])
def test_infinite_loops_are_stopped_by_budgets(adapters, kind, budget):
    adapters(LoopingAgent(kind))
    run = _run("looping")
    assert run.status == "FAILED" and run.failure_origin == "agent"
    assert budget in run.status_reason
    assert any(e.phase == "budget_exceeded" for e in read_events(run.run_id))


def test_max_run_seconds_enforced(adapters, use_settings):
    use_settings(max_run_seconds=1)
    adapters(LoopingAgent("sleep"))
    t0 = time.monotonic()
    run = _run("looping")
    assert time.monotonic() - t0 < 5
    assert run.status == "FAILED" and "MAX_RUN_SECONDS" in run.status_reason


def test_cancel_running_run(adapters):
    adapters(LoopingAgent("sleep"))
    r = orchestrator.create_run(kind=RunKind.BASELINE, scenario_id="robotics-benchmark", agent=AgentConfig(adapter="looping"))
    out = {}
    t = threading.Thread(target=lambda: out.setdefault("run", orchestrator.execute(r.run_id)))
    t.start()
    time.sleep(0.3)
    orchestrator.cancel(r.run_id)
    t.join(5)
    assert out["run"].status == "CANCELLED"


def test_harness_bug_is_error_not_agent_failure(monkeypatch):
    from app.runner import gateway
    def broken(self, *a, **k):
        raise RuntimeError("fixture backend exploded")
    monkeypatch.setattr(gateway.FixtureBackend, "execute", broken)
    run = _run("scripted-robust")
    assert run.status == "ERROR" and run.failure_origin == "harness"


def test_agent_exception_is_agent_failure(adapters):
    class Crashy:
        name, mode, description = "crashy", "offline", "test"
        def execute(self, task, gw, config):
            raise ValueError("boom")
    adapters(Crashy())
    run = _run("crashy")
    assert run.status == "FAILED" and run.failure_origin == "agent" and "boom" in run.status_reason


def test_redaction_removes_keys_and_tokens(use_settings):
    use_settings(gemini_api_key="AIzaSyTESTKEY000000000000000000000000000")
    data = {"api_key": "x", "headers": {"Authorization": "Bearer abc.def.ghi"},
            "note": "key AIzaSyTESTKEY000000000000000000000000000 and sk-abcdefghijklmnopqrstuv"}
    out = json.dumps(redact(data))
    assert "AIza" not in out and "sk-abc" not in out and "abc.def" not in out
    assert out.count(REDACTED) >= 3


def test_trace_export_contains_no_secret(use_settings):
    secret = "AIzaSyLEAKCHECK0000000000000000000000000"
    use_settings(gemini_api_key=secret)
    w = TraceWriter("leakcheck")
    w.emit("note", f"message with {secret}", data={"authorization": "Bearer zzzzzzzzzzzz", "nested": [secret]})
    raw = trace_path("leakcheck").read_text()
    assert secret not in raw and "zzzzzzzz" not in raw


def test_trace_file_size_cap():
    w = TraceWriter("capped", max_bytes=2000)
    for i in range(50):
        w.emit("note", "x" * 100)
    raw = trace_path("capped").read_bytes()
    assert len(raw) <= 2000 + 600
    assert read_events("capped")[-1].phase == "trace_truncated"
    assert len(w.events) == 50  # assertions still see the full in-memory trace


def test_retention_cleanup(settings):
    import os
    w = TraceWriter("old")
    w.emit("note", "old")
    old = time.time() - 30 * 86400
    os.utime(trace_path("old"), (old, old))
    TraceWriter("fresh").emit("note", "fresh")
    assert cleanup_old_traces(14) == ["old"]
    assert trace_path("fresh").exists()


def test_unknown_tool_and_bad_args_rejected_without_execution(adapters):
    class Prober:
        name, mode, description = "prober", "offline", "test"
        def execute(self, task, gw, config):
            a = gw.call("rm_rf", {"path": "/"})
            b = gw.call("get_research_paper", {"id": "../../etc/passwd"})
            c = gw.call("get_benchmark", {"technology": "robotic-manipulation", "url": "http://evil"})
            return RunResult(agent_error=f"{a.status_code},{b.status_code},{c.status_code}")
    adapters(Prober())
    run = _run("prober")
    assert run.status_reason.endswith("400,400,400")
    assert run.tool_calls == 0
