"""Tests for the wiki module."""

from __future__ import annotations

import json
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import pytest

from agentos_harness.wiki import (
    DEFAULT_SETTINGS,
    SearchHit,
    _context_receipt_id,
    _dedupe_strings,
    _extract_markdown_links,
    _extract_source_paths,
    _extract_summary,
    _extract_title,
    _parse_utc_timestamp,
    _query_terms,
    _section_body,
    _slugify,
    _utc_now,
    load_wiki_settings,
    wiki_init,
    wiki_lint,
    wiki_maintain_status,
    wiki_preflight,
    wiki_search,
    wiki_status,
)


@pytest.fixture
def temp_workspace():
    """Create a temporary workspace directory."""
    with tempfile.TemporaryDirectory() as tmpdir:
        workspace = Path(tmpdir)
        yield workspace


def test_default_stale_authority_threshold_is_twenty_minutes():
    """Generated wiki settings tolerate current-authority mtime drift up to 1200 seconds."""
    assert DEFAULT_SETTINGS["stale_authority_seconds"] == 1200


@pytest.fixture
def initialized_workspace(temp_workspace):
    """Create a workspace with wiki structure initialized."""
    wiki_init(temp_workspace)
    return temp_workspace


@pytest.fixture
def populated_workspace(temp_workspace):
    """Create a workspace with wiki pages."""
    workspace = temp_workspace

    # Create settings file
    settings_path = workspace / ".claude" / "state" / "config" / "wiki_settings.json"
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    settings_path.write_text(json.dumps(DEFAULT_SETTINGS, indent=2))

    # Initialize
    wiki_init(workspace)

    # Create a wiki page
    page_dir = workspace / ".claude" / "wiki" / "wiki" / "projects"
    page_dir.mkdir(parents=True, exist_ok=True)

    page_path = page_dir / "test-project.md"
    page_path.write_text(
        """# Test Project

Last updated: 2026-05-01T00:00:00Z

## Summary
This is a test project page for unit testing.

## Authority And Recency
- Current authority: `projects/test-project/HANDOFF.md` is the authoritative source.
- Recency rule: Prefer the newest owner-maintained source.

## Source Artifacts
- `projects/test-project/HANDOFF.md`
- `projects/test-project/internal/scripts/main.py`

## Related Pages
- [Another Page](../domains/test-domain.md): A related domain page.
"""
    )

    # Create the source artifacts
    project_dir = workspace / "projects" / "test-project"
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / "HANDOFF.md").write_text("# Test Project Handoff\n\nProject notes.\n")
    internal_scripts = project_dir / "internal" / "scripts"
    internal_scripts.mkdir(parents=True, exist_ok=True)
    (internal_scripts / "main.py").write_text("# main.py\nprint('hello')\n")

    # Create the related page
    domain_dir = workspace / ".claude" / "wiki" / "wiki" / "domains"
    domain_dir.mkdir(parents=True, exist_ok=True)
    domain_page = domain_dir / "test-domain.md"
    domain_page.write_text(
        """# Test Domain

Last updated: 2026-05-01T00:00:00Z

## Summary
This is a test domain page.

## Authority And Recency
- Current authority: `.claude/wiki/raw/descriptors/test-domain.json` provides domain definitions.
- Recency rule: Use newest source.

## Source Artifacts
- `.claude/wiki/raw/descriptors/test-domain.json`

## Related Pages
- [Test Project](../projects/test-project.md): The related project page.
"""
    )

    # Create the raw descriptor
    raw_dir = workspace / ".claude" / "wiki" / "raw" / "descriptors"
    raw_dir.mkdir(parents=True, exist_ok=True)
    (raw_dir / "test-domain.json").write_text('{"name": "test-domain"}\n')

    # Update index to include the pages
    index_path = workspace / ".claude" / "wiki" / "index.md"
    index_path.write_text(
        """# Workspace Wiki Index

Last updated: 2026-05-01T00:00:00Z

This is the content-oriented catalog for the wiki.

## projects
- [Test Project](wiki/projects/test-project.md): A test project page.

## domains
- [Test Domain](wiki/domains/test-domain.md): A test domain page.
"""
    )

    return workspace


