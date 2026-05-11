"""Tests for session_context hook."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

HOOK = Path(__file__).parent.parent / "src" / "agentos_harness" / "hooks" / "session_context.py"
DISCIPLINE_HOOK = Path(__file__).parent.parent / "src" / "agentos_harness" / "hooks" / "session_start_discipline.py"


def _run(event: dict | None = None, cwd: Path | None = None) -> subprocess.CompletedProcess:
    inp = json.dumps(event).encode() if event is not None else b""
    return subprocess.run(
        [sys.executable, str(HOOK)],
        input=inp,
        capture_output=True,
        cwd=str(cwd) if cwd else None,
    )


def test_exits_zero_with_no_stdin() -> None:
    result = subprocess.run([sys.executable, str(HOOK)], capture_output=True)
    assert result.returncode == 0


def test_exits_zero_for_non_compact_source(tmp_path: Path) -> None:
    result = _run({"source": "human", "type": "session_start"}, cwd=tmp_path)
    assert result.returncode == 0
    assert result.stdout == b""


def test_exits_zero_for_missing_source(tmp_path: Path) -> None:
    result = _run({"type": "session_start"}, cwd=tmp_path)
    assert result.returncode == 0
    assert result.stdout == b""


def test_compact_event_emits_context_block(tmp_path: Path) -> None:
    state_dir = tmp_path / ".harness" / "state"
    state_dir.mkdir(parents=True)
    (state_dir / "setup.json").write_text(
        json.dumps({"moe_tier": "claude-codex", "profile_version": "1.3.0"}),
        encoding="utf-8",
    )
    (state_dir / "analysis.json").write_text(
        json.dumps({"workspace": {"display_name": "my-repo"}}),
        encoding="utf-8",
    )
    result = _run({"source": "compact"}, cwd=tmp_path)
    assert result.returncode == 0
    out = result.stdout.decode()
    assert "HARNESS CONTEXT" in out
    assert "my-repo" in out
    assert "claude-codex" in out
    assert "1.3.0" in out


def test_compact_event_without_state_files_still_exits_zero(tmp_path: Path) -> None:
    result = _run({"source": "compact"}, cwd=tmp_path)
    assert result.returncode == 0


def test_compact_event_reports_wiki_page_count(tmp_path: Path) -> None:
    state_dir = tmp_path / ".harness" / "state"
    state_dir.mkdir(parents=True)
    wiki_dir = tmp_path / ".claude" / "wiki"
    wiki_dir.mkdir(parents=True)
    index = wiki_dir / "index.md"
    index.write_text("- [Page One](wiki/page_one.md)\n- [Page Two](wiki/page_two.md)\n", encoding="utf-8")
    result = _run({"source": "compact"}, cwd=tmp_path)
    assert result.returncode == 0
    out = result.stdout.decode()
    assert "wiki" in out.lower()


def test_compact_event_reports_active_plans(tmp_path: Path) -> None:
    plans_dir = tmp_path / ".claude" / "state" / "plans" / "active"
    plans_dir.mkdir(parents=True)
    (plans_dir / "Phase1.md").write_text("# Plan\n", encoding="utf-8")
    result = _run({"source": "compact"}, cwd=tmp_path)
    assert result.returncode == 0
    out = result.stdout.decode()
    assert "plan" in out.lower() or "Phase1" in out


def test_non_compact_event_with_wiki_shows_consultation(tmp_path: Path) -> None:
    """Non-compact session start with wiki pages shows consultation reminder."""
    wiki_dir = tmp_path / ".claude" / "wiki"
    wiki_dir.mkdir(parents=True)
    index = wiki_dir / "index.md"
    index.write_text("- [Page One](wiki/page_one.md)\n", encoding="utf-8")
    result = _run({"source": "human", "type": "session_start"}, cwd=tmp_path)
    assert result.returncode == 0
    out = result.stdout.decode()
    assert "BEFORE STARTING WORK" in out
    assert "wiki" in out.lower()
    assert "Context-Receipt" in out
    assert "Wiki-Index" in out
    assert "Skill-Index" in out
    assert "Skills-Selected" in out
    assert "Project-Continuity: N/A because no task or project path was supplied" in out
    assert "Source-Artifacts: N/A because no source path was supplied" in out
    assert "Validators-Planned: N/A until a task changes files" in out


def test_non_compact_event_without_wiki_is_silent(tmp_path: Path) -> None:
    """Non-compact session start without wiki pages produces no output."""
    result = _run({"source": "human", "type": "session_start"}, cwd=tmp_path)
    assert result.returncode == 0
    assert result.stdout == b""


def test_session_start_discipline_emits_generic_context_receipt(tmp_path: Path) -> None:
    plans_dir = tmp_path / ".claude" / "state" / "plans" / "active"
    plans_dir.mkdir(parents=True)
    (plans_dir / "Example_Plan.md").write_text("# Example\n", encoding="utf-8")
    (tmp_path / ".claude" / "skills").mkdir(parents=True)

    env = os.environ.copy()
    env["CLAUDE_PROJECT_DIR"] = str(tmp_path)
    result = subprocess.run(
        [sys.executable, str(DISCIPLINE_HOOK)],
        capture_output=True,
        env=env,
    )

    assert result.returncode == 0
    out = result.stdout.decode()
    assert "Codex Context Receipt" in out
    assert "Context-Receipt" in out
    assert "Wiki-Index" in out
    assert "Skill-Index" in out
    assert "Skills-Selected: N/A until a task-specific skill is selected" in out
    assert "Project-Continuity: N/A because no task or project path was supplied" in out
    assert "Source-Artifacts: N/A because no source path was supplied" in out
    assert "Validators-Planned: N/A until a task changes files" in out
