"""Stable JSON helpers used by package modules."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


JsonObject = dict[str, Any]


def stable_json(data: Any) -> str:
    return json.dumps(data, sort_keys=True, indent=2, separators=(",", ": ")) + "\n"


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(stable_json(data), encoding="utf-8")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def content_hash(data: Any) -> str:
    return hashlib.sha256(stable_json(data).encode("utf-8")).hexdigest()


def file_hash(content: str | bytes) -> str:
    payload = content.encode("utf-8") if isinstance(content, str) else content
    return hashlib.sha256(payload).hexdigest()


def redact_text(value: str) -> str:
    lowered = value.lower()
    sensitive_markers = (
        "token",
        "secret",
        "password",
        "private_key",
        "aws_access_key",
        "api_key",
        "authorization",
    )
    if any(marker in lowered for marker in sensitive_markers):
        return "[REDACTED]"
    return value


def redact_object(value: Any) -> Any:
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            if redact_text(str(key)) == "[REDACTED]":
                redacted[key] = "[REDACTED]"
            else:
                redacted[key] = redact_object(item)
        return redacted
    if isinstance(value, list):
        return [redact_object(item) for item in value]
    if isinstance(value, str):
        return redact_text(value)
    return value
