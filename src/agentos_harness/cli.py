"""Command-line interface for agentos-harness (v2 of agentos-harness)."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

from . import __version__
from .analyzer import analyze_workspace
from .audit import audit_has_errors, audit_skills_dir, format_audit_report
from .config import MANIFEST_FILE, PACKAGE_NAME, SCHEMA_VERSION, SETUP_STATE_FILE, resolve_workspace, state_file
from .dashboard_data import build_dashboard_state
from .dashboard_server import run_server
from .generator import apply_manifest, manifest_summary, rollback_latest, write_manifest
from .profile_registry import available_profiles
from .existing_harness import run_existing_harness_wizard
from .project_detector import apply_project_layout, confirm_projects_interactive, plan_project_layout, scaffold_project
from .discipline import run_discipline_wizard, write_discipline_settings
from .setup_modules import selected_modules, unselected_modules
from .tool_check import TOOL_REGISTRY, detect_tools, moe_tier, parse_tools_flag, run_tool_wizard
from .models import read_json, redact_object, stable_json, write_json


REPO_INSTALL_SPEC = "git+https://github.com/htleffew/agentos-harness.git@master"
AGENTOS_REPO_SPEC = "git+https://github.com/htleffew/agentos-harness.git@master"


def _print_json(data: object) -> None:
    print(stable_json(data), end="")


def cmd_update(args: argparse.Namespace) -> int:
    command = [
        sys.executable,
        "-m",
        "pip",
        "install",
        "--upgrade",
        "--force-reinstall",
        REPO_INSTALL_SPEC,
    ]
    print("Updating agentos-harness from the repository...")
    print("Command:")
    print(f"  {' '.join(command)}")
    result = subprocess.run(command)
    if result.returncode != 0:
        print("Update failed. Fix the pip error above, then run `harness --update` again.", file=sys.stderr)
        return result.returncode
    print("\nUpdate complete.")
    print("Next:")
    print("  cd /path/to/your/repo")
    print("  harness setup")
    return 0


def _print_apply_error(workspace: Path, exc: Exception, *, command: str) -> None:
    manifest_path = state_file(workspace, MANIFEST_FILE)
    print(f"{command} could not apply generated harness files.", file=sys.stderr)
    print(f"Reason: {exc}", file=sys.stderr)
    print("", file=sys.stderr)
    print("Run these commands from the target repository:", file=sys.stderr)
    print("  harness setup . --dry-run", file=sys.stderr)
    print("  harness setup . --apply", file=sys.stderr)
    print("", file=sys.stderr)
    print(f"Dry run writes the reviewed manifest at {manifest_path}.", file=sys.stderr)
    print("Apply is blocked until that manifest exists and matches the current package profile.", file=sys.stderr)
    print("No repository files were changed by this failed apply.", file=sys.stderr)


def cmd_doctor(args: argparse.Namespace) -> int:
    from .linter import format_lint_report, run_lint

    workspace = resolve_workspace(args.workspace)
    detected = detect_tools()
    lint_results = run_lint(workspace)
    payload = {
        "package": PACKAGE_NAME,
        "package_version": __version__,
        "python_version": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
        "git_available": shutil.which("git") is not None,
        "claude_available": detected.get("claude", False),
        "codex_available": detected.get("codex", False),
        "gemini_available": detected.get("gemini", False),
        "moe_tier": moe_tier(detected),
        "state_path": str(state_file(workspace, "analysis.json").parent),
        "lint": {
            "errors": sum(1 for r in lint_results if r.status == "fail"),
            "warnings": sum(1 for r in lint_results if r.status == "warn"),
            "checks": {r.check: r.status for r in lint_results},
        },
    }
    _print_json(payload)
    return 0


def cmd_lint(args: argparse.Namespace) -> int:
    from .linter import format_lint_report, lint_has_errors, run_lint

    workspace = resolve_workspace(args.workspace)
    results = run_lint(workspace)
    print(format_lint_report(results, workspace))
    return 1 if lint_has_errors(results) else 0


def cmd_validate(args: argparse.Namespace) -> int:
    from .validate import run_all_validations

    workspace = resolve_workspace(args.workspace)
    results = run_all_validations(workspace)
    _print_json(results)
    return 0 if results["all_passed"] else 1


# --- Wiki Commands ---


def cmd_wiki_init(args: argparse.Namespace) -> int:
    from .wiki import wiki_init

    workspace = resolve_workspace(args.workspace)
    result = wiki_init(workspace)
    _print_json(result)
    return 0


def cmd_wiki_preflight(args: argparse.Namespace) -> int:
    from .wiki import wiki_preflight

    workspace = resolve_workspace(args.workspace)
    result = wiki_preflight(workspace, args.task, args.mode)
    _print_json(result)
    return 0


def cmd_wiki_status(args: argparse.Namespace) -> int:
    from .wiki import wiki_status

    workspace = resolve_workspace(args.workspace)
    result = wiki_status(workspace)
    _print_json(result)
    return 0


def cmd_wiki_lint(args: argparse.Namespace) -> int:
    from .wiki import wiki_lint

    workspace = resolve_workspace(args.workspace)
    issues = wiki_lint(workspace)
    _print_json({"issues": issues, "count": len(issues)})
    return 1 if issues else 0


def cmd_wiki_search(args: argparse.Namespace) -> int:
    from .wiki import wiki_search

    workspace = resolve_workspace(args.workspace)
    hits = wiki_search(workspace, args.query, args.limit)
    _print_json({"hits": hits, "count": len(hits)})
    return 0


def cmd_wiki_semantic_lint(args: argparse.Namespace) -> int:
    from .wiki import wiki_semantic_lint

    workspace = resolve_workspace(args.workspace)
    result = wiki_semantic_lint(workspace, args.limit, args.add_to_backlog)
    _print_json(result)
    return 0


def cmd_wiki_extract_learnings(args: argparse.Namespace) -> int:
    from .wiki import wiki_extract_learnings

    workspace = resolve_workspace(args.workspace)
    result = wiki_extract_learnings(workspace, args.hours)
    _print_json(result)
    return 0


def cmd_wiki_pending_synthesis(args: argparse.Namespace) -> int:
    from .wiki import wiki_pending_synthesis

    workspace = resolve_workspace(args.workspace)
    result = wiki_pending_synthesis(workspace)
    _print_json(result)
    return 0


def cmd_wiki_build_skill_index(args: argparse.Namespace) -> int:
    from .wiki import build_skill_index

    workspace = resolve_workspace(args.workspace)
    result = build_skill_index(workspace)
    _print_json(result)
    return 0 if result.get("skills_indexed", 0) > 0 else 1


def cmd_check_tools(args: argparse.Namespace) -> int:
    detected = run_tool_wizard(interactive=True)
    _print_json(detected)
    return 0 if detected.get("claude") else 1


def cmd_audit(args: argparse.Namespace) -> int:
    workspace = resolve_workspace(args.workspace)
    skills_dir = workspace / ".claude" / "skills"
    if not skills_dir.exists():
        print("No .claude/skills/ found. Run harness setup first.", file=sys.stderr)
        return 1
    findings = audit_skills_dir(skills_dir)
    print(format_audit_report(findings))
    return 1 if audit_has_errors(findings) else 0


def cmd_analyze(args: argparse.Namespace) -> int:
    analysis = analyze_workspace(args.workspace)
    _print_json(
        {
            "workspace": analysis["workspace"],
            "analysis_hash": analysis["analysis_hash"],
            "inventory": analysis["inventory"],
        }
    )
    return 0


def cmd_generate(args: argparse.Namespace) -> int:
    workspace = resolve_workspace(args.workspace)
    if args.dry_run:
        manifest = write_manifest(workspace, profile=args.profile)
        _print_json({"manifest": str(state_file(workspace, MANIFEST_FILE)), "summary": manifest_summary(manifest)})
        return 0
    if args.apply:
        try:
            ledger = apply_manifest(workspace)
        except (FileNotFoundError, ValueError) as exc:
            _print_apply_error(workspace, exc, command="harness generate --apply")
            return 1
        _print_json({"ledger": str(state_file(workspace, "generation_ledger.json")), "applied": ledger["entries"]})
        return 0
    raise SystemExit("choose --dry-run or --apply")


def _write_setup_state(
    workspace: Path,
    analysis: dict,
    *,
    mode: str,
    manifest: dict | None = None,
    ledger: dict | None = None,
    port: int = 8765,
) -> dict:
    payload = {
        "schema_version": SCHEMA_VERSION,
        "mode": mode,
        "workspace": analysis["workspace"],
        "selected_modules": selected_modules(analysis),
        "unselected_modules": unselected_modules(analysis),
        "manifest": str(state_file(workspace, MANIFEST_FILE)) if manifest else None,
        "summary": manifest_summary(manifest) if manifest else {},
        "ledger": str(state_file(workspace, "generation_ledger.json")) if ledger else None,
        "applied_count": len(ledger.get("entries", [])) if ledger else 0,
        "next_command": "harness setup . --apply" if mode == "dry-run" else f"harness dashboard . --port {port}",
        "dashboard_command": f"harness dashboard . --port {port}",
    }
    write_json(state_file(workspace, SETUP_STATE_FILE), payload)
    return payload


def _read_state_payload(workspace: Path, filename: str) -> dict:
    path = state_file(workspace, filename)
    if not path.exists():
        return {}
    try:
        payload = read_json(path)
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _default_discipline_settings() -> dict:
    return {"version": "1.0", "plan_cold_reader_gate": False, "loop_as_default": False}


def _validate_project_layout_targets(workspace: Path, projects: list[dict]) -> str | None:
    for project in projects:
        source_rel = project.get("source_path") or project.get("path")
        target_rel = project.get("path")
        if not source_rel or not target_rel or source_rel == target_rel:
            continue
        source = workspace / source_rel
        target = workspace / target_rel
        if not source.exists():
            return f"source project does not exist: {source_rel}"
        if target.exists():
            return f"target project already exists: {target_rel}"
    return None


def _remove_empty_parents(path: Path, stop_at: Path) -> None:
    current = path
    stop_at = stop_at.resolve()
    while current.resolve() != stop_at and current.exists():
        try:
            current.rmdir()
        except OSError:
            return
        current = current.parent


def _rollback_project_setup(workspace: Path) -> dict:
    setup = _read_state_payload(workspace, SETUP_STATE_FILE)
    removed: list[str] = []
    reverted_moves: list[dict] = []
    errors: list[str] = []

    for scaffold in setup.get("scaffolded_projects", []):
        for rel_path in sorted(scaffold.get("created_files", []), reverse=True):
            target = workspace / rel_path
            if target.exists() and target.is_file():
                try:
                    target.unlink()
                    removed.append(rel_path)
                    _remove_empty_parents(target.parent, workspace)
                except OSError as exc:
                    errors.append(f"failed to remove {rel_path}: {exc}")

    for layout in reversed(setup.get("project_layout_results", [])):
        if layout.get("action") != "move":
            continue
        source_rel = layout["source_path"]
        target_rel = layout["path"]
        source = workspace / source_rel
        target = workspace / target_rel
        if source.exists():
            errors.append(f"cannot reverse project move; source already exists: {source_rel}")
            continue
        if not target.exists():
            errors.append(f"cannot reverse project move; target missing: {target_rel}")
            continue
        try:
            source.parent.mkdir(parents=True, exist_ok=True)
            target.rename(source)
            reverted_moves.append({"source_path": source_rel, "path": target_rel})
            _remove_empty_parents(target.parent, workspace)
        except OSError as exc:
            errors.append(f"failed to reverse {target_rel} -> {source_rel}: {exc}")

    return {
        "project_scaffold_removed": sorted(removed),
        "project_moves_reverted": reverted_moves,
        "project_rollback_errors": errors,
    }


def _agent_handoff_prompt() -> str:
    return (
        "Finish harness setup for this repository. Read AGENTS.md, CLAUDE.md, "
        "CODEX.md if present, then run `harness validate .` and `harness lint .`. "
        "Fix any setup issues you find and summarize the validation results."
    )


def _print_setup_summary(payload: dict) -> None:
    mode = payload.get("mode", "unknown")
    if mode == "apply":
        print("\nHarness setup applied.")
    else:
        print("\nHarness setup review ready.")

    print(f"Workspace: {payload.get('workspace', {}).get('root', '.')}")
    print(f"Tool tier: {payload.get('moe_tier', 'unknown')}")
    print(f"Projects: {len(payload.get('confirmed_projects', []))}")

    if mode == "dry-run":
        print(f"Manifest: {payload.get('manifest')}")
        summary = payload.get("summary", {})
        if summary:
            parts = [f"{action}={count}" for action, count in sorted(summary.items())]
            print(f"Planned files: {', '.join(parts)}")
        print("\nNext:")
        print("  Apply now with `harness setup . --apply`, or rerun `harness setup` and choose apply.")
        print("  Use `harness setup . --dry-run --json` for machine-readable output.")
        return

    print(f"Applied entries: {payload.get('applied_count', 0)}")
    print(f"Dashboard: {payload.get('dashboard_command', 'harness dashboard .')}")
    print("\nNext:")
    print("  Open your agent terminal in this repository.")
    print("  Paste this prompt:")
    print()
    print(_agent_handoff_prompt())


def _apply_setup_plan(workspace: Path, analysis: dict, *, tier: str, port: int) -> dict | None:
    layout_error = _validate_project_layout_targets(workspace, analysis.get("confirmed_projects", []))
    if layout_error:
        print(f"Project layout failed: {layout_error}", file=sys.stderr)
        return None
    try:
        ledger = apply_manifest(workspace)
    except (FileNotFoundError, ValueError) as exc:
        _print_apply_error(workspace, exc, command="harness setup --apply")
        return None

    discipline_settings = analysis.get("discipline_settings", {})
    write_discipline_settings(workspace, discipline_settings)
    print("  ✓ .harness/config/discipline.json", file=sys.stderr)

    scaffolded = []
    layout_results = []
    for project in analysis.get("confirmed_projects", []):
        layout_result = apply_project_layout(workspace, project)
        layout_results.append(layout_result)
        if layout_result["errors"]:
            print(f"Project layout failed for {project['path']}: {layout_result['errors'][0]}", file=sys.stderr)
            return None
        if layout_result["action"] == "move":
            print(f"  ✓ moved {layout_result['source_path']} -> {layout_result['path']}", file=sys.stderr)
        elif layout_result["action"] == "copy":
            print(f"  ✓ copied {layout_result['source_path']} -> {layout_result['path']}", file=sys.stderr)
        for warning in layout_result.get("warnings", []):
            print(f"  ! {warning}", file=sys.stderr)
        result = scaffold_project(workspace, project)
        scaffolded.append(result)
        if result["created_files"]:
            for f in result["created_files"]:
                print(f"  ✓ {f}", file=sys.stderr)

    payload = _write_setup_state(workspace, analysis, mode="apply", ledger=ledger, port=port)
    payload["moe_tier"] = tier
    payload["confirmed_projects"] = analysis["confirmed_projects"]
    payload["project_layout"] = analysis.get("project_layout", analysis["confirmed_projects"])
    payload["discipline_settings"] = analysis["discipline_settings"]
    payload["project_layout_results"] = layout_results
    payload["scaffolded_projects"] = scaffolded
    write_json(state_file(workspace, SETUP_STATE_FILE), payload)
    return payload


def cmd_setup(args: argparse.Namespace) -> int:
    workspace = resolve_workspace(args.workspace)
    tools_flag = getattr(args, "tools", None)
    guided = not args.dry_run and not args.apply

    if args.apply and not state_file(workspace, MANIFEST_FILE).exists():
        _print_apply_error(workspace, FileNotFoundError("dry-run manifest is required before apply"), command="harness setup --apply")
        return 1

    # Non-interactive if explicitly set, or if tools flag is provided
    has_tools_flag = tools_flag is not None
    interactive = not getattr(args, "non_interactive", False) and not has_tools_flag

    if has_tools_flag:
        try:
            detected = parse_tools_flag(tools_flag or "")
        except ValueError as exc:
            print(f"Error: {exc}", file=sys.stderr)
            return 1
    elif interactive:
        detected = run_tool_wizard(interactive=True)
    else:
        detected = detect_tools()

    tier = moe_tier(detected)
    if tier == "no-agent":
        print("At least one AI CLI is required. Install one of:", file=sys.stderr)
        for spec in TOOL_REGISTRY.values():
            print(f"  {spec.install_cmd}", file=sys.stderr)
        return 1

    harness_choice = run_existing_harness_wizard(workspace, interactive=interactive)
    if harness_choice["strategy"] == "cancel":
        print("Setup cancelled.", file=sys.stderr)
        return 0

    analysis = analyze_workspace(workspace, write_state=True)
    analysis["detected_tools"] = detected
    analysis["moe_tier"] = tier
    analysis["harness_migration"] = harness_choice

    previous_setup = _read_state_payload(workspace, SETUP_STATE_FILE)
    previous_manifest = _read_state_payload(workspace, MANIFEST_FILE)

    if args.apply:
        analysis["confirmed_projects"] = (
            previous_setup.get("confirmed_projects")
            or previous_manifest.get("confirmed_projects")
            or analysis.get("confirmed_projects", [])
        )
        if previous_setup.get("project_layout"):
            analysis["project_layout"] = previous_setup["project_layout"]
        elif previous_manifest.get("project_layout"):
            analysis["project_layout"] = previous_manifest["project_layout"]
        else:
            analysis["project_layout"] = plan_project_layout(analysis["confirmed_projects"])
            analysis["confirmed_projects"] = analysis["project_layout"]
        analysis["discipline_settings"] = (
            previous_setup.get("discipline_settings")
            or previous_manifest.get("discipline_settings")
            or _default_discipline_settings()
        )
    else:
        confirmed = confirm_projects_interactive(
            analysis.get("suggested_projects", []), interactive=interactive
        )
        project_layout = plan_project_layout(confirmed)
        analysis["confirmed_projects"] = project_layout
        analysis["project_layout"] = project_layout

        # Run discipline settings wizard.
        discipline_settings = run_discipline_wizard(interactive=interactive)
        analysis["discipline_settings"] = discipline_settings

    action = "Applying reviewed manifest" if args.apply else "Generating manifest"
    print(f"Tool tier: {tier}. Confirmed projects: {len(analysis['confirmed_projects'])}. {action}...", file=sys.stderr)

    if args.apply:
        payload = _apply_setup_plan(workspace, analysis, tier=tier, port=args.port)
        if payload is None:
            return 1
    else:
        manifest = write_manifest(workspace, profile=args.profile, analysis=analysis, setup_mode="setup")
        payload = _write_setup_state(workspace, analysis, mode="dry-run", manifest=manifest, port=args.port)
        payload["moe_tier"] = tier
        payload["confirmed_projects"] = analysis["confirmed_projects"]
        payload["project_layout"] = analysis.get("project_layout", analysis["confirmed_projects"])
        payload["discipline_settings"] = analysis["discipline_settings"]

    write_json(state_file(workspace, SETUP_STATE_FILE), payload)

    if args.json:
        _print_json(payload)
    else:
        _print_setup_summary(payload)

    if guided and interactive and not args.json:
        try:
            apply_now = input("\nApply these changes now? [Y/n]: ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            apply_now = "n"
        if apply_now not in ("n", "no"):
            print("Applying reviewed manifest...", file=sys.stderr)
            apply_payload = _apply_setup_plan(workspace, analysis, tier=tier, port=args.port)
            if apply_payload is None:
                return 1
            if args.json:
                _print_json(apply_payload)
            else:
                _print_setup_summary(apply_payload)
            payload = apply_payload

    if args.serve:
        if not args.json:
            print(f"\nStarting dashboard on {args.host}:{args.port}...")
        run_server(workspace, host=args.host, port=args.port)
        return 0

    return 0


def cmd_rollback(args: argparse.Namespace) -> int:
    workspace = resolve_workspace(args.workspace)
    project_result = _rollback_project_setup(workspace)
    result = rollback_latest(workspace)
    result.update(project_result)
    _print_json(result)
    return 1 if project_result["project_rollback_errors"] else 0


# --- Dashboard Commands (agentos-harness §10) ---


def cmd_dashboard_install(args: argparse.Namespace) -> int:
    """harness dashboard install [workspace] — run the install wizard."""
    from .config import MANIFEST_FILE, resolve_workspace, state_file
    from .dashboard.install import run_wizard

    workspace = resolve_workspace(args.workspace)
    interactive = not getattr(args, "non_interactive", False)
    cfg = run_wizard(workspace, interactive=interactive)
    if args.json:
        _print_json(cfg.to_dict())
    return 0


def cmd_dashboard_start(args: argparse.Namespace) -> int:
    """harness dashboard start — start Next.js + daemon."""
    from .config import resolve_workspace
    from .dashboard.config import load_config
    from .dashboard.process import start

    workspace = resolve_workspace(args.workspace)
    cfg = load_config(workspace)
    port = args.port if args.port else cfg.port
    host = args.host if args.host else "127.0.0.1"

    try:
        result = start(workspace, port=port, host=host, wait=not args.no_wait)
    except (RuntimeError, FileNotFoundError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    if args.json:
        _print_json(result)
    else:
        status = result.get("status", "unknown")
        if status == "already_running":
            print(result["message"])
        elif status in ("started", "started_not_ready"):
            print(f"Dashboard started: {result.get('url', '')} (PID {result.get('web_pid')}")
            if status == "started_not_ready":
                print(f"  Warning: port {port} not yet responding. See log: {result.get('log')}",
                      file=sys.stderr)
        else:
            print(f"Dashboard status: {status}")
    return 0


def cmd_dashboard_stop(args: argparse.Namespace) -> int:
    """harness dashboard stop — stop running dashboard processes."""
    from .config import resolve_workspace
    from .dashboard.process import stop

    workspace = resolve_workspace(args.workspace)
    result = stop(workspace)
    if args.json:
        _print_json(result)
    else:
        if result.get("stopped"):
            print("Stopped: " + ", ".join(result["stopped"]))
        else:
            print("Dashboard was not running.")
    return 0


def cmd_dashboard_status(args: argparse.Namespace) -> int:
    """harness dashboard status — check if dashboard is running."""
    from .config import resolve_workspace
    from .dashboard.process import status

    workspace = resolve_workspace(args.workspace)
    result = status(workspace)
    if args.json:
        _print_json(result)
    else:
        running = result.get("running", False)
        if running:
            print(f"Running: {result.get('url')}  (web PID {result.get('web_pid')})")
        else:
            print("Not running.")
    return 0 if result.get("running") else 1


def cmd_dashboard_upgrade(args: argparse.Namespace) -> int:
    """harness dashboard upgrade [workspace] — re-run install wizard and restart."""
    from .config import resolve_workspace
    from .dashboard.install import run_wizard
    from .dashboard.process import status, stop, start

    workspace = resolve_workspace(args.workspace)

    # Stop if running
    proc_status = status(workspace)
    if proc_status.get("running"):
        print("Stopping dashboard for upgrade...")
        stop(workspace)

    # Re-run wizard
    interactive = not getattr(args, "non_interactive", False)
    cfg = run_wizard(workspace, interactive=interactive)

    # Restart
    print("Restarting dashboard...")
    try:
        result = start(workspace, port=cfg.port)
    except (RuntimeError, FileNotFoundError) as exc:
        print(f"Restart failed: {exc}", file=sys.stderr)
        return 1

    if args.json:
        _print_json(result)
    else:
        print(f"Dashboard restarted: {result.get('url', '')}")
    return 0


def cmd_export(args: argparse.Namespace) -> int:
    payload = build_dashboard_state(args.workspace)
    payload = redact_object(payload)
    if args.output:
        write_json(Path(args.output), payload)
        _print_json({"export": str(Path(args.output).resolve())})
    else:
        _print_json(payload)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="harness")
    parser.add_argument("--version", action="version", version=__version__)
    parser.add_argument("--update", action="store_true", help="Reinstall the latest harness package from the repository")
    subparsers = parser.add_subparsers(dest="command")

    doctor = subparsers.add_parser("doctor")
    doctor.add_argument("workspace", nargs="?", default=".")
    doctor.set_defaults(func=cmd_doctor)

    analyze = subparsers.add_parser("analyze")
    analyze.add_argument("workspace", nargs="?", default=".")
    analyze.set_defaults(func=cmd_analyze)

    generate = subparsers.add_parser("generate")
    generate.add_argument("workspace", nargs="?", default=".")
    generate.add_argument("--profile", choices=available_profiles(), default="core")
    mode = generate.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--apply", action="store_true")
    generate.set_defaults(func=cmd_generate)

    check_tools = subparsers.add_parser("check-tools")
    check_tools.add_argument("workspace", nargs="?", default=".")
    check_tools.set_defaults(func=cmd_check_tools)

    audit_cmd = subparsers.add_parser("audit")
    audit_cmd.add_argument("workspace", nargs="?", default=".")
    audit_cmd.set_defaults(func=cmd_audit)

    setup = subparsers.add_parser("setup")
    setup.add_argument("workspace", nargs="?", default=".")
    setup.add_argument("--profile", choices=available_profiles(), default="core")
    setup_mode = setup.add_mutually_exclusive_group()
    setup_mode.add_argument("--dry-run", action="store_true")
    setup_mode.add_argument("--apply", action="store_true")
    setup.add_argument("--serve", action="store_true")
    setup.add_argument("--port", type=int, default=8765)
    setup.add_argument("--host", default="127.0.0.1")
    setup.add_argument("--tools", default=None, help="comma-separated tool names, e.g. claude,codex")
    setup.add_argument("--non-interactive", action="store_true", dest="non_interactive")
    setup.add_argument("--json", action="store_true", help="Print setup result as JSON for automation")
    setup.set_defaults(func=cmd_setup)

    rollback = subparsers.add_parser("rollback")
    rollback.add_argument("workspace", nargs="?", default=".")
    rollback.set_defaults(func=cmd_rollback)

    # ── dashboard subcommand group ──────────────────────────────────────────
    dashboard_parser = subparsers.add_parser("dashboard", help="Agentic-OS dashboard management")
    dashboard_subs = dashboard_parser.add_subparsers(dest="dashboard_command", required=True)

    # harness dashboard install
    db_install = dashboard_subs.add_parser("install", help="Run install wizard and write dashboard.json")
    db_install.add_argument("workspace", nargs="?", default=".")
    db_install.add_argument("--non-interactive", action="store_true", dest="non_interactive")
    db_install.add_argument("--json", action="store_true", help="Print result as JSON")
    db_install.set_defaults(func=cmd_dashboard_install)

    # harness dashboard start
    db_start = dashboard_subs.add_parser("start", help="Start the dashboard (Next.js + daemon)")
    db_start.add_argument("workspace", nargs="?", default=".")
    db_start.add_argument("--port", type=int, default=None)
    db_start.add_argument("--host", default=None)
    db_start.add_argument("--no-wait", action="store_true", dest="no_wait",
                          help="Don't wait for the port to be ready")
    db_start.add_argument("--json", action="store_true", help="Print result as JSON")
    db_start.set_defaults(func=cmd_dashboard_start)

    # harness dashboard stop
    db_stop = dashboard_subs.add_parser("stop", help="Stop the dashboard")
    db_stop.add_argument("workspace", nargs="?", default=".")
    db_stop.add_argument("--json", action="store_true", help="Print result as JSON")
    db_stop.set_defaults(func=cmd_dashboard_stop)

    # harness dashboard status
    db_status = dashboard_subs.add_parser("status", help="Check dashboard status")
    db_status.add_argument("workspace", nargs="?", default=".")
    db_status.add_argument("--json", action="store_true", help="Print result as JSON")
    db_status.set_defaults(func=cmd_dashboard_status)

    # harness dashboard upgrade
    db_upgrade = dashboard_subs.add_parser("upgrade", help="Re-run wizard and restart dashboard")
    db_upgrade.add_argument("workspace", nargs="?", default=".")
    db_upgrade.add_argument("--non-interactive", action="store_true", dest="non_interactive")
    db_upgrade.add_argument("--json", action="store_true", help="Print result as JSON")
    db_upgrade.set_defaults(func=cmd_dashboard_upgrade)

    export = subparsers.add_parser("export")
    export.add_argument("workspace", nargs="?", default=".")
    export.add_argument("--format", choices=["json"], default="json")
    export.add_argument("--output")
    export.set_defaults(func=cmd_export)

    lint_cmd = subparsers.add_parser("lint", help="Check harness integrity")
    lint_cmd.add_argument("workspace", nargs="?", default=".")
    lint_cmd.set_defaults(func=cmd_lint)

    validate_cmd = subparsers.add_parser("validate", help="Validate workspace against quality rules")
    validate_cmd.add_argument("workspace", nargs="?", default=".")
    validate_cmd.set_defaults(func=cmd_validate)

    # Wiki commands
    wiki_parser = subparsers.add_parser("wiki", help="Wiki management commands")
    wiki_subparsers = wiki_parser.add_subparsers(dest="wiki_command", required=True)

    wiki_init_parser = wiki_subparsers.add_parser("init", help="Initialize wiki structure")
    wiki_init_parser.add_argument("workspace", nargs="?", default=".")
    wiki_init_parser.set_defaults(func=cmd_wiki_init)

    wiki_preflight_parser = wiki_subparsers.add_parser("preflight", help="Create wiki context receipt")
    wiki_preflight_parser.add_argument("workspace", nargs="?", default=".")
    wiki_preflight_parser.add_argument("--task", required=True, help="Task description")
    wiki_preflight_parser.add_argument("--mode", choices=["read", "maintenance"], default="read")
    wiki_preflight_parser.set_defaults(func=cmd_wiki_preflight)

    wiki_status_parser = wiki_subparsers.add_parser("status", help="Show wiki status")
    wiki_status_parser.add_argument("workspace", nargs="?", default=".")
    wiki_status_parser.set_defaults(func=cmd_wiki_status)

    wiki_lint_parser = wiki_subparsers.add_parser("lint", help="Validate wiki structure")
    wiki_lint_parser.add_argument("workspace", nargs="?", default=".")
    wiki_lint_parser.set_defaults(func=cmd_wiki_lint)

    wiki_search_parser = wiki_subparsers.add_parser("search", help="Search wiki pages")
    wiki_search_parser.add_argument("workspace", nargs="?", default=".")
    wiki_search_parser.add_argument("query", help="Search query")
    wiki_search_parser.add_argument("--limit", type=int, default=10)
    wiki_search_parser.set_defaults(func=cmd_wiki_search)

    wiki_semantic_lint_parser = wiki_subparsers.add_parser(
        "semantic-lint", help="Check for contradictions and redundancies"
    )
    wiki_semantic_lint_parser.add_argument("workspace", nargs="?", default=".")
    wiki_semantic_lint_parser.add_argument("--limit", type=int, default=10)
    wiki_semantic_lint_parser.add_argument(
        "--add-to-backlog", action="store_true", help="Add findings to maintenance backlog"
    )
    wiki_semantic_lint_parser.set_defaults(func=cmd_wiki_semantic_lint)

    wiki_extract_learnings_parser = wiki_subparsers.add_parser(
        "extract-learnings", help="Extract wiki candidates from activity logs"
    )
    wiki_extract_learnings_parser.add_argument("workspace", nargs="?", default=".")
    wiki_extract_learnings_parser.add_argument(
        "--hours", type=int, default=24, help="Hours of activity to analyze"
    )
    wiki_extract_learnings_parser.set_defaults(func=cmd_wiki_extract_learnings)

    wiki_pending_synthesis_parser = wiki_subparsers.add_parser(
        "pending-synthesis", help="Show pending synthesis candidates"
    )
    wiki_pending_synthesis_parser.add_argument("workspace", nargs="?", default=".")
    wiki_pending_synthesis_parser.set_defaults(func=cmd_wiki_pending_synthesis)

    wiki_build_skill_index_parser = wiki_subparsers.add_parser(
        "build-skill-index", help="Regenerate skill-index.md from SKILL.md files"
    )
    wiki_build_skill_index_parser.add_argument("workspace", nargs="?", default=".")
    wiki_build_skill_index_parser.set_defaults(func=cmd_wiki_build_skill_index)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.update:
        return cmd_update(args)
    if not hasattr(args, "func"):
        parser.print_help()
        return 2
    return int(args.func(args))  # type: ignore[arg-type]


if __name__ == "__main__":
    raise SystemExit(main())
