#!/usr/bin/env python3
"""Session-start discipline hook: recommend wiki/skill reads before execution.

This hook counters the 'skip reading' instinct by making required reads
explicit and specific to the current task context.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path


def detect_task_context() -> dict:
    """Detect current task type from active plans and git state."""
    project_dir = os.environ.get("CLAUDE_PROJECT_DIR", "")
    if not project_dir:
        return {"type": "unknown", "hints": []}

    root = Path(project_dir)
    context = {"type": "general", "hints": []}

    active_plans_dir = root / ".claude/state/plans/active"
    if active_plans_dir.exists():
        for plan in active_plans_dir.glob("*.md"):
            context["hints"].append(f"active_plan:{plan.name}")

    try:
        recent_files = subprocess.run(
            ["git", "-C", project_dir, "diff", "--name-only", "HEAD~5", "HEAD"],
            capture_output=True, text=True, timeout=5
        ).stdout.strip().split("\n")

        for f in recent_files[:10]:
            if ".claude/wiki/" in f:
                context["type"] = "wiki_work"
            if ".claude/skills/" in f:
                context["type"] = "skill_work"
            if ".ipynb" in f:
                context["type"] = "research"
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass

    return context


def build_discipline_reminder(context: dict) -> str:
    """Build task-specific read recommendations."""
    project_dir = os.environ.get("CLAUDE_PROJECT_DIR", "")
    root = Path(project_dir) if project_dir else Path.cwd()

    lines = ["DISCIPLINE CHECK: Before starting, read:"]
    reads = []

    reads.append(".claude/wiki/index.md")

    if context.get("type") == "wiki_work":
        wiki_skill = root / ".claude/skills/maintaining-wiki/SKILL.md"
        if wiki_skill.exists():
            reads.append(".claude/skills/maintaining-wiki/SKILL.md")

    if context.get("type") == "research":
        reads.append("any research protocol references in your skill files")

    if context.get("hints"):
        lines.append("")
        lines.append("For execution tasks, first run:")
        lines.append("  grep -r 'pattern' .claude/skills/*/scripts/")

    seen = set()
    unique_reads = []
    for r in reads:
        if r not in seen:
            seen.add(r)
            unique_reads.append(r)

    for r in unique_reads:
        lines.append(f"  - {r}")

    lines.append("")
    lines.append("Codex Context Receipt:")
    lines.append("  - Context-Receipt: session-start discipline hook")
    lines.append("  - Wiki-Index: .claude/wiki/index.md")
    lines.append("  - Skill-Index: .claude/skills/ present" if (root / ".claude/skills").exists() else "  - Skill-Index: N/A because .claude/skills/ is absent")
    lines.append("  - Skills-Selected: N/A until a task-specific skill is selected")
    lines.append("  - Project-Continuity: N/A because no task or project path was supplied")
    lines.append("  - Source-Artifacts: N/A because no source path was supplied")
    lines.append("  - Validators-Planned: N/A until a task changes files")

    return "\n".join(lines)


def main() -> int:
    """Output discipline reminder at session start."""
    context = detect_task_context()

    if context["type"] == "unknown" and not context.get("hints"):
        return 0

    reminder = build_discipline_reminder(context)

    output = {
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": reminder
        }
    }

    print(json.dumps(output))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
