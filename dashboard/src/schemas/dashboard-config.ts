import { z } from "zod";

export const CostEstimationSchema = z.object({
  codexBurnRatePerMin: z.number().min(0).default(0.05),
  geminiBurnRatePerMin: z.number().min(0).default(0.03),
});

export const DashboardConfigSchema = z.object({
  port: z.number().int().min(1024).max(65535).default(8768),
  theme: z.literal("dark").default("dark"),
  domainOrder: z
    .array(z.string())
    .default(["daily", "productivity", "research", "content", "community", "ops", "custom"]),
  pinnedSkill: z.string().nullable().default(null),
  concurrencyLimit: z.number().int().min(1).max(16).default(2),
  maxContinuations: z.number().int().min(1).max(10).default(3),
  recencyWeight: z.number().min(0).max(1).default(0.6),
  frequencyWeight: z.number().min(0).max(1).default(0.4),
  costEstimation: CostEstimationSchema.default(() => ({
    codexBurnRatePerMin: 0.05,
    geminiBurnRatePerMin: 0.03,
  })),
});

export type DashboardConfig = z.infer<typeof DashboardConfigSchema>;
export type CostEstimation = z.infer<typeof CostEstimationSchema>;
