"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorBanner } from "@/components/error-banner";
import { FaultList, InjectionPoint, type FaultChoice } from "@/components/fault-picker";
import { OptionRow } from "@/components/option-row";
import { RunsTable } from "@/components/runs-table";
import { ModeBadge, StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { api, TERMINAL, type AgentSpec, type FaultSpec, type Run, type Scenario } from "@/lib/api";
import { FAULT_NAMES, ms } from "@/lib/utils";

const AGENT_COPY: Record<string, { title: string; text: string }> = {
  "scripted-robust": {
    title: "Reference agent, careful",
    text: "Validates every response, retries twice with backoff, treats source text as data.",
  },
  "scripted-naive": {
    title: "Reference agent, fragile",
    text: "No retries, patches broken JSON, follows instructions it finds in sources. Built to fail visibly.",
  },
  gemini: {
    title: "Gemini agent",
    text: "Live function-calling model. Results vary run to run.",
  },
};

export default function NewTest() {
  const router = useRouter();
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [faults, setFaults] = useState<FaultSpec[]>([]);
  const [agents, setAgents] = useState<AgentSpec[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [agent, setAgent] = useState("scripted-robust");
  const [seed, setSeed] = useState(42);
  const [fault, setFault] = useState<FaultChoice | null>(null);
  const [baseline, setBaseline] = useState<Run | null>(null);
  const [busy, setBusy] = useState<"baseline" | "chaos" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshRuns = useCallback(() => api.runs(6).then(setRuns).catch(() => undefined), []);

  useEffect(() => {
    Promise.all([api.scenarios(), api.faults(), api.agents()])
      .then(([s, f, a]) => {
        setScenario(s[0] ?? null);
        setFaults(f);
        setAgents(a);
      })
      .catch((e) => setError(e.message));
    refreshRuns();
    return () => {
      if (poll.current) clearTimeout(poll.current);
    };
  }, [refreshRuns]);

  const watch = (id: string) => {
    api
      .run(id)
      .then((r) => {
        setBaseline(r);
        if (TERMINAL.includes(r.status)) {
          setBusy(null);
          refreshRuns();
        } else {
          poll.current = setTimeout(() => watch(id), 700);
        }
      })
      .catch((e) => {
        setBusy(null);
        setError(e.message);
      });
  };

  const baselineUsable =
    !!baseline && baseline.agent_adapter === agent && baseline.seed === seed && ["PASSED", "FAILED"].includes(baseline.status);

  const runBaseline = async () => {
    if (!scenario) return;
    setError(null);
    setBusy("baseline");
    try {
      const r = await api.baseline({ agent: { adapter: agent }, seed, scenario_id: scenario.scenario_id });
      setBaseline(r);
      watch(r.run_id);
    } catch (e) {
      setBusy(null);
      setError((e as Error).message);
    }
  };

  const runCrashTest = async () => {
    if (!fault || !scenario) return;
    setError(null);
    setBusy("chaos");
    try {
      const r = await api.chaos({
        agent: { adapter: agent },
        seed,
        scenario_id: scenario.scenario_id,
        baseline_run_id: baselineUsable ? baseline!.run_id : undefined,
        fault,
      });
      router.push(`/runs/${r.run_id}`);
    } catch (e) {
      setBusy(null);
      setError((e as Error).message);
    }
  };

  const selectedAgent = agents.find((a) => a.name === agent);
  const spec = faults.find((f) => f.fault_type === fault?.fault_type);

  return (
    <div className="space-y-8">
      <header className="max-w-3xl space-y-3">
        <h1 className="text-heading-lg font-medium text-ink-deep sm:text-display">New crash test</h1>
        <p className="text-subtitle text-ink-charcoal">
          Run the agent once clean, then again with one fault injected at the tool boundary. The verdict comes from the
          recorded trace, not from the agent grading itself.
        </p>
      </header>

      <ErrorBanner message={error} onClose={() => setError(null)} />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-10">
          <section aria-labelledby="scenario-h" className="rounded-3xl bg-cloud px-6 py-7 sm:px-8">
            <h2 id="scenario-h" className="text-body-sm font-bold text-ink-steel">
              Scenario {scenario ? `robotics-benchmark, fixture ${scenario.fixture_version}` : ""}
            </h2>
            <p className="mt-3 text-heading-md font-light text-ink-deep" data-testid="task-text">
              {scenario?.task ?? "Loading scenario"}
            </p>
            <p className="mt-4 text-body-sm text-ink-steel">
              Tools: get_benchmark, get_research_paper, verify_citation. Every record is fictional and marked as simulation.
            </p>
          </section>

          <section aria-labelledby="agent-h" className="space-y-4">
            <SectionHeading id="agent-h" title="Agent" text="Which agent to put through the test." />
            <div role="radiogroup" aria-label="Agent" className="grid gap-3">
              {agents.map((a) => (
                <OptionRow
                  key={a.name}
                  testId={`agent-${a.name}`}
                  selected={agent === a.name}
                  disabled={!a.available}
                  onSelect={() => setAgent(a.name)}
                  title={AGENT_COPY[a.name]?.title ?? a.name}
                  description={a.available ? (AGENT_COPY[a.name]?.text ?? a.description) : "Add GEMINI_API_KEY to the API environment to enable."}
                  aside={<span className="font-mono text-caption">{a.name}</span>}
                />
              ))}
            </div>
          </section>

          <section aria-labelledby="fault-h" className="space-y-4">
            <SectionHeading id="fault-h" title="Fault" text="One documented failure, injected between the agent and its tools." />
            <FaultList faults={faults} value={fault} onChange={setFault} />
          </section>

          {spec && fault && (
            <section aria-labelledby="where-h" className="space-y-4">
              <SectionHeading id="where-h" title="Injection point" text={spec.expected_behavior} />
              <div className="rounded-2xl border border-line-soft p-6">
                <InjectionPoint spec={spec} value={fault} onChange={setFault} />
              </div>
            </section>
          )}
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-line-soft bg-canvas p-6 shadow-[0_1px_4px_rgba(20,22,26,0.18)]">
            <h2 className="text-heading-sm font-medium text-ink-deep">Test summary</h2>
            <dl className="mt-4 divide-y divide-line-soft text-body-sm">
              <SummaryRow label="Agent">
                <span className="font-bold text-ink-deep">{AGENT_COPY[agent]?.title ?? agent}</span>
                <span className="mt-1 block">{selectedAgent && <ModeBadge mode={selectedAgent.mode} />}</span>
              </SummaryRow>
              <SummaryRow label="Fault">
                {fault ? (
                  <span className="font-bold text-inject">{FAULT_NAMES[fault.fault_type]}</span>
                ) : (
                  <span className="text-ink-stone">Pick a fault</span>
                )}
              </SummaryRow>
              {fault && (
                <SummaryRow label="Lands on">
                  <span className="tnum">
                    {fault.target_tool}, call {fault.occurrence}
                    {fault.max_injections > 1 ? `–${fault.occurrence + fault.max_injections - 1}` : ""}
                  </span>
                </SummaryRow>
              )}
              <SummaryRow label="Seed">
                <input
                  type="number"
                  min={0}
                  aria-label="Seed"
                  value={seed}
                  onChange={(e) => setSeed(Math.max(0, Math.floor(+e.target.value || 0)))}
                  className="tnum h-9 w-24 rounded-lg border border-line px-3 text-body-sm text-ink focus:border-2 focus:border-[#1876f2] focus:outline-none"
                />
              </SummaryRow>
              <SummaryRow label="Baseline">
                <div data-testid="baseline-card">
                  {!baseline ? (
                    <span className="text-ink-stone">Runs automatically if missing</span>
                  ) : (
                    <span className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={baseline.status} />
                      <span className="tnum text-ink-steel">
                        {baseline.score ? `${baseline.score.passed} of ${baseline.score.applicable} checks` : ""}
                        {baseline.latency_ms ? `, ${ms(baseline.latency_ms)}` : ""}
                      </span>
                      <Link href={`/runs/${baseline.run_id}`} className="font-bold text-cobalt hover:underline">
                        View trace
                      </Link>
                    </span>
                  )}
                </div>
              </SummaryRow>
            </dl>

            <div className="mt-6 grid gap-3">
              <Button onClick={runCrashTest} disabled={!fault || !!busy} data-testid="inject-fault" className="w-full">
                {busy === "chaos" ? "Starting crash test" : "Run crash test"}
              </Button>
              <Button variant="outline" onClick={runBaseline} disabled={!!busy || !scenario} data-testid="run-baseline" className="w-full">
                {busy === "baseline" ? "Running baseline" : "Run baseline only"}
              </Button>
            </div>
            <p className="mt-4 text-caption text-ink-steel">
              {baselineUsable
                ? "The crash test will be compared with the baseline above."
                : "A baseline with the same agent and seed runs alongside, so there is always a clean trace to compare."}
            </p>
          </div>
        </aside>
      </div>

      <section aria-labelledby="recent-h" className="space-y-4 pt-4">
        <div className="flex items-end justify-between gap-4">
          <SectionHeading id="recent-h" title="Recent runs" text="Newest first." />
          <Link href="/runs" className="text-body-sm font-bold text-cobalt hover:underline">
            All runs
          </Link>
        </div>
        <RunsTable runs={runs} />
      </section>
    </div>
  );
}

function SectionHeading({ id, title, text }: { id: string; title: string; text: string }) {
  return (
    <div>
      <h2 id={id} className="text-heading-sm font-medium text-ink-deep">
        {title}
      </h2>
      <p className="mt-1 text-body-sm text-ink-steel">{text}</p>
    </div>
  );
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-3 py-3">
      <dt className="text-ink-steel">{label}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </div>
  );
}
