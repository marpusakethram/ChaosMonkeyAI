"""Assertion semantics on synthetic inputs: UNKNOWN is never success; score math."""

from app.models import AssertionResult, AssertionStatus
from app.runner.assertions import AssertionContext, evaluate, score
from app.tools.research_tools import load_dataset


def _ctx(artifact, **kw):
    base = dict(artifact=artifact, events=[], fault=None, dataset=load_dataset(),
                expected={"conclusion": "improved", "max_tool_calls": 16, "max_latency_ms": 8000},
                max_retries_per_call=3, tool_calls=3, latency_ms=100.0, agent_error=None, budget_exceeded=None)
    base.update(kw)
    return AssertionContext(**base)


def test_missing_artifact_gives_fail_and_unknown_not_pass():
    res = {r.assertion_id: r for r in evaluate(_ctx(None, agent_error="crashed"))}
    assert res["final_artifact_valid"].status == AssertionStatus.FAIL
    assert res["claims_source_backed"].status == AssertionStatus.UNKNOWN
    sc = score(list(res.values()), "offline")
    assert sc.passed == 2 and sc.unknown == 3 and sc.value == round(2 / 6, 4)


def test_invented_citation_detected():
    art = {"task_id": "robotics-benchmark", "conclusion": "improved", "summary": "s",
           "claims": [{"claim_id": "C1", "statement": "x", "values": [], "source_ids": ["BM-999"], "verified": True}]}
    res = {r.assertion_id: r for r in evaluate(_ctx(art))}
    assert res["no_invented_citations"].status == AssertionStatus.FAIL
    assert "BM-999" in res["no_invented_citations"].reason
    # Never seen in a valid tool output either:
    assert res["claims_source_backed"].status == AssertionStatus.FAIL


def test_schema_invalid_artifact_is_fail():
    res = {r.assertion_id: r for r in evaluate(_ctx({"conclusion": "great"}))}
    assert res["final_artifact_valid"].status == AssertionStatus.FAIL


def test_fault_specific_assertions_not_applicable_on_baseline():
    res = evaluate(_ctx(None))
    na = {r.assertion_id for r in res if not r.applicable}
    assert {"malformed_data_not_used", "injection_not_adopted", "conflict_reported"} <= na


def test_latency_and_budget_failures():
    res = {r.assertion_id: r for r in evaluate(_ctx(None, latency_ms=99999, tool_calls=40))}
    assert res["max_latency"].status == AssertionStatus.FAIL
    assert res["bounded_execution"].status == AssertionStatus.FAIL


def test_live_mode_score_is_low_confidence():
    r = [AssertionResult(assertion_id="a", title="a", status=AssertionStatus.PASS, applicable=True, reason="")]
    assert score(r, "live").confidence == "low"
