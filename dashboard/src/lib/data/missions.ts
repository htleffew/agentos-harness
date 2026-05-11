/**
 * missions.ts — Mission CRUD and dispatch loop tracking.
 *
 * A Mission groups tasks into an autonomous dispatch loop:
 *   DRAFT → RUNNING → PAUSED | DONE | FAILED
 *
 * Persisted to .harness/state/dashboard-missions.json.
 * Loop detection: failCount >= maxContinuations escalates status.
 */

import fs from "fs";
import path from "path";
import { Mutex } from "async-mutex";
import { randomUUID } from "crypto";
import { MissionSchema, type Mission, type MissionStatus } from "@/schemas/mission";

const MISSIONS_FILE = path.join(".harness", "state", "dashboard-missions.json");
const writeMutex = new Mutex();

// ── File I/O ──────────────────────────────────────────────────────────────────

interface MissionsStore {
  missions: Mission[];
  version: number;
}

function missionsPath(workspace: string): string {
  return path.join(workspace, MISSIONS_FILE);
}

function readStore(workspace: string): MissionsStore {
  const p = missionsPath(workspace);
  if (!fs.existsSync(p)) return { missions: [], version: 1 };
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    const missions: Mission[] = [];
    for (const item of raw.missions ?? []) {
      try { missions.push(MissionSchema.parse(item)); } catch { /* skip */ }
    }
    return { missions, version: raw.version ?? 1 };
  } catch {
    return { missions: [], version: 1 };
  }
}

function writeStore(workspace: string, store: MissionsStore): void {
  const p = missionsPath(workspace);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(
    p,
    JSON.stringify({ ...store, version: store.version + 1 }, null, 2) + "\n",
    "utf-8"
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface CreateMissionInput {
  title: string;
  description?: string;
  objective: string;
  agent: "claude" | "codex" | "gemini";
  skillSequence: string[];
  maxContinuations?: number;
  taskIds?: string[];
}

export async function createMission(
  workspace: string,
  input: CreateMissionInput
): Promise<Mission> {
  const now = new Date().toISOString();
  const mission = MissionSchema.parse({
    id: randomUUID(),
    title: input.title,
    description: input.description ?? "",
    objective: input.objective,
    agent: input.agent,
    status: "DRAFT",
    skillSequence: input.skillSequence,
    currentSkillIndex: 0,
    maxContinuations: input.maxContinuations ?? 3,
    continuationCount: 0,
    failCount: 0,
    taskIds: input.taskIds ?? [],
    runIds: [],
    costAccumulated: 0,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
  });

  await writeMutex.runExclusive(() => {
    const store = readStore(workspace);
    store.missions.push(mission);
    writeStore(workspace, store);
  });

  return mission;
}

export async function updateMission(
  workspace: string,
  missionId: string,
  patch: Partial<Omit<Mission, "id" | "createdAt">>
): Promise<Mission | null> {
  let updated: Mission | null = null;
  await writeMutex.runExclusive(() => {
    const store = readStore(workspace);
    const idx = store.missions.findIndex((m) => m.id === missionId);
    if (idx < 0) return;
    const now = new Date().toISOString();
    store.missions[idx] = MissionSchema.parse({
      ...store.missions[idx],
      ...patch,
      updatedAt: now,
      completedAt:
        (patch.status === "DONE" || patch.status === "FAILED") &&
        !store.missions[idx].completedAt
          ? now
          : patch.completedAt ?? store.missions[idx].completedAt,
      startedAt:
        patch.status === "RUNNING" && !store.missions[idx].startedAt
          ? now
          : patch.startedAt ?? store.missions[idx].startedAt,
    });
    updated = store.missions[idx];
    writeStore(workspace, store);
  });
  return updated;
}

export async function deleteMission(workspace: string, missionId: string): Promise<boolean> {
  let deleted = false;
  await writeMutex.runExclusive(() => {
    const store = readStore(workspace);
    const before = store.missions.length;
    store.missions = store.missions.filter((m) => m.id !== missionId);
    deleted = store.missions.length < before;
    if (deleted) writeStore(workspace, store);
  });
  return deleted;
}

export function listMissions(workspace: string, filter?: { status?: MissionStatus }): Mission[] {
  const { missions } = readStore(workspace);
  if (!filter?.status) return missions;
  return missions.filter((m) => m.status === filter.status);
}

export function getMissionById(workspace: string, missionId: string): Mission | null {
  return readStore(workspace).missions.find((m) => m.id === missionId) ?? null;
}
