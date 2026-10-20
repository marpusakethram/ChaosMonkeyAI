# What could go wrong, and how we guard against it

ChaosMonkey AI is a **testing tool you run on your own machine**. It tests the agents that ship with it, using
made-up data. It doesn't scan anything, and it never goes after anyone else's systems.

## What we're protecting
- Your Gemini API key, if you set one.
- Your computer: files, network, Docker.
- The log and report files, which could leak keys or prompts if we logged carelessly.
- The verdicts themselves. A "Passed" has to mean the agent really did the right thing.

## Where data crosses a line

| from → to | what crosses | how we keep it safe |
|---|---|---|
| Browser → backend | test settings | Only set options are accepted (fault type, tool, agent, a few numbers in a fixed range). Anything extra gets rejected. Nothing accepts code, links, file paths or commands. |
| Agent → tools | tool name and inputs | Everything goes through one gateway. Unknown tools and bad inputs (IDs must look like `BM-101`) get refused and never run. Tools only read the bundled data files. |
| Tool → AI model | text that could be sketchy | Only sent as tool results, marked as untrusted. The model's core instructions are fixed and never mixed with tool text (there's a test for this). |
| Backend → Gemini | prompts | Only the fixed question and tool results. Capped per run and per minute. |
| Backend → disk | logs and reports | Secrets get blanked out before anything is written. Only writes to the data folder. |

## Risks and what we do about them

| risk | what we do | the test that proves it |
|---|---|---|
| Someone runs code through the app | No endpoint takes code. Only built-in agents can run, picked by name from a fixed list. | `test_rejects_invalid_or_arbitrary_input` |
| The app gets tricked into calling random websites | Tools don't make web requests and there are no link fields anywhere. The only outside call is to Gemini, and only if you set a key. | code review, `test_unknown_tool_and_bad_args_rejected_without_execution` |
| Someone sneaks a file path in to read other files | Bad-data examples are picked from a fixed list, double-checked to stay inside the fixtures folder, and capped at 64 KB. | `test_rejects_invalid_or_arbitrary_input` |
| An agent loops forever or runs up a bill | Hard caps on tool calls, steps, total time, Gemini calls, retries per call, runs at once, and time per tool call. A watchdog kills stuck runs. | `test_infinite_loops_are_stopped_by_budgets`, `test_max_run_seconds_enforced` |
| The screen freezes | Runs happen in the background, the screen checks in every 0.7 s, there's a cancel button, and every run always ends with a result. | `test_cancel_running_run`, browser tests |
| Secrets end up in logs or reports | We blank out anything named like a key (`api_key`, `authorization`...), anything shaped like a key (`AIza…`, `Bearer …`, `sk-…`, `ghp_…`), and your actual Gemini key. We never log Gemini prompts, its free text, or its private reasoning. Only which tools it called. | `test_trace_export_contains_no_secret`, `test_trace_has_no_raw_prompt_or_thoughts` |
| Hidden instructions in documents | Document text stays marked as data. The checks measure whether the agent followed it and whether it noticed. | `test_prompt_injection_*`, `test_untrusted_text_never_enters_system_instruction` |
| A misleading verdict | We judge from our own recorded tool responses and the dataset, never from what the agent claims. "Not sure" never counts as a pass. When our own code breaks, the run says "Harness error", not "Failed". | `test_assertions_unit.py`, `test_harness_bug_is_error_not_agent_failure` |
| Breaking out of the Docker container | No access to Docker itself, doesn't run as admin, can't write to its own system files, all extra powers removed, only reachable from your machine. | `docker-compose.yml` |
| Filling up your disk | Each log file is capped at 1 MB, and old logs get deleted after 14 days. | `test_trace_file_size_cap`, `test_retention_cleanup` |

## Honest limits
- Passing the hidden-instruction test means the agent handled **this one test**. It doesn't mean it's safe from
  prompt injection in general.
- Each Gemini run is one sample. The Gemini code was tested with a fake stand-in for Google's API, not the real one,
  because there was no API key available while building it.
- Agents are trusted code running inside the app. Review any outside agent before adding it. The app doesn't
  sandbox agent code.
- There's no login. Keep it on your own machine, and don't put it on the public internet.
- Google may use free-tier Gemini requests to improve its products, so don't send private data through it.
