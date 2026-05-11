#!/usr/bin/env python3
"""PostToolUse hook: model-aware loop detection with escalating recovery messages.

Detects five loop types:
- REPEATED_ACTION: same tool+args 3 times in a row
- REPEATED_FAILURE: same error 3+ times in 5 minutes
- NO_PROGRESS: file status hash unchanged for 10 tool calls
- CIRCULAR_PLAN: same file+args 5+ times in window
- REPEATED_OUTPUT: output hash matches older entry 3 times

Model-aware patience limits:
- opus: 1 (trigger immediately)
- sonnet: 2 (trigger on second occurrence)
- other: 4 (trigger on fourth occurrence)
"""
import collections
import hashlib
import io
import json
import os
import select
import subprocess
import sys
import uuid
from datetime import datetime, timezone

_STATE_FILE_NAME = "doom_loop_window.json"
_WINDOW_MAX = 20
_RECOVERY_MESSAGES = {
    1: lambda t: json.dumps(
        {"additionalContext": f"WARNING: Possible loop detected ({t}). Try a different approach."}
    ),
    2: lambda _: json.dumps(
        {
            "additionalContext": (
                "STOP. Describe what you have tried and what is not working."
                " Then try a completely different approach."
            )
        }
    ),
    4: lambda t: json.dumps(
        {
            "additionalContext": (
                f"STOP. Agent stalled: {t}. Human intervention required."
            ),
        }
    ),
}


def _patience_limit(model: str) -> int:
    """Return patience limit based on model capability."""
    if "opus" in model:
        return 1
    if "sonnet" in model:
        return 2
    return 4


def _get_session_id() -> str:
    """Get session ID from environment or generate one."""
    return os.environ.get("CLAUDE_SESSION_ID") or str(uuid.uuid4())


def _load_state(state_path: str) -> dict:
    """Load state from JSON file."""
    try:
        with open(state_path) as f:
            return json.load(f)
    except Exception:
        return {}


def _save_state(state_path: str, state: dict) -> None:
    """Save state to JSON file."""
    try:
        os.makedirs(os.path.dirname(state_path), exist_ok=True)
        with open(state_path, "w") as f:
            json.dump(state, f)
    except Exception:
        pass


