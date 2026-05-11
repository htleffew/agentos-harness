"""Tests for workflow_completion_wiki_sweep hook."""

from __future__ import annotations

import json
import sys
from io import StringIO
from pathlib import Path
from unittest.mock import patch

import pytest

from agentos_harness.hooks import workflow_completion_wiki_sweep


class TestWorkflowCompletionSweep:
    """Tests for workflow_completion_wiki_sweep hook."""

    def test_returns_empty_output_for_non_completion_events(self, tmp_path: Path) -> None:
        """Hook returns empty output for non-completion events."""
        event = {
            "tool_name": "Bash",
            "tool_result": {"stdout": "Some random output", "stderr": ""},
        }
        with patch.object(sys, "stdin", StringIO(json.dumps(event))):
            with patch("sys.stdout", new_callable=StringIO) as mock_stdout:
                workflow_completion_wiki_sweep.main()
                output = json.loads(mock_stdout.getvalue())
                assert output["hookSpecificOutput"]["hookEventName"] == "PostToolUse"
                assert "additionalContext" not in output["hookSpecificOutput"]

    def test_detects_shebang_completion_pattern(self, tmp_path: Path) -> None:
        """Hook detects SHEBANG completion pattern."""
        (tmp_path / ".harness" / "state").mkdir(parents=True)
        backlog = {"version": "1.0", "items": [{"id": "test", "status": "pending"}]}
        (tmp_path / ".harness" / "state" / "wiki_maintenance_backlog.json").write_text(json.dumps(backlog))

        event = {
            "tool_name": "Bash",
            "tool_result": {"stdout": "[SHEBANG] Complete - all work done", "stderr": ""},
        }
        with patch.object(sys, "stdin", StringIO(json.dumps(event))):
            with patch.object(workflow_completion_wiki_sweep, "_detect_workspace_root", return_value=tmp_path):
                with patch("sys.stdout", new_callable=StringIO) as mock_stdout:
                    workflow_completion_wiki_sweep.main()
                    output = json.loads(mock_stdout.getvalue())
                    assert "additionalContext" in output["hookSpecificOutput"]
                    assert "WIKI SWEEP AVAILABLE" in output["hookSpecificOutput"]["additionalContext"]

    def test_detects_execute_completion_pattern(self, tmp_path: Path) -> None:
        """Hook detects EXECUTE completion pattern."""
        (tmp_path / ".harness" / "state").mkdir(parents=True)
        backlog = {"version": "1.0", "items": [{"id": "test", "status": "pending"}]}
        (tmp_path / ".harness" / "state" / "wiki_maintenance_backlog.json").write_text(json.dumps(backlog))

        event = {
            "tool_name": "Bash",
            "tool_result": "[EXECUTE] Complete",
        }
        with patch.object(sys, "stdin", StringIO(json.dumps(event))):
            with patch.object(workflow_completion_wiki_sweep, "_detect_workspace_root", return_value=tmp_path):
                with patch("sys.stdout", new_callable=StringIO) as mock_stdout:
                    workflow_completion_wiki_sweep.main()
                    output = json.loads(mock_stdout.getvalue())
                    assert "additionalContext" in output["hookSpecificOutput"]
                    assert "1 pending" in output["hookSpecificOutput"]["additionalContext"]

    def test_detects_plans_completed_pattern(self, tmp_path: Path) -> None:
        """Hook detects plans/completed/ pattern."""
        (tmp_path / ".harness" / "state").mkdir(parents=True)
        backlog = {"version": "1.0", "items": [{"id": "test", "status": "pending"}]}
        (tmp_path / ".harness" / "state" / "wiki_maintenance_backlog.json").write_text(json.dumps(backlog))

        event = {
            "tool_name": "Bash",
            "tool_result": {"stdout": "Moved plan to plans/completed/My_Plan.md", "stderr": ""},
        }
        with patch.object(sys, "stdin", StringIO(json.dumps(event))):
            with patch.object(workflow_completion_wiki_sweep, "_detect_workspace_root", return_value=tmp_path):
                with patch("sys.stdout", new_callable=StringIO) as mock_stdout:
                    workflow_completion_wiki_sweep.main()
                    output = json.loads(mock_stdout.getvalue())
                    assert "additionalContext" in output["hookSpecificOutput"]

    def test_returns_advisory_when_pending_greater_than_zero(self, tmp_path: Path) -> None:
        """Hook returns advisory when pending > 0."""
        (tmp_path / ".harness" / "state").mkdir(parents=True)
        backlog = {
            "version": "1.0",
            "items": [
                {"id": "test1", "status": "pending"},
                {"id": "test2", "status": "pending"},
                {"id": "test3", "status": "completed"},
            ],
        }
        (tmp_path / ".harness" / "state" / "wiki_maintenance_backlog.json").write_text(json.dumps(backlog))

        event = {
            "tool_name": "Bash",
            "tool_result": "Plan execution complete",
        }
        with patch.object(sys, "stdin", StringIO(json.dumps(event))):
            with patch.object(workflow_completion_wiki_sweep, "_detect_workspace_root", return_value=tmp_path):
                with patch("sys.stdout", new_callable=StringIO) as mock_stdout:
                    workflow_completion_wiki_sweep.main()
                    output = json.loads(mock_stdout.getvalue())
                    assert "2 pending" in output["hookSpecificOutput"]["additionalContext"]

    def test_returns_nothing_when_pending_equals_zero(self, tmp_path: Path) -> None:
        """Hook returns nothing when pending == 0."""
        (tmp_path / ".harness" / "state").mkdir(parents=True)
        backlog = {
            "version": "1.0",
            "items": [
                {"id": "test1", "status": "completed"},
                {"id": "test2", "status": "dismissed"},
            ],
        }
        (tmp_path / ".harness" / "state" / "wiki_maintenance_backlog.json").write_text(json.dumps(backlog))

        event = {
            "tool_name": "Bash",
            "tool_result": "[SHEBANG] Complete",
        }
        with patch.object(sys, "stdin", StringIO(json.dumps(event))):
            with patch.object(workflow_completion_wiki_sweep, "_detect_workspace_root", return_value=tmp_path):
                with patch("sys.stdout", new_callable=StringIO) as mock_stdout:
                    workflow_completion_wiki_sweep.main()
                    output = json.loads(mock_stdout.getvalue())
                    assert "additionalContext" not in output["hookSpecificOutput"]

    def test_handles_missing_backlog_file_gracefully(self, tmp_path: Path) -> None:
        """Hook handles missing backlog file gracefully."""
        (tmp_path / ".harness").mkdir()

        event = {
            "tool_name": "Bash",
            "tool_result": "[SHEBANG] Complete",
        }
        with patch.object(sys, "stdin", StringIO(json.dumps(event))):
            with patch.object(workflow_completion_wiki_sweep, "_detect_workspace_root", return_value=tmp_path):
                with patch("sys.stdout", new_callable=StringIO) as mock_stdout:
                    workflow_completion_wiki_sweep.main()
                    output = json.loads(mock_stdout.getvalue())
                    assert output["hookSpecificOutput"]["hookEventName"] == "PostToolUse"
                    assert "additionalContext" not in output["hookSpecificOutput"]

    def test_handles_malformed_backlog_file_gracefully(self, tmp_path: Path) -> None:
        """Hook handles malformed backlog file gracefully."""
        (tmp_path / ".harness" / "state").mkdir(parents=True)
        (tmp_path / ".harness" / "state" / "wiki_maintenance_backlog.json").write_text("not valid json")

        event = {
            "tool_name": "Bash",
            "tool_result": "[SHEBANG] Complete",
        }
        with patch.object(sys, "stdin", StringIO(json.dumps(event))):
            with patch.object(workflow_completion_wiki_sweep, "_detect_workspace_root", return_value=tmp_path):
                with patch("sys.stdout", new_callable=StringIO) as mock_stdout:
                    workflow_completion_wiki_sweep.main()
                    output = json.loads(mock_stdout.getvalue())
                    assert output["hookSpecificOutput"]["hookEventName"] == "PostToolUse"
                    assert "additionalContext" not in output["hookSpecificOutput"]


class TestIsWorkflowCompletion:
    """Tests for _is_workflow_completion function."""

    def test_matches_shebang_complete(self) -> None:
        assert workflow_completion_wiki_sweep._is_workflow_completion("[SHEBANG] Complete")

    def test_matches_execute_complete(self) -> None:
        assert workflow_completion_wiki_sweep._is_workflow_completion("[EXECUTE] Complete")

    def test_matches_plans_completed_path(self) -> None:
        assert workflow_completion_wiki_sweep._is_workflow_completion("Moved to plans/completed/plan.md")

    def test_matches_plan_execution_complete(self) -> None:
        assert workflow_completion_wiki_sweep._is_workflow_completion("Plan execution complete")

    def test_does_not_match_random_text(self) -> None:
        assert not workflow_completion_wiki_sweep._is_workflow_completion("Just some random output")
