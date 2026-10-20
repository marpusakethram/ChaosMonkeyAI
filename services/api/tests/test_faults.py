import json

import pytest

from app.models import FaultType
from app.runner.trace import read_events
from tests.conftest import run_once, statuses


def _fault_events(run):
    return [e for e in read_events(run.run_id) if e.phase == "fault_injected"]


@pytest.mark.parametrize("fault,tool", [
    (FaultType.HTTP_429, "get_benchmark"),
    (FaultType.MALFORMED_JSON, "get_benchmark"),
    (FaultType.TIMEOUT, "get_benchmark"),
    (FaultType.CONFLICTING_SOURCES, "get_benchmark"),
    (FaultType.PROMPT_INJECTION, "get_research_paper"),
])
def test_each_fault_is_observable_in_trace_and_robust_agent_recovers(fault, tool):
    run = run_once(fault=fault)
    faults = _fault_events(run)
    assert len(faults) == 1
    assert faults[0].tool_name == tool and faults[0].fault_id == f"{fault.value}@{tool}#1"
    assert run.status == "PASSED", run.status_reason


def test_429_returns_structured_retry_after_and_robust_agent_retries():
    run = run_once(fault=FaultType.HTTP_429)
    done = [e for e in read_events(run.run_id) if e.phase == "tool_call_completed" and e.tool_name == "get_benchmark"]
    assert done[0].data["status_code"] == 429
    assert json.loads(done[0].data["body"])["retry_after_ms"] > 0
    assert done[1].retry_index == 1 and done[1].output_schema_status == "valid"
    assert statuses(run)["recovered_after_transient_error"] == "PASS"


def test_persistent_429_ends_in_explicit_graceful_failure():
    run = run_once(fault=FaultType.HTTP_429, max_injections=3)
    assert run.status == "FAILED" and run.failure_origin == "agent"
    assert run.artifact["conclusion"] == "unable_to_complete"
    assert run.artifact["errors_disclosed"]
    assert statuses(run)["bounded_execution"] == "PASS"
    assert statuses(run)["recovered_after_transient_error"] == "FAIL"


def test_malformed_json_naive_agent_silently_uses_bad_data():
    run = run_once("scripted-naive", fault=FaultType.MALFORMED_JSON)
    s = statuses(run)
    assert run.status == "FAILED"
    assert s["malformed_data_not_used"] == "FAIL"
    bad = next(e for e in read_events(run.run_id) if e.phase == "tool_call_completed" and e.fault_id)
    assert bad.output_schema_status == "invalid_json"


def test_timeout_is_bounded_and_naive_agent_crash_is_agent_failure():
    run = run_once("scripted-naive", fault=FaultType.TIMEOUT)
    assert run.status == "FAILED" and run.failure_origin == "agent"
    failed = [e for e in read_events(run.run_id) if e.phase == "tool_call_failed"]
    assert failed[0].exception_type == "ToolTimeoutError"
    assert run.latency_ms < 3000


def test_conflicting_sources_robust_reports_naive_combines():
    robust = run_once(fault=FaultType.CONFLICTING_SOURCES)
    assert any("BM-103" in c["benchmark_ids"] for c in robust.artifact["conflicts"])
    naive = run_once("scripted-naive", fault=FaultType.CONFLICTING_SOURCES)
    s = statuses(naive)
    assert s["conflict_reported"] == "FAIL" and s["comparable_setups_only"] == "FAIL"


def test_prompt_injection_naive_adopts_robust_flags():
    naive = run_once("scripted-naive", fault=FaultType.PROMPT_INJECTION)
    assert statuses(naive)["injection_not_adopted"] == "FAIL"
    assert any(v["value"] == 999 for v in naive.artifact["claims"][0]["values"])
    robust = run_once(fault=FaultType.PROMPT_INJECTION)
    assert statuses(robust)["injection_detected"] == "PASS"
    assert "999" not in json.dumps(robust.artifact["claims"])


def test_fault_occurrence_targets_the_nth_call():
    run = run_once(fault=FaultType.MALFORMED_JSON, target_tool="verify_citation", occurrence=3)
    f = _fault_events(run)
    assert len(f) == 1 and f[0].data["call_index"] == 3 and f[0].tool_name == "verify_citation"


def test_invalid_fault_target_rejected():
    from app.runner.orchestrator import RunRejected
    with pytest.raises(RunRejected):
        run_once(fault=FaultType.PROMPT_INJECTION, target_tool="get_benchmark")
