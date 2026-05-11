from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

from agentos_harness.cli import main
from agentos_harness.config import state_file
from agentos_harness.dashboard_data import build_dashboard_state

FIXTURES = Path(__file__).parent / "fixtures"


def test_end_to_end_fixture_flow(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    shutil.copytree(FIXTURES / "python_basic", workspace)
    subprocess.run(["git", "init"], cwd=workspace, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    assert main(["setup", str(workspace), "--dry-run", "--non-interactive"]) == 0
    assert main(["setup", str(workspace), "--apply", "--non-interactive"]) == 0
    state = build_dashboard_state(workspace)
    assert state["inventory"]["wiki_pages"] > 0
    assert state["inventory"]["setup_modules"] > 0
    assert main(["rollback", str(workspace)]) == 0


def test_no_git_fallback(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    shutil.copytree(FIXTURES / "typescript_basic", workspace)
    assert main(["analyze", str(workspace)]) == 0
    payload = json.loads(state_file(workspace, "analysis.json").read_text(encoding="utf-8"))
    assert payload["workspace"]["has_git"] is False


# Wiki end-to-end tests


def test_wiki_init_on_empty_workspace(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    assert main(["wiki", "init", str(workspace)]) == 0
    assert (workspace / ".claude" / "wiki" / "index.md").exists()
    assert (workspace / ".claude" / "wiki" / "log.md").exists()
    assert (workspace / ".claude" / "state" / "config" / "wiki_settings.json").exists()


def test_wiki_status_on_populated_wiki(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    shutil.copytree(FIXTURES / "wiki_workspace", workspace)
    assert main(["wiki", "status", str(workspace)]) == 0


def test_wiki_lint_passes_on_valid_wiki(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    shutil.copytree(FIXTURES / "wiki_workspace", workspace)
    assert main(["wiki", "lint", str(workspace)]) == 0


def test_wiki_lint_fails_on_broken_links(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    shutil.copytree(FIXTURES / "wiki_workspace", workspace)
    index_path = workspace / ".claude" / "wiki" / "index.md"
    content = index_path.read_text()
    content = content.replace("wiki/systems/example-system.md", "wiki/systems/nonexistent.md")
    index_path.write_text(content)
    assert main(["wiki", "lint", str(workspace)]) == 1


def test_wiki_search_returns_hits(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    shutil.copytree(FIXTURES / "wiki_workspace", workspace)
    assert main(["wiki", "search", str(workspace), "example"]) == 0


def test_wiki_preflight_creates_receipt(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    shutil.copytree(FIXTURES / "wiki_workspace", workspace)
    (workspace / ".claude" / "state" / "runtime" / "wiki_context_receipts").mkdir(parents=True, exist_ok=True)
    assert main(["wiki", "preflight", str(workspace), "--task", "test task"]) == 0
    receipts_dir = workspace / ".claude" / "state" / "runtime" / "wiki_context_receipts"
    receipt_files = list(receipts_dir.glob("*.json"))
    assert len(receipt_files) >= 1
