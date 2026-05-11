"""Harness generation manifest and apply logic."""

from __future__ import annotations

import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .analyzer import analyze_workspace
from .config import BACKUP_DIR, LEDGER_FILE, MANIFEST_FILE, ensure_state_dir, resolve_workspace, state_dir, state_file
from .existing_harness import merge_settings_json
from .models import content_hash, file_hash, read_json, write_json
from .profile_registry import CORE_PROFILE_NAME, profile_metadata, render_profile, symlink_targets
from .setup_modules import selected_modules, unselected_modules


def _safe_target(root: Path, relative_path: str) -> Path:
    candidate = (root / relative_path).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError as exc:
        raise ValueError(f"path escapes workspace: {relative_path}") from exc
    return candidate


def build_manifest(
    workspace: str | Path,
    analysis: dict[str, Any] | None = None,
    *,
    profile: str = CORE_PROFILE_NAME,
    setup_mode: str = "generate",
) -> dict[str, Any]:
    root = resolve_workspace(workspace)
    current = analysis or analyze_workspace(root, write_state=False)

    harness_migration = current.get("harness_migration", {})
    preserve_paths = set(harness_migration.get("preserve_paths", []))
    merge_settings = harness_migration.get("merge_settings", False)

    entries: list[dict[str, Any]] = []
    for rel_path, content in sorted(render_profile(current, profile).items()):
        if rel_path in preserve_paths:
            entries.append({
                "action": "skip",
                "path": rel_path,
                "content_hash": file_hash(content),
                "content": content,
                "reason": "preserved by user choice",
            })
            continue

        if rel_path == ".claude/settings.json" and merge_settings:
            try:
                new_settings = json.loads(content)
                merged = merge_settings_json(root, new_settings)
                content = json.dumps(merged, indent=2, sort_keys=True)
            except (json.JSONDecodeError, TypeError):
                pass
        target = _safe_target(root, rel_path)
        if target.exists():
            existing = target.read_text(encoding="utf-8", errors="ignore")
            if existing == content:
                action = "skip"
            elif rel_path == "AGENTS.md" and "Generated Harness" not in existing:
                action = "modify"
                content = existing.rstrip() + "\n\n## Generated Harness\n\nRun `harness analyze .` after repository structure changes.\n"
            else:
                action = "backup_required"
        else:
            action = "create"
        entries.append(
            {
                "action": action,
                "path": rel_path,
                "content_hash": file_hash(content),
                "content": content,
            }
        )

    if os.name != "nt":
        for rel_path, target_rel in symlink_targets(profile).items():
            target = _safe_target(root, rel_path)
            action = "skip" if target.exists() else "symlink"
            entries.append(
                {
                    "action": action,
                    "path": rel_path,
                    "target": target_rel,
                    "content_hash": file_hash(target_rel),
                }
            )

    manifest = {
        "schema_version": "1.0",
        "created_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        **profile_metadata(profile),
        "setup_mode": setup_mode,
        "selected_modules": selected_modules(current),
        "unselected_modules": unselected_modules(current),
        "confirmed_projects": current.get("confirmed_projects", []),
        "project_layout": current.get("project_layout", current.get("confirmed_projects", [])),
        "discipline_settings": current.get("discipline_settings", {}),
        "analysis_hash": current["analysis_hash"],
        "workspace": {
            "root": str(root),
            "display_name": current["workspace"]["display_name"],
        },
        "entries": sorted(entries, key=lambda item: item["path"]),
    }
    manifest["manifest_hash"] = content_hash({k: v for k, v in manifest.items() if k != "created_at"})
    return manifest


def write_manifest(
    workspace: str | Path,
    *,
    profile: str = CORE_PROFILE_NAME,
    analysis: dict[str, Any] | None = None,
    setup_mode: str = "generate",
) -> dict[str, Any]:
    root = resolve_workspace(workspace)
    manifest = build_manifest(root, analysis=analysis, profile=profile, setup_mode=setup_mode)
    ensure_state_dir(root)
    write_json(state_file(root, MANIFEST_FILE), manifest)
    return manifest


