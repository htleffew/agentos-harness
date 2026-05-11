#!/usr/bin/env python3
"""Block SKILL.md writes that violate the Anthropic agent skills spec."""

from __future__ import annotations

import json
import re
import select
import sys

_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
_WHEN_PHRASES = ("use when", "when the user", "when working with")


def _parse_frontmatter(content: str) -> dict[str, str]:
    lines = content.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}
    end = -1
    for i, line in enumerate(lines[1:], 1):
        if line.strip() == "---":
            end = i
            break
    if end == -1:
        return {}
    fm: dict[str, str] = {}
    for line in lines[1:end]:
        if line.startswith("name:"):
            fm["name"] = line[5:].strip()
        elif line.startswith("description:"):
            fm["description"] = line[12:].strip()
    return fm


def main() -> None:
    if not select.select([sys.stdin], [], [], 0.0)[0]:
        sys.exit(0)

    try:
        event = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    if event.get("tool_name") != "Write":
        sys.exit(0)

    tool_input = event.get("tool_input", {})
    file_path = tool_input.get("file_path", "")
    normalized = file_path.replace("\\", "/")
    if not (normalized.endswith("SKILL.md") and ".claude/skills/" in normalized):
        sys.exit(0)

    content = tool_input.get("content", "")
    fm = _parse_frontmatter(content)

    errors: list[str] = []

    if not fm:
        errors.append(
            "SKILL.md has no YAML frontmatter. Add a --- block with name and description fields."
        )
    else:
        name = fm.get("name", "")
        description = fm.get("description", "")

        if not name:
            errors.append("SKILL.md missing required 'name' field.")
        else:
            if len(name) > 64:
                errors.append(f"SKILL.md name '{name}' exceeds 64 characters ({len(name)}).")
            if not _NAME_RE.match(name):
                errors.append(
                    f"SKILL.md name '{name}' must be lowercase alphanumeric with hyphens only "
                    f"(no underscores, no uppercase, no leading hyphen)."
                )
            if "anthropic" in name.lower() or "claude" in name.lower():
                errors.append(f"SKILL.md name '{name}' must not contain 'anthropic' or 'claude'.")

        if not description:
            errors.append("SKILL.md missing required 'description' field.")
        else:
            if len(description) > 1024:
                errors.append(
                    f"SKILL.md description exceeds 1024 characters ({len(description)})."
                )
            desc_lower = description.lower()
            if not any(phrase in desc_lower for phrase in _WHEN_PHRASES):
                errors.append(
                    "SKILL.md description must include a 'use when' or 'when the user' clause "
                    "describing the trigger condition."
                )

    if errors:
        for error in errors:
            print(f"BLOCKED: {error}", file=sys.stderr)
        sys.exit(2)

    sys.exit(0)


if __name__ == "__main__":
    main()
