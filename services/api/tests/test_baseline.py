from app.runner.trace import read_events
from tests.conftest import run_once, statuses


def test_baseline_passes_and_validates_a_source_backed_claim():
    run = run_once()
    assert run.status == "PASSED"
    assert run.failure_origin is None
    claim = run.artifact["claims"][0]
    assert {"BM-101", "BM-102"} <= set(claim["source_ids"])
    assert claim["verified"] is True
    assert statuses(run)["claims_source_backed"] == "PASS"
    assert run.score["value"] == 1.0 and run.score["confidence"] == "high"


def test_baseline_trace_has_every_required_event_field():
    run = run_once()
    events = read_events(run.run_id)
    assert [e.sequence for e in events] == list(range(1, len(events) + 1))
    phases = {e.phase for e in events}
    assert {"run_started", "tool_call_started", "tool_call_completed", "assertion_evaluated", "run_completed"} <= phases
    call = next(e for e in events if e.phase == "tool_call_completed")
    for f in ("timestamp", "run_id", "invocation_id", "input_hash", "output_schema_status", "duration_ms", "retry_index"):
        assert getattr(call, f) is not None, f


def test_baseline_tool_calls_follow_reference_workflow():
    run = run_once()
    tools = [e.tool_name for e in read_events(run.run_id) if e.phase == "tool_call_started"]
    assert tools[0] == "get_benchmark"
    assert tools.count("get_research_paper") == 2
    assert tools.count("verify_citation") == 4
    assert run.tool_calls == 7


def test_naive_agent_also_passes_baseline():
    # Faults, not the happy path, are what separate the two reference agents.
    assert run_once("scripted-naive").status == "PASSED"
