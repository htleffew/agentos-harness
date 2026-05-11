"""Tests for commit_gate hook."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

HOOK = Path(__file__).parent.parent / "src" / "agentos_harness" / "hooks" / "commit_gate.py"


def _run(event: dict) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps(event).encode(),
        capture_output=True,
    )


def _bash_event(command: str) -> dict:
    return {"tool_name": "Bash", "tool_input": {"command": command}}


def test_exits_zero_with_no_stdin() -> None:
    result = subprocess.run([sys.executable, str(HOOK)], capture_output=True)
    assert result.returncode == 0


def test_plain_bash_command_allowed() -> None:
    result = _run(_bash_event("ls -la"))
    assert result.returncode == 0


def test_git_status_allowed() -> None:
    result = _run(_bash_event("git status"))
    assert result.returncode == 0


def test_git_commit_blocked() -> None:
    result = _run(_bash_event("git commit -m 'fix: update readme'"))
    assert result.returncode == 2
    assert b"BLOCKED" in result.stderr


def test_git_commit_am_blocked() -> None:
    result = _run(_bash_event("git commit --amend --no-edit"))
    assert result.returncode == 2
    assert b"BLOCKED" in result.stderr


def test_git_commit_help_allowed() -> None:
    result = _run(_bash_event("git commit --help"))
    assert result.returncode == 0


def test_git_commit_h_flag_allowed() -> None:
    result = _run(_bash_event("git commit -h"))
    assert result.returncode == 0


def test_non_bash_tool_skipped() -> None:
    event = {"tool_name": "Write", "tool_input": {"file_path": "/workspace/file.py", "content": "git commit"}}
    result = _run(event)
    assert result.returncode == 0


def test_git_commit_in_comment_string_blocked() -> None:
    result = _run(_bash_event("echo 'running' && git commit -m 'batch'"))
    assert result.returncode == 2


def test_echo_git_commit_allowed_when_no_actual_commit() -> None:
    result = _run(_bash_event("echo git-commit-message"))
    assert result.returncode == 0
