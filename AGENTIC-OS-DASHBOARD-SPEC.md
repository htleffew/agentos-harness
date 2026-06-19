# AGENTIC OS DASHBOARD — COMPLETE SPECIFICATION & IMPLEMENTATION PLAN

**Version:** 1.2.0-draft  
**Status:** Pre-implementation  
**Replaces:** `harness setup . --serve` (existing harness dashboard)

**Changelog:**
- v1.2.0 — Closed open question 4: shared `activity.jsonl`, not a separate file. Three open questions remain (§15).
- v1.1.0 — Closed open questions 2 and 3 via `track_knowledge_reads.py` review and empirical Codex/Gemini output format strategy. Added tier-aware preamble (§5.1), Codex-specific preflight extension (§5.4), estimated cost tracking for non-Claude agents (§11.3), dispatch-tagging approach for activity.jsonl (§15).

---

## 1. EXECUTIVE SUMMARY

This document specifies a unified mission-control dashboard that combines:

- **Chase AI's terminal cockpit aesthetic** — domain-organized skill buttons, token telemetry, run output panel
- **Mission Control's task management depth** — Kanban, Eisenhower matrix, brain dump with AI triage, agent crew, continuous missions, loop detection
- **agentos-harness integration** — all enforcement hooks fire, multi-model routing is visible, skills are auto-discovered from `.claude/skills/`, activity data is sourced from `.harness/state/activity.jsonl`

The result is a single `dashboard` command that installs as part of the harness, travels with the repo, reads the harness's existing state files as its source of truth, and wraps every dispatched agent session in a compliant preflight preamble so no hook is bypassed.

---

## 2. SYSTEM CONTEXT & CONSTRAINTS

### 2.1 What the Harness Already Owns (Dashboard Must Not Duplicate)

| Harness artifact | Dashboard relationship |
|---|---|
| `.claude/skills/<domain>/<skill>/SKILL.md` | Source of truth for skill discovery — read-only by dashboard |
| `.harness/state/activity.jsonl` | Source of truth for frequency/recency — dashboard reads, never writes |
| `.harness/state/session/knowledge_reads.json` | Session state — dashboard reads to show preflight status |
| `.harness/config/discipline.json` | Operating discipline — dashboard reads and exposes in UI |
| `.claude/settings.json` skillOverrides | Skill visibility — dashboard respects `"off"` and `"user-invocable-only"` |
| `AGENTS.md` | Multi-model routing tier — dashboard reads to determine which agents are available |
| `CLAUDE.md` | Context — included in preflight preamble |
| `.claude/wiki/index.md` | Required preflight read — included in preflight preamble |
| `.claude/skills.json` | Skills index — included in preflight preamble |

### 2.2 What the Dashboard Owns

| Dashboard artifact | Location | Purpose |
|---|---|---|
| Dashboard config | `.harness/config/dashboard.json` | Port, theme, domain display order, pinned skills |
| Usage cache | `.harness/state/dashboard-usage.json` | Derived frequency/recency cache from activity.jsonl |
| Task store | `.harness/state/dashboard-tasks.json` | Kanban tasks, brain dump entries, goals |
| Mission store | `.harness/state/dashboard-missions.json` | Continuous mission state, dependency chains |
| Active runs | `.harness/state/dashboard-runs.json` | Live session tracking (PIDs, status, cost, tokens) |

All paths are inside `.harness/state/` or `.harness/config/`, both of which are in `EXEMPT_PATHS` in `knowledge_preflight_guard.py` and ignored by `harness lint`. No harness validation noise.

### 2.3 Portability Contract

The dashboard is a harness module. It:
- Installs via `harness setup . --apply` (extended) or standalone `harness dashboard install .`
- Runs via `harness dashboard start` from within the repo root
- Reads `CLAUDE_PROJECT_DIR` (same env var the hooks use) to locate all harness artifacts
- Port defaults to `8768`; configurable in `.harness/config/dashboard.json`
- Process travels with the repo — different machines, same command, same experience

---

## 3. ARCHITECTURE

### 3.1 Tech Stack Decision

**Next.js 15 (TypeScript, App Router) + Tailwind CSS**

Rationale:
- Mission Control proved this stack works for exactly this use case with 193 tests
- Gives real-time UI via Server-Sent Events without WebSocket complexity
- TypeScript strict mode matches harness engineering quality standards
- Zod validation on all data writes (same pattern as Mission Control)
- Async-mutex on concurrent writes from multiple agent sessions
- Streamlit was considered and rejected: not TypeScript, poor real-time story, harder to build Kanban/drag-drop, no test infrastructure

**Process model:** `harness dashboard start` spawns two processes managed by a single PM2 ecosystem config:
1. Next.js web server (port 8768)
2. Node.js daemon (polls for pending tasks, manages session lifecycle)

### 3.2 Data Flow

