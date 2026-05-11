"""Operating discipline settings for the harness.

Discipline settings control optional enforcement features:
- plan_cold_reader_gate: Validate plan quality before execution
- loop_as_default: Continue with /loop until 100% complete
"""

from __future__ import annotations

import json
from pathlib import Path


def run_discipline_wizard(interactive: bool = True) -> dict:
    """Run the discipline settings wizard.

    Args:
        interactive: If True, prompt user for choices. If False, use defaults.

    Returns:
        dict with discipline settings.
    """
    settings = {
        "version": "1.0",
        "plan_cold_reader_gate": False,
        "loop_as_default": False,
    }

    if not interactive:
        return settings

    print("\n" + "=" * 60, file=__import__("sys").stderr)
    print("OPERATING DISCIPLINE SETTINGS", file=__import__("sys").stderr)
    print("=" * 60, file=__import__("sys").stderr)
    print(file=__import__("sys").stderr)
    print("These settings control optional enforcement features.", file=__import__("sys").stderr)
    print("You can change them later in .harness/config/discipline.json", file=__import__("sys").stderr)
    print(file=__import__("sys").stderr)

    # Plan cold-reader gate
    print("1. Plan Cold-Reader Quality Gate", file=__import__("sys").stderr)
    print("   When enabled, warns if plans lack explicit pass/fail criteria", file=__import__("sys").stderr)
    print("   and expected deliverables.", file=__import__("sys").stderr)
    print(file=__import__("sys").stderr)

    try:
        response = input("   Enable plan quality gate? [y/N]: ").strip().lower()
        if response in ("y", "yes"):
            settings["plan_cold_reader_gate"] = True
            print("   ✓ Plan quality gate enabled", file=__import__("sys").stderr)
        else:
            print("   ○ Plan quality gate disabled (default)", file=__import__("sys").stderr)
    except (EOFError, KeyboardInterrupt):
        print("\n   ○ Plan quality gate disabled (default)", file=__import__("sys").stderr)

    print(file=__import__("sys").stderr)

    # Loop as default
    print("2. Loop-as-Default Mode", file=__import__("sys").stderr)
    print("   When enabled, /execute continues with /loop until 100% complete", file=__import__("sys").stderr)
    print("   rather than stopping after one pass.", file=__import__("sys").stderr)
    print(file=__import__("sys").stderr)

    try:
        response = input("   Enable loop-as-default? [y/N]: ").strip().lower()
        if response in ("y", "yes"):
            settings["loop_as_default"] = True
            print("   ✓ Loop-as-default enabled", file=__import__("sys").stderr)
        else:
            print("   ○ Loop-as-default disabled (default)", file=__import__("sys").stderr)
    except (EOFError, KeyboardInterrupt):
        print("\n   ○ Loop-as-default disabled (default)", file=__import__("sys").stderr)

    print(file=__import__("sys").stderr)
    print("-" * 60, file=__import__("sys").stderr)

    return settings


def write_discipline_settings(workspace: Path, settings: dict) -> Path:
    """Write discipline settings to the config file.

    Args:
        workspace: Workspace root path.
        settings: Discipline settings dict.

    Returns:
        Path to the written config file.
    """
    config_dir = workspace / ".harness" / "config"
    config_dir.mkdir(parents=True, exist_ok=True)

    config_path = config_dir / "discipline.json"

    full_settings = {
        "version": settings.get("version", "1.0"),
        "description": "Operating discipline settings for the harness",
        "plan_cold_reader_gate": settings.get("plan_cold_reader_gate", False),
        "loop_as_default": settings.get("loop_as_default", False),
        "comments": {
            "plan_cold_reader_gate": (
                "When true, validates that plans have explicit pass/fail criteria "
                "and deliverables before execution"
            ),
            "loop_as_default": (
                "When true, execute skill continues with /loop until 100% complete "
                "rather than stopping after one pass"
            ),
        },
    }

    config_path.write_text(json.dumps(full_settings, indent=2) + "\n", encoding="utf-8")
    return config_path


def load_discipline_settings(workspace: Path) -> dict:
    """Load discipline settings from the config file.

    Args:
        workspace: Workspace root path.

    Returns:
        Discipline settings dict, or defaults if file doesn't exist.
    """
    config_path = workspace / ".harness" / "config" / "discipline.json"
    if not config_path.exists():
        return {
            "plan_cold_reader_gate": False,
            "loop_as_default": False,
        }

    try:
        return json.loads(config_path.read_text(encoding="utf-8"))
    except Exception:
        return {
            "plan_cold_reader_gate": False,
            "loop_as_default": False,
        }
