# agentos-harness

`agentos-harness` installs a local AI assistant harness inside a developer
repository, generating operating guides, workflow skills, slash commands, and safety
hooks tailored to the repository's detected structure and available AI tools.

## Requirements

- Python 3.11 or later
- Git on PATH
- Claude Code CLI v1.0.0 or later: `npm install -g @anthropic-ai/claude-code`
  and `claude --version`

Optional tools detected during setup:

- Codex CLI: `npm install -g @openai/codex`
- Gemini CLI: `npm install -g @google/gemini-cli`

## Quick Start

```bash
python -m pip install "git+https://github.com/htleffew/agentos-harness.git@master"
harness setup
```

`harness setup` checks the required AI tools, asks short setup questions,
reviews the planned repository changes, asks whether to apply them, and then
prints the exact prompt to paste into an agent terminal for final validation.

## Key Terms

| Term | Meaning |
|---|---|
| Multi-model | Review flow where the installed AI tools participate through approval or correction verdicts |
| Closeable gap | Unfinished work the current session can resolve |
| Blocker | A condition requiring external action the assistant cannot take |
| Cold-readable | Content that another person or assistant can understand and act on without prior context or access to the original author |
| Context receipt | Startup evidence recording what the assistant read before making changes |
| Engineering Quality Receipt | Per-chunk evidence covering context consulted, assumptions checked, files changed, validation run, review verdict, and remaining gaps |

## Install

Install directly from the repository source:

```bash
python -m pip install "git+https://github.com/htleffew/agentos-harness.git@master"
harness doctor
```

`harness doctor` prints package version, Python version, Git availability, and
detected AI tool status. Package version tracks CLI behavior and installer
fixes; profile version tracks the generated harness content.

To force a fresh reinstall from the repository after package changes:

```bash
harness --update
```

After a successful update, run `harness setup` again from the repository that
should receive the harness.

**Windows users**: If installation fails with a git checkout error, install from a
local checkout instead (see below).

<details>
<summary>Install from local checkout (development)</summary>

```bash
git clone https://github.com/htleffew/agentos-harness.git
cd agentos-harness
python -m pip install -e .[dev]
harness doctor
```

</details>

<details>
<summary>Build wheel locally</summary>

```bash
git clone https://github.com/htleffew/agentos-harness.git
cd agentos-harness
pip install build
python -m build
# Creates dist/agentos_harness-0.6.3-py3-none-any.whl
```

</details>

## First Run

From inside the repository that should receive the harness:

```bash
cd /path/to/your/repo
harness setup
```

Installation only makes the `harness` command available. `harness setup` is
the guided command that reviews and writes repository files.

`harness doctor` prints package version, Python version, Git availability, and
detected AI tool status as JSON.

`harness check-tools` runs the interactive tool wizard and exits. Use it to
verify or install AI tools before running setup.

`harness setup` scans the repository and writes a review manifest first.
Nothing is written to `.claude/` or `AGENTS.md` until you answer yes to apply.
If setup detects project boundaries, it asks whether to include all projects,
include none, or choose specific projects. After apply, setup prints the exact
agent-terminal prompt to use for final validation.

Automation and recovery commands remain available:

```bash
harness setup . --dry-run --json
harness setup . --apply --json
```

## Comprehensive 100% Execution Default

Under the 100% rule, 75% complete equals zero, 90% equals zero, and
99% equals zero; only fully complete work satisfies the contract.
The generated validator treats incomplete-work markers as validation failures,
including the standard to-do marker written here as T-O-D-O, the standard
fix-me marker written here as F-I-X-M-E, temporary filler comments, and
skeletal implementations. (Markers are hyphenated in this document to avoid
validator self-detection.)

Generated harnesses now make this the default non-trivial work contract:

`/plan -> multi-model plan consensus -> /execute -> /loop -> multi-model completion audit -> done`

Here, "multi-model" means the installed AI tools participate in the review
step. When only Claude is installed, Claude performs the review locally. When
multiple tools are present, each installed review route returns an approval or
correction verdict. The active lead agent is omitted from independent
multi-model plan consensus and completion audit, so Claude does not call Claude,
Codex does not call Codex, and Gemini does not call Gemini as an independent
reviewer. Same-agent review is local sanity evidence only.

