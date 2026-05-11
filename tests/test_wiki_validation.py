"""Tests for wiki_validation module."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agentos_harness.wiki_validation import validate_wiki_state


def _create_valid_wiki_structure(workspace: Path) -> None:
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


class TestValidateWikiState:
    """Tests for validate_wiki_state function."""

    def test_passes_valid_wiki_structure(self, tmp_path: Path) -> None:
        """Passes valid wiki structure."""
        _create_valid_wiki_structure(tmp_path)
        result = validate_wiki_state(tmp_path)
        assert result["passed"] is True
        assert result["issue_count"] == 0
        assert result["index_valid"] is True
        assert result["log_valid"] is True
        assert result["backlog_valid"] is True
        assert result["settings_valid"] is True

    def test_fails_missing_index(self, tmp_path: Path) -> None:
        """Fails missing index.md."""
        _create_valid_wiki_structure(tmp_path)
        (tmp_path / ".claude" / "wiki" / "index.md").unlink()
        result = validate_wiki_state(tmp_path)
        assert result["passed"] is False
        assert result["index_valid"] is False
        assert "missing index.md" in result["issues"]

    def test_fails_missing_log(self, tmp_path: Path) -> None:
        """Fails missing log.md."""
        _create_valid_wiki_structure(tmp_path)
        (tmp_path / ".claude" / "wiki" / "log.md").unlink()
        result = validate_wiki_state(tmp_path)
        assert result["passed"] is False
        assert result["log_valid"] is False
        assert "missing log.md" in result["issues"]

    def test_fails_missing_family_sections_in_index(self, tmp_path: Path) -> None:
        """Fails missing family sections in index."""
        _create_valid_wiki_structure(tmp_path)
        (tmp_path / ".claude" / "wiki" / "index.md").write_text("# Wiki\n\nNo sections.\n")
        result = validate_wiki_state(tmp_path)
        assert result["passed"] is False
        assert result["index_valid"] is False
        assert any("missing family section" in issue for issue in result["issues"])

    def test_fails_no_log_entries(self, tmp_path: Path) -> None:
        """Fails no log entries."""
        _create_valid_wiki_structure(tmp_path)
        (tmp_path / ".claude" / "wiki" / "log.md").write_text("# Wiki Log\n\nEmpty.\n")
        result = validate_wiki_state(tmp_path)
        assert result["passed"] is False
        assert result["log_valid"] is False
        assert any("no parseable log entries" in issue for issue in result["issues"])

    def test_includes_lint_issues(self, tmp_path: Path) -> None:
        """Includes lint issues in results."""
        _create_valid_wiki_structure(tmp_path)
        result = validate_wiki_state(tmp_path)
        assert "lint_issues" in result
        assert isinstance(result["lint_issues"], list)

    def test_fails_invalid_backlog_json(self, tmp_path: Path) -> None:
        """Fails invalid backlog JSON."""
        _create_valid_wiki_structure(tmp_path)
        backlog_path = tmp_path / ".claude" / "state" / "curation" / "wiki_maintenance_backlog.json"
        backlog_path.write_text("not valid json")
        result = validate_wiki_state(tmp_path)
        assert result["passed"] is False
        assert result["backlog_valid"] is False
        assert any("invalid JSON" in issue for issue in result["issues"])

    def test_fails_invalid_settings_json(self, tmp_path: Path) -> None:
        """Fails invalid settings JSON."""
        _create_valid_wiki_structure(tmp_path)
        settings_path = tmp_path / ".claude" / "state" / "config" / "wiki_settings.json"
        settings_path.write_text("not valid json")
        result = validate_wiki_state(tmp_path)
        assert result["passed"] is False
        assert result["settings_valid"] is False
        assert any("invalid JSON" in issue for issue in result["issues"])

    def test_handles_missing_wiki_root(self, tmp_path: Path) -> None:
        """Handles missing wiki root."""
        result = validate_wiki_state(tmp_path)
        assert result["passed"] is False
        assert result["index_valid"] is False
        assert result["log_valid"] is False

    def test_returns_structured_dict(self, tmp_path: Path) -> None:
        """Returns structured dict."""
        _create_valid_wiki_structure(tmp_path)
        result = validate_wiki_state(tmp_path)
        assert "passed" in result
        assert "issue_count" in result
        assert "issues" in result
        assert "index_valid" in result
        assert "log_valid" in result
        assert "lint_issues" in result
        assert "backlog_valid" in result
        assert "settings_valid" in result
