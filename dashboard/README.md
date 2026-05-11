# AgentOS Dashboard

> **v1.0.0** — The autonomous mission-control interface for the `agentos-harness` v2 platform.

A production-ready Next.js 15 dashboard that turns your local Claude/Codex/Gemini CLI tools into a fully observable, task-orchestrating autonomous system.

---

## Quick Start

```bash
# From your workspace root (the repo that contains AGENTS.md)
harness dashboard install .
harness dashboard start
# Open http://localhost:8768
```

---

## Prerequisites

| Tool | Minimum version | Purpose |
|------|----------------|---------|
| Node.js | 20 LTS | Runtime |
| pnpm | 9+ | Package manager |
| agentos-harness | 1.0.0 | Python CLI + state management |
| claude CLI | 1.x | Agent dispatch |
| PM2 | ≥5 (optional) | Production process management |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_PROJECT_DIR` | `process.cwd()` | Workspace root (where AGENTS.md lives) |
| `AGENTOS_WORKSPACE` | `process.cwd()` | Alias for `CLAUDE_PROJECT_DIR` |
| `AGENTOS_PORT` | `8768` | Dashboard HTTP port |
| `NODE_ENV` | `development` | `production` enables build output |

---

## CLI Commands

```bash
harness dashboard install .          # Install deps + build
harness dashboard start              # Start dev server + daemon
harness dashboard start --prod       # Start via PM2 (production)
harness dashboard stop               # Stop all processes
harness dashboard status             # Check running PIDs + URL
harness dashboard upgrade            # Stop → reinstall → restart
```

---

## Architecture

```
agentos-harness/dashboard/
├── src/
│   ├── app/                         # Next.js App Router pages + API
│   │   ├── api/
│   │   │   ├── brain-dump/triage/   # POST — AI triage via Claude CLI
│   │   │   ├── lint/                # GET  — runs `harness lint <workspace>`
│   │   │   ├── missions/            # GET/POST/PATCH/DELETE
│   │   │   ├── missions/[id]/
│   │   │   ├── runs/                # GET  — active + recent runs
│   │   │   ├── runs/stream/         # GET  — SSE stream for live output
│   │   │   ├── runs/stop-all/       # POST — emergency stop all sessions
│   │   │   ├── skills/              # GET  — skill discovery
│   │   │   ├── skills/[skill]/run/  # POST — dispatch a skill session
│   │   │   ├── tasks/               # GET/POST
│   │   │   ├── tasks/[id]/          # PATCH/DELETE
│   │   │   ├── telemetry/           # GET  — token stats + sparkline
│   │   │   └── wizard/run/          # POST — 7-step setup check
│   │   ├── brain-dump/              # Brain Dump page
│   │   ├── kanban/                  # Kanban board
│   │   ├── matrix/                  # Eisenhower Matrix
│   │   ├── missions/                # Mission control
│   │   ├── ops/                     # OPS + lint + telemetry + wizard
│   │   └── skills/                  # Skills launcher
│   ├── components/
│   │   ├── kanban/
│   │   │   ├── KanbanColumn.tsx
│   │   │   ├── TaskCard.tsx
│   │   │   ├── CreateTaskModal.tsx
│   │   │   └── MultiAgentLane.tsx   # Per-agent swim lanes
│   │   ├── layout/
│   │   │   ├── Header.tsx           # Brand + emergency stop
│   │   │   ├── Sidebar.tsx          # Navigation + HarnessPulse
│   │   │   └── CommandPalette.tsx   # Cmd+K global search
│   │   ├── ops/
│   │   │   └── SetupWizard.tsx      # 7-step validation modal
│   │   └── skills/
│   │       └── RunDrawer.tsx        # Live SSE output drawer
│   ├── lib/
│   │   ├── dispatch/
│   │   │   ├── run-store.ts         # async-mutex run CRUD
│   │   │   └── stream-parser.ts     # Claude stream-json parser + cost
│   │   ├── harness/
│   │   │   └── preflight.ts         # Preamble builder (knowledge guard)
│   │   └── parse/
│   │       └── brain-dump-parser.ts # Heuristic task extractor
│   └── schemas/
│       ├── mission.ts               # Zod mission schema
│       ├── run.ts                   # Zod run schema
│       └── task.ts                  # Zod task schema
├── scripts/daemon/
│   └── index.js                     # Autonomous background daemon
├── __tests__/                       # Vitest test suite (21 tests)
├── ecosystem.config.js              # PM2 config
└── package.json
```

---

## State Files

All persistent state lives under `.harness/state/` in the workspace root and is excluded from standard linters.

| File | Purpose |
|------|---------|
| `dashboard-tasks.json` | Task store (Kanban + Matrix) |
| `dashboard-missions.json` | Mission definitions + lifecycle state |
| `dashboard-runs.json` | Active + recent agent run records |
| `dashboard-pids.json` | Daemon session tracking |
| `activity.jsonl` | Append-only audit log (every dispatch, heartbeat, stop) |
| `run-streams/<runId>.jsonl` | Per-run SSE event stream file |

---

## Pages

| Page | Route | Description |
|------|-------|-------------|
| Skills | `/skills` | Discover + launch skill sessions with live SSE output |
| Kanban | `/kanban` | dnd-kit drag-and-drop board with 6 status columns + per-agent swim lanes |
| Matrix | `/matrix` | Eisenhower 4-quadrant priority matrix |
| Brain Dump | `/brain-dump` | Paste notes → AI triage (Claude) or heuristic parse → import to Backlog |
| Missions | `/missions` | Autonomous skill-sequence missions with loop detection |
| OPS | `/ops` | Live harness lint + token telemetry + Setup Wizard |

---

## Key Features

### Cmd+K Command Palette
Press `Ctrl+K` / `Cmd+K` anywhere to open the global search palette. Searches skills (live), tasks, missions, and pages.

### AI Brain Dump Triage
Click **🤖 AI Triage** in Brain Dump to dispatch Claude with a structured triage prompt. Claude returns a JSON array of tasks with title, description, priority (P1–P4), agent assignment, tags, and Eisenhower quadrant. Falls back to heuristic parser if Claude is unavailable.

### Emergency Stop
When sessions are active, a red **⏹ Stop All** button appears in the Header. Clicking it (with confirmation) sends `SIGTERM` to all active PIDs, marks runs `FAILED`, and pauses all `RUNNING` missions.

### Token Cost Tracking
Claude Sonnet 4 input ($3/M tokens) and output ($15/M tokens) costs are computed in real time from `stream-json` `message_delta` events and persisted to `dashboard-runs.json`. Telemetry page shows total cost and hourly burn rate.

### Loop Detection
Tasks track `continuationCount`. If a task exceeds `maxContinuations` (default: 3), it is flagged with a `⚠ LOOP` badge. Missions track `failCount`; at threshold, they pause with a `DaemonLoopDetected` activity entry.

### Autonomous Daemon
`scripts/daemon/index.js` runs as a background Node.js process. It polls `dashboard-tasks.json` every 5 seconds, dispatches `TODO` tasks (respecting `concurrencyLimit`), advances mission skill sequences on completion, and writes heartbeats to `activity.jsonl` every 5 minutes. Exposes a health endpoint at `http://127.0.0.1:8769/health`.

