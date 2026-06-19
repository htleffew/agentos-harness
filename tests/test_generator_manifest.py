from __future__ import annotations

import shutil
from pathlib import Path

from agentos_harness.config import MANIFEST_FILE, state_file
from agentos_harness.generator import write_manifest

FIXTURES = Path(__file__).parent / "fixtures"


def test_dry_run_writes_only_manifest(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    shutil.copytree(FIXTURES / "python_basic", workspace)
    before = sorted(path.relative_to(workspace).as_posix() for path in workspace.rglob("*") if path.is_file())
    manifest = write_manifest(workspace)
    after = sorted(path.relative_to(workspace).as_posix() for path in workspace.rglob("*") if path.is_file())
    assert state_file(workspace, MANIFEST_FILE).exists()
    assert set(after) - set(before) == {".harness/state/generation_manifest.json"}
    assert [entry["path"] for entry in manifest["entries"]] == sorted(entry["path"] for entry in manifest["entries"])


def test_existing_files_require_backup_or_merge(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    shutil.copytree(FIXTURES / "existing_partial_harness", workspace)
    manifest = write_manifest(workspace)
    actions = {entry["path"]: entry["action"] for entry in manifest["entries"]}
    assert actions["AGENTS.md"] in {"modify", "skip"}
    assert actions[".claude/commands/status.md"] == "create"
    assert actions["CLAUDE.md"] == "create"
    assert actions["CODEX.md"] == "create"


def test_templates_are_workspace_neutral(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    shutil.copytree(FIXTURES / "python_basic", workspace)
    manifest = write_manifest(workspace)
    text = "\n".join(entry.get("content", "") for entry in manifest["entries"])
    import re
    assert re.search(r"/home/\w", text) is None
    assert re.search(r"/Users/\w", text) is None
    assert "s3://" not in text


def test_manifest_records_profile_metadata(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    shutil.copytree(FIXTURES / "python_basic", workspace)
    manifest = write_manifest(workspace)
    assert manifest["profile"] == "core"
    assert manifest["profile_version"]
    assert len(manifest["profile_source_hash"]) == 64
    assert "selected_modules" in manifest
    assert "unselected_modules" in manifest
    assert manifest["manifest_hash"]
