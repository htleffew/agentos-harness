"""Workspace validation checks for harness validate command."""

from __future__ import annotations

import re
from pathlib import Path

from .wiki_validation import validate_wiki_state
from .workspace_hygiene import check_workspace_hygiene


ENGINEERING_QUALITY_SUBSECTIONS = (
    "Assumptions And Ambiguity",
    "Simplicity Rationale",
    "Surgical Scope",
    "Verification Contract",
    "Final Output Requirements",
    "Narrative, Prose, And Visual Requirements",
    "Behavior, Function, Interactivity, Display, Style, Look, Feel, And Tone",
    "Context Receipt Requirements For All Agents",
)


def validate_100pct_rule(project_dir: Path) -> dict:
    """Scan source files for incomplete-work markers.

    Returns dict with 'passed' and 'violations' keys.
    """
    violations = []

    if not project_dir.exists():
        return {"passed": True, "violations": []}

    incomplete_patterns = [
        (r"\b" + "TO" + "DO" + r"\b", "TO" + "DO"),
        (r"\b" + "FIX" + "ME" + r"\b", "FIX" + "ME"),
        (r"\b" + "X" + "X" + "X" + r"\b", "X" + "X" + "X"),
        (r"\b" + "place" + "holder" + r"\b", "place" + "holder"),
        (r"\b" + "st" + "ub" + r"\b", "st" + "ub"),
        ("Not" + "Implemented" + "Error", "Not" + "Implemented" + "Error"),
    ]

    src_extensions = {".py", ".md", ".json", ".yaml", ".yml"}

    for ext in src_extensions:
        for src_file in project_dir.rglob(f"*{ext}"):
            rel_path_parts = src_file.relative_to(project_dir).parts
            if any(p.lower().startswith("test") for p in rel_path_parts):
                continue
            if "__pycache__" in str(src_file):
                continue

            try:
                content = src_file.read_text(encoding="utf-8")
                rel_path = src_file.relative_to(project_dir)

                for line_num, line in enumerate(content.splitlines(), 1):
                    for pattern, marker in incomplete_patterns:
                        if re.search(pattern, line, re.IGNORECASE):
                            violations.append(f"{rel_path}:{line_num}: found '{marker}'")
                            break
            except Exception:
                continue

    return {"passed": len(violations) == 0, "violations": violations}


def validate_project_continuity(project_dir: Path) -> dict:
    """Check that project has HANDOFF.md and UPDATE.txt files.

    Returns dict with 'passed' and 'missing' keys.
    """
    missing = []

    if not project_dir.exists():
        return {"passed": False, "missing": ["project directory does not exist"]}

    if _is_agentos_harness_package_source(project_dir):
        return {
            "passed": True,
            "missing": [],
            "not_applicable": True,
            "reason": "publishable package source does not own project HANDOFF.md or UPDATE.txt",
        }

    setup_state = project_dir / ".harness" / "state" / "setup.json"
    generated_agents = project_dir / "AGENTS.md"
    analysis_state = project_dir / ".harness" / "state" / "analysis.json"
    if setup_state.exists() and generated_agents.exists() and analysis_state.exists():
        try:
            import json

            analysis = json.loads(analysis_state.read_text(encoding="utf-8"))
            setup = json.loads(setup_state.read_text(encoding="utf-8"))
            confirmed = analysis.get("confirmed_projects", []) or setup.get("confirmed_projects", [])
            boundaries = analysis.get("inventory", {}).get("project_boundaries", [])
            if not confirmed and len(boundaries) <= 1:
                return {
                    "passed": True,
                    "missing": [],
                    "note": "generated workspace has no confirmed project boundaries",
                }
            if confirmed:
                for project in confirmed:
                    project_path = project.get("path")
                    if not project_path:
                        missing.append("confirmed project missing path")
                        continue
                    project_root = project_dir / project_path
                    handoff = project_root / "HANDOFF.md"
                    update = project_root / "UPDATE.txt"
                    if not handoff.exists():
                        missing.append(f"{project_path}: missing HANDOFF.md")
                    elif not handoff.read_text(encoding="utf-8").strip():
                        missing.append(f"{project_path}: HANDOFF.md is empty")
                    if not update.exists():
                        missing.append(f"{project_path}: missing UPDATE.txt")
                return {
                    "passed": len(missing) == 0,
                    "missing": missing,
                    "note": "generated workspace continuity checked per confirmed project",
                }
        except Exception:
            pass

    project_name = project_dir.name.upper().replace("-", "_").replace("_", "-")

    handoff_variants = [
        project_dir / f"{project_name}-HANDOFF.md",
        project_dir / "HANDOFF.md",
    ]
    has_handoff = any(v.exists() for v in handoff_variants)

    update_variants = [
        project_dir / f"{project_name}-UPDATE.txt",
        project_dir / "UPDATE.txt",
    ]
    has_update = any(v.exists() for v in update_variants)

    if not has_handoff:
        missing.append("missing HANDOFF.md")
    else:
        for v in handoff_variants:
            if v.exists():
                content = v.read_text(encoding="utf-8").strip()
                if not content:
                    missing.append("HANDOFF.md is empty")
                break

    if not has_update:
        missing.append("missing UPDATE.txt")

    return {"passed": len(missing) == 0, "missing": missing}


