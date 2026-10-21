// Undercurrent 2 · FEATURES — intimacy: 'uc_cast' lines with each present character's likes, dislikes and limits
// (with the quotes that evidence them) and their intimate history, only while the scene is intimate or attraction is
// live (scene classifier: tracker words + cue words in the latest exchange). No meters, no stages, no gates.
//
// Invariants: limits are ALWAYS restated (own line, top priority) whenever an intimate scene is live; a limit or an
// evidenced dislike outranks any like; nothing here ever describes or decides {{user}}'s arousal, feelings or choices
// ({{user}} never gets a line). Optional one-time seed job (off by default): reads {{char}}'s card and extracts a
// conservative starting profile (content.jobs.seed_profile; strict JSON parse); stored in this feature's store as
// `seed` and merged under the story's own evidence (card items are marked as such).

import { str, clip, isPlainObject, normText, contentTokens, jaccard, stripThink, fillProvided, usesToken } from '../common/text.js';
import { charName, isUser, sameName } from '../common/chat.js';
import { optBool, optNum, phrase, jobPrompt, sget, sset } from '../common/settings.js';
import { findCharacter, intimacyOf, presentNames, sceneKind } from '../common/state.js';
import { unsafeReason } from '../common/safety.js';

export const DEFAULTS = Object.freeze({
    'intimacy.enabled': true,
    'intimacy.seed': false,
    'intimacy.max_likes': 5,
});

export const SCHEMA = [
    { key: 'intimacy.enabled', tab: 'characters', section: 'Intimacy', type: 'toggle', default: true, label: 'Intimacy profiles',
        help: 'While attraction is live or a scene turns intimate, each present character\'s likes, dislikes and limits (with the lines that showed them) ride along. Limits always win.', scope: 'story' },
    { key: 'intimacy.seed', tab: 'characters', section: 'Intimacy', type: 'toggle', default: false, label: 'Seed the main character from the card',
        help: 'One background job after a reply reads the character card once and notes its stated likes, limits and history. Off by default.', scope: 'story' },
    { key: 'intimacy.max_likes', tab: 'characters', section: 'Intimacy', type: 'slider', default: 5, min: 1, max: 10, step: 1, advanced: true, label: 'Likes shown per character',
        help: 'Evidenced likes first, then ones stated in the card.', scope: 'setup' },
];

const GUARD = 'None of this decides what {{user}} feels, wants or does.';

