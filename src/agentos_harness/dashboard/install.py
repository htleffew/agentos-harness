"""Install wizard — harness dashboard install.

Implements §10.2 Steps 1–6 as a CLI-mode wizard (no UI yet).
Writes .harness/config/dashboard.json on completion.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

from .config import DashboardConfig, CostEstimation, config_exists, load_config, save_config
from .skill_discovery import discover_skills, skills_by_domain


def _prompt(msg: str, default: str = "") -> str:
    """Interactive prompt with default. Returns default on EOF."""
    display = f"{msg} [{default}]: " if default else f"{msg}: "
    try:
        val = input(display).strip()
        return val if val else default
    except (EOFError, KeyboardInterrupt):
        return default


def _prompt_int(msg: str, default: int, min_val: int, max_val: int) -> int:
    while True:
        raw = _prompt(msg, str(default))
        try:
            val = int(raw)
            if min_val <= val <= max_val:
                return val
            print(f"  Must be {min_val}–{max_val}.", file=sys.stderr)
        except ValueError:
            print("  Enter a number.", file=sys.stderr)


def _prompt_float(msg: str, default: float) -> float:
    while True:
        raw = _prompt(msg, str(default))
        try:
            return float(raw)
        except ValueError:
            print("  Enter a decimal number (e.g. 0.6).", file=sys.stderr)


def run_wizard(workspace: Path, *, interactive: bool = True) -> DashboardConfig:
    """Run the 6-step install wizard. Returns the resulting DashboardConfig."""

    print("\n" + "=" * 60)
    print("AGENTIC OS DASHBOARD — INSTALL WIZARD")
    print("=" * 60)

    # Load existing config as defaults
    if config_exists(workspace):
        print("  Existing dashboard.json detected — loading as defaults.")
        cfg = load_config(workspace)
        print("  Choose: (f) fresh install / (u) update / (p) preserve all")
        if interactive:
            choice = _prompt("Choice", "u").lower()
            if choice == "f":
                cfg = DashboardConfig()
            elif choice == "p":
                save_config(workspace, cfg)
                print("  Configuration preserved. No changes written.")
                return cfg
        # else: use existing as defaults
    else:
        cfg = DashboardConfig()

    # ── Step 1: Skill discovery preview ──────────────────────────────────────
    print("\n--- Step 1: Skill discovery ---")
    skills = discover_skills(workspace, cfg.recency_weight, cfg.frequency_weight)
    if not skills:
        print("  WARNING: No skills found in .claude/skills/")
    else:
        grouped = skills_by_domain(skills, cfg.domain_order)
        print(f"  Discovered {len(skills)} skill(s) across {len(grouped)} domain(s):")
        for domain, domain_skills in grouped.items():
            print(f"    [{domain.upper()}]")
            for s in domain_skills[:3]:
                badge = " [slash-cmd]" if s.invocable_only else ""
                print(f"      • {s.display_label}{badge}")
            if len(domain_skills) > 3:
                print(f"      ... and {len(domain_skills) - 3} more")

    # ── Step 2: Domain configuration ─────────────────────────────────────────
    print("\n--- Step 2: Domain order ---")
    current_order = ", ".join(cfg.domain_order)
    print(f"  Current domain order: {current_order}")
    if interactive:
        raw = _prompt(
            "  Domain order (comma-separated, Enter to keep)",
            ", ".join(cfg.domain_order),
        )
        parts = [p.strip() for p in raw.split(",") if p.strip()]
        if parts:
            cfg.domain_order = parts

    # ── Step 3: Agent routing confirmation ───────────────────────────────────
    print("\n--- Step 3: Agent routing ---")
    agents = {
        "claude": shutil.which("claude") or shutil.which("claude.cmd"),
        "codex": shutil.which("codex") or shutil.which("codex.cmd"),
        "gemini": shutil.which("gemini") or shutil.which("gemini.cmd"),
    }
    for agent, path in agents.items():
        status = f"found at {path}" if path else "NOT FOUND"
        print(f"  {agent:10s} {status}")

    # ── Step 4: Daemon configuration ─────────────────────────────────────────
    print("\n--- Step 4: Daemon configuration ---")
    if interactive:
        cfg.concurrency_limit = _prompt_int(
            "  Max concurrent sessions", cfg.concurrency_limit, 1, 16
        )
        cfg.max_continuations = _prompt_int(
            "  Max continuations per task", cfg.max_continuations, 1, 10
        )

    # ── Step 5: Dashboard config ──────────────────────────────────────────────
    print("\n--- Step 5: Dashboard settings ---")
    if interactive:
        cfg.port = _prompt_int("  Port", cfg.port, 1024, 65535)
        raw_pinned = _prompt("  Pinned skill (Enter for none)", cfg.pinned_skill or "")
        cfg.pinned_skill = raw_pinned if raw_pinned else None

    # ── Step 6: Review & apply ────────────────────────────────────────────────
    print("\n--- Step 6: Review ---")
    import json as _json
    print(_json.dumps(cfg.to_dict(), indent=2))

    if interactive:
        confirm = _prompt("  Write dashboard.json? [Y/n]", "y").lower()
        if confirm in ("n", "no"):
            print("  Aborted. No changes written.")
            return cfg

    save_config(workspace, cfg)
    config_path = workspace / ".harness" / "config" / "dashboard.json"
    print(f"\n  dashboard.json written to: {config_path}")
    print("  Run `harness dashboard start` to launch the dashboard.")
    return cfg
