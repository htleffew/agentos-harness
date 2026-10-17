// Undercurrent — builds the compact context the hidden passes read (never the RP preset). Pure logic.

import { clip, truncateBlock, stripReasoning, stripUcBlocks, contentTokens } from './util.js';
import { openItems } from './state.js';

/**
 * Mark *asterisk* segments in the player's message as private thoughts nobody in the story can know.
 * **bold** is left alone.
 */
export function markPrivateThoughts(text) {
    return String(text ?? '').replace(/(^|[^*])\*(?!\*)([^*\n]+?)\*(?!\*)/g, (_, pre, inner) => `${pre}⟦private thought — no character can know this: ${inner.trim()}⟧`);
}

/** Extract the *asterisk* private-thought segments of a player message. */
export function privateThoughts(text) {
    const out = [];
    const re = /(^|[^*])\*(?!\*)([^*\n]+?)\*(?!\*)/g;
    let m;
    while ((m = re.exec(String(text ?? '')))) out.push(m[2].trim());
    return out;
}

/** The player's message with private thoughts removed (what characters can actually perceive). */
export function publicPart(text) {
    return String(text ?? '').replace(/(^|[^*])\*(?!\*)([^*\n]+?)\*(?!\*)/g, '$1').replace(/\s+/g, ' ').trim();
}

export function cleanAssistantText(text) {
    return stripUcBlocks(stripReasoning(String(text ?? '')));
}

export function countUserTurns(chat) {
    return (Array.isArray(chat) ? chat : []).filter(m => m && m.is_user && !m.is_system).length;
}

export function lastUserMessage(chat) {
    const arr = Array.isArray(chat) ? chat : [];
    for (let i = arr.length - 1; i >= 0; i--) {
        const m = arr[i];
        if (m && m.is_user && !m.is_system) return { index: i, mes: String(m.mes ?? '') };
    }
    return null;
}

/** Assistant replies strictly before `beforeIndex`, newest last, at most n. */
export function previousAssistantReplies(chat, beforeIndex, n = 4) {
    const arr = Array.isArray(chat) ? chat : [];
    const out = [];
    for (let i = Math.min(beforeIndex, arr.length) - 1; i >= 0 && out.length < n; i--) {
        const m = arr[i];
        if (m && !m.is_user && !m.is_system && m.mes) out.unshift(cleanAssistantText(m.mes));
    }
    return out;
}

/** The player message that precedes an assistant message. */
export function userMessageBefore(chat, index) {
    const arr = Array.isArray(chat) ? chat : [];
    for (let i = index - 1; i >= 0; i--) {
        const m = arr[i];
        if (m && m.is_user && !m.is_system) return String(m.mes ?? '');
        if (m && !m.is_user && !m.is_system) return '';
    }
    return '';
}

/**
 * Role-tagged transcript of the last messages. Player messages are verbatim except that private thoughts are marked.
 * @param {object[]} chat
 * @param {{userName?:string, charName?:string, max?:number, maxChars?:number, uptoIndex?:number}} opts
 */
export function buildTranscript(chat, opts = {}) {
    const arr = Array.isArray(chat) ? chat : [];
    const upto = Number.isFinite(opts.uptoIndex) ? opts.uptoIndex + 1 : arr.length;
    const max = opts.max ?? 12;
    const maxChars = opts.maxChars ?? 1400;
    const user = opts.userName || '{{user}}';
    const lines = [];
    for (let i = upto - 1; i >= 0 && lines.length < max; i--) {
        const m = arr[i];
        if (!m || m.is_system || !m.mes) continue;
        if (m.is_user) {
            lines.unshift(`[#${i} PLAYER — ${m.name || user}]\n${truncateBlock(markPrivateThoughts(m.mes), maxChars)}`);
        } else {
            lines.unshift(`[#${i} STORY — ${m.name || opts.charName || '{{char}}'}]\n${truncateBlock(cleanAssistantText(m.mes), maxChars)}`);
        }
    }
    return lines.join('\n\n');
}

/** Card budgets and include switches (knobs context.*). */
export const CARD_DEFAULTS = Object.freeze({
    descChars: 2400,
    personalityChars: 700,
    scenarioChars: 700,
    personaChars: 700,
    includeDescription: true,
    includePersonality: true,
    includeScenario: true,
    includePersona: true,
});

/**
 * Character card + player persona block, truncated sensibly.
 * @param {object} card {name, description, personality, scenario, persona}
 * @param {object} [opts] {userName, charName, descChars, personalityChars, scenarioChars, personaChars, include*}
 */
