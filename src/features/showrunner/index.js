// Undercurrent 2 · FEATURES — showrunner (off by default): one optional background job after a reply writes a short
// directive for the NEXT turn, in the narrator persona's voice.
//
// onReply returns a job spec (content.jobs.showrunner) with a compact context: the card, the player persona, a summary
// of the derived state, and the last N messages cleaned of <UC> and <think> (the player's *private thoughts* are marked
// as unknown to every character). Output is strict: a DIRECTIVE line (≤ 60 words asked, cut at 70) and an AVOID line;
// anything else, or anything scripting {{user}} or asking for trackers, is dropped. The stored line stays ≤ 90 words.
// apply stores the directive keyed by the uc_id AND text hash of the reply it followed. turnLines emits it only while
// that reply (that exact swipe) is the reply the player is answering, i.e. the latest AI message before the newest
// player message. Effects: used for exactly one turn; a swipe of that reply (new text) discards it; swiping back
// restores it; regenerating the next reply re-uses it (same anchor), so swipes of the next reply stay consistent.

import { str, clip, clipWords, stripThink, hashText, isPlainObject, fillProvided, usesToken } from '../common/text.js';
import { anchor, cleanOf, messages, userName, charName } from '../common/chat.js';
import { optBool, optNum, jobPrompt, activePersona, sget, sset } from '../common/settings.js';
import { sceneOf, trackerOf, characters, mindOf, presentNames, threadsOf, stateOf } from '../common/state.js';
import { unsafeReason } from '../common/safety.js';

export const DEFAULTS = Object.freeze({
    'showrunner.enabled': false,
    'showrunner.every': 1,
    'showrunner.context_messages': 12,
});

export const SCHEMA = [
    { key: 'showrunner.enabled', tab: 'director', section: 'Showrunner', type: 'toggle', default: false, label: 'Showrunner (background job)',
        help: 'After each reply, one short background request plans the next beat in the narrator\'s voice. Never delays a reply; discarded when you swipe.', scope: 'story' },
    { key: 'showrunner.every', tab: 'director', section: 'Showrunner', type: 'slider', default: 1, min: 1, max: 10, step: 1, advanced: true, label: 'Showrunner every N replies',
        help: '1 = after every reply.', scope: 'setup' },
    { key: 'showrunner.context_messages', tab: 'director', section: 'Showrunner', type: 'slider', default: 12, min: 4, max: 40, step: 2, advanced: true, label: 'Showrunner reads (messages)',
        help: 'How many recent messages the showrunner sees.', scope: 'setup' },
];

const SYSTEM = [
    'You are the hidden showrunner of a long interactive story. You do not write the story. You read where it stands and give the writer ONE directive for the next reply. The player never sees it.',
    '{{uc.persona_taste}}',
    'Never script {{user}}: no words, actions, choices, feelings or thoughts for {{user}}, not even as a prediction; {{user}}\'s *private thoughts* are unknown to every character. Characters act only on what they know. Prefer consequences of what already happened; if recent replies loop, change something real. One beat, concrete and stageable. No menus, no questions for the player, no meters.',
    'Output exactly these two lines and nothing else:',
    'DIRECTIVE: <one to three sentences, at most 60 words>',
    'AVOID: <at most 15 words: what the next reply must not repeat, or "nothing">',
].join('\n');
const USER = '<card>\n{card}\n</card>\n<player_persona>\n{persona}\n</player_persona>\n<state>\n{state}\n</state>\n<recent>\n{recent}\n</recent>\nWrite the DIRECTIVE and AVOID lines now.';
const MAX_DIRECTIVE = 70;
const MAX_AVOID = 18;

function cardBlock(ctx) {
    const c = ctx?.card || {};
    return [
        c.name ? `Name: ${str(c.name)}` : '',
        c.description ? clip(c.description, 1800) : '',
        c.personality ? `Personality: ${clip(c.personality, 600)}` : '',
        c.scenario ? `Scenario: ${clip(c.scenario, 600)}` : '',
    ].filter(Boolean).join('\n') || '(no card)';
}

function personaBlock(ctx) {
    const p = ctx?.persona || {};
    return [p.name ? `Name: ${str(p.name)}` : '', clip(str(p.description), 800)].filter(Boolean).join('\n') || '(no description)';
}