```
.claude/skills/<domain>/<skill>/SKILL.md
        │
        ▼ (read at startup + on fs.watch)
Dashboard Skill Registry (in-memory)
        │
        ▼ (button click)
Preflight Preamble Builder
        │
        ▼ (assembled prompt)
claude -p "<preamble>\n\n<skill prompt>" --cwd <repo> --output-format stream-json
        │
        ├── hooks fire (knowledge_preflight_guard, activity_logger, etc.)
        │
        ▼ (stream)
Run Output Panel (SSE)
        │
        ▼ (on complete)
.harness/state/activity.jsonl (written by activity_logger hook)
        │
        ▼ (read by dashboard)
Skill frequency/recency cache → button sort order
```

### 3.3 Multi-Model Routing

The dashboard reads `AGENTS.md` at startup to detect the installed tier:

| Tier | What dashboard shows |
|---|---|
| `claude-only` | Single agent column per task |
| `claude-codex` | Claude lead + Codex reviewer columns |
| `claude-gemini` | Claude lead + Gemini reviewer columns |
| `full-moe` | Claude + Codex + Gemini columns, each with own status |

For skill button dispatches: routing is determined by the skill's own workflow (as defined in its SKILL.md body). The dashboard dispatches to Claude as the entry point; the skill's internal instructions handle multi-model handoff per the harness contract (`/plan → consensus → /execute → /loop → audit`).

For Kanban tasks with explicit agent assignment: the dashboard dispatches directly to the assigned agent CLI (`claude -p`, `codex -p`, or `gemini --prompt`) based on assignment.

---

## 4. SKILL DISCOVERY & ORGANIZATION

### 4.1 Discovery Algorithm

On startup and on `fs.watch` of `.claude/skills/`:

```
for each directory in .claude/skills/<domain>/<skill>/SKILL.md:
  parse frontmatter → { name, description }
  domain = parent directory name of skill directory
  check .claude/settings.json skillOverrides:
    if "off" → skip
    if "user-invocable-only" → show in UI but mark as slash-command-only
    default → show normally
  derive display label from `name` field (title-case, hyphen → space)
  derive domain display name from directory name (title-case, hyphen → space)
```

### 4.2 Sort Order Within Domains

Skills within each domain are sorted by a composite score:

```
score = (recency_weight × days_since_last_run⁻¹) + (frequency_weight × run_count_30d)
```

Both weights are configurable in `.harness/config/dashboard.json`. Default: recency 0.6, frequency 0.4. Frequency and recency derived from `.harness/state/activity.jsonl` — match on `desc` field containing the skill name, filtered to `ok: true` entries.

On first install with no activity history: alphabetical within domain.

### 4.3 Domain Display Order

Default order (configurable in `.harness/config/dashboard.json`):

```json
{ "domainOrder": ["daily", "productivity", "research", "content", "community", "ops", "custom"] }
```

Domains not in the list appear appended alphabetically. The setup wizard prompts for domain order during installation.

### 4.4 Built-in Harness Skill Mapping

The harness's generated skills map to these domains automatically:

| Harness skill directory | Auto-assigned domain |
|---|---|
| `planning-work` | DAILY |
| `executing-plans` | DAILY |
| `looping-to-completion` | DAILY |
| `orienting-session` | DAILY |
| `workspace-status` | DAILY |
| `reviewing-work` | DAILY |
| `auditing-completion` | DAILY |
| `maintaining-wiki` | PRODUCTIVITY |
| `investigating-questions` | RESEARCH |
| `suggesting-skills` | OPS |
| `generating-prompts` | OPS |
| `agent-engineering-quality` | OPS |

Custom skills fall into whatever domain their directory path specifies.

---

## 5. PREFLIGHT PREAMBLE SYSTEM

Every prompt dispatched by the dashboard (skill buttons, Kanban task execution, daemon runs) is prepended with a standard preamble before the skill-specific content.

### 5.1 Preamble Template

The preamble is tier-aware. `track_knowledge_reads.py` defines `KNOWLEDGE_SURFACES` as:

```python
KNOWLEDGE_SURFACES = {
    "wiki_index":   ".claude/wiki/index.md",
    "agents_md":    "AGENTS.md",
    "claude_md":    "CLAUDE.md",
    "codex_md":     "CODEX.md",          # tracked but not in ALWAYS_REQUIRED
    "skills_index": ".claude/skills.json",
}
```

`knowledge_preflight_guard.py` enforces `ALWAYS_REQUIRED = ["wiki_index", "agents_md", "claude_md", "skills_index"]`. `codex_md` is tracked but not enforced as always-required — however it should still be read when Codex is the dispatched agent, both for correctness and because the Codex session orientation depends on it.

**Base preamble (all agents):**

```
DASHBOARD SESSION PREFLIGHT

Before taking any action, read these knowledge surfaces in order:
1. Read `.claude/wiki/index.md`
2. Read `AGENTS.md`
3. Read `CLAUDE.md`
4. Read `.claude/skills.json`

These reads satisfy the knowledge_preflight_guard requirement. Do not write,
edit, or spawn sub-agents until all four reads are complete.

After reading, proceed with the following task:

---

{skill_prompt}
```

**Codex-tier addition** (appended when dispatched agent is Codex):

```
5. Read `CODEX.md`
```

