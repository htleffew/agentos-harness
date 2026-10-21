// Undercurrent 2 · FEATURES — import chance-rule packs. Pure logic; never executes imported code.
//
// Accepted input (JSON text or object, or plain text):
//   - Undercurrent 2 packs {format:"undercurrent2-rules", version:1, pack, rules}
//   - Undercurrent v1 packs {format:"undercurrent-rules"} (scene modes mapped to scene kinds; variables/switches dropped)
//   - LoreBary plugins (entries with triggerGroups + actions): only static add_message prompt pools are imported.
//       triggerLogic AND|OR → all|any; random → chance; keyword → keyword (target user|bot→reply|both); regex → regex;
//       messageCount → turn_min/turn_max; messageCountInterval → every_n; a group "chance" < 100 → that trigger's pct.
//       variable/switch/time/date/agent groups are not supported (entry skipped under AND, group dropped under OR).
//       advancedCode is NEVER executed: an entry without a static pool is skipped. run_agent and set_* actions are ignored.
//   - SillyTavern / LoreBary lorebook exports (key + content): keyword rules over user + reply.
//   - Plain text: one prompt per line (blank-line separated blocks also work) → one pool, 15% chance, cooldown 3.
// Every line is cleaned (zero-width watermarks stripped), checked against the safety filter (never scripts {{user}},
// no trackers/footers/meters) and for unsupported tokens; failing lines are removed and reported as warnings.
// Chance scale: if every chance value in a file is ≤ 1, the file uses fractions (×100); otherwise values are percent.

import { str, isPlainObject, clip } from '../common/text.js';
import { stripInvisible, unsafeReason } from '../common/safety.js';
import { normalizeRule, unknownTokens, slug } from './engine.js';

export const PACK_FORMAT = 'undercurrent2-rules';
const V1_MODE = { '@intimate': 'intimate', '@romance': 'attraction', '@grief': 'grief', '@argument': 'argument', '@action': 'action', romantic: 'attraction', flirt: 'attraction' };
const NPC_ALIASES = /\{\{\s*(?:someone|somebody|random_char|random_character|npc|random_person)\s*\}\}/gi;
const KW_TARGET = { user: 'user', char: 'reply', bot: 'reply', assistant: 'reply', ai: 'reply', both: 'both', all: 'both', any: 'both' };

