"use client";

import type { FaultSpec } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface FaultChoice {
  fault_type: string;
  target_tool: string;
  occurrence: number;
  max_injections: number;
  severity: string;
}

const ICON: Record<string, string> = {
  http_429: "429",
  malformed_json: "{…",
  timeout: "⏱",
  conflicting_sources: "≠",
  prompt_injection: "⚠",
};

export function FaultPicker({
  faults,
  value,
  onChange,
}: {
  faults: FaultSpec[];
  value: FaultChoice | null;
  onChange: (v: FaultChoice) => void;
}) {
  const selected = faults.find((f) => f.fault_type === value?.fault_type);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5" role="radiogroup" aria-label="Fault type">
        {faults.map((f) => {
          const active = value?.fault_type === f.fault_type;
          return (
            <button
              key={f.fault_type}
              role="radio"
              aria-checked={active}
              data-testid={`fault-${f.fault_type}`}
              onClick={() =>
                onChange({ fault_type: f.fault_type, target_tool: f.default_target, occurrence: 1, max_injections: 1, severity: "medium" })
              }
              className={cn(
                "group flex flex-col gap-2 rounded-lg border p-3 text-left transition-all",
                active
                  ? "border-fault bg-fault-dim shadow-[0_0_0_1px_#ff8a1f55]"
                  : "border-graphite-700 bg-graphite-850 hover:border-graphite-500",
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-10 items-center justify-center rounded font-mono text-xs font-bold",
                  active ? "bg-fault text-graphite-950" : "bg-graphite-700 text-graphite-200",
                )}
              >
                {ICON[f.fault_type] ?? "!"}
              </span>
              <span className="text-sm font-semibold text-graphite-100">{f.title}</span>
              <span className="text-xs leading-snug text-graphite-400">{f.description}</span>
            </button>
          );
        })}
      </div>

      {selected && value && (
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-graphite-700 bg-graphite-850 p-3 text-xs md:grid-cols-5">
          <label className="flex flex-col gap-1">
            <span className="text-graphite-400">Target tool</span>
            <select
              data-testid="fault-target"
              className="rounded border border-graphite-600 bg-graphite-900 px-2 py-1.5 font-mono"
              value={value.target_tool}
              onChange={(e) => onChange({ ...value, target_tool: e.target.value })}
            >
              {selected.allowed_targets.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-graphite-400">On call #</span>
            <input
              type="number"
              min={1}
              max={10}
              className="rounded border border-graphite-600 bg-graphite-900 px-2 py-1.5 font-mono"
              value={value.occurrence}
              onChange={(e) => onChange({ ...value, occurrence: clamp(+e.target.value, 1, 10) })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-graphite-400">Consecutive injections</span>
            <input
              type="number"
              min={1}
              max={3}
              data-testid="fault-max-injections"
              className="rounded border border-graphite-600 bg-graphite-900 px-2 py-1.5 font-mono"
              value={value.max_injections}
              onChange={(e) => onChange({ ...value, max_injections: clamp(+e.target.value, 1, 3) })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-graphite-400">Severity</span>
            <select
              className="rounded border border-graphite-600 bg-graphite-900 px-2 py-1.5 font-mono"
              value={value.severity}
              onChange={(e) => onChange({ ...value, severity: e.target.value })}
            >
              {["low", "medium", "high"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <div className="col-span-2 flex flex-col gap-1 md:col-span-1">
            <span className="text-graphite-400">Expected agent behavior</span>
            <span className="leading-snug text-graphite-200">{selected.expected_behavior}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : lo;
}