In practice, that means a user can say `proceed with /plan` for substantive
work and the generated workflow guidance requires this sequence:

1. `/plan` investigates the task and writes a cold-readable plan. A
   cold-readable plan names the target files, work chunks, pass/fail
   verification, and final-state expectations clearly enough that another
   agent could execute it without prior context.
2. Plan consensus reviews the plan before implementation begins. When multiple
   AI tools are installed, the generated harness expects explicit approval or
   correction verdicts from the installed review routes. When only Claude is
   installed, Claude performs that review locally.
3. `/execute` runs the plan and records an Engineering Quality Receipt, the
   per-chunk evidence record covering context consulted, assumptions checked,
   files changed, validation run, review verdict, and any remaining gaps, for
   each completed chunk.
4. `/loop` repeats planning and execution until the work product conforms to
   the final-state spec. Plan completion alone is not enough.
5. Completion audit checks the final work product against the expected outcome
   before the work is treated as complete.

Generated workflow guidance also requires:

- explicit assumptions, simplicity rationale, surgical scope, and verification
  contract
- context receipts for top-level and dispatched agents
- loop exit based on work-product conformance, not plan completion alone
- explicit approval or correction verdicts for plan consensus and completion audit
- optional refinements recorded under `Nonblocking suggestions:` so preferences
  do not create repeated consensus loops

Planning-only remains available when the user explicitly asks for planning-only
work or no file changes.

## Skill Budget Management

Claude Code loads skill `name` and `description` fields at startup (approximately
100 tokens per skill). Full SKILL.md body content and bundled references load
only when a skill triggers. This progressive disclosure keeps startup fast.

For workspaces with 40+ skills, keep descriptions at 130 characters or fewer.
Front-load trigger keywords in the first 50 characters so truncated previews
remain useful for skill matching.

**Configuration options in `.claude/settings.json`:**

```json
{
  "skillOverrides": {
    "my-background-skill": "name-only",
    "rarely-used-skill": "name-only"
  }
}
```

The `skillOverrides` block marks skills for different loading behavior:
- `"on"` (default): load name and description at startup
- `"name-only"`: load only the name; description loads on invocation
- `"user-invocable-only"`: load only for explicit slash command invocation
- `"off"`: skill is disabled

This block is optional. If it is absent, every skill uses the `"on"` behavior.

The `harness wiki build-skill-index` command generates a markdown index for
human reference, not for runtime discovery. Claude Code native progressive
disclosure reads SKILL.md frontmatter directly.

## Tool Wizard

`harness setup .` starts by checking which AI CLIs are installed:

```
Checking AI tools...
  ✓ Claude Code CLI
  ✗ Codex CLI   (not found)
  ✗ Gemini CLI  (not found)

  Optional. Deterministic code dispatch from /plan and /execute.
  Install: npm install -g @openai/codex
  Optional. Long-context parsing and visual analysis.
  Install: npm install -g @google/gemini-cli

Install optional AI tools now? [y/N/o]
```

Answer `y` to install every missing optional tool, `n` or Enter to skip, or
`o` to choose tool names. For each tool you confirm, the wizard prints the
install command and waits for you to run it in another terminal. After you
press Enter, it re-detects and shows updated status.

The detected tool set determines which routing section appears in the generated
`AGENTS.md`. A tier is the routing configuration for the installed tool
combination:
The generated `AGENTS.md` Operating Posture section is therefore tier-specific
and reflects the tools detected at setup time.

| Tier | Tools | Generated routing |
|------|-------|-------------------|
| claude-only | Claude only | Claude handles all work; Claude handles parallel steps directly |
| codex-only | Codex only | Codex handles deterministic implementation and validation |
| gemini-only | Gemini only | Gemini handles planning, long-context analysis, and review |
| claude-codex | Claude + Codex | Claude orchestrates; Codex executes deterministic chunks |
| claude-gemini | Claude + Gemini | Claude orchestrates; Gemini handles long-context analysis |
| codex-gemini | Codex + Gemini | Codex executes deterministic chunks; Gemini reviews broad context and code concerns |
| full-moe | All three | Claude, Codex, and Gemini route by their generated responsibilities |

