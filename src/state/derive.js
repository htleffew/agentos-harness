// Undercurrent 2: derived story state (BUILD_SPEC §3.3). Pure.
//
// State is a fold over the chat AS IT CURRENTLY STANDS: each AI message's active text (chat[i].mes) is parsed and its
// envelope applied in order. Swipes, edits, deletes, branches and reloads are therefore consistent by construction.
// Fold semantics:
//   Scene      last-write-wins per field; `present` replaced when given
//   Minds      last-write-wins per character field (omitted = unchanged, "none" = cleared)
//   Threads    offscreen / planted / timers replaced when the block is present; resolved accumulates (capped)
//   Facts      "+ fact" adds (dedupe by normalized text), "- fact" removes (exact, else containment)
//   Intimacy   evidence appended per category (skipped when the same quote or the same text is already there)
//   New_Character  profile set once (first wins); later Minds update the mind
//   Tracker    last-write-wins per field
// `seed` (per-chat, not from replies) is applied before the fold; `overrides` (user edits) after it.

import { parseEnvelope } from '../envelope/parse.js';
import {
    parseScene, parseMinds, parseThreads, parseFacts, parseIntimacy, parseNewCharacter, parseTracker, MIND_FIELDS,
} from '../envelope/fields.js';
import { clone, normKey, isPlainObject } from '../core/util.js';
import { applyOverrides } from './overrides.js';

export const LIMITS = Object.freeze({ facts: 300, resolved: 12, evidence: 40, offscreen: 20, planted: 20, timers: 20 });

export function emptyState() {
    return {
        turn: 0,
        scene: {},
        characters: {},
        facts: [],
        threads: { offscreen: [], planted: [], timers: [], resolved: [] },
        tracker: {},
        stats: { envelopesSeen: 0, envelopesMissing: 0, truncated: 0 },
    };
}

export function emptyCharacter(name, turn = 0) {
    return {
        name,
        mind: {},
        profile: {},
        intimacy: { likes: [], dislikes: [], limits: [], history: [] },
        firstSeen: turn,
        lastSeen: turn,
        offscreen: '',
    };
}

/** Find a character key case-insensitively (names from model output vary in case and spacing). */
export function findCharacterKey(state, name) {
    const n = normKey(name);
    if (!n) return null;
    for (const k of Object.keys(state.characters)) if (normKey(k) === n) return k;
    return null;
}

export function ensureCharacter(state, name, turn) {
    const clean = String(name ?? '').replace(/\s+/g, ' ').trim();
    if (!clean) return null;
    const key = findCharacterKey(state, clean) || clean;
    if (!state.characters[key]) state.characters[key] = emptyCharacter(key, turn);
    return state.characters[key];
}

function seen(ch, turn) {
    if (!ch) return;
    if (ch.firstSeen === null || ch.firstSeen === undefined) ch.firstSeen = turn;
    ch.lastSeen = Math.max(Number(ch.lastSeen) || 0, turn);
}

function isUserName(name, userNames) {
    const n = normKey(name);
    return !!n && (n === '{{user}}' || userNames.some(u => normKey(u) === n));
}

/** Append evidence unless the same quote or the same text is already recorded. */
function addEvidence(list, item, meta) {
    const t = normKey(item.text);
    const q = normKey(item.quote);
    if (!t && !q) return;
    if (list.some(x => (q && normKey(x.quote) === q) || (t && normKey(x.text) === t))) return;
    list.push({ text: item.text, quote: item.quote || '', turn: meta.turn, ucId: meta.ucId || '' });
    if (list.length > LIMITS.evidence) list.splice(0, list.length - LIMITS.evidence);
}

function removeFact(facts, text) {
    const n = normKey(text);
    if (!n) return;
    let idx = facts.findIndex(f => normKey(f.text) === n);
    if (idx < 0) idx = facts.findIndex(f => { const fk = normKey(f.text); return fk.includes(n) || n.includes(fk); });
    if (idx >= 0) facts.splice(idx, 1);
}

