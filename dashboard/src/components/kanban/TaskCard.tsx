"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Task } from "@/schemas/task";

interface TaskCardProps {
  task: Task;
  onStatusChange: (taskId: string, status: Task["status"]) => void;
  onDelete: (taskId: string) => void;
  onLaunch: (task: Task) => void;
}

const AGENT_COLOURS: Record<string, string> = {
  claude: "var(--color-accent)",
  codex: "var(--color-info)",
  gemini: "var(--color-success)",
  unassigned: "var(--color-text-muted)",
};

const AGENT_LABELS: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
  unassigned: "—",
};

const PRIORITY_LABELS = ["", "🔴 P1", "🟠 P2", "🟡 P3", "⚪ P4"];

export function TaskCard({ task, onStatusChange, onDelete, onLaunch }: TaskCardProps) {
  const [expanded, setExpanded] = useState(false);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const agentColour = AGENT_COLOURS[task.agent] ?? AGENT_COLOURS.unassigned;
  const isRunning = task.status === "IN_PROGRESS" && !!task.activePid;
  const isLooping = task.continuationCount >= 3;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="surface rounded-md p-3 cursor-default select-none"
    >
      {/* Drag handle + title row */}
      <div className="flex items-start gap-2">
        <span
          {...attributes}
          {...listeners}
          className="mt-0.5 flex-shrink-0 cursor-grab active:cursor-grabbing"
          style={{ color: "var(--color-text-muted)", fontSize: "0.75rem" }}
          aria-label="drag handle"
        >
          ⠿
        </span>

        <div className="flex-1 min-w-0">
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-left w-full"
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
          >
            <p
              className="text-sm font-medium leading-snug"
              style={{ color: "var(--color-text-primary)" }}
            >
              {isLooping && (
                <span
                  className="mr-1 text-xs px-1 rounded"
                  style={{ background: "color-mix(in srgb, var(--color-warning) 20%, transparent)", color: "var(--color-warning)" }}
                  title="Loop detected"
                >
                  ⚠ LOOP
                </span>
              )}
              {task.title}
            </p>
          </button>

          {/* Meta row */}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span
              className="text-xs px-1.5 py-0.5 rounded-full border"
              style={{ color: agentColour, borderColor: agentColour, fontSize: "0.65rem" }}
            >
              {AGENT_LABELS[task.agent]}
            </span>
            <span style={{ color: "var(--color-text-muted)", fontSize: "0.7rem" }}>
              {PRIORITY_LABELS[task.priority] ?? ""}
            </span>
            {task.continuationCount > 0 && (
              <span style={{ color: "var(--color-text-muted)", fontSize: "0.65rem" }}>
                ↩ {task.continuationCount}×
              </span>
            )}
            {task.costAccumulated > 0 && (
              <span style={{ color: "var(--color-text-muted)", fontSize: "0.65rem" }}>
                ${task.costAccumulated.toFixed(3)}
              </span>
            )}
            {isRunning && (
              <span className="dot-pulse" style={{ width: 6, height: 6 }} />
            )}
          </div>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="mt-3 space-y-2 animate-fade-in">
          {task.description && (
            <p
              className="text-xs leading-relaxed"
              style={{ color: "var(--color-text-secondary)" }}
            >
              {task.description}
            </p>
          )}

          {/* Tags */}
          {task.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {task.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs px-1.5 py-0.5 rounded"
                  style={{ background: "var(--color-bg-overlay)", color: "var(--color-text-muted)" }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Loop escalation warning */}
          {isLooping && (
            <div
              className="rounded p-2 text-xs"
              style={{
                background: "color-mix(in srgb, var(--color-warning) 10%, var(--color-bg-elevated))",
                border: "1px solid var(--color-warning)",
                color: "var(--color-warning)",
              }}
            >
              ⚠ Loop detected after {task.continuationCount} continuations. Manual intervention required.
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 flex-wrap pt-1">
            {task.status !== "IN_PROGRESS" && task.agent !== "unassigned" && !isLooping && (
              <button
                onClick={() => onLaunch(task)}
                className="text-xs px-2.5 py-1 rounded transition-colors"
                style={{
                  background: "var(--color-accent-dim)",
                  color: "var(--color-accent)",
                  border: "1px solid var(--color-accent)",
                }}
                id={`task-launch-${task.id}`}
              >
                ▷ Launch
              </button>
            )}
            {task.status === "BACKLOG" && (
              <button
                onClick={() => onStatusChange(task.id, "TODO")}
                className="text-xs px-2.5 py-1 rounded transition-colors"
                style={{
                  background: "var(--color-bg-elevated)",
                  color: "var(--color-text-secondary)",
                  border: "1px solid var(--color-border)",
                }}
              >
                → Queue
              </button>
            )}
            {task.status === "IN_PROGRESS" && (
              <button
                onClick={() => onStatusChange(task.id, "DONE")}
                className="text-xs px-2.5 py-1 rounded transition-colors"
                style={{
                  background: "color-mix(in srgb, var(--color-success) 15%, transparent)",
                  color: "var(--color-success)",
                  border: "1px solid var(--color-success)",
                }}
              >
                ✓ Done
              </button>
            )}
            <button
              onClick={() => onDelete(task.id)}
              className="text-xs px-2.5 py-1 rounded transition-colors ml-auto"
              style={{
                background: "transparent",
                color: "var(--color-text-muted)",
                border: "1px solid var(--color-border)",
              }}
              id={`task-delete-${task.id}`}
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
