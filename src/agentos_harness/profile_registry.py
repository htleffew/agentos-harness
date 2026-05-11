"""Generated harness profile registry."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .models import content_hash, stable_json
from .project_detector import render_agents_project_table
from .setup_modules import module_source_for_hash, render_module_targets, selected_module_ids


def _load_hook(filename: str) -> str:
    hook_path = Path(__file__).parent / "hooks" / filename
    return hook_path.read_text(encoding="utf-8")


CORE_PROFILE_NAME = "core"
CORE_PROFILE_VERSION = "2.3.2"

_ADAPTIVE_WORKFLOW_PAGES = {
    "ci-release": ("CI Release Workflow", "ci-release.md"),
    "docs-site": ("Documentation Workflow", "docs-site.md"),
    "monorepo": ("Monorepo Boundary Workflow", "monorepo-boundaries.md"),
    "notebook-workspace": ("Notebook Workspace Workflow", "notebook-workspace.md"),
    "python-package": ("Python Package Workflow", "python-package.md"),
    "typescript-app": ("TypeScript Application Workflow", "typescript-app.md"),
}


@dataclass(frozen=True)
class WorkflowSpec:
    skill: str         # skill directory name, e.g. "workspace-status"
    command: str       # slash command name, e.g. "status"
    description: str   # SKILL.md frontmatter description
    skill_body: str    # SKILL.md body markdown (overview, points to references/)
    command_ref: str   # references/command.md content; empty string = MoE-aware


# ---------------------------------------------------------------------------
# Skill content
# ---------------------------------------------------------------------------

_STATUS_SKILL_BODY = """\
# Workspace Status

Read `references/command.md` for the full workflow.

Reports current repository state: git status, active plans, detected projects,
and open blockers. Lead with the most important finding. Keep output under 40 lines.

## When To Use

Use at the start of a session, after a context break, or when unsure what work
remains in a repository.

## Bundled Resources

- `references/command.md`: four-phase status workflow.
"""

_STATUS_COMMAND_REF = """\
# /status Reference

## Phase 1: Git State

Run `git status` and `git log --oneline -10`. Report the current branch, any
dirty files, and the last 10 commit messages.

## Phase 2: Active Plans

Search for plan files:

```bash
find .claude/state/plans/active projects/*/internal/plans/active \\
  -name "*.md" 2>/dev/null
```

For each plan found, read the frontmatter only (status, created fields). Flag
any plan that has not had a git commit in more than seven days as stale.

## Phase 3: Repository Structure

Read `AGENTS.md` if it exists. Report the project index table and operating
posture section. Read `.claude/wiki/index.md` if it exists; report the page
count and any pages flagged for maintenance.

## Phase 4: Blockers

For each file matching `projects/*/HANDOFF.md` or `<root>/HANDOFF.md`, read
the "## Blockers" or "## Next Safe Action" section. Aggregate and report all
open blockers.

## Output Contract

- Maximum 40 lines total.
- Lead with the most important finding.
- No padded prose; only findings and references.
- If no blockers or active plans are found, state that explicitly.
"""

_PROMPT_SKILL_BODY = """\
# Generating Prompts

Read `references/command.md` for the full workflow.

Generates a self-contained continuation prompt for resuming incomplete work in
a new session. The prompt is addressed to a future agent and includes the task
description, current state, what remains, key decisions already made, and the
next specific action.

## When To Use

Use when a session is ending with work incomplete, or when the user wants a
resumption prompt to hand off to a new session.

## Bundled Resources

- `references/command.md`: three-phase prompt generation workflow.
"""

_PROMPT_COMMAND_REF = """\
# /prompt Reference

## Phase 1: Identify Current Task

Identify the current task from conversation context. Note:
- What has been done in this session.
- What is currently in progress.
- What remains to reach completion.

## Phase 2: Inventory State

Identify the relevant files and their current state. Note any decisions made
during this session that a future agent would need to know to proceed safely.
Include:
- Which files were modified and how.
- Which verification commands were run and passed.
- Which verification commands were skipped or failed.
- Any open questions or unresolved choices.

## Phase 3: Format the Continuation Prompt

Write a continuation prompt under 400 words addressed to a future agent:

> Continue the following work: [task description]
>
> Current state: [1-3 sentences on what exists now]
>
> What remains: [bulleted list]
>
> Key decisions already made: [bulleted list, one sentence each]
>
> Next action: [one specific sentence on where to start]

Print the prompt to the conversation. Do not write it to a file unless the user
explicitly requests it.
"""

_WIKI_SKILL_BODY = """\
# Maintaining Wiki

Read `references/command.md` for the full workflow.

Maintains the local markdown wiki at `.claude/wiki/` as the repository
synthesis layer. Source files remain authoritative; the wiki synthesizes across
them for fast cross-session agent orientation.

## When To Use

Use when durable context changes, when source artifacts are updated, or when
an agent needs retained cross-session knowledge that is not obvious from reading
source files directly.

## Preflight Requirement

Before any write-capable wiki work, run:

```bash
harness wiki preflight . --task "<task description>"
```

This mints a context receipt that gates protected wiki mutations. The receipt
captures required reads, candidate pages, and a freshness window. Without a
valid receipt, write-capable wiki operations are blocked.

## Maintenance Backlog

The wiki tracks a semantic-maintenance backlog for source changes that deserve
wiki updates. Check pending entries with:

```bash
harness wiki status .
harness wiki maintain .
```

Backlog entries are created when source artifacts change in ways that likely
require wiki synthesis updates.

## Structure

- `.claude/wiki/index.md` -- table of contents and maintenance log pointer
- `.claude/wiki/log.md` -- append-only maintenance history
- `.claude/wiki/wiki/**/*.md` -- content pages by topic
- `.claude/wiki/Templates/` -- page templates for consistent structure

## Bundled Resources

- `references/command.md`: preflight, ingest, query, maintain, and lint workflows.
"""

_WIKI_COMMAND_REF = """\
# /wiki Reference

The wiki is the single synthesis layer for this repository. Source files remain
authoritative; the wiki synthesizes across them.

## CLI Commands

All wiki operations use the harness CLI:

```bash
harness wiki preflight . --task "<task description>"
harness wiki status .
harness wiki lint .
harness wiki maintain .
harness wiki search . "<query>"
harness wiki query . "<query>"
harness wiki ingest . --source <path> --family <family> --slug <slug>
```

## Preflight Workflow

Run this before any write-capable wiki work:

1. Identify the task, changed sources, or maintenance entry.
2. Run `harness wiki preflight . --task "<description>"` with relevant source
   and page-ref arguments.
3. Read the surfaced context pack.
4. Proceed with write-capable wiki operations.

The preflight receipt gates protected wiki mutations. Without a valid receipt,
write-capable operations are blocked.

## Ingest Workflow

Run this when a source artifact changes and durable context should be updated.

1. Run `harness wiki preflight . --task "<description>" --source <path>`.
2. Read the changed source artifact.
3. Read `.claude/wiki/index.md` to locate affected wiki pages.
4. Edit the affected wiki pages to reflect the change. Open each page with its
   current conclusion or finding. Do not start with background.
5. Run `harness wiki ingest . --source <path> --family <family> --slug <slug>`.
6. Update `.claude/wiki/index.md` if pages were added or removed.
7. Append a log entry to `.claude/wiki/log.md`:

```
## YYYY-MM-DDTHH:MM:SSZ | <task-name>
One-line summary of what changed.
```

## Query Workflow

Run this when an agent needs cross-session context before starting work.

1. Run `harness wiki preflight . --task "<description>"` for read context.
2. Run `harness wiki query . "<query>"` to search and synthesize.
3. Read the content pages relevant to the current task.
4. Synthesize an answer from wiki content, citing the source pages.
5. If the query reveals a missing or stale page, add a maintenance entry to the
   log and update or create the page before proceeding.

## Maintenance Backlog Workflow

Run this to catch up on semantic wiki work from prior sessions:

1. Run `harness wiki status .` to see pending backlog entries.
2. Run `harness wiki maintain .` to inspect the backlog.
3. For each entry, run `harness wiki preflight . --maintenance-entry <id>`.
4. Read the changed sources and candidate wiki pages.
5. Edit affected wiki pages semantically.
6. Close the entry with `harness wiki maintain . --complete-entry <id>`.
7. Run `harness wiki lint .` to verify structural integrity.

## Authoring Rules

- Do not write findings to standalone markdown files outside the wiki.
- Do not duplicate source-file content; synthesize and cite instead.
- Do not use em-dashes, banned prose terms, or metacommentary.
- The wiki compounds knowledge; scattered files do not.
- Use templates from `.claude/wiki/Templates/` for consistent page structure.
"""

_AGENT_ENGINEERING_QUALITY_SKILL_BODY = """\
# Agent Engineering Quality

Read `references/comprehensive_100pct_execution_default.md` for the full
standard.

Defines the default non-trivial work contract for this harness:

`/plan -> multi-model plan consensus -> /execute -> /loop -> multi-model completion audit -> done`

## When To Use

Use when a task requires planning, implementation, review, or validation across
more than one file or step. This standard applies by default unless the user
explicitly requests planning-only, analysis-only, or no file changes.

## Bundled Resources

- `references/comprehensive_100pct_execution_default.md`: assumption,
  simplicity, surgicality, verification, receipt, and multi-model requirements.
"""

_AGENT_ENGINEERING_QUALITY_REFERENCE = """\
# Comprehensive 100% Execution Default

This harness defaults non-trivial work to the full chain:

`/plan -> multi-model plan consensus -> /execute -> /loop -> multi-model completion audit -> done`

## Assumption Test

State assumptions, ambiguity, tradeoffs, and authority boundaries before
implementation.

## Simplicity Test

Choose the simplest sufficient design. Add complexity only when it removes a
real correctness, auditability, or usability gap.

## Surgicality Test

Every changed file and line must trace to the request, target state,
verification, cleanup caused by the change, or the minimal scaffolding needed
to enforce the contract.

## Verification Test

Every success claim must be backed by a command, artifact inspection, review
record, or explicit proof.

## Cold-Readable Planning

Plans for non-trivial work must define:

- exact target deliverable and file paths
- exact remaining work
- expected behavior, function, interactivity, display, style, look, feel, and tone
- narrative prose and visual requirements when material
- validators, review gates, and pass/fail criteria
- work chunks with explicit verification

## Context Receipt

Every top-level and dispatched agent must report:

- `Context-Receipt`
- `Wiki-Index`
- `Skill-Index`
- `Skills-Selected`
- `Project-Continuity`
- `Source-Artifacts`
- `Engineering-Quality-Standard`
- `Validators-Planned`

Missing receipts invalidate the returned work.

## Completion Rule

`/loop` is not complete until the work product conforms to the final-state spec,
no closeable gap remains, deterministic validation passes, and the multi-model
completion audit returns explicit approval verdicts.

## Independent Multi-Model Review

Multi-model plan consensus and completion audit use independent reviewers only.
The active lead agent is omitted from the consensus or audit reviewer set;
same-agent review is local sanity evidence only. If generated launchers define
an active-agent signal, use it to exclude the lead. Optional refinements and
minor preferences belong under `Nonblocking suggestions:` and do not block
approval.
"""

_ORIENT_SKILL_BODY = """\
# Orienting Session

Read `references/command.md` for the full workflow.