function parse(input) {
    if (isPlainObject(input) || Array.isArray(input)) return { obj: input };
    const s = stripInvisible(str(input)).replace(/^﻿/, '').trim();
    if (!s) return { error: 'Nothing to import.' };
    if (/^[[{]/.test(s)) {
        try { return { obj: JSON.parse(s) }; } catch (e) { return { error: `Invalid JSON: ${e.message}` }; }
    }
    return { text: s };
}

function entriesOf(obj) {
    if (Array.isArray(obj)) return obj;
    const e = obj?.entries ?? obj?.plugin?.entries;
    if (Array.isArray(e)) return e;
    if (isPlainObject(e)) return Object.values(e);
    return [];
}

export function detectFormat(obj) {
    if (isPlainObject(obj) && obj.format === PACK_FORMAT) return 'uc2';
    if (isPlainObject(obj) && obj.format === 'undercurrent-rules') return 'uc1';
    const entries = entriesOf(obj);
    if (entries.some(e => isPlainObject(e) && (Array.isArray(e.triggerGroups) || isPlainObject(e.actions) || typeof e.advancedCode === 'string'))) return 'plugin';
    if (entries.some(e => isPlainObject(e) && (Array.isArray(e.key) || Array.isArray(e.keys)) && typeof e.content === 'string')) return 'lorebook';
    return 'unknown';
}

/** Clean one pool item; multi-line blocks are filtered line by line. */
export function cleanPoolItem(raw, { userName = '', defaults = {} } = {}) {
    const removed = [];
    const text = stripInvisible(str(raw)).replace(/\r\n?/g, '\n').replace(NPC_ALIASES, '{{random_npc}}')
        .replace(/\{\{\s*([A-Za-z_]\w*)\s*\}\}/g, (all, name) => (Object.prototype.hasOwnProperty.call(defaults, name) && str(defaults[name]).trim() ? str(defaults[name]).replace(/[{}]/g, '') : all))
        .replace(/\{\{\s*var:([^|{}]+)\|([^{}]*)\}\}/gi, (_, __, fb) => fb.trim() || '{{var}}');
    const keep = [];
    for (const line of text.split('\n')) {
        if (!line.trim()) { keep.push(line); continue; }
        const unk = unknownTokens(line);
        if (unk.length) { removed.push({ line: clip(line, 160), reason: `unsupported token {{${clip(unk[0], 40)}}}` }); continue; }
        const bad = unsafeReason(line, { userName });
        if (bad) { removed.push({ line: clip(line, 160), reason: bad }); continue; }
        keep.push(line);
    }
    const out = keep.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    const unlabeled = out.replace(/^\s*\[[^\]\n]{0,48}\]\s*$/gm, '').replace(/[-=*_#`>|]+/g, ' ');
    return { text: /\p{L}{2,}/u.test(unlabeled) ? out : '', removed };
}

function chanceScale(entries) {
    const values = [];
    for (const e of entries) for (const g of Array.isArray(e?.triggerGroups) ? e.triggerGroups : []) {
        const n = Number(g?.chance);
        if (g && g.chance !== undefined && g.chance !== null && g.chance !== '' && Number.isFinite(n) && n >= 0) values.push(n);
    }
    const fraction = values.length > 0 && values.every(v => v <= 1);
    return v => { const n = Number(v); if (!Number.isFinite(n)) return 100; return Math.max(0, Math.min(100, fraction ? n * 100 : n)); };
}

function mapGroup(g, toPct) {
    const type = str(g?.type);
    const pct = toPct(g?.chance ?? 100);
    const withPct = t => (pct < 100 ? { ...t, pct } : t);
    switch (type) {
        case 'always': return { trigger: withPct({ type: 'always' }) };
        case 'random': return { trigger: { type: 'chance', pct } };
        case 'keyword': {
            const words = (Array.isArray(g.keywords) ? g.keywords : str(g.keywords).split(',')).map(w => stripInvisible(str(w)).trim()).filter(Boolean);
            if (!words.length) return { error: 'keyword trigger without keywords' };
            return { trigger: withPct({ type: 'keyword', words, target: KW_TARGET[str(g.keywordTarget || 'user').toLowerCase()] || 'user', whole: true }) };
        }
        case 'regex': {
            const pattern = stripInvisible(str(g.regex));
            const flags = str(g.flags || 'i').replace(/[^imsu]/g, '') || 'i';
            try { new RegExp(pattern, flags); } catch (e) { return { error: `invalid regex (${e.message})` }; }
            if (!pattern) return { error: 'regex trigger without a pattern' };
            return { trigger: withPct({ type: 'regex', pattern, flags, target: KW_TARGET[str(g.regexTarget || 'user').toLowerCase()] || 'user' }) };
        }
        case 'messageCount': {
            const v = Math.round(Number(g.messageCountValue) || 0);
            const op = str(g.messageCountOperator || '>');
            const t = op === '>' ? { type: 'turn_min', n: v + 1 } : op === '>=' ? { type: 'turn_min', n: v }
                : op === '<' ? { type: 'turn_max', n: Math.max(0, v - 1) } : op === '<=' ? { type: 'turn_max', n: v }
                    : { type: 'all_of', triggers: [{ type: 'turn_min', n: v }, { type: 'turn_max', n: v }] };
            return { trigger: withPct(t) };
        }
        case 'messageCountInterval': {
            const n = Math.max(1, Math.round(Number(g.messageCountInterval) || 1));
            const v = Math.round(Number(g.messageCountValue) || 0);
            const op = str(g.messageCountOperator || '>');
            const min = op === '>' ? v + 1 : op === '>=' ? v : 0;
            return { trigger: withPct({ type: 'every_n', n, offset: 0, ...(min > 0 ? { min } : {}) }) };
        }
        default: return { error: `"${type || 'unknown'}" trigger not supported` };
    }
}

function v1Trigger(t) {
    if (!isPlainObject(t)) return null;
    if (t.type === 'scene_mode' || t.type === 'not_scene_mode') {
        const is = [...new Set((t.modes || []).map(m => V1_MODE[str(m).toLowerCase()] || str(m).toLowerCase().replace(/^@/, '')))];
        return { type: t.type === 'scene_mode' ? 'scene' : 'not_scene', is, ...(t.pct !== undefined ? { pct: t.pct } : {}) };
    }
    if (t.type === 'intimacy_phase') return { type: 'intimate' };
    if (t.type === 'variable' || t.type === 'switch') return null;
    if (['any_of', 'all_of', 'none_of'].includes(t.type)) {
        const ts = (t.triggers || []).map(v1Trigger);
        if (ts.some(x => !x)) return null;
        return { type: t.type, triggers: ts };
    }
    return t;
}

/**
 * Import anything supported. Returns {ok, pack:{id, name, description, default_enabled, max_per_turn?}, rules[], added,
 * warnings[], format}. The caller stores the pack (see chance/index.js importLoreBary).
 */
export function importPack(input, { userName = '', fileName = '' } = {}) {
    const res = { ok: false, pack: null, rules: [], added: 0, warnings: [], format: 'unknown' };
    const p = parse(input);
    if (p.error) { res.warnings.push(p.error); return res; }
    const warn = w => { if (!res.warnings.includes(w) && res.warnings.length < 60) res.warnings.push(w); };
    const used = new Set();
    const uniq = (base) => { let id = slug(base) || 'rule'; let k = 2; const b = id; while (used.has(id)) id = `${b}_${k++}`; used.add(id); return id; };
    const cleanPool = (label, pool, defaults) => {
        const out = [];
        for (const item of (Array.isArray(pool) ? pool : [pool]).filter(x => typeof x === 'string' && x.trim())) {
            const c = cleanPoolItem(item, { userName, defaults });
            for (const r of c.removed) warn(`${label}: removed "${r.line}" (${r.reason})`);
            if (c.text) out.push(c.text);
        }
        return out;
    };

    if (p.text !== undefined) {
        res.format = 'text';
        const blocks = p.text.includes('\n\n') ? p.text.split(/\n\s*\n/) : p.text.split('\n');
        const pool = cleanPool('text', blocks.map(b => b.trim()).filter(Boolean));
        const name = clip(fileName.replace(/\.[a-z]+$/i, '') || 'Imported prompts', 80);
        res.pack = { id: `imp_${slug(name) || 'text'}`, name, description: 'Imported prompt pool.', default_enabled: true, max_per_turn: 1 };
        const rule = normalizeRule({ id: uniq(`${res.pack.id}_pool`), name, priority: 2, logic: 'all', triggers: [{ type: 'chance', pct: 15 }], cooldown: 3, pool }, res.pack.id);
        if (rule) res.rules.push(rule); else warn('No usable lines.');
    } else {
        const obj = p.obj;
        res.format = detectFormat(obj);
        if (res.format === 'unknown') { warn('Not a LoreBary plugin, lorebook or Undercurrent pack.'); return res; }
        if (res.format === 'uc2' || res.format === 'uc1') {
            const meta = isPlainObject(obj.pack) ? obj.pack : {};
            res.pack = { id: slug(meta.id || meta.name) || 'imported', name: clip(stripInvisible(str(meta.name || meta.id || 'Imported pack')), 80), description: clip(stripInvisible(str(meta.description)), 300), default_enabled: meta.default_enabled !== false, ...(Number(meta.max_per_turn) > 0 ? { max_per_turn: Math.round(Number(meta.max_per_turn)) } : {}) };
            for (const raw of Array.isArray(obj.rules) ? obj.rules : []) {
                if (!isPlainObject(raw)) continue;
                const label = clip(str(raw.name || raw.id || 'rule'), 80);
                let triggers = raw.triggers;
                if (res.format === 'uc1') {
                    triggers = (raw.triggers || []).map(v1Trigger);
                    if (triggers.some(t => !t)) {
                        if (raw.logic === 'all') { warn(`${label}: skipped (variables/switches are not supported)`); continue; }
                        triggers = triggers.filter(Boolean);
                    }
                    if (raw.action?.type === 'set_var') { warn(`${label}: skipped (set_var rules are not supported)`); continue; }
                }
                const pool = cleanPool(label, raw.pool ?? raw.action?.pool ?? []);
                const rule = normalizeRule({ ...raw, triggers, pool, id: uniq(raw.id || raw.name) }, res.pack.id);
                if (rule) res.rules.push(rule); else warn(`${label}: skipped (no usable triggers or lines)`);
            }
        } else {
            const entries = entriesOf(obj).filter(isPlainObject);
            const name = stripInvisible(str(obj?.name || obj?.meta?.name || obj?.title || fileName.replace(/\.[a-z]+$/i, '') || 'Imported pack')).trim();
            res.pack = { id: `lb_${slug(name) || 'pack'}`, name: clip(name, 80), description: clip(stripInvisible(str(obj?.meta?.description || obj?.description)).replace(/<[^>]+>/g, ''), 300), default_enabled: true };
            const defaults = {};
            if (isPlainObject(obj?.variables)) for (const [k, v] of Object.entries(obj.variables)) defaults[k] = isPlainObject(v) ? v.value ?? '' : v;
            const toPct = chanceScale(entries);
            entries.forEach((e, idx) => {
                const label = clip(stripInvisible(str(e.name || e.comment || (Array.isArray(e.key) ? e.key[0] : '') || `entry ${e.uid ?? idx}`)), 80);
                if (res.format === 'lorebook') {
                    if (e.disable === true) return;
                    const keys = (e.key || e.keys || []).map(k => stripInvisible(str(k)).trim()).filter(Boolean);
                    const second = (e.keysecondary || e.secondary_keys || []).map(k => stripInvisible(str(k)).trim()).filter(Boolean);
                    let triggers;
                    let logic = 'any';
                    if (e.constant) triggers = [{ type: 'always' }];
                    else if (!keys.length) { warn(`${label}: skipped (no keys and not constant)`); return; }
                    else if (e.selective && second.length) { logic = 'all'; triggers = [{ type: 'keyword', words: keys, target: 'both' }, { type: 'keyword', words: second, target: 'both' }]; }
                    else triggers = [{ type: 'keyword', words: keys, target: 'both' }];
                    const pool = cleanPool(label, [e.content || ''], defaults);
                    const rule = normalizeRule({ id: uniq(`${res.pack.id}_${e.uid ?? idx}`), name: label, logic, triggers, pool }, res.pack.id);
                    if (rule) res.rules.push(rule); else warn(`${label}: skipped (empty after cleaning)`);
                    return;
                }
                const actions = Array.isArray(e.actions?.default) ? e.actions.default : Array.isArray(e.actions) ? e.actions : [];
                const msg = actions.filter(a => a?.type === 'add_message');
                const pools = msg.map(a => cleanPool(label, a.pool, defaults)).filter(x => x.length);
                const hasCode = typeof e.advancedCode === 'string' && e.advancedCode.trim();
                if (!pools.length) { warn(`${label}: skipped (${hasCode ? 'JavaScript-only entry; code is never executed' : actions.some(a => a?.type === 'run_agent') ? 'run_agent is not supported' : 'no static prompt pool'})`); return; }
                if (hasCode) warn(`${label}: advancedCode ignored (never executed); static text imported`);
                if (actions.some(a => /^set_/.test(str(a?.type)))) warn(`${label}: set_variable/set_switch actions ignored`);
                const logic = str(e.triggerLogic || 'AND').toUpperCase() === 'OR' ? 'any' : 'all';
                const triggers = [];
                const dropped = [];
                for (const g of Array.isArray(e.triggerGroups) ? e.triggerGroups : []) {
                    const r = mapGroup(g, toPct);
                    if (r.trigger) triggers.push(r.trigger); else dropped.push(r.error);
                }
                if (dropped.length && (logic === 'all' || !triggers.length)) { warn(`${label}: skipped (${dropped[0]})`); return; }
                if (dropped.length) warn(`${label}: dropped ${dropped.join('; ')} (OR logic: the other triggers still apply)`);
                if (!triggers.length) { warn(`${label}: skipped (no triggers)`); return; }
                pools.forEach((pool, k) => {
                    const rule = normalizeRule({ id: uniq(`${res.pack.id}_${e.uid ?? idx}${k ? `_${k + 1}` : ''}`), name: k ? `${label} (${k + 1})` : label, logic, triggers, pool }, res.pack.id);
                    if (rule) res.rules.push(rule);
                });
            });
        }
    }
    for (const r of res.rules) r.pack = res.pack.id;
    res.added = res.rules.length;
    res.ok = res.added > 0;
    if (!res.ok) warn('No rules could be imported.');
    return res;
}
