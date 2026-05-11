from __future__ import annotations

import pytest

from agentos_harness.profile_registry import (
    CORE_PROFILE_NAME,
    CORE_PROFILE_VERSION,
    available_profiles,
    profile_metadata,
    render_profile,
    symlink_targets,
)


def _base_analysis() -> dict:
    return {
        "moe_tier": "claude-only",
        "confirmed_projects": [],
        "detected_tools": {"claude": True, "codex": False, "gemini": False},
        "suggested_projects": [],
        "workspace": {"display_name": "sample-repo", "root": "/tmp/sample"},
        "inventory": {
            "languages": ["Python"],
            "package_managers": ["python"],
            "test_commands": ["python -m pytest"],
            "build_commands": [],
            "docs": ["README.md"],
            "source_dirs": ["src"],
            "project_boundaries": ["."],
            "agent_files": [],
            "ci_files": [],
            "notebooks": [],
            "publication_dirs": [],
            "generated_dirs": [],
            "scripts": [],
        },
        "files": [],
        "schema_version": "1.0",
        "analysis_hash": "testhash",
    }


def test_core_profile_targets_are_complete() -> None:
    analysis = _base_analysis()
    rendered = render_profile(analysis)
    required = {
        "AGENTS.md",
        "CLAUDE.md",
        "CODEX.md",
        "GEMINI.md",
        ".claude/SKILL_STANDARDS.md",
        ".claude/wiki/index.md",
        ".claude/wiki/log.md",
        ".claude/wiki/wiki/repository-overview.md",
        ".claude/wiki/wiki/workflows/local-development.md",
        ".claude/wiki/wiki/projects/repository.md",
        ".claude/wiki/wiki/reference/agent-engineering-quality-standard.md",
        ".claude/skills/agent-engineering-quality/SKILL.md",
        ".claude/skills/agent-engineering-quality/references/comprehensive_100pct_execution_default.md",
        ".claude/skills/workspace-status/SKILL.md",
        ".claude/skills/workspace-status/references/command.md",
        ".claude/skills/generating-prompts/SKILL.md",
        ".claude/skills/generating-prompts/references/command.md",
        ".claude/skills/maintaining-wiki/SKILL.md",
        ".claude/skills/maintaining-wiki/references/command.md",
        ".claude/skills/planning-work/SKILL.md",
        ".claude/skills/planning-work/references/command.md",
        ".claude/skills/executing-plans/SKILL.md",
        ".claude/skills/executing-plans/references/command.md",
        ".claude/skills/orienting-session/SKILL.md",
        ".claude/skills/orienting-session/references/command.md",
        ".claude/skills/looping-to-completion/SKILL.md",
        ".claude/skills/looping-to-completion/references/command.md",
        ".claude/skills/reviewing-work/SKILL.md",
        ".claude/skills/reviewing-work/references/command.md",
        ".claude/skills/auditing-completion/SKILL.md",
        ".claude/skills/auditing-completion/references/command.md",
        ".claude/skills/investigating-questions/SKILL.md",
        ".claude/skills/investigating-questions/references/command.md",
        ".claude/skills/suggesting-skills/SKILL.md",
        ".claude/skills/suggesting-skills/references/command.md",
        ".claude/commands/status.md",
        ".claude/commands/prompt.md",
        ".claude/commands/wiki.md",
        ".claude/commands/plan.md",
        ".claude/commands/execute.md",
        ".claude/commands/orient.md",
        ".claude/commands/loop.md",
        ".claude/commands/review.md",
        ".claude/commands/audit.md",
        ".claude/commands/investigate.md",
        ".claude/commands/suggest.md",
        ".claude/hooks/pre/path_guard.py",
        ".claude/hooks/pre/destructive_guard.py",
        ".claude/hooks/pre/secret_guard.py",
        ".claude/hooks/pre/engineering_quality_guard.py",
        ".claude/hooks/post/activity_log.py",
        ".claude/hooks/post/wiki_reminder.py",
        ".claude/settings.json",
        ".codex/README.md",
    }
    assert required <= set(rendered)
    assert ".claude/commands/python-test.md" in rendered
    assert ".claude/skills/python-package/SKILL.md" in rendered
    assert ".claude/hooks/post/setup_rescan_reminder.py" in rendered
    assert symlink_targets() == {
        ".codex/commands": "../.claude/commands",
        ".codex/skills": "../.claude/skills",
        ".codex/hooks": "../.claude/hooks",
    }


