#!/usr/bin/env python3
"""PostToolUse hook that advises when wiki backlog entries exist after workflow completion."""

from __future__ import annotations

import io
import json
import re
import select
import sys
from pathlib import Path


COMPLETION_PATTERNS = [
    r"\[SHEBANG\]\s*Complete",
    r"plans/completed/",
    r"\[EXECUTE\]\s*Complete",
    r"Plan execution complete",
    r"\[LOOP\]\s*Complete",
    r"\[BYE\]\s*Complete",
    r"\[CLEAN\]\s*Complete",
]


def _detect_workspace_root() -> Path:
    cwd = Path.cwd()
    for parent in [cwd, *cwd.parents]:
        if (parent / ".harness").exists() or (parent / ".claude").exists():
            return parent
    return cwd


def _backlog_path(workspace: Path) -> Path:
    harness_dir = workspace / ".harness"
    if harness_dir.exists():
        return harness_dir / "state" / "wiki_maintenance_backlog.json"
    claude_dir = workspace / ".claude"
    if claude_dir.exists():
        return claude_dir / "state" / "curation" / "wiki_maintenance_backlog.json"
    return harness_dir / "state" / "wiki_maintenance_backlog.json"


def _get_pending_count(workspace: Path) -> int:
    path = _backlog_path(workspace)
    if not path.exists():
        return 0
    try:
        backlog = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(backlog, dict):
            return 0
        items = backlog.get("items", [])
        if not isinstance(items, list):
            return 0
        pending = [item for item in items if isinstance(item, dict) and item.get("status") == "pending"]
        return len(pending)
    except (json.JSONDecodeError, OSError):
        return 0


def _is_workflow_completion(tool_result: str) -> bool:
    for pattern in COMPLETION_PATTERNS:
        if re.search(pattern, tool_result, re.IGNORECASE):
            return True
    return False


def main() -> None:
    try:
        stdin_has_data = select.select([sys.stdin], [], [], 0.0)[0]
    except (OSError, io.UnsupportedOperation):
        stdin_has_data = True

    if not stdin_has_data:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse"}}))
        return

    try:
        input_data = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse"}}))
        return

    tool_result = input_data.get("tool_result", {})
    if isinstance(tool_result, dict):
        result_text = str(tool_result.get("stdout", "")) + str(tool_result.get("stderr", ""))
    elif isinstance(tool_result, str):
        result_text = tool_result
    else:
        result_text = str(tool_result)

    output = {"hookSpecificOutput": {"hookEventName": "PostToolUse"}}

    if _is_workflow_completion(result_text):
        workspace = _detect_workspace_root()
        pending_count = _get_pending_count(workspace)
        if pending_count > 0:
            output["hookSpecificOutput"]["additionalContext"] = (
                f"WIKI SWEEP AVAILABLE: {pending_count} pending wiki maintenance "
                f"entries detected after workflow completion. "
                f"Run `harness wiki maintain --process-pending` to process."
            )

    print(json.dumps(output))


if __name__ == "__main__":
    main()
