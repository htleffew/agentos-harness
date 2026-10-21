// Undercurrent 2 · FEATURES — chance rules provider: trigger → one directive line, with cooldowns, sticky lines, a
// per-turn budget and starter packs. Code only (no model call).
//
// Swipe consistency: a turn's result is cached under the uc_id of the turn's user message (the anchor), so swiping or
// regenerating the reply re-uses the same lines. Cooldowns, sticky carry-over, cycle positions and max_fires are derived
// by walking the current chat's user messages in order, so deleting or editing messages keeps everything consistent.
//
// Packs: built-in starter packs (extension/data/rulepacks, embedded in ./packs.js) plus imported packs stored in the
// setting `chance.user_packs`; on/off per pack in `chance.packs` ({[packId]: boolean}). CORE's api routes
// listRulePacks / setRulePackEnabled / importLoreBary / removeRulePack here: each takes the effective settings and returns
// {key, value} for CORE to persist with setSetting (pure; nothing is written here).

import { isPlainObject, publicPart } from '../common/text.js';
import { anchor, cleanOf, pruneByUids, userName, charName } from '../common/chat.js';
import { opt, optBool, optNum, sget, sset, rngOf } from '../common/settings.js';
import { sceneKind, presentNames } from '../common/state.js';
import { normalizeRule, rulePasses, produceLine, makeEnv, slug } from './engine.js';
import { importPack } from './importer.js';
import { STARTER_PACKS } from './packs.js';

export const DEFAULTS = Object.freeze({
    'chance.enabled': true,
    'chance.max_lines': 2,
    'chance.multiplier': 1,
    'chance.max_chars': 240,
    'chance.packs': {},
    'chance.user_packs': [],
});

export const SCHEMA = [
    { key: 'chance.enabled', tab: 'director', section: 'Chance rules', type: 'toggle', default: true, label: 'Chance rules',
        help: 'Small trigger → line rules (starter packs on the Rules tab). Lines adapt to whoever is in the scene.', scope: 'story' },
    { key: 'chance.max_lines', tab: 'rules', section: 'Chance rules', type: 'slider', default: 2, min: 0, max: 5, step: 1, label: 'Lines per turn',
        help: 'At most this many rule lines join a turn (highest priority first).', scope: 'setup' },
    { key: 'chance.multiplier', tab: 'rules', section: 'Chance rules', type: 'slider', default: 1, min: 0, max: 3, step: 0.1, advanced: true, label: 'Chance multiplier',
        help: '0 silences chance rolls, 1 = as written, 2 = twice as likely (capped at 100%).', scope: 'story' },
    { key: 'chance.max_chars', tab: 'rules', section: 'Chance rules', type: 'number', default: 240, min: 60, max: 1200, advanced: true, label: 'Max characters per line',
        help: 'Longer lines (usually imported ones) are clipped.', scope: 'setup' },
    { key: 'chance.packs', tab: 'rules', section: 'Chance rules', type: 'json', default: {}, advanced: true, hidden: true, label: 'Pack switches',
        help: 'On/off per pack (managed by the pack list).', scope: 'setup' },
    { key: 'chance.user_packs', tab: 'rules', section: 'Chance rules', type: 'json', default: [], advanced: true, hidden: true, label: 'Imported packs',
        help: 'Packs imported from LoreBary or files (managed by the pack list).', scope: 'setup' },
];

// ---------------------------------------------------------------------------------------------------------------------
// Pack resolution

const resolvedCache = new Map();

function rawPacks(settings) {
    const user = Array.isArray(settings?.['chance.user_packs']) ? settings['chance.user_packs'] : [];
    return [
        ...STARTER_PACKS.map(p => ({ ...p, builtin: true })),
        ...user.filter(isPlainObject).map(p => ({ ...p, builtin: false })),
    ];
}

