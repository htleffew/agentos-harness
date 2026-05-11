"""Tests for Karpathy wiki features: hash staleness, semantic lint, learning extraction, synthesis capture."""
import json
import pytest
from pathlib import Path
from datetime import datetime, timedelta, timezone

from agentos_harness.wiki import (
    _compute_source_hashes,
    _extract_source_hashes,
    _validate_source_hashes,
    _find_overlapping_page_pairs,
    wiki_semantic_lint,
    _load_activity_log,
    _detect_error_fix_patterns,
    _detect_repeated_lookups,
    wiki_extract_learnings,
    load_learning_candidates,
    save_learning_candidates,
    wiki_pending_synthesis,
    load_wiki_settings,
    DEFAULT_SETTINGS,
)


@pytest.fixture
def temp_workspace(tmp_path):
    """Create a minimal workspace structure."""
    wiki_root = tmp_path / ".claude" / "wiki"
    wiki_root.mkdir(parents=True)
    (wiki_root / "wiki" / "projects").mkdir(parents=True)
    (wiki_root / "wiki" / "reference").mkdir(parents=True)
    (wiki_root / "index.md").write_text("# Wiki Index\n")
    (wiki_root / "log.md").write_text("# Wiki Log\n")

    state_dir = tmp_path / ".claude" / "state"
    state_dir.mkdir(parents=True)
    (state_dir / "config").mkdir(parents=True)
    (state_dir / "curation").mkdir(parents=True)

    (state_dir / "config" / "wiki_settings.json").write_text(json.dumps({
        **DEFAULT_SETTINGS,
        "hash_staleness_check": True,
    }))

    return tmp_path


# --- Hash staleness tests ---

def test_compute_source_hashes_returns_dict(temp_workspace):
    """Hash computation returns a dict."""
    test_file = temp_workspace / "test.md"
    test_file.write_text("test content")

    hashes = _compute_source_hashes(temp_workspace, ["test.md"])

    assert isinstance(hashes, dict)
    if "test.md" in hashes:
        assert len(hashes["test.md"]) == 16


def test_compute_source_hashes_ignores_missing(temp_workspace):
    """Hash computation skips missing files."""
    hashes = _compute_source_hashes(temp_workspace, ["nonexistent.md"])
    assert hashes == {}


def test_extract_source_hashes_parses_section():
    """Extract hashes from Source Hashes section."""
    content = """# Test

## Source Hashes
- `projects/test.md`: `abc123def4567890`
- `CLAUDE.md`: `1234567890abcdef`
"""
    hashes = _extract_source_hashes(content)
    assert len(hashes) == 2
    assert hashes["projects/test.md"] == "abc123def4567890"


def test_extract_source_hashes_empty_without_section():
    """Returns empty dict when no Source Hashes section."""
    content = "# Test\n\n## Summary\nContent."
    hashes = _extract_source_hashes(content)
    assert hashes == {}


def test_validate_source_hashes_detects_mismatch(temp_workspace):
    """Validation detects hash mismatches."""
    test_file = temp_workspace / "projects" / "test.md"
    test_file.parent.mkdir(parents=True, exist_ok=True)
    test_file.write_text("original content")

    content = """# Test

## Source Hashes
- `projects/test.md`: `0000000000000000`
"""
    page_path = temp_workspace / ".claude" / "wiki" / "wiki" / "projects" / "test-page.md"
    settings = load_wiki_settings(temp_workspace)

    issues = _validate_source_hashes(page_path, content, settings, temp_workspace)

    assert len(issues) >= 1
    assert "mismatch" in issues[0].lower()


# --- Semantic lint tests ---

def test_find_overlapping_page_pairs_returns_list(temp_workspace):
    """Overlapping page pairs returns a list."""
    settings = load_wiki_settings(temp_workspace)
    pairs = _find_overlapping_page_pairs(temp_workspace, settings)
    assert isinstance(pairs, list)


def test_wiki_semantic_lint_returns_report(temp_workspace):
    """Semantic lint returns a report dict."""
    result = wiki_semantic_lint(temp_workspace)

    assert "generated_at" in result
    assert "pairs_checked" in result
    assert "findings" in result


