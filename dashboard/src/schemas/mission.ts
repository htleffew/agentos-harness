import { z } from "zod";

export const MissionStatusSchema = z.enum([
  "DRAFT",
  "RUNNING",
  "PAUSED",
  "DONE",
  "FAILED",
]);
export type MissionStatus = z.infer<typeof MissionStatusSchema>;

export const MissionSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().default(""),
  objective: z.string().default(""),
  agent: z.enum(["claude", "codex", "gemini"]).default("claude"),
  status: MissionStatusSchema.default("DRAFT"),
  skillSequence: z.array(z.string()).default([]),
  currentSkillIndex: z.number().int().min(0).default(0),
  maxContinuations: z.number().int().min(1).max(20).default(3),
  continuationCount: z.number().int().min(0).default(0),
  failCount: z.number().int().min(0).default(0),
  taskIds: z.array(z.string()).default([]),
  runIds: z.array(z.string()).default([]),
  costAccumulated: z.number().min(0).default(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable().default(null),
  completedAt: z.string().datetime().nullable().default(null),
});

export type Mission = z.infer<typeof MissionSchema>;
