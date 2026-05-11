"use client";

/**
 * MultiAgentLane — Groups IN_PROGRESS tasks by agent into swim-lane rows.
 *
 * Shows only when there are IN_PROGRESS tasks with at least 2 distinct agents.
 * Each lane has a header badge and a horizontal scroll of TaskCards.
 */

import type { Task } from "@/schemas/task";
import { TaskCard } from "./TaskCard";

const AGENT_META: Record<string, { label: string; colour: string; icon: string }> = {
  claude:    { label: "Claude",     colour: "var(--color-accent)",  icon: "⚡" },
  codex:     { label: "Codex",      colour: "var(--color-info)",    icon: "⌨" },
  gemini:    { label: "Gemini",     colour: "var(--color-success)", icon: "✦" },
  unassigned:{ label: "Unassigned", colour: "var(--color-text-muted)", icon: "·" },
};

interface Props {
  tasks: Task[];
  onLaunchTask: (task: Task) => void;
  onStatusChange: (taskId: string, status: Task["status"]) => void;
  onDeleteTask: (taskId: string) => void;
}

export function MultiAgentLane({ tasks, onLaunchTask, onStatusChange, onDeleteTask }: Props) {
  const inProgress = tasks.filter((t) => t.status === "IN_PROGRESS");
  const byAgent: Record<string, Task[]> = {};

  for (const task of inProgress) {
    const key = task.agent ?? "unassigned";
    if (!byAgent[key]) byAgent[key] = [];
    byAgent[key].push(task);
  }

  const agents = Object.keys(byAgent).sort();

  if (agents.length < 2) return null; // Only show when multiple agents are active

  return (
    <div
      className="border-b"
      style={{ borderColor: "var(--color-border)", background: "var(--color-bg-surface)" }}
    >
      <div className="px-4 pt-3 pb-1 flex items-center gap-2">
        <span
          className="text-xs font-bold tracking-widest"
          style={{ color: "var(--color-text-muted)" }}
        >
          MULTI-AGENT LANES
        </span>
        <span
          className="text-xs px-1.5 py-0.5 rounded"
          style={{ background: "var(--color-bg-overlay)", color: "var(--color-text-muted)" }}
        >
          {inProgress.length} in-progress
        </span>
      </div>

      <div className="space-y-0.5 pb-3">
        {agents.map((agent) => {
          const meta = AGENT_META[agent] ?? AGENT_META.unassigned;
          const agentTasks = byAgent[agent];
          return (
            <div key={agent} className="flex items-start gap-3 px-4 py-2">
              {/* Agent label */}
              <div
                className="flex-shrink-0 flex flex-col items-center gap-1 pt-1"
                style={{ minWidth: 70 }}
              >
                <span
                  className="text-xs font-bold px-2 py-0.5 rounded-full"
                  style={{
                    background: `color-mix(in srgb, ${meta.colour} 15%, var(--color-bg-elevated))`,
                    color: meta.colour,
                    border: `1px solid ${meta.colour}`,
                    fontSize: "0.65rem",
                    whiteSpace: "nowrap",
                  }}
                >
                  {meta.icon} {meta.label}
                </span>
                <span
                  className="text-xs"
                  style={{ color: "var(--color-text-muted)", fontSize: "0.65rem" }}
                >
                  {agentTasks.length} task{agentTasks.length !== 1 ? "s" : ""}
                </span>
              </div>

              {/* Horizontal task scroll */}
              <div
                className="flex gap-2 overflow-x-auto pb-1"
                style={{ flex: 1, scrollbarWidth: "thin" }}
              >
                {agentTasks.map((task) => (
                  <div key={task.id} style={{ minWidth: 220, maxWidth: 260, flexShrink: 0 }}>
                    <TaskCard
                      task={task}
                      onStatusChange={onStatusChange}
                      onLaunch={onLaunchTask}
                      onDelete={onDeleteTask}
                    />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
