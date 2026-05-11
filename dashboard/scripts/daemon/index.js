/**
 * Agentic-OS Dashboard Daemon — Full Implementation
 *
 * Responsibilities:
 *   1. Poll dashboard-tasks.json for TODO tasks with a skill assigned
 *   2. Dispatch via POST /api/skills/:skill/run, respecting concurrencyLimit
 *   3. Mark tasks IN_PROGRESS; write runId; watch run completion
 *   4. Advance mission currentSkillIndex on DONE; increment failCount on FAILED
 *   5. Loop detection: failCount >= maxContinuations → PAUSED + escalation log
 *   6. Write heartbeat entry to activity.jsonl every 5 minutes
 *   7. Expose GET /health on port 8769
 */

"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");

// ── Config ────────────────────────────────────────────────────────────────────

const WORKSPACE =
  process.env.CLAUDE_PROJECT_DIR ||
  process.env.AGENTOS_WORKSPACE ||
  process.cwd();

const DASHBOARD_PORT = parseInt(process.env.AGENTOS_PORT || "8768", 10);
const HEALTH_PORT = 8769;
const POLL_MS = 5_000;
const HEARTBEAT_MS = 5 * 60 * 1_000;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_MAX_CONTINUATIONS = 3;

const TASKS_FILE    = path.join(WORKSPACE, ".harness", "state", "dashboard-tasks.json");
const MISSIONS_FILE = path.join(WORKSPACE, ".harness", "state", "dashboard-missions.json");
const RUNS_FILE     = path.join(WORKSPACE, ".harness", "state", "dashboard-runs.json");
const CONFIG_FILE   = path.join(WORKSPACE, ".harness", "config", "dashboard.json");
const ACTIVITY_FILE = path.join(WORKSPACE, ".harness", "state", "activity.jsonl");
const PIDS_FILE     = path.join(WORKSPACE, ".harness", "state", "dashboard-pids.json");

// ── Helpers ───────────────────────────────────────────────────────────────────

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try { return JSON.parse(fs.readFileSync(filePath, "utf-8")); } catch { return fallback; }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function appendActivity(entry) {
  fs.mkdirSync(path.dirname(ACTIVITY_FILE), { recursive: true });
  try { fs.appendFileSync(ACTIVITY_FILE, JSON.stringify(entry) + "\n", "utf-8"); } catch { /* silent */ }
}

function getConfig() {
  const cfg = readJson(CONFIG_FILE, {});
  return {
    concurrencyLimit: cfg.concurrencyLimit ?? DEFAULT_CONCURRENCY,
    maxContinuations: cfg.maxContinuations ?? DEFAULT_MAX_CONTINUATIONS,
    codexBurnRatePerMin: cfg.costEstimation?.codexBurnRatePerMin ?? 0.05,
    geminiBurnRatePerMin: cfg.costEstimation?.geminiBurnRatePerMin ?? 0.03,
  };
}

// ── Active session tracking ───────────────────────────────────────────────────

/** Map<runId, { taskId, missionId, skillName, startedAt }> */
const activeSessions = new Map();

