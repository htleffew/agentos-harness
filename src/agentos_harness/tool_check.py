"""AI tool detection and interactive wizard for harness setup."""

from __future__ import annotations

import shutil
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass


@dataclass(frozen=True)
class ToolSpec:
    name: str
    install_cmd: str
    required: bool
    role: str


TOOL_REGISTRY: dict[str, ToolSpec] = {
    "claude": ToolSpec(
        name="Claude Code CLI",
        install_cmd="npm install -g @anthropic-ai/claude-code",
        required=False,
        role="Optional. Semantic orchestration, review, and Claude Code workflows.",
    ),
    "codex": ToolSpec(
        name="Codex CLI",
        install_cmd="npm install -g @openai/codex",
        required=False,
        role="Optional. Deterministic code dispatch from /plan and /execute.",
    ),
    "gemini": ToolSpec(
        name="Gemini CLI",
        install_cmd="npm install -g @google/gemini-cli",
        required=False,
        role="Optional. Long-context parsing and visual analysis.",
    ),
}


def detect_tools() -> dict[str, bool]:
    """Return {tool_key: is_present} for all tools in TOOL_REGISTRY."""
    result: dict[str, bool] = {}
    for key in TOOL_REGISTRY:
        result[key] = shutil.which(key) is not None
    return result


def run_tool_wizard(interactive: bool = True) -> dict[str, bool]:
    """Run the interactive tool detection and install wizard.

    When interactive=False, returns detect_tools() result without any prompts.
    """
    if not interactive:
        return detect_tools()

    detected = detect_tools()
    print("Checking AI tools...")

    for key, spec in TOOL_REGISTRY.items():
        if detected.get(key):
            print(f"  ✓ {spec.name}")
        else:
            print(f"  ✗ {spec.name}  -- not found")

    missing_optional = [
        key for key, spec in TOOL_REGISTRY.items()
        if not detected.get(key)
    ]

    if missing_optional:
        print()
        for key in missing_optional:
            spec = TOOL_REGISTRY[key]
            print(f"  {spec.role}")
            print(f"  Install: {spec.install_cmd}")
        print()
        raw_choice = input("Install optional AI tools now? [y/N/o] ").strip().lower()

        requested: list[str] = []
        if raw_choice == "y":
            requested = missing_optional
        elif raw_choice == "o":
            raw_selection = input(
                "Enter names of tools to install, separated by commas: "
            ).strip()
            requested = [t.strip().lower() for t in raw_selection.split(",") if t.strip()]

        if requested:
            for key in requested:
                if key not in TOOL_REGISTRY:
                    print(f"  Unknown tool '{key}', skipping.")
                    continue
                spec = TOOL_REGISTRY[key]
                print(f"\n  Run this command in another terminal:")
                print(f"  {spec.install_cmd}")
                skip = input("  Press Enter when done, or type 's' to skip this tool: ").strip().lower()
                if skip == "s":
                    print(f"  Skipping {spec.name}.")

    print()
    final = detect_tools()
    print("Re-checking AI tools...")
    for key, spec in TOOL_REGISTRY.items():
        status = "✓" if final.get(key) else "✗"
        print(f"  {status} {spec.name}")

    confirmed_keys = [k for k, v in final.items() if v]
    print(f"\nContinuing with: {', '.join(confirmed_keys) if confirmed_keys else 'none'}")
    return final


def parse_tools_flag(tools_str: str) -> dict[str, bool]:
    """Parse a comma-separated tools string into a detection result dict.

    Example: parse_tools_flag("claude,codex") -> {"claude": True, "codex": True, "gemini": False}
    Raises ValueError for unknown tool names.
    """
    valid_keys = set(TOOL_REGISTRY.keys())
    requested = [t.strip().lower() for t in tools_str.split(",") if t.strip()]
    unknown = [t for t in requested if t not in valid_keys]
    if unknown:
        raise ValueError(
            f"Unknown tool(s): {', '.join(unknown)}. Valid options: {', '.join(sorted(valid_keys))}"
        )
    return {key: (key in requested) for key in TOOL_REGISTRY}


def moe_tier(detected: dict[str, bool]) -> str:
    """Return the MoE tier string for the detected tool set.

    Returns one of: "no-agent", "claude-only", "codex-only", "gemini-only",
    "claude-codex", "claude-gemini", "codex-gemini", or "full-moe".
    """
    has_claude = detected.get("claude", False)
    has_codex = detected.get("codex", False)
    has_gemini = detected.get("gemini", False)

    if not has_claude:
        if has_codex and has_gemini:
            return "codex-gemini"
        if has_codex:
            return "codex-only"
        if has_gemini:
            return "gemini-only"
        return "no-agent"
    if has_codex and has_gemini:
        return "full-moe"
    if has_codex:
        return "claude-codex"
    if has_gemini:
        return "claude-gemini"
    return "claude-only"
