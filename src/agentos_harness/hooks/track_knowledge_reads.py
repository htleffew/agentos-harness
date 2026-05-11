#!/usr/bin/env python3
"""PostToolUse hook: track knowledge surface reads for session enforcement."""

from __future__ import annotations

import json
import os
import select
import sys
from datetime import datetime, timezone
from pathlib import Path


def _get_paths(project_dir: Path) -> tuple[Path, Path]:
    session_state_dir = project_dir / ".harness" / "state" / "session"
    knowledge_reads_file = session_state_dir / "knowledge_reads.json"
    return session_state_dir, knowledge_reads_file


KNOWLEDGE_SURFACES = {
    "wiki_index": ".claude/wiki/index.md",
    "agents_md": "AGENTS.md",
    "claude_md": "CLAUDE.md",
    "codex_md": "CODEX.md",
    "skills_index": ".claude/skills.json",
}

PROJECT_WIKI_PATTERN = ".claude/wiki/wiki/projects/"
SKILL_PATTERN = ".claude/skills/"
MEMORY_PATTERN = ".claude/projects/"


def _normalize_path(file_path: str, project_dir: Path) -> str:
    file_path = file_path.strip()
    if not file_path:
        return ""
    path = Path(file_path)
    if path.is_absolute():
        try:
            return str(path.relative_to(project_dir))
        except ValueError:
            return file_path
    return file_path.lstrip("./")


def _load_session_state(knowledge_reads_file: Path) -> dict:
    if not knowledge_reads_file.exists():
        return {"reads": {}, "session_start": None}
    try:
        return json.loads(knowledge_reads_file.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"reads": {}, "session_start": None}


def _save_session_state(state: dict, session_state_dir: Path, knowledge_reads_file: Path) -> None:
    session_state_dir.mkdir(parents=True, exist_ok=True)
    knowledge_reads_file.write_text(
        json.dumps(state, indent=2, sort_keys=True),
        encoding="utf-8"
    )


def _classify_read(rel_path: str) -> list[str]:
    """Classify what kind of knowledge surface was read."""
    classifications = []

    for key, pattern in KNOWLEDGE_SURFACES.items():
        if rel_path == pattern:
            classifications.append(key)

    if rel_path.startswith(PROJECT_WIKI_PATTERN) and rel_path.endswith(".md"):
        project_name = rel_path[len(PROJECT_WIKI_PATTERN):-3]
        classifications.append(f"project_wiki:{project_name}")

    if rel_path.startswith(SKILL_PATTERN):
        parts = rel_path[len(SKILL_PATTERN):].split("/")
        if parts:
            skill_name = parts[0]
            if "SKILL.md" in rel_path:
                classifications.append(f"skill:{skill_name}")
            elif "/references/" in rel_path:
                classifications.append(f"skill_ref:{skill_name}")

    if "/memory/" in rel_path and rel_path.endswith(".md"):
        classifications.append("memory")

    return classifications


def main() -> None:
    if not select.select([sys.stdin], [], [], 0.0)[0]:
        sys.exit(0)

    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = payload.get("tool_name", "")
    tool_input = payload.get("tool_input", {}) or {}

    if tool_name != "Read":
        sys.exit(0)

    file_path = tool_input.get("file_path", "")
    if not file_path:
        sys.exit(0)

    project_dir = Path(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()).resolve()
    session_state_dir, knowledge_reads_file = _get_paths(project_dir)

    rel_path = _normalize_path(file_path, project_dir)
    classifications = _classify_read(rel_path)

    if not classifications:
        sys.exit(0)

    state = _load_session_state(knowledge_reads_file)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    if state.get("session_start") is None:
        state["session_start"] = now

    for classification in classifications:
        if classification not in state["reads"]:
            state["reads"][classification] = {
                "first_read": now,
                "path": rel_path,
                "count": 0
            }
        state["reads"][classification]["last_read"] = now
        state["reads"][classification]["count"] += 1

    _save_session_state(state, session_state_dir, knowledge_reads_file)
    sys.exit(0)


if __name__ == "__main__":
    main()