function savePids() {
  writeJson(PIDS_FILE, {
    daemonPid: process.pid,
    sessions: Array.from(activeSessions.entries()).map(([runId, s]) => ({ runId, ...s })),
    ts: new Date().toISOString(),
  });
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiFetch(method, apiPath, body) {
  const url = `http://127.0.0.1:${DASHBOARD_PORT}${apiPath}`;
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${method} ${apiPath} → ${res.status}`);
  return res.json();
}

// ── Task helpers ──────────────────────────────────────────────────────────────

function readTasks() {
  return readJson(TASKS_FILE, { tasks: [] }).tasks || [];
}

function patchTask(taskId, patch) {
  const store = readJson(TASKS_FILE, { tasks: [] });
  const idx = (store.tasks || []).findIndex((t) => t.id === taskId);
  if (idx >= 0) {
    store.tasks[idx] = { ...store.tasks[idx], ...patch, updatedAt: new Date().toISOString() };
    writeJson(TASKS_FILE, store);
  }
}

// ── Mission helpers ───────────────────────────────────────────────────────────

function readMissions() {
  return readJson(MISSIONS_FILE, { missions: [] }).missions || [];
}

function patchMission(missionId, patch) {
  const store = readJson(MISSIONS_FILE, { missions: [] });
  const idx = (store.missions || []).findIndex((m) => m.id === missionId);
  if (idx >= 0) {
    store.missions[idx] = { ...store.missions[idx], ...patch, updatedAt: new Date().toISOString() };
    writeJson(MISSIONS_FILE, store);
  }
}

// ── Run status check ─────────────────────────────────────────────────────────

function getRunStatus(runId) {
  const store = readJson(RUNS_FILE, { active: [], recent: [] });
  if ((store.active || []).some((r) => r.id === runId)) return "RUNNING";
  const r = (store.recent || []).find((r) => r.id === runId);
  return r ? r.status : null;
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

async function dispatchSkill(skillName, agent, taskId, missionId) {
  const agentName = (agent && agent !== "unassigned") ? agent : "claude";
  let data;
  try {
    data = await apiFetch("POST", `/api/skills/${encodeURIComponent(skillName)}/run`, { agent: agentName });
  } catch (err) {
    console.error(`[daemon] dispatch failed skill=${skillName}:`, err.message);
    return null;
  }
  const runId = data.runId;
  activeSessions.set(runId, { taskId, missionId, skillName, agent: agentName, startedAt: new Date().toISOString() });
  savePids();
  appendActivity({ ts: new Date().toISOString(), tool: "DaemonDispatch", ok: true, desc: `skill:${skillName}`, taskId, missionId, runId });
  console.log(`[daemon] dispatched skill=${skillName} run=${runId}`);
  return runId;
}

// ── Completion handler ────────────────────────────────────────────────────────

function handleCompletion(runId, status) {
  const session = activeSessions.get(runId);
  if (!session) return;
  activeSessions.delete(runId);
  savePids();

  const ok = status === "DONE";
  const { taskId, missionId, skillName } = session;

  appendActivity({ ts: new Date().toISOString(), tool: ok ? "DaemonComplete" : "DaemonError", ok, desc: `skill:${skillName}`, taskId, missionId, runId });
  console.log(`[daemon] run ${runId} finished status=${status}`);

  // ── Task state machine ───────────────────────────────────────────────────
  if (taskId) {
    patchTask(taskId, { status: ok ? "REVIEW" : "BLOCKED" });
  }

  // ── Mission advancement ──────────────────────────────────────────────────
  if (missionId) {
    const missions = readMissions();
    const mission = missions.find((m) => m.id === missionId);
    if (!mission) return;

    if (ok) {
      const nextIdx = mission.currentSkillIndex + 1;
      if (nextIdx >= (mission.skillSequence || []).length) {
        // Mission complete
        patchMission(missionId, {
          status: "DONE",
          currentSkillIndex: nextIdx,
          completedAt: new Date().toISOString(),
        });
        console.log(`[daemon] mission ${missionId} DONE`);
      } else {
        // Advance to next skill
        patchMission(missionId, { currentSkillIndex: nextIdx, continuationCount: mission.continuationCount + 1 });
        // Dispatch next skill in the same poll cycle
        const nextSkill = mission.skillSequence[nextIdx];
        setTimeout(() => dispatchSkill(nextSkill, mission.agent, null, missionId), 500);
      }
    } else {
      const newFailCount = (mission.failCount || 0) + 1;
      const maxCont = mission.maxContinuations || DEFAULT_MAX_CONTINUATIONS;
      if (newFailCount >= maxCont) {
        // Loop detected — escalate
        patchMission(missionId, { status: "PAUSED", failCount: newFailCount });
        console.warn(`[daemon] LOOP DETECTED mission=${missionId} failCount=${newFailCount} — paused for human review`);
        appendActivity({ ts: new Date().toISOString(), tool: "DaemonLoopDetected", ok: false, desc: `mission:${missionId}`, failCount: newFailCount });
      } else {
        patchMission(missionId, { failCount: newFailCount });
      }
    }
  }
}

// ── Main poll loop ────────────────────────────────────────────────────────────

async function poll() {
  try {
    const cfg = getConfig();

    // 1. Check completed sessions
    for (const [runId] of activeSessions) {
      const status = getRunStatus(runId);
      if (status === "RUNNING" || status === null) continue;
      handleCompletion(runId, status);
    }

    // 2. Dispatch queued tasks if under concurrency limit
    if (activeSessions.size >= cfg.concurrencyLimit) return;

    const tasks = readTasks();
    const queued = tasks.filter(
      (t) => t.status === "TODO" && t.skill && (t.continuationCount || 0) < cfg.maxContinuations
    );

    const slots = cfg.concurrencyLimit - activeSessions.size;
    for (const task of queued.slice(0, slots)) {
      patchTask(task.id, { status: "IN_PROGRESS", continuationCount: (task.continuationCount || 0) + 1 });
      const runId = await dispatchSkill(task.skill, task.agent, task.id, null);
      if (!runId) patchTask(task.id, { status: "TODO" }); // roll back if dispatch failed
    }

    // 3. Dispatch pending RUNNING missions whose current skill is not in-flight
    if (activeSessions.size < cfg.concurrencyLimit) {
      const missions = readMissions();
      const runningMissions = missions.filter((m) => m.status === "RUNNING");
      for (const mission of runningMissions) {
        if (activeSessions.size >= cfg.concurrencyLimit) break;
        const alreadyDispatched = Array.from(activeSessions.values()).some((s) => s.missionId === mission.id);
        if (alreadyDispatched) continue;
        const skill = (mission.skillSequence || [])[mission.currentSkillIndex];
        if (!skill) continue;
        await dispatchSkill(skill, mission.agent, null, mission.id);
      }
    }
  } catch (err) {
    console.error("[daemon] poll error:", err.message);
  }
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────

function heartbeat() {
  appendActivity({
    ts: new Date().toISOString(),
    tool: "DaemonHeartbeat",
    ok: true,
    desc: "daemon:heartbeat",
    activeSessions: activeSessions.size,
    daemonPid: process.pid,
  });
  console.log(`[daemon] heartbeat — active=${activeSessions.size}`);
}

// ── Health endpoint ───────────────────────────────────────────────────────────

const healthServer = http.createServer((req, res) => {
  if (req.url === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      activeSessions: activeSessions.size,
      daemonPid: process.pid,
      workspace: WORKSPACE,
      ts: new Date().toISOString(),
    }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

healthServer.listen(HEALTH_PORT, "127.0.0.1", () => {
  console.log(`[daemon] health endpoint → http://127.0.0.1:${HEALTH_PORT}/health`);
});

// ── Shutdown ──────────────────────────────────────────────────────────────────

function shutdown(sig) {
  console.log(`[daemon] shutdown (${sig})`);
  appendActivity({ ts: new Date().toISOString(), tool: "DaemonStop", ok: true, desc: "daemon:stop", signal: sig });
  healthServer.close();
  clearInterval(pollInterval);
  clearInterval(heartbeatInterval);
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

// ── Start ─────────────────────────────────────────────────────────────────────

console.log(`[daemon] started pid=${process.pid} workspace=${WORKSPACE}`);
appendActivity({ ts: new Date().toISOString(), tool: "DaemonStart", ok: true, desc: "daemon:start" });
savePids();

const pollInterval      = setInterval(() => poll().catch(console.error), POLL_MS);
const heartbeatInterval = setInterval(heartbeat, HEARTBEAT_MS);
poll().catch(console.error); // immediate first poll
