"""Shared package configuration."""

from __future__ import annotations

from pathlib import Path

PACKAGE_NAME = "agentos-harness"
STATE_DIR = ".harness/state"
ANALYSIS_FILE = "analysis.json"
MANIFEST_FILE = "generation_manifest.json"
DASHBOARD_STATE_FILE = "dashboard_state.json"
SETUP_STATE_FILE = "setup.json"
LEDGER_FILE = "generation_ledger.json"
BACKUP_DIR = "backups"
SCHEMA_VERSION = "1.0"


def resolve_workspace(workspace: str | Path | None) -> Path:
    root = Path(workspace or ".").expanduser().resolve()
    if not root.exists():
        raise FileNotFoundError(f"workspace does not exist: {root}")
    if not root.is_dir():
        raise NotADirectoryError(f"workspace is not a directory: {root}")
    return root


def state_dir(workspace: str | Path) -> Path:
    return Path(workspace).resolve() / STATE_DIR


def state_file(workspace: str | Path, filename: str) -> Path:
    return state_dir(workspace) / filename


def ensure_state_dir(workspace: str | Path) -> Path:
    path = state_dir(workspace)
    path.mkdir(parents=True, exist_ok=True)
    return path
