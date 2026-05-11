"""Existing harness detection and migration wizard."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


def detect_existing_harness(workspace: Path) -> dict[str, Any]:
    """Detect existing harness files and categorize them.

    Returns dict with:
        has_harness: bool
        custom_skills: list of paths
        custom_commands: list of paths
        custom_hooks: list of paths
        settings_json: path or None
        settings_has_custom_hooks: bool
        generated_conflicts: list of paths that would be overwritten
    """
    result = {
        "has_harness": False,
        "custom_skills": [],
        "custom_commands": [],
        "custom_hooks": [],
        "settings_json": None,
        "settings_has_custom_hooks": False,
        "generated_conflicts": [],
    }

    claude_dir = workspace / ".claude"
    harness_dir = workspace / ".harness"

    if not claude_dir.exists() and not harness_dir.exists():
        return result

    result["has_harness"] = True

    from .profile_registry import render_profile
    from .analyzer import analyze_workspace

    analysis = analyze_workspace(workspace, write_state=False)
    generated_paths = set(render_profile(analysis, "core").keys())

    for skills_dir in [claude_dir / "skills", harness_dir / "skills"]:
        if skills_dir.exists():
            for skill_dir in skills_dir.iterdir():
                if skill_dir.is_dir():
                    skill_path = f".claude/skills/{skill_dir.name}/SKILL.md"
                    if skill_path in generated_paths:
                        if (skill_dir / "SKILL.md").exists():
                            result["generated_conflicts"].append(skill_path)
                    else:
                        result["custom_skills"].append(skill_dir.name)

    for commands_dir in [claude_dir / "commands", harness_dir / "commands"]:
        if commands_dir.exists():
            for cmd_file in commands_dir.glob("*.md"):
                cmd_path = f".claude/commands/{cmd_file.name}"
                if cmd_path in generated_paths:
                    result["generated_conflicts"].append(cmd_path)
                else:
                    result["custom_commands"].append(cmd_file.stem)

    for hooks_parent in [claude_dir / "hooks", harness_dir / "hooks"]:
        for hooks_dir in [hooks_parent / "pre", hooks_parent / "post"]:
            if hooks_dir.exists():
                for hook_file in hooks_dir.glob("*.py"):
                    hook_path = f".claude/hooks/{hooks_dir.name}/{hook_file.name}"
                    if hook_path in generated_paths:
                        result["generated_conflicts"].append(hook_path)
                    else:
                        result["custom_hooks"].append(hook_file.stem)

    settings_path = claude_dir / "settings.json"
    if settings_path.exists():
        result["settings_json"] = str(settings_path)
        try:
            settings = json.loads(settings_path.read_text(encoding="utf-8"))
            hooks_config = settings.get("hooks", {})

            generated_hook_names = {
                "activity_log.py", "activity_logger.py", "doom_loop_detector.py",
                "error_tracker.py", "handoff_reminder.py", "knowledge_freshness_check.py",
                "knowledge_promotion_check.py", "learn_from_failure.py", "wiki_reminder.py",
                "wiki_sweep.py", "workflow_completion_wiki_sweep.py", "path_guard.py",
                "destructive_guard.py", "secret_guard.py", "commit_gate.py", "skill_guard.py",
                "wiki_receipt_guard.py", "external_boundary_guard.py", "notebook_conformance_check.py",
                "session_context.py", "setup_rescan_reminder.py",
            }

            for hook_list in hooks_config.values():
                if isinstance(hook_list, list):
                    for entry in hook_list:
                        if isinstance(entry, dict):
                            hooks = entry.get("hooks", [entry])
                            for hook in hooks:
                                cmd = hook.get("command", "")
                                if not any(name in cmd for name in generated_hook_names):
                                    if ".py" in cmd:
                                        result["settings_has_custom_hooks"] = True
                                        break
        except (json.JSONDecodeError, KeyError):
            pass

    return result


def run_existing_harness_wizard(workspace: Path, interactive: bool = True) -> dict[str, Any]:
    """Run interactive wizard for handling existing harness files.

    Returns dict with:
        strategy: "fresh" | "merge" | "preserve_custom" | "skip_conflicts"
        preserve_paths: list of paths to skip during generation
        merge_settings: bool - whether to merge settings.json hooks
    """
    detection = detect_existing_harness(workspace)

    if not detection["has_harness"]:
        return {"strategy": "fresh", "preserve_paths": [], "merge_settings": False}

    if not interactive:
        return {"strategy": "fresh", "preserve_paths": [], "merge_settings": True}

    has_conflicts = (
        detection["generated_conflicts"]
        or detection["settings_has_custom_hooks"]
    )
    if not has_conflicts:
        if detection["custom_skills"] or detection["custom_commands"] or detection["custom_hooks"]:
            print("\nExisting custom skills/commands/hooks detected - they will be preserved.", file=sys.stderr)
        return {"strategy": "merge", "preserve_paths": [], "merge_settings": False}

    print("\n" + "=" * 60, file=sys.stderr)
    print("EXISTING HARNESS DETECTED", file=sys.stderr)
    print("=" * 60, file=sys.stderr)

    if detection["custom_skills"]:
        print(f"\n  Custom skills (will be preserved):", file=sys.stderr)
        for skill in detection["custom_skills"][:5]:
            print(f"    + {skill}", file=sys.stderr)
        if len(detection["custom_skills"]) > 5:
            print(f"    ... and {len(detection['custom_skills']) - 5} more", file=sys.stderr)

    if detection["custom_commands"]:
        print(f"\n  Custom commands (will be preserved):", file=sys.stderr)
        for cmd in detection["custom_commands"][:5]:
            print(f"    + {cmd}", file=sys.stderr)

    if detection["custom_hooks"]:
        print(f"\n  Custom hooks (will be preserved):", file=sys.stderr)
        for hook in detection["custom_hooks"][:5]:
            print(f"    + {hook}", file=sys.stderr)

    if detection["generated_conflicts"]:
        print(f"\n  Files that would be overwritten ({len(detection['generated_conflicts'])}):", file=sys.stderr)
        for path in detection["generated_conflicts"][:5]:
            print(f"    ! {path}", file=sys.stderr)
        if len(detection["generated_conflicts"]) > 5:
            print(f"    ... and {len(detection['generated_conflicts']) - 5} more", file=sys.stderr)

    if detection["settings_has_custom_hooks"]:
        print(f"\n  settings.json has custom hook registrations", file=sys.stderr)

    print("\n" + "-" * 60, file=sys.stderr)
    print("How would you like to handle existing files?\n", file=sys.stderr)
    print("  1. Fresh install plan - on apply, backup and replace all generated paths", file=sys.stderr)
    print("  2. Merge plan - on apply, preserve custom hooks in settings.json and backup rest", file=sys.stderr)
    print("  3. Preserve modified - skip files you've customized", file=sys.stderr)
    print("  4. Cancel - exit without changes", file=sys.stderr)

    while True:
        try:
            choice = input("\nEnter choice [1-4] or press Enter for merge: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nCancelled.", file=sys.stderr)
            return {"strategy": "cancel", "preserve_paths": [], "merge_settings": False}

        if choice == "" or choice == "2":
            return {
                "strategy": "merge",
                "preserve_paths": [],
                "merge_settings": True,
            }
        elif choice == "1":
            return {
                "strategy": "fresh",
                "preserve_paths": [],
                "merge_settings": False,
            }
        elif choice == "3":
            preserve = _select_paths_to_preserve(detection["generated_conflicts"])
            return {
                "strategy": "preserve_custom",
                "preserve_paths": preserve,
                "merge_settings": detection["settings_has_custom_hooks"],
            }
        elif choice == "4":
            return {"strategy": "cancel", "preserve_paths": [], "merge_settings": False}
        else:
            print("Invalid choice. Enter 1, 2, 3, or 4.", file=sys.stderr)


def _select_paths_to_preserve(conflicts: list[str]) -> list[str]:
    """Let user select which conflicting paths to preserve."""
    if not conflicts:
        return []

    print("\nSelect files to preserve (enter numbers separated by commas, or 'all'):", file=sys.stderr)
    for i, path in enumerate(conflicts, 1):
        print(f"  {i}. {path}", file=sys.stderr)

    try:
        choice = input("\nPreserve: ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        return []

    if choice == "all":
        return conflicts

    if not choice:
        return []

    selected = []
    for part in choice.split(","):
        try:
            idx = int(part.strip()) - 1
            if 0 <= idx < len(conflicts):
                selected.append(conflicts[idx])
        except ValueError:
            pass

    return selected


def merge_settings_json(workspace: Path, new_settings: dict) -> dict:
    """Merge new settings with existing, preserving custom hook registrations."""
    settings_path = workspace / ".claude" / "settings.json"

    if not settings_path.exists():
        return new_settings

    try:
        existing = json.loads(settings_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return new_settings

    generated_hook_names = {
        "activity_log.py", "activity_logger.py", "doom_loop_detector.py",
        "error_tracker.py", "handoff_reminder.py", "knowledge_freshness_check.py",
        "knowledge_promotion_check.py", "learn_from_failure.py", "wiki_reminder.py",
        "wiki_sweep.py", "workflow_completion_wiki_sweep.py", "path_guard.py",
        "destructive_guard.py", "secret_guard.py", "commit_gate.py", "skill_guard.py",
        "wiki_receipt_guard.py", "external_boundary_guard.py", "notebook_conformance_check.py",
        "session_context.py", "setup_rescan_reminder.py",
    }

    def is_custom_hook(hook_entry: dict) -> bool:
        cmd = hook_entry.get("command", "")
        return not any(name in cmd for name in generated_hook_names) and ".py" in cmd

    def extract_custom_hooks(hooks_config: dict) -> dict:
        custom = {}
        for event_type, hook_list in hooks_config.items():
            if not isinstance(hook_list, list):
                continue
            custom_entries = []
            for entry in hook_list:
                if isinstance(entry, dict):
                    if "hooks" in entry:
                        custom_hooks = [h for h in entry.get("hooks", []) if is_custom_hook(h)]
                        if custom_hooks:
                            custom_entries.append({**entry, "hooks": custom_hooks})
                    elif is_custom_hook(entry):
                        custom_entries.append(entry)
            if custom_entries:
                custom[event_type] = custom_entries
        return custom

    existing_hooks = existing.get("hooks", {})
    custom_hooks = extract_custom_hooks(existing_hooks)

    merged = dict(new_settings)

    for event_type, custom_entries in custom_hooks.items():
        if event_type in merged.get("hooks", {}):
            merged["hooks"][event_type].extend(custom_entries)
        else:
            if "hooks" not in merged:
                merged["hooks"] = {}
            merged["hooks"][event_type] = custom_entries

    return merged
