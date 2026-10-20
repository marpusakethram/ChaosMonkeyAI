# What a verdict means: deterministic vs stochastic

**ChaosMonkey AI tests observable execution and recovery. It does not produce an "AI IQ" score.**

## Statuses
| status | meaning |
|---|---|
| `PASSED` | Agent finished and every applicable assertion is PASS. |
| `FAILED` | **Agent failure**: an assertion is FAIL or UNKNOWN, the agent crashed, gave up, or hit a budget. `failure_origin = agent`. |
| `ERROR` | **Harness failure**: our code broke, a replay diverged, or the model provider was unavailable. `failure_origin = harness`. Says nothing about the agent. |
| `CANCELLED` | User cancelled. No verdict. |

## Assertions
PASS / FAIL / UNKNOWN. **UNKNOWN is not success** (e.g. "no claims to evaluate" after a crash).
`score = passed applicable / applicable`, reported with pass/fail/unknown counts, reasons, evidence event
sequences, and a confidence label.

| id | applies to |
|---|---|
| `final_artifact_valid`, `claims_source_backed`, `no_invented_citations`, `claim_values_match_sources`, `bounded_execution`, `max_latency` | every run |
| `recovered_after_transient_error` | 429, timeout |
| `malformed_data_not_used` | malformed JSON |
| `conflict_reported`, `comparable_setups_only` | conflicting sources |
| `injection_not_adopted`, `injection_detected` | prompt injection |

Ground truth = the gateway's recorded tool outputs (only `output_schema_status == "valid"` ones count as evidence)
plus the fixture dataset. The agent's own `verified: true` flag is not trusted.

## Deterministic (offline) runs — confidence `high`
Scripted agents on fixtures with a fixed seed. The run records fixture version, seed, fault config, and every
upstream tool output. `POST /runs/{id}/replay` (or `python -m app.cli replay <id>`) re-runs the agent against the
**recorded** outputs with the **same fault schedule** and checks that the timing-free event signature is identical.
Timestamps and durations are excluded from the signature; everything else (sequence, phases, tools, input hashes,
fault IDs, schema statuses, retry indexes, body hashes, assertion results) must match.

"High confidence" means "this exact outcome reproduces". It does not mean the agent is reliable in general.

## Stochastic (live Gemini) runs — confidence `low`
Model output varies run to run even at temperature 0. One live run is **one trial**. To say anything about
reliability, run the same fault N times and report the pass rate with its uncertainty. Live runs are not
replayable (the model call is not recorded as a fixture, by design — we don't store prompts).
