"""Config file templates generated during harness setup."""

from __future__ import annotations

import json
from pathlib import Path

ERROR_PATTERNS_TEMPLATE = """{
  "patterns": [
    {
      "id": "E001",
      "name": "module_not_found",
      "regex": "ModuleNotFoundError: No module named '([^']+)'",
      "fix": "Install the missing package: pip install <module>",
      "hit_count": 0,
      "last_hit": null,
      "has_preventive_hook": false
    },
    {
      "id": "E002",
      "name": "permission_denied",
      "regex": "Permission denied|EACCES",
      "fix": "Check file permissions. May need chmod or run with appropriate access.",
      "hit_count": 0,
      "last_hit": null,
      "has_preventive_hook": false
    },
    {
      "id": "E003",
      "name": "git_uncommitted_changes",
      "regex": "Please commit your changes or stash them",
      "fix": "Commit or stash current changes before proceeding: git stash",
      "hit_count": 0,
      "last_hit": null,
      "has_preventive_hook": false
    },
    {
      "id": "E004",
      "name": "file_not_found",
      "regex": "FileNotFoundError|No such file or directory",
      "fix": "Verify the file path exists. Check for typos or missing directories.",
      "hit_count": 0,
      "last_hit": null,
      "has_preventive_hook": false
    },
    {
      "id": "E005",
      "name": "syntax_error",
      "regex": "SyntaxError: ",
      "fix": "Fix the syntax error at the indicated line. Check for missing colons, parentheses, or quotes.",
      "hit_count": 0,
      "last_hit": null,
      "has_preventive_hook": false
    }
  ]
}"""

CRITICAL_LEARNINGS_TEMPLATE = """\
# Critical Learnings

This file accumulates lessons learned from this workspace. Each entry records
a significant discovery, gotcha, or best practice that future sessions should
know to avoid repeating mistakes.

## Format

Each entry uses this structure:

### YYYY-MM-DD: Brief Title

**Context:** What was happening when this was learned.

**Learning:** The specific insight or rule.

**Prevention:** How to avoid this issue in the future.

---

## Entries

(Add new entries above this line)
"""

PUBLICATION_REGISTRY_TEMPLATE = """{
  "surfaces": [
    {
      "name": "external_deliverables",
      "path_pattern": "projects/*/external/",
      "review_required": true,
      "prose_compliance": true
    }
  ],
  "last_updated": null
}"""

SAFE_CLEANUP_PATHS_TEMPLATE = """{
  "paths": ["/tmp/"]
}"""

EXTERNAL_EXCLUSIONS_TEMPLATE = """{
  "prefixes": []
}"""

SENSITIVE_OUTPUT_POLICY_TEMPLATE = """{
  "version": "1.0",
  "blocked_path_regexes": [],
  "path_allowlist_regexes": [
    "reports/csv/.*\\\\.csv$",
    "\\\\.harness/skills/.*/references/.*\\\\.md$"
  ],
  "blocked_extension_regexes": [
    "\\\\.parquet$",
    "\\\\.joblib$",
    "\\\\.pkl$",
    "\\\\.pickle$",
    "\\\\.feather$",
    "\\\\.jsonl$",
    "\\\\.orc$",
    "\\\\.avro$",
    "\\\\.snappy$",
    "\\\\.crc$",
    "\\\\.zst$",
    "\\\\.zstd$"
  ],
  "publication_blocked_extension_regexes": [
    "\\\\.csv$",
    "\\\\.parquet$",
    "\\\\.joblib$",
    "\\\\.pkl$"
  ],
  "publication_path_prefixes": [
    ".harness/state/hub/"
  ],
  "blocked_filename_regexes": [
    ".*_rows\\\\.csv$",
    ".*observations\\\\.parquet$",
    ".*scored\\\\.parquet$"
  ],
  "max_file_size_bytes": 20971520,
  "max_file_size_allowlist_regexes": [],
  "pii_patterns": {
    "email": "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\\\.[A-Za-z]{2,}",
    "phone_e164_us": "\\\\+1[0-9]{10}",
    "phone_us_formatted": "\\\\([0-9]{3}\\\\)\\\\s?[0-9]{3}-[0-9]{4}",
    "ssn_us": "\\\\b[0-9]{3}-[0-9]{2}-[0-9]{4}\\\\b"
  },
  "text_extensions_for_pii_scan": [
    ".md",
    ".txt",
    ".json",
    ".csv",
    ".yaml",
    ".yml",
    ".sql",
    ".py",
    ".rst"
  ],
  "pii_allowlist_file": ".harness/hooks/config/pii_allowlist.txt"
}"""

