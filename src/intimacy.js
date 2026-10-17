// Undercurrent — intimacy profiles. Pure logic.
//
// Model: each character has a sexual personality (orientation, style), preferences, hard limits, a history of what
// actually happened, and an optional relationship phase. There are NO meters, scores, gates or stage ladders.
// Evidence rules (enforced in code, not by prompt):
//   1. Preferences change only on in-story evidence: an op must carry a quote that really appears in the source text.
//   2. Limits change only by an explicit in-story choice: adding needs a quoted statement/act; dropping needs
//      explicit_choice:true plus a quote. Inference can never relax a limit.
//   3. Negative evidence outranks compatibility: once something is evidenced as disliked, later positive signals do not
//      flip it unless the character explicitly chooses otherwise in-story. Card/inferred guesses never override evidence.
//   4. A limit always beats a preference.

import { clip, normText, contentTokens, jaccard, isPlainObject } from './util.js';

export const PHASES = ['first_time', 'new', 'established', 'tension', 'reunion'];
const MAX_PREFS = 24;
const MAX_LIMITS = 16;
const MAX_HISTORY = 12;
const MAX_EVIDENCE = 4;

export function emptyIntimacy() {
    return {
        orientation: '',
        style: '',
        attraction: '',
        attraction_turn: null,
        preferences: [],
        limits: [],
        history: [],
        phase: null,
        seeded: false,
        seed_attempts: 0,
    };
}

function str(v, max = 160) {
    return typeof v === 'string' ? clip(v, max) : (v === null || v === undefined ? '' : clip(String(v), max));
}

export function normalizeIntimacy(raw) {
    const base = emptyIntimacy();
    if (!isPlainObject(raw)) return base;
    base.orientation = str(raw.orientation, 120);
    base.style = str(raw.style, 200);
    base.attraction = str(raw.attraction, 160);
    base.attraction_turn = Number.isFinite(raw.attraction_turn) ? raw.attraction_turn : null;
    base.phase = PHASES.includes(raw.phase) ? raw.phase : null;
    base.seeded = !!raw.seeded;
    base.seed_attempts = Number.isFinite(raw.seed_attempts) ? raw.seed_attempts : 0;
    base.preferences = (Array.isArray(raw.preferences) ? raw.preferences : [])
        .map(p => (typeof p === 'string' ? { item: p } : p))
        .filter(p => isPlainObject(p) && str(p.item))
        .map(p => ({
            item: str(p.item, 100),
            status: ['card', 'inferred', 'evidenced'].includes(p.status) ? p.status : 'card',
            stance: p.stance === 'dislikes' ? 'dislikes' : 'likes',
            evidence: (Array.isArray(p.evidence) ? p.evidence : []).filter(isPlainObject).slice(-MAX_EVIDENCE).map(e => ({
                quote: str(e.quote, 240),
                polarity: e.polarity === 'negative' ? 'negative' : 'positive',
                turn: Number.isFinite(e.turn) ? e.turn : 0,
            })),
        }))
        .slice(0, MAX_PREFS);
    base.limits = (Array.isArray(raw.limits) ? raw.limits : [])
        .map(l => (typeof l === 'string' ? { item: l, source: 'card' } : l))
        .filter(l => isPlainObject(l) && str(l.item))
        .map(l => ({ item: str(l.item, 100), source: l.source === 'story' ? 'story' : 'card', quote: str(l.quote, 240), turn: Number.isFinite(l.turn) ? l.turn : 0 }))
        .slice(0, MAX_LIMITS);
    base.history = (Array.isArray(raw.history) ? raw.history : [])
        .map(h => (typeof h === 'string' ? { text: h } : h))
        .filter(h => isPlainObject(h) && str(h.text))
        .map(h => ({ text: str(h.text, 200), quote: str(h.quote, 240), turn: Number.isFinite(h.turn) ? h.turn : 0 }))
        .slice(-MAX_HISTORY);
    return base;
}

