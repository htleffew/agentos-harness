"""Tests for knowledge_promotion_check hook."""

from __future__ import annotations

import json
import sys
from io import StringIO
from pathlib import Path
from unittest.mock import patch

import pytest

from agentos_harness.hooks import knowledge_promotion_check


class TestKnowledgePromotionCheck:
    """Tests for knowledge_promotion_check hook."""

    def test_returns_empty_output_for_non_matching_paths(self, tmp_path: Path) -> None:
        """Hook returns empty output for non-matching paths."""
        event = {
            "tool_name": "Write",
            "tool_input": {"file_path": str(tmp_path / "random_file.txt")},
        }
        with patch.object(sys, "stdin", StringIO(json.dumps(event))):
            with patch.object(knowledge_promotion_check, "_detect_workspace_root", return_value=tmp_path):
                with patch("sys.stdout", new_callable=StringIO) as mock_stdout:
                    knowledge_promotion_check.main()
                    output = json.loads(mock_stdout.getvalue())
                    assert output["hookSpecificOutput"]["hookEventName"] == "PostToolUse"
                    assert "additionalContext" not in output["hookSpecificOutput"]

    def test_queues_entry_for_harness_hooks_changes(self, tmp_path: Path) -> None:
        """Hook queues entry for .harness/hooks/ changes."""
        (tmp_path / ".harness").mkdir()
        event = {
            "tool_name": "Write",
            "tool_input": {"file_path": str(tmp_path / ".harness/hooks/my_hook.py")},
        }
        with patch.object(sys, "stdin", StringIO(json.dumps(event))):
            with patch.object(knowledge_promotion_check, "_detect_workspace_root", return_value=tmp_path):
                with patch("sys.stdout", new_callable=StringIO) as mock_stdout:
                    knowledge_promotion_check.main()
                    output = json.loads(mock_stdout.getvalue())
                    assert "additionalContext" in output["hookSpecificOutput"]
                    assert "WIKI PROMOTION CHECK" in output["hookSpecificOutput"]["additionalContext"]
                    assert "workspace_hook_changed" in output["hookSpecificOutput"]["additionalContext"] or "Queued" in output["hookSpecificOutput"]["additionalContext"]

    def test_queues_entry_for_harness_skills_changes(self, tmp_path: Path) -> None:
        """Hook queues entry for .harness/skills/ changes."""
        (tmp_path / ".harness").mkdir()
        event = {
            "tool_name": "Edit",
            "tool_input": {"file_path": str(tmp_path / ".harness/skills/my_skill/SKILL.md")},
        }
        with patch.object(sys, "stdin", StringIO(json.dumps(event))):
            with patch.object(knowledge_promotion_check, "_detect_workspace_root", return_value=tmp_path):
                with patch("sys.stdout", new_callable=StringIO) as mock_stdout:
                    knowledge_promotion_check.main()
                    output = json.loads(mock_stdout.getvalue())
                    assert "additionalContext" in output["hookSpecificOutput"]
                    assert "WIKI PROMOTION CHECK" in output["hookSpecificOutput"]["additionalContext"]

    def test_queues_entry_for_project_external_changes(self, tmp_path: Path) -> None:
        """Hook queues entry for projects/*/external/ changes."""
        (tmp_path / ".harness").mkdir()
        event = {
            "tool_name": "Write",
            "tool_input": {"file_path": str(tmp_path / "projects/my-project/external/docs/README.md")},
        }
        with patch.object(sys, "stdin", StringIO(json.dumps(event))):
            with patch.object(knowledge_promotion_check, "_detect_workspace_root", return_value=tmp_path):
                with patch("sys.stdout", new_callable=StringIO) as mock_stdout:
                    knowledge_promotion_check.main()
                    output = json.loads(mock_stdout.getvalue())
                    assert "additionalContext" in output["hookSpecificOutput"]
                    assert "my-project" in output["hookSpecificOutput"]["additionalContext"]

    def test_queues_entry_for_handoff_changes(self, tmp_path: Path) -> None:
        """Hook queues entry for HANDOFF.md changes."""
        (tmp_path / ".harness").mkdir()
        event = {
            "tool_name": "Edit",
            "tool_input": {"file_path": str(tmp_path / "projects/my-project/MY-PROJECT-HANDOFF.md")},
        }
        with patch.object(sys, "stdin", StringIO(json.dumps(event))):
            with patch.object(knowledge_promotion_check, "_detect_workspace_root", return_value=tmp_path):
                with patch("sys.stdout", new_callable=StringIO) as mock_stdout:
                    knowledge_promotion_check.main()
                    output = json.loads(mock_stdout.getvalue())
                    assert "additionalContext" in output["hookSpecificOutput"]

    def test_creates_backlog_file_if_missing(self, tmp_path: Path) -> None:
        """Hook creates backlog file if missing."""
        (tmp_path / ".harness").mkdir()
        backlog_path = tmp_path / ".harness" / "state" / "wiki_maintenance_backlog.json"
        assert not backlog_path.exists()

        event = {
            "tool_name": "Write",
            "tool_input": {"file_path": str(tmp_path / ".harness/hooks/test.py")},
        }
        with patch.object(sys, "stdin", StringIO(json.dumps(event))):
            with patch.object(knowledge_promotion_check, "_detect_workspace_root", return_value=tmp_path):
                with patch("sys.stdout", new_callable=StringIO):
                    knowledge_promotion_check.main()

        assert backlog_path.exists()
        backlog = json.loads(backlog_path.read_text())
        assert "items" in backlog
        assert len(backlog["items"]) == 1

    def test_upserts_existing_entry_for_same_source(self, tmp_path: Path) -> None:
        """Hook upserts existing entry for same source path."""
        (tmp_path / ".harness").mkdir()

        event = {
            "tool_name": "Write",
            "tool_input": {"file_path": str(tmp_path / ".harness/hooks/test.py")},
        }

        with patch.object(sys, "stdin", StringIO(json.dumps(event))):
            with patch.object(knowledge_promotion_check, "_detect_workspace_root", return_value=tmp_path):
                with patch("sys.stdout", new_callable=StringIO):
                    knowledge_promotion_check.main()

        backlog_path = tmp_path / ".harness" / "state" / "wiki_maintenance_backlog.json"
        backlog = json.loads(backlog_path.read_text())
        first_count = backlog["items"][0]["event_count"]

        with patch.object(sys, "stdin", StringIO(json.dumps(event))):
            with patch.object(knowledge_promotion_check, "_detect_workspace_root", return_value=tmp_path):
                with patch("sys.stdout", new_callable=StringIO) as mock_stdout:
                    knowledge_promotion_check.main()
                    output = json.loads(mock_stdout.getvalue())
                    assert "Refreshed" in output["hookSpecificOutput"]["additionalContext"]

        backlog = json.loads(backlog_path.read_text())
        assert len(backlog["items"]) == 1
        assert backlog["items"][0]["event_count"] == first_count + 1

    def test_entry_id_is_deterministic(self, tmp_path: Path) -> None:
        """Entry ID is deterministic for same source path."""
        id1 = knowledge_promotion_check._maintenance_entry_id(".harness/hooks/test.py")
        id2 = knowledge_promotion_check._maintenance_entry_id(".harness/hooks/test.py")
        assert id1 == id2
        assert id1.startswith("wiki-maint-")

    def test_family_hints_correct_for_hook_changes(self) -> None:
        """Family hints correct for hook changes."""
        hints = knowledge_promotion_check._family_hints(".harness/hooks/my_hook.py")
        assert "systems" in hints
        assert "workflows" in hints

    def test_family_hints_correct_for_skill_changes(self) -> None:
        """Family hints correct for skill changes."""
        hints = knowledge_promotion_check._family_hints(".harness/skills/my_skill/SKILL.md")
        assert "systems" in hints
        assert "workflows" in hints

    def test_family_hints_correct_for_project_changes(self) -> None:
        """Family hints correct for project changes."""
        hints = knowledge_promotion_check._family_hints("projects/my-project/internal/code.py")
        assert "projects" in hints


