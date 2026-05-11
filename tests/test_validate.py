"""Tests for validate module: validate_100pct_rule, validate_project_continuity, validate_plan_completeness."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agentos_harness.validate import (
    _workspace_requires_wiki_validation,
    run_all_validations,
    validate_engineering_quality_contract,
    validate_execution_receipts,
    validate_100pct_rule,
    validate_plan_completeness,
    validate_project_continuity,
)


# --- validate_100pct_rule tests ---


def test_100pct_rule_passes_clean_project(tmp_path: Path) -> None:
    project_dir = tmp_path / "projects" / "myproject"
    project_dir.mkdir(parents=True)

    src = project_dir / "src" / "app.py"
    src.parent.mkdir(parents=True)
    src.write_text("def main():\n    print('hello')\n")

    result = validate_100pct_rule(project_dir)
    assert result["passed"] is True
    assert len(result["violations"]) == 0


def test_100pct_rule_detects_todo_comments(tmp_path: Path) -> None:
    project_dir = tmp_path / "projects" / "myproject"
    project_dir.mkdir(parents=True)

    src = project_dir / "src" / "app.py"
    src.parent.mkdir(parents=True)
    src.write_text("def main():\n    # TODO: implement this\n    pass\n")

    result = validate_100pct_rule(project_dir)
    assert result["passed"] is False
    assert any("TODO" in v for v in result["violations"])


def test_100pct_rule_detects_fixme_comments(tmp_path: Path) -> None:
    project_dir = tmp_path / "projects" / "myproject"
    project_dir.mkdir(parents=True)

    src = project_dir / "src" / "app.py"
    src.parent.mkdir(parents=True)
    src.write_text("def main():\n    # FIXME: broken\n    pass\n")

    result = validate_100pct_rule(project_dir)
    assert result["passed"] is False
    assert any("FIXME" in v for v in result["violations"])


def test_100pct_rule_detects_placeholder_patterns(tmp_path: Path) -> None:
    project_dir = tmp_path / "projects" / "myproject"
    project_dir.mkdir(parents=True)

    src = project_dir / "src" / "app.py"
    src.parent.mkdir(parents=True)
    src.write_text('def main():\n    return "placeholder"\n')

    result = validate_100pct_rule(project_dir)
    assert result["passed"] is False
    assert any("placeholder" in v.lower() for v in result["violations"])


def test_100pct_rule_detects_not_implemented(tmp_path: Path) -> None:
    project_dir = tmp_path / "projects" / "myproject"
    project_dir.mkdir(parents=True)

    src = project_dir / "src" / "app.py"
    src.parent.mkdir(parents=True)
    src.write_text("def main():\n    raise NotImplementedError()\n")

    result = validate_100pct_rule(project_dir)
    assert result["passed"] is False
    assert any("NotImplemented" in v for v in result["violations"])


def test_100pct_rule_ignores_test_files(tmp_path: Path) -> None:
    project_dir = tmp_path / "projects" / "myproject"
    project_dir.mkdir(parents=True)

    test_src = project_dir / "tests" / "test_app.py"
    test_src.parent.mkdir(parents=True)
    test_src.write_text("def test_main():\n    # TODO: add more tests\n    pass\n")

    result = validate_100pct_rule(project_dir)
    assert result["passed"] is True


def test_100pct_rule_handles_missing_directory(tmp_path: Path) -> None:
    project_dir = tmp_path / "projects" / "nonexistent"

    result = validate_100pct_rule(project_dir)
    assert result["passed"] is True
    assert len(result["violations"]) == 0


# --- validate_project_continuity tests ---


def test_project_continuity_passes_with_both_files(tmp_path: Path) -> None:
    project_dir = tmp_path / "projects" / "myproject"
    project_dir.mkdir(parents=True)

    (project_dir / "MYPROJECT-HANDOFF.md").write_text("# Handoff\n\nContext here.")
    (project_dir / "MYPROJECT-UPDATE.txt").write_text("2026-01-01: Initial update")

    result = validate_project_continuity(project_dir)
    assert result["passed"] is True
    assert len(result["missing"]) == 0


def test_project_continuity_detects_missing_handoff(tmp_path: Path) -> None:
    project_dir = tmp_path / "projects" / "myproject"
    project_dir.mkdir(parents=True)

    (project_dir / "MYPROJECT-UPDATE.txt").write_text("2026-01-01: Update")

    result = validate_project_continuity(project_dir)
    assert result["passed"] is False
    assert "HANDOFF.md" in result["missing"][0]


def test_project_continuity_detects_missing_update(tmp_path: Path) -> None:
    project_dir = tmp_path / "projects" / "myproject"
    project_dir.mkdir(parents=True)

    (project_dir / "MYPROJECT-HANDOFF.md").write_text("# Handoff")

    result = validate_project_continuity(project_dir)
    assert result["passed"] is False
    assert "UPDATE.txt" in result["missing"][0]


def test_project_continuity_detects_both_missing(tmp_path: Path) -> None:
    project_dir = tmp_path / "projects" / "myproject"
    project_dir.mkdir(parents=True)

    result = validate_project_continuity(project_dir)
    assert result["passed"] is False
    assert len(result["missing"]) == 2


def test_project_continuity_accepts_short_form_handoff(tmp_path: Path) -> None:
    project_dir = tmp_path / "projects" / "myproject"
    project_dir.mkdir(parents=True)

    (project_dir / "HANDOFF.md").write_text("# Handoff")
    (project_dir / "UPDATE.txt").write_text("2026-01-01: Update")

    result = validate_project_continuity(project_dir)
    assert result["passed"] is True


def test_project_continuity_accepts_generated_canonical_projects(tmp_path: Path) -> None:
    workspace = tmp_path
    (workspace / ".harness" / "state").mkdir(parents=True)
    (workspace / ".harness" / "state" / "setup.json").write_text("{}")
    (workspace / ".harness" / "state" / "analysis.json").write_text(
        '{"confirmed_projects": [{"path": "projects/api"}], "inventory": {"project_boundaries": ["api"]}}'
    )
    (workspace / "AGENTS.md").write_text("# Agents")
    project_dir = workspace / "projects" / "api"
    project_dir.mkdir(parents=True)
    (project_dir / "HANDOFF.md").write_text("# Handoff")
    (project_dir / "UPDATE.txt").write_text("2026-01-01: Update")

    result = validate_project_continuity(workspace)

    assert result["passed"] is True
    assert result["missing"] == []
    assert result["note"] == "generated workspace continuity checked per confirmed project"


def test_project_continuity_flags_generated_project_missing_update(tmp_path: Path) -> None:
    workspace = tmp_path
    (workspace / ".harness" / "state").mkdir(parents=True)
    (workspace / ".harness" / "state" / "setup.json").write_text(
        '{"confirmed_projects": [{"path": "projects/api"}]}'
    )
    (workspace / ".harness" / "state" / "analysis.json").write_text(
        '{"confirmed_projects": [], "inventory": {"project_boundaries": ["api"]}}'
    )
    (workspace / "AGENTS.md").write_text("# Agents")
    project_dir = workspace / "projects" / "api"
    project_dir.mkdir(parents=True)
    (project_dir / "HANDOFF.md").write_text("# Handoff")

    result = validate_project_continuity(workspace)

    assert result["passed"] is False
    assert result["missing"] == ["projects/api: missing UPDATE.txt"]


def test_project_continuity_detects_empty_handoff(tmp_path: Path) -> None:
    project_dir = tmp_path / "projects" / "myproject"
    project_dir.mkdir(parents=True)

    (project_dir / "MYPROJECT-HANDOFF.md").write_text("")
    (project_dir / "MYPROJECT-UPDATE.txt").write_text("2026-01-01: Update")

    result = validate_project_continuity(project_dir)
    assert result["passed"] is False
    assert any("empty" in m.lower() for m in result["missing"])


def test_project_continuity_not_applicable_for_package_source(tmp_path: Path) -> None:
    package_dir = tmp_path / "distributable-harness"
    (package_dir / "src" / "agentos_harness").mkdir(parents=True)
    (package_dir / "pyproject.toml").write_text(
        '[project]\nname = "distributable-harness"\n',
        encoding="utf-8",
    )
    result = validate_project_continuity(package_dir)
    assert result["passed"] is True
    assert result["not_applicable"] is True
    assert "publishable package source" in result["reason"]


# --- validate_plan_completeness tests ---


def test_plan_completeness_passes_all_done(tmp_path: Path) -> None:
    plans_dir = tmp_path / "plans" / "active"
    plans_dir.mkdir(parents=True)

    plan_content = """# Test Plan

