// Undercurrent — assembles the single <undercurrent>…</undercurrent> system note from every engine.
// Terse bullet lines, hard word cap, lowest-priority lines dropped first. Pure logic.
//
// Everything is configurable through `config` (knobs inject.*): word cap, wrapper tag, bullet, each section's on/off
// switch, output order and priority, per-section caps and the label wording. Sections:
//   clock (Now: time · place · weather), present (Here:), beat (+ pacing), pacing (only when there is no beat),
//   event, author (/uc-direct note), stall, moves (NPC moves), minds (NPC minds), intimacy, facts, offscreen, avoid,
//   tics (Prose: corrections), goals, sparks (filled by other engines through `extra`).

import { openItems } from './state.js';
import { intimacyLines, attractionLive } from './intimacy.js';
import { relevantFacts } from './context.js';
import { clip, wordCount, findKeyCI, mergeConfig } from './util.js';
import { eventFallbackText, eventKinds } from './events.js';
import { notebookValid } from './director.js';

export const MAX_WORDS = 350;

export const INJECT_SECTIONS = [
    'clock', 'present', 'beat', 'pacing', 'event', 'author', 'stall', 'moves', 'minds', 'intimacy', 'facts', 'offscreen', 'avoid', 'tics', 'goals', 'sparks',
    // native port engines (lines come through `extra`, each with its own priority)
    'scene_intimacy', 'desire', 'psyche', 'reply_shape', 'critic', 'drama',
];

export const INJECT_DEFAULTS = Object.freeze({
    maxWords: MAX_WORDS,
    wrapperTag: 'undercurrent',
    bullet: '- ',
    lineChars: 420,
    order: Object.freeze([...INJECT_SECTIONS]),
    show: Object.freeze(Object.fromEntries(INJECT_SECTIONS.map(s => [s, true]))),
    pri: Object.freeze({
        clock: 100, present: 95, beat: 90, pacing: 60, event: 88, author: 92, stall: 80, moves: 78, minds: 70,
        intimacy: 85, intimacy_attraction: 55, facts: 50, facts_impersonate: 90, offscreen: 30, avoid: 45, tics: 65,
        goals: 75, sparks: 40, scene_intimacy: 60, desire: 55, psyche: 50, reply_shape: 45, critic: 70, drama: 60,
    }),
    maxNpcs: 0, // 0 = every character present
    maxFacts: 4,
    maxFactsImpersonate: 5,
    maxOffscreen: 2,
    maxAvoid: 4,
    maxTics: 4,
    nudgeChars: 240,
    assumeCharPresent: true,
    pacingInBeat: true,
    intimacyWhen: 'auto', // auto (intimate scene or live attraction) | intimate | always | never
    intimacyHistory: true,
    labels: Object.freeze({
        now: 'Now', here: 'Here', beat: 'Beat', pacing: 'Pacing', event: 'Event', author: 'Author\'s note', acts: 'acts',
        facts: 'Facts', offscreen: 'Offscreen', avoid: 'Avoid', prose: 'Prose', intimacy: 'Intimacy',
        wants: 'wants', plan: 'plan', doesnt_know: 'doesn\'t know', surfaces: 'surfaces when',
    }),
    pacingText: Object.freeze({
        linger: 'linger — stay inside this moment',
        advance: 'advance — move the situation forward',
        cut: 'cut — skip dead time to the next meaningful moment',
    }),
    stallText: 'The story has idled: let something new happen (a fact, an arrival, a decision, a change of place or time).',
    // Note style: 'notebook' = the director's first-person backstage notebook (in the narrator persona's voice) plus
    // a few short follow lines; 'terse' = labeled bullets only. Notebook falls back to terse when it is missing.
    style: 'notebook',
    notebookMinWords: 12,
    notebookPri: 90,
    // desire and psyche reach the director (signals) and are voiced inside the notebook itself.
    notebookFollow: Object.freeze(['clock', 'intimacy', 'facts', 'tics', 'goals', 'sparks', 'scene_intimacy', 'reply_shape', 'critic', 'drama']),
    notebookLabels: Object.freeze({
        now: 'Where & when', here: 'In the room', facts: 'Stuff that\'s true, don\'t screw it up', prose: 'Quit doing this',
        intimacy: 'Heat file',
    }),
});

