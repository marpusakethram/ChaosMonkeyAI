import { Badge } from "@/components/ui/badge";
import type { Comparison } from "@/lib/api";
import { cn, ms } from "@/lib/utils";

const OUTCOME: Record<Comparison["recovery_outcome"], { tone: "pass" | "fail" | "unknown" | "neutral"; text: string }> = {
  recovered: { tone: "pass", text: "Recovered" },
  graceful_failure: { tone: "unknown", text: "Graceful failure" },
  silent_failure: { tone: "fail", text: "Silent failure" },
  crashed: { tone: "fail", text: "Crashed" },
  not_applicable: { tone: "neutral", text: "Fault not triggered" },
};

function Metric({ label, a, b, delta, fmt = (v: number) => String(v), worseIfHigher = true }: {
  label: string;
  a: number;
  b: number;
  delta?: number;
  fmt?: (v: number) => string;
  worseIfHigher?: boolean;
}) {
  const d = delta ?? b - a;
  const worse = worseIfHigher ? d > 0 : d < 0;
  return (
    <div className="rounded-lg border border-graphite-700 bg-graphite-850 p-3">
      <div className="text-[11px] uppercase tracking-wider text-graphite-400">{label}</div>
      <div className="mt-1 flex items-baseline gap-2 font-mono text-sm">
        <span className="text-graphite-300">{fmt(a)}</span>
        <span className="text-graphite-500">→</span>
        <span className="text-graphite-100">{fmt(b)}</span>
        {d !== 0 && (
          <span className={cn("text-xs", worse ? "text-fault" : "text-recover")}>
            ({d > 0 ? "+" : ""}
            {fmt(d)})
          </span>
        )}
      </div>
    </div>
  );
}

export function DiffPanel({ comparison }: { comparison: Comparison }) {
  const o = OUTCOME[comparison.recovery_outcome];
  return (
    <div className="space-y-3" data-testid="diff-panel">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={o.tone} data-testid="recovery-outcome">{o.text}</Badge>
        <span className="text-sm text-graphite-300">{comparison.recovery_explanation}</span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Metric label="Tool calls" a={comparison.tool_calls.baseline} b={comparison.tool_calls.chaos} />
        <Metric label="Latency" a={comparison.latency_ms.baseline} b={comparison.latency_ms.chaos} fmt={ms} />
        <Metric
          label="Result completeness"
          a={comparison.completeness.baseline}
          b={comparison.completeness.chaos}
          fmt={(v) => `${Math.round(v * 100)}%`}
          worseIfHigher={false}
        />
      </div>
      {comparison.assertions_changed.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-graphite-700">
          <table className="w-full text-left text-xs">
            <thead className="bg-graphite-850 text-graphite-400">
              <tr>
                <th className="px-3 py-2 font-medium">Assertion</th>
                <th className="px-3 py-2 font-medium">Baseline</th>
                <th className="px-3 py-2 font-medium">Chaos</th>
              </tr>
            </thead>
            <tbody>
              {comparison.assertions_changed.map((c) => (
                <tr key={c.assertion_id} className="border-t border-graphite-800">
                  <td className="px-3 py-2 font-mono text-graphite-200">{c.assertion_id}</td>
                  <td className="px-3 py-2 font-mono text-graphite-400">{c.baseline}</td>
                  <td className={cn("px-3 py-2 font-mono", c.chaos === "PASS" ? "text-recover" : c.chaos === "FAIL" ? "text-danger" : "text-unknown")}>
                    {c.chaos}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
