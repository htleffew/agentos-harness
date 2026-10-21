// Undercurrent 2 · FEATURES — tic guard. Code only (no model call): finds repetition and slop in the reply the player
// just answered and adds short, escalating corrections for the next reply.
//
// Detects (on the reply's story prose: <UC> envelope and <think> removed):
//   repeats — 3–6-word phrases that already appeared in the last few replies
//   slop    — per-model-family overused phrasing (extension/data/slop.json: generic + DeepSeek, GLM, Kimi, MiMo lists)
//   parrot  — the reply echoing 4+ words the player actually said (the player's *private thoughts* are excluded)
//   private — the reply picking up words from the player's *private thoughts* (left to the critic while it is on)
//   opening — the reply opening like a recent one (same first words, or always the same kind of opening)
//   stall   — same place and time with nothing new for a few replies, or near-identical consecutive replies
// Escalation: a streak of replies with findings raises the level (1 nudge, 2 firm, 3 hard ban). Everything is derived
// from the chat as it stands (memoized by uc_id + text hash), so swipes, edits and deletes need no bookkeeping.

import { str, tokens, contentTokens, ngrams, meaningful, escapeRegex, clip, isPlainObject, publicPart, privateThoughts, hashText, fillTokens, usesToken } from '../common/text.js';
import { anchor, cleanOf } from '../common/chat.js';
import { optBool, optNum, opt, phrases } from '../common/settings.js';
import { stallOf } from '../common/stall.js';
import { SLOP_DATA } from './slop_data.js';

export const DEFAULTS = Object.freeze({
    'ticguard.enabled': true,
    'ticguard.max_lines': 3,
    'ticguard.window': 4,
    'ticguard.bans': '',
});

export const SCHEMA = [
    { key: 'ticguard.enabled', tab: 'director', section: 'Quality', type: 'toggle', default: true, advanced: true, label: 'Tic guard',
        help: 'Code-only checks for repeated phrasing, model-specific clichés, parroting and stalls; short corrections for the next reply.', scope: 'setup' },
    { key: 'ticguard.max_lines', tab: 'director', section: 'Quality', type: 'slider', default: 3, min: 1, max: 5, step: 1, advanced: true, label: 'Tic corrections per turn',
        help: 'At most this many correction lines per turn.', scope: 'setup' },
    { key: 'ticguard.window', tab: 'director', section: 'Quality', type: 'slider', default: 4, min: 2, max: 8, step: 1, advanced: true, label: 'Replies compared',
        help: 'How many earlier replies count for repeated phrasing and openings.', scope: 'setup' },
    { key: 'ticguard.bans', tab: 'director', section: 'Quality', type: 'textarea', default: '', advanced: true, label: 'Extra banned phrases',
        help: 'One phrase per line (or /regex/). Reported like the built-in cliché lists.', scope: 'setup' },
];

const FALLBACK = {
    tic_repeat: '"{phrase}" has turned up {n} times lately. Retire it: new image, new gesture, or say it plainly.',
    tic_slop: '{verb}: {quote}. Write the concrete, scene-specific detail instead.',
    tic_parrot: 'Don\'t parrot {{user}}\'s words back ("{quote}"); answer them.',
    tic_private_thought: 'Nobody heard {{user}}\'s private thought ("{quote}"). No character reacts to it or knows it.',
    tic_opening: 'Recent replies keep opening with "{phrase}". Open differently.',
    stall: 'Nothing has really changed for {n} turns. Change something real this reply: new information, an arrival, a decision, a cost, or a move in place or time.',
};
const LEVEL_VERBS = ['Avoid', 'Stop using', 'Banned now'];

// ---------------------------------------------------------------------------------------------------------------------
// Slop lists

/** Family key for slop lists from ctx.model ({family, id}). */
export function slopFamily(model) {
    const s = `${str(model?.family)} ${str(model?.id)}`.toLowerCase();
    for (const f of Array.isArray(SLOP_DATA.families) ? SLOP_DATA.families : []) {
        if ((f.match || []).some((p) => { try { return new RegExp(p, 'i').test(s); } catch { return false; } })) return f.key;
    }
    return 'generic';
}