Produces a prioritized session agenda from git state, active plans, and project
blockers. Works with git and local plan files only; no external ticket system
required.

## When To Use

Use when starting a work session to determine where to focus first. Prefer this
over reading HANDOFF files directly when context is cold.

## Bundled Resources

- `references/command.md`: four-phase orient workflow and agenda format.
"""

_ORIENT_COMMAND_REF = """\
# /orient Reference

## Phase 1: Git State

Run `git log --oneline -20` and `git status`. Note the active branch and any
dirty files. Dirty files indicate work in progress.

## Phase 2: Active Plans

```bash
find .claude/state/plans/active projects/*/internal/plans/active \\
  -name "*.md" 2>/dev/null
```

For each plan, read frontmatter only (status, created). Flag plans with no git
activity in more than seven days as stale. List in-progress plans with their
creation date.

## Phase 3: Blockers

For each `HANDOFF.md` file under `projects/`, read the "## Blockers" section
if present. Aggregate all blockers into one list.

## Phase 4: Session Agenda

Produce a session agenda of no more than 60 lines:

- Priority 1: Unblock anything that is blocking multiple downstream items.
- Priority 2: Advance in-progress plans to completion.
- Priority 3: Start new work in the most important open area.

State each agenda item as one sentence: what to do and where to start.
"""

_LOOP_SKILL_BODY = """\
# Looping to Completion

Read `references/command.md` for the full workflow.

Applies the 100% rule to any deliverable by cycling gap analysis, planning,
and execution until nothing is missing. Partial completion does not count:
75% complete is 0%.

## When To Use

Use when a deliverable must reach complete state and partial progress is not
acceptable. Requires a defined final state and a validation command before
starting.

## Bundled Resources

- `references/command.md`: scope gate, loop cycle, routing guidance, and exit
  conditions.
"""

_LOOP_COMMAND_REF = """\
# /loop Reference

The 100% rule: 75% complete is 0%. 90% complete is 0%. Only fully complete
work has value.

For non-trivial work, `/plan` is the start of the full default chain:

`/plan -> multi-model plan consensus -> /execute -> /loop -> multi-model completion audit -> done`

## Scope Gate

Do not begin until all four are defined:

1. The target deliverable (name it).
2. The final state (write down exactly what 100% looks like).
3. The target file set (exactly which files will change).
4. The validation command (a command that exits 0 when and only when the
   deliverable is complete).

Record these four items before the first loop cycle.

## Loop Cycle

1. Gap analysis: compare current state against the final state. List every gap.
2. If the gap list is empty, the validation command exits 0, the work product
   conforms to the final state, and multi-model completion evidence exists: exit the
   loop. The deliverable is complete.
3. If gaps remain: run /plan against the gap list.
4. Run /execute on the resulting plan.
5. Return to step 1.

## Routing Work

Read `AGENTS.md` Operating Posture section to determine routing:

- Claude-only: Claude executes all steps. Use the Task tool for parallel
  independent work within a session.
- Claude and Codex: Claude orchestrates and reviews. Codex executes
  deterministic code chunks.
- Full triad: route per the three-tool table in AGENTS.md.

## Exit Conditions

All of the following must be true before exiting:

- Gap analysis is empty.
- Validation command exits 0.
- All target files exist and contain complete content.
- No stubs, T-O-D-O markers, placeholders, or disabled features remain in target files.
- Completed chunks include Engineering Quality Receipts.
- Material prose, visual, behavior, function, interactivity, display, style,
  look, feel, and tone requirements were checked.
- Multi-model completion audit evidence records explicit verdict lines.
- Multi-model completion audit excludes the active lead agent; same-agent
  review is local sanity evidence only.
- Optional refinements and minor preferences belong under `Nonblocking
  suggestions:` and do not block approval.
- Durable context from this loop is captured: if execution revealed decisions,
  constraints, or patterns not already in `.claude/wiki/`, update the relevant
  pages and append to `.claude/wiki/log.md` before exiting.

Do not exit the loop until every condition is satisfied.
"""

_INVESTIGATE_SKILL_BODY = """\
# Investigating Questions

Read `references/command.md` for the full workflow.

Authors a research notebook to answer a specific question using the
Intent-Execute-Interpret cell pattern. Findings live in notebooks, not in
standalone markdown files.

## When To Use

Use when a question requires systematic investigation with data analysis and a
documented conclusion. Use when findings must be reproducible and traceable to
specific evidence.

## Bundled Resources

- `references/command.md`: pre-authoring steps, notebook location rules,
  cell-by-cell authoring discipline, and conclusion format.
"""

_INVESTIGATE_COMMAND_REF = """\
# /investigate Reference

Research findings live in notebooks, not standalone markdown files. Each
notebook answers one or more numbered research questions and emits a decision
code at its conclusion.

## Pre-Authoring

1. Locate or create the project research-questions document at
   `projects/<project>/internal/research_questions.md`. If it does not exist,
   create it with the question you are about to answer as Q1.
2. Read the existing questions to avoid duplicating answered work.
3. Define evidence needs and compute method before opening a notebook.

## Notebook Location

- Publishable findings: `projects/<project>/external/notebooks/`
- Exploratory or internal work: `projects/<project>/internal/research/`

## Cell-by-Cell Authoring

Never pre-write conclusions. For each analytical step:

1. INTENT cell (markdown): state what the next code cell computes and why.
2. CODE cell: write and execute the code.
3. Read the output completely before writing the next cell.
4. INTERPRET cell (markdown): first sentence is a specific finding with numbers
   and a claim. Connect subsequent sentences to prior findings. If output is
   surprising, the next INTENT cell must respond to that surprise.

## Notebook Conclusion

1. Write a conclusion cell referencing specific findings from earlier cells.
2. Emit a decision code: `<!-- decision: CODE -->` where CODE is a short
   descriptive token (e.g., `hypothesis_confirmed`, `approach_rejected`,
   `inconclusive`).
3. Update the research-questions document: mark the question as answered, note
   the notebook path and decision code.
4. Update the project HANDOFF.md research questions status section.

## Authoring Discipline

- Do not pre-write conclusions before analysis runs.
- Do not skip the INTENT cell.
- Do not write findings to standalone files outside the notebook.
"""

_REVIEW_SKILL_BODY = """\
# Reviewing Work

Read `references/command.md` for the full workflow.

Reviews plans, diffs, documentation, or generated harness surfaces in one
complete pass. Use when work needs defect discovery, cold-reader review, or
review-gate evidence before completion.

## When To Use

Use before approving a plan, after implementing a chunk with meaningful
behavior or prose changes, or when a reviewer must list every material finding
at once.

## Bundled Resources

- `references/command.md`: complete-pass review contract and verdict format.
"""

_REVIEW_COMMAND_REF = """\
# /review Reference

## Complete-Pass Contract

Review the requested plan, diff, documentation, generated workflow, or
validation evidence in one full pass before returning a verdict.

- Do not stop after the first issue.
- Inspect every requested surface even after finding a defect.
- Return all material findings in one response.
- Use deterministic validators for deterministic evidence.
- Use semantic review for prose, governance, user-facing clarity, and judgment.

## Verdict Format

Return one first-line verdict:

```text
verdict: APPROVED
verdict: CORRECT
verdict: BLOCKED
```

Use `CORRECT` for fixable findings. Use `BLOCKED` only for a true authority,
access, or evidence boundary that prevents a complete review.

Each finding must include path, section or chunk, issue, exact correction, and
why it matters.
"""

_AUDIT_SKILL_BODY = """\
# Auditing Completion

Read `references/command.md` for the full workflow.

Audits whether a deliverable satisfies the 100% rule. Use before claiming that
generated workflow, documentation, validation, and review gates are complete.

## When To Use

Use at the end of `/loop`, before moving a plan to completed, or whenever a
task claims no material gaps remain.

## Bundled Resources

- `references/command.md`: completion audit categories and approval standard.
"""

_AUDIT_COMMAND_REF = """\
# /audit Reference

## Completion Standard

Audit completion under the 100% rule. No closeable gap remains. A gap is
planned and executed; a blocker is a proven authority, access, or evidence
boundary.

## Required Coverage

Check:

- Plan status and location
- All chunks complete
- Engineering Quality Receipts
- Deterministic validators
- Tests
- Wiki updates
- Colleague-facing prose review
- Semantic or cold-reader review
- Architecture or generated-harness review
- Final output conformance
- Multi-model or multi-review signatures

## Verdict Format

Return one first-line verdict:

```text
verdict: APPROVED
verdict: CORRECT
verdict: BLOCKED
```

Use `APPROVED` only when every applicable coverage item passes. Use `CORRECT`
for fixable completion gaps. Use `BLOCKED` only when the audit cannot be
completed from available authority or evidence.
"""

_SUGGEST_SKILL_BODY = """\
# Suggesting Skills

Read `references/command.md` for the full workflow.

Generates new custom skill definitions for this repository conforming to the
Anthropic agent skills specification. Read `.claude/SKILL_STANDARDS.md` before
generating anything.

## When To Use

Use when you want to add a new workflow skill tailored to this repository's
tech stack or domain. Use after running `harness audit .` shows a gap in
workflow coverage.

## Bundled Resources

- `references/command.md`: five-phase discovery, definition, generation,
  evaluation, and feedback workflow.
"""

_SUGGEST_COMMAND_REF = """\
# /suggest Reference

Read `.claude/SKILL_STANDARDS.md` before generating anything. Read
`.harness/state/analysis.json` to understand detected repository patterns.

## Phase 1: Discovery

Identify what is missing. Ask:
- What repetitive tasks does this repository involve?
- What context requires repeated re-explanation to agents?
- What workflows are fragile without documented steps?

List up to five candidate skill ideas.

## Phase 2: Define Each Candidate

For each candidate, define:
- name: lowercase-hyphenated, gerund preferred, 64 characters maximum
- description: third person, WHAT and WHEN, 100 words maximum
- trigger phrases: three to five natural-language phrases that should activate
  the skill
- workflow steps: three to eight concrete steps a future agent would follow
- external references: any files the skill would point to

## Phase 3: Generate the SKILL.md

- Write frontmatter: name and description fields.
- Write body: brief overview pointing to `references/command.md` for detail.
- Keep body under 100 lines. Move detailed workflow steps to
  `references/command.md`.
- Validate: name 64 characters maximum, description 1024 characters maximum,
  third person, WHAT and WHEN present.
- Run `harness audit .` and fix any reported errors before proceeding.

## Phase 4: Evaluation Stubs

For each generated skill, write three evaluation scenarios as markdown saved
to `.claude/skills/<name>/evaluations.md`:

- Scenario 1: the canonical trigger phrase and expected agent behavior.
- Scenario 2: a variant trigger phrase. Same expected behavior.
- Scenario 3: a non-trigger phrase that should NOT activate the skill.

## Phase 5: Feedback Loop

After generating, test the skill with a real request. Observe:
- Does the agent select the skill when expected?
- Does the agent read the right reference files?
- Does the agent follow the workflow steps?

Refine the skill based on observed gaps. Return to Phase 3 if steps need
revision.
"""


def _plan_command_ref(tier: str) -> str:
    common_header = """\
# /plan Reference

Investigate a topic and produce a chunked work plan. Do not begin implementation
until the plan is specific enough for another reviewer to execute without prior
context.

