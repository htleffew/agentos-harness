"""Wiki state validation for harness validate command."""

from __future__ import annotations

import json
import re
from pathlib import Path

from .wiki import load_wiki_settings, wiki_lint


def validate_wiki_state(workspace: Path) -> dict:
    """Validate wiki structural integrity.

    Checks:
    - index.md exists and has required family sections
    - log.md exists and has parseable log entries
    - Wiki lint checks pass
    - Maintenance backlog is valid JSON
    - Wiki settings are valid

    Args:
        workspace: Root path of the workspace.

    Returns:
        Dictionary with validation results:
        - passed: bool
        - issue_count: int
        - issues: list[str]
        - index_valid: bool
        - log_valid: bool
        - lint_issues: list[str]
        - backlog_valid: bool
        - settings_valid: bool
    """
    issues: list[str] = []
    settings = load_wiki_settings(workspace)
    wiki_root = workspace / settings.get("wiki_root", ".claude/wiki")

    index_valid = True
    log_valid = True
    backlog_valid = True
    settings_valid = True

    index_path = wiki_root / "index.md"
    if not index_path.exists():
        issues.append("missing index.md")
        index_valid = False
    else:
        text = index_path.read_text(encoding="utf-8")
        for family in settings.get("wiki_families", []):
            if f"## {family}" not in text and f"## {family.title()}" not in text:
                if family.lower() not in text.lower():
                    issues.append(f"index.md: missing family section '{family}'")
                    index_valid = False

    log_path = wiki_root / "log.md"
    if not log_path.exists():
        issues.append("missing log.md")
        log_valid = False
    else:
        text = log_path.read_text(encoding="utf-8")
        headings = re.findall(
            r"(?m)^## (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z) \| ([a-z0-9-]+)$",
            text,
        )
        if not headings:
            issues.append("log.md: no parseable log entries found")
            log_valid = False

    lint_issues = wiki_lint(workspace)
    for issue in lint_issues:
        issues.append(f"wiki lint: {issue}")

    backlog_path = workspace / settings.get("maintenance_backlog", {}).get(
        "path",
        ".claude/state/curation/wiki_maintenance_backlog.json",
    )
    harness_backlog = workspace / ".harness" / "state" / "wiki_maintenance_backlog.json"

    actual_backlog = None
    if backlog_path.exists():
        actual_backlog = backlog_path
    elif harness_backlog.exists():
        actual_backlog = harness_backlog

    if actual_backlog is not None:
        try:
            backlog = json.loads(actual_backlog.read_text(encoding="utf-8"))
            if not isinstance(backlog, dict):
                issues.append("maintenance backlog: root must be a JSON object")
                backlog_valid = False
            elif not isinstance(backlog.get("items"), list):
                issues.append("maintenance backlog: 'items' must be an array")
                backlog_valid = False
        except json.JSONDecodeError as e:
            issues.append(f"maintenance backlog: invalid JSON ({e})")
            backlog_valid = False

    settings_path = workspace / ".claude" / "state" / "config" / "wiki_settings.json"
    harness_settings_path = workspace / ".harness" / "state" / "config" / "wiki_settings.json"

    actual_settings = None
    if settings_path.exists():
        actual_settings = settings_path
    elif harness_settings_path.exists():
        actual_settings = harness_settings_path

    if actual_settings is not None:
        try:
            settings_data = json.loads(actual_settings.read_text(encoding="utf-8"))
            if not isinstance(settings_data, dict):
                issues.append("wiki settings: root must be a JSON object")
                settings_valid = False
        except json.JSONDecodeError as e:
            issues.append(f"wiki settings: invalid JSON ({e})")
            settings_valid = False

    return {
        "passed": len(issues) == 0,
        "issue_count": len(issues),
        "issues": issues,
        "index_valid": index_valid,
        "log_valid": log_valid,
        "lint_issues": lint_issues,
        "backlog_valid": backlog_valid,
        "settings_valid": settings_valid,
    }
