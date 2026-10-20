"""Append-only JSONL trace per run (C4).

* One event per line, written with a single os.write on an O_APPEND fd, then fsync'd.
* Events are redacted before serialization.
* Files are capped at TRACE_MAX_BYTES; past the cap a single `trace_truncated` marker is written.
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from app.config import get_settings
from app.models import Event
from app.runner.redaction import redact

MAX_BODY_CHARS = 4000


def stable_hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def clip(text: str | None, limit: int = MAX_BODY_CHARS) -> str | None:
    if text is None:
        return None
    return text if len(text) <= limit else text[:limit] + f"...[clipped {len(text) - limit} chars]"


def trace_path(run_id: str) -> Path:
    return get_settings().traces_dir / f"{run_id}.jsonl"


class TraceWriter:
    def __init__(self, run_id: str, max_bytes: int | None = None):
        self.run_id = run_id
        self.path = trace_path(run_id)
        self.max_bytes = max_bytes or get_settings().trace_max_bytes
        self._lock = threading.Lock()
        self._seq = 0
        self._t0 = time.perf_counter()
        self._bytes = self.path.stat().st_size if self.path.exists() else 0
        self._truncated = False
        self.events: list[Event] = []

    @property
    def elapsed_ms(self) -> float:
        return (time.perf_counter() - self._t0) * 1000

    def emit(self, phase: str, message: str = "", **fields: Any) -> Event:
        with self._lock:
            self._seq += 1
            data = fields.pop("data", {}) or {}
            event = Event(
                timestamp=datetime.now(timezone.utc).isoformat(),
                run_id=self.run_id,
                sequence=self._seq,
                phase=phase,
                offset_ms=round(self.elapsed_ms, 3),
                message=message,
                data=redact(data),
                **fields,
            )
            event.message = redact(event.message)
            self.events.append(event)
            self._write(event)
            return event

    def _write(self, event: Event) -> None:
        if self._truncated:
            return
        line = (event.model_dump_json() + "\n").encode()
        if self._bytes + len(line) > self.max_bytes:
            marker = Event(
                timestamp=event.timestamp,
                run_id=self.run_id,
                sequence=event.sequence,
                phase="trace_truncated",
                offset_ms=event.offset_ms,
                message=f"trace exceeded {self.max_bytes} bytes; further events kept in memory only",
            )
            line = (marker.model_dump_json() + "\n").encode()
            self._truncated = True
        fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        try:
            os.write(fd, line)
            os.fsync(fd)
        finally:
            os.close(fd)
        self._bytes += len(line)


def read_events(run_id: str, after: int = 0) -> list[Event]:
    path = trace_path(run_id)
    if not path.exists():
        return []
    events = []
    with path.open() as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                ev = Event.model_validate_json(line)
            except ValueError:
                continue  # a torn final line is skipped, never fatal
            if ev.sequence > after:
                events.append(ev)
    return events


SIGNATURE_FIELDS = (
    "sequence",
    "phase",
    "tool_name",
    "input_hash",
    "output_schema_status",
    "fault_id",
    "exception_type",
    "retry_index",
    "assertion_ids",
)


def event_signature_rows(events: list[Event]) -> list[dict[str, Any]]:
    """Timing-free, ID-free projection of a trace. Two runs with identical tool outputs and fault
    schedules must produce identical rows."""
    rows = []
    for ev in events:
        if ev.phase in ("run_started", "run_completed", "trace_truncated"):
            continue
        row = {k: getattr(ev, k) for k in SIGNATURE_FIELDS}
        row["body_hash"] = ev.data.get("body_hash")
        row["status_code"] = ev.data.get("status_code")
        row["assertion_status"] = ev.data.get("status")
        rows.append(row)
    return rows


def compute_signature(events: list[Event]) -> str:
    return stable_hash(event_signature_rows(events))


def write_json_atomic(path: Path, payload: Any) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, sort_keys=True, default=str))
    os.replace(tmp, path)


def cleanup_old_traces(retention_days: int | None = None) -> list[str]:
    """Delete trace and report files older than the retention window. Returns removed run IDs."""
    settings = get_settings()
    days = settings.retention_days if retention_days is None else retention_days
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).timestamp()
    removed = []
    for directory in (settings.traces_dir, settings.reports_dir):
        for f in directory.glob("*"):
            if f.is_file() and f.stat().st_mtime < cutoff:
                f.unlink(missing_ok=True)
                if f.suffix == ".jsonl":
                    removed.append(f.stem)
    return removed
