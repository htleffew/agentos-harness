/**
 * run-store.ts — Track active and recent agent runs in dashboard-runs.json.
 *
 * Uses async-mutex to prevent concurrent write corruption from multiple
 * SSE streams updating the same file.
 */

import fs from "fs";
import path from "path";
import { Mutex } from "async-mutex";
import { RunSchema, type Run } from "@/schemas/run";


const RUNS_FILE = path.join(".harness", "state", "dashboard-runs.json");
const MAX_RECENT = 50; // keep last 50 completed runs

const writeMutex = new Mutex();

// ── File I/O ──────────────────────────────────────────────────────────────────

function runsPath(workspace: string): string {
  return path.join(workspace, RUNS_FILE);
}

interface RunsStore {
  active: Run[];
  recent: Run[];
}

function readStore(workspace: string): RunsStore {
  const p = runsPath(workspace);
  if (!fs.existsSync(p)) return { active: [], recent: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    return {
      active: (raw.active ?? []).map((r: unknown) => {
        try { return RunSchema.parse(r); } catch { return null; }
      }).filter(Boolean) as Run[],
      recent: (raw.recent ?? []).map((r: unknown) => {
        try { return RunSchema.parse(r); } catch { return null; }
      }).filter(Boolean) as Run[],
    };
  } catch {
    return { active: [], recent: [] };
  }
}

function writeStore(workspace: string, store: RunsStore): void {
  const p = runsPath(workspace);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(store, null, 2) + "\n", "utf-8");
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Create a new run record and persist it as PENDING. */
export async function createRun(
  workspace: string,
  run: Omit<Run, "status" | "completedAt" | "durationMs" | "exitCode">
): Promise<Run> {
  const fullRun: Run = RunSchema.parse({
    ...run,
    status: "PENDING",
    completedAt: null,
    durationMs: null,
    exitCode: null,
  });

  await writeMutex.runExclusive(() => {
    const store = readStore(workspace);
    store.active.push(fullRun);
    writeStore(workspace, store);
  });

  return fullRun;
}

/** Update a run's status, cost, tokens. */
export async function updateRun(
  workspace: string,
  runId: string,
  patch: Partial<Pick<Run, "status" | "pid" | "costEstimate" | "tokenInputs" | "tokenOutputs" | "exitCode" | "completedAt" | "durationMs">>
): Promise<void> {
  await writeMutex.runExclusive(() => {
    const store = readStore(workspace);
    const idx = store.active.findIndex((r) => r.id === runId);
    if (idx >= 0) {
      store.active[idx] = { ...store.active[idx], ...patch };

      // Move to recent if terminal status
      const updated = store.active[idx];
      if (["DONE", "FAILED", "TIMEOUT"].includes(updated.status)) {
        store.recent.unshift(updated);
        store.recent = store.recent.slice(0, MAX_RECENT);
        store.active.splice(idx, 1);
      }
    }
    writeStore(workspace, store);
  });
}

/** Get all active runs. */
export function getActiveRuns(workspace: string): Run[] {
  return readStore(workspace).active;
}

/** Get recent completed runs. */
export function getRecentRuns(workspace: string, limit = 20): Run[] {
  return readStore(workspace).recent.slice(0, limit);
}

/** Get a single run by ID (checks active then recent). */
export function getRunById(workspace: string, runId: string): Run | null {
  const store = readStore(workspace);
  return (
    store.active.find((r) => r.id === runId) ??
    store.recent.find((r) => r.id === runId) ??
    null
  );
}
