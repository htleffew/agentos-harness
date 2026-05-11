"""Tests for discipline settings."""

from __future__ import annotations

import json
from pathlib import Path

from agentos_harness.discipline import (
    load_discipline_settings,
    run_discipline_wizard,
    write_discipline_settings,
)


def test_run_discipline_wizard_non_interactive() -> None:
    """Non-interactive wizard returns defaults."""
    settings = run_discipline_wizard(interactive=False)
    assert settings["plan_cold_reader_gate"] is False
    assert settings["loop_as_default"] is False


def test_run_discipline_wizard_interactive_yes_yes(monkeypatch) -> None:
    """Interactive wizard with 'y' enables both settings."""
    inputs = iter(["y", "y"])
    monkeypatch.setattr("builtins.input", lambda _: next(inputs))
    settings = run_discipline_wizard(interactive=True)
    assert settings["plan_cold_reader_gate"] is True
    assert settings["loop_as_default"] is True


def test_run_discipline_wizard_interactive_no_no(monkeypatch) -> None:
    """Interactive wizard with 'n' disables both settings."""
    inputs = iter(["n", "n"])
    monkeypatch.setattr("builtins.input", lambda _: next(inputs))
    settings = run_discipline_wizard(interactive=True)
    assert settings["plan_cold_reader_gate"] is False
    assert settings["loop_as_default"] is False


def test_run_discipline_wizard_interactive_enter_defaults(monkeypatch) -> None:
    """Interactive wizard with Enter uses defaults (disabled)."""
    inputs = iter(["", ""])
    monkeypatch.setattr("builtins.input", lambda _: next(inputs))
    settings = run_discipline_wizard(interactive=True)
    assert settings["plan_cold_reader_gate"] is False
    assert settings["loop_as_default"] is False


def test_run_discipline_wizard_interactive_mixed(monkeypatch) -> None:
    """Interactive wizard with mixed responses."""
    inputs = iter(["yes", ""])
    monkeypatch.setattr("builtins.input", lambda _: next(inputs))
    settings = run_discipline_wizard(interactive=True)
    assert settings["plan_cold_reader_gate"] is True
    assert settings["loop_as_default"] is False


def test_write_discipline_settings(tmp_path: Path) -> None:
    """Write creates config file with expected structure."""
    settings = {"plan_cold_reader_gate": True, "loop_as_default": False}
    path = write_discipline_settings(tmp_path, settings)

    assert path.exists()
    assert path.name == "discipline.json"

    content = json.loads(path.read_text(encoding="utf-8"))
    assert content["plan_cold_reader_gate"] is True
    assert content["loop_as_default"] is False
    assert "comments" in content


def test_load_discipline_settings_missing_file(tmp_path: Path) -> None:
    """Missing config returns defaults."""
    settings = load_discipline_settings(tmp_path)
    assert settings["plan_cold_reader_gate"] is False
    assert settings["loop_as_default"] is False


def test_load_discipline_settings_existing_file(tmp_path: Path) -> None:
    """Loads settings from existing file."""
    config_dir = tmp_path / ".harness" / "config"
    config_dir.mkdir(parents=True)
    config_path = config_dir / "discipline.json"
    config_path.write_text(
        json.dumps({"plan_cold_reader_gate": True, "loop_as_default": True}),
        encoding="utf-8",
    )

    settings = load_discipline_settings(tmp_path)
    assert settings["plan_cold_reader_gate"] is True
    assert settings["loop_as_default"] is True


def test_load_discipline_settings_invalid_json(tmp_path: Path) -> None:
    """Invalid JSON returns defaults."""
    config_dir = tmp_path / ".harness" / "config"
    config_dir.mkdir(parents=True)
    config_path = config_dir / "discipline.json"
    config_path.write_text("not valid json{", encoding="utf-8")

    settings = load_discipline_settings(tmp_path)
    assert settings["plan_cold_reader_gate"] is False
    assert settings["loop_as_default"] is False
