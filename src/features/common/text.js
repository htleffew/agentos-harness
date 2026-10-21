// Undercurrent 2 · FEATURES — small pure text helpers shared by every provider. No DOM, no SillyTavern globals.

import { STOPWORDS } from './lexicon.js';

export function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function str(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return '';
}

/** FNV-1a 32-bit hash of a string (whitespace collapsed first, so reflows are not edits), as 8 hex chars. */
export function hashText(text) {
    const s = str(text).replace(/\s+/g, ' ').trim();
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

/** Same hash as a positive 31-bit integer (ST vector items need numeric hashes). */
export function hashNumber(text) {
    return parseInt(hashText(text), 16) & 0x7fffffff;
}

/** Lowercase, strip punctuation (keeping apostrophes inside words), collapse whitespace. */
export function normText(text) {
    return str(text)
        .toLowerCase()
        .replace(/[‘’]/g, '\'')
        .replace(/[“”]/g, '"')
        .replace(/[^\p{L}\p{N}'\s]+/gu, ' ')
        .replace(/(^|\s)'+|'+(\s|$)/g, '$1$2')
        .replace(/\s+/g, ' ')
        .trim();
}

export function tokens(text) {
    const n = normText(text);
    return n ? n.split(' ') : [];
}

export function contentTokens(text) {
    return tokens(text).filter(t => !STOPWORDS.has(t));
}

export function wordCount(text) {
    const s = str(text).trim();
    return s ? s.split(/\s+/).length : 0;
}

/** Jaccard similarity of two token collections (0..1). */
export function jaccard(a, b) {
    const A = a instanceof Set ? a : new Set(a);
    const B = b instanceof Set ? b : new Set(b);
    if (!A.size && !B.size) return 0;
    let inter = 0;
    for (const x of A) if (B.has(x)) inter++;
    return inter / (A.size + B.size - inter);
}

export function clamp(n, lo, hi) {
    const x = Number(n);
    if (!Number.isFinite(x)) return lo;
    return Math.min(hi, Math.max(lo, x));
}

/** Trim to at most maxChars at a word boundary, with an ellipsis. */
export function clip(text, maxChars) {
    const s = str(text).replace(/\s+/g, ' ').trim();
    if (!maxChars || s.length <= maxChars) return s;
    const cut = s.slice(0, maxChars);
    const sp = cut.lastIndexOf(' ');
    return (sp > maxChars * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, '') + '…';
}

/** Keep at most maxWords words, preferring to end on a sentence boundary. */
export function clipWords(text, maxWords) {
    const s = str(text).replace(/\s+/g, ' ').trim();
    const w = s.split(' ');
    if (!s || w.length <= maxWords) return s;
    const head = w.slice(0, maxWords).join(' ');
    const end = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '), /[.!?]["”]?$/.test(head) ? head.length - 1 : -1);
    if (end > head.length * 0.5) return head.slice(0, end + 1).trim();
    return head.replace(/[\s,;:-]+$/, '') + '…';
}

export function escapeRegex(s) {
    return str(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Remove reasoning blocks (<think>…</think> and friends), including a dangling close tag with no opener. */
export function stripThink(text) {
    let s = str(text);
    s = s.replace(/<(think|thinking|reasoning|reflection)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
    const dangling = s.match(/<\/(think|thinking|reasoning)\s*>/i);
    if (dangling) s = s.slice(dangling.index + dangling[0].length);
    const open = s.match(/<(think|thinking|reasoning)\b[^>]*>/i);
    if (open) s = s.slice(0, open.index);
    return s.trim();
}

/** Envelope block tags the model may emit (BUILD_SPEC §3.1). */
export const ENVELOPE_TAGS = ['Scene', 'Minds', 'Threads', 'Facts', 'Intimacy', 'New_Character', 'Tracker'];
const BARE_BLOCK = new RegExp(`(^|\\n)[ \\t]*<(?:${ENVELOPE_TAGS.join('|')})\\b[^>]*>`, 'i');

/** Remove the <UC> envelope (closed or truncated) and bare envelope blocks emitted without the wrapper at the end. */
export function stripEnvelope(text) {
    let s = str(text);
    s = s.replace(/<UC\b[^>]*>[\s\S]*?(?:<\/UC\s*>|$)/gi, '');
    const bare = s.match(BARE_BLOCK);
    if (bare) s = s.slice(0, bare.index);
    return s.replace(/<\/UC\s*>/gi, '').trim();
}

/** Story prose of a reply: no <think>, no envelope, no leftover rule tags. */
export function cleanReply(text) {
    return stripEnvelope(stripThink(text)).replace(/\[\[uc_[a-z0-9_]+\]\]/gi, '').replace(/<\/?uc_[a-z0-9_]+[^>]*>/gi, '').trim();
}

const THOUGHT_RE = /(^|[^*])\*(?!\*)([^*\n]+?)\*(?!\*)/g;

/** Text in single asterisks (private thoughts in user messages; *thoughts* of {{char}} in replies). */
export function privateThoughts(text) {
    const out = [];
    const s = str(text);
    THOUGHT_RE.lastIndex = 0;
    let m;
    while ((m = THOUGHT_RE.exec(s))) out.push(m[2].trim());
    return out;
}

/** The text with *private thoughts* removed (what the other characters could actually perceive). */
export function publicPart(text) {
    return str(text).replace(THOUGHT_RE, '$1').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

/** Narration only: no "quoted dialogue", no *thoughts*. */
export function narrationOf(text) {
    return str(text)
        .replace(/"[^"\n]*"|“[^”\n]*”/g, ' ')
        .replace(THOUGHT_RE, '$1 ')
        .replace(/[ \t]+/g, ' ')
        .trim();
}

export function dialogueSpans(text) {
    return str(text).match(/"[^"\n]+"|“[^”\n]+”/g) || [];
}

export function ngrams(toks, n) {
    const out = [];
    for (let i = 0; i + n <= toks.length; i++) out.push(toks.slice(i, i + n).join(' '));
    return out;
}

/** A phrase worth flagging: at least two content words (or one long one inside a long phrase). */
export function meaningful(gram) {
    const parts = gram.split(' ');
    const content = parts.filter(t => !STOPWORDS.has(t) && t.length > 2);
    return content.length >= 2 || (content.length === 1 && parts.length >= 5 && content[0].length >= 5);
}

/** Single-brace tokens used by content text (directive phrases and job templates) and filled by FEATURES or CORE. */
export const LOCAL_TOKENS = ['card', 'persona', 'state', 'recent', 'previous', 'messages', 'range', 'value', 'phrase', 'quote', 'name', 'n',
    'detail', 'items', 'verb', 'place', 'time', 'weather', 'someone'];
const LOCAL_RE = new RegExp(`\\{(${LOCAL_TOKENS.join('|')})\\}`, 'g');
const UC_RE = /\{\{\s*uc\.([a-z0-9_]+)\s*\}\}/gi;

function tidy(text) {
    return text.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([,.;:!?])/g, '$1').replace(/\(\s*""\s*\)/g, '').trim();
}

/**
 * Fill a content text for a turn line: single-brace tokens ({phrase} {quote} {name} {n} …) and {{uc.name}}
 * placeholders from `vars`. Known tokens without a value become '' and are reported in `missing`. ST macros
 * ({{user}}, {{char}}) are left for SillyTavern. Returns {text, missing}.
 */
export function fillTokens(template, vars = {}) {
    const missing = [];
    const val = (name) => {
        const v = vars[String(name).toLowerCase()];
        if (v === undefined || v === null || str(v).trim() === '') { missing.push(String(name).toLowerCase()); return ''; }
        return str(v);
    };
    const text = str(template).replace(LOCAL_RE, (_, n) => val(n)).replace(UC_RE, (_, n) => val(n));
    return { text: tidy(text), missing };
}

/** Back-compat alias. */
export const fillUc = fillTokens;

/** Fill only the tokens we have values for; everything else stays for CORE's job filler. */
export function fillProvided(template, vars = {}) {
    const has = n => vars[n] !== undefined && vars[n] !== null && str(vars[n]) !== '';
    return str(template)
        .replace(LOCAL_RE, (all, n) => (has(n) ? str(vars[n]) : all))
        .replace(UC_RE, (all, n) => (has(n.toLowerCase()) ? str(vars[n.toLowerCase()]) : all));
}

/** True when a template uses a token ({name} or {{uc.name}}). */
export function usesToken(template, name) {
    return new RegExp(`\\{${name}\\}|\\{\\{\\s*uc\\.${name}\\s*\\}\\}`, 'i').test(str(template));
}

/** Mulberry32 seeded PRNG → () => [0,1). Used only as a fallback when ctx.rng is missing. */
export function makeRng(seed) {
    let a = (Number(seed) >>> 0) || 0x9e3779b9;
    return function rng() {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Distinct cues from a list found in a text. A cue is a whole word ("bed"), a word start with a trailing * ("kiss*" →
 * kiss, kisses, kissing) or a hyphenated phrase ("skin-to-skin"). Token-based (no regex), so it is cheap even cold.
 */
export function cueHits(text, cues) {
    const norm = normText(text);
    if (!norm) return [];
    const words = norm.split(' ');
    const set = new Set(words);
    const padded = ` ${norm} `;
    const out = [];
    for (const cue of cues || []) {
        const c = str(cue).toLowerCase();
        const prefix = c.endsWith('*');
        const base = normText(prefix ? c.slice(0, -1) : c);
        if (!base) continue;
        let hit;
        if (base.includes(' ')) hit = prefix ? padded.includes(` ${base}`) : padded.includes(` ${base} `);
        else hit = prefix ? words.some(w => w.startsWith(base)) : set.has(base);
        if (hit) out.push(cue);
    }
    return out;
}
