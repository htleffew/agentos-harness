"""Rollback entrypoint helpers."""

from __future__ import annotations

from pathlib import Path

from .generator import rollback_latest


def rollback(workspace: str | Path) -> dict:
    return rollback_latest(workspace)
