# Threat model

ChaosMonkey AI is a **local, defensive** test harness. It crash-tests bundled agents against bundled
fixtures. It is not a scanner and never targets third-party systems.

## Assets
- The user's Gemini API key (optional).
- The host machine (filesystem, network, Docker).
- Trace and report files (could leak keys or prompts if logged carelessly).
- Integrity of verdicts (a PASS must mean the observed behavior was correct).

## Trust boundaries

| boundary | what crosses it | control |
|---|---|---|
| Browser → API | JSON run configs | Pydantic models with `extra="forbid"`; enums for fault type, target tool, payload ref, adapter; numeric bounds (`occurrence` 1–10, `max_injections` 1–3, `seed` ≤ 2³¹). No field accepts code, URLs, file paths or shell. |
| Agent → tools | tool name + args | Single `ToolGateway`. Unknown tools and schema-invalid args (IDs must match `^[A-Z]{1,3}-\d{1,4}$`) get HTTP 400 and never execute. Tools only read bundled JSON. |
| Tool output → model | untrusted text | Sent only as function **responses** with `trust_level`. The system instruction is a constant and never concatenated with tool output (tested). |
| Harness → Gemini | prompts | Only the fixed task + tool results. Free-tier limiter + `MAX_GEMINI_REQUESTS_PER_RUN`. |
| Harness → disk | traces/reports | Redaction before write; only `CHAOS_DATA_DIR`. |

## Threats and mitigations

| threat | mitigation | verified by |
|---|---|---|
| Arbitrary code execution from the UI | No endpoint accepts code; only bundled adapters are registered; adapter name is checked against a fixed registry. | `test_rejects_invalid_or_arbitrary_input` |
| SSRF / calling user URLs | No HTTP client in tools; no URL fields anywhere. Only outbound call is the Google GenAI SDK, when a key is set. | code review; `test_unknown_tool_and_bad_args_rejected_without_execution` |
| Path traversal via payload refs | `payload_ref` is an enum per fault; payload loader also checks the resolved path stays in the fixture dir and is ≤64 KB. | `test_rejects_invalid_or_arbitrary_input` |
| Infinite loops / runaway cost | `MAX_TOOL_CALLS`, `MAX_AGENT_STEPS`, `MAX_RUN_SECONDS` (+ watchdog thread), `MAX_GEMINI_REQUESTS_PER_RUN`, `MAX_RETRIES_PER_CALL`, `MAX_CONCURRENT_RUNS`, per-call `TOOL_TIMEOUT_MS`. | `test_infinite_loops_are_stopped_by_budgets`, `test_max_run_seconds_enforced` |
| Hanging UI | Runs execute in background workers; UI polls every 700 ms; cancel endpoint; every run reaches a terminal status. | `test_cancel_running_run`, e2e |
| Secrets in traces/exports | Key-name redaction (`api_key`, `authorization`, …), value patterns (`AIza…`, `Bearer …`, `sk-…`, `ghp_…`), and literal replacement of the configured key. Gemini prompts, free text and thought parts are not logged — only function names, argument hashes, token counts. | `test_trace_export_contains_no_secret`, `test_trace_has_no_raw_prompt_or_thoughts` |
| Prompt injection via sources | Untrusted text stays in the data channel; assertions measure adoption and detection. | `test_prompt_injection_*`, `test_untrusted_text_never_enters_system_instruction` |
| Misleading verdicts | Ground truth comes from the gateway's recorded outputs and the fixture dataset, never from the agent's self-report. UNKNOWN never counts as a pass. Harness failures are `ERROR`, not `FAILED`. | `test_assertions_unit.py`, `test_harness_bug_is_error_not_agent_failure` |
| Container escape / host access | Compose: no Docker socket, non-root user, `read_only` root FS, `cap_drop: ALL`, `no-new-privileges`, ports bound to 127.0.0.1. | `docker-compose.yml` |
| Disk exhaustion | `TRACE_MAX_BYTES` per trace (truncation marker), `RETENTION_DAYS` cleanup at startup and via CLI. | `test_trace_file_size_cap`, `test_retention_cleanup` |

## Known limitations (honest list)
- A PASS on the prompt-injection probe is evidence for **this one probe**. It is not a guarantee of injection resistance.
- The live Gemini path is a single stochastic trial per run. It was tested here with a mocked client built from
  real SDK types; it was **not** exercised against the live API in this build (no key available in the build environment).
- Agent adapters are trusted Python running in-process. Third-party adapters must be reviewed before bundling;
  the harness does not sandbox Python code.
- No authentication: the API is meant to bind to localhost only. Do not expose it publicly.
- Free-tier Gemini requests may be used by Google to improve products; don't send private data through it.
