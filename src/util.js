// Undercurrent — small pure helpers shared by every engine. No DOM, no SillyTavern globals.

/** FNV-1a 32-bit hash of a string, as 8 hex chars. Whitespace is collapsed first so trivial reflows don't count as edits. */
export function hashText(text) {
    const s = String(text ?? '').replace(/\s+/g, ' ').trim();
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

/** Lowercase, strip punctuation (keeping apostrophes inside words), collapse whitespace. */
export function normText(text) {
    return String(text ?? '')
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

export const STOPWORDS = new Set(('a an the and or but if then so of to in on at by for with from into onto as is are was were be been being ' +
    'i me my mine you your yours he him his she her hers it its we us our they them their this that these those there here ' +
    'not no do does did done have has had will would can could should shall may might must just very too also than up down out ' +
    'over under again once only own same s t don didn doesn isn wasn weren won wouldn couldn shouldn what which who whom whose ' +
    'when where why how all any both each few more most other some such about against between through during before after above ' +
    'below off further am o re ve ll d m').split(/\s+/));

export function contentTokens(text) {
    return tokens(text).filter(t => !STOPWORDS.has(t));
}

/** Jaccard similarity of two token sets (0..1). */
export function jaccard(a, b) {
    const A = a instanceof Set ? a : new Set(a);
    const B = b instanceof Set ? b : new Set(b);
    if (A.size === 0 && B.size === 0) return 0;
    let inter = 0;
    for (const x of A) if (B.has(x)) inter++;
    return inter / (A.size + B.size - inter);
}

export function clamp(n, lo, hi) {
    const x = Number(n);
    if (!Number.isFinite(x)) return lo;
    return Math.min(hi, Math.max(lo, x));
}

/** Trim a string to at most maxChars, cutting at a word boundary and adding an ellipsis. */
export function clip(text, maxChars) {
    const s = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (!maxChars || s.length <= maxChars) return s;
    const cut = s.slice(0, maxChars);
    const sp = cut.lastIndexOf(' ');
    return (sp > maxChars * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, '') + '…';
}

/** Truncate a long block keeping its head (and a short tail when there is room). */
export function truncateBlock(text, maxChars) {
    const s = String(text ?? '').trim();
    if (!maxChars || s.length <= maxChars) return s;
    const head = Math.floor(maxChars * 0.8);
    const tail = maxChars - head - 5;
    return s.slice(0, head).trimEnd() + '\n[…]\n' + (tail > 40 ? s.slice(-tail).trimStart() : '');
}

export function wordCount(text) {
    const s = String(text ?? '').trim();
    return s ? s.split(/\s+/).length : 0;
}

export function deepClone(obj) {
    if (obj === undefined) return undefined;
    return JSON.parse(JSON.stringify(obj));
}

export function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Case-insensitive lookup of an existing key in an object. */
export function findKeyCI(obj, key) {
    if (!isPlainObject(obj)) return null;
    const k = String(key ?? '').trim().toLowerCase();
    if (!k) return null;
    for (const name of Object.keys(obj)) {
        if (name.toLowerCase() === k) return name;
    }
    return null;
}

/** Remove reasoning blocks (<think>…</think> etc.), including a dangling close tag with no opener. */
export function stripReasoning(text) {
    let s = String(text ?? '');
    s = s.replace(/<(think|thinking|reasoning|reflection)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
    // A closing tag with no opener: everything before it was reasoning.
    const dangling = s.match(/<\/(think|thinking|reasoning)\s*>/i);
    if (dangling) s = s.slice(dangling.index + dangling[0].length);
    // An opener that never closed (truncated output): drop it and what follows only if nothing useful precedes it.
    const open = s.match(/<(think|thinking|reasoning)\b[^>]*>/i);
    if (open) {
        const before = s.slice(0, open.index);
        const after = s.slice(open.index + open[0].length);
        s = /[{[]/.test(after) && !/[{[]/.test(before) ? after : before;
    }
    return s.trim();
}

/** Strip hidden in-reply blocks <!--uc … --> (closed or truncated at the end). */
export function stripUcBlocks(text) {
    return String(text ?? '')
        .replace(/[ \t]*\n?[ \t]*<!--\s*uc\b[\s\S]*?-->/gi, '')
        .replace(/[ \t]*\n?[ \t]*<!--\s*uc\b[\s\S]*$/i, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** Mulberry32 seeded PRNG returning a function () => [0,1). */
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

export function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
