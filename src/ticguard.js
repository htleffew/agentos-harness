// Undercurrent — tic guard. Code-only (no LLM): detects repetition and slop in assistant replies and produces short,
// escalating corrections for the next turn's injection. Pure logic.
//
// Detects:
//   repeats  — 3–6-word phrases in this reply that already appeared in the last N assistant replies
//   slop     — per-model overused phrases/constructions (shared/slop.json)
//   echo     — the reply parroting the player's spoken words
//   mindread — the reply reacting to the player's *private* asterisk thoughts
//   opening  — the reply opening the same way as recent replies
//   stall    — no new facts / place / time / characters for K turns (or replies nearly identical)

import { tokens, STOPWORDS, escapeRegex, jaccard, contentTokens, clip, isPlainObject, renderTemplate, mergeConfig } from './util.js';
import { privateThoughts, publicPart } from './context.js';

/** Every threshold, window and correction phrasing (knobs ticguard.*). Defaults reproduce v1.0 behavior. */
export const TICGUARD_DEFAULTS = Object.freeze({
    detect: Object.freeze({ repeats: true, slop: true, echo: true, mindread: true, opening: true, samey: true }),
    ngramMin: 3,
    ngramMax: 6,
    maxRepeats: 5,
    repeatMinPhrases: 1,
    echoMinWords: 4,
    echoMaxWords: 10,
    echoMax: 3,
    mindreadMinWords: 3,
    mindreadMax: 2,
    openingWindow: 3,
    openingWords: 3,
    openingClassRun: 2,
    sameyThreshold: 0.55,
    slopRecent: 3,
    decay: 0.5,
    countsMax: 40,
    maxLevel: 3,
    level2Streak: 2,
    level3Streak: 3,
    maxLines: 4,
    slopItemsSoft: 3,
    slopItemsFirm: 4,
    repeatItems: 3,
    verbs: Object.freeze({ 1: 'Avoid', 2: 'Stop using', 3: 'Banned now' }),
    text: Object.freeze({
        mindread: '{{user}}\'s *asterisk* thoughts are private: nobody hears or reacts to "{{uc_phrase}}".',
        slop: '{{uc_verb}}: {{uc_items}} — write the concrete, scene-specific detail instead.',
        repeatSoft: 'Don\'t recycle phrasing: {{uc_items}}.',
        repeatFirm: 'Repeated from earlier replies: {{uc_items}}. New wording, new gestures.',
        echo: 'Don\'t parrot {{user}}\'s words ("{{uc_phrase}}"); answer them.',
        opening: 'Open differently from recent replies (not "{{uc_phrase}}…").',
        samey: 'The last replies are near-identical in content: change the situation, not just the words.',
    }),
});

export const TIC_TEXT_PLACEHOLDERS = [
    { name: 'uc_phrase', help: 'The offending phrase (mind-read, echo, opening).' },
    { name: 'uc_items', help: 'Quoted, comma-separated phrases (slop, repeats).' },
    { name: 'uc_verb', help: 'The escalation verb for the current level (slop line).' },
];

export function ticguardConfig(config) {
    return mergeConfig(TICGUARD_DEFAULTS, config);
}

/**
 * Turn the user's custom ban list (one phrase per entry; "/regex/" for a regular expression) and optional raw slop
 * entries into slop-list entries, appended to `base`. The result is memoized so compiled regexes are reused.
 */
const mergedCache = new Map();
export function mergeSlopList(base = [], customBans = [], customEntries = []) {
    const bans = (Array.isArray(customBans) ? customBans : []).map(x => String(x ?? '').trim()).filter(Boolean);
    const extra = (Array.isArray(customEntries) ? customEntries : []).filter(e => isPlainObject(e) && typeof e.pattern === 'string' && e.pattern);
    if (!bans.length && !extra.length) return base;
    const key = JSON.stringify([bans, extra]);
    const hit = mergedCache.get(key);
    if (hit && hit.base === base) return hit.list;
    const own = bans.map((b) => {
        const m = b.match(/^\/(.+)\/([a-z]*)$/);
        return m ? { pattern: m[1], kind: 'regex', note: 'custom ban' } : { pattern: b, note: 'custom ban' };
    });
    const list = [...(base || []), ...own, ...extra.map(e => ({ note: 'custom', ...e }))];
    if (mergedCache.size > 20) mergedCache.clear();
    mergedCache.set(key, { base, list });
    return list;
}