def _file_status_hash(workspace: str) -> str:
    """Get hash of git status to detect progress."""
    try:
        result = subprocess.run(
            ["git", "-C", workspace, "status", "--porcelain"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        return hashlib.md5(result.stdout.encode()).hexdigest()[:8]
    except Exception:
        return "unknown"


def _extract_error(tool_result) -> str:
    """Extract error message from tool result."""
    if isinstance(tool_result, dict):
        return str(tool_result.get("error", ""))
    s = str(tool_result or "")
    if s.startswith("Error"):
        return s
    return ""


def _extract_file_path(tool_input: dict) -> str:
    """Extract file path from tool input."""
    return tool_input.get("file_path") or tool_input.get("path") or ""


def _check_repeated_action(window: list) -> bool:
    """Check if same tool+args called 3 times in a row."""
    if len(window) < 3:
        return False
    last = window[-3:]
    key = (last[0]["tool"], last[0]["args_hash"])
    return all((e["tool"], e["args_hash"]) == key for e in last)


def _check_repeated_failure(window: list) -> bool:
    """Check if same error occurred 3+ times in last 5 minutes."""
    now = datetime.now(timezone.utc)
    cutoff = now.timestamp() - 300
    recent = []
    for e in window:
        try:
            ts = datetime.fromisoformat(e["timestamp"].replace("Z", "+00:00"))
            if ts.timestamp() >= cutoff and e.get("error"):
                recent.append(e["error"][:50])
        except Exception:
            pass
    if len(recent) < 3:
        return False
    first = recent[0]
    return sum(1 for r in recent if r == first) >= 3


def _check_no_progress(window: list) -> bool:
    """Check if file status unchanged for 10 tool calls."""
    if len(window) < 10:
        return False
    last10 = window[-10:]
    hashes = [e.get("file_status_hash", "") for e in last10]
    return len(set(hashes)) == 1 and hashes[0] != "unknown"


def _check_circular_plan(window: list) -> bool:
    """Check if same file+args occurred 5+ times in window."""
    counts: dict = {}
    for e in window:
        fp = e.get("file_path", "")
        if not fp:
            continue
        ch = e.get("args_hash", "")
        key = (fp, ch)
        counts[key] = counts.get(key, 0) + 1
        if counts[key] >= 5:
            return True
    return False


def _check_repeated_output(window: list) -> bool:
    """Check if recent output matches older output."""
    if len(window) < 10:
        return False
    last3 = [e.get("output_hash", "") for e in window[-3:]]
    older = [e.get("output_hash", "") for e in window[-10:-3]]
    for h in last3:
        if h and h in older:
            return True
    return False


def main() -> None:
    try:
        try:
            stdin_has_data = select.select([sys.stdin], [], [], 0.0)[0]
        except (OSError, io.UnsupportedOperation):
            stdin_has_data = True
        if not stdin_has_data:
            sys.exit(0)

        try:
            hook_data = json.load(sys.stdin)
        except Exception:
            sys.exit(0)

        workspace = os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd())
        state_dir = os.path.join(workspace, ".harness", "state")
        state_path = os.path.join(state_dir, _STATE_FILE_NAME)

        session_id = _get_session_id()
        state = _load_state(state_path)

        raw_window = state.get("window", [])
        window = collections.deque(raw_window, maxlen=_WINDOW_MAX)
        step_counts: dict = state.get("step_counts", {})

        tool_name = hook_data.get("tool_name", "")
        tool_input = hook_data.get("tool_input", {}) or {}
        tool_result = hook_data.get("tool_result", {})

        args_hash = hashlib.md5(
            json.dumps(tool_input, sort_keys=True).encode()
        ).hexdigest()[:8]
        output_hash = hashlib.md5(str(tool_result).encode()).hexdigest()[:8]
        file_status_hash = _file_status_hash(workspace)
        error = _extract_error(tool_result)
        file_path = _extract_file_path(tool_input)
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        entry = {
            "tool": tool_name,
            "args_hash": args_hash,
            "output_hash": output_hash,
            "file_status_hash": file_status_hash,
            "file_path": file_path,
            "timestamp": ts,
            "error": error,
        }
        window.append(entry)
        window_list = list(window)

        model = os.environ.get("CLAUDE_MODEL", "sonnet").lower()
        patience = _patience_limit(model)

        detection_type = None

        if _check_repeated_action(window_list):
            detection_type = "REPEATED_ACTION"
        elif _check_repeated_failure(window_list):
            detection_type = "REPEATED_FAILURE"
        elif _check_no_progress(window_list):
            detection_type = "NO_PROGRESS"
        elif _check_circular_plan(window_list):
            detection_type = "CIRCULAR_PLAN"
        elif _check_repeated_output(window_list):
            detection_type = "REPEATED_OUTPUT"

        if detection_type:
            session_counts = step_counts.setdefault(session_id, {})
            session_counts[detection_type] = session_counts.get(detection_type, 0) + 1
            step = session_counts[detection_type]

            if step >= patience:
                msg = _RECOVERY_MESSAGES[4](detection_type)
                print(msg)
            elif step == 3 and patience == 4:
                msg = json.dumps(
                    {
                        "additionalContext": (
                            f"STOP. Agent stalled: {detection_type}."
                            " Human intervention required."
                        ),
                    }
                )
                print(msg)
            elif step == 2:
                print(_RECOVERY_MESSAGES[2](detection_type))
            else:
                print(_RECOVERY_MESSAGES[1](detection_type))

        new_state = {
            "session_id": session_id,
            "window": window_list,
            "step_counts": step_counts,
        }
        _save_state(state_path, new_state)

    except Exception:
        pass

    sys.exit(0)


if __name__ == "__main__":
    main()