ALLOWED_LOCATIONS_TEMPLATE = """{
  "allowed_directories": [
    ".harness/hooks/pre/",
    ".harness/hooks/post/",
    ".harness/hooks/session/",
    ".harness/hooks/config/",
    ".harness/skills/",
    ".harness/commands/",
    ".harness/state/",
    ".harness/wiki/",
    "projects/"
  ],
  "allowed_root_files": [
    ".harness/settings.json",
    ".harness/settings.local.json",
    "AGENTS.md",
    "CLAUDE.md",
    "CODEX.md",
    "README.md"
  ]
}"""

DISCIPLINE_TEMPLATE = """{
  "version": "1.0",
  "description": "Operating discipline settings for the harness",
  "plan_cold_reader_gate": false,
  "loop_as_default": false,
  "comments": {
    "plan_cold_reader_gate": "When true, validates that plans have explicit pass/fail criteria and deliverables before execution",
    "loop_as_default": "When true, execute skill continues with /loop until 100% complete rather than stopping after one pass"
  }
}"""

NOTEBOOK_CONFORMANCE_POLICY_TEMPLATE = """{
  "version": "1.0",
  "enforce_on_external": true,
  "enforce_on_commit": true,
  "research_program_projects": [],
  "required_opening_sections": [
    "title",
    "research questions",
    "pipeline position",
    "surfaces under examination",
    "scope constraints",
    "methodology references"
  ],
  "valid_shape_values": [
    "magnitude vs baseline",
    "ranked categories",
    "before/after paired",
    "attrition through ordered stages",
    "network with named entities",
    "distribution of scores",
    "time series with events",
    "outlier callout",
    "correlation",
    "threshold/calibration"
  ],
  "forbidden_llm_markers": [
    "\\\\*\\\\*Finding:\\\\*\\\\*",
    "\\\\*\\\\*Look at:\\\\*\\\\*",
    "\\\\*\\\\*Why:\\\\*\\\\*",
    "\\\\*\\\\*Note:\\\\*\\\\*",
    "\\\\*\\\\*Observation:\\\\*\\\\*"
  ],
  "forbidden_import_patterns": [
    "sys\\\\.path\\\\.insert",
    "importlib\\\\.util\\\\.spec_from_file_location",
    "runpy\\\\.run_path"
  ],
  "forbidden_absolute_paths": [
    "/home/",
    "/Users/"
  ],
  "grace_period_allowlist": {
    "description": "Notebook paths that get WARN instead of BLOCK on external-tier checks",
    "paths": []
  }
}"""


def get_template(name: str) -> str:
    """Get a config template by name."""
    templates = {
        "error_patterns": ERROR_PATTERNS_TEMPLATE,
        "critical_learnings": CRITICAL_LEARNINGS_TEMPLATE,
        "publication_registry": PUBLICATION_REGISTRY_TEMPLATE,
        "safe_cleanup_paths": SAFE_CLEANUP_PATHS_TEMPLATE,
        "external_exclusions": EXTERNAL_EXCLUSIONS_TEMPLATE,
        "sensitive_output_policy": SENSITIVE_OUTPUT_POLICY_TEMPLATE,
        "allowed_locations": ALLOWED_LOCATIONS_TEMPLATE,
        "notebook_conformance_policy": NOTEBOOK_CONFORMANCE_POLICY_TEMPLATE,
        "discipline": DISCIPLINE_TEMPLATE,
    }
    return templates.get(name, "{}")


def generate_config_files(config_dir: Path, overwrite: bool = False) -> None:
    """Generate all config files in the specified directory.

    Args:
        config_dir: Directory to write config files to.
        overwrite: If True, overwrite existing files. Default False.
    """
    config_dir.mkdir(parents=True, exist_ok=True)

    files = {
        "error_patterns.json": ERROR_PATTERNS_TEMPLATE,
        "publication_registry.json": PUBLICATION_REGISTRY_TEMPLATE,
        "safe_cleanup_paths.json": SAFE_CLEANUP_PATHS_TEMPLATE,
        "external_exclusions.json": EXTERNAL_EXCLUSIONS_TEMPLATE,
        "sensitive_output_policy.json": SENSITIVE_OUTPUT_POLICY_TEMPLATE,
        "allowed_locations.json": ALLOWED_LOCATIONS_TEMPLATE,
        "notebook_conformance_policy.json": NOTEBOOK_CONFORMANCE_POLICY_TEMPLATE,
        "discipline.json": DISCIPLINE_TEMPLATE,
        "CRITICAL_LEARNINGS.md": CRITICAL_LEARNINGS_TEMPLATE,
    }

    for filename, content in files.items():
        filepath = config_dir / filename
        if filepath.exists() and not overwrite:
            continue
        filepath.write_text(content)
