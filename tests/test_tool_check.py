from __future__ import annotations

import pytest

from agentos_harness.tool_check import (
    TOOL_REGISTRY,
    detect_tools,
    moe_tier,
    parse_tools_flag,
    run_tool_wizard,
)


def test_detect_tools_returns_all_keys() -> None:
    result = detect_tools()
    assert set(result.keys()) == {"claude", "codex", "gemini"}


def test_detect_tools_values_are_bool() -> None:
    result = detect_tools()
    for value in result.values():
        assert isinstance(value, bool)


def test_moe_tier_claude_only() -> None:
    assert moe_tier({"claude": True, "codex": False, "gemini": False}) == "claude-only"


def test_moe_tier_claude_codex() -> None:
    assert moe_tier({"claude": True, "codex": True, "gemini": False}) == "claude-codex"


def test_moe_tier_claude_gemini() -> None:
    assert moe_tier({"claude": True, "codex": False, "gemini": True}) == "claude-gemini"


def test_moe_tier_full_moe() -> None:
    assert moe_tier({"claude": True, "codex": True, "gemini": True}) == "full-moe"


def test_moe_tier_no_claude_uses_available_pair() -> None:
    assert moe_tier({"claude": False, "codex": True, "gemini": True}) == "codex-gemini"


def test_moe_tier_codex_only() -> None:
    assert moe_tier({"claude": False, "codex": True, "gemini": False}) == "codex-only"


def test_moe_tier_gemini_only() -> None:
    assert moe_tier({"claude": False, "codex": False, "gemini": True}) == "gemini-only"


def test_moe_tier_no_agent() -> None:
    assert moe_tier({"claude": False, "codex": False, "gemini": False}) == "no-agent"


def test_parse_tools_flag_single() -> None:
    result = parse_tools_flag("claude")
    assert result == {"claude": True, "codex": False, "gemini": False}


def test_parse_tools_flag_multiple() -> None:
    result = parse_tools_flag("claude,codex")
    assert result == {"claude": True, "codex": True, "gemini": False}


def test_parse_tools_flag_all() -> None:
    result = parse_tools_flag("claude,codex,gemini")
    assert result == {"claude": True, "codex": True, "gemini": True}


def test_parse_tools_flag_unknown_raises() -> None:
    with pytest.raises(ValueError, match="Unknown tool"):
        parse_tools_flag("invalid")


def test_parse_tools_flag_mixed_valid_invalid_raises() -> None:
    with pytest.raises(ValueError):
        parse_tools_flag("claude,notreal")


def test_run_tool_wizard_non_interactive_returns_dict() -> None:
    result = run_tool_wizard(interactive=False)
    assert "claude" in result
    assert isinstance(result["claude"], bool)


def test_run_tool_wizard_non_interactive_no_prompts(monkeypatch: pytest.MonkeyPatch) -> None:
    called = []
    monkeypatch.setattr("builtins.input", lambda _: called.append(True) or "")
    run_tool_wizard(interactive=False)
    assert not called, "Non-interactive wizard should not call input()"


def test_run_tool_wizard_interactive_skip_all(monkeypatch: pytest.MonkeyPatch) -> None:
    """Interactive wizard with Enter skips installing missing tools."""
    monkeypatch.setattr("builtins.input", lambda _: "")
    result = run_tool_wizard(interactive=True)
    assert "claude" in result
    assert isinstance(result["claude"], bool)


def test_run_tool_wizard_interactive_unknown_tool(monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    """Interactive wizard handles unknown tool name gracefully."""
    inputs = iter(["notreal", ""])
    monkeypatch.setattr("builtins.input", lambda _: next(inputs, ""))
    result = run_tool_wizard(interactive=True)
    captured = capsys.readouterr()
    assert "Unknown tool" in captured.out or "claude" in result


def test_tool_registry_has_required_keys() -> None:
    assert "claude" in TOOL_REGISTRY
    assert "codex" in TOOL_REGISTRY
    assert "gemini" in TOOL_REGISTRY


def test_tool_registry_claude_is_optional() -> None:
    assert TOOL_REGISTRY["claude"].required is False


def test_tool_registry_codex_and_gemini_are_optional() -> None:
    assert TOOL_REGISTRY["codex"].required is False
    assert TOOL_REGISTRY["gemini"].required is False


def test_tool_registry_install_commands_present() -> None:
    for key, spec in TOOL_REGISTRY.items():
        assert "npm install" in spec.install_cmd, f"{key} missing npm install command"
