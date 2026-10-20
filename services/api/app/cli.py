"""Command line: python -m app.cli run --scenario robotics-benchmark --fault malformed-json --seed 42"""

from __future__ import annotations

import argparse
import json
import sys

from app.faults.registry import BY_SLUG, FAULTS
from app.models import AgentConfig, FaultConfig, RunKind, Severity, ToolName
from app.runner.orchestrator import RunRejected, orchestrator
from app.runner.report import build_report
from app.runner.trace import cleanup_old_traces, read_events, write_json_atomic

MARK = {"PASS": "✓", "FAIL": "✗", "UNKNOWN": "?"}
TAGS = {
    "tool_call_completed": "OK", "tool_call_failed": "FAILED", "fault_injected": "FAULT", "agent_decision": "AGENT",
    "budget_exceeded": "BUDGET", "agent_crashed": "CRASH", "harness_error": "HARNESS", "agent_gave_up": "GAVE UP",
}


def _print_run(run_id: str, as_json: bool) -> dict:
    report = build_report(run_id)
    if as_json:
        print(json.dumps(report, indent=2, default=str))
        return report
    r = report["run"]
    print(f"\n{r['kind'].upper()} run {r['run_id']}  [{r['agent_adapter']} / {r['agent_mode']}]")
    if report["fault"]:
        f = report["fault"]
        print(f"  fault: {f['fault_type']} -> {f['target_tool']} call #{f['occurrence']} (x{f['max_injections']})")
    for ev in read_events(run_id):
        if ev.phase in TAGS:
            tag = TAGS[ev.phase]
            if ev.phase == "tool_call_completed" and ev.output_schema_status != "valid":
                tag = "BAD"
            print(f"  #{ev.sequence:<3} {ev.offset_ms:8.1f}ms {tag:<10} {ev.message}")
    print("  assertions:")
    for a in report["assertions"] or []:
        if a["applicable"]:
            print(f"    {MARK[a['status']]} {a['assertion_id']:<34} {a['reason']}")
    s = report["score"] or {}
    if s:
        print(f"  score: {s['passed']}/{s['applicable']} applicable (confidence {s['confidence']})")
    if report["comparison"]:
        c = report["comparison"]
        print(f"  vs baseline: tool calls {c['tool_calls']['baseline']} -> {c['tool_calls']['chaos']}, "
              f"recovery: {c['recovery_outcome']}")
    print(f"  STATUS: {r['status']}" + (f" ({r['failure_origin']} failure)" if r["failure_origin"] else "")
          + f" - {r['status_reason']}")
    print(f"  signature: {report['determinism']['signature']}")
    return report


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m app.cli", description="ChaosMonkey AI command line")
    sub = p.add_subparsers(dest="cmd", required=True)

    run = sub.add_parser("run", help="run a baseline, or a baseline + chaos run when --fault is given")
    run.add_argument("--scenario", default="robotics-benchmark")
    run.add_argument("--fault", choices=sorted(f.slug for f in FAULTS.values()))
    run.add_argument("--agent", default="scripted-robust")
    run.add_argument("--seed", type=int, default=42)
    run.add_argument("--target-tool", choices=[t.value for t in ToolName])
    run.add_argument("--occurrence", type=int, default=1)
    run.add_argument("--max-injections", type=int, default=1)
    run.add_argument("--severity", choices=[s.value for s in Severity], default="medium")
    run.add_argument("--json", action="store_true", help="print the full JSON report")
    run.add_argument("--out", help="also write the JSON report to this path")

    rp = sub.add_parser("replay", help="replay a recorded run with its recorded tool outputs and fault schedule")
    rp.add_argument("run_id")
    rp.add_argument("--json", action="store_true")

    sub.add_parser("faults", help="list the fault catalog")
    cl = sub.add_parser("cleanup", help="delete traces/reports older than RETENTION_DAYS")
    cl.add_argument("--days", type=int)

    args = p.parse_args(argv)
    try:
        if args.cmd == "faults":
            for f in FAULTS.values():
                print(f"{f.slug:<20} default target {f.default_target.value:<20} {f.expected_behavior}")
            return 0
        if args.cmd == "cleanup":
            removed = cleanup_old_traces(args.days)
            print(f"removed {len(removed)} trace(s)")
            return 0
        if args.cmd == "replay":
            new = orchestrator.create_replay(args.run_id)
            final = orchestrator.execute(new.run_id)
            report = _print_run(final.run_id, args.json)
            original = build_report(args.run_id)
            same = original["determinism"]["signature"] == report["determinism"]["signature"]
            if not args.json:
                print(f"  replay of {args.run_id}: signature {'IDENTICAL' if same else 'DIFFERENT'}")
            return 0 if same else 3

        agent = AgentConfig(adapter=args.agent)
        base = orchestrator.create_run(kind=RunKind.BASELINE, scenario_id=args.scenario, agent=agent, seed=args.seed)
        base = orchestrator.execute(base.run_id)
        if not args.fault:
            report = _print_run(base.run_id, args.json)
            final = base
        else:
            if not args.json:
                _print_run(base.run_id, False)
            fault = FaultConfig(
                fault_type=BY_SLUG[args.fault], target_tool=args.target_tool, occurrence=args.occurrence,
                max_injections=args.max_injections, severity=args.severity,
            )
            chaos = orchestrator.create_run(kind=RunKind.CHAOS, scenario_id=args.scenario, agent=agent, fault=fault,
                                            seed=args.seed, baseline_run_id=base.run_id)
            final = orchestrator.execute(chaos.run_id)
            report = _print_run(final.run_id, args.json)
        if args.out:
            from pathlib import Path
            write_json_atomic(Path(args.out), report)
        return {"PASSED": 0, "FAILED": 1}.get(final.status, 2)
    except (RunRejected, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