Pass `--tools claude,codex` to skip the wizard and set the tier directly.
Pass `--non-interactive` to skip all prompts and use whatever is detected.

## Codex Context Startup

When Codex CLI is available, generated repositories include Codex-facing
guidance in `AGENTS.md`, `CODEX.md`, `/plan`, `/execute`, session hooks, and
the `.codex/` directory, which points Codex to the same generated instructions
that live under `.claude/`.

A bare Codex session with no prompt is treated as a generic session. It does
not require a project assignment, source path, or validator list. The generated
reminder tells the agent to report `Project-Continuity: N/A` and
`Source-Artifacts: N/A` with the reason.

Task-scoped Codex work must report these fields before implementation:

- `Context-Receipt`
- `Wiki-Index`
- `Skill-Index`
- `Skills-Selected`
- `Project-Continuity`
- `Source-Artifacts`
- `Engineering-Quality-Standard`
- `Validators-Planned`

This keeps no-prompt startup fast while making real work explicit about the
wiki, skills, continuity files, source artifacts, engineering standard, and
validators it will use.

A context receipt (the `Context-Receipt` field) is the short startup evidence block that records what the
assistant read before it started changing files. The generated harness uses it
to make plan and execution context auditable.

## Validation And Health

Generated harnesses surface this default in three places:

- `harness validate .` checks the Engineering Quality Contract and Engineering
  Quality Receipts in addition to the existing continuity, 100% rule, wiki,
  and hygiene checks.
- `harness lint .` reports an Engineering Quality row once a harness has been
  generated.
- dashboard Health includes an Engineering Quality signal alongside the other
  generated integrity checks.

## Existing Harness Migration

If the repository already has agent files, skills, commands, or hooks, setup
detects them and offers migration options:

```
============================================================
EXISTING HARNESS DETECTED
============================================================

  Custom skills (will be preserved):
    + my-custom-skill
    + another-skill

  Files that would be overwritten (2):
    ! .claude/skills/planning-work/SKILL.md
    ! .claude/settings.json

  settings.json has custom hook registrations

------------------------------------------------------------
How would you like to handle existing files?

  1. Fresh install - backup and replace all generated paths
  2. Merge - preserve custom hooks in settings.json, backup rest
  3. Preserve modified - skip files you've customized
  4. Cancel - exit without changes

Enter choice [1-4] or press Enter for merge:
```

Custom skills, commands, and hooks in non-generated paths are always preserved.
The wizard only prompts when there are conflicts with generated paths or custom
hook registrations in settings.json.

Pass `--non-interactive` to skip prompts and use merge strategy automatically.

## Project Detection and Scaffolding

After the tool wizard, setup scans for project boundaries: first-level
subdirectories that contain a recognized project file (`pyproject.toml`,
`package.json`, `go.mod`, `Cargo.toml`, `Makefile`, or `README.md`).

```
Detected project boundaries:
  1. api  [pyproject.toml, README.md]
  2. frontend  [package.json]
  3. infra  [Makefile]

Include all detected projects? [Y/n/o] 
```

- `Y` (the default) includes all detected projects.
- `n` skips all projects.
- `o` opens a menu to select projects by number or rename them.

Confirmed projects populate the project index table in `AGENTS.md`. Dry run
maps each confirmed top-level project directory to `projects/<project>/`.
Apply moves those directories into their canonical homes when needed. Projects
already under `projects/<project>/` stay there.

For each confirmed project, setup creates:

- `HANDOFF.md` - agent-facing operating brief, read order, routing rules, and
  directory contract
- `UPDATE.txt` - human-facing dated status log
- `internal/plans/active/` - directory for in-progress work plans
- `internal/plans/completed/` - directory for finished work plans
- `internal/resources/` - project-owned references and specifications
- `internal/state/` - project-owned validation records and local state
- `external/` - curated project deliverables

Existing project content is preserved. Existing `HANDOFF.md`, `UPDATE.txt`,
and scaffold directories are not overwritten. If a target canonical project
path already exists while setup is trying to move a top-level project there,
apply stops and reports the conflict.

