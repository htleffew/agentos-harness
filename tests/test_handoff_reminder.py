"""Tests for handoff_reminder hook."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

HOOK = Path(__file__).parent.parent / "src" / "agentos_harness" / "hooks" / "handoff_reminder.py"


def _run(event: dict, cwd: Path | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps(event).encode(),
        capture_output=True,
        cwd=str(cwd) if cwd else None,
    )


def _write_event(path: str) -> dict:
    return {"tool_name": "Write", "tool_input": {"file_path": path, "content": ""}}


def _edit_event(path: str) -> dict:
    return {"tool_name": "Edit", "tool_input": {"file_path": path, "new_string": "", "old_string": ""}}


def test_exits_zero_with_no_stdin() -> None:
    result = subprocess.run([sys.executable, str(HOOK)], capture_output=True)
    assert result.returncode == 0


def test_plan_completed_write_fires_reminder(tmp_path: Path) -> None:
    (tmp_path / ".harness" / "state").mkdir(parents=True)
    result = _run(_write_event(str(tmp_path / "projects/foo/internal/plans/completed/Phase1.md")), cwd=tmp_path)
    assert result.returncode == 0
    reminders = tmp_path / ".harness" / "state" / "handoff_reminders.jsonl"
    assert reminders.exists()
    entry = json.loads(reminders.read_text().strip())
    assert "completed" in entry["trigger_path"]
    assert "HANDOFF" in entry["suggested_action"]


def test_plan_completed_prints_reminder_to_stderr(tmp_path: Path) -> None:
    (tmp_path / ".harness" / "state").mkdir(parents=True)
    result = _run(_write_event(str(tmp_path / "projects/foo/internal/plans/completed/Plan.md")), cwd=tmp_path)
    assert b"HARNESS" in result.stderr or b"Plan" in result.stderr


def test_active_plan_write_does_not_fire(tmp_path: Path) -> None:
    (tmp_path / ".harness" / "state").mkdir(parents=True)
    _run(_write_event(str(tmp_path / "projects/foo/internal/plans/active/Plan.md")), cwd=tmp_path)
    assert not (tmp_path / ".harness" / "state" / "handoff_reminders.jsonl").exists()


def test_source_file_write_does_not_fire(tmp_path: Path) -> None:
    (tmp_path / ".harness" / "state").mkdir(parents=True)
    _run(_write_event(str(tmp_path / "src/main.py")), cwd=tmp_path)
    assert not (tmp_path / ".harness" / "state" / "handoff_reminders.jsonl").exists()


def test_handoff_write_itself_does_not_fire(tmp_path: Path) -> None:
    (tmp_path / ".harness" / "state").mkdir(parents=True)
    _run(_write_event(str(tmp_path / "projects/foo/FOO-HANDOFF.md")), cwd=tmp_path)
    assert not (tmp_path / ".harness" / "state" / "handoff_reminders.jsonl").exists()


def test_bare_handoff_write_does_not_fire(tmp_path: Path) -> None:
    (tmp_path / ".harness" / "state").mkdir(parents=True)
    _run(_write_event("/workspace/HANDOFF.md"), cwd=tmp_path)
    assert not (tmp_path / ".harness" / "state" / "handoff_reminders.jsonl").exists()


def test_edit_to_completed_plan_fires(tmp_path: Path) -> None:
    (tmp_path / ".harness" / "state").mkdir(parents=True)
    result = _run(_edit_event(str(tmp_path / "projects/bar/internal/plans/completed/Work.md")), cwd=tmp_path)
    assert result.returncode == 0
    assert (tmp_path / ".harness" / "state" / "handoff_reminders.jsonl").exists()


def test_non_write_tool_skipped(tmp_path: Path) -> None:
    (tmp_path / ".harness" / "state").mkdir(parents=True)
    event = {"tool_name": "Bash", "tool_input": {"command": "ls"}}
    _run(event, cwd=tmp_path)
    assert not (tmp_path / ".harness" / "state" / "handoff_reminders.jsonl").exists()
