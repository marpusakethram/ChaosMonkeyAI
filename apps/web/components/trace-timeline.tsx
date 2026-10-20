"use client";

import { useState } from "react";
import type { TraceEvent } from "@/lib/api";
import { cn, ms } from "@/lib/utils";

type Kind = "fault" | "recover" | "fail" | "pass" | "unknown" | "decision" | "neutral";

export function classify(e: TraceEvent): { kind: Kind; label: string } {
  const status = e.data?.status as string | undefined;
  switch (e.phase) {
    case "fault_injected":
      return { kind: "fault", label: "FAULT" };
    case "tool_call_completed":
      if (e.output_schema_status !== "valid") return { kind: "fail", label: e.output_schema_status?.toUpperCase() ?? "BAD" };
      if ((e.retry_index ?? 0) > 0) return { kind: "recover", label: "RECOVERED" };
      return { kind: "neutral", label: "OK" };
    case "tool_call_failed":
      return { kind: "fail", label: e.exception_type ?? "FAILED" };
    case "tool_call_started":
      return { kind: "neutral", label: "CALL" };
    case "tool_call_rejected":
      return { kind: "fail", label: "REJECTED" };
    case "assertion_evaluated":
      return status === "PASS"
        ? { kind: "pass", label: "PASS" }
        : status === "FAIL"
          ? { kind: "fail", label: "FAIL" }
          : { kind: "unknown", label: "UNKNOWN" };
    case "agent_decision":
    case "model_response":
      return { kind: "decision", label: "AGENT" };
    case "agent_step":
      return { kind: "neutral", label: "STEP" };
    case "artifact_submitted":
      return { kind: "neutral", label: "REPORT" };
    case "budget_exceeded":
    case "agent_crashed":
    case "agent_gave_up":
    case "harness_error":
      return { kind: "fail", label: e.phase.replace("_", " ").toUpperCase() };
    case "run_completed": {
      const s = e.data?.status as string;
      return { kind: s === "PASSED" ? "pass" : s === "CANCELLED" ? "neutral" : "fail", label: s ?? "DONE" };
    }
    default:
      return { kind: "neutral", label: e.phase.toUpperCase() };
  }
}

const DOT: Record<Kind, string> = {
  fault: "bg-fault shadow-[0_0_10px_#ff8a1f]",
  recover: "bg-recover shadow-[0_0_10px_#35d07f]",
  fail: "bg-danger",
  pass: "bg-recover/70",
  unknown: "bg-unknown",
  decision: "bg-sky-400/70",
  neutral: "bg-graphite-500",
};
const LABEL: Record<Kind, string> = {
  fault: "text-fault",
  recover: "text-recover",
  fail: "text-danger",
  pass: "text-recover/80",
  unknown: "text-unknown",
  decision: "text-sky-300",
  neutral: "text-graphite-400",
};

const QUIET = new Set(["tool_call_started", "agent_step"]);

export function TraceTimeline({
  events,
  title,
  highlight = [],
  testId,
}: {
  events: TraceEvent[];
  title: React.ReactNode;
  highlight?: number[];
  testId?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const visible = showAll ? events : events.filter((e) => !QUIET.has(e.phase));
  const maxOffset = Math.max(1, ...events.map((e) => e.offset_ms));

  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-graphite-700 bg-graphite-900/80" data-testid={testId}>
      <div className="flex items-center justify-between gap-2 border-b border-graphite-800 px-4 py-3">
        <div className="min-w-0 text-sm font-semibold text-graphite-100">{title}</div>
        <label className="flex shrink-0 items-center gap-1.5 text-xs text-graphite-400">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="accent-fault" />
          all events
        </label>
      </div>
      {events.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-graphite-400">Waiting for the first event…</div>
      ) : (
        <ol className="max-h-[560px] overflow-y-auto py-2">
          {visible.map((e) => {
            const { kind, label } = classify(e);
            const isOpen = open === e.sequence;
            const hl = highlight.includes(e.sequence);
            return (
              <li
                key={e.sequence}
                data-kind={kind}
                data-phase={e.phase}
                className={cn("animate-rise relative pl-9 pr-3", hl && "bg-fault/5")}
              >
                <span className="absolute left-[18px] top-0 h-full w-px bg-graphite-700" />
                <span className={cn("absolute left-[14px] top-[11px] h-[9px] w-[9px] rounded-full", DOT[kind])} />
                <button
                  className="flex w-full items-start gap-3 rounded-md px-2 py-1.5 text-left hover:bg-graphite-800/60"
                  onClick={() => setOpen(isOpen ? null : e.sequence)}
                  aria-expanded={isOpen}
                >
                  <span className="w-8 shrink-0 pt-0.5 font-mono text-[10px] text-graphite-500">#{e.sequence}</span>
                  <span className={cn("w-[86px] shrink-0 pt-0.5 font-mono text-[10px] font-bold", LABEL[kind])}>{label}</span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block break-words text-xs", kind === "fault" ? "text-fault" : "text-graphite-100")}>
                      {e.message}
                    </span>
                    <span className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-[10px] text-graphite-500">
                      <span>+{ms(e.offset_ms)}</span>
                      {e.duration_ms != null && <span>took {ms(e.duration_ms)}</span>}
                      {e.retry_index ? <span className="text-recover">retry {e.retry_index}</span> : null}
                      {e.fault_id && <span className="text-fault">{e.fault_id}</span>}
                      {e.invocation_id && <span>inv {e.invocation_id.slice(0, 8)}</span>}
                    </span>
                  </span>
                  <span
                    className="mt-1.5 hidden h-1 w-16 shrink-0 overflow-hidden rounded bg-graphite-800 sm:block"
                    title="position in run"
                  >
                    <span className={cn("block h-full", DOT[kind])} style={{ width: `${(e.offset_ms / maxOffset) * 100}%` }} />
                  </span>
                </button>
                {isOpen && (
                  <pre
                    data-testid="raw-event"
                    className="mb-2 ml-10 max-h-72 overflow-auto rounded-md border border-graphite-700 bg-graphite-950 p-3 font-mono text-[11px] leading-relaxed text-graphite-300"
                  >
                    {JSON.stringify(e, null, 2)}
                  </pre>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