export function ngrams(toks, n) {
    const out = [];
    for (let i = 0; i + n <= toks.length; i++) out.push(toks.slice(i, i + n).join(' '));
    return out;
}

function meaningful(gram) {
    const parts = gram.split(' ');
    const content = parts.filter(t => !STOPWORDS.has(t) && t.length > 2);
    return content.length >= 2 || (content.length === 1 && parts.length >= 5 && content[0].length >= 5);
}

/** Phrases (3..6 words) of `reply` that also occur in any of `previous`. Longest-first, sub-phrases removed. */
export function findRepeatedNgrams(reply, previous, { minN = 3, maxN = 6, max = 5 } = {}) {
    const rt = tokens(reply);
    const prevSets = new Map();
    for (let n = minN; n <= maxN; n++) {
        const set = new Set();
        for (const p of previous || []) for (const g of ngrams(tokens(p), n)) set.add(g);
        prevSets.set(n, set);
    }
    const found = [];
    for (let n = maxN; n >= minN; n--) {
        for (const g of new Set(ngrams(rt, n))) {
            if (!prevSets.get(n).has(g) || !meaningful(g)) continue;
            if (found.some(f => f.includes(g))) continue;
            found.push(g);
        }
    }
    return found.slice(0, max);
}

const compiledCache = new WeakMap();

export function compileSlop(list) {
    if (compiledCache.has(list)) return compiledCache.get(list);
    const out = [];
    for (const e of list || []) {
        if (!isPlainObject(e) || !e.pattern) continue;
        try {
            let src;
            if (e.kind === 'regex') src = e.pattern;
            else {
                const body = escapeRegex(String(e.pattern).trim()).replace(/\s+/g, '\\s+');
                src = `${/^\w/.test(e.pattern) ? '\\b' : ''}${body}${/\w$/.test(e.pattern) ? '\\b' : ''}`;
            }
            out.push({ re: new RegExp(src, 'gim'), pattern: e.pattern, note: e.note || '', min: Number.isFinite(e.min) ? e.min : 1 });
        } catch { /* invalid pattern: skip */ }
    }
    compiledCache.set(list, out);
    return out;
}

/** Slop hits in `text`: [{pattern, note, match, count}] */
export function matchSlop(text, list) {
    const hits = [];
    const s = String(text ?? '');
    for (const c of compileSlop(list)) {
        c.re.lastIndex = 0;
        const ms = s.match(c.re);
        if (ms && ms.length) hits.push({ pattern: c.pattern, note: c.note, match: clip(ms[0], 60), count: ms.length, min: c.min });
    }
    return hits;
}

/** Spans of 4+ words from the player's spoken/public text repeated in the reply. */
export function detectEcho(reply, userMessage, { n = 4, max = 3, maxLen = 10 } = {}) {
    const pub = publicPart(userMessage);
    const ut = tokens(pub);
    if (ut.length < n) return [];
    const rset = new Set(ngrams(tokens(reply), n));
    const found = [];
    for (let len = Math.min(Math.max(n, maxLen), ut.length); len >= n; len--) {
        const rs = len === n ? rset : new Set(ngrams(tokens(reply), len));
        for (const g of ngrams(ut, len)) {
            if (!rs.has(g) || !meaningful(g)) continue;
            if (found.some(f => f.includes(g))) continue;
            found.push(g);
        }
    }
    return found.slice(0, max);
}

