#!/usr/bin/env python3
"""4-stage learning loop: detect errors -> detect fixes -> prompt loop completion -> promote prevention.

Stage 1 (Detection): Fires on PostToolUseFailure/Bash - matches stderr/stdout against
    error_patterns.json. Known errors get fix injection; unknown errors logged.
Stage 2 (Fix Detection): Fires on PostToolUse/Edit|Write - if within 120s of a Bash
    failure, marks awaiting_loop_completion in last_failure.json.
Stage 3 (Loop Completion): On any PostToolUse when awaiting_loop_completion is true,
    prompts agent to complete the learning loop (add pattern, grep for siblings, fix all).
Stage 4 (Prevention Promotion): During Stage 1, escalates patterns with high hit_count
    that still lack preventive hooks.
"""
import hashlib
import io
import json
import os
import re
import select
import sys
import time
from datetime import datetime, timezone

UNKNOWN_ERRORS_MAX = 100
UNKNOWN_ERRORS_RETENTION_DAYS = 30
UNKNOWN_ERROR_DEDUPE_WINDOW_HOURS = 24

# Benign patterns that are normal tool usage, not real errors
BENIGN_PATTERNS = [
    r"^\s*diff\b",
    r"^\s*head\b",
    r"^\s*tail\b",
    r"^\s*ls\b",
    r"^\s*test\b",
    r"^\s*\[",
    r"^\s*cat\b.*\|\|",
    r"^\s*source\b",
    r"No such file or directory",
]

REAL_ERROR_KEYWORDS = ["Error", "Exception", "FATAL", "CRITICAL", "Errno", "denied", "refused"]


def load_json(path, default=None):
    """Load JSON file, returning default on missing or corrupt file."""
    if default is None:
        default = {}
    if os.path.exists(path):
        try:
            with open(path) as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return default


