"""Dashboard state construction."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .analyzer import analyze_workspace
from .config import DASHBOARD_STATE_FILE, MANIFEST_FILE, SETUP_STATE_FILE, ensure_state_dir, state_file
from .linter import lint_has_errors, run_lint
from .models import read_json, redact_object, write_json
from .wiki import wiki_maintain_status


def _signal(count: int, *, optional: bool = False) -> str:
    if count > 0:
        return "healthy"
    return "optional" if optional else "attention"


def _row(kind: str, name: str, signal: str, path: str, detail: str, action: str = "") -> dict[str, str]:
    return {
        "kind": kind,
        "name": name,
        "signal": signal,
        "path": path,
        "detail": detail,
        "action": action,
    }


def build_dashboard_state(workspace: str | Path, *, write_state: bool = True) -> dict[str, Any]:
    analysis = analyze_workspace(workspace, write_state=True)
    root = Path(analysis["workspace"]["root"])
    inventory = analysis["inventory"]
    manifest_path = state_file(root, MANIFEST_FILE)
    manifest = read_json(manifest_path) if manifest_path.exists() else None
    setup_path = state_file(root, SETUP_STATE_FILE)
    setup_state = read_json(setup_path) if setup_path.exists() else None

    lint_results = run_lint(root)
    lint_errors = sum(1 for r in lint_results if r.status == "fail")
    lint_warnings = sum(1 for r in lint_results if r.status == "warn")
    health_signal = "attention" if lint_errors else ("optional" if lint_warnings else "healthy")

    wiki_pages = len([item for item in inventory["agent_files"] if item.startswith(".claude/wiki/") and item.endswith(".md")])
    skills = len([item for item in inventory["agent_files"] if item.startswith(".claude/skills/") and item.endswith("SKILL.md")])
    commands = len([item for item in inventory["agent_files"] if item.startswith(".claude/commands/") and item.endswith(".md")])
    hook_files = [item for item in inventory["agent_files"] if item.startswith(".claude/hooks/") and item.endswith(".py")]
    settings_files = [item for item in inventory["agent_files"] if item == ".claude/settings.json"]
    hooks = len(hook_files) + len(settings_files)
    projects = len(inventory["project_boundaries"])
    maintenance = 0
    wiki_settings_path = root / ".claude" / "state" / "config" / "wiki_settings.json"
    if wiki_settings_path.exists():
        try:
            maintenance_status = wiki_maintain_status(root)
            maintenance = maintenance_status.get("counts", {}).get("pending", 0)
        except Exception:
            pass

    if not inventory["agent_files"]:
        status = "attention"
        reason = "No local harness files were detected."
        next_command = "harness setup . --dry-run"
    elif manifest and any(entry["action"] != "skip" for entry in manifest.get("entries", [])):
        status = "attention"
        reason = "A generation manifest is waiting for review."
        next_command = "harness setup . --apply"
    else:
        status = "ready"
        reason = "Harness files are present and scan state is current."
        next_command = "harness analyze ."

    sections = [
        {
            "id": "overview",
            "title": "Overview",
            "signal": status if status != "ready" else "healthy",
            "summary": reason,
            "tabs": ["Summary", "Findings", "Files", "Actions"],
            "rows": [
                _row("workspace", analysis["workspace"]["display_name"], "healthy", ".", reason, next_command),
                _row("language", ", ".join(inventory["languages"]) or "None detected", _signal(len(inventory["languages"])), ".", "Detected language set"),
            ],
        },
        {
            "id": "wiki",
            "title": "Wiki",
            "signal": _signal(wiki_pages),
            "summary": f"{wiki_pages} wiki pages detected.",
            "tabs": ["Summary", "Findings", "Files", "Actions"],
            "rows": [_row("wiki", Path(path).name, "healthy", path, "Generated or existing wiki page") for path in inventory["agent_files"] if path.startswith(".claude/wiki/")],
        },
        {
            "id": "skills",
            "title": "Skills",
            "signal": _signal(skills),
            "summary": f"{skills} skills detected.",
            "tabs": ["Summary", "Findings", "Files", "Actions"],
            "rows": [_row("skill", Path(path).parts[-2] if len(Path(path).parts) > 1 else path, "healthy", path, "Skill entrypoint") for path in inventory["agent_files"] if path.endswith("SKILL.md")],
        },
        {
            "id": "commands",
            "title": "Commands",
            "signal": _signal(commands),
            "summary": f"{commands} slash commands detected.",
            "tabs": ["Summary", "Findings", "Files", "Actions"],
            "rows": [_row("command", Path(path).stem, "healthy", path, "Command wrapper") for path in inventory["agent_files"] if path.startswith(".claude/commands/")],
        },
        {
            "id": "hooks",
            "title": "Hooks",
            "signal": _signal(hooks, optional=True),
            "summary": f"{hooks} hook files and registrations detected.",
            "tabs": ["Summary", "Findings", "Files", "Actions"],
            "rows": [
                *[_row("hook", Path(path).name, "healthy", path, "Generated hook script") for path in hook_files],
                *[_row("hook", path, "healthy", path, "Hook registration") for path in settings_files],
            ],
        },
        {
            "id": "health",
            "title": "Health",
            "signal": health_signal,
            "summary": f"{lint_errors} error(s), {lint_warnings} warning(s) from harness lint.",
            "tabs": ["Summary", "Findings", "Files", "Actions"],
            "rows": [
                _row(
                    "lint",
                    r.check,
                    "healthy" if r.status == "pass" else ("attention" if r.status == "fail" else "optional"),
                    ".",
                    r.message,
                    "harness lint ." if r.status != "pass" else "",
                )
                for r in lint_results
            ],
        },
        {
            "id": "setup",
            "title": "Setup",
            "signal": _signal(len(manifest.get("selected_modules", [])) if manifest else 0, optional=True),
            "summary": f"{len(manifest.get('selected_modules', [])) if manifest else 0} adaptive setup modules selected.",
            "tabs": ["Summary", "Findings", "Files", "Actions"],
            "rows": [
                *[
                    _row("module", module["id"], "healthy", ".", module["reason"], f"harness setup . --apply")
                    for module in (manifest.get("selected_modules", []) if manifest else [])
                ],
                *[
                    _row("module", module["id"], "optional", ".", module["reason"])
                    for module in (manifest.get("unselected_modules", []) if manifest else [])
                ],
                _row("setup", setup_state.get("mode", "not run") if setup_state else "not run", "healthy" if setup_state else "attention", ".harness/state/setup.json", "Latest setup state", next_command),
            ],
        },
        {
            "id": "projects",
            "title": "Projects",
            "signal": _signal(projects),
            "summary": f"{projects} project boundaries detected.",
            "tabs": ["Summary", "Findings", "Files", "Actions"],
            "rows": [_row("project", path, "healthy", path, "Detected package or project boundary") for path in inventory["project_boundaries"]],
        },
        {
            "id": "activity",
            "title": "Activity",
            "signal": "healthy",
            "summary": "Latest scan state and manifest state.",
            "tabs": ["Summary", "Findings", "Files", "Actions"],
            "rows": [
                _row("scan", analysis["workspace"]["scanned_at"], "healthy", ".harness/state/analysis.json", "Latest analyzer run"),
                _row("manifest", "present" if manifest else "absent", "attention" if manifest else "optional", ".harness/state/generation_manifest.json", "Dry-run manifest state"),
            ],
        },
        {
            "id": "search",
            "title": "Search",
            "signal": "healthy",
            "summary": "Client-side search across current dashboard rows.",
            "tabs": ["Summary", "Findings", "Files", "Actions"],
            "rows": [_row("search", "local index", "healthy", ".", "Search is built from the dashboard payload")],
        },
    ]
    payload = {
        "schema_version": "1.0",
        "workspace": analysis["workspace"],
        "verdict": {
            "status": status,
            "reason": reason,
            "next_command": next_command,
        },
        "health": {
            "errors": lint_errors,
            "warnings": lint_warnings,
            "checks": {r.check: r.status for r in lint_results},
        },
        "inventory": {
            "wiki_pages": wiki_pages,
            "skills": skills,
            "commands": commands,
            "hooks": hooks,
            "projects": projects,
            "setup_modules": len(manifest.get("selected_modules", [])) if manifest else 0,
            "maintenance_items": maintenance,
        },
        "sections": sections,
    }
    payload = redact_object(payload)
    if write_state:
        ensure_state_dir(root)
        write_json(state_file(root, DASHBOARD_STATE_FILE), payload)
    return payload
