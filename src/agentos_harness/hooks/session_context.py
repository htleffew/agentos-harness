#!/usr/bin/env python3
"""Re-inject harness operating context after session compaction.

Also provides wiki/skill consultation at session start to enforce the
discipline of checking existing knowledge before starting work.
"""

from __future__ import annotations

import json
import os
import re
import select
import sys
from pathlib import Path


def _load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except Exception:
        return {}


def _detect_relevant_skills(project_dir: Path, context_hints: list[str]) -> list[str]:
    """Detect skills that might be relevant based on context hints."""
    skills_dir = project_dir / ".claude" / "skills"
    if not skills_dir.exists():
        return []

    relevant: list[str] = []
    hint_patterns = [h.lower() for h in context_hints if h]

    for skill_path in sorted(skills_dir.iterdir()):
        if not skill_path.is_dir():
            continue
        skill_md = skill_path / "SKILL.md"
        if not skill_md.exists():
            continue

        try:
            content = skill_md.read_text(encoding="utf-8", errors="replace").lower()
            skill_name = skill_path.name

            # Check if any hint pattern matches the skill content or name
            for hint in hint_patterns:
                if hint in content or hint in skill_name:
                    relevant.append(skill_name)
                    break
        except Exception:
            continue

    return relevant[:5]  # Limit to top 5


def _detect_relevant_wiki_pages(project_dir: Path, context_hints: list[str]) -> list[str]:
    """Detect wiki pages that might be relevant based on context hints."""
    wiki_dir = project_dir / ".claude" / "wiki" / "wiki"
    if not wiki_dir.exists():
        return []

    relevant: list[str] = []
    hint_patterns = [h.lower() for h in context_hints if h]

    for wiki_file in sorted(wiki_dir.rglob("*.md")):
        try:
            content = wiki_file.read_text(encoding="utf-8", errors="replace").lower()
            rel_path = wiki_file.relative_to(wiki_dir)

            for hint in hint_patterns:
                if hint in content or hint in str(rel_path):
                    relevant.append(str(rel_path))
                    break
        except Exception:
            continue

    return relevant[:5]  # Limit to top 5


def _extract_context_hints(project_dir: Path) -> list[str]:
    """Extract context hints from active plans and recent work."""
    hints: list[str] = []

    # Check active plan names
    plan_dirs = [project_dir / ".claude" / "state" / "plans" / "active"]
    projects_dir = project_dir / "projects"
    if projects_dir.exists():
        for p in sorted(projects_dir.iterdir()):
            candidate = p / "internal" / "plans" / "active"
            if candidate.exists():
                plan_dirs.append(candidate)
            candidate2 = p / "plans" / "active"
            if candidate2.exists():
                plan_dirs.append(candidate2)

    for plan_dir in plan_dirs:
        if not plan_dir.exists():
            continue
        for plan_file in sorted(plan_dir.glob("*.md")):
            # Extract keywords from plan name
            name = plan_file.stem.lower()
            # Split on underscores and hyphens
            parts = re.split(r"[_-]", name)
            hints.extend(p for p in parts if len(p) > 3)

    # Check for project names
    if projects_dir.exists():
        for p in sorted(projects_dir.iterdir()):
            if p.is_dir() and not p.name.startswith("."):
                hints.append(p.name.lower())

    return list(set(hints))[:10]