## Work Chunks

### WC-01: First chunk
- status: done

### WC-02: Second chunk
- status: done
"""
    (plans_dir / "test_plan.md").write_text(plan_content)

    result = validate_plan_completeness(plans_dir)
    assert result["passed"] is True
    assert len(result["incomplete_chunks"]) == 0


def test_plan_completeness_detects_pending_chunks(tmp_path: Path) -> None:
    plans_dir = tmp_path / "plans" / "active"
    plans_dir.mkdir(parents=True)

    plan_content = """# Test Plan

## Work Chunks

### WC-01: First chunk
- status: done

### WC-02: Second chunk
- status: pending
"""
    (plans_dir / "test_plan.md").write_text(plan_content)

    result = validate_plan_completeness(plans_dir)
    assert result["passed"] is False
    assert any("WC-02" in c for c in result["incomplete_chunks"])


def test_plan_completeness_detects_in_progress_chunks(tmp_path: Path) -> None:
    plans_dir = tmp_path / "plans" / "active"
    plans_dir.mkdir(parents=True)

    plan_content = """# Test Plan

## Work Chunks

### WC-01: First chunk
- status: in-progress
"""
    (plans_dir / "test_plan.md").write_text(plan_content)

    result = validate_plan_completeness(plans_dir)
    assert result["passed"] is False
    assert any("WC-01" in c for c in result["incomplete_chunks"])


def test_plan_completeness_handles_no_plans(tmp_path: Path) -> None:
    plans_dir = tmp_path / "plans" / "active"
    plans_dir.mkdir(parents=True)

    result = validate_plan_completeness(plans_dir)
    assert result["passed"] is True
    assert len(result["incomplete_chunks"]) == 0


def test_plan_completeness_handles_multiple_plans(tmp_path: Path) -> None:
    plans_dir = tmp_path / "plans" / "active"
    plans_dir.mkdir(parents=True)

    plan1 = """# Plan 1