---

## Development

```bash
pnpm install
pnpm dev          # http://localhost:8768
pnpm typecheck    # tsc --noEmit (0 errors required)
pnpm test         # vitest run (21 tests)
pnpm build        # next build (all routes)
pnpm verify       # typecheck + lint + build + test
```

---

## Testing

```bash
pnpm test                    # Run all 21 tests
pnpm test:watch              # Watch mode
pnpm test:coverage           # Coverage report
```

Test files:
- `__tests__/schemas/schemas.test.ts` — Zod schema validation
- `__tests__/parse/brain-dump-parser.test.ts` — Heuristic parser

---

## Production Deployment

### PM2
```bash
harness dashboard start --prod
# or directly:
cd dashboard && pm2 start ecosystem.config.js --env production
pm2 logs agentos-dashboard-web
pm2 logs agentos-dashboard-daemon
```

### Manual
```bash
cd dashboard
pnpm build
CLAUDE_PROJECT_DIR=/path/to/repo pnpm start &
CLAUDE_PROJECT_DIR=/path/to/repo node scripts/daemon/index.js &
```

---

## Harness CLI Integration

The dashboard ships as a standard `harness dashboard` subcommand:

```
harness dashboard install    Run install wizard, write dashboard.json
harness dashboard start      Start Next.js server + daemon
harness dashboard stop       Stop all dashboard processes
harness dashboard status     Check PIDs and URL
harness dashboard upgrade    Re-run wizard and restart
```

Configuration is stored in `.harness/config/dashboard.json`:

```json
{
  "port": 8768,
  "theme": "dark",
  "concurrencyLimit": 2,
  "maxContinuations": 3,
  "domainOrder": ["daily", "ops", "research", "productivity", "content", "community"]
}
```
