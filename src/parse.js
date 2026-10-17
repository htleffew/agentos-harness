// Undercurrent — robust JSON extraction from model output. Never throws.
//
// Handles: <think>…</think> reasoning, ```json fences, leading/trailing prose, trailing commas, smart quotes,
// // and /* */ comments, unquoted keys, single-quoted strings (best effort) and output truncated mid-object.

import { stripReasoning, stripUcBlocks, isPlainObject, clip } from './util.js';

/** Scan from `start` (a '{' or '[') to its balanced close, respecting strings. Returns end index or -1. */
function balancedEnd(text, start) {
    const stack = [];
    let inStr = false;
    let quote = '';
    let esc = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inStr) {
            if (esc) esc = false;
            else if (ch === '\\') esc = true;
            else if (ch === quote) inStr = false;
            continue;
        }
        if (ch === '"') { inStr = true; quote = ch; continue; }
        if (ch === '{' || ch === '[') stack.push(ch);
        else if (ch === '}' || ch === ']') {
            const open = stack.pop();
            if ((ch === '}' && open !== '{') || (ch === ']' && open !== '[')) return -1;
            if (stack.length === 0) return i;
        }
    }
    return -1;
}

/** Close a truncated JSON prefix: drop the dangling partial token and append the missing closers. */
function closeTruncated(text) {
    const stack = [];
    let inStr = false;
    let esc = false;
    let lastSafe = -1;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inStr) {
            if (esc) esc = false;
            else if (ch === '\\') esc = true;
            else if (ch === '"') { inStr = false; }
            continue;
        }
        if (ch === '"') { inStr = true; continue; }
        if (ch === '{' || ch === '[') { stack.push(ch); lastSafe = i; }
        else if (ch === '}' || ch === ']') { stack.pop(); lastSafe = i; }
        else if (ch === ',') lastSafe = i - 1;
    }
    let body = text;
    if (inStr || !/[}\]"\d\w]\s*$/.test(body)) body = body.slice(0, lastSafe + 1);
    // Recount the stack for the cut body.
    const st2 = [];
    inStr = false; esc = false;
    for (const ch of body) {
        if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
        if (ch === '"') inStr = true;
        else if (ch === '{' || ch === '[') st2.push(ch);
        else if (ch === '}' || ch === ']') st2.pop();
    }
    body = body.replace(/[,:]\s*$/, '');
    // A dangling key with no value ("key" at the end of an object) is removed.
    body = body.replace(/,\s*"[^"]*"\s*$/, '');
    return body + st2.reverse().map(c => (c === '{' ? '}' : ']')).join('');
}

/** Light, string-aware repairs that keep valid JSON valid: comments, trailing commas, unquoted keys, Python literals. */
export function repairJson(text) {
    const s = String(text ?? '')
        .replace(/^\uFEFF/, '')
        .replace(/[\u201c\u201d\u201e\u201f]/g, '"')
        .replace(/[\u2018\u2019]/g, '\'');
    let out = '';
    let inStr = false;
    let esc = false;
    let prevSig = ''; // last significant char emitted outside strings
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
            out += ch;
            if (esc) esc = false;
            else if (ch === '\\') esc = true;
            else if (ch === '"') { inStr = false; prevSig = '"'; }
            continue;
        }
        if (ch === '"') { inStr = true; out += ch; continue; }
        if (ch === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; out += '\n'; continue; }
        if (ch === '/' && s[i + 1] === '*') { const end = s.indexOf('*/', i + 2); i = end === -1 ? s.length : end + 1; continue; }
        if (ch === ',') {
            let j = i + 1;
            while (j < s.length && /\s/.test(s[j])) j++;
            if (s[j] === '}' || s[j] === ']') continue; // trailing comma
            out += ch; prevSig = ch; continue;
        }
        if (/[A-Za-z_]/.test(ch)) {
            let j = i;
            while (j < s.length && /[\w-]/.test(s[j])) j++;
            const word = s.slice(i, j);
            let k = j;
            while (k < s.length && /\s/.test(s[k])) k++;
            if ((prevSig === '{' || prevSig === ',') && s[k] === ':') {
                out += `"${word}"`;
            } else if (word === 'None') out += 'null';
            else if (word === 'True') out += 'true';
            else if (word === 'False') out += 'false';
            else out += word;
            prevSig = word.slice(-1);
            i = j - 1;
            continue;
        }
        out += ch;
        if (!/\s/.test(ch)) prevSig = ch;
    }
    return out;
}