class TestUtilityFunctions:
    """Tests for utility functions."""

    def test_utc_now_format(self):
        """UTC timestamp should be ISO format with Z suffix."""
        ts = _utc_now()
        assert ts.endswith("Z")
        assert "T" in ts
        # Should be parseable
        dt = datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ")
        assert dt.tzinfo is None  # strptime doesn't set tzinfo

    def test_parse_utc_timestamp_valid(self):
        """Should parse valid UTC timestamps."""
        ts = "2026-05-01T12:30:00Z"
        dt = _parse_utc_timestamp(ts)
        assert dt is not None
        assert dt.year == 2026
        assert dt.month == 5
        assert dt.day == 1
        assert dt.hour == 12
        assert dt.minute == 30
        assert dt.tzinfo == timezone.utc

    def test_parse_utc_timestamp_invalid(self):
        """Should return None for invalid timestamps."""
        assert _parse_utc_timestamp(None) is None
        assert _parse_utc_timestamp("") is None
        assert _parse_utc_timestamp("not-a-date") is None
        assert _parse_utc_timestamp("2026/05/01") is None

    def test_slugify(self):
        """Should convert strings to URL-safe slugs."""
        assert _slugify("Hello World") == "hello-world"
        assert _slugify("Test_Project-Name") == "test-project-name"
        assert _slugify("  spaces  ") == "spaces"
        assert _slugify("!!!") == "page"  # fallback
        assert _slugify("") == "page"  # fallback

    def test_dedupe_strings(self):
        """Should deduplicate while preserving order."""
        assert _dedupe_strings(["a", "b", "a", "c", "b"]) == ["a", "b", "c"]
        assert _dedupe_strings(["  x  ", "x", "  x"]) == ["x"]
        assert _dedupe_strings([]) == []


class TestMarkdownParsing:
    """Tests for markdown parsing functions."""

    def test_extract_title(self):
        """Should extract title from markdown."""
        text = "# My Title\n\nSome content."
        assert _extract_title(text, "fallback") == "My Title"

        text_no_title = "Some content without title."
        assert _extract_title(text_no_title, "fallback") == "fallback"

    def test_extract_summary(self):
        """Should extract summary from Summary section."""
        text = """# Page

## Summary
This is the summary text.

## Other Section
More content.
"""
        assert _extract_summary(text) == "This is the summary text."

    def test_extract_summary_multiline(self):
        """Should handle multiline summaries."""
        text = """# Page

## Summary
Line one.
Line two.
Line three.

## Next
"""
        assert _extract_summary(text) == "Line one. Line two. Line three."

    def test_section_body(self):
        """Should extract section body content."""
        text = """# Page

## First
Content of first.

## Second
Content of second.

## Third
"""
        assert _section_body(text, "First") == "Content of first.\n\n"
        assert _section_body(text, "Second") == "Content of second.\n\n"
        assert _section_body(text, "Missing") is None

    def test_extract_markdown_links(self):
        """Should extract markdown link targets."""
        text = """
Some text with [link one](path/to/file.md) and [link two](../other.md).
Also [external](https://example.com) links.
"""
        links = _extract_markdown_links(text)
        assert "path/to/file.md" in links
        assert "../other.md" in links
        assert "https://example.com" in links

    def test_extract_source_paths(self):
        """Should extract source paths from Source Artifacts section."""
        text = """# Page

## Summary
Test.

## Source Artifacts
- `projects/my-project/src/main.py`
- `.claude/state/config/settings.json`

## Related Pages
- None linked yet.
"""
        sources = _extract_source_paths(text)
        assert "projects/my-project/src/main.py" in sources
        assert ".claude/state/config/settings.json" in sources


