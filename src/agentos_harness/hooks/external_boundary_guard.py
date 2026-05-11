#!/usr/bin/env python3
"""Block internal references and non-deliverable content from leaking into
projects/*/external/ surfaces.

Three layers of protection:
1. File type check: only deliverable file types allowed in external/
2. Filename pattern check: block operational document patterns
3. Content check: forbidden internal references in prose
"""
import io
import json
import os
import re
import select
import sys

# Deliverable file types allowed in external/
ALLOWED_EXTENSIONS = {
    ".ipynb",
    ".md",
    ".json",
    ".png",
    ".svg",
    ".jpg",
    ".jpeg",
    ".csv",
    ".txt",
}

# Operational filename patterns to block
OPERATIONAL_FILENAME_PATTERNS = [
    (r"^AGENTS\.MD$", "AGENTS.md is a project governance file"),
    (r"STANDARD", "standards documents belong in skill references/"),
    (r"GUIDE(?!D)", "guide documents belong in internal/guides/"),
    (r"POLICY", "policy documents belong in .harness/ or internal/"),
    (r"RUNBOOK", "runbooks belong in internal/guides/workflows/"),
    (r"HOOK", "hook-related files belong in .harness/hooks/"),
    (r"CONFIG", "configuration files belong in internal/config/"),
]

# Allowlist for operational-sounding names that are legitimate deliverables
OPERATIONAL_ALLOWLIST = [
    r"SOURCE_CONTRACT",
    r"PRELAUNCH.*POLICY",
    r"MONITORING",
    r"DEPLOYMENT.*GUIDE",
]

# Content patterns that indicate internal references
CONTENT_PATTERNS = [
    (r"WC-\d{2}", "orchestration label"),
    (r"\binternal/", "reference to internal/ path"),
    (r"\.claude/", "reference to .claude/ path"),
    (r"\.harness/", "reference to .harness/ path"),
    (r"\buser_materials\b", "reference to user_materials"),
    (r"not intended for external", "internal distribution warning"),
    (r"not for external distribution", "internal distribution warning"),
    (r"internal tool\b", "internal tool marker"),
    (r"\(internal only\)", "internal-only marker"),
    (r"\binternal use only\b", "internal use marker"),
    (r"\bagent-operational\b", "agent-centric language"),
]


def _load_exclusions(workspace: str) -> list:
    """Load external exclusion prefixes from config."""
    config_path = os.path.join(workspace, ".harness", "config", "external_exclusions.json")
    try:
        with open(config_path) as f:
            data = json.load(f)
            return data.get("prefixes", [])
    except (FileNotFoundError, json.JSONDecodeError, KeyError):
        return []


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

    # Only relevant for Edit and Write
    if tool_name not in ("Edit", "Write"):
        sys.exit(0)

    # Path detection
    file_path = tool_input.get("file_path", "")
    if not file_path:
        sys.exit(0)

    workspace = os.environ.get("CLAUDE_PROJECT_DIR", "")
    if workspace:
        rel_path = os.path.relpath(file_path, workspace)
    else:
        rel_path = file_path

    if not re.search(r"projects/[^/]+/external/", rel_path):
        sys.exit(0)

    # Check exclusions (source trees that live under external/ but aren't deliverables)
    exclusion_prefixes = _load_exclusions(workspace)
    if any(re.search(p, rel_path) for p in exclusion_prefixes):
        sys.exit(0)

    # Layer 1: File type check
    _, ext = os.path.splitext(file_path)
    if ext.lower() not in ALLOWED_EXTENSIONS:
        print(
            f"BLOCKED: File type '{ext}' is not allowed in external/ surfaces. "
            f"Only deliverable file types are permitted: "
            f"{', '.join(sorted(ALLOWED_EXTENSIONS))}. "
            f"Scripts, configs, and operational files belong in internal/.",
            file=sys.stderr,
        )
        sys.exit(2)

    # Layer 2: Filename pattern check
    basename = os.path.basename(file_path).upper()

    is_allowlisted = any(re.search(pat, basename) for pat in OPERATIONAL_ALLOWLIST)

    if not is_allowlisted:
        for pattern, description in OPERATIONAL_FILENAME_PATTERNS:
            if re.search(pattern, basename):
                print(
                    f"BLOCKED: '{os.path.basename(file_path)}' appears to be an "
                    f"operational document, not a colleague deliverable. "
                    f"{description}. "
                    f"external/ is reserved for curated professional deliverables only.",
                    file=sys.stderr,
                )
                sys.exit(2)

    # Layer 3: Content check for forbidden internal references
    if tool_name == "Write":
        content = tool_input.get("content", "")
    elif tool_name == "Edit":
        content = tool_input.get("new_string", "")
    else:
        content = ""

    if not content:
        sys.exit(0)

    # Skip content check for .ipynb files (code cells legitimately reference paths)
    if file_path.endswith(".ipynb"):
        sys.exit(0)

    # Skip enforcement for test assertion contexts
    if re.search(r"pytest\.raises|assert.*(?:Error|Exception)", content):
        sys.exit(0)

    violations = []
    for pattern, description in CONTENT_PATTERNS:
        if re.search(pattern, content, re.IGNORECASE):
            violations.append(description)

    if violations:
        shown = ", ".join(violations[:3])
        print(
            f"BLOCKED: Content written to external/ surface contains forbidden "
            f"internal references: {shown}. External surfaces must not leak "
            f"internal project structure.",
            file=sys.stderr,
        )
        sys.exit(2)

    sys.exit(0)


if __name__ == "__main__":
    main()
