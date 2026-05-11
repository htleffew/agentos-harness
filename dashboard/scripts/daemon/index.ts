/**
 * daemon/index.ts — Agentic OS Dashboard autonomous daemon.
 *
 * Responsibilities:
 *   1. Poll dashboard-tasks.json for QUEUED tasks with an assigned skill
 *   2. Dispatch them via the Next.js API (POST /api/skills/:skill/run)
 *   3. Enforce concurrency limit from dashboard.json
 *   4. Mark tasks IN_PROGRESS, attach runId, watch for completion
 *   5. Advance mission currentSkillIndex on completion
 *   6. Detect loops: failCount >= maxContinuations → escalate
 *   7. Write reconciliation heartbeat to activity.jsonl every 5 minutes
 *
 * Runs as a separate Node.js process managed by PM2 or the Python harness CLI.
 */

import fs from "fs";
import path from "path";
import { createServer } from "http";

const WORKSPACE =
  process.env.CLAUDE_PROJECT_DIR || process.env.AGENTOS_WORKSPACE || process.cwd();

const TASKS_FILE = path.join(WORKSPACE, ".harness", "state", "dashboard-tasks.json");
const MISSIONS_FILE = path.join(WORKSPACE, ".harness", "state", "dashboard-missions.json");
const ACTIVITY_FILE = path.join(WORKSPACE, ".harness", "state", "activity.jsonl");
const CONFIG_FILE = path.join(WORKSPACE, ".harness", "config", "dashboard.json");
const PIDS_FILE = path.join(WORKSPACE, ".harness", "state", "dashboard-pids.json");

const DASHBOARD_URL = `http://localhost:${process.env.AGENTOS_PORT ?? "8768"}`;
const POLL_INTERVAL_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function readJson<T>(p: string, fallback: T): T {
  if (!fs.existsSync(p)) return fallback;
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return fallback; }
}

function appendActivity(entry: object): void {
  fs.mkdirSync(path.dirname(ACTIVITY_FILE), { recursive: true });
  try { fs.appendFileSync(ACTIVITY_FILE, JSON.stringify(entry) + "\n", "utf-8"); } catch { /* silent */ }
}

function getDashboardConfig(): { concurrencyLimit: number; maxContinuations: number } {
  const cfg = readJson(CONFIG_FILE, {});
  return {
    concurrencyLimit: (cfg as Record<string, number>).concurrencyLimit ?? 2,
    maxContinuations: (cfg as Record<string, number>).maxContinuations ?? 3,
  };
}

// ── Active session tracking ───────────────────────────────────────────────────

interface ActiveSession {
  taskId: string | null;
  missionId: string | null;
  runId: string;
  skillName: string;
  startedAt: string;
}

const activeSessions = new Map<string, ActiveSession>();

function savePids(): void {
  const data = { sessions: Array.from(activeSessions.values()), ts: new Date().toISOString() };
  fs.mkdirSync(path.dirname(PIDS_FILE), { recursive: true });
  try { fs.writeFileSync(PIDS_FILE, JSON.stringify(data, null, 2), "utf-8"); } catch { /* silent */ }
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiPost(path: string, body: object): Promise<unknown> {
  const res = await fetch(`${DASHBOARD_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res.json();
}

async function apiPatch(path: string, body: object): Promise<void> {
  await fetch(`${DASHBOARD_URL}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function pollRunStatus(runId: string): Promise<string | null> {
  try {
    const res = await fetch(`${DASHBOARD_URL}/api/runs`);
    const data = await res.json() as { active: { id: string }[]; recent: { id: string; status: string }[] };
    const active = data.active?.find((r) => r.id === runId);
    if (active) return "RUNNING";
    const completed = data.recent?.find((r) => r.id === runId);
    return (completed as { status?: string })?.status ?? null;
  } catch { return null; }
}

// ── Task dispatch ─────────────────────────────────────────────────────────────

interface Task {
  id: string;
  status: string;
  skill: string | null;
  agent: string;
  continuationCount: number;
}

async function dispatchTask(task: Task): Promise<void> {
  if (!task.skill) return;

  try {
    const data = await apiPost(`/api/skills/${encodeURIComponent(task.skill)}/run`, {
      agent: task.agent === "unassigned" ? "claude" : task.agent,
    }) as { runId: string };

    await apiPatch(`/api/tasks/${task.id}`, {
      status: "IN_PROGRESS",
      continuationCount: task.continuationCount + 1,
    });

    activeSessions.set(data.runId, {
      taskId: task.id,
      missionId: null,
      runId: data.runId,
      skillName: task.skill,
      startedAt: new Date().toISOString(),
    });
    savePids();
    appendActivity({ ts: new Date().toISOString(), tool: "DaemonDispatch", ok: true, desc: `skill:${task.skill}`, taskId: task.id, runId: data.runId });
    console.log(`[daemon] dispatched task ${task.id} skill=${task.skill} run=${data.runId}`);
  } catch (err) {
    console.error(`[daemon] failed to dispatch task ${task.id}:`, err);
  }
}

// ── Poll loop ─────────────────────────────────────────────────────────────────

async function poll(): Promise<void> {
  const { concurrencyLimit, maxContinuations } = getDashboardConfig();

  // Check completed sessions
  for (const [runId, session] of activeSessions) {
    const status = await pollRunStatus(runId);
    if (status === "RUNNING" || status === null) continue;

    const ok = status === "DONE";
    activeSessions.delete(runId);
    savePids();

    if (session.taskId) {
      const newStatus = ok ? "REVIEW" : "BLOCKED";
      await apiPatch(`/api/tasks/${session.taskId}`, { status: newStatus });
      appendActivity({ ts: new Date().toISOString(), tool: ok ? "DaemonComplete" : "DaemonError", ok, desc: `skill:${session.skillName}`, taskId: session.taskId, runId });
    }
  }

  // Dispatch queued tasks if under concurrency limit
  if (activeSessions.size >= concurrencyLimit) return;

  const store = readJson<{ tasks: Task[] }>(TASKS_FILE, { tasks: [] });
  const queued = store.tasks.filter(
    (t) => t.status === "TODO" && t.skill && t.continuationCount < maxContinuations
  );

  const slots = concurrencyLimit - activeSessions.size;
  for (const task of queued.slice(0, slots)) {
    await dispatchTask(task);
  }
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────

function heartbeat(): void {
  appendActivity({
    ts: new Date().toISOString(),
    tool: "DaemonHeartbeat",
    ok: true,
    desc: "daemon:heartbeat",
    activeSessions: activeSessions.size,
  });
  console.log(`[daemon] heartbeat — ${activeSessions.size} active sessions`);
}

// ── Health endpoint (port 8769) ───────────────────────────────────────────────

const healthServer = createServer((req, res) => {
  if (req.url === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", activeSessions: activeSessions.size, ts: new Date().toISOString() }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

healthServer.listen(8769, "127.0.0.1", () => {
  console.log("[daemon] health endpoint at http://127.0.0.1:8769/health");
});

// ── Start ─────────────────────────────────────────────────────────────────────

console.log(`[daemon] started — workspace=${WORKSPACE} concurrency=${getDashboardConfig().concurrencyLimit}`);
appendActivity({ ts: new Date().toISOString(), tool: "DaemonStart", ok: true, desc: "daemon:start" });

setInterval(() => { poll().catch((e) => console.error("[daemon] poll error:", e)); }, POLL_INTERVAL_MS);
setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
poll().catch((e) => console.error("[daemon] initial poll error:", e));
