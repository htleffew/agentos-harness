// Undercurrent 2 · FEATURES — tolerant readers for CORE's derived State (BUILD_SPEC §3.3) and a scene classifier.
// The derived state is built by CORE from the <UC> envelopes; field spellings may vary slightly ("doesn't know" vs
// "doesnt_know", items as strings or {text, quote}), so every reader here accepts the reasonable variants and never throws.

import { str, isPlainObject, normText, cueHits, publicPart, hashText } from './text.js';
import { INTIMATE_CUES, ATTRACTION_CUES, GRIEF_CUES, ARGUMENT_CUES, ACTION_CUES } from './lexicon.js';
import { anchor, cleanOf, isUser, charName } from './chat.js';

export function stateOf(ctx) {
    return isPlainObject(ctx?.state) ? ctx.state : {};
}

export function sceneOf(ctx) {
    const s = stateOf(ctx).scene;
    if (!isPlainObject(s)) return { time: '', place: '', weather: '', present: [], room: '' };
    return {
        time: str(s.time),
        place: str(s.place),
        weather: str(s.weather ?? s.light ?? s['weather/light'] ?? s.weather_light),
        present: listOf(s.present),
        room: str(s.room ?? s.atmosphere),
    };
}

export function trackerOf(ctx) {
    const t = stateOf(ctx).tracker;
    if (!isPlainObject(t)) return { arc: '', phase: '', scene: '', next_beat: '', hidden: '' };
    return {
        arc: str(t.arc), phase: str(t.phase).toLowerCase(), scene: str(t.scene).toLowerCase(),
        next_beat: str(t.next_beat ?? t.nextBeat ?? t['next beat']), hidden: str(t.hidden),
    };
}

/** A list from an array or a comma-separated string, trimmed, without blanks. */
export function listOf(v) {
    const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\s*,\s*/) : [];
    return arr.map(x => (isPlainObject(x) ? str(x.name ?? x.text) : str(x)).trim()).filter(Boolean);
}

export function characters(ctx) {
    const c = stateOf(ctx).characters;
    return isPlainObject(c) ? c : {};
}

/** Case-insensitive character lookup → {name, c} or null. */
export function findCharacter(ctx, name) {
    const n = str(name).trim().toLowerCase();
    if (!n) return null;
    const all = characters(ctx);
    for (const k of Object.keys(all)) if (k.toLowerCase() === n) return { name: k, c: isPlainObject(all[k]) ? all[k] : {} };
    return null;
}

const MIND_FIELDS = {
    mood: ['mood', 'feeling', 'feelings'],
    wants: ['wants', 'want', 'goal', 'goals'],
    plan: ['plan', 'plans', 'intent'],
    knows: ['knows', 'know', 'knowledge'],
    unknown: ['doesnt_know', 'doesn\'t know', 'doesnt know', 'does_not_know', 'unknown', 'not_know', 'blind_spot', 'unaware'],
    secret: ['secret', 'secrets', 'hidden'],
};

function textOf(v) {
    if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join('; ');
    if (isPlainObject(v)) return str(v.text ?? v.value ?? v.item);
    return str(v).trim();
}

export function mindOf(c) {
    const src = isPlainObject(c?.mind) ? c.mind : isPlainObject(c) ? c : {};
    const out = {};
    for (const [field, keys] of Object.entries(MIND_FIELDS)) {
        let v = '';
        for (const k of keys) { if (src[k] !== undefined) { v = textOf(src[k]); if (v) break; } }
        out[field] = v;
    }
    return out;
}

export function profileOf(c) {
    const p = isPlainObject(c?.profile) ? c.profile : {};
    const out = {};
    for (const [k, v] of Object.entries(p)) out[k] = textOf(v);
    return out;
}

