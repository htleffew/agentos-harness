// Undercurrent 2 · FEATURES — chance rules engine (trigger → directive line). Pure logic.
//
// A rule: {id, name, enabled, pack, priority 1..5, logic "any"|"all", triggers:[...], cooldown, sticky, max_fires,
//          pool:[lines], pick:"random"|"cycle"}
// Triggers (any trigger may also carry pct: a 0..100 roll that must pass too):
//   always · chance{pct} · keyword{words, target user|reply|both, whole} · regex{pattern, flags, target}
//   every_n{n, offset, min} · turn_min{n} · turn_max{n} · scene{is:[kinds]} · not_scene{is:[kinds]}
//   present{names: "char" | "any_npc" | [names]} · attraction{} · intimate{} · setting{key, is | in:[…] | not}
//   any_of{triggers} · all_of{triggers} · none_of{triggers}
// Scene kinds: intimate, attraction, grief, argument, action, calm, plus the tracker's own words (simmer, building,
// peak, breather; setup, escalation, complication, crisis, resolution).
// Pool tokens are filled from runtime state only: {{random_present}} {{random_npc}} {{subject}} {{pref:any|char|Name}}
// {{want:…}} {{mood:…}} {{limit:…}} {{place}} {{time}} {{weather}} {{pick:a|b}} {{roll:1d20}}; {{char}}, {{user}} and
// other SillyTavern macros pass through. A line with a token that cannot be filled, or that fails the safety filter,
// is dropped (never injected broken). Keyword/regex triggers never read the player's *private thoughts*.

import { str, isPlainObject, clamp, clip, escapeRegex, contentTokens, jaccard, normText } from '../common/text.js';
import { stripInvisible, unsafeReason } from '../common/safety.js';
import { findCharacter, mindOf, intimacyOf, sceneOf } from '../common/state.js';

export const TRIGGER_TYPES = ['always', 'chance', 'keyword', 'regex', 'every_n', 'turn_min', 'turn_max', 'scene', 'not_scene',
    'present', 'attraction', 'intimate', 'setting', 'any_of', 'all_of', 'none_of'];
export const PICK_MODES = ['random', 'cycle'];
const TARGETS = ['user', 'reply', 'both'];
const MAX_POOL = 200;
const MAX_LINE = 1200;

