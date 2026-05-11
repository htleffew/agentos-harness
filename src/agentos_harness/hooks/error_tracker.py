#!/usr/bin/env python3
"""PostToolUse hook: append tool errors to .harness/state/error_patterns.jsonl."""

from __future__ import annotations

import json
import select
import sys
from datetime import datetime, timezone
from pathlib import Path


def _project_root() -> Path:
    marker = Path.cwd()
    for parent in [marker, *marker.parents]:
        if (parent / ".harness").exists() or (parent / ".claude").exists():
            return parent
    return marker


def main() -> None:
    if not select.select([sys.stdin], [], [], 0.0)[0]:
        sys.exit(0)

    try:
        event = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_result = event.get("tool_result", {})
    if not isinstance(tool_result, dict):
        sys.exit(0)

    error = tool_result.get("error") or tool_result.get("stderr") or ""
    exit_code = tool_result.get("exit_code")

    # Only record genuine failures
    if not error and (exit_code is None or exit_code == 0):
        sys.exit(0)

    tool_name = event.get("tool_name", "unknown")
    tool_input = event.get("tool_input", {})

    record: dict[str, object] = {
        "at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "tool": tool_name,
    }
    if exit_code is not None and exit_code != 0:
        record["exit_code"] = exit_code
    if error:
        record["error"] = str(error)[:400]
    if tool_name == "Bash":
        record["command"] = str(tool_input.get("command", ""))[:200]
    elif tool_name in ("Write", "Edit", "Read"):
        record["path"] = tool_input.get("file_path", "")

    root = _project_root()
    state_dir = root / ".harness" / "state"
    state_dir.mkdir(parents=True, exist_ok=True)

    with (state_dir / "error_patterns.jsonl").open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, sort_keys=True) + "\n")

    sys.exit(0)


if __name__ == "__main__":
    main()