The preamble builder (`src/lib/harness/preflight.ts`) accepts the dispatched agent as a parameter and conditionally appends the Codex extension. The count in "do not write until all N reads are complete" is updated accordingly (four for Claude/Gemini, five for Codex).

### 5.2 Project-Scoped Preamble Extension

If the task is scoped to a specific project (detectable from the skill prompt or explicit task metadata), the preamble appends:

```
5. Read `projects/{project}/HANDOFF.md`
6. Read `.claude/wiki/wiki/projects/{project}.md` (if it exists)
```

This satisfies the project-wiki requirement in `_check_requirements`.

### 5.3 Skill-Scoped Preamble Extension

If the task modifies a skill (e.g., the `suggesting-skills` skill), the preamble appends:

```
7. Read `.claude/skills/{skill-name}/SKILL.md` before modifying it
8. Read `.claude/SKILL_STANDARDS.md`
```

### 5.4 User Transparency

The run output panel shows a collapsible **PREFLIGHT** section at the top of every run, displaying which surfaces were read and their read timestamps (sourced from `knowledge_reads.json`). Users can see that the guard was satisfied without needing to understand why.

---

## 6. UI SPECIFICATION

### 6.1 Visual Design

**Aesthetic:** Chase AI terminal cockpit. Non-negotiable.

- Font: JetBrains Mono everywhere, no exceptions
- Color system: CSS variables matching Chase AI's palette (`--bg`, `--bg-card`, `--accent` orange-red, `--fg`, `--fg-mute`, `--ring-soft`)
- All labels uppercase, letter-spacing 0.06–0.14em
- Border radius: 2–3px maximum (cockpit, not consumer app)
- Box shadows ring-only, no drop shadows
- Dark only

Tailwind is configured with a custom theme that maps these variables. shadcn/ui components are reskinned to match.

### 6.2 Page Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│ AGENTIC OS  [SKILLS] [KANBAN] [MATRIX] [BRAIN DUMP] [MISSIONS] [OPS]│
│ ── token windows ── activity chart ── MCP/agent strip ──────────────│
├──────────────────────────────────────┬──────────────────────────────┤
│  PAGE CONTENT (route-dependent)      │  PERSISTENT SIDEBAR          │
│                                      │  · Recent runs               │
│                                      │  · Multi-model status        │
│                                      │  · Forecast                  │
│                                      │  · Vault/harness pulse       │
│                                      │  · Upcoming routines         │
└──────────────────────────────────────┴──────────────────────────────┘
```

### 6.3 Global Header (Persistent)

**Left:** AGENTIC OS logotype + repo name (read from `package.json` or `AGENTS.md`)

**Center nav tabs:**
- SKILLS (default)
- KANBAN
- MATRIX (Eisenhower)
- BRAIN DUMP
- MISSIONS
- OPS (harness health, lint status, wiki state)

**Right:** 
- Active agent indicators (Claude 🟢 / Codex 🟡 / Gemini 🔵) with live session count
- DEEP RESEARCH quick-launch button (most-used skill, pinnable)

### 6.4 Token Windows Bar (Persistent, below header)

Three cards:

| Card | Source | Display |
|---|---|---|
| 5-HOUR WINDOW | `.harness/state/activity.jsonl` last 5h, `discipline.json` limit | `X.XM / 5.0M` + fill bar |
| WEEKLY WINDOW | Same, last 7d | `XX.XM / 60.0M` + fill bar |
| ROUTINES · TODAY | Count of daemon-dispatched runs in last 24h | `N / MAX` + fill bar |

Bar color: green < 55%, amber 55–80%, red > 80%.

### 6.5 Activity Chart (Persistent, below token windows)

30-day cumulative token activity. Orange line on dark background. Plotted from `activity.jsonl`. Annotation: total last 300d (top right), delta last 7d.

### 6.6 Agent/Integration Strip (Persistent)

Pill chips showing:
- Detected agent tier from `AGENTS.md` (e.g., `● claude  ● codex  ● gemini`)
- MCP servers from `.claude/settings.json` mcpServers block
- Live session count per agent

---

## 7. PAGE SPECIFICATIONS

### 7.1 SKILLS Page

**Layout:** Domain columns, up to 3 per row, overflow to next row.

Each domain card:
```
// DOMAIN NAME
──────────────────
▶ SKILL NAME          [last run: 2h ago]
  description excerpt (1 line, truncated)

▶ SKILL NAME          [run count: 47]
  ...