def test_moe_aware_agents_claude_only() -> None:
    analysis = _base_analysis()
    rendered = render_profile(analysis)
    assert "Claude Code as its AI assistant" in rendered["AGENTS.md"]


def test_moe_aware_agents_full_moe() -> None:
    analysis = _base_analysis()
    analysis["moe_tier"] = "full-moe"
    analysis["detected_tools"] = {"claude": True, "codex": True, "gemini": True}
    rendered = render_profile(analysis)
    assert "three-tool AI triad" in rendered["AGENTS.md"]
    assert "Independent plan consensus and completion audit omit the active lead agent" in rendered["AGENTS.md"]
    assert "Nonblocking suggestions:" in rendered["AGENTS.md"]


def test_moe_aware_agents_claude_gemini_excludes_active_lead() -> None:
    analysis = _base_analysis()
    analysis["moe_tier"] = "claude-gemini"
    analysis["detected_tools"] = {"claude": True, "codex": False, "gemini": True}
    rendered = render_profile(analysis)
    assert "two-tool AI pair" in rendered["AGENTS.md"]
    assert "Independent plan consensus and completion audit omit the active lead agent" in rendered["AGENTS.md"]
    assert "same-agent review is local sanity evidence only" in rendered["AGENTS.md"].lower()
    assert "Nonblocking suggestions:" in rendered["AGENTS.md"]


def test_moe_aware_agents_non_claude_permutations() -> None:
    cases = {
        "codex-only": "Codex CLI as its AI assistant",
        "gemini-only": "Gemini CLI as its AI assistant",
        "codex-gemini": "Codex CLI for deterministic",
    }
    for tier, expected in cases.items():
        analysis = _base_analysis()
        analysis["moe_tier"] = tier
        analysis["detected_tools"] = {
            "claude": False,
            "codex": "codex" in tier,
            "gemini": "gemini" in tier,
        }
        rendered = render_profile(analysis)
        assert expected in rendered["AGENTS.md"]


def test_skill_standards_present_and_correct() -> None:
    analysis = _base_analysis()
    rendered = render_profile(analysis)
    assert ".claude/SKILL_STANDARDS.md" in rendered
    assert "harness audit ." in rendered[".claude/SKILL_STANDARDS.md"]


def test_no_workspace_leakage_in_skills() -> None:
    import re
    analysis = _base_analysis()
    rendered = render_profile(analysis)
    forbidden = ["cx exec", " gx ", "JiraClient", "s3://", "atlas_lq", "spokeo"]
    for path, content in rendered.items():
        if "/SKILL.md" in path or "/references/command.md" in path:
            for term in forbidden:
                assert term.lower() not in content.lower(), (
                    f"Leakage in {path}: found '{term}'"
                )


def test_generated_codex_context_receipt_surfaces_are_complete() -> None:
    analysis = _base_analysis()
    analysis["moe_tier"] = "full-moe"
    analysis["detected_tools"] = {"claude": True, "codex": True, "gemini": True}
    rendered = render_profile(analysis)
    surfaces = {
        "AGENTS.md": rendered["AGENTS.md"],
        "CLAUDE.md": rendered["CLAUDE.md"],
        "CODEX.md": rendered["CODEX.md"],
        "GEMINI.md": rendered["GEMINI.md"],
        ".claude/skills/planning-work/references/command.md": rendered[
            ".claude/skills/planning-work/references/command.md"
        ],
        ".claude/skills/executing-plans/references/command.md": rendered[
            ".claude/skills/executing-plans/references/command.md"
        ],
        ".codex/README.md": rendered[".codex/README.md"],
    }
    fields = (
        "Context-Receipt",
        "Wiki-Index",
        "Skill-Index",
        "Skills-Selected",
        "Project-Continuity",
        "Source-Artifacts",
        "Engineering-Quality-Standard",
        "Validators-Planned",
    )
    for path, content in surfaces.items():
        for field in fields:
            assert field in content, f"{path} is missing {field}"

    assert "bare Codex session (a Codex CLI invocation with no task prompt)" in rendered["AGENTS.md"]
    assert "Project-Continuity: N/A" in rendered["CODEX.md"]
    assert "Task-scoped Codex work" in rendered[".codex/README.md"]