/** True when two short item labels refer to the same thing. */
export function sameItem(a, b) {
    const na = normText(a);
    const nb = normText(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    const ta = contentTokens(a);
    const tb = contentTokens(b);
    if (!ta.length || !tb.length) return false;
    return jaccard(ta, tb) >= 0.6;
}

/** Does `quote` actually occur in `source`? Tolerates punctuation/case/whitespace and long quotes (head match). */
export function quoteFound(quote, source) {
    const q = normText(quote);
    const s = normText(source);
    if (!q || !s) return false;
    if (q.split(' ').length < 2 && q.length < 6) return false; // a single short word proves nothing
    if (s.includes(q)) return true;
    const words = q.split(' ');
    if (words.length > 10) {
        const head = words.slice(0, 8).join(' ');
        const tail = words.slice(-6).join(' ');
        return s.includes(head) || s.includes(tail);
    }
    return false;
}

export function findLimit(intimacy, item) {
    return (intimacy?.limits || []).find(l => sameItem(l.item, item)) || null;
}

function findPref(intimacy, item) {
    return (intimacy?.preferences || []).find(p => sameItem(p.item, item)) || null;
}

function itemOf(value) {
    if (typeof value === 'string') return value;
    if (isPlainObject(value)) return value.item ?? value.text ?? '';
    return '';
}

/**
 * Apply one intimacy op. Never throws.
 * @param {object} intimacy current profile (not mutated)
 * @param {{op:string, field:string, value:any}} op
 * @param {{turn?:number, sourceText?:string, trusted?:boolean}} opts trusted = replay of an already-validated op or seed
 * @returns {{ok:boolean, reason:string, intimacy:object}}
 */
export function applyIntimacyOp(intimacy, op, opts = {}) {
    const cur = normalizeIntimacy(intimacy);
    const turn = Number.isFinite(opts.turn) ? opts.turn : 0;
    const trusted = !!opts.trusted;
    const source = String(opts.sourceText ?? '');
    const value = op?.value;
    const quote = isPlainObject(value) ? str(value.quote, 240) : '';
    const hasEvidence = trusted || (quote && quoteFound(quote, source));
    const fail = reason => ({ ok: false, reason, intimacy: cur });
    const done = (reason = 'ok') => ({ ok: true, reason, intimacy: cur });

    switch (op?.field) {
        case 'preferences': {
            if (op.op !== 'append') return fail('preferences only grow by evidence (append)');
            const item = str(itemOf(value), 100);
            if (!item) return fail('missing item');
            if (!hasEvidence) return fail('preferences change only on quoted in-story evidence');
            const polarity = isPlainObject(value) && value.polarity === 'negative' ? 'negative' : 'positive';
            const explicit = isPlainObject(value) && value.explicit_choice === true;
            const evidence = { quote, polarity, turn };
            if (polarity === 'positive' && findLimit(cur, item)) return fail('a hard limit outranks positive evidence');
            const pref = findPref(cur, item);
            if (pref) {
                pref.evidence = [...pref.evidence, evidence].slice(-MAX_EVIDENCE);
                if (polarity === 'negative') {
                    pref.stance = 'dislikes';
                    pref.status = 'evidenced';
                    return done('negative evidence recorded');
                }
                if (pref.stance === 'dislikes' && !explicit) {
                    return done('negative evidence outranks; stance kept');
                }
                pref.stance = 'likes';
                pref.status = 'evidenced';
                return done('positive evidence recorded');
            }
            if (cur.preferences.length >= MAX_PREFS) {
                const drop = cur.preferences.findIndex(p => p.status !== 'evidenced');
                if (drop === -1) return fail('preference list full');
                cur.preferences.splice(drop, 1);
            }
            cur.preferences.push({ item, status: 'evidenced', stance: polarity === 'negative' ? 'dislikes' : 'likes', evidence: [evidence] });
            return done('new evidenced preference');
        }
        case 'limits': {
            const item = str(itemOf(value), 100);
            if (!item) return fail('missing item');
            if (op.op === 'append') {
                if (!hasEvidence) return fail('limits are added only by an explicit, quoted in-story statement');
                if (findLimit(cur, item)) return done('limit already recorded');
                if (cur.limits.length >= MAX_LIMITS) return fail('limit list full');
                cur.limits.push({ item, source: trusted && !quote ? 'card' : 'story', quote, turn });
                const pref = findPref(cur, item);
                if (pref) { pref.stance = 'dislikes'; pref.status = 'evidenced'; }
                return done('limit added');
            }
            if (op.op === 'close' || op.op === 'remove') {
                const explicit = isPlainObject(value) && value.explicit_choice === true;
                if (!(trusted || (explicit && quote && quoteFound(quote, source)))) {
                    return fail('limits only change by an explicit in-story choice (explicit_choice + quote)');
                }
                const idx = cur.limits.findIndex(l => sameItem(l.item, item));
                if (idx === -1) return fail('no such limit');
                cur.limits.splice(idx, 1);
                cur.history = [...cur.history, { text: `chose to drop the limit: ${item}`, quote, turn }].slice(-MAX_HISTORY);
                return done('limit dropped by explicit choice');
            }
            return fail('limits cannot be set wholesale');
        }
        case 'history': {
            if (op.op !== 'append') return fail('history is append-only');
            const text = str(isPlainObject(value) ? (value.text ?? value.item) : value, 200);
            if (!text) return fail('missing text');
            cur.history = [...cur.history, { text, quote, turn }].slice(-MAX_HISTORY);
            return done('history appended');
        }
        case 'phase': {
            if (op.op !== 'set' && op.op !== 'close' && op.op !== 'remove') return fail('phase is set');
            const v = op.op === 'set' ? (isPlainObject(value) ? value.value ?? value.phase : value) : null;
            if (v === null || v === '' || v === undefined) { cur.phase = null; return done('phase cleared'); }
            if (!PHASES.includes(v)) return fail(`phase must be one of ${PHASES.join('|')}`);
            cur.phase = v;
            return done('phase set');
        }
        case 'attraction': {
            if (op.op === 'close' || op.op === 'remove') { cur.attraction = ''; cur.attraction_turn = turn; return done('attraction cleared'); }
            if (op.op !== 'set') return fail('attraction is set');
            cur.attraction = str(isPlainObject(value) ? (value.text ?? value.value) : value, 160);
            cur.attraction_turn = turn;
            return done('attraction noted');
        }
        case 'orientation':
        case 'style': {
            if (op.op !== 'set') return fail(`${op.field} is set`);
            if (cur.seeded && !hasEvidence) return fail(`${op.field} changes only on quoted in-story evidence`);
            cur[op.field] = str(isPlainObject(value) ? (value.text ?? value.value) : value, op.field === 'style' ? 200 : 120);
            return done(`${op.field} set`);
        }
        default:
            return fail('unknown intimacy field');
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// One-time seeding from the character card.

export const SEED_SYSTEM = [
    'You read a fictional character card and extract that character\'s sexual personality for a private continuity file.',
    'Use only what the card states or clearly implies. Do not invent kinks or history the card does not support; short or empty lists are correct when the card is silent.',
    'Return ONLY a JSON object, no prose:',
    '{"orientation":"short text or empty","style":"one sentence: how they initiate, respond and behave when attracted, or empty",',
    '"preferences":[{"item":"short label","basis":"card|inferred"}],',
    '"limits":["hard limits the card states or that follow unmistakably from who they are"],',
    '"history":["relevant romantic/sexual past the card mentions"]}',
    '"card" = stated in the card. "inferred" = strongly implied by personality; at most 3 inferred items. Labels under 8 words.',
].join('\n');

export function buildSeedMessages(card = {}) {
    const name = card.name || '{{char}}';
    const parts = [`<character name="${name}">`];
    if (card.description) parts.push(`Description:\n${card.description}`);
    if (card.personality) parts.push(`Personality:\n${card.personality}`);
    if (card.scenario) parts.push(`Scenario:\n${card.scenario}`);
    if (card.examples) parts.push(`Example dialogue:\n${card.examples}`);
    parts.push('</character>');
    parts.push(`Extract ${name}'s sexual personality as JSON now.`);
    return { systemPrompt: SEED_SYSTEM, messages: [{ role: 'user', content: parts.join('\n\n') }] };
}

/** Merge a parsed seed result into a profile. Card entries are 'card'; limits from the card are permanent until an in-story choice. */
export function seedFromParsed(intimacy, parsed, opts = {}) {
    const cur = normalizeIntimacy(intimacy);
    const turn = Number.isFinite(opts.turn) ? opts.turn : 0;
    if (!isPlainObject(parsed)) {
        cur.seed_attempts = (cur.seed_attempts || 0) + 1;
        return cur;
    }
    if (!cur.orientation) cur.orientation = str(parsed.orientation, 120);
    if (!cur.style) cur.style = str(parsed.style, 200);
    let inferred = 0;
    for (const p of Array.isArray(parsed.preferences) ? parsed.preferences.slice(0, 16) : []) {
        const item = str(itemOf(p), 100);
        if (!item || findPref(cur, item) || findLimit(cur, item)) continue;
        const basis = isPlainObject(p) && p.basis === 'inferred' ? 'inferred' : 'card';
        if (basis === 'inferred' && ++inferred > 3) continue;
        cur.preferences.push({ item, status: basis, stance: 'likes', evidence: [] });
    }
    for (const l of Array.isArray(parsed.limits) ? parsed.limits.slice(0, 12) : []) {
        const item = str(itemOf(l), 100);
        if (!item || findLimit(cur, item)) continue;
        cur.limits.push({ item, source: 'card', quote: '', turn });
        const pref = findPref(cur, item);
        if (pref) cur.preferences.splice(cur.preferences.indexOf(pref), 1);
    }
    for (const h of Array.isArray(parsed.history) ? parsed.history.slice(0, 6) : []) {
        const text = str(isPlainObject(h) ? h.text : h, 200);
        if (text) cur.history.push({ text, quote: '', turn: 0 });
    }
    cur.preferences = cur.preferences.slice(0, MAX_PREFS);
    cur.limits = cur.limits.slice(0, MAX_LIMITS);
    cur.history = cur.history.slice(-MAX_HISTORY);
    cur.seeded = true;
    cur.seed_attempts = (cur.seed_attempts || 0) + 1;
    return cur;
}

// ---------------------------------------------------------------------------------------------------------------------
// Injection helpers.

/** Attraction is "live" when the scribe noted unacted attraction recently or an intimate thread is fresh. */
export function attractionLive(intimacy, turn) {
    const i = normalizeIntimacy(intimacy);
    if (i.attraction && (i.attraction_turn === null || turn - i.attraction_turn <= 12)) return true;
    const last = i.history[i.history.length - 1];
    return !!(i.phase && last && turn - last.turn <= 4);
}

/** Terse, qualitative lines. Limits and dislikes always come first. No numbers. */
export function intimacyLines(name, intimacy, opts = {}) {
    const i = normalizeIntimacy(intimacy);
    const maxLikes = opts.maxLikes ?? 5;
    const bits = [];
    if (i.limits.length) bits.push(`hard limits: ${i.limits.map(l => l.item).join(', ')}`);
    const dislikes = i.preferences.filter(p => p.stance === 'dislikes').map(p => p.item);
    if (dislikes.length) bits.push(`dislikes (evidence, outranks any guess): ${dislikes.join(', ')}`);
    const likes = i.preferences
        .filter(p => p.stance === 'likes')
        .sort((a, b) => rank(a) - rank(b))
        .slice(0, maxLikes)
        .map(p => (p.status === 'evidenced' ? p.item : `${p.item} (${p.status === 'inferred' ? 'guess' : 'card'})`));
    if (likes.length) bits.push(`likes: ${likes.join(', ')}`);
    if (i.orientation) bits.push(i.orientation);
    if (i.style) bits.push(i.style);
    if (i.phase) bits.push(`phase: ${i.phase.replace('_', ' ')}`);
    if (i.attraction) bits.push(`unacted attraction: ${i.attraction}`);
    const last = i.history[i.history.length - 1];
    if (last && opts.includeHistory !== false) bits.push(`last: ${last.text}`);
    return bits.length ? [`Intimacy · ${name}: ${bits.join('; ')}`] : [];
}

function rank(p) {
    return p.status === 'evidenced' ? 0 : p.status === 'card' ? 1 : 2;
}