### WC-01: Chunk 1
- status: done
"""
    plan2 = """# Plan 2

### WC-01: Chunk 1
- status: pending
"""
    (plans_dir / "plan1.md").write_text(plan1)
    (plans_dir / "plan2.md").write_text(plan2)

    result = validate_plan_completeness(plans_dir)
    assert result["passed"] is False


def test_engineering_quality_contract_detects_missing_contract(tmp_path: Path) -> None:
    plans_dir = tmp_path / "plans" / "active"
    plans_dir.mkdir(parents=True)
    (plans_dir / "test_plan.md").write_text("# Plan\n\n## Overview\nTest\n", encoding="utf-8")
    result = validate_engineering_quality_contract(plans_dir)
    assert result["passed"] is False
    assert any("Engineering Quality Contract" in violation for violation in result["violations"])


def test_engineering_quality_contract_passes_complete_plan(tmp_path: Path) -> None:
    plans_dir = tmp_path / "plans" / "active"
    plans_dir.mkdir(parents=True)
    content = """# Plan

## Overview
Overview

## Current State
Current

## Target State
Target

## Engineering Quality Contract
### Assumptions And Ambiguity
None
### Simplicity Rationale
Simple
### Surgical Scope
Scoped
### Verification Contract
Verify
### Final Output Requirements
Update file behavior
### Narrative, Prose, And Visual Requirements
None
### Behavior, Function, Interactivity, Display, Style, Look, Feel, And Tone
Behavior
### Context Receipt Requirements For All Agents
Required
### MoE Plan Consensus Requirement
MoE plan consensus
"""
    (plans_dir / "test_plan.md").write_text(content, encoding="utf-8")
    result = validate_engineering_quality_contract(plans_dir)
    assert result["passed"] is True


def test_execution_receipts_detect_missing_receipt(tmp_path: Path) -> None:
    plans_dir = tmp_path / "plans" / "active"
    plans_dir.mkdir(parents=True)
    content = """# Plan