def test_generated_codex_context_surfaces_do_not_leak_live_launchers() -> None:
    analysis = _base_analysis()
    analysis["moe_tier"] = "full-moe"
    analysis["detected_tools"] = {"claude": True, "codex": True, "gemini": True}
    rendered = render_profile(analysis)
    surfaces = [
        "AGENTS.md",
        "CLAUDE.md",
        "CODEX.md",
        "GEMINI.md",
        ".claude/skills/planning-work/references/command.md",
        ".claude/skills/executing-plans/references/command.md",
        ".codex/README.md",
    ]
    forbidden = ("cx exec", " gx ", "clx", "atlas_lq")
    for path in surfaces:
        content = rendered[path].lower()
        for term in forbidden:
            assert term not in content, f"{path} leaked {term}"


def test_core_profile_metadata_is_stable() -> None:
    assert available_profiles() == (CORE_PROFILE_NAME,)
    metadata = profile_metadata()
    assert metadata["profile"] == "core"
    assert metadata["profile_version"] == CORE_PROFILE_VERSION
    assert len(metadata["profile_source_hash"]) == 64
    assert metadata == profile_metadata()


def test_unknown_profile_is_rejected() -> None:
    with pytest.raises(ValueError):
        profile_metadata("unknown")


def test_core_profile_version_is_2_3_2() -> None:
    assert CORE_PROFILE_VERSION == "2.3.2"


def test_enforcement_hooks_present_in_rendered_profile() -> None:
    analysis = _base_analysis()
    rendered = render_profile(analysis)
    expected = {
        ".claude/hooks/pre/commit_gate.py",
        ".claude/hooks/pre/skill_guard.py",
        ".claude/hooks/pre/engineering_quality_guard.py",
        ".claude/hooks/post/error_tracker.py",
        ".claude/hooks/post/handoff_reminder.py",
        ".claude/hooks/session/session_context.py",
    }
    assert expected <= set(rendered)


def test_removed_hooks_absent_from_rendered_profile() -> None:
    analysis = _base_analysis()
    rendered = render_profile(analysis)
    assert ".claude/hooks/pre/prose_guard.py" not in rendered
    assert ".claude/hooks/pre/publication_guard.py" not in rendered


def test_new_hook_files_are_non_empty() -> None:
    analysis = _base_analysis()
    rendered = render_profile(analysis)
    for path in (
        ".claude/hooks/pre/commit_gate.py",
        ".claude/hooks/pre/skill_guard.py",
        ".claude/hooks/pre/engineering_quality_guard.py",
        ".claude/hooks/post/error_tracker.py",
        ".claude/hooks/post/handoff_reminder.py",
        ".claude/hooks/session/session_context.py",
    ):
        assert len(rendered[path]) > 50, f"{path} is suspiciously short"


def test_settings_json_includes_session_start_block() -> None:
    import json
    analysis = _base_analysis()
    rendered = render_profile(analysis)
    settings = json.loads(rendered[".claude/settings.json"])
    assert "SessionStart" in settings["hooks"]
    session_hooks = settings["hooks"]["SessionStart"]
    assert any(
        "session_context.py" in str(block)
        for block in session_hooks
    )
    assert any(
        "session_start_discipline.py" in str(block)
        for block in session_hooks
    )


def test_settings_json_includes_commit_gate_for_bash() -> None:
    import json
    analysis = _base_analysis()
    rendered = render_profile(analysis)
    settings = json.loads(rendered[".claude/settings.json"])
    bash_matchers = [
        block
        for matcher_list in settings["hooks"].get("PreToolUse", [])
        for block in [matcher_list]
        if "Bash" in str(block)
    ]
    assert any("commit_gate.py" in str(b) for b in bash_matchers)


