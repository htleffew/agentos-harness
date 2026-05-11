from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from agentos_harness.dashboard_data import build_dashboard_state
from agentos_harness.dashboard_server import create_server
from agentos_harness.generator import apply_manifest, write_manifest

FIXTURES = Path(__file__).parent / "fixtures"
PACKAGE_ROOT = Path(__file__).parents[1]


def test_dashboard_state_redacts_credentials(tmp_path) -> None:
    (tmp_path / "README.md").write_text("API_TOKEN=abc123\n", encoding="utf-8")
    payload = build_dashboard_state(tmp_path)
    assert "abc123" not in str(payload)


def test_dashboard_refresh_does_not_generate_harness_files(tmp_path) -> None:
    before = sorted(path.relative_to(tmp_path).as_posix() for path in tmp_path.rglob("*"))
    build_dashboard_state(tmp_path)
    after = sorted(path.relative_to(tmp_path).as_posix() for path in tmp_path.rglob("*"))
    assert ".claude" not in {item.split("/")[0] for item in after}
    assert set(after) - set(before) <= {".harness", ".harness/state", ".harness/state/analysis.json", ".harness/state/dashboard_state.json"}


def test_dashboard_rejects_unapproved_host(tmp_path) -> None:
    with pytest.raises(ValueError):
        create_server(tmp_path, host="192.0.2.10", port=0)


def test_apply_writes_inside_workspace_only(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    shutil.copytree(FIXTURES / "python_basic", workspace)
    write_manifest(workspace)
    apply_manifest(workspace)
    assert not (tmp_path / "AGENTS.md").exists()
    assert (workspace / "AGENTS.md").exists()


def test_package_source_does_not_ship_project_continuity_files() -> None:
    forbidden = [
        path.relative_to(PACKAGE_ROOT).as_posix()
        for path in PACKAGE_ROOT.iterdir()
        if path.name.endswith(("HANDOFF.md", "UPDATE.txt"))
    ]
    assert forbidden == []
