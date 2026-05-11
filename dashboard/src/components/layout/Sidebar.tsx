"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { RecentRuns } from "@/components/sidebar/RecentRuns";


const NAV = [
  { href: "/skills",     label: "SKILLS",     icon: "⚡" },
  { href: "/kanban",     label: "KANBAN",     icon: "📋" },
  { href: "/matrix",     label: "MATRIX",     icon: "⊞" },
  { href: "/brain-dump", label: "BRAIN DUMP", icon: "🧠" },
  { href: "/missions",   label: "MISSIONS",   icon: "🚀" },
  { href: "/ops",        label: "OPS",        icon: "⚙" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="shell-sidebar flex flex-col h-full" style={{ background: "var(--color-bg-surface)" }}>
      {/* Nav links */}
      <nav className="flex-1 p-3 space-y-0.5">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors"
              style={{
                color: active ? "var(--color-accent)" : "var(--color-text-secondary)",
                background: active ? "var(--color-accent-dim)" : "transparent",
                textDecoration: "none",
              }}
            >
              <span style={{ fontSize: "0.9rem", lineHeight: 1 }}>{item.icon}</span>
              <span style={{ letterSpacing: "0.04em", fontSize: "0.75rem" }}>{item.label}</span>
              {active && (
                <span
                  className="ml-auto"
                  style={{
                    width: 4,
                    height: 4,
                    borderRadius: "50%",
                    background: "var(--color-accent)",
                    display: "inline-block",
                  }}
                />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Recent runs */}
      <RecentRuns />

      {/* HarnessPulse */}
      <HarnessPulse />
    </aside>
  );
}

function HarnessPulse() {
  const [checks, setChecks] = useState<{ label: string; status: "ok" | "warn" | "fail" | "unknown" }[]>([
    { label: "Wiki", status: "unknown" },
    { label: "Skills", status: "unknown" },
    { label: "Hooks", status: "unknown" },
    { label: "Dashboard", status: "unknown" },
    { label: "Quality", status: "unknown" },
  ]);
  const [lastRun, setLastRun] = useState<string | null>(null);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/lint");
        if (!res.ok) return;
        const data = await res.json();
        if (!Array.isArray(data.checks)) return;

        setChecks(
          data.checks.map((c: { check: string; status: string }) => ({
            label: c.check.replace(" Config", "").replace("Engineering Quality", "Quality").replace("Hook Registration", "Hooks"),
            status: c.status === "pass" ? "ok" : c.status === "fail" ? "fail" : c.status === "warn" ? "warn" : "unknown",
          }))
        );
        setLastRun(data.runAt ?? null);
      } catch { /* silent */ }
    };

    poll();
    const id = setInterval(poll, 60_000); // refresh every 60s
    return () => clearInterval(id);
  }, []);

  return (
    <div className="p-3 border-t" style={{ borderColor: "var(--color-border)" }}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold tracking-widest" style={{ color: "var(--color-text-muted)" }}>
          HARNESS PULSE
        </p>
        {lastRun && (
          <span style={{ fontSize: "0.6rem", color: "var(--color-text-muted)" }}>
            {new Date(lastRun).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>
      <div className="space-y-1">
        {checks.map((c) => (
          <div key={c.label} className="flex items-center gap-2">
            <span className={`harness-pulse-dot ${c.status}`} />
            <span style={{ color: "var(--color-text-secondary)", fontSize: "0.7rem" }}>
              {c.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
