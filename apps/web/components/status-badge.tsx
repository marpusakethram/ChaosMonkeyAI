import { Badge } from "@/components/ui/badge";
import type { RunStatus } from "@/lib/api";

const STATUS: Record<RunStatus, { tone: "pass" | "fail" | "attention" | "muted" | "neutral"; text: string }> = {
  PASSED: { tone: "pass", text: "Passed" },
  FAILED: { tone: "fail", text: "Failed" },
  ERROR: { tone: "muted", text: "Harness error" },
  CANCELLED: { tone: "neutral", text: "Cancelled" },
  RUNNING: { tone: "attention", text: "Running" },
  CREATED: { tone: "neutral", text: "Queued" },
};

export function StatusBadge({ status }: { status: RunStatus }) {
  const s = STATUS[status];
  return (
    <Badge tone={s.tone} data-testid="run-status" data-status={status}>
      {status === "RUNNING" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-deep" aria-hidden />}
      {s.text}
    </Badge>
  );
}

export function ModeBadge({ mode }: { mode: "offline" | "live" | string }) {
  return mode === "live" ? (
    <Badge tone="cobalt" data-testid="mode-badge" title="Live model: results vary run to run">
      <span className="h-1.5 w-1.5 rounded-full bg-cobalt" aria-hidden />
      Gemini live
    </Badge>
  ) : (
    <Badge tone="outline" data-testid="mode-badge" title="Scripted agent on bundled fixtures: results reproduce exactly">
      <span className="h-1.5 w-1.5 rounded-full bg-ink-steel" aria-hidden />
      Offline fixtures
    </Badge>
  );
}
