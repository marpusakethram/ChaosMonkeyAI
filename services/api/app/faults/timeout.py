from __future__ import annotations

from app.faults.base import Fault, FaultContext, InjectionOutcome
from app.models import FaultType, Severity, ToolName

DELAY_CAP_MS = {Severity.LOW: 800, Severity.MEDIUM: 1500, Severity.HIGH: 3000}


class TimeoutFault(Fault):
    fault_type = FaultType.TIMEOUT
    slug = "timeout"
    title = "Tool timeout"
    description = "The synthetic tool stalls past the gateway's TOOL_TIMEOUT_MS budget; the gateway raises ToolTimeoutError."
    expected_behavior = "Timeout is caught; bounded retry or graceful failure. No hanging UI, no infinite retry."
    allowed_targets = (ToolName.GET_BENCHMARK, ToolName.GET_RESEARCH_PAPER, ToolName.VERIFY_CITATION)
    default_target = ToolName.GET_BENCHMARK
    payload_refs = {"slow_upstream": "slow_upstream.json"}
    default_payload_ref = "slow_upstream"
    assertion_ids = ("recovered_after_transient_error", "bounded_execution", "max_latency")

    def inject(self, ctx: FaultContext) -> InjectionOutcome:
        delay_ms = min(int(ctx.payload.get("delay_ms", 1500)), DELAY_CAP_MS[ctx.severity])
        # Wait is interruptible: once the gateway gives up it sets `abandon` and this thread exits.
        if ctx.abandon.wait(delay_ms / 1000):
            return InjectionOutcome(delivered=None, upstream=None, detail={"delay_ms": delay_ms, "abandoned": True})
        upstream = ctx.upstream()
        return InjectionOutcome(delivered=upstream, upstream=upstream, detail={"delay_ms": delay_ms})
