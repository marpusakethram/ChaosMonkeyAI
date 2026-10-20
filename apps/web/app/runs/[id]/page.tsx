"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DiffPanel } from "@/components/diff-panel";
import { ErrorBanner } from "@/components/error-banner";
import { ReportPanel } from "@/components/report-panel";
import { ModeBadge, StatusBadge } from "@/components/status-badge";
import { TraceTimeline } from "@/components/trace-timeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, TERMINAL, type Report, type Run, type TraceEvent } from "@/lib/api";
import { ms, shortId } from "@/lib/utils";

const POLL_MS = 700;

/** Polls a run and appends its events incrementally until the run is terminal. */
function useRunStream(id: string | null | undefined, onError: (m: string) => void) {
  const [run, setRun] = useState<Run | null>(null);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const last = useRef(0);

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
        if (!stop) onError((e as Error).message);
      }
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return { run, events };
}

export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [focus, setFocus] = useState<number[]>([]);
  const { run, events } = useRunStream(id, setError);
  const { run: base, events: baseEvents } = useRunStream(run?.baseline_run_id, setError);

  const done = run && TERMINAL.includes(run.status);
  const baseDone = !run?.baseline_run_id || (base && TERMINAL.includes(base.status));

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

  return (
    <div className="space-y-5">
      <Link href="/" className="text-xs text-graphite-400 hover:text-graphite-100">
        ← back to runs
      </Link>
      <ErrorBanner message={error} onClose={() => setError(null)} />

      {!run ? (
        <p className="text-sm text-graphite-400">Loading run {shortId(id)}…</p>
      ) : (
        <>
          <section className="flex flex-col gap-4 rounded-xl border border-graphite-700 bg-graphite-900/80 p-5 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold text-graphite-100">
                  {run.kind === "chaos" ? "Chaos run" : run.kind === "replay" ? "Replay" : "Baseline run"}
                </h1>
                <span className="font-mono text-xs text-graphite-500">{run.run_id}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={run.status} origin={run.failure_origin} />
                <ModeBadge mode={run.agent_mode} />
                <Badge>{run.agent_adapter}</Badge>
                {fault && (
                  <Badge tone="fault" data-testid="fault-badge">
                    ⚡ {fault.fault_type} → {fault.target_tool} #{fault.occurrence}
                    {fault.max_injections > 1 ? ` ×${fault.max_injections}` : ""}
                  </Badge>
                )}
                {run.replay_of && <Badge>replay of {shortId(run.replay_of)}</Badge>}
              </div>
              <p className="break-words text-sm text-graphite-300" data-testid="status-reason">
                {run.status_reason || "Running…"}
              </p>
              {run.failure_origin === "harness" && (
                <p className="text-xs text-unknown">
                  Harness error: this run says nothing about the agent. Fix the environment and re-run.
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-4">
              <dl className="grid grid-cols-3 gap-4 font-mono text-xs">
                <div>
                  <dt className="text-graphite-500">duration</dt>
                  <dd className="text-graphite-100">{ms(run.latency_ms)}</dd>
                </div>
                <div>
                  <dt className="text-graphite-500">tool calls</dt>
                  <dd className="text-graphite-100">{run.tool_calls}</dd>
                </div>
                <div>
                  <dt className="text-graphite-500">seed</dt>
                  <dd className="text-graphite-100">{run.seed}</dd>
                </div>
              </dl>
              {!done ? (
                <Button variant="danger" size="sm" onClick={cancel} data-testid="cancel-run">
                  Cancel
                </Button>
              ) : (
                run.agent_mode === "offline" &&
                ["PASSED", "FAILED"].includes(run.status) && (
                  <Button variant="outline" size="sm" onClick={replay} data-testid="replay-run">
                    Replay deterministically
                  </Button>
                )
              )}
            </div>
          </section>

          {faultEvents.length > 0 && (
            <div className="rounded-lg border border-fault/40 bg-fault-dim px-4 py-3 text-sm text-fault" data-testid="fault-callout">
              {faultEvents.map((f) => (
                <div key={f.sequence}>
                  ⚡ Event #{f.sequence}: {f.message} <span className="font-mono text-xs opacity-80">({f.fault_id}, invocation {shortId(f.invocation_id)})</span>
                </div>
              ))}
            </div>
          )}

          <div className={run.baseline_run_id ? "grid grid-cols-1 gap-4 xl:grid-cols-2" : ""}>
            {run.baseline_run_id && (
              <TraceTimeline
                testId="baseline-timeline"
                events={baseEvents}
                title={
                  <span className="flex items-center gap-2">
                    Baseline <span className="font-mono text-xs text-graphite-500">{shortId(run.baseline_run_id)}</span>
                    {base && <StatusBadge status={base.status} />}
                  </span>
                }
              />
            )}
            <TraceTimeline
              testId="chaos-timeline"
              events={events}
              highlight={focus}
              title={
                <span className="flex items-center gap-2">
                  {run.kind === "chaos" ? <span className="text-fault">Chaos</span> : "Trace"}
                  <span className="font-mono text-xs text-graphite-500">{shortId(run.run_id)}</span>
                  <StatusBadge status={run.status} />
                </span>
              }
            />
          </div>

          {report?.comparison && (
            <Card>
              <CardHeader>
                <CardTitle>Baseline vs chaos</CardTitle>
              </CardHeader>
              <CardContent>
                <DiffPanel comparison={report.comparison} />
              </CardContent>
            </Card>
          )}

          {report ? (
            <ReportPanel report={report} onFocus={setFocus} />
          ) : (
            done && <p className="text-sm text-graphite-400">Building report…</p>
          )}

          {run.artifact && (
            <details className="rounded-xl border border-graphite-700 bg-graphite-900/80 p-4">
              <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wider text-graphite-200">
                Agent&apos;s final artifact
              </summary>
              <pre className="mt-3 max-h-96 overflow-auto rounded-md bg-graphite-950 p-3 font-mono text-[11px] text-graphite-300">
                {JSON.stringify(run.artifact, null, 2)}
              </pre>
            </details>
          )}
        </>
      )}
    </div>
  );
}
