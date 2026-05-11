"use client";

import { useState } from "react";

interface CreateTaskModalProps {
  onClose: () => void;
  onCreate: (data: {
    title: string;
    description: string;
    agent: string;
    priority: number;
    tags: string[];
  }) => void;
}

const AGENTS = ["unassigned", "claude", "codex", "gemini"];
const PRIORITIES = [
  { value: 1, label: "🔴 P1 — Urgent & Important" },
  { value: 2, label: "🟠 P2 — Important, Not Urgent" },
  { value: 3, label: "🟡 P3 — Urgent, Not Important" },
  { value: 4, label: "⚪ P4 — Neither" },
];

export function CreateTaskModal({ onClose, onCreate }: CreateTaskModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [agent, setAgent] = useState("unassigned");
  const [priority, setPriority] = useState(3);
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) { setTags([...tags, t]); setTagInput(""); }
  };

  const submit = () => {
    if (!title.trim()) return;
    onCreate({ title: title.trim(), description, agent, priority, tags });
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-50" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose} />
      <div
        className="fixed z-50 surface-overlay p-6 w-full"
        style={{
          top: "50%", left: "50%",
          transform: "translate(-50%, -50%)",
          maxWidth: 520,
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <h2 className="text-base font-bold mb-4" style={{ color: "var(--color-text-primary)" }}>
          New Task
        </h2>

        {/* Title */}
        <div className="mb-3">
          <label className="block text-xs mb-1.5" style={{ color: "var(--color-text-secondary)" }}>
            Title *
          </label>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            className="w-full rounded px-3 py-2 text-sm"
            style={{
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-primary)",
              outline: "none",
            }}
            placeholder="What needs to be done?"
            id="new-task-title"
          />
        </div>

        {/* Description */}
        <div className="mb-3">
          <label className="block text-xs mb-1.5" style={{ color: "var(--color-text-secondary)" }}>
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full rounded px-3 py-2 text-sm resize-none"
            style={{
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-primary)",
              outline: "none",
            }}
            placeholder="Optional context…"
          />
        </div>

        {/* Agent + Priority */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs mb-1.5" style={{ color: "var(--color-text-secondary)" }}>Agent</label>
            <select
              value={agent}
              onChange={(e) => setAgent(e.target.value)}
              className="w-full rounded px-3 py-2 text-sm"
              style={{
                background: "var(--color-bg-elevated)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-primary)",
              }}
              id="new-task-agent"
            >
              {AGENTS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1.5" style={{ color: "var(--color-text-secondary)" }}>Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              className="w-full rounded px-3 py-2 text-sm"
              style={{
                background: "var(--color-bg-elevated)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-primary)",
              }}
              id="new-task-priority"
            >
              {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
        </div>

        {/* Tags */}
        <div className="mb-5">
          <label className="block text-xs mb-1.5" style={{ color: "var(--color-text-secondary)" }}>Tags</label>
          <div className="flex gap-2">
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); } }}
              className="flex-1 rounded px-3 py-2 text-sm"
              style={{
                background: "var(--color-bg-elevated)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-primary)",
                outline: "none",
              }}
              placeholder="Add tag, press Enter"
            />
            <button onClick={addTag} className="px-3 py-2 rounded text-sm"
              style={{ background: "var(--color-bg-overlay)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)" }}>+</button>
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {tags.map((t) => (
                <span key={t} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded"
                  style={{ background: "var(--color-bg-overlay)", color: "var(--color-text-secondary)" }}>
                  {t}
                  <button onClick={() => setTags(tags.filter((x) => x !== t))} style={{ color: "var(--color-text-muted)", background: "none", border: "none", cursor: "pointer" }}>×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded text-sm"
            style={{ background: "var(--color-bg-elevated)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)" }}>
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!title.trim()}
            className="px-4 py-2 rounded text-sm font-semibold"
            style={{
              background: title.trim() ? "var(--color-accent)" : "var(--color-border)",
              color: title.trim() ? "var(--color-text-inverse)" : "var(--color-text-muted)",
              border: "none",
              cursor: title.trim() ? "pointer" : "not-allowed",
            }}
            id="new-task-submit"
          >
            Create Task
          </button>
        </div>
      </div>
    </>
  );
}