For non-trivial work, saying `proceed with /plan` means the harness prepares
the full chain:

`/plan -> multi-model plan consensus -> /execute -> /loop -> multi-model completion audit -> done`

## Phase 1: Investigate

Start by reading the wiki:

1. Read `.claude/wiki/index.md` to locate relevant pages.
2. Read every wiki page that covers the affected subsystem, known patterns, or
   prior decisions. Do not re-investigate what the wiki already answers.
3. Read the relevant HANDOFF.md if this is project-scoped work.
4. Read relevant source files and existing plans. Identify the scope, affected
   file paths, unknowns, and risks. Record open questions.

## Phase 2: Write The Plan

"""
    common_plan_format = """\
## Plan Format

Save the plan to:
- `.claude/state/plans/active/<name>.md` for workspace-wide plans
- `projects/<project>/internal/plans/active/<name>.md` for project-specific plans

Required structure:

```
---
status: active
created: YYYY-MM-DD
---

# <Plan Title>

## Overview
## Current State
## Target State
## Engineering Quality Contract
### Assumptions And Ambiguity
### Simplicity Rationale
### Surgical Scope
### Verification Contract
### Final Output Requirements
### Narrative, Prose, And Visual Requirements
### Behavior, Function, Interactivity, Display, Style, Look, Feel, And Tone
### Context Receipt Requirements For All Agents
### Multi-model Plan Consensus Requirement
## Work Chunks (WC-01, WC-02, ...)
  - depends_on: []
  - creates/modifies: [file list]
  - details: what to do
  - verification: how to prove it is done
## Dependency Graph
## Plan Review Record
```

Each work chunk must have explicit file paths, dependency ordering, and a
specific pass/fail verification step.

"""
    review_completeness = """\
Review completeness rule:
- Do one full pass before deciding the review outcome. Do not stop after the
  first issue.
- If corrections are required, list every material correction found in that
  pass in one Plan Review Record.
- Treat fixable plan problems as corrections, not blockers. Use blocked only
  when an authority boundary, unavailable artifact, or tool limit prevents
  completing the review.
- Independent multi-model plan consensus excludes the active lead agent from
  the reviewer set. Same-agent review is local sanity evidence only.
- Apply a materiality threshold: require corrections only for issues affecting
  correctness, completeness, safety, governance, executability, or deliverable
  fit. Put optional refinements under `Nonblocking suggestions:`.

"""
    if tier == "claude-only":
        routing = """\
## Dispatch

Claude handles all investigation, planning, and review. Use the Task tool for
independent parallel investigation subtasks within a session.

## Phase 3: Review

Read the plan cold and check:
- Path ownership: do created/modified paths stay inside the declared scope?
- Dependency soundness: can every chunk start given its declared depends_on?
- Missing verification: does each chunk have a specific pass/fail test?
- Under-specified chunks: would another reviewer know exactly what to do?

Append a Plan Review Record section with the review outcome and any corrections.
"""
    elif tier == "codex-only":
        routing = """\
## Dispatch

Codex handles planning, deterministic implementation, and local validation in
one assistant lane. Use shell commands as evidence for deterministic claims.

## Phase 3: Review

Read the plan cold in the same session and check path ownership, dependency
soundness, missing verification steps, and under-specified chunks. Record this
as local sanity evidence, not independent multi-model review.
"""
    elif tier == "gemini-only":
        routing = """\
## Dispatch

Gemini handles planning, long-context analysis, and review in one assistant
lane. Use deterministic shell commands for tests, lint, grep, schema checks,
and build commands.

## Phase 3: Review

Read the plan cold in the same session and check path ownership, dependency
soundness, missing verification steps, and under-specified chunks. Record this
as local sanity evidence, not independent multi-model review.
"""
    elif tier == "claude-codex":
        routing = """\
## Dispatch

Claude orchestrates. For deterministic code chunks, dispatch via:
`codex exec "<task prompt>"`

Include `AGENTS.md`, the Codex Context Receipt fields from `AGENTS.md`
(`Context-Receipt`, `Wiki-Index`, `Skill-Index`, `Skills-Selected`,
`Project-Continuity`, `Source-Artifacts`, `Engineering-Quality-Standard`, and
`Validators-Planned`), and
relevant context files in every Codex prompt. Bare Codex startup may be generic;
task-scoped dispatch must name wiki index status, selected skills, continuity
files when present, source artifacts, and planned validators. Do not dispatch
semantic review, prose generation, or cold-reader work to Codex; those route
back to Claude natively.

## Phase 3: Review

Claude reads the plan cold and checks path ownership, dependency soundness,
missing verification steps, and under-specified chunks. Note Codex dispatch
status in the Plan Review Record. If Claude is the active lead, record Claude
as omitted from independent reviewer consensus.
"""
    elif tier == "codex-gemini":
        routing = """\
## Dispatch

Two-tool routing per AGENTS.md Operating Posture section:
- Codex: deterministic code execution via `codex exec`.
- Gemini: long-context investigation, architecture review, visual extraction,
  and independent code-review concerns.

Every Codex dispatch must include the Codex Context Receipt fields from
`AGENTS.md`: `Context-Receipt`, `Wiki-Index`, `Skill-Index`,
`Skills-Selected`, `Project-Continuity`, `Source-Artifacts`,
`Engineering-Quality-Standard`, and
`Validators-Planned`. Bare Codex startup may be generic; task-scoped dispatch
must name wiki index status, selected skills, continuity files when present,
source artifacts, and planned validators.

## Phase 3: Review

Route per the Codex/Gemini table. Codex checks deterministic structure and
Gemini checks broad context, architecture, visual behavior, and code-review
concerns. Record all review outcomes in the Plan Review Record. Omit whichever
agent is the active lead from independent reviewer consensus.
"""
    else:
        routing = """\
## Dispatch

Three-tool routing per AGENTS.md Operating Posture section:
- Gemini: long-context investigation, architecture review, visual extraction.
- Codex: deterministic code execution via `codex exec`.
- Claude: semantic review, prose review, cold-reader audit, final deliverables.

Every Codex dispatch must include the Codex Context Receipt fields from
`AGENTS.md`: `Context-Receipt`, `Wiki-Index`, `Skill-Index`,
`Skills-Selected`, `Project-Continuity`, `Source-Artifacts`,
`Engineering-Quality-Standard`, and
`Validators-Planned`. Bare Codex startup may be generic; task-scoped dispatch
must name wiki index status, selected skills, continuity files when present,
source artifacts, and planned validators.

Deterministic validators (tests, lint, grep) are not Claude review gates. These
validators produce evidence; Claude reviews semantic correctness, prose
quality, and completeness as a separate step.

## Phase 3: Review

Route per the three-tool table. Claude reviews the plan for semantic
correctness and completeness. Codex or Gemini may review structural or
code-specific concerns. Record all review outcomes in the Plan Review Record.
Omit whichever agent is the active lead from independent reviewer consensus.
"""
    wiki_update = """\
## After The Plan Is Approved

If investigation revealed durable context not already in the wiki (a decision,
a constraint, a key pattern, a prior result), update the relevant wiki pages
before beginning execution. Append to `.claude/wiki/log.md`. If no new durable
context was found, skip this step.

Do not begin implementation until the plan has explicit multi-model plan consensus
evidence with verdict lines from independent non-lead reviewers.
"""
    return common_header + common_plan_format + routing + review_completeness + wiki_update


def _execute_command_ref(tier: str) -> str:
    common_header = """\
# /execute Reference

Execute an approved plan by dispatching work chunks in dependency order and
reviewing results. Do not begin without a plan that passes the scope gate.

## Pre-Execution Checks

1. Read the plan. Confirm the target file set and validation command.
2. Verify no chunk writes outside the declared scope.
3. Note any chunks that require human approval before running.
4. Confirm the plan includes Engineering Quality Contract and multi-model plan
   consensus evidence.

"""
    if tier == "claude-only":
        dispatch = """\
## Dispatch

Claude reads each work chunk and executes directly using Bash, Edit, Write, and
Read tools. Use the Task tool for independent parallel chunks. Mark chunk status
in the plan file after each chunk completes:

```
<!-- WC-01: done -->
```

## After Each Chunk

Run the chunk's verification step. Record an Engineering Quality Receipt with:

- Context consulted
- Assumptions checked
- Simplicity preserved or complexity justified
- Files changed and why each was necessary
- Material prose, visual, behavior, function, interactivity, display, style,
  look, feel, and tone requirements addressed when relevant
- Validation run with command and result
- Review gates run with reviewer and verdict
- Remaining gaps, blockers, or valid exclusions

If verification fails, diagnose and fix before marking done. Do not skip
verification and mark done.

## Plan Completion

When all chunks are marked done, each done chunk has an Engineering Quality
Receipt, and the plan's validation command exits 0:

1. Move the plan file to `completed/`.
2. Update the project HANDOFF.md Current Plan section.
3. Append a dated entry to UPDATE.txt or PROJECT_UPDATE.md describing what changed.
4. If execution produced durable context (decisions, patterns, error fixes),
   update the relevant wiki pages and append to `.claude/wiki/log.md`.

## Loop-as-Default

Check `.harness/config/discipline.json`. If `loop_as_default` is true, do not
stop after plan completion. Continue with /loop to ensure the deliverable
reaches 100% complete state with no remaining gaps.
"""
    elif tier in {"codex-only", "gemini-only"}:
        assistant = "Codex" if tier == "codex-only" else "Gemini"
        dispatch = f"""\
## Dispatch

{assistant} reads each work chunk and executes directly using available shell
and file-edit tools. Mark chunk status in the plan file after each chunk
completes:

```
<!-- WC-01: done -->
```

## After Each Chunk

Run the chunk's verification step. Record an Engineering Quality Receipt with:

- Context consulted
- Assumptions checked
- Simplicity preserved or complexity justified
- Files changed and why each was necessary
- Material prose, visual, behavior, function, interactivity, display, style,
  look, feel, and tone requirements addressed when relevant
- Validation run with command and result
- Review gates run with reviewer and verdict
- Remaining gaps, blockers, or valid exclusions

If verification fails, diagnose and fix before marking done. Do not skip
verification and mark done. Same-agent review is local sanity evidence only.

## Plan Completion

When all chunks are marked done, each done chunk has an Engineering Quality
Receipt, and the validation command exits 0, the plan is complete. Update
status to "completed" and move the file to `completed/`.

## Loop-as-Default

Check `.harness/config/discipline.json`. If `loop_as_default` is true, do not
stop after plan completion. Continue with /loop to ensure the deliverable
reaches 100% complete state with no remaining gaps.
"""
    elif tier == "claude-codex":
        dispatch = """\
## Dispatch

For chunks marked `codex_routing: high` or `codex_routing: cheap`:
`codex exec "<chunk details and verification command>"`

The prompt must include the Codex Context Receipt fields from `AGENTS.md`:
`Context-Receipt`, `Wiki-Index`, `Skill-Index`, `Skills-Selected`,
`Project-Continuity`, `Source-Artifacts`, `Engineering-Quality-Standard`, and
`Validators-Planned`.
For generic startup, explicitly mark missing project continuity and source
artifacts as `N/A` with a reason. For task-scoped chunks, name wiki index
status, selected skills, continuity files when present, source artifacts, and
planned validators before implementation.

For native chunks (prose, semantic review, cold-reader work): Claude executes
directly.

