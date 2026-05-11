import { NextResponse } from "next/server";
import path from "path";
import { discoverSkills } from "@/lib/harness/skill-discovery";
import { buildSkillStats } from "@/lib/harness/activity-reader";

export const dynamic = "force-dynamic";

export async function GET() {
  const workspace = process.env.CLAUDE_PROJECT_DIR || process.env.AGENTOS_WORKSPACE || process.cwd();
  const configPath = path.join(workspace, ".harness", "config", "dashboard.json");

  let recencyWeight = 0.6;
  let frequencyWeight = 0.4;
  let domainOrder = ["daily", "productivity", "research", "content", "community", "ops", "custom"];

  try {
    const { readFileSync, existsSync } = await import("fs");
    if (existsSync(configPath)) {
      const cfg = JSON.parse(readFileSync(configPath, "utf-8"));
      recencyWeight = cfg.recencyWeight ?? recencyWeight;
      frequencyWeight = cfg.frequencyWeight ?? frequencyWeight;
      domainOrder = cfg.domainOrder ?? domainOrder;
    }
  } catch {
    // Use defaults
  }

  const skills = discoverSkills(workspace);
  const statsMap = buildSkillStats(workspace, recencyWeight, frequencyWeight);

  // Apply scores
  const scored = skills.map((s) => {
    const key = s.skillDir.split("/").pop() ?? "";
    const stats = statsMap.get(key);
    return {
      ...s,
      sortScore: stats?.score ?? 0,
      runCount30d: stats?.runCount30d ?? 0,
      lastRunAt: stats?.lastRunAt?.toISOString() ?? null,
    };
  });

  // Group by domain in order
  const grouped: Record<string, typeof scored> = {};
  for (const skill of scored) {
    if (!grouped[skill.domain]) grouped[skill.domain] = [];
    grouped[skill.domain].push(skill);
  }

  // Sort within each domain
  for (const domain of Object.keys(grouped)) {
    grouped[domain].sort((a, b) => b.sortScore - a.sortScore || a.displayLabel.localeCompare(b.displayLabel));
  }

  // Order domains
  const ordered: Record<string, typeof scored> = {};
  for (const d of domainOrder) {
    if (grouped[d]) ordered[d] = grouped[d];
  }
  for (const d of Object.keys(grouped).sort()) {
    if (!ordered[d]) ordered[d] = grouped[d];
  }

  return NextResponse.json({
    workspace,
    skills: scored,
    byDomain: ordered,
    total: scored.length,
  });
}
