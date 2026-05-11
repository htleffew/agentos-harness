from __future__ import annotations

import json
import py_compile
import shutil
import subprocess
import sys
from pathlib import Path

from agentos_harness.generator import apply_manifest, write_manifest

FIXTURES = Path(__file__).parent / "fixtures"


def test_generated_hooks_compile_and_run_without_stdin(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    shutil.copytree(FIXTURES / "python_basic", workspace)
    write_manifest(workspace)
    apply_manifest(workspace)
    hooks = sorted((workspace / ".claude/hooks").rglob("*.py"))
    hook_names = {path.name for path in hooks}
    assert hook_names >= {
        "activity_log.py",
        "destructive_guard.py",
        "path_guard.py",
        "secret_guard.py",
        "wiki_reminder.py",
        "setup_rescan_reminder.py",
        "error_tracker.py",
        "handoff_reminder.py",
        "commit_gate.py",
        "skill_guard.py",
        "session_context.py",
    }
    assert "prose_guard.py" not in hook_names
    assert "publication_guard.py" not in hook_names
    for hook in hooks:
        py_compile.compile(str(hook), doraise=True)
        result = subprocess.run([sys.executable, str(hook)], cwd=workspace, check=False)
        assert result.returncode == 0


def test_generated_settings_reference_existing_hooks(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    shutil.copytree(FIXTURES / "python_basic", workspace)
    write_manifest(workspace)
    apply_manifest(workspace)
    settings = json.loads((workspace / ".claude/settings.json").read_text(encoding="utf-8"))
    commands: list[str] = []
    for event in settings["hooks"].values():
        for block in event:
            for hook in block["hooks"]:
                commands.append(hook["command"])
    assert commands
    for command in commands:
        marker = '"/.claude/hooks/'
        assert marker in command
        rel = ".claude/hooks/" + command.split(marker, 1)[1].split('"', 1)[0]
        assert (workspace / rel).exists()


def test_generated_settings_include_session_start(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    shutil.copytree(FIXTURES / "python_basic", workspace)
    write_manifest(workspace)
    apply_manifest(workspace)
    settings = json.loads((workspace / ".claude/settings.json").read_text(encoding="utf-8"))
    assert "SessionStart" in settings["hooks"]
    assert any(
        "session_context.py" in str(block)
        for block in settings["hooks"]["SessionStart"]
    )


def test_generated_settings_include_commit_gate_for_bash(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    shutil.copytree(FIXTURES / "python_basic", workspace)
    write_manifest(workspace)
    apply_manifest(workspace)
    settings = json.loads((workspace / ".claude/settings.json").read_text(encoding="utf-8"))
    bash_blocks = [
        block for block in settings["hooks"].get("PreToolUse", [])
        if "Bash" in str(block)
    ]
    assert any("commit_gate.py" in str(b) for b in bash_blocks)


def test_generated_settings_include_error_tracker_in_post_hooks(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    shutil.copytree(FIXTURES / "python_basic", workspace)
    write_manifest(workspace)
    apply_manifest(workspace)
    settings = json.loads((workspace / ".claude/settings.json").read_text(encoding="utf-8"))
    post_blocks = settings["hooks"].get("PostToolUse", [])
    assert any("error_tracker.py" in str(b) for b in post_blocks)


def test_generated_settings_include_handoff_reminder_in_post_hooks(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    shutil.copytree(FIXTURES / "python_basic", workspace)
    write_manifest(workspace)
    apply_manifest(workspace)
    settings = json.loads((workspace / ".claude/settings.json").read_text(encoding="utf-8"))
    post_blocks = settings["hooks"].get("PostToolUse", [])
    assert any("handoff_reminder.py" in str(b) for b in post_blocks)
