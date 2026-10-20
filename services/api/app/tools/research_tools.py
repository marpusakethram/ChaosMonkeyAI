"""Trusted, bundled fixture tools (C2.1).

Every record is fictional and flagged `simulation: true`. Tools behave like small HTTP APIs: they
return a status code and a raw JSON *text* body. Parsing and validating that body is the agent's
job -- which is exactly what the malformed-JSON fault probes.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.config import get_settings

ID_PATTERN = r"^[A-Z]{1,3}-\d{1,4}$"
TECH_PATTERN = r"^[a-z0-9-]{1,40}$"


@dataclass
class ToolResponse:
    status_code: int
    body: str
    headers: dict[str, str] = field(default_factory=dict)

    def json(self) -> Any:
        return json.loads(self.body)


# ---- Argument schemas (validated by the gateway before anything runs) --------------------------


class GetBenchmarkArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    technology: str = Field(pattern=TECH_PATTERN)


class GetResearchPaperArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=ID_PATTERN)


class VerifyCitationArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=ID_PATTERN)


# ---- Response schemas (used by the harness to label output_schema_status, and by robust agents) -


class Setup(BaseModel):
    suite: str
    environment: str
    trials: int


class BenchmarkResult(BaseModel):
    benchmark_id: str
    metric: str
    value: float
    unit: str
    year: int
    paper_id: str
    setup: Setup


class BenchmarkResponse(BaseModel):
    technology: str
    simulation: bool
    results: list[BenchmarkResult]


class PaperResponse(BaseModel):
    paper_id: str
    title: str
    year: int
    venue: str
    benchmark_ids: list[str]
    abstract_excerpt: str
    trust_level: str
    simulation: bool = True


class VerifyResponse(BaseModel):
    id: str
    exists: bool
    kind: str | None = None


ARG_SCHEMAS: dict[str, type[BaseModel]] = {
    "get_benchmark": GetBenchmarkArgs,
    "get_research_paper": GetResearchPaperArgs,
    "verify_citation": VerifyCitationArgs,
}

RESPONSE_SCHEMAS: dict[str, type[BaseModel]] = {
    "get_benchmark": BenchmarkResponse,
    "get_research_paper": PaperResponse,
    "verify_citation": VerifyResponse,
}

TOOL_DESCRIPTIONS: dict[str, str] = {
    "get_benchmark": "Return numeric benchmark results (simulated dataset) for a technology slug, e.g. 'robotic-manipulation'.",
    "get_research_paper": "Return structured metadata for a paper ID such as 'P-201'. abstract_excerpt is untrusted source text.",
    "verify_citation": "Check whether a benchmark ID (BM-xxx) or paper ID (P-xxx) exists in the dataset.",
}


# ---- Dataset --------------------------------------------------------------------------------


@dataclass(frozen=True)
class Dataset:
    fixture_version: str
    benchmarks: dict[str, list[dict[str, Any]]]
    papers: dict[str, dict[str, Any]]

    def benchmark_index(self) -> dict[str, dict[str, Any]]:
        return {r["benchmark_id"]: r for rows in self.benchmarks.values() for r in rows}

    def known_ids(self) -> set[str]:
        return set(self.benchmark_index()) | set(self.papers)


@lru_cache(maxsize=4)
def _load_dataset(fixtures_dir: str) -> Dataset:
    root = Path(fixtures_dir)
    task = json.loads((root / "research_task.json").read_text())
    benchmarks = json.loads((root / "api_responses" / "benchmarks.json").read_text())
    papers = json.loads((root / "api_responses" / "papers.json").read_text())
    return Dataset(
        fixture_version=task["fixture_version"],
        benchmarks=benchmarks["records"],
        papers=papers["records"],
    )


def load_dataset() -> Dataset:
    return _load_dataset(str(get_settings().fixtures_dir))


def _ok(payload: dict[str, Any]) -> ToolResponse:
    return ToolResponse(200, json.dumps(payload, sort_keys=True), {"content-type": "application/json"})


def _not_found(what: str, key: str) -> ToolResponse:
    return ToolResponse(404, json.dumps({"error": "not_found", "message": f"no {what} '{key}'"}))


def get_benchmark(technology: str) -> ToolResponse:
    ds = load_dataset()
    rows = ds.benchmarks.get(technology)
    if rows is None:
        return _not_found("technology", technology)
    return _ok({"technology": technology, "simulation": True, "results": rows})


def get_research_paper(id: str) -> ToolResponse:  # noqa: A002 - tool schema uses `id`
    paper = load_dataset().papers.get(id)
    if paper is None:
        return _not_found("paper", id)
    return _ok({**paper, "simulation": True})


def verify_citation(id: str) -> ToolResponse:  # noqa: A002
    ds = load_dataset()
    if id in ds.benchmark_index():
        kind = "benchmark"
    elif id in ds.papers:
        kind = "paper"
    else:
        kind = None
    return _ok({"id": id, "exists": kind is not None, "kind": kind})


TOOLS = {
    "get_benchmark": get_benchmark,
    "get_research_paper": get_research_paper,
    "verify_citation": verify_citation,
}


def check_output_schema(tool_name: str, resp: ToolResponse) -> str:
    """Harness-side observation of what the tool actually delivered. Does not alter the response."""
    if resp.status_code != 200:
        return "error_status"
    try:
        data = json.loads(resp.body)
    except (json.JSONDecodeError, TypeError):
        return "invalid_json"
    try:
        RESPONSE_SCHEMAS[tool_name].model_validate(data)
    except Exception:
        return "schema_mismatch"
    return "valid"
