"""Tests for wiki_validator module."""

import tempfile
from pathlib import Path

import pytest

from agentos_harness.wiki_validator import (
    ValidationResult,
    validate_wiki_structure,
    DEFAULT_WIKI_FAMILIES,
    REQUIRED_SECTIONS,
)


@pytest.fixture
def temp_workspace():
    """Create a temporary workspace directory."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


def _create_wiki_structure(workspace: Path) -> Path:
    """Create a basic valid wiki structure."""
    wiki_root = workspace / ".claude" / "wiki"
    wiki_root.mkdir(parents=True, exist_ok=True)

    # Create index.md with family sections
    index_content = "# Wiki Index\n\n"
    for family in DEFAULT_WIKI_FAMILIES:
        index_content += f"## {family}\n\nPages for {family}.\n\n"
    (wiki_root / "index.md").write_text(index_content)

    # Create log.md
    log_content = "# Wiki Log\n\n## 2026-01-01T00:00:00Z | initial-setup\n\nInitial wiki setup.\n"
    (wiki_root / "log.md").write_text(log_content)

    # Create wiki directory with family subdirs
    wiki_dir = wiki_root / "wiki"
    wiki_dir.mkdir(exist_ok=True)
    for family in DEFAULT_WIKI_FAMILIES:
        (wiki_dir / family).mkdir(exist_ok=True)

    return wiki_root


def _create_valid_wiki_page(page_path: Path, related_page: str | None = None) -> None:
    """Create a valid wiki page with all required sections."""
    content = f"""# {page_path.stem}

## Summary

This is a summary of the page.

## Authority And Recency

Last updated: 2026-01-01

## Source Artifacts

- artifact1.py
- artifact2.py

## Related Pages

"""
    if related_page:
        content += f"- [{related_page}]({related_page})\n"

    page_path.parent.mkdir(parents=True, exist_ok=True)
    page_path.write_text(content)


class TestValidationResult:
    """Tests for ValidationResult dataclass."""

    def test_create_validation_result(self):
        """Test creating a ValidationResult."""
        result = ValidationResult(
            path="/some/path",
            check="test_check",
            status="pass",
            message="Test passed",
        )
        assert result.path == "/some/path"
        assert result.check == "test_check"
        assert result.status == "pass"
        assert result.message == "Test passed"


class TestEmptyWorkspace:
    """Tests for empty workspace validation."""

    def test_empty_workspace_returns_wiki_root_error(self, temp_workspace):
        """Empty workspace returns error for missing wiki root."""
        results = validate_wiki_structure(temp_workspace)

        assert len(results) >= 1
        error_results = [r for r in results if r.status == "error"]
        assert any("Wiki root does not exist" in r.message for r in error_results)

    def test_empty_workspace_stops_early(self, temp_workspace):
        """Empty workspace validation stops after wiki root check."""
        results = validate_wiki_structure(temp_workspace)

        # Should only have the wiki root error
        assert len(results) == 1
        assert results[0].check == "wiki_root_exists"
        assert results[0].status == "error"


class TestValidWikiStructure:
    """Tests for valid wiki structure."""

    def test_valid_structure_passes(self, temp_workspace):
        """Valid wiki structure passes all checks."""
        _create_wiki_structure(temp_workspace)

        results = validate_wiki_structure(temp_workspace)

        # Should have pass results for root, index, log
        pass_results = [r for r in results if r.status == "pass"]
        assert len(pass_results) >= 3

        # Check specific passes
        assert any(r.check == "wiki_root_exists" for r in pass_results)
        assert any(r.check == "index_exists" for r in pass_results)
        assert any(r.check == "log_exists" for r in pass_results)

    def test_valid_page_passes(self, temp_workspace):
        """Valid wiki page passes required section checks."""
        wiki_root = _create_wiki_structure(temp_workspace)
        page_path = wiki_root / "wiki" / "projects" / "test_page.md"
        _create_valid_wiki_page(page_path)

        results = validate_wiki_structure(temp_workspace)

        # Should have no errors for required sections
        section_errors = [
            r for r in results if r.check == "required_section" and r.status == "error"
        ]
        assert len(section_errors) == 0


class TestMissingIndexMd:
    """Tests for missing index.md detection."""

    def test_missing_index_detected(self, temp_workspace):
        """Missing index.md is detected."""
        wiki_root = temp_workspace / ".claude" / "wiki"
        wiki_root.mkdir(parents=True, exist_ok=True)
        (wiki_root / "log.md").write_text("# Log\n")

        results = validate_wiki_structure(temp_workspace)

        error_results = [r for r in results if r.status == "error"]
        assert any("Missing index.md" in r.message for r in error_results)


class TestMissingLogMd:
    """Tests for missing log.md detection."""

    def test_missing_log_detected(self, temp_workspace):
        """Missing log.md is detected."""
        wiki_root = temp_workspace / ".claude" / "wiki"
        wiki_root.mkdir(parents=True, exist_ok=True)
        (wiki_root / "index.md").write_text("# Index\n")

        results = validate_wiki_structure(temp_workspace)

        error_results = [r for r in results if r.status == "error"]
        assert any("Missing log.md" in r.message for r in error_results)


class TestMissingRequiredSection:
    """Tests for missing required section detection."""

    def test_missing_summary_detected(self, temp_workspace):
        """Missing Summary section is detected."""
        wiki_root = _create_wiki_structure(temp_workspace)
        page_path = wiki_root / "wiki" / "projects" / "incomplete.md"
        page_path.parent.mkdir(parents=True, exist_ok=True)

        # Create page without Summary section
        content = """# Incomplete Page

