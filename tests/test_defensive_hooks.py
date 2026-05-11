"""Tests for defensive hooks: destructive_guard, doom_loop_detector, activity_logger, external_boundary_guard."""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

import pytest


# --- destructive_guard tests ---


def test_destructive_guard_blocks_git_push_force(tmp_path: Path) -> None:
    from agentos_harness.hooks import destructive_guard

    event = {"tool_name": "Bash", "tool_input": {"command": "git push --force origin main"}}

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with pytest.raises(SystemExit) as exc:
                destructive_guard.main()
            assert exc.value.code == 2


def test_destructive_guard_blocks_git_push_f(tmp_path: Path) -> None:
    from agentos_harness.hooks import destructive_guard

    event = {"tool_name": "Bash", "tool_input": {"command": "git push -f origin main"}}

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with pytest.raises(SystemExit) as exc:
                destructive_guard.main()
            assert exc.value.code == 2


def test_destructive_guard_blocks_git_reset_hard(tmp_path: Path) -> None:
    from agentos_harness.hooks import destructive_guard

    event = {"tool_name": "Bash", "tool_input": {"command": "git reset --hard HEAD~1"}}

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with pytest.raises(SystemExit) as exc:
                destructive_guard.main()
            assert exc.value.code == 2


def test_destructive_guard_blocks_git_clean_f(tmp_path: Path) -> None:
    from agentos_harness.hooks import destructive_guard

    event = {"tool_name": "Bash", "tool_input": {"command": "git clean -f"}}

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with pytest.raises(SystemExit) as exc:
                destructive_guard.main()
            assert exc.value.code == 2


def test_destructive_guard_blocks_git_branch_D(tmp_path: Path) -> None:
    from agentos_harness.hooks import destructive_guard

    event = {"tool_name": "Bash", "tool_input": {"command": "git branch -D feature-branch"}}

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with pytest.raises(SystemExit) as exc:
                destructive_guard.main()
            assert exc.value.code == 2


def test_destructive_guard_blocks_git_checkout_dot(tmp_path: Path) -> None:
    from agentos_harness.hooks import destructive_guard

    event = {"tool_name": "Bash", "tool_input": {"command": "git checkout ."}}

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with pytest.raises(SystemExit) as exc:
                destructive_guard.main()
            assert exc.value.code == 2


def test_destructive_guard_blocks_rm_rf_root(tmp_path: Path) -> None:
    from agentos_harness.hooks import destructive_guard

    event = {"tool_name": "Bash", "tool_input": {"command": "rm -rf /home/user/important"}}

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with pytest.raises(SystemExit) as exc:
                destructive_guard.main()
            assert exc.value.code == 2


def test_destructive_guard_allows_rm_rf_tmp(tmp_path: Path) -> None:
    from agentos_harness.hooks import destructive_guard

    event = {"tool_name": "Bash", "tool_input": {"command": "rm -rf /tmp/mydir"}}

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with pytest.raises(SystemExit) as exc:
                destructive_guard.main()
            assert exc.value.code == 0


def test_destructive_guard_allows_non_bash_tools(tmp_path: Path) -> None:
    from agentos_harness.hooks import destructive_guard

    event = {"tool_name": "Read", "tool_input": {"file_path": "/some/file.txt"}}

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with pytest.raises(SystemExit) as exc:
                destructive_guard.main()
            assert exc.value.code == 0


def test_destructive_guard_allows_safe_git_commands(tmp_path: Path) -> None:
    from agentos_harness.hooks import destructive_guard

    event = {"tool_name": "Bash", "tool_input": {"command": "git status"}}

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with pytest.raises(SystemExit) as exc:
                destructive_guard.main()
            assert exc.value.code == 0


# --- doom_loop_detector tests ---


def test_doom_loop_detector_detects_repeated_action(tmp_path: Path) -> None:
    from agentos_harness.hooks import doom_loop_detector

    state_dir = tmp_path / ".harness" / "state"
    state_dir.mkdir(parents=True)

    event = {"tool_name": "Read", "tool_input": {"file_path": "/test.txt"}, "tool_result": {}}

    # Simulate 3 identical calls
    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path), "CLAUDE_MODEL": "haiku"}):
        for _ in range(3):
            with patch("sys.stdin", io.StringIO(json.dumps(event))):
                with pytest.raises(SystemExit):
                    doom_loop_detector.main()

    # Check state file has window entries
    state_path = state_dir / "doom_loop_window.json"
    assert state_path.exists()
    state = json.loads(state_path.read_text())
    assert len(state.get("window", [])) >= 3


