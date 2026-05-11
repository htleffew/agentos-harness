"""Generalized wiki CLI functionality for workspace knowledge management.

This module provides portable wiki infrastructure that can be adapted to any
workspace using the distributable harness. It extracts core wiki patterns from
workspace-specific implementations and makes them configurable.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from pathlib import Path
from typing import Sequence


# Default settings that can be overridden via wiki_settings.json
DEFAULT_SETTINGS = {
    "version": "1.1",
    "wiki_root": ".claude/wiki",
    "hash_staleness_check": True,
    "raw_subdirs": ["descriptors", "imported", "harvested", "manifests"],
    "wiki_families": [
        "projects",
        "domains",
        "systems",
        "products",
        "models",
        "research",
        "methods",
        "workflows",
        "contracts",
        "reference",
        "evidence",
        "changes",
    ],
    "page_required_sections": [
        "Summary",
        "Authority And Recency",
        "Source Artifacts",
        "Related Pages",
    ],
    "max_source_artifacts_per_page": 9,
    "max_source_artifacts_per_family": {"evidence": 24},
    "stale_authority_seconds": 1200,
    "search": {
        "default_limit": 8,
        "max_snippets_per_page": 3,
        "exclude_subdirs": ["descriptors"],
        "family_score_adjustments": {"changes": -3},
    },
    "related": {"auto_limit": 4, "max_links_per_page": 6},
    "source_drilldown": {
        "max_sources": 6,
        "max_snippets_per_source": 2,
        "exclude_subdirs": ["descriptors"],
        "max_file_bytes": 500000,
    },
    "status": {"recent_log_entries": 5},
    "maintenance_backlog": {
        "path": ".claude/state/curation/wiki_maintenance_backlog.json",
        "default_limit": 5,
        "max_related_pages": 6,
    },
    "context_receipts": {
        "path": ".claude/state/runtime/wiki_context_receipts",
        "current_file": "current.json",
        "ttl_seconds": 7200,
        "max_receipts": 20,
        "candidate_page_limit": 8,
        "enforce_for_wiki_writes": True,
    },
}

STOPWORDS = {
    "a",
    "an",
    "and",
    "for",
    "in",
    "need",
    "of",
    "on",
    "or",
    "the",
    "to",
    "want",
    "working",
}

# Query aliases can be configured per-workspace via settings
# Default is empty; workspace-specific aliases should be set in wiki_settings.json
QUERY_ALIASES: dict[str, str] = {}

TEXTUAL_SOURCE_SUFFIXES = {
    ".astro",
    ".ipynb",
    ".json",
    ".md",
    ".py",
    ".sh",
    ".sql",
    ".ts",
    ".txt",
    ".yaml",
    ".yml",
}

PLACEHOLDER_NOTE = "- Created by the shared wiki workflow."


@dataclass
class SearchHit:
    """A single search result."""

    path: str
    title: str
    kind: str
    score: int
    snippets: list[str]

    def to_dict(self) -> dict:
        """Convert to dictionary representation."""
        return asdict(self)


def _utc_now() -> str:
    """Return current UTC timestamp in ISO format."""
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _parse_utc_timestamp(value: str | None) -> datetime | None:
    """Parse a UTC timestamp string."""
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=timezone.utc
        )
    except ValueError:
        return None


def _slugify(value: str) -> str:
    """Convert a string to a URL-safe slug."""
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "page"


def _read_text(path: Path) -> str:
    """Read file contents as text."""
    return path.read_text(encoding="utf-8")


def _write_text(path: Path, text: str) -> None:
    """Write text to file with trailing newline."""
    path.write_text(text.rstrip() + "\n", encoding="utf-8")


def _write_json_file(path: Path, payload: dict) -> None:
    """Write JSON to file with pretty formatting."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _relative(path: Path, workspace: Path) -> str:
    """Return workspace-relative path as posix string."""
    return path.relative_to(workspace).as_posix()


# --- Settings Management ---