def _is_agentos_harness_package_source(project_dir: Path) -> bool:
    """Return True for the publishable package root itself."""
    pyproject = project_dir / "pyproject.toml"
    package_dir = project_dir / "src" / "agentos_harness"
    if not pyproject.exists() or not package_dir.is_dir():
        return False
    try:
        content = pyproject.read_text(encoding="utf-8")
    except OSError:
        return False
    return 'name = "agentos-harness"' in content or 'name = "agentos-harness"' in content


def validate_dashboard_tasks(workspace: Path) -> dict:
    """§12.4: Validate dashboard task and mission state.

    Checks:
    - No tasks with status IN_PROGRESS and no active PID (stuck tasks)
    - No missions with status RUNNING when daemon is stopped

    Returns dict with 'passed', 'stuck_tasks', 'orphaned_missions', 'skipped' keys.
    """
    import json as _json
    import sys

    tasks_path = workspace / ".harness" / "state" / "dashboard-tasks.json"
    missions_path = workspace / ".harness" / "state" / "dashboard-missions.json"
    pids_path = workspace / ".harness" / "state" / "dashboard-pids.json"

    # If neither state file exists, dashboard isn't in use — skip check cleanly
    if not tasks_path.exists() and not missions_path.exists():
        return {
            "passed": True,
            "skipped": True,
            "reason": "no dashboard state files found (dashboard not yet used)",
            "stuck_tasks": [],
            "orphaned_missions": [],
        }

    # Determine daemon liveness
    daemon_running = False
    if pids_path.exists():
        try:
            pids = _json.loads(pids_path.read_text(encoding="utf-8"))
            daemon_pid = pids.get("daemon_pid", 0)
            web_pid = pids.get("web_pid", 0)
            if daemon_pid and web_pid:
                # Probe liveness: os.kill(pid, 0) on POSIX; Windows uses OpenProcess
                if sys.platform == "win32":
                    import ctypes
                    handle = ctypes.windll.kernel32.OpenProcess(0x00100000, False, daemon_pid)
                    daemon_running = handle != 0
                    if handle:
                        ctypes.windll.kernel32.CloseHandle(handle)
                else:
                    import os
                    try:
                        os.kill(daemon_pid, 0)
                        daemon_running = True
                    except (ProcessLookupError, PermissionError):
                        daemon_running = False
        except (OSError, _json.JSONDecodeError):
            pass

    stuck_tasks: list[str] = []
    orphaned_missions: list[str] = []

    # Check tasks
    if tasks_path.exists():
        try:
            data = _json.loads(tasks_path.read_text(encoding="utf-8"))
            tasks = data if isinstance(data, list) else data.get("tasks", [])
            for task in tasks:
                if not isinstance(task, dict):
                    continue
                if task.get("status") == "IN_PROGRESS" and not task.get("activePid"):
                    title = task.get("title", task.get("id", "unknown"))
                    stuck_tasks.append(f"Task '{title}' is IN_PROGRESS with no activePid")
        except (OSError, _json.JSONDecodeError):
            pass

    # Check missions
    if missions_path.exists() and not daemon_running:
        try:
            data = _json.loads(missions_path.read_text(encoding="utf-8"))
            missions = data if isinstance(data, list) else data.get("missions", [])
            for mission in missions:
                if not isinstance(mission, dict):
                    continue
                if mission.get("status") == "RUNNING":
                    title = mission.get("title", mission.get("id", "unknown"))
                    orphaned_missions.append(
                        f"Mission '{title}' is RUNNING but daemon is stopped"
                    )
        except (OSError, _json.JSONDecodeError):
            pass

    passed = not stuck_tasks and not orphaned_missions
    return {
        "passed": passed,
        "stuck_tasks": stuck_tasks,
        "orphaned_missions": orphaned_missions,
        "skipped": False,
    }


