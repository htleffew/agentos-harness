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
} from "@dnd-kit/core";
import type { Task } from "@/schemas/task";
import { KanbanColumn } from "@/components/kanban/KanbanColumn";
import { CreateTaskModal } from "@/components/kanban/CreateTaskModal";
import { RunDrawer } from "@/components/skills/RunDrawer";
import { MultiAgentLane } from "@/components/kanban/MultiAgentLane";

const COLUMNS: { id: Task["status"]; label: string; colour: string }[] = [
  { id: "BACKLOG",     label: "BACKLOG",     colour: "var(--color-text-muted)" },
  { id: "TODO",        label: "QUEUED",      colour: "var(--color-info)" },
  { id: "IN_PROGRESS", label: "IN PROGRESS", colour: "var(--color-accent)" },
  { id: "REVIEW",      label: "REVIEW",      colour: "var(--color-warning)" },
  { id: "DONE",        label: "DONE",        colour: "var(--color-success)" },
  { id: "BLOCKED",     label: "BLOCKED",     colour: "var(--color-danger)" },
];

interface ActiveRun { runId: string; skillName: string; }

export default function KanbanPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);
  const [dragging, setDragging] = useState<Task | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // ── Load tasks ──────────────────────────────────────────────────────────────

  const loadTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks");
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTasks();
    const id = setInterval(loadTasks, 8000); // refresh every 8s
    return () => clearInterval(id);
  }, [loadTasks]);

  // ── Drag & Drop ─────────────────────────────────────────────────────────────

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find((t) => t.id === String(event.active.id));
    setDragging(task ?? null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setDragging(null);
    const { active, over } = event;
    if (!over) return;

    const taskId = String(active.id);
    const newStatus = String(over.id) as Task["status"];

    // Only update if dropped on a column header (valid status)
    const validStatus = COLUMNS.find((c) => c.id === newStatus);
    if (!validStatus) return;

    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === newStatus) return;

    // Optimistic update
    setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, status: newStatus } : t));

    await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
  };

  // ── CRUD handlers ───────────────────────────────────────────────────────────

  const handleCreate = async (data: {
    title: string; description: string; agent: string; priority: number; tags: string[];
  }) => {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      const { task } = await res.json();
      setTasks((prev) => [...prev, task]);
    }
  };

  const handleStatusChange = async (taskId: string, status: Task["status"]) => {
    setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, status } : t));
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
      // Update task with continuation count
      await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ continuationCount: task.continuationCount + 1 }),
      });
      loadTasks();
    }
  };

  // ── Derived data ────────────────────────────────────────────────────────────

  const byStatus = (status: Task["status"]) => tasks.filter((t) => t.status === status);
  const loopCount = tasks.filter((t) => t.continuationCount >= 3).length;
  const stuckCount = tasks.filter((t) => t.status === "IN_PROGRESS" && !t.activePid).length;

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
              Kanban
            </h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
              {tasks.length} tasks
              {loopCount > 0 && (
                <span className="ml-2" style={{ color: "var(--color-warning)" }}>⚠ {loopCount} looping</span>
              )}
              {stuckCount > 0 && (
                <span className="ml-2" style={{ color: "var(--color-danger)" }}>✗ {stuckCount} stuck</span>
              )}
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 rounded text-sm font-semibold transition-colors"
            style={{
              background: "var(--color-accent)",
              color: "var(--color-text-inverse)",
              border: "none",
            }}
            id="kanban-new-task-btn"
          >
            + New Task
          </button>
        </div>

        {/* Multi-agent swim lanes (shown when 2+ agents IN_PROGRESS) */}
        <MultiAgentLane
          tasks={tasks}
          onLaunchTask={handleLaunch}
          onStatusChange={handleStatusChange}
          onDeleteTask={handleDelete}
        />

        {/* Board */}
        <div className="flex-1 overflow-x-auto p-6">
          {loading ? (
            <div style={{ color: "var(--color-text-muted)" }}>Loading tasks…</div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <div className="flex gap-4" style={{ minHeight: "70vh" }}>
                {COLUMNS.map((col) => (
                  <KanbanColumn
                    key={col.id}
                    id={col.id}
                    label={col.label}
                    colour={col.colour}
                    tasks={byStatus(col.id)}
                    onStatusChange={handleStatusChange}
                    onDelete={handleDelete}
                    onLaunch={handleLaunch}
                  />
                ))}
              </div>

              {/* Drag overlay: ghost card while dragging */}
              <DragOverlay>
                {dragging && (
                  <div className="surface rounded-md p-3 opacity-90" style={{ maxWidth: 320 }}>
                    <p className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>
                      {dragging.title}
                    </p>
                  </div>
                )}
              </DragOverlay>
            </DndContext>
          )}
        </div>
      </div>

      {/* Modals */}
      {showCreate && (
        <CreateTaskModal
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
        />
      )}
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
