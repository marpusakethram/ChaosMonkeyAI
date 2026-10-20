import { Badge } from "@/components/ui/badge";
import type { RunStatus } from "@/lib/api";

const TONE: Record<RunStatus, "pass" | "fail" | "unknown" | "neutral" | "fault"> = {
  PASSED: "pass",
  FAILED: "fail",
  ERROR: "unknown",
  CANCELLED: "neutral",
  RUNNING: "fault",
  CREATED: "neutral",
};

export function StatusBadge({ status, origin }: { status: RunStatus; origin?: string | null }) {
  return (
    <Badge tone={TONE[status]} data-testid="run-status">
      {status === "RUNNING" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-fault" />}
      {status}
      {origin ? <span className="opacity-70">· {origin}</span> : null}
    </Badge>
  );
}

export function ModeBadge({ mode }: { mode: "offline" | "live" | string }) {
  return mode === "live" ? (
    <Badge tone="live" data-testid="mode-badge">● Gemini live · stochastic</Badge>
  ) : (
    <Badge tone="neutral" data-testid="mode-badge">◆ Offline fixture mode · deterministic</Badge>
  );
}