[+ ADD SKILL TO DOMAIN]
```

Skill button behavior:
- Click → opens run input drawer (if skill prompt contains `{input}` placeholders) or fires immediately
- Long-press / right-click → context menu: Pin to top, Disable, Edit prompt, View SKILL.md
- Running state: button border pulses orange, shows spinner
- Done state: border flashes green briefly, run count increments

Skills marked `user-invocable-only` in skillOverrides show with a slash-command badge and do not dispatch headlessly — they display the slash command to run instead.

**Domain wizard button:** `+ NEW DOMAIN` at end of domain list → opens the setup wizard inline.

### 7.2 KANBAN Page

Three columns: **NOT STARTED** · **IN PROGRESS** · **DONE**

Task card fields:
- Title
- Domain tag (color-coded)
- Assigned agent (Claude / Codex / Gemini / Me)
- Linked skill (optional — selecting a skill pre-fills the execution prompt)
- Priority (P1–P4)
- Subtasks (checklist)
- Acceptance criteria
- Notes (append-only log)
- Cost tracker (cumulative tokens + USD from all runs on this task)

Task card actions:
- ▶ Launch — dispatches to assigned agent with preflight preamble
- ⏸ Stop — kills process tree
- ↻ Continue — re-spawns continuation session with progress context injected
- Move between columns (drag-and-drop via dnd-kit)

**Multi-agent task view:** When a task has a lead + reviewers, each agent gets its own status lane within the card:

```
[CLAUDE] planning ████░░ → [CODEX] reviewing ░░░░░░ → [GEMINI] pending
```

This reflects the `/plan → consensus → /execute → /loop → audit` contract visually.

**Loop detection:** After 3 failed attempts on a task, the card enters LOOP DETECTED state — red border, escalation prompt asking user to: retry differently, reassign agent, or stop.

**Session resilience:** Timed-out sessions auto-respawn with a continuation prompt that includes task notes and last-known progress, up to a configurable max (default: 3 continuations per task).

### 7.3 MATRIX Page (Eisenhower)

Four quadrants: DO (urgent+important) · SCHEDULE (important, not urgent) · DELEGATE (urgent, not important) · ELIMINATE (neither)

Tasks draggable between quadrants. Quadrant placement stored in task store. The DELEGATE quadrant shows the assigned agent alongside the task — delegating to Claude is a first-class action.

Filter bar: by domain, by agent, by project.

### 7.4 BRAIN DUMP Page

**Input:** Large text area. Keyboard shortcut: `Cmd+Shift+B` from anywhere in the app to focus it. Voice input button (invokes OS speech-to-text via Web Speech API).

**Capture modes:**
- Quick capture (no triage — just saves to brain dump list)
- Auto-triage (default) — on submit, fires a background Claude session with the triage prompt

**AI Triage Prompt (auto-generated, uses preflight preamble):**

```
You are triaging a brain dump entry into the task management system.

Entry: "{brain_dump_text}"

Analyze this entry and return JSON only:
{
  "title": "concise task title",
  "domain": "best matching domain from available domains",
  "suggested_skill": "skill name if a harness skill applies, else null",
  "urgency": "high|medium|low",
  "importance": "high|medium|low",
  "quadrant": "do|schedule|delegate|eliminate",
  "suggested_agent": "claude|codex|gemini|me",
  "notes": "any context or decomposition notes",
  "is_task": true/false,
  "if_not_task_reason": "if is_task=false, why (e.g. reference, idea, question)"
}

Base domain and skill suggestions on the available skills: {skills_index_summary}
```

**Triage result UI:** Shows the triage card with all suggested values pre-filled, editable before saving. One-click "Send to Kanban" or "Send to Matrix" or "Discard".

**Brain dump list:** Untriaged entries shown below the input. Each has a ▶ TRIAGE button to manually trigger AI triage and a 🗑 DISCARD button.

### 7.5 MISSIONS Page

A mission is a group of tasks that auto-dispatch sequentially or in parallel, respecting dependency chains.

**Mission card:**
- Name + description
- Task list with dependency arrows
- Progress bar (N/total done)
- ▶ START MISSION — dispatches all eligible tasks; as each completes, the next batch auto-dispatches
- ⏸ PAUSE — stops new dispatches; in-flight sessions finish
- ⏹ STOP — kills all active sessions, resets in-flight tasks to NOT STARTED

**Continuous mission loop:** The dashboard daemon polls every 30s for missions in running state, dispatches newly unblocked tasks, and reconciles stuck missions (tasks marked in-progress with no active PID → reset to NOT STARTED).

### 7.6 OPS Page

Split into four panels:

**Harness Health** (replaces `harness setup . --serve`):
- Live results of `harness lint .` — 5 checks with green/amber/red signals
- Engineering Quality signal
- Hook registration status
- Wiki state summary (page count, pending maintenance count)
- Last lint timestamp + manual re-run button

**Wiki State:**
- Pages with pending maintenance (from `.harness/state/`)
- Stale pages detected (SHA256 mismatch)
- Synthesis candidates

**Skill Audit:**
- All skills with compliance status (passes `harness audit .`)
- skillOverrides current state
- Link to SKILL_STANDARDS.md

**System:**
- Installed agent tier
- `.harness/config/discipline.json` values (editable in UI)
- Dashboard version, harness version
- Log viewer for `.harness/state/activity.jsonl`

---

## 8. PERSISTENT SIDEBAR

### 8.1 Recent Runs

Last 20 skill/task dispatches. Each row:
```
21:22  DEEP RESEARCH          [OPEN ↗]
       claude · 2.5k in · 1.2k out · $0.021
```

OPEN loads that run's full output into the run output panel.

### 8.2 Multi-Model Status Panel

Live view of all active sessions across all agents:

```
● CLAUDE    [2 active]
  task-abc  planning     ████░░░░  3m
  task-def  executing    ██████░░  7m