class TestQueryTerms:
    """Tests for query tokenization."""

    def test_basic_tokenization(self):
        """Should tokenize query into terms."""
        terms = _query_terms("hello world test")
        assert "hello" in terms
        assert "world" in terms
        assert "test" in terms

    def test_stopword_removal(self):
        """Should remove stopwords."""
        terms = _query_terms("the project and the system")
        assert "the" not in terms
        assert "and" not in terms
        assert "project" in terms
        assert "system" in terms

    def test_alias_expansion(self):
        """Should expand query aliases."""
        aliases = {"my-project": "proj"}
        terms = _query_terms("search for my-project", aliases)
        assert "proj" in terms

    def test_empty_query(self):
        """Should handle empty or stopword-only queries."""
        terms = _query_terms("the and or")
        # Should fall back to the stripped query
        assert len(terms) > 0


class TestSearchHit:
    """Tests for SearchHit dataclass."""

    def test_to_dict(self):
        """Should convert to dictionary."""
        hit = SearchHit(
            path="wiki/page.md",
            title="Test Page",
            kind="wiki",
            score=10,
            snippets=["line 1", "line 2"],
        )
        d = hit.to_dict()
        assert d["path"] == "wiki/page.md"
        assert d["title"] == "Test Page"
        assert d["kind"] == "wiki"
        assert d["score"] == 10
        assert d["snippets"] == ["line 1", "line 2"]


class TestLoadWikiSettings:
    """Tests for settings loading."""

    def test_default_settings(self, temp_workspace):
        """Should use default settings when no file exists."""
        settings = load_wiki_settings(temp_workspace)
        assert settings["wiki_root"] == ".claude/wiki"
        assert "projects" in settings["wiki_families"]
        assert "domains" in settings["wiki_families"]

    def test_custom_settings(self, temp_workspace):
        """Should merge custom settings with defaults."""
        settings_path = temp_workspace / ".claude" / "state" / "config" / "wiki_settings.json"
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text(
            json.dumps(
                {
                    "wiki_root": ".custom/wiki",
                    "wiki_families": ["custom-family"],
                }
            )
        )

        settings = load_wiki_settings(temp_workspace)
        assert settings["wiki_root"] == ".custom/wiki"
        assert settings["wiki_families"] == ["custom-family"]
        # Should still have defaults for unspecified keys
        assert "context_receipts" in settings

    def test_invalid_settings_file(self, temp_workspace):
        """Should handle invalid JSON gracefully."""
        settings_path = temp_workspace / ".claude" / "state" / "config" / "wiki_settings.json"
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text("not valid json {{{")

        settings = load_wiki_settings(temp_workspace)
        # Should fall back to defaults
        assert settings["wiki_root"] == ".claude/wiki"