/** {packs:[{id, name, description, builtin, enabled, max_per_turn, count}], rules:[normalized]} */
export function resolvePacks(settings = {}) {
    const s = isPlainObject(settings) ? settings : {};
    const toggles = isPlainObject(s['chance.packs']) ? s['chance.packs'] : {};
    const key = JSON.stringify([toggles, s['chance.user_packs'] || []]);
    if (resolvedCache.has(key)) return resolvedCache.get(key);
    const packs = [];
    const rules = [];
    const seen = new Set();
    for (const p of rawPacks(s)) {
        const meta = isPlainObject(p.pack) ? p.pack : {};
        const id = slug(meta.id || meta.name);
        if (!id || packs.some(x => x.id === id)) continue;
        const list = (Array.isArray(p.rules) ? p.rules : []).map(r => normalizeRule(r, id)).filter(r => r && !seen.has(r.id));
        list.forEach(r => { r.pack = id; seen.add(r.id); });
        packs.push({
            id, name: String(meta.name || id), description: String(meta.description || ''), builtin: !!p.builtin,
            enabled: typeof toggles[id] === 'boolean' ? toggles[id] : meta.default_enabled !== false,
            max_per_turn: Number(meta.max_per_turn) > 0 ? Math.round(Number(meta.max_per_turn)) : 0,
            count: list.length,
        });
        rules.push(...list);
    }
    const out = { packs, rules };
    resolvedCache.set(key, out);
    if (resolvedCache.size > 10) resolvedCache.delete(resolvedCache.keys().next().value);
    return out;
}

/** For CORE's api.listRulePacks(). */
export function listRulePacks(settings) {
    return resolvePacks(settings).packs.map(p => ({ ...p }));
}

/** For CORE's api.setRulePackEnabled(id, on): returns the setting write to perform. */
export function setRulePackEnabled(settings, id, on) {
    const cur = isPlainObject(settings?.['chance.packs']) ? settings['chance.packs'] : {};
    return { key: 'chance.packs', value: { ...cur, [slug(id)]: !!on } };
}

/** Remove an imported pack (built-in packs can only be switched off). */
export function removeRulePack(settings, id) {
    const user = Array.isArray(settings?.['chance.user_packs']) ? settings['chance.user_packs'] : [];
    return { key: 'chance.user_packs', value: user.filter(p => slug(p?.pack?.id || p?.pack?.name) !== slug(id)) };
}

/**
 * For CORE's api.importLoreBary(text): parse + clean, then return {ok, added, warnings, pack, key, value} where
 * {key, value} is the setting write that stores the new pack (an imported pack with the same id is replaced).
 */
