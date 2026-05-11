import { z } from "zod";

export const TaskStatusSchema = z.enum([
  "BACKLOG",
  "TODO",
  "IN_PROGRESS",
  "REVIEW",
  "DONE",
  "BLOCKED",
]);

export const AgentSchema = z.enum(["claude", "codex", "gemini", "unassigned"]);

export const TaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().default(""),
  status: TaskStatusSchema.default("BACKLOG"),
  agent: AgentSchema.default("unassigned"),
  project: z.string().nullable().default(null),
  skill: z.string().nullable().default(null),
  priority: z.number().int().min(1).max(4).default(3), // 1=urgent+important, 4=neither
  tags: z.array(z.string()).default([]),
  activePid: z.number().nullable().default(null),
  continuationCount: z.number().int().min(0).default(0),
  costAccumulated: z.number().min(0).default(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable().default(null),
});

export type Task = z.infer<typeof TaskSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type Agent = z.infer<typeof AgentSchema>;
