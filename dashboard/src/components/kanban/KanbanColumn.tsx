"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { TaskCard } from "./TaskCard";
import type { Task } from "@/schemas/task";

interface KanbanColumnProps {
  id: Task["status"];
  label: string;
  colour: string;
  tasks: Task[];
  onStatusChange: (taskId: string, status: Task["status"]) => void;
  onDelete: (taskId: string) => void;
  onLaunch: (task: Task) => void;
}

export function KanbanColumn({
  id,
  label,
  colour,
  tasks,
  onStatusChange,
  onDelete,
  onLaunch,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className="flex flex-col"
      style={{
        minWidth: 280,
        maxWidth: 340,
        flex: "1 1 0",
        background: isOver ? "color-mix(in srgb, var(--color-bg-elevated) 80%, var(--color-accent-dim))" : "var(--color-bg-surface)",
        border: `1px solid ${isOver ? colour : "var(--color-border)"}`,
        borderRadius: "var(--radius-md)",
        transition: "border-color 150ms ease, background 150ms ease",
      }}
    >
      {/* Column header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ background: colour }}
          />
          <h3
            className="text-xs font-bold tracking-widest"
            style={{ color: colour }}
          >
            {label}
          </h3>
        </div>
        <span
          className="text-xs px-2 py-0.5 rounded-full font-mono"
          style={{ background: "var(--color-bg-overlay)", color: "var(--color-text-muted)" }}
        >
          {tasks.length}
        </span>
      </div>

      {/* Task list */}
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex-1 overflow-y-auto p-3 space-y-2" style={{ maxHeight: "calc(100vh - 14rem)" }}>
          {tasks.length === 0 && (
            <div
              className="flex items-center justify-center py-8 rounded border-2 border-dashed"
              style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)", fontSize: "0.75rem" }}
            >
              Drop tasks here
            </div>
          )}
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onStatusChange={onStatusChange}
              onDelete={onDelete}
              onLaunch={onLaunch}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}