● CODEX     [1 active]
  task-abc  reviewing    ██░░░░░░  1m

○ GEMINI    [idle]
```

Each session row has a ⏸ stop button.

### 8.3 Forecast

```
FORECAST · 5H
BURN  27.4k/min
STATUS  UNDER CAP
CAP AT  22:39
```

### 8.4 Harness Pulse

Recently modified files in the repo (reads `activity.jsonl` for Write/Edit events):

```
[UPDATED]  HANDOFF.md         projects/api  2m
[CREATED]  2026-05-10-plan.md  plans/active  14m
[UPDATED]  SKILL.md           .claude/skills/research  1h
```

### 8.5 Upcoming Routines

Daemon-scheduled tasks with next-run ETAs:

```
22:00  VAULT COMPACT       IN 4H
09:00  MORNING BRIEF       IN 11H
```

---

## 9. RUN OUTPUT PANEL

Shown as a bottom drawer or right panel (user-configurable). Appears on any skill/task dispatch.

### 9.1 Panel Anatomy

```
LAST RUN · DEEP RESEARCH                    [↻ RERUN] [md] [✕]
COMPLETE ●
● OPEN IN EDITOR — .harness/state/runs/2026-05-10-21-22-deep-research.md
$0.021 · 2,587 IN · 1,204 OUT

▼ PREFLIGHT    [wiki_index ✓] [agents_md ✓] [claude_md ✓] [skills_index ✓]

OUTPUT
───────
{structured output text}

SOURCES
· https://...
· https://...

FILE
raw/2026-05-10-deep-research.md
```

### 9.2 Output Format Enforcement

The preflight preamble includes an output format requirement for all skill runs:

```
Format your final response with these sections:
## OUTPUT
(the substantive result)

## SOURCES
(URLs used, one per line, prefixed with ·)

## FILE
(path where output was saved, if applicable)
```

The dashboard parses these sections to display them in the structured panel.

### 9.3 Streaming

Output streams via SSE as the `claude -p --output-format stream-json` session runs. The panel renders incrementally. A live token counter updates in the header.

---

## 10. SETUP WIZARD

### 10.1 Trigger

`harness dashboard install .` (new harness subcommand) or prompted automatically by `harness setup . --apply` if dashboard module is selected.

Detects existing dashboard config and offers: Fresh install / Update / Preserve customizations.

### 10.2 Wizard Steps

**Step 1 — Skill discovery preview**
Shows all discovered skills grouped by auto-detected domain. User can:
- Rename domain display labels
- Drag skills between domains
- Disable skills from dashboard (sets skillOverrides)
- Set domain display order

**Step 2 — Domain configuration**
For each domain, set:
- Display name
- Icon (single emoji or none)
- Color accent (for domain card header)
- Whether domain is collapsed by default

**Step 3 — Agent routing confirmation**
Shows detected tier from `AGENTS.md`. Confirms which CLI paths are on PATH (`which claude`, `which codex`, `which gemini`). Warns if a tier agent is specified in AGENTS.md but not found on PATH.

**Step 4 — Daemon configuration**
- Enable/disable autonomous daemon
- Set concurrency limit (default: 2 simultaneous sessions)
- Configure scheduled routines (morning brief, vault compact, etc.) with cron expressions
- Max continuations per task (default: 3)

**Step 5 — Dashboard config**
- Port (default 8768)
- Pinned skill (shown as quick-launch button in header)
- Token limit overrides (if different from harness defaults)

**Step 6 — Review & apply**
Shows `.harness/config/dashboard.json` preview. Confirm to write.

---

## 11. DAEMON

The daemon is a Node.js process (`scripts/daemon/index.ts`) that runs alongside the Next.js server.

### 11.1 Responsibilities

- Poll `dashboard-tasks.json` every 30s for tasks in NOT STARTED with `auto_dispatch: true`
- Enforce concurrency limits (default: 2)
- Dispatch eligible tasks via `claude -p` (or codex/gemini per assignment) with preflight preamble
- Track PIDs in `dashboard-runs.json`
- Detect stuck sessions (PID dead but task still in-progress) → reset task
- Run loop detection (3 failures → escalate)
- Execute cron-scheduled routines
- Auto-spawn continuation sessions for timed-out tasks (up to max continuations)
- Write cost/token data from stream-json output to task store on completion

### 11.2 Session Dispatch

```typescript
const proc = spawn('claude', [
  '-p', `${preflightPreamble}\n\n${skillPrompt}`,
  '--output-format', 'stream-json',
  '--cwd', projectDir,
], { cwd: projectDir, env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir } });
```

`CLAUDE_PROJECT_DIR` is explicitly set so all hooks resolve paths correctly.

For Codex:
```typescript
const proc = spawn('codex', ['-p', `${preflightPreamble}\n\n${skillPrompt}`], { cwd: projectDir });
```

For Gemini:
```typescript
const proc = spawn('gemini', ['--prompt', `${preflightPreamble}\n\n${skillPrompt}`], { cwd: projectDir });
```

### 11.3 Cost Tracking

**Claude (exact):** Parse `stream-json` output for usage events:

```json
{ "type": "usage", "input_tokens": 2587, "output_tokens": 1204, "cache_read_tokens": 0, "cache_creation_tokens": 0 }
```

Cost computed from model pricing constants. Stored per-task and aggregated in dashboard telemetry.

**Codex and Gemini (estimated):** Neither CLI currently exposes structured token/cost output in a documented stable format. Until confirmed otherwise, the dashboard uses elapsed-time estimation:

```typescript
const estimatedCost = elapsedMinutes * burnRatePerMin;
```

Burn rates are configurable in `.harness/config/dashboard.json`:

```json
{
  "costEstimation": {
    "codexBurnRatePerMin": 0.05,
    "geminiBurnRatePerMin": 0.03
  }
}
```

These are displayed in the run panel with an `~` prefix to signal estimation (`~$0.12`) versus Claude's exact display (`$0.021`). When Codex or Gemini output format is confirmed to include structured usage data, `stream-parser.ts` gains a per-agent parsing branch and the estimation fallback is retained for unknown agents.

The empirical test to determine Codex/Gemini output format, to be run from inside a harnessed repo before Phase 2 begins:

```bash
# Codex
codex --help | grep -i "output\|format\|stream\|json"
echo "Say hello." | codex -p "Say hello." 2>&1 | cat

