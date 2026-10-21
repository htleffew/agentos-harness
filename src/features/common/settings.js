// Undercurrent 2 · FEATURES — settings, content and store access with safe fallbacks.

import { str, isPlainObject, fillTokens } from './text.js';

/**
 * A feature setting. ctx.settings is CORE's effective settings object; keys are flat ("events.drama"). A nested
 * shape ({events:{drama}}) is accepted too. Falls back to `def`.
 */
export function opt(ctx, key, def) {
    const s = isPlainObject(ctx?.settings) ? ctx.settings : {};
    if (Object.prototype.hasOwnProperty.call(s, key) && s[key] !== undefined && s[key] !== null) return s[key];
    const dot = key.indexOf('.');
    if (dot > 0) {
        const group = s[key.slice(0, dot)];
        const v = isPlainObject(group) ? group[key.slice(dot + 1)] : undefined;
        if (v !== undefined && v !== null) return v;
    }
    return def;
}

export function optBool(ctx, key, def) {
    const v = opt(ctx, key, def);
    if (typeof v === 'string') return !/^(false|off|0|no)$/i.test(v.trim());
    return !!v;
}

export function optNum(ctx, key, def, lo = -Infinity, hi = Infinity) {
    const n = Number(opt(ctx, key, def));
    if (!Number.isFinite(n)) return def;
    return Math.min(hi, Math.max(lo, n));
}

/** First defined value among several possible keys (settings owned by CORE/CONTENT whose exact key may vary). */
export function optAny(ctx, keys, def = '') {
    for (const k of keys) {
        const v = opt(ctx, k, undefined);
        if (v !== undefined && v !== null && v !== '') return v;
    }
    return def;
}

/** Narrator persona id, tone id and genre id (CONTENT_SETTINGS keys; several spellings accepted). */
export function personaId(ctx) {
    return str(optAny(ctx, ['persona', 'narrator.persona', 'narrator_persona', 'story.persona'], ''));
}
export function toneId(ctx) {
    return str(optAny(ctx, ['tone', 'story.tone'], ''));
}
export function genreId(ctx) {
    return str(optAny(ctx, ['genre', 'story.genre'], ''));
}
export function ruleVoice(ctx) {
    return str(optAny(ctx, ['rule_voice', 'narrator.rule_voice'], 'loud'));
}

export function content(ctx) {
    return isPlainObject(ctx?.content) ? ctx.content : {};
}

/** The active narrator persona object from content.personas (by setting id, else the default one). */
export function activePersona(ctx) {
    const list = Array.isArray(content(ctx).personas) ? content(ctx).personas.filter(isPlainObject) : [];
    const id = personaId(ctx);
    return list.find(p => p.id === id) || list.find(p => p.default) || null;
}

/** A content option object (e.g. kind 'tone', id 'dark'). */
export function contentOption(ctx, kind, id) {
    const list = content(ctx).options?.[kind];
    return Array.isArray(list) ? list.find(o => isPlainObject(o) && o.id === id) || null : null;
}

/** directive_phrases[key] as a list of non-empty strings (a single string becomes a one-item list). */
export function phrases(ctx, key) {
    const v = content(ctx).directive_phrases?.[key];
    const list = Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
    return list.map(x => str(x).trim()).filter(Boolean);
}

/** One directive phrase (the first) with tokens filled; falls back to the built-in text. */
export function phrase(ctx, key, fallback, vars = {}) {
    const list = phrases(ctx, key);
    return fillTokens(list.length ? list[0] : fallback, vars).text;
}

const joinText = v => (Array.isArray(v) ? v.map(str).join('\n') : str(v));

/**
 * A job prompt from content.jobs: {system, user, output}. Arrays of lines are joined. The plain system text is used
 * when the rule voice is plain or no narrator persona is active (and the content has one).
 */
export function jobPrompt(ctx, kind) {
    const j = content(ctx).jobs?.[kind];
    if (!isPlainObject(j)) return { system: '', user: '', output: '' };
    const persona = activePersona(ctx);
    const plain = ruleVoice(ctx) === 'plain' || !persona || persona.id === 'none';
    const system = plain && j.system_plain ? joinText(j.system_plain) : joinText(j.system);
    return { system, user: joinText(j.user), output: str(j._output) };
}

/** Store access that never throws (ctx.store may be missing in odd contexts). */
export function sget(ctx, key, def) {
    try {
        const v = ctx?.store?.get?.(key);
        return v === undefined || v === null ? def : v;
    } catch { return def; }
}

export function sset(ctx, key, value) {
    try { ctx?.store?.set?.(key, value); } catch { /* storage is best-effort */ }
}

/** ctx.rng with a fallback. */
export function rngOf(ctx) {
    return typeof ctx?.rng === 'function' ? ctx.rng : Math.random;
}

/** Pick an index from a list with rng, avoiding `avoid` (an index or text) when there is a choice. */
export function pickVaried(list, rng, avoid) {
    if (!list.length) return -1;
    const options = list.map((x, i) => i).filter(i => list.length === 1 || (i !== avoid && list[i] !== avoid));
    const r = Math.min(0.999999, Math.max(0, Number(rng()) || 0));
    return options[Math.floor(r * options.length)];
}
