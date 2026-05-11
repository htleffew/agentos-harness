#!/usr/bin/env python3
"""SessionStart hook: reset knowledge read tracking for enforcement.

Clears the session state so each new conversation starts fresh,
ensuring agents must re-read knowledge surfaces at session start.
"""

from __future__ import annotations

import json
import os
import select
import sys
from datetime import datetime, timezone
from pathlib import Path


def main() -> None:
    if not select.select([sys.stdin], [], [], 0.0)[0]:
        return

    try:
        json.load(sys.stdin)
    except Exception:
        return

    project_dir = Path(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()).resolve()
    session_state_dir = project_dir / ".harness" / "state" / "session"
    knowledge_reads_file = session_state_dir / "knowledge_reads.json"

    session_state_dir.mkdir(parents=True, exist_ok=True)

    initial_state = {
        "reads": {},
        "session_start": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "tool_count": 0,
        "discipline_acknowledged": False,
    }

    knowledge_reads_file.write_text(
        json.dumps(initial_state, indent=2, sort_keys=True),
        encoding="utf-8"
    )


if __name__ == "__main__":
    main()
