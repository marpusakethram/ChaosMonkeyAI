from __future__ import annotations

import os
from dataclasses import replace

import pytest

os.environ.pop("GEMINI_API_KEY", None)

from app.config import Settings, set_settings  # noqa: E402
from app.models import AgentConfig, FaultConfig, FaultType, RunKind  # noqa: E402
from app.runner.orchestrator import orchestrator  # noqa: E402


@pytest.fixture(autouse=True)
def settings(tmp_path):
    import app.ai.gemini as gemini
    gemini._limiter = None  # the free-tier limiter is process-wide; isolate it per test
    s = set_settings(Settings(data_dir=tmp_path / "data", gemini_api_key="", gemini_rpm=1000))
    yield s


@pytest.fixture
def use_settings(settings):
    """Swap individual settings for one test: use_settings(max_tool_calls=3)."""
    def _apply(**overrides):
        return set_settings(replace(settings, **overrides))
    return _apply


def run_once(agent: str = "scripted-robust", fault: FaultType | None = None, seed: int = 42, **fault_kw):
    cfg = FaultConfig(fault_type=fault, **fault_kw) if fault else None
    run = orchestrator.create_run(
        kind=RunKind.CHAOS if cfg else RunKind.BASELINE, scenario_id="robotics-benchmark",
        agent=AgentConfig(adapter=agent), fault=cfg, seed=seed,
    )
    return orchestrator.execute(run.run_id)


def statuses(run) -> dict[str, str]:
    return {a["assertion_id"]: a["status"] for a in run.assertion_results or [] if a["applicable"]}