def main() -> None:
    if not select.select([sys.stdin], [], [], 0.0)[0]:
        return

    try:
        event = json.load(sys.stdin)
    except Exception:
        return

    project_dir = Path(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()).resolve()
    source = event.get("source", "")

    # Load basic harness state
    setup = _load_json(project_dir / ".harness" / "state" / "setup.json")
    tier = setup.get("moe_tier", "unknown")
    version = setup.get("profile_version", "unknown")

    analysis = _load_json(project_dir / ".harness" / "state" / "analysis.json")
    display_name = (analysis.get("workspace") or {}).get("display_name", "this repository")

    # Count wiki pages
    index_path = project_dir / ".claude" / "wiki" / "index.md"
    wiki_count = 0
    if index_path.exists():
        content = index_path.read_text(encoding="utf-8", errors="replace")
        wiki_count = sum(1 for line in content.splitlines() if line.strip().startswith("- ["))

    # Count pending reminders
    reminders_path = project_dir / ".harness" / "state" / "wiki_reminders.jsonl"
    pending_count = 0
    if reminders_path.exists():
        unique_paths: set[str] = set()
        for line in reminders_path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                unique_paths.add(entry.get("source_path", ""))
            except Exception:
                pass
        pending_count = len(unique_paths)

    # Detect active plans
    plan_dirs = [project_dir / ".claude" / "state" / "plans" / "active"]
    projects_dir = project_dir / "projects"
    if projects_dir.exists():
        for p in sorted(projects_dir.iterdir()):
            candidate = p / "internal" / "plans" / "active"
            if candidate.exists():
                plan_dirs.append(candidate)
            candidate2 = p / "plans" / "active"
            if candidate2.exists():
                plan_dirs.append(candidate2)

    plan_names: list[str] = []
    for plan_dir in plan_dirs:
        if not plan_dir.exists():
            continue
        for plan_file in sorted(plan_dir.glob("*.md")):
            if len(plan_names) >= 3:
                break
            plan_names.append(plan_file.stem)

    active_plans = ", ".join(plan_names) if plan_names else "none detected"

    # For compact events, provide recovery context
    if source == "compact":
        sys.stdout.write(
            "HARNESS CONTEXT (post-compact):\n"
            f"- Repository: {display_name} | MoE tier: {tier} | Profile: core {version}\n"
            f"- Wiki: {wiki_count} indexed pages -- read .claude/wiki/index.md before wiki writes\n"
            f"- Wiki reminders: {pending_count} pending -- address with /wiki\n"
            f"- Active plans: {active_plans}\n"
            "- Commit gate: present staged files and message to human before git commit\n"
            "- Skill guard: run harness audit after any SKILL.md edit\n"
        )
        return

    # For all session starts: wiki/skill consultation reminder
    # Only output if there are meaningful resources to consult
    if wiki_count == 0:
        return  # No wiki pages to consult

    # Extract context hints from current work state
    context_hints = _extract_context_hints(project_dir)

    # Detect relevant resources
    relevant_skills = _detect_relevant_skills(project_dir, context_hints)
    relevant_wiki = _detect_relevant_wiki_pages(project_dir, context_hints)

    # Build consultation message. A session-start hook has no user task text,
    # so it must not invent a project assignment from active plan names alone.
    lines = ["BEFORE STARTING WORK:"]
    lines.append("- Context-Receipt: session-start hook")
    lines.append(f"- Wiki-Index: .claude/wiki/index.md present ({wiki_count} pages)")
    lines.append("- Skill-Index: .claude/skills/ present" if (project_dir / ".claude" / "skills").exists() else "- Skill-Index: N/A because .claude/skills/ is absent")

    if relevant_wiki:
        lines.append(f"- Wiki pages possibly relevant: {', '.join(relevant_wiki)}")

    if relevant_skills:
        lines.append(f"- Skills-Selected: {', '.join(relevant_skills)}")
    else:
        lines.append("- Skills-Selected: N/A because no task-specific skill matched")

    if plan_names:
        lines.append(f"- Active plans: {active_plans}")

    lines.append("- Project-Continuity: N/A because no task or project path was supplied")
    lines.append("- Source-Artifacts: N/A because no source path was supplied")
    lines.append("- Validators-Planned: N/A until a task changes files")

    # Load discipline settings
    discipline = _load_json(project_dir / ".harness" / "config" / "discipline.json")
    if discipline.get("loop_as_default"):
        lines.append("- Loop-as-default is ON: continue with /loop until 100% complete")

    sys.stdout.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
