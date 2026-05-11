#!/usr/bin/env python3
"""PostToolUse hook: append a structured JSONL entry to .harness/state/activity.jsonl.

Records: timestamp, tool_name, success/failure, brief description.
Keeps entries compact (one line per event).
"""
import io
import json
import os
import select
import sys
from datetime import datetime, timezone


def _build_description(tool_name: str, tool_input: dict) -> str:
    """Build a compact description from tool input."""
    if tool_name == "Bash":
        cmd = tool_input.get("command", "")
        if len(cmd) > 80:
            return cmd[:77] + "..."
        return cmd

    if tool_name in ("Read", "Write", "Edit"):
        fp = tool_input.get("file_path", "")
        if fp:
            return os.path.basename(fp)
        return tool_name

    if tool_name in ("Glob", "Grep"):
        pattern = tool_input.get("pattern", "")
        if pattern and len(pattern) > 60:
            return pattern[:57] + "..."
        return pattern or tool_name

    if tool_name == "Task":
        return tool_input.get("description", "agent task")[:80]

    return tool_name


def main() -> None:
    # CLI mode support
    try:
        stdin_has_data = select.select([sys.stdin], [], [], 0.0)[0]
    except (OSError, io.UnsupportedOperation):
        stdin_has_data = True
    if not stdin_has_data:
        sys.exit(0)

    # Hook mode - read event from stdin
    try:
        hook_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        sys.exit(0)

    workspace = os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd())

    # Extract tool info from hook event data
    tool_name = hook_data.get("tool_name", "unknown")
    hook_event = hook_data.get("hook_event_name", "")
    tool_input = hook_data.get("tool_input", {})
    tool_result = hook_data.get("tool_result", {})

    # Determine success/failure
    is_failure = hook_event == "PostToolUseFailure"
    if not is_failure:
        is_failure = bool(tool_result.get("error"))
    success = not is_failure

    # Build brief description
    description = _build_description(tool_name, tool_input)

    # Build the JSONL entry
    entry = {
        "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "tool": tool_name,
        "ok": success,
        "desc": description,
    }

    # Append to activity.jsonl
    activity_path = os.path.join(workspace, ".harness", "state", "activity.jsonl")

    try:
        os.makedirs(os.path.dirname(activity_path), exist_ok=True)
        with open(activity_path, "a") as f:
            f.write(json.dumps(entry, separators=(",", ":")) + "\n")
    except IOError:
        pass  # Silent failure - logging should never block tool use

    sys.exit(0)


if __name__ == "__main__":
    main()
