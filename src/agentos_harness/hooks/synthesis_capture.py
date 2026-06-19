#!/usr/bin/env python3
"""PostToolUse hook: detect multi-source synthesis and propose wiki candidates.

When a Write or Edit follows multiple Read operations on different files,
this suggests a synthesis occurred. The hook captures these as wiki candidates
for the closed-loop wiki compounding pattern.

This hook is part of the agentos-harness wiki infrastructure and
implements the Karpathy LLM Wiki pattern's automatic synthesis detection.
"""
import json
import os
import sys
import select
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path


STATE_FILE = ".claude/state/runtime/synthesis_tracking.json"
CANDIDATES_FILE = ".claude/state/curation/learning_candidates.json"
WIKI_PATHS = {".claude/wiki/", ".claude/state/curation/"}
MIN_READS_FOR_SYNTHESIS = 2
MAX_RECENT_READS = 20


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _load_state(project_dir: str) -> dict:
    state_path = Path(project_dir) / STATE_FILE
    if state_path.exists():
        try:
            return json.loads(state_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, IOError):
            pass
    return {"recent_reads": [], "last_updated": None}


def _save_state(project_dir: str, state: dict) -> None:
    state_path = Path(project_dir) / STATE_FILE
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state["last_updated"] = _utc_now()
    state_path.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")


def _is_wiki_path(file_path: str) -> bool:
    return any(wiki_prefix in file_path for wiki_prefix in WIKI_PATHS)


def _load_candidates(project_dir: str) -> dict:
    candidates_path = Path(project_dir) / CANDIDATES_FILE
    if candidates_path.exists():
        try:
            return json.loads(candidates_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, IOError):
            pass
    return {"generated_at": _utc_now(), "candidates": []}


def _save_candidates(project_dir: str, candidates: dict) -> None:
    candidates_path = Path(project_dir) / CANDIDATES_FILE
    candidates_path.parent.mkdir(parents=True, exist_ok=True)
    candidates["generated_at"] = _utc_now()
    candidates_path.write_text(json.dumps(candidates, indent=2) + "\n", encoding="utf-8")


def _infer_title(file_path: str) -> str:
    stem = Path(file_path).stem
    return stem.replace("_", " ").replace("-", " ").title()


def _infer_family(file_path: str) -> str:
    lower = file_path.lower()
    if "reference" in lower or "doc" in lower:
        return "reference"
    if "method" in lower or "script" in lower:
        return "methods"
    if "system" in lower or "config" in lower:
        return "systems"
    if "workflow" in lower or "process" in lower:
        return "workflows"
    return "reference"


def main():
    stdin_has_data = select.select([sys.stdin], [], [], 0.0)[0]
    if not stdin_has_data:
        sys.exit(0)

    try:
        hook_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        sys.exit(0)

    project_dir = os.environ.get("CLAUDE_PROJECT_DIR", "")
    if not project_dir:
        sys.exit(0)

    tool_name = hook_data.get("tool_name", "")
    tool_input = hook_data.get("tool_input", {})
    hook_event = hook_data.get("hook_event_name", "")

    if hook_event == "PostToolUseFailure":
        sys.exit(0)

    state = _load_state(project_dir)

    if tool_name == "Read":
        file_path = tool_input.get("file_path", "")
        if file_path and not _is_wiki_path(file_path):
            state["recent_reads"].append({
                "file": file_path,
                "ts": _utc_now(),
            })
            state["recent_reads"] = state["recent_reads"][-MAX_RECENT_READS:]
            _save_state(project_dir, state)
        sys.exit(0)

    if tool_name in ("Write", "Edit"):
        file_path = tool_input.get("file_path", "")
        if not file_path or _is_wiki_path(file_path):
            state["recent_reads"] = []
            _save_state(project_dir, state)
            sys.exit(0)

        recent_reads = state.get("recent_reads", [])
        unique_files = list(dict.fromkeys(r["file"] for r in recent_reads))

        if len(unique_files) >= MIN_READS_FOR_SYNTHESIS:
            candidates = _load_candidates(project_dir)
            candidate_id = f"synthesis-{sha256(file_path.encode()).hexdigest()[:12]}"
            existing = next(
                (c for c in candidates.get("candidates", []) if c.get("id") == candidate_id),
                None
            )
            if not existing:
                candidates.setdefault("candidates", []).append({
                    "id": candidate_id,
                    "type": "synthesis",
                    "target_file": file_path,
                    "source_files": unique_files[:10],
                    "proposed_wiki_family": _infer_family(file_path),
                    "proposed_slug": Path(file_path).stem,
                    "proposed_title": _infer_title(file_path),
                    "proposed_summary": f"Synthesis of {len(unique_files)} sources into {Path(file_path).name}.",
                    "confidence": min(0.9, 0.5 + 0.1 * len(unique_files)),
                    "created_at": _utc_now(),
                })
                _save_candidates(project_dir, candidates)

        state["recent_reads"] = []
        _save_state(project_dir, state)

    sys.exit(0)


if __name__ == "__main__":
    main()
