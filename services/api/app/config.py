"""Runtime settings. Every limit here is a hard budget enforced by the harness."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]


def _int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return int(raw)


@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.getenv("CHAOS_DATA_DIR", REPO_ROOT / "data")))
    fixtures_dir: Path = field(default_factory=lambda: Path(os.getenv("CHAOS_FIXTURES_DIR", REPO_ROOT / "fixtures")))

    # Budgets (C6.3)
    max_tool_calls: int = field(default_factory=lambda: _int("MAX_TOOL_CALLS", 16))
    max_agent_steps: int = field(default_factory=lambda: _int("MAX_AGENT_STEPS", 24))
    max_run_seconds: int = field(default_factory=lambda: _int("MAX_RUN_SECONDS", 20))
    max_gemini_requests_per_run: int = field(default_factory=lambda: _int("MAX_GEMINI_REQUESTS_PER_RUN", 8))
    max_retries_per_call: int = field(default_factory=lambda: _int("MAX_RETRIES_PER_CALL", 3))
    max_fault_injections_per_run: int = field(default_factory=lambda: _int("MAX_FAULT_INJECTIONS_PER_RUN", 3))
    tool_timeout_ms: int = field(default_factory=lambda: _int("TOOL_TIMEOUT_MS", 400))
    max_concurrent_runs: int = field(default_factory=lambda: _int("MAX_CONCURRENT_RUNS", 4))

    # Trace storage (C4.3)
    trace_max_bytes: int = field(default_factory=lambda: _int("TRACE_MAX_BYTES", 1_000_000))
    retention_days: int = field(default_factory=lambda: _int("RETENTION_DAYS", 14))

    # Gemini (optional live mode)
    gemini_api_key: str = field(default_factory=lambda: os.getenv("GEMINI_API_KEY", "").strip())
    gemini_model: str = field(default_factory=lambda: os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite"))
    gemini_rpm: int = field(default_factory=lambda: _int("GEMINI_RPM", 5))

    @property
    def traces_dir(self) -> Path:
        return self.data_dir / "traces"

    @property
    def reports_dir(self) -> Path:
        return self.data_dir / "reports"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "chaosmonkey.db"

    @property
    def gemini_enabled(self) -> bool:
        return bool(self.gemini_api_key)

    def ensure_dirs(self) -> None:
        for d in (self.data_dir, self.traces_dir, self.reports_dir):
            d.mkdir(parents=True, exist_ok=True)


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
        _settings.ensure_dirs()
    return _settings


def set_settings(settings: Settings) -> Settings:
    """Used by tests and the CLI to point the harness at a scratch data dir."""
    global _settings
    _settings = settings
    settings.ensure_dirs()
    return settings
