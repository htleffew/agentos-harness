// Undercurrent 2: small shared helpers. Pure (no DOM, no SillyTavern).

/** FNV-1a 32-bit hash of a string, as 8 hex chars. Fast and stable; used for cache keys only. */
export function hashText(text) {
    const s = String(text ?? '');
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
}

/** Deep clone of plain data (structuredClone when available). */
export function clone(value) {
    if (value === undefined) return undefined;
    try {
        if (typeof structuredClone === 'function') return structuredClone(value);
    } catch { /* fall through: values with functions */ }
    return JSON.parse(JSON.stringify(value));
}

export function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Stable JSON (sorted keys) for signatures. */
export function stableStringify(value) {
    const seen = new WeakSet();
    const walk = (v) => {
        if (v === null || typeof v !== 'object') return v;
        if (seen.has(v)) return null;
        seen.add(v);
        if (Array.isArray(v)) return v.map(walk);
        const out = {};
        for (const k of Object.keys(v).sort()) out[k] = walk(v[k]);
        return out;
    };
    return JSON.stringify(walk(value));
}

/** Simple trailing debounce; returned function has .flush() and .cancel(). */
export function debounce(fn, ms, timers = globalThis) {
    let t = null;
    let lastArgs = [];
    const run = () => {
        t = null;
        fn(...lastArgs);
    };
    const d = (...args) => {
        lastArgs = args;
        if (t) timers.clearTimeout(t);
        t = timers.setTimeout(run, ms);
    };
    d.flush = () => {
        if (t) {
            timers.clearTimeout(t);
            run();
        }
    };
    d.cancel = () => {
        if (t) timers.clearTimeout(t);
        t = null;
    };
    d.pending = () => !!t;
    return d;
}

/** RFC 4122 v4 uuid from crypto (falls back to Math.random only where crypto is missing). */
export function uuid() {
    const c = globalThis.crypto;
    if (c?.randomUUID) return c.randomUUID();
    const b = new Uint8Array(16);
    if (c?.getRandomValues) c.getRandomValues(b);
    else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Crypto-backed uniform float in [0, 1). */
export function cryptoRandom() {
    const c = globalThis.crypto;
    if (c?.getRandomValues) {
        const a = new Uint32Array(2);
        c.getRandomValues(a);
        // 53 random bits
        return ((a[0] >>> 5) * 67108864 + (a[1] >>> 6)) / 9007199254740992;
    }
    return Math.random();
}

/** Seedable PRNG (mulberry32) for tests. */
export function seededRandom(seed = 1) {
    let a = (Number(seed) >>> 0) || 1;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function wordCount(text) {
    const m = String(text ?? '').trim().match(/\S+/g);
    return m ? m.length : 0;
}

/** Rough token estimate (chars / 3.5). */
export function estimateTokens(text) {
    return Math.ceil(String(text ?? '').length / 3.5);
}

export function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Lower-case, collapse whitespace, strip surrounding punctuation: used to compare names and fact texts. */
export function normKey(text) {
    return String(text ?? '')
        .toLowerCase()
        .replace(/[‘’]/g, '\'')
        .replace(/[“”]/g, '"')
        .replace(/\s+/g, ' ')
        .replace(/^[\s"'*_`.,;:!?()[\]-]+|[\s"'*_`.,;:!?()[\]-]+$/g, '')
        .trim();
}

/** Replace every occurrence of `needle` without String.replace's `$` patterns. */
export function replaceAllLiteral(haystack, needle, replacement) {
    if (!needle) return haystack;
    return String(haystack).split(needle).join(String(replacement));
}

/** Read a dotted path; array segments are matched by element `id` (or a numeric index). */
export function getPath(obj, path) {
    let cur = obj;
    for (const seg of String(path).split('.')) {
        if (cur == null) return undefined;
        if (Array.isArray(cur)) {
            const byId = cur.find(x => x && typeof x === 'object' && String(x.id) === seg);
            cur = byId !== undefined ? byId : (/^\d+$/.test(seg) ? cur[Number(seg)] : undefined);
        } else if (typeof cur === 'object') {
            cur = cur[seg];
        } else {
            return undefined;
        }
    }
    return cur;
}

/** Write a dotted path in place (arrays by element id or index). Returns true when written. */
export function setPath(obj, path, value) {
    const segs = String(path).split('.');
    let cur = obj;
    for (let i = 0; i < segs.length - 1; i++) {
        const seg = segs[i];
        let next;
        if (Array.isArray(cur)) {
            next = cur.find(x => x && typeof x === 'object' && String(x.id) === seg);
            if (next === undefined && /^\d+$/.test(seg)) next = cur[Number(seg)];
        } else if (cur && typeof cur === 'object') {
            if (cur[seg] == null || typeof cur[seg] !== 'object') cur[seg] = {};
            next = cur[seg];
        }
        if (next == null || typeof next !== 'object') return false;
        cur = next;
    }
    const last = segs[segs.length - 1];
    if (Array.isArray(cur)) {
        const idx = cur.findIndex(x => x && typeof x === 'object' && String(x.id) === last);
        if (idx >= 0) cur[idx] = value;
        else if (/^\d+$/.test(last)) cur[Number(last)] = value;
        else return false;
        return true;
    }
    if (!cur || typeof cur !== 'object') return false;
    cur[last] = value;
    return true;
}

/** Tiny event emitter. */
export function createEmitter() {
    const map = new Map();
    return {
        on(ev, fn) {
            if (typeof fn !== 'function') return;
            if (!map.has(ev)) map.set(ev, new Set());
            map.get(ev).add(fn);
        },
        off(ev, fn) {
            map.get(ev)?.delete(fn);
        },
        emit(ev, payload) {
            for (const fn of [...(map.get(ev) || [])]) {
                try { fn(payload); } catch (e) { try { console.warn('[Undercurrent 2] listener failed', ev, e); } catch { /* ignore */ } }
            }
        },
    };
}
