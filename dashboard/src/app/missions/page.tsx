"use client";

import { useCallback, useEffect, useState } from "react";
import type { Mission, MissionStatus } from "@/schemas/mission";
import { RunDrawer } from "@/components/skills/RunDrawer";

const STATUS_COLOURS: Record<MissionStatus, string> = {
  DRAFT:   "var(--color-text-muted)",
  RUNNING: "var(--color-accent)",
  PAUSED:  "var(--color-warning)",
  DONE:    "var(--color-success)",
  FAILED:  "var(--color-danger)",
};

const AGENT_COLOURS: Record<string, string> = {
  claude: "var(--color-accent)",
  codex: "var(--color-info)",
  gemini: "var(--color-success)",
};

interface ActiveRun { runId: string; skillName: string; }
interface NewMissionDraft {
  title: string;
  objective: string;
  agent: "claude" | "codex" | "gemini";
  skillSequence: string;
  maxContinuations: number;
}

function MissionCard({
  mission,
  onLaunch,
  onPause,
  onDelete,
}: {
  mission: Mission;
  onLaunch: (m: Mission) => void;
  onPause: (m: Mission) => void;
  onDelete: (id: string) => void;
}) {
  const colour = STATUS_COLOURS[mission.status];
  const isRunning = mission.status === "RUNNING";
  const isLooping = mission.failCount >= mission.maxContinuations;
  const progressPct = mission.skillSequence.length > 0
    ? Math.round((mission.currentSkillIndex / mission.skillSequence.length) * 100)
    : 0;

  return (
    <div
      className="surface rounded-md p-4"
      style={{ border: `1px solid ${isLooping ? "var(--color-warning)" : "var(--color-border)"}` }}
    >
      {/* Title + status */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {isRunning && <span className="dot-pulse" style={{ width: 6, height: 6 }} />}
            <h3 className="text-sm font-semibold truncate" style={{ color: "var(--color-text-primary)" }}>
              {mission.title}
            </h3>
          </div>
          <p className="text-xs leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
            {mission.objective}
          </p>
        </div>
        <span
          className="text-xs px-2 py-1 rounded font-mono flex-shrink-0"
          style={{ background: `color-mix(in srgb, ${colour} 15%, var(--color-bg-elevated))`, color: colour, border: `1px solid ${colour}` }}
        >
          {mission.status}
        </span>
      </div>

      {/* Progress bar */}
      {mission.skillSequence.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span style={{ fontSize: "0.65rem", color: "var(--color-text-muted)" }}>
              Skill {mission.currentSkillIndex}/{mission.skillSequence.length}
            </span>
            <span style={{ fontSize: "0.65rem", color: "var(--color-text-muted)" }}>{progressPct}%</span>
          </div>
          <div className="token-bar-track">
            <div
              className="token-bar-fill transition-all"
              style={{ width: `${progressPct}%`, background: colour, transition: "width 400ms ease" }}
            />
          </div>
        </div>
      )}

      {/* Skill sequence pills */}
      {mission.skillSequence.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {mission.skillSequence.map((skill, i) => (
            <span
              key={i}
              className="text-xs px-1.5 py-0.5 rounded"
              style={{
                background: i < mission.currentSkillIndex
                  ? "color-mix(in srgb, var(--color-success) 20%, var(--color-bg-overlay))"
                  : i === mission.currentSkillIndex && isRunning
                  ? "color-mix(in srgb, var(--color-accent) 20%, var(--color-bg-overlay))"
                  : "var(--color-bg-overlay)",
                color: i < mission.currentSkillIndex
                  ? "var(--color-success)"
                  : i === mission.currentSkillIndex && isRunning
                  ? "var(--color-accent)"
                  : "var(--color-text-muted)",
                border: `1px solid ${i === mission.currentSkillIndex && isRunning ? "var(--color-accent)" : "transparent"}`,
                fontSize: "0.65rem",
              }}
            >
              {i < mission.currentSkillIndex ? "✓ " : i === mission.currentSkillIndex && isRunning ? "▷ " : ""}{skill}
            </span>
          ))}
        </div>
      )}

      {/* Meta */}
      <div className="flex items-center gap-3 mb-3" style={{ fontSize: "0.65rem", color: "var(--color-text-muted)" }}>
        <span style={{ color: AGENT_COLOURS[mission.agent] }}>@{mission.agent}</span>
        {mission.costAccumulated > 0 && <span>${mission.costAccumulated.toFixed(3)}</span>}
        {mission.continuationCount > 0 && <span>↩ {mission.continuationCount}×</span>}
        {isLooping && (
          <span style={{ color: "var(--color-warning)" }}>⚠ LOOP ({mission.failCount} fails)</span>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        {(mission.status === "DRAFT" || mission.status === "PAUSED") && !isLooping && (
          <button
            onClick={() => onLaunch(mission)}
            className="text-xs px-3 py-1.5 rounded font-semibold"
            style={{ background: "var(--color-accent)", color: "var(--color-text-inverse)", border: "none", cursor: "pointer" }}
            id={`mission-launch-${mission.id}`}
          >
            ▷ {mission.status === "PAUSED" ? "Resume" : "Launch"}
          </button>
        )}
        {mission.status === "RUNNING" && (
          <button
            onClick={() => onPause(mission)}
            className="text-xs px-3 py-1.5 rounded"
            style={{ background: "var(--color-bg-elevated)", color: "var(--color-warning)", border: "1px solid var(--color-warning)", cursor: "pointer" }}
            id={`mission-pause-${mission.id}`}
          >
            ⏸ Pause
          </button>
        )}
        <button
          onClick={() => onDelete(mission.id)}
          className="text-xs px-3 py-1.5 rounded ml-auto"
          style={{ background: "transparent", color: "var(--color-text-muted)", border: "1px solid var(--color-border)", cursor: "pointer" }}
          id={`mission-delete-${mission.id}`}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export default function MissionsPage() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState<NewMissionDraft>({
    title: "", objective: "", agent: "claude", skillSequence: "", maxContinuations: 3,
  });
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);

  const loadMissions = useCallback(async () => {
    try {
      const res = await fetch("/api/missions");
      if (res.ok) { const d = await res.json(); setMissions(d.missions ?? []); }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    loadMissions();
    const id = setInterval(loadMissions, 8000);
    return () => clearInterval(id);
  }, [loadMissions]);

  const handleCreate = async () => {
    if (!draft.title.trim() || !draft.objective.trim()) return;
    const skillSequence = draft.skillSequence.split(",").map((s) => s.trim()).filter(Boolean);
    if (skillSequence.length === 0) return;
    const res = await fetch("/api/missions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...draft, skillSequence }),
    });
    if (res.ok) { const d = await res.json(); setMissions((p) => [...p, d.mission]); setShowCreate(false); setDraft({ title: "", objective: "", agent: "claude", skillSequence: "", maxContinuations: 3 }); }
  };

  const handleLaunch = async (mission: Mission) => {
    const skill = mission.skillSequence[mission.currentSkillIndex];
    if (!skill) return;
    await fetch(`/api/missions/${mission.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "RUNNING" }),
    });
    const res = await fetch(`/api/skills/${encodeURIComponent(skill)}/run`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent: mission.agent }),
    });
    if (res.ok) {
      const { runId } = await res.json();
      await fetch(`/api/missions/${mission.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runIds: [...mission.runIds, runId], continuationCount: mission.continuationCount + 1 }),
      });
      setActiveRun({ runId, skillName: skill });
      loadMissions();
    }
  };

  const handlePause = async (mission: Mission) => {
    await fetch(`/api/missions/${mission.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "PAUSED" }),
    });
    loadMissions();
  };

  const handleDelete = async (id: string) => {
    setMissions((p) => p.filter((m) => m.id !== id));
    await fetch(`/api/missions/${id}`, { method: "DELETE" });
  };

  const byStatus = (s: MissionStatus) => missions.filter((m) => m.status === s);
  const running = byStatus("RUNNING").length;

  return (
    <>
      <div className="shell-main flex flex-col">
        <div
          className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b glass"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div>
            <h1 className="text-lg font-bold" style={{ color: "var(--color-text-primary)" }}>
              Missions
            </h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
              {missions.length} missions · {running > 0 ? <span style={{ color: "var(--color-accent)" }}>{running} running</span> : "none active"}
            </p>
          </div>
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="px-4 py-2 rounded text-sm font-semibold"
            style={{ background: "var(--color-accent)", color: "var(--color-text-inverse)", border: "none", cursor: "pointer" }}
            id="missions-new-btn"
          >
            + New Mission
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {/* Create form */}
          {showCreate && (
            <div className="surface-overlay rounded-md p-5 mb-6 animate-fade-in">
              <h2 className="text-sm font-bold mb-4" style={{ color: "var(--color-text-primary)" }}>New Mission</h2>
              <div className="grid gap-3">
                <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="Mission title *" className="w-full rounded px-3 py-2 text-sm"
                  style={{ background: "var(--color-bg-elevated)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)", outline: "none" }}
                  id="mission-title-input" />
                <textarea value={draft.objective} onChange={(e) => setDraft({ ...draft, objective: e.target.value })}
                  placeholder="Objective — what should this mission achieve? *" rows={2} className="w-full rounded px-3 py-2 text-sm resize-none"
                  style={{ background: "var(--color-bg-elevated)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)", outline: "none" }} />
                <input value={draft.skillSequence} onChange={(e) => setDraft({ ...draft, skillSequence: e.target.value })}
                  placeholder="Skill sequence (comma-separated): orienting-session, planning-work, executing-plans"
                  className="w-full rounded px-3 py-2 text-sm"
                  style={{ background: "var(--color-bg-elevated)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)", outline: "none", fontFamily: "var(--font-mono)" }} />
                <div className="grid grid-cols-2 gap-3">
                  <select value={draft.agent} onChange={(e) => setDraft({ ...draft, agent: e.target.value as "claude" | "codex" | "gemini" })}
                    className="rounded px-3 py-2 text-sm"
                    style={{ background: "var(--color-bg-elevated)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}>
                    <option value="claude">Claude</option>
                    <option value="codex">Codex</option>
                    <option value="gemini">Gemini</option>
                  </select>
                  <select value={draft.maxContinuations} onChange={(e) => setDraft({ ...draft, maxContinuations: Number(e.target.value) })}
                    className="rounded px-3 py-2 text-sm"
                    style={{ background: "var(--color-bg-elevated)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}>
                    {[1,2,3,5,10].map((n) => <option key={n} value={n}>Max {n} retry{n > 1 ? "s" : ""}</option>)}
                  </select>
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded text-sm"
                    style={{ background: "var(--color-bg-elevated)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)" }}>Cancel</button>
                  <button onClick={handleCreate} className="px-4 py-2 rounded text-sm font-semibold"
                    style={{ background: "var(--color-accent)", color: "var(--color-text-inverse)", border: "none", cursor: "pointer" }}
                    id="mission-create-submit">Create Mission</button>
                </div>
              </div>
            </div>
          )}

          {loading ? (
            <div style={{ color: "var(--color-text-muted)" }}>Loading missions…</div>
          ) : missions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16" style={{ color: "var(--color-text-muted)" }}>
              <p className="text-4xl mb-4">🚀</p>
              <p className="text-sm">No missions yet</p>
              <p className="text-xs mt-1 opacity-60">Missions chain skills together into autonomous dispatch loops</p>
            </div>
          ) : (
            <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(400px, 1fr))" }}>
              {missions.map((m) => (
                <MissionCard key={m.id} mission={m} onLaunch={handleLaunch} onPause={handlePause} onDelete={handleDelete} />
              ))}
            </div>
          )}
        </div>
      </div>

      {activeRun && (
        <RunDrawer runId={activeRun.runId} skillName={activeRun.skillName} onClose={() => { setActiveRun(null); loadMissions(); }} />
      )}
    </>
  );
}
