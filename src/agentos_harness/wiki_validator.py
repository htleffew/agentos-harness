"""Wiki structure validator for agentos-harness.

Validates structural aspects of a wiki:
- Wiki root exists with index.md and log.md
- Wiki families exist (projects/, systems/, changes/, etc.)
- Page required sections present
- Markdown links resolve to existing files
- Related page links are reciprocal
- No sibling wiki pages used as source artifacts
- Source artifact count within limits
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import List


@dataclass
class ValidationResult:
    """Result of a single validation check."""

    path: str
    check: str
    status: str  # "pass", "warn", "error"
    message: str


# Default wiki families expected in a wiki structure
DEFAULT_WIKI_FAMILIES = [
    "projects",
    "systems",
    "changes",
    "concepts",
    "workflows",
]

# Required sections in wiki pages
REQUIRED_SECTIONS = [
    "Summary",
    "Authority And Recency",
    "Source Artifacts",
    "Related Pages",
]

# Default maximum source artifacts per page
DEFAULT_MAX_SOURCE_ARTIFACTS = 9


def _read_text(path: Path) -> str:
    """Read file content as text."""
    return path.read_text(encoding="utf-8")


def _extract_markdown_links(content: str) -> List[str]:
    """Extract markdown link targets from content.

    Matches [text](path) style links.
    """
    # Match markdown links: [text](path)
    pattern = r"\[([^\]]*)\]\(([^)]+)\)"
    matches = re.findall(pattern, content)
    return [m[1] for m in matches if not m[1].startswith(("http://", "https://", "#"))]


def _extract_section_content(content: str, section_name: str) -> str | None:
    """Extract content under a section heading.

    Returns content between the section heading and the next heading of same or higher level.
    """
    pattern = rf"(?m)^##\s+{re.escape(section_name)}\s*$\n(.*?)(?=^##\s|\Z)"
    match = re.search(pattern, content, re.DOTALL)
    if match:
        return match.group(1).strip()
    return None


def _count_source_artifacts(content: str) -> int:
    """Count source artifact entries in the Source Artifacts section.

    Source artifacts are typically listed as markdown links or bullet items.
    """
    section = _extract_section_content(content, "Source Artifacts")
    if not section:
        return 0

    # Count bullet items or markdown links
    bullet_count = len(re.findall(r"(?m)^[\s]*[-*]\s+", section))
    return bullet_count


def _extract_related_pages(content: str) -> List[str]:
    """Extract related page links from the Related Pages section."""
    section = _extract_section_content(content, "Related Pages")
    if not section:
        return []

    # Extract markdown links from the section
    return _extract_markdown_links(section)


def _check_wiki_root(wiki_root: Path, results: List[ValidationResult]) -> bool:
    """Check that wiki root directory exists."""
    if not wiki_root.exists():
        results.append(
            ValidationResult(
                path=str(wiki_root),
                check="wiki_root_exists",
                status="error",
                message=f"Wiki root does not exist: {wiki_root}",
            )
        )
        return False

    if not wiki_root.is_dir():
        results.append(
            ValidationResult(
                path=str(wiki_root),
                check="wiki_root_is_directory",
                status="error",
                message=f"Wiki root is not a directory: {wiki_root}",
            )
        )
        return False

    results.append(
        ValidationResult(
            path=str(wiki_root),
            check="wiki_root_exists",
            status="pass",
            message="Wiki root exists",
        )
    )
    return True


def _check_index_exists(wiki_root: Path, results: List[ValidationResult]) -> bool:
    """Check that index.md exists in wiki root."""
    index_path = wiki_root / "index.md"
    if not index_path.exists():
        results.append(
            ValidationResult(
                path=str(index_path),
                check="index_exists",
                status="error",
                message="Missing index.md in wiki root",
            )
        )
        return False

    results.append(
        ValidationResult(
            path=str(index_path),
            check="index_exists",
            status="pass",
            message="index.md exists",
        )
    )
    return True


def _check_log_exists(wiki_root: Path, results: List[ValidationResult]) -> bool:
    """Check that log.md exists in wiki root."""
    log_path = wiki_root / "log.md"
    if not log_path.exists():
        results.append(
            ValidationResult(
                path=str(log_path),
                check="log_exists",
                status="error",
                message="Missing log.md in wiki root",
            )
        )
        return False

    results.append(
        ValidationResult(
            path=str(log_path),
            check="log_exists",
            status="pass",
            message="log.md exists",
        )
    )
    return True


def _check_wiki_families(
    wiki_root: Path,
    families: List[str],
    results: List[ValidationResult],
) -> None:
    """Check that wiki family directories exist."""
    # Check index.md mentions each family
    index_path = wiki_root / "index.md"
    if index_path.exists():
        index_content = _read_text(index_path)
        for family in families:
            if f"## {family}" not in index_content:
                results.append(
                    ValidationResult(
                        path=str(index_path),
                        check="family_in_index",
                        status="warn",
                        message=f"Missing family section '{family}' in index.md",
                    )
                )

    # Check family directories exist under wiki/
    wiki_dir = wiki_root / "wiki"
    if wiki_dir.exists():
        for family in families:
            family_dir = wiki_dir / family
            if not family_dir.exists():
                results.append(
                    ValidationResult(
                        path=str(family_dir),
                        check="family_directory_exists",
                        status="warn",
                        message=f"Missing wiki family directory: {family}",
                    )
                )


def _check_page_required_sections(
    page_path: Path,
    results: List[ValidationResult],
    required_sections: List[str] | None = None,
) -> None:
    """Check that a wiki page has all required sections."""
    if required_sections is None:
        required_sections = REQUIRED_SECTIONS

    content = _read_text(page_path)

    for section in required_sections:
        pattern = rf"(?m)^##\s+{re.escape(section)}\s*$"
        if not re.search(pattern, content):
            results.append(
                ValidationResult(
                    path=str(page_path),
                    check="required_section",
                    status="error",
                    message=f"Missing required section: {section}",
                )
            )


def _check_markdown_links_resolve(
    page_path: Path,
    wiki_root: Path,
    results: List[ValidationResult],
) -> None:
    """Check that markdown links in a page resolve to existing files."""
    content = _read_text(page_path)
    links = _extract_markdown_links(content)

    for link in links:
        # Resolve link relative to the page location
        if link.startswith("/"):
            # Absolute path from wiki root
            target = wiki_root / link.lstrip("/")
        else:
            # Relative path from page location
            target = page_path.parent / link

        # Normalize the path
        target = target.resolve()

        # Remove any anchor from the path
        target_str = str(target).split("#")[0]
        target = Path(target_str)

        if not target.exists():
            results.append(
                ValidationResult(
                    path=str(page_path),
                    check="link_resolves",
                    status="error",
                    message=f"Broken link: {link}",
                )
            )


def _check_source_artifact_count(
    page_path: Path,
    results: List[ValidationResult],
    max_artifacts: int = DEFAULT_MAX_SOURCE_ARTIFACTS,
) -> None:
    """Check that source artifact count is within limits."""
    content = _read_text(page_path)
    count = _count_source_artifacts(content)

    if count > max_artifacts:
        results.append(
            ValidationResult(
                path=str(page_path),
                check="source_artifact_count",
                status="warn",
                message=f"Source artifact count ({count}) exceeds limit ({max_artifacts})",
            )
        )


def _check_no_sibling_wiki_as_source(
    page_path: Path,
    wiki_root: Path,
    results: List[ValidationResult],
) -> None:
    """Check that no sibling wiki pages are used as source artifacts."""
    content = _read_text(page_path)
    section = _extract_section_content(content, "Source Artifacts")
    if not section:
        return

    # Extract links from source artifacts section
    links = _extract_markdown_links(section)

    wiki_wiki_dir = wiki_root / "wiki"
    page_wiki_dir = None

    # Determine which wiki family the page is in
    for parent in page_path.parents:
        if parent.parent == wiki_wiki_dir:
            page_wiki_dir = parent
            break

    if page_wiki_dir is None:
        return

    for link in links:
        # Resolve the link
        if link.startswith("/"):
            target = wiki_root / link.lstrip("/")
        else:
            target = page_path.parent / link

        target = target.resolve()

        # Check if target is a sibling wiki page
        for parent in target.parents:
            if parent == wiki_wiki_dir or parent.parent == wiki_wiki_dir:
                results.append(
                    ValidationResult(
                        path=str(page_path),
                        check="no_sibling_wiki_as_source",
                        status="warn",
                        message=f"Sibling wiki page used as source artifact: {link}",
                    )
                )
                break


def _check_reciprocal_related_pages(
    page_path: Path,
    wiki_root: Path,
    results: List[ValidationResult],
) -> None:
    """Check that related page links are reciprocal."""
    content = _read_text(page_path)
    related = _extract_related_pages(content)

    for link in related:
        # Resolve the link
        if link.startswith("/"):
            target = wiki_root / link.lstrip("/")
        else:
            target = page_path.parent / link

        target = target.resolve()
        target_str = str(target).split("#")[0]
        target = Path(target_str)

        if not target.exists():
            # Already caught by link resolution check
            continue

        # Check if target has a reciprocal link back
        target_content = _read_text(target)
        target_related = _extract_related_pages(target_content)

        # Compute what the reciprocal link should look like
        page_relative = page_path.relative_to(wiki_root)
        has_reciprocal = False

        for back_link in target_related:
            if back_link.startswith("/"):
                back_target = wiki_root / back_link.lstrip("/")
            else:
                back_target = target.parent / back_link

            back_target = back_target.resolve()
            back_str = str(back_target).split("#")[0]
            back_target = Path(back_str)

            if back_target == page_path:
                has_reciprocal = True
                break

        if not has_reciprocal:
            results.append(
                ValidationResult(
                    path=str(page_path),
                    check="reciprocal_related",
                    status="warn",
                    message=f"Related page {link} does not link back",
                )
            )


def validate_wiki_structure(
    workspace: Path,
    wiki_subpath: str = ".claude/wiki",
    families: List[str] | None = None,
    required_sections: List[str] | None = None,
    max_source_artifacts: int = DEFAULT_MAX_SOURCE_ARTIFACTS,
) -> List[ValidationResult]:
    """Validate wiki structure within a workspace.

    Args:
        workspace: Path to the workspace root
        wiki_subpath: Relative path from workspace to wiki root (default: .claude/wiki)
        families: List of expected wiki family names (default: DEFAULT_WIKI_FAMILIES)
        required_sections: List of required section names for wiki pages
        max_source_artifacts: Maximum allowed source artifacts per page

    Returns:
        List of ValidationResult objects describing validation outcomes
    """
    if families is None:
        families = DEFAULT_WIKI_FAMILIES
    if required_sections is None:
        required_sections = REQUIRED_SECTIONS

    results: List[ValidationResult] = []

    wiki_root = workspace / wiki_subpath

    # Check wiki root exists
    if not _check_wiki_root(wiki_root, results):
        return results

    # Check index.md exists
    _check_index_exists(wiki_root, results)

    # Check log.md exists
    _check_log_exists(wiki_root, results)

    # Check wiki families
    _check_wiki_families(wiki_root, families, results)

    # Find all wiki pages and check each
    wiki_dir = wiki_root / "wiki"
    if wiki_dir.exists():
        for page_path in wiki_dir.rglob("*.md"):
            # Skip non-page files
            if page_path.name.startswith("_"):
                continue

            # Check required sections
            _check_page_required_sections(page_path, results, required_sections)

            # Check markdown links resolve
            _check_markdown_links_resolve(page_path, wiki_root, results)

            # Check source artifact count
            _check_source_artifact_count(page_path, results, max_source_artifacts)

            # Check no sibling wiki as source
            _check_no_sibling_wiki_as_source(page_path, wiki_root, results)

            # Check reciprocal related pages
            _check_reciprocal_related_pages(page_path, wiki_root, results)

    return results
