"""Tests for existing_harness module."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agentos_harness.existing_harness import (
    detect_existing_harness,
    merge_settings_json,
    run_existing_harness_wizard,
)


class TestDetectExistingHarness:
    """Tests for detect_existing_harness function."""

    def test_empty_workspace_no_harness(self, tmp_path: Path) -> None:
        """Empty workspace has no harness."""
        result = detect_existing_harness(tmp_path)
        assert result["has_harness"] is False
        assert result["custom_skills"] == []
        assert result["custom_commands"] == []
        assert result["custom_hooks"] == []

    def test_detects_custom_skill(self, tmp_path: Path) -> None:
        """Detects custom skills not in generated set."""
        skill_dir = tmp_path / ".claude" / "skills" / "my-custom-skill"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text("# My Custom Skill")
        (tmp_path / "README.md").write_text("# Test")

        result = detect_existing_harness(tmp_path)
        assert result["has_harness"] is True
        assert "my-custom-skill" in result["custom_skills"]

    def test_detects_custom_command(self, tmp_path: Path) -> None:
        """Detects custom commands not in generated set."""
        cmd_dir = tmp_path / ".claude" / "commands"
        cmd_dir.mkdir(parents=True)
        (cmd_dir / "my-command.md").write_text("# My Command")
        (tmp_path / "README.md").write_text("# Test")

        result = detect_existing_harness(tmp_path)
        assert result["has_harness"] is True
        assert "my-command" in result["custom_commands"]

    def test_detects_custom_hook(self, tmp_path: Path) -> None:
        """Detects custom hooks not in generated set."""
        hook_dir = tmp_path / ".claude" / "hooks" / "post"
        hook_dir.mkdir(parents=True)
        (hook_dir / "my_hook.py").write_text("# custom hook")
        (tmp_path / "README.md").write_text("# Test")

        result = detect_existing_harness(tmp_path)
        assert result["has_harness"] is True
        assert "my_hook" in result["custom_hooks"]

    def test_detects_generated_conflict(self, tmp_path: Path) -> None:
        """Detects when generated skill already exists."""
        skill_dir = tmp_path / ".claude" / "skills" / "planning-work"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text("# Modified planning skill")
        (tmp_path / "README.md").write_text("# Test")

        result = detect_existing_harness(tmp_path)
        assert ".claude/skills/planning-work/SKILL.md" in result["generated_conflicts"]

    def test_detects_custom_hooks_in_settings(self, tmp_path: Path) -> None:
        """Detects custom hook registrations in settings.json."""
        (tmp_path / ".claude").mkdir(parents=True)
        (tmp_path / ".claude" / "settings.json").write_text(json.dumps({
            "hooks": {
                "PostToolUse": [
                    {"hooks": [{"command": "python my_custom_hook.py"}]}
                ]
            }
        }))
        (tmp_path / "README.md").write_text("# Test")

        result = detect_existing_harness(tmp_path)
        assert result["settings_has_custom_hooks"] is True

    def test_generated_hooks_not_flagged_as_custom(self, tmp_path: Path) -> None:
        """Generated hook names are not flagged as custom."""
        (tmp_path / ".claude").mkdir(parents=True)
        (tmp_path / ".claude" / "settings.json").write_text(json.dumps({
            "hooks": {
                "PostToolUse": [
                    {"hooks": [{"command": "python activity_logger.py"}]}
                ]
            }
        }))
        (tmp_path / "README.md").write_text("# Test")

        result = detect_existing_harness(tmp_path)
        assert result["settings_has_custom_hooks"] is False


class TestRunExistingHarnessWizard:
    """Tests for run_existing_harness_wizard function."""

    def test_no_harness_returns_fresh(self, tmp_path: Path) -> None:
        """No existing harness returns fresh strategy."""
        result = run_existing_harness_wizard(tmp_path, interactive=False)
        assert result["strategy"] == "fresh"
        assert result["preserve_paths"] == []

    def test_non_interactive_returns_merge(self, tmp_path: Path) -> None:
        """Non-interactive mode with harness returns merge."""
        (tmp_path / ".claude" / "skills" / "my-skill").mkdir(parents=True)
        (tmp_path / ".claude" / "skills" / "my-skill" / "SKILL.md").write_text("# Custom")
        (tmp_path / "README.md").write_text("# Test")

        result = run_existing_harness_wizard(tmp_path, interactive=False)
        assert result["strategy"] == "fresh"
        assert result["merge_settings"] is True

    def test_no_conflicts_skips_prompt(self, tmp_path: Path) -> None:
        """When only custom files exist (no conflicts), skips prompt."""
        skill_dir = tmp_path / ".claude" / "skills" / "my-custom-skill"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text("# My Custom Skill")
        (tmp_path / "README.md").write_text("# Test")

        result = run_existing_harness_wizard(tmp_path, interactive=True)
        assert result["strategy"] == "merge"

    def test_interactive_choice_1_fresh(self, tmp_path: Path, monkeypatch) -> None:
        """Interactive choice 1 returns fresh strategy."""
        skill_dir = tmp_path / ".claude" / "skills" / "planning-work"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text("# Planning")
        (tmp_path / "README.md").write_text("# Test")
        monkeypatch.setattr("builtins.input", lambda _: "1")
        result = run_existing_harness_wizard(tmp_path, interactive=True)
        assert result["strategy"] == "fresh"

    def test_interactive_choice_2_merge(self, tmp_path: Path, monkeypatch) -> None:
        """Interactive choice 2 returns merge strategy."""
        skill_dir = tmp_path / ".claude" / "skills" / "planning-work"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text("# Planning")
        (tmp_path / "README.md").write_text("# Test")
        monkeypatch.setattr("builtins.input", lambda _: "2")
        result = run_existing_harness_wizard(tmp_path, interactive=True)
        assert result["strategy"] == "merge"

    def test_interactive_enter_defaults_to_merge(self, tmp_path: Path, monkeypatch) -> None:
        """Pressing Enter defaults to merge strategy."""
        skill_dir = tmp_path / ".claude" / "skills" / "planning-work"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text("# Planning")
        (tmp_path / "README.md").write_text("# Test")
        monkeypatch.setattr("builtins.input", lambda _: "")
        result = run_existing_harness_wizard(tmp_path, interactive=True)
        assert result["strategy"] == "merge"

    def test_interactive_choice_4_cancel(self, tmp_path: Path, monkeypatch) -> None:
        """Interactive choice 4 returns cancel strategy."""
        skill_dir = tmp_path / ".claude" / "skills" / "planning-work"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text("# Planning")
        (tmp_path / "README.md").write_text("# Test")
        monkeypatch.setattr("builtins.input", lambda _: "4")
        result = run_existing_harness_wizard(tmp_path, interactive=True)
        assert result["strategy"] == "cancel"


class TestMergeSettingsJson:
    """Tests for merge_settings_json function."""

    def test_no_existing_returns_new(self, tmp_path: Path) -> None:
        """No existing settings returns new settings unchanged."""
        new_settings = {"hooks": {"PreToolUse": []}}
        result = merge_settings_json(tmp_path, new_settings)
        assert result == new_settings

    def test_preserves_custom_hooks(self, tmp_path: Path) -> None:
        """Preserves custom hook registrations from existing."""
        (tmp_path / ".claude").mkdir(parents=True)
        (tmp_path / ".claude" / "settings.json").write_text(json.dumps({
            "hooks": {
                "PostToolUse": [
                    {"hooks": [{"command": "python my_custom.py"}]}
                ]
            }
        }))

        new_settings = {
            "hooks": {
                "PostToolUse": [
                    {"hooks": [{"command": "python activity_logger.py"}]}
                ]
            }
        }

        result = merge_settings_json(tmp_path, new_settings)
        commands = []
        for entry in result["hooks"]["PostToolUse"]:
            for hook in entry.get("hooks", [entry]):
                commands.append(hook.get("command", ""))

        assert "python my_custom.py" in commands
        assert "python activity_logger.py" in commands

    def test_does_not_duplicate_generated_hooks(self, tmp_path: Path) -> None:
        """Does not preserve generated hooks from existing."""
        (tmp_path / ".claude").mkdir(parents=True)
        (tmp_path / ".claude" / "settings.json").write_text(json.dumps({
            "hooks": {
                "PostToolUse": [
                    {"hooks": [{"command": "python activity_logger.py"}]}
                ]
            }
        }))

        new_settings = {
            "hooks": {
                "PostToolUse": [
                    {"hooks": [{"command": "python activity_logger.py"}]}
                ]
            }
        }

        result = merge_settings_json(tmp_path, new_settings)
        commands = []
        for entry in result["hooks"]["PostToolUse"]:
            for hook in entry.get("hooks", [entry]):
                commands.append(hook.get("command", ""))

        assert commands.count("python activity_logger.py") == 1
