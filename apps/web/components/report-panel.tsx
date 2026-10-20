import { Check, Download, HelpCircle, X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { api, type Report } from "@/lib/api";
import { cn } from "@/lib/utils";

const ICON = {
  PASS: { icon: Check, cls: "bg-pass text-white", text: "Passed" },
  FAIL: { icon: X, cls: "bg-fail text-white", text: "Failed" },
  UNKNOWN: { icon: HelpCircle, cls: "bg-attention text-ink-deep", text: "Unknown" },
} as const;

export function ChecksList({ report, onFocus }: { report: Report; onFocus?: (seqs: number[]) => void }) {
  const applicable = (report.assertions ?? []).filter((a) => a.applicable);
  const notApplicable = (report.assertions ?? []).filter((a) => !a.applicable);
  const s = report.score;
  return (
    <section className="rounded-2xl border border-line-soft" data-testid="assertion-checklist">
      <div className="flex flex-wrap items-end justify-between gap-3 px-6 pb-3 pt-6">
        <div>
          <h2 className="text-heading-sm font-medium text-ink-deep">Checks</h2>
          {s && (
            <p className="tnum mt-1 text-body-sm text-ink-steel" data-testid="score">
              {s.passed} of {s.applicable} passed{s.failed ? `, ${s.failed} failed` : ""}
              {s.unknown ? `, ${s.unknown} unknown` : ""}. Unknown never counts as a pass.
            </p>
          )}
        </div>
      </div>
      {applicable.length === 0 ? (
        <p className="px-6 pb-6 text-body-sm text-ink-steel">No checks were evaluated for this run.</p>
      ) : (
        <ul className="divide-y divide-line-soft border-t border-line-soft">
          {applicable.map((a) => {
            const st = ICON[a.status];
            const Icon = st.icon;
            return (
              <li key={a.assertion_id} data-testid={`assertion-${a.assertion_id}`} data-status={a.status} className="flex gap-4 px-6 py-4">
                <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full", st.cls)}>
                  <Icon className="h-3.5 w-3.5" strokeWidth={3} aria-label={st.text} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-body font-bold text-ink-deep">{a.title}</p>
                  <p className="mt-0.5 break-words text-body-sm text-ink-steel">{a.reason}</p>
                </div>
                {a.evidence_sequences.length > 0 && onFocus && (
                  <button
                    onClick={() => onFocus(a.evidence_sequences)}
                    className="h-8 shrink-0 self-center rounded-full border border-line px-3 text-caption font-bold text-ink hover:bg-cloud"
                  >
                    Show in trace
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {(notApplicable.length > 0 || s) && (
        <div className="space-y-2 border-t border-line-soft px-6 py-4 text-caption text-ink-steel">
          {notApplicable.length > 0 && <p>Not relevant to this fault: {notApplicable.map((a) => a.title.toLowerCase()).join(", ")}.</p>}
          {s && <p>{s.confidence_note}</p>}
        </div>
      )}
    </section>
  );
}

const CHECK_LINE = /^[a-z_]+ (FAIL|UNKNOWN|PASS):/;

export function ReportRail({ report }: { report: Report }) {
  const story = report.root_cause.details.filter((d) => !CHECK_LINE.test(d));
  const failed = report.root_cause.failed_assertions.length;
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-line-soft p-6" data-testid="root-cause">
        <h2 className="text-subtitle font-bold text-ink-deep">What happened</h2>
        <ul className="mt-3 space-y-3 text-body-sm text-ink-charcoal">
          {story.map((d, i) => (
            <li key={i} className="break-words">
              {d}
            </li>
          ))}
          {failed > 0 && (
            <li className="font-bold text-ink-deep">
              {failed} check{failed === 1 ? "" : "s"} did not pass. The checks list shows each reason and where it shows up in the trace.
            </li>
          )}
        </ul>
      </section>

      {report.recovery_suggestions.length > 0 && (
        <section className="rounded-2xl bg-cloud p-6">
          <h2 className="text-subtitle font-bold text-ink-deep">How to fix the agent</h2>
          <ul className="mt-3 space-y-4 text-body-sm text-ink">
            {report.recovery_suggestions.map((r) => (
              <li key={r.assertion_id}>
                <span className="block font-mono text-caption text-ink-steel">{r.assertion_id}</span>
                {r.suggestion}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border border-line-soft p-6">
        <h2 className="text-subtitle font-bold text-ink-deep">Report</h2>
        <p className="mt-1 text-body-sm text-ink-steel">JSON with the run, fault, checks, comparison and fingerprint.</p>
        <a
          href={api.reportDownloadUrl(report.run.run_id)}
          data-testid="download-report"
          download
          className={cn(buttonVariants({ variant: "ink" }), "mt-4 w-full")}
        >
          <Download className="h-4 w-4" aria-hidden />
          Download JSON report
        </a>
        <dl className="mt-5 grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-2 text-caption">
          <dt className="text-ink-steel">Signature</dt>
          <dd className="break-all font-mono text-ink-charcoal">{report.determinism.signature}</dd>
          <dt className="text-ink-steel">Fingerprint</dt>
          <dd className="break-all font-mono text-ink-charcoal">{report.report_fingerprint}</dd>
          <dt className="text-ink-steel">Fixture</dt>
          <dd className="text-ink-charcoal">{report.determinism.fixture_version}</dd>
          <dt className="text-ink-steel">Seed</dt>
          <dd className="tnum text-ink-charcoal">{report.determinism.seed}</dd>
        </dl>
        <ul className="mt-5 list-disc space-y-1.5 pl-4 text-caption text-ink-steel">
          {report.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
