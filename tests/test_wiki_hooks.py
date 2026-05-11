"""Tests for wiki_receipt_guard and wiki_sweep hooks."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from datetime import datetime, timezone, timedelta
from pathlib import Path
from unittest.mock import patch

import pytest


# --- Fixtures ---

@pytest.fixture
def temp_workspace(tmp_path: Path):
    """Create a minimal workspace structure for testing."""
    claude_dir = tmp_path / ".claude"
    claude_dir.mkdir()

    wiki_dir = claude_dir / "wiki" / "wiki"
    wiki_dir.mkdir(parents=True)

    state_dir = claude_dir / "state" / "config"
    state_dir.mkdir(parents=True)

    curation_dir = claude_dir / "state" / "curation"
    curation_dir.mkdir(parents=True)

    receipts_dir = claude_dir / "state" / "runtime" / "wiki_context_receipts"
    receipts_dir.mkdir(parents=True)

    return tmp_path


@pytest.fixture
def wiki_settings(temp_workspace: Path):
    """Create wiki settings file."""
    settings_path = temp_workspace / ".claude" / "state" / "config" / "wiki_settings.json"
    settings = {
        "context_receipts": {
            "path": ".claude/state/runtime/wiki_context_receipts",
            "current_file": "current.json",
            "enforce_for_wiki_writes": True
        }
    }
    settings_path.write_text(json.dumps(settings))
    return settings_path


def create_receipt(temp_workspace: Path, expired: bool = False, allow_mutation: bool = True) -> Path:
    """Create a wiki context receipt."""
    receipts_dir = temp_workspace / ".claude" / "state" / "runtime" / "wiki_context_receipts"

    if expired:
        expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
    else:
        expires_at = datetime.now(timezone.utc) + timedelta(hours=1)

    receipt = {
        "expires_at": expires_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "allow_wiki_mutation": allow_mutation,
        "task": "test task"
    }

    receipt_path = receipts_dir / "receipt_001.json"
    receipt_path.write_text(json.dumps(receipt))

    pointer = {"receipt_path": str(receipt_path.relative_to(temp_workspace))}
    pointer_path = receipts_dir / "current.json"
    pointer_path.write_text(json.dumps(pointer))

    return receipt_path


def create_backlog(temp_workspace: Path, pending_count: int = 0) -> Path:
    """Create a wiki maintenance backlog."""
    backlog_path = temp_workspace / ".claude" / "state" / "curation" / "wiki_maintenance_backlog.json"
    items = [{"status": "pending", "id": f"item_{i}"} for i in range(pending_count)]
    items.extend([{"status": "completed", "id": "done_1"}])
    backlog = {"items": items}
    backlog_path.write_text(json.dumps(backlog))
    return backlog_path


# --- wiki_receipt_guard tests ---

class TestWikiReceiptGuard:
    """Tests for wiki_receipt_guard hook."""

    def get_hook_path(self) -> Path:
        return Path(__file__).parent.parent / "src" / "agentos_harness" / "hooks" / "wiki_receipt_guard.py"

    def run_hook(self, input_data: dict, cwd: Path) -> tuple[int, str, str]:
        """Run the hook with given input and return exit code, stdout, stderr."""
        proc = subprocess.run(
            [sys.executable, str(self.get_hook_path())],
            input=json.dumps(input_data),
            capture_output=True,
            text=True,
            cwd=str(cwd)
        )
        return proc.returncode, proc.stdout, proc.stderr

    def test_blocks_edit_to_wiki_without_receipt(self, temp_workspace: Path, wiki_settings: Path):
        """Edit to .claude/wiki/wiki/ should be blocked without receipt."""
        input_data = {
            "tool_name": "Edit",
            "tool_input": {
                "file_path": str(temp_workspace / ".claude" / "wiki" / "wiki" / "page.md")
            }
        }

        exit_code, stdout, stderr = self.run_hook(input_data, temp_workspace)

        assert exit_code == 0
        if stdout.strip():
            output = json.loads(stdout)
            assert output["hookSpecificOutput"]["permissionDecision"] == "deny"
            assert "wiki" in output["hookSpecificOutput"]["permissionDecisionReason"].lower()

    def test_allows_edit_to_wiki_with_fresh_receipt(self, temp_workspace: Path, wiki_settings: Path):
        """Edit to .claude/wiki/wiki/ should be allowed with fresh receipt."""
        create_receipt(temp_workspace, expired=False, allow_mutation=True)

        input_data = {
            "tool_name": "Edit",
            "tool_input": {
                "file_path": str(temp_workspace / ".claude" / "wiki" / "wiki" / "page.md")
            }
        }

        exit_code, stdout, stderr = self.run_hook(input_data, temp_workspace)

        assert exit_code == 0
        # No output means allowed
        if stdout.strip():
            output = json.loads(stdout)
            assert "permissionDecision" not in output.get("hookSpecificOutput", {}) or \
                   output["hookSpecificOutput"].get("permissionDecision") != "deny"

    def test_blocks_bash_wiki_ingest_without_receipt(self, temp_workspace: Path, wiki_settings: Path):
        """Bash wiki_cli.py ingest should be blocked without receipt."""
        input_data = {
            "tool_name": "Bash",
            "tool_input": {
                "command": "python wiki_cli.py ingest --source foo.md"
            }
        }

        exit_code, stdout, stderr = self.run_hook(input_data, temp_workspace)

        assert exit_code == 0
        if stdout.strip():
            output = json.loads(stdout)
            assert output["hookSpecificOutput"]["permissionDecision"] == "deny"
            assert "ingest" in output["hookSpecificOutput"]["permissionDecisionReason"].lower()

    def test_allows_non_wiki_paths(self, temp_workspace: Path, wiki_settings: Path):
        """Edit to non-wiki paths should be allowed."""
        input_data = {
            "tool_name": "Edit",
            "tool_input": {
                "file_path": str(temp_workspace / "some" / "other" / "file.py")
            }
        }

        exit_code, stdout, stderr = self.run_hook(input_data, temp_workspace)

        assert exit_code == 0
        # Should produce no deny output
        if stdout.strip():
            output = json.loads(stdout)
            assert output.get("hookSpecificOutput", {}).get("permissionDecision") != "deny"

    def test_blocks_with_expired_receipt(self, temp_workspace: Path, wiki_settings: Path):
        """Edit should be blocked when receipt is expired."""
        create_receipt(temp_workspace, expired=True, allow_mutation=True)

        input_data = {
            "tool_name": "Edit",
            "tool_input": {
                "file_path": str(temp_workspace / ".claude" / "wiki" / "wiki" / "page.md")
            }
        }

        exit_code, stdout, stderr = self.run_hook(input_data, temp_workspace)

        assert exit_code == 0
        if stdout.strip():
            output = json.loads(stdout)
            assert output["hookSpecificOutput"]["permissionDecision"] == "deny"
            assert "expired" in output["hookSpecificOutput"]["permissionDecisionReason"].lower()

    def test_blocks_with_readonly_receipt(self, temp_workspace: Path, wiki_settings: Path):
        """Edit should be blocked when receipt is read-only."""
        create_receipt(temp_workspace, expired=False, allow_mutation=False)

        input_data = {
            "tool_name": "Edit",
            "tool_input": {
                "file_path": str(temp_workspace / ".claude" / "wiki" / "wiki" / "page.md")
            }
        }

        exit_code, stdout, stderr = self.run_hook(input_data, temp_workspace)

        assert exit_code == 0
        if stdout.strip():
            output = json.loads(stdout)
            assert output["hookSpecificOutput"]["permissionDecision"] == "deny"
            assert "read-only" in output["hookSpecificOutput"]["permissionDecisionReason"].lower()

    def test_allows_preflight_without_receipt(self, temp_workspace: Path, wiki_settings: Path):
        """wiki_cli.py preflight should be allowed without receipt."""
        input_data = {
            "tool_name": "Bash",
            "tool_input": {
                "command": "python wiki_cli.py preflight --task 'my task'"
            }
        }

        exit_code, stdout, stderr = self.run_hook(input_data, temp_workspace)

        assert exit_code == 0
        # Should not produce deny output
        if stdout.strip():
            output = json.loads(stdout)
            assert output.get("hookSpecificOutput", {}).get("permissionDecision") != "deny"

    def test_empty_input(self, temp_workspace: Path):
        """Hook should handle empty input gracefully."""
        exit_code, stdout, stderr = self.run_hook({}, temp_workspace)
        assert exit_code == 0


# --- wiki_sweep tests ---

class TestWikiSweep:
    """Tests for wiki_sweep hook."""

    def get_hook_path(self) -> Path:
        return Path(__file__).parent.parent / "src" / "agentos_harness" / "hooks" / "wiki_sweep.py"

    def run_hook(self, input_data: dict, cwd: Path) -> tuple[int, str, str]:
        """Run the hook with given input and return exit code, stdout, stderr."""
        proc = subprocess.run(
            [sys.executable, str(self.get_hook_path())],
            input=json.dumps(input_data),
            capture_output=True,
            text=True,
            cwd=str(cwd)
        )
        return proc.returncode, proc.stdout, proc.stderr

    def test_detects_shebang_complete_pattern(self, temp_workspace: Path):
        """Should detect [SHEBANG] Complete pattern."""
        create_backlog(temp_workspace, pending_count=3)

        input_data = {
            "tool_result": "[SHEBANG] Complete - all tasks finished"
        }

        exit_code, stdout, stderr = self.run_hook(input_data, temp_workspace)

        assert exit_code == 0
        output = json.loads(stdout)
        assert "additionalContext" in output["hookSpecificOutput"]
        assert "3 pending" in output["hookSpecificOutput"]["additionalContext"]

    def test_detects_plans_completed_pattern(self, temp_workspace: Path):
        """Should detect plans/completed/ pattern."""
        create_backlog(temp_workspace, pending_count=2)

        input_data = {
            "tool_result": {"stdout": "Moved to plans/completed/plan_001.yaml"}
        }

        exit_code, stdout, stderr = self.run_hook(input_data, temp_workspace)

        assert exit_code == 0
        output = json.loads(stdout)
        assert "additionalContext" in output["hookSpecificOutput"]
        assert "2 pending" in output["hookSpecificOutput"]["additionalContext"]

    def test_detects_execute_complete_pattern(self, temp_workspace: Path):
        """Should detect [EXECUTE] Complete pattern."""
        create_backlog(temp_workspace, pending_count=1)

        input_data = {
            "tool_result": "[EXECUTE] Complete"
        }

        exit_code, stdout, stderr = self.run_hook(input_data, temp_workspace)

        assert exit_code == 0
        output = json.loads(stdout)
        assert "additionalContext" in output["hookSpecificOutput"]

    def test_returns_empty_when_no_pending_backlog(self, temp_workspace: Path):
        """Should return no advisory when backlog is empty."""
        create_backlog(temp_workspace, pending_count=0)

        input_data = {
            "tool_result": "[SHEBANG] Complete"
        }

        exit_code, stdout, stderr = self.run_hook(input_data, temp_workspace)

        assert exit_code == 0
        output = json.loads(stdout)
        assert "additionalContext" not in output.get("hookSpecificOutput", {})

    def test_returns_advisory_when_pending_backlog_exists(self, temp_workspace: Path):
        """Should return advisory when pending backlog entries exist."""
        create_backlog(temp_workspace, pending_count=5)

        input_data = {
            "tool_result": "Plan execution complete"
        }

        exit_code, stdout, stderr = self.run_hook(input_data, temp_workspace)

        assert exit_code == 0
        output = json.loads(stdout)
        assert "additionalContext" in output["hookSpecificOutput"]
        assert "WIKI SWEEP AVAILABLE" in output["hookSpecificOutput"]["additionalContext"]
        assert "5 pending" in output["hookSpecificOutput"]["additionalContext"]

    def test_no_advisory_for_non_completion_output(self, temp_workspace: Path):
        """Should not trigger for non-completion tool results."""
        create_backlog(temp_workspace, pending_count=5)

        input_data = {
            "tool_result": "Some random output"
        }

        exit_code, stdout, stderr = self.run_hook(input_data, temp_workspace)

        assert exit_code == 0
        output = json.loads(stdout)
        assert "additionalContext" not in output.get("hookSpecificOutput", {})

    def test_handles_missing_backlog_file(self, temp_workspace: Path):
        """Should handle missing backlog file gracefully."""
        input_data = {
            "tool_result": "[SHEBANG] Complete"
        }

        exit_code, stdout, stderr = self.run_hook(input_data, temp_workspace)

        assert exit_code == 0
        output = json.loads(stdout)
        # No pending items means no advisory
        assert "additionalContext" not in output.get("hookSpecificOutput", {})

    def test_empty_input(self, temp_workspace: Path):
        """Hook should handle empty/invalid input gracefully."""
        proc = subprocess.run(
            [sys.executable, str(self.get_hook_path())],
            input="{}",
            capture_output=True,
            text=True,
            cwd=str(temp_workspace)
        )

        assert proc.returncode == 0
        output = json.loads(proc.stdout)
        assert output["hookSpecificOutput"]["hookEventName"] == "PostToolUse"
