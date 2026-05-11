#!/usr/bin/env python3
"""Block destructive git and filesystem commands that are hard to reverse.

PreToolUse hook that blocks dangerous operations:
- Force push and force-related git operations
- Hard reset and clean operations
- Destructive rm commands outside safe paths
"""
import io
import json
import os
import re
import select
import sys


def _load_safe_paths(workspace: str) -> list:
    """Load safe cleanup paths from config or return defaults."""
    config_path = os.path.join(workspace, ".harness", "config", "safe_cleanup_paths.json")
    try:
        with open(config_path) as f:
            data = json.load(f)
            return data.get("paths", ["/tmp/"])
    except (FileNotFoundError, json.JSONDecodeError, KeyError):
        return ["/tmp/"]


def main() -> None:
    # CLI mode support: check if stdin has data
    try:
        stdin_has_data = select.select([sys.stdin], [], [], 0.0)[0]
    except (OSError, io.UnsupportedOperation):
        stdin_has_data = True
    if not stdin_has_data:
        sys.exit(0)

    try:
        input_data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    if input_data.get("tool_name") != "Bash":
        sys.exit(0)

    command = input_data.get("tool_input", {}).get("command", "")
    workspace = os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd())
    safe_paths = _load_safe_paths(workspace)

    # Destructive patterns to block
    destructive_patterns = [
        (r"\bgit\s+push\s+.*--force\b", "git push --force can overwrite upstream history"),
        (r"\bgit\s+push\s+-f\b", "git push -f can overwrite upstream history"),
        (r"\bgit\s+reset\s+--hard\b", "git reset --hard discards all uncommitted changes"),
        (r"\bgit\s+clean\s+-f\b", "git clean -f permanently deletes untracked files"),
        (r"\bgit\s+branch\s+-D\b", "git branch -D force-deletes a branch without merge check"),
        (r"\bgit\s+checkout\s+\.\s*$", "git checkout . discards all unstaged changes"),
        (r"\brm\s+-rf\s+/", "rm -rf on root paths is extremely dangerous"),
    ]

    for pattern, reason in destructive_patterns:
        if re.search(pattern, command):
            # Allow rm -rf when ALL targets are under safe cleanup paths
            if pattern == r"\brm\s+-rf\s+/":
                rm_targets = re.findall(r"/\S+", command)
                if rm_targets and all(
                    any(t.startswith(safe) for safe in safe_paths) for t in rm_targets
                ):
                    continue  # safe cleanup, allow

            print(
                f"BLOCKED: {reason}. This action is irreversible and requires "
                "explicit user confirmation.",
                file=sys.stderr,
            )
            sys.exit(2)

    sys.exit(0)


if __name__ == "__main__":
    main()