function sameItem(a, b) {
    const na = normText(a);
    const nb = normText(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    const ta = contentTokens(a);
    const tb = contentTokens(b);
    return ta.length > 0 && tb.length > 0 && jaccard(ta, tb) >= 0.6;
}

/** Group evidence entries by item: [{text, quote (newest), count, card}] in first-seen order. */
function group(list, card = false) {
    const out = [];
    for (const e of list) {
        const g = out.find(x => sameItem(x.text || x.quote, e.text || e.quote));
        if (g) { g.count++; if (e.quote) g.quote = e.quote; } else out.push({ text: e.text || e.quote, quote: e.quote, count: 1, card });
    }
    return out;
}

function strength(g) {
    if (g.card) return 'card';
    if (g.count >= 3) return 'well established';
    return '';
}

function item(g) {
    const s = strength(g);
    const q = g.quote && normText(g.quote) !== normText(g.text) ? ` "${clip(g.quote, 70)}"` : '';
    return `${clip(g.text, 60)}${q}${s ? ` (${s})` : ''}`;
}

/** Merge a character's evidence with the card seed (seed items only where the story says nothing). */
export function profileFor(ctx, name) {
    const rec = findCharacter(ctx, name);
    const live = intimacyOf(rec?.c || {});
    const seedAll = sget(ctx, 'seed', {});
    const seed = isPlainObject(seedAll?.profiles) ? Object.entries(seedAll.profiles).find(([k]) => sameName(k, name))?.[1] : null;
    const merge = (key) => {
        const own = group(live[key]);
        const extra = isPlainObject(seed) && Array.isArray(seed[key]) ? group(seed[key].map(t => (isPlainObject(t) ? { text: str(t.text), quote: str(t.quote) } : { text: str(t), quote: '' })), true) : [];
        for (const e of extra) if (!own.some(o => sameItem(o.text, e.text))) own.push(e);
        return own;
    };
    const limits = merge('limits');
    const dislikes = merge('dislikes').filter(d => !limits.some(l => sameItem(l.text, d.text)));
    const blocked = [...limits, ...dislikes];
    const likes = merge('likes').filter(l => !blocked.some(b => sameItem(b.text, l.text)));
    likes.sort((x, y) => Number(x.card) - Number(y.card) || y.count - x.count);
    return { name: rec?.name || name, limits, dislikes, likes, history: merge('history') };
}

/** Lines for the current turn (empty unless the scene is intimate or attraction is live). */
export function intimacyLines(ctx) {
    const sk = sceneKind(ctx);
    if (!sk.intimate && !sk.attraction) return [];
    const maxLikes = Math.round(optNum(ctx, 'intimacy.max_likes', 5, 1, 10));
    const out = [];
    for (const n of presentNames(ctx)) {
        if (isUser(ctx, n)) continue;
        const p = profileFor(ctx, n);
        if (p.limits.length) out.push({ slot: 'uc_cast', text: `${p.name}'s limits (they hold, whatever the moment): ${p.limits.map(item).join('; ')}`, priority: sk.intimate ? 100 : 86, source: 'intimacy:limits' });
        const bits = [];
        if (p.dislikes.length) bits.push(`dislikes: ${p.dislikes.slice(0, 4).map(item).join('; ')}`);
        if (p.likes.length) bits.push(`likes: ${p.likes.slice(0, maxLikes).map(item).join('; ')}`);
        if (p.history.length && sk.intimate) bits.push(`so far: ${p.history.slice(-2).map(h => clip(h.text, 90)).join('; ')}`);
        if (bits.length) out.push({ slot: 'uc_cast', text: `${p.name} (intimacy) — ${bits.join(' · ')}`, priority: sk.intimate ? 76 : 66, source: 'intimacy:profile' });
    }
    if (out.length && sk.intimate) out.push({ slot: 'uc_cast', text: phrase(ctx, 'intimacy_guard', GUARD), priority: 99, source: 'intimacy:guard' });
    return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Seed job (content.jobs.seed_profile: the model answers with a <New_Character> and an <Intimacy> block in the envelope
// grammar; a JSON object is accepted too). Evidence rule: a likes/dislikes/limit line whose quote is not found in the
// card is dropped; "unknown" values are ignored. Never anything about {{user}}.

const SEED_SYSTEM = [
    'You read a fictional character card and write a private continuity profile for {{char}}. Use only what the card states or clearly implies; where the card is silent write "unknown"; never invent kinks, history or limits.',
    'Output EXACTLY these two blocks, nothing before or after:',
    '<New_Character name="{{char}}">',
    'role: … | look: … | voice: … | wants: … | ikigai: … | secret: … | sexual self: orientation, style, limits',
    '</New_Character>',
    '<Intimacy name="{{char}}">',
    'likes: <item> "<short verbatim quote from the card>"',
    'dislikes: <item> "<quote>"',
    'limit: <item> "<quote>"',
    'history: <relevant past>',
    '</Intimacy>',
    'Each likes, dislikes and limit line needs a verbatim quote from the card. At most 6 lines of each kind. Never write anything about {{user}}.',
].join('\n');
const SEED_USER = '<card>\n{card}\n</card>\nWrite the two blocks now.';

function cardBlock(ctx) {
    const c = ctx?.card || {};
    return [
        c.name ? `Name: ${str(c.name)}` : '',
        c.description ? clip(c.description, 6000) : '',
        c.personality ? `Personality: ${clip(c.personality, 2000)}` : '',
        c.scenario ? `Scenario: ${clip(c.scenario, 2000)}` : '',
    ].filter(Boolean).join('\n');
}

export function buildSeed(ctx) {
    const p = jobPrompt(ctx, 'seed_profile');
    const card = cardBlock(ctx);
    let user = p.user || SEED_USER;
    user = usesToken(user, 'card') ? fillProvided(user, { card }) : `${user}\n\n<card>\n${card}\n</card>`;
    return { systemPrompt: p.system || SEED_SYSTEM, prompt: user, responseLength: 700, tokens: { card } };
}

const UNKNOWN = /^(?:unknown|none|n\/a|not stated|-|—)?$/i;

function seedItem(raw) {
    const s = str(raw).trim();
    const m = s.match(/^(.*?)\s*["“]([^"”]+)["”]\s*$/);
    const text = (m ? m[1] : s).replace(/[\s:,-]+$/, '').trim();
    return { text, quote: m ? m[2].trim() : '' };
}

function blockBody(text, tag) {
    const m = str(text).match(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)(?:</${tag}\\s*>|(?=<[A-Z][A-Za-z_]*\\b)|$)`, 'i'));
    if (!m) return null;
    const name = (m[1].match(/name\s*=\s*["“]([^"”]+)["”]/i) || [])[1] || '';
    return { name: name.trim(), body: m[2] };
}

/**
 * Strict parse of the seed answer → {name, likes[], dislikes[], limits[], history[], profile{}} or null.
 * Items are {text, quote}. `cardText` (when given) must contain every likes/dislikes/limit quote.
 */
export function parseSeed(text, { cardText = '' } = {}) {
    const s = stripThink(text).replace(/```(?:json|xml)?/gi, '').trim();
    if (!s) return null;
    const out = { name: '', likes: [], dislikes: [], limits: [], history: [], profile: {} };
    const keep = (it) => it.text && it.text.length <= 120 && !UNKNOWN.test(it.text) && !/[<>{}]/.test(it.text) && !unsafeReason(it.text)
        && (!cardText || !it.quote || normText(cardText).includes(normText(it.quote)));
    const intim = blockBody(s, 'Intimacy');
    const nc = blockBody(s, 'New_Character');
    if (intim || nc) {
        out.name = (intim?.name || nc?.name || '').trim();
        for (const line of str(intim?.body).split('\n')) {
            const m = line.match(/^\s*[-*]?\s*(likes?|dislikes?|limits?|history)\s*:\s*(.+)$/i);
            if (!m) continue;
            const kind = m[1].toLowerCase().replace(/s$/, '');
            const it = seedItem(m[2]);
            if (kind !== 'history' && cardText && !it.quote) continue; // evidence rule: quotes required
            if (!keep(it)) continue;
            const key = kind === 'like' ? 'likes' : kind === 'dislike' ? 'dislikes' : kind === 'limit' ? 'limits' : 'history';
            if (out[key].length < (key === 'history' ? 6 : 6)) out[key].push(kind === 'history' ? { text: it.text, quote: '' } : it);
        }
        for (const part of str(nc?.body).replace(/\n/g, ' | ').split('|')) {
            const m = part.match(/^\s*([a-z][a-z _]{1,20}?)\s*:\s*(.+?)\s*$/i);
            if (m && !UNKNOWN.test(m[2]) && m[2].length <= 200) out.profile[m[1].toLowerCase().replace(/\s+/g, '_')] = m[2];
        }
        return Object.values(out).some(v => (Array.isArray(v) ? v.length : Object.keys(v || {}).length)) ? out : null;
    }
    const j = s.match(/\{[\s\S]*\}/);
    if (!j) return null;
    let obj;
    try { obj = JSON.parse(j[0]); } catch { return null; }
    if (!isPlainObject(obj)) return null;
    const list = (v, max) => (Array.isArray(v) ? v : []).map(x => (isPlainObject(x) ? { text: str(x.item ?? x.text).trim(), quote: str(x.quote).trim() } : seedItem(x))).filter(keep).slice(0, max);
    out.likes = list(obj.likes ?? obj.preferences, 12);
    out.dislikes = list(obj.dislikes, 8);
    out.limits = list(obj.limits, 10);
    out.history = list(obj.history, 6).map(h => ({ text: h.text, quote: '' }));
    if (!['likes', 'preferences', 'dislikes', 'limits', 'history'].some(k => Array.isArray(obj[k]))) return null;
    return out;
}

/** Store the seed for a character (feature store) and hand it to CORE's derived-state seed when available. */
export function applySeed(result, store, name) {
    if (!isPlainObject(result) || !store?.get) return;
    const cur = isPlainObject(store.get('seed')) ? store.get('seed') : {};
    const profiles = { ...(isPlainObject(cur.profiles) ? cur.profiles : {}) };
    const who = str(name) || str(cur.pending) || str(result.name) || '{{char}}';
    const norm = l => (Array.isArray(l) ? l : []).map(x => (isPlainObject(x) ? { text: str(x.text), quote: str(x.quote) } : { text: str(x), quote: '' })).filter(x => x.text);
    const intimacy = { likes: norm(result.likes), dislikes: norm(result.dislikes), limits: norm(result.limits), history: norm(result.history) };
    profiles[who] = intimacy;
    store.set('seed', { ...cur, profiles, pending: '', done: [...new Set([...(cur.done || []), who.toLowerCase()])] });
    try {
        store.setSeed?.(`char:${who}`, 'intimacy', intimacy);
        if (isPlainObject(result.profile) && Object.keys(result.profile).length) store.setSeed?.(`char:${who}`, 'profile', result.profile);
    } catch { /* optional CORE hook */ }
}

/** {{char}}'s name when a seed job should run. A manual run (ctx.manualJob) skips the switch and the done/attempt caps. */
function seedNeeded(ctx, manual = false) {
    const name = charName(ctx);
    if (!name) return '';
    if (!manual) {
        if (!optBool(ctx, 'intimacy.seed', false) || !optBool(ctx, 'intimacy.enabled', true)) return '';
        const cur = sget(ctx, 'seed', {});
        if ((cur.done || []).includes(name.toLowerCase())) return '';
        if ((cur.attempts?.[name.toLowerCase()] || 0) >= 2) return '';
    }
    if (!str(ctx?.card?.description) && !str(ctx?.card?.personality)) return '';
    return name;
}

export const jobs = {
    seed_profile: {
        build(ctx) {
            const name = charName(ctx);
            const cur = sget(ctx, 'seed', {});
            const attempts = { ...(cur.attempts || {}) };
            attempts[name.toLowerCase()] = (attempts[name.toLowerCase()] || 0) + 1;
            sset(ctx, 'seed', { ...cur, pending: name, attempts });
            return buildSeed(ctx);
        },
        parse(text, spec) { return parseSeed(text, { cardText: spec?.meta?.cardText || '' }); },
        apply(result, store, spec) { applySeed(result, store, spec?.meta?.name); },
    },
};

export default {
    id: 'intimacy',
    settingsKeys: Object.keys(DEFAULTS),
    jobs,
    turnLines(ctx) {
        if (!optBool(ctx, 'intimacy.enabled', true)) return [];
        return intimacyLines(ctx);
    },
    onReply(ctx) {
        const name = seedNeeded(ctx, ctx?.manualJob === 'seed_profile');
        if (!name) return [];
        return [{
            kind: 'seed_profile', provider: 'intimacy', dedupeKey: `seed_profile:${name.toLowerCase()}`, meta: { name },
            buildRequest: () => jobs.seed_profile.build(ctx),
            parse: text => parseSeed(text, { cardText: cardBlock(ctx) }),
            apply: (result, store) => applySeed(result, store || ctx.store, name),
        }];
    },
};