# Gemini
gemini --help | grep -i "output\|format\|stream\|json"
gemini --prompt "Say hello." 2>&1 | cat
```

If structured usage blocks are found, update `stream-parser.ts` accordingly and remove the estimation path for that agent.

---

## 12. HARNESS INTEGRATION POINTS

### 12.1 Dashboard as Harness Module

`harness setup` gains a new adaptive module: `dashboard`. Selected when:
- Node.js v20+ detected
- pnpm detected
- User confirms during setup

Module adds to the manifest:
- `dashboard/` directory (the Next.js app)
- `.harness/config/dashboard.json` (generated by wizard)
- `AGENTS.md` section: dashboard routing notes
- `harness dashboard` subcommand registration

### 12.2 `harness dashboard` Subcommands

```bash
harness dashboard install .    # Run wizard, write config
harness dashboard start        # Start Next.js + daemon via PM2
harness dashboard stop         # Stop both processes
harness dashboard status       # Show running state, active sessions, stats
harness dashboard upgrade .    # Pull latest dashboard version, re-run wizard diffs
```

### 12.3 `harness lint` Extension

Dashboard module adds one lint check to the existing five:

| Check | What it verifies |
|---|---|
| Dashboard Config | `.harness/config/dashboard.json` exists and is valid; all referenced skill paths resolve; no disabled-agent tier is referenced |

### 12.4 `harness validate` Extension

Validate gains a dashboard-tasks check when dashboard module is installed:
- No tasks in IN PROGRESS with no active PID (stuck tasks)
- No missions in running state with daemon stopped

---

## 13. IMPLEMENTATION PLAN

### Phase 0 — Foundation (Week 1)

**Goal:** Repo scaffold, harness integration points, skill discovery working, preflight system proven.

- [ ] Initialize `dashboard/` as Next.js 15 + TypeScript + Tailwind project inside harness repo
- [ ] Implement `DashboardConfig` Zod schema + `.harness/config/dashboard.json` read/write
- [ ] Implement skill discovery: walk `.claude/skills/`, parse frontmatter, respect skillOverrides
- [ ] Implement frequency/recency scoring from `activity.jsonl`
- [ ] Implement preflight preamble builder (base + project-scope extension + skill-scope extension)
- [ ] Implement session dispatch: `claude -p`, `codex -p`, `gemini --prompt` with `CLAUDE_PROJECT_DIR`
- [ ] Prove preflight: run a dispatch, confirm `knowledge_reads.json` is populated, confirm guard does not block
- [ ] `harness dashboard install` wizard — Steps 1–6 (CLI, not UI yet)
- [ ] `harness dashboard start/stop/status` subcommands via PM2

**Deliverable:** CLI-only, no UI. But skill buttons work from terminal test harness and hooks fire correctly.

### Phase 1 — Skills Page + Run Panel (Week 2)

**Goal:** Chase AI aesthetic, skill buttons working, run output visible.

- [ ] Global layout: header, token windows bar, activity chart, agent strip
- [ ] SKILLS page: domain cards, skill buttons, sort by frequency/recency
- [ ] Run output panel: streaming SSE, preflight section, structured output parsing
- [ ] Persistent sidebar: recent runs, forecast, harness pulse
- [ ] Token window data from `activity.jsonl`
- [ ] `fs.watch` on `.claude/skills/` for hot-reload of skill buttons
- [ ] Skill button states: idle, running (pulse), done (flash), failed (red)

**Deliverable:** Functional replacement for Chase AI dashboard. Skills fire, output streams, hooks fire.

### Phase 2 — Kanban + Multi-Model (Week 3)

**Goal:** Task management with full multi-agent visibility.

- [ ] Task store: Zod schema, CRUD API, mutex writes
- [ ] KANBAN page: three columns, dnd-kit drag-drop
- [ ] Task card: all fields, launch/stop/continue buttons
- [ ] Multi-agent status lane within task card
- [ ] Loop detection: 3 failures → escalation UI
- [ ] Session resilience: auto-continuation with progress injection
- [ ] Cost tracking per task: accumulate from stream-json events
- [ ] Multi-model sidebar panel: live session view per agent

**Deliverable:** Full task management. Multi-model plan→consensus→execute→loop→audit is visually trackable.

### Phase 3 — Brain Dump + Matrix (Week 4)

**Goal:** Capture → triage → task pipeline. Priority management.

- [ ] BRAIN DUMP page: input area, quick capture, voice input
- [ ] AI triage: background Claude session with triage prompt, JSON response parsing
- [ ] Triage result card: pre-filled editable fields, send to Kanban/Matrix
- [ ] MATRIX page: Eisenhower four quadrants, dnd-kit drag-drop
- [ ] Task filtering: by domain, agent, project
- [ ] Cmd+K global search (cmdk): tasks, skills, brain dump, wiki pages

**Deliverable:** Full idea-to-task pipeline. Nothing falls through the cracks.

### Phase 4 — Missions + OPS + Daemon (Week 5)

**Goal:** Autonomous operation, harness health visibility.

- [ ] Mission store: Zod schema, dependency chain resolution
- [ ] MISSIONS page: mission cards, progress bars, start/pause/stop
- [ ] Daemon: full implementation (poll, dispatch, concurrency, cron, loop detection, reconciliation)
- [ ] OPS page: harness lint live results, wiki state, skill audit, discipline config editor
- [ ] `harness lint` extension: dashboard config check
- [ ] `harness validate` extension: stuck task check
- [ ] Upcoming routines sidebar panel
- [ ] Emergency stop: kills all active sessions, pauses all missions

**Deliverable:** Full autonomous operation. OPS page replaces `harness setup . --serve`.

### Phase 5 — Setup Wizard UI + Polish (Week 6)

**Goal:** The wizard is in the dashboard UI, not just CLI. Final QA.

- [ ] In-app setup wizard: Steps 1–6 as guided UI flow, accessible from OPS page
- [ ] Skill domain drag-drop reorganization in wizard
- [ ] PM2 ecosystem config generation
- [ ] `harness dashboard upgrade` implementation
- [ ] Vitest test suite: Zod schemas, data layer, agent dispatch, preflight builder, activity parser
- [ ] Full `pnpm verify` passing: typecheck + lint + build + tests
- [ ] README and inline docs

**Deliverable:** Shippable. Installs with one command, travels with the repo, all hooks fire, all agents visible.

---

## 14. FILE STRUCTURE

```
dashboard/                          Next.js 15 app root
├── package.json
├── ecosystem.config.js             PM2 config (web server + daemon)
├── next.config.ts
├── tailwind.config.ts              Custom theme with harness CSS variables
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── app/                        Next.js App Router
│   │   ├── layout.tsx              Global layout: header + sidebar
│   │   ├── page.tsx                → redirect to /skills
│   │   ├── skills/page.tsx         SKILLS page
│   │   ├── kanban/page.tsx         KANBAN page
│   │   ├── matrix/page.tsx         MATRIX page
│   │   ├── brain-dump/page.tsx     BRAIN DUMP page
│   │   ├── missions/page.tsx       MISSIONS page
│   │   └── ops/page.tsx            OPS page
│   ├── components/
│   │   ├── layout/                 Header, Sidebar, TokenWindows, ActivityChart, AgentStrip
│   │   ├── skills/                 DomainCard, SkillButton, RunDrawer
│   │   ├── kanban/                 KanbanColumn, TaskCard, MultiAgentLane
│   │   ├── matrix/                 EisenhowerGrid, MatrixCard
│   │   ├── brain-dump/             BrainDumpInput, TriageCard, DumpList
│   │   ├── missions/               MissionCard, MissionProgress
│   │   ├── ops/                    LintResults, WikiState, SkillAudit
│   │   ├── run-panel/              RunOutput, PreflightBadges, SourceList
│   │   └── sidebar/                RecentRuns, MultiModelStatus, HarnessPulse
│   ├── lib/
│   │   ├── harness/
│   │   │   ├── skill-discovery.ts  Walk .claude/skills/, parse frontmatter
│   │   │   ├── activity-reader.ts  Parse .harness/state/activity.jsonl
│   │   │   ├── preflight.ts        Preamble builder
│   │   │   ├── agents-md-reader.ts Detect installed tier from AGENTS.md
│   │   │   ├── settings-reader.ts  Read .claude/settings.json skillOverrides
│   │   │   └── lint-runner.ts      Shell out to `harness lint .`
│   │   ├── dispatch/
│   │   │   ├── session.ts          Spawn claude/codex/gemini with preflight
│   │   │   ├── stream-parser.ts    Parse stream-json output, extract cost
│   │   │   └── run-store.ts        Track PIDs, status, cost in dashboard-runs.json
│   │   ├── data/
│   │   │   ├── tasks.ts            Task CRUD with Zod + mutex
│   │   │   ├── missions.ts         Mission CRUD with dependency resolution
│   │   │   ├── brain-dump.ts       Brain dump CRUD
│   │   │   └── usage-cache.ts      Frequency/recency cache from activity.jsonl
│   │   └── triage/
│   │       └── ai-triage.ts        Brain dump triage prompt + response parser
│   ├── api/
│   │   ├── skills/route.ts         GET discovered skills
│   │   ├── tasks/route.ts          CRUD + run/stop
│   │   ├── runs/route.ts           GET active runs
│   │   ├── runs/stream/route.ts    SSE stream for run output
│   │   ├── brain-dump/route.ts     CRUD + triage trigger
│   │   ├── missions/route.ts       CRUD + start/stop
│   │   ├── lint/route.ts           GET lint results (cached + manual trigger)
│   │   └── telemetry/route.ts      GET token windows, activity chart data
│   └── schemas/
│       ├── task.ts                 Zod task schema
│       ├── mission.ts              Zod mission schema
│       ├── brain-dump.ts           Zod brain dump schema
│       ├── run.ts                  Zod run schema
│       └── dashboard-config.ts     Zod dashboard.json schema
├── scripts/
│   └── daemon/
│       └── index.ts               Autonomous daemon (node-cron + dispatch)
└── __tests__/
    ├── schemas/                    Zod schema tests
    ├── data/                       CRUD + mutex tests
    ├── dispatch/                   Session spawn + stream parser tests
    ├── harness/                    Skill discovery + activity reader + preflight tests
    └── daemon/                     Daemon logic tests
