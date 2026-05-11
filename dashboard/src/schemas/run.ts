import { z } from "zod";

export const RunStatusSchema = z.enum(["PENDING", "RUNNING", "DONE", "FAILED", "TIMEOUT"]);

export const RunSchema = z.object({
  id: z.string().uuid(),
  skillName: z.string(),
  agent: z.enum(["claude", "codex", "gemini"]),
  pid: z.number().nullable().default(null),
  status: RunStatusSchema.default("PENDING"),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable().default(null),
  durationMs: z.number().nullable().default(null),
  costEstimate: z.number().min(0).default(0),
  tokenInputs: z.number().int().min(0).default(0),
  tokenOutputs: z.number().int().min(0).default(0),
  exitCode: z.number().nullable().default(null),
  taskId: z.string().uuid().nullable().default(null),
  projectDir: z.string(),
});

export type Run = z.infer<typeof RunSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
