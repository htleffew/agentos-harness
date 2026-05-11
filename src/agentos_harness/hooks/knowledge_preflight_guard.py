#!/usr/bin/env python3
"""PreToolUse hook: block Write/Edit/Agent without proof of knowledge reads.

This hook enforces the discipline that agents MUST read knowledge surfaces
before modifying files or spawning sub-agents. Session start recommendations
are advisory; this hook makes them mandatory.
"""

from __future__ import annotations

import json
import os
import select
import sys
from pathlib import Path


def _get_paths(project_dir: Path) -> tuple[Path, Path]:
    session_state_dir = project_dir / ".harness" / "state" / "session"
    knowledge_reads_file = session_state_dir / "knowledge_reads.json"
    return session_state_dir, knowledge_reads_file


ALWAYS_REQUIRED = ["wiki_index", "agents_md", "claude_md", "skills_index"]

EXEMPT_PATHS = {
    ".claude/state/",
    ".harness/state/",
    ".harness/config/",
    ".claude/hooks/",
    ".git/",
}

EXEMPT_EXACT = {
    ".claude/settings.json",
    ".claude/settings.local.json",
}

BOOTSTRAP_GRACE_TOOLS = 0


def _normalize_path(file_path: str, project_dir: Path) -> str:
    path = Path(file_path.strip())
    if path.is_absolute():
        try:
            return str(path.relative_to(project_dir))
        except ValueError:
            return file_path.strip()
    return file_path.strip().lstrip("./")


def _load_session_state(knowledge_reads_file: Path) -> dict:
    if not knowledge_reads_file.exists():
        return {"reads": {}, "session_start": None, "tool_count": 0}
    try:
        state = json.loads(knowledge_reads_file.read_text(encoding="utf-8"))
        return state
    except (json.JSONDecodeError, OSError):
        return {"reads": {}, "session_start": None, "tool_count": 0}


def _save_session_state(state: dict, session_state_dir: Path, knowledge_reads_file: Path) -> None:
    session_state_dir.mkdir(parents=True, exist_ok=True)
    knowledge_reads_file.write_text(
        json.dumps(state, indent=2, sort_keys=True),
        encoding="utf-8"
    )


def _is_exempt_path(rel_path: str) -> bool:
    if rel_path in EXEMPT_EXACT:
        return True
    for prefix in EXEMPT_PATHS:
        if rel_path.startswith(prefix):
            return True
    return False


def _detect_project_from_path(rel_path: str) -> str | None:
    if rel_path.startswith("projects/"):
        parts = rel_path[len("projects/"):].split("/")
        if parts:
            return parts[0]
    return None


def _detect_skill_from_path(rel_path: str) -> str | None:
    if rel_path.startswith(".claude/skills/"):
        parts = rel_path[len(".claude/skills/"):].split("/")
        if parts:
            return parts[0]
    return None


def _check_requirements(rel_path: str, reads: dict) -> tuple[bool, list[str]]:
    """Check if required knowledge surfaces were read. Returns (ok, missing)."""
    missing = []

    for req in ALWAYS_REQUIRED:
        if req not in reads:
            missing.append(req)

    project = _detect_project_from_path(rel_path)
    if project:
        project_wiki_key = f"project_wiki:{project}"
        has_project_wiki = project_wiki_key in reads
        has_any_project_wiki = any(k.startswith("project_wiki:") for k in reads)
        if not has_project_wiki and not has_any_project_wiki:
            missing.append(f"project wiki page for '{project}'")

    skill = _detect_skill_from_path(rel_path)
    if skill:
        skill_key = f"skill:{skill}"
        skill_ref_key = f"skill_ref:{skill}"
        if skill_key not in reads and skill_ref_key not in reads:
            missing.append(f"skill references for '{skill}'")

    return len(missing) == 0, missing


def _deny(reason: str) -> None:
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": reason,
                }
            }
        )
    )


def _format_missing(missing: list[str]) -> str:
    if len(missing) == 1:
        return missing[0]
    return ", ".join(missing[:-1]) + f", and {missing[-1]}"


def main() -> None:
    if not select.select([sys.stdin], [], [], 0.0)[0]:
        sys.exit(0)

    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = payload.get("tool_name", "")
    tool_input = payload.get("tool_input", {}) or {}

    if tool_name not in {"Write", "Edit", "Agent"}:
        sys.exit(0)

    project_dir = Path(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()).resolve()
    session_state_dir, knowledge_reads_file = _get_paths(project_dir)

    state = _load_session_state(knowledge_reads_file)
    tool_count = state.get("tool_count", 0) + 1
    state["tool_count"] = tool_count
    _save_session_state(state, session_state_dir, knowledge_reads_file)

    if tool_count <= BOOTSTRAP_GRACE_TOOLS:
        sys.exit(0)

    reads = state.get("reads", {})

    if tool_name == "Agent":
        ok, missing = _check_requirements("", reads)
        if not ok:
            _deny(
                f"Agent spawning blocked. You have not read: {_format_missing(missing)}. "
                "Read the wiki index and relevant knowledge surfaces before spawning sub-agents. "
                "The session-start discipline check told you what to read."
            )
        sys.exit(0)

    file_path = tool_input.get("file_path", "") or tool_input.get("path", "")
    if not file_path:
        sys.exit(0)

    rel_path = _normalize_path(file_path, project_dir)

    if _is_exempt_path(rel_path):
        sys.exit(0)

    ok, missing = _check_requirements(rel_path, reads)
    if not ok:
        _deny(
            f"File modification blocked for `{rel_path}`. You have not read: {_format_missing(missing)}. "
            "Read the required knowledge surfaces before modifying files. "
            "The session-start discipline check told you what to read."
        )
        sys.exit(0)

    sys.exit(0)


if __name__ == "__main__":
    main()
