"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorBanner } from "@/components/error-banner";
import { FaultPicker, type FaultChoice } from "@/components/fault-picker";
import { ModeBadge, StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, TERMINAL, type AgentSpec, type FaultSpec, type Health, type Run, type Scenario } from "@/lib/api";
import { cn, ms, shortId } from "@/lib/utils";

export default function Home() {
  const router = useRouter();
  const [health, setHealth] = useState<Health | null>(null);
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

  const refreshRuns = useCallback(() => api.runs(12).then(setRuns).catch(() => undefined), []);

  useEffect(() => {
    Promise.all([api.health(), api.scenarios(), api.faults(), api.agents()])
      .then(([h, s, f, a]) => {
        setHealth(h);
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

  const injectFault = async () => {
    if (!fault || !scenario) return;
    setError(null);
    setBusy("chaos");
    const reuse =
      baseline && baseline.agent_adapter === agent && baseline.seed === seed && ["PASSED", "FAILED"].includes(baseline.status);
    try {
      const r = await api.chaos({
        agent: { adapter: agent },
        seed,
        scenario_id: scenario.scenario_id,
        baseline_run_id: reuse ? baseline!.run_id : undefined,
        fault,
      });
      router.push(`/runs/${r.run_id}`);
    } catch (e) {
      setBusy(null);
      setError((e as Error).message);
    }
  };

  const selectedAgent = agents.find((a) => a.name === agent);

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-graphite-100 sm:text-3xl">
            Break the agent <span className="text-fault">on purpose.</span>
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-graphite-400">
            Run a baseline, inject one documented fault at the tool boundary, and watch the trace fail or recover. Every
            verdict comes from recorded events, not from the agent grading itself.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {health && <ModeBadge mode={selectedAgent?.mode ?? "offline"} />}
          {health && !health.gemini_enabled && <Badge tone="neutral">Gemini: no key set</Badge>}
        </div>
      </section>

      <ErrorBanner message={error} onClose={() => setError(null)} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>1 · Task</CardTitle>
            {scenario && <span className="font-mono text-[11px] text-graphite-500">{scenario.scenario_id} · fixture {scenario.fixture_version}</span>}
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-lg leading-snug text-graphite-100" data-testid="task-text">
              {scenario?.task ?? "Loading scenario…"}
            </p>
            <p className="text-xs text-graphite-500">{scenario?.simulation_notice}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {agents.map((a) => (
                <button
                  key={a.name}
                  disabled={!a.available}
                  data-testid={`agent-${a.name}`}
                  onClick={() => setAgent(a.name)}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                    agent === a.name ? "border-graphite-200 bg-graphite-800" : "border-graphite-700 bg-graphite-850 hover:border-graphite-500",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-graphite-100">{a.name}</span>
                    <Badge tone={a.mode === "live" ? "live" : "neutral"}>{a.mode}</Badge>
                  </div>
                  <p className="mt-1.5 text-xs leading-snug text-graphite-400">{a.description}</p>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={runBaseline} disabled={!!busy || !scenario} data-testid="run-baseline" size="lg">
                {busy === "baseline" ? "Running baseline…" : "Run baseline"}
              </Button>
              <label className="flex items-center gap-2 text-xs text-graphite-400">
                seed
                <input
                  type="number"
                  value={seed}
                  min={0}
                  onChange={(e) => setSeed(Math.max(0, Math.floor(+e.target.value || 0)))}
                  className="w-20 rounded border border-graphite-600 bg-graphite-900 px-2 py-1 font-mono text-graphite-100"
                />
              </label>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="baseline-card">
          <CardHeader>
            <CardTitle>Baseline</CardTitle>
          </CardHeader>
          <CardContent>
            {!baseline ? (
              <p className="text-sm text-graphite-400">No baseline yet. Run one to get a known-good trace to compare against.</p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <StatusBadge status={baseline.status} origin={baseline.failure_origin} />
                  <span className="font-mono text-xs text-graphite-400">{shortId(baseline.run_id)}</span>
                </div>
                <dl className="grid grid-cols-3 gap-2 font-mono text-xs">
                  <div>
                    <dt className="text-graphite-500">calls</dt>
                    <dd className="text-graphite-100">{baseline.tool_calls}</dd>
                  </div>
                  <div>
                    <dt className="text-graphite-500">latency</dt>
                    <dd className="text-graphite-100">{ms(baseline.latency_ms)}</dd>
                  </div>
                  <div>
                    <dt className="text-graphite-500">score</dt>
                    <dd className="text-graphite-100">
                      {baseline.score ? `${baseline.score.passed}/${baseline.score.applicable}` : "—"}
                    </dd>
                  </div>
                </dl>
                <p className="text-xs text-graphite-400">{baseline.status_reason}</p>
                <Link href={`/runs/${baseline.run_id}`} className="text-xs text-fault underline-offset-2 hover:underline">
                  Open trace →
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>2 · Choose a fault</CardTitle>
          <span className="text-xs text-graphite-500">Injected at the tool gateway. Bounded, local, repeatable.</span>
        </CardHeader>
        <CardContent className="space-y-4">
          <FaultPicker faults={faults} value={fault} onChange={setFault} />
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="fault" size="lg" onClick={injectFault} disabled={!fault || !!busy} data-testid="inject-fault">
              {busy === "chaos" ? "Injecting…" : "Inject fault"}
            </Button>
            <span className="text-xs text-graphite-400">
              {baseline && ["PASSED", "FAILED"].includes(baseline.status) && baseline.agent_adapter === agent && baseline.seed === seed
                ? `Compares against baseline ${shortId(baseline.run_id)}.`
                : "A matching baseline will be run automatically for comparison."}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent runs</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="text-graphite-500">
              <tr>
                {["run", "kind", "agent", "fault", "status", "score", "latency"].map((h) => (
                  <th key={h} className="px-5 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-6 text-center text-graphite-500">
                    No runs yet.
                  </td>
                </tr>
              )}
              {runs.map((r) => (
                <tr key={r.run_id} className="border-t border-graphite-800 hover:bg-graphite-850">
                  <td className="px-5 py-2 font-mono">
                    <Link href={`/runs/${r.run_id}`} className="text-graphite-100 hover:text-fault">
                      {shortId(r.run_id)}
                    </Link>
                  </td>
                  <td className="px-5 py-2 text-graphite-300">{r.kind}</td>
                  <td className="px-5 py-2 font-mono text-graphite-300">{r.agent_adapter}</td>
                  <td className="px-5 py-2 font-mono text-fault">{r.fault_config?.fault_type ?? "—"}</td>
                  <td className="px-5 py-2">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-5 py-2 font-mono text-graphite-300">{r.score ? `${r.score.passed}/${r.score.applicable}` : "—"}</td>
                  <td className="px-5 py-2 font-mono text-graphite-300">{ms(r.latency_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
