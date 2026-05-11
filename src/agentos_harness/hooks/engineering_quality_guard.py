#!/usr/bin/env python3
"""Block plan completion without engineering-quality evidence."""

from __future__ import annotations

import json
import os
import re
import select
import sys
from pathlib import Path


REQUIRED_PLAN_MARKERS = (
    "## Engineering Quality Contract",
    "### Context Receipt Requirements For All Agents",
    "### MoE Plan Consensus Requirement",
)

REQUIRED_RECEIPT_MARKERS = (
    "### Engineering Quality Receipt",
    "Context consulted",
    "Validation run",
    "Review gates run",
)


def _read_event() -> dict:
    if not select.select([sys.stdin], [], [], 0.0)[0]:
        return {}
    try:
        return json.load(sys.stdin)
    except Exception:
        return {}


def _fail(message: str) -> int:
    print(f"ENGINEERING QUALITY GUARD BLOCKED: {message}", file=sys.stderr)
    return 2


def _is_plan_path(path: str) -> bool:
    normalized = path.replace("\\", "/")
    return "/plans/active/" in normalized and normalized.endswith(".md")


def _is_completion_attempt(content: str) -> bool:
    lowered = content.lower()
    return (
        "status: completed" in lowered
        or "<!-- wc-" in lowered and ": done -->" in lowered
        or "/completed/" in lowered
    )


def main() -> int:
    event = _read_event()
    if not event:
        return 0

    if event.get("tool_name") not in {"Edit", "Write"}:
        return 0

    tool_input = event.get("tool_input", {})
    file_path = str(tool_input.get("file_path", ""))
    if not file_path or not _is_plan_path(file_path):
        return 0

    content = tool_input.get("content")
    if content is None:
        content = tool_input.get("new_string", "")
    if not isinstance(content, str) or not content:
        return 0

    if not _is_completion_attempt(content):
        return 0

    for marker in REQUIRED_PLAN_MARKERS:
        if marker not in content:
            return _fail(f"missing required plan marker: {marker}")

    if not re.search(r"verdict:\s*APPROVED", content):
        return _fail("missing explicit approved review evidence")

    if "Remaining gaps" in content and not re.search(r"Remaining gaps.*(?:none|no closeable gap)", content, re.IGNORECASE | re.DOTALL):
        return _fail("plan still reports remaining gaps")

    if "### Engineering Quality Receipt" in content:
        for marker in REQUIRED_RECEIPT_MARKERS:
            if marker not in content:
                return _fail(f"missing required execution receipt marker: {marker}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
