"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  useDroppable,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Task } from "@/schemas/task";
import { TaskCard } from "@/components/kanban/TaskCard";
import { RunDrawer } from "@/components/skills/RunDrawer";

// Eisenhower priority → quadrant mapping
// P1 = Urgent + Important
// P2 = Important, Not Urgent
// P3 = Urgent, Not Important
// P4 = Neither
const QUADRANTS = [
  {
    priority: 1,
    label: "DO FIRST",
    sub: "Urgent + Important",
    colour: "var(--color-danger)",
    corner: "top-left",
  },
  {
    priority: 2,
    label: "SCHEDULE",
    sub: "Important, Not Urgent",
    colour: "var(--color-info)",
    corner: "top-right",
  },
  {
    priority: 3,
    label: "DELEGATE",
    sub: "Urgent, Not Important",
    colour: "var(--color-warning)",
    corner: "bottom-left",
  },
  {
    priority: 4,
    label: "ELIMINATE",
    sub: "Neither",
    colour: "var(--color-text-muted)",
    corner: "bottom-right",
  },
] as const;

interface MatrixQuadrantProps {
  priority: 1 | 2 | 3 | 4;
  label: string;
  sub: string;
  colour: string;
  tasks: Task[];
  onStatusChange: (id: string, status: Task["status"]) => void;
  onDelete: (id: string) => void;
  onLaunch: (task: Task) => void;
}