## Authority And Recency

Last updated: 2026-01-01

## Source Artifacts

- artifact.py

## Related Pages

None.
"""
        page_path.write_text(content)

        results = validate_wiki_structure(temp_workspace)

        section_errors = [
            r
            for r in results
            if r.check == "required_section"
            and r.status == "error"
            and "Summary" in r.message
        ]
        assert len(section_errors) == 1

    def test_missing_source_artifacts_detected(self, temp_workspace):
        """Missing Source Artifacts section is detected."""
        wiki_root = _create_wiki_structure(temp_workspace)
        page_path = wiki_root / "wiki" / "projects" / "incomplete.md"
        page_path.parent.mkdir(parents=True, exist_ok=True)

        # Create page without Source Artifacts section
        content = """# Incomplete Page

## Summary

This is a summary.

## Authority And Recency

Last updated: 2026-01-01

## Related Pages

None.
"""
        page_path.write_text(content)

        results = validate_wiki_structure(temp_workspace)

        section_errors = [
            r
            for r in results
            if r.check == "required_section"
            and r.status == "error"
            and "Source Artifacts" in r.message
        ]
        assert len(section_errors) == 1


class TestBrokenLinks:
    """Tests for broken link detection."""

    def test_broken_link_detected(self, temp_workspace):
        """Broken markdown link is detected."""
        wiki_root = _create_wiki_structure(temp_workspace)
        page_path = wiki_root / "wiki" / "projects" / "with_broken_link.md"
        page_path.parent.mkdir(parents=True, exist_ok=True)

        content = """# Page With Broken Link

## Summary

See [nonexistent](./nonexistent.md) for more info.

## Authority And Recency

Last updated: 2026-01-01

## Source Artifacts

- artifact.py

## Related Pages

None.
"""
        page_path.write_text(content)

        results = validate_wiki_structure(temp_workspace)

        link_errors = [
            r
            for r in results
            if r.check == "link_resolves"
            and r.status == "error"
            and "nonexistent.md" in r.message
        ]
        assert len(link_errors) == 1

    def test_valid_link_not_flagged(self, temp_workspace):
        """Valid markdown link is not flagged."""
        wiki_root = _create_wiki_structure(temp_workspace)
        page_path = wiki_root / "wiki" / "projects" / "with_valid_link.md"
        target_path = wiki_root / "wiki" / "projects" / "target.md"
        page_path.parent.mkdir(parents=True, exist_ok=True)

        # Create target page
        _create_valid_wiki_page(target_path)

        content = """# Page With Valid Link

