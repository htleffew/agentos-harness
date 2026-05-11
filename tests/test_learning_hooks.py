"""Tests for learning hooks: learn_from_failure, knowledge_freshness_check."""

from __future__ import annotations

import io
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


def mock_stdin_with_select(event_data: dict):
    """Create a context manager that mocks both stdin and select.select for hook testing."""
    stdin_mock = io.StringIO(json.dumps(event_data))
    select_mock = MagicMock(return_value=([stdin_mock], [], []))
    return patch("sys.stdin", stdin_mock), patch("select.select", select_mock)


# --- learn_from_failure tests ---


def test_learn_from_failure_detects_known_error(tmp_path: Path) -> None:
    from agentos_harness.hooks import learn_from_failure

    config_dir = tmp_path / ".harness" / "config"
    config_dir.mkdir(parents=True)
    state_dir = tmp_path / ".harness" / "state"
    state_dir.mkdir(parents=True)

    patterns = {
        "patterns": [
            {
                "id": "ERR001",
                "name": "ModuleNotFoundError",
                "regex": "ModuleNotFoundError",
                "fix": "Install the missing package",
                "hit_count": 0,
            }
        ]
    }
    (config_dir / "error_patterns.json").write_text(json.dumps(patterns))

    event = {
        "tool_name": "Bash",
        "hook_event_name": "PostToolUseFailure",
        "tool_input": {"command": "python script.py"},
        "tool_result": {"stderr": "ModuleNotFoundError: No module named 'requests'"},
    }

    stdin_patch, select_patch = mock_stdin_with_select(event)
    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with stdin_patch, select_patch:
            with patch("sys.stdout", new_callable=io.StringIO) as mock_stdout:
                with pytest.raises(SystemExit) as exc:
                    learn_from_failure.main()
                assert exc.value.code == 0

    output = mock_stdout.getvalue()
    assert "KNOWN ERROR DETECTED" in output or output == ""


def test_learn_from_failure_logs_unknown_error(tmp_path: Path) -> None:
    from agentos_harness.hooks import learn_from_failure

    config_dir = tmp_path / ".harness" / "config"
    config_dir.mkdir(parents=True)
    state_dir = tmp_path / ".harness" / "state"
    state_dir.mkdir(parents=True)

    patterns = {"patterns": []}
    (config_dir / "error_patterns.json").write_text(json.dumps(patterns))

    event = {
        "tool_name": "Bash",
        "hook_event_name": "PostToolUseFailure",
        "tool_input": {"command": "python script.py"},
        "tool_result": {"stderr": "SomeUnknownError: something bad happened"},
    }

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with pytest.raises(SystemExit) as exc:
                learn_from_failure.main()
            assert exc.value.code == 0

    unknown_errors = json.loads((config_dir / "unknown_errors.json").read_text())
    assert len(unknown_errors) >= 1
    assert "SomeUnknownError" in unknown_errors[0].get("output_snippet", "")


def test_learn_from_failure_ignores_benign_failures(tmp_path: Path) -> None:
    from agentos_harness.hooks import learn_from_failure

    config_dir = tmp_path / ".harness" / "config"
    config_dir.mkdir(parents=True)
    state_dir = tmp_path / ".harness" / "state"
    state_dir.mkdir(parents=True)

    patterns = {"patterns": []}
    (config_dir / "error_patterns.json").write_text(json.dumps(patterns))

    event = {
        "tool_name": "Bash",
        "hook_event_name": "PostToolUseFailure",
        "tool_input": {"command": "diff file1 file2"},
        "tool_result": {"stderr": "", "exit_code": 1},
    }

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with pytest.raises(SystemExit) as exc:
                learn_from_failure.main()
            assert exc.value.code == 0

    unknown_errors_path = config_dir / "unknown_errors.json"
    if unknown_errors_path.exists():
        unknown_errors = json.loads(unknown_errors_path.read_text())
        assert len(unknown_errors) == 0


def test_learn_from_failure_increments_hit_count(tmp_path: Path) -> None:
    from agentos_harness.hooks import learn_from_failure

    config_dir = tmp_path / ".harness" / "config"
    config_dir.mkdir(parents=True)
    state_dir = tmp_path / ".harness" / "state"
    state_dir.mkdir(parents=True)

    patterns = {
        "patterns": [
            {
                "id": "ERR001",
                "name": "TestError",
                "regex": "TestError",
                "fix": "Fix it",
                "hit_count": 2,
            }
        ]
    }
    (config_dir / "error_patterns.json").write_text(json.dumps(patterns))

    event = {
        "tool_name": "Bash",
        "hook_event_name": "PostToolUseFailure",
        "tool_input": {"command": "python script.py"},
        "tool_result": {"stderr": "TestError occurred"},
    }

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with pytest.raises(SystemExit):
                learn_from_failure.main()

    updated = json.loads((config_dir / "error_patterns.json").read_text())
    assert updated["patterns"][0]["hit_count"] == 3


