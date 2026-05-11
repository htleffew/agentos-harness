"""Anthropic agent skills specification validator."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Callable


def _parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    """Parse YAML frontmatter from a markdown file.

    Returns (frontmatter_dict, body_text). Only handles simple key: value pairs.
    """
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, text

    end_idx = None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end_idx = i
            break

    if end_idx is None:
        return {}, text

    fm: dict[str, str] = {}
    for line in lines[1:end_idx]:
        if ":" in line:
            key, _, value = line.partition(":")
            fm[key.strip()] = value.strip()

    # Skip the single blank separator line immediately after the closing ---
    body_lines = lines[end_idx + 1:]
    if body_lines and body_lines[0] == "":
        body_lines = body_lines[1:]
    body = "\n".join(body_lines)
    return fm, body


def _rule(
    rule_id: str,
    description: str,
    severity: str,
    check: Callable[[dict[str, str], str, str], str | None],
) -> dict[str, Any]:
    return {
        "id": rule_id,
        "description": description,
        "severity": severity,
        "check": check,
    }


def _check_skill01(fm: dict[str, str], body: str, path: str) -> str | None:
    name = fm.get("name", "").strip()
    if not name:
        return "name field is missing or empty"
    return None


def _check_skill02(fm: dict[str, str], body: str, path: str) -> str | None:
    name = fm.get("name", "").strip()
    if len(name) > 64:
        return f"name is {len(name)} characters; maximum is 64"
    return None


def _check_skill03(fm: dict[str, str], body: str, path: str) -> str | None:
    name = fm.get("name", "").strip()
    if name and not re.match(r"^[a-z0-9-]+$", name):
        return "name must match ^[a-z0-9-]+$ (lowercase letters, numbers, hyphens only)"
    return None


def _check_skill04(fm: dict[str, str], body: str, path: str) -> str | None:
    name = fm.get("name", "").strip().lower()
    if "anthropic" in name or "claude" in name:
        return 'name must not contain "anthropic" or "claude"'
    return None


def _check_skill05(fm: dict[str, str], body: str, path: str) -> str | None:
    desc = fm.get("description", "").strip()
    if not desc:
        return "description field is missing or empty"
    return None


def _check_skill06(fm: dict[str, str], body: str, path: str) -> str | None:
    desc = fm.get("description", "").strip()
    if len(desc) > 1024:
        return f"description is {len(desc)} characters; maximum is 1024"
    return None


def _check_skill07(fm: dict[str, str], body: str, path: str) -> str | None:
    desc = fm.get("description", "").strip()
    if re.search(r"<[^>]+>", desc):
        return "description must not contain XML or HTML tags"
    return None


def _check_skill08(fm: dict[str, str], body: str, path: str) -> str | None:
    desc = fm.get("description", "").strip()
    first_person_starts = ("I ", "I'll ", "I can ", "You can ", "You'll ", "Use me")
    for pattern in first_person_starts:
        if desc.startswith(pattern):
            return f'description appears to be first person; starts with "{pattern}". Use third person.'
    return None


def _check_skill09(fm: dict[str, str], body: str, path: str) -> str | None:
    desc = fm.get("description", "").strip().lower()
    when_patterns = ("use when", "when the user", "when working with")
    if not any(p in desc for p in when_patterns):
        return (
            'description should include when to use the skill. '
            'Add "Use when..." or "when the user..." to indicate trigger conditions.'
        )
    return None


def _check_skill10(fm: dict[str, str], body: str, path: str) -> str | None:
    line_count = len(body.splitlines())
    if line_count > 500:
        return f"SKILL.md body is {line_count} lines; maximum is 500. Move detail into references/ files."
    return None


def _check_skill11(fm: dict[str, str], body: str, path: str) -> str | None:
    if re.search(r"\\[a-zA-Z]", body):
        return "body contains Windows-style backslash paths; use forward slashes"
    return None


def _check_skill12(fm: dict[str, str], body: str, path: str) -> str | None:
    patterns = [
        r"before \d{4}\b",
        r"after \d{4}\b",
        r"until \d{4}\b",
        r"as of \d{4}\b",
    ]
    for pat in patterns:
        match = re.search(pat, body, re.IGNORECASE)
        if match:
            return f'body contains time-sensitive language: "{match.group()}"'
    return None


def _check_skill13(fm: dict[str, str], body: str, path: str) -> str | None:
    name = fm.get("name", "").strip()
    if not name:
        return None
    ACCEPTABLE_NON_GERUND = {
        "status", "orient", "prompt", "audit", "wiki", "loop",
        "plan", "execute", "investigate", "suggest",
    }
    name_parts = name.split("-")
    # Accept if any part is a gerund (ending in "ing") — covers both
    # "processing-pdfs" (gerund first) and "data-processing" (gerund last).
    if any(part.endswith("ing") for part in name_parts):
        return None
    if name in ACCEPTABLE_NON_GERUND or any(p in ACCEPTABLE_NON_GERUND for p in name_parts):
        return None
    return (
        f'name "{name}" does not use a gerund form (ending in "-ing"). '
        "Gerund names (e.g. processing-pdfs, analyzing-data) are preferred."
    )


SPEC_RULES: list[dict[str, Any]] = [
    _rule("SKILL-01", "name field present and non-empty", "error", _check_skill01),
    _rule("SKILL-02", "name maximum 64 characters", "error", _check_skill02),
    _rule("SKILL-03", "name matches ^[a-z0-9-]+$", "error", _check_skill03),
    _rule('SKILL-04', 'name does not contain "anthropic" or "claude"', "error", _check_skill04),
    _rule("SKILL-05", "description field present and non-empty", "error", _check_skill05),
    _rule("SKILL-06", "description maximum 1024 characters", "error", _check_skill06),
    _rule("SKILL-07", "description contains no XML tags", "error", _check_skill07),
    _rule("SKILL-08", "description uses third person", "warning", _check_skill08),
    _rule("SKILL-09", "description includes WHAT and WHEN", "warning", _check_skill09),
    _rule("SKILL-10", "SKILL.md body is 500 lines or fewer", "error", _check_skill10),
    _rule("SKILL-11", "no Windows-style backslash paths", "warning", _check_skill11),
    _rule("SKILL-12", "no time-sensitive language", "warning", _check_skill12),
    _rule("SKILL-13", "name uses preferred gerund form", "warning", _check_skill13),
]


def audit_skill_file(skill_md_path: Path) -> list[dict[str, str]]:
    """Audit one SKILL.md file against all SPEC_RULES.

    Returns a list of finding dicts: {rule, severity, message, file}.
    """
    try:
        text = skill_md_path.read_text(encoding="utf-8")
    except OSError as exc:
        return [{"rule": "SKILL-00", "severity": "error", "message": str(exc), "file": str(skill_md_path)}]

    fm, body = _parse_frontmatter(text)
    findings: list[dict[str, str]] = []

    for rule in SPEC_RULES:
        msg = rule["check"](fm, body, str(skill_md_path))
        if msg is not None:
            findings.append({
                "rule": rule["id"],
                "severity": rule["severity"],
                "message": msg,
                "file": str(skill_md_path),
            })

    return findings


def audit_skills_dir(skills_dir: Path) -> list[dict[str, str]]:
    """Audit all SKILL.md files under skills_dir.

    Returns combined findings sorted by file path then rule id.
    """
    findings: list[dict[str, str]] = []
    for skill_md in sorted(skills_dir.glob("**/SKILL.md")):
        findings.extend(audit_skill_file(skill_md))
    return sorted(findings, key=lambda f: (f["file"], f["rule"]))


def format_audit_report(findings: list[dict[str, str]]) -> str:
    """Format findings as a human-readable audit report."""
    by_file: dict[str, list[dict[str, str]]] = {}
    for f in findings:
        by_file.setdefault(f["file"], []).append(f)

    lines: list[str] = []
    all_files = sorted(by_file.keys()) if by_file else []

    for file_path in all_files:
        file_findings = by_file[file_path]
        lines.append(f"\n{file_path}")
        for f in file_findings:
            tag = "[ERROR]" if f["severity"] == "error" else "[WARN] "
            lines.append(f"  {tag} {f['rule']}: {f['message']}")

    if not findings:
        lines.append("No SKILL.md files found or all files pass.")

    error_count = sum(1 for f in findings if f["severity"] == "error")
    warn_count = sum(1 for f in findings if f["severity"] == "warning")
    file_count = len(by_file)

    lines.append(f"\n{file_count} file(s) checked. {error_count} error(s). {warn_count} warning(s).")
    return "\n".join(lines).lstrip("\n")


def audit_has_errors(findings: list[dict[str, str]]) -> bool:
    """Return True if any finding has severity 'error'."""
    return any(f.get("severity") == "error" for f in findings)