Mark chunk status in the plan after each chunk:

```
<!-- WC-01: done -->
```

Claude reviews all returned artifacts before marking a codex-dispatched chunk
done. Semantic review, prose review, and cold-reader audit always run natively
in Claude.

## Plan Completion

When all chunks are marked done, each done chunk has an Engineering Quality
Receipt, and the validation command exits 0, the plan is complete. Update
status to "completed" and move the file to `completed/`.

## Loop-as-Default

Check `.harness/config/discipline.json`. If `loop_as_default` is true, do not
stop after plan completion. Continue with /loop to ensure the deliverable
reaches 100% complete state with no remaining gaps.
"""
    elif tier == "codex-gemini":
        dispatch = """\
## Dispatch

For deterministic implementation chunks:
`codex exec "<chunk details and verification command>"`

The prompt must include the Codex Context Receipt fields from `AGENTS.md`:
`Context-Receipt`, `Wiki-Index`, `Skill-Index`, `Skills-Selected`,
`Project-Continuity`, `Source-Artifacts`, `Engineering-Quality-Standard`, and
`Validators-Planned`.

Route long-context analysis, visual review, and code-review concerns to Gemini.
Codex-led execution must route code review to Gemini, not self-review.

Mark chunk status in the plan:
```
<!-- WC-01: done -->
```

The active lead agent is omitted from independent completion audit consensus;
same-agent review is local sanity evidence only. Optional refinements belong
under `Nonblocking suggestions:` and do not block approval.

## Plan Completion

When all chunks are marked done, each done chunk has an Engineering Quality
Receipt, and the validation command exits 0, the plan is complete. Update
status to "completed" and move the file to `completed/`.

## Loop-as-Default

Check `.harness/config/discipline.json`. If `loop_as_default` is true, continue
with /loop until no material gaps remain.
"""
    else:
        dispatch = """\
## Dispatch

Route work chunks per AGENTS.md Operating Posture three-tool table:
- Codex (`codex exec`): deterministic code, structural audit, plan review.
- Gemini: long-context parsing, visual extraction, code review of Codex output.
- Claude: semantic review, prose generation, cold-reader audit, final approvals.

Every Codex dispatch must include the Codex Context Receipt fields from
`AGENTS.md`: `Context-Receipt`, `Wiki-Index`, `Skill-Index`,
`Skills-Selected`, `Project-Continuity`, `Source-Artifacts`,
`Engineering-Quality-Standard`, and
`Validators-Planned`. Generic startup may report `N/A` for project continuity
and source artifacts with a reason. Task-scoped chunks must name wiki index
status, selected skills, continuity files when present, source artifacts, and
planned validators before implementation.

Deterministic validators (tests, lint, grep, schema checks) run in any
assistant and are not Claude review gates. These validators produce evidence;
Claude reviews semantic correctness, prose quality, and completeness as a
separate step.

Mark chunk status in the plan:
```
<!-- WC-01: done -->
```

Codex-led execution must route code review to Gemini, not self-review. Semantic
review and prose audit always route back to Claude. The active lead agent is
omitted from independent completion audit consensus; same-agent review is local
sanity evidence only. Optional refinements belong under `Nonblocking
suggestions:` and do not block approval.

## Plan Completion

When all chunks are marked done, each done chunk has an Engineering Quality
Receipt, and the validation command exits 0, the plan is complete. Update
status to "completed" and move the file to `completed/`.

## Loop-as-Default

Check `.harness/config/discipline.json`. If `loop_as_default` is true, do not
stop after plan completion. Continue with /loop to ensure the deliverable
reaches 100% complete state with no remaining gaps.
"""
    return common_header + dispatch


_SKILL_STANDARDS_CONTENT = """\
# Skill Authoring Standards

Applies when creating or modifying any file under `.claude/skills/`.
Full specification: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices

## Required Frontmatter

name:
  - Maximum 64 characters
  - Lowercase letters, numbers, and hyphens only
  - No "anthropic" or "claude" in the name
  - Preferred form: gerund (processing-pdfs, analyzing-data, managing-tasks)

description:
  - Maximum 1024 characters
  - Third person only ("Processes PDF files" not "I can process" or "You can use this")
  - Include WHAT the skill does AND WHEN to use it
  - Example: "Extracts text from PDF files. Use when the user mentions PDFs,
    forms, or document extraction."

## SKILL.md Body

- Keep under 500 lines. Move detail into `references/` files.
- All references must be one level deep from SKILL.md. Never ref -> ref -> ref.
- Reference files longer than 100 lines must include a table of contents.
- Use forward slashes in all file paths. Never backslashes.
- No time-sensitive language ("before 2025", "after August").
- Use consistent terminology throughout.

## Scripts

- Handle errors explicitly. Do not let scripts fail silently and punt to Claude.
- Document all constants. No magic numbers.
- Prefer utility scripts for deterministic operations.

## Validation

Run `harness audit .` after creating or modifying any skill.
Fix all errors before committing. Address warnings where practical.

## Feedback Loop