export function buildCardBlock(card = {}, opts = {}) {
    const o = { ...CARD_DEFAULTS, ...Object.fromEntries(Object.entries(opts || {}).filter(([, v]) => v !== undefined)) };
    const name = card.name || o.charName || '{{char}}';
    const user = o.userName || '{{user}}';
    const parts = [`<character name="${name}">`];
    if (card.description && o.includeDescription) parts.push(truncateBlock(card.description, o.descChars));
    if (card.personality && o.includePersonality) parts.push(`Personality: ${truncateBlock(card.personality, o.personalityChars)}`);
    if (card.scenario && o.includeScenario) parts.push(`Scenario: ${truncateBlock(card.scenario, o.scenarioChars)}`);
    parts.push('</character>');
    if (card.persona && o.includePersona) parts.push(`<player name="${user}">\n${truncateBlock(card.persona, o.personaChars)}\n</player>`);
    return parts.join('\n');
}

/** Compact, readable state summary for hidden passes. */
export function summarizeState(state, opts = {}) {
    if (!state) return '(no state yet)';
    const turn = opts.turn ?? state.turn ?? 0;
    const maxFacts = opts.maxFacts ?? 15;
    const maxCharacters = opts.maxCharacters ?? 14;
    const L = [];
    const sc = state.scene || {};
    L.push(`Turn ${turn}. Scene: ${sc.mode || 'conversation'}${sc.place ? ` · ${sc.place}` : ''}${sc.time ? ` · ${sc.time}` : ''}${sc.weather ? ` · ${sc.weather}` : ''}`);
    if (sc.present?.length) L.push(`Present (besides the player): ${sc.present.join(', ')}`);
    const chars = Object.entries(state.characters || {});
    if (chars.length) {
        L.push('Characters:');
        for (const [name, c] of chars.slice(0, maxCharacters)) {
            const bits = [];
            if (c.role) bits.push(c.role);
            if (c.ikigai) bits.push(`ikigai: ${clip(c.ikigai, 80)}`);
            if (c.mood) bits.push(`mood: ${c.mood}`);
            const w = openItems(c.wants, turn).map(x => x.text);
            if (w.length) bits.push(`wants: ${clip(w.join('; '), 160)}`);
            const g = openItems(c.goals, turn).map(x => x.text);
            if (g.length) bits.push(`goals: ${clip(g.join('; '), 140)}`);
            const p = openItems(c.plans, turn).map(x => x.text);
            if (p.length) bits.push(`plans: ${clip(p.join('; '), 160)}`);
            const dk = openItems(c.doesnt_know, turn).map(x => x.text);
            if (dk.length) bits.push(`does NOT know: ${clip(dk.join('; '), 160)}`);
            const se = openItems(c.secrets, turn).map(x => x.text);
            if (se.length) bits.push(`hides: ${clip(se.join('; '), 120)}`);
            const here = sc.present?.some(n => n.toLowerCase() === name.toLowerCase());
            if (!here && c.offscreen) bits.push(`offscreen: ${clip(c.offscreen, 100)}`);
            L.push(`- ${name}${here ? ' (here)' : ''}: ${bits.join(' | ') || '—'}`);
        }
    }
    const facts = openItems(state.facts, turn).slice(-maxFacts);
    if (facts.length) L.push('Established facts:\n' + facts.map(f => `- ${f.text}`).join('\n'));
    const off = openItems(state.threads?.offscreen, turn);
    if (off.length) L.push('Offscreen threads:\n' + off.map(o => `- ${o.who || ''}${o.who ? ': ' : ''}${o.doing || o.text}${o.surfaces_when ? ` (surfaces when ${o.surfaces_when})` : ''}`).join('\n'));
    const arcs = openItems(state.threads?.arcs, turn);
    if (arcs.length) L.push('Arcs:\n' + arcs.map(a => `- ${a.name || a.text}${a.status ? `: ${a.status}` : ''}${a.next ? ` → next: ${a.next}` : ''}`).join('\n'));
    const drv = openItems(state.threads?.driver, turn);
    if (drv.length) L.push('Seeded drivers:\n' + drv.map(d => `- ${d.item || d.text}${d.purpose ? ` (purpose: ${d.purpose})` : ''}${d.planned_outcome ? ` → ${d.planned_outcome}` : ''}`).join('\n'));
    return L.join('\n');
}

/** Score facts by token overlap with recent text plus recency; return the top n texts. */
export function relevantFacts(state, recentText, n = 4, turn = 0) {
    const facts = openItems(state?.facts, turn);
    if (!facts.length) return [];
    const ctx = new Set(contentTokens(recentText));
    const scored = facts.map((f, i) => {
        const t = contentTokens(f.text);
        const overlap = t.filter(x => ctx.has(x)).length / Math.max(1, Math.sqrt(t.length));
        const recency = (i + 1) / facts.length;
        return { f, score: overlap * 2 + recency };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, n).map(x => x.f.text);
}
