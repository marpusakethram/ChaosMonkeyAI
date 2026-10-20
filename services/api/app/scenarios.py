from __future__ import annotations

import json

from app.agents.adapter import Task
from app.config import get_settings


def load_scenarios() -> dict[str, Task]:
    raw = json.loads((get_settings().fixtures_dir / "research_task.json").read_text())
    task = Task(
        scenario_id=raw["scenario_id"],
        fixture_version=raw["fixture_version"],
        task=raw["task"],
        technology=raw["technology"],
        metric=raw["metric"],
        expected=raw["expected"],
        simulation_notice=raw["simulation_notice"],
    )
    return {task.scenario_id: task}


def get_scenario(scenario_id: str) -> Task:
    scenarios = load_scenarios()
    if scenario_id not in scenarios:
        raise KeyError(f"unknown scenario '{scenario_id}'; available: {sorted(scenarios)}")
    return scenarios[scenario_id]