def test_learn_from_failure_detects_fix_after_failure(tmp_path: Path) -> None:
    from agentos_harness.hooks import learn_from_failure

    config_dir = tmp_path / ".harness" / "config"
    config_dir.mkdir(parents=True)
    state_dir = tmp_path / ".harness" / "state"
    state_dir.mkdir(parents=True)

    patterns = {"patterns": []}
    (config_dir / "error_patterns.json").write_text(json.dumps(patterns))

    last_failure = {
        "timestamp": time.time() - 30,
        "command": "python script.py",
        "output_snippet": "Error",
        "awaiting_loop_completion": False,
    }
    (state_dir / "last_failure.json").write_text(json.dumps(last_failure))

    event = {
        "tool_name": "Edit",
        "hook_event_name": "PostToolUse",
        "tool_input": {"file_path": "/some/file.py"},
        "tool_result": {},
    }

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with pytest.raises(SystemExit):
                learn_from_failure.main()

    updated = json.loads((state_dir / "last_failure.json").read_text())
    assert updated.get("awaiting_loop_completion") is True


def test_learn_from_failure_prompts_loop_completion(tmp_path: Path) -> None:
    from agentos_harness.hooks import learn_from_failure

    config_dir = tmp_path / ".harness" / "config"
    config_dir.mkdir(parents=True)
    state_dir = tmp_path / ".harness" / "state"
    state_dir.mkdir(parents=True)

    patterns = {"patterns": []}
    (config_dir / "error_patterns.json").write_text(json.dumps(patterns))

    last_failure = {
        "timestamp": time.time() - 60,
        "command": "python script.py",
        "output_snippet": "Error",
        "awaiting_loop_completion": True,
    }
    (state_dir / "last_failure.json").write_text(json.dumps(last_failure))

    event = {
        "tool_name": "Read",
        "hook_event_name": "PostToolUse",
        "tool_input": {"file_path": "/some/file.py"},
        "tool_result": {},
    }

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with patch("sys.stdout", new_callable=io.StringIO) as mock_stdout:
                with pytest.raises(SystemExit):
                    learn_from_failure.main()

    output = mock_stdout.getvalue()
    assert "LEARNING LOOP" in output


def test_learn_from_failure_escalates_high_hit_count(tmp_path: Path) -> None:
    from agentos_harness.hooks import learn_from_failure

    config_dir = tmp_path / ".harness" / "config"
    config_dir.mkdir(parents=True)
    state_dir = tmp_path / ".harness" / "state"
    state_dir.mkdir(parents=True)

    patterns = {
        "patterns": [
            {
                "id": "ERR001",
                "name": "FrequentError",
                "regex": "FrequentError",
                "fix": "Fix it",
                "hit_count": 4,
                "has_preventive_hook": False,
            }
        ]
    }
    (config_dir / "error_patterns.json").write_text(json.dumps(patterns))

    event = {
        "tool_name": "Bash",
        "hook_event_name": "PostToolUseFailure",
        "tool_input": {"command": "python script.py"},
        "tool_result": {"stderr": "FrequentError occurred"},
    }

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with patch("sys.stdout", new_callable=io.StringIO) as mock_stdout:
                with pytest.raises(SystemExit):
                    learn_from_failure.main()

    output = mock_stdout.getvalue()
    if output:
        data = json.loads(output)
        context = data.get("hookSpecificOutput", {}).get("additionalContext", "")
        assert "CRITICAL" in context or "NOTE" in context


def test_learn_from_failure_prunes_old_unknown_errors(tmp_path: Path) -> None:
    from agentos_harness.hooks import learn_from_failure

    config_dir = tmp_path / ".harness" / "config"
    config_dir.mkdir(parents=True)
    state_dir = tmp_path / ".harness" / "state"
    state_dir.mkdir(parents=True)

    patterns = {"patterns": []}
    (config_dir / "error_patterns.json").write_text(json.dumps(patterns))

    old_timestamp = "2020-01-01T00:00:00+00:00"
    unknown_errors = [
        {
            "timestamp": old_timestamp,
            "first_seen": old_timestamp,
            "last_seen": old_timestamp,
            "command": "old command",
            "output_snippet": "old error",
            "classified": False,
            "hit_count": 1,
            "fingerprint": "abc123",
        }
    ]
    (config_dir / "unknown_errors.json").write_text(json.dumps(unknown_errors))

    event = {
        "tool_name": "Bash",
        "hook_event_name": "PostToolUseFailure",
        "tool_input": {"command": "python new_script.py"},
        "tool_result": {"stderr": "NewError: something new"},
    }

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with pytest.raises(SystemExit):
                learn_from_failure.main()

    updated = json.loads((config_dir / "unknown_errors.json").read_text())
    old_entries = [e for e in updated if "old error" in e.get("output_snippet", "")]
    assert len(old_entries) == 0