def save_json(path, data):
    """Write JSON file, creating parent directories as needed."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def _parse_iso8601(value: str):
    """Parse ISO8601 timestamps safely."""
    if not value or not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _unknown_error_fingerprint(command: str, output_snippet: str) -> str:
    """Stable fingerprint for deduping repeated unknown errors."""
    seed = f"{command.strip().lower()}|{output_snippet.strip().lower()}"
    return hashlib.sha1(seed.encode("utf-8")).hexdigest()


def _prune_unknown_errors(entries):
    """Normalize + prune stale unknown error entries."""
    now = datetime.now(timezone.utc)
    pruned = []

    for entry in entries:
        if not isinstance(entry, dict):
            continue

        timestamp = entry.get("timestamp") or entry.get("last_seen")
        parsed_ts = _parse_iso8601(timestamp)
        if parsed_ts is None:
            continue

        is_classified = bool(entry.get("classified", False))
        age_days = (now - parsed_ts).days
        if not is_classified and age_days > UNKNOWN_ERRORS_RETENTION_DAYS:
            continue

        command = str(entry.get("command", ""))[:500]
        output_snippet = str(entry.get("output_snippet", ""))[:500]

        normalized = dict(entry)
        normalized["command"] = command
        normalized["output_snippet"] = output_snippet
        normalized["timestamp"] = timestamp
        normalized["first_seen"] = entry.get("first_seen", timestamp)
        normalized["last_seen"] = entry.get("last_seen", timestamp)
        normalized["hit_count"] = max(1, int(entry.get("hit_count", 1)))
        normalized["fingerprint"] = entry.get(
            "fingerprint",
            _unknown_error_fingerprint(command, output_snippet),
        )
        pruned.append(normalized)

    def _sort_key(item):
        parsed = _parse_iso8601(item.get("last_seen") or item.get("timestamp") or "")
        return parsed or datetime.min.replace(tzinfo=timezone.utc)

    pruned.sort(key=_sort_key, reverse=True)
    return pruned[:UNKNOWN_ERRORS_MAX]


def get_output_text(result):
    """Extract searchable text from tool result for pattern matching."""
    parts = []
    for key in ("stdout", "stderr", "content"):
        val = result.get(key, "")
        if isinstance(val, str) and val:
            parts.append(val)
    return "\n".join(parts)


def _is_benign_failure(command: str, output_text: str, exit_code: int) -> bool:
    """Check if this failure is benign normal tool usage."""
    for bp in BENIGN_PATTERNS:
        try:
            if re.search(bp, command.strip(), re.IGNORECASE):
                return True
        except re.error:
            pass

    has_real_error_keyword = any(kw in output_text for kw in REAL_ERROR_KEYWORDS)
    if (
        exit_code == 1
        and len(output_text.strip()) < 80
        and not output_text.strip().startswith("Traceback")
        and not has_real_error_keyword
    ):
        return True

    return False


def main() -> None:
    # CLI mode support
    try:
        stdin_has_data = select.select([sys.stdin], [], [], 0.0)[0]
    except (OSError, io.UnsupportedOperation):
        stdin_has_data = True  # Assume data for testing with StringIO
    if not stdin_has_data:
        input_data = {
            "tool_name": "CLI",
            "hook_event_name": "CLIInvocation",
            "tool_input": {},
            "tool_result": {},
        }
    else:
        try:
            input_data = json.load(sys.stdin)
        except Exception:
            sys.exit(0)

    tool_name = input_data.get("tool_name", "")
    hook_event = input_data.get("hook_event_name", "")
    tool_input = input_data.get("tool_input", {})
    tool_result = input_data.get("tool_result", {})

    workspace = os.environ.get("CLAUDE_PROJECT_DIR", "")
    if not workspace:
        sys.exit(0)

    config_dir = os.path.join(workspace, ".harness", "config")
    state_dir = os.path.join(workspace, ".harness", "state")

    error_patterns_path = os.path.join(config_dir, "error_patterns.json")
    unknown_errors_path = os.path.join(config_dir, "unknown_errors.json")
    last_failure_path = os.path.join(state_dir, "last_failure.json")

    os.makedirs(state_dir, exist_ok=True)

    context_parts = []
    _just_set_awaiting = False

    # STAGE 1: Error Detection (fires on Bash failure)
    if hook_event == "PostToolUseFailure" and tool_name == "Bash":
        output_text = get_output_text(tool_result)
        command = tool_input.get("command", "")
        exit_code = tool_result.get("exit_code", 1)

        if _is_benign_failure(command, output_text, exit_code):
            sys.exit(0)

        search_text = output_text + "\n" + command

        patterns_data = load_json(error_patterns_path, {"patterns": []})
        patterns = patterns_data.get("patterns", [])

        matched = False
        for pattern in patterns:
            regex = pattern.get("regex", "")
            if not regex:
                continue
            try:
                if re.search(regex, search_text, re.IGNORECASE | re.MULTILINE):
                    pattern["last_hit"] = datetime.now(timezone.utc).isoformat()
                    pattern["hit_count"] = pattern.get("hit_count", 0) + 1

                    fix_text = (
                        f"KNOWN ERROR DETECTED: {pattern.get('name', 'unknown')} "
                        f"[{pattern.get('id', '???')}]\n"
                        f"Fix: {pattern.get('fix', 'See error_patterns.json')}"
                    )

                    hit_count = pattern["hit_count"]
                    has_preventive = pattern.get("has_preventive_hook", False)
                    if hit_count >= 5 and not has_preventive:
                        fix_text += (
                            f"\n\nCRITICAL: This error has recurred {hit_count} times. "
                            "The learning loop is not closing. Add a preventive check."
                        )
                    elif hit_count >= 3 and not has_preventive:
                        fix_text += (
                            f"\n\nNOTE: This error has recurred {hit_count} times. "
                            "Consider adding a preventive check."
                        )

                    context_parts.append(fix_text)
                    matched = True
                    break
            except re.error:
                continue

        save_json(error_patterns_path, patterns_data)

        if not matched:
            now_iso = datetime.now(timezone.utc).isoformat()
            command_snippet = command[:500]
            output_snippet = output_text[:500]
            fingerprint = _unknown_error_fingerprint(command_snippet, output_snippet)

            unknown_errors = load_json(unknown_errors_path, [])
            if not isinstance(unknown_errors, list):
                unknown_errors = []
            unknown_errors = _prune_unknown_errors(unknown_errors)

            dedupe_window_seconds = UNKNOWN_ERROR_DEDUPE_WINDOW_HOURS * 3600
            merged = False
            for entry in unknown_errors:
                if entry.get("classified", False):
                    continue
                if entry.get("fingerprint") != fingerprint:
                    continue

                last_seen = _parse_iso8601(entry.get("last_seen") or entry.get("timestamp") or "")
                if last_seen is None:
                    continue
                elapsed_seconds = (datetime.now(timezone.utc) - last_seen).total_seconds()
                if elapsed_seconds > dedupe_window_seconds:
                    continue

                entry["last_seen"] = now_iso
                entry["timestamp"] = now_iso
                entry["hit_count"] = int(entry.get("hit_count", 1)) + 1
                merged = True
                break

            if not merged:
                unknown_errors.append(
                    {
                        "timestamp": now_iso,
                        "first_seen": now_iso,
                        "last_seen": now_iso,
                        "command": command_snippet,
                        "exit_code": tool_result.get("exit_code", 1),
                        "output_snippet": output_snippet,
                        "file_context": tool_input.get("description", ""),
                        "classified": False,
                        "hit_count": 1,
                        "fingerprint": fingerprint,
                    }
                )

            unknown_errors = _prune_unknown_errors(unknown_errors)
            save_json(unknown_errors_path, unknown_errors)

        save_json(
            last_failure_path,
            {
                "timestamp": time.time(),
                "command": command[:500],
                "output_snippet": output_text[:300],
                "awaiting_loop_completion": False,
            },
        )

    # STAGE 2: Fix Detection (fires on Edit/Write after recent Bash failure)
    elif hook_event == "PostToolUse" and tool_name in ("Edit", "Write"):
        last_failure = load_json(last_failure_path)

        if last_failure and not last_failure.get("awaiting_loop_completion", False):
            failure_time = last_failure.get("timestamp", 0)
            elapsed = time.time() - failure_time

            if 0 < elapsed < 120:
                last_failure["awaiting_loop_completion"] = True
                last_failure["fix_detected_at"] = time.time()
                last_failure["fix_tool"] = tool_name
                last_failure["fix_file"] = tool_input.get("file_path", "")
                save_json(last_failure_path, last_failure)
                _just_set_awaiting = True

    # STAGE 2 (alt): Fix Detection via Bash rerun after failure
    elif hook_event == "PostToolUse" and tool_name == "Bash":
        last_failure = load_json(last_failure_path)

        if last_failure and not last_failure.get("awaiting_loop_completion", False):
            failure_time = last_failure.get("timestamp", 0)
            elapsed = time.time() - failure_time

            exit_code = tool_result.get("exit_code", -1)
            if 0 < elapsed < 120 and exit_code == 0:
                last_failure["awaiting_loop_completion"] = True
                last_failure["fix_detected_at"] = time.time()
                last_failure["fix_tool"] = "Bash (successful rerun)"
                save_json(last_failure_path, last_failure)
                _just_set_awaiting = True

    # STAGE 3: Loop Completion Prompt
    last_failure = load_json(last_failure_path)
    if last_failure.get("awaiting_loop_completion", False) and not _just_set_awaiting:
        failed_command = last_failure.get("command", "<unknown>")
        error_snippet = last_failure.get("output_snippet", "")

        base_message = (
            "LEARNING LOOP: You just fixed an error. Complete these steps:\n"
            "1. Add this error+fix to .harness/config/error_patterns.json "
            "(with regex pattern + fix text)\n"
            "2. Search the codebase for the same pattern\n"
            "3. Fix all other occurrences found\n"
            "4. If this error has occurred 3+ times, add a preventive check\n"
            f"\nOriginal failed command: {failed_command[:200]}\n"
            f"Error snippet: {error_snippet[:200]}"
        )

        context_parts.append(base_message)

        last_failure["awaiting_loop_completion"] = False
        last_failure["loop_prompted_at"] = time.time()
        save_json(last_failure_path, last_failure)

    # Output
    if context_parts:
        output = {
            "hookSpecificOutput": {
                "hookEventName": hook_event,
                "additionalContext": "\n\n".join(context_parts),
            }
        }
        print(json.dumps(output))

    sys.exit(0)


if __name__ == "__main__":
    main()
