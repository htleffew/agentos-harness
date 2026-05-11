/**
 * activity-reader.ts — Parse .harness/state/activity.jsonl
 *
 * Computes recency/frequency scores for skill sort order.
 * All reads are synchronous — called server-side only.
 */

import fs from "fs";
import path from "path";

export interface ActivityEntry {
  ts: string;
  tool: string;
  ok: boolean;
  desc: string;
  agent?: string;
  pid?: number;
}

export interface SkillStats {
  lastRunAt: Date | null;
  runCount30d: number;
}

export function readActivity(workspace: string): ActivityEntry[] {
  const filePath = path.join(workspace, ".harness", "state", "activity.jsonl");
  if (!fs.existsSync(filePath)) return [];

  const entries: ActivityEntry[] = [];
  const lines = fs.readFileSync(filePath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed);
      if (typeof entry === "object" && entry !== null) {
        entries.push(entry as ActivityEntry);
      }
    } catch {
      // Skip malformed lines silently
    }
  }
  return entries;
}

/**
 * Build a map of skill name → stats from activity.jsonl.
 * Matches entries where desc starts with "skill:" (DashboardDispatch format).
 */
export function buildSkillStats(
  workspace: string,
  recencyWeight = 0.6,
  frequencyWeight = 0.4
): Map<string, { score: number } & SkillStats> {
  const entries = readActivity(workspace);
  const now = Date.now();
  const cutoff30d = now - 30 * 24 * 60 * 60 * 1000;

  const stats = new Map<string, { lastRunMs: number | null; count30d: number }>();

  for (const entry of entries) {
    if (!entry.ok) continue;
    if (!entry.desc?.startsWith("skill:")) continue;
    const skillKey = entry.desc.slice("skill:".length);
    const ts = new Date(entry.ts).getTime();
    if (!isFinite(ts)) continue;

    const existing = stats.get(skillKey) ?? { lastRunMs: null, count30d: 0 };
    if (existing.lastRunMs === null || ts > existing.lastRunMs) {
      existing.lastRunMs = ts;
    }
    if (ts >= cutoff30d) {
      existing.count30d += 1;
    }
    stats.set(skillKey, existing);
  }

  const result = new Map<string, { score: number } & SkillStats>();
  for (const [key, s] of stats) {
    const daysSince = s.lastRunMs !== null
      ? Math.max((now - s.lastRunMs) / 86400000, 0.01)
      : Infinity;
    const recency = daysSince === Infinity ? 0 : 1 / daysSince;
    const score = recencyWeight * recency + frequencyWeight * s.count30d;
    result.set(key, {
      score,
      lastRunAt: s.lastRunMs !== null ? new Date(s.lastRunMs) : null,
      runCount30d: s.count30d,
    });
  }
  return result;
}
