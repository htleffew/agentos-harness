"use client";

import { SkillButton } from "./SkillButton";

interface Skill {
  skillName: string;
  displayLabel: string;
  description: string;
  domain: string;
  invocableOnly: boolean;
  sortScore: number;
}

interface DomainCardProps {
  domain: string;
  domainDisplay: string;
  skills: Skill[];
  onRun: (runId: string, skillName: string) => void;
}

const DOMAIN_COLOURS: Record<string, string> = {
  daily: "var(--color-daily)",
  productivity: "var(--color-productivity)",
  research: "var(--color-research)",
  content: "var(--color-content)",
  community: "var(--color-community)",
  ops: "var(--color-ops)",
  custom: "var(--color-custom)",
};

export function DomainCard({ domain, domainDisplay, skills, onRun }: DomainCardProps) {
  const colour = DOMAIN_COLOURS[domain] ?? "var(--color-custom)";

  return (
    <section className="animate-fade-in">
      {/* Domain header */}
      <div className="flex items-center gap-2 mb-3">
        <span
          className="block w-2 h-2 rounded-full flex-shrink-0"
          style={{ background: colour }}
        />
        <h2
          className="text-xs font-bold tracking-widest"
          style={{ color: colour }}
        >
          {domainDisplay.toUpperCase()}
        </h2>
        <span
          className="text-xs ml-1"
          style={{ color: "var(--color-text-muted)" }}
        >
          {skills.length}
        </span>
      </div>

      {/* Skills grid */}
      <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
        {skills.map((skill) => (
          <SkillButton
            key={skill.skillName}
            skillName={skill.skillName}
            displayLabel={skill.displayLabel}
            description={skill.description}
            invocableOnly={skill.invocableOnly}
            onRun={(runId) => onRun(runId, skill.skillName)}
          />
        ))}
      </div>
    </section>
  );
}
