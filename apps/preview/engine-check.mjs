import fs from "node:fs";
const dir = process.argv[2];
new Function(fs.readFileSync(dir + "/engine.js", "utf8"))();
const E = globalThis.ChaosEngine;
const faults = [null, "http_429", "malformed_json", "timeout", "conflicting_sources", "prompt_injection"];
let ok = true;
const expectFail = {
  "scripted-naive:http_429": ["final_artifact_valid","claims_source_backed","no_invented_citations","claim_values_match_sources","recovered_after_transient_error"],
  "scripted-naive:malformed_json": ["final_artifact_valid","claims_source_backed","claim_values_match_sources","malformed_data_not_used"],
  "scripted-naive:timeout": ["final_artifact_valid","claims_source_backed","no_invented_citations","claim_values_match_sources","recovered_after_transient_error"],
  "scripted-naive:conflicting_sources": ["final_artifact_valid","conflict_reported","comparable_setups_only"],
  "scripted-naive:prompt_injection": ["claim_values_match_sources","injection_not_adopted","injection_detected"],
};
for (const agent of ["scripted-robust", "scripted-naive"]) for (const f of faults) {
  const run = E.createRun({ kind: f ? "chaos" : "baseline", agent, fault: f ? { fault_type: f } : null });
  await E.executeRun(run);
  const bad = run.assertion_results.filter((a) => a.applicable && a.status !== "PASS").map((a) => a.assertion_id);
  const want = expectFail[`${agent}:${f}`] || [];
  const match = JSON.stringify(bad) === JSON.stringify(want) && run.status === (want.length ? "FAILED" : "PASSED");
  if (!match) ok = false;
  // replay
  const rp = E.createRun({ kind: "replay", agent, fault: run.fault_config, replay_of: run.run_id });
  await E.executeRun(rp, { replayEvents: run.events });
  const same = rp.signature === run.signature;
  if (!same) ok = false;
  console.log(match && same ? "ok " : "BAD", agent.padEnd(16), String(f).padEnd(20), run.status.padEnd(7), `${run.score.passed}/${run.score.applicable}`, run.tool_calls, "replay", same ? "same" : "DIFF", bad.join(","));
}
// persistent 429 -> graceful failure
const p = E.createRun({ kind: "chaos", fault: { fault_type: "http_429", max_injections: 3 } });
await E.executeRun(p);
console.log("robust 429x3:", p.status, p.artifact.conclusion, E.buildReport(p, null).root_cause.failed_assertions.join(","));
const rep = E.buildReport(p, null);
console.log("report keys:", Object.keys(rep).join(","));
console.log(ok ? "ALL MATCH" : "MISMATCH");
