# Adapter API

```python
class AgentAdapter(Protocol):
    name: str                      # registry key, e.g. "scripted-robust"
    mode: Literal["offline", "live"]
    description: str

    def execute(self, task: Task, tool_gateway: ToolGateway, config: AgentConfig) -> RunResult: ...
```

- `task` — the scenario (`task.task`, `task.technology`, `task.metric`, `task.scenario_id`, …).
- `tool_gateway.call(name, args) -> ToolResponse(status_code, body: str, headers)` — the **only** way to reach a tool.
  It may raise `ToolTimeoutError` (catch it), and raises `BudgetExceeded` / `RunCancelled` (let those propagate).
  Bodies are raw text; parsing and validating is your agent's job — that is what the malformed-JSON fault tests.
- `tool_gateway.step(description)` — call once per reasoning step (enforces `MAX_AGENT_STEPS`).
- `tool_gateway.count_model_request()` — call before every LLM request (enforces `MAX_GEMINI_REQUESTS_PER_RUN`).
- `tool_gateway.note(phase, message, **data)` — short structured decision logs. Never log chain-of-thought or raw prompts.
- Return `RunResult(artifact=<dict matching ResearchReport>)`, or `RunResult(agent_error="...")` if the agent gives up.
  Any other exception is recorded as an **agent crash** (FAILED), not a harness error.

`ResearchReport` (see `app/models.py`): `conclusion`, `summary`, `claims[] {claim_id, statement, values[] {benchmark_id, value}, source_ids[], verified}`,
`conflicts[]`, `errors_disclosed[]`, `untrusted_content_flags[]`.

## Bundled adapters

| name | mode | what it is |
|---|---|---|
| `scripted-robust` | offline | Deterministic, follows the rules. Validates, retries ≤2 with capped backoff, flags untrusted text, groups by setup. |
| `scripted-naive` | offline | Deliberately fragile on purpose: no retries, regex-scrapes broken JSON, obeys instructions in sources, averages everything. Exists so you can see assertions catch real failure modes. |
| `gemini` | live | Gemini function-calling loop via `google-genai`. Enabled only when `GEMINI_API_KEY` is set. |

## Wrapping another framework (LangChain, AutoGen, CrewAI, your own)

Write a thin adapter that turns the gateway into that framework's tool objects:

```python
class MyFrameworkAdapter:
    name, mode, description = "my-agent", "live", "My agent on framework X"

    def execute(self, task, tool_gateway, config):
        def make_tool(tool_name):
            def tool(**kwargs):
                tool_gateway.step(f"tool {tool_name}")
                try:
                    r = tool_gateway.call(tool_name, kwargs)
                    return {"status_code": r.status_code, "body": r.body}
                except ToolTimeoutError as e:
                    return {"status_code": 504, "error": str(e)}
            return tool
        tools = [make_tool(n) for n in ("get_benchmark", "get_research_paper", "verify_citation")]
        report = run_my_agent(task.task, tools)   # your framework, bounded by your own step limit too
        return RunResult(artifact=report)
```

Register it in `available_adapters()` (`app/agents/adapter.py`).

### Rules for third-party adapters
- **No secret transfer.** The harness never hands keys to adapters. If your agent needs a model key, read it from
  your own environment variable inside the adapter process; it is redacted from traces by pattern and must not
  be put in `note()` data.
- **No untrusted code execution.** Adapters are reviewed source code bundled into the repo. The API cannot load
  adapters, URLs or code at runtime, by design.
- **No side channels.** Don't let your framework call tools directly (HTTP, shell, filesystem). Everything must go
  through `tool_gateway.call`, or faults and budgets won't apply and the run means nothing.