/** Macro names (registered by index.js) and the sections each one carries. */
export const MACRO_SECTIONS = Object.freeze({
    uc_beat: ['notebook', 'beat', 'pacing', 'event', 'author', 'stall', 'moves', 'offscreen', 'avoid'],
    uc_minds: ['minds'],
    uc_intimacy: ['intimacy'],
    uc_facts: ['facts'],
    uc_scene: ['clock', 'present'],
    uc_tics: ['tics'],
    uc_goals: ['goals'],
    uc_sparks: ['sparks'],
});
export const MACRO_NAMES = Object.freeze(['uc_note', ...Object.keys(MACRO_SECTIONS)]);

export function injectConfig(config) {
    return mergeConfig(INJECT_DEFAULTS, config);
}

/** The effective section order: the configured list (unknown ids dropped, duplicates removed) + any missing section. */
export function sectionOrder(order, extraIds = []) {
    const known = [...INJECT_SECTIONS, ...extraIds.filter(id => !INJECT_SECTIONS.includes(id))];
    const list = (Array.isArray(order) ? order : []).map(String).filter((id, i, a) => known.includes(id) && a.indexOf(id) === i);
    for (const id of known) if (!list.includes(id)) list.push(id);
    return list;
}

const TAG_RE = /^[A-Za-z][\w.-]{0,40}$/;

/**
 * @param {object} p
 * @param {object} p.state
 * @param {'full'|'impersonate'} [p.mode]
 * @param {object|null} [p.plan] director plan (null when none)
 * @param {boolean} [p.beatFresh] true when the plan was made for this turn (beat/event/moves only then)
 * @param {{kind:string, also?:string[]}|null} [p.event] due event
 * @param {string[]} [p.ticLines] tic-guard corrections
 * @param {string} [p.nudge] one-shot /uc-direct note
 * @param {number} [p.turn]
 * @param {boolean} [p.intimacyEnabled]
 * @param {string} [p.recentText] for fact relevance
 * @param {boolean} [p.stall]
 * @param {number} [p.maxWords] overrides config.maxWords
 * @param {string} [p.charName] assumed present until the scene records who is here
 * @param {object} [p.extra] extra sections from other engines: { goals: [string|{text,pri}], sparks: [...], <id>: [...] }
 * @param {object} [p.config] see INJECT_DEFAULTS
 * @param {object} [p.eventsConfig] events config (fallback texts)
 * @returns {string} '' when there is nothing to say
 */
export function buildInjection(p) {
    return buildInjectionParts(p).text;
}

/**
 * Same inputs as buildInjection. Returns the note text plus every candidate line by section (before the word cap),
 * which the macros ({{uc_beat}}, {{uc_facts}}, …) are built from.
 * @returns {{text:string, notebook:boolean, lines:{text:string, pri:number, section:string}[], kept:object[]}}
 */
