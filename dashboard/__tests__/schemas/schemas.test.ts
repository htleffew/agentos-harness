import { describe, it, expect } from "vitest";
import { DashboardConfigSchema } from "@/schemas/dashboard-config";
import { TaskSchema } from "@/schemas/task";
import { RunSchema } from "@/schemas/run";
import { MissionSchema } from "@/schemas/mission";
import { buildPreamble } from "@/lib/harness/preflight";

describe("DashboardConfigSchema", () => {
  it("parses defaults", () => {
    const result = DashboardConfigSchema.parse({});
    expect(result.port).toBe(8768);
    expect(result.theme).toBe("dark");
    expect(result.concurrencyLimit).toBe(2);
    expect(result.domainOrder).toContain("daily");
  });

  it("rejects invalid port", () => {
    expect(() => DashboardConfigSchema.parse({ port: 80 })).toThrow();
  });

  it("round-trips custom config", () => {
    const input = {
      port: 9000,
      theme: "dark" as const,
      domainOrder: ["daily", "ops"],
      pinnedSkill: "planning-work",
      concurrencyLimit: 4,
      maxContinuations: 5,
      recencyWeight: 0.7,
      frequencyWeight: 0.3,
      costEstimation: { codexBurnRatePerMin: 0.1, geminiBurnRatePerMin: 0.05 },
    };
    const parsed = DashboardConfigSchema.parse(input);
    expect(parsed.port).toBe(9000);
    expect(parsed.pinnedSkill).toBe("planning-work");
    expect(parsed.costEstimation.codexBurnRatePerMin).toBe(0.1);
  });
});

describe("TaskSchema", () => {
  it("parses a valid task", () => {
    const now = new Date().toISOString();
    const task = TaskSchema.parse({
      id: "550e8400-e29b-41d4-a716-446655440001",
      title: "Test task",
      createdAt: now,
      updatedAt: now,
    });
    expect(task.title).toBe("Test task");
    expect(task.status).toBe("BACKLOG");
    expect(task.agent).toBe("unassigned");
  });
});

describe("RunSchema", () => {
  it("parses a valid run", () => {
    const now = new Date().toISOString();
    const run = RunSchema.parse({
      id: "550e8400-e29b-41d4-a716-446655440002",
      skillName: "planning-work",
      agent: "claude",
      startedAt: now,
      projectDir: "/workspace",
    });
    expect(run.agent).toBe("claude");
    expect(run.status).toBe("PENDING");
  });
});

describe("MissionSchema", () => {
  it("parses a valid mission", () => {
    const now = new Date().toISOString();
    const mission = MissionSchema.parse({
      id: "550e8400-e29b-41d4-a716-446655440003",
      title: "Test mission",
      createdAt: now,
      updatedAt: now,
    });
    expect(mission.status).toBe("DRAFT");
    expect(mission.failCount).toBe(0);
  });
});

describe("buildPreamble", () => {
  it("includes all 4 base surfaces", () => {
    const result = buildPreamble({ agent: "claude", skillPrompt: "Do a thing" });
    expect(result).toContain(".claude/wiki/index.md");
    expect(result).toContain("AGENTS.md");
    expect(result).toContain("CLAUDE.md");
    expect(result).toContain(".claude/skills.json");
    expect(result).toContain("Do a thing");
  });

  it("adds CODEX.md for codex agent", () => {
    const result = buildPreamble({ agent: "codex", skillPrompt: "Do a thing" });
    expect(result).toContain("CODEX.md");
  });

  it("adds project surfaces when project provided", () => {
    const result = buildPreamble({ agent: "claude", skillPrompt: "Do a thing", project: "myproject" });
    expect(result).toContain("projects/myproject/HANDOFF.md");
  });
});