Setup organizes detected project directories. It does not invent product or
codebase directories from names alone; create at least the project directories
first if the repository is empty.

## Operating Discipline Settings

After project confirmation, setup prompts for optional operating discipline
settings that control how strictly the harness enforces work patterns:

```
============================================================
OPERATING DISCIPLINE SETTINGS
============================================================

1. Plan Cold-Reader Quality Gate
   When enabled, warns if plans lack explicit pass/fail criteria
   and expected deliverables.

   Enable plan quality gate? [y/N]:

2. Loop-as-Default Mode
   When enabled, /execute continues with /loop until 100% complete
   rather than stopping after one pass.

   Enable loop-as-default? [y/N]:
```

These settings are stored in `.harness/config/discipline.json` and can be
changed at any time by editing that file. The harness enforces two behaviors
automatically without user configuration:

```json
{
  "plan_cold_reader_gate": true,
  "loop_as_default": false
}
```

- **Wiki/skill consultation**: At session start, the harness reminds the agent
  to read `.claude/wiki/index.md` and relevant skill files before starting work.
- **Surface maintenance reminders**: After significant file changes, the harness
  prompts the agent to update `HANDOFF.md`, `UPDATE.txt`, and wiki with what
  was learned.

Pass `--non-interactive` to skip discipline prompts and use defaults.

## Review the Manifest

After dry run, open `.harness/state/generation_manifest.json`:

| Action | Meaning |
|--------|---------|
| `create` | File does not exist; will be created |
| `modify` | A section can be appended safely |
| `backup_required` | Existing file will be backed up before replacement |
| `skip` | Target already matches generated content |
| `symlink` | Discovery pointer will be created when symlinks are supported |

Also review `selected_modules` and `unselected_modules`. Each unselected module
includes a reason so the absence is explainable.

## Apply

After reviewing the manifest:

```bash
harness setup . --apply
```

Apply creates or updates only the paths listed in the manifest. Files that need
replacement are backed up under `.harness/state/backups/`. Apply does not
commit files, create tags, push branches, or write outside the target repository.

## What You Have

After apply, the repository contains:

| Path | Purpose |
|------|---------|
| `AGENTS.md` | Root operating guide: project index, read order, routing posture |
| `CLAUDE.md` | Claude-facing supplement |
| `CODEX.md` | Codex-facing supplement |
| `.claude/SKILL_STANDARDS.md` | Anthropic skill authoring spec for creating new skills |
| `.claude/wiki/` | Local markdown wiki: index, log, content pages, skill index |
| `.claude/skills/agent-engineering-quality/` | Default non-trivial work contract and 100% rule reference |
| `.claude/skills/workspace-status/` | Report git status, active plans, and blockers |
| `.claude/skills/generating-prompts/` | Generate a resumption prompt for incomplete work |
| `.claude/skills/maintaining-wiki/` | Ingest changes and query durable context |
| `.claude/skills/planning-work/` | Investigate and produce a chunked work plan |
| `.claude/skills/executing-plans/` | Dispatch plan chunks and review results |
| `.claude/skills/orienting-session/` | Produce a session agenda from git and plan state |
| `.claude/skills/looping-to-completion/` | Apply the 100% rule: loop until nothing is missing |
| `.claude/skills/reviewing-work/` | Review generated surfaces and implementation evidence in one complete pass |
| `.claude/skills/auditing-completion/` | Audit final completion against the 100% rule |
| `.claude/skills/investigating-questions/` | Author a research notebook with a recorded conclusion |
| `.claude/skills/suggesting-skills/` | Generate new custom skills conforming to the spec |
| `.claude/commands/` | Slash-command wrappers: /status, /prompt, /wiki, /plan, /execute, /orient, /loop, /review, /audit, /investigate, /suggest |
| `.claude/hooks/pre/*.py` and `.claude/hooks/post/*.py` | Path guard, secret guard, destructive command guard, activity log, wiki reminder, prose guard, publication guard, commit gate, skill guard, session context, session discipline, notebook conformance, knowledge promotion, workflow completion sweep |
| `.claude/settings.json` | Hook registration |
| `.harness/config/` | Operating discipline and hook configuration |
| `.codex/` | Codex discovery directory that points to `.claude/` guidance |
| `projects/<project>/` | Canonical home for each confirmed project |
| `projects/<project>/HANDOFF.md` | Agent-facing project operating brief |
| `projects/<project>/UPDATE.txt` | Human-facing project status log |
| `projects/<project>/internal/` | Project-local plans, resources, state, scripts, and working artifacts |
| `projects/<project>/external/` | Curated professional deliverables |

