"""Optional live Gemini adapter: bounded function-calling loop through the tool gateway.

* Untrusted tool text only ever travels inside function *responses*; the system instruction is a
  fixed constant and never concatenated with tool output.
* Every model request is counted against MAX_GEMINI_REQUESTS_PER_RUN and the free-tier limiter.
* The trace records function-call names, argument hashes and token counts -- never the raw prompt,
  free-text model output, or thought parts.
"""

from __future__ import annotations

from typing import Any, Literal

from app.agents.adapter import Task
from app.ai.gemini import SYSTEM_INSTRUCTION, ProviderUnavailable, function_declarations, get_limiter, make_client
from app.config import get_settings
from app.models import AgentConfig, RunResult
from app.runner.gateway import ToolGateway, ToolTimeoutError
from app.runner.trace import clip, stable_hash

TOOL_NAMES = {"get_benchmark", "get_research_paper", "verify_citation"}


class GeminiResearchAgent:
    name = "gemini"
    mode: Literal["offline", "live"] = "live"
    description = "Live Gemini function-calling agent (stochastic). One run is one trial, not a reliability guarantee."

    def __init__(self, client: Any = None, model: str | None = None):
        self._client = client
        self.model = model

    def execute(self, task: Task, tool_gateway: ToolGateway, config: AgentConfig) -> RunResult:
        from google.genai import errors as genai_errors
        from google.genai import types

        gw = tool_gateway
        settings = get_settings()
        client = self._client or make_client()
        model = self.model or settings.gemini_model
        gen_config = types.GenerateContentConfig(
            system_instruction=SYSTEM_INSTRUCTION,
            tools=[types.Tool(function_declarations=function_declarations())],
            tool_config=types.ToolConfig(function_calling_config=types.FunctionCallingConfig(mode="ANY")),
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
            temperature=config.temperature,
            seed=getattr(gw, "seed", None),
            max_output_tokens=2048,
        )
        contents: list[Any] = [
            types.Content(role="user", parts=[types.Part(text=(
                f"Task: {task.task}\nTechnology slug: {task.technology}\nMetric: {task.metric}\n"
                f"Scenario id: {task.scenario_id}. {task.simulation_notice}"
            ))])
        ]

        while True:
            gw.step("model turn", model=model)
            gw.count_model_request()
            get_limiter().acquire(max_wait_s=gw.remaining_seconds)
            try:
                response = client.models.generate_content(model=model, contents=contents, config=gen_config)
            except genai_errors.APIError as exc:
                raise ProviderUnavailable(f"Gemini API error {getattr(exc, 'code', '?')}: {clip(str(exc), 200)}") from exc

            calls = list(response.function_calls or [])
            usage = getattr(response, "usage_metadata", None)
            gw.note(
                "model_response",
                f"model requested {', '.join(c.name for c in calls) or 'no function call'}",
                function_calls=[{"name": c.name, "args_hash": stable_hash(c.args or {})} for c in calls],
                prompt_tokens=getattr(usage, "prompt_token_count", None),
                output_tokens=getattr(usage, "candidates_token_count", None),
            )
            if not calls:
                return RunResult(agent_error="model stopped without calling submit_report",
                                 steps=gw.stats.agent_steps, model_requests=gw.stats.model_requests)

            model_content = response.candidates[0].content
            # Drop any thought parts before echoing the turn back; we never store or replay them.
            model_content.parts = [p for p in (model_content.parts or []) if not getattr(p, "thought", False)]
            contents.append(model_content)

            reply_parts = []
            for call in calls:
                args = dict(call.args or {})
                if call.name == "submit_report":
                    artifact = {"task_id": task.scenario_id, **args}
                    for key in ("conflicts", "errors_disclosed", "untrusted_content_flags"):
                        artifact.setdefault(key, [])
                    for c in artifact.get("claims") or []:
                        c.setdefault("metric", task.metric)
                    return RunResult(artifact=artifact, steps=gw.stats.agent_steps,
                                     model_requests=gw.stats.model_requests)
                if call.name not in TOOL_NAMES:
                    payload = {"status_code": 400, "body": f'{{"error": "unknown_tool", "name": "{call.name[:40]}"}}'}
                else:
                    try:
                        resp = gw.call(call.name, args)
                        payload = {"status_code": resp.status_code, "body": resp.body,
                                   "retry_after_ms": resp.headers.get("retry-after-ms"),
                                   "trust_level": "untrusted" if call.name == "get_research_paper" else "tool_output"}
                    except ToolTimeoutError as exc:
                        payload = {"status_code": 504, "error": "timeout", "message": str(exc)}
                reply_parts.append(types.Part(function_response=types.FunctionResponse(
                    id=call.id, name=call.name, response=payload)))
            contents.append(types.Content(role="user", parts=reply_parts))