export function slug(s) {
    return str(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
}

function names(v) {
    return (Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : []).map(x => clip(stripInvisible(str(x)), 80)).filter(Boolean);
}

function normPct(v) {
    const n = Number(v);
    return v === undefined || v === null || v === '' || !Number.isFinite(n) ? null : clamp(n, 0, 100);
}

export function normTrigger(raw, depth = 0) {
    if (!isPlainObject(raw) || !TRIGGER_TYPES.includes(raw.type)) return null;
    const t = { type: raw.type };
    const pct = normPct(raw.pct);
    if (pct !== null && pct < 100 && raw.type !== 'chance') t.pct = pct;
    switch (raw.type) {
        case 'always': case 'attraction': case 'intimate': break;
        case 'chance': t.pct = pct ?? 0; break;
        case 'keyword':
            t.words = names(raw.words).slice(0, 60);
            t.target = TARGETS.includes(raw.target) ? raw.target : 'user';
            t.whole = raw.whole !== false;
            if (!t.words.length) return null;
            break;
        case 'regex':
            t.pattern = str(raw.pattern).slice(0, 600);
            t.flags = str(raw.flags || 'i').replace(/[^imsu]/g, '').replace(/(.)(?=.*\1)/g, '');
            t.target = TARGETS.includes(raw.target) ? raw.target : 'user';
            try { new RegExp(t.pattern, t.flags); } catch { return null; }
            if (!t.pattern) return null;
            break;
        case 'every_n':
            t.n = Math.max(1, Math.round(Number(raw.n) || 1));
            t.offset = Math.max(0, Math.round(Number(raw.offset) || 0));
            if (Number(raw.min) > 0) t.min = Math.round(Number(raw.min));
            break;
        case 'turn_min': case 'turn_max':
            t.n = Math.max(0, Math.round(Number(raw.n) || 0));
            break;
        case 'scene': case 'not_scene':
            t.is = names(raw.is ?? raw.kinds ?? raw.modes).map(x => x.toLowerCase().replace(/^@/, ''));
            if (!t.is.length) return null;
            break;
        case 'present':
            t.names = raw.names === 'char' || raw.names === 'any_npc' ? raw.names : names(raw.names);
            if (Array.isArray(t.names) && !t.names.length) return null;
            break;
        case 'setting':
            t.key = str(raw.key).trim();
            if (!t.key) return null;
            if (Array.isArray(raw.in)) t.in = raw.in.map(x => str(x));
            else if (raw.not !== undefined) t.not = str(raw.not);
            else t.is = raw.is === undefined ? true : raw.is;
            break;
        case 'any_of': case 'all_of': case 'none_of':
            if (depth >= 3) return null;
            t.triggers = (Array.isArray(raw.triggers) ? raw.triggers : []).map(x => normTrigger(x, depth + 1)).filter(Boolean).slice(0, 16);
            if (!t.triggers.length) return null;
            break;
        default: return null;
    }
    return t;
}

/** Coerce anything into a rule, or null. Never throws. */
export function normalizeRule(raw, pack = 'custom') {
    if (!isPlainObject(raw)) return null;
    const name = clip(stripInvisible(str(raw.name || raw.id)), 120);
    const id = slug(raw.id) || slug(name);
    if (!id) return null;
    const count = v => Math.max(0, Math.round(Number(v) || 0));
    const poolSrc = Array.isArray(raw.pool) ? raw.pool : Array.isArray(raw.action?.pool) ? raw.action.pool : [];
    const pool = poolSrc.filter(x => typeof x === 'string').map(x => stripInvisible(x).trim()).filter(Boolean).slice(0, MAX_POOL).map(x => x.slice(0, MAX_LINE));
    const triggers = (Array.isArray(raw.triggers) ? raw.triggers : []).map(t => normTrigger(t)).filter(Boolean).slice(0, 16);
    if (!pool.length || !triggers.length) return null;
    return {
        id,
        name: name || id,
        enabled: raw.enabled !== false,
        pack: slug(raw.pack) || slug(pack) || 'custom',
        priority: clamp(Math.round(Number(raw.priority ?? 3)), 1, 5),
        logic: raw.logic === 'all' ? 'all' : 'any',
        triggers,
        cooldown: count(raw.cooldown),
        sticky: count(raw.sticky),
        max_fires: count(raw.max_fires),
        pool,
        pick: PICK_MODES.includes(raw.pick ?? raw.action?.pick) ? (raw.pick ?? raw.action?.pick) : 'random',
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// Template expansion

const PASSTHROUGH = /^(?:char|user|trim|newline|noop|\/\/[\s\S]*|getvar::[^{}]+|getglobalvar::[^{}]+|random::[\s\S]+|pick::[\s\S]+)$/i;
export const OWN_TOKENS = ['random_present', 'random_npc', 'subject', 'pref', 'limit', 'want', 'mood', 'place', 'time', 'weather', 'pick', 'roll'];
const TOKEN_RE = /\{\{\s*([^{}]*?)\s*\}\}/g;
const SUBJECT_ANY = new Set(['', 'any', 'subject']);
const FIELD_TOKENS = ['pref', 'want', 'mood', 'limit'];

function parseToken(raw) {
    const m = str(raw).match(/^([a-z_]+)(?::([\s\S]*))?$/i);
    if (!m) return { name: str(raw).toLowerCase(), arg: null };
    return { name: m[1].toLowerCase(), arg: m[2] === undefined ? null : m[2].trim() };
}

/** Tokens in a line that this engine cannot fill (unknown names). */
export function unknownTokens(text) {
    const out = [];
    for (const m of str(text).matchAll(TOKEN_RE)) {
        if (PASSTHROUGH.test(m[1])) continue;
        if (!OWN_TOKENS.includes(parseToken(m[1]).name)) out.push(m[1]);
    }
    return out;
}

function sameItem(a, b) {
    const na = normText(a);
    const nb = normText(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    const ta = contentTokens(a);
    const tb = contentTokens(b);
    return ta.length > 0 && tb.length > 0 && jaccard(ta, tb) >= 0.6;
}

/** Likes that no limit or dislike covers (limits always win). */
export function usableLikes(intimacy) {
    const blocked = [...intimacy.limits, ...intimacy.dislikes].map(x => x.text);
    return intimacy.likes.map(x => x.text).filter(t => t && !blocked.some(b => sameItem(b, t)));
}

function fieldValues(env, field, name) {
    const rec = findCharacter(env.ctx, name);
    if (!rec) return [];
    switch (field) {
        case 'pref': return env.intimacyOn ? usableLikes(intimacyOf(rec.c)) : [];
        case 'limit': return env.intimacyOn ? intimacyOf(rec.c).limits.map(x => x.text).filter(Boolean) : [];
        case 'want': return mindOf(rec.c).wants.split(/\s*;\s*/).filter(Boolean);
        case 'mood': { const m = mindOf(rec.c).mood; return m ? [m] : []; }
        default: return [];
    }
}

function pickOne(list, rng) {
    return list.length ? list[Math.min(list.length - 1, Math.floor((Number(rng()) || 0) * list.length))] : null;
}

function rollDice(spec, rng) {
    const m = str(spec).replace(/\s+/g, '').match(/^(\d{0,2})d(\d{1,4})([+-]\d{1,4})?$/i);
    if (!m) return null;
    const n = clamp(Number(m[1] || 1), 1, 20);
    const sides = clamp(Number(m[2]), 2, 1000);
    let total = Number(m[3] || 0);
    for (let i = 0; i < n; i++) total += 1 + Math.floor((Number(rng()) || 0) * sides);
    return String(total);
}

/**
 * Expand one pool line against the env. All subject-bound tokens in one line refer to ONE present character chosen
 * among those who can fill every such token. Returns {ok, text, reason}.
 */
export function expandLine(line, env) {
    const src = stripInvisible(line);
    const rng = env.rng;
    const toks = [...src.matchAll(TOKEN_RE)].map(m => ({ inner: m[1], ...parseToken(m[1]) }));
    const fail = reason => ({ ok: false, text: '', reason });
    const unknown = toks.filter(t => !PASSTHROUGH.test(t.inner) && !OWN_TOKENS.includes(t.name));
    if (unknown.length) return fail(`unsupported token {{${unknown[0].inner}}}`);
    const bound = toks.filter(t => ['random_present', 'random_npc', 'subject'].includes(t.name)
        || (FIELD_TOKENS.includes(t.name) && SUBJECT_ANY.has(str(t.arg).toLowerCase())));
    let subject = null;
    if (bound.length) {
        const npcOnly = bound.some(t => t.name === 'random_npc');
        const people = env.present.filter(n => !npcOnly || n.toLowerCase() !== env.charName.toLowerCase());
        const needs = new Set(bound.filter(t => FIELD_TOKENS.includes(t.name)).map(t => t.name));
        const candidates = needs.size ? people.filter(n => [...needs].every(f => fieldValues(env, f, n).length)) : people;
        subject = pickOne(candidates, rng);
        if (!subject) return fail(people.length ? `nobody present has a ${[...needs].join('/')}` : 'nobody present');
        subject = findCharacter(env.ctx, subject)?.name || subject;
    }
    let out = '';
    let last = 0;
    const used = {};
    for (const m of src.matchAll(TOKEN_RE)) {
        out += src.slice(last, m.index);
        last = m.index + m[0].length;
        const t = { inner: m[1], ...parseToken(m[1]) };
        if (PASSTHROUGH.test(t.inner)) { out += m[0]; continue; }
        let v = null;
        switch (t.name) {
            case 'random_present': case 'random_npc': case 'subject': v = subject; break;
            case 'pref': case 'want': case 'mood': case 'limit': {
                const anyForm = SUBJECT_ANY.has(str(t.arg).toLowerCase());
                const who = anyForm ? subject : (/^(char|\{\{char\}\})$/i.test(str(t.arg)) ? env.charName : t.arg);
                const vals = who ? fieldValues(env, t.name, who) : [];
                const fresh = used[t.name] && vals.length > 1 ? vals.filter(x => x !== used[t.name]) : vals;
                v = t.name === 'mood' ? vals[0] ?? null : pickOne(fresh, rng);
                if (v) used[t.name] = v;
                break;
            }
            case 'place': case 'time': case 'weather': v = env.scene[t.name] || null; break;
            case 'pick': v = pickOne(str(t.arg).split('|').map(x => x.trim()).filter(Boolean), rng); break;
            case 'roll': v = rollDice(t.arg, rng); break;
            default: v = null;
        }
        if (v === null || v === undefined || str(v).trim() === '') return fail(`unresolved {{${t.inner}}}`);
        out += str(v).replace(/\{\{|\}\}/g, '');
    }
    out += src.slice(last);
    const text = out.replace(/[ \t]+/g, ' ').replace(/ ([,.;:!?])/g, '$1').trim();
    return text ? { ok: true, text, reason: 'ok' } : fail('empty');
}

// ---------------------------------------------------------------------------------------------------------------------
// Triggers

const regexCache = new Map();
function cachedRegex(pattern, flags) {
    const key = `${flags}\u0000${pattern}`;
    if (regexCache.has(key)) return regexCache.get(key);
    let re = null;
    try { re = new RegExp(pattern, flags); } catch { re = null; }
    regexCache.set(key, re);
    if (regexCache.size > 500) regexCache.delete(regexCache.keys().next().value);
    return re;
}

function keywordHit(words, text, whole) {
    const t = str(text);
    if (!t) return false;
    for (const w of words || []) {
        const body = escapeRegex(str(w).trim()).replace(/\\\*/g, '\\w*').replace(/\s+/g, '\\s+');
        if (!body) continue;
        const re = cachedRegex(whole ? `(?:^|[^\\p{L}\\p{N}_])${body}(?=$|[^\\p{L}\\p{N}_])` : body, 'iu');
        if (re && re.test(t)) return true;
    }
    return false;
}

function textFor(target, env) {
    if (target === 'reply') return env.replyText;
    if (target === 'both') return `${env.userText}\n${env.replyText}`;
    return env.userText;
}

function roll(env, pct) {
    return (Number(env.rng()) || 0) * 100 < clamp(Number(pct) * env.mult, 0, 100);
}

function settingMatches(t, env) {
    const v = env.setting(t.key);
    const s = v === undefined || v === null ? '' : String(v);
    if (Array.isArray(t.in)) return t.in.some(x => x.toLowerCase() === s.toLowerCase());
    if (t.not !== undefined) return s.toLowerCase() !== String(t.not).toLowerCase();
    if (typeof t.is === 'boolean') return (v === true || /^(true|on|1|yes)$/i.test(s)) === t.is;
    return s.toLowerCase() === String(t.is).toLowerCase();
}

export function testTrigger(t, env) {
    let ok;
    switch (t.type) {
        case 'always': ok = true; break;
        case 'chance': return roll(env, t.pct);
        case 'keyword': ok = keywordHit(t.words, textFor(t.target, env), t.whole !== false); break;
        case 'regex': { const re = cachedRegex(t.pattern, t.flags || 'i'); ok = !!re && re.test(textFor(t.target, env)); break; }
        case 'every_n': ok = env.turn > 0 && env.turn >= (t.min || 0) && env.turn >= (t.offset || 0) && (env.turn - (t.offset || 0)) % t.n === 0; break;
        case 'turn_min': ok = env.turn >= t.n; break;
        case 'turn_max': ok = env.turn <= t.n; break;
        case 'scene': ok = t.is.some(k => env.kinds.has(k)); break;
        case 'not_scene': ok = !t.is.some(k => env.kinds.has(k)); break;
        case 'present': {
            const p = env.present.map(n => n.toLowerCase());
            const c = env.charName.toLowerCase();
            if (t.names === 'char') ok = !!c && p.includes(c);
            else if (t.names === 'any_npc') ok = p.some(n => n !== c);
            else ok = t.names.some(n => p.includes((/^\{\{char\}\}$/i.test(n) ? c : n.toLowerCase())));
            break;
        }
        case 'attraction': ok = env.intimacyOn && env.kinds.has('attraction'); break;
        case 'intimate': ok = env.intimacyOn && env.kinds.has('intimate'); break;
        case 'setting': ok = settingMatches(t, env); break;
        case 'any_of': ok = t.triggers.some(x => testTrigger(x, env)); break;
        case 'all_of': ok = t.triggers.every(x => testTrigger(x, env)); break;
        case 'none_of': ok = !t.triggers.some(x => testTrigger(x, env)); break;
        default: ok = false;
    }
    if (ok && t.pct !== undefined && t.type !== 'chance') ok = roll(env, t.pct);
    return ok;
}

/** Under "all", rolls are evaluated last so a failed condition never consumes a roll. */
export function rulePasses(rule, env) {
    const ts = rule.triggers || [];
    if (!ts.length) return false;
    if (rule.logic === 'all') {
        const rolls = t => t.type === 'chance' || t.pct !== undefined;
        return [...ts.filter(t => !rolls(t)), ...ts.filter(rolls)].every(t => testTrigger(t, env));
    }
    return ts.some(t => testTrigger(t, env));
}

/** Pick and expand one line. Returns {text, idx} or {text:null, reason}. */
export function produceLine(rule, env, firesSoFar) {
    const pool = rule.pool || [];
    if (!pool.length) return { text: null, reason: 'empty pool' };
    let order;
    if (rule.pick === 'cycle') {
        const start = firesSoFar % pool.length;
        order = pool.map((_, i) => (start + i) % pool.length);
    } else {
        order = pool.map((_, i) => i);
        for (let i = order.length - 1; i > 0; i--) {
            const j = Math.floor((Number(env.rng()) || 0) * (i + 1));
            [order[i], order[j]] = [order[j], order[i]];
        }
    }
    let reason = 'no usable line';
    for (const idx of order) {
        const r = expandLine(pool[idx], env);
        if (!r.ok) { reason = r.reason; continue; }
        const bad = unsafeReason(r.text, { userName: env.userName });
        if (bad) { reason = `unsafe: ${bad}`; continue; }
        return { text: clip(r.text, env.maxChars), idx };
    }
    return { text: null, reason };
}

/** Build the evaluation env from ctx (scene kinds, present cast, texts). */
export function makeEnv({ ctx, turn, rng, userText, replyText, kinds, present, charName, userName, intimacyOn, mult, maxChars, setting }) {
    return {
        ctx, turn, rng, userText: str(userText), replyText: str(replyText), kinds: kinds instanceof Set ? kinds : new Set(kinds || []),
        present: present || [], charName: str(charName), userName: str(userName), intimacyOn: intimacyOn !== false,
        mult: Number.isFinite(mult) ? mult : 1, maxChars: maxChars || 240, scene: sceneOf(ctx), setting: setting || (() => undefined),
    };
}
