"""HTTP API (C5.2). Accepts only typed, bounded configuration -- never code, URLs or shell input."""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field

from app import db
from app.agents.adapter import adapter_catalog
from app.config import get_settings
from app.faults.registry import catalog as fault_catalog
from app.models import AgentConfig, FaultConfig, Run, RunKind
from app.runner import assertions
from app.runner.orchestrator import RunRejected, orchestrator
from app.runner.report import build_report
from app.runner.trace import cleanup_old_traces, read_events, write_json_atomic
from app.scenarios import load_scenarios



@asynccontextmanager
async def lifespan(_: FastAPI):
    get_settings().ensure_dirs()
    db.get_engine()
    cleanup_old_traces()
    yield


app = FastAPI(title="ChaosMonkey AI", version="0.1.0", description="Crash-test AI agents before customers do.",
              lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["GET", "POST"],
    allow_headers=["content-type"],
)

API = "/api/v1"


class BaselineRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scenario_id: str = Field(default="robotics-benchmark", max_length=64, pattern=r"^[a-z0-9-]+$")
    agent: AgentConfig = Field(default_factory=AgentConfig)
    seed: int = Field(default=42, ge=0, le=2**31 - 1)


class ChaosRequest(BaselineRequest):
    fault: FaultConfig
    baseline_run_id: str | None = Field(default=None, max_length=64)


def _run_out(run: Run) -> dict[str, Any]:
    return json.loads(run.model_dump_json())


def _get(run_id: str) -> Run:
    run = db.get_run(run_id)
    if run is None:
        raise HTTPException(404, f"run {run_id} not found")
    return run


def _start(**kwargs: Any) -> Run:
    try:
        run = orchestrator.create_run(**kwargs)
        orchestrator.submit(run.run_id)
    except RunRejected as exc:
        raise HTTPException(429 if "too many" in str(exc) else 422, str(exc)) from exc
    return run


@app.get(f"{API}/health")
def health() -> dict[str, Any]:
    s = get_settings()
    return {
        "status": "ok",
        "mode": "gemini-live-available" if s.gemini_enabled else "offline-fixtures",
        "gemini_enabled": s.gemini_enabled,
        "gemini_model": s.gemini_model if s.gemini_enabled else None,
        "budgets": {
            "max_tool_calls": s.max_tool_calls, "max_agent_steps": s.max_agent_steps,
            "max_run_seconds": s.max_run_seconds, "max_gemini_requests_per_run": s.max_gemini_requests_per_run,
            "tool_timeout_ms": s.tool_timeout_ms, "max_fault_injections_per_run": s.max_fault_injections_per_run,
        },
    }


@app.get(f"{API}/faults")
def faults() -> list[dict]:
    return fault_catalog()


@app.get(f"{API}/agents")
def agents() -> list[dict]:
    return adapter_catalog()


@app.get(f"{API}/assertions")
def assertion_catalog() -> list[dict]:
    return assertions.catalog()


@app.get(f"{API}/scenarios")
def scenarios() -> list[dict]:
    return [
        {"scenario_id": t.scenario_id, "task": t.task, "fixture_version": t.fixture_version,
         "technology": t.technology, "metric": t.metric, "simulation_notice": t.simulation_notice, "expected": t.expected}
        for t in load_scenarios().values()
    ]


@app.post(f"{API}/runs/baseline", status_code=202)
def create_baseline(req: BaselineRequest) -> dict[str, Any]:
    run = _start(kind=RunKind.BASELINE, scenario_id=req.scenario_id, agent=req.agent, seed=req.seed)
    return _run_out(run)


@app.post(f"{API}/runs/chaos", status_code=202)
def create_chaos(req: ChaosRequest) -> dict[str, Any]:
    baseline_id = req.baseline_run_id
    if baseline_id:
        base = _get(baseline_id)
        if base.kind != RunKind.BASELINE.value:
            raise HTTPException(422, "baseline_run_id must reference a baseline run")
    else:
        # No baseline supplied: run one with the same agent and seed so there is always a comparison.
        base = _start(kind=RunKind.BASELINE, scenario_id=req.scenario_id, agent=req.agent, seed=req.seed)
        baseline_id = base.run_id
    run = _start(kind=RunKind.CHAOS, scenario_id=req.scenario_id, agent=req.agent, fault=req.fault, seed=req.seed,
                 baseline_run_id=baseline_id)
    return _run_out(run)


@app.get(f"{API}/runs")
def runs(limit: int = Query(30, ge=1, le=200)) -> list[dict[str, Any]]:
    return [_run_out(r) for r in db.list_runs(limit)]


@app.get(f"{API}/runs/{{run_id}}")
def get_run(run_id: str) -> dict[str, Any]:
    return _run_out(_get(run_id))


@app.get(f"{API}/runs/{{run_id}}/events")
def get_events(run_id: str, after: int = Query(0, ge=0)) -> list[dict[str, Any]]:
    _get(run_id)
    return [e.model_dump() for e in read_events(run_id, after=after)]


@app.get(f"{API}/runs/{{run_id}}/report")
def get_report(run_id: str, download: bool = False) -> Response:
    _get(run_id)
    report = build_report(run_id)
    if not download:
        return JSONResponse(json.loads(json.dumps(report, default=str)))
    path = get_settings().reports_dir / f"{run_id}.json"
    write_json_atomic(path, report)
    return Response(
        path.read_bytes(), media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="chaosmonkey-report-{run_id[:8]}.json"'},
    )


@app.post(f"{API}/runs/{{run_id}}/cancel")
def cancel(run_id: str) -> dict[str, Any]:
    _get(run_id)
    return _run_out(orchestrator.cancel(run_id))


@app.post(f"{API}/runs/{{run_id}}/replay", status_code=202)
def replay(run_id: str) -> dict[str, Any]:
    _get(run_id)
    try:
        run = orchestrator.create_replay(run_id)
        orchestrator.submit(run.run_id)
    except RunRejected as exc:
        raise HTTPException(422, str(exc)) from exc
    return _run_out(run)