Pre-hooks fire before tool execution and may block the operation. Post-hooks
fire after tool execution and observe without blocking.

Adaptive modules add targeted skills for detected repository types:

| Module | Selected when |
|--------|--------------|
| `python-package` | Python package files detected |
| `typescript-app` | JavaScript or TypeScript detected |
| `notebook-workspace` | Notebook files detected |
| `docs-site` | Documentation site structure detected |
| `ci-release` | CI configuration detected |
| `monorepo` | More than one project boundary detected |

## Daily Use

Open the repository in Claude Code or another supported agent CLI after
`harness setup . --apply`. Slash commands run inside that agent session:

```
/orient      produces a session agenda from git state and active plans
/plan        investigates a topic and writes a chunked work plan
/execute     dispatches plan chunks and marks them done
/loop        repeats plan-execute until the deliverable is 100% complete
/wiki        updates the local wiki when durable context changes
/status      git and plan status summary
/prompt      creates a resumption prompt for incomplete work
/investigate writes a research notebook for a tracked question
/suggest     generates a new custom skill for this repository
```

Each command reads `AGENTS.md` and the relevant skill file before starting.
The skill file points to `references/command.md` for the detailed workflow.

## Adding Custom Skills

To add a skill tailored to this repository:

```bash
# In a Claude Code session:
/suggest

# Validate the generated skill:
harness audit .
```

`harness audit .` validates every `.claude/skills/*/SKILL.md` against the
Anthropic agent skills specification and reports errors and warnings for each
skill. `harness lint .` includes skill compliance as one of five checks; use
`harness audit .` when you want skill-only detail with per-rule findings.

Read `.claude/SKILL_STANDARDS.md` before authoring or modifying any skill.
It encodes the name rules, description rules, body length limit, and the
validation and feedback loop.

## Keeping the Harness Current

The harness enforces its own quality through four mechanisms: a lint check,
four enforcement hooks that block on violations, a session discipline hook
that recommends task-specific reads before execution, and a session context
hook that restores workspace state after conversation compaction.

### Lint

`harness lint .` runs five checks and prints a pass/fail/warn report:

| Check | What it verifies |
|-------|-----------------|
| Wiki Index | Every page under `.claude/wiki/wiki/` has an entry in `index.md`; no link in `index.md` points to a missing file |
| Skill Compliance | Every `SKILL.md` in `.claude/skills/` passes the Anthropic agent skills spec |
| Hook Registration | Every `.py` path referenced in `.claude/settings.json` exists on disk |
| Wiki Reminders | Fewer than 5 distinct files have pending wiki-update reminders queued |
| Engineering Quality | Generated engineering-quality skills, wiki page, and blocking plan/completion guards are present |

Run `harness lint .` after any bulk edit to the skills or wiki directories to
catch drift before it accumulates.

### Knowledge Preflight Enforcement

The harness enforces that agents read knowledge surfaces before modifying files
or spawning sub-agents. This prevents agents from bypassing the wiki, skills,
memory, and project context that the harness provides.

**Required reads before any file modification or agent spawn:**
- `.claude/wiki/index.md` (wiki_index)
- `AGENTS.md` (agents_md)
- `CLAUDE.md` (claude_md)
- `.claude/skills.json` (skills_index)

**Additional requirements for project work:**
- The project wiki page under `.claude/wiki/wiki/projects/<project>.md`
- Relevant skill files when modifying `.claude/skills/<skill>/`
- Relevant memory entries when work touches categories with prior corrections

The enforcement works through three hooks:

| Hook | Trigger | What it does |
|------|---------|-------------|
| `reset_session_state.py` | SessionStart | Clears session tracking so each conversation starts fresh |
| `track_knowledge_reads.py` | PostToolUse on Read | Records which knowledge surfaces have been read this session |
| `knowledge_preflight_guard.py` | PreToolUse on Write/Edit/Agent | Blocks file modifications and agent spawns until required surfaces are read |
| `memory_enforcement_guard.py` | PreToolUse on Write/Edit/Agent/Bash | Blocks work matching memory categories until relevant memory entries are read |

This enforcement has zero grace period: agents must read knowledge surfaces
before their first file modification. The hooks exempt state files
(`.harness/state/`, `.claude/state/`) and settings files to allow bootstrap
operations.

### Enforcement Hooks

Seven hooks fire before Claude writes or runs shell commands and will block the operation:

| Hook | Trigger | What it blocks |
|------|---------|---------------|
| `knowledge_preflight_guard.py` | Write/Edit/Agent | Blocks until required knowledge surfaces (wiki index, AGENTS.md, CLAUDE.md, skills index) are read |
| `memory_enforcement_guard.py` | Write/Edit/Agent/Bash | Blocks work matching memory categories until relevant memory entries are read |
| `commit_gate.py` | Bash commands matching `git commit` | All `git commit` invocations except `--help`; requires explicit human approval before committing |
| `skill_guard.py` | Write to `.claude/skills/*/SKILL.md` | Skills with missing or malformed name and description fields, names that violate the alphanumeric-hyphen rule (lowercase letters, digits, and hyphens only), and descriptions without a trigger clause |
| `destructive_guard.py` | Bash commands with destructive patterns | Blocks force push, hard reset, checkout dot, clean force, branch force delete, and unsafe rm commands |
| `external_boundary_guard.py` | Write or Edit to `projects/*/external/` | Blocks non-deliverable file types, operational document patterns, and internal reference leaks |
| `notebook_conformance_check.py` | Write to `.ipynb` files in research or external paths | Validates notebook structure: opening sections, consecutive code cell limit (default: 3), decision codes, forbidden patterns such as `os.system` calls and `subprocess` calls that lack a timeout parameter, absolute paths, and LLM prose markers such as "I'll", "Let me", or "Here's what I found" |

The destructive guard uses a configurable safe cleanup paths list at
`.harness/config/safe_cleanup_paths.json`. By default, `rm -rf` targeting
`/tmp/` paths is allowed.

The external boundary guard runs three checks on files written to external
surfaces: file type allowlist (only `.md`, `.ipynb`, `.json`, `.png`, etc.),
filename pattern blocklist (no `HOOK`, `CONFIG`, `STANDARD` names), and content
pattern blocklist (no orchestration labels, internal path references, or
agent-centric language).

### Self-Managing Hooks

Three hooks implement the learning loop and session observability:

| Hook | Trigger | What it does |
|------|---------|-------------|
| `learn_from_failure.py` | PostToolUseFailure on Bash commands | Matches stderr against known error patterns, logs unknown errors, detects subsequent fixes, and prompts the agent to add new patterns |
| `doom_loop_detector.py` | PostToolUse on all tools | Detects repetitive tool calls with model-aware patience limits; escalates warnings from suggestion to strong redirect to stop |
| `activity_logger.py` | PostToolUse on all tools | Appends a compact JSONL entry to `.harness/state/activity.jsonl` with timestamp, tool name, success status, and description |

The learning hook implements a 4-stage loop: detect error via pattern match,
detect fix via subsequent Edit or Write, prompt the agent to complete the loop
by adding the pattern and searching for sibling occurrences, and escalate
patterns with high hit counts that lack preventive hooks.

The doom loop detector tracks tool call fingerprints in a sliding window and
detects five loop types: repeated action, repeated failure, no progress,
circular plan, and repeated output. Model-aware patience limits apply: opus
triggers immediately, sonnet on second occurrence, other models on fourth.

### Knowledge Freshness Hook

