# Plug in your own agent

An "adapter" is a small wrapper that lets ChaosMonkey AI run your agent. It only needs one method:

```python
class AgentAdapter(Protocol):
    name: str                      # short name, e.g. "scripted-robust"
    mode: Literal["offline", "live"]
    description: str

    def execute(self, task: Task, tool_gateway: ToolGateway, config: AgentConfig) -> RunResult: ...
```

What you get and what you give back:

- `task`: the question to answer and some details (`task.task`, `task.technology`, `task.metric`, `task.scenario_id`).
- `tool_gateway.call(name, args)`: **the only way** your agent can use a tool. You get back a status code, the raw
  text, and headers. It might throw `ToolTimeoutError` (catch that one). If it throws `BudgetExceeded` or
  `RunCancelled`, let those through.
  The response is raw text on purpose. Checking that it's valid JSON is your agent's job, and that's exactly what the
  broken-JSON test checks.
- `tool_gateway.step(description)`: call this once per thinking step, so we can stop runaway loops.
- `tool_gateway.count_model_request()`: call this before every AI model call, so we can cap them.
- `tool_gateway.note(phase, message, **data)`: short notes about decisions for the log. Don't log the model's
  private reasoning or full prompts.
- Give back `RunResult(artifact=<the report dict>)`, or `RunResult(agent_error="...")` if the agent gives up.
  If your code throws any other error, we count it as **the agent crashing**, not our bug.

The report your agent hands back (`ResearchReport` in `app/models.py`) has: a conclusion, a summary, a list of
claims (each with numbers, source IDs, and whether it was verified), conflicts it found, errors it ran into, and
any sketchy content it flagged.

## Agents that come with it

| name | type | what it is |
|---|---|---|
| `scripted-robust` | offline | The careful one. Checks every response, retries up to 2 times, flags sketchy text, keeps different tests apart. |
| `scripted-naive` | offline | The fragile one, on purpose. Never retries, patches up broken JSON, follows instructions it finds in documents, averages everything. It's there so you can see the checks catch real mistakes. |
| `gemini` | live | A real Gemini model calling tools. Only shows up if you set `GEMINI_API_KEY`. |

## Wrapping LangChain, AutoGen, CrewAI or your own setup

Write a thin adapter that turns the gateway into tools your framework understands:

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
        report = run_my_agent(task.task, tools)   # your framework, with its own step limit too
        return RunResult(artifact=report)
```

Then add it to `available_adapters()` in `app/agents/adapter.py`.

### House rules for outside agents

- **Don't hand over secrets.** We never pass API keys to adapters. If your agent needs a key, read it from your own
  environment variable inside the adapter, and never put it in `note()`. We blank out anything that looks like a
  key in the logs anyway.
- **No running unknown code.** Adapters are reviewed code that ships with the project. The app can't load agents,
  links or code while it's running. That's on purpose.
- **No back doors.** Don't let your framework call tools directly (web requests, shell, files). Everything has to
  go through `tool_gateway.call`, or the problems and limits won't apply and the test means nothing.