/** Phrases from the player's *private thoughts* that surface in the reply (characters reacting to unspoken thoughts). */
export function detectMindRead(reply, userMessage, { n = 3, max = 2 } = {}) {
    const thoughts = privateThoughts(userMessage);
    if (!thoughts.length) return [];
    const rset = new Set(ngrams(tokens(reply), n));
    const pubSet = new Set(ngrams(tokens(publicPart(userMessage)), n));
    const found = [];
    for (const t of thoughts) {
        for (const g of ngrams(tokens(t), n)) {
            if (rset.has(g) && !pubSet.has(g) && meaningful(g) && !found.some(f => f.includes(g))) found.push(g);
        }
    }
    return found.slice(0, max);
}

/** First words of a reply, normalized; and a structural class. */
export function openingSignature(text) {
    const s = String(text ?? '').trim();
    const t = tokens(s).slice(0, 3).join(' ');
    let cls = 'narration';
    if (/^["“]/.test(s)) cls = 'dialogue';
    else if (/^\*/.test(s)) cls = 'thought';
    return { words: t, cls };
}

/** True when the reply opens like one of the recent replies (same first 3 words), or the 3 latest share one class. */
export function detectOpeningRepeat(reply, previous, { window = 3, words = 3, classRun = 2 } = {}) {
    const sig = t => {
        const o = openingSignature(t);
        return words === 3 ? o : { ...o, words: tokens(String(t ?? '').trim()).slice(0, words).join(' ') };
    };
    const cur = sig(reply);
    if (!cur.words) return null;
    const prev = window > 0 ? (previous || []).slice(-window).map(sig) : [];
    if (prev.some(p => p.words === cur.words)) return { words: cur.words, kind: 'same words' };
    if (classRun > 0 && prev.length >= classRun && prev.slice(-classRun).every(p => p.cls === cur.cls) && cur.cls !== 'narration') return { words: cur.words, kind: `always opens with ${cur.cls}` };
    return null;
}

/** Story stall: no new fact/place/time/character for K turns. */
export function isStalled(state, turn, k = 4) {
    const last = state?.tics?.last_progress_turn ?? 0;
    return turn >= k && turn - last >= k;
}

/** Near-identical consecutive replies (content-token Jaccard). */
export function similarityStall(reply, previous, threshold = 0.55) {
    const last = (previous || [])[previous.length - 1];
    if (!last) return false;
    return jaccard(contentTokens(reply), contentTokens(last)) >= threshold;
}

/**
 * Analyze one finished reply and update tic state.
 * @param {object} p
 * @param {string} p.reply
 * @param {string[]} p.previous last assistant replies before this one (oldest first)
 * @param {string} p.userMessage the player's message this reply answered
 * @param {object[]} p.slopList
 * @param {object} p.tics current tic state
 * @returns {{findings:object, tics:object}}
 */
export function analyzeReply({ reply, previous = [], userMessage = '', slopList = [], tics = {}, config }) {
    const cfg = ticguardConfig(config);
    const on = k => cfg.detect?.[k] !== false;
    const repeats = on('repeats') ? findRepeatedNgrams(reply, previous, { minN: cfg.ngramMin, maxN: Math.max(cfg.ngramMin, cfg.ngramMax), max: cfg.maxRepeats }) : [];
    const findings = {
        repeats: repeats.length >= Math.max(1, cfg.repeatMinPhrases) ? repeats : [],
        slop: [],
        echo: on('echo') ? detectEcho(reply, userMessage, { n: cfg.echoMinWords, maxLen: cfg.echoMaxWords, max: cfg.echoMax }) : [],
        mindread: on('mindread') ? detectMindRead(reply, userMessage, { n: cfg.mindreadMinWords, max: cfg.mindreadMax }) : [],
        opening: on('opening') ? detectOpeningRepeat(reply, previous, { window: cfg.openingWindow, words: cfg.openingWords, classRun: cfg.openingClassRun }) : null,
        samey: on('samey') ? similarityStall(reply, previous, cfg.sameyThreshold) : false,
    };
    const counts = { ...(isPlainObject(tics.counts) ? tics.counts : {}) };
    // Slop: weak patterns (min > 1) need hits across this reply + recent replies.
    if (on('slop')) {
        const recentHits = new Map();
        for (const p of (cfg.slopRecent > 0 ? previous.slice(-cfg.slopRecent) : [])) for (const h of matchSlop(p, slopList)) recentHits.set(h.pattern, (recentHits.get(h.pattern) || 0) + h.count);
        for (const h of matchSlop(reply, slopList)) {
            const total = h.count + (recentHits.get(h.pattern) || 0);
            if (total >= h.min) findings.slop.push(h);
        }
    }
    const keys = [
        ...findings.slop.map(h => `slop:${h.pattern}`),
        ...findings.repeats.map(r => `repeat:${r}`),
        ...(findings.echo.length ? ['echo'] : []),
        ...(findings.mindread.length ? ['mindread'] : []),
        ...(findings.opening ? ['opening'] : []),
        ...(findings.samey ? ['samey'] : []),
    ];
    for (const k of keys) counts[k] = (counts[k] || 0) + 1;
    // Decay: entries not seen this reply fade.
    for (const k of Object.keys(counts)) {
        if (!keys.includes(k)) {
            counts[k] = Math.max(0, counts[k] - cfg.decay);
            if (counts[k] === 0) delete counts[k];
        }
    }
    // Bound the table.
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, cfg.countsMax);
    const dirty = keys.length > 0;
    const streak = dirty ? (tics.streak || 0) + 1 : 0;
    const level = dirty ? escalationLevel(streak, cfg) : Math.max(0, (tics.level || 0) - 1);
    const next = {
        ...tics,
        counts: Object.fromEntries(entries),
        streak,
        level,
    };
    next.pending = correctionLines(findings, next, cfg);
    return { findings, tics: next };
}

/** Correction level for a streak of dirty replies: 1 = nudge, 2 = firm, 3 = hard ban (capped at maxLevel). */
export function escalationLevel(streak, config) {
    const cfg = ticguardConfig(config);
    if (streak <= 0) return 0;
    const lvl = streak >= cfg.level3Streak ? 3 : streak >= cfg.level2Streak ? 2 : 1;
    return Math.max(0, Math.min(cfg.maxLevel, lvl));
}

/**
 * Short, escalating corrections for the next reply. Level 1 = nudge, 2 = firm, 3 = hard ban. At most 4 lines.
 */
export function correctionLines(findings, tics, config) {
    const cfg = ticguardConfig(config);
    const level = tics?.level || 0;
    const counts = tics?.counts || {};
    if (!findings || level === 0) return [];
    const t = (k, vars) => renderTemplate(cfg.text?.[k] ?? TICGUARD_DEFAULTS.text[k], vars);
    const lines = [];
    const verb = cfg.verbs?.[Math.min(3, level)] ?? TICGUARD_DEFAULTS.verbs[Math.min(3, level)];
    if (findings.mindread?.length) {
        lines.push(t('mindread', { uc_phrase: findings.mindread[0] }));
    }
    if (findings.slop?.length) {
        const items = findings.slop
            .sort((a, b) => (counts[`slop:${b.pattern}`] || 0) - (counts[`slop:${a.pattern}`] || 0))
            .slice(0, level >= 2 ? cfg.slopItemsFirm : cfg.slopItemsSoft)
            .map(h => `"${h.match}"`);
        lines.push(t('slop', { uc_verb: verb, uc_items: items.join(', ') }));
    }
    if (findings.repeats?.length) {
        const items = findings.repeats.slice(0, cfg.repeatItems).map(r => `"${r}"`).join(', ');
        lines.push(t(level >= 2 ? 'repeatFirm' : 'repeatSoft', { uc_items: items }));
    }
    if (findings.echo?.length) {
        lines.push(t('echo', { uc_phrase: findings.echo[0] }));
    }
    if (findings.opening) {
        lines.push(t('opening', { uc_phrase: findings.opening.words }));
    }
    if (findings.samey && lines.length < cfg.maxLines) {
        lines.push(t('samey', {}));
    }
    return lines.filter(Boolean).slice(0, cfg.maxLines);
}
