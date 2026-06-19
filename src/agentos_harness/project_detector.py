"""Project boundary detection and canonical project scaffolding."""

from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import List

BOUNDARY_SIGNALS = {
    "pyproject.toml",
    "setup.py",
    "package.json",
    "Cargo.toml",
    "go.mod",
    "Makefile",
    "README.md",
}

EXCLUDED_DIRS = {
    ".",
    "__pycache__",
    "node_modules",
    ".venv",
    "dist",
    "build",
    ".git",
    ".harness",
}

MAX_BOUNDARIES = 20


def detect_project_boundaries(root: Path) -> list[dict]:
    """Scan workspace root for potential project boundaries.

    Returns up to MAX_BOUNDARIES dicts with keys: path, signals, suggested_name.
    Only scans first-level subdirectories; excludes hidden dirs and generated dirs.
    """
    if not root.is_dir():
        return []

    results: list[dict] = []
    try:
        children = sorted(root.iterdir())
    except PermissionError:
        return []

    for child in children:
        if not child.is_dir():
            continue
        if child.name.startswith("."):
            continue
        if child.name in EXCLUDED_DIRS:
            continue
        if child.name == "projects":
            results.extend(_detect_managed_project_boundaries(root, child))
            if len(results) >= MAX_BOUNDARIES:
                break
            continue

        signals: list[str] = []
        try:
            for entry in sorted(child.iterdir()):
                if entry.name in BOUNDARY_SIGNALS:
                    signals.append(entry.name)
        except PermissionError:
            continue

        if signals:
            results.append({
                "path": child.relative_to(root).as_posix(),
                "signals": signals,
                "suggested_name": child.name,
            })
        if len(results) >= MAX_BOUNDARIES:
            break

    return results


def _detect_managed_project_boundaries(root: Path, projects_dir: Path) -> list[dict]:
    """Detect existing canonical projects under projects/<name>/."""
    results: list[dict] = []
    try:
        children = sorted(projects_dir.iterdir())
    except PermissionError:
        return results

    for child in children:
        if not child.is_dir() or child.name.startswith("."):
            continue
        signals: list[str] = []
        try:
            for entry in sorted(child.iterdir()):
                if entry.name in BOUNDARY_SIGNALS or entry.name in {"HANDOFF.md", "UPDATE.txt"}:
                    signals.append(entry.name)
        except PermissionError:
            continue
        if signals or (child / "internal").exists() or (child / "external").exists():
            rel = child.relative_to(root).as_posix()
            results.append({
                "path": rel,
                "source_path": rel,
                "signals": signals or ["projects/<name>"],
                "suggested_name": child.name,
            })
        if len(results) >= MAX_BOUNDARIES:
            break
    return results


def _normalize_name(raw: str) -> str:
    lower = raw.lower()
    hyphened = re.sub(r"[\s_]+", "-", lower)
    clean = re.sub(r"[^a-z0-9-]", "", hyphened)
    clean = re.sub(r"-{2,}", "-", clean).strip("-")
    return clean or "project"


def suggest_project_names(boundaries: list[dict]) -> list[dict]:
    """Return boundaries list with suggested_name normalized to lowercase-hyphenated form."""
    return [
        {**b, "suggested_name": _normalize_name(b.get("suggested_name", b.get("path", "")))}
        for b in boundaries
    ]


def confirm_projects_interactive(
    boundaries: list[dict],
    interactive: bool = True,
) -> list[dict]:
    """Return confirmed project boundaries.

    When interactive=False, returns all detected boundaries unchanged.
    When interactive=True, prompts user to select and optionally rename.
    """
    if not boundaries:
        return []
    if not interactive:
        return boundaries

    print("Detected project boundaries:")
    for i, b in enumerate(boundaries, 1):
        signals_str = ", ".join(b.get("signals", []))
        print(f"  {i}. {b['path']}  [{signals_str}]")

    raw_choice = input("\nInclude all detected projects? [Y/n/o] ").strip().lower()

    if raw_choice == "n":
        return []
    if raw_choice == "o":
        # Original interactive flow
        raw_selection = input(
            "Confirm projects to include (enter numbers separated by commas, 'all', or press Enter to skip): "
        ).strip()
        if not raw_selection:
            return []
        custom_names: dict[int, str] = {}
        if raw_selection.lower() == "all":
            selected_indices = list(range(len(boundaries)))
        else:
            indices: list[int] = []
            for part in raw_selection.split(","):
                part = part.strip()
                if ":" in part:
                    idx_str, name = part.split(":", 1)
                    try:
                        idx = int(idx_str.strip()) - 1
                        custom_names[idx] = name.strip()
                        indices.append(idx)
                    except ValueError:
                        pass
                else:
                    try:
                        indices.append(int(part) - 1)
                    except ValueError:
                        pass
            selected_indices = [i for i in indices if 0 <= i < len(boundaries)]

        confirmed: list[dict] = []
        for idx in selected_indices:
            b = dict(boundaries[idx])
            if idx in custom_names:
                b["suggested_name"] = _normalize_name(custom_names[idx])
            confirmed.append(b)
        return confirmed
    # Default to "Y"
    return boundaries


