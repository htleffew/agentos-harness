// Undercurrent — assembles the single <undercurrent>…</undercurrent> system note from every engine.
// Terse bullet lines, hard word cap, lowest-priority lines dropped first. Pure logic.

import { openItems } from './state.js';
import { intimacyLines, attractionLive } from './intimacy.js';
import { relevantFacts } from './context.js';
import { clip, wordCount, findKeyCI } from './util.js';
import { eventFallbackText } from './events.js';

export const MAX_WORDS = 350;

const PACING_TEXT = {
    linger: 'linger — stay inside this moment',
    advance: 'advance — move the situation forward',
    cut: 'cut — skip dead time to the next meaningful moment',
};

/**
 * @param {object} p
 * @param {object} p.state
 * @param {'full'|'impersonate'} [p.mode]
 * @param {object|null} [p.plan] director plan (null when none)
 * @param {boolean} [p.beatFresh] true when the plan was made for this turn (beat/event/moves only then)
 * @param {{kind:string}|null} [p.event] due event
 * @param {string[]} [p.ticLines] tic-guard corrections
 * @param {string} [p.nudge] one-shot /uc-direct note
 * @param {number} [p.turn]
 * @param {boolean} [p.intimacyEnabled]
 * @param {string} [p.recentText] for fact relevance
 * @param {boolean} [p.stall]
 * @param {number} [p.maxWords]
 * @param {string} [p.charName] assumed present until the scene records who is here
 * @returns {string} '' when there is nothing to say
 */
export function buildInjection(p) {
    const state = p.state || {};
    const turn = p.turn ?? state.turn ?? 0;
    const mode = p.mode || 'full';
    const maxWords = p.maxWords ?? MAX_WORDS;
    const plan = p.plan || null;
    const fresh = !!p.beatFresh;
    const scene = state.scene || {};
    const recorded = (scene.present || []).filter(Boolean);
    // Until the scribe has recorded who is here, assume {{char}} is.
    const present = recorded.length ? recorded : (p.charName ? [p.charName] : []);
    /** @type {{text:string, pri:number}[]} higher pri = kept longer */
    const lines = [];
    const add = (text, pri) => { if (text) lines.push({ text: clip(text, 420), pri }); };

    // World facts: clock/place/weather and who is here — always first.
    const now = [scene.time, scene.place, scene.weather].filter(Boolean).join(' · ');
    if (now) add(`Now: ${now}`, 100);
    if (recorded.length) add(`Here: ${recorded.join(', ')}`, 95);

    if (mode !== 'impersonate') {
        if (fresh && plan?.beat) add(`Beat: ${plan.beat}${plan.pacing ? ` (pacing: ${PACING_TEXT[plan.pacing] || plan.pacing})` : ''}`, 90);
        else if (plan?.pacing && fresh) add(`Pacing: ${PACING_TEXT[plan.pacing]}`, 60);
        if (p.event) {
            const content = (fresh && plan?.event) || eventFallbackText(p.event.kind);
            add(`Event (${p.event.kind}): ${content}`, 88);
        }
        if (p.nudge) add(`Author's note: ${clip(p.nudge, 240)}`, 92);
        if (p.stall && !(fresh && plan?.beat)) add('The story has idled: let something new happen (a fact, an arrival, a decision, a change of place or time).', 80);
        if (fresh) {
            for (const m of (plan?.npc_moves || []).filter(m => isPresent(m.name, present))) add(`${m.name} acts: ${m.move}`, 78);
        }
    }

    // NPC minds — characters present only.
    if (mode !== 'impersonate') {
        const social = new Map((plan?.social || []).map(s => [s.name.toLowerCase(), s]));
        for (const name of present) {
            const key = findKeyCI(state.characters, name);
            const c = key ? state.characters[key] : null;
            const s = social.get(name.toLowerCase());
            const bits = [];
            const mood = s?.mood || c?.mood;
            if (mood) bits.push(mood);
            const want = s?.want || openItems(c?.wants, turn).slice(-1)[0]?.text;
            if (want) bits.push(`wants ${want}`);
            const plan_ = s?.plan || openItems(c?.plans, turn).slice(-1)[0]?.text;
            if (plan_) bits.push(`plan: ${plan_}`);
            const gap = s?.knows_missing || openItems(c?.doesnt_know, turn).slice(-1)[0]?.text;
            if (gap) bits.push(`doesn't know: ${gap}`);
            if (bits.length) add(`${key || name}: ${bits.join('; ')}`, 70);
        }
    }

    // Intimacy — only when the scene is intimate or attraction is live.
    if (mode !== 'impersonate' && p.intimacyEnabled !== false) {
        for (const name of present) {
            const key = findKeyCI(state.characters, name);
            const c = key ? state.characters[key] : null;
            if (!c) continue;
            if (scene.mode === 'intimate' || attractionLive(c.intimacy, turn)) {
                for (const l of intimacyLines(key, c.intimacy, { includeHistory: scene.mode === 'intimate' })) add(l, scene.mode === 'intimate' ? 85 : 55);
            }
        }
    }

    // Memory — the most relevant open facts.
    const facts = relevantFacts(state, `${p.recentText || ''} ${present.join(' ')} ${scene.place || ''}`, mode === 'impersonate' ? 5 : 4, turn);
    if (facts.length) add(`Facts: ${facts.join('; ')}`, mode === 'impersonate' ? 90 : 50);

    if (mode !== 'impersonate') {
        // Off-screen threads that are due to surface (director's list for this turn).
        if (fresh) {
            const off = (plan?.offscreen || []).slice(0, 2).map(o => `${o.who} — ${o.doing}${o.surfaces_when ? ` (surfaces when ${o.surfaces_when})` : ''}`);
            if (off.length) add(`Offscreen: ${off.join('; ')}`, 30);
        }
        if (plan?.avoid?.length) add(`Avoid: ${plan.avoid.slice(0, 4).join('; ')}`, 45);
        for (const t of (p.ticLines || []).slice(0, 4)) add(`Prose: ${t}`, 65);
    }

    if (!lines.length) return '';
    // Enforce the word cap: drop the lowest-priority lines, then clip the last kept line if still over.
    const kept = [...lines];
    const total = () => kept.reduce((n, l) => n + wordCount(l.text) + 1, 2);
    while (kept.length > 1 && total() > maxWords) {
        let minIdx = 0;
        kept.forEach((l, i) => { if (l.pri <= kept[minIdx].pri) minIdx = i; });
        kept.splice(minIdx, 1);
    }
    if (total() > maxWords) {
        const words = kept[0].text.split(/\s+/).slice(0, Math.max(5, maxWords - 4));
        kept[0] = { ...kept[0], text: words.join(' ') + '…' };
    }
    return `<undercurrent>\n${kept.map(l => `- ${l.text}`).join('\n')}\n</undercurrent>`;
}

function isPresent(name, present) {
    const n = String(name || '').toLowerCase();
    return !!n && present.some(x => x.toLowerCase() === n);
}