After generating a skill:
1. Run `harness audit .` and fix errors.
2. Test the skill with a real request.
3. Observe whether Claude reads the right files.
4. Return to the skill and refine based on observed gaps.
"""


WORKFLOWS: tuple[WorkflowSpec, ...] = (
    WorkflowSpec(
        skill="workspace-status",
        command="status",
        description=(
            "Reports current repository state including git status, active plans, and open"
            " blockers. Use when starting a session, after a context break, or when unsure"
            " what work remains."
        ),
        skill_body=_STATUS_SKILL_BODY,
        command_ref=_STATUS_COMMAND_REF,
    ),
    WorkflowSpec(
        skill="generating-prompts",
        command="prompt",
        description=(
            "Generates a self-contained continuation prompt for resuming incomplete work in"
            " a new session. Use when a session is ending with work incomplete, or when the"
            " user wants a resumption prompt."
        ),
        skill_body=_PROMPT_SKILL_BODY,
        command_ref=_PROMPT_COMMAND_REF,
    ),
    WorkflowSpec(
        skill="maintaining-wiki",
        command="wiki",
        description=(
            "Maintains the local markdown wiki at .claude/wiki/ as the repository synthesis"
            " layer. Use when durable context changes, when source artifacts are updated, or"
            " when an agent needs retained cross-session knowledge."
        ),
        skill_body=_WIKI_SKILL_BODY,
        command_ref=_WIKI_COMMAND_REF,
    ),
    WorkflowSpec(
        skill="planning-work",
        command="plan",
        description=(
            "Investigates a topic and produces a chunked work plan with dependency ordering."
            " Use when work spans more than one file or step and requires a reviewable plan"
            " before execution."
        ),
        skill_body="",  # MoE-aware; body generated inline in render_profile
        command_ref="",  # MoE-aware; generated by _plan_command_ref(tier)
    ),
    WorkflowSpec(
        skill="executing-plans",
        command="execute",
        description=(
            "Executes an approved plan by dispatching work chunks in dependency order and"
            " reviewing results. Use when a plan exists and implementation should proceed."
        ),
        skill_body="",  # MoE-aware; body generated inline in render_profile
        command_ref="",  # MoE-aware; generated by _execute_command_ref(tier)
    ),
    WorkflowSpec(
        skill="orienting-session",
        command="orient",
        description=(
            "Produces a prioritized session agenda from git state, active plans, and project"
            " blockers. Use when starting a work session to determine where to focus first."
        ),
        skill_body=_ORIENT_SKILL_BODY,
        command_ref=_ORIENT_COMMAND_REF,
    ),
    WorkflowSpec(
        skill="looping-to-completion",
        command="loop",
        description=(
            "Applies the 100% rule to any deliverable by cycling gap analysis, planning, and"
            " execution until nothing is missing. Use when a deliverable must reach complete"
            " state and partial progress is not acceptable."
        ),
        skill_body=_LOOP_SKILL_BODY,
        command_ref=_LOOP_COMMAND_REF,
    ),
    WorkflowSpec(
        skill="reviewing-work",
        command="review",
        description=(
            "Reviews plans, diffs, documentation, or generated harness surfaces in one"
            " complete pass. Use when work needs defect discovery, cold-reader review,"
            " or review-gate evidence before completion."
        ),
        skill_body=_REVIEW_SKILL_BODY,
        command_ref=_REVIEW_COMMAND_REF,
    ),
    WorkflowSpec(
        skill="auditing-completion",
        command="audit",
        description=(
            "Audits whether a deliverable satisfies the 100% rule. Use before claiming"
            " generated workflow, documentation, validation, and review gates are complete."
        ),
        skill_body=_AUDIT_SKILL_BODY,
        command_ref=_AUDIT_COMMAND_REF,
    ),
    WorkflowSpec(
        skill="investigating-questions",
        command="investigate",
        description=(
            "Authors a research notebook to answer a specific question using the"
            " Intent-Execute-Interpret cell pattern. Use when a question requires systematic"
            " investigation with data analysis and a documented conclusion."
        ),
        skill_body=_INVESTIGATE_SKILL_BODY,
        command_ref=_INVESTIGATE_COMMAND_REF,
    ),
)

_SUGGEST_SPEC = WorkflowSpec(
    skill="suggesting-skills",
    command="suggest",
    description=(
        "Generates new custom skill definitions for this repository conforming to the"
        " Anthropic agent skills specification. Use when you want to add a new workflow"
        " skill tailored to this repository's tech stack or domain."
    ),
    skill_body=_SUGGEST_SKILL_BODY,
    command_ref=_SUGGEST_COMMAND_REF,
)


def available_profiles() -> tuple[str, ...]:
    return (CORE_PROFILE_NAME,)


def profile_metadata(profile: str = CORE_PROFILE_NAME) -> dict[str, str]:
    if profile != CORE_PROFILE_NAME:
        raise ValueError(f"unknown harness profile: {profile}")
    return {
        "profile": CORE_PROFILE_NAME,
        "profile_version": CORE_PROFILE_VERSION,
        "profile_source_hash": profile_source_hash(profile),
    }


def profile_source_hash(profile: str = CORE_PROFILE_NAME) -> str:
    if profile != CORE_PROFILE_NAME:
        raise ValueError(f"unknown harness profile: {profile}")
    source = {
        "profile": CORE_PROFILE_NAME,
        "version": CORE_PROFILE_VERSION,
        "workflows": [spec.__dict__ for spec in WORKFLOWS],
        "suggest_spec": _SUGGEST_SPEC.__dict__,
        "adaptive_modules": module_source_for_hash(),
        "static_targets": sorted(_static_target_names()),
    }
    return content_hash(source)


def render_profile(analysis: dict[str, Any], profile: str = CORE_PROFILE_NAME) -> dict[str, str]:
    if profile != CORE_PROFILE_NAME:
        raise ValueError(f"unknown harness profile: {profile}")

    context = _context(analysis)
    tier = context["moe_tier"]

    rendered = {
        "AGENTS.md": _agents(context),
        "CLAUDE.md": _claude(context),
        "CODEX.md": _codex(context),
        "GEMINI.md": _gemini(context),
        ".claude/SKILL_STANDARDS.md": _SKILL_STANDARDS_CONTENT,
        ".claude/wiki/index.md": _wiki_index(context),
        ".claude/wiki/log.md": _wiki_log(context),
        ".claude/wiki/wiki/repository-overview.md": _repository_overview(context),
        ".claude/wiki/wiki/workflows/local-development.md": _local_development(context),
        ".claude/wiki/wiki/projects/repository.md": _repository_project(context),
        ".claude/wiki/wiki/reference/agent-engineering-quality-standard.md": _agent_engineering_quality_wiki_page(),
        ".claude/wiki/wiki/reference/skill-index.md": _skill_index(context),
        ".claude/skills/agent-engineering-quality/SKILL.md": _agent_engineering_quality_skill_file(),
        ".claude/skills/agent-engineering-quality/references/comprehensive_100pct_execution_default.md": _AGENT_ENGINEERING_QUALITY_REFERENCE,
        ".claude/settings.json": _settings_json(context),
        ".claude/hooks/pre/path_guard.py": _path_guard_hook(),
        ".claude/hooks/pre/destructive_guard.py": _destructive_guard_hook(),
        ".claude/hooks/pre/secret_guard.py": _secret_guard_hook(),
        ".claude/hooks/pre/commit_gate.py": _load_hook("commit_gate.py"),
        ".claude/hooks/pre/skill_guard.py": _load_hook("skill_guard.py"),
        ".claude/hooks/pre/wiki_receipt_guard.py": _load_hook("wiki_receipt_guard.py"),
        ".claude/hooks/pre/engineering_quality_guard.py": _load_hook("engineering_quality_guard.py"),
        ".claude/hooks/post/activity_log.py": _activity_log_hook(),
        ".claude/hooks/post/wiki_reminder.py": _wiki_reminder_hook(),
        ".claude/hooks/post/wiki_sweep.py": _load_hook("wiki_sweep.py"),
        ".claude/hooks/post/error_tracker.py": _load_hook("error_tracker.py"),
        ".claude/hooks/post/handoff_reminder.py": _load_hook("handoff_reminder.py"),
        ".claude/hooks/post/doom_loop_detector.py": _load_hook("doom_loop_detector.py"),
        ".claude/hooks/post/learn_from_failure.py": _load_hook("learn_from_failure.py"),
        ".claude/hooks/post/activity_logger.py": _load_hook("activity_logger.py"),
        ".claude/hooks/post/synthesis_capture.py": _load_hook("synthesis_capture.py"),
        ".claude/hooks/post/knowledge_freshness_check.py": _load_hook("knowledge_freshness_check.py"),
        ".claude/hooks/post/knowledge_promotion_check.py": _load_hook("knowledge_promotion_check.py"),
        ".claude/hooks/post/workflow_completion_wiki_sweep.py": _load_hook("workflow_completion_wiki_sweep.py"),
        ".claude/hooks/pre/external_boundary_guard.py": _load_hook("external_boundary_guard.py"),
        ".claude/hooks/pre/notebook_conformance_check.py": _load_hook("notebook_conformance_check.py"),
        ".claude/hooks/session/session_context.py": _load_hook("session_context.py"),
        ".claude/hooks/session/session_start_discipline.py": _load_hook("session_start_discipline.py"),
        ".claude/hooks/session/reset_session_state.py": _load_hook("reset_session_state.py"),
        ".claude/hooks/post/surface_maintenance_reminder.py": _load_hook("surface_maintenance_reminder.py"),
        ".claude/hooks/post/track_knowledge_reads.py": _load_hook("track_knowledge_reads.py"),
        ".claude/hooks/pre/plan_quality_gate.py": _load_hook("plan_quality_gate.py"),
        ".claude/hooks/pre/knowledge_preflight_guard.py": _load_hook("knowledge_preflight_guard.py"),
        ".claude/hooks/pre/memory_enforcement_guard.py": _load_hook("memory_enforcement_guard.py"),
        ".claude/state/config/wiki_settings.json": _wiki_settings_json(),
        ".claude/wiki/Templates/page_template.md": _wiki_page_template(),
        ".codex/README.md": _codex_readme(context),
    }

    for spec in WORKFLOWS:
        rendered[f".claude/commands/{spec.command}.md"] = _command_wrapper(spec)
        if spec.skill == "planning-work":
            rendered[f".claude/skills/{spec.skill}/SKILL.md"] = _plan_skill_file(spec, tier)
            rendered[f".claude/skills/{spec.skill}/references/command.md"] = _plan_command_ref(tier)
        elif spec.skill == "executing-plans":
            rendered[f".claude/skills/{spec.skill}/SKILL.md"] = _execute_skill_file(spec, tier)
            rendered[f".claude/skills/{spec.skill}/references/command.md"] = _execute_command_ref(tier)
        else:
            rendered[f".claude/skills/{spec.skill}/SKILL.md"] = _skill_file(spec)
            rendered[f".claude/skills/{spec.skill}/references/command.md"] = spec.command_ref

    rendered[f".claude/commands/{_SUGGEST_SPEC.command}.md"] = _command_wrapper(_SUGGEST_SPEC)
    rendered[f".claude/skills/{_SUGGEST_SPEC.skill}/SKILL.md"] = _skill_file(_SUGGEST_SPEC)
    rendered[f".claude/skills/{_SUGGEST_SPEC.skill}/references/command.md"] = _SUGGEST_SPEC.command_ref

    for path, content in render_module_targets(analysis).items():
        if path in rendered:
            raise ValueError(f"adaptive module target collides with core target: {path}")
        rendered[path] = content

    return dict(sorted(rendered.items()))


def symlink_targets(profile: str = CORE_PROFILE_NAME) -> dict[str, str]:
    if profile != CORE_PROFILE_NAME:
        raise ValueError(f"unknown harness profile: {profile}")
    return {
        ".codex/commands": "../.claude/commands",
        ".codex/skills": "../.claude/skills",
        ".codex/hooks": "../.claude/hooks",
    }


def _static_target_names() -> set[str]:
    names = {
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
        ".claude/wiki/wiki/reference/skill-index.md",
        ".claude/skills/agent-engineering-quality/SKILL.md",
        ".claude/skills/agent-engineering-quality/references/comprehensive_100pct_execution_default.md",
        ".claude/settings.json",
        ".claude/hooks/pre/path_guard.py",
        ".claude/hooks/pre/destructive_guard.py",
        ".claude/hooks/pre/secret_guard.py",
        ".claude/hooks/pre/commit_gate.py",
        ".claude/hooks/pre/skill_guard.py",
        ".claude/hooks/pre/wiki_receipt_guard.py",
        ".claude/hooks/pre/engineering_quality_guard.py",
        ".claude/hooks/post/activity_log.py",
        ".claude/hooks/post/wiki_reminder.py",
        ".claude/hooks/post/wiki_sweep.py",
        ".claude/hooks/post/error_tracker.py",
        ".claude/hooks/post/handoff_reminder.py",
        ".claude/hooks/post/doom_loop_detector.py",
        ".claude/hooks/post/learn_from_failure.py",
        ".claude/hooks/post/activity_logger.py",
        ".claude/hooks/post/knowledge_freshness_check.py",
        ".claude/hooks/post/knowledge_promotion_check.py",
        ".claude/hooks/post/workflow_completion_wiki_sweep.py",
        ".claude/hooks/pre/external_boundary_guard.py",
        ".claude/hooks/pre/notebook_conformance_check.py",
        ".claude/hooks/session/session_context.py",
        ".claude/hooks/session/session_start_discipline.py",
        ".claude/hooks/session/reset_session_state.py",
        ".claude/hooks/post/surface_maintenance_reminder.py",
        ".claude/hooks/post/track_knowledge_reads.py",
        ".claude/hooks/pre/plan_quality_gate.py",
        ".claude/hooks/pre/knowledge_preflight_guard.py",
        ".claude/hooks/pre/memory_enforcement_guard.py",
        ".claude/state/config/wiki_settings.json",
        ".claude/wiki/Templates/page_template.md",
        ".codex/README.md",
    }
    for spec in WORKFLOWS:
        names.add(f".claude/commands/{spec.command}.md")
        names.add(f".claude/skills/{spec.skill}/SKILL.md")
        names.add(f".claude/skills/{spec.skill}/references/command.md")
    names.add(f".claude/commands/{_SUGGEST_SPEC.command}.md")
    names.add(f".claude/skills/{_SUGGEST_SPEC.skill}/SKILL.md")
    names.add(f".claude/skills/{_SUGGEST_SPEC.skill}/references/command.md")
    names.add(".claude/hooks/post/setup_rescan_reminder.py")
    return names


def _context(analysis: dict[str, Any]) -> dict[str, Any]:
    inventory = analysis["inventory"]
    workspace = analysis["workspace"]
    return {
        "display_name": workspace["display_name"],
        "languages": _join(inventory.get("languages", []), "No primary language detected"),
        "package_managers": _join(inventory.get("package_managers", []), "No package manager detected"),
        "test_commands": _join(inventory.get("test_commands", []), "No test command detected"),
        "build_commands": _join(inventory.get("build_commands", []), "No build command detected"),
        "docs": _join(inventory.get("docs", []), "No documentation files detected"),
        "source_dirs": _join(inventory.get("source_dirs", []), "No source directory detected"),
        "project_boundaries": _join(inventory.get("project_boundaries", []), "Repository root"),
        "selected_module_count": str(len(selected_module_ids(analysis))),
        "selected_module_ids": selected_module_ids(analysis),
        "moe_tier": analysis.get("moe_tier", "claude-only"),
        "confirmed_projects": analysis.get("confirmed_projects", []),
    }


def _join(values: list[str], empty: str) -> str:
    return ", ".join(values) if values else empty


def _document(title: str, body: str) -> str:
    return f"# {title}\n\n{body.strip()}\n"


def _adaptive_workflow_index_lines(ctx: dict[str, Any]) -> str:
    lines = []
    for module_id in ctx.get("selected_module_ids", []):
        page = _ADAPTIVE_WORKFLOW_PAGES.get(module_id)
        if page:
            title, filename = page
            lines.append(f"- [{title}](wiki/workflows/{filename}): adaptive workflow selected during setup.")
    return "\n".join(lines) if lines else "- No adaptive workflow pages selected."


def _adaptive_workflow_related_lines(ctx: dict[str, Any]) -> str:
    lines = []
    for module_id in ctx.get("selected_module_ids", []):
        page = _ADAPTIVE_WORKFLOW_PAGES.get(module_id)
        if page:
            title, filename = page
            lines.append(f"- [{title}](workflows/{filename})")
    return "\n".join(lines)


def _adaptive_workflow_local_related_lines(ctx: dict[str, Any]) -> str:
    lines = []
    for module_id in ctx.get("selected_module_ids", []):
        page = _ADAPTIVE_WORKFLOW_PAGES.get(module_id)
        if page:
            title, filename = page
            lines.append(f"- [{title}]({filename})")
    return "\n".join(lines)


_CODEX_CONTEXT_RECEIPT = """\
## Codex Context Receipt

Before deterministic Codex work begins, the prompt or session reminder must
state:

- `Context-Receipt`: the generated or manual startup context that was read
- `Wiki-Index`: `.claude/wiki/index.md` status, or `N/A` with a reason
- `Skill-Index`: `.claude/skills/` status, or `N/A` with a reason
- `Skills-Selected`: selected skill names, or `N/A` with a reason
- `Project-Continuity`: HANDOFF/UPDATE or equivalent status, or `N/A` with a reason
- `Source-Artifacts`: files or paths inspected for the task, or `N/A` with a reason
- `Engineering-Quality-Standard`: the active quality standard, or `N/A` with a reason
- `Validators-Planned`: tests, lint, build, schema, or review commands planned

