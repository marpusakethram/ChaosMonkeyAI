import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, type Report } from "@/lib/api";
import { cn } from "@/lib/utils";

const MARK = { PASS: "✓", FAIL: "✗", UNKNOWN: "?" } as const;

export function ReportPanel({ report, onFocus }: { report: Report; onFocus?: (seqs: number[]) => void }) {
  const applicable = (report.assertions ?? []).filter((a) => a.applicable);
  const notApplicable = (report.assertions ?? []).filter((a) => !a.applicable);
  const s = report.score;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      <Card className="lg:col-span-3" data-testid="assertion-checklist">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Assertion checklist</CardTitle>
          {s && (
            <span className="font-mono text-xs text-graphite-300" data-testid="score">
              {s.passed}/{s.applicable} passed · {s.failed} fail · {s.unknown} unknown ·{" "}
              <span className={s.confidence === "high" ? "text-graphite-200" : "text-unknown"}>{s.confidence} confidence</span>
            </span>
          )}
        </CardHeader>
        <CardContent className="space-y-1.5">
          {applicable.length === 0 && <p className="text-sm text-graphite-400">No assertions evaluated for this run.</p>}
          {applicable.map((a) => (
            <button
              key={a.assertion_id}
              onClick={() => onFocus?.(a.evidence_sequences)}
              data-testid={`assertion-${a.assertion_id}`}
              data-status={a.status}
              className="flex w-full items-start gap-3 rounded-md border border-transparent px-2 py-2 text-left hover:border-graphite-700 hover:bg-graphite-850"
            >
              <span
                className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded font-mono text-xs font-bold",
                  a.status === "PASS" && "bg-recover-dim text-recover",
                  a.status === "FAIL" && "bg-danger-dim text-danger",
                  a.status === "UNKNOWN" && "bg-unknown-dim text-unknown",
                )}
              >
                {MARK[a.status]}
              </span>
              <span className="min-w-0">
                <span className="block text-sm text-graphite-100">{a.title}</span>
                <span className="block break-words text-xs text-graphite-400">{a.reason}</span>
              </span>
            </button>
          ))}
          {notApplicable.length > 0 && (
            <p className="pt-2 text-xs text-graphite-500">
              Not applicable here: {notApplicable.map((a) => a.assertion_id).join(", ")}
            </p>
          )}
          {s && <p className="pt-2 text-xs text-graphite-500">{s.confidence_note} UNKNOWN never counts as a pass.</p>}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4 lg:col-span-2">
        <Card data-testid="root-cause">
          <CardHeader>
            <CardTitle>Root cause</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {report.root_cause.details.map((d, i) => (
              <p key={i} className={cn("break-words", i === 0 ? "text-graphite-100" : "text-graphite-300")}>
                {d}
              </p>
            ))}
          </CardContent>
        </Card>
        {report.recovery_suggestions.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Recovery suggestions</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-graphite-200">
                {report.recovery_suggestions.map((r) => (
                  <li key={r.assertion_id} className="flex gap-2">
                    <span className="text-recover">→</span>
                    <span>
                      <span className="font-mono text-xs text-graphite-400">{r.assertion_id}</span>
                      <br />
                      {r.suggestion}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Export</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs text-graphite-400">
            <a
              href={api.reportDownloadUrl(report.run.run_id)}
              data-testid="download-report"
              className="inline-flex h-9 items-center rounded-md bg-graphite-100 px-4 text-sm font-medium text-graphite-950 hover:bg-white"
              download
            >
              Download JSON report
            </a>
            <div className="space-y-1 font-mono">
              <div>signature {report.determinism.signature}</div>
              <div>fingerprint {report.report_fingerprint}</div>
              <div>
                fixture {report.determinism.fixture_version} · seed {report.determinism.seed}
              </div>
            </div>
            <ul className="list-disc space-y-1 pl-4">
              {report.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <Badge tone="neutral">report v{report.report_version}</Badge>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
