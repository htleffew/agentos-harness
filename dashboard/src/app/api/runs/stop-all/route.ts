/**
 * POST /api/runs/stop-all — Emergency stop.
 *
 * Kills all active run PIDs, marks runs as FAILED,
 * and sets all RUNNING missions to PAUSED.
 */

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { Mutex } from "async-mutex";

export const dynamic = "force-dynamic";

const mutex = new Mutex();

function readJson<T>(p: string, fallback: T): T {
  if (!fs.existsSync(p)) return fallback;
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return fallback; }
}

function writeJson(p: string, data: unknown): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function appendActivity(p: string, entry: object): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  try { fs.appendFileSync(p, JSON.stringify(entry) + "\n", "utf-8"); } catch { /* silent */ }
}

export async function POST(): Promise<NextResponse> {
  const workspace =
    process.env.CLAUDE_PROJECT_DIR || process.env.AGENTOS_WORKSPACE || process.cwd();

  const runsPath     = path.join(workspace, ".harness", "state", "dashboard-runs.json");
  const missionsPath = path.join(workspace, ".harness", "state", "dashboard-missions.json");
  const activityPath = path.join(workspace, ".harness", "state", "activity.jsonl");
  const pidsPath     = path.join(workspace, ".harness", "state", "dashboard-pids.json");
  const now          = new Date().toISOString();

  const killed: string[] = [];
  const paused: string[] = [];

  await mutex.runExclusive(() => {
    // ── Kill active run PIDs ───────────────────────────────────────────────
    const store = readJson<{ active: { id: string; pid?: number | null; skillName: string }[]; recent: unknown[] }>(
      runsPath, { active: [], recent: [] }
    );

    for (const run of store.active) {
      if (run.pid) {
        try { process.kill(run.pid, "SIGTERM"); } catch { /* already dead */ }
      }
    }

    const nowCompleted = store.active.map((r) => ({
      ...r,
      status: "FAILED",
      exitCode: -1,
      completedAt: now,
      durationMs: null,
    }));

    killed.push(...store.active.map((r) => r.id));

    writeJson(runsPath, {
      active: [],
      recent: [...nowCompleted, ...(store.recent as unknown[])].slice(0, 50),
    });

    // ── Also kill daemon-tracked sessions ─────────────────────────────────
    const pids = readJson<{ sessions?: { runId: string }[] }>(pidsPath, { sessions: [] });
    for (const s of (pids.sessions ?? [])) {
      killed.push(s.runId); // already killed above by PID
    }
    writeJson(pidsPath, { sessions: [], ts: now });

    // ── Pause RUNNING missions ─────────────────────────────────────────────
    const missionStore = readJson<{ missions: { id: string; status: string }[] }>(missionsPath, { missions: [] });
    missionStore.missions = missionStore.missions.map((m) =>
      m.status === "RUNNING" ? { ...m, status: "PAUSED", updatedAt: now } : m
    );
    paused.push(...missionStore.missions.filter((m) => m.status === "PAUSED").map((m) => m.id));
    writeJson(missionsPath, missionStore);
  });

  appendActivity(activityPath, {
    ts: now,
    tool: "EmergencyStop",
    ok: true,
    desc: `emergency-stop killed=${killed.length} paused=${paused.length}`,
    killedRuns: killed,
    pausedMissions: paused,
  });

  return NextResponse.json({
    killed: killed.length,
    paused: paused.length,
    runIds: killed,
    missionIds: paused,
    ts: now,
  });
}
