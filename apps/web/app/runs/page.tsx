"use client";

import { useEffect, useState } from "react";
import { ErrorBanner } from "@/components/error-banner";
import { RunsTable } from "@/components/runs-table";
import { api, type Run } from "@/lib/api";

export default function RunHistory() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.runs(100).then(setRuns).catch((e) => setError(e.message));
  }, []);

  return (
    <div className="space-y-8">
      <header className="max-w-3xl space-y-3">
        <h1 className="text-heading-lg font-medium text-ink-deep sm:text-display">Run history</h1>
        <p className="text-subtitle text-ink-charcoal">Every baseline, crash test and replay on this machine, newest first.</p>
      </header>
      <ErrorBanner message={error} />
      {runs ? <RunsTable runs={runs} /> : !error && <p className="text-body-sm text-ink-steel">Loading runs</p>}
    </div>
  );
}
