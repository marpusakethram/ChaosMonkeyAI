"""Fault framework (C3). Faults are injected only at the controlled tool boundary.

A fault receives the call context and a thunk that runs the real (or recorded) tool. It returns what
the agent receives plus the upstream response it was derived from, so a replay can reproduce the
exact delivered bytes from recorded upstream outputs.
"""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from app.config import get_settings
from app.models import FaultConfig, FaultType, Severity, ToolName
from app.tools.research_tools import ToolResponse

MAX_PAYLOAD_BYTES = 64 * 1024


@dataclass
class FaultContext:
    tool_name: str
    arguments: dict[str, Any]
    call_index: int
    upstream: Callable[[], ToolResponse]
    abandon: threading.Event  # set by the gateway when it stops waiting for this call
    payload: Any
    severity: Severity


@dataclass
class InjectionOutcome:
    delivered: ToolResponse | None  # None only if the call was abandoned (timeout)
    upstream: ToolResponse | None  # what the real tool returned, if it was executed
    detail: dict[str, Any] = field(default_factory=dict)


class Fault:
    fault_type: FaultType
    slug: str  # CLI name
    title: str
    description: str
    expected_behavior: str
    allowed_targets: tuple[ToolName, ...]
    default_target: ToolName
    payload_refs: dict[str, str | None]  # ref -> bundled file name (None = generated in code)
    default_payload_ref: str
    assertion_ids: tuple[str, ...]

    def inject(self, ctx: FaultContext) -> InjectionOutcome:  # pragma: no cover - interface
        raise NotImplementedError

    def catalog_entry(self) -> dict[str, Any]:
        return {
            "fault_type": self.fault_type.value,
            "slug": self.slug,
            "title": self.title,
            "description": self.description,
            "expected_behavior": self.expected_behavior,
            "allowed_targets": [t.value for t in self.allowed_targets],
            "default_target": self.default_target.value,
            "payload_refs": list(self.payload_refs),
            "default_payload_ref": self.default_payload_ref,
            "assertion_ids": list(self.assertion_ids),
        }


def load_payload(fault: Fault, ref: str) -> Any:
    filename = fault.payload_refs[ref]
    if filename is None:
        return None
    path = (get_settings().fixtures_dir / "api_responses" / "faults" / filename).resolve()
    base = (get_settings().fixtures_dir / "api_responses" / "faults").resolve()
    if base not in path.parents:
        raise ValueError("payload path escapes fixture directory")
    raw = path.read_bytes()
    if len(raw) > MAX_PAYLOAD_BYTES:
        raise ValueError(f"payload {ref} exceeds {MAX_PAYLOAD_BYTES} bytes")
    text = raw.decode()
    return json.loads(text) if Path(filename).suffix == ".json" else text.rstrip("\n")


@dataclass(frozen=True)
class ResolvedFault:
    config: FaultConfig
    fault: Fault
    target_tool: str
    payload_ref: str

    def fault_id(self, call_index: int) -> str:
        return f"{self.config.fault_type.value}@{self.target_tool}#{call_index}"

    def as_dict(self) -> dict[str, Any]:
        d = self.config.model_dump(mode="json")
        d.update(target_tool=self.target_tool, payload_ref=self.payload_ref)
        return d


def resolve(config: FaultConfig) -> ResolvedFault:
    from app.faults.registry import FAULTS

    fault = FAULTS[config.fault_type]
    target = config.target_tool or fault.default_target
    if target not in fault.allowed_targets:
        allowed = ", ".join(t.value for t in fault.allowed_targets)
        raise ValueError(f"{config.fault_type.value} cannot target {target.value}; allowed: {allowed}")
    ref = config.payload_ref or fault.default_payload_ref
    if ref not in fault.payload_refs:
        raise ValueError(f"unknown payload_ref '{ref}' for {config.fault_type.value}; allowed: {list(fault.payload_refs)}")
    return ResolvedFault(config=config, fault=fault, target_tool=target.value, payload_ref=ref)


class FaultScheduler:
    """Decides, deterministically, whether a given call is faulted. Hard-capped per run."""

    def __init__(self, resolved: ResolvedFault | None, run_budget: int):
        self.resolved = resolved
        self.run_budget = run_budget
        self.injected = 0
        self.payload = load_payload(resolved.fault, resolved.payload_ref) if resolved else None

    def match(self, tool_name: str, call_index: int) -> bool:
        r = self.resolved
        if r is None or tool_name != r.target_tool:
            return False
        if self.injected >= min(r.config.max_injections, self.run_budget):
            return False
        return r.config.occurrence <= call_index < r.config.occurrence + r.config.max_injections

    def record(self) -> None:
        self.injected += 1
