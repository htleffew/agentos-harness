"""Workspace hygiene checks for harness validate command."""

from __future__ import annotations

import json
from pathlib import Path

from .wiki import wiki_lint, wiki_maintain_status
from .wiki_validation import validate_wiki_state


def _load_skill_registry(workspace: Path) -> list[dict]:
    """Load skills.json registry from workspace.

    Note: skills.json is optional and deprecated for runtime discovery.
    Claude Code native progressive disclosure reads SKILL.md frontmatter
    directly. This function is retained for build-time validation only.
    """
    paths = [
        workspace / ".harness" / "skills.json",
        workspace / ".claude" / "skills.json",
    ]
    for path in paths:
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and "skills" in data:
                return data["skills"]
            if isinstance(data, list):
                return data
    return []


def get_native_skill_count(workspace: Path) -> int:
    """Count SKILL.md files directly without requiring skills.json.

    Claude Code native progressive disclosure reads SKILL.md frontmatter
    at startup. This function provides a registry-independent skill count.
    """
    skill_dirs = [
        workspace / ".harness" / "skills",
        workspace / ".claude" / "skills",
    ]
    count = 0
    for skill_dir in skill_dirs:
        if skill_dir.exists():
            for skill_folder in skill_dir.iterdir():
                if skill_folder.is_dir():
                    skill_md = skill_folder / "SKILL.md"
                    if skill_md.exists():
                        count += 1
    return count


def check_workspace_hygiene(workspace: Path) -> dict:
    """Run comprehensive workspace health check.

    Combines wiki lint, skill compliance, hook registration, validation
    checks, and pending maintenance count.

    Args:
        workspace: Root path of the workspace.

    Returns:
        Dictionary with hygiene results:
        - passed: bool
        - issue_count: int
        - issues: list[str]
        - wiki_lint_issues: list[str]
        - skill_compliance: dict with passed, issues
        - hook_status: dict with registered, missing
        - wiki_state: dict from validate_wiki_state
        - maintenance_status: dict from wiki_maintain_status
    """
    issues: list[str] = []

    wiki_lint_issues = wiki_lint(workspace)
    for issue in wiki_lint_issues:
        issues.append(f"wiki lint: {issue}")

    skill_result = _check_skill_compliance(workspace)
    issues.extend(skill_result["issues"])

    hook_result = _check_hook_registration(workspace)
    issues.extend(hook_result["issues"])

    wiki_state = validate_wiki_state(workspace)
    for issue in wiki_state["issues"]:
        if not issue.startswith("wiki lint:"):
            issues.append(issue)

    try:
        maintenance_status = wiki_maintain_status(workspace)
    except Exception:
        maintenance_status = {"counts": {"pending": 0}, "pending_items": []}

    return {
        "passed": len(issues) == 0,
        "issue_count": len(issues),
        "issues": issues,
        "wiki_lint_issues": wiki_lint_issues,
        "skill_compliance": skill_result,
        "hook_status": hook_result,
        "wiki_state": wiki_state,
        "maintenance_status": maintenance_status,
    }


def _check_skill_compliance(workspace: Path) -> dict:
    """Check that all registered skills have valid structure.

    Note: skills.json is optional. Claude Code native progressive disclosure
    reads SKILL.md frontmatter directly at startup. When skills.json is absent,
    validation falls back to counting SKILL.md files directly.
    """
    issues: list[str] = []

    skills_json_paths = [
        workspace / ".harness" / "skills.json",
        workspace / ".claude" / "skills.json",
    ]
    skills_json = None
    for path in skills_json_paths:
        if path.exists():
            skills_json = path
            break

    if skills_json is None:
        native_count = get_native_skill_count(workspace)
        return {
            "passed": True,
            "issues": [],
            "registered_skills": [],
            "native_skill_count": native_count,
            "note": "skills.json absent; using native SKILL.md discovery",
        }

    try:
        registry = _load_skill_registry(workspace)
    except Exception as e:
        return {
            "passed": False,
            "issues": [f"skill registry: invalid JSON ({e})"],
            "registered_skills": [],
        }

    registered_skills: list[str] = []
    for skill_entry in registry:
        name = skill_entry.get("name", "")
        path_str = skill_entry.get("path", "")
        registered_skills.append(name)

        if not path_str:
            issues.append(f"skill '{name}': missing path")
            continue

        if path_str.startswith("bundled:") or path_str.startswith("system:"):
            continue

        if path_str.startswith("projectSettings:"):
            skill_name = path_str.replace("projectSettings:", "")
            skill_dir_paths = [
                workspace / ".harness" / "skills" / skill_name,
                workspace / ".claude" / "skills" / skill_name,
            ]
            skill_dir = None
            for d in skill_dir_paths:
                if d.exists():
                    skill_dir = d
                    break

            if skill_dir is None:
                issues.append(f"skill '{name}': missing skill directory")
                continue

            skill_md = skill_dir / "SKILL.md"
            if not skill_md.exists():
                issues.append(f"skill '{name}': missing SKILL.md")

    return {
        "passed": len(issues) == 0,
        "issues": issues,
        "registered_skills": registered_skills,
    }


def _check_hook_registration(workspace: Path) -> dict:
    """Check that hook files are properly registered."""
    issues: list[str] = []
    registered: list[str] = []
    missing: list[str] = []

    settings_paths = [
        workspace / ".harness" / "settings.json",
        workspace / ".claude" / "settings.json",
    ]
    settings_content = None
    for path in settings_paths:
        if path.exists():
            try:
                import json
                settings_content = json.loads(path.read_text(encoding="utf-8"))
                break
            except Exception:
                pass

    hook_dirs = [
        workspace / ".harness" / "hooks" / "pre",
        workspace / ".harness" / "hooks" / "post",
        workspace / ".claude" / "hooks" / "pre",
        workspace / ".claude" / "hooks" / "post",
    ]

    hook_files: list[Path] = []
    for hook_dir in hook_dirs:
        if hook_dir.exists():
            hook_files.extend(hook_dir.glob("*.py"))

    if settings_content is None:
        if hook_files:
            for hf in hook_files:
                missing.append(str(hf.name))
                issues.append(f"hook '{hf.name}': no settings.json to register in")
        return {
            "passed": len(issues) == 0,
            "issues": issues,
            "registered": registered,
            "missing": missing,
        }

    hooks_config = settings_content.get("hooks", {})
    hook_groups = []
    for key in ("preToolUse", "postToolUse", "PreToolUse", "PostToolUse", "SessionStart"):
        value = hooks_config.get(key, [])
        if isinstance(value, list):
            hook_groups.extend(value)

    all_registered_cmds: list[str] = []
    for hook_entry in hook_groups:
        if not isinstance(hook_entry, dict):
            continue
        cmd = hook_entry.get("command", "")
        if isinstance(cmd, str) and cmd:
            all_registered_cmds.append(cmd)
        nested_hooks = hook_entry.get("hooks", [])
        if isinstance(nested_hooks, list):
            for nested in nested_hooks:
                if isinstance(nested, dict):
                    nested_cmd = nested.get("command", "")
                    if isinstance(nested_cmd, str) and nested_cmd:
                        all_registered_cmds.append(nested_cmd)

    for hf in hook_files:
        hook_name = hf.name
        found = False
        for cmd in all_registered_cmds:
            if hook_name in cmd:
                found = True
                registered.append(hook_name)
                break
        if not found:
            missing.append(hook_name)
            issues.append(f"hook '{hook_name}': present but not registered in settings.json")

    return {
        "passed": len(issues) == 0,
        "issues": issues,
        "registered": registered,
        "missing": missing,
    }