def test_settings_json_includes_error_tracker_in_post_hooks() -> None:
    import json
    analysis = _base_analysis()
    rendered = render_profile(analysis)
    settings = json.loads(rendered[".claude/settings.json"])
    post_blocks = settings["hooks"].get("PostToolUse", [])
    assert any("error_tracker.py" in str(b) for b in post_blocks)


def test_settings_json_includes_handoff_reminder_in_post_hooks() -> None:
    import json
    analysis = _base_analysis()
    rendered = render_profile(analysis)
    settings = json.loads(rendered[".claude/settings.json"])
    post_blocks = settings["hooks"].get("PostToolUse", [])
    assert any("handoff_reminder.py" in str(b) for b in post_blocks)


def test_plan_command_ref_includes_wiki_read_step() -> None:
    analysis = _base_analysis()
    rendered = render_profile(analysis)
    plan_ref = rendered[".claude/skills/planning-work/references/command.md"]
    assert "wiki/index.md" in plan_ref
    assert "wiki" in plan_ref.lower()
    assert "multi-model completion audit" in plan_ref
    assert "Engineering Quality Contract" in plan_ref


def test_plan_command_ref_requires_complete_review_pass() -> None:
    for tier in (
        "claude-only",
        "codex-only",
        "gemini-only",
        "claude-codex",
        "claude-gemini",
        "codex-gemini",
        "full-moe",
    ):
        analysis = _base_analysis()
        analysis["moe_tier"] = tier
        rendered = render_profile(analysis)
        plan_ref = rendered[".claude/skills/planning-work/references/command.md"]
        assert "Do one full pass before deciding the review outcome" in plan_ref
        assert "Do not stop after the" in plan_ref
        assert "Treat fixable plan problems as corrections, not blockers" in plan_ref
        assert "excludes the active lead agent" in plan_ref
        assert "same-agent review is local sanity evidence only" in plan_ref.lower()
        assert "Nonblocking suggestions:" in plan_ref


def test_execute_command_ref_includes_handoff_update_step() -> None:
    analysis = _base_analysis()
    rendered = render_profile(analysis)
    execute_ref = rendered[".claude/skills/executing-plans/references/command.md"]
    assert "HANDOFF" in execute_ref
    assert "UPDATE.txt" in execute_ref
    assert "Engineering Quality Receipt" in execute_ref


def test_loop_command_ref_includes_wiki_exit_condition() -> None:
    analysis = _base_analysis()
    rendered = render_profile(analysis)
    loop_ref = rendered[".claude/skills/looping-to-completion/references/command.md"]
    assert "wiki" in loop_ref.lower()
    assert "log.md" in loop_ref
    assert "multi-model completion audit" in loop_ref
    assert "excludes the active lead agent" in loop_ref
    assert "same-agent" in loop_ref
    assert "nonblocking" in loop_ref.lower()
    assert "suggestions:" in loop_ref


def test_review_and_audit_commands_are_generated() -> None:
    analysis = _base_analysis()
    rendered = render_profile(analysis)
    review_ref = rendered[".claude/skills/reviewing-work/references/command.md"]
    audit_ref = rendered[".claude/skills/auditing-completion/references/command.md"]
    assert "Do not stop after the first issue" in review_ref
    assert "Engineering Quality Receipts" in audit_ref
    assert "No closeable gap remains" in audit_ref
    assert "verdict: APPROVED" in audit_ref


def test_wiki_skill_body_contains_preflight_reference() -> None:
    analysis = _base_analysis()
    rendered = render_profile(analysis)
    wiki_skill = rendered[".claude/skills/maintaining-wiki/SKILL.md"]
    assert "preflight" in wiki_skill.lower()
    assert "harness wiki preflight" in wiki_skill