const compiled = new Map();
function compile(entries, cacheKey) {
    if (cacheKey && compiled.has(cacheKey)) return compiled.get(cacheKey);
    const out = [];
    for (const e of entries) {
        if (!isPlainObject(e) || !e.pattern) continue;
        try {
            let src;
            if (e.kind === 'regex') src = e.pattern;
            else {
                const body = escapeRegex(String(e.pattern).trim()).replace(/\s+/g, '\\s+');
                src = `${/^\w/.test(e.pattern) ? '\\b' : ''}${body}${/\w$/.test(e.pattern) ? '\\b' : ''}`;
            }
            out.push({ re: new RegExp(src, 'gim'), pattern: e.pattern, min: Number.isFinite(e.min) ? e.min : 1 });
        } catch { /* invalid pattern: skip */ }
    }
    if (cacheKey) { compiled.set(cacheKey, out); if (compiled.size > 20) compiled.delete(compiled.keys().next().value); }
    return out;
}

export function slopList(family, bans = '') {
    const lists = SLOP_DATA.lists || {};
    const base = [...(lists.generic || []), ...(family && family !== 'generic' ? lists[family] || [] : [])];
    const own = str(bans).split('\n').map(x => x.trim()).filter(Boolean).map((b) => {
        const m = b.match(/^\/(.+)\/[a-z]*$/);
        return m ? { pattern: m[1], kind: 'regex' } : { pattern: b, kind: 'phrase' };
    });
    return compile([...base, ...own], `${family}|${hashText(bans)}`);
}

export function matchSlop(text, list) {
    const hits = [];
    for (const c of list) {
        c.re.lastIndex = 0;
        const ms = str(text).match(c.re);
        if (ms && ms.length) hits.push({ pattern: c.pattern, match: clip(ms[0], 60), count: ms.length, min: c.min });
    }
    return hits;
}

// ---------------------------------------------------------------------------------------------------------------------
// Detectors (pure)

/** Phrases (3..6 words) of `reply` also found in any of `previous`; longest first, sub-phrases removed. */
export function findRepeats(reply, previous, { minN = 3, maxN = 6, max = 4 } = {}) {
    const rt = tokens(reply);
    const found = [];
    for (let n = maxN; n >= minN; n--) {
        const prev = new Set();
        for (const p of previous) for (const g of ngrams(tokens(p), n)) prev.add(g);
        for (const g of new Set(ngrams(rt, n))) {
            if (!prev.has(g) || !meaningful(g) || found.some(f => f.includes(g))) continue;
            found.push(g);
        }
    }
    return found.slice(0, max);
}

/** Spans (4..10 words) of what the player SAID or did (no *thoughts*) repeated in the reply. */
export function findParrot(reply, userMessage, { n = 4, maxLen = 10, max = 2 } = {}) {
    const ut = tokens(publicPart(userMessage));
    if (ut.length < n) return [];
    const rt = tokens(reply);
    const found = [];
    for (let len = Math.min(maxLen, ut.length); len >= n; len--) {
        const rs = new Set(ngrams(rt, len));
        for (const g of ngrams(ut, len)) if (rs.has(g) && meaningful(g) && !found.some(f => f.includes(g))) found.push(g);
    }
    return found.slice(0, max);
}

/** Consecutive content-word pairs (stopwords skipped): "the envelope in my coat pocket" → envelope coat, coat pocket. */
function contentPairs(text) {
    const c = contentTokens(text).filter(t => t.length > 2);
    const out = [];
    for (let i = 0; i + 1 < c.length; i++) out.push(`${c[i]} ${c[i + 1]}`);
    return out;
}

/**
 * Phrases from the player's *private thoughts* that surface in the reply but were neither said aloud nor already in
 * the story (`earlier` = recent replies). Matches an exact 3-word phrase, or a pair of content words in the same order
 * (catches paraphrase: "*the envelope is in my coat pocket*" → "the envelope in your coat pocket").
 */