def test_doom_loop_patience_limit_opus() -> None:
    from agentos_harness.hooks.doom_loop_detector import _patience_limit

    assert _patience_limit("opus-4-5") == 1
    assert _patience_limit("claude-opus") == 1


def test_doom_loop_patience_limit_sonnet() -> None:
    from agentos_harness.hooks.doom_loop_detector import _patience_limit

    assert _patience_limit("sonnet-4-5") == 2
    assert _patience_limit("claude-sonnet") == 2


def test_doom_loop_patience_limit_default() -> None:
    from agentos_harness.hooks.doom_loop_detector import _patience_limit

    assert _patience_limit("haiku") == 4
    assert _patience_limit("unknown") == 4


def test_doom_loop_state_persistence(tmp_path: Path) -> None:
    from agentos_harness.hooks import doom_loop_detector

    state_dir = tmp_path / ".harness" / "state"
    state_dir.mkdir(parents=True)

    event = {"tool_name": "Bash", "tool_input": {"command": "ls"}, "tool_result": {}}

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with pytest.raises(SystemExit):
                doom_loop_detector.main()

    state_path = state_dir / "doom_loop_window.json"
    assert state_path.exists()
    state = json.loads(state_path.read_text())
    assert "window" in state
    assert "session_id" in state


# --- activity_logger tests ---


def test_activity_logger_logs_bash_command(tmp_path: Path) -> None:
    from agentos_harness.hooks import activity_logger

    state_dir = tmp_path / ".harness" / "state"
    state_dir.mkdir(parents=True)

    event = {
        "tool_name": "Bash",
        "hook_event_name": "PostToolUse",
        "tool_input": {"command": "git status"},
        "tool_result": {},
    }

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with pytest.raises(SystemExit):
                activity_logger.main()

    log_path = state_dir / "activity.jsonl"
    assert log_path.exists()
    lines = log_path.read_text().strip().split("\n")
    assert len(lines) >= 1
    entry = json.loads(lines[-1])
    assert entry["tool"] == "Bash"
    assert entry["desc"] == "git status"


def test_activity_logger_logs_read_file(tmp_path: Path) -> None:
    from agentos_harness.hooks import activity_logger

    state_dir = tmp_path / ".harness" / "state"
    state_dir.mkdir(parents=True)

    event = {
        "tool_name": "Read",
        "hook_event_name": "PostToolUse",
        "tool_input": {"file_path": "/some/path/to/file.py"},
        "tool_result": {},
    }

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with pytest.raises(SystemExit):
                activity_logger.main()

    log_path = state_dir / "activity.jsonl"
    entry = json.loads(log_path.read_text().strip().split("\n")[-1])
    assert entry["tool"] == "Read"
    assert entry["desc"] == "file.py"


def test_activity_logger_logs_success_status(tmp_path: Path) -> None:
    from agentos_harness.hooks import activity_logger

    state_dir = tmp_path / ".harness" / "state"
    state_dir.mkdir(parents=True)

    event = {
        "tool_name": "Bash",
        "hook_event_name": "PostToolUse",
        "tool_input": {"command": "ls"},
        "tool_result": {},
    }

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with pytest.raises(SystemExit):
                activity_logger.main()

    log_path = state_dir / "activity.jsonl"
    entry = json.loads(log_path.read_text().strip().split("\n")[-1])
    assert entry["ok"] is True


def test_activity_logger_logs_failure_status(tmp_path: Path) -> None:
    from agentos_harness.hooks import activity_logger

    state_dir = tmp_path / ".harness" / "state"
    state_dir.mkdir(parents=True)

    event = {
        "tool_name": "Bash",
        "hook_event_name": "PostToolUseFailure",
        "tool_input": {"command": "ls"},
        "tool_result": {"error": "command failed"},
    }

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with pytest.raises(SystemExit):
                activity_logger.main()

    log_path = state_dir / "activity.jsonl"
    entry = json.loads(log_path.read_text().strip().split("\n")[-1])
    assert entry["ok"] is False


