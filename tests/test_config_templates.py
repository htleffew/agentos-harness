"""Tests for config_templates module."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agentos_harness.config_templates import (
    ALLOWED_LOCATIONS_TEMPLATE,
    CRITICAL_LEARNINGS_TEMPLATE,
    ERROR_PATTERNS_TEMPLATE,
    EXTERNAL_EXCLUSIONS_TEMPLATE,
    NOTEBOOK_CONFORMANCE_POLICY_TEMPLATE,
    PUBLICATION_REGISTRY_TEMPLATE,
    SAFE_CLEANUP_PATHS_TEMPLATE,
    SENSITIVE_OUTPUT_POLICY_TEMPLATE,
    generate_config_files,
    get_template,
)


def test_error_patterns_template_is_valid_json() -> None:
    data = json.loads(ERROR_PATTERNS_TEMPLATE)
    assert "patterns" in data
    assert isinstance(data["patterns"], list)


def test_error_patterns_template_has_example_pattern() -> None:
    data = json.loads(ERROR_PATTERNS_TEMPLATE)
    patterns = data["patterns"]
    assert len(patterns) >= 1

    example = patterns[0]
    assert "id" in example
    assert "name" in example
    assert "regex" in example
    assert "fix" in example


def test_publication_registry_template_is_valid_json() -> None:
    data = json.loads(PUBLICATION_REGISTRY_TEMPLATE)
    assert "surfaces" in data
    assert isinstance(data["surfaces"], list)


def test_safe_cleanup_paths_template_is_valid_json() -> None:
    data = json.loads(SAFE_CLEANUP_PATHS_TEMPLATE)
    assert "paths" in data
    assert isinstance(data["paths"], list)
    assert "/tmp/" in data["paths"]


def test_external_exclusions_template_is_valid_json() -> None:
    data = json.loads(EXTERNAL_EXCLUSIONS_TEMPLATE)
    assert "prefixes" in data
    assert isinstance(data["prefixes"], list)


def test_critical_learnings_template_is_markdown() -> None:
    assert CRITICAL_LEARNINGS_TEMPLATE.startswith("#")
    assert "Critical Learnings" in CRITICAL_LEARNINGS_TEMPLATE


def test_generate_config_files_creates_all_files(tmp_path: Path) -> None:
    config_dir = tmp_path / ".harness" / "config"

    generate_config_files(config_dir)

    assert (config_dir / "error_patterns.json").exists()
    assert (config_dir / "publication_registry.json").exists()
    assert (config_dir / "safe_cleanup_paths.json").exists()
    assert (config_dir / "external_exclusions.json").exists()
    assert (config_dir / "CRITICAL_LEARNINGS.md").exists()


def test_generate_config_files_creates_directory(tmp_path: Path) -> None:
    config_dir = tmp_path / ".harness" / "config"
    assert not config_dir.exists()

    generate_config_files(config_dir)

    assert config_dir.exists()


def test_generate_config_files_produces_valid_json(tmp_path: Path) -> None:
    config_dir = tmp_path / ".harness" / "config"

    generate_config_files(config_dir)

    json_files = [
        "error_patterns.json",
        "publication_registry.json",
        "safe_cleanup_paths.json",
        "external_exclusions.json",
    ]

    for name in json_files:
        content = (config_dir / name).read_text()
        data = json.loads(content)
        assert isinstance(data, dict)


def test_generate_config_files_does_not_overwrite_existing(tmp_path: Path) -> None:
    config_dir = tmp_path / ".harness" / "config"
    config_dir.mkdir(parents=True)

    existing_content = '{"patterns": [{"id": "CUSTOM"}]}'
    (config_dir / "error_patterns.json").write_text(existing_content)

    generate_config_files(config_dir, overwrite=False)

    content = (config_dir / "error_patterns.json").read_text()
    assert "CUSTOM" in content


def test_generate_config_files_can_overwrite_existing(tmp_path: Path) -> None:
    config_dir = tmp_path / ".harness" / "config"
    config_dir.mkdir(parents=True)

    existing_content = '{"patterns": [{"id": "CUSTOM"}]}'
    (config_dir / "error_patterns.json").write_text(existing_content)

    generate_config_files(config_dir, overwrite=True)

    content = (config_dir / "error_patterns.json").read_text()
    data = json.loads(content)
    assert not any(p.get("id") == "CUSTOM" for p in data.get("patterns", []))


def test_error_patterns_template_patterns_have_required_fields() -> None:
    data = json.loads(ERROR_PATTERNS_TEMPLATE)
    required_fields = {"id", "name", "regex", "fix"}

    for pattern in data["patterns"]:
        assert required_fields.issubset(pattern.keys()), f"Pattern missing fields: {pattern}"


def test_publication_registry_template_surfaces_have_required_fields() -> None:
    data = json.loads(PUBLICATION_REGISTRY_TEMPLATE)
    required_fields = {"name", "path_pattern", "review_required"}

    for surface in data["surfaces"]:
        assert required_fields.issubset(surface.keys()), f"Surface missing fields: {surface}"


def test_sensitive_output_policy_template_is_valid_json() -> None:
    data = json.loads(SENSITIVE_OUTPUT_POLICY_TEMPLATE)
    assert "version" in data
    assert "blocked_extension_regexes" in data
    assert "pii_patterns" in data
    assert isinstance(data["pii_patterns"], dict)


def test_sensitive_output_policy_template_has_pii_patterns() -> None:
    data = json.loads(SENSITIVE_OUTPUT_POLICY_TEMPLATE)
    pii_patterns = data["pii_patterns"]
    assert "email" in pii_patterns
    assert "phone_e164_us" in pii_patterns
    assert "ssn_us" in pii_patterns


def test_allowed_locations_template_is_valid_json() -> None:
    data = json.loads(ALLOWED_LOCATIONS_TEMPLATE)
    assert "allowed_directories" in data
    assert "allowed_root_files" in data
    assert isinstance(data["allowed_directories"], list)
    assert isinstance(data["allowed_root_files"], list)


def test_allowed_locations_template_has_standard_paths() -> None:
    data = json.loads(ALLOWED_LOCATIONS_TEMPLATE)
    directories = data["allowed_directories"]
    assert ".harness/hooks/pre/" in directories
    assert ".harness/skills/" in directories
    assert ".harness/commands/" in directories


def test_notebook_conformance_policy_template_is_valid_json() -> None:
    data = json.loads(NOTEBOOK_CONFORMANCE_POLICY_TEMPLATE)
    assert "version" in data
    assert "required_opening_sections" in data
    assert "valid_shape_values" in data
    assert "forbidden_llm_markers" in data
    assert "forbidden_import_patterns" in data


def test_notebook_conformance_policy_template_has_opening_sections() -> None:
    data = json.loads(NOTEBOOK_CONFORMANCE_POLICY_TEMPLATE)
    sections = data["required_opening_sections"]
    assert "title" in sections
    assert "research questions" in sections
    assert "methodology references" in sections


def test_generate_config_files_creates_new_templates(tmp_path: Path) -> None:
    config_dir = tmp_path / ".harness" / "config"

    generate_config_files(config_dir)

    assert (config_dir / "sensitive_output_policy.json").exists()
    assert (config_dir / "allowed_locations.json").exists()
    assert (config_dir / "notebook_conformance_policy.json").exists()


def test_get_template_returns_sensitive_output_policy() -> None:
    template = get_template("sensitive_output_policy")
    data = json.loads(template)
    assert "pii_patterns" in data


def test_get_template_returns_allowed_locations() -> None:
    template = get_template("allowed_locations")
    data = json.loads(template)
    assert "allowed_directories" in data


def test_get_template_returns_notebook_conformance_policy() -> None:
    template = get_template("notebook_conformance_policy")
    data = json.loads(template)
    assert "required_opening_sections" in data


def test_get_template_returns_empty_for_unknown() -> None:
    template = get_template("nonexistent_template")
    assert template == "{}"