def _backup(root: Path, target: Path, ledger_id: str) -> str | None:
    if not target.exists() and not target.is_symlink():
        return None
    rel = target.relative_to(root).as_posix()
    backup_path = state_dir(root) / BACKUP_DIR / ledger_id / rel
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    if target.is_dir() and not target.is_symlink():
        shutil.copytree(target, backup_path, dirs_exist_ok=True)
    else:
        shutil.copy2(target, backup_path)
    return backup_path.relative_to(root).as_posix()


def apply_manifest(workspace: str | Path) -> dict[str, Any]:
    root = resolve_workspace(workspace)
    manifest_path = state_file(root, MANIFEST_FILE)
    if not manifest_path.exists():
        raise FileNotFoundError("dry-run manifest is required before apply")
    manifest = read_json(manifest_path)
    if not manifest.get("profile") or not manifest.get("profile_version") or not manifest.get("profile_source_hash"):
        raise ValueError("manifest profile metadata is missing; rerun dry-run with the current package")
    expected_metadata = profile_metadata(manifest["profile"])
    for key, value in expected_metadata.items():
        if manifest.get(key) != value:
            raise ValueError("manifest profile metadata is stale; rerun dry-run with the current package")
    current = analyze_workspace(root, write_state=False)
    if manifest.get("analysis_hash") != current.get("analysis_hash"):
        ledger_path = state_file(root, LEDGER_FILE)
        if not ledger_path.exists() or read_json(ledger_path).get("manifest_hash") != manifest.get("manifest_hash"):
            raise ValueError("manifest analysis hash does not match current workspace analysis")

    ledger_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    applied: list[dict[str, Any]] = []
    for entry in manifest["entries"]:
        action = entry["action"]
        rel_path = entry["path"]
        target = _safe_target(root, rel_path)
        record = {"path": rel_path, "action": action, "backup": None}
        if action == "skip":
            applied.append(record)
            continue
        if action in {"create", "modify", "backup_required"}:
            content = entry["content"]
            if target.exists() and target.read_text(encoding="utf-8", errors="ignore") == content:
                record["action"] = "skip"
                applied.append(record)
                continue
            record["backup"] = _backup(root, target, ledger_id)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
        elif action == "symlink":
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists() or target.is_symlink():
                record["action"] = "skip"
            else:
                target.symlink_to(entry["target"])
        else:
            raise ValueError(f"unknown manifest action: {action}")
        applied.append(record)

    ledger = {
        "schema_version": "1.0",
        "ledger_id": ledger_id,
        "manifest_hash": manifest["manifest_hash"],
        "applied_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "entries": applied,
    }
    if all(entry["action"] == "skip" for entry in applied) and state_file(root, LEDGER_FILE).exists():
        return ledger
    write_json(state_file(root, LEDGER_FILE), ledger)
    return ledger


def rollback_latest(workspace: str | Path) -> dict[str, Any]:
    root = resolve_workspace(workspace)
    ledger_path = state_file(root, LEDGER_FILE)
    if not ledger_path.exists():
        raise FileNotFoundError("generation ledger is required before rollback")
    ledger = read_json(ledger_path)
    restored: list[str] = []
    removed: list[str] = []
    for entry in reversed(ledger["entries"]):
        target = _safe_target(root, entry["path"])
        backup = entry.get("backup")
        if backup:
            backup_path = root / backup
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists() or target.is_symlink():
                if target.is_dir() and not target.is_symlink():
                    shutil.rmtree(target)
                else:
                    target.unlink()
            shutil.copy2(backup_path, target)
            restored.append(entry["path"])
        elif entry["action"] in {"create", "symlink"} and (target.exists() or target.is_symlink()):
            if target.is_dir() and not target.is_symlink():
                shutil.rmtree(target)
            else:
                target.unlink()
            removed.append(entry["path"])
    result = {"restored": sorted(restored), "removed": sorted(removed)}
    write_json(state_file(root, "rollback_result.json"), result)
    return result


def manifest_summary(manifest: dict[str, Any]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for entry in manifest.get("entries", []):
        counts[entry["action"]] = counts.get(entry["action"], 0) + 1
    return counts
