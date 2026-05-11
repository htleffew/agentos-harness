"""Tests for skill index generation."""
from __future__ import annotations

import pytest
from pathlib import Path

from agentos_harness.profile_registry import (
    _skill_index,
    render_profile,
)
from agentos_harness.wiki import build_skill_index


def _base_analysis() -> dict:
    return {
        "moe_tier": "claude-only",
        "confirmed_projects": [],
        "detected_tools": {"claude": True, "codex": False, "gemini": False},
        "suggested_projects": [],
        "workspace": {"display_name": "sample-repo", "root": "/tmp/sample"},
        "inventory": {
            "languages": ["Python"],
            "package_managers": ["python"],
            "test_commands": ["python -m pytest"],
            "build_commands": [],
            "docs": ["README.md"],
            "source_dirs": ["src"],
            "project_boundaries": ["."],
            "agent_files": [],
            "ci_files": [],
            "notebooks": [],
            "publication_dirs": [],
            "generated_dirs": [],
            "scripts": [],
        },
        "files": [],
        "schema_version": "1.0",
        "analysis_hash": "testhash",
    }


def test_skill_index_generated_in_targets() -> None:
    """CORE_PROFILE_TARGETS includes skill-index.md."""
    analysis = _base_analysis()
    rendered = render_profile(analysis)
    assert ".claude/wiki/wiki/reference/skill-index.md" in rendered


def test_skill_index_has_summary_section() -> None:
    """Generated markdown has ## Summary."""
    analysis = _base_analysis()
    ctx = {"display_name": "test-repo"}
    content = _skill_index(ctx)
    assert "## Summary" in content


def test_skill_index_has_authority_section() -> None:
    """Generated markdown has ## Authority And Recency."""
    analysis = _base_analysis()
    ctx = {"display_name": "test-repo"}
    content = _skill_index(ctx)
    assert "## Authority And Recency" in content


def test_skill_index_has_source_artifacts_section() -> None:
    """Generated markdown has ## Source Artifacts."""
    analysis = _base_analysis()
    ctx = {"display_name": "test-repo"}
    content = _skill_index(ctx)
    assert "## Source Artifacts" in content


def test_skill_index_has_related_pages_section() -> None:
    """Generated markdown has ## Related Pages."""
    analysis = _base_analysis()
    ctx = {"display_name": "test-repo"}
    content = _skill_index(ctx)
    assert "## Related Pages" in content


def test_skill_index_has_workflow_skills_table() -> None:
    """Generated markdown has ## Workflow Skills with table."""
    analysis = _base_analysis()
    ctx = {"display_name": "test-repo"}
    content = _skill_index(ctx)
    assert "## Workflow Skills" in content
    assert "| Name | Trigger |" in content


def test_skill_index_trigger_max_15_words() -> None:
    """Each trigger phrase is 15 words or fewer."""
    analysis = _base_analysis()
    ctx = {"display_name": "test-repo"}
    content = _skill_index(ctx)
    lines = content.split("\n")
    for line in lines:
        if line.startswith("|") and "Trigger" not in line and "---" not in line:
            parts = line.split("|")
            if len(parts) >= 3:
                trigger = parts[2].strip()
                word_count = len(trigger.split())
                assert word_count <= 15, f"Trigger too long: {trigger}"


def test_skill_index_no_em_dashes() -> None:
    """Generated markdown contains no em-dashes."""
    analysis = _base_analysis()
    ctx = {"display_name": "test-repo"}
    content = _skill_index(ctx)
    assert "—" not in content, "Em-dash found in skill index"
    assert "–" not in content, "En-dash found in skill index"


def test_wiki_build_skill_index_creates_file(tmp_path: Path) -> None:
    """CLI command creates skill-index.md."""
    skills_dir = tmp_path / ".claude" / "skills" / "test-skill"
    skills_dir.mkdir(parents=True)
    skill_md = skills_dir / "SKILL.md"
    skill_md.write_text(
        "---\nname: test-skill\ndescription: Test skill for testing.\n---\n\nTest body."
    )

    wiki_dir = tmp_path / ".claude" / "wiki" / "wiki" / "reference"
    wiki_dir.mkdir(parents=True)

    result = build_skill_index(tmp_path)

    assert result["skills_found"] == 1
    assert result["skills_indexed"] == 1
    skill_index_path = tmp_path / ".claude" / "wiki" / "wiki" / "reference" / "skill-index.md"
    assert skill_index_path.exists()


def test_wiki_build_skill_index_updates_index(tmp_path: Path) -> None:
    """CLI command updates wiki index.md with Reference section."""
    skills_dir = tmp_path / ".claude" / "skills" / "test-skill"
    skills_dir.mkdir(parents=True)
    skill_md = skills_dir / "SKILL.md"
    skill_md.write_text(
        "---\nname: test-skill\ndescription: Test skill for testing.\n---\n\nTest body."
    )

    wiki_dir = tmp_path / ".claude" / "wiki"
    wiki_dir.mkdir(parents=True)
    (wiki_dir / "wiki" / "reference").mkdir(parents=True)

    index_md = wiki_dir / "index.md"
    index_md.write_text("# Wiki Index\n\n## Start Here\n\n## Maintenance\n\nUpdate regularly.")

    result = build_skill_index(tmp_path)

    updated_index = index_md.read_text()
    assert "## Reference" in updated_index
    assert "skill-index.md" in updated_index