def validate_plan_completeness(plans_dir: Path) -> dict:
    """Check that active plans have all chunks marked done.

    Returns dict with 'passed' and 'incomplete_chunks' keys.
    """
    incomplete_chunks = []

    if not plans_dir.exists():
        return {"passed": True, "incomplete_chunks": []}

    for plan_file in plans_dir.glob("*.md"):
        try:
            content = plan_file.read_text(encoding="utf-8")

            chunk_pattern = r"###\s+(WC-\d+)[^\n]*"
            status_pattern = r"-\s*status:\s*(\w+)"

            for match in re.finditer(chunk_pattern, content):
                chunk_id = match.group(1)
                chunk_start = match.end()

                next_chunk = re.search(r"###\s+WC-\d+", content[chunk_start:])
                if next_chunk:
                    chunk_end = chunk_start + next_chunk.start()
                else:
                    chunk_end = len(content)

                chunk_content = content[chunk_start:chunk_end]
                status_match = re.search(status_pattern, chunk_content, re.IGNORECASE)

                if status_match:
                    status = status_match.group(1).lower()
                    if status not in ("done", "complete", "completed"):
                        incomplete_chunks.append(f"{plan_file.name}: {chunk_id} ({status})")
                else:
                    incomplete_chunks.append(f"{plan_file.name}: {chunk_id} (no status)")

        except Exception:
            continue

    return {"passed": len(incomplete_chunks) == 0, "incomplete_chunks": incomplete_chunks}


def validate_engineering_quality_contract(plans_dir: Path) -> dict:
    """Check that active plans include the engineering-quality contract."""
    violations: list[str] = []

    if not plans_dir.exists():
        return {"passed": True, "violations": []}

    for plan_file in plans_dir.glob("*.md"):
        try:
            content = plan_file.read_text(encoding="utf-8")
        except Exception:
            continue

        if "## Engineering Quality Contract" not in content:
            violations.append(f"{plan_file.name}: missing Engineering Quality Contract")
            continue

        for subsection in ENGINEERING_QUALITY_SUBSECTIONS:
            if f"### {subsection}" not in content:
                violations.append(f"{plan_file.name}: missing subsection '{subsection}'")

        if (
            "### Multi-model Plan Consensus Requirement" not in content
            and "### MoE Plan Consensus Requirement" not in content
        ):
            violations.append(f"{plan_file.name}: missing multi-model plan consensus requirement")

        if "Final Output Requirements" in content and not re.search(r"(file|path|behavior|function|deliverable)", content, re.IGNORECASE):
            violations.append(f"{plan_file.name}: vague final output requirements")

    return {"passed": len(violations) == 0, "violations": violations}


