"""Redaction applied to every event before it touches disk or leaves the API."""

from __future__ import annotations

import re
from typing import Any

from app.config import get_settings

REDACTED = "[REDACTED]"

_SENSITIVE_KEY = re.compile(r"(api[_-]?key|authorization|auth[_-]?token|secret|password|cookie|x-goog-api-key)", re.I)
_SENSITIVE_VALUE = [
    re.compile(r"AIza[0-9A-Za-z_\-]{30,}"),  # Google API keys
    re.compile(r"(?i)bearer\s+[A-Za-z0-9._\-]{8,}"),
    re.compile(r"sk-[A-Za-z0-9_\-]{16,}"),
    re.compile(r"ghp_[A-Za-z0-9]{20,}"),
]


def redact_text(text: str) -> str:
    key = get_settings().gemini_api_key
    if key and len(key) >= 8:
        text = text.replace(key, REDACTED)
    for pattern in _SENSITIVE_VALUE:
        text = pattern.sub(REDACTED, text)
    return text


def redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            k: (REDACTED if isinstance(k, str) and _SENSITIVE_KEY.search(k) else redact(v)) for k, v in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [redact(v) for v in value]
    if isinstance(value, str):
        return redact_text(value)
    return value