export function findPrivateEcho(reply, userMessage, earlier = [], { n = 3, max = 2 } = {}) {
    const thoughts = privateThoughts(userMessage);
    if (!thoughts.length) return [];
    const context = [publicPart(userMessage), ...earlier];
    const rset = new Set(ngrams(tokens(reply), n));
    const known = new Set(context.flatMap(t => ngrams(tokens(t), n)));
    const rpairs = new Set(contentPairs(reply));
    const knownPairs = new Set(context.flatMap(contentPairs));
    const knownWords = new Set(context.flatMap(t => contentTokens(t)));
    const found = [];
    const add = g => { if (!found.some(f => f.includes(g) || g.includes(f))) found.push(g); };
    for (const t of thoughts) {
        for (const g of ngrams(tokens(t), n)) if (rset.has(g) && !known.has(g) && meaningful(g)) add(g);
        for (const p of contentPairs(t)) {
            const [x, y] = p.split(' ');
            if (rpairs.has(p) && !knownPairs.has(p) && x.length + y.length >= 9 && !(knownWords.has(x) && knownWords.has(y))) add(p);
        }
    }
    return found.slice(0, max);
}

function openingOf(text) {
    const s = str(text).trim();
    return { words: tokens(s).slice(0, 3).join(' '), cls: /^["“]/.test(s) ? 'dialogue' : /^\*/.test(s) ? 'thought' : 'narration' };
}

/** {words, kind} when the reply opens like a recent one, else null. */
export function findOpening(reply, previous, window = 3) {
    const cur = openingOf(reply);
    if (!cur.words) return null;
    const prev = previous.slice(-window).map(openingOf);
    if (prev.some(p => p.words === cur.words)) return { words: cur.words, kind: 'same words' };
    if (prev.length >= 2 && cur.cls !== 'narration' && prev.slice(-2).every(p => p.cls === cur.cls)) return { words: cur.words, kind: `always ${cur.cls}` };
    return null;
}

const analysisCache = new Map();

/**
 * Analyze one reply. All texts are already cleaned prose. Returns findings:
 * {repeats[], slop[], parrot[], private[], opening, dirty}
 */
export function analyzeReply({ reply, previous = [], userMessage = '', slop = [], window = 4, checkPrivate = true }) {
    const key = [hashText(reply), previous.slice(-window).map(hashText).join(','), hashText(userMessage), slop.length, window, checkPrivate].join('|');
    const hit = analysisCache.get(key);
    if (hit) return hit;
    const prev = previous.slice(-window);
    const f = {
        repeats: findRepeats(reply, prev),
        slop: [],
        parrot: findParrot(reply, userMessage),
        private: checkPrivate ? findPrivateEcho(reply, userMessage, prev) : [],
        opening: findOpening(reply, prev, Math.min(3, window)),
    };
    const recent = new Map();
    for (const p of prev.slice(-3)) for (const h of matchSlop(p, slop)) recent.set(h.pattern, (recent.get(h.pattern) || 0) + h.count);
    for (const h of matchSlop(reply, slop)) if (h.count + (recent.get(h.pattern) || 0) >= h.min) f.slop.push(h);
    f.dirty = !!(f.repeats.length || f.slop.length || f.parrot.length || f.private.length || f.opening);
    analysisCache.set(key, f);
    if (analysisCache.size > 300) analysisCache.delete(analysisCache.keys().next().value);
    return f;
}

// ---------------------------------------------------------------------------------------------------------------------
// Provider

function phraseText(ctx, key, vars) {
    const list = phrases(ctx, key);
    const tpl = list.length ? list[0] : FALLBACK[key];
    let text = fillTokens(tpl, vars).text;
    // A content phrase without the token still gets the specifics, so the correction stays actionable.
    const spec = vars.quote || vars.phrase;
    if (spec && !usesToken(tpl, 'quote') && !usesToken(tpl, 'phrase')) text = `${text.replace(/[.\s]+$/, '')} ("${spec}").`;
    return text;
}

/** How many of the given texts contain the phrase. */
function occurrences(phrase, texts) {
    const p = ` ${phrase} `;
    return texts.filter(t => ` ${tokens(t).join(' ')} `.includes(p)).length;
}

/**
 * Findings for the reply before the turn anchor, plus the escalation level (streak of replies with findings).
 * Returns {findings, level, stall, lines:[text]} — lines already rendered from directive_phrases.
 */
export function ticTurn(ctx) {
    const a = anchor(ctx);
    if (!a.reply) return { findings: null, level: 0, stall: false, lines: [] };
    const window = Math.round(optNum(ctx, 'ticguard.window', 4, 2, 8));
    const slop = slopList(slopFamily(ctx?.model), str(opt(ctx, 'ticguard.bans', '')));
    const checkPrivate = !optBool(ctx, 'critic.enabled', true);
    // Every AI reply up to the analyzed one, with the user message each one answered.
    const replies = [];
    let lastUser = '';
    for (const m of a.list) {
        if (m.pos > a.reply.pos) break;
        if (m.isUser) lastUser = m.mes;
        else replies.push({ m, user: lastUser });
    }
    replies.splice(0, Math.max(0, replies.length - (window + 4)));
    const texts = replies.map(r => cleanOf(r.m));
    const analyze = (k) => analyzeReply({ reply: texts[k], previous: texts.slice(0, k), userMessage: replies[k].user, slop, window, checkPrivate });
    const findings = analyze(texts.length - 1);
    let streak = 0;
    for (let k = texts.length - 1; k >= 0 && streak < 3; k--) { if (analyze(k).dirty) streak++; else break; }
    const level = findings.dirty ? Math.min(3, streak) : 0;
    const stall = stallOf(ctx, { window: 3 });
    const lines = [];
    const q = list => list.map(x => `"${x}"`).join(', ');
    if (findings.private.length) lines.push(phraseText(ctx, 'tic_private_thought', { quote: findings.private[0] }));
    if (findings.slop.length) {
        const items = findings.slop.slice(0, level >= 2 ? 4 : 3).map(h => h.match);
        lines.push(phraseText(ctx, 'tic_slop', { verb: (phrases(ctx, 'tic_levels')[level - 1]) || LEVEL_VERBS[Math.max(0, level - 1)], quote: items.join('", "'), items: q(items) }));
    }
    if (findings.repeats.length) {
        const recent = [...texts.slice(-(window + 1))];
        const ranked = findings.repeats.map(r => ({ r, n: occurrences(r, recent) })).sort((x, y) => y.n - x.n || y.r.length - x.r.length);
        lines.push(phraseText(ctx, 'tic_repeat', { phrase: ranked[0].r, n: Math.max(2, ranked[0].n), items: q(findings.repeats.slice(0, 3)) }));
    }
    if (findings.parrot.length) lines.push(phraseText(ctx, 'tic_parrot', { quote: findings.parrot[0] }));
    if (findings.opening) lines.push(phraseText(ctx, 'tic_opening', { phrase: findings.opening.words }));
    if (stall.stalled) lines.push(phraseText(ctx, 'stall', { n: stall.reason === 'samey' ? 2 : 3 }));
    return { findings, level, stall: stall.stalled, lines: lines.filter(Boolean).slice(0, Math.round(optNum(ctx, 'ticguard.max_lines', 3, 1, 5))) };
}

export default {
    id: 'ticguard',
    settingsKeys: Object.keys(DEFAULTS),
    turnLines(ctx) {
        if (!optBool(ctx, 'ticguard.enabled', true)) return [];
        const t = ticTurn(ctx);
        return t.lines.map((text, i) => ({ slot: 'uc_directive', text, priority: 78 + Math.max(t.level, 1) * 2 - i, source: 'ticguard' }));
    },
};