function MatrixQuadrant({
  priority,
  label,
  sub,
  colour,
  tasks,
  onStatusChange,
  onDelete,
  onLaunch,
}: MatrixQuadrantProps) {
  const droppableId = `priority-${priority}`;
  const { setNodeRef, isOver } = useDroppable({ id: droppableId });

  return (
    <div
      ref={setNodeRef}
      className="flex flex-col"
      style={{
        background: isOver
          ? `color-mix(in srgb, var(--color-bg-elevated) 80%, color-mix(in srgb, ${colour} 20%, transparent))`
          : "var(--color-bg-surface)",
        border: `1px solid ${isOver ? colour : "var(--color-border)"}`,
        borderRadius: "var(--radius-md)",
        transition: "border-color 150ms ease, background 150ms ease",
        minHeight: 280,
      }}
    >
      {/* Quadrant header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span
              className="text-xs font-bold tracking-widest"
              style={{ color: colour }}
            >
              {label}
            </span>
            <span
              className="text-xs px-2 py-0.5 rounded-full font-mono"
              style={{ background: "var(--color-bg-overlay)", color: "var(--color-text-muted)" }}
            >
              {tasks.length}
            </span>
          </div>
          <p style={{ color: "var(--color-text-muted)", fontSize: "0.7rem" }}>{sub}</p>
        </div>
        <span style={{ color: colour, fontSize: "1.25rem", opacity: 0.4 }}>
          {priority === 1 ? "🔴" : priority === 2 ? "🔵" : priority === 3 ? "🟡" : "⚪"}
        </span>
      </div>

      {/* Task list */}
      <SortableContext
        items={tasks.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {tasks.length === 0 && (
            <div
              className="flex items-center justify-center py-6 rounded border-2 border-dashed"
              style={{
                borderColor: "var(--color-border)",
                color: "var(--color-text-muted)",
                fontSize: "0.75rem",
              }}
            >
              Drop P{priority} tasks here
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

interface ActiveRun {
  runId: string;
  skillName: string;
}

export default function MatrixPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState<Task | null>(null);
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const loadTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks");
      if (res.ok) {
        const data = await res.json();
        // Show all non-DONE, non-BLOCKED tasks in the matrix
        setTasks(
          (data.tasks ?? []).filter(
            (t: Task) => t.status !== "DONE" && t.status !== "BLOCKED"
          )
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTasks();
    const id = setInterval(loadTasks, 10_000);
    return () => clearInterval(id);
  }, [loadTasks]);

  const handleDragStart = (event: DragStartEvent) => {
    setDragging(tasks.find((t) => t.id === String(event.active.id)) ?? null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setDragging(null);
    const { active, over } = event;
    if (!over) return;

    const taskId = String(active.id);
    const overId = String(over.id);

    // Check if dropped on a quadrant droppable (priority-1, priority-2, etc.)
    const match = overId.match(/^priority-(\d)$/);
    if (!match) return;
    const newPriority = Number(match[1]) as 1 | 2 | 3 | 4;

    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.priority === newPriority) return;

    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, priority: newPriority } : t))
    );

    await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priority: newPriority }),
    });
  };

  const handleStatusChange = async (taskId: string, status: Task["status"]) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId)); // remove from matrix
    await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  };

  const handleDelete = async (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
  };

  const handleLaunch = async (task: Task) => {
    if (!task.skill) return;
    await handleStatusChange(task.id, "IN_PROGRESS");
    const res = await fetch(`/api/skills/${encodeURIComponent(task.skill)}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: task.agent === "unassigned" ? "claude" : task.agent }),
    });
    if (res.ok) {
      const { runId } = await res.json();
      setActiveRun({ runId, skillName: task.skill });
    }
  };

  const byPriority = (p: 1 | 2 | 3 | 4) => tasks.filter((t) => t.priority === p);

  return (
    <>
      <div className="shell-main flex flex-col">
        {/* Page header */}
        <div
          className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b glass"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div>
            <h1 className="text-lg font-bold" style={{ color: "var(--color-text-primary)" }}>
              Eisenhower Matrix
            </h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
              {tasks.length} active tasks · drag to re-prioritize
            </p>
          </div>
          <div className="flex items-center gap-2">
            {([1, 2, 3, 4] as const).map((p) => (
              <span key={p} className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                P{p}:{byPriority(p).length}
              </span>
            ))}
          </div>
        </div>

        {/* Matrix grid */}
        <div className="flex-1 overflow-auto p-6">
          {loading ? (
            <div style={{ color: "var(--color-text-muted)" }}>Loading tasks…</div>
          ) : (
            <>
              {/* Axis labels */}
              <div className="flex items-center mb-3">
                <div className="w-4" />
                <div className="flex-1 text-center text-xs font-semibold tracking-widest" style={{ color: "var(--color-text-muted)" }}>
                  URGENT →
                </div>
              </div>
              <div className="flex gap-1">
                {/* Y-axis label */}
                <div className="flex items-center justify-center w-4">
                  <span
                    className="text-xs font-semibold tracking-widest"
                    style={{
                      color: "var(--color-text-muted)",
                      writingMode: "vertical-rl",
                      transform: "rotate(180deg)",
                    }}
                  >
                    IMPORTANT →
                  </span>
                </div>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCorners}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                >
                  <div
                    className="grid gap-4 flex-1"
                    style={{ gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr" }}
                  >
                    {QUADRANTS.map((q) => (
                      <MatrixQuadrant
                        key={q.priority}
                        priority={q.priority}
                        label={q.label}
                        sub={q.sub}
                        colour={q.colour}
                        tasks={byPriority(q.priority)}
                        onStatusChange={handleStatusChange}
                        onDelete={handleDelete}
                        onLaunch={handleLaunch}
                      />
                    ))}
                  </div>
                  <DragOverlay>
                    {dragging && (
                      <div className="surface rounded-md p-3 opacity-90" style={{ maxWidth: 280 }}>
                        <p className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>
                          {dragging.title}
                        </p>
                      </div>
                    )}
                  </DragOverlay>
                </DndContext>
              </div>
            </>
          )}
        </div>
      </div>

      {activeRun && (
        <RunDrawer
          runId={activeRun.runId}
          skillName={activeRun.skillName}
          onClose={() => { setActiveRun(null); loadTasks(); }}
        />
      )}
    </>
  );
}