class TestWikiInit:
    """Tests for wiki initialization."""

    def test_creates_structure(self, temp_workspace):
        """Should create wiki directory structure with all expected files."""
        result = wiki_init(temp_workspace)

        assert result["wiki_root"] == ".claude/wiki"
        assert result["settings_path"] == ".claude/state/config/wiki_settings.json"
        assert result["next_command"] == "harness wiki status ."

        # Check all expected files were created
        wiki_root = temp_workspace / ".claude" / "wiki"
        assert wiki_root.exists()
        assert (wiki_root / "index.md").exists()
        assert (wiki_root / "log.md").exists()
        assert (wiki_root / "Templates" / "page_template.md").exists()

        # Check family directories with .gitkeep
        assert (wiki_root / "wiki" / "systems" / ".gitkeep").exists()
        assert (wiki_root / "wiki" / "projects" / ".gitkeep").exists()
        assert (wiki_root / "wiki" / "changes" / ".gitkeep").exists()

        # Check settings and backlog
        assert (temp_workspace / ".claude" / "state" / "config" / "wiki_settings.json").exists()
        assert (temp_workspace / ".claude" / "state" / "curation" / "wiki_maintenance_backlog.json").exists()

        # Check context receipts directory
        assert (temp_workspace / ".claude" / "state" / "runtime" / "wiki_context_receipts").is_dir()

        # All created paths should be in result
        assert len(result["created"]) > 0
        assert ".claude/wiki/index.md" in result["created"]
        assert ".claude/wiki/log.md" in result["created"]

    def test_idempotent(self, temp_workspace):
        """Should be safe to call multiple times without overwriting."""
        result1 = wiki_init(temp_workspace)
        initial_created_count = len(result1["created"])

        # Modify index.md to verify it's not overwritten
        index_path = temp_workspace / ".claude" / "wiki" / "index.md"
        original_content = index_path.read_text()
        modified_content = original_content + "\n## Custom Section\nCustom content.\n"
        index_path.write_text(modified_content)

        result2 = wiki_init(temp_workspace)

        # Second call should create no new files
        assert len(result2["created"]) == 0

        # Original modifications should be preserved
        assert index_path.read_text() == modified_content

    def test_index_has_expected_sections(self, temp_workspace):
        """Created index.md should have expected sections."""
        wiki_init(temp_workspace)

        index_path = temp_workspace / ".claude" / "wiki" / "index.md"
        content = index_path.read_text()

        assert "# Wiki Index" in content
        assert "Last updated:" in content
        assert "## Systems" in content
        assert "## Projects" in content
        assert "## Changes" in content
        assert "[log.md](log.md)" in content

    def test_log_has_init_entry(self, temp_workspace):
        """Created log.md should have wiki-init entry."""
        wiki_init(temp_workspace)

        log_path = temp_workspace / ".claude" / "wiki" / "log.md"
        content = log_path.read_text()

        assert "# Wiki Maintenance Log" in content
        assert "wiki-init" in content
        assert "Initialized wiki structure" in content

    def test_settings_has_no_workspace_specific_paths(self, temp_workspace):
        """Created settings should not contain workspace-specific absolute paths."""
        wiki_init(temp_workspace)

        settings_path = temp_workspace / ".claude" / "state" / "config" / "wiki_settings.json"
        content = settings_path.read_text()
        settings = json.loads(content)

        # All paths should be relative
        assert settings["wiki_root"] == ".claude/wiki"
        assert settings["context_receipts"]["path"] == ".claude/state/runtime/wiki_context_receipts"

        # Should not contain the temp workspace path
        assert str(temp_workspace) not in content

    def test_backlog_is_valid_json(self, temp_workspace):
        """Created backlog should be valid JSON with expected structure."""
        wiki_init(temp_workspace)

        backlog_path = temp_workspace / ".claude" / "state" / "curation" / "wiki_maintenance_backlog.json"
        content = backlog_path.read_text()
        backlog = json.loads(content)

        assert backlog["version"] == "1.0"
        assert backlog["items"] == []
        assert isinstance(backlog["items"], list)

    def test_page_template_has_required_sections(self, temp_workspace):
        """Created page_template.md should have required sections."""
        wiki_init(temp_workspace)

        template_path = temp_workspace / ".claude" / "wiki" / "Templates" / "page_template.md"
        content = template_path.read_text()

        assert "## Summary" in content
        assert "## Authority And Recency" in content
        assert "## Source Artifacts" in content
        assert "## Related Pages" in content
        assert "Current authority:" in content
        assert "Recency rule:" in content

    def test_respects_existing_settings(self, temp_workspace):
        """Should use existing settings if present."""
        # Create custom settings first
        settings_path = temp_workspace / ".claude" / "state" / "config" / "wiki_settings.json"
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        custom_settings = {
            "version": "1.0",
            "wiki_root": ".claude/wiki",
            "wiki_families": ["custom-family", "another-family"],
        }
        settings_path.write_text(json.dumps(custom_settings, indent=2))

        result = wiki_init(temp_workspace)

        # Settings should not be in created list since it already existed
        assert ".claude/state/config/wiki_settings.json" not in result["created"]

        # Custom families should be created
        assert (temp_workspace / ".claude" / "wiki" / "wiki" / "custom-family").is_dir()
        assert (temp_workspace / ".claude" / "wiki" / "wiki" / "another-family").is_dir()


