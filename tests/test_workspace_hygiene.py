"""Tests for workspace_hygiene module."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agentos_harness.workspace_hygiene import (
    check_workspace_hygiene,
    _check_hook_registration,
    _check_skill_compliance,
)


def _create_minimal_workspace(workspace: Path) -> None:
    """Create minimal workspace structure for testing."""
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

    state_dir = workspace / ".claude" / "state"
    (state_dir / "config").mkdir(parents=True)
    (state_dir / "curation").mkdir(parents=True)

    (state_dir / "config" / "wiki_settings.json").write_text(json.dumps({
        "version": "1.0",
        "wiki_root": ".claude/wiki",
        "wiki_families": ["systems", "projects", "changes"],
    }))

    (state_dir / "curation" / "wiki_maintenance_backlog.json").write_text(json.dumps({
        "version": "1.0",
        "items": [],
    }))


class TestCheckWorkspaceHygiene:
    """Tests for check_workspace_hygiene function."""

    def test_passes_minimal_valid_workspace(self, tmp_path: Path) -> None:
        """Passes minimal valid workspace."""
        _create_minimal_workspace(tmp_path)
        result = check_workspace_hygiene(tmp_path)
        assert result["passed"] is True
        assert result["issue_count"] == 0

    def test_returns_structured_dict(self, tmp_path: Path) -> None:
        """Returns structured dict with all expected keys."""
        _create_minimal_workspace(tmp_path)
        result = check_workspace_hygiene(tmp_path)
        assert "passed" in result
        assert "issue_count" in result
        assert "issues" in result
        assert "wiki_lint_issues" in result
        assert "skill_compliance" in result
        assert "hook_status" in result
        assert "wiki_state" in result
        assert "maintenance_status" in result

    def test_includes_wiki_lint_issues(self, tmp_path: Path) -> None:
        """Includes wiki lint issues in results."""
        _create_minimal_workspace(tmp_path)
        result = check_workspace_hygiene(tmp_path)
        assert "wiki_lint_issues" in result
        assert isinstance(result["wiki_lint_issues"], list)

    def test_includes_skill_compliance(self, tmp_path: Path) -> None:
        """Includes skill compliance check results."""
        _create_minimal_workspace(tmp_path)
        result = check_workspace_hygiene(tmp_path)
        assert "skill_compliance" in result
        assert "passed" in result["skill_compliance"]
        assert "issues" in result["skill_compliance"]

    def test_includes_hook_status(self, tmp_path: Path) -> None:
        """Includes hook registration status."""
        _create_minimal_workspace(tmp_path)
        result = check_workspace_hygiene(tmp_path)
        assert "hook_status" in result
        assert "registered" in result["hook_status"]
        assert "missing" in result["hook_status"]

    def test_includes_wiki_state(self, tmp_path: Path) -> None:
        """Includes wiki state validation."""
        _create_minimal_workspace(tmp_path)
        result = check_workspace_hygiene(tmp_path)
        assert "wiki_state" in result
        assert "passed" in result["wiki_state"]

    def test_includes_maintenance_status(self, tmp_path: Path) -> None:
        """Includes maintenance status."""
        _create_minimal_workspace(tmp_path)
        result = check_workspace_hygiene(tmp_path)
        assert "maintenance_status" in result

    def test_fails_with_lint_issues(self, tmp_path: Path) -> None:
        """Fails when wiki lint issues exist."""
        _create_minimal_workspace(tmp_path)
        wiki_root = tmp_path / ".claude" / "wiki"
        (wiki_root / "index.md").write_text("# Index\n\n[Broken](wiki/missing.md)\n")
        result = check_workspace_hygiene(tmp_path)
        assert result["passed"] is False
        assert any("wiki lint" in issue for issue in result["issues"])


class TestCheckSkillCompliance:
    """Tests for _check_skill_compliance function."""

    def test_passes_with_no_skills_json(self, tmp_path: Path) -> None:
        """Passes when no skills.json exists."""
        result = _check_skill_compliance(tmp_path)
        assert result["passed"] is True
        assert result["issues"] == []

    def test_passes_valid_bundled_skill(self, tmp_path: Path) -> None:
        """Passes for bundled skills."""
        (tmp_path / ".harness").mkdir()
        (tmp_path / ".harness" / "skills.json").write_text(json.dumps([
            {"name": "loop", "path": "bundled:loop", "description": "Loop skill"}
        ]))
        result = _check_skill_compliance(tmp_path)
        assert result["passed"] is True
        assert "loop" in result["registered_skills"]

    def test_passes_valid_project_skill(self, tmp_path: Path) -> None:
        """Passes for valid projectSettings skill."""
        (tmp_path / ".harness").mkdir()
        (tmp_path / ".harness" / "skills.json").write_text(json.dumps([
            {"name": "test-skill", "path": "projectSettings:test-skill", "description": "Test"}
        ]))
        skill_dir = tmp_path / ".harness" / "skills" / "test-skill"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text("# Test Skill\n")
        result = _check_skill_compliance(tmp_path)
        assert result["passed"] is True

    def test_fails_missing_skill_directory(self, tmp_path: Path) -> None:
        """Fails when skill directory is missing."""
        (tmp_path / ".harness").mkdir()
        (tmp_path / ".harness" / "skills.json").write_text(json.dumps([
            {"name": "test-skill", "path": "projectSettings:test-skill", "description": "Test"}
        ]))
        result = _check_skill_compliance(tmp_path)
        assert result["passed"] is False
        assert any("missing skill directory" in issue for issue in result["issues"])

    def test_fails_missing_skill_md(self, tmp_path: Path) -> None:
        """Fails when SKILL.md is missing."""
        (tmp_path / ".harness").mkdir()
        (tmp_path / ".harness" / "skills.json").write_text(json.dumps([
            {"name": "test-skill", "path": "projectSettings:test-skill", "description": "Test"}
        ]))
        skill_dir = tmp_path / ".harness" / "skills" / "test-skill"
        skill_dir.mkdir(parents=True)
        result = _check_skill_compliance(tmp_path)
        assert result["passed"] is False
        assert any("missing SKILL.md" in issue for issue in result["issues"])

    def test_fails_invalid_json(self, tmp_path: Path) -> None:
        """Fails with invalid skills.json."""
        (tmp_path / ".harness").mkdir()
        (tmp_path / ".harness" / "skills.json").write_text("not valid json")
        result = _check_skill_compliance(tmp_path)
        assert result["passed"] is False
        assert any("invalid JSON" in issue for issue in result["issues"])


class TestCheckHookRegistration:
    """Tests for _check_hook_registration function."""

    def test_passes_with_no_hooks(self, tmp_path: Path) -> None:
        """Passes when no hooks exist."""
        result = _check_hook_registration(tmp_path)
        assert result["passed"] is True

    def test_passes_registered_hook(self, tmp_path: Path) -> None:
        """Passes when hook is properly registered."""
        (tmp_path / ".harness" / "hooks" / "pre").mkdir(parents=True)
        (tmp_path / ".harness" / "hooks" / "pre" / "test_hook.py").write_text("# hook")
        (tmp_path / ".harness" / "settings.json").write_text(json.dumps({
            "hooks": {
                "preToolUse": [
                    {"command": "python .harness/hooks/pre/test_hook.py"}
                ]
            }
        }))
        result = _check_hook_registration(tmp_path)
        assert result["passed"] is True
        assert "test_hook.py" in result["registered"]

    def test_fails_unregistered_hook(self, tmp_path: Path) -> None:
        """Fails when hook file exists but is not registered."""
        (tmp_path / ".harness" / "hooks" / "pre").mkdir(parents=True)
        (tmp_path / ".harness" / "hooks" / "pre" / "unregistered.py").write_text("# hook")
        (tmp_path / ".harness" / "settings.json").write_text(json.dumps({
            "hooks": {}
        }))
        result = _check_hook_registration(tmp_path)
        assert result["passed"] is False
        assert "unregistered.py" in result["missing"]
        assert any("not registered" in issue for issue in result["issues"])

    def test_fails_hook_without_settings(self, tmp_path: Path) -> None:
        """Fails when hook exists but no settings.json."""
        (tmp_path / ".harness" / "hooks" / "pre").mkdir(parents=True)
        (tmp_path / ".harness" / "hooks" / "pre" / "orphan.py").write_text("# hook")
        result = _check_hook_registration(tmp_path)
        assert result["passed"] is False
        assert "orphan.py" in result["missing"]

    def test_handles_post_hooks(self, tmp_path: Path) -> None:
        """Handles postToolUse hooks."""
        (tmp_path / ".harness" / "hooks" / "post").mkdir(parents=True)
        (tmp_path / ".harness" / "hooks" / "post" / "post_hook.py").write_text("# hook")
        (tmp_path / ".harness" / "settings.json").write_text(json.dumps({
            "hooks": {
                "postToolUse": [
                    {"command": "python .harness/hooks/post/post_hook.py"}
                ]
            }
        }))
        result = _check_hook_registration(tmp_path)
        assert result["passed"] is True
        assert "post_hook.py" in result["registered"]
