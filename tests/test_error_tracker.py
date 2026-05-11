"""Tests for error_tracker hook."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

HOOK = Path(__file__).parent.parent / "src" / "agentos_harness" / "hooks" / "error_tracker.py"


def _run(event: dict, cwd: Path | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps(event).encode(),
        capture_output=True,
        cwd=str(cwd) if cwd else None,
    )


def _bash_error_event(command: str, exit_code: int, stderr: str = "") -> dict:
    return {
        "tool_name": "Bash",
        "tool_input": {"command": command},
        "tool_result": {"exit_code": exit_code, "stderr": stderr, "output": ""},
    }


def _bash_success_event(command: str) -> dict:
    return {
        "tool_name": "Bash",
        "tool_input": {"command": command},
        "tool_result": {"exit_code": 0, "output": "ok"},
    }


def test_exits_zero_with_no_stdin() -> None:
    result = subprocess.run([sys.executable, str(HOOK)], capture_output=True)
    assert result.returncode == 0


def test_success_event_not_recorded(tmp_path: Path) -> None:
    (tmp_path / ".harness" / "state").mkdir(parents=True)
    _run(_bash_success_event("echo hello"), cwd=tmp_path)
    assert not (tmp_path / ".harness" / "state" / "error_patterns.jsonl").exists()


def test_bash_error_recorded(tmp_path: Path) -> None:
    (tmp_path / ".harness" / "state").mkdir(parents=True)
    _run(_bash_error_event("bad-command", 1, "command not found"), cwd=tmp_path)
    patterns = tmp_path / ".harness" / "state" / "error_patterns.jsonl"
    assert patterns.exists()
    entry = json.loads(patterns.read_text().strip())
    assert entry["tool"] == "Bash"
    assert entry["exit_code"] == 1
    assert "command" in entry


def test_bash_error_captures_command(tmp_path: Path) -> None:
    (tmp_path / ".harness" / "state").mkdir(parents=True)
    _run(_bash_error_event("python -c 'import missing'", 1, "ModuleNotFoundError"), cwd=tmp_path)
    entry = json.loads((tmp_path / ".harness" / "state" / "error_patterns.jsonl").read_text().strip())
    assert "python" in entry["command"]


def test_error_field_recorded(tmp_path: Path) -> None:
    (tmp_path / ".harness" / "state").mkdir(parents=True)
    _run(_bash_error_event("bad", 1, "Something went wrong"), cwd=tmp_path)
    entry = json.loads((tmp_path / ".harness" / "state" / "error_patterns.jsonl").read_text().strip())
    assert "Something went wrong" in entry["error"]


def test_multiple_errors_appended(tmp_path: Path) -> None:
    (tmp_path / ".harness" / "state").mkdir(parents=True)
    _run(_bash_error_event("cmd1", 1, "err1"), cwd=tmp_path)
    _run(_bash_error_event("cmd2", 2, "err2"), cwd=tmp_path)
    lines = (tmp_path / ".harness" / "state" / "error_patterns.jsonl").read_text().strip().splitlines()
    assert len(lines) == 2


def test_no_harness_dir_exits_zero(tmp_path: Path) -> None:
    result = _run(_bash_error_event("bad", 1, "err"), cwd=tmp_path)
    assert result.returncode == 0


def test_write_error_recorded_with_path(tmp_path: Path) -> None:
    (tmp_path / ".harness" / "state").mkdir(parents=True)
    event = {
        "tool_name": "Write",
        "tool_input": {"file_path": "/some/path.py"},
        "tool_result": {"error": "permission denied"},
    }
    _run(event, cwd=tmp_path)
    entry = json.loads((tmp_path / ".harness" / "state" / "error_patterns.jsonl").read_text().strip())
    assert entry["tool"] == "Write"
    assert "path" in entry
