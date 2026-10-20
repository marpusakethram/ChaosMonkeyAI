import type { Comparison } from "@/lib/api";
import { cn, ms } from "@/lib/utils";

const STATUS_TEXT: Record<string, string> = { PASS: "Passed", FAIL: "Failed", UNKNOWN: "Unknown", "N/A": "Not checked" };

/** Spec-table comparison (Meta tech-specs table): label left, baseline vs crash test right. */
export function DiffPanel({ comparison }: { comparison: Comparison }) {
  const rows = [
    // Calls and duration only describe the run; more or fewer is not better or worse on its own.
    { label: "Tool calls", a: String(comparison.tool_calls.baseline), b: String(comparison.tool_calls.chaos), worse: null },
    { label: "Duration", a: ms(comparison.latency_ms.baseline), b: ms(comparison.latency_ms.chaos), worse: null },
    {
      label: "Report completeness",
      a: `${Math.round(comparison.completeness.baseline * 100)}%`,
      b: `${Math.round(comparison.completeness.chaos * 100)}%`,
      worse: comparison.completeness.chaos < comparison.completeness.baseline,
    },
  ];
  return (
    <div data-testid="diff-panel" className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-left text-body-sm">
        <thead>
          <tr className="border-b border-line-soft text-ink-steel">
            <th className="py-3 pr-4 font-bold">Measure</th>
            <th className="py-3 pr-4 text-right font-bold">Baseline</th>
            <th className="py-3 text-right font-bold">Crash test</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-soft">
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="py-3 pr-4 font-bold text-ink">{r.label}</td>
              <td className="tnum py-3 pr-4 text-right text-ink-charcoal">{r.a}</td>
              <td className={cn("tnum py-3 text-right font-bold", r.worse === null || r.a === r.b ? "text-ink" : r.worse ? "text-fail-text" : "text-pass")}>
                {r.b}
              </td>
            </tr>
          ))}
          {comparison.assertions_changed.map((c) => (
            <tr key={c.assertion_id}>
              <td className="py-3 pr-4 text-ink">
                <span className="font-mono text-caption">{c.assertion_id}</span>
              </td>
              <td className="py-3 pr-4 text-right text-ink-charcoal">{STATUS_TEXT[c.baseline] ?? c.baseline}</td>
              <td
                className={cn(
                  "py-3 text-right font-bold",
                  c.chaos === "PASS" ? "text-pass" : c.chaos === "FAIL" ? "text-fail-text" : "text-[#9a6b00]",
                )}
              >
                {STATUS_TEXT[c.chaos] ?? c.chaos}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
