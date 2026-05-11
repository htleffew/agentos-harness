/**
 * GET /api/telemetry — reads activity.jsonl and returns:
 *   - tokenStats: total input/output tokens consumed today
 *   - recentActivity: last N entries for the sparkline
 *   - burnRate: USD/hour estimate from recent runs
 */

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

interface ActivityEntry {
  ts: string;
  tool: string;
  ok: boolean;
  desc: string;
  agent?: string;
  runId?: string;
}

interface RunEntry {
  id: string;
  tokenInputs?: number;
  tokenOutputs?: number;
  costEstimate?: number;
  startedAt: string;
  completedAt?: string;
  status?: string;
}

export async function GET(): Promise<NextResponse> {
  const workspace =
    process.env.CLAUDE_PROJECT_DIR || process.env.AGENTOS_WORKSPACE || process.cwd();

  const activityPath = path.join(workspace, ".harness", "state", "activity.jsonl");
  const runsPath = path.join(workspace, ".harness", "state", "dashboard-runs.json");

  // Read activity.jsonl — last 200 lines
  const activity: ActivityEntry[] = [];
  if (fs.existsSync(activityPath)) {
    const lines = fs.readFileSync(activityPath, "utf-8").trim().split("\n").filter(Boolean);
    for (const line of lines.slice(-200)) {
      try { activity.push(JSON.parse(line)); } catch { /* skip */ }
    }
  }

  // Read runs for token stats
  let tokenInputs = 0;
  let tokenOutputs = 0;
  let totalCost = 0;
  const todayPrefix = new Date().toISOString().slice(0, 10);
  const hourlyBuckets: Record<string, number> = {};

  if (fs.existsSync(runsPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(runsPath, "utf-8"));
      const allRuns: RunEntry[] = [...(data.active ?? []), ...(data.recent ?? [])];
      for (const run of allRuns) {
        if (!run.startedAt.startsWith(todayPrefix)) continue;
        tokenInputs += run.tokenInputs ?? 0;
        tokenOutputs += run.tokenOutputs ?? 0;
        totalCost += run.costEstimate ?? 0;
        // hourly bucket for burn rate
        const hour = run.startedAt.slice(0, 13); // "2026-05-10T14"
        hourlyBuckets[hour] = (hourlyBuckets[hour] ?? 0) + (run.costEstimate ?? 0);
      }
    } catch { /* ignore */ }
  }

  // Burn rate: average over last 3 hours that have data
  const recentHours = Object.entries(hourlyBuckets)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-3);
  const burnRatePerHour =
    recentHours.length > 0
      ? recentHours.reduce((s, [, v]) => s + v, 0) / recentHours.length
      : 0;

  // Sparkline data: activity count per 5-minute window over the last 2 hours
  const now = Date.now();
  const WINDOW = 5 * 60 * 1000; // 5 minutes
  const BUCKETS = 24; // 24 × 5min = 2 hours
  const sparkline = Array.from({ length: BUCKETS }, (_, i) => {
    const windowStart = now - (BUCKETS - i) * WINDOW;
    const windowEnd = windowStart + WINDOW;
    return activity.filter((a) => {
      const t = new Date(a.ts).getTime();
      return t >= windowStart && t < windowEnd;
    }).length;
  });

  // Context window estimate (rough: 200k context, each token ~4 chars)
  const contextUsed = tokenInputs + tokenOutputs;
  const contextMax = 200_000; // Sonnet 4 default

  return NextResponse.json({
    workspace,
    tokenInputs,
    tokenOutputs,
    totalCost: parseFloat(totalCost.toFixed(4)),
    burnRatePerHour: parseFloat(burnRatePerHour.toFixed(4)),
    contextUsed,
    contextMax,
    contextPct: Math.min(100, Math.round((contextUsed / contextMax) * 100)),
    sparkline,
    recentActivity: activity.slice(-20),
    todayRuns: recentHours.length,
  });
}