A bare Codex session (a Codex CLI invocation with no task prompt) is a valid
generic session. It may report
`Project-Continuity: N/A` and `Source-Artifacts: N/A` when no project, source
path, or prompt has been supplied. A task-scoped Codex prompt must name the
relevant wiki, skills, continuity files when present, source artifacts, and
validators before implementation.
"""


def _agents(ctx: dict[str, Any]) -> str:
    tier = ctx["moe_tier"]
    confirmed = ctx.get("confirmed_projects", [])
    project_table = render_agents_project_table(confirmed)

    if tier == "claude-only":
        posture = """\
## Operating Posture

This repository uses Claude Code as its AI assistant. Claude investigates,
plans, executes, and reviews all work. No external CLI dispatch is configured.

Use the Task tool for parallel independent work within a session.
Prefer direct Bash, Read, Write, and Edit for deterministic file operations.
Reserve the Agent tool for genuinely isolated or cold-reader work."""
    elif tier == "codex-only":
        posture = """\
## Operating Posture

This repository uses Codex CLI as its AI assistant. Codex handles deterministic
implementation, local validation, and concise engineering notes directly.

Use shell evidence for tests, lint, grep, schema checks, and build commands.
When semantic review, prose review, or visual review matters, record that an
optional second assistant would improve review depth rather than inventing an
unavailable reviewer."""
    elif tier == "gemini-only":
        posture = """\
## Operating Posture

This repository uses Gemini CLI as its AI assistant. Gemini handles planning,
long-context analysis, implementation guidance, and review within one
available assistant lane.

Use deterministic shell commands for tests, lint, grep, schema checks, and
build commands. When deterministic implementation would benefit from Codex or
semantic cold review would benefit from Claude, record that as an optional
tooling improvement rather than a setup blocker."""
    elif tier == "claude-codex":
        posture = """\
## Operating Posture

This repository uses a two-tier AI toolchain: Claude as orchestrator and
semantic reviewer, Codex CLI for deterministic code execution.

Claude-led work: Claude investigates, plans, and reviews. Dispatch
deterministic implementation chunks to `codex exec` via the /execute skill.
Codex-led work: Codex implements and validates. Dispatch semantic review,
prose review, and cold-reader audit back to Claude CLI with --print.
Same-agent review is local sanity evidence only; the active lead agent is
omitted from independent plan consensus and completion audit.
Use the Task tool for parallel independent Claude work within a session."""
    elif tier == "codex-gemini":
        posture = """\
## Operating Posture

This repository uses a two-tool AI pair: Codex CLI for deterministic
implementation and Gemini CLI for long-context analysis, visual extraction, and
independent review.

Codex-led work: Codex implements and validates. Gemini reviews broad context,
architecture, visual behavior, and code-review concerns. Gemini-led work:
Gemini plans and reviews; Codex handles deterministic implementation chunks.
Independent plan consensus and completion audit omit the active lead agent.
Same-agent review is local sanity evidence only; optional refinements belong
under `Nonblocking suggestions:` and do not block approval."""
    elif tier == "claude-gemini":
        posture = """\
## Operating Posture

This repository uses a two-tool AI pair: Claude as semantic orchestrator and
Gemini CLI for long-context analysis and visual extraction.

Claude orchestrates, plans, and reviews. Dispatch long-context parsing and
visual extraction to Gemini CLI. Semantic review, prose review, and final
deliverables always route back to Claude.
Independent plan consensus and completion audit omit the active lead agent.
Same-agent review is local sanity evidence only; optional refinements belong
under `Nonblocking suggestions:` and do not block approval.
Use the Task tool for parallel independent Claude work within a session."""
    else:
        posture = """\
## Operating Posture

This repository uses a three-tool AI triad: Claude as auditor and cold reader,
Codex CLI as deterministic mechanic, Gemini CLI for long-context analysis and
visual extraction.

Claude-led plans: Claude orchestrates. Codex executes deterministic chunks.
Gemini handles long-context parsing, visual extraction, and code review.
Codex-led plans: Codex implements. Gemini reviews code. Claude reviews
semantic content, prose, and final deliverables.
Independent plan consensus and completion audit omit the active lead agent.
Same-agent review is local sanity evidence only; optional refinements belong
under `Nonblocking suggestions:` and do not block approval.
Deterministic validators (tests, lint, grep) are never Claude review gates."""

    return _document(
        "Workspace Agent Guide",
        f"""
This repository uses a generated local harness.

For non-trivial work, the default execution chain is:

`/plan -> multi-model plan consensus -> /execute -> /loop -> multi-model completion audit -> done`

## Repository Profile

- Name: `{ctx['display_name']}`
- Languages: {ctx['languages']}
- Package managers: {ctx['package_managers']}
- Test commands: {ctx['test_commands']}
- Build commands: {ctx['build_commands']}
- Source directories: {ctx['source_dirs']}

These values are populated by `harness analyze .` from repository content.
This is a synthetic review sample generated from an empty repository; real
repositories populate these fields from detected files.

## Projects

{project_table}

## Required Read Order

1. `AGENTS.md`
2. `CLAUDE.md` or `CODEX.md`, depending on the active assistant
3. `.claude/wiki/index.md`
4. The relevant skill under `.claude/skills/`
5. The files named by the current task
6. `.claude/skills/agent-engineering-quality/references/comprehensive_100pct_execution_default.md`

{posture}

{_CODEX_CONTEXT_RECEIPT}

## Operating Rules

- Keep package-owned state under `.harness/state/`.
- Run `harness analyze .` after structural repository changes.
- Run `harness setup . --dry-run` before applying generated harness changes.
- Review `.harness/state/generation_manifest.json` before `harness setup . --apply`.
- Do not commit, tag, push, publish, or delete history without explicit human approval.
- Preserve durable repository context in `.claude/wiki/`.
""",
    )


def _claude(ctx: dict[str, Any]) -> str:
    return _document(
        "Claude Workspace Supplement",
        f"""
This file is the Claude-facing supplement for `{ctx['display_name']}`.

Root routing lives in `AGENTS.md`. Use `.claude/wiki/index.md` for durable
repository context and `.claude/skills/` for workflow-specific instructions.
For non-trivial work, `/plan` defaults to the full
`/plan -> multi-model plan consensus -> /execute -> /loop -> multi-model completion audit -> done`
chain. Use `.claude/skills/agent-engineering-quality/` for the canonical
requirements.
When Claude is the active lead, omit Claude from independent multi-model plan
consensus and completion audit; same-agent review is local sanity evidence
only.
When dispatching deterministic work to Codex, require the Codex Context Receipt
fields defined in `AGENTS.md`: `Context-Receipt`, `Wiki-Index`, `Skill-Index`,
`Skills-Selected`, `Project-Continuity`, `Source-Artifacts`,
`Engineering-Quality-Standard`, and
`Validators-Planned`.
See `AGENTS.md` Codex Context Receipt section for field definitions.

## Safety

- Treat `.harness/state/` as package-owned runtime state.
- Use dry-run generation before applying harness changes.
- Keep edits inside this repository unless the user explicitly names another location.
- Run the repository's detected tests when behavior changes.
""",
    )


def _codex(ctx: dict[str, Any]) -> str:
    return _document(
        "Codex Workspace Supplement",
        f"""
This file is the Codex-facing supplement for `{ctx['display_name']}`.

Root routing lives in `AGENTS.md`. Canonical generated workflow surfaces live
under `.claude/`. The `.codex/` directory is a discoverability facade that
points Codex users to the same generated commands, skills, and hooks.

## Execution Notes

- Prefer fast local search with `rg` (ripgrep).
- For non-trivial work, `/plan` starts the default
  `/plan -> multi-model plan consensus -> /execute -> /loop -> multi-model completion audit -> done`
  chain.
- When Codex is the active lead, omit Codex from independent multi-model plan
  consensus and completion audit; same-agent review is local sanity evidence
  only.
- Treat a bare Codex session (a Codex CLI invocation with no task prompt) as generic. State
  `Project-Continuity: N/A` and `Source-Artifacts: N/A` when no project,
  source path, or prompt has been supplied.
- Before task-scoped deterministic work, provide the Codex Context Receipt
  fields from `AGENTS.md`: `Context-Receipt`, `Wiki-Index`, `Skill-Index`,
  `Skills-Selected`, `Project-Continuity`, `Source-Artifacts`,
  `Engineering-Quality-Standard`, and
  `Validators-Planned`.
  See `AGENTS.md` Codex Context Receipt section for field definitions.
- Run deterministic tests after code changes.
- Keep generated harness updates behind `harness setup . --dry-run` and
  `harness setup . --apply`.
- Never treat same-directory generated state as source truth when live source
  files disagree.
""",
    )


def _gemini(ctx: dict[str, Any]) -> str:
    return _document(
        "Gemini Workspace Supplement",
        f"""
This file is the Gemini-facing supplement for `{ctx['display_name']}`.

Root routing lives in `AGENTS.md`. Canonical generated workflow surfaces live
under `.claude/`; use `.claude/wiki/index.md` for durable repository context
and `.claude/skills/` for workflow-specific instructions.

## Execution Notes

- For non-trivial work, `/plan` starts the default
  `/plan -> multi-model plan consensus -> /execute -> /loop -> multi-model completion audit -> done`
  chain.
- When Gemini is the active lead, omit Gemini from independent multi-model plan
  consensus and completion audit; same-agent review is local sanity evidence
  only.
- Before task-scoped planning, investigation, architecture review, visual
  review, or long-context analysis, provide the context receipt fields from
  `AGENTS.md`: `Context-Receipt`, `Wiki-Index`, `Skill-Index`,
  `Skills-Selected`, `Project-Continuity`, `Source-Artifacts`,
  `Engineering-Quality-Standard`, and `Validators-Planned`.
  These fields record the context the assistant read before starting work; see
  `AGENTS.md` for the full context receipt contract.
- Gemini should handle large-context synthesis, architecture consistency,
  visual extraction, and review of broad generated-harness surfaces when the
  task explicitly routes that work to Gemini.
- Route prose, governance, cold-reader judgment, and final human-facing
  approval back to Claude. Route deterministic implementation and local tests
  to Codex when that tool is available.
- Use deterministic validators as evidence, not as substitutes for semantic,
  architecture, prose, or visual review.
- Keep generated harness updates behind `harness setup . --dry-run` and
  `harness setup . --apply`.
- Never treat same-directory generated state as source truth when live source
  files disagree.
""",
    )


def _wiki_index(ctx: dict[str, Any]) -> str:
    return _document(
        "Workspace Wiki Index",
        f"""
Surface class: index
Lifecycle posture: generated current

This local wiki preserves durable context for `{ctx['display_name']}`.

## Start Here

- [Repository Overview](wiki/repository-overview.md): detected repository profile.
- [Repository Project](wiki/projects/repository.md): local ownership and continuity.
- [Local Development Workflow](wiki/workflows/local-development.md): commands and validation.

## systems

- No generated system pages yet.

## projects

- [Repository Project](wiki/projects/repository.md): local ownership and continuity.

## changes

- No generated change pages yet.

## domains

- No generated domain pages yet.

## concepts

- No generated concept pages yet.