export function importLoreBary(settings, text, { userName: uname = '', fileName = '' } = {}) {
    const r = importPack(text, { userName: uname, fileName });
    const out = { ok: r.ok, added: r.added, warnings: r.warnings, format: r.format, pack: r.pack };
    if (!r.ok) return out;
    const user = Array.isArray(settings?.['chance.user_packs']) ? settings['chance.user_packs'] : [];
    const builtinIds = new Set(STARTER_PACKS.map(p => slug(p.pack?.id)));
    if (builtinIds.has(r.pack.id)) r.pack.id = `${r.pack.id}_imported`;
    const stored = { format: 'undercurrent2-rules', version: 1, pack: r.pack, rules: r.rules.map(({ pack: _p, ...rest }) => rest) };
    out.key = 'chance.user_packs';
    out.value = [...user.filter(p => slug(p?.pack?.id) !== r.pack.id), stored];
    return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Evaluation

function anchorKey(a) {
    return a.user ? (a.userKey || `pos:${a.user.pos}`) : '';
}

/**
 * This turn's lines (cached per anchor). Returns {lines:[{rule, text, priority, sticky}], trace:[{id, reason}]}.
 * The trace is computed only when nothing is cached (debug aid for the UI/dev panel).
 */
export function evaluateTurn(ctx) {
    const a = anchor(ctx);
    const key = anchorKey(a);
    if (!key || !optBool(ctx, 'chance.enabled', true)) return { lines: [], trace: [] };
    const turns = isPlainObject(sget(ctx, 'turns', null)) ? sget(ctx, 'turns', {}) : {};
    if (Array.isArray(turns[key])) return { lines: turns[key], trace: [{ id: '*', reason: 'cached for this turn' }] };

    const settings = isPlainObject(ctx?.settings) ? ctx.settings : {};
    const { packs, rules } = resolvePacks(settings);
    const packById = Object.fromEntries(packs.map(p => [p.id, p]));
    const turn = a.turn;
    const rng = rngOf(ctx);

    // History along the current chat (excluding this anchor): fires per rule with their turn numbers.
    const fired = {};
    const stickyCarry = [];
    a.userUids.slice(0, -1).forEach((uid, i) => {
        for (const f of Array.isArray(turns[uid]) ? turns[uid] : []) {
            if (!f?.rule) continue;
            if (f.carried) continue;
            (fired[f.rule] ||= []).push(i + 1);
            const r = rules.find(x => x.id === f.rule);
            if (r && r.sticky > 0 && turn - (i + 1) <= r.sticky) stickyCarry.push({ rule: r, text: f.text, priority: f.priority });
        }
    });
    const env = makeEnv({
        ctx, turn, rng,
        userText: a.user ? publicPart(a.user.mes) : '',
        replyText: a.reply ? cleanOf(a.reply) : '',
        kinds: sceneKind(ctx).kinds,
        present: presentNames(ctx),
        charName: charName(ctx),
        userName: userName(ctx),
        intimacyOn: optBool(ctx, 'intimacy.enabled', true),
        mult: optNum(ctx, 'chance.multiplier', 1, 0, 3),
        maxChars: optNum(ctx, 'chance.max_chars', 240, 60, 1200),
        setting: k => opt(ctx, k, undefined),
    });
    const budget = Math.round(optNum(ctx, 'chance.max_lines', 2, 0, 5));
    const trace = [];
    const lines = [];
    const perPack = {};
    const admit = (r) => {
        const cap = packById[r.pack]?.max_per_turn || 0;
        if (cap && (perPack[r.pack] || 0) >= cap) return false;
        perPack[r.pack] = (perPack[r.pack] || 0) + 1;
        return true;
    };
    const live = r => r.enabled !== false && packById[r.pack]?.enabled !== false;
    for (const c of stickyCarry.sort((x, y) => y.rule.priority - x.rule.priority)) {
        if (lines.length >= budget || !live(c.rule)) continue;
        if (!admit(c.rule)) continue;
        lines.push({ rule: c.rule.id, text: c.text, priority: c.priority, carried: true });
        trace.push({ id: c.rule.id, reason: 'sticky (still active)' });
    }
    const ordered = rules.map((r, i) => ({ r, i })).sort((x, y) => y.r.priority - x.r.priority || x.i - y.i);
    for (const { r } of ordered) {
        if (lines.length >= budget) { trace.push({ id: r.id, reason: 'over budget' }); continue; }
        if (!live(r)) { trace.push({ id: r.id, reason: 'off' }); continue; }
        if (lines.some(l => l.rule === r.id)) continue;
        const past = fired[r.id] || [];
        if (r.max_fires > 0 && past.length >= r.max_fires) { trace.push({ id: r.id, reason: 'max fires reached' }); continue; }
        const last = past[past.length - 1];
        if (r.cooldown > 0 && last !== undefined && turn - last <= r.cooldown) { trace.push({ id: r.id, reason: 'cooldown' }); continue; }
        if (!rulePasses(r, env)) { trace.push({ id: r.id, reason: 'triggers not met' }); continue; }
        const out = produceLine(r, env, past.length);
        if (!out.text) { trace.push({ id: r.id, reason: out.reason }); continue; }
        if (!admit(r)) { trace.push({ id: r.id, reason: 'pack limit' }); continue; }
        lines.push({ rule: r.id, text: out.text, priority: 40 + r.priority * 4 });
        trace.push({ id: r.id, reason: 'fired' });
    }
    sset(ctx, 'turns', pruneByUids({ ...turns, [key]: lines }, a.userUids, 300));
    return { lines, trace };
}

export default {
    id: 'chance',
    settingsKeys: Object.keys(DEFAULTS),
    turnLines(ctx) {
        if (!optBool(ctx, 'chance.enabled', true)) return [];
        return evaluateTurn(ctx).lines.map(l => ({ slot: 'uc_directive', text: l.text, priority: l.priority, source: `chance:${l.rule}` }));
    },
};
