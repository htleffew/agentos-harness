#!/usr/bin/env python3
"""PostToolUse hook that advises when wiki backlog entries exist after workflow completion."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Dict, Any, List


def _find_workspace_root() -> Path:
    """Find workspace root by searching for .claude directory."""
    current = Path.cwd().resolve()
    for parent in [current, *current.parents]:
        if (parent / ".claude").is_dir():
            return parent
    return current


BACKLOG_REL_PATH = ".claude/state/curation/wiki_maintenance_backlog.json"

COMPLETION_PATTERNS = [
    r"\[SHEBANG\]\s*Complete",
    r"plans/completed/",
    r"\[EXECUTE\]\s*Complete",
    r"Plan execution complete",
]


def _get_pending_count(repo_root: Path) -> int:
    """Count pending items in the wiki maintenance backlog."""
    backlog_path = repo_root / BACKLOG_REL_PATH
    if not backlog_path.exists():
        return 0
    try:
        backlog = json.loads(backlog_path.read_text(encoding="utf-8"))
        pending: List[Dict[str, Any]] = [
            item for item in backlog.get("items", []) if item.get("status") == "pending"
        ]
        return len(pending)
    except (json.JSONDecodeError, KeyError):
        return 0


def _is_workflow_completion(tool_result: str) -> bool:
    """Check if tool result indicates workflow completion."""
    for pattern in COMPLETION_PATTERNS:
        if re.search(pattern, tool_result, re.IGNORECASE):
            return True
    return False


def main() -> None:
    """Main entry point for the PostToolUse hook."""
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse"}}))
        return

    tool_result = input_data.get("tool_result", {})
    if isinstance(tool_result, dict):
        result_text = tool_result.get("stdout", "") + tool_result.get("stderr", "")
    elif isinstance(tool_result, str):
        result_text = tool_result
    else:
        result_text = str(tool_result)

    output: Dict[str, Any] = {"hookSpecificOutput": {"hookEventName": "PostToolUse"}}

    if _is_workflow_completion(result_text):
        repo_root = _find_workspace_root()
        pending_count = _get_pending_count(repo_root)
        if pending_count > 0:
            output["hookSpecificOutput"]["additionalContext"] = (
                f"WIKI SWEEP AVAILABLE: {pending_count} pending wiki maintenance "
                f"entries detected after workflow completion. "
                f"Run `wiki_cli.py maintain --process-pending` to process."
            )

    print(json.dumps(output))


if __name__ == "__main__":
    main()