| Hook | Trigger | What it does |
|------|---------|-------------|
| `knowledge_freshness_check.py` | Edit or Write to `plans/completed/*.md` | Checks if referenced files were modified after the plan was created and warns the agent |

### Wiki Maintenance Hooks

Two hooks maintain the wiki backlog and trigger maintenance at workflow boundaries:

| Hook | Trigger | What it does |
|------|---------|-------------|
| `knowledge_promotion_check.py` | Edit or Write to hooks, skills, or external directories | Queues wiki maintenance backlog entries when project artifacts change; dispatches semantic maintainer for wiki synthesis updates |
| `workflow_completion_wiki_sweep.py` | PostToolUse matching workflow completion patterns | Detects workflow completion signals and advises draining pending wiki maintenance before signoff |

The knowledge promotion hook fires when paths matching `.claude/hooks/`, `.claude/skills/`, `projects/*/external/`, `projects/*/HANDOFF.md`, `projects/*/UPDATE.txt`, or files ending with `-HANDOFF.md` or `-UPDATE.txt` are modified. Each trigger queues an entry in the wiki maintenance backlog with a suggested starting page and family hints.

The workflow completion sweep detects patterns like `[SHEBANG] Complete`, `plans/completed/`, and `[EXECUTE] Complete` in tool results. When pending maintenance exists, it returns an advisory message prompting the agent to drain the backlog before completing the workflow.

Two hooks fire after each tool call and observe without blocking:

| Hook | Trigger | What it records |
|------|---------|----------------|
| `error_tracker.py` | Any tool that returns a non-zero exit code or an error field | Appends `{at, tool, exit_code, error, command/path}` to `.harness/state/error_patterns.jsonl` for drift detection |
| `handoff_reminder.py` | Write or Edit to a file matching `plans/completed/*.md` | Appends a reminder entry to `.harness/state/handoff_reminders.jsonl` and prints a message to stderr prompting the agent to update `HANDOFF.md` and `UPDATE.txt` |

### Session Discipline Hook

`session_start_discipline.py` fires on `SessionStart` at the beginning of every
session. It detects the current task type from active plans and recent git
activity, then outputs a discipline reminder listing specific wiki pages, skill
files, and project continuity documents the agent should read before execution.
This counters the tendency to skip reading existing patterns and prevents
trial-and-error when documented solutions already exist.

### Session Context Hook

`session_context.py` fires on `SessionStart` when Claude detects a context
compaction event. It reads harness state files and prints a structured context
block to stdout with the repository name, tool tier, profile version, wiki page
count, pending reminder count, and active plan names. This lets the agent
resume a long session without losing workspace orientation.

## Dashboard

Start the local read-only status dashboard:

```bash
harness setup . --serve --port 8765
```

Open `http://127.0.0.1:8765`. The dashboard shows harness state, selected
modules, setup status, and next-command guidance. It does not write to the
repository.

The Health section shows live lint results. Each check appears with a signal
color: green for pass, red for fail, amber for warn. Open the Health section
to see which checks need attention without running the CLI.

The dashboard uses three verdict states: Ready, Attention, and Blocked. Health
rows use healthy, attention, blocked, or optional signals to show whether a
check passed cleanly, needs action, failed, or is informational-only and does
not affect the overall verdict.

<details>
<summary>Forwarded-port environments (SageMaker CodeEditor, etc.)</summary>

Bind to `0.0.0.0` so the port is reachable through the IDE proxy:

```bash
harness setup . --serve --host 0.0.0.0 --port 8765
```

In SageMaker CodeEditor, open the forwarded route:

```bash
/opt/conda/share/sagemaker-code-editor/bin/helpers/browser.sh \
  "https://<space>.studio.<region>.sagemaker.aws/codeeditor/default/ports/8765/"
```

The working route uses `/codeeditor/default/ports/`; `/codeeditor/default/proxy/`
is compatibility only.

</details>

## Wiki

The wiki is a local markdown knowledge base at `.claude/wiki/` for cross-session
agent orientation. Source files remain authoritative; the wiki synthesizes
across them.

`harness setup . --apply` creates the standard wiki files for a new harnessed
repository. Use the wiki CLI below for repair, maintenance, and advanced wiki
operations after setup.

