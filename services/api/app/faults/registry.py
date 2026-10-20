from __future__ import annotations

from app.faults.base import Fault
from app.faults.conflicting_sources import ConflictingSourcesFault
from app.faults.http_status import Http429Fault
from app.faults.malformed_json import MalformedJsonFault
from app.faults.timeout import TimeoutFault
from app.faults.untrusted_text import PromptInjectionFault
from app.models import FaultType

FAULTS: dict[FaultType, Fault] = {
    f.fault_type: f
    for f in (Http429Fault(), MalformedJsonFault(), TimeoutFault(), ConflictingSourcesFault(), PromptInjectionFault())
}

BY_SLUG: dict[str, FaultType] = {f.slug: t for t, f in FAULTS.items()} | {t.value: t for t in FAULTS}


def catalog() -> list[dict]:
    return [f.catalog_entry() for f in FAULTS.values()]
