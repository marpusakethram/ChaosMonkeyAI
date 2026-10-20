"""Run contract (C1): entities, statuses and the final artifact schema."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlmodel import JSON, Column
from sqlmodel import Field as SQLField
from sqlmodel import SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid.uuid4())


class RunStatus(str, Enum):
    CREATED = "CREATED"
    RUNNING = "RUNNING"
    PASSED = "PASSED"  # agent ran, every applicable assertion passed
    FAILED = "FAILED"  # agent failure: an assertion failed/unknown, the agent crashed or blew a budget
    ERROR = "ERROR"  # harness failure: our code broke, not the agent's
    CANCELLED = "CANCELLED"


TERMINAL_STATUSES = {RunStatus.PASSED, RunStatus.FAILED, RunStatus.ERROR, RunStatus.CANCELLED}


class RunKind(str, Enum):
    BASELINE = "baseline"
    CHAOS = "chaos"
    REPLAY = "replay"


class FaultType(str, Enum):
    HTTP_429 = "http_429"
    MALFORMED_JSON = "malformed_json"
    TIMEOUT = "timeout"
    CONFLICTING_SOURCES = "conflicting_sources"
    PROMPT_INJECTION = "prompt_injection"


class ToolName(str, Enum):
    GET_BENCHMARK = "get_benchmark"
    GET_RESEARCH_PAPER = "get_research_paper"
    VERIFY_CITATION = "verify_citation"


class Severity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class FaultConfig(BaseModel):
    """Repeatable fault schedule (C3.6). Bounded by validation and by MAX_FAULT_INJECTIONS_PER_RUN."""

    model_config = ConfigDict(extra="forbid")

    fault_type: FaultType
    target_tool: ToolName | None = None  # None -> fault catalog default
    occurrence: int = Field(default=1, ge=1, le=10, description="1-indexed call number of target_tool to fault")
    payload_ref: str | None = None  # None -> fault catalog default; must be a bundled payload
    severity: Severity = Severity.MEDIUM
    max_injections: int = Field(default=1, ge=1, le=3, description="consecutive calls faulted starting at occurrence")


class AgentConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    adapter: str = "scripted-robust"
    max_retries: int = Field(default=2, ge=0, le=3)
    temperature: float = Field(default=0.0, ge=0.0, le=1.0)


class AssertionStatus(str, Enum):
    PASS = "PASS"
    FAIL = "FAIL"
    UNKNOWN = "UNKNOWN"  # could not be evaluated; never counted as success


class Assertion(BaseModel):
    assertion_id: str
    title: str
    description: str
    applies_to: list[str] = Field(default_factory=list, description="fault types; empty = always applicable")


class AssertionResult(BaseModel):
    assertion_id: str
    title: str
    status: AssertionStatus
    applicable: bool
    reason: str
    evidence_sequences: list[int] = Field(default_factory=list)


class Score(BaseModel):
    passed: int
    failed: int
    unknown: int
    applicable: int
    not_applicable: int
    value: float | None  # passed / applicable, None if nothing applicable
    confidence: Literal["high", "low"]
    confidence_note: str


class ToolInvocation(BaseModel):
    invocation_id: str
    tool_name: str
    arguments: dict[str, Any]
    input_hash: str
    call_index: int  # nth call of this tool in the run (1-indexed)
    retry_index: int
    status_code: int | None = None
    output_schema_status: str = "not_checked"
    duration_ms: float = 0.0
    fault_id: str | None = None
    exception_type: str | None = None


class Event(BaseModel):
    """One append-only trace line (C4.1). Never carries keys, auth headers, raw prompts or chain-of-thought."""

    timestamp: str
    run_id: str
    sequence: int
    phase: str
    tool_name: str | None = None
    invocation_id: str | None = None
    input_hash: str | None = None
    output_schema_status: str | None = None
    duration_ms: float | None = None
    fault_id: str | None = None
    exception_type: str | None = None
    retry_index: int | None = None
    assertion_ids: list[str] = Field(default_factory=list)
    offset_ms: float = 0.0
    message: str = ""
    data: dict[str, Any] = Field(default_factory=dict)


# ---- Final artifact the reference task must produce -------------------------------------------


class ClaimValue(BaseModel):
    model_config = ConfigDict(extra="forbid")
    benchmark_id: str
    value: float


class Claim(BaseModel):
    model_config = ConfigDict(extra="forbid")
    claim_id: str
    statement: str
    metric: str = "task_success_rate"
    values: list[ClaimValue] = Field(default_factory=list)
    source_ids: list[str] = Field(min_length=1)
    verified: bool = False


class Conflict(BaseModel):
    model_config = ConfigDict(extra="forbid")
    benchmark_ids: list[str]
    reason: str


class UntrustedFlag(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_id: str
    reason: str


class ResearchReport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    task_id: str
    conclusion: Literal["improved", "not_improved", "inconclusive", "unable_to_complete"]
    summary: str
    claims: list[Claim] = Field(default_factory=list)
    conflicts: list[Conflict] = Field(default_factory=list)
    errors_disclosed: list[str] = Field(default_factory=list)
    untrusted_content_flags: list[UntrustedFlag] = Field(default_factory=list)


class RunResult(BaseModel):
    """What an adapter returns from execute()."""

    artifact: dict[str, Any] | None = None
    agent_error: str | None = None  # agent-side failure (crash, gave up); harness bugs raise instead
    steps: int = 0
    model_requests: int = 0
    notes: list[str] = Field(default_factory=list)


class ComparisonReport(BaseModel):
    baseline_run_id: str
    chaos_run_id: str
    tool_calls: dict[str, int]
    latency_ms: dict[str, float]
    completeness: dict[str, float]
    assertions_changed: list[dict[str, Any]]
    recovery_outcome: Literal["recovered", "graceful_failure", "silent_failure", "crashed", "not_applicable"]
    recovery_explanation: str


# ---- Persistence ------------------------------------------------------------------------------


class Run(SQLModel, table=True):
    run_id: str = SQLField(default_factory=new_id, primary_key=True)
    kind: str = RunKind.BASELINE.value
    scenario_id: str
    agent_adapter: str
    agent_mode: str = "offline"  # offline | live
    created_at: datetime = SQLField(default_factory=utcnow)
    started_at: datetime | None = None
    completed_at: datetime | None = None
    status: str = RunStatus.CREATED.value
    failure_origin: str | None = None  # agent | harness | None
    status_reason: str = ""
    fault_config: dict | None = SQLField(default=None, sa_column=Column(JSON))
    agent_config: dict = SQLField(default_factory=dict, sa_column=Column(JSON))
    seed: int = 42
    fixture_version: str = ""
    latency_ms: float | None = None
    tool_calls: int = 0
    model_requests: int = 0
    trace_id: str = ""
    baseline_run_id: str | None = None
    replay_of: str | None = None
    artifact: dict | None = SQLField(default=None, sa_column=Column(JSON))
    assertion_results: list | None = SQLField(default=None, sa_column=Column(JSON))
    score: dict | None = SQLField(default=None, sa_column=Column(JSON))
    signature: str | None = None
