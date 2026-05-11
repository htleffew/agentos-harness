#!/usr/bin/env python3
"""PostToolUse reminder when a completed plan may now be stale relative to sources.

Fires on Edit/Write to plans/completed/ and checks if referenced files have been
modified since the plan's creation date.
"""
import io
import json
import os
import re
import select
import sys
from datetime import datetime
from pathlib import Path


def main() -> None:
    # CLI mode support
    try:
        stdin_has_data = select.select([sys.stdin], [], [], 0.0)[0]
    except (OSError, io.UnsupportedOperation):
        stdin_has_data = True
    if not stdin_has_data:
        sys.exit(0)

    try:
        input_data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = input_data.get("tool_name", "")
    tool_input = input_data.get("tool_input", {})

    # Only fire on Edit/Write to plans/completed/
    file_path = tool_input.get("file_path", "") or tool_input.get("path", "")
    if "plans/completed/" not in file_path:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse"}}))
        sys.exit(0)

    workspace = os.environ.get("CLAUDE_PROJECT_DIR", "")
    if not workspace:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse"}}))
        sys.exit(0)

    # Read the plan file to find referenced files
    try:
        plan_content = Path(file_path).read_text()
    except Exception:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse"}}))
        sys.exit(0)

    # Extract file references from the plan
    ref_patterns = [
        r"(?:internal|external)/[a-zA-Z0-9_/\-\.]+\.(?:md|json|py|ipynb)",
        r"(?:projects|\.claude|\.harness)/[a-zA-Z0-9_/\-\.]+\.(?:md|json|py|ipynb)",
    ]

    references = set()
    for pattern in ref_patterns:
        references.update(re.findall(pattern, plan_content))

    if not references:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse"}}))
        sys.exit(0)

    # Get plan creation date from frontmatter
    plan_created = None
    created_match = re.search(r"created:\s*(\d{4}-\d{2}-\d{2})", plan_content)
    if created_match:
        try:
            plan_created = datetime.strptime(created_match.group(1), "%Y-%m-%d")
        except ValueError:
            pass

    if not plan_created:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse"}}))
        sys.exit(0)

    # Check which referenced files were modified after plan creation
    stale_refs = []
    for ref in references:
        candidates = [
            Path(workspace) / ref,
            Path(file_path).parent.parent.parent / ref,
        ]

        for candidate in candidates:
            if candidate.exists():
                mtime = datetime.fromtimestamp(candidate.stat().st_mtime)
                if mtime > plan_created:
                    stale_refs.append((ref, mtime.strftime("%Y-%m-%d")))
                break

    output = {"hookSpecificOutput": {"hookEventName": "PostToolUse"}}

    if stale_refs:
        lines = [
            f"KNOWLEDGE FRESHNESS: {len(stale_refs)} reference(s) changed since "
            f"plan creation ({created_match.group(1)}):"
        ]
        for ref, mod_date in stale_refs[:5]:
            lines.append(f"  {ref} (modified {mod_date})")
        lines.append("Consider reviewing whether the plan's assumptions are still valid.")
        output["hookSpecificOutput"]["additionalContext"] = "\n".join(lines)

    print(json.dumps(output))
    sys.exit(0)


if __name__ == "__main__":
    main()
