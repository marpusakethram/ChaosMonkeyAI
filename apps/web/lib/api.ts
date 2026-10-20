export type RunStatus = "CREATED" | "RUNNING" | "PASSED" | "FAILED" | "ERROR" | "CANCELLED";
export const TERMINAL: RunStatus[] = ["PASSED", "FAILED", "ERROR", "CANCELLED"];

export interface AssertionResult {
  assertion_id: string;
  title: string;
  status: "PASS" | "FAIL" | "UNKNOWN";
  applicable: boolean;
  reason: string;
  evidence_sequences: number[];
}

export interface Score {
  passed: number;
  failed: number;
  unknown: number;
  applicable: number;
  not_applicable: number;
  value: number | null;
  confidence: "high" | "low";
  confidence_note: string;
}

export interface FaultConfigOut {
  fault_type: string;
  target_tool: string;
  occurrence: number;
  payload_ref: string;
  severity: string;
  max_injections: number;
}

export interface Run {
  run_id: string;
  kind: "baseline" | "chaos" | "replay";
  scenario_id: string;
  agent_adapter: string;
  agent_mode: "offline" | "live";
  created_at: string;
  completed_at: string | null;
  status: RunStatus;
  failure_origin: "agent" | "harness" | null;
  status_reason: string;
  fault_config: FaultConfigOut | null;
  seed: number;
  fixture_version: string;
  latency_ms: number | null;
  tool_calls: number;
  model_requests: number;
  trace_id: string;
  baseline_run_id: string | null;
  replay_of: string | null;
  artifact: Record<string, unknown> | null;
  assertion_results: AssertionResult[] | null;
  score: Score | null;
  signature: string | null;
}

export interface TraceEvent {
  timestamp: string;
  run_id: string;
  sequence: number;
  phase: string;
  tool_name: string | null;
  invocation_id: string | null;
  input_hash: string | null;
  output_schema_status: string | null;
  duration_ms: number | null;
  fault_id: string | null;
  exception_type: string | null;
  retry_index: number | null;
  assertion_ids: string[];
  offset_ms: number;
  message: string;
  data: Record<string, unknown>;
}

export interface FaultSpec {
  fault_type: string;
  slug: string;
  title: string;
  description: string;
  expected_behavior: string;
  allowed_targets: string[];
  default_target: string;
  payload_refs: string[];
  default_payload_ref: string;
  assertion_ids: string[];
}

export interface AgentSpec {
  name: string;
  mode: "offline" | "live";
  description: string;
  available: boolean;
}

export interface Scenario {
  scenario_id: string;
  task: string;
  fixture_version: string;
  technology: string;
  metric: string;
  simulation_notice: string;
}

export interface Health {
  status: string;
  mode: string;
  gemini_enabled: boolean;
  gemini_model: string | null;
  budgets: Record<string, number>;
}

export interface Comparison {
  baseline_run_id: string;
  chaos_run_id: string;
  tool_calls: { baseline: number; chaos: number; delta: number };
  latency_ms: { baseline: number; chaos: number; delta: number };
  completeness: { baseline: number; chaos: number };
  assertions_changed: { assertion_id: string; baseline: string; chaos: string; reason: string }[];
  recovery_outcome: "recovered" | "graceful_failure" | "silent_failure" | "crashed" | "not_applicable";
  recovery_explanation: string;
}

export interface Report {
  report_version: string;
  run: Partial<Run> & { run_id: string; status: RunStatus };
  fault: FaultConfigOut | null;
  score: Score | null;
  assertions: AssertionResult[] | null;
  artifact: Record<string, unknown> | null;
  comparison: Comparison | null;
  root_cause: {
    summary: string;
    details: string[];
    faulted_invocations: { sequence: number; fault_id: string; tool_name: string; invocation_id: string; call_index: number }[];
    failed_assertions: string[];
  };
  recovery_suggestions: { assertion_id: string; suggestion: string }[];
  determinism: { signature: string | null; fixture_version: string; seed: number };
  report_fingerprint: string;
  limitations: string[];
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { cache: "no-store", ...init });
  } catch {
    throw new ApiError(0, "Cannot reach the ChaosMonkey API. Is it running on port 8000?");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body);
    } catch {
      /* keep statusText */
    }
    throw new ApiError(res.status, `${res.status}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

const post = <T,>(path: string, body?: unknown) =>
  call<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });

export const api = {
  health: () => call<Health>("/health"),
  faults: () => call<FaultSpec[]>("/faults"),
  agents: () => call<AgentSpec[]>("/agents"),
  scenarios: () => call<Scenario[]>("/scenarios"),
  runs: (limit = 20) => call<Run[]>(`/runs?limit=${limit}`),
  run: (id: string) => call<Run>(`/runs/${id}`),
  events: (id: string, after = 0) => call<TraceEvent[]>(`/runs/${id}/events?after=${after}`),
  report: (id: string) => call<Report>(`/runs/${id}/report`),
  baseline: (body: { agent: { adapter: string }; seed: number; scenario_id: string }) => post<Run>("/runs/baseline", body),
  chaos: (body: {
    agent: { adapter: string };
    seed: number;
    scenario_id: string;
    baseline_run_id?: string;
    fault: { fault_type: string; target_tool?: string; occurrence: number; max_injections: number; severity: string };
  }) => post<Run>("/runs/chaos", body),
  cancel: (id: string) => post<Run>(`/runs/${id}/cancel`),
  replay: (id: string) => post<Run>(`/runs/${id}/replay`),
  reportDownloadUrl: (id: string) => `/api/v1/runs/${id}/report?download=true`,
};
