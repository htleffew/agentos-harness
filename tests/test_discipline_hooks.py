"""Tests for discipline-related hooks."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

HOOKS_DIR = Path(__file__).parent.parent / "src" / "agentos_harness" / "hooks"


def _run_hook(hook_name: str, event: dict | None = None, cwd: Path | None = None) -> subprocess.CompletedProcess:
    hook = HOOKS_DIR / hook_name
    inp = json.dumps(event).encode() if event is not None else b""
    return subprocess.run(
        [sys.executable, str(hook)],
        input=inp,
        capture_output=True,
        cwd=str(cwd) if cwd else None,
    )


# Surface maintenance reminder tests


def test_surface_maintenance_exits_zero_no_stdin() -> None:
    result = subprocess.run(
        [sys.executable, str(HOOKS_DIR / "surface_maintenance_reminder.py")],
        capture_output=True,
    )
    assert result.returncode == 0


def test_surface_maintenance_exits_zero_non_edit_tool() -> None:
    result = _run_hook("surface_maintenance_reminder.py", {"tool_name": "Bash", "tool_input": {}})
    assert result.returncode == 0


def test_surface_maintenance_exits_zero_for_update_file(tmp_path: Path) -> None:
    result = _run_hook(
        "surface_maintenance_reminder.py",
        {"tool_name": "Write", "tool_input": {"file_path": "PROJECT_UPDATE.md", "content": "test"}},
        cwd=tmp_path,
    )
    assert result.returncode == 0
    assert result.stderr == b""  # No reminder for update file itself


def test_surface_maintenance_reminds_for_significant_change(tmp_path: Path) -> None:
    result = _run_hook(
        "surface_maintenance_reminder.py",
        {"tool_name": "Write", "tool_input": {"file_path": "src/module.py", "content": "def test_function():\n    pass"}},
        cwd=tmp_path,
    )
    assert result.returncode == 0
    assert b"SURFACE MAINTENANCE REMINDER" in result.stderr


# Plan quality gate tests


def test_plan_quality_gate_exits_zero_no_stdin() -> None:
    result = subprocess.run(
        [sys.executable, str(HOOKS_DIR / "plan_quality_gate.py")],
        capture_output=True,
    )
    assert result.returncode == 0


def test_plan_quality_gate_skips_non_plan_files(tmp_path: Path) -> None:
    result = _run_hook(
        "plan_quality_gate.py",
        {"tool_name": "Write", "tool_input": {"file_path": "src/code.py", "content": "# code"}},
        cwd=tmp_path,
    )
    assert result.returncode == 0
    assert result.stderr == b""


def test_plan_quality_gate_skips_when_disabled(tmp_path: Path) -> None:
    # Create disabled discipline config
    config_dir = tmp_path / ".harness" / "config"
    config_dir.mkdir(parents=True)
    (config_dir / "discipline.json").write_text(
        json.dumps({"plan_cold_reader_gate": False}),
        encoding="utf-8",
    )

    result = _run_hook(
        "plan_quality_gate.py",
        {
            "tool_name": "Write",
            "tool_input": {
                "file_path": str(tmp_path / "plans/active/Test.md"),
                "content": "# Minimal plan without validation",
            },
        },
        cwd=tmp_path,
    )
    assert result.returncode == 0
    assert b"PLAN QUALITY GATE" not in result.stderr


def test_plan_quality_gate_blocks_when_enabled(tmp_path: Path) -> None:
    # Create enabled discipline config
    config_dir = tmp_path / ".harness" / "config"
    config_dir.mkdir(parents=True)
    (config_dir / "discipline.json").write_text(
        json.dumps({"plan_cold_reader_gate": True}),
        encoding="utf-8",
    )

    # Plan without required engineering-quality structure
    result = _run_hook(
        "plan_quality_gate.py",
        {
            "tool_name": "Write",
            "tool_input": {
                "file_path": str(tmp_path / "plans/active/Test.md"),
                "content": "# Plan\n\n## Summary\nDo stuff.\n\n### WC-01: Chunk\n- status: not_started",
            },
        },
        cwd=tmp_path,
    )
    assert result.returncode == 2
    assert b"PLAN QUALITY GATE BLOCKED" in result.stderr
    assert b"Missing" in result.stderr


def test_plan_quality_gate_quiet_for_good_plan(tmp_path: Path) -> None:
    # Create enabled discipline config
    config_dir = tmp_path / ".harness" / "config"
    config_dir.mkdir(parents=True)
    (config_dir / "discipline.json").write_text(
        json.dumps({"plan_cold_reader_gate": True}),
        encoding="utf-8",
    )

    # Well-formed plan
    good_plan = """# Good Plan

## Overview
Implement feature X.

## Current State
Feature is partially implemented.

## Target State
Feature is complete and tested.

Default chain: /plan -> MoE plan consensus -> /execute -> /loop -> MoE completion audit -> done

## Engineering Quality Contract
### Assumptions And Ambiguity
None.
### Simplicity Rationale
Keep the change scoped to one module and tests.
### Surgical Scope
Only update feature and test files.
### Verification Contract
Pass if: `pytest` exits 0.
### Final Output Requirements
Update src/feature.py and tests/test_feature.py.
### Narrative, Prose, And Visual Requirements
No extra prose or visuals.
### Behavior, Function, Interactivity, Display, Style, Look, Feel, And Tone
Behavioral change only.
### Context Receipt Requirements For All Agents
Use Context-Receipt and the related fields.
### MoE Plan Consensus Requirement
Require explicit verdict lines.

## Work Chunks
### WC-01: Implement feature
- status: not_started
creates/modifies: [src/feature.py, tests/test_feature.py]
verification: |
  Pass if `pytest tests/test_feature.py` exits 0.

## Dependency Graph
WC-01

## Plan Review Record
verdict: APPROVED
"""
    result = _run_hook(
        "plan_quality_gate.py",
        {
            "tool_name": "Write",
            "tool_input": {
                "file_path": str(tmp_path / "plans/active/Good.md"),
                "content": good_plan,
            },
        },
        cwd=tmp_path,
    )
    assert result.returncode == 0
    assert result.stderr == b""


def test_engineering_quality_guard_blocks_completion_without_markers(tmp_path: Path) -> None:
    result = _run_hook(
        "engineering_quality_guard.py",
        {
            "tool_name": "Write",
            "tool_input": {
                "file_path": str(tmp_path / "plans/active/Test.md"),
                "content": "status: completed\n\n### WC-01: Chunk\n- status: completed\n",
            },
        },
        cwd=tmp_path,
    )
    assert result.returncode == 2
    assert b"ENGINEERING QUALITY GUARD BLOCKED" in result.stderr


def test_engineering_quality_guard_allows_completion_with_markers(tmp_path: Path) -> None:
    plan = """status: completed

## Engineering Quality Contract
### Context Receipt Requirements For All Agents
Required.
### MoE Plan Consensus Requirement
Required.

### WC-01: Chunk
- status: completed
### Engineering Quality Receipt
Context consulted
Validation run
Review gates run
Remaining gaps: none

verdict: APPROVED
"""
    result = _run_hook(
        "engineering_quality_guard.py",
        {
            "tool_name": "Write",
            "tool_input": {
                "file_path": str(tmp_path / "plans/active/Test.md"),
                "content": plan,
            },
        },
        cwd=tmp_path,
    )
    assert result.returncode == 0