def plan_project_layout(projects: list[dict]) -> list[dict]:
    """Return confirmed projects mapped to canonical projects/<name>/ homes."""
    planned: list[dict] = []
    used_targets: set[str] = set()
    for project in projects:
        source_path = project.get("source_path") or project.get("path", "")
        project_name = _normalize_name(project.get("suggested_name") or Path(source_path).name)
        target_path = source_path if source_path.startswith("projects/") else f"projects/{project_name}"
        if target_path in used_targets:
            suffix = 2
            base = target_path
            while f"{base}-{suffix}" in used_targets:
                suffix += 1
            target_path = f"{base}-{suffix}"
        used_targets.add(target_path)
        planned.append({
            **project,
            "source_path": source_path,
            "path": target_path,
            "suggested_name": project_name,
            "layout": "canonical-project",
            "move_required": source_path != target_path,
        })
    return planned


def render_handoff_template(project_name: str, project_path: str) -> str:
    """Return a HANDOFF.md template string for the given project.

    DEPRECATED: Use render_update_template instead.
    """
    return render_update_template(project_name, project_path)


def render_update_template(project_name: str, project_path: str) -> str:
    """Return a PROJECT-NAME_UPDATE.md template string for the given project.

    The _UPDATE.md suffix is a pattern that agents can detect programmatically.
    """
    title = project_name.replace("-", " ").title()
    upper_name = project_name.upper().replace("-", "_")
    return f"""# {title}

## Summary

<What this project does and why it exists.>

## Current State

<What's done, what's in progress, what's blocked.>

## Project Structure

| Path | Purpose |
|------|---------|
| plans/active/ | In-progress work plans |
| plans/completed/ | Finished work plans |

<Updated by agents as folders are created.>

## Active Plans

None.

## Read Order

1. This file ({upper_name}_UPDATE.md)
2. plans/active/*.md (if any exist)

## Routing Rules

- Work plans go in plans/
- <Add project-specific routing as needed>

## Validation

<Commands to verify project state, e.g.:>
```bash
# Example: run tests
# pytest {project_path}/tests/
```
"""


def render_handoff(project_name: str, project_path: str) -> str:
    """Return a canonical project HANDOFF.md template."""
    title = project_name.replace("-", " ").title()
    return f"""Audience: agent-facing operating brief for project resumption, routing, and execution.
Project posture: `infrastructure`

# {title} Handoff

## Summary

<What this project owns and why it exists.>

## Current Authority

- `HANDOFF.md`: agent-facing operating brief.
- `UPDATE.txt`: human-facing status log.

## Read Order

1. Root `AGENTS.md`
2. Root assistant supplement for the active agent
3. `.claude/wiki/index.md`
4. This `HANDOFF.md`
5. `UPDATE.txt`
6. Active plans under `internal/plans/active/`
7. Project-owned source and delivery surfaces

## Directory Contract

| Path | Purpose |
|---|---|
| `internal/` | Project-local plans, scripts, resources, state, and working artifacts |
| `internal/plans/active/` | Active implementation plans |
| `internal/plans/completed/` | Completed implementation plans |
| `external/` | Curated colleague-facing deliverables only |

## Routing Rules

- Start project work from `{project_path}/`.
- Keep project-local execution material under `internal/`.
- Keep only curated deliverables under `external/`.
- Update `HANDOFF.md` and `UPDATE.txt` when durable project context changes.
"""


def render_update_log(project_name: str) -> str:
    """Return a canonical project UPDATE.txt template."""
    title = project_name.replace("-", " ").title()
    return f"""Audience: human-facing project status log.

# {title} Update

## Summary

<Plain-language project status.>

## Status History

- <YYYY-MM-DD>: Project workspace initialized by agentos-harness setup.
"""


def get_update_filename(project_name: str) -> str:
    """Return the _UPDATE.md filename for a project.

    Example: 'my-project' -> 'MY_PROJECT_UPDATE.md'
    """
    upper_name = project_name.upper().replace("-", "_")
    return f"{upper_name}_UPDATE.md"