## reference

- [Agent Engineering Quality Standard](wiki/reference/agent-engineering-quality-standard.md): default non-trivial work contract.
- [Skill Index](wiki/reference/skill-index.md): compact discovery table for skills.

## workflows

- [Local Development Workflow](wiki/workflows/local-development.md): commands and validation.
{_adaptive_workflow_index_lines(ctx)}

## Maintenance

Update this index and `log.md` when repository structure, generated harness
files, tests, or release instructions change.
""",
    )


def _wiki_log(ctx: dict[str, Any]) -> str:
    return _document(
        "Workspace Wiki Log",
        f"""
## 2026-05-07T00:00:00Z | generated-harness

Initial wiki surfaces were generated for `{ctx['display_name']}` by
`harness setup --profile core --dry-run` followed by reviewed apply.
""",
    )


def _repository_overview(ctx: dict[str, Any]) -> str:
    return _document(
        "Repository Overview",
        f"""
## Summary

`{ctx['display_name']}` is the repository analyzed by the generated local
harness.

## Current Signals

- Languages: {ctx['languages']}
- Package managers: {ctx['package_managers']}
- Test commands: {ctx['test_commands']}
- Build commands: {ctx['build_commands']}
- Documentation: {ctx['docs']}
- Source directories: {ctx['source_dirs']}

## Authority And Recency

- Current authority: live repository files for source behavior.
- Current authority: `.harness/state/analysis.json` for the latest generated
  scan state.
- Recency rule: rerun `harness analyze .` after structural repository changes.

## Source Artifacts

- `.harness/state/analysis.json`
- `AGENTS.md`
- `README.md`

## Related Pages

- [Repository Project](projects/repository.md)
- [Local Development Workflow](workflows/local-development.md)
- [Skill Index](reference/skill-index.md)
{_adaptive_workflow_related_lines(ctx)}
""",
    )


def _local_development(ctx: dict[str, Any]) -> str:
    return _document(
        "Local Development Workflow",
        f"""
## Summary

The generated harness detected these validation commands for
`{ctx['display_name']}`.

## Commands

- Tests: {ctx['test_commands']}
- Builds: {ctx['build_commands']}
- Harness scan: `harness analyze .`
- Harness dry run: `harness setup . --profile core --dry-run`
- Dashboard: `harness dashboard . --port 8765`

## Authority And Recency

- Current authority: `.claude/commands/status.md` for generated command routing.
- Current authority: live package files for repository-specific test and build commands.
- Recency rule: prefer the repository's current package files over this generated
  page when they conflict; update the wiki after command or package-manager
  changes.

## Source Artifacts

- `.harness/state/analysis.json`
- `.claude/commands/status.md`

## Related Pages

- [Repository Overview](../repository-overview.md)
- [Repository Project](../projects/repository.md)
- [Skill Index](../reference/skill-index.md)
{_adaptive_workflow_local_related_lines(ctx)}
""",
    )


def _repository_project(ctx: dict[str, Any]) -> str:
    return _document(
        "Repository Project",
        f"""
## Summary

The generated harness treats `{ctx['display_name']}` as the owning repository
for local work.

## Ownership

- Project boundaries: {ctx['project_boundaries']}
- Source directories: {ctx['source_dirs']}
- Documentation: {ctx['docs']}

## Authority And Recency

- Current authority: `AGENTS.md` for repository routing.
- Current authority: `.harness/state/analysis.json` for generated project boundaries.
- Recency rule: rerun `harness analyze .` after project layout changes.

## Rules

- Keep project-local generated state under `.harness/state/`.
- Keep durable synthesis under `.claude/wiki/`.
- Keep command wrappers under `.claude/commands/`.
- Keep workflow instructions under `.claude/skills/`.

## Source Artifacts

- `AGENTS.md`
- `.harness/state/analysis.json`

## Related Pages

- [Repository Overview](../repository-overview.md)
- [Local Development Workflow](../workflows/local-development.md)
""",
    )


def _skill_file(spec: WorkflowSpec) -> str:
    return f"---\nname: {spec.skill}\ndescription: {spec.description}\n---\n\n{spec.skill_body.strip()}\n"


def _agent_engineering_quality_skill_file() -> str:
    return (
        "---\n"
        "name: agent-engineering-quality\n"
        "description: Defines the default non-trivial work contract and quality gates. "
        "Use when planning, executing, reviewing, or auditing substantive work.\n"
        "---\n\n"
        f"{_AGENT_ENGINEERING_QUALITY_SKILL_BODY.strip()}\n"
    )


def _agent_engineering_quality_wiki_page() -> str:
    return _document(
        "Agent Engineering Quality Standard",
        """
## Summary

This page defines the default non-trivial work contract for the generated
harness: `/plan -> multi-model plan consensus -> /execute -> /loop -> multi-model completion
audit -> done`.

## Authority And Recency

- Current authority: `.claude/skills/agent-engineering-quality/SKILL.md`
- Recency rule: update when workflow contracts, review gates, or validator requirements change.

## Standard

- Use the assumption, simplicity, surgicality, and verification tests.
- Require cold-readable plans with explicit target files, work chunks, and pass/fail criteria.
- Require context receipts for top-level and dispatched agents.
- Do not treat `/plan` as completion for non-trivial work.
- Do not exit `/loop` until the work product conforms and multi-model completion audit approves.
- Exclude the active lead agent from independent multi-model consensus and
  completion audit.
- Put optional refinements under `Nonblocking suggestions:` instead of blocking
  approval.

## Source Artifacts

- `.claude/skills/agent-engineering-quality/SKILL.md`
- `.claude/skills/agent-engineering-quality/references/comprehensive_100pct_execution_default.md`

## Related Pages

- [Skill Index](skill-index.md)
""",
    )


def _plan_skill_file(spec: WorkflowSpec, tier: str) -> str:
    if tier == "claude-only":
        routing_line = "Claude handles all investigation, planning, and review."
    elif tier == "codex-only":
        routing_line = "Codex handles deterministic planning, execution, and validation."
    elif tier == "gemini-only":
        routing_line = "Gemini handles planning, long-context analysis, and review."
    elif tier == "claude-codex":
        routing_line = "Claude orchestrates; Codex executes deterministic chunks."
    elif tier == "claude-gemini":
        routing_line = "Claude orchestrates; Gemini handles long-context analysis and visual extraction."
    elif tier == "codex-gemini":
        routing_line = "Codex executes deterministic chunks; Gemini reviews broad context and code concerns."
    else:
        routing_line = "Claude orchestrates; Codex executes code; Gemini reviews long-context."
    body = f"""\
# Planning Work

Read `references/command.md` for the full workflow.

Investigates a topic and produces a chunked work plan with dependency ordering.
{routing_line}

## When To Use

Use when work spans more than one file or step and requires a reviewable plan
before execution starts.

## Bundled Resources

- `references/command.md`: investigation, plan format, dispatch guidance, and review.
"""
    return f"---\nname: {spec.skill}\ndescription: {spec.description}\n---\n\n{body.strip()}\n"


def _execute_skill_file(spec: WorkflowSpec, tier: str) -> str:
    if tier == "claude-only":
        routing_line = "Claude executes all chunks directly using Bash, Edit, Write, and Read tools."
    elif tier == "codex-only":
        routing_line = "Codex executes chunks directly and records shell validation evidence."
    elif tier == "gemini-only":
        routing_line = "Gemini executes chunks directly and records deterministic validation evidence."
    elif tier == "claude-codex":
        routing_line = "Claude orchestrates; deterministic chunks dispatch via codex exec."
    elif tier == "claude-gemini":
        routing_line = "Claude executes or orchestrates chunks; Gemini handles long-context and visual review."
    elif tier == "codex-gemini":
        routing_line = "Codex executes deterministic chunks; Gemini reviews broad context and code concerns."
    else:
        routing_line = "Routes per AGENTS.md three-tool table."
    body = f"""\
# Executing Plans

Read `references/command.md` for the full workflow.

Executes an approved plan by dispatching work chunks in dependency order and
reviewing results. {routing_line}

## When To Use

Use when a plan exists and implementation should proceed.

## Bundled Resources

- `references/command.md`: pre-execution checks, dispatch rules, and completion criteria.
"""
    return f"---\nname: {spec.skill}\ndescription: {spec.description}\n---\n\n{body.strip()}\n"


def _command_wrapper(spec: WorkflowSpec) -> str:
    return (
        f"---\nname: {spec.command}\ndescription: {spec.description}\n---\n\n"
        f"# /{spec.command}\n\n"
        f"Use `.claude/skills/{spec.skill}/SKILL.md` for the workflow overview.\n"
        f"Use `.claude/skills/{spec.skill}/references/command.md` for detailed instructions.\n\n"
        "Required first reads:\n\n"
        "1. `AGENTS.md`\n"
        "2. `.claude/wiki/index.md`\n"
        f"3. `.claude/skills/{spec.skill}/SKILL.md`\n"
        f"4. `.claude/skills/{spec.skill}/references/command.md`\n"
    )


def _settings_json(ctx: dict[str, Any]) -> str:
    post_hooks = [
        {
            "type": "command",
            "command": 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/post/activity_log.py',
            "timeout": 10,
        },
        {
            "type": "command",
            "command": 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/post/synthesis_capture.py',
            "timeout": 10,
        },
        {
            "type": "command",
            "command": 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/post/wiki_reminder.py',
            "timeout": 10,
        },
        {
            "type": "command",
            "command": 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/post/wiki_sweep.py',
            "timeout": 10,
        },
        {
            "type": "command",
            "command": 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/post/error_tracker.py',
            "timeout": 10,
        },
        {
            "type": "command",
            "command": 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/post/handoff_reminder.py',
            "timeout": 10,
        },
        {
            "type": "command",
            "command": 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/post/doom_loop_detector.py',
            "timeout": 10,
        },
        {
            "type": "command",
            "command": 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/post/learn_from_failure.py',
            "timeout": 15,
        },
        {
            "type": "command",
            "command": 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/post/activity_logger.py',
            "timeout": 10,
        },
        {
            "type": "command",
            "command": 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/post/knowledge_freshness_check.py',
            "timeout": 10,
        },
        {
            "type": "command",
            "command": 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/post/knowledge_promotion_check.py',
            "timeout": 10,
        },
        {
            "type": "command",
            "command": 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/post/workflow_completion_wiki_sweep.py',
            "timeout": 10,
        },
        {
            "type": "command",
            "command": 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/post/surface_maintenance_reminder.py',
            "timeout": 10,
        },
    ]
    if int(ctx["selected_module_count"]) > 0:
        post_hooks.append(
            {
                "type": "command",
                "command": 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/post/setup_rescan_reminder.py',
                "timeout": 10,
            }
        )
    return stable_json(
        {
            "generated_by": "distributable-harness",
            "profile": CORE_PROFILE_NAME,
            "profile_version": CORE_PROFILE_VERSION,
            "hooks": {
                "SessionStart": [
                    {
                        "hooks": [
                            {
                                "type": "command",
                                "command": 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/session/reset_session_state.py',
                                "timeout": 10,
                            },
                            {
                                "type": "command",
                                "command": 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/session/session_start_discipline.py',
                                "timeout": 10,
                            },
                            {
                                "type": "command",
                                "command": 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/session/session_context.py',
                                "timeout": 15,
                            }
                        ]
                    }
                ],
                "PreToolUse": [
                    {
                        "matcher": "Edit|Write|Agent",
                        "hooks": [
                            {
                                "type": "command",
                                "command": 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/pre/knowledge_preflight_guard.py',
                                "timeout": 10,
                            },
                            {
                                "type": "command",
                                "command": 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/pre/memory_enforcement_guard.py',
                                "timeout": 10,
                            },
                            {
                                "type": "command",
                                "command": 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/pre/path_guard.py',
                                "timeout": 10,
                            },
                            {
                                "type": "command",
                                "command": 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/pre/secret_guard.py',
                                "timeout": 10,
                            },
                            {
                                "type": "command",
                                "command": 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/pre/skill_guard.py',
                                "timeout": 10,
                            },
                            {
                                "type": "command",
                                "command": 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/pre/wiki_receipt_guard.py',
                                "timeout": 10,
                            },
                            {
                                "type": "command",
                                "command": 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/pre/external_boundary_guard.py',
                                "timeout": 10,
                            },
                            {
                                "type": "command",
                                "command": 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/pre/notebook_conformance_check.py',
                                "timeout": 10,
                            },
                            {
                                "type": "command",
                                "command": 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/pre/plan_quality_gate.py',
                                "timeout": 10,
                            },
                            {
                                "type": "command",
                                "command": 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/pre/engineering_quality_guard.py',
                                "timeout": 10,
                            },
                        ],
                    },
                    {
                        "matcher": "Bash",
                        "hooks": [
                            {
                                "type": "command",
                                "command": 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/pre/memory_enforcement_guard.py',
                                "timeout": 10,
                            },
                            {
                                "type": "command",
                                "command": 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/pre/destructive_guard.py',
                                "timeout": 10,
                            },
                            {
                                "type": "command",
                                "command": 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/pre/commit_gate.py',
                                "timeout": 10,
                            },
                        ],
                    },
                ],
                "PostToolUse": [
                    {
                        "matcher": "Read",
                        "hooks": [
                            {
                                "type": "command",
                                "command": 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/post/track_knowledge_reads.py',
                                "timeout": 10,
                            },
                        ],
                    },
                    {
                        "matcher": "Edit|Write|Bash",
                        "hooks": post_hooks,
                    }
                ],
            },
        }
    )


def _hook_prelude(summary: str) -> str:
    return f"""#!/usr/bin/env python3\n\"\"\"{summary}\"\"\"\n\nfrom __future__ import annotations\n\nimport json\nimport os\nimport select\nimport sys\nfrom pathlib import Path\n\n\ndef read_event() -> dict:\n    if not select.select([sys.stdin], [], [], 0.0)[0]:\n        return {{}}\n    try:\n        return json.load(sys.stdin)\n    except json.JSONDecodeError:\n        return {{}}\n\n\ndef project_root() -> Path:\n    return Path(os.environ.get(\"CLAUDE_PROJECT_DIR\") or os.getcwd()).resolve()\n\n\ndef fail(message: str) -> None:\n    print(message, file=sys.stderr)\n    raise SystemExit(2)\n\n"""


