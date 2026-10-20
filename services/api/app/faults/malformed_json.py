from __future__ import annotations

from app.faults.base import Fault, FaultContext, InjectionOutcome
from app.models import FaultType, ToolName
from app.tools.research_tools import ToolResponse


class MalformedJsonFault(Fault):
    fault_type = FaultType.MALFORMED_JSON
    slug = "malformed-json"
    title = "Malformed JSON"
    description = "One expected tool result is replaced by invalid JSON (a truncated object) with HTTP 200."
    expected_behavior = "Validator rejects the body; agent retries or discloses the error. Never silently uses malformed data."
    allowed_targets = (ToolName.GET_BENCHMARK, ToolName.GET_RESEARCH_PAPER, ToolName.VERIFY_CITATION)
    default_target = ToolName.GET_BENCHMARK
    payload_refs = {"truncated_object": "truncated_object.txt", "truncate_upstream": None}
    default_payload_ref = "truncated_object"
    assertion_ids = ("malformed_data_not_used", "claim_values_match_sources")

    def inject(self, ctx: FaultContext) -> InjectionOutcome:
        upstream = ctx.upstream()
        if ctx.payload is not None and ctx.tool_name == ToolName.GET_BENCHMARK.value:
            body = ctx.payload
            strategy = "bundled truncated object"
        else:
            # Deterministic generic truncation: keep the first 60% of the real body.
            body = upstream.body[: max(1, int(len(upstream.body) * 0.6))]
            strategy = "truncated upstream body at 60%"
        delivered = ToolResponse(200, body, {"content-type": "application/json"})
        return InjectionOutcome(delivered=delivered, upstream=upstream, detail={"strategy": strategy})
