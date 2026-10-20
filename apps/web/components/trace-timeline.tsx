"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import type { TraceEvent } from "@/lib/api";
import { cn, ms } from "@/lib/utils";

type Kind = "fault" | "recover" | "fail" | "pass" | "unknown" | "decision" | "neutral";

const SCHEMA_LABEL: Record<string, string> = {
  invalid_json: "Invalid JSON",
  schema_mismatch: "Wrong shape",
  error_status: "Error response",
  timeout: "Timed out",
};

export function classify(e: TraceEvent): { kind: Kind; label: string } {
  const status = e.data?.status as string | undefined;
  switch (e.phase) {
    case "fault_injected":
      return { kind: "fault", label: "Fault injected" };
    case "tool_call_completed":
      if (e.output_schema_status !== "valid")
        return { kind: "fail", label: SCHEMA_LABEL[e.output_schema_status ?? ""] ?? "Bad response" };
      if ((e.retry_index ?? 0) > 0) return { kind: "recover", label: "Recovered" };
      return { kind: "neutral", label: "Response" };
    case "tool_call_failed":
      return { kind: "fail", label: e.exception_type === "ToolTimeoutError" ? "Timed out" : "Call failed" };
    case "tool_call_started":
      return { kind: "neutral", label: "Call" };
    case "tool_call_rejected":
      return { kind: "fail", label: "Rejected" };
    case "assertion_evaluated":
      return status === "PASS"
        ? { kind: "pass", label: "Check passed" }
        : status === "FAIL"
          ? { kind: "fail", label: "Check failed" }
          : { kind: "unknown", label: "Check unknown" };
    case "agent_decision":
    case "model_response":
      return { kind: "decision", label: "Agent" };
    case "agent_step":
      return { kind: "neutral", label: "Step" };
    case "artifact_submitted":
      return { kind: "neutral", label: "Report" };
    case "budget_exceeded":
      return { kind: "fail", label: "Budget hit" };
    case "agent_crashed":
      return { kind: "fail", label: "Agent crashed" };
    case "agent_gave_up":
      return { kind: "fail", label: "Agent gave up" };
    case "harness_error":
      return { kind: "unknown", label: "Harness error" };
    case "run_started":
      return { kind: "neutral", label: "Started" };
    case "run_completed": {
      const s = e.data?.status as string;
      return { kind: s === "PASSED" ? "pass" : s === "CANCELLED" ? "neutral" : "fail", label: "Finished" };
    }
    default:
      return { kind: "neutral", label: e.phase.replace(/_/g, " ") };
  }
}

const LABEL: Record<Kind, string> = {
  fault: "text-inject",
  recover: "text-pass",
  fail: "text-fail-text",
  pass: "text-pass",
  unknown: "text-[#9a6b00]",
  decision: "text-cobalt-deep",
  neutral: "text-ink-steel",
};

const QUIET = new Set(["tool_call_started", "agent_step"]);

export function TraceTimeline({
  events,
  title,
  status,
  highlight = [],
  testId,
}: {
  events: TraceEvent[];
  title: React.ReactNode;
  status?: React.ReactNode;
  highlight?: number[];
  testId?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const visible = showAll ? events : events.filter((e) => !QUIET.has(e.phase));

  return (
    <section className="flex min-w-0 flex-col rounded-2xl border border-line-soft bg-canvas" data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <h3 className="text-subtitle font-bold text-ink-deep">{title}</h3>
          {status}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-body-sm text-ink-steel">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="h-4 w-4 accent-[#0064e0]" />
          Show every step
        </label>
      </div>
      {events.length === 0 ? (
        <p className="px-5 py-12 text-center text-body-sm text-ink-steel">Waiting for the first event</p>
      ) : (
        <ol className="max-h-[620px] divide-y divide-line-soft overflow-y-auto">
          {visible.map((e) => {
            const { kind, label } = classify(e);
            const isOpen = open === e.sequence;
            return (
              <li
                key={e.sequence}
                data-kind={kind}
                data-phase={e.phase}
                className={cn(
                  "border-l-[3px] border-transparent",
                  kind === "fault" && "border-inject bg-inject-tint",
                  highlight.includes(e.sequence) && kind !== "fault" && "border-cobalt bg-cobalt-tint",
                )}
              >
                <button
                  className="grid w-full grid-cols-[52px_104px_minmax(0,1fr)_16px] items-start gap-3 px-4 py-3 text-left hover:bg-cloud/70"
                  onClick={() => setOpen(isOpen ? null : e.sequence)}
                  aria-expanded={isOpen}
                >
                  <span className="tnum pt-px text-caption text-ink-stone">{ms(e.offset_ms)}</span>
                  <span className={cn("pt-px text-caption font-bold", LABEL[kind])}>{label}</span>
                  <span className="min-w-0">
                    <span className={cn("block break-words text-body-sm", kind === "fault" ? "font-bold text-inject" : "text-ink")}>
                      {e.message.replace(/ -> /g, " → ")}
                    </span>
                    {(e.duration_ms != null || e.retry_index || e.fault_id) && (
                      <span className="tnum mt-0.5 flex flex-wrap gap-x-3 text-caption text-ink-steel">
                        {e.duration_ms != null && <span>took {ms(e.duration_ms)}</span>}
                        {e.retry_index ? <span className="font-bold text-pass">retry {e.retry_index}</span> : null}
                        {e.fault_id && <span className="text-inject">{e.fault_id}</span>}
                      </span>
                    )}
                  </span>
                  <ChevronRight
                    aria-hidden
                    className={cn("mt-0.5 h-4 w-4 text-ink-stone transition-transform", isOpen && "rotate-90")}
                  />
                </button>
                {isOpen && (
                  <pre
                    data-testid="raw-event"
                    className="mx-4 mb-4 max-h-72 overflow-auto rounded-lg bg-cloud p-4 font-mono text-[12px] leading-relaxed text-ink-charcoal"
                  >
                    {JSON.stringify(e, null, 2)}
                  </pre>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