/** Compact text summary of the derived state (scene, tracker, present minds, threads, recent facts). */
export function stateSummary(ctx) {
    const sc = sceneOf(ctx);
    const tr = trackerOf(ctx);
    const lines = [];
    const scene = [sc.time && `time: ${sc.time}`, sc.place && `place: ${sc.place}`, sc.weather && `light: ${sc.weather}`, sc.room && `room: ${sc.room}`].filter(Boolean);
    if (scene.length) lines.push(`Scene — ${scene.join(' | ')}`);
    const present = presentNames(ctx);
    if (present.length) lines.push(`Present: ${present.join(', ')}`);
    const track = [tr.arc && `arc: ${tr.arc}`, tr.phase && `phase: ${tr.phase}`, tr.scene && `scene: ${tr.scene}`, tr.next_beat && `next beat: ${tr.next_beat}`, tr.hidden && `hidden: ${tr.hidden}`].filter(Boolean);
    if (track.length) lines.push(`Tracker — ${track.join(' | ')}`);
    const all = characters(ctx);
    for (const n of present) {
        const key = Object.keys(all).find(k => k.toLowerCase() === n.toLowerCase());
        if (!key) continue;
        const m = mindOf(all[key]);
        const bits = [m.mood && `mood: ${m.mood}`, m.wants && `wants: ${m.wants}`, m.plan && `plan: ${m.plan}`, m.unknown && `doesn't know: ${m.unknown}`, m.secret && `secret: ${m.secret}`].filter(Boolean);
        if (bits.length) lines.push(`${key} — ${clip(bits.join('; '), 260)}`);
    }
    const th = threadsOf(ctx);
    for (const o of th.offscreen.slice(0, 3)) lines.push(`Off-screen: ${o.name ? `${o.name} — ` : ''}${clip(o.text, 120)}`);
    for (const t of th.timers.slice(0, 3)) lines.push(`Timer: ${clip(t.text, 120)}${t.left !== null ? ` (${t.left} turns left)` : ''}`);
    for (const p of th.planted.slice(-3)) lines.push(`Planted: ${clip(p, 120)}`);
    const facts = Array.isArray(stateOf(ctx).facts) ? stateOf(ctx).facts : [];
    for (const f of facts.slice(-6)) lines.push(`Fact: ${clip(isPlainObject(f) ? str(f.text) : str(f), 140)}`);
    return lines.join('\n') || '(nothing recorded yet)';
}

function recentBlock(ctx, n) {
    const list = messages(ctx).slice(-n);
    const u = userName(ctx) || '{{user}}';
    const c = charName(ctx) || '{{char}}';
    return list.map((m) => {
        if (m.isUser) {
            // Private thoughts are marked so the showrunner never treats them as known to anyone.
            const marked = str(m.mes).replace(/(^|[^*])\*(?!\*)([^*\n]+?)\*(?!\*)/g, (_, pre, inner) => `${pre}[private thought, unknown to every character: ${inner.trim()}]`);
            return `${m.name || u}: ${clip(marked, 1500)}`;
        }
        return `${m.name || c}: ${clip(cleanOf(m), 2500)}`;
    }).join('\n\n');
}

export function buildShowrunner(ctx) {
    const p = jobPrompt(ctx, 'showrunner');
    const persona = activePersona(ctx);
    const tokens = {
        card: cardBlock(ctx), persona: personaBlock(ctx), state: stateSummary(ctx),
        recent: recentBlock(ctx, Math.round(optNum(ctx, 'showrunner.context_messages', 12, 4, 40))),
        persona_name: str(persona?.name), persona_taste: str(persona?.taste),
    };
    let user = p.user || USER;
    for (const k of ['state', 'recent']) if (!usesToken(user, k)) user += `\n<${k}>\n{${k}}\n</${k}>`;
    return { systemPrompt: fillProvided(p.system || SYSTEM, tokens), prompt: fillProvided(user, tokens), responseLength: 400 };
}

/**
 * Strict parse (content.jobs.showrunner._output): exactly a "DIRECTIVE: …" line and an optional "AVOID: …" line,
 * nothing else (reasoning and code fences are removed first). The directive may not script {{user}} or ask for
 * trackers. Returns {text, directive, avoid} with text = "<directive> Avoid: <avoid>." or null.
 */