### Repair Init

Initialize missing wiki structure without overwriting existing files:

```bash
harness wiki init .
```

This creates index.md, log.md, wiki directories, settings, and templates.

### Commands

- `harness wiki init .` - scaffold wiki structure
- `harness wiki status .` - show wiki state and maintenance backlog
- `harness wiki lint .` - validate wiki structure (including hash-based staleness)
- `harness wiki search . <query>` - search wiki pages
- `harness wiki preflight . --task "..."` - mint context receipt for writes
- `harness wiki semantic-lint .` - detect contradictions between pages
- `harness wiki extract-learnings .` - find wiki candidates from activity
- `harness wiki pending-synthesis .` - show synthesis candidates
- `harness wiki build-skill-index .` - regenerate skill index from SKILL.md files

### Wiki Maintenance Features (0.4.0)

Version 0.4.0 adds four wiki-maintenance features. The pattern treats the wiki
as a compounding knowledge base that agents actively maintain while they work:

**Hash-based staleness tracking**: Wiki pages record SHA256 hashes of their
source files. `wiki lint` detects when source content changes even if the
mtime stayed the same (common after git operations).

**Semantic lint**: `wiki semantic-lint` finds wiki page pairs that cite the
same sources and flags them for contradiction/redundancy review. Use
`--add-to-backlog` to queue findings for maintenance.

**Session learning extraction**: `wiki extract-learnings` analyzes the activity
log for patterns that suggest wiki-worthy content: error-fix sequences
(failure followed by success on the same file) and repeated lookups (same
file read 3+ times).

**Automatic synthesis capture**: The `synthesis_capture.py` hook tracks Read
operations and detects when a Write or Edit follows multiple Reads from
different files. These multi-source synthesis events become wiki candidates
viewable with `wiki pending-synthesis`.

### Skill Index

The generated wiki includes a skill index page at
`.claude/wiki/wiki/reference/skill-index.md`. This page lists all skills with
their trigger phrases for agent discovery.

When you add custom skills via `/suggest` and validate with `harness audit`,
regenerate the skill index:

```bash
harness wiki build-skill-index .
```

### Receipt Gate

Wiki writes require a fresh context receipt. Before editing wiki pages or
running write-capable wiki commands, run:

```bash
harness wiki preflight . --task "your task description"
```

The receipt expires after 2 hours. The `wiki_receipt_guard.py` hook blocks
writes without a valid receipt.

### Maintenance Backlog

The wiki captures pending maintenance entries when source files change.
Check status with:

```bash
harness wiki status .
```

## Validate

Run workspace validation checks:

```bash
harness validate . --project projects/myproject --plans plans/active
```

The validate command runs five checks:

| Check | What it verifies |
|-------|-----------------|
| 100% Rule | Source files contain no incomplete-work markers such as unfinished-task markers, fix-me markers, temporary filler comments, or skeletal implementations |
| Project Continuity | Project directory has HANDOFF.md and UPDATE.txt files |
| Plan Completeness | Active plans have all work chunks marked done |
| Wiki State | Wiki structure is valid: index.md exists with family sections, log.md has entries, settings and backlog are valid JSON |
| Workspace Hygiene | Comprehensive health check combining wiki lint, skill compliance, hook registration, and pending maintenance count |

Results are printed as JSON with pass/fail status and violation details for
each check. The `all_passed` key indicates whether all checks passed.

## Rollback

Restore the repository to its state before the last apply:

```bash
harness rollback .
```

Rollback removes files created by the last apply run, restores backed-up files,
removes project scaffold files created by setup, and reverses reviewed project
directory moves when the move was recorded and nothing exists at the original
source path. If no ledger exists, rollback stops without changing files.

## Re-Running Setup

Re-run setup when:

- A new AI tool is installed and the routing section in `AGENTS.md` should change.
- The repository's project structure changes and the project index needs updating.
- New adaptive modules should be selected after adding Python, TypeScript,
  notebooks, CI files, or documentation.

```bash
harness setup                # guided review and apply
harness setup . --dry-run --json
harness setup . --apply --json
harness --update             # reinstall the latest package from the repository
```
