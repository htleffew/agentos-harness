#!/usr/bin/env python3
"""PostToolUse hook: remind to update HANDOFF.md and UPDATE.txt when plans complete."""

from __future__ import annotations

import json
import re
import select
import sys
from datetime import datetime, timezone
from pathlib import Path

_PLAN_COMPLETED_RE = re.compile(r"[/\\]plans[/\\]completed[/\\].+\.md$")
_HANDOFF_PATH_RE = re.compile(r"[A-Z][A-Z0-9-]*-HANDOFF\.md$|(?:^|[/\\])HANDOFF\.md$")


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

    if event.get("tool_name") not in {"Write", "Edit"}:
        sys.exit(0)

    file_path = event.get("tool_input", {}).get("file_path", "")
    if not file_path:
        sys.exit(0)

    normalized = file_path.replace("\\", "/")

    # Skip if the file being written IS a HANDOFF (no recursive reminder)
    if _HANDOFF_PATH_RE.search(normalized):
        sys.exit(0)

    # Only fire when a plan is moved to completed/
    if not _PLAN_COMPLETED_RE.search(normalized):
        sys.exit(0)

    record = {
        "at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "trigger_path": file_path,
        "suggested_action": (
            "A plan was written to completed/. "
            "Update the project HANDOFF.md Current Plan section and append a dated entry to UPDATE.txt."
        ),
    }

    root = _project_root()
    state_dir = root / ".harness" / "state"
    state_dir.mkdir(parents=True, exist_ok=True)

    with (state_dir / "handoff_reminders.jsonl").open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, sort_keys=True) + "\n")

    # Surface the reminder to stdout so it appears in the session
    print(
        f"\nHARNESS: Plan completed ({Path(file_path).name}). "
        "Update HANDOFF.md and UPDATE.txt before closing this work.",
        file=sys.stderr,
    )

    sys.exit(0)


if __name__ == "__main__":
    main()
