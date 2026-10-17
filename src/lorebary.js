// Undercurrent — import LoreBary plugins (and LoreBary/ST lorebook exports) into Chance Rules, plus Undercurrent's own
// pack JSON {format:"undercurrent-rules", version:1, pack, rules}. Pure logic; never executes imported code.
//
// LoreBary plugin entry → rule:
//   triggerLogic AND|OR → logic all|any
//   triggerGroups: always → always · random → chance · keyword → keyword (target user|bot→reply|both) · regex → regex
//     messageCount → turn_min/turn_max · messageCountInterval → every_n {n, min} · variable → variable (default from the
//     plugin's variables) · switch → switch (default from the plugin's switches) · time/date/messageLength/agent → not
//     supported (entry skipped under AND, group dropped with a note under OR)
//   group "chance" below 100 on a non-random group → that trigger's pct
//   actions.default: add_message → inject pool (role kept; long or multi-line blocks and non-system roles go to a depth
//     injection) · set_variable / set_switch → action.sets · run_agent → not supported
//   advancedCode is NEVER executed: a rule is created only when a static pool exists, else "JavaScript-only entry".
//
// Chance scale heuristic (LoreBary exports differ): all "chance" values of a file are collected (every group type).
//   If every value is <= 1, the file uses fractions (1 = 100%, 0.25 = 25%) and values are multiplied by 100.
//   If any value is > 1, the file uses percent and values are taken as written (so a 1 next to a 12 means 1%).
// Message counts are mapped 1:1 onto Undercurrent's player turns.
//
// Every pool line is cleaned (zero-width/watermark characters stripped, LoreBary {{variable}} tokens rewritten to
// {{var:name|default}}), then sub-lines that fail the safety filter or use unsupported tokens are removed and reported.
// Lines that hard-code a character name not present in the current chat are kept (they are the user's data) but flagged.

import {
    normalizeRule, unsafeReason, unknownTokens, stripInvisible, resolveRuleOptions, DEFAULT_RULE_OPTIONS, validateRule,
} from './rules.js';
import { isPlainObject, clip } from './util.js';

export const PACK_FORMAT = 'undercurrent-rules';
export const PACK_VERSION = 1;

function slug(s) {
    return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}

function parseInput(json) {
    if (typeof json === 'string') {
        try { return JSON.parse(stripInvisible(json).replace(/^﻿/, '')); } catch (e) { return { __error: `Invalid JSON: ${e.message}` }; }
    }
    return json;
}

function entriesOf(obj) {
    if (Array.isArray(obj)) return obj;
    if (!isPlainObject(obj)) return [];
    const e = obj.entries ?? obj.plugin?.entries;
    if (Array.isArray(e)) return e;
    if (isPlainObject(e)) return Object.values(e);
    return [];
}

/** 'plugin' | 'lorebook' | 'undercurrent' | 'unknown' */
export function detectFormat(input) {
    const obj = parseInput(input);
    if (isPlainObject(obj) && obj.format === PACK_FORMAT) return 'undercurrent';
    const entries = entriesOf(obj);
    if (entries.some(e => isPlainObject(e) && (Array.isArray(e.triggerGroups) || isPlainObject(e.actions) || typeof e.advancedCode === 'string'))) return 'plugin';
    if (entries.some(e => isPlainObject(e) && (Array.isArray(e.key) || Array.isArray(e.keys)) && typeof e.content === 'string')) return 'lorebook';
    return 'unknown';
}

/** Infer how a file writes its chances (see header). */
export function inferChanceScale(entries) {
    const values = [];
    for (const e of entries || []) {
        for (const g of Array.isArray(e?.triggerGroups) ? e.triggerGroups : []) {
            const n = Number(g?.chance);
            if (g && g.chance !== undefined && g.chance !== null && g.chance !== '' && Number.isFinite(n) && n >= 0) values.push(n);
        }
    }
    const scale = values.length && values.every(v => v <= 1) ? 'fraction' : 'percent';
    return { scale, values, toPct: v => { const n = Number(v); if (!Number.isFinite(n)) return 100; return Math.max(0, Math.min(100, scale === 'fraction' ? n * 100 : n)); } };
}

// ---------------------------------------------------------------------------------------------------------------------
// Hard-coded names