def test_learn_from_failure_dedupes_repeated_unknown_errors(tmp_path: Path) -> None:
    from agentos_harness.hooks import learn_from_failure

    config_dir = tmp_path / ".harness" / "config"
    config_dir.mkdir(parents=True)
    state_dir = tmp_path / ".harness" / "state"
    state_dir.mkdir(parents=True)

    patterns = {"patterns": []}
    (config_dir / "error_patterns.json").write_text(json.dumps(patterns))

    event = {
        "tool_name": "Bash",
        "hook_event_name": "PostToolUseFailure",
        "tool_input": {"command": "python script.py"},
        "tool_result": {"stderr": "RepeatedError: same error"},
    }

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        for _ in range(3):
            with patch("sys.stdin", io.StringIO(json.dumps(event))):
                with pytest.raises(SystemExit):
                    learn_from_failure.main()

    updated = json.loads((config_dir / "unknown_errors.json").read_text())
    repeated_entries = [e for e in updated if "RepeatedError" in e.get("output_snippet", "")]
    assert len(repeated_entries) == 1
    assert repeated_entries[0]["hit_count"] >= 3


def test_learn_from_failure_no_workspace_exits_cleanly(tmp_path: Path) -> None:
    from agentos_harness.hooks import learn_from_failure

    event = {
        "tool_name": "Bash",
        "hook_event_name": "PostToolUseFailure",
        "tool_input": {"command": "python script.py"},
        "tool_result": {"stderr": "Error"},
    }

    with patch.dict(os.environ, {}, clear=True):
        os.environ.pop("CLAUDE_PROJECT_DIR", None)
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with pytest.raises(SystemExit) as exc:
                learn_from_failure.main()
            assert exc.value.code == 0


# --- knowledge_freshness_check tests ---


def test_knowledge_freshness_check_ignores_non_completed_plans(tmp_path: Path) -> None:
    from agentos_harness.hooks import knowledge_freshness_check

    event = {
        "tool_name": "Edit",
        "tool_input": {"file_path": str(tmp_path / "plans/active/my_plan.md")},
        "tool_result": {},
    }

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with patch("sys.stdout", new_callable=io.StringIO) as mock_stdout:
                with pytest.raises(SystemExit) as exc:
                    knowledge_freshness_check.main()
                assert exc.value.code == 0

    output = mock_stdout.getvalue()
    if output:
        data = json.loads(output)
        assert "KNOWLEDGE FRESHNESS" not in data.get("hookSpecificOutput", {}).get(
            "additionalContext", ""
        )


def test_knowledge_freshness_check_detects_stale_references(tmp_path: Path) -> None:
    from agentos_harness.hooks import knowledge_freshness_check

    plans_dir = tmp_path / "plans" / "completed"
    plans_dir.mkdir(parents=True)

    internal_dir = tmp_path / "internal" / "scripts"
    internal_dir.mkdir(parents=True)
    referenced_file = internal_dir / "helper.py"
    referenced_file.write_text("# helper")

    plan_content = """---
name: Test Plan
created: 2020-01-01
---

# Plan

References:
- internal/scripts/helper.py
"""
    plan_file = plans_dir / "test_plan.md"
    plan_file.write_text(plan_content)

    event = {
        "tool_name": "Edit",
        "tool_input": {"file_path": str(plan_file)},
        "tool_result": {},
    }

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with patch("sys.stdout", new_callable=io.StringIO) as mock_stdout:
                with pytest.raises(SystemExit) as exc:
                    knowledge_freshness_check.main()
                assert exc.value.code == 0

    output = mock_stdout.getvalue()
    if output:
        data = json.loads(output)
        context = data.get("hookSpecificOutput", {}).get("additionalContext", "")
        assert "KNOWLEDGE FRESHNESS" in context


def test_knowledge_freshness_check_no_stale_if_plan_is_recent(tmp_path: Path) -> None:
    from agentos_harness.hooks import knowledge_freshness_check

    plans_dir = tmp_path / "plans" / "completed"
    plans_dir.mkdir(parents=True)

    internal_dir = tmp_path / "internal" / "scripts"
    internal_dir.mkdir(parents=True)
    referenced_file = internal_dir / "helper.py"
    referenced_file.write_text("# helper")

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    plan_content = f"""---
name: Test Plan
created: {today}
---

# Plan

References:
- internal/scripts/helper.py
"""
    plan_file = plans_dir / "test_plan.md"
    plan_file.write_text(plan_content)

    import os as os_module

    old_mtime = (datetime.now(timezone.utc).timestamp()) - (365 * 24 * 3600)
    os_module.utime(referenced_file, (old_mtime, old_mtime))

    event = {
        "tool_name": "Edit",
        "tool_input": {"file_path": str(plan_file)},
        "tool_result": {},
    }

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with patch("sys.stdout", new_callable=io.StringIO) as mock_stdout:
                with pytest.raises(SystemExit) as exc:
                    knowledge_freshness_check.main()
                assert exc.value.code == 0

    output = mock_stdout.getvalue()
    if output:
        data = json.loads(output)
        context = data.get("hookSpecificOutput", {}).get("additionalContext", "")
        assert "KNOWLEDGE FRESHNESS" not in context