### WC-01: Chunk
- status: done
"""
    (plans_dir / "test_plan.md").write_text(content, encoding="utf-8")
    result = validate_execution_receipts(plans_dir)
    assert result["passed"] is False
    assert any("missing Engineering Quality Receipt" in violation for violation in result["violations"])


def test_execution_receipts_pass_with_complete_receipt(tmp_path: Path) -> None:
    plans_dir = tmp_path / "plans" / "active"
    plans_dir.mkdir(parents=True)
    content = """# Plan

### WC-01: Chunk
- status: done
### Engineering Quality Receipt
Context consulted
Assumptions checked
Files changed
Validation run
Review gates run
Remaining gaps
"""
    (plans_dir / "test_plan.md").write_text(content, encoding="utf-8")
    result = validate_execution_receipts(plans_dir)
    assert result["passed"] is True


# --- run_all_validations tests ---


def test_run_all_validations_aggregates_results(tmp_path: Path) -> None:
    project_dir = tmp_path / "projects" / "myproject"
    project_dir.mkdir(parents=True)

    (project_dir / "MYPROJECT-HANDOFF.md").write_text("# Handoff")
    (project_dir / "MYPROJECT-UPDATE.txt").write_text("Update")

    src = project_dir / "src" / "app.py"
    src.parent.mkdir(parents=True)
    src.write_text("def main(): pass\n")

    plans_dir = project_dir / "plans" / "active"
    plans_dir.mkdir(parents=True)

    results = run_all_validations(project_dir, plans_dir)

    assert "100pct_rule" in results
    assert "project_continuity" in results
    assert "plan_completeness" in results
    assert "engineering_quality_contract" in results
    assert "execution_receipts" in results


def test_run_all_validations_all_pass(tmp_path: Path) -> None:
    project_dir = tmp_path / "projects" / "myproject"
    project_dir.mkdir(parents=True)

    (project_dir / "MYPROJECT-HANDOFF.md").write_text("# Handoff")
    (project_dir / "MYPROJECT-UPDATE.txt").write_text("Update")

    src = project_dir / "src" / "app.py"
    src.parent.mkdir(parents=True)
    src.write_text("def main(): pass\n")

    plans_dir = project_dir / "plans" / "active"
    plans_dir.mkdir(parents=True)

    results = run_all_validations(project_dir, plans_dir)

    assert results["100pct_rule"]["passed"] is True
    assert results["project_continuity"]["passed"] is True
    assert results["plan_completeness"]["passed"] is True


def test_run_all_validations_mixed_results(tmp_path: Path) -> None:
    project_dir = tmp_path / "projects" / "myproject"
    project_dir.mkdir(parents=True)

    (project_dir / "MYPROJECT-HANDOFF.md").write_text("# Handoff")
    (project_dir / "MYPROJECT-UPDATE.txt").write_text("Update")

    src = project_dir / "src" / "app.py"
    src.parent.mkdir(parents=True)
    src.write_text("def main():\n    # TODO: implement\n    pass\n")

    plans_dir = project_dir / "plans" / "active"
    plans_dir.mkdir(parents=True)

    results = run_all_validations(project_dir, plans_dir)

    assert results["100pct_rule"]["passed"] is False
    assert results["project_continuity"]["passed"] is True


def _create_valid_wiki_workspace(workspace: Path) -> None:
    """Create a valid wiki structure for testing."""
    wiki_root = workspace / ".claude" / "wiki"
    wiki_root.mkdir(parents=True)
    (wiki_root / "wiki" / "systems").mkdir(parents=True)
    (wiki_root / "wiki" / "projects").mkdir(parents=True)
    (wiki_root / "wiki" / "changes").mkdir(parents=True)

    index_content = """# Wiki Index

Last updated: 2026-05-04T00:00:00Z

## Systems
- No systems yet

## Projects
- No projects yet

## Changes
- None yet
"""
    (wiki_root / "index.md").write_text(index_content)

    log_content = """# Wiki Log