function singleToDouble(s) {
    // Only when there are no double quotes at all: convert 'x' strings to "x".
    if (s.includes('"')) return s;
    return s.replace(/'((?:[^'\\]|\\.)*)'/g, (_, inner) => `"${inner.replace(/"/g, '\\"')}"`);
}

function tryParse(s) {
    try { return { ok: true, value: JSON.parse(s) }; } catch { /* fallthrough */ }
    const r = repairJson(s);
    try { return { ok: true, value: JSON.parse(r) }; } catch { /* fallthrough */ }
    try { return { ok: true, value: JSON.parse(repairJson(singleToDouble(s))) }; } catch { /* fallthrough */ }
    return { ok: false, value: null };
}

/** Collect candidate JSON substrings, best first. */
function candidates(text) {
    const out = [];
    const fence = /```(?:json|JSON|js|javascript)?\s*\n?([\s\S]*?)```/g;
    let m;
    while ((m = fence.exec(text))) out.push(m[1].trim());
    // Unterminated fence (truncated output).
    const openFence = text.match(/```(?:json|JSON)?\s*\n?([\s\S]*)$/);
    if (openFence && !openFence[1].includes('```')) out.push(openFence[1].trim());
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch !== '{' && ch !== '[') continue;
        const end = balancedEnd(text, i);
        if (end !== -1) {
            out.push(text.slice(i, end + 1));
            if (ch === '{') i = end; // skip nested; arrays may contain the object we want, keep scanning
        } else {
            out.push({ truncated: true, text: closeTruncated(text.slice(i)) });
            break;
        }
    }
    return out;
}

/**
 * Extract the first JSON value from model output.
 * @param {string} text
 * @param {{prefer?:'object'|'array'|'any'}} [opts]
 * @returns {any|null}
 */
export function extractJson(text, opts = {}) {
    const prefer = opts.prefer || 'object';
    let s = stripReasoning(String(text ?? ''));
    if (!s) return null;
    const direct = tryParse(s.trim());
    if (direct.ok && (prefer === 'any' || (prefer === 'object' ? isPlainObject(direct.value) : Array.isArray(direct.value)))) return direct.value;
    let fallback = null;
    for (const cand of candidates(s)) {
        const c = typeof cand === 'string' ? cand : cand.text;
        const r = tryParse(c);
        if (!r.ok || r.value === null || typeof r.value !== 'object') continue;
        // A repaired truncation that recovered nothing is not a result.
        if (typeof cand !== 'string' && Object.keys(r.value).length === 0) continue;
        if (prefer === 'any') return r.value;
        if (prefer === 'object' && isPlainObject(r.value)) return r.value;
        if (prefer === 'array' && Array.isArray(r.value)) return r.value;
        if (fallback === null) fallback = r.value;
    }
    if (direct.ok && direct.value && typeof direct.value === 'object') return direct.value;
    return fallback;
}

/** Same as extractJson but returns `fallback` when nothing usable is found or `validate` rejects it. */
export function parseJsonSafe(text, { fallback = null, validate = null, prefer = 'object' } = {}) {
    try {
        const v = extractJson(text, { prefer });
        if (v === null || v === undefined) return fallback;
        if (validate) {
            const out = validate(v);
            return out === null || out === undefined ? fallback : out;
        }
        return v;
    } catch {
        return fallback;
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Shape helpers (coercion, never throw)

export function asString(v, max = 300) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return clip(v, max);
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) return clip(v.filter(x => typeof x === 'string').join('; '), max);
    return '';
}

export function asArray(v, max = 10) {
    if (Array.isArray(v)) return v.slice(0, max);
    if (v === null || v === undefined || v === '') return [];
    return [v].slice(0, max);
}

export function asEnum(v, allowed, def) {
    const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
    return allowed.includes(s) ? s : def;
}

export function asObjectList(v, fields, { max = 6, required = [] } = {}) {
    return asArray(v, max)
        .map(x => (typeof x === 'string' && fields.length ? { [fields[0]]: x } : x))
        .filter(isPlainObject)
        .map(x => Object.fromEntries(fields.map(f => [f, asString(x[f], 240)])))
        .filter(x => required.every(f => x[f]));
}

// ---------------------------------------------------------------------------------------------------------------------
// In-reply hidden block <!--uc {json} -->

/**
 * Extract the last <!--uc … --> block from a reply and return the reply without any such blocks.
 * @returns {{clean:string, found:boolean, json:any|null}}
 */
export function extractInreplyBlock(text) {
    const src = String(text ?? '');
    const re = /<!--\s*uc\b([\s\S]*?)(?:-->|$)/gi;
    let m;
    let last = null;
    while ((m = re.exec(src))) {
        last = m[1];
        if (m[0].length === 0) break;
    }
    const clean = stripUcBlocks(src);
    if (last === null) return { clean, found: false, json: null };
    const json = extractJson(last, { prefer: 'any' });
    return { clean, found: true, json };
}