export function parseShowrunner(text, { userName: uname = '' } = {}) {
    const s = stripThink(text).replace(/```[a-z]*\n?/gi, '').trim();
    if (!s) return null;
    let directive = '';
    let avoid = '';
    for (const raw of s.split('\n')) {
        const line = raw.replace(/^[\s>*#-]+/, '').replace(/\*\*/g, '').trim();
        if (!line) continue;
        const d = line.match(/^directive\s*:\s*(.+)$/i);
        const a = line.match(/^avoid\s*:\s*(.*)$/i);
        if (d && !directive) directive = d[1].trim();
        else if (a && !avoid) avoid = a[1].trim();
        else return null;
    }
    directive = directive.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    avoid = avoid.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!directive || directive.split(' ').length < 4 || directive.split(' ').length > MAX_DIRECTIVE * 2) return null;
    if (unsafeReason(directive, { userName: uname }) || (avoid && unsafeReason(avoid, { userName: uname }))) return null;
    directive = clipWords(directive, MAX_DIRECTIVE);
    if (/^(?:nothing|none|n\/a|-)\.?$/i.test(avoid)) avoid = '';
    avoid = clipWords(avoid, MAX_AVOID);
    const out = avoid ? `${directive.replace(/\s*$/, '')} Avoid: ${avoid.replace(/[.\s]+$/, '')}.` : directive;
    return { text: out, directive, avoid };
}

/** Store a directive for reply {uid, hash}. */
export function applyShowrunner(result, store, meta) {
    if (!result?.text || !meta?.uid || !store?.get) return false;
    const cur = isPlainObject(store.get('directives')) ? store.get('directives') : {};
    const key = `${meta.uid}#${meta.hash}`;
    const entry = { text: result.text, at: Date.now(), ...(meta.manual ? { manual: true } : {}) };
    const entries = Object.entries({ ...cur, [key]: entry }).slice(-12);
    store.set('directives', Object.fromEntries(entries));
    return true;
}

/** The directive for this turn, or ''. `manualOnly`: only a directive from a manual run (showrunner switched off). */
export function directiveFor(ctx, { manualOnly = false } = {}) {
    const a = anchor(ctx);
    if (!a.reply || !a.user || !a.reply.uid) return '';
    const all = sget(ctx, 'directives', {});
    const hit = isPlainObject(all) ? all[`${a.reply.uid}#${hashText(a.reply.mes)}`] : null;
    if (manualOnly && !hit?.manual) return '';
    return hit && str(hit.text) ? str(hit.text) : '';
}

function replyMeta(ctx) {
    const list = messages(ctx);
    const last = list[list.length - 1];
    if (!last || last.isUser || !last.uid) return null;
    return { uid: last.uid, hash: hashText(last.mes), aiCount: list.filter(m => !m.isUser).length };
}

export const jobs = {
    showrunner: {
        build(ctx) {
            const meta = replyMeta(ctx);
            if (meta) sset(ctx, 'pending', meta);
            return buildShowrunner(ctx);
        },
        parse: parseShowrunner,
        apply(result, store, spec) { applyShowrunner(result, store, spec?.meta || store?.get?.('pending')); },
    },
};

export default {
    id: 'showrunner',
    settingsKeys: Object.keys(DEFAULTS),
    jobs,
    turnLines(ctx) {
        // Switched off: only a directive the player asked for with a manual run is used.
        const text = directiveFor(ctx, { manualOnly: !optBool(ctx, 'showrunner.enabled', false) });
        return text ? [{ slot: 'uc_directive', text, priority: 86, source: 'showrunner' }] : [];
    },
    onReply(ctx) {
        // A manual run (Advanced tab "run now": CORE sets ctx.manualJob) skips the on/off switch and the every-N gate.
        const manual = ctx?.manualJob === 'showrunner';
        if (!manual && !optBool(ctx, 'showrunner.enabled', false)) return [];
        const meta = replyMeta(ctx);
        if (!meta) return [];
        const every = Math.round(optNum(ctx, 'showrunner.every', 1, 1, 10));
        if (!manual && meta.aiCount % every !== 0) return [];
        if (manual) meta.manual = true;
        const uname = userName(ctx);
        return [{
            kind: 'showrunner', provider: 'showrunner', dedupeKey: `showrunner:${meta.uid}#${meta.hash}`, meta,
            buildRequest: () => buildShowrunner(ctx),
            parse: text => parseShowrunner(text, { userName: uname }),
            apply: (result, store) => applyShowrunner(result, store || ctx.store, meta),
        }];
    },
};

