#!/usr/bin/env python3
"""Block direct git commit calls and require human approval."""

from __future__ import annotations

import json
import re
import select
import sys

_COMMIT_RE = re.compile(r"\bgit\s+commit\b")
_HELP_RE = re.compile(r"\bgit\s+commit\s+(--help|-h)\b")


def main() -> None:
    if not select.select([sys.stdin], [], [], 0.0)[0]:
        sys.exit(0)

    try:
        event = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    if event.get("tool_name") != "Bash":
        sys.exit(0)

    command = event.get("tool_input", {}).get("command", "")
    if not _COMMIT_RE.search(command):
        sys.exit(0)

    if _HELP_RE.search(command):
        sys.exit(0)

    print(
        "BLOCKED: git commit requires explicit human approval. "
        "Show the human the proposed commit message and the output of "
        "'git status' and 'git diff --staged' first. "
        "The human runs the commit command after reviewing.",
        file=sys.stderr,
    )
    sys.exit(2)


if __name__ == "__main__":
    main()
