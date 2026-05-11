"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";

interface SearchResult {
  id: string;
  type: "skill" | "task" | "mission" | "page";
  label: string;
  detail?: string;
  href?: string;
  action?: () => void;
}

const PAGES: SearchResult[] = [
  { id: "page-skills",    type: "page", label: "Skills",          detail: "Run agent skills",              href: "/skills" },
  { id: "page-kanban",    type: "page", label: "Kanban",          detail: "Task board",                    href: "/kanban" },
  { id: "page-matrix",    type: "page", label: "Matrix",          detail: "Eisenhower priority matrix",    href: "/matrix" },
  { id: "page-brain",     type: "page", label: "Brain Dump",      detail: "Capture → triage → tasks",     href: "/brain-dump" },
  { id: "page-missions",  type: "page", label: "Missions",        detail: "Autonomous dispatch loops",     href: "/missions" },
  { id: "page-ops",       type: "page", label: "OPS",             detail: "Lint · telemetry · config",    href: "/ops" },
];

const TYPE_ICON: Record<string, string> = {
  skill: "⚡",
  task: "📋",
  mission: "🚀",
  page: "→",
};

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [skills, setSkills] = useState<SearchResult[]>([]);
  const [tasks, setTasks] = useState<SearchResult[]>([]);
  const [missions, setMissions] = useState<SearchResult[]>([]);

  // Focus input and load data when opened
  useEffect(() => {
    if (!open) return;
    setTimeout(() => inputRef.current?.focus(), 50);

    // Fetch in parallel
    Promise.all([
      fetch("/api/skills").then((r) => r.json()).catch(() => ({ skills: [] })),
      fetch("/api/tasks").then((r) => r.json()).catch(() => ({ tasks: [] })),
      fetch("/api/missions").then((r) => r.json()).catch(() => ({ missions: [] })),
    ]).then(([skillsData, tasksData, missionsData]) => {
      setSkills(
        (skillsData.skills ?? []).map((s: { skillDir: string; skillName: string; domain: string }) => ({
          id: `skill-${s.skillDir}`,
          type: "skill" as const,
          label: s.skillName,
          detail: s.domain,
          href: `/skills#${s.skillDir}`,
        }))
      );
      setTasks(
        (tasksData.tasks ?? []).map((t: { id: string; title: string; status: string }) => ({
          id: `task-${t.id}`,
          type: "task" as const,
          label: t.title,
          detail: t.status,
          href: "/kanban",
        }))
      );
      setMissions(
        (missionsData.missions ?? []).map((m: { id: string; title: string; status: string }) => ({
          id: `mission-${m.id}`,
          type: "mission" as const,
          label: m.title,
          detail: m.status,
          href: "/missions",
        }))
      );
    });
  }, [open]);


  const handleSelect = useCallback((result: SearchResult) => {
    if (result.action) { result.action(); }
    else if (result.href) { router.push(result.href); }
    onClose();
  }, [router, onClose]);

  if (!open) return null;

  const allResults = [...PAGES, ...skills, ...tasks, ...missions];
  const filtered = query
    ? allResults.filter((r) =>
        r.label.toLowerCase().includes(query.toLowerCase()) ||
        r.detail?.toLowerCase().includes(query.toLowerCase())
      )
    : allResults;

  const groups: Record<string, SearchResult[]> = {};
  for (const item of filtered) {
    (groups[item.type] ??= []).push(item);
  }
  const groupOrder = ["page", "skill", "task", "mission"] as const;
  const groupLabels: Record<string, string> = { page: "Pages", skill: "Skills", task: "Tasks", mission: "Missions" };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50"
        style={{ background: "rgba(0,0,0,0.7)" }}
        onClick={onClose}
      />
      {/* Palette */}
      <div
        className="fixed z-50"
        style={{
          top: "20%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(600px, 90vw)",
          maxHeight: "60vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        }}
      >
        <Command shouldFilter={false}>
          {/* Search input */}
          <div
            className="flex items-center gap-3 px-4 py-3 border-b"
            style={{ borderColor: "var(--color-border)" }}
          >
            <span style={{ color: "var(--color-text-muted)", fontSize: "1rem" }}>⌕</span>
            <Command.Input
              ref={inputRef}
              value={query}
              onValueChange={setQuery}
              placeholder="Search skills, tasks, missions, pages…"
              className="flex-1 bg-transparent outline-none text-sm"
              style={{ color: "var(--color-text-primary)", border: "none" }}
              id="command-palette-input"
            />
            <kbd
              className="text-xs px-1.5 py-0.5 rounded"
              style={{ background: "var(--color-bg-overlay)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}
            >
              Esc
            </kbd>
          </div>

          {/* Results */}
          <Command.List
            className="overflow-y-auto"
            style={{ maxHeight: "calc(60vh - 3.5rem)", padding: "0.5rem 0" }}
          >
            <Command.Empty
              style={{ color: "var(--color-text-muted)", textAlign: "center", padding: "2rem", fontSize: "0.85rem" }}
            >
              No results for &ldquo;{query}&rdquo;
            </Command.Empty>

            {groupOrder.map((type) => {
              const items = groups[type];
              if (!items?.length) return null;
              return (
                <Command.Group key={type} heading={groupLabels[type]}>
                  <div
                    className="px-4 py-1 text-xs font-semibold tracking-widest"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    {groupLabels[type]}
                  </div>
                  {items.slice(0, 6).map((item) => (
                    <Command.Item
                      key={item.id}
                      value={item.id}
                      onSelect={() => handleSelect(item)}
                      className="flex items-center gap-3 px-4 py-2 cursor-pointer"
                      style={{
                        color: "var(--color-text-primary)",
                        fontSize: "0.85rem",
                      }}
                      id={`cmd-${item.id}`}
                    >
                      <span style={{ color: "var(--color-text-muted)", fontSize: "0.8rem", width: 16, textAlign: "center", flexShrink: 0 }}>
                        {TYPE_ICON[item.type]}
                      </span>
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.detail && (
                        <span style={{ color: "var(--color-text-muted)", fontSize: "0.75rem", flexShrink: 0 }}>
                          {item.detail}
                        </span>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              );
            })}
          </Command.List>
        </Command>
      </div>
    </>
  );
}