def test_activity_logger_truncates_long_descriptions(tmp_path: Path) -> None:
    from agentos_harness.hooks import activity_logger

    state_dir = tmp_path / ".harness" / "state"
    state_dir.mkdir(parents=True)

    long_command = "a" * 100
    event = {
        "tool_name": "Bash",
        "hook_event_name": "PostToolUse",
        "tool_input": {"command": long_command},
        "tool_result": {},
    }

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with pytest.raises(SystemExit):
                activity_logger.main()

    log_path = state_dir / "activity.jsonl"
    entry = json.loads(log_path.read_text().strip().split("\n")[-1])
    assert len(entry["desc"]) <= 80
    assert entry["desc"].endswith("...")


# --- external_boundary_guard tests ---


def test_external_boundary_guard_blocks_py_in_external(tmp_path: Path) -> None:
    from agentos_harness.hooks import external_boundary_guard

    event = {
        "tool_name": "Write",
        "tool_input": {
            "file_path": str(tmp_path / "projects/myproj/external/script.py"),
            "content": "print('hello')",
        },
    }

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with pytest.raises(SystemExit) as exc:
                external_boundary_guard.main()
            assert exc.value.code == 2


def test_external_boundary_guard_allows_md_in_external(tmp_path: Path) -> None:
    from agentos_harness.hooks import external_boundary_guard

    event = {
        "tool_name": "Write",
        "tool_input": {
            "file_path": str(tmp_path / "projects/myproj/external/README.md"),
            "content": "# Documentation",
        },
    }

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with pytest.raises(SystemExit) as exc:
                external_boundary_guard.main()
            assert exc.value.code == 0


def test_external_boundary_guard_allows_ipynb_in_external(tmp_path: Path) -> None:
    from agentos_harness.hooks import external_boundary_guard

    event = {
        "tool_name": "Write",
        "tool_input": {
            "file_path": str(tmp_path / "projects/myproj/external/analysis.ipynb"),
            "content": "{}",
        },
    }

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with pytest.raises(SystemExit) as exc:
                external_boundary_guard.main()
            assert exc.value.code == 0


def test_external_boundary_guard_blocks_agents_md(tmp_path: Path) -> None:
    from agentos_harness.hooks import external_boundary_guard

    event = {
        "tool_name": "Write",
        "tool_input": {
            "file_path": str(tmp_path / "projects/myproj/external/AGENTS.md"),
            "content": "# Agents",
        },
    }

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with pytest.raises(SystemExit) as exc:
                external_boundary_guard.main()
            assert exc.value.code == 2


def test_external_boundary_guard_blocks_wc_xx_content(tmp_path: Path) -> None:
    from agentos_harness.hooks import external_boundary_guard

    event = {
        "tool_name": "Write",
        "tool_input": {
            "file_path": str(tmp_path / "projects/myproj/external/doc.md"),
            "content": "See WC-01 for details",
        },
    }

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with pytest.raises(SystemExit) as exc:
                external_boundary_guard.main()
            assert exc.value.code == 2


def test_external_boundary_guard_blocks_internal_path_content(tmp_path: Path) -> None:
    from agentos_harness.hooks import external_boundary_guard

    event = {
        "tool_name": "Write",
        "tool_input": {
            "file_path": str(tmp_path / "projects/myproj/external/doc.md"),
            "content": "See internal/scripts/run.py for the implementation",
        },
    }

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with pytest.raises(SystemExit) as exc:
                external_boundary_guard.main()
            assert exc.value.code == 2


def test_external_boundary_guard_allows_ipynb_with_internal_paths(tmp_path: Path) -> None:
    from agentos_harness.hooks import external_boundary_guard

    event = {
        "tool_name": "Write",
        "tool_input": {
            "file_path": str(tmp_path / "projects/myproj/external/analysis.ipynb"),
            "content": '{"cells": [{"source": ["from internal.utils import helper"]}]}',
        },
    }

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with pytest.raises(SystemExit) as exc:
                external_boundary_guard.main()
            assert exc.value.code == 0


def test_external_boundary_guard_allows_non_external_paths(tmp_path: Path) -> None:
    from agentos_harness.hooks import external_boundary_guard

    event = {
        "tool_name": "Write",
        "tool_input": {
            "file_path": str(tmp_path / "projects/myproj/internal/script.py"),
            "content": "print('hello')",
        },
    }

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with pytest.raises(SystemExit) as exc:
                external_boundary_guard.main()
            assert exc.value.code == 0
