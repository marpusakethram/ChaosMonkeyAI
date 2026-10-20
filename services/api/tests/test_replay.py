"""C1 acceptance gate: a recorded run replays with fixed tool outputs and identical fault schedule."""

import pytest

from app.models import FaultType
from app.runner.orchestrator import orchestrator
from app.runner.trace import event_signature_rows, read_events
from tests.conftest import run_once


@pytest.mark.parametrize("agent,fault", [
    ("scripted-robust", None),
    ("scripted-robust", FaultType.HTTP_429),
    ("scripted-naive", FaultType.MALFORMED_JSON),
    ("scripted-robust", FaultType.TIMEOUT),
    ("scripted-naive", FaultType.PROMPT_INJECTION),
    ("scripted-robust", FaultType.CONFLICTING_SOURCES),
])
def test_replay_is_identical(agent, fault):
    original = run_once(agent, fault=fault)
    replay = orchestrator.execute(orchestrator.create_replay(original.run_id).run_id)
    assert replay.replay_of == original.run_id
    assert replay.status == original.status
    assert event_signature_rows(read_events(replay.run_id)) == event_signature_rows(read_events(original.run_id))
    assert replay.signature == original.signature
    assert [(a["assertion_id"], a["status"]) for a in replay.assertion_results] == \
           [(a["assertion_id"], a["status"]) for a in original.assertion_results]


def test_same_seed_fresh_runs_have_same_signature():
    a = run_once(fault=FaultType.MALFORMED_JSON, seed=7)
    b = run_once(fault=FaultType.MALFORMED_JSON, seed=7)
    assert a.signature == b.signature


def test_replay_uses_recorded_outputs_not_live_fixtures(monkeypatch):
    original = run_once()
    from app.tools import research_tools
    monkeypatch.setitem(research_tools.TOOLS, "get_benchmark", lambda **k: (_ for _ in ()).throw(AssertionError("live call")))
    replay = orchestrator.execute(orchestrator.create_replay(original.run_id).run_id)
    assert replay.status == "PASSED"
