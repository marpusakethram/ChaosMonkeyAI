"""Adapter interface (C2.3).

    execute(task, tool_gateway, config) -> RunResult

An adapter wraps one agent implementation. It may only reach tools through `tool_gateway.call`,
which is where faults are injected and budgets enforced. Adapters are bundled Python code -- the
API never accepts agent code, URLs or shell commands from the browser.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol

from app.models import AgentConfig, RunResult
from app.runner.gateway import ToolGateway


@dataclass(frozen=True)
class Task:
    scenario_id: str
    fixture_version: str
    task: str
    technology: str
    metric: str
    expected: dict
    simulation_notice: str


class AgentAdapter(Protocol):
    name: str
    mode: Literal["offline", "live"]
    description: str

    def execute(self, task: Task, tool_gateway: ToolGateway, config: AgentConfig) -> RunResult: ...


def available_adapters() -> dict[str, AgentAdapter]:
    from app.agents.gemini_agent import GeminiResearchAgent
    from app.agents.reference_agent import ScriptedResearchAgent
    from app.config import get_settings

    adapters: dict[str, AgentAdapter] = {
        "scripted-robust": ScriptedResearchAgent(policy="robust"),
        "scripted-naive": ScriptedResearchAgent(policy="naive"),
    }
    if get_settings().gemini_enabled:
        adapters["gemini"] = GeminiResearchAgent()
    return adapters


def adapter_catalog() -> list[dict]:
    from app.config import get_settings

    entries = [
        {"name": a.name, "mode": a.mode, "description": a.description, "available": True}
        for a in available_adapters().values()
    ]
    if not get_settings().gemini_enabled:
        entries.append({
            "name": "gemini", "mode": "live", "available": False,
            "description": "Gemini function-calling agent. Set GEMINI_API_KEY to enable live mode.",
        })
    return entries
