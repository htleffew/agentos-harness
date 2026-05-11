"""Skill discovery — walk .claude/skills/<domain>/<skill>/SKILL.md.

Implements §4 of AGENTIC-OS-DASHBOARD-SPEC.md:
- §4.1  Discovery algorithm (frontmatter parse, skillOverrides check)
- §4.2  Sort order: composite recency/frequency score from activity.jsonl
- §4.3  Domain display order from dashboard config
- §4.4  Built-in harness skill → domain mapping
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ── §4.4 Built-in skill → domain mapping ─────────────────────────────────────

BUILTIN_DOMAIN_MAP: dict[str, str] = {
    "planning-work": "daily",
    "executing-plans": "daily",
    "looping-to-completion": "daily",
    "orienting-session": "daily",
    "workspace-status": "daily",
    "reviewing-work": "daily",
    "auditing-completion": "daily",
    "maintaining-wiki": "productivity",
    "investigating-questions": "research",
    "suggesting-skills": "ops",
    "generating-prompts": "ops",
    "agent-engineering-quality": "ops",
}

# ── Data types ────────────────────────────────────────────────────────────────


@dataclass
class SkillEntry:
    skill_dir: str           # relative path: <domain>/<skill>
    skill_name: str          # from frontmatter 'name' field (or derived)
    description: str         # from frontmatter 'description' field
    domain: str              # parent directory name
    display_label: str       # title-cased, hyphen→space
    domain_display: str      # title-cased domain name
    invocable_only: bool     # True if skillOverrides = "user-invocable-only"
    skill_md_path: Path      # absolute path to SKILL.md
    # Scoring fields (populated by score_skills)
    last_run_ts: datetime | None = None
    run_count_30d: int = 0
    sort_score: float = 0.0


# ── §4.1 Frontmatter parser ───────────────────────────────────────────────────

_FM_PATTERN = re.compile(r"^---\s*\n(.*?)\n---", re.DOTALL)
_FIELD_PATTERN = re.compile(r"^(\w[\w\s-]*):\s*(.+)$", re.MULTILINE)


def _parse_frontmatter(text: str) -> dict[str, str]:
    """Extract key: value pairs from YAML frontmatter block."""
    match = _FM_PATTERN.match(text)
    if not match:
        return {}
    block = match.group(1)
    return {k.strip(): v.strip() for k, v in _FIELD_PATTERN.findall(block)}


def _title_case(s: str) -> str:
    """Convert kebab-case or snake_case to Title Case."""
    return " ".join(w.capitalize() for w in re.split(r"[-_\s]+", s) if w)


# ── §4.2 Frequency / recency scoring ─────────────────────────────────────────

def _load_activity(workspace: Path) -> list[dict[str, Any]]:
    """Load activity.jsonl entries, silently ignoring I/O and parse errors."""
    activity_path = workspace / ".harness" / "state" / "activity.jsonl"
    if not activity_path.exists():
        return []
    entries: list[dict[str, Any]] = []
    try:
        for line in activity_path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    except OSError:
        pass
    return entries


def _parse_ts(ts_str: str | None) -> datetime | None:
    if not ts_str:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%S%z"):
        try:
            dt = datetime.strptime(ts_str, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            continue
    return None


def score_skills(
    skills: list[SkillEntry],
    workspace: Path,
    recency_weight: float = 0.6,
    frequency_weight: float = 0.4,
) -> list[SkillEntry]:
    """Populate sort_score, last_run_ts, run_count_30d for each skill.

    Score = recency_weight * (1 / days_since_last_run) + frequency_weight * run_count_30d
    Skills with no history get score=0 and sort alphabetically at end.
    """
    entries = _load_activity(workspace)
    now = datetime.now(tz=timezone.utc)
    cutoff_30d = now.timestamp() - 30 * 86400

    # Build lookup: skill_dir_name -> (last_run, count_30d)
    skill_stats: dict[str, tuple[datetime | None, int]] = {}

    for entry in entries:
        if not entry.get("ok", True):
            continue
        desc: str = entry.get("desc", "")
        # Match "skill:<skill-name>" prefix (from DashboardDispatch entries)
        if desc.startswith("skill:"):
            skill_key = desc[len("skill:"):]
        else:
            # Try to match skill name in desc for legacy entries
            skill_key = desc

        ts = _parse_ts(entry.get("ts"))
        if skill_key not in skill_stats:
            skill_stats[skill_key] = (None, 0)
        last_ts, count = skill_stats[skill_key]
        if ts is not None and (last_ts is None or ts > last_ts):
            skill_stats[skill_key] = (ts, count)
        if ts is not None and ts.timestamp() >= cutoff_30d:
            last_ts2, count2 = skill_stats[skill_key]
            skill_stats[skill_key] = (last_ts2, count2 + 1)

    for skill in skills:
        # Try matching by skill dir name, display_label, or skill_name
        candidates = [
            skill.skill_dir.split("/")[-1],          # e.g. "planning-work"
            skill.skill_dir.split("\\")[-1],
            skill.skill_name.lower().replace(" ", "-"),
        ]
        stats: tuple[datetime | None, int] | None = None
        for c in candidates:
            if c in skill_stats:
                stats = skill_stats[c]
                break

        if stats is None:
            skill.sort_score = 0.0
            continue

        last_run, count_30d = stats
        skill.last_run_ts = last_run
        skill.run_count_30d = count_30d

        if last_run is not None:
            days_since = max((now - last_run).total_seconds() / 86400, 0.01)
            recency = 1.0 / days_since
        else:
            recency = 0.0

        skill.sort_score = recency_weight * recency + frequency_weight * count_30d

    return skills


# ── §4.1 Main discovery function ──────────────────────────────────────────────

def discover_skills(
    workspace: Path,
    recency_weight: float = 0.6,
    frequency_weight: float = 0.4,
) -> list[SkillEntry]:
    """Discover all skills from .claude/skills/<domain>/<skill>/SKILL.md.

    Returns a list of SkillEntry objects sorted by domain display order,
    then by sort_score descending within each domain, then alphabetically.
    """
    skills_root = workspace / ".claude" / "skills"
    if not skills_root.exists():
        return []

    overrides = _load_skill_overrides(workspace)
    skills: list[SkillEntry] = []

    # Walk two levels: domain/ -> skill/ -> SKILL.md
    for domain_dir in sorted(skills_root.iterdir()):
        if not domain_dir.is_dir():
            continue
        domain = domain_dir.name

        for skill_dir in sorted(domain_dir.iterdir()):
            if not skill_dir.is_dir():
                continue
            skill_md = skill_dir / "SKILL.md"
            if not skill_md.exists():
                continue

            skill_key = skill_dir.name
            override = overrides.get(skill_key, "default")

            if override == "off":
                continue  # Hidden per skillOverrides

            invocable_only = override == "user-invocable-only"

            # Parse frontmatter
            text = skill_md.read_text(encoding="utf-8", errors="replace")
            fm = _parse_frontmatter(text)

            name = fm.get("name") or _title_case(skill_key)
            description = fm.get("description", "")

            # Apply built-in domain mapping (§4.4)
            effective_domain = BUILTIN_DOMAIN_MAP.get(skill_key, domain)

            skills.append(SkillEntry(
                skill_dir=f"{domain}/{skill_key}",
                skill_name=name,
                description=description,
                domain=effective_domain,
                display_label=_title_case(name),
                domain_display=_title_case(effective_domain),
                invocable_only=invocable_only,
                skill_md_path=skill_md,
            ))

    # Score and sort
    skills = score_skills(skills, workspace, recency_weight, frequency_weight)
    return skills


def skills_by_domain(
    skills: list[SkillEntry],
    domain_order: list[str] | None = None,
) -> dict[str, list[SkillEntry]]:
    """Group skills by domain and sort within each domain by score desc, then name.

    Domains are ordered per domain_order list; unlisted domains appended alphabetically.
    """
    order = domain_order or []
    grouped: dict[str, list[SkillEntry]] = {}
    for skill in skills:
        grouped.setdefault(skill.domain, []).append(skill)

    # Sort within each domain
    for domain_skills in grouped.values():
        domain_skills.sort(key=lambda s: (-s.sort_score, s.display_label.lower()))

    # Order domains
    ordered: dict[str, list[SkillEntry]] = {}
    for d in order:
        if d in grouped:
            ordered[d] = grouped.pop(d)
    for d in sorted(grouped.keys()):
        ordered[d] = grouped[d]
    return ordered


# ── §4.1 skillOverrides helper ────────────────────────────────────────────────

def _load_skill_overrides(workspace: Path) -> dict[str, str]:
    """Load .claude/settings.json skillOverrides block.

    Returns dict of {skill_name: "off" | "user-invocable-only" | "default"}.
    """
    settings_path = workspace / ".claude" / "settings.json"
    if not settings_path.exists():
        return {}
    try:
        data = json.loads(settings_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    overrides = data.get("skillOverrides", {})
    if not isinstance(overrides, dict):
        return {}
    return {str(k): str(v) for k, v in overrides.items()}
