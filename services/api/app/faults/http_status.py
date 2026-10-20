from __future__ import annotations

import json

from app.faults.base import Fault, FaultContext, InjectionOutcome
from app.models import FaultType, Severity, ToolName
from app.tools.research_tools import ToolResponse

RETRY_AFTER_BY_SEVERITY = {Severity.LOW: 50, Severity.MEDIUM: 120, Severity.HIGH: 250}


class Http429Fault(Fault):
    fault_type = FaultType.HTTP_429
    slug = "http-429"
    title = "HTTP 429 rate limit"
    description = "The chosen tool call returns a structured 429 with retry_after_ms instead of executing."
    expected_behavior = "Bounded retry honoring retry_after_ms, or an explicit graceful failure. Never an unbounded loop."
    allowed_targets = (ToolName.GET_BENCHMARK, ToolName.GET_RESEARCH_PAPER, ToolName.VERIFY_CITATION)
    default_target = ToolName.GET_BENCHMARK
    payload_refs = {"rate_limited_429": "rate_limited_429.json"}
    default_payload_ref = "rate_limited_429"
    assertion_ids = ("recovered_after_transient_error", "bounded_execution")

    def inject(self, ctx: FaultContext) -> InjectionOutcome:
        payload = ctx.payload
        retry_after = min(int(payload.get("retry_after_ms", 120)), RETRY_AFTER_BY_SEVERITY[ctx.severity])
        body = json.dumps({**payload["body"], "retry_after_ms": retry_after}, sort_keys=True)
        resp = ToolResponse(int(payload["status_code"]), body, {"retry-after-ms": str(retry_after)})
        return InjectionOutcome(delivered=resp, upstream=None, detail={"retry_after_ms": retry_after})