def apply_project_layout(root: Path, project: dict) -> dict:
    """Move a project to its canonical path when the reviewed layout requires it."""
    source_rel = project.get("source_path") or project["path"]
    target_rel = project["path"]
    source = (root / source_rel).resolve()
    target = (root / target_rel).resolve()
    try:
        source.relative_to(root.resolve())
        target.relative_to(root.resolve())
    except ValueError:
        return {"action": "error", "source_path": source_rel, "path": target_rel, "errors": ["project path escapes workspace"]}

    if source == target:
        return {"action": "skip", "source_path": source_rel, "path": target_rel, "errors": []}
    if not source.exists():
        return {"action": "error", "source_path": source_rel, "path": target_rel, "errors": [f"source project does not exist: {source_rel}"]}
    if target.exists():
        return {"action": "error", "source_path": source_rel, "path": target_rel, "errors": [f"target project already exists: {target_rel}"]}
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        source.rename(target)
    except OSError as exc:
        fallback = _copy_project_layout_source(source, target, source_rel, target_rel, exc)
        if fallback["errors"]:
            return fallback
        return fallback
    return {"action": "move", "source_path": source_rel, "path": target_rel, "errors": [], "warnings": []}


def _copy_project_layout_source(source: Path, target: Path, source_rel: str, target_rel: str, move_error: OSError) -> dict:
    """Copy a project when Windows refuses an atomic directory rename."""
    try:
        shutil.copytree(source, target, symlinks=True)
    except OSError as copy_error:
        if target.exists():
            shutil.rmtree(target, ignore_errors=True)
        return {
            "action": "error",
            "source_path": source_rel,
            "path": target_rel,
            "errors": [f"failed to move project: {move_error}; copy fallback also failed: {copy_error}"],
            "warnings": [],
        }

    try:
        shutil.rmtree(source)
    except OSError as cleanup_error:
        return {
            "action": "copy",
            "source_path": source_rel,
            "path": target_rel,
            "errors": [],
            "warnings": [
                f"renamed copy into canonical path after move failed: {move_error}",
                f"original source retained because cleanup failed: {cleanup_error}",
            ],
        }

    return {
        "action": "move",
        "source_path": source_rel,
        "path": target_rel,
        "errors": [],
        "warnings": [f"used copy fallback after move failed: {move_error}"],
    }


def scaffold_project(root: Path, project: dict) -> dict:
    """Create canonical project scaffold files and directories.

    Args:
        root: Workspace root path
        project: Dict with path and suggested_name keys

    Returns:
        Dict with created_files list and any errors
    """
    project_path = root / project["path"]
    project_name = project.get("suggested_name", project["path"])

    created_files = []
    errors = []

    file_templates = {
        "HANDOFF.md": render_handoff(project_name, project["path"]),
        "UPDATE.txt": render_update_log(project_name),
    }
    for filename, content in file_templates.items():
        target = project_path / filename
        if target.exists():
            continue
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
            created_files.append(str(target.relative_to(root)))
        except OSError as e:
            errors.append(f"Failed to create {filename}: {e}")

    for rel_dir in (
        "internal/plans/active",
        "internal/plans/completed",
        "internal/resources",
        "internal/state",
        "external",
    ):
        directory = project_path / rel_dir
        try:
            directory.mkdir(parents=True, exist_ok=True)
            gitkeep = directory / ".gitkeep"
            if not gitkeep.exists():
                gitkeep.touch()
                created_files.append(str(gitkeep.relative_to(root)))
        except OSError as e:
            errors.append(f"Failed to create {rel_dir}/: {e}")

    return {
        "project": project_name,
        "path": project["path"],
        "source_path": project.get("source_path", project["path"]),
        "handoff_file": "HANDOFF.md",
        "update_file": "UPDATE.txt",
        "created_files": created_files,
        "errors": errors,
    }


def render_agents_project_table(confirmed: list[dict]) -> str:
    """Return a markdown table of confirmed projects for AGENTS.md.

    Columns: Project | Home | Posture.
    """
    header = "| Project | Home | Posture |\n|---------|------|---------|"
    if not confirmed:
        return f"{header}\n| (none detected) | N/A | N/A |"

    rows = [header]
    for b in confirmed:
        name = b.get("suggested_name", b.get("path", "<project>"))
        path = b.get("path", "<path>")
        rows.append(f"| {name} | `{path}/` | active |")
    return "\n".join(rows)