export function buildInjectionParts(p) {
    const cfg = injectConfig(p.config);
    const plan0 = p.plan || null;
    const useNotebook = cfg.style === 'notebook' && (p.mode || 'full') !== 'impersonate' && !!p.beatFresh
        && notebookValid(plan0?.notebook, cfg.notebookMinWords);
    const L = useNotebook ? { ...cfg.labels, ...cfg.notebookLabels } : cfg.labels;
    const state = p.state || {};
    const turn = p.turn ?? state.turn ?? 0;
    const mode = p.mode || 'full';
    const full = mode !== 'impersonate';
    const maxWords = p.maxWords ?? cfg.maxWords;
    const plan = p.plan || null;
    const fresh = !!p.beatFresh;
    const scene = state.scene || {};
    const recorded = (scene.present || []).filter(Boolean);
    // Until the scribe has recorded who is here, assume {{char}} is.
    const present = recorded.length ? recorded : (p.charName && cfg.assumeCharPresent ? [p.charName] : []);
    const on = id => cfg.show?.[id] !== false;
    const pri = (id, def) => (Number.isFinite(cfg.pri?.[id]) ? cfg.pri[id] : def);
    /** @type {{text:string, pri:number, section:string}[]} higher pri = kept longer */
    const lines = [];
    const add = (section, text, priority) => { if (text && on(section)) lines.push({ text: clip(text, cfg.lineChars), pri: priority, section }); };

    // World facts: clock/place/weather and who is here.
    const now = [scene.time, scene.place, scene.weather].filter(Boolean).join(' · ');
    if (now) add('clock', `${L.now}: ${now}`, pri('clock', 100));
    if (recorded.length) add('present', `${L.here}: ${recorded.join(', ')}`, pri('present', 95));

    if (full) {
        const pacingText = plan?.pacing ? (cfg.pacingText[plan.pacing] || plan.pacing) : '';
        if (fresh && plan?.beat && on('beat')) add('beat', `${L.beat}: ${plan.beat}${pacingText && cfg.pacingInBeat ? ` (pacing: ${pacingText})` : ''}`, pri('beat', 90));
        else if (plan?.pacing && fresh) add('pacing', `${L.pacing}: ${cfg.pacingText[plan.pacing]}`, pri('pacing', 60));
        if (p.event) {
            const kinds = eventKinds(p.event);
            const content = (fresh && plan?.event) || kinds.map(k => eventFallbackText(k, p.eventsConfig)).filter(Boolean).join(' ');
            add('event', `${L.event} (${kinds.join('+')}): ${content}`, pri('event', 88));
        }
        if (p.nudge) add('author', `${L.author}: ${clip(p.nudge, cfg.nudgeChars)}`, pri('author', 92));
        if (p.stall && !(fresh && plan?.beat && on('beat'))) add('stall', cfg.stallText, pri('stall', 80));
        if (fresh) {
            for (const m of (plan?.npc_moves || []).filter(m => isPresent(m.name, present))) add('moves', `${m.name} ${L.acts}: ${m.move}`, pri('moves', 78));
        }
    }

    // NPC minds — characters present only.
    if (full && on('minds')) {
        const social = new Map((plan?.social || []).map(s => [s.name.toLowerCase(), s]));
        const listed = cfg.maxNpcs > 0 ? present.slice(0, cfg.maxNpcs) : present;
        for (const name of listed) {
            const key = findKeyCI(state.characters, name);
            const c = key ? state.characters[key] : null;
            const s = social.get(name.toLowerCase());
            const bits = [];
            const mood = s?.mood || c?.mood;
            if (mood) bits.push(mood);
            const want = s?.want || openItems(c?.wants, turn).slice(-1)[0]?.text;
            if (want) bits.push(`${L.wants} ${want}`);
            const plan_ = s?.plan || openItems(c?.plans, turn).slice(-1)[0]?.text;
            if (plan_) bits.push(`${L.plan}: ${plan_}`);
            const gap = s?.knows_missing || openItems(c?.doesnt_know, turn).slice(-1)[0]?.text;
            if (gap) bits.push(`${L.doesnt_know}: ${gap}`);
            if (bits.length) add('minds', `${key || name}: ${bits.join('; ')}`, pri('minds', 70));
        }
    }

    // Intimacy — by default only when the scene is intimate or attraction is live.
    if (full && p.intimacyEnabled !== false && on('intimacy') && cfg.intimacyWhen !== 'never') {
        for (const name of present) {
            const key = findKeyCI(state.characters, name);
            const c = key ? state.characters[key] : null;
            if (!c) continue;
            const intimate = scene.mode === 'intimate';
            const show = cfg.intimacyWhen === 'always' || intimate || (cfg.intimacyWhen === 'auto' && attractionLive(c.intimacy, turn));
            if (!show) continue;
            for (const l of intimacyLines(key, c.intimacy, { includeHistory: intimate && cfg.intimacyHistory, label: L.intimacy })) {
                add('intimacy', l, intimate ? pri('intimacy', 85) : pri('intimacy_attraction', 55));
            }
        }
    }

    // Memory — the most relevant open facts.
    if (on('facts')) {
        const n = full ? cfg.maxFacts : cfg.maxFactsImpersonate;
        const facts = n > 0 ? relevantFacts(state, `${p.recentText || ''} ${present.join(' ')} ${scene.place || ''}`, n, turn) : [];
        if (facts.length) add('facts', `${L.facts}: ${facts.join('; ')}`, full ? pri('facts', 50) : pri('facts_impersonate', 90));
    }

    if (full) {
        // Off-screen threads that are due to surface (director's list for this turn).
        if (fresh) {
            const off = (plan?.offscreen || []).slice(0, cfg.maxOffscreen).map(o => `${o.who} — ${o.doing}${o.surfaces_when ? ` (${L.surfaces} ${o.surfaces_when})` : ''}`);
            if (off.length) add('offscreen', `${L.offscreen}: ${off.join('; ')}`, pri('offscreen', 30));
        }
        if (plan?.avoid?.length && cfg.maxAvoid > 0) add('avoid', `${L.avoid}: ${plan.avoid.slice(0, cfg.maxAvoid).join('; ')}`, pri('avoid', 45));
        for (const t of (p.ticLines || []).slice(0, cfg.maxTics)) add('tics', `${L.prose}: ${t}`, pri('tics', 65));
        // Sections supplied by other engines (goals, sparks, …): strings or {text, pri}.
        for (const [id, items] of Object.entries(p.extra && typeof p.extra === 'object' ? p.extra : {})) {
            for (const it of Array.isArray(items) ? items : [items]) {
                const text = typeof it === 'string' ? it : it?.text;
                const prio = Number.isFinite(it?.pri) ? it.pri : pri(id, 50);
                if (text) add(id, String(text), prio);
            }
        }
    }

    const all = [...lines];
    let candidates = lines;
    if (useNotebook) {
        // The notebook replaces the director's direction lines; only the follow sections are added after it.
        const follow = new Set(Array.isArray(cfg.notebookFollow) ? cfg.notebookFollow : []);
        candidates = [{ text: plan0.notebook, pri: cfg.notebookPri, section: 'notebook' }, ...lines.filter(l => follow.has(l.section))];
        all.unshift(candidates[0]);
    }
    if (!candidates.length) return { text: '', notebook: useNotebook, lines: all, kept: [] };
    // Output order follows the section order list (stable within a section); the notebook always comes first.
    const order = sectionOrder(cfg.order, Object.keys(p.extra || {}));
    const rank = id => { if (id === 'notebook') return -1; const i = order.indexOf(id); return i === -1 ? order.length : i; };
    const kept = candidates.map((l, i) => ({ ...l, i })).sort((a, b) => rank(a.section) - rank(b.section) || a.i - b.i);
    // Enforce the word cap: drop the lowest-priority lines, then clip the first kept line if still over.
    const tag = TAG_RE.test(String(cfg.wrapperTag || '')) ? String(cfg.wrapperTag) : (cfg.wrapperTag === '' ? '' : 'undercurrent');
    const total = () => kept.reduce((n, l) => n + wordCount(l.text) + 1, 2);
    // The notebook is never dropped (only clipped below); every other line competes by priority.
    const droppable = () => kept.map((l, i) => (l.section === 'notebook' ? -1 : i)).filter(i => i >= 0);
    while (kept.length > 1 && total() > maxWords && droppable().length) {
        let minIdx = droppable()[0];
        for (const i of droppable()) if (kept[i].pri <= kept[minIdx].pri) minIdx = i;
        kept.splice(minIdx, 1);
    }
    if (total() > maxWords) {
        const words = kept[0].text.split(/\s+/).slice(0, Math.max(5, maxWords - 4));
        kept[0] = { ...kept[0], text: words.join(' ') + '…' };
    }
    const body = kept.map(l => (l.section === 'notebook' ? `${l.text}\n` : `${cfg.bullet}${l.text}`)).join('\n').replace(/\n+$/, '');
    return { text: tag ? `<${tag}>\n${body}\n</${tag}>` : body, notebook: useNotebook, lines: all, kept };
}

/**
 * Macro values from injection parts: {{uc_note}} is the whole note; the others carry their sections' lines (one per
 * line, no wrapper, not word-capped). In notebook style {{uc_beat}} carries the notebook instead of the terse lines.
 * @param {{text:string, notebook:boolean, lines:object[]}} parts
 * @param {{bullet?:string}} [opts]
 */
export function macroValues(parts, { bullet = INJECT_DEFAULTS.bullet } = {}) {
    const out = { uc_note: parts?.text || '' };
    const lines = Array.isArray(parts?.lines) ? parts.lines : [];
    for (const [name, sections] of Object.entries(MACRO_SECTIONS)) {
        let pick = lines.filter(l => sections.includes(l.section));
        if (name === 'uc_beat' && parts?.notebook) pick = pick.filter(l => l.section === 'notebook');
        out[name] = pick.map(l => (l.section === 'notebook' ? l.text : `${bullet}${l.text}`)).join('\n');
    }
    return out;
}

function isPresent(name, present) {
    const n = String(name || '').toLowerCase();
    return !!n && present.some(x => x.toLowerCase() === n);
}