```

---

## 15. OPEN QUESTIONS FOR IMPLEMENTATION

These are design decisions that need answers before or during Phase 0 but do not block the spec:

1. **harness CLI extension mechanism** — How does `harness dashboard` get added as a subcommand? Does it piggyback on the existing Python CLI entry point, or does the dashboard ship its own thin Python wrapper that the harness CLI delegates to?

2. ~~**Codex and Gemini output format**~~ — **RESOLVED (estimated).** Neither CLI exposes stable structured token output. Dashboard uses elapsed-time cost estimation for both, with configurable burn rates in `dashboard.json`. See §11.3. Empirical test commands documented there; update `stream-parser.ts` if structured output is confirmed.

3. ~~**skill-index.md vs skills.json**~~ — **RESOLVED.** `track_knowledge_reads.py` confirms `skills_index` maps exactly to `.claude/skills.json`. The `harness wiki build-skill-index` command generates `.claude/wiki/wiki/reference/skill-index.md` for human reference only — it is not the enforced surface. Preflight preamble in §5.1 is correct as written.

4. ~~**Activity.jsonl skill matching**~~ — **RESOLVED (shared file).** The dashboard's dispatch layer (`session.ts`) writes synthetic tagged entries directly to `.harness/state/activity.jsonl` at session start and completion:

   ```json
   {"ts":"2026-05-10T21:22:00Z","tool":"DashboardDispatch","ok":true,"desc":"skill:deep-research"}
   {"ts":"2026-05-10T21:27:34Z","tool":"DashboardComplete","ok":true,"desc":"skill:deep-research"}
   ```

   Shared file is correct. Splitting into a separate `dashboard-activity.jsonl` would give any tool that reads `activity.jsonl` (harness features, `wiki extract-learnings`, user scripts) an incomplete picture. The `tool` field (`DashboardDispatch` / `DashboardComplete`) provides a clean filter for any reader that wants only dashboard events or wants to exclude them. The append-only, silent-IOError pattern in `activity_logger.py` is already designed for concurrent writers. `activity-reader.ts` matches frequency/recency on `desc` values prefixed with `skill:`.

5. **PM2 availability** — PM2 is the obvious choice for process management but adds a global npm dependency. Alternative: the harness CLI manages the processes directly using Python's `subprocess` and writes PIDs to `.harness/state/dashboard-pids.json`. Simpler dependency story.

---

## 16. SUCCESS CRITERIA

The implementation is complete when:

- [ ] `harness dashboard install .` runs wizard, writes config, all skills discovered correctly
- [ ] `harness dashboard start` launches dashboard at port 8768
- [ ] Every skill button dispatch fires a session where `knowledge_preflight_guard` does **not** block
- [ ] Every skill button dispatch produces output with structured OUTPUT / SOURCES / FILE sections
- [ ] Multi-agent task (Claude plan + Codex review) shows per-agent live status in Kanban
- [ ] Brain dump entry → AI triage → Kanban task in under 60 seconds
- [ ] Continuous mission runs 5 tasks with dependency chain, dispatches correctly, loop detection fires on 3rd failure
- [ ] `harness lint .` passes with dashboard module installed (6/6 checks)
- [ ] `harness validate .` passes on clean repo with dashboard module
- [ ] `pnpm verify` passes (typecheck + lint + build + tests)
- [ ] Moving the repo to a new machine and running `harness dashboard start` produces identical UI with correct skill discovery