## Summary

See [target](./target.md) for more info.

## Authority And Recency

Last updated: 2026-01-01

## Source Artifacts

- artifact.py

## Related Pages

None.
"""
        page_path.write_text(content)

        results = validate_wiki_structure(temp_workspace)

        link_errors = [
            r
            for r in results
            if r.check == "link_resolves"
            and r.status == "error"
            and "target.md" in r.message
        ]
        assert len(link_errors) == 0


class TestSourceArtifactCount:
    """Tests for source artifact count limits."""

    def test_over_limit_detected(self, temp_workspace):
        """Source artifact count over limit is detected."""
        wiki_root = _create_wiki_structure(temp_workspace)
        page_path = wiki_root / "wiki" / "projects" / "too_many_sources.md"
        page_path.parent.mkdir(parents=True, exist_ok=True)

        # Create page with 12 source artifacts (exceeds default limit of 9)
        content = """# Page With Many Sources

## Summary

This page has too many source artifacts.

## Authority And Recency

Last updated: 2026-01-01

## Source Artifacts

- artifact1.py
- artifact2.py
- artifact3.py
- artifact4.py
- artifact5.py
- artifact6.py
- artifact7.py
- artifact8.py
- artifact9.py
- artifact10.py
- artifact11.py
- artifact12.py

## Related Pages

None.
"""
        page_path.write_text(content)

        results = validate_wiki_structure(temp_workspace)

        count_warnings = [
            r
            for r in results
            if r.check == "source_artifact_count" and r.status == "warn"
        ]
        assert len(count_warnings) == 1
        assert "12" in count_warnings[0].message
        assert "exceeds limit" in count_warnings[0].message

    def test_within_limit_not_flagged(self, temp_workspace):
        """Source artifact count within limit is not flagged."""
        wiki_root = _create_wiki_structure(temp_workspace)
        page_path = wiki_root / "wiki" / "projects" / "few_sources.md"
        _create_valid_wiki_page(page_path)  # Has 2 source artifacts

        results = validate_wiki_structure(temp_workspace)

        count_warnings = [
            r
            for r in results
            if r.check == "source_artifact_count"
            and r.status == "warn"
            and str(page_path) in r.path
        ]
        assert len(count_warnings) == 0

    def test_custom_limit_respected(self, temp_workspace):
        """Custom source artifact limit is respected."""
        wiki_root = _create_wiki_structure(temp_workspace)
        page_path = wiki_root / "wiki" / "projects" / "some_sources.md"
        page_path.parent.mkdir(parents=True, exist_ok=True)

        # Create page with 5 source artifacts
        content = """# Page With Some Sources

## Summary

This page has some source artifacts.

## Authority And Recency

Last updated: 2026-01-01

## Source Artifacts

- artifact1.py
- artifact2.py
- artifact3.py
- artifact4.py
- artifact5.py

## Related Pages

