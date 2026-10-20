from __future__ import annotations

import threading

from sqlalchemy import Engine
from sqlmodel import Session, SQLModel, create_engine, select

from app.config import get_settings
from app.models import Run

_engine: Engine | None = None
_engine_path: str | None = None
_lock = threading.Lock()


def get_engine() -> Engine:
    global _engine, _engine_path
    path = str(get_settings().db_path)
    with _lock:
        if _engine is None or _engine_path != path:
            _engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
            _engine_path = path
            SQLModel.metadata.create_all(_engine)
    return _engine


def get_run(run_id: str) -> Run | None:
    with Session(get_engine()) as s:
        return s.get(Run, run_id)


def save_run(run: Run) -> Run:
    with Session(get_engine()) as s:
        merged = s.merge(run)
        s.commit()
        s.refresh(merged)
        return merged


def update_run(run_id: str, **fields) -> Run:
    with Session(get_engine()) as s:
        run = s.get(Run, run_id)
        if run is None:
            raise KeyError(run_id)
        for k, v in fields.items():
            setattr(run, k, v)
        s.add(run)
        s.commit()
        s.refresh(run)
        return run


def list_runs(limit: int = 50) -> list[Run]:
    with Session(get_engine()) as s:
        return list(s.exec(select(Run).order_by(Run.created_at.desc()).limit(limit)))
