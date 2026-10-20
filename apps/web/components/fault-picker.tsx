"use client";

import { Braces, Gauge, ShieldAlert, Split, Timer } from "lucide-react";
import { OptionRow, PillTabs, Stepper } from "@/components/option-row";
import type { FaultSpec } from "@/lib/api";
import { FAULT_NAMES } from "@/lib/utils";

export interface FaultChoice {
  fault_type: string;
  target_tool: string;
  occurrence: number;
  max_injections: number;
  severity: string;
}

const ICON: Record<string, React.ReactNode> = {
  http_429: <Gauge className="h-5 w-5" />,
  malformed_json: <Braces className="h-5 w-5" />,
  timeout: <Timer className="h-5 w-5" />,
  conflicting_sources: <Split className="h-5 w-5" />,
  prompt_injection: <ShieldAlert className="h-5 w-5" />,
};

// Plain-language descriptions; the API catalog carries the technical ones.
const PLAIN: Record<string, string> = {
  http_429: "The tool answers “too many requests” with a retry-after hint instead of data.",
  malformed_json: "The tool returns a cut-off JSON body with a 200 status.",
  timeout: "The tool stalls past the 400 ms budget and the call is abandoned.",
  conflicting_sources: "A second result disagrees and was measured on a different setup.",
  prompt_injection: "A source excerpt tells the agent to report the value as 999.",
};

export function FaultList({
  faults,
  value,
  onChange,
}: {
  faults: FaultSpec[];
  value: FaultChoice | null;
  onChange: (v: FaultChoice) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Fault" className="grid gap-3">
      {faults.map((f) => (
        <OptionRow
          key={f.fault_type}
          testId={`fault-${f.fault_type}`}
          selected={value?.fault_type === f.fault_type}
          onSelect={() =>
            onChange({ fault_type: f.fault_type, target_tool: f.default_target, occurrence: 1, max_injections: 1, severity: "medium" })
          }
          icon={ICON[f.fault_type]}
          title={FAULT_NAMES[f.fault_type] ?? f.title}
          description={PLAIN[f.fault_type] ?? f.description}
          aside={f.allowed_targets.length === 1 ? `Only on ${f.default_target}` : `Any tool`}
        />
      ))}
    </div>
  );
}

export function InjectionPoint({
  spec,
  value,
  onChange,
}: {
  spec: FaultSpec;
  value: FaultChoice;
  onChange: (v: FaultChoice) => void;
}) {
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <Field label="Tool" hint="Where the fault lands.">
        <PillTabs
          label="Target tool"
          testId="fault-target"
          value={value.target_tool}
          options={spec.allowed_targets.map((t) => ({ value: t, label: t }))}
          onChange={(t) => onChange({ ...value, target_tool: t })}
        />
      </Field>
      <Field label="Severity" hint="Longer stalls and retry-after hints at higher severity.">
        <PillTabs
          label="Severity"
          value={value.severity}
          options={[
            { value: "low", label: "Low" },
            { value: "medium", label: "Medium" },
            { value: "high", label: "High" },
          ]}
          onChange={(s) => onChange({ ...value, severity: s })}
        />
      </Field>
      <Field label="On call number" hint="Retries count as calls.">
        <Stepper label="call number" value={value.occurrence} min={1} max={10} onChange={(n) => onChange({ ...value, occurrence: n })} />
      </Field>
      <Field label="Calls in a row" hint="Three in a row outlasts a two-retry agent.">
        <Stepper
          label="calls in a row"
          testId="fault-max-injections"
          value={value.max_injections}
          min={1}
          max={3}
          onChange={(n) => onChange({ ...value, max_injections: n })}
        />
      </Field>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <div className="text-body-sm font-bold text-ink-deep">{label}</div>
        <div className="text-caption text-ink-steel">{hint}</div>
      </div>
      {children}
    </div>
  );
}
