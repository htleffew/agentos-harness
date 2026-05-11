"""Deterministic workspace analyzer."""

from __future__ import annotations

import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from .config import ANALYSIS_FILE, ensure_state_dir, resolve_workspace, state_file
from .models import content_hash, write_json
from .tool_check import detect_tools, moe_tier
from .project_detector import detect_project_boundaries, suggest_project_names

SKIP_DIRS = {
    ".git",
    ".hg",
    ".svn",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".tox",
    ".venv",
    "__pycache__",
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".next",
    ".nuxt",
    ".astro",
    ".harness",
    "output",
    "site",
}

TEXT_SUFFIXES = {
    ".cfg",
    ".css",
    ".html",
    ".ini",
    ".js",
    ".json",
    ".jsx",
    ".md",
    ".mjs",
    ".py",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".yaml",
    ".yml",
}

LANGUAGE_SUFFIXES = {
    ".py": "Python",
    ".js": "JavaScript",
    ".mjs": "JavaScript",
    ".jsx": "JavaScript",
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".go": "Go",
    ".rs": "Rust",
    ".java": "Java",
    ".ipynb": "Notebook",
}


def _relative(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


def _iter_files(root: Path) -> Iterable[Path]:
    for current, dirnames, filenames in os.walk(root):
        current_path = Path(current)
        dirnames[:] = sorted(
            item
            for item in dirnames
            if item not in SKIP_DIRS and not item.endswith(".egg-info")
        )
        for filename in sorted(filenames):
            path = current_path / filename
            try:
                if path.stat().st_size > 2_000_000:
                    continue
            except OSError:
                continue
            yield path


def _read_text(path: Path) -> str:
    if path.suffix.lower() not in TEXT_SUFFIXES:
        return ""
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return ""


def _git_value(root: Path, args: list[str]) -> str | None:
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=root,
            check=False,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=3,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip()


def _package_scripts(path: Path) -> list[str]:
    text = _read_text(path)
    scripts: list[str] = []
    for name in ("test", "build", "lint", "dev"):
        if f'"{name}"' in text:
            scripts.append(name)
    return scripts


def analyze_workspace(workspace: str | Path, *, write_state: bool = True) -> dict:
    root = resolve_workspace(workspace)
    files = list(_iter_files(root))
    rel_files = [_relative(root, path) for path in files]

    languages = sorted(
        {
            LANGUAGE_SUFFIXES[path.suffix.lower()]
            for path in files
            if path.suffix.lower() in LANGUAGE_SUFFIXES
        }
    )
    package_managers: set[str] = set()
    test_commands: set[str] = set()
    build_commands: set[str] = set()
    scripts: set[str] = set()

    for path in files:
        rel = _relative(root, path)
        name = path.name
        if name == "pyproject.toml":
            package_managers.add("python")
            test_commands.add("python -m pytest")
        elif name == "requirements.txt":
            package_managers.add("pip")
        elif name == "package.json":
            package_managers.add("npm")
            script_names = _package_scripts(path)
            if "test" in script_names:
                test_commands.add("npm test")
            if "build" in script_names:
                build_commands.add("npm run build")
        elif name == "pnpm-lock.yaml":
            package_managers.add("pnpm")
        elif name == "yarn.lock":
            package_managers.add("yarn")
        elif name == "Makefile":
            scripts.add(rel)

    docs = sorted(rel for rel in rel_files if Path(rel).name.lower() in {"readme.md", "docs.md"} or rel.startswith("docs/"))
    agent_files = sorted(
        rel
        for rel in rel_files
        if rel in {"AGENTS.md", "CLAUDE.md", "CODEX.md"}
        or rel.startswith(".claude/")
        or rel.startswith(".codex/")
    )
    ci_files = sorted(
        rel
        for rel in rel_files
        if rel.startswith(".github/workflows/")
        or rel in {".gitlab-ci.yml", "Jenkinsfile", "azure-pipelines.yml"}
    )
    notebooks = sorted(rel for rel in rel_files if rel.endswith(".ipynb"))
    source_dirs = sorted(
        {
            rel.split("/src/")[0] + "/src" if "/src/" in rel else "src"
            for rel in rel_files
            if rel == "src" or rel.startswith("src/") or "/src/" in rel
        }
    )
    project_boundaries = sorted(
        str(Path(rel).parent).replace(".", "")
        for rel in rel_files
        if Path(rel).name in {"pyproject.toml", "package.json"}
    )
    project_boundaries = sorted({item or "." for item in project_boundaries})
    publication_dirs = sorted(
        {
            rel.split("/")[0]
            for rel in rel_files
            if rel.startswith(("docs/", "external/", "site/"))
        }
    )
    generated_dirs = sorted(
        name
        for name in (".harness", ".claude/wiki", "dist", "build", "output")
        if (root / name).exists()
    )

    branch = _git_value(root, ["rev-parse", "--abbrev-ref", "HEAD"])
    dirty = _git_value(root, ["status", "--porcelain"])
    has_git = branch is not None

    detected_tools = detect_tools()
    moe_tier_value = moe_tier(detected_tools)
    raw_boundaries = detect_project_boundaries(root)
    suggested_projects = suggest_project_names(raw_boundaries)

    analysis = {
        "schema_version": "1.0",
        "workspace": {
            "root": str(root),
            "display_name": root.name,
            "git_branch": branch or None,
            "git_dirty": bool(dirty),
            "scanned_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "has_git": has_git,
        },
        "inventory": {
            "file_count": len(rel_files),
            "languages": languages,
            "package_managers": sorted(package_managers),
            "test_commands": sorted(test_commands),
            "build_commands": sorted(build_commands),
            "docs": docs,
            "agent_files": agent_files,
            "ci_files": ci_files,
            "notebooks": notebooks,
            "source_dirs": source_dirs,
            "project_boundaries": project_boundaries,
            "publication_dirs": publication_dirs,
            "generated_dirs": generated_dirs,
            "scripts": sorted(scripts),
        },
        "files": rel_files,
        "detected_tools": detected_tools,
        "moe_tier": moe_tier_value,
        "suggested_projects": suggested_projects,
        "confirmed_projects": [],
    }
    stable_for_hash = {k: v for k, v in analysis.items() if k != "workspace"}
    stable_for_hash["inventory"] = {
        k: v for k, v in analysis["inventory"].items() if k != "generated_dirs"
    }
    stable_for_hash["workspace"] = {k: v for k, v in analysis["workspace"].items() if k != "scanned_at"}
    stable_for_hash.pop("suggested_projects", None)
    analysis["analysis_hash"] = content_hash(stable_for_hash)

    if write_state:
        ensure_state_dir(root)
        write_json(state_file(root, ANALYSIS_FILE), analysis)
    return analysis
