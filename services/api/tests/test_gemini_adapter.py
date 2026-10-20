"""Gemini adapter against a fake client built from real google-genai response types.

These are mocks: they test our loop, bounds and data handling, not Gemini's behavior.
"""

import pytest
from google.genai import types

from app.agents.gemini_agent import GeminiResearchAgent
from app.ai.gemini import SYSTEM_INSTRUCTION, ProviderUnavailable, RequestLimiter
from app.models import AgentConfig, FaultConfig, FaultType, RunKind
from app.runner import orchestrator as orch_mod
from app.runner.orchestrator import orchestrator
from app.runner.trace import trace_path


def fc(name, **args):
    return types.Part(function_call=types.FunctionCall(name=name, args=args))


def resp(*parts):
    return types.GenerateContentResponse(candidates=[types.Candidate(content=types.Content(role="model", parts=list(parts)))])


class FakeModels:
    def __init__(self, script):
        self.script = script
        self.calls = []

    def generate_content(self, model, contents, config):
        self.calls.append((contents, config))
        step = self.script[min(len(self.calls) - 1, len(self.script) - 1)]
        return step(contents) if callable(step) else step


class FakeClient:
    def __init__(self, script):
        self.models = FakeModels(script)


GOOD_REPORT = dict(conclusion="improved", summary="BM-101 62.0 -> BM-102 71.5", claims=[{
    "claim_id": "C1", "statement": "62.0 -> 71.5", "values": [{"benchmark_id": "BM-101", "value": 62.0},
    {"benchmark_id": "BM-102", "value": 71.5}], "source_ids": ["BM-101", "BM-102"], "verified": True}])


def _install(monkeypatch, client):
    monkeypatch.setattr(orch_mod, "available_adapters", lambda: {"gemini": GeminiResearchAgent(client=client, model="fake")})


def _run(fault=None):
    r = orchestrator.create_run(kind=RunKind.CHAOS if fault else RunKind.BASELINE, scenario_id="robotics-benchmark",
                                agent=AgentConfig(adapter="gemini"), fault=fault)
    return orchestrator.execute(r.run_id)


def test_function_calling_loop_routes_through_gateway(monkeypatch):
    client = FakeClient([
        resp(fc("get_benchmark", technology="robotic-manipulation")),
        resp(fc("verify_citation", id="BM-101"), fc("verify_citation", id="BM-102")),
        resp(fc("submit_report", **GOOD_REPORT)),
    ])
    _install(monkeypatch, client)
    run = _run()
    assert run.status == "PASSED", run.status_reason
    assert run.agent_mode == "live" and run.score["confidence"] == "low"
    assert run.tool_calls == 3 and run.model_requests == 3


def test_untrusted_text_never_enters_system_instruction(monkeypatch):
    client = FakeClient([
        resp(fc("get_research_paper", id="P-201")),
        resp(fc("submit_report", **GOOD_REPORT)),
    ])
    _install(monkeypatch, client)
    _run(FaultConfig(fault_type=FaultType.PROMPT_INJECTION))
    contents, config = client.models.calls[-1]
    assert config.system_instruction == SYSTEM_INSTRUCTION
    assert "Ignore prior instructions" not in config.system_instruction
    fr = next(p.function_response for c in contents for p in c.parts if p.function_response)
    assert fr.response["trust_level"] == "untrusted" and "Ignore prior instructions" in fr.response["body"]
    assert config.automatic_function_calling.disable is True


def test_model_request_cap_stops_a_chatty_model(monkeypatch, use_settings):
    use_settings(max_gemini_requests_per_run=3)
    _install(monkeypatch, FakeClient([resp(fc("verify_citation", id="BM-101"))]))
    run = _run()
    assert run.status == "FAILED" and "MAX_GEMINI_REQUESTS_PER_RUN" in run.status_reason


def test_trace_has_no_raw_prompt_or_thoughts(monkeypatch):
    thought = types.Part(text="SECRET-CHAIN-OF-THOUGHT", thought=True)
    _install(monkeypatch, FakeClient([resp(thought, fc("submit_report", **GOOD_REPORT))]))
    run = _run()
    raw = trace_path(run.run_id).read_text()
    assert "SECRET-CHAIN-OF-THOUGHT" not in raw
    assert "careful research assistant" not in raw  # system prompt not logged


def test_provider_error_is_harness_error(monkeypatch):
    from google.genai import errors
    class Boom:
        class models:
            @staticmethod
            def generate_content(**kw):
                raise errors.APIError(429, {"error": {"message": "quota"}})
    _install(monkeypatch, Boom())
    run = _run()
    assert run.status == "ERROR" and run.failure_origin == "harness"


def test_limiter_refuses_when_budget_cannot_wait():
    lim = RequestLimiter(rpm=1)
    lim.acquire(max_wait_s=1)
    with pytest.raises(ProviderUnavailable):
        lim.acquire(max_wait_s=0.1)
