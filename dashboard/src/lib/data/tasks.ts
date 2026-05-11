/**
 * tasks.ts — Task CRUD with Zod validation and async-mutex write safety.
 *
 * Persists to .harness/state/dashboard-tasks.json.
 * All writes go through writeMutex to prevent corruption from concurrent
 * API calls (e.g. a drag-drop + a status update arriving simultaneously).
 */

import fs from "fs";
import path from "path";
import { Mutex } from "async-mutex";
import { randomUUID } from "crypto";
import { TaskSchema, type Task, type TaskStatus, type Agent } from "@/schemas/task";

const TASKS_FILE = path.join(".harness", "state", "dashboard-tasks.json");
const writeMutex = new Mutex();

// ── File I/O ──────────────────────────────────────────────────────────────────

interface TaskStore {
  tasks: Task[];
  version: number;
}

function tasksPath(workspace: string): string {
  return path.join(workspace, TASKS_FILE);
}

function readStore(workspace: string): TaskStore {
  const p = tasksPath(workspace);
  if (!fs.existsSync(p)) return { tasks: [], version: 1 };
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    const tasks: Task[] = [];
    for (const item of raw.tasks ?? []) {
      try { tasks.push(TaskSchema.parse(item)); } catch { /* skip corrupt entries */ }
    }
    return { tasks, version: raw.version ?? 1 };
  } catch {
    return { tasks: [], version: 1 };
  }
}

function writeStore(workspace: string, store: TaskStore): void {
  const p = tasksPath(workspace);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ ...store, version: store.version + 1 }, null, 2) + "\n", "utf-8");
}

// ── Public CRUD API ───────────────────────────────────────────────────────────

export interface CreateTaskInput {
  title: string;
  description?: string;
  status?: TaskStatus;
  agent?: Agent;
  project?: string | null;
  skill?: string | null;
  priority?: number;
  tags?: string[];
}

export async function createTask(workspace: string, input: CreateTaskInput): Promise<Task> {
  const now = new Date().toISOString();
  const task = TaskSchema.parse({
    id: randomUUID(),
    title: input.title,
    description: input.description ?? "",
    status: input.status ?? "BACKLOG",
    agent: input.agent ?? "unassigned",
    project: input.project ?? null,
    skill: input.skill ?? null,
    priority: input.priority ?? 3,
    tags: input.tags ?? [],
    activePid: null,
    continuationCount: 0,
    costAccumulated: 0,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  });

  await writeMutex.runExclusive(() => {
    const store = readStore(workspace);
    store.tasks.push(task);
    writeStore(workspace, store);
  });

  return task;
}

export async function updateTask(
  workspace: string,
  taskId: string,
  patch: Partial<Omit<Task, "id" | "createdAt">>
): Promise<Task | null> {
  let updated: Task | null = null;
  await writeMutex.runExclusive(() => {
    const store = readStore(workspace);
    const idx = store.tasks.findIndex((t) => t.id === taskId);
    if (idx < 0) return;

    const now = new Date().toISOString();
    const merged = {
      ...store.tasks[idx],
      ...patch,
      updatedAt: now,
      completedAt:
        patch.status === "DONE" && !store.tasks[idx].completedAt
          ? now
          : patch.completedAt ?? store.tasks[idx].completedAt,
    };
    store.tasks[idx] = TaskSchema.parse(merged);
    updated = store.tasks[idx];
    writeStore(workspace, store);
  });
  return updated;
}

export async function deleteTask(workspace: string, taskId: string): Promise<boolean> {
  let deleted = false;
  await writeMutex.runExclusive(() => {
    const store = readStore(workspace);
    const before = store.tasks.length;
    store.tasks = store.tasks.filter((t) => t.id !== taskId);
    deleted = store.tasks.length < before;
    if (deleted) writeStore(workspace, store);
  });
  return deleted;
}

export function listTasks(workspace: string, filter?: { status?: TaskStatus; agent?: Agent }): Task[] {
  const { tasks } = readStore(workspace);
  if (!filter) return tasks;
  return tasks.filter((t) => {
    if (filter.status && t.status !== filter.status) return false;
    if (filter.agent && t.agent !== filter.agent) return false;
    return true;
  });
}

export function getTaskById(workspace: string, taskId: string): Task | null {
  const { tasks } = readStore(workspace);
  return tasks.find((t) => t.id === taskId) ?? null;
}

/** Detect stuck tasks: IN_PROGRESS with no activePid */
export function getStuckTasks(workspace: string): Task[] {
  const { tasks } = readStore(workspace);
  return tasks.filter((t) => t.status === "IN_PROGRESS" && !t.activePid);
}

/** Detect loop: task has failureContinuationCount >= maxContinuations */
export function isLooping(task: Task, maxContinuations = 3): boolean {
  return task.continuationCount >= maxContinuations;
}
