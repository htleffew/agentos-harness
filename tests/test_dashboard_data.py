from __future__ import annotations

import shutil
from pathlib import Path

from agentos_harness.dashboard_data import build_dashboard_state
from agentos_harness.generator import apply_manifest, write_manifest

FIXTURES = Path(__file__).parent / "fixtures"


def test_dashboard_state_empty_workspace(tmp_path) -> None:
    payload = build_dashboard_state(tmp_path)
    assert payload["schema_version"] == "1.0"
    assert payload["verdict"]["status"] == "attention"
    assert payload["verdict"]["next_command"] == "harness setup . --dry-run"
    assert {section["id"] for section in payload["sections"]} >= {"overview", "wiki", "skills", "commands", "hooks", "setup", "projects", "activity", "search"}


def test_dashboard_state_generated_workspace(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    shutil.copytree(FIXTURES / "python_basic", workspace)
    write_manifest(workspace)
    apply_manifest(workspace)
    payload = build_dashboard_state(workspace)
    assert payload["inventory"]["wiki_pages"] > 0
    assert payload["inventory"]["skills"] > 0
    assert payload["inventory"]["commands"] > 0
    assert payload["inventory"]["hooks"] > 1
    assert payload["inventory"]["setup_modules"] > 0
    setup = next(section for section in payload["sections"] if section["id"] == "setup")
    assert setup["rows"]
