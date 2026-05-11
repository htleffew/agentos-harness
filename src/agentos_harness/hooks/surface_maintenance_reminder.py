#!/usr/bin/env python3
"""Prompt surface maintenance after significant work chunks.

Fires after Edit/Write operations to detect work completion patterns and remind
the agent to update project continuity surfaces (_UPDATE.md, wiki) with what
was just learned or changed.
"""

from __future__ import annotations

import json
import os
import re
import select
import sys
from datetime import datetime, timezone
from pathlib import Path


WORK_PATTERNS = (
    # Plan chunk completion
    r"<!--\s*WC-\d+:\s*done\s*-->",
    # Function/class additions
    r"def\s+\w+\s*\(",
    r"class\s+\w+",
    # Test additions
    r"def\s+test_\w+",
    # Significant code changes (20+ lines)
)

SIGNIFICANT_PATHS = (
    # Source code
    "src/",
    "lib/",
    "app/",
    # Tests
    "tests/",
    "test/",
    # Scripts
    "scripts/",
    # External deliverables
    "external/",
)


def _load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except Exception:
        return {}


def _find_project_update_file(project_dir: Path, file_path: str) -> str | None:
    """Find the relevant project continuity file for a given file path."""
    # Check if file is in a project directory
    if "projects/" in file_path:
        parts = file_path.split("projects/", 1)[1].split("/", 1)
        if parts:
            for filename in ("UPDATE.txt", "HANDOFF.md"):
                update_file = f"projects/{parts[0]}/{filename}"
                if (project_dir / update_file).exists():
                    return update_file

    # Check for project-level continuity files at repo root
    for filename in ("UPDATE.txt", "HANDOFF.md"):
        if (project_dir / filename).exists():
            return filename
    for item in project_dir.iterdir():
        if item.is_file() and item.name.endswith("_UPDATE.md"):
            return item.name

    return None


def _is_significant_change(file_path: str, content: str | None) -> bool:
    """Determine if this change is significant enough to warrant a reminder."""
    # Check if path is in significant directories
    path_significant = any(sig in file_path for sig in SIGNIFICANT_PATHS)

    # Check if content contains work patterns
    content_significant = False
    if content:
        for pattern in WORK_PATTERNS:
            if re.search(pattern, content):
                content_significant = True
                break
        # Also significant if content is large
        if len(content) > 500:
            content_significant = True

    return path_significant or content_significant


def _append_reminder(project_dir: Path, reminder: dict) -> None:
    """Append a reminder to the surface maintenance log."""
    log_dir = project_dir / ".harness" / "state"
    log_dir.mkdir(parents=True, exist_ok=True)

    log_path = log_dir / "surface_maintenance_reminders.jsonl"
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(reminder) + "\n")


def main() -> int:
    if not select.select([sys.stdin], [], [], 0.0)[0]:
        return 0

    try:
        event = json.load(sys.stdin)
    except Exception:
        return 0

    tool = event.get("tool_name", "")
    tool_input = event.get("tool_input", {})

    # Only fire on Edit and Write operations
    if tool not in ("Edit", "Write"):
        return 0

    file_path = tool_input.get("file_path", "")
    if not file_path:
        return 0

    # Skip if editing the update file itself or wiki
    if "_UPDATE.md" in file_path or file_path.endswith(("UPDATE.txt", "HANDOFF.md")) or ".claude/wiki/" in file_path:
        return 0

    # Skip config and state files
    if ".harness/" in file_path or ".claude/state/" in file_path:
        return 0

    # Get content for significance check
    content = tool_input.get("content") or tool_input.get("new_string", "")

    # Check if this is a significant change
    if not _is_significant_change(file_path, content):
        return 0

    project_dir = Path(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()).resolve()

    # Find relevant update file
    update_file = _find_project_update_file(project_dir, file_path)

    # Check discipline settings
    discipline = _load_json(project_dir / ".harness" / "config" / "discipline.json")

    # Always remind about surface maintenance after significant changes
    reminder = {
        "at": datetime.now(timezone.utc).isoformat(),
        "source_path": file_path,
        "update_file": update_file,
    }
    _append_reminder(project_dir, reminder)

    # Build reminder message
    lines = ["SURFACE MAINTENANCE REMINDER:"]
    lines.append(f"  Significant change to: {file_path}")

    if update_file:
        lines.append(f"  Consider updating: {update_file}")
    else:
        lines.append("  Consider updating the relevant HANDOFF.md or UPDATE.txt file")

    lines.append("  Consider updating: .claude/wiki/ if durable context changed")

    # Check for loop-as-default
    if discipline.get("loop_as_default"):
        lines.append("  Loop-as-default: continue until 100% complete")

    sys.stderr.write("\n".join(lines) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
