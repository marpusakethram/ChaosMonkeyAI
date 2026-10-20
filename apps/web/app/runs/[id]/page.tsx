"use client";

import { ChevronRight, RotateCcw, Zap } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DiffPanel } from "@/components/diff-panel";
import { ErrorBanner } from "@/components/error-banner";
import { ChecksList, ReportRail } from "@/components/report-panel";
import { ModeBadge, StatusBadge } from "@/components/status-badge";
import { TraceTimeline } from "@/components/trace-timeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, TERMINAL, type Comparison, type Report, type Run, type TraceEvent } from "@/lib/api";
import { cn, FAULT_NAMES, ms, shortId } from "@/lib/utils";

const POLL_MS = 700;

/** Polls a run and appends its events incrementally until the run is terminal. */
function useRunStream(id: string | null | undefined, onError: (m: string) => void) {
  const [run, setRun] = useState<Run | null>(null);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const last = useRef(0);
  const report = useRef(onError);
  report.current = onError;

  useEffect(() => {
    if (!id) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    last.current = 0;
    setEvents([]);
    const tick = async () => {
      try {
        const r = await api.run(id);
        const fresh = await api.events(id, last.current);
        if (stop) return;
        if (fresh.length) {
          last.current = fresh[fresh.length - 1].sequence;
          setEvents((prev) => [...prev, ...fresh]);
        }
        setRun(r);
        if (!TERMINAL.includes(r.status)) timer = setTimeout(tick, POLL_MS);
      } catch (e) {
        if (!stop) report.current((e as Error).message);
      }
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [id]);

  return { run, events };
}

const OUTCOME: Record<Comparison["recovery_outcome"], { tone: "pass" | "attention" | "fail" | "neutral"; label: string; verdict: string }> = {
  recovered: { tone: "pass", label: "Recovered", verdict: "The agent absorbed the fault." },
  graceful_failure: { tone: "attention", label: "Graceful failure", verdict: "The agent stopped and said why." },
  silent_failure: { tone: "fail", label: "Silent failure", verdict: "The agent kept going on bad data." },
  crashed: { tone: "fail", label: "Crashed", verdict: "The agent fell over on the fault." },
  not_applicable: { tone: "neutral", label: "Fault never fired", verdict: "The fault never fired." },
};

function verdictFor(run: Run, report: Report | null): { headline: string; outcome?: (typeof OUTCOME)[keyof typeof OUTCOME] } {
  if (!TERMINAL.includes(run.status)) return { headline: run.kind === "chaos" ? "Crash test in progress" : "Run in progress" };
  if (run.status === "ERROR") return { headline: "The test harness failed. This run says nothing about the agent." };
  if (run.status === "CANCELLED") return { headline: "Cancelled before a verdict." };
  const outcome = report?.comparison ? OUTCOME[report.comparison.recovery_outcome] : undefined;
  if (run.kind === "chaos" && outcome) return { headline: outcome.verdict, outcome };
  if (run.status === "PASSED") return { headline: "Every check passed." };
  const failed = (run.assertion_results ?? []).filter((a) => a.applicable && a.status !== "PASS").length;
  return { headline: `The agent missed ${failed} check${failed === 1 ? "" : "s"}.` };
}

export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [focus, setFocus] = useState<number[]>([]);
  const { run, events } = useRunStream(id, setError);
  const { run: base, events: baseEvents } = useRunStream(run?.baseline_run_id, setError);

  const done = !!run && TERMINAL.includes(run.status);
  const baseDone = !run?.baseline_run_id || (!!base && TERMINAL.includes(base.status));

  useEffect(() => {
    if (!done || !baseDone) return;
    api.report(id).then(setReport).catch((e) => setError(e.message));
  }, [done, baseDone, id]);

  const cancel = () => api.cancel(id).catch((e) => setError(e.message));
  const replay = () =>
    api
      .replay(id)
      .then((r) => router.push(`/runs/${r.run_id}`))
      .catch((e) => setError(e.message));

  const fault = run?.fault_config;
  const faultEvents = events.filter((e) => e.phase === "fault_injected");
  const kindName = run?.kind === "chaos" ? "Crash test" : run?.kind === "replay" ? "Replay" : "Baseline";
  const title = fault
    ? `${FAULT_NAMES[fault.fault_type]} on ${fault.target_tool}, call ${fault.occurrence}${fault.max_injections > 1 ? `–${fault.occurrence + fault.max_injections - 1}` : ""}`
    : run?.kind === "replay"
      ? `Replay of ${shortId(run.replay_of)}`
      : "Clean baseline";
  const v = run ? verdictFor(run, report) : null;

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-body-sm text-ink-steel">
        <Link href="/runs" className="hover:text-ink-deep hover:underline">
          Run history
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-ink-stone" aria-hidden />
        <span className="text-ink">
          {kindName} {shortId(id)}
        </span>
      </nav>

      <ErrorBanner message={error} onClose={() => setError(null)} />

      {!run ? (
        <p className="text-body-sm text-ink-steel">Loading run {shortId(id)}</p>
      ) : (
        <>
          <header className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={run.status} />
              <ModeBadge mode={run.agent_mode} />
              <Badge tone="outline">
                <span className="font-mono font-normal">{run.agent_adapter}</span>
              </Badge>
              {fault && (
                <Badge tone="inject" data-testid="fault-badge">
                  <Zap className="h-3 w-3" aria-hidden />
                  {FAULT_NAMES[fault.fault_type]}
                </Badge>
              )}
            </div>
            <h1 className="text-heading-lg font-medium text-ink-deep">{title}</h1>
          </header>

          <section
            key={v?.headline}
            className="verdict-enter grid gap-8 rounded-3xl bg-ink-deep px-6 py-8 text-white sm:px-10 sm:py-10 lg:grid-cols-[minmax(0,1fr)_auto]"
            data-testid="verdict"
          >
            <div className="min-w-0 space-y-4">
              {v?.outcome && (
                <Badge tone={v.outcome.tone} data-testid="recovery-outcome">
                  {v.outcome.label}
                </Badge>
              )}
              <p className="max-w-3xl text-heading-lg font-medium sm:text-display">{v?.headline}</p>
              <p className="max-w-3xl break-words text-body-sm text-white/70" data-testid="status-reason">
                {humanReason(run.status_reason)}
                {run.failure_origin === "harness" && " Fix the environment and run it again."}
              </p>
            </div>
            <div className="flex flex-col justify-between gap-6 lg:items-end">
              <dl className="tnum grid grid-cols-3 gap-6 lg:text-right">
                <Stat label="Checks" value={run.score ? `${run.score.passed}/${run.score.applicable}` : "–"} />
                <Stat label="Tool calls" value={String(run.tool_calls)} />
                <Stat label="Duration" value={ms(run.latency_ms)} />
              </dl>
              {!done ? (
                <Button variant="danger" size="sm" onClick={cancel} data-testid="cancel-run" className="border-white/40 text-white hover:bg-white/10">
                  Cancel run
                </Button>
              ) : (
                run.agent_mode === "offline" &&
                ["PASSED", "FAILED"].includes(run.status) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={replay}
                    data-testid="replay-run"
                    className="border-white/30 text-white hover:bg-white/10"
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden />
                    Replay from recording
                  </Button>
                )
              )}
            </div>
          </section>

          {faultEvents.length > 0 && (
            <div className="flex items-start gap-3 rounded-xl bg-inject-tint px-5 py-4 text-body-sm text-inject" data-testid="fault-callout">
              <Zap className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <div className="space-y-1">
                {faultEvents.map((f) => (
                  <p key={f.sequence}>
                    <span className="font-bold">{f.message}</span>{" "}
                    <span className="text-inject/80">
                      at event {f.sequence}, invocation {shortId(f.invocation_id)}
                    </span>
                  </p>
                ))}
              </div>
            </div>
          )}

          <div className={cn("grid gap-6", run.baseline_run_id && "xl:grid-cols-2")}>
            {run.baseline_run_id && (
              <TraceTimeline
                testId="baseline-timeline"
                events={baseEvents}
                title="Baseline"
                status={base && <StatusBadge status={base.status} />}
              />
            )}
            <TraceTimeline
              testId="chaos-timeline"
              events={events}
              highlight={focus}
              title={run.kind === "chaos" ? "Crash test" : "Trace"}
              status={<StatusBadge status={run.status} />}
            />
          </div>

          {report ? (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
              <div className="min-w-0 space-y-6">
                {report.comparison && (
                  <section className="rounded-2xl border border-line-soft px-6 pb-4 pt-6">
                    <h2 className="text-heading-sm font-medium text-ink-deep">Baseline compared with crash test</h2>
                    <p className="mt-1 text-body-sm text-ink-steel">{report.comparison.recovery_explanation}</p>
                    <div className="mt-3">
                      <DiffPanel comparison={report.comparison} />
                    </div>
                  </section>
                )}
                <ChecksList report={report} onFocus={setFocus} />
                {run.artifact && (
                  <details className="group rounded-2xl border border-line-soft">
                    <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-5 text-subtitle font-bold text-ink-deep">
                      Agent&apos;s final report
                      <ChevronRight className="h-4 w-4 text-ink-stone transition-transform group-open:rotate-90" aria-hidden />
                    </summary>
                    <pre className="mx-6 mb-6 max-h-96 overflow-auto rounded-lg bg-cloud p-4 font-mono text-[12px] text-ink-charcoal">
                      {JSON.stringify(run.artifact, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
              <ReportRail report={report} />
            </div>
          ) : (
            done && <p className="text-body-sm text-ink-steel">Building the report</p>
          )}
        </>
      )}
    </div>
  );
}

function humanReason(reason: string): string {
  if (!reason) return "Waiting for the agent";
  if (reason === "all applicable assertions passed") return "All checks passed.";
  return reason.replace(/^assertions not passed: /, "Failed checks: ");
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-caption text-white/60">{label}</dt>
      <dd className="text-heading-sm font-medium">{value}</dd>
    </div>
  );
}
