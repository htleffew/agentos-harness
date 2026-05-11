"""Tests for skill_guard hook."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

HOOK = Path(__file__).parent.parent / "src" / "agentos_harness" / "hooks" / "skill_guard.py"

VALID_SKILL = """\
---
name: my-skill
description: Use when the user needs help with something specific.
---

# My Skill

Body content here.
"""


def _run(event: dict) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps(event).encode(),
        capture_output=True,
    )


def _write_skill(path: str, content: str) -> dict:
    return {"tool_name": "Write", "tool_input": {"file_path": path, "content": content}}


def test_exits_zero_with_no_stdin() -> None:
    result = subprocess.run([sys.executable, str(HOOK)], capture_output=True)
    assert result.returncode == 0


def test_valid_skill_passes() -> None:
    result = _run(_write_skill("/workspace/.claude/skills/my-skill/SKILL.md", VALID_SKILL))
    assert result.returncode == 0


def test_non_skill_write_skipped() -> None:
    result = _run(_write_skill("/workspace/README.md", VALID_SKILL))
    assert result.returncode == 0


def test_write_outside_skills_dir_skipped() -> None:
    result = _run(_write_skill("/workspace/.claude/commands/SKILL.md", VALID_SKILL))
    assert result.returncode == 0


def test_no_frontmatter_blocked() -> None:
    result = _run(_write_skill("/workspace/.claude/skills/foo/SKILL.md", "# No frontmatter\n"))
    assert result.returncode == 2
    assert b"BLOCKED" in result.stderr


def test_missing_name_blocked() -> None:
    content = "---\ndescription: Use when the user asks.\n---\n# Body\n"
    result = _run(_write_skill("/workspace/.claude/skills/foo/SKILL.md", content))
    assert result.returncode == 2
    assert b"BLOCKED" in result.stderr


def test_name_with_uppercase_blocked() -> None:
    content = "---\nname: MySkill\ndescription: Use when the user asks.\n---\n"
    result = _run(_write_skill("/workspace/.claude/skills/foo/SKILL.md", content))
    assert result.returncode == 2


def test_name_with_underscore_blocked() -> None:
    content = "---\nname: my_skill\ndescription: Use when the user asks.\n---\n"
    result = _run(_write_skill("/workspace/.claude/skills/foo/SKILL.md", content))
    assert result.returncode == 2


def test_name_exceeding_64_chars_blocked() -> None:
    long_name = "a" * 65
    content = f"---\nname: {long_name}\ndescription: Use when the user asks.\n---\n"
    result = _run(_write_skill("/workspace/.claude/skills/foo/SKILL.md", content))
    assert result.returncode == 2


def test_name_containing_claude_blocked() -> None:
    content = "---\nname: claude-helper\ndescription: Use when the user asks.\n---\n"
    result = _run(_write_skill("/workspace/.claude/skills/foo/SKILL.md", content))
    assert result.returncode == 2


def test_name_containing_anthropic_blocked() -> None:
    content = "---\nname: anthropic-tool\ndescription: Use when the user asks.\n---\n"
    result = _run(_write_skill("/workspace/.claude/skills/foo/SKILL.md", content))
    assert result.returncode == 2


def test_missing_description_blocked() -> None:
    content = "---\nname: valid-name\n---\n# Body\n"
    result = _run(_write_skill("/workspace/.claude/skills/foo/SKILL.md", content))
    assert result.returncode == 2


def test_description_without_when_clause_blocked() -> None:
    content = "---\nname: valid-name\ndescription: This skill helps with tasks.\n---\n"
    result = _run(_write_skill("/workspace/.claude/skills/foo/SKILL.md", content))
    assert result.returncode == 2
    assert b"BLOCKED" in result.stderr


def test_description_with_when_the_user_passes() -> None:
    content = "---\nname: valid-name\ndescription: When the user needs a report generated.\n---\n"
    result = _run(_write_skill("/workspace/.claude/skills/foo/SKILL.md", content))
    assert result.returncode == 0


def test_description_with_working_with_passes() -> None:
    content = "---\nname: valid-name\ndescription: Use when working with Spark pipelines.\n---\n"
    result = _run(_write_skill("/workspace/.claude/skills/foo/SKILL.md", content))
    assert result.returncode == 0


def test_edit_tool_skipped_for_skill_md() -> None:
    event = {"tool_name": "Edit", "tool_input": {"file_path": "/workspace/.claude/skills/foo/SKILL.md", "new_string": "# Invalid", "old_string": ""}}
    result = _run(event)
    assert result.returncode == 0


def test_multiple_errors_reported() -> None:
    content = "---\nname: BAD_NAME\n---\n# No description\n"
    result = _run(_write_skill("/workspace/.claude/skills/foo/SKILL.md", content))
    assert result.returncode == 2
    stderr = result.stderr.decode()
    assert stderr.count("BLOCKED") >= 2
