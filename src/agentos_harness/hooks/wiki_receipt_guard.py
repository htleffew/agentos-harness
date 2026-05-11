#!/usr/bin/env python3
"""PreToolUse hook: require a fresh wiki context receipt for write-capable wiki work."""

from __future__ import annotations

import json
import re
import select
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Tuple, Optional, Dict, Any


def _find_workspace_root() -> Path:
    """Find workspace root by searching for .claude directory."""
    current = Path.cwd().resolve()
    for parent in [current, *current.parents]:
        if (parent / ".claude").is_dir():
            return parent
    return current


PROTECTED_PATH_PREFIXES = (".claude/wiki/wiki/",)
PROTECTED_EXACT_PATHS = {
    ".claude/wiki/index.md",
    ".claude/wiki/log.md",
    ".claude/state/curation/wiki_maintenance_backlog.json",
}
DEFAULT_RECEIPT_ROOT = ".claude/state/runtime/wiki_context_receipts"
SETTINGS_REL_PATH = ".claude/state/config/wiki_settings.json"

BASH_RECEIPT_PATTERNS = [
    (re.compile(r"\bwiki_cli\.py\s+ingest\b"), "wiki ingest"),
    (re.compile(r"\bwiki_cli\.py\s+query\b(?=.*--writeback-)", re.DOTALL), "wiki query writeback"),
    (
        re.compile(
            r"\bwiki_cli\.py\s+maintain\b(?=.*--(?:complete-entry|dismiss-entry|dispatch-entry|dispatch-latest))",
            re.DOTALL,
        ),
        "wiki maintain write-capable resolution/dispatch",
    ),
]


def _load_settings(repo_root: Path) -> Dict[str, Any]:
    """Load wiki settings from standard path."""
    settings_path = repo_root / SETTINGS_REL_PATH
    try:
        return json.loads(settings_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _normalize_relative_path(file_path: str, repo_root: Path) -> str:
    """Convert absolute or relative path to repo-relative posix path."""
    path = Path(file_path.strip())
    if not file_path.strip():
        return ""
    if path.is_absolute():
        try:
            return path.relative_to(repo_root).as_posix()
        except ValueError:
            return file_path.strip()
    return file_path.strip().lstrip("./")


def _context_receipt_root(settings: Dict[str, Any], repo_root: Path) -> Path:
    """Get the context receipt root directory."""
    receipt_settings = settings.get("context_receipts", {}) or {}
    return repo_root / receipt_settings.get("path", DEFAULT_RECEIPT_ROOT)


def _current_receipt_pointer_path(settings: Dict[str, Any], repo_root: Path) -> Path:
    """Get the path to the current receipt pointer file."""
    receipt_settings = settings.get("context_receipts", {}) or {}
    return _context_receipt_root(settings, repo_root) / receipt_settings.get("current_file", "current.json")


def _load_json(path: Path) -> Optional[Dict[str, Any]]:
    """Load JSON from path, returning None on failure."""
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def _parse_timestamp(value: Optional[str]) -> Optional[datetime]:
    """Parse ISO timestamp string to datetime."""
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _load_current_receipt(settings: Dict[str, Any], repo_root: Path) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Load the current receipt payload and its path."""
    pointer = _load_json(_current_receipt_pointer_path(settings, repo_root))
    if not isinstance(pointer, dict):
        return None, None
    receipt_rel = pointer.get("receipt_path")
    if not isinstance(receipt_rel, str) or not receipt_rel:
        return None, None
    receipt_path = repo_root / receipt_rel
    payload = _load_json(receipt_path)
    return payload, receipt_rel


def _fresh_write_receipt(settings: Dict[str, Any], repo_root: Path) -> Tuple[bool, str]:
    """Check if there is a fresh write-capable receipt."""
    payload, receipt_rel = _load_current_receipt(settings, repo_root)
    if not isinstance(payload, dict):
        return False, "No current wiki context receipt is recorded."
    expires_at = _parse_timestamp(payload.get("expires_at"))
    if expires_at is None or expires_at < datetime.now(timezone.utc):
        return False, f"Wiki context receipt is missing or expired: {receipt_rel or 'unknown'}"
    if not payload.get("allow_wiki_mutation", False):
        return False, f"Current wiki context receipt is read-only: {receipt_rel or 'unknown'}"
    return True, receipt_rel or "unknown"


def _deny(reason: str) -> None:
    """Output denial response in hook format."""
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": (
                        reason
                        + " Run `wiki_cli.py preflight --task \"<task>\"` "
                        "and read the required context pack before performing write-capable wiki work."
                    ),
                }
            }
        )
    )


def _protected_wiki_path(rel_path: str) -> bool:
    """Check if path is a protected wiki path."""
    return rel_path.startswith(PROTECTED_PATH_PREFIXES) or rel_path in PROTECTED_EXACT_PATHS


def _bash_operation_requiring_receipt(command: str) -> Optional[str]:
    """Check if bash command requires a receipt, returning operation name or None."""
    if re.search(r"\bwiki_cli\.py\s+preflight\b", command):
        return None
    if re.search(r"\bwiki_cli\.py\s+maintain\b(?=.*--finalize-entry)", command, re.DOTALL):
        return None
    for pattern, label in BASH_RECEIPT_PATTERNS:
        if pattern.search(command):
            return label
    return None


def main() -> None:
    """Main entry point for the PreToolUse hook."""
    if not select.select([sys.stdin], [], [], 0.0)[0]:
        sys.exit(0)

    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    repo_root = _find_workspace_root()
    settings = _load_settings(repo_root)
    if not (settings.get("context_receipts", {}) or {}).get("enforce_for_wiki_writes", True):
        sys.exit(0)

    tool_name = payload.get("tool_name", "")
    tool_input = payload.get("tool_input", {}) or {}

    if tool_name in {"Edit", "Write"}:
        file_path = tool_input.get("file_path", "") or tool_input.get("path", "")
        rel_path = _normalize_relative_path(file_path, repo_root)
        if not rel_path or not _protected_wiki_path(rel_path):
            sys.exit(0)
        ok, detail = _fresh_write_receipt(settings, repo_root)
        if ok:
            sys.exit(0)
        _deny(f"Write-capable wiki mutation blocked for `{rel_path}`. {detail}")
        sys.exit(0)

    if tool_name == "Bash":
        command = tool_input.get("command", "")
        operation = _bash_operation_requiring_receipt(command)
        if operation is None:
            sys.exit(0)
        ok, detail = _fresh_write_receipt(settings, repo_root)
        if ok:
            sys.exit(0)
        _deny(f"Write-capable wiki command blocked for `{operation}`. {detail}")
        sys.exit(0)

    sys.exit(0)


if __name__ == "__main__":
    main()
