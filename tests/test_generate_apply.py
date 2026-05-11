from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from agentos_harness.config import LEDGER_FILE, state_file
from agentos_harness.cli import main
from agentos_harness.generator import apply_manifest, rollback_latest, write_manifest

FIXTURES = Path(__file__).parent / "fixtures"


def test_apply_and_rollback(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    shutil.copytree(FIXTURES / "python_basic", workspace)
    write_manifest(workspace)
    ledger = apply_manifest(workspace)
    assert state_file(workspace, LEDGER_FILE).exists()
    assert (workspace / "AGENTS.md").exists()
    assert ledger["entries"]
    second = apply_manifest(workspace)
    assert all(entry["action"] == "skip" for entry in second["entries"])
    result = rollback_latest(workspace)
    assert "AGENTS.md" in result["removed"]


def test_apply_requires_manifest(tmp_path) -> None:
    with pytest.raises(FileNotFoundError):
        apply_manifest(tmp_path)


def test_generate_apply_without_dry_run_prints_next_steps(tmp_path, capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["generate", str(tmp_path), "--apply"]) == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "harness generate --apply could not apply generated harness files." in captured.err
    assert "Reason: dry-run manifest is required before apply" in captured.err
    assert "harness setup . --dry-run" in captured.err
    assert "harness setup . --apply" in captured.err
    assert ".harness/state/generation_manifest.json" in captured.err
    assert "No repository files were changed by this failed apply." in captured.err
    assert "Traceback" not in captured.err


def test_path_traversal_is_rejected(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    shutil.copytree(FIXTURES / "python_basic", workspace)
    manifest = write_manifest(workspace)
    manifest["entries"].append({"action": "create", "path": "../escape.txt", "content": "bad", "content_hash": "bad"})
    state_file(workspace, "generation_manifest.json").write_text(__import__("json").dumps(manifest), encoding="utf-8")
    with pytest.raises(ValueError):
        apply_manifest(workspace)


def test_apply_rejects_manifest_without_profile_metadata(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    shutil.copytree(FIXTURES / "python_basic", workspace)
    manifest = write_manifest(workspace)
    for key in ("profile", "profile_version", "profile_source_hash"):
        manifest.pop(key)
    state_file(workspace, "generation_manifest.json").write_text(__import__("json").dumps(manifest), encoding="utf-8")
    with pytest.raises(ValueError, match="profile metadata"):
        apply_manifest(workspace)


def test_apply_rejects_stale_profile_metadata(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    shutil.copytree(FIXTURES / "python_basic", workspace)
    manifest = write_manifest(workspace)
    manifest["profile_version"] = "0.0.0"
    state_file(workspace, "generation_manifest.json").write_text(__import__("json").dumps(manifest), encoding="utf-8")
    with pytest.raises(ValueError, match="profile metadata is stale"):
        apply_manifest(workspace)