class TestShouldQueueSource:
    """Tests for _should_queue_source function."""

    def test_skips_wiki_paths(self) -> None:
        """Skips wiki paths."""
        assert not knowledge_promotion_check._should_queue_source(".harness/wiki/index.md")
        assert not knowledge_promotion_check._should_queue_source(".claude/wiki/wiki/projects/test.md")

    def test_skips_runtime_paths(self) -> None:
        """Skips runtime state paths."""
        assert not knowledge_promotion_check._should_queue_source(".harness/state/runtime/receipts/test.json")
        assert not knowledge_promotion_check._should_queue_source(".claude/state/runtime/test.json")

    def test_skips_backlog_itself(self) -> None:
        """Skips the maintenance backlog file itself."""
        assert not knowledge_promotion_check._should_queue_source(".harness/state/wiki_maintenance_backlog.json")
        assert not knowledge_promotion_check._should_queue_source(".claude/state/curation/wiki_maintenance_backlog.json")

    def test_matches_trigger_substrings(self) -> None:
        """Matches trigger path substrings."""
        assert knowledge_promotion_check._should_queue_source(".harness/hooks/test.py")
        assert knowledge_promotion_check._should_queue_source(".harness/skills/test/SKILL.md")
        assert knowledge_promotion_check._should_queue_source(".harness/commands/test.md")
        assert knowledge_promotion_check._should_queue_source("projects/test/external/docs/README.md")
        assert knowledge_promotion_check._should_queue_source("projects/test/research/notebook.ipynb")

    def test_matches_trigger_filenames(self) -> None:
        """Matches trigger filenames."""
        assert knowledge_promotion_check._should_queue_source("projects/test/HANDOFF.md")
        assert knowledge_promotion_check._should_queue_source("projects/test/UPDATE.txt")
        assert knowledge_promotion_check._should_queue_source("some/path/README.md")