def _path_guard_hook() -> str:
    return _hook_prelude("Keep generated assistant file edits inside the repository root.") + """
event = read_event()
if not event:
    raise SystemExit(0)

tool_name = event.get("tool_name", "")
if tool_name not in {"Edit", "Write"}:
    raise SystemExit(0)

raw_path = event.get("tool_input", {}).get("file_path", "")
if not raw_path:
    raise SystemExit(0)

root = project_root()
candidate = Path(raw_path).expanduser()
if not candidate.is_absolute():
    candidate = root / candidate
candidate = candidate.resolve()

try:
    candidate.relative_to(root)
except ValueError:
    fail(f"BLOCKED: file path leaves repository root: {raw_path}")
"""


def _destructive_guard_hook() -> str:
    return _hook_prelude("Block destructive shell commands that require explicit approval.") + """
import re

event = read_event()
if not event:
    raise SystemExit(0)

if event.get("tool_name") != "Bash":
    raise SystemExit(0)

command = event.get("tool_input", {}).get("command", "")
patterns = [
    (r"\\bgit\\s+reset\\s+--hard\\b", "git reset --hard discards uncommitted work"),
    (r"\\bgit\\s+clean\\s+-f", "git clean -f deletes untracked files"),
    (r"\\bgit\\s+push\\s+.*--force\\b", "force push can rewrite remote history"),
    (r"\\bgit\\s+push\\s+-f\\b", "force push can rewrite remote history"),
    (r"\\brm\\s+-rf\\s+/", "rm -rf on root paths is not allowed"),
]
for pattern, reason in patterns:
    if re.search(pattern, command):
        fail(f"BLOCKED: {reason}. Ask for explicit human approval first.")
"""


def _secret_guard_hook() -> str:
    return _hook_prelude("Block obvious credential material from generated edits.") + """
import re

event = read_event()
if not event:
    raise SystemExit(0)

tool_name = event.get("tool_name", "")
if tool_name not in {"Edit", "Write"}:
    raise SystemExit(0)

tool_input = event.get("tool_input", {})
content = "\\n".join(
    str(tool_input.get(key, ""))
    for key in ("content", "new_string")
    if tool_input.get(key)
)
if not content:
    raise SystemExit(0)

patterns = [
    r"(?i)aws_access_key_id\\s*=",
    r"(?i)aws_secret_access_key\\s*=",
    r"(?i)api[_-]?key\\s*[:=]",
    r"(?i)password\\s*[:=]",
    r"-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----",
]
for pattern in patterns:
    if re.search(pattern, content):
        fail("BLOCKED: edit appears to contain credential material")
"""


def _activity_log_hook() -> str:
    return _hook_prelude("Record compact local assistant activity under package-owned state.") + """
from datetime import datetime, timezone

event = read_event()
if not event:
    raise SystemExit(0)

root = project_root()
state_dir = root / ".harness" / "state"
state_dir.mkdir(parents=True, exist_ok=True)
record = {
    "at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    "tool_name": event.get("tool_name"),
}
with (state_dir / "activity_log.jsonl").open("a", encoding="utf-8") as handle:
    handle.write(json.dumps(record, sort_keys=True) + "\\n")
"""


def _wiki_reminder_hook() -> str:
    return _hook_prelude("Record local wiki maintenance reminders after source edits.") + """
from datetime import datetime, timezone

event = read_event()
if not event:
    raise SystemExit(0)

if event.get("tool_name") not in {"Edit", "Write"}:
    raise SystemExit(0)

raw_path = event.get("tool_input", {}).get("file_path", "")
if not raw_path or raw_path.startswith(".claude/wiki/"):
    raise SystemExit(0)

root = project_root()
state_dir = root / ".harness" / "state"
state_dir.mkdir(parents=True, exist_ok=True)
record = {
    "at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    "source_path": raw_path,
    "suggested_action": "Review .claude/wiki/index.md and update wiki context if this edit changed durable repository behavior.",
}
with (state_dir / "wiki_reminders.jsonl").open("a", encoding="utf-8") as handle:
    handle.write(json.dumps(record, sort_keys=True) + "\\n")
"""


def _wiki_settings_json() -> str:
    return stable_json(
        {
            "version": "1.0",
            "wiki_root": ".claude/wiki",
            "wiki_families": ["projects", "reference", "workflows"],
            "page_required_sections": ["Summary", "Authority And Recency", "Source Artifacts", "Related Pages"],
            "max_source_artifacts_per_page": 9,
            "context_receipts": {
                "path": ".claude/state/runtime/wiki_context_receipts",
                "ttl_seconds": 7200,
                "enforce_for_wiki_writes": True,
            },
            "semantic_maintainer": {
                "hook_trigger_path_substrings": ["/external/", "/docs/", "/research/", "/.claude/hooks/", "/.claude/skills/", "/.claude/commands/"],
                "hook_trigger_filenames": ["HANDOFF.md", "UPDATE.txt", "README.md"],
            },
        }
    )


def _wiki_page_template() -> str:
    return """\
# <Page Title>

## Summary

<One to three sentences stating the main finding or purpose of this page.>

## Authority And Recency

- Current authority: <path to authoritative source>
- Recency rule: <when to refresh this page>

## <Main Content Section>

<Substantive content synthesized from source artifacts.>

## Source Artifacts

- <path/to/source/artifact>

## Related Pages

- [Related Page Title](../path/to/related.md)
"""


def _skill_index(ctx: dict[str, Any]) -> str:
    """Generate skill-index.md wiki page content."""
    all_specs = list(WORKFLOWS) + [_SUGGEST_SPEC]

    rows = []
    rows.append(
        "| [agent-engineering-quality](../../../skills/agent-engineering-quality/SKILL.md) | "
        "Default non-trivial work contract and quality gates. |"
    )
    for spec in all_specs:
        name = spec.skill
        desc = spec.description
        trigger = desc.split(".")[0].strip() if "." in desc else desc[:80]
        if len(trigger.split()) > 15:
            trigger = " ".join(trigger.split()[:15])
        rows.append(f"| [{name}](../../../skills/{name}/SKILL.md) | {trigger} |")

    table = "\n".join(rows)
    source_artifacts = "\n".join(
        [
            "- `.claude/SKILL_STANDARDS.md`",
            "- `.claude/skills/agent-engineering-quality/SKILL.md`",
            "- `.claude/skills/planning-work/SKILL.md`",
            "- `.claude/skills/executing-plans/SKILL.md`",
            "- `.claude/skills/looping-to-completion/SKILL.md`",
            "- `.claude/skills/reviewing-work/SKILL.md`",
            "- `.claude/skills/auditing-completion/SKILL.md`",
        ]
    )

    return _document(
        "Skill Index",
        f"""
---
family: reference
lifecycle: generated current
---

## Summary

This page lists all generated skills with their trigger phrases. Agents read
this page before invoking unfamiliar skills to find the right skill by trigger
phrase. Run `harness wiki build-skill-index .` to regenerate after adding
custom skills.

## Authority And Recency

- Current authority: `.claude/SKILL_STANDARDS.md` for generated skill standards.
- Recency rule: Regenerate when custom skills are added via `/suggest`.

## Workflow Skills

| Name | Trigger |
|------|---------|
{table}

## Source Artifacts

{source_artifacts}

## Related Pages

- [Repository Overview](../repository-overview.md): detected repository profile.
- [Agent Engineering Quality Standard](agent-engineering-quality-standard.md): default non-trivial work contract.
- [Local Development Workflow](../workflows/local-development.md): generated command routing.
""",
    )


def _codex_readme(ctx: dict[str, Any]) -> str:
    return _document(
        "Codex Facade",
        f"""
This directory is a generated Codex discoverability facade for
`{ctx['display_name']}`.

Canonical generated workflow files live under `.claude/`. The generated
`.codex/commands`, `.codex/skills`, and `.codex/hooks` entries point to those
canonical surfaces when the operating system supports symlinks.

Use `AGENTS.md` and `CODEX.md` for the Codex Context Receipt contract. Bare
Codex startup is allowed to be generic. Task-scoped Codex work should name
`Context-Receipt`, `Wiki-Index`, `Skill-Index`, `Skills-Selected`,
`Project-Continuity`, `Source-Artifacts`, `Engineering-Quality-Standard`, and
`Validators-Planned` before
implementation.
""",
    )