## 2026-05-04T00:00:00Z | wiki-init
Initialized wiki.
"""
    (wiki_root / "log.md").write_text(log_content)

    settings_dir = workspace / ".claude" / "state" / "config"
    settings_dir.mkdir(parents=True)
    (settings_dir / "wiki_settings.json").write_text(json.dumps({
        "version": "1.0",
        "wiki_root": ".claude/wiki",
        "wiki_families": ["systems", "projects", "changes"],
    }))

    backlog_dir = workspace / ".claude" / "state" / "curation"
    backlog_dir.mkdir(parents=True)
    (backlog_dir / "wiki_maintenance_backlog.json").write_text(json.dumps({
        "version": "1.0",
        "items": [],
    }))


def test_run_all_validations_includes_wiki_state(tmp_path: Path) -> None:
    """run_all_validations includes wiki_state check."""
    project_dir = tmp_path / "projects" / "myproject"
    project_dir.mkdir(parents=True)

    (project_dir / "MYPROJECT-HANDOFF.md").write_text("# Handoff")
    (project_dir / "MYPROJECT-UPDATE.txt").write_text("Update")

    _create_valid_wiki_workspace(tmp_path)

    results = run_all_validations(project_dir, workspace_dir=tmp_path)

    assert "wiki_state" in results
    assert "passed" in results["wiki_state"]


def test_run_all_validations_includes_workspace_hygiene(tmp_path: Path) -> None:
    """run_all_validations includes workspace_hygiene check."""
    project_dir = tmp_path / "projects" / "myproject"
    project_dir.mkdir(parents=True)

    (project_dir / "MYPROJECT-HANDOFF.md").write_text("# Handoff")
    (project_dir / "MYPROJECT-UPDATE.txt").write_text("Update")

    _create_valid_wiki_workspace(tmp_path)

    results = run_all_validations(project_dir, workspace_dir=tmp_path)

    assert "workspace_hygiene" in results
    assert "passed" in results["workspace_hygiene"]


def test_run_all_validations_all_passed_key(tmp_path: Path) -> None:
    """run_all_validations includes all_passed key."""
    project_dir = tmp_path / "projects" / "myproject"
    project_dir.mkdir(parents=True)

    (project_dir / "MYPROJECT-HANDOFF.md").write_text("# Handoff")
    (project_dir / "MYPROJECT-UPDATE.txt").write_text("Update")

    src = project_dir / "src" / "app.py"
    src.parent.mkdir(parents=True)
    src.write_text("def main(): pass\n")

    plans_dir = project_dir / "plans" / "active"
    plans_dir.mkdir(parents=True)

    _create_valid_wiki_workspace(tmp_path)

    results = run_all_validations(project_dir, plans_dir, workspace_dir=tmp_path)

    assert "all_passed" in results
    assert results["all_passed"] is True


def test_run_all_validations_skips_wiki_when_no_generated_wiki_contract(tmp_path: Path) -> None:
    """all_passed can pass when the target has no generated wiki contract."""
    project_dir = tmp_path / "projects" / "myproject"
    project_dir.mkdir(parents=True)

    (project_dir / "MYPROJECT-HANDOFF.md").write_text("# Handoff")
    (project_dir / "MYPROJECT-UPDATE.txt").write_text("Update")

    results = run_all_validations(project_dir, workspace_dir=tmp_path)

    assert results["all_passed"] is True
    assert results["wiki_state"]["passed"] is True
    assert results["wiki_state"]["not_applicable"] is True


def test_run_all_validations_all_passed_false_when_present_wiki_fails(tmp_path: Path) -> None:
    """all_passed is False when an applied wiki surface is broken."""
    project_dir = tmp_path / "projects" / "myproject"
    project_dir.mkdir(parents=True)

    (project_dir / "MYPROJECT-HANDOFF.md").write_text("# Handoff")
    (project_dir / "MYPROJECT-UPDATE.txt").write_text("Update")
    wiki_root = tmp_path / ".claude" / "wiki"
    wiki_root.mkdir(parents=True)
    (wiki_root / "index.md").write_text("# Wiki Index\n")

    results = run_all_validations(project_dir, workspace_dir=tmp_path)

    assert results["all_passed"] is False
    assert results["wiki_state"]["passed"] is False
    assert "missing log.md" in results["wiki_state"]["issues"]


def test_workspace_requires_wiki_validation_for_generated_setup_state(tmp_path: Path) -> None:
    state_dir = tmp_path / ".harness" / "state"
    state_dir.mkdir(parents=True)
    (state_dir / "setup.json").write_text("{}")

    assert _workspace_requires_wiki_validation(tmp_path) is True