def load_wiki_settings(workspace: Path) -> dict:
    """Load wiki settings from workspace, falling back to defaults.

    Args:
        workspace: Root path of the workspace.

    Returns:
        Merged settings dictionary.
    """
    settings = dict(DEFAULT_SETTINGS)
    settings_path = workspace / ".claude" / "state" / "config" / "wiki_settings.json"
    if settings_path.exists():
        try:
            loaded = json.loads(settings_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                _deep_merge(settings, loaded)
        except (json.JSONDecodeError, OSError):
            pass
    return settings


def _deep_merge(base: dict, overlay: dict) -> None:
    """Deep merge overlay into base dict in place."""
    for key, value in overlay.items():
        if key in base and isinstance(base[key], dict) and isinstance(value, dict):
            _deep_merge(base[key], value)
        else:
            base[key] = value


def _wiki_root(workspace: Path, settings: dict) -> Path:
    """Return the wiki root path."""
    return workspace / settings["wiki_root"]


def _context_receipt_settings(settings: dict) -> dict:
    """Return context receipt settings with defaults."""
    payload = dict(settings.get("context_receipts", {}) or {})
    defaults = DEFAULT_SETTINGS["context_receipts"]
    for key, default_value in defaults.items():
        payload.setdefault(key, default_value)
    return payload


def _context_receipt_root(workspace: Path, settings: dict) -> Path:
    """Return the context receipts directory."""
    return workspace / _context_receipt_settings(settings).get(
        "path", ".claude/state/runtime/wiki_context_receipts"
    )


def _current_context_receipt_pointer_path(workspace: Path, settings: dict) -> Path:
    """Return the path to the current receipt pointer file."""
    receipt_settings = _context_receipt_settings(settings)
    return _context_receipt_root(workspace, settings) / receipt_settings.get(
        "current_file", "current.json"
    )


# --- Substrate Management ---


def _ensure_substrate(workspace: Path, settings: dict) -> None:
    """Ensure wiki directory structure exists."""
    root = _wiki_root(workspace, settings)
    for subdir in settings.get("raw_subdirs", []):
        (root / "raw" / subdir).mkdir(parents=True, exist_ok=True)
    for family in settings.get("wiki_families", []):
        (root / "wiki" / family).mkdir(parents=True, exist_ok=True)
    (root / "Templates").mkdir(parents=True, exist_ok=True)
    _ensure_maintenance_backlog(workspace, settings)


def _ensure_context_receipt_root(workspace: Path, settings: dict) -> Path:
    """Ensure the context receipts directory exists."""
    root = _context_receipt_root(workspace, settings)
    root.mkdir(parents=True, exist_ok=True)
    return root


# --- Maintenance Backlog ---


def _backlog_path(workspace: Path, settings: dict) -> Path:
    """Return the maintenance backlog file path."""
    backlog_settings = settings.get("maintenance_backlog", {})
    return workspace / backlog_settings.get(
        "path", ".claude/state/curation/wiki_maintenance_backlog.json"
    )


def _default_backlog_payload() -> dict:
    """Return default empty backlog structure."""
    return {"version": "1.0", "items": []}


def _ensure_maintenance_backlog(workspace: Path, settings: dict) -> Path:
    """Ensure maintenance backlog file exists."""
    path = _backlog_path(workspace, settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        _write_text(path, json.dumps(_default_backlog_payload(), indent=2))
    return path


def _load_maintenance_backlog(workspace: Path, settings: dict) -> dict:
    """Load the maintenance backlog."""
    path = _ensure_maintenance_backlog(workspace, settings)
    try:
        payload = json.loads(_read_text(path))
    except json.JSONDecodeError:
        payload = _default_backlog_payload()
    if not isinstance(payload, dict):
        payload = _default_backlog_payload()
    payload.setdefault("version", "1.0")
    payload.setdefault("items", [])
    if not isinstance(payload["items"], list):
        payload["items"] = []
    return payload


def _save_maintenance_backlog(workspace: Path, settings: dict, payload: dict) -> None:
    """Save the maintenance backlog."""
    _write_text(_backlog_path(workspace, settings), json.dumps(payload, indent=2))


def _maintenance_backlog_counts(payload: dict) -> dict[str, int]:
    """Return counts by status from backlog."""
    counts = Counter(item.get("status", "pending") for item in payload.get("items", []))
    counts.setdefault("pending", 0)
    counts.setdefault("completed", 0)
    counts.setdefault("dismissed", 0)
    return dict(sorted(counts.items()))


# --- Context Receipts ---


def _prune_context_receipts(workspace: Path, settings: dict) -> None:
    """Remove expired and excess context receipts."""
    receipt_settings = _context_receipt_settings(settings)
    root = _ensure_context_receipt_root(workspace, settings)
    current_pointer = _current_context_receipt_pointer_path(workspace, settings)
    max_receipts = max(int(receipt_settings.get("max_receipts", 20)), 1)
    now = datetime.now(timezone.utc)
    receipt_files = sorted(
        [path for path in root.glob("*.json") if path.name != current_pointer.name],
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    kept: list[Path] = []
    for path in receipt_files:
        payload = _load_json_path(path)
        expires_at = (
            _parse_utc_timestamp(payload.get("expires_at"))
            if isinstance(payload, dict)
            else None
        )
        if expires_at is not None and expires_at < now and len(kept) >= max_receipts:
            path.unlink(missing_ok=True)
            continue
        kept.append(path)
    for path in receipt_files[max_receipts:]:
        if path in kept:
            continue
        payload = _load_json_path(path)
        expires_at = (
            _parse_utc_timestamp(payload.get("expires_at"))
            if isinstance(payload, dict)
            else None
        )
        if expires_at is None or expires_at < now:
            path.unlink(missing_ok=True)


def _load_json_path(path: Path) -> dict | None:
    """Load JSON from path, returning None on failure."""
    if not path.exists():
        return None
    try:
        payload = json.loads(_read_text(path))
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def _load_current_context_receipt(
    workspace: Path, settings: dict
) -> tuple[dict | None, Path | None]:
    """Load the current context receipt if it exists."""
    pointer_path = _current_context_receipt_pointer_path(workspace, settings)
    pointer = _load_json_path(pointer_path)
    if not isinstance(pointer, dict):
        return None, None
    receipt_rel = pointer.get("receipt_path")
    if not isinstance(receipt_rel, str) or not receipt_rel:
        return None, None
    receipt_path = workspace / receipt_rel
    if not receipt_path.exists():
        return None, None
    payload = _load_json_path(receipt_path)
    return payload, receipt_path


def _context_receipt_is_fresh(payload: dict | None) -> bool:
    """Check if a context receipt is still valid."""
    if not isinstance(payload, dict):
        return False
    expires_at = _parse_utc_timestamp(payload.get("expires_at"))
    if expires_at is None:
        return False
    return expires_at >= datetime.now(timezone.utc)


def _context_receipt_id(task: str, source_paths: Sequence[str], mode: str) -> str:
    """Generate a unique context receipt ID."""
    source_list = list(source_paths)
    seed = "|".join(_dedupe_strings([mode, task, *source_list])) or mode
    digest = sha256(seed.encode("utf-8")).hexdigest()[:12]
    stem_source = task or source_list[0] if source_list else mode
    stem = _slugify(Path(stem_source).stem if "/" in stem_source else stem_source)[
        :24
    ] or mode
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"wiki-context-{stem}-{digest}-{timestamp}"


def _dedupe_strings(values: Sequence[str]) -> list[str]:
    """Deduplicate strings while preserving order."""
    ordered = []
    seen: set[str] = set()
    for value in values:
        if not isinstance(value, str):
            continue
        cleaned = value.strip()
        if not cleaned or cleaned in seen:
            continue
        ordered.append(cleaned)
        seen.add(cleaned)
    return ordered


def _write_current_context_receipt(
    workspace: Path, settings: dict, receipt_path: Path, payload: dict
) -> None:
    """Update the current receipt pointer."""
    pointer = {
        "receipt_id": payload.get("id"),
        "receipt_path": _relative(receipt_path, workspace),
        "updated_at": _utc_now(),
    }
    _write_json_file(
        _current_context_receipt_pointer_path(workspace, settings), pointer
    )


# --- Page Utilities ---


def _all_page_paths(workspace: Path, settings: dict) -> list[Path]:
    """Return all wiki page paths."""
    root = _wiki_root(workspace, settings) / "wiki"
    paths: list[Path] = []
    for family in settings.get("wiki_families", []):
        paths.extend(sorted((root / family).glob("*.md")))
    return paths


def _extract_title(text: str, fallback: str) -> str:
    """Extract the page title from markdown."""
    match = re.search(r"(?m)^#\s+(.+)$", text)
    return match.group(1).strip() if match else fallback


def _extract_summary(text: str) -> str:
    """Extract the summary section from markdown."""
    summary_match = re.search(r"(?ms)^## Summary\s*\n(.+?)(?=^## |\Z)", text)
    if summary_match:
        summary = " ".join(
            line.strip() for line in summary_match.group(1).splitlines() if line.strip()
        )
        return summary.strip()
    for line in text.splitlines():
        stripped = line.strip()
        if (
            stripped
            and not stripped.startswith("#")
            and not stripped.startswith("Surface class:")
            and not stripped.startswith("Lifecycle posture:")
            and not stripped.startswith("Last updated:")
        ):
            return stripped
    return ""


def _section_body(text: str, heading: str) -> str | None:
    """Extract the body of a markdown section."""
    match = re.search(rf"(?ms)^## {re.escape(heading)}\s*\n(.+?)(?=^## |\Z)", text)
    return match.group(1) if match else None


def _extract_markdown_links(text: str) -> list[str]:
    """Extract markdown link targets from text."""
    return [target.strip() for target in re.findall(r"\[[^\]]+\]\(([^)]+)\)", text)]


def _resolve_markdown_link(
    base_path: Path, target: str, workspace: Path
) -> Path | None:
    """Resolve a markdown link relative to a base path."""
    cleaned = target.strip()
    if not cleaned or cleaned.startswith(("http://", "https://", "mailto:", "#")):
        return None
    cleaned = cleaned.split("#", 1)[0].strip()
    if not cleaned:
        return None
    if cleaned.startswith("/"):
        return workspace / cleaned.lstrip("/")
    return (base_path.parent / cleaned).resolve()


def _extract_workspace_paths(text: str) -> list[str]:
    """Extract workspace paths from markdown code spans."""
    return re.findall(
        r"`((?:projects|\.claude|\.harness|artifacts|user_materials)/[^`]+|(?:AGENTS|CLAUDE|CODEX|GEMINI|README)\.md)`",
        text,
    )


def _extract_source_paths(text: str) -> list[str]:
    """Extract source artifact paths from markdown."""
    return _extract_workspace_paths(_section_body(text, "Source Artifacts") or "")


def _extract_related_page_paths(
    page_path: Path, text: str, workspace: Path
) -> list[Path]:
    """Extract related page paths from markdown."""
    body = _section_body(text, "Related Pages") or ""
    paths: list[Path] = []
    for target in _extract_markdown_links(body):
        resolved = _resolve_markdown_link(page_path, target, workspace)
        if resolved is None or not resolved.exists() or resolved == page_path:
            continue
        if resolved.suffix != ".md":
            continue
        paths.append(resolved)
    return list(dict.fromkeys(paths))


def _extract_authority_signals(text: str) -> tuple[list[str], list[str], bool]:
    """Extract authority signals from the Authority And Recency section."""
    body = _section_body(text, "Authority And Recency")
    if body is None:
        return [], [], False

    current_paths: list[str] = []
    retained_paths: list[str] = []
    has_recency_rule = False
    for raw_line in body.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("- Current authority:"):
            current_paths.extend(_extract_workspace_paths(line))
        elif line.startswith("- Retained context only:"):
            retained_paths.extend(_extract_workspace_paths(line))
        elif line.startswith("- Recency rule:"):
            has_recency_rule = True
    return current_paths, retained_paths, has_recency_rule


def _parse_last_updated(text: str) -> datetime | None:
    """Parse the Last updated timestamp from a page."""
    match = re.search(r"(?m)^Last updated:\s+(\S+)$", text)
    if not match:
        return None
    try:
        return datetime.strptime(match.group(1), "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=timezone.utc
        )
    except ValueError:
        return None


# --- Hash-based staleness ---


def _compute_source_hashes(workspace: Path, source_paths: Sequence[str]) -> dict[str, str]:
    """Compute SHA256 hashes for source files that exist."""
    hashes: dict[str, str] = {}
    for source in source_paths:
        source_path = workspace / source
        if source_path.exists() and source_path.is_file():
            try:
                hashes[source] = sha256(source_path.read_bytes()).hexdigest()[:16]
            except (OSError, IOError):
                pass
    return hashes


def _extract_source_hashes(text: str) -> dict[str, str]:
    """Extract source hashes from the Source Hashes section."""
    body = _section_body(text, "Source Hashes") or ""
    hashes: dict[str, str] = {}
    for line in body.splitlines():
        match = re.match(r"^-\s+`([^`]+)`:\s+`([a-f0-9]+)`", line.strip())
        if match:
            hashes[match.group(1)] = match.group(2)
    return hashes


def _validate_source_hashes(
    path: Path, text: str, settings: dict, workspace: Path
) -> list[str]:
    """Validate that stored source hashes match current file hashes."""
    if not settings.get("hash_staleness_check", True):
        return []
    stored_hashes = _extract_source_hashes(text)
    if not stored_hashes:
        return []
    issues: list[str] = []
    rel = _relative(path, workspace)
    for source, stored_hash in stored_hashes.items():
        source_path = workspace / source
        if not source_path.exists() or not source_path.is_file():
            continue
        try:
            current_hash = sha256(source_path.read_bytes()).hexdigest()[:16]
            if current_hash != stored_hash:
                issues.append(
                    f"{rel}: source hash mismatch for '{source}' (stored {stored_hash}, current {current_hash})"
                )
        except (OSError, IOError):
            pass
    return issues


# --- Search ---


def _query_terms(query: str, aliases: dict[str, str] | None = None) -> list[str]:
    """Tokenize a query string into search terms."""
    if aliases is None:
        aliases = QUERY_ALIASES
    lowered_query = query.lower()
    terms = [
        term
        for term in re.findall(r"[A-Za-z0-9][A-Za-z0-9_-]*", lowered_query)
        if len(term) > 1
    ]
    filtered = [term for term in terms if term not in STOPWORDS]
    for alias, canonical in aliases.items():
        if alias in lowered_query and canonical not in filtered:
            filtered.append(canonical)
    return filtered or [lowered_query.strip()]


def _search_wiki(
    workspace: Path, settings: dict, query: str, aliases: dict[str, str] | None = None
) -> list[SearchHit]:
    """Search wiki pages for matching content."""
    terms = _query_terms(query, aliases)
    root = _wiki_root(workspace, settings)
    paths = [root / "index.md", *_all_page_paths(workspace, settings)]
    hits: list[SearchHit] = []
    family_adjustments = settings.get("search", {}).get("family_score_adjustments", {})
    max_snippets = settings.get("search", {}).get("max_snippets_per_page", 3)

    for path in paths:
        if not path.exists():
            continue
        text = _read_text(path)
        lowered = text.lower()
        score = sum(lowered.count(term) for term in terms)
        if path.parent.name in family_adjustments:
            score += int(family_adjustments[path.parent.name])
        if score <= 0:
            continue
        title = _extract_title(text, path.stem.replace("-", " ").title())
        snippets: list[str] = []
        for line in text.splitlines():
            lowered_line = line.lower()
            if any(term in lowered_line for term in terms):
                snippets.append(line.strip())
            if len(snippets) >= max_snippets:
                break
        hits.append(
            SearchHit(
                path=_relative(path, workspace),
                title=title,
                kind="wiki",
                score=score,
                snippets=snippets,
            )
        )
    return hits


# --- Lint Validation ---


def _validate_markdown_links(
    path: Path, text: str, workspace: Path
) -> list[str]:
    """Validate markdown links in a file."""
    issues: list[str] = []
    rel = _relative(path, workspace)
    for target in _extract_markdown_links(text):
        resolved = _resolve_markdown_link(path, target, workspace)
        if resolved is None:
            continue
        if not resolved.exists():
            issues.append(f"{rel}: broken markdown link '{target}'")
    return issues


def _validate_related_pages(path: Path, text: str, workspace: Path) -> list[str]:
    """Validate the Related Pages section."""
    body = _section_body(text, "Related Pages")
    if body is None:
        return []
    has_link = False
    rel = _relative(path, workspace)
    for line in body.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped == "- None linked yet.":
            return [
                f"{rel}: related pages must include at least one real markdown link"
            ]
        if stripped.startswith("- ["):
            has_link = True
            continue
        return [
            f"{rel}: related pages entries must be markdown links or `None linked yet.`"
        ]
    if not has_link:
        return [f"{rel}: related pages must include at least one real markdown link"]
    return []


def _validate_authority_and_recency(
    path: Path, text: str, sources: Sequence[str], workspace: Path
) -> list[str]:
    """Validate the Authority And Recency section."""
    body = _section_body(text, "Authority And Recency")
    if body is None:
        return []

    current_paths, retained_paths, has_recency_rule = _extract_authority_signals(text)
    issues: list[str] = []
    rel = _relative(path, workspace)
    source_set = set(sources)

    if not current_paths:
        issues.append(
            f"{rel}: authority section must name at least one current authority source"
        )
    if not has_recency_rule:
        issues.append(f"{rel}: authority section must include a recency rule")

    for label, paths in (
        ("current authority", current_paths),
        ("retained context", retained_paths),
    ):
        for source in paths:
            if source not in source_set:
                issues.append(
                    f"{rel}: {label} path '{source}' must also appear in Source Artifacts"
                )
            wiki_wiki_prefix = ".claude/wiki/wiki/"
            if source.startswith(wiki_wiki_prefix):
                issues.append(
                    f"{rel}: {label} must cite underlying sources, not sibling wiki pages ('{source}')"
                )

    live_owner_sources = [
        source
        for source in sources
        if not source.startswith(".claude/wiki/raw/")
        and not source.startswith(".claude/wiki/wiki/")
    ]
    if live_owner_sources:
        for source in current_paths:
            if source.startswith(".claude/wiki/raw/"):
                issues.append(
                    f"{rel}: raw provenance '{source}' cannot be named as current authority while live owner sources are cited"
                )

    return issues


def _validate_stale_authority(
    path: Path,
    text: str,
    current_authority: Sequence[str],
    stale_authority_seconds: int | None,
    workspace: Path,
) -> list[str]:
    """Check if current authority sources are newer than the page."""
    if not isinstance(stale_authority_seconds, int) or stale_authority_seconds < 0:
        return []

    page_updated = _parse_last_updated(text)
    if page_updated is None:
        return []

    page_ts = page_updated.timestamp()
    rel = _relative(path, workspace)
    issues: list[str] = []
    for source in current_authority:
        source_path = workspace / source
        if not source_path.exists() or source_path.is_dir():
            continue
        delta = source_path.stat().st_mtime - page_ts
        if delta > stale_authority_seconds:
            issues.append(
                f"{rel}: current authority '{source}' is newer than page Last updated by {int(delta)}s"
            )
    return issues


def _lint_impl(workspace: Path, settings: dict) -> list[str]:
    """Run lint validation on the wiki structure."""
    root = _wiki_root(workspace, settings)
    issues: list[str] = []
    index_path = root / "index.md"
    log_path = root / "log.md"

    if not index_path.exists():
        issues.append("missing index.md")
    if not log_path.exists():
        issues.append("missing log.md")

    index_text = _read_text(index_path) if index_path.exists() else ""
    indexed_paths: set[str] = set()
    if index_path.exists():
        for target in _extract_markdown_links(index_text):
            resolved = _resolve_markdown_link(index_path, target, workspace)
            if resolved is None:
                continue
            if resolved.exists():
                indexed_paths.add(_relative(resolved, workspace))
        issues.extend(_validate_markdown_links(index_path, index_text, workspace))

    all_page_rels = [
        _relative(path, workspace) for path in _all_page_paths(workspace, settings)
    ]
    inbound_links: dict[str, int] = {rel: 0 for rel in all_page_rels}

    for family in settings.get("wiki_families", []):
        family_dir = root / "wiki" / family
        if not family_dir.exists():
            issues.append(f"missing family directory: {_relative(family_dir, workspace)}")
            continue
        for path in sorted(family_dir.glob("*.md")):
            text = _read_text(path)
            rel = _relative(path, workspace)
            if not re.search(r"(?m)^#\s+.+$", text):
                issues.append(f"{rel}: missing top-level heading")
            for section in settings.get("page_required_sections", []):
                if f"## {section}" not in text:
                    issues.append(f"{rel}: missing section '{section}'")
            sources = _extract_source_paths(text)
            if not sources:
                issues.append(f"{rel}: no source artifacts recorded")
            max_source_artifacts = _max_source_artifacts_limit(settings, path)
            if isinstance(max_source_artifacts, int) and len(sources) > max_source_artifacts:
                issues.append(
                    f"{rel}: source artifacts list is too large ({len(sources)} > {max_source_artifacts}); keep the smallest sufficient source set"
                )
            for source in sources:
                if source.startswith(".claude/wiki/wiki/"):
                    issues.append(
                        f"{rel}: source artifacts must cite underlying sources, not sibling wiki page '{source}'"
                    )
                source_path = workspace / source
                if not source_path.exists():
                    issues.append(f"{rel}: missing cited source '{source}'")
            current_authority, _, _ = _extract_authority_signals(text)
            issues.extend(
                _validate_authority_and_recency(path, text, sources, workspace)
            )
            issues.extend(
                _validate_stale_authority(
                    path,
                    text,
                    current_authority,
                    settings.get("stale_authority_seconds"),
                    workspace,
                )
            )
            issues.extend(
                _validate_source_hashes(path, text, settings, workspace)
            )
            issues.extend(_validate_markdown_links(path, text, workspace))
            issues.extend(_validate_related_pages(path, text, workspace))
            related_body = _section_body(text, "Related Pages") or ""
            for target in _extract_markdown_links(related_body):
                resolved = _resolve_markdown_link(path, target, workspace)
                if resolved is None or not resolved.exists():
                    continue
                resolved_rel = _relative(resolved, workspace)
                if resolved_rel in inbound_links:
                    inbound_links[resolved_rel] += 1
            if rel not in indexed_paths:
                issues.append(f"{rel}: orphan page not represented in index.md")

    for rel, count in sorted(inbound_links.items()):
        if count == 0:
            issues.append(f"{rel}: orphan page has no inbound related-page links")

    return issues


def _max_source_artifacts_limit(settings: dict, path: Path) -> int | None:
    """Get the max source artifacts limit for a page."""
    family_overrides = settings.get("max_source_artifacts_per_family", {})
    family = path.parent.name
    if isinstance(family_overrides, dict):
        override = family_overrides.get(family)
        if isinstance(override, int) and override >= 0:
            return override
    default_limit = settings.get("max_source_artifacts_per_page")
    if isinstance(default_limit, int) and default_limit >= 0:
        return default_limit
    return None


def _log_entries(log_path: Path, limit: int) -> list[str]:
    """Get recent log entries."""
    entries = (
        [
            line[3:].strip()
            for line in _read_text(log_path).splitlines()
            if line.startswith("## ")
        ]
        if log_path.exists()
        else []
    )
    return entries[-limit:]


def _log_action_counts(log_path: Path) -> dict[str, int]:
    """Get action counts from log."""
    actions = (
        [
            line.split("|", 1)[1].strip()
            for line in _read_text(log_path).splitlines()
            if line.startswith("## ") and "|" in line
        ]
        if log_path.exists()
        else []
    )
    return dict(sorted(Counter(actions).items()))


def _maintenance_signals(workspace: Path, settings: dict) -> dict:
    """Compute maintenance signals for wiki health."""
    root = _wiki_root(workspace, settings)
    empty_families = [
        family
        for family in settings.get("wiki_families", [])
        if not list((root / "wiki" / family).glob("*.md"))
    ]
    thin_pages: list[str] = []
    stale_pages: list[str] = []
    orphan_pages: list[str] = []
    inbound_links: dict[str, int] = {
        _relative(path, workspace): 0
        for path in _all_page_paths(workspace, settings)
    }

    for path in _all_page_paths(workspace, settings):
        text = _read_text(path)
        rel = _relative(path, workspace)
        summary = _extract_summary(text)
        sources = _extract_source_paths(text)
        notes = _section_body(text, "Notes") or ""
        extra_sections = [
            heading
            for heading in re.findall(r"(?m)^## (.+)$", text)
            if heading not in {*settings.get("page_required_sections", []), "Notes"}
        ]
        if PLACEHOLDER_NOTE in notes or (
            len(sources) <= 1 and len(summary) < 120 and not extra_sections
        ):
            thin_pages.append(rel)
        current_authority, _, _ = _extract_authority_signals(text)
        if _validate_stale_authority(
            path,
            text,
            current_authority,
            settings.get("stale_authority_seconds"),
            workspace,
        ):
            stale_pages.append(rel)
        for target in _extract_related_page_paths(path, text, workspace):
            resolved_rel = _relative(target, workspace)
            if resolved_rel in inbound_links:
                inbound_links[resolved_rel] += 1

    orphan_pages = sorted([rel for rel, count in inbound_links.items() if count == 0])

    return {
        "empty_families": empty_families,
        "thin_pages": sorted(thin_pages),
        "stale_pages": sorted(stale_pages),
        "orphan_pages": orphan_pages,
    }


# --- Public API ---


def wiki_init(workspace: Path) -> dict:
    """Initialize wiki structure in a workspace.

    Creates the full wiki scaffolding including:
    - .claude/wiki/index.md
    - .claude/wiki/log.md
    - .claude/wiki/wiki/systems/ with .gitkeep
    - .claude/wiki/wiki/projects/ with .gitkeep
    - .claude/wiki/wiki/changes/ with .gitkeep
    - .claude/wiki/Templates/page_template.md
    - .claude/state/config/wiki_settings.json
    - .claude/state/curation/wiki_maintenance_backlog.json
    - .claude/state/runtime/wiki_context_receipts/

    This function is idempotent: it does not overwrite existing files.

    Args:
        workspace: Root path of the workspace.

    Returns:
        Dictionary with created files and next command suggestion.
    """
    created_files: list[str] = []
    timestamp = _utc_now()

    # --- Settings file ---
    settings_path = workspace / ".claude" / "state" / "config" / "wiki_settings.json"
    if not settings_path.exists():
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        init_settings = {
            "version": "1.0",
            "wiki_root": ".claude/wiki",
            "wiki_families": ["systems", "projects", "changes", "domains", "reference"],
            "page_required_sections": [
                "Summary",
                "Authority And Recency",
                "Source Artifacts",
                "Related Pages",
            ],
            "max_source_artifacts_per_page": 9,
            "context_receipts": {
                "path": ".claude/state/runtime/wiki_context_receipts",
                "ttl_seconds": 7200,
                "enforce_for_wiki_writes": True,
            },
            "semantic_maintainer": {
                "hook_trigger_path_substrings": [
                    "/external/",
                    "/docs/",
                    "/research/",
                    "/.claude/hooks/",
                    "/.claude/skills/",
                    "/.claude/commands/",
                ],
                "hook_trigger_filenames": ["HANDOFF.md", "UPDATE.txt", "README.md"],
            },
        }
        _write_json_file(settings_path, init_settings)
        created_files.append(_relative(settings_path, workspace))

    # Now load settings (may have been pre-existing or just created)
    settings = load_wiki_settings(workspace)
    root = _wiki_root(workspace, settings)

    # --- Wiki root directories ---
    root.mkdir(parents=True, exist_ok=True)

    # --- index.md ---
    index_path = root / "index.md"
    if not index_path.exists():
        index_content = f"""# Wiki Index

Last updated: {timestamp}

## Systems
<!-- Add system pages here -->

## Projects
<!-- Add project pages here -->

## Changes
<!-- Add change pages here -->

---

Maintenance log: [log.md](log.md)
"""
        _write_text(index_path, index_content)
        created_files.append(_relative(index_path, workspace))

    # --- log.md ---
    log_path = root / "log.md"
    if not log_path.exists():
        log_content = f"""# Wiki Maintenance Log

Append entries in reverse chronological order.

---

## {timestamp} | wiki-init
Initialized wiki structure.
"""
        _write_text(log_path, log_content)
        created_files.append(_relative(log_path, workspace))

    # --- wiki family directories with .gitkeep ---
    core_families = ["systems", "projects", "changes"]
    for family in core_families:
        family_dir = root / "wiki" / family
        family_dir.mkdir(parents=True, exist_ok=True)
        gitkeep_path = family_dir / ".gitkeep"
        if not gitkeep_path.exists():
            gitkeep_path.write_text("")
            created_files.append(_relative(gitkeep_path, workspace))

    # Ensure other wiki families from settings exist (no .gitkeep required)
    for family in settings.get("wiki_families", []):
        (root / "wiki" / family).mkdir(parents=True, exist_ok=True)

    # Ensure raw subdirs exist
    for subdir in settings.get("raw_subdirs", []):
        (root / "raw" / subdir).mkdir(parents=True, exist_ok=True)

    # --- Templates/page_template.md ---
    templates_dir = root / "Templates"
    templates_dir.mkdir(parents=True, exist_ok=True)
    template_path = templates_dir / "page_template.md"
    if not template_path.exists():
        template_content = f"""# <Title>

Last updated: <UTC timestamp>

## Summary
<One-paragraph durable synthesis summary.>

## Authority And Recency
- Current authority: `<projects/...>` for the live owner-maintained source for this topic.
- Recency rule: Prefer the newest owner-maintained source artifacts over harvested provenance, cutover-era packets, or sibling wiki synthesis when conflicts exist.

## Source Artifacts
- `<projects/...>`

## Related Pages
- [Related Page](../systems/example-system.md)

## Notes
- Created or updated by the shared wiki workflow.
"""
        _write_text(template_path, template_content)
        created_files.append(_relative(template_path, workspace))

    # --- Maintenance backlog ---
    backlog_path = workspace / ".claude" / "state" / "curation" / "wiki_maintenance_backlog.json"
    if not backlog_path.exists():
        backlog_path.parent.mkdir(parents=True, exist_ok=True)
        backlog_payload = {"version": "1.0", "items": []}
        _write_json_file(backlog_path, backlog_payload)
        created_files.append(_relative(backlog_path, workspace))

    # --- Context receipts directory ---
    receipts_dir = workspace / ".claude" / "state" / "runtime" / "wiki_context_receipts"
    receipts_dir.mkdir(parents=True, exist_ok=True)
    # Directory itself is not added to created_files since it's a directory

    return {
        "created": created_files,
        "wiki_root": ".claude/wiki",
        "settings_path": ".claude/state/config/wiki_settings.json",
        "next_command": "harness wiki status .",
    }


def wiki_preflight(
    workspace: Path,
    task: str,
    mode: str = "read",
    source_paths: Sequence[str] | None = None,
    page_refs: Sequence[str] | None = None,
    origin: str = "api",
    ttl_seconds: int | None = None,
    no_set_current: bool = False,
) -> dict:
    """Create a wiki context receipt for a task.

    Args:
        workspace: Root path of the workspace.
        task: Description of the task.
        mode: One of 'read', 'write', or 'maintenance'.
        source_paths: List of source artifact paths.
        page_refs: List of page references.
        origin: Origin identifier for the receipt.
        ttl_seconds: Custom TTL in seconds (default from settings).
        no_set_current: If True, do not update current receipt pointer.

    Returns:
        Dictionary with receipt information.
    """
    settings = load_wiki_settings(workspace)
    _ensure_substrate(workspace, settings)
    _ensure_context_receipt_root(workspace, settings)
    _prune_context_receipts(workspace, settings)

    source_list = list(source_paths or [])
    page_ref_list = list(page_refs or [])

    if not task and not source_list and not page_ref_list:
        raise ValueError(
            "preflight requires at least one of task, source_paths, or page_refs"
        )

    # Build required reads list
    read_items: list[dict] = []
    seen: set[str] = set()

    def add_read_item(path: Path, kind: str, reason: str) -> None:
        if not path.exists():
            return
        rel = _relative(path, workspace)
        if rel in seen:
            return
        read_items.append({"path": rel, "kind": kind, "reason": reason})
        seen.add(rel)

    for governance in ("AGENTS.md", "CLAUDE.md", "CODEX.md"):
        gov_path = workspace / governance
        if gov_path.exists():
            add_read_item(gov_path, "governance", "workspace routing context")

    root = _wiki_root(workspace, settings)
    add_read_item(root / "index.md", "wiki-index", "shared wiki entrypoint")

    for source in source_list:
        source_path = workspace / source
        if source_path.exists():
            add_read_item(source_path, "source-artifact", "authoritative source for task")

    candidate_pages = [_relative(p, workspace) for p in _all_page_paths(workspace, settings)[:8]]

    created_at = datetime.now(timezone.utc).replace(microsecond=0)
    actual_ttl = ttl_seconds or int(
        _context_receipt_settings(settings).get("ttl_seconds", 7200)
    )
    expires_at = created_at + timedelta(seconds=max(actual_ttl, 60))

    receipt_payload = {
        "version": "1.0",
        "id": _context_receipt_id(task, source_list, mode),
        "created_at": created_at.isoformat().replace("+00:00", "Z"),
        "expires_at": expires_at.isoformat().replace("+00:00", "Z"),
        "mode": mode,
        "origin": origin,
        "task": task,
        "source_paths": source_list,
        "page_refs": page_ref_list,
        "allow_wiki_mutation": mode in {"write", "maintenance"},
        "required_reads": read_items,
        "candidate_pages": candidate_pages,
    }

    receipt_path = (
        _context_receipt_root(workspace, settings) / f"{receipt_payload['id']}.json"
    )
    _write_json_file(receipt_path, receipt_payload)

    if not no_set_current:
        _write_current_context_receipt(workspace, settings, receipt_path, receipt_payload)

    _prune_context_receipts(workspace, settings)

    return {
        "receipt_id": receipt_payload["id"],
        "receipt_path": _relative(receipt_path, workspace),
        "created_at": receipt_payload["created_at"],
        "expires_at": receipt_payload["expires_at"],
        "mode": mode,
        "required_reads": read_items,
        "candidate_pages": candidate_pages,
        "source_paths": source_list,
    }


def wiki_status(workspace: Path) -> dict:
    """Get wiki status information.

    Args:
        workspace: Root path of the workspace.

    Returns:
        Dictionary with wiki status information.
    """
    settings = load_wiki_settings(workspace)
    _ensure_substrate(workspace, settings)

    root = _wiki_root(workspace, settings)
    backlog = _load_maintenance_backlog(workspace, settings)
    backlog_counts = _maintenance_backlog_counts(backlog)

    page_counts_by_family = {
        family: len(list((root / "wiki" / family).glob("*.md")))
        for family in settings.get("wiki_families", [])
    }
    page_count = sum(page_counts_by_family.values())

    raw_counts = {
        subdir: len(list((root / "raw" / subdir).glob("*")))
        for subdir in settings.get("raw_subdirs", [])
    }

    log_path = root / "log.md"
    last_entry = None
    if log_path.exists():
        for line in reversed(_read_text(log_path).splitlines()):
            if line.startswith("## "):
                last_entry = line[3:].strip()
                break

    issues = _lint_impl(workspace, settings)
    maintenance_sigs = _maintenance_signals(workspace, settings)

    recent_limit = int(settings.get("status", {}).get("recent_log_entries", 5))
    recent_entries = _log_entries(log_path, recent_limit)
    action_counts = _log_action_counts(log_path)

    return {
        "wiki_root": _relative(root, workspace),
        "page_count": page_count,
        "page_counts_by_family": page_counts_by_family,
        "raw_counts": raw_counts,
        "last_log_entry": last_entry,
        "recent_log_entries": recent_entries,
        "log_action_counts": action_counts,
        "lint_issue_count": len(issues),
        "maintenance_backlog": {
            "path": _relative(_backlog_path(workspace, settings), workspace),
            "counts": backlog_counts,
        },
        "maintenance_signals": maintenance_sigs,
    }


def wiki_lint(workspace: Path) -> list[str]:
    """Run lint validation on wiki structure.

    Args:
        workspace: Root path of the workspace.

    Returns:
        List of lint issues found.
    """
    settings = load_wiki_settings(workspace)
    _ensure_substrate(workspace, settings)
    return _lint_impl(workspace, settings)


def wiki_search(
    workspace: Path,
    query: str,
    limit: int | None = None,
    aliases: dict[str, str] | None = None,
) -> list[dict]:
    """Search wiki pages for matching content.

    Args:
        workspace: Root path of the workspace.
        query: Search query string.
        limit: Maximum number of results.
        aliases: Optional query term aliases.

    Returns:
        List of search hit dictionaries.
    """
    settings = load_wiki_settings(workspace)
    _ensure_substrate(workspace, settings)

    hits = _search_wiki(workspace, settings, query, aliases)
    hits.sort(key=lambda hit: (-hit.score, hit.kind, hit.path))

    actual_limit = limit or settings.get("search", {}).get("default_limit", 8)
    return [hit.to_dict() for hit in hits[:actual_limit]]


def wiki_maintain_status(workspace: Path) -> dict:
    """Get maintenance backlog status.

    Args:
        workspace: Root path of the workspace.

    Returns:
        Dictionary with backlog counts and signals.
    """
    settings = load_wiki_settings(workspace)
    _ensure_substrate(workspace, settings)

    backlog = _load_maintenance_backlog(workspace, settings)
    counts = _maintenance_backlog_counts(backlog)
    signals = _maintenance_signals(workspace, settings)

    pending_items = [
        {
            "id": item.get("id"),
            "summary": item.get("summary"),
            "project": item.get("project"),
            "created_at": item.get("created_at"),
        }
        for item in backlog.get("items", [])
        if item.get("status") == "pending"
    ]

    return {
        "backlog_path": _relative(_backlog_path(workspace, settings), workspace),
        "counts": counts,
        "pending_items": pending_items[:10],
        "signals": signals,
    }


# --- Semantic Lint ---


def _find_overlapping_page_pairs(
    workspace: Path, settings: dict
) -> list[tuple[Path, Path, set[str]]]:
    """Find page pairs with overlapping source citations."""
    root = _wiki_root(workspace, settings)
    page_sources: dict[Path, set[str]] = {}
    for family in settings.get("wiki_families", []):
        family_dir = root / "wiki" / family
        if not family_dir.exists():
            continue
        for path in sorted(family_dir.glob("*.md")):
            text = _read_text(path)
            sources = set(_extract_source_paths(text))
            if sources:
                page_sources[path] = sources
    pairs: list[tuple[Path, Path, set[str]]] = []
    pages = list(page_sources.keys())
    for i, page_a in enumerate(pages):
        for page_b in pages[i + 1:]:
            overlap = page_sources[page_a] & page_sources[page_b]
            if overlap:
                pairs.append((page_a, page_b, overlap))
    return pairs


def wiki_semantic_lint(
    workspace: Path,
    limit: int = 10,
    add_to_backlog: bool = False,
) -> dict:
    """Run semantic lint to detect contradictions and redundancies.

    This finds page pairs with overlapping sources and reports them for
    manual review. Full Claude CLI dispatch for semantic analysis requires
    Claude CLI to be installed.

    Args:
        workspace: Root path of the workspace.
        limit: Maximum number of pairs to check.
        add_to_backlog: Whether to add findings to maintenance backlog.

    Returns:
        Dictionary with pairs checked and findings.
    """
    settings = load_wiki_settings(workspace)
    _ensure_substrate(workspace, settings)
    pairs = _find_overlapping_page_pairs(workspace, settings)[:limit]

    findings = []
    for page_a, page_b, shared in pairs:
        findings.append({
            "page_a": _relative(page_a, workspace),
            "page_b": _relative(page_b, workspace),
            "shared_sources": list(shared),
            "requires_review": True,
        })

    if add_to_backlog and findings:
        backlog = _load_maintenance_backlog(workspace, settings)
        for finding in findings:
            page_a_key = finding["page_a"]
            page_b_key = finding["page_b"]
            entry_id = f"semantic-lint-{sha256(f'{page_a_key}:{page_b_key}'.encode()).hexdigest()[:12]}"
            if not any(item.get("id") == entry_id for item in backlog.get("items", [])):
                backlog.setdefault("items", []).append({
                    "id": entry_id,
                    "type": "semantic_review",
                    "summary": f"Review overlap: {finding['page_a']} and {finding['page_b']}",
                    "status": "pending",
                    "created_at": _utc_now(),
                    "details": finding,
                })
        _save_maintenance_backlog(workspace, settings, backlog)

    return {
        "generated_at": _utc_now(),
        "pairs_checked": len(pairs),
        "findings": findings,
    }


# --- Learning Extraction ---


def _load_activity_log(workspace: Path, hours: int) -> list[dict]:
    """Load activity log entries from the last N hours."""
    activity_path = workspace / ".claude" / "state" / "activity.jsonl"
    if not activity_path.exists():
        return []
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    entries: list[dict] = []
    with open(activity_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                ts_str = entry.get("ts", "")
                ts = _parse_utc_timestamp(ts_str)
                if ts and ts >= cutoff:
                    entry["_ts"] = ts
                    entries.append(entry)
            except json.JSONDecodeError:
                continue
    return entries


def _extract_file_from_desc(desc: str) -> str | None:
    """Extract a file path from an activity log description."""
    if not desc:
        return None
    parts = desc.split()
    for part in parts:
        if "/" in part and not part.startswith("-"):
            cleaned = part.strip("'\"(),;:")
            if any(cleaned.endswith(ext) for ext in [".py", ".md", ".json", ".txt"]):
                return cleaned
    return None


def _detect_error_fix_patterns(entries: list[dict]) -> list[dict]:
    """Detect error-fix patterns: failure followed by success on same file."""
    patterns: list[dict] = []
    error_entries: dict[str, list[dict]] = {}
    for entry in entries:
        if not entry.get("ok"):
            file_path = _extract_file_from_desc(entry.get("desc", ""))
            if file_path:
                error_entries.setdefault(file_path, []).append(entry)
    for entry in entries:
        if entry.get("ok") and entry.get("tool") in ("Edit", "Write", "Bash"):
            file_path = _extract_file_from_desc(entry.get("desc", ""))
            if file_path and file_path in error_entries:
                for error_entry in error_entries[file_path]:
                    error_ts = error_entry.get("_ts")
                    success_ts = entry.get("_ts")
                    if error_ts and success_ts and success_ts > error_ts:
                        delta = (success_ts - error_ts).total_seconds()
                        if delta < 600:
                            patterns.append({
                                "type": "error_fix",
                                "file": file_path,
                                "error_ts": error_entry.get("ts"),
                                "fix_ts": entry.get("ts"),
                                "delta_seconds": int(delta),
                            })
    seen = set()
    unique_patterns = []
    for p in patterns:
        key = f"{p['file']}:{p['error_ts']}"
        if key not in seen:
            seen.add(key)
            unique_patterns.append(p)
    return unique_patterns


def _detect_repeated_lookups(entries: list[dict]) -> list[dict]:
    """Detect repeated lookup patterns: same file read 3+ times."""
    read_counts: dict[str, list[dict]] = {}
    for entry in entries:
        if entry.get("tool") == "Read" and entry.get("ok"):
            file_path = _extract_file_from_desc(entry.get("desc", ""))
            if file_path:
                read_counts.setdefault(file_path, []).append(entry)
    patterns: list[dict] = []
    for file_path, read_entries in read_counts.items():
        if len(read_entries) >= 3:
            patterns.append({
                "type": "repeated_lookup",
                "file": file_path,
                "count": len(read_entries),
                "first_ts": read_entries[0].get("ts"),
                "last_ts": read_entries[-1].get("ts"),
            })
    return patterns


def wiki_extract_learnings(workspace: Path, hours: int = 24) -> dict:
    """Extract learning candidates from activity logs.

    Analyzes activity logs for patterns that suggest wiki-worthy content:
    - Error-fix patterns: failure followed by success on same file
    - Repeated lookups: same file read 3+ times

    Args:
        workspace: Root path of the workspace.
        hours: Number of hours of activity to analyze.

    Returns:
        Dictionary with detected patterns and candidate count.
    """
    settings = load_wiki_settings(workspace)
    _ensure_substrate(workspace, settings)
    entries = _load_activity_log(workspace, hours)
    error_fix_patterns = _detect_error_fix_patterns(entries)
    repeated_lookups = _detect_repeated_lookups(entries)

    candidates = []
    for pattern in error_fix_patterns:
        file_stem = Path(pattern["file"]).stem.replace("_", " ").replace("-", " ").title()
        candidates.append({
            "id": f"learning-error-fix-{sha256(pattern['file'].encode()).hexdigest()[:12]}",
            "type": "error_fix",
            "evidence": pattern,
            "proposed_wiki_family": "reference",
            "proposed_slug": f"{Path(pattern['file']).stem}-gotchas",
            "proposed_title": f"{file_stem} Common Issues",
            "confidence": 0.7,
        })
    for pattern in repeated_lookups:
        file_stem = Path(pattern["file"]).stem.replace("_", " ").replace("-", " ").title()
        candidates.append({
            "id": f"learning-lookup-{sha256(pattern['file'].encode()).hexdigest()[:12]}",
            "type": "repeated_lookup",
            "evidence": pattern,
            "proposed_wiki_family": "reference",
            "proposed_slug": Path(pattern["file"]).stem,
            "proposed_title": file_stem,
            "confidence": 0.6,
        })

    return {
        "generated_at": _utc_now(),
        "hours_analyzed": hours,
        "entries_processed": len(entries),
        "error_fix_patterns": len(error_fix_patterns),
        "repeated_lookup_patterns": len(repeated_lookups),
        "candidates": candidates,
    }


# --- Synthesis Capture ---


def _learning_candidates_path(workspace: Path) -> Path:
    """Get path to learning candidates file."""
    return workspace / ".claude" / "state" / "curation" / "learning_candidates.json"


def load_learning_candidates(workspace: Path) -> dict:
    """Load learning candidates from file."""
    path = _learning_candidates_path(workspace)
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, IOError):
            pass
    return {"generated_at": _utc_now(), "candidates": []}


def save_learning_candidates(workspace: Path, payload: dict) -> None:
    """Save learning candidates to file."""
    path = _learning_candidates_path(workspace)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload["generated_at"] = _utc_now()
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def wiki_pending_synthesis(workspace: Path) -> dict:
    """Get pending synthesis candidates.

    Args:
        workspace: Root path of the workspace.

    Returns:
        Dictionary with synthesis candidates awaiting filing.
    """
    candidates = load_learning_candidates(workspace)
    synthesis_candidates = [
        c for c in candidates.get("candidates", [])
        if c.get("type") == "synthesis"
    ]
    return {
        "count": len(synthesis_candidates),
        "candidates": synthesis_candidates,
    }


def build_skill_index(workspace: Path) -> dict:
    """Regenerate skill-index.md from SKILL.md files.

    Args:
        workspace: Root path of the workspace.

    Returns:
        Dictionary with skills_found, skills_indexed, and path_written.
    """
    import re
    import yaml

    skills_dir = workspace / ".claude" / "skills"
    if not skills_dir.exists():
        return {"skills_found": 0, "skills_indexed": 0, "error": "No .claude/skills/ found"}

    skill_files = list(skills_dir.glob("*/SKILL.md"))
    if not skill_files:
        return {"skills_found": 0, "skills_indexed": 0, "error": "No SKILL.md files found"}

    rows = []
    for skill_path in sorted(skill_files):
        content = skill_path.read_text(encoding="utf-8")
        fm_match = re.match(r"^---\n(.*?)\n---", content, re.DOTALL)
        if not fm_match:
            continue
        try:
            fm = yaml.safe_load(fm_match.group(1))
        except Exception:
            continue

        name = fm.get("name", skill_path.parent.name)
        desc = fm.get("description", "")
        trigger = desc.split(".")[0].strip() if "." in desc else desc[:80]
        if len(trigger.split()) > 15:
            trigger = " ".join(trigger.split()[:15])
        rows.append(f"| [{name}](../../skills/{name}/SKILL.md) | {trigger} |")

    if not rows:
        return {"skills_found": len(skill_files), "skills_indexed": 0, "error": "No valid frontmatter"}

    table = "\n".join(rows)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    page_content = f"""# Skill Index

---
family: reference
lifecycle: generated current
last_updated: {now}
---

## Summary

This page lists all skills with their trigger phrases. Agents read this page
before invoking unfamiliar skills to find the right skill by trigger phrase.
Run `harness wiki build-skill-index .` to regenerate after adding custom skills.

## Authority And Recency

- Current authority: `.claude/skills/*/SKILL.md` for live skill definitions.
- Recency rule: Regenerate when custom skills are added via `/suggest`.

## Workflow Skills

| Name | Trigger |
|------|---------|
{table}

## Source Artifacts

- `.claude/skills/*/SKILL.md`

## Related Pages

- [Repository Overview](../repository-overview.md): detected repository profile.
"""

    output_dir = workspace / ".claude" / "wiki" / "wiki" / "reference"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "skill-index.md"
    output_path.write_text(page_content, encoding="utf-8")

    index_path = workspace / ".claude" / "wiki" / "index.md"
    if index_path.exists():
        index_content = index_path.read_text(encoding="utf-8")
        if "skill-index.md" not in index_content and "## Reference" not in index_content:
            if "## Maintenance" in index_content:
                index_content = index_content.replace(
                    "## Maintenance",
                    "## Reference\n\n- [Skill Index](wiki/reference/skill-index.md): compact discovery table for skills.\n\n## Maintenance"
                )
                index_path.write_text(index_content, encoding="utf-8")

    return {
        "skills_found": len(skill_files),
        "skills_indexed": len(rows),
        "path_written": str(output_path),
    }