function evidenceList(v) {
    return (Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : []).map((x) => {
        if (isPlainObject(x)) return { text: str(x.text ?? x.item ?? x.value).trim(), quote: str(x.quote).trim(), since: x.since ?? x.turn ?? x.uc_id ?? null };
        const s = str(x).trim();
        const m = s.match(/^(.*?)\s*["“]([^"”]+)["”]\s*$/);
        return m ? { text: m[1].replace(/[\s:,-]+$/, ''), quote: m[2], since: null } : { text: s, quote: '', since: null };
    }).filter(e => e.text || e.quote);
}

export function intimacyOf(c) {
    const i = isPlainObject(c?.intimacy) ? c.intimacy : {};
    return {
        likes: evidenceList(i.likes),
        dislikes: evidenceList(i.dislikes),
        limits: evidenceList(i.limits),
        history: evidenceList(i.history),
    };
}

/** Threads: {offscreen:[{name, text}], planted:[text], timers:[{text, left}], resolved:[text]}. */
export function threadsOf(ctx) {
    const t = isPlainObject(stateOf(ctx).threads) ? stateOf(ctx).threads : {};
    const arr = v => (Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : []);
    const offscreen = arr(t.offscreen).map((x) => {
        if (isPlainObject(x)) return { name: str(x.name ?? x.who).trim(), text: str(x.doing ?? x.text ?? x.what).trim() };
        const m = str(x).match(/^\s*([^—–:-]+?)\s*[—–:-]+\s*(.+)$/);
        return m ? { name: m[1].trim(), text: m[2].trim() } : { name: '', text: str(x).trim() };
    }).filter(x => x.text || x.name);
    const timers = arr(t.timers).map((x) => {
        const text = isPlainObject(x) ? str(x.text ?? x.what) : str(x);
        const raw = isPlainObject(x) ? (x.remaining ?? x.turnsLeft ?? x.turns_left ?? x.left) : null;
        const n = raw !== null && raw !== undefined && Number.isFinite(Number(raw)) ? Number(raw)
            : Number((text.match(/turns?\s*left\s*:?\s*(\d+)/i) || text.match(/\((\d+)\s*turns?\s*left\)/i) || [])[1]);
        return { text: text.replace(/\s*\(?\s*turns?\s*left\s*:?\s*\d+\s*\)?/i, '').trim(), left: Number.isFinite(n) ? n : null };
    }).filter(x => x.text);
    const plain = v => arr(v).map(x => (isPlainObject(x) ? str(x.text) : str(x)).trim()).filter(Boolean);
    return { offscreen, planted: plain(t.planted), timers, resolved: plain(t.resolved) };
}

/** Present characters except the player (recorded presence, else the card character). */
export function presentNames(ctx) {
    const recorded = sceneOf(ctx).present;
    const fallback = charName(ctx) ? [charName(ctx)] : [];
    const list = (recorded.length ? recorded : fallback).filter(n => !isUser(ctx, n));
    const seen = new Set();
    return list.filter(n => { const k = n.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

// ---------------------------------------------------------------------------------------------------------------------
// Scene classification (no meters: a few cue words over the latest exchange + the tracker's own words)

const kindCache = new Map();

/**
 * Classify the current scene from the latest reply (prose only), the player's latest message (spoken/public part only)
 * and the tracker/scene text. Returns {intimate, attraction, grief, argument, action, calm, peak, kinds:Set}.
 * Two distinct cue words (or one in the tracker) are needed, so a single stray word never flips a scene.
 */
export function sceneKind(ctx) {
    const a = anchor(ctx);
    const reply = a.reply ? cleanOf(a.reply) : '';
    const user = a.user ? publicPart(a.user.mes) : '';
    const tr = trackerOf(ctx);
    const sc = sceneOf(ctx);
    const trackerText = [tr.arc, tr.next_beat, tr.hidden, sc.room].join(' ');
    const key = `${hashText(reply)}|${hashText(user)}|${hashText(trackerText)}|${tr.scene}|${tr.phase}`;
    const hit = kindCache.get(key);
    if (hit) return hit;
    const exchange = normText(`${reply.slice(-2500)} ${user}`);
    const tnorm = normText(trackerText);
    const score = cues => cueHits(exchange, cues).length + 2 * cueHits(tnorm, cues).length;
    const intimate = score(INTIMATE_CUES) >= 2;
    const attraction = intimate || score(ATTRACTION_CUES) >= 2;
    const grief = score(GRIEF_CUES) >= 2;
    const argument = score(ARGUMENT_CUES) >= 2;
    const action = score(ACTION_CUES) >= 2;
    const kinds = new Set();
    if (intimate) kinds.add('intimate');
    if (attraction) kinds.add('attraction');
    if (grief) kinds.add('grief');
    if (argument) kinds.add('argument');
    if (action) kinds.add('action');
    if (!kinds.size) kinds.add('calm');
    if (tr.scene) kinds.add(tr.scene);
    if (tr.phase) kinds.add(tr.phase);
    const out = { intimate, attraction, grief, argument, action, calm: kinds.has('calm'), peak: tr.scene === 'peak', kinds };
    kindCache.set(key, out);
    if (kindCache.size > 200) kindCache.delete(kindCache.keys().next().value);
    return out;
}