def test_wiki_command_ref_contains_cli_commands() -> None:
    analysis = _base_analysis()
    rendered = render_profile(analysis)
    wiki_ref = rendered[".claude/skills/maintaining-wiki/references/command.md"]
    assert "harness wiki preflight" in wiki_ref
    assert "harness wiki status" in wiki_ref
    assert "harness wiki lint" in wiki_ref
    assert "harness wiki maintain" in wiki_ref
    assert "harness wiki search" in wiki_ref
    assert "harness wiki query" in wiki_ref
    assert "harness wiki ingest" in wiki_ref


def test_core_profile_includes_wiki_hooks() -> None:
    analysis = _base_analysis()
    rendered = render_profile(analysis)
    assert ".claude/hooks/pre/wiki_receipt_guard.py" in rendered
    assert ".claude/hooks/post/wiki_sweep.py" in rendered
    assert len(rendered[".claude/hooks/pre/wiki_receipt_guard.py"]) > 50
    assert len(rendered[".claude/hooks/post/wiki_sweep.py"]) > 50


def test_wiki_settings_json_has_no_workspace_specific_paths() -> None:
    import json
    analysis = _base_analysis()
    rendered = render_profile(analysis)
    assert ".claude/state/config/wiki_settings.json" in rendered
    wiki_settings = json.loads(rendered[".claude/state/config/wiki_settings.json"])
    settings_str = json.dumps(wiki_settings)
    forbidden = ["atlas_lq", "spokeo", "sagemaker", "/home/", "/tmp/", "s3://"]
    for term in forbidden:
        assert term.lower() not in settings_str.lower(), (
            f"Workspace-specific path in wiki_settings.json: found '{term}'"
        )
    assert wiki_settings["version"] == "1.0"
    assert wiki_settings["wiki_root"] == ".claude/wiki"
    assert "wiki_families" in wiki_settings
    assert wiki_settings["context_receipts"]["enforce_for_wiki_writes"] is True


def test_wiki_page_template_present() -> None:
    analysis = _base_analysis()
    rendered = render_profile(analysis)
    assert ".claude/wiki/Templates/page_template.md" in rendered
    template = rendered[".claude/wiki/Templates/page_template.md"]
    assert "Summary" in template
    assert "Authority And Recency" in template
    assert "Source Artifacts" in template
    assert "Related Pages" in template


def test_settings_json_includes_wiki_receipt_guard_for_edit_write() -> None:
    import json
    analysis = _base_analysis()
    rendered = render_profile(analysis)
    settings = json.loads(rendered[".claude/settings.json"])
    edit_write_matchers = [
        block
        for matcher_list in settings["hooks"].get("PreToolUse", [])
        for block in [matcher_list]
        if "Edit|Write" in str(block.get("matcher", ""))
    ]
    assert any("wiki_receipt_guard.py" in str(b) for b in edit_write_matchers)
    assert any("engineering_quality_guard.py" in str(b) for b in edit_write_matchers)


def test_settings_json_includes_wiki_sweep_in_post_hooks() -> None:
    import json
    analysis = _base_analysis()
    rendered = render_profile(analysis)
    settings = json.loads(rendered[".claude/settings.json"])
    post_blocks = settings["hooks"].get("PostToolUse", [])
    assert any("wiki_sweep.py" in str(b) for b in post_blocks)


def test_generated_engineering_quality_skill_and_reference_present() -> None:
    analysis = _base_analysis()
    rendered = render_profile(analysis)
    skill = rendered[".claude/skills/agent-engineering-quality/SKILL.md"]
    reference = rendered[
        ".claude/skills/agent-engineering-quality/references/comprehensive_100pct_execution_default.md"
    ]
    wiki_page = rendered[".claude/wiki/wiki/reference/agent-engineering-quality-standard.md"]
    assert "/plan -> multi-model plan consensus -> /execute -> /loop -> multi-model completion audit -> done" in skill
    assert "Assumption Test" in reference
    assert "Context-Receipt" in reference
    assert "Independent Multi-Model Review" in reference
    assert "same-agent review is local sanity evidence only" in reference
    assert "Nonblocking suggestions:" in reference
    assert "Agent Engineering Quality Standard" in wiki_page
    assert "Exclude the active lead agent" in wiki_page
