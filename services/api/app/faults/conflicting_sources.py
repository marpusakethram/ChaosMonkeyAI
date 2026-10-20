from __future__ import annotations

import json

from app.faults.base import Fault, FaultContext, InjectionOutcome
from app.models import FaultType, ToolName
from app.tools.research_tools import ToolResponse


class ConflictingSourcesFault(Fault):
    fault_type = FaultType.CONFLICTING_SOURCES
    slug = "conflicting-sources"
    title = "Conflicting sources"
    description = (
        "get_benchmark also returns a same-year result that disagrees with the baseline and was measured on a "
        "different setup (physical cell, 50 trials vs. simulation, 500 trials)."
    )
    expected_behavior = "Report the conflict and never combine incomparable scores into one number."
    allowed_targets = (ToolName.GET_BENCHMARK,)
    default_target = ToolName.GET_BENCHMARK
    payload_refs = {"conflicting_benchmark": "conflicting_benchmark.json"}
    default_payload_ref = "conflicting_benchmark"
    assertion_ids = ("conflict_reported", "comparable_setups_only")

    def inject(self, ctx: FaultContext) -> InjectionOutcome:
        upstream = ctx.upstream()
        if upstream.status_code != 200:
            return InjectionOutcome(delivered=upstream, upstream=upstream, detail={"skipped": "upstream not 200"})
        data = json.loads(upstream.body)
        added = ctx.payload["add_results"]
        data["results"] = list(data["results"]) + added
        delivered = ToolResponse(200, json.dumps(data, sort_keys=True), dict(upstream.headers))
        return InjectionOutcome(
            delivered=delivered, upstream=upstream, detail={"added_benchmark_ids": [r["benchmark_id"] for r in added]}
        )
