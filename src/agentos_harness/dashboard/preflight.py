"""Preflight preamble builder — §5 of AGENTIC-OS-DASHBOARD-SPEC.md.

Builds the context-receipt preamble prepended to every dashboard-dispatched
prompt so that knowledge_preflight_guard.py does not block the session.

Sections:
  §5.1  Base preamble (all agents): 4 required surfaces
  §5.1  Codex-tier addition: surface 5 (CODEX.md)
  §5.2  Project-scoped extension: HANDOFF.md + project wiki page
  §5.3  Skill-scoped extension: SKILL.md + SKILL_STANDARDS.md
  §9.2  Output format requirement appended to every run
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

Agent = Literal["claude", "codex", "gemini"]

# ── §5.1 Base surfaces ────────────────────────────────────────────────────────

_BASE_SURFACES = [
    ("wiki_index", ".claude/wiki/index.md"),
    ("agents_md", "AGENTS.md"),
    ("claude_md", "CLAUDE.md"),
    ("skills_index", ".claude/skills.json"),
]

_CODEX_SURFACE = ("codex_md", "CODEX.md")

# ── §9.2 Output format requirement ────────────────────────────────────────────

_OUTPUT_FORMAT = """
Format your final response with these sections:

## OUTPUT
(the substantive result)

## SOURCES
(URLs used, one per line, prefixed with ·)

## FILE
(path where output was saved, if applicable)
"""

# ── Public API ────────────────────────────────────────────────────────────────


def build_preamble(
    *,
    agent: Agent,
    skill_prompt: str,
    project: str | None = None,
    skill_name: str | None = None,
    workspace: Path | None = None,
) -> str:
    """Build the full dispatched prompt for a dashboard session.

    Args:
        agent:        Dispatched agent CLI ("claude", "codex", or "gemini").
        skill_prompt: The skill's own content / task description.
        project:      Project name for project-scoped preamble extension (§5.2).
        skill_name:   Skill directory name for skill-scoped extension (§5.3).
        workspace:    Repo root (used to check if optional files exist).

    Returns:
        The complete prompt string: preamble + skill_prompt.
    """
    surfaces = list(_BASE_SURFACES)
    if agent == "codex":
        surfaces.append(_CODEX_SURFACE)

    # §5.2 Project-scoped extension
    project_lines: list[str] = []
    if project:
        handoff = f"projects/{project}/HANDOFF.md"
        project_wiki = f".claude/wiki/wiki/projects/{project}.md"
        n = len(surfaces)
        project_lines.append(f"{n + 1}. Read `{handoff}`")
        surfaces.append((f"project_handoff_{project}", handoff))
        if workspace is None or (workspace / project_wiki).exists():
            project_lines.append(f"{n + 2}. Read `{project_wiki}` (if it exists)")
            surfaces.append((f"project_wiki_{project}", project_wiki))

    # §5.3 Skill-scoped extension
    skill_lines: list[str] = []
    if skill_name:
        skill_md_path = f".claude/skills/{skill_name}/SKILL.md"
        standards_path = ".claude/SKILL_STANDARDS.md"
        n = len(surfaces)
        skill_lines.append(f"{n + 1}. Read `{skill_md_path}` before modifying it")
        skill_lines.append(f"{n + 2}. Read `{standards_path}`")

    # Build numbered surface list
    surface_lines = []
    for i, (_, path) in enumerate(_BASE_SURFACES, 1):
        surface_lines.append(f"{i}. Read `{path}`")
    if agent == "codex":
        surface_lines.append(f"{len(_BASE_SURFACES) + 1}. Read `CODEX.md`")
    surface_lines.extend(project_lines)
    surface_lines.extend(skill_lines)

    total_reads = len(surface_lines)
    surface_block = "\n".join(surface_lines)

    preamble = f"""DASHBOARD SESSION PREFLIGHT

Before taking any action, read these knowledge surfaces in order:
{surface_block}

These reads satisfy the knowledge_preflight_guard requirement. Do not write,
edit, or spawn sub-agents until all {total_reads} read{"s" if total_reads != 1 else ""} are complete.

After reading, proceed with the following task:
{_OUTPUT_FORMAT}
---

{skill_prompt}"""

    return preamble