None.
"""
        page_path.write_text(content)

        # With default limit (9), should pass
        results = validate_wiki_structure(temp_workspace)
        count_warnings = [
            r
            for r in results
            if r.check == "source_artifact_count" and r.status == "warn"
        ]
        assert len(count_warnings) == 0

        # With custom limit (3), should warn
        results = validate_wiki_structure(temp_workspace, max_source_artifacts=3)
        count_warnings = [
            r
            for r in results
            if r.check == "source_artifact_count" and r.status == "warn"
        ]
        assert len(count_warnings) == 1


class TestCustomConfiguration:
    """Tests for custom configuration options."""

    def test_custom_wiki_subpath(self, temp_workspace):
        """Custom wiki subpath is respected."""
        # Create wiki at custom location
        wiki_root = temp_workspace / "docs" / "wiki"
        wiki_root.mkdir(parents=True, exist_ok=True)
        (wiki_root / "index.md").write_text("# Index\n\n## projects\n")
        (wiki_root / "log.md").write_text("# Log\n")

        results = validate_wiki_structure(temp_workspace, wiki_subpath="docs/wiki")

        pass_results = [r for r in results if r.status == "pass"]
        assert any(r.check == "wiki_root_exists" for r in pass_results)
        assert any(r.check == "index_exists" for r in pass_results)
        assert any(r.check == "log_exists" for r in pass_results)

    def test_custom_families(self, temp_workspace):
        """Custom wiki families are checked."""
        wiki_root = _create_wiki_structure(temp_workspace)

        # Check with custom families that are not in index
        results = validate_wiki_structure(
            temp_workspace, families=["custom_family", "another_family"]
        )

        family_warnings = [
            r
            for r in results
            if r.check == "family_in_index" and r.status == "warn"
        ]
        assert len(family_warnings) == 2
        assert any("custom_family" in w.message for w in family_warnings)
        assert any("another_family" in w.message for w in family_warnings)

    def test_custom_required_sections(self, temp_workspace):
        """Custom required sections are checked."""
        wiki_root = _create_wiki_structure(temp_workspace)
        page_path = wiki_root / "wiki" / "projects" / "test_page.md"
        _create_valid_wiki_page(page_path)

        # Check with custom required section that does not exist
        results = validate_wiki_structure(
            temp_workspace, required_sections=["Custom Section"]
        )

        section_errors = [
            r
            for r in results
            if r.check == "required_section"
            and r.status == "error"
            and "Custom Section" in r.message
        ]
        assert len(section_errors) == 1


class TestWikiFamilies:
    """Tests for wiki family validation."""

    def test_missing_family_in_index_warned(self, temp_workspace):
        """Missing family section in index.md is warned."""
        wiki_root = temp_workspace / ".claude" / "wiki"
        wiki_root.mkdir(parents=True, exist_ok=True)

        # Create index without all family sections
        (wiki_root / "index.md").write_text("# Index\n\n## projects\n")
        (wiki_root / "log.md").write_text("# Log\n")

        results = validate_wiki_structure(temp_workspace)

        family_warnings = [
            r for r in results if r.check == "family_in_index" and r.status == "warn"
        ]
        # Should warn about missing families (systems, changes, concepts, workflows)
        assert len(family_warnings) >= 4


class TestRelatedPagesReciprocity:
    """Tests for related pages reciprocity check."""

    def test_non_reciprocal_related_warned(self, temp_workspace):
        """Non-reciprocal related page link is warned."""
        wiki_root = _create_wiki_structure(temp_workspace)

        # Create page A that links to page B
        page_a = wiki_root / "wiki" / "projects" / "page_a.md"
        page_b = wiki_root / "wiki" / "projects" / "page_b.md"

        _create_valid_wiki_page(page_a, related_page="./page_b.md")
        _create_valid_wiki_page(page_b)  # Does not link back to page_a

        results = validate_wiki_structure(temp_workspace)

        reciprocal_warnings = [
            r
            for r in results
            if r.check == "reciprocal_related"
            and r.status == "warn"
            and "page_b.md" in r.message
        ]
        assert len(reciprocal_warnings) == 1

    def test_reciprocal_related_not_warned(self, temp_workspace):
        """Reciprocal related page links are not warned."""
        wiki_root = _create_wiki_structure(temp_workspace)

        # Create page A that links to page B and vice versa
        page_a = wiki_root / "wiki" / "projects" / "page_a.md"
        page_b = wiki_root / "wiki" / "projects" / "page_b.md"

        _create_valid_wiki_page(page_a, related_page="./page_b.md")
        _create_valid_wiki_page(page_b, related_page="./page_a.md")

        results = validate_wiki_structure(temp_workspace)

        reciprocal_warnings = [
            r
            for r in results
            if r.check == "reciprocal_related" and r.status == "warn"
        ]
        assert len(reciprocal_warnings) == 0