/** Apply one parsed envelope to the state (mutates). */
export function applyEnvelope(state, parsed, meta) {
    const { turn, ucId, userNames = [] } = meta;
    for (const block of parsed.blocks || []) {
        switch (block.id) {
            case 'scene': {
                const { fields, present } = parseScene(block);
                Object.assign(state.scene, fields);
                if (present) {
                    state.scene.present = present;
                    for (const name of present) {
                        if (isUserName(name, userNames)) continue;
                        const ch = ensureCharacter(state, name, turn);
                        seen(ch, turn);
                        if (ch) ch.offscreen = '';
                    }
                }
                break;
            }
            case 'minds': {
                for (const entry of parseMinds(block, { userNames })) {
                    const ch = ensureCharacter(state, entry.name, turn);
                    if (!ch) continue;
                    for (const f of MIND_FIELDS) if (Object.hasOwn(entry.fields, f)) ch.mind[f] = entry.fields[f];
                    seen(ch, turn);
                }
                break;
            }
            case 'threads': {
                const t = parseThreads(block);
                for (const ch of Object.values(state.characters)) ch.offscreen = '';
                state.threads.offscreen = t.offscreen.slice(0, LIMITS.offscreen).map(o => ({ name: o.name, doing: o.doing, since: turn }));
                for (const o of state.threads.offscreen) {
                    if (!o.name || isUserName(o.name, userNames)) continue;
                    const ch = ensureCharacter(state, o.name, turn);
                    if (ch) ch.offscreen = o.doing;
                }
                state.threads.planted = t.planted.slice(0, LIMITS.planted).map(text => ({ text, since: turn }));
                state.threads.timers = t.timers.slice(0, LIMITS.timers).map(x => ({ text: x.text, turnsLeft: x.turnsLeft, setAt: turn }));
                for (const r of t.resolved) {
                    if (!state.threads.resolved.some(x => normKey(x.text) === normKey(r))) state.threads.resolved.push({ text: r, at: turn });
                }
                if (state.threads.resolved.length > LIMITS.resolved) state.threads.resolved.splice(0, state.threads.resolved.length - LIMITS.resolved);
                break;
            }
            case 'facts': {
                const { add, remove } = parseFacts(block);
                for (const r of remove) removeFact(state.facts, r);
                for (const a of add) {
                    if (state.facts.some(f => normKey(f.text) === normKey(a))) continue;
                    state.facts.push({ text: a, since: turn, ucId: ucId || '' });
                }
                if (state.facts.length > LIMITS.facts) state.facts.splice(0, state.facts.length - LIMITS.facts);
                break;
            }
            case 'intimacy': {
                const x = parseIntimacy(block);
                if (!x.name || isUserName(x.name, userNames)) break;
                const ch = ensureCharacter(state, x.name, turn);
                if (!ch) break;
                for (const cat of ['likes', 'dislikes', 'limits', 'history']) for (const item of x[cat]) addEvidence(ch.intimacy[cat], item, { turn, ucId });
                seen(ch, turn);
                break;
            }
            case 'new_character': {
                const x = parseNewCharacter(block);
                if (!x.name || isUserName(x.name, userNames)) break;
                const ch = ensureCharacter(state, x.name, turn);
                if (!ch) break;
                if (!ch.profile || !Object.keys(ch.profile).length) ch.profile = x.profile;
                seen(ch, turn);
                break;
            }
            case 'tracker':
                Object.assign(state.tracker, parseTracker(block));
                break;
            default:
                // Unknown (custom) blocks: keep the latest raw lines so features can read them.
                if (!isPlainObject(state.custom)) state.custom = {};
                state.custom[block.id] = { lines: block.lines.slice(0, 40), at: turn };
        }
    }
}

/** Apply per-chat seed data (e.g. {{char}}'s card-seeded intimacy profile). Mutates. */
export function applySeed(state, seed) {
    if (!isPlainObject(seed)) return state;
    const chars = isPlainObject(seed.characters) ? seed.characters : {};
    for (const [name, data] of Object.entries(chars)) {
        const ch = ensureCharacter(state, name, 0);
        if (!ch || !isPlainObject(data)) continue;
        if (isPlainObject(data.profile)) ch.profile = { ...data.profile, ...ch.profile };
        if (isPlainObject(data.mind)) ch.mind = { ...data.mind, ...ch.mind };
        if (isPlainObject(data.intimacy)) {
            for (const cat of ['likes', 'dislikes', 'limits', 'history']) {
                for (const item of Array.isArray(data.intimacy[cat]) ? data.intimacy[cat] : []) {
                    const it = typeof item === 'string' ? { text: item, quote: '' } : { text: String(item?.text ?? ''), quote: String(item?.quote ?? '') };
                    addEvidence(ch.intimacy[cat], it, { turn: 0, ucId: 'seed' });
                }
            }
        }
    }
    if (Array.isArray(seed.facts)) for (const f of seed.facts) if (f) state.facts.push({ text: String(f.text ?? f), since: 0, ucId: 'seed' });
    return state;
}

/** Message classification shared by derive and the cache. */
export function messageKind(m) {
    if (!m || typeof m !== 'object') return 'skip';
    if (m.is_system) return 'skip';
    if (m.extra && (m.extra.type === 'narrator' || m.extra.isSmallSys)) return 'skip';
    return m.is_user ? 'user' : 'ai';
}

/** Fold one message into the state (mutates). `parsed` is parseEnvelope(m.mes) for AI messages. */
export function foldMessage(state, m, parsed, meta) {
    const kind = messageKind(m);
    if (kind === 'user') {
        state.turn += 1;
        return;
    }
    if (kind !== 'ai') return;
    if (parsed?.ok) {
        state.stats.envelopesSeen += 1;
        if (parsed.truncated || parsed.blocks.some(b => b.truncated)) state.stats.truncated += 1;
        applyEnvelope(state, parsed, { turn: state.turn, ucId: m.extra?.uc_id || '', userNames: meta.userNames });
    } else if (state.turn > 0) {
        state.stats.envelopesMissing += 1;
    }
}

/** Output view: timer countdowns relative to the current turn. Returns a new object. */
export function finalizeState(state) {
    const out = clone(state);
    if (!isPlainObject(out.overridden)) out.overridden = {};
    out.threads.timers = out.threads.timers.map(t => ({
        ...t,
        remaining: Number.isFinite(t.turnsLeft) ? Math.max(0, t.turnsLeft - (out.turn - t.setAt)) : null,
    }));
    return out;
}

/**
 * Full recompute (reference implementation; the cache does the same work incrementally).
 * @param {{chat:object[], seed?:object, overrides?:object, userNames?:string[], registry?:object[], parse?:(mes:string)=>object}} o
 */
export function derive({ chat, seed = null, overrides = null, userNames = [], registry = null, parse = null }) {
    const p = parse || (mes => parseEnvelope(mes, registry));
    const state = applySeed(emptyState(), seed);
    for (const m of Array.isArray(chat) ? chat : []) {
        const kind = messageKind(m);
        foldMessage(state, m, kind === 'ai' ? p(String(m.mes ?? '')) : null, { userNames });
    }
    return finalizeState(applyOverrides(state, overrides));
}
