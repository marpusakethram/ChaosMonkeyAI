import Link from "next/link";
import { CrashMark } from "@/components/crash-mark";
import { StatusBadge } from "@/components/status-badge";
import type { Run } from "@/lib/api";
import { FAULT_NAMES, ms, relTime, shortId } from "@/lib/utils";

export function RunsTable({ runs }: { runs: Run[] }) {
  if (runs.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line px-6 py-12 text-center">
        <CrashMark size={32} />
        <p className="text-body font-bold text-ink-deep">No runs yet</p>
        <p className="max-w-sm text-body-sm text-ink-steel">Pick a fault above and run a crash test. Runs show up here as they finish.</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-line-soft">
      <table className="w-full min-w-[720px] text-left text-body-sm">
        <thead className="bg-cloud text-ink-steel">
          <tr>
            <th className="px-5 py-3 font-bold">Test</th>
            <th className="px-5 py-3 font-bold">Agent</th>
            <th className="px-5 py-3 font-bold">Result</th>
            <th className="px-5 py-3 text-right font-bold">Checks</th>
            <th className="px-5 py-3 text-right font-bold">Duration</th>
            <th className="px-5 py-3 text-right font-bold">Started</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-soft">
          {runs.map((r) => (
            <tr key={r.run_id} className="hover:bg-cloud/60">
              <td className="px-5 py-3">
                <Link href={`/runs/${r.run_id}`} className="font-bold text-ink-deep hover:text-cobalt">
                  {r.fault_config ? (
                    <span className="text-inject">{FAULT_NAMES[r.fault_config.fault_type]}</span>
                  ) : r.kind === "replay" ? (
                    "Replay"
                  ) : (
                    "Baseline"
                  )}
                </Link>
                <span className="ml-2 font-mono text-caption text-ink-stone">{shortId(r.run_id)}</span>
              </td>
              <td className="px-5 py-3 font-mono text-caption text-ink-charcoal">{r.agent_adapter}</td>
              <td className="px-5 py-3">
                <StatusBadge status={r.status} />
              </td>
              <td className="tnum px-5 py-3 text-right text-ink-charcoal">
                {r.score ? `${r.score.passed}/${r.score.applicable}` : "–"}
              </td>
              <td className="tnum px-5 py-3 text-right text-ink-charcoal">{ms(r.latency_ms)}</td>
              <td className="px-5 py-3 text-right text-ink-steel">{relTime(r.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