const NOT_NAMES = new Set(('I Im Ill Ive Id OK Okay Mr Mrs Ms Mx Dr Sir Madam Miss Lady Lord God Gods Christ Jesus Monday Tuesday Wednesday ' +
    'Thursday Friday Saturday Sunday January February March April May June July August September October November December ' +
    'English French German Spanish Italian Japanese Chinese Korean Russian American British European Christmas Easter ' +
    'AM PM TV USA UK EU NPC NPCs OOC POV AI LLM JSON NSFW SFW').split(/\s+/));

/**
 * Words that look like hard-coded names: capitalized mid-sentence somewhere in the texts, never written in lowercase,
 * not a macro, not a known title/day/month, and not one of the chat's own names.
 */
export function findHardcodedNames(texts, knownNames = []) {
    const known = new Set((knownNames || []).map(n => String(n).toLowerCase()).flatMap(n => [n, ...n.split(/\s+/)]));
    const all = (texts || []).map(t => String(t ?? '').replace(/\{\{[^{}]*\}\}/g, ' ')).join('\n');
    const lower = new Map();
    for (const w of all.match(/\b[a-z][a-z']+\b/g) || []) lower.set(w, (lower.get(w) || 0) + 1);
    const counts = new Map();
    // Capitalized word right after a lowercase word, not followed by ':' and not part of a Title Case phrase.
    const re = /\b([a-z][a-z']*)[ \t]+([A-Z][a-z]{2,})(?:'s|’s)?\b(?![ \t]*:)(?![ \t]+(?:of[ \t]+)?[A-Z][a-z])/g;
    let m;
    while ((m = re.exec(all))) {
        const w = m[2];
        if (NOT_NAMES.has(w) || known.has(w.toLowerCase())) continue;
        counts.set(w, (counts.get(w) || 0) + 1);
    }
    // A name recurs and is (almost) never written in lowercase; one stray typo does not make it a common word.
    const total = (w) => (all.match(new RegExp(`\\b${w}\\b`, 'g')) || []).length;
    return [...counts.keys()].filter(w => {
        const t = total(w);
        return t >= 2 && (lower.get(w.toLowerCase()) || 0) <= Math.max(1, Math.floor(t * 0.05));
    });
}

// ---------------------------------------------------------------------------------------------------------------------
// Pool cleaning

// LoreBary placeholders for "some other person in the scene" map onto Undercurrent's {{random_npc}}.
const NPC_ALIASES = /\{\{\s*(?:someone|somebody|random_npc|random_char|random_character|npc|random_person)\s*\}\}/gi;
// A block that asks for a printed footer/tracker is a footer spec as a whole: drop all of it, not just the one line.
const BLOCK_REASONS = new Set(['meter/tracker/footer', 'tracker bar', 'status readout', 'numeric stat line', 'print at end of reply', 'stamp/footer instruction', 'stage ladder']);

function rewriteVars(text, varDefaults) {
    return text.replace(NPC_ALIASES, '{{random_npc}}').replace(/\{\{\s*([A-Za-z_][\w]*)\s*\}\}/g, (all, name) => {
        if (!Object.prototype.hasOwnProperty.call(varDefaults, name)) return all;
        const d = varDefaults[name];
        return `{{var:${name}${d === undefined || d === null || d === '' ? '' : `|${String(d).replace(/[{}|]/g, '')}`}}}`;
    });
}

/**
 * Clean one pool item. Multi-line blocks are filtered line by line so one bad sentence does not discard the whole block.
 * @returns {{text:string, removed:{line:string, reason:string}[]}}
 */
export function cleanPoolItem(raw, { varDefaults = {}, userName = '', options } = {}) {
    const removed = [];
    const text = rewriteVars(stripInvisible(raw).replace(/\r\n?/g, '\n'), varDefaults);
    const keep = [];
    for (const line of text.split('\n')) {
        if (!line.trim()) { keep.push(line); continue; }
        const unk = unknownTokens(line);
        if (unk.length) { removed.push({ line: clip(line, 160), reason: `unsupported token {{${clip(unk[0], 40)}}}` }); continue; }
        const bad = unsafeReason(line, { userName, options });
        if (bad && BLOCK_REASONS.has(bad) && text.includes('\n')) {
            return { text: '', removed: [...removed, { line: clip(text.replace(/\s+/g, ' '), 160), reason: `${bad} (whole block)` }] };
        }
        if (bad) { removed.push({ line: clip(line, 160), reason: bad }); continue; }
        keep.push(line);
    }
    const out = keep.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    // A block whose remaining text is only labels/punctuation carries no instruction.
    const unlabeled = out.replace(/^\s*\[[^\]\n]{0,48}\]\s*$/gm, '').replace(/[-=*_#`>|]+/g, ' ');
    return { text: /[\p{L}]{2,}/u.test(unlabeled) ? out : '', removed };
}

// ---------------------------------------------------------------------------------------------------------------------
// Trigger mapping

const KW_TARGET = { user: 'user', char: 'reply', bot: 'reply', assistant: 'reply', ai: 'reply', both: 'both', all: 'both', any: 'both' };
const VAR_OP = { '==': '==', '=': '==', '===': '==', '!=': '!=', '!==': '!=', '>': '>', '>=': '>=', '<': '<', '<=': '<=', between: 'between', contains: 'contains', exists: 'exists' };

function mapGroup(g, ctx) {
    const type = String(g?.type || '');
    const pct = ctx.chance.toPct(g?.chance ?? (ctx.chance.scale === 'fraction' ? 1 : 100));
    const withPct = (t) => (pct < 100 ? { ...t, pct } : t);
    switch (type) {
        case 'always':
            return { trigger: withPct({ type: 'always' }) };
        case 'random':
            return { trigger: { type: 'chance', pct } };
        case 'keyword': {
            const words = (Array.isArray(g.keywords) ? g.keywords : String(g.keywords || '').split(','))
                .map(w => stripInvisible(w).trim()).filter(Boolean);
            if (!words.length) return { error: 'keyword trigger without keywords' };
            return { trigger: withPct({ type: 'keyword', words, target: KW_TARGET[String(g.keywordTarget || 'user').toLowerCase()] || 'user', whole: true }) };
        }
        case 'regex': {
            const pattern = stripInvisible(g.regex || '');
            const flags = String(g.flags || 'i').replace(/[^imsu]/g, '') || 'i';
            if (!pattern) return { error: 'regex trigger without a pattern' };
            try { new RegExp(pattern, flags); } catch (e) { return { error: `invalid regex (${e.message})` }; }
            return { trigger: withPct({ type: 'regex', pattern, flags, target: KW_TARGET[String(g.regexTarget || 'user').toLowerCase()] || 'user' }) };
        }
        case 'messageCount': {
            const v = Math.round((Number(g.messageCountValue) || 0) / (ctx.divisor || 1));
            const op = String(g.messageCountOperator || '>');
            const t = op === '>' ? { type: 'turn_min', n: v + 1 } : op === '>=' ? { type: 'turn_min', n: v }
                : op === '<' ? { type: 'turn_max', n: Math.max(0, v - 1) } : op === '<=' ? { type: 'turn_max', n: v }
                    : { type: 'all_of', triggers: [{ type: 'turn_min', n: v }, { type: 'turn_max', n: v }] };
            return { trigger: withPct(t) };
        }
        case 'messageCountInterval': {
            const n = Math.max(1, Math.round((Number(g.messageCountInterval) || 1) / (ctx.divisor || 1)));
            const v = Math.round((Number(g.messageCountValue) || 0) / (ctx.divisor || 1));
            const op = String(g.messageCountOperator || '>');
            const min = op === '>' ? v + 1 : op === '>=' ? v : 0;
            return { trigger: withPct({ type: 'every_n', n, offset: 0, ...(min > 0 ? { min } : {}) }) };
        }
        case 'variable': {
            const name = stripInvisible(g.variableName || '').trim();
            if (!name) return { error: 'variable trigger without a name' };
            const op = VAR_OP[String(g.variableOperator || '==').toLowerCase()];
            if (!op) return { error: `variable operator "${g.variableOperator}" not supported` };
            const t = { type: 'variable', name, op, value: g.variableValue ?? '' };
            if (op === 'between') {
                const lo = g.variableValueMin !== undefined && g.variableValueMin !== '' ? g.variableValueMin : g.variableValue;
                const hi = g.variableValueMax !== undefined && g.variableValueMax !== '' ? g.variableValueMax : g.variableValue;
                t.value = lo; t.value2 = hi;
            }
            if (Object.prototype.hasOwnProperty.call(ctx.varDefaults, name)) t.default = ctx.varDefaults[name];
            return { trigger: withPct(t) };
        }
        case 'switch': {
            const name = stripInvisible(g.switchName || '').trim();
            if (!name) return { error: 'switch trigger without a name' };
            const t = { type: 'switch', name, state: g.switchState !== false };
            if (typeof ctx.switchDefaults[name] === 'boolean') t.default = ctx.switchDefaults[name];
            return { trigger: withPct(t) };
        }
        default:
            return { error: `"${type || 'unknown'}" trigger not supported` };
    }
}

const ADD_OPS = new Set(['add', 'plus', 'increment', 'inc', '+', '+=']);
const SUB_OPS = new Set(['sub', 'subtract', 'minus', 'decrement', 'dec', '-', '-=']);

function setsFrom(actions, notes, label) {
    const sets = [];
    for (const a of actions) {
        if (a?.type === 'set_variable' && a.variable) {
            const op = String(a.operation || 'set').toLowerCase();
            const mapped = ADD_OPS.has(op) ? 'add' : SUB_OPS.has(op) ? 'sub' : 'set';
            sets.push({ kind: 'var', name: String(a.variable), value: a.value ?? '', op: mapped });
            if (mapped === 'set' && op !== 'set') notes.push(`${label}: set_variable operation "${op}" treated as set.`);
        } else if (a?.type === 'set_switch' && a.switch) {
            sets.push({ kind: 'switch', name: String(a.switch), value: a.value !== false && a.value !== 'false' });
        }
    }
    return sets;
}

function defaultsOf(obj) {
    const varDefaults = {};
    const switchDefaults = {};
    if (isPlainObject(obj?.variables)) {
        for (const [k, v] of Object.entries(obj.variables)) varDefaults[k] = isPlainObject(v) ? (v.value ?? '') : v;
    }
    if (isPlainObject(obj?.switches)) {
        for (const [k, v] of Object.entries(obj.switches)) switchDefaults[k] = isPlainObject(v) ? v.value !== false && v.state !== false : !!v;
    }
    return { varDefaults, switchDefaults };
}

function packMeta(obj, fallbackName, source) {
    const name = stripInvisible(obj?.name || obj?.meta?.name || obj?.meta?.title || obj?.title || fallbackName || 'Imported pack').trim();
    const description = stripInvisible(obj?.meta?.description || obj?.description || '').replace(/<[^>]+>/g, '').trim();
    return { id: `lb_${slug(name) || 'pack'}`, name: clip(name, 80), description: clip(description, 300), source, default_enabled: true };
}

/**
 * Import a LoreBary plugin (or a LoreBary / SillyTavern lorebook export, or an Undercurrent pack).
 * @param {object|string} json
 * @param {{knownNames?:string[], userName?:string, options?:object, packId?:string, fileName?:string}} [opts]
 *   knownNames: {{char}}, the persona and the chat's characters — used only to flag hard-coded names.
 * @returns {{pack:object, rules:object[], skipped:{entry:string, reason:string}[], removed:{entry:string, line:string, reason:string}[],
 *   flagged:{entry:string, line:string, names:string[]}[], notes:string[], format:string, chanceScale:string|null}}
 */
export function importLoreBary(json, opts = {}) {
    const obj = parseInput(json);
    const options = resolveRuleOptions(opts.options || {});
    const result = { pack: null, rules: [], skipped: [], removed: [], flagged: [], notes: [], format: 'unknown', chanceScale: null };
    if (obj?.__error) { result.notes.push(obj.__error); return result; }
    const format = detectFormat(obj);
    result.format = format;
    if (format === 'undercurrent') {
        const r = importRules(obj, opts);
        return { ...result, ...r, format };
    }
    if (format === 'unknown') {
        result.notes.push('Not a LoreBary plugin, lorebook or Undercurrent pack: no entries with triggerGroups/actions or key/content were found.');
        return result;
    }
    const pack = packMeta(obj, opts.fileName, format === 'plugin' ? 'lorebary-plugin' : 'lorebook');
    if (opts.packId) pack.id = slug(opts.packId) || pack.id;
    result.pack = pack;
    const { varDefaults, switchDefaults } = defaultsOf(obj);
    const entries = entriesOf(obj).filter(isPlainObject);
    const chance = inferChanceScale(entries);
    result.chanceScale = format === 'plugin' ? chance.scale : null;
    if (format === 'plugin' && chance.values.length) {
        result.notes.push(chance.scale === 'fraction'
            ? `Chances read as fractions (every value ≤ 1, so 1 = 100%): ${[...new Set(chance.values)].slice(0, 8).join(', ')}.`
            : `Chances read as percent: ${[...new Set(chance.values)].slice(0, 8).join(', ')}${chance.values.some(v => v > 0 && v <= 1) ? ' (values ≤ 1 here mean ≤ 1%)' : ''}.`);
    }
    const ctx = { chance, varDefaults, switchDefaults, divisor: Number(options.lorebary_interval_divisor) > 0 ? Number(options.lorebary_interval_divisor) : 1 };
    const usedIds = new Set();
    const uniqueId = (base) => { let id = base; let k = 2; while (usedIds.has(id)) id = `${base}_${k++}`; usedIds.add(id); return id; };
    let codeIgnored = 0;
    let agentsIgnored = 0;

    entries.forEach((e, idx) => {
        const label = clip(stripInvisible(e.name || e.comment || (Array.isArray(e.key) ? e.key[0] : '') || `entry ${e.uid ?? idx}`), 80);
        const skip = (reason) => result.skipped.push({ entry: label, reason });
        const baseId = `${pack.id}_${slug(e.uid ?? idx) || idx}`;
        const cleanPool = (pool) => {
            const out = [];
            for (const item of (Array.isArray(pool) ? pool : [pool]).filter(x => typeof x === 'string' && x.trim())) {
                const c = cleanPoolItem(item, { varDefaults, userName: opts.userName, options });
                for (const r of c.removed) result.removed.push({ entry: label, ...r });
                if (c.text) out.push(c.text);
            }
            return out;
        };

        if (format === 'lorebook') {
            if (e.disable === true) { skip('disabled in the lorebook'); return; }
            const keys = (e.key || e.keys || []).map(k => stripInvisible(k).trim()).filter(Boolean);
            const second = (e.keysecondary || e.secondary_keys || []).map(k => stripInvisible(k).trim()).filter(Boolean);
            let triggers;
            let logic = 'any';
            if (e.constant) triggers = [{ type: 'always' }];
            else if (!keys.length) { skip('no keys and not constant'); return; }
            else if (e.selective && second.length) { logic = 'all'; triggers = [{ type: 'keyword', words: keys, target: 'both', whole: true }, { type: 'keyword', words: second, target: 'both', whole: true }]; }
            else triggers = [{ type: 'keyword', words: keys, target: 'both', whole: true }];
            const pool = cleanPool([e.content || '']);
            if (!pool.length) { skip(e.content ? 'all text removed by the safety filter or unsupported tokens' : 'empty content'); return; }
            const long = pool.some(t => t.length > options.max_line_chars || t.includes('\n'));
            const rule = normalizeRule({
                id: uniqueId(baseId), name: label, pack: pack.id, logic, triggers,
                action: { type: 'inject', pool, pick: 'random', role: 'system', placement: long ? 'depth' : 'note', depth: options.default_depth },
            }, { pack: pack.id, options });
            if (rule) result.rules.push(rule);
            return;
        }

        // LoreBary plugin entry
        const actions = Array.isArray(e.actions?.default) ? e.actions.default : (Array.isArray(e.actions) ? e.actions : []);
        for (const k of Object.keys(isPlainObject(e.actions) ? e.actions : {})) if (k !== 'default') result.notes.push(`${label}: action branch "${k}" ignored (only "default" is imported).`);
        const hasCode = typeof e.advancedCode === 'string' && e.advancedCode.trim().length > 0;
        const groups = Array.isArray(e.triggerGroups) ? e.triggerGroups : [];
        const logic = String(e.triggerLogic || 'AND').toUpperCase() === 'OR' ? 'any' : 'all';
        const triggers = [];
        const dropped = [];
        for (const g of groups) {
            const r = mapGroup(g, ctx);
            if (r.trigger) triggers.push(r.trigger);
            else dropped.push(r.error);
        }
        const msgActions = actions.filter(a => a?.type === 'add_message');
        const pools = msgActions.map(a => ({ a, pool: cleanPool(a.pool) })).filter(x => x.pool.length);
        const sets = setsFrom(actions, result.notes, label);
        if (actions.some(a => a?.type === 'run_agent')) agentsIgnored++;
        const unknownActions = [...new Set(actions.map(a => a?.type).filter(t => t && !['add_message', 'set_variable', 'set_switch', 'run_agent'].includes(t)))];
        if (unknownActions.length) result.notes.push(`${label}: action type(s) ${unknownActions.join(', ')} not supported.`);

        if (hasCode && !pools.length) { skip('JavaScript-only entry (advancedCode is never executed)'); return; }
        if (!pools.length && !sets.length) {
            if (actions.some(a => a?.type === 'run_agent')) skip('run_agent only (LoreBary agents are not supported)');
            else if (msgActions.length) skip('all lines removed by the safety filter or unsupported tokens');
            else skip('no usable action');
            return;
        }
        if (dropped.length && (logic === 'all' || !triggers.length)) { skip(dropped[0]); return; }
        if (dropped.length) result.notes.push(`${label}: dropped ${dropped.join('; ')} (OR logic: the other triggers still apply).`);
        if (!triggers.length) { skip('no triggers'); return; }
        if (hasCode) codeIgnored++;

        if (!pools.length) {
            const rule = normalizeRule({ id: uniqueId(baseId), name: label, pack: pack.id, logic, triggers, action: { type: 'set_var', sets } }, { pack: pack.id, options });
            if (rule) result.rules.push(rule);
            return;
        }
        pools.forEach(({ a, pool }, k) => {
            const role = ['system', 'user', 'assistant'].includes(a.role) ? a.role : 'system';
            const long = pool.some(t => t.length > options.max_line_chars || t.includes('\n'));
            const count = Number(a.poolCount);
            const rule = normalizeRule({
                id: uniqueId(k ? `${baseId}_${k + 1}` : baseId),
                name: k ? `${label} (${k + 1})` : label,
                pack: pack.id, logic, triggers,
                action: {
                    type: 'inject', pool, pick: 'random', role,
                    placement: long || role !== 'system' ? 'depth' : 'note',
                    depth: Number.isFinite(Number(e.depth ?? a.depth)) ? Number(e.depth ?? a.depth) : options.default_depth,
                    ...(Number.isFinite(count) && count > 1 ? { count } : {}),
                    ...(k === 0 && sets.length ? { sets } : {}),
                },
            }, { pack: pack.id, options });
            if (rule) result.rules.push(rule);
        });
    });

    // Hard-coded names: flag (keep) lines that name someone this chat does not have.
    const allLines = result.rules.flatMap(r => (r.action.pool || []));
    const names = findHardcodedNames(allLines, opts.knownNames || []);
    if (names.length) {
        const re = new RegExp(`\\b(?:${names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`);
        for (const r of result.rules) {
            const hit = new Set();
            for (const line of r.action.pool || []) {
                const found = names.filter(n => new RegExp(`\\b${n}\\b`).test(line));
                if (found.length) { result.flagged.push({ entry: r.name, line: clip(line, 120), names: found }); found.forEach(n => hit.add(n)); }
            }
            if (hit.size) r.note = clip(`Mentions ${[...hit].join(', ')} by name — not a character in this chat. Edit to {{char}}/{{random_present}} or disable.`, 300);
        }
        if (re) result.notes.push(`${result.flagged.length} line(s) hard-code names not in this chat (${names.slice(0, 8).join(', ')}${names.length > 8 ? '…' : ''}). Kept as your data and flagged; replace with {{char}}, {{random_present}} or {{random_npc}} to make them adapt.`);
    }
    if (codeIgnored) result.notes.push(`${codeIgnored} entr${codeIgnored === 1 ? 'y has' : 'ies have'} advancedCode that was ignored (never executed); only static text was imported.`);
    if (agentsIgnored) result.notes.push(`${agentsIgnored} run_agent action(s) ignored: Undercurrent's own director and scribe passes cover hidden generations.`);
    if (result.removed.length) result.notes.push(`${result.removed.length} line(s) removed by the safety filter or for unsupported tokens (see the removed list).`);
    if (format === 'lorebook') result.notes.push('This is a lorebook: long always-on entries usually work better as a SillyTavern World Info book; here they compete for a few rule slots per turn.');
    if (format === 'plugin' && result.rules.some(r => r.triggers.some(t => t.type === 'every_n' || t.type === 'turn_min' || t.type === 'turn_max'))) {
        const div = Number(options.lorebary_interval_divisor) > 0 ? Number(options.lorebary_interval_divisor) : 1;
        result.notes.push(div === 1 ? 'LoreBary message counts were mapped 1:1 onto player turns (knob rules.lorebary_interval_divisor changes this).' : `LoreBary message counts were divided by ${div} to get player turns.`);
    }
    if (aliasUsed(entries)) result.notes.push('{{someone}}-style placeholders were mapped to {{random_npc}} (a present character other than {{char}}).');
    result.notes = [...new Set(result.notes)];
    return result;
}

function aliasUsed(entries) {
    return entries.some(e => JSON.stringify(e.actions ?? e.content ?? '').match(NPC_ALIASES));
}

// ---------------------------------------------------------------------------------------------------------------------
// Undercurrent's own pack format

/** Serialize a pack: {format:"undercurrent-rules", version:1, pack, rules}. */
export function exportRules(pack, rules) {
    const p = isPlainObject(pack) ? pack : {};
    const meta = {
        id: slug(p.id) || slug(p.name) || 'pack',
        name: clip(String(p.name || p.id || 'Pack'), 80),
        description: clip(String(p.description || ''), 300),
        default_enabled: p.default_enabled !== false && p.enabled !== false,
        ...(Number(p.max_per_turn) > 0 ? { max_per_turn: Math.round(Number(p.max_per_turn)) } : {}),
    };
    const list = (Array.isArray(rules) ? rules : []).map(r => normalizeRule(r, { pack: meta.id })).filter(Boolean)
        .map(({ pack: _p, ...rest }) => rest);
    return { format: PACK_FORMAT, version: PACK_VERSION, pack: meta, rules: list };
}

/**
 * Parse an Undercurrent pack. Unsafe lines and lines with unsupported tokens are removed (reported); rules that fail
 * validation are skipped with their errors.
 */
export function importRules(json, opts = {}) {
    const obj = parseInput(json);
    const options = resolveRuleOptions(opts.options || {});
    const out = { pack: null, rules: [], skipped: [], removed: [], flagged: [], notes: [] };
    if (obj?.__error) { out.notes.push(obj.__error); return out; }
    if (!isPlainObject(obj) || obj.format !== PACK_FORMAT) { out.notes.push(`Not an Undercurrent pack (format must be "${PACK_FORMAT}").`); return out; }
    if (Number(obj.version) !== PACK_VERSION) out.notes.push(`Pack version ${obj.version} read as version ${PACK_VERSION}.`);
    const p = isPlainObject(obj.pack) ? obj.pack : {};
    out.pack = {
        id: slug(opts.packId || p.id || p.name) || 'imported',
        name: clip(stripInvisible(p.name || p.id || 'Imported pack'), 80),
        description: clip(stripInvisible(p.description || ''), 300),
        default_enabled: p.default_enabled !== false,
        ...(Number(p.max_per_turn) > 0 ? { max_per_turn: Math.round(Number(p.max_per_turn)) } : {}),
    };
    const seen = new Set();
    for (const raw of Array.isArray(obj.rules) ? obj.rules : []) {
        if (!isPlainObject(raw)) { out.skipped.push({ entry: '(not an object)', reason: 'rule must be an object' }); continue; }
        const label = clip(String(raw.name || raw.id || '(unnamed)'), 80);
        const r = { ...raw, action: isPlainObject(raw.action) ? { ...raw.action } : raw.action };
        if (isPlainObject(r.action) && Array.isArray(r.action.pool)) {
            const pool = [];
            for (const item of r.action.pool) {
                if (typeof item !== 'string') continue;
                const c = cleanPoolItem(item, { userName: opts.userName, options });
                for (const x of c.removed) out.removed.push({ entry: label, ...x });
                if (c.text) pool.push(c.text);
            }
            r.action.pool = pool;
        }
        const errors = validateRule(r, { userName: opts.userName, options });
        if (errors.length) { out.skipped.push({ entry: label, reason: errors[0] }); continue; }
        const n = normalizeRule(r, { pack: out.pack.id, options });
        if (!n) { out.skipped.push({ entry: label, reason: 'unusable rule' }); continue; }
        if (seen.has(n.id)) { out.skipped.push({ entry: label, reason: `duplicate id ${n.id}` }); continue; }
        seen.add(n.id);
        n.pack = out.pack.id;
        out.rules.push(n);
    }
    if (out.removed.length) out.notes.push(`${out.removed.length} line(s) removed by the safety filter or for unsupported tokens.`);
    return out;
}

export { DEFAULT_RULE_OPTIONS };