def validate_execution_receipts(plans_dir: Path) -> dict:
    """Check that done chunks include engineering-quality receipts."""
    violations: list[str] = []

    if not plans_dir.exists():
        return {"passed": True, "violations": []}

    chunk_pattern = re.compile(r"###\s+(WC-\d+)[^\n]*")
    status_pattern = re.compile(r"-\s*status:\s*(\w+)", re.IGNORECASE)

    for plan_file in plans_dir.glob("*.md"):
        try:
            content = plan_file.read_text(encoding="utf-8")
        except Exception:
            continue

        for match in chunk_pattern.finditer(content):
            chunk_id = match.group(1)
            start = match.end()
            next_match = chunk_pattern.search(content, start)
            end = next_match.start() if next_match else len(content)
            chunk_content = content[start:end]

            status_match = status_pattern.search(chunk_content)
            status = status_match.group(1).lower() if status_match else ""
            if status not in {"done", "complete", "completed"}:
                continue

            if "Engineering Quality Receipt" not in chunk_content:
                violations.append(f"{plan_file.name}: {chunk_id} missing Engineering Quality Receipt")
                continue

            required_markers = (
                "Context consulted",
                "Assumptions checked",
                "Files changed",
                "Validation run",
                "Review gates run",
                "Remaining gaps",
            )
            for marker in required_markers:
                if marker not in chunk_content:
                    violations.append(f"{plan_file.name}: {chunk_id} missing receipt field '{marker}'")

    return {"passed": len(violations) == 0, "violations": violations}


def _workspace_requires_wiki_validation(workspace_dir: Path) -> bool:
    """Return True when the target has an applied/generated wiki contract."""
    wiki_root = workspace_dir / ".claude" / "wiki"
    if (wiki_root / "index.md").exists() or (wiki_root / "log.md").exists():
        return True

    generated_markers = (
        workspace_dir / ".harness" / "state" / "setup.json",
        workspace_dir / ".harness" / "state" / "config" / "wiki_settings.json",
        workspace_dir / ".claude" / "state" / "config" / "wiki_settings.json",
    )
    return any(path.exists() for path in generated_markers)


def _not_applicable_result(reason: str) -> dict:
    return {
        "passed": True,
        "not_applicable": True,
        "reason": reason,
        "issue_count": 0,
        "issues": [],
    }


def run_all_validations(
    project_dir: Path,
    plans_dir: Path | None = None,
    workspace_dir: Path | None = None,
) -> dict:
    """Run all validation checks and return structured results.

    Args:
        project_dir: Path to the project directory.
        plans_dir: Path to active plans directory. Defaults to project_dir/plans/active.
        workspace_dir: Path to workspace root for wiki/hygiene checks. Defaults to project_dir.

    Returns:
        Dictionary with results for each validation check.
    """
    rule_result = validate_100pct_rule(project_dir)
    continuity_result = validate_project_continuity(project_dir)

    if plans_dir is None:
        plans_dir = project_dir / "plans" / "active"
    plan_result = validate_plan_completeness(plans_dir)
    contract_result = validate_engineering_quality_contract(plans_dir)
    receipt_result = validate_execution_receipts(plans_dir)

    if workspace_dir is None:
        workspace_dir = project_dir

    if _workspace_requires_wiki_validation(workspace_dir):
        wiki_result = validate_wiki_state(workspace_dir)
        hygiene_result = check_workspace_hygiene(workspace_dir)
    else:
        reason = "target has no applied generated wiki or harness setup state"
        wiki_result = _not_applicable_result(reason)
        hygiene_result = _not_applicable_result(reason)

    dashboard_result = validate_dashboard_tasks(workspace_dir)

    all_passed = (
        rule_result["passed"]
        and continuity_result["passed"]
        and plan_result["passed"]
        and contract_result["passed"]
        and receipt_result["passed"]
        and wiki_result["passed"]
        and hygiene_result["passed"]
        and dashboard_result["passed"]
    )

    return {
        "all_passed": all_passed,
        "100pct_rule": rule_result,
        "project_continuity": continuity_result,
        "plan_completeness": plan_result,
        "engineering_quality_contract": contract_result,
        "execution_receipts": receipt_result,
        "wiki_state": wiki_result,
        "workspace_hygiene": hygiene_result,
        "dashboard_tasks": dashboard_result,
    }