def test_semantic_lint_with_overlapping_pages(temp_workspace):
    """Semantic lint finds pages with shared sources."""
    wiki_root = temp_workspace / ".claude" / "wiki" / "wiki"

    shared_source = temp_workspace / "projects" / "shared" / "HANDOFF.md"
    shared_source.parent.mkdir(parents=True, exist_ok=True)
    shared_source.write_text("# Shared handoff")

    (wiki_root / "projects" / "page-a.md").write_text("""# Page A

## Summary
Test.

## Authority And Recency
Updated.

## Source Artifacts
- `projects/shared/HANDOFF.md`

## Related Pages
None.
""")
    (wiki_root / "reference" / "page-b.md").write_text("""# Page B

## Summary
Test.

## Authority And Recency
Updated.

## Source Artifacts
- `projects/shared/HANDOFF.md`

## Related Pages
None.
""")

    result = wiki_semantic_lint(temp_workspace)

    assert result["pairs_checked"] >= 1
    if result["findings"]:
        assert "shared_sources" in result["findings"][0]


# --- Learning extraction tests ---

def test_detect_error_fix_patterns():
    """Detect error-fix patterns from entries."""
    now = datetime.now(timezone.utc)
    entries = [
        {"ts": (now - timedelta(minutes=10)).strftime("%Y-%m-%dT%H:%M:%SZ"),
         "tool": "Edit", "ok": False, "desc": "Edit /test/broken.py",
         "_ts": now - timedelta(minutes=10)},
        {"ts": (now - timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%SZ"),
         "tool": "Edit", "ok": True, "desc": "Edit /test/broken.py",
         "_ts": now - timedelta(minutes=5)},
    ]

    patterns = _detect_error_fix_patterns(entries)

    assert len(patterns) >= 1
    assert patterns[0]["type"] == "error_fix"


def test_detect_repeated_lookups():
    """Detect repeated lookup patterns."""
    now = datetime.now(timezone.utc)
    entries = [
        {"ts": (now - timedelta(minutes=i)).strftime("%Y-%m-%dT%H:%M:%SZ"),
         "tool": "Read", "ok": True, "desc": "Read /docs/important.md",
         "_ts": now - timedelta(minutes=i)}
        for i in range(5)
    ]

    patterns = _detect_repeated_lookups(entries)

    assert len(patterns) >= 1
    assert patterns[0]["type"] == "repeated_lookup"
    assert patterns[0]["count"] >= 3


def test_wiki_extract_learnings_returns_candidates(temp_workspace):
    """Extract learnings returns a candidate structure."""
    result = wiki_extract_learnings(temp_workspace, hours=1)

    assert "generated_at" in result
    assert "hours_analyzed" in result
    assert "candidates" in result


# --- Synthesis capture tests ---

def test_load_save_learning_candidates(temp_workspace):
    """Learning candidates can be saved and loaded."""
    candidates = {
        "candidates": [{
            "id": "synthesis-test123",
            "type": "synthesis",
            "target_file": "/test/output.py",
            "source_files": ["/test/a.py", "/test/b.py"],
            "proposed_wiki_family": "reference",
        }]
    }

    save_learning_candidates(temp_workspace, candidates)
    loaded = load_learning_candidates(temp_workspace)

    assert len(loaded.get("candidates", [])) >= 1


def test_wiki_pending_synthesis_returns_structure(temp_workspace):
    """Pending synthesis returns correct structure."""
    candidates = {
        "candidates": [{
            "id": "synthesis-abc",
            "type": "synthesis",
            "target_file": "/output.py",
        }]
    }
    save_learning_candidates(temp_workspace, candidates)

    result = wiki_pending_synthesis(temp_workspace)

    assert "count" in result
    assert "candidates" in result
    assert result["count"] == 1


def test_pending_synthesis_empty_workspace(temp_workspace):
    """Pending synthesis works on empty workspace."""
    result = wiki_pending_synthesis(temp_workspace)

    assert result["count"] == 0
    assert result["candidates"] == []