class TestWikiStatus:
    """Tests for wiki status reporting."""

    def test_empty_wiki(self, initialized_workspace):
        """Should report status for empty wiki."""
        status = wiki_status(initialized_workspace)

        assert status["wiki_root"] == ".claude/wiki"
        assert status["page_count"] == 0
        assert all(count == 0 for count in status["page_counts_by_family"].values())
        assert status["lint_issue_count"] == 0  # Empty wiki is valid

    def test_populated_wiki(self, populated_workspace):
        """Should report status for populated wiki."""
        status = wiki_status(populated_workspace)

        assert status["page_count"] == 2
        assert status["page_counts_by_family"]["projects"] == 1
        assert status["page_counts_by_family"]["domains"] == 1

        # Backlog counts
        assert "maintenance_backlog" in status
        assert status["maintenance_backlog"]["counts"]["pending"] == 0


class TestWikiLint:
    """Tests for wiki linting."""

    def test_missing_index(self, temp_workspace):
        """Should detect missing index.md."""
        # Create wiki structure without index
        wiki_root = temp_workspace / ".claude" / "wiki"
        wiki_root.mkdir(parents=True, exist_ok=True)
        (wiki_root / "wiki" / "projects").mkdir(parents=True, exist_ok=True)

        issues = wiki_lint(temp_workspace)

        assert any("missing index.md" in issue for issue in issues)

    def test_broken_links(self, initialized_workspace):
        """Should detect broken markdown links."""
        # Create a page with a broken link
        page_dir = initialized_workspace / ".claude" / "wiki" / "wiki" / "projects"
        page_dir.mkdir(parents=True, exist_ok=True)

        page_path = page_dir / "test.md"
        page_path.write_text(
            """# Test

Last updated: 2026-05-01T00:00:00Z

## Summary
Test page.

## Authority And Recency
- Current authority: `projects/test/HANDOFF.md` is authoritative.
- Recency rule: Use newest.

## Source Artifacts
- `projects/test/HANDOFF.md`

## Related Pages
- [Broken Link](../nonexistent/page.md): This link is broken.
"""
        )

        # Create the source artifact
        (initialized_workspace / "projects" / "test").mkdir(parents=True, exist_ok=True)
        (initialized_workspace / "projects" / "test" / "HANDOFF.md").write_text("# Handoff\n")

        issues = wiki_lint(initialized_workspace)

        assert any("broken markdown link" in issue for issue in issues)

    def test_valid_wiki(self, populated_workspace):
        """Should find few issues in valid wiki."""
        issues = wiki_lint(populated_workspace)

        # The populated workspace should be mostly valid
        # May have some orphan/index issues but no broken links
        broken_link_issues = [i for i in issues if "broken markdown link" in i]
        assert len(broken_link_issues) == 0


class TestWikiSearch:
    """Tests for wiki search."""

    def test_search_returns_ranked_hits(self, populated_workspace):
        """Should return ranked search results."""
        results = wiki_search(populated_workspace, "test project")

        assert len(results) > 0
        # Results should be sorted by score descending
        scores = [r["score"] for r in results]
        assert scores == sorted(scores, reverse=True)

    def test_search_finds_matching_content(self, populated_workspace):
        """Should find pages matching query."""
        results = wiki_search(populated_workspace, "unit testing")

        # Should find the test project page which mentions "unit testing"
        paths = [r["path"] for r in results]
        assert any("test-project" in p for p in paths)

    def test_search_with_limit(self, populated_workspace):
        """Should respect limit parameter."""
        results = wiki_search(populated_workspace, "test", limit=1)
        assert len(results) <= 1

    def test_search_empty_query(self, populated_workspace):
        """Should handle queries with only stopwords."""
        results = wiki_search(populated_workspace, "the and or")
        # Should still return some results (falls back to query as term)
        assert isinstance(results, list)

    def test_search_no_matches(self, populated_workspace):
        """Should return empty list for no matches."""
        results = wiki_search(populated_workspace, "xyznonexistent123")
        assert results == []