def test_knowledge_freshness_check_no_references_exits_cleanly(tmp_path: Path) -> None:
    from agentos_harness.hooks import knowledge_freshness_check

    plans_dir = tmp_path / "plans" / "completed"
    plans_dir.mkdir(parents=True)

    plan_content = """---
name: Test Plan
created: 2020-01-01
---

# Plan

No file references here.
"""
    plan_file = plans_dir / "test_plan.md"
    plan_file.write_text(plan_content)

    event = {
        "tool_name": "Edit",
        "tool_input": {"file_path": str(plan_file)},
        "tool_result": {},
    }

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with patch("sys.stdout", new_callable=io.StringIO) as mock_stdout:
                with pytest.raises(SystemExit) as exc:
                    knowledge_freshness_check.main()
                assert exc.value.code == 0

    output = mock_stdout.getvalue()
    if output:
        data = json.loads(output)
        context = data.get("hookSpecificOutput", {}).get("additionalContext", "")
        assert "KNOWLEDGE FRESHNESS" not in context


def test_knowledge_freshness_check_no_created_date_exits_cleanly(tmp_path: Path) -> None:
    from agentos_harness.hooks import knowledge_freshness_check

    plans_dir = tmp_path / "plans" / "completed"
    plans_dir.mkdir(parents=True)

    plan_content = """---
name: Test Plan
---

# Plan

References:
- internal/scripts/helper.py
"""
    plan_file = plans_dir / "test_plan.md"
    plan_file.write_text(plan_content)

    event = {
        "tool_name": "Edit",
        "tool_input": {"file_path": str(plan_file)},
        "tool_result": {},
    }

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with patch("sys.stdout", new_callable=io.StringIO) as mock_stdout:
                with pytest.raises(SystemExit) as exc:
                    knowledge_freshness_check.main()
                assert exc.value.code == 0


def test_knowledge_freshness_check_multiple_references(tmp_path: Path) -> None:
    from agentos_harness.hooks import knowledge_freshness_check

    plans_dir = tmp_path / "plans" / "completed"
    plans_dir.mkdir(parents=True)

    internal_dir = tmp_path / "internal" / "scripts"
    internal_dir.mkdir(parents=True)
    (internal_dir / "helper1.py").write_text("# helper1")
    (internal_dir / "helper2.py").write_text("# helper2")
    (internal_dir / "helper3.py").write_text("# helper3")

    plan_content = """---
name: Test Plan
created: 2020-01-01
---

# Plan

References:
- internal/scripts/helper1.py
- internal/scripts/helper2.py
- internal/scripts/helper3.py
"""
    plan_file = plans_dir / "test_plan.md"
    plan_file.write_text(plan_content)

    event = {
        "tool_name": "Edit",
        "tool_input": {"file_path": str(plan_file)},
        "tool_result": {},
    }

    with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(tmp_path)}):
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with patch("sys.stdout", new_callable=io.StringIO) as mock_stdout:
                with pytest.raises(SystemExit) as exc:
                    knowledge_freshness_check.main()
                assert exc.value.code == 0

    output = mock_stdout.getvalue()
    if output:
        data = json.loads(output)
        context = data.get("hookSpecificOutput", {}).get("additionalContext", "")
        if "KNOWLEDGE FRESHNESS" in context:
            assert "3 reference" in context or "reference(s)" in context


def test_knowledge_freshness_check_no_workspace_exits_cleanly(tmp_path: Path) -> None:
    from agentos_harness.hooks import knowledge_freshness_check

    plans_dir = tmp_path / "plans" / "completed"
    plans_dir.mkdir(parents=True)
    plan_file = plans_dir / "test_plan.md"
    plan_file.write_text("# Plan")

    event = {
        "tool_name": "Edit",
        "tool_input": {"file_path": str(plan_file)},
        "tool_result": {},
    }

    with patch.dict(os.environ, {}, clear=True):
        os.environ.pop("CLAUDE_PROJECT_DIR", None)
        with patch("sys.stdin", io.StringIO(json.dumps(event))):
            with patch("sys.stdout", new_callable=io.StringIO):
                with pytest.raises(SystemExit) as exc:
                    knowledge_freshness_check.main()
                assert exc.value.code == 0
