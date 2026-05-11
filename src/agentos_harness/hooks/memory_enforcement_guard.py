#!/usr/bin/env python3
"""PreToolUse hook: enforce memory consultation for matching task patterns.

If the current work matches memory entries about prior corrections or feedback,
block until those entries have been read this session.
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


def _get_memory_dir() -> Path:
    home = Path.home()
    cwd = Path.cwd().resolve()
    project_key = str(cwd).replace("/", "-").lstrip("-")
    return home / ".claude" / "projects" / project_key / "memory"


BOOTSTRAP_GRACE_TOOLS = 0

MEMORY_KEYWORDS = {
    "emr": ["emr", "spark", "shuffle", "executor", "dra"],
    "s3": ["s3", "glacier", "bucket", "storage"],
    "wiki": ["wiki", "synthesis", "knowledge"],
    "jira": ["jira", "ticket", "comment"],
    "confluence": ["confluence", "page"],
    "notebook": ["notebook", "ipynb", "research"],
    "prose": ["prose", "publication", "writing"],
    "codex": ["codex", "cx", "dispatch"],
    "gemini": ["gemini", "gx"],
    "commit": ["commit", "git", "push"],
}


def _load_session_state(knowledge_reads_file: Path) -> dict:
    if not knowledge_reads_file.exists():
        return {"reads": {}, "tool_count": 0}
    try:
        return json.loads(knowledge_reads_file.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"reads": {}, "tool_count": 0}


def _load_memory_index(memory_dir: Path) -> dict[str, list[str]]:
    """Load memory entries and index them by keyword category."""
    index = {cat: [] for cat in MEMORY_KEYWORDS}

    if not memory_dir.exists():
        return index

    for memory_file in memory_dir.glob("*.md"):
        if memory_file.name == "MEMORY.md":
            continue

        try:
            content = memory_file.read_text(encoding="utf-8").lower()
            for category, keywords in MEMORY_KEYWORDS.items():
                for kw in keywords:
                    if kw in content:
                        index[category].append(memory_file.name)
                        break
        except OSError:
            continue

    return index


def _detect_task_categories(tool_input: dict, tool_name: str) -> set[str]:
    """Detect what categories the current task touches."""
    categories = set()

    file_path = tool_input.get("file_path", "") or tool_input.get("path", "")
    command = tool_input.get("command", "")
    content = tool_input.get("content", "") or tool_input.get("new_string", "")
    prompt = tool_input.get("prompt", "")

    text_to_check = f"{file_path} {command} {content} {prompt}".lower()

    for category, keywords in MEMORY_KEYWORDS.items():
        for kw in keywords:
            if kw in text_to_check:
                categories.add(category)
                break

    if ".ipynb" in file_path:
        categories.add("notebook")
    if "projects/" in file_path and "/external/" in file_path:
        categories.add("prose")
    if ".claude/wiki/" in file_path:
        categories.add("wiki")

    return categories


def _check_memory_reads(categories: set[str], reads: dict, memory_index: dict) -> tuple[bool, list[str]]:
    """Check if relevant memory entries were read."""
    missing_memories = []

    for category in categories:
        relevant_memories = memory_index.get(category, [])
        if not relevant_memories:
            continue

        memory_read = reads.get("memory", False)
        if not memory_read:
            for mem in relevant_memories[:2]:
                missing_memories.append(f"memory/{mem}")

    return len(missing_memories) == 0, missing_memories


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


def main() -> None:
    if not select.select([sys.stdin], [], [], 0.0)[0]:
        sys.exit(0)

    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = payload.get("tool_name", "")
    tool_input = payload.get("tool_input", {}) or {}

    if tool_name not in {"Write", "Edit", "Agent", "Bash"}:
        sys.exit(0)

    project_dir = Path(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()).resolve()
    session_state_dir, knowledge_reads_file = _get_paths(project_dir)

    state = _load_session_state(knowledge_reads_file)
    tool_count = state.get("tool_count", 0)

    if tool_count <= BOOTSTRAP_GRACE_TOOLS:
        sys.exit(0)

    categories = _detect_task_categories(tool_input, tool_name)
    if not categories:
        sys.exit(0)

    memory_dir = _get_memory_dir()
    memory_index = _load_memory_index(memory_dir)
    reads = state.get("reads", {})

    ok, missing = _check_memory_reads(categories, reads, memory_index)
    if not ok:
        relevant_files = ", ".join(missing[:3])
        _deny(
            f"Memory consultation required. Your task touches categories with prior corrections. "
            f"Read these memory entries first: {relevant_files}. "
            "Memory contains feedback about past mistakes that must not be repeated."
        )
        sys.exit(0)

    sys.exit(0)


if __name__ == "__main__":
    main()