class TestWikiPreflight:
    """Tests for preflight receipt creation."""

    def test_creates_receipt(self, initialized_workspace):
        """Should create a context receipt."""
        result = wiki_preflight(
            initialized_workspace,
            task="Test task description",
            mode="read",
        )

        assert "receipt_id" in result
        assert result["receipt_id"].startswith("wiki-context-")
        assert "receipt_path" in result
        assert result["mode"] == "read"
        assert "expires_at" in result

        # Receipt file should exist
        receipt_path = initialized_workspace / result["receipt_path"]
        assert receipt_path.exists()

    def test_receipt_with_sources(self, initialized_workspace):
        """Should include source paths in receipt."""
        # Create a source file
        source_dir = initialized_workspace / "projects" / "test"
        source_dir.mkdir(parents=True, exist_ok=True)
        (source_dir / "main.py").write_text("# test\n")

        result = wiki_preflight(
            initialized_workspace,
            task="Test with source",
            mode="write",
            source_paths=["projects/test/main.py"],
        )

        assert "projects/test/main.py" in result["source_paths"]
        assert result["mode"] == "write"

    def test_receipt_validation(self, initialized_workspace):
        """Should create valid receipt that can be loaded."""
        result = wiki_preflight(
            initialized_workspace,
            task="Validation test",
            mode="maintenance",
        )

        # Load and validate the receipt
        receipt_path = initialized_workspace / result["receipt_path"]
        receipt = json.loads(receipt_path.read_text())

        assert receipt["version"] == "1.0"
        assert receipt["id"] == result["receipt_id"]
        assert receipt["mode"] == "maintenance"
        assert receipt["allow_wiki_mutation"] is True

    def test_preflight_requires_task_or_sources(self, initialized_workspace):
        """Should raise error if no task or sources provided."""
        with pytest.raises(ValueError) as exc_info:
            wiki_preflight(
                initialized_workspace,
                task="",
                mode="read",
                source_paths=[],
                page_refs=[],
            )
        assert "requires at least one" in str(exc_info.value)


class TestWikiMaintainStatus:
    """Tests for maintenance status reporting."""

    def test_empty_backlog(self, initialized_workspace):
        """Should report empty backlog."""
        status = wiki_maintain_status(initialized_workspace)

        assert status["counts"]["pending"] == 0
        assert status["counts"]["completed"] == 0
        assert len(status["pending_items"]) == 0

    def test_signals_reported(self, populated_workspace):
        """Should report maintenance signals."""
        status = wiki_maintain_status(populated_workspace)

        assert "signals" in status
        assert "empty_families" in status["signals"]
        assert "thin_pages" in status["signals"]
        assert "orphan_pages" in status["signals"]


class TestContextReceiptId:
    """Tests for context receipt ID generation."""

    def test_unique_ids(self):
        """Should generate unique IDs for different inputs."""
        id1 = _context_receipt_id("task1", ["source1.py"], "read")
        id2 = _context_receipt_id("task2", ["source2.py"], "read")
        assert id1 != id2

    def test_id_format(self):
        """Should follow expected format."""
        receipt_id = _context_receipt_id("my task", ["file.py"], "write")
        assert receipt_id.startswith("wiki-context-")
        parts = receipt_id.split("-")
        assert len(parts) >= 4  # wiki-context-<slug>-<hash>-<timestamp>

    def test_deterministic_hash(self):
        """Same inputs should produce same hash component."""
        id1 = _context_receipt_id("task", ["source.py"], "read")
        id2 = _context_receipt_id("task", ["source.py"], "read")
        # Hash portion should match, timestamp will differ
        hash1 = id1.split("-")[3]
        hash2 = id2.split("-")[3]
        assert hash1 == hash2
