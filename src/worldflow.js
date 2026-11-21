import { historySourceMatches } from './history-source.js';
import { recallPolicy } from './recall.js';
import { memoryComponents } from './components.js';
import { separateReply } from './reply-format.js';
import { extractUpdate, normalizeRecord, readRecord, recordMap, effectiveModules, ensureWorld, enabledV10, baselineFor, effectivePortrayal, PLOT_KINDS, baseWorld, prefs } from './v10.js';
import { promptText, promptStatus } from './prompts.js';
import { trimBranchOverrides, correctionAnchor, sceneFromReplyHeader } from './state.js';
// Keeping the story world up to date by itself.
//  1. With each reply the extension asks the model to add one short block that records what the reply made true.
//     The block is lifted out of the reply and filed as world entries. No extra AI request is made.
//  2. Open threads build by themselves, and now and then something that is ready is ordered into the scene.
//  3. Every automatic change is stored with the reply that caused it, and is undone when that reply is swiped
//     away or deleted.
import { ctx, KEY, LOG, names, isReply, toast } from './st.js';
import { settings, chatState, saveChatState } from './store.js';
import { addLog } from './log.js';
import { rollInt, pickWeighted, setInfo, entriesOf, createSet, knownSets } from './books.js';
import { worldOffers, rememberStory } from './pacing.js';
import { showAgain } from './hide.js';
import { WORLD_KINDS, MAX_ACTIVITIES, DONE, HUD_BLOCKS, chapterIsMine, namedIn, listWorld, newWorldEntry, writeWorldEntry, chatWorld, loadWorld, saveWorld, storyRecall } from './world.js';

export const ASK_WORLD = 'Roleplay Instructions story update';
export const ORDER_WORLD = 'Story world';
export const isAsk = e => e?.world === ASK_WORLD;
export const isOrder = e => e?.world === ORDER_WORLD;
export const PACE_WORLD = 'Roleplay Instructions story phase';
export const isPace = e => e?.world === PACE_WORLD;
export const DICE_WORLD = 'Roleplay Instructions dice';
export const isDice = e => e?.world === DICE_WORLD;
export const ORDER_KEY = `${ORDER_WORLD}.0`;

const clean = t => String(t ?? '').replace(/\s+/g, ' ').trim();
const norm = t => clean(t).toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, '').trim();

function synthetic(world, comment, content, depth) {
    return {
        uid: 0, world, comment, content, key: [], keysecondary: [],
        constant: true, vectorized: false, selective: true, selectiveLogic: 0, addMemo: true, order: 110, position: 4, depth, role: 0,
        disable: false, ignoreBudget: true, excludeRecursion: true, preventRecursion: true, delayUntilRecursion: 0,
        probability: 100, useProbability: false, group: '', groupOverride: false, groupWeight: 100,
        scanDepth: null, caseSensitive: null, matchWholeWords: null, useGroupScoring: null, automationId: '',
        sticky: null, cooldown: null, delay: null, triggers: [], outletName: '', displayIndex: 0,
        characterFilter: { isExclude: false, names: [], tags: [] }, extensions: { ri: { type: 'flow' } },
    };
}
export const askEntry = text => synthetic(ASK_WORLD, 'Story update request', text, 0);
export const orderEntry = () => synthetic(ORDER_WORLD, 'Story world', 'story world', 1);
export const paceEntry = text => synthetic(PACE_WORLD, 'Story phase', text, 2);
export const diceEntry = () => synthetic(DICE_WORLD, 'Dice', 'dice', 1);

/** True when the newest message from the user starts out of character, as in "(OOC: ...)". */
export function isOocTurn() {
    const chat = ctx().chat || [];
    for (let i = chat.length - 1; i >= 0; i--) if (chat[i]?.is_user) return /^[\s(\[<*]*OOC\b/i.test(String(chat[i].mes ?? ''));
    return false;
}

// ---------- the request ----------

const FORM = [
    ['person', 'Name | their role in the story | who they are'],
    ['wants', 'Name | what they want now'],
    ['plans', 'Name | what they plan to do next'],
    ['knows', 'Name | what they learned in this reply'],
    ['believes', 'Name | what they now believe'],
    ['suspects', 'Name | what they now suspect'],
    ['wrong', 'Name | what they are wrong about'],
    ['place', 'Name | what it is'],
    ['group', 'Name | what it is'],
    ['thread', 'Short title | the matter that is now open'],
    ['moved', 'Thread title | what happened to it in this reply'],
    ['settled', 'Thread title | how it ended'],
    ['secret', 'Short title | whose secret | the secret'],
    ['out', 'Secret title | who found out'],
    ['planted', 'Short title | the small detail that can matter later'],
    ['paid', 'Planted detail title | how it paid off'],
    ['elsewhere', 'Short title | who | what they are doing away from the scene'],
];
// CLEAR/RESOLVED are field values, never subjects of automatic world updates.
const isClearSubject = value => /^(clear|resolved)$/i.test(norm(value));
const PLACEHOLDER = /^(name|short title|thread title|secret title|planted detail title|title|none|nothing|n\/a|-+|\.+)$/i;

/** The three lines about the scene itself. They are asked for with every reply, with or without a story world, so the
 * extension knows who is present, where and when under any preset. */
const SCENE_FORM = [
    ['present', 'everyone in the scene at the end of this reply other than {{user}}, by name, separated by commas'],
    ['where', 'the place where the scene is at the end of this reply'],
    ['when', 'the day, the time of day and the weather at the end of this reply'],
    ['environment', 'important continuing physical conditions or hazards; omit if unchanged, CLEAR if resolved'],
];
const sceneLines = () => SCENE_FORM.map(([k, v]) => `${k}: ${v}`);

/** The request for the scene lines and the character cards, for a chat with no story world. type: the kind of generation. */
export function buildSceneAsk(type = 'normal') {
    const track = settings().scene?.track !== false;
    const cards = cardsOn();
    if (!track && !cards) return '';
    const what = [track ? 'who is present, where and when' : '', cards ? 'character profiles' : ''].filter(Boolean).join(', and ');
    return [
        `[Scene. ${promptText('scene', { what, sceneRule: track ? ' Fill in all three scene lines.' : '' })}${promptStatus('scene').customized ? ' Output the following <story_update> block after the story text.' : ''}`,
        '<story_update>',
        ...(track ? sceneLines() : []),
        ...(track ? ['scene: continues (or "ended" when the story moved on to a new time or place)'] : []),
        ...cardForm(),
        '</story_update>',
        ...cardRules(onFileNames([], type), type),
    ].join('\n') + ']';
}

// ---------- character profile cards and the roast ----------

/** The lines of a profile that say who the person is. They are kept (in the story world, or with the chat) and asked for once. */
export const PROFILE_STABLE = [
    ['who', 'Who', 'personality and background, in two or three plain facts'],
    ['strength', 'Strength', 'their main strength'],
    ['flaw', 'Flaw', 'their main flaw'],
    ['voice', 'Voice', 'how they talk (rhythm, word choice, habits of speech)'],
    ['orientation', 'Orientation', 'as their card or the story states it'],
];
/** The lines of a profile that say what is going on in the person now. They are written new with every reply. */
export const PROFILE_NOW = [
    ['wants', 'Wants', 'what they want right now, and in the long run'],
    ['thinks', 'Thinks', 'what they think about what just happened'],
    ['feels', 'Feels', 'what they feel, named plainly, such as "Hale feels angry"'],
    ['shows', 'Shows', 'what they let the others see'],
    ['private', 'Keeps private', 'what they think or feel and do not say'],
    ['willnot', 'Will not', 'what they refuse to do in this scene'],
    ['why', 'Why', 'how who they are led to what they just did, felt or chose in this reply'],
    ['mind', 'Mind', 'current goal, attention or plan'],
    ['heart', 'Heart', 'salient emotion or relationship tension'],
    ['body', 'Body', 'persistent physical condition or injury'],
    ['psyche', 'Psyche', 'established inner conflict or vulnerability'],
];
const PROFILE_LINES = [...PROFILE_STABLE, ...PROFILE_NOW];
const ROAST_FORM = "the commentator's reaction to this reply";

export function cardsOn() {
    const c = settings().cards;
    return !!(settings().enabled !== false && c?.on);
}
const roastOn = () => cardsOn() && settings().cards.roast !== false;
const cardMost = () => Math.max(1, Math.min(3, Math.round(Number(settings().cards?.most) || 2)));

function cardForm() {
    if (!cardsOn()) return [];
    return [
        '<profile name="{{char}}">',
        ...PROFILE_NOW.filter(([k]) => ['mind', 'heart', 'body', 'psyche'].includes(k)).map(([, label, help]) => `${label}: ${help}`),
        '</profile>',
        ...(roastOn() ? ['<roast>', ROAST_FORM, '</roast>'] : []),
    ];
}

/** True when a person's profile is on file: the four lines that describe them are filled in. */
const complete = (f) => ['who', 'strength', 'flaw', 'voice'].every(k => clean(f?.[k]));

/** Who a person is, from the newest card of theirs in this chat before message `before`. Swipes, deletes and branches follow by themselves. */
export function keptProfile(name, before = Infinity) {
    const chat = ctx().chat || [];
    for (let i = Math.min(chat.length, before) - 1; i >= 0; i--) {
        const p = (chat[i]?.extra?.[KEY]?.profiles || []).find(x => norm(x.name) === norm(name));
        if (p && Object.keys(p.stable || {}).length) return p.stable;
    }
    return null;
}

/** Names whose profile is on file, from the story world's characters and from earlier cards in this chat. */
export function onFileNames(list, type = 'normal') {
    const out = list.filter(w => w.on && w.kind === 'character' && complete(w.fields)).map(w => clean(w.name));
    const chat = ctx().chat || [];
    // A reply that is being replaced by a swipe does not count.
    const upTo = type === 'swipe' && chat.length && !chat[chat.length - 1]?.is_user ? chat.length - 1 : chat.length;
    for (const m of chat.slice(0, upTo)) for (const p of m?.extra?.[KEY]?.profiles || []) if (complete(p.stable) && !out.some(n => norm(n) === norm(p.name))) out.push(clean(p.name));
    return out.filter(Boolean).slice(0, 30);
}

/** The roast written about the reply before the one being written now. */
export function lastRoast(type = 'normal') {
    const chat = ctx().chat || [];
    let i = chat.length - 1;
    if ((type === 'swipe' || type === 'continue') && i >= 0 && !chat[i]?.is_user) i--;
    for (; i >= 0 && i >= chat.length - 8; i--) {
        const m = chat[i];
        if (!m || m.is_user || m.is_system) continue;
        return clean(m.extra?.[KEY]?.roast || '');
    }
    return '';
}

function cardRules(onFile, type) {
    if (!cardsOn()) return [];
    const most = cardMost();
    const lines = [
        `Profiles: {{char}} gets a profile in every reply.${most > 1 ? ` Another character gets one only when they are present and what they did in this reply changed what happens next: they spoke to {{user}}, made a choice, or acted on a goal of their own. ${most} profiles at most.` : ' Nobody else gets one.'} {{user}} never gets one. ${promptText('profile')}${promptStatus('profile').customized ? ' Omit unchanged fields and use CLEAR to resolve a field.' : ''}`,
        `For a person whose profile is not on file yet, add five lines at the top of their profile: ${PROFILE_STABLE.map(([, label, help]) => `${label}: ${help}`).join('. ')}. Profiles on file: ${onFile.join(', ') || 'none yet'}.`,
    ];
    if (roastOn()) {
        lines.push(`Roast: ${clean(settings().cards.voice) || 'one short reaction from a viewer of this reply'}`);
        const prev = settings().cards.previousRoast === false ? '' : lastRoast(type);
        if (prev) lines.push(`The commentator's reaction to the previous reply was: ${prev}`);
    }
    return lines;
}

const PROFILE_BLOCK = /<profile\b([^>]*)>([\s\S]*?)(?:<\/profile\s*>|(?=<profile\b|<roast\b|<\/story_update|$))/gi;
const ROAST_BLOCK = /<roast\b[^>]*>([\s\S]*?)(?:<\/roast\s*>|(?=<profile\b|<\/story_update|$))/gi;
const NAME_PLACEHOLDER = /^(\[?name\]?|\{\{char\}\}|character|none)$/i;

/** Read the profiles and the roast in a piece of text. Returns { profiles: [{ name, now, stable }], roast, rest } where rest is the text without them. */
export function parseCards(text) {
    const src = String(text ?? '');
    const profiles = [];
    let roast = '';
    const charName = clean(names().char);
    let rest = src.replace(PROFILE_BLOCK, (all, attrs, body) => {
        const nm = String(attrs).match(/name\s*=\s*["“']?([^"”'>]+)/i);
        let name = clean(nm?.[1] || '');
        if (/^\{\{char\}\}$/i.test(name)) name = charName;
        if (!name || isClearSubject(name) || NAME_PLACEHOLDER.test(name) || name.length > 60) return '';
        const now = {}, stable = {};
        for (const raw of String(body).split('\n')) {
            const line = raw.replace(/^[\s\-*•]+/, '').replace(/\*\*/g, '').trim();
            const hit = PROFILE_LINES.find(([, label]) => line.toLowerCase().startsWith(label.toLowerCase() + ':'));
            if (!hit) continue;
            const v = clean(line.slice(hit[1].length + 1)).replace(/^\[|\]$/g, '');
            if (!v || norm(v) === norm(hit[2]) || v.length > 600) continue;
            (PROFILE_STABLE.includes(hit) ? stable : now)[hit[0]] = /^(clear|resolved)$/i.test(v) && ['mind', 'heart', 'body', 'psyche'].includes(hit[0]) ? null : v;
        }
        if (!Object.keys(now).length && !Object.keys(stable).length) return '';
        const same = profiles.find(p => norm(p.name) === norm(name));
        if (same) { Object.assign(same.now, now); Object.assign(same.stable, stable); } else profiles.push({ name, now, stable });
        return '';
    });
    rest = rest.replace(ROAST_BLOCK, (all, body) => {
        const v = String(body).replace(/\s+\n/g, '\n').trim();
        if (v && norm(v) !== norm(ROAST_FORM)) roast = v.slice(0, 1200);
        return '';
    });
    return { profiles: profiles.slice(0, 3), roast, rest };
}

/** The text that asks for the block. list: the world's entries. */
export function buildAsk(list, type = 'normal') {
    const on = list.filter(w => w.on);
    const names = (kind, keep = () => true) => on.filter(w => w.kind === kind && keep(w)).map(w => clean(w.name)).filter(Boolean).slice(0, 40).join(', ') || 'none yet';
    return [
        `[Story update. ${promptText('worldUpdate')}${promptStatus('worldUpdate').customized ? ' Output the following <story_update> block after the story text.' : ''}`,
        '<story_update>',
        ...(settings().scene?.track !== false ? sceneLines() : []),
        ...FORM.map(([k, v]) => `${k}: ${v}`),
        'scene: continues (or "ended" when the story moved on to a new time or place)',
        ...cardForm(),
        '</story_update>',
        ...cardRules(onFileNames(list, type), type),
        '"person", "place" and "group" are for ones that have a name and are not on file yet. Use the names and titles on file exactly as they are written here.',
        `On file. People: ${names('character')}. Places: ${names('place')}. Groups: ${names('faction')}. Open threads: ${names('thread', w => w.status !== DONE.thread)}. Kept secrets: ${names('secret', w => w.status === 'kept')}. Planted details: ${names('seed', w => w.status !== DONE.seed)}. Going on elsewhere: ${names('activity', w => w.status !== DONE.activity)}.]`,
    ].join('\n');
}

// ---------- reading the block ----------

const BLOCK = /\s*<story_update\b[^>]*>([\s\S]*?)(?:<\/story_update\s*>|$)/i;
const BLOCK_ALL = /\s*<story_update\b[^>]*>[\s\S]*?(?:<\/story_update\s*>|$)/gi;
export const stripUpdateBlock = text => String(text ?? '').replace(BLOCK_ALL, '');
const ARITY = Object.fromEntries(FORM.map(([k, v]) => [k, v.split('|').length]));

/** Find the block in a reply. Returns { found, ops: [{ k, a, b, c }], ended, block, clean }. */
export function parseUpdate(text) {
    const src = String(text ?? '');
    const modern = extractUpdate(src);
    if (modern) return { ops:[], profiles:[], block:'', ended:false, scene:null, roast:'', ...modern, modern:true };
    const m = src.match(BLOCK);
    if (!m) return { found: false, ops: [], ended: false, block: '', clean: src, scene: null, profiles: [], roast: '' };
    const ops = [];
    let ended = false;
    const scene = {};
    // Profiles and the roast sit inside the block. They are read first, so their lines are not read as update lines.
    const cards = parseCards(m[1]);
    for (const p of cards.profiles) {
        if (Object.keys(p.stable).length) ops.push({ k: 'profile', a: p.name, b: '', c: '', f: { ...p.stable } });
        if (p.now.wants) ops.push({ k: 'wants', a: p.name, b: p.now.wants, c: '' });
    }
    for (const raw of cards.rest.split('\n')) {
        const line = raw.replace(/^[\s\-*•]+/, '').replace(/\*\*/g, '').trim();
        const hit = line.match(/^([a-z]+)\s*:\s*(.+)$/i);
        if (!hit) continue;
        const k = hit[1].toLowerCase();
        if (k === 'scene') { ended = /^\W*ended\b/i.test(hit[2]); continue; }
        if (k === 'present' || k === 'where' || k === 'when' || k === 'environment') {
            const v = clean(hit[2]).replace(/[.]+$/, '');
            // A line copied from the form with nothing filled in is left out.
            if (v && !SCENE_FORM.some(([fk, fv]) => fk === k && norm(fv) === norm(v))) scene[k] = k === 'environment' && /^(clear|resolved)$/i.test(v) ? '' : v.slice(0, 300);
            continue;
        }
        if (!ARITY[k]) continue;
        const parts = hit[2].split('|').map(clean);
        if (!parts[0] || isClearSubject(parts[0]) || PLACEHOLDER.test(parts[0]) || parts[0].length > 80) continue;
        // A line copied from the form with nothing filled in is left out.
        if (FORM.some(([fk, fv]) => fk === k && norm(fv) === norm(hit[2]))) continue;
        ops.push({ k, a: parts[0], b: parts[1] || '', c: parts.slice(2).join(' | ') });
    }
    return { found: true, ops, ended, block: clean(m[0]), clean: stripUpdateBlock(src).trimEnd(), scene: Object.keys(scene).length ? scene : null, profiles: cards.profiles, roast: cards.roast };
}

// ---------- filing what the block says ----------

/** Lines of an entry you wrote that the extension may keep up to date. Everything else you wrote stays as written. */
const LIVE = { character: ['wants', 'plans', 'knows', 'believes', 'suspects', 'wrong'], thread: ['latest'], secret: ['known'], activity: ['step'] };
const LISTS = ['knows', 'believes', 'suspects', 'wrong'];
const MAX_NEW = 6;      // new entries from one reply
const MAX_LIST = 6;     // sentences kept in a list line such as "What they know"

function similar(a, b) {
    const x = norm(a), y = norm(b);
    if (!x || !y) return false;
    if (x === y || x.includes(y) || y.includes(x)) return true;
    const A = new Set(x.split(' ').filter(w => w.length > 2)), B = new Set(y.split(' ').filter(w => w.length > 2));
    if (!A.size || !B.size) return false;
    let both = 0;
    for (const w of A) if (B.has(w)) both++;
    return both / (A.size + B.size - both) >= 0.6;
}

/** The entry of this kind that a name or title means, or null. */
function findEntry(list, kind, name) {
    const n = norm(name);
    if (!n) return null;
    const mine = list.filter(w => w.kind === kind);
    return mine.find(w => [w.name, ...w.aliases].some(x => norm(x) === n))
        || mine.find(w => n.length >= 3 && (namedIn(name, w) || namedIn([w.name, ...w.aliases].join(' , '), { name, aliases: [] })))
        || (['thread', 'secret', 'seed', 'activity'].includes(kind) ? mine.find(w => similar(w.name, name)) : null)
        || null;
}

const stepIndex = (kind, status) => WORLD_KINDS[kind].steps.findIndex(s => s[0] === status);

/**
 * Apply the lines of one block. meta: { chat, n } the chat and reply number. mode: 'all' or 'auto'.
 * Changes the data in place and returns the list of changes, each of which can be undone.
 */
export function applyOps(data, id, ops, meta, mode = 'all', maxNew = MAX_NEW) {
    const list = listWorld(data, id);
    const changes = [];
    const dirty = new Set();
    let made = 0;
    const editable = w => !w.locked && (mode !== 'history' || w.auto && w.on && !(w.at?.chat === meta.chat && w.at.n > meta.n));
    const may = (w, field) => editable(w) && (w.auto || (mode === 'all' && (LIVE[w.kind] || []).includes(field)));
    const mayStatus = (w) => editable(w) && (w.auto || mode === 'all');
    const set = (w, field, value) => {
        const after = clean(value);
        const before = clean(w.fields[field]);
        if (!after || after === before || !may(w, field)) return false;
        w.fields[field] = after; dirty.add(w);
        changes.push({ uid: w.uid, name: w.name, kind: w.kind, type: 'set', field, before, after });
        return true;
    };
    const status = (w, to, why = '') => {
        if (w.status === to || !mayStatus(w)) return false;
        changes.push({ uid: w.uid, name: w.name, kind: w.kind, type: 'status', before: w.status, after: to, beforeAt: w.at ? { ...w.at } : null, afterAt: { chat: meta.chat, n: meta.n }, why });
        w.status = to; w.at = { chat: meta.chat, n: meta.n }; dirty.add(w);
        return true;
    };
    const create = (kind, name, fields) => {
        if (made >= maxNew || !clean(name) || clean(name).length > 60) return null;
        const w = newWorldEntry(data, kind);
        // The number is taken now, so a second new entry in the same reply gets the next one.
        Object.assign(w, { name: clean(name), auto: true, at: { chat: meta.chat, n: meta.n } });
        for (const [k, v] of Object.entries(fields)) w.fields[k] = clean(v);
        writeWorldEntry(data, w, id);
        delete w.isNew;
        list.push(w); made++;
        changes.push({ uid: w.uid, name: w.name, kind, type: 'create', createdState: creationFingerprint(w) });
        return w;
    };

    for (const op of ops) {
        const { k, a, b, c } = op;
        if (isClearSubject(a)) continue;
        if (k === 'profile') {
            // Who a person is: a new person gets an entry, and an entry gets the lines it does not have yet.
            const w = findEntry(list, 'character', a);
            if (!w) { create('character', a, op.f || {}); continue; }
            if (!editable(w)) continue;
            for (const [field, value] of Object.entries(op.f || {})) {
                const after = clean(value);
                if (!after || clean(w.fields[field]) || !WORLD_KINDS.character.fields.some(x => x.key === field)) continue;
                w.fields[field] = after; dirty.add(w);
                changes.push({ uid: w.uid, name: w.name, kind: w.kind, type: 'set', field, before: '', after });
            }
            continue;
        }
        if (k === 'person') { if (!findEntry(list, 'character', a)) create('character', a, { role: b, who: c }); continue; }
        if (k === 'place' || k === 'group') { const kind = k === 'group' ? 'faction' : 'place'; if (!findEntry(list, kind, a)) create(kind, a, { what: b }); continue; }
        if (k === 'wants' || k === 'plans') { const w = findEntry(list, 'character', a); if (w && !similar(w.fields[k], b)) set(w, k, b); continue; }
        if (LISTS.includes(k)) {
            const w = findEntry(list, 'character', a);
            if (!w || !b) continue;
            const have = clean(w.fields[k]).split(/\s*;\s*/).filter(Boolean);
            if (have.some(x => similar(x, b))) continue;
            set(w, k, [...have, b.replace(/[.;]+$/, '')].slice(-MAX_LIST).join('; '));
            continue;
        }
        if (k === 'thread') { if (!findEntry(list, 'thread', a)) create('thread', a, { open: b }); continue; }
        if (k === 'moved') {
            const w = findEntry(list, 'thread', a);
            if (!w || w.status === DONE.thread) continue;
            const steps = WORLD_KINDS.thread.steps;
            const next = steps[Math.min(stepIndex('thread', w.status) + 1, steps.length - 2)][0];   // up to "happening now"
            status(w, next, 'the story moved it');
            if (b) set(w, 'latest', b);
            continue;
        }
        if (k === 'settled') { const w = findEntry(list, 'thread', a); if (w) { status(w, DONE.thread, 'the story settled it'); if (b) set(w, 'latest', b); } continue; }
        if (k === 'secret') { if (!findEntry(list, 'secret', a) && c) create('secret', a, { holder: b, secret: c }); continue; }
        if (k === 'out') {
            const w = findEntry(list, 'secret', a);
            if (!w) continue;
            status(w, 'out', 'it came out in the story');
            if (b && !similar(w.fields.known, b)) set(w, 'known', [clean(w.fields.known), b].filter(Boolean).join(', '));
            continue;
        }
        if (k === 'planted') { if (!findEntry(list, 'seed', a)) create('seed', a, { detail: b }); continue; }
        if (k === 'paid') { const w = findEntry(list, 'seed', a); if (w) status(w, DONE.seed, 'it paid off in the story'); continue; }
        if (k === 'elsewhere') {
            const w = findEntry(list, 'activity', a);
            if (w) { if (w.status !== DONE.activity) set(w, 'step', c || b); continue; }
            if (list.filter(x => x.kind === 'activity' && x.on && x.status !== DONE.activity).length < MAX_ACTIVITIES) create('activity', a, { who: b, what: c });
        }
    }
    for (const w of dirty) writeWorldEntry(data, w, id);
    return changes;
}

/** Open threads build by themselves: one step up after `build` replies with no movement. */
export function tick(data, id, meta, opts = settings().world) {
    const build = Math.max(0, Math.round(Number(opts.build) || 0));
    const changes = [];
    if (!build) return changes;
    const ready = stepIndex('thread', 'ready');
    for (const w of listWorld(data, id)) {
        if (w.kind !== 'thread' || !w.on || w.locked || stepIndex('thread', w.status) >= ready) continue;
        if (!w.at || w.at.chat !== meta.chat) { const beforeAt = w.at ? { ...w.at } : null; w.at = { chat: meta.chat, n: meta.n }; writeWorldEntry(data, w, id); changes.push({ uid: w.uid, type: 'clock', beforeAt, afterAt: { ...w.at } }); continue; }
        if (meta.n - w.at.n < build) continue;
        const to = WORLD_KINDS.thread.steps[stepIndex('thread', w.status) + 1][0];
        changes.push({ uid: w.uid, name: w.name, kind: 'thread', type: 'status', before: w.status, after: to, beforeAt: w.at ? { ...w.at } : null, afterAt: { chat: meta.chat, n: meta.n }, why: `${build} replies went by with no movement` });
        w.status = to; w.at = { chat: meta.chat, n: meta.n };
        writeWorldEntry(data, w, id);
    }
    return changes;
}

/** Ignore UID and storage location so a created entry can be checked after branching. */
export function creationFingerprint(w) {
    return JSON.stringify([w.name, w.kind, w.fields, w.aliases, w.status, w.show, w.on]);
}

/** Undo a list of changes, newest first. A line that was changed again since is left as it is. */
export function revertChanges(data, id, changes) {
    let done = 0;
    for (const c of [...changes].reverse()) {
        if (c.type === 'hide') { if (showAgain(c.dates)) done++; continue; }
        const entry = data.entries?.[c.uid];
        if (!entry) continue;
        const w = listWorld(data, id).find(x => x.uid === c.uid);
        if (!w) continue;
        if (c.type === 'create') { if (w.auto && (!c.createdState || c.createdState === creationFingerprint(w))) { delete data.entries[c.uid]; done++; } continue; }
        if (c.type === 'set' && (c.field === 'data' ? w.fields.data : clean(w.fields[c.field])) === c.after) { w.fields[c.field] = c.before; writeWorldEntry(data, w, id); done++; }
        if (c.type === 'status' && w.status === c.after && (!Object.hasOwn(c, 'afterAt') || JSON.stringify(w.at) === JSON.stringify(c.afterAt))) { w.status = c.before; if (Object.hasOwn(c, 'beforeAt')) w.at = c.beforeAt; writeWorldEntry(data, w, id); done++; }
        if (c.type === 'clock' && Object.hasOwn(c, 'afterAt') && JSON.stringify(w.at) === JSON.stringify(c.afterAt)) { w.at = c.beforeAt || null; writeWorldEntry(data, w, id); done++; }
        if (c.type === 'off' && !w.on) { w.on = true; writeWorldEntry(data, w, id); done++; }
    }
    return done;
}

const stepName = (kind, s) => WORLD_KINDS[kind]?.steps?.find(x => x[0] === s)?.[1] || s;
/** One change in plain words. */
export function describeChange(c) {
    const def = WORLD_KINDS[c.kind];
    if (!def) return '';
    if (c.type === 'create') return `Added ${def.label.toLowerCase()}: ${c.name}`;
    if (c.type === 'hide') return `${c.dates.length} older ${c.dates.length === 1 ? 'message was' : 'messages were'} hidden from the AI, because the chapter "${c.name}" covers them`;
    if (c.type === 'off') return `${c.name}: it is finished, so it was written into the chapter "${c.into}" and turned off`;
    if (c.type === 'status') return `${c.name}: went from "${stepName(c.kind, c.before)}" to "${stepName(c.kind, c.after)}"${c.why ? ` (${c.why})` : ''}`;
    if (c.type === 'set') return `${c.name}: "${def.fields.find(f => f.key === c.field)?.label || c.field}" is now "${c.after.length > 160 ? `${c.after.slice(0, 160)}...` : c.after}"`;
    return '';
}
export const shownChanges = changes => (changes || []).filter(c => c.type !== 'clock');

// ---------- ordering something into the scene ----------

/**
 * A character entry that was read as present in each of the last N replies and is named in the story text of none
 * of them. N is the "silent" setting; 0 turns this off. Returns null, or { w, replies }.
 */
export function silentCharacter(list, present, type = 'normal') {
    const need = Math.max(0, Math.round(Number(settings().pace.silent) || 0));
    if (!need) return null;
    const chat = ctx().chat || [];
    let end = chat.length;
    if (type === 'swipe' || type === 'continue') end -= 1;
    const back = [];
    for (let i = end - 1; i >= 1 && back.length < need; i--) { const m = chat[i]; if (isReply(m)) back.push(m); }
    if (back.length < need) return null;
    const user = norm(names().user);
    const here = present.map(norm);
    for (const w of list.filter(x => x.on && x.kind === 'character' && here.includes(norm(x.name)) && norm(x.name) !== user)) {
        const silent = back.every((m) => {
            const was = (m.extra?.[KEY]?.items || []).find(it => it.notes)?.notes?.present || [];
            return was.map(norm).includes(norm(w.name)) && !namedIn(String(m.mes || '').replace(HUD_BLOCKS, ' '), w);
        });
        if (silent) return { w, replies: need };
    }
    return null;
}

/**
 * Now and then one thing that is ready is ordered into the scene. list: the world's entries. present: names read
 * as present. Returns null, or { text, name, effect: { uid, kind, to } }.
 */
export function rollOrder(list, present, meta, opts = settings().world, more = {}) {
    // A character of the world who is in the scene and has gone unnamed in the story text gets an order first.
    const quietOne = silentCharacter(list, present, more.type);
    if (quietOne) {
        const w = quietOne.w;
        const wants = clean(w.fields.wants).replace(/[.]+$/, '');
        return { text: promptText('silentCharacter', { name: w.name, wants: wants ? ` and what ${w.name} wants (${wants})` : '' }), name: `Character: ${w.name}`,
            effect: { uid: w.uid, kind: 'character', name: w.name, to: '', silent: quietOne.replies, label: `In the scene and unnamed for ${quietOne.replies} replies: ${w.name}` } };
    }
    const chance = Math.max(0, Math.min(100, Math.round((Number(opts.head) || 0) * (Number(more.scale ?? 100) / 100))));
    if (!chance || rollInt(100) >= chance) return null;
    const bring = opts.bring || {};
    const minAge = Math.max(0, Math.round(Number(opts.minAge) || 0));
    const age = w => (!w.at || w.at.chat !== meta.chat ? Infinity : meta.n - w.at.n);
    const v = (w, k) => clean(w.fields[k]).replace(/[.]+$/, '');
    const here = present.map(norm);
    const options = [];
    for (const w of list.filter(x => x.on && !x.locked)) {
        if (w.kind === 'thread' && bring.thread && w.status === 'ready') {
            options.push({ weight: 3, w, to: 'happening', text: promptText('threadOrder', { name: w.name, open: v(w, 'open') ? `: ${v(w, 'open')}` : '', trigger: v(w, 'sets_off') ? ` What brings it on: ${v(w, 'sets_off')}.` : '' }) });
        } else if (w.kind === 'seed' && bring.seed && w.status !== DONE.seed && age(w) >= minAge) {
            options.push({ weight: 2, w, to: DONE.seed, text: promptText('seedOrder', { detail: v(w, 'detail') || w.name, payoff: v(w, 'payoff') ? ` What it leads to: ${v(w, 'payoff')}.` : '' }) });
        } else if (w.kind === 'activity' && bring.activity && w.status !== DONE.activity && age(w) >= minAge) {
            const who = v(w, 'who') || 'someone';
            options.push({ weight: 2, w, to: DONE.activity, text: promptText('activityOrder', { who, activity: v(w, 'what') ? ` (${v(w, 'what')}${v(w, 'step') ? `; so far: ${v(w, 'step')}` : ''})` : '' }) });
        } else if (w.kind === 'secret' && bring.secret && w.status === 'kept' && v(w, 'secret') && here.some(n => n && norm(w.fields.holder).includes(n))) {
            options.push({ weight: 1, w, to: 'out', text: promptText('secretOrder', { secret: v(w, 'secret'), holder: v(w, 'holder') ? ` (it is ${v(w, 'holder')}'s secret)` : '' }) });
        }
    }
    if (!options.length) return null;
    const pick = pickWeighted(options, o => o.weight, 1)[0];
    return { text: pick.text, name: `${WORLD_KINDS[pick.w.kind].label}: ${pick.w.name}`, effect: { uid: pick.w.uid, kind: pick.w.kind, name: pick.w.name, to: pick.to, label: `${WORLD_KINDS[pick.w.kind].label}: ${pick.w.name}` } };
}

// ---------- what goes out with a reply ----------

/**
 * Everything the story world adds to the reply that is about to be written.
 * Returns null when this chat has no world, else { notes, ask, order, id }.
 */
export async function prepareWorld(type, replyNo, { quiet = false, scale = 100, native = false, opportunities = false, memory = false, components = memoryComponents() } = {}) {
    const id = chatWorld();
    if (quiet) return null;
    if (!id) {
        // A chat that was started with "New chapter" and has no story world carries its summary in the chat itself.
        const carried = clean(chatState()?.carried);
        if (!carried || !components.chapters) return null;
        const text = memory ? `[Story memory\n${carried}]` : `[The story before this chat. These are facts already true in this story. Write the reply so that they stay true.\n${carried}]`;
        rememberStory(carried);
        return { id: '', notes: { text, tokens: Math.round(text.length / 4), ids: [], extra: [], present: [], missing: [], place: '', location: '', how: '' }, ask: '', order: null };
    }
    const data = await loadWorld(id).catch(() => null);
    if (!data) return null;
    const o = settings().world;
    const list = listWorld(data, id);
    const { rows, notes } = storyRecall(list,type,{memory,components});
    if (memory) return {id,notes,rows,ask:'',order:null};
    const policy = recallPolicy(id,type);
    const eligible = list.filter(row=>policy(row).on);
    const ooc = isOocTurn();
    const ask = !native && o.update !== 'off' && !ooc ? buildAsk(list, type) : '';
    const meta = { chat: String(ctx().getCurrentChatId() || ''), n: replyNo };
    const order = ooc || (native && !opportunities) ? null : rollOrder(eligible, notes?.present || [], meta, native ? {...o, head:100, bring:{...o.bring,secret:false}} : o, { type, scale:native ? 100 : scale });
    if (order) order.text = promptText('worldOrder', { order: order.text });
    // What a story event item may ask for: an open thread, a kept secret or a plan of someone in the scene.
    return { id, notes, ask, order, offers: worldOffers(eligible, notes?.present || [], meta) };
}

// ---------- after the reply ----------

let queue = Promise.resolve();
/** World changes run one after another, so two of them never write the lorebook at the same time. */
export function enqueue(fn, { propagate = false } = {}) {
    const result = queue.then(fn);
    queue = result.catch(e => console.warn(LOG, 'story world', e));
    return propagate ? result : queue;
}
export const worldIdle = () => queue;

function worldLog(cs) {
    const chat = String(ctx().getCurrentChatId() || '');
    if (!cs.worldLog || cs.worldLog.chat !== chat) cs.worldLog = { chat, items: {}, fresh: true };
    return cs.worldLog;
}

/** Take the block out of a reply, on the message and on its swipe. Returns what parseUpdate found. */
export function liftBlock(id, paired = false, modules = null) {
    const c = ctx();
    const m = c.chat?.[id];
    const none = { found: false, ops: [], ended: false, block: '', scene: null, profiles: [], roast: '' };
    if (!m || typeof m.mes !== 'string') return none;
    const output = paired ? separateReply(m.mes) : {text:m.mes,plan:''};
    const hasBlock = /<story_update\b/i.test(output.text);
    // A profile or roast written outside the block (some models put it after the block) is taken too.
    const hasCards = (modules || cardsOn()) && /<(profile|roast)\b/i.test(output.text);
    if (!hasBlock && !hasCards && output.text === m.mes) return none;
    const parsed = hasBlock ? parseUpdate(output.text) : { ...none, clean:output.text };
    if (modules?.state) parsed.legacyScene = sceneFromReplyHeader(m.mes);
    if (output.plan) parsed.plan = output.plan;
    if (hasCards) {
        const stray = parseCards(parsed.clean);
        if (stray.rest !== parsed.clean) {
            parsed.clean = stray.rest.replace(/\n{3,}/g, '\n\n').trimEnd();
            for (const p of stray.profiles) {
                const same = parsed.profiles.find(x => norm(x.name) === norm(p.name));
                if (same) continue;
                parsed.profiles.push(p);
                if (Object.keys(p.stable).length) parsed.ops.push({ k: 'profile', a: p.name, b: '', c: '', f: { ...p.stable } });
                if (p.now.wants) parsed.ops.push({ k: 'wants', a: p.name, b: p.now.wants, c: '' });
            }
            if (!parsed.roast) parsed.roast = stray.roast;
            parsed.found = parsed.found || hasBlock;
        }
    }
    m.mes = parsed.clean;
    if (Array.isArray(m.swipes) && typeof m.swipe_id === 'number' && m.swipes[m.swipe_id] !== undefined) m.swipes[m.swipe_id] = m.mes;
    try { c.updateMessageBlock?.(id, m); } catch { /* drawn without the block on the next redraw */ }
    return parsed;
}

/** Apply validated, evidence-backed records to a working copy of the story book. */
export function applyStructuredUpdates(data, wid, meta, id, rec, parsed, turn, { historical = false } = {}) {
    const changes = [];
    const previous = listWorld(data,wid);
    const records = recordMap(previous);
    const offer = turn.legacyOffer;
    const quote = clean(parsed.legacyOutcome);
    const established = offer && previous.find(row=>row.uid===offer.uid && row.kind===offer.kind && row.on && !row.locked);
    if (established && quote.length >= 4 && clean(parsed.clean).toLowerCase().includes(quote.toLowerCase())) {
        const before = established.status, beforeAt = established.at;
        if (before !== offer.to && before !== DONE[offer.kind]) {
            established.status = offer.to;
            established.at = { chat:meta.chat, n:meta.n };
            writeWorldEntry(data,established,wid);
            changes.push({uid:established.uid,name:established.name,kind:established.kind,type:'status',
                before,after:established.status,beforeAt,afterAt:established.at,legacyV10:true});
        }
    }
    const repair = parsed.repair && parsed.repair === turn.repair?.id;
    const updates = [
        ...(parsed.changes || []).map(input=>({input,evidence:parsed.clean,source:rec.time})),
        ...(repair ? parsed.repairChanges || [] : []).map(input=>({input,evidence:turn.repair.text,source:parsed.repair})),
    ];
    if (parsed.repairChanges?.length && !repair) rec.v10Invalid = true;
    const updated = new Set();
    for (const {input,evidence,source} of updates) {
        const existing = previous.find(row => readRecord(row)?.id === input?.id);
        if (existing?.locked || existing?.on === false || updated.has(input?.id)) continue;
        const old = records.get(input?.id);
        if (historical && (old?.protected || old?.source === 'user' || old?.atIndex > id)) continue;
        if (source !== rec.time && (old?.source === 'user' || Number(old?.source) > source)) continue;
        const record = normalizeRecord(input,{ modules:turn.modules, rows:records, snapshot:turn.records, evidence, clock:rec.v10Minutes, scene:rec.scene, sceneId:rec.v10SceneId,
            baseline:baselineFor(turn.baselines,input?.subject ?? old?.subject,input?.aliases ?? old?.aliases), base:turn.base });
        if (!record) { rec.v10Invalid = true; continue; }
        record.atIndex = id;
        record.source = source;
        const kind = record.kind === 'seed' ? 'payoff' : record.kind;
        updated.add(record.id);
        const w = existing || newWorldEntry(data,kind);
        const before = w.fields.data || '';
        w.name = w.name && existing ? w.name : record.id;
        w.fields.data = JSON.stringify(record);
        if (!existing) { w.auto = true; w.at = { chat:meta.chat, n:meta.n }; }
        writeWorldEntry(data,w,wid);
        records.set(record.id,record);
        (rec.v10Changes ||= []).push(record);
        if (record.realized && PLOT_KINDS.includes(record.kind) && !old?.realized && old?.status!=='done') {
            const audit = rec.v10Plot?.find(row=>row.id===record.id);
            if (audit) audit.realized = true;
            else (rec.v10Plot ||= []).push({id:record.id,eligible:true,recalled:false,realized:true});
        }
        changes.push(existing ? { uid:w.uid, name:w.name, kind, type:'set', field:'data', before, after:w.fields.data } :
            {uid:w.uid, name:w.name, kind, type:'create', createdState:creationFingerprint(w), entry:structuredClone(w)});
    }
    return changes;
}

/** File what a reply established. parsed: from liftBlock. rec: the record on that reply. effects: world orders that count as done. */
export function afterReply(id, rec, parsed, replyNo, onDone, options = {}) {
    return enqueue(async () => {
        const cs = chatState();
        const wid = chatWorld();
        if (!cs || !wid || !rec) return;
        await syncNow();
        if (options.v10 && ctx().chat?.[id]?.extra?.[KEY] !== rec) return;
        const o = settings().world;
        const data = await loadWorld(wid);
        if (!data) { if (options.propagate) throw new Error('The story world could not be read.'); return; }
        if (options.v10 && (chatState() !== cs || ctx().chat?.[id]?.extra?.[KEY] !== rec)) return;
        const meta = { chat: String(ctx().getCurrentChatId() || ''), n: replyNo };
        const ooc = options.rebuild ? false : isOocTurn();
        const changes = [];
        if (options.v10 && !ooc && parsed.modern && !parsed.invalid) {
            changes.push(...applyStructuredUpdates(data, wid, meta, id, rec, parsed, options.v10));
        }
        if ((parsed.found || parsed.ops?.length) && o.update !== 'off' && !ooc) changes.push(...applyOps(data, wid, parsed.ops, meta, o.update));
        // The cards under the reply show who each person is as the story world has it.
        if (rec.profiles?.length) {
            const list = listWorld(data, wid);
            for (const p of rec.profiles) {
                const w = findEntry(list, 'character', p.name);
                if (w) for (const [k] of PROFILE_STABLE) if (clean(w.fields[k])) p.stable[k] = clean(w.fields[k]);
            }
        }
        if (!ooc && !options.rebuild && !options.v10) changes.push(...tick(data, wid, meta));
        if (options.v10 && !ooc) rec.v10Profiles = [...recordMap(listWorld(data,wid)).values()].filter(row=>row.kind==='profile' && String(rec.scene?.present || '').toLowerCase().split(/[,;\n]/).some(name=>[row.subject,...(row.aliases || [])].some(alias=>alias.toLowerCase() === name.trim()))).slice(0,8).map(row=>{
            const profile = effectivePortrayal(row,baselineFor(options.v10.baselines,row.subject,row.aliases));
            return profile.facetScene===rec.v10SceneId ? profile : {...profile,facet:''};
        });
        if (changes.length) await saveWorld(wid, data);
        // A reply that was continued keeps what its first part filed.
        const before = rec.update && rec.update.world === wid && !rec.update.undone ? rec.update : null;
        rec.update = { world: wid, ops: [...(before?.ops || []), ...parsed.ops], ended: !!parsed.ended, changes: [...(before?.changes || []), ...changes] };
        worldLog(cs).items[String(rec.time)] = { world: wid, changes: rec.update.changes };
        if (chatState() !== cs) return;
        saveChatState();
        try { ctx().saveChat?.(); } catch { /* saved with the next change */ }
        const shown = shownChanges(changes);
        if (options.v10 && parsed.modern) {
            addLog({what:'Story state update',ok:rec.v10Invalid ? null : true,
                result:rec.v10Invalid ? 'Some update fields failed validation. Affected records kept their last valid value.' : `${shown.length} world changes recorded.`,
                details:shown.map(describeChange),got:''});
        } else if (parsed.found || shown.length) {
            addLog({ what: 'Story world update', ok: true, result: parsed.found
                ? `The reply's update block had ${parsed.ops.length} ${parsed.ops.length === 1 ? 'line' : 'lines'}. ${shown.length} ${shown.length === 1 ? 'change was' : 'changes were'} made to the world.${ooc ? ' Nothing was filed, because your message was out of character.' : ''}`
                : `${shown.length} ${shown.length === 1 ? 'change was' : 'changes were'} made by the clock. The reply had no update block.`,
                details: shown.map(describeChange), got: parsed.block });
        } else if (o.update !== 'off' && !ooc) {
            addLog({ what: 'Story world update', ok: null, result: 'The reply had no update block, so nothing was filed from it. This is normal now and then. If it happens every time, the model is leaving the block out.', details: [], got: '' });
        }
        onDone?.();
    }, options);
}

/** Record extension-editor changes so a later branch can undo future manual edits
 * on its copy without changing the parent world. */
export function recordManualWorldChange(world, uid, before, after, anchor = correctionAnchor(), {persist = true} = {}) {
    const cs = chatState();
    if (!cs) return;
    cs.manualWorldChanges ||= [];
    cs.manualWorldChanges.push({ world, uid, before: before ? JSON.parse(JSON.stringify(before)) : null, after: after ? JSON.parse(JSON.stringify(after)) : null, anchor, time: Date.now() });
    if (persist) saveChatState();
}

/** A world order happened (or was sent with checking off): make its effect, and store it with the reply. */
export function applyEffect(rec, effect, onDone) {
    return enqueue(async () => {
        const cs = chatState();
        const wid = chatWorld();
        if (!cs || !wid || !rec || !effect || !effect.to) return;   // an order with nothing to move on (a silent character) leaves the world as it is
        const data = await loadWorld(wid);
        const w = data ? listWorld(data, wid).find(x => x.uid === effect.uid && x.kind === effect.kind) : null;
        if (!w || w.status === effect.to) return;
        const change = { uid: w.uid, name: w.name, kind: w.kind, type: 'status', before: w.status, after: effect.to, why: 'it was ordered into the scene and it happened' };
        w.status = effect.to;
        writeWorldEntry(data, w, wid);
        await saveWorld(wid, data);
        if (!rec.update) rec.update = { world: wid, ops: [], ended: false, changes: [] };
        rec.update.changes.push(change);
        const log = worldLog(cs);
        const item = log.items[String(rec.time)] || (log.items[String(rec.time)] = { world: wid, changes: [] });
        if (item.changes !== rec.update.changes) item.changes.push(change);
        saveChatState();
        try { ctx().saveChat?.(); } catch { /* saved with the next change */ }
        addLog({ what: 'Story world update', ok: true, result: 'Something that was ordered into the scene happened.', details: [describeChange(change)], got: '' });
        onDone?.();
    });
}

/** Store one more change with the reply whose record has this time, so it is undone with that reply. Call inside enqueue. */
export function attachChange(time, wid, change) {
    return attachChanges(time,wid,[change]);
}

export function attachChanges(time, wid, changes, { persist = true } = {}) {
    const cs = chatState();
    if (!cs) return false;
    const rec = (ctx().chat || []).map(m => m?.extra?.[KEY]).find(r => r && String(r.time) === String(time));
    if (!rec) return false;
    if (!rec.update) rec.update = { world: wid, ops: [], ended: false, changes: [] };
    rec.update.changes.push(...changes);
    const log = worldLog(cs);
    const item = log.items[String(time)] || (log.items[String(time)] = { world: wid, changes: rec.update.changes });
    if (item.changes !== rec.update.changes) item.changes.push(...changes);
    if (persist) {
        saveChatState();
        try { ctx().saveChat?.(); } catch { /* saved with the next change */ }
    }
    return true;
}

async function revertItem(item) {
    if (!item?.changes?.length || !item.world) return 0;
    const data = await loadWorld(item.world).catch(() => null);
    if (!data) return 0;
    const n = revertChanges(data, item.world, item.changes);
    if (n) await saveWorld(item.world, data);
    return n;
}

/** An edited reply invalidates generated state and automatic world changes from
 * that point onward. Manual/protected corrections are retained. */
function staleHistoryStart(chat = ctx().chat || []) {
    for (let end = 0; end < chat.length; end++) {
        const rec = chat[end]?.extra?.[KEY];
        if (rec?.historySource?.length && !rec.update?.undone && !historySourceMatches(chat,end,rec.historySource)) {
            return Math.max(0,end + 1 - rec.historySource.length);
        }
    }
    return Infinity;
}

export function invalidateAfterEdit(id, onDone) {
    return enqueue(async () => {
        const host = ctx(), chat = host.chat || [], wid = chatWorld(), current = chatState();
        let start = Math.min(id,staleHistoryStart(chat));
        const boundaries = chat.flatMap((message,index)=>index>0 && isReply(message) ? [index] : []);
        const edited = Math.max(1,boundaries.filter(index=>index<=start).length);
        const data = wid && await loadWorld(wid).catch(()=>null);
        if (ctx().chat!==chat || chatState()!==current || chatWorld()!==wid) return;
        for (const row of data ? listWorld(data,wid) : []) {
            if (row.kind!=='chapter' || !row.on || !row.span || !chapterIsMine(row,host.getCurrentChatId?.()) ||
                edited<row.span.from || edited>row.span.to) continue;
            start = Math.min(start,boundaries[row.span.from-1] ?? start);
        }
        await invalidateFrom(start,onDone);
    });
}

async function invalidateFrom(id, onDone) {
    const c = ctx(), chatId = String(c.getCurrentChatId?.() || '');
    const cs = chatState(), chat = c.chat || [];
    if (!cs || cs.worldDetached || id < 0 || id >= chat.length) return;
    const affected = chat.slice(id).filter(m => !m?.is_user && m?.extra?.[KEY]);
    const waitingForBranch = !!cs.branchPendingWorld;
    let undone = 0;
    for (const m of [...affected].reverse()) {
        const rec = m.extra[KEY];
        if (rec.update && !rec.update.undone) {
            if (!waitingForBranch) undone += await revertItem({ world: rec.update.world, changes: rec.update.changes });
            rec.update.undone = true;
            const log = worldLog(cs);
            if (!waitingForBranch && rec.time && log.items[String(rec.time)]) log.items[String(rec.time)].changes = [];
        }
        rec.stateStale = true;
        rec.stateOutdated = true;
        const info = m.swipe_info?.[m.swipe_id];
        if (info) { info.extra ||= {}; info.extra[KEY] = JSON.parse(JSON.stringify(rec)); }
    }
    if (String(ctx().getCurrentChatId?.() || '') !== chatId) return;
    const firstReply = Math.max(1, chat.slice(1, id + 1).filter(isReply).length);
    cs.historyInvalidFrom = Math.min(Number(cs.historyInvalidFrom) || firstReply, firstReply);
    cs.historyNeedsReview = true;
    saveChatState();
    try { await c.saveChat?.(); } catch { /* saved on the next change */ }
    addLog({ what: 'Edited story', ok: null, result: `An earlier reply changed. ${affected.length} replies have stale state; ${undone} automatic world changes were undone. Review current state, world entries and any manually edited chapter summaries.`, details: [], got: '' });
    onDone?.(firstReply);
}

/** Bring the world in line with the replies that are in the chat now. */
async function syncNow() {
    const cs = chatState();
    if (!cs || !settings().enabled || cs.branchPendingWorld || cs.worldDetached) return;
    const log = worldLog(cs);
    const current = new Map();
    for (const m of ctx().chat || []) { const rec = m?.extra?.[KEY]; if (rec?.update && rec.time) current.set(String(rec.time), rec); }
    if (log.fresh) {
        // A chat seen for the first time (or a branch): what its replies changed is taken as already done.
        for (const [t, rec] of current) log.items[t] = { world: rec.update.world, changes: rec.update.undone ? [] : rec.update.changes };
        delete log.fresh;
        saveChatState();
        return;
    }
    let undone = 0, redone = 0;
    // Replies that are gone (deleted, or swiped away): undo what they changed.
    let laterReplyStillPresent = false;
    for (const t of Object.keys(log.items).reverse()) {
        if (current.has(t)) {
            if (!current.get(t).update.undone) laterReplyStillPresent = true;
            continue;
        }
        // The host can emit deletion events while a bulk delete is still in
        // progress. Do not discard an older rollback while a newer reply still
        // exists: its changes may currently cover the older values.
        if (laterReplyStillPresent) continue;
        undone += await revertItem(log.items[t]);
        delete log.items[t];
    }
    // A reply that is back (swiped back to): file its block again.
    for (const [t, rec] of current) {
        if (log.items[t] || rec.update.undone) continue;
        const wid = chatWorld();
        const data = wid && rec.update.world === wid ? await loadWorld(wid).catch(() => null) : null;
        let changes = [];
        if (data && rec.update.ops?.length && settings().world.update !== 'off') {
            changes = applyOps(data, wid, rec.update.ops, { chat: log.chat, n: 0 }, settings().world.update);
        }
        if (data && rec.v10) {
            for (const change of rec.update.changes || []) {
                const rows = listWorld(data,wid);
                const row = rows.find(item=>item.kind===change.kind && item.name===change.name);
                if (change.type === 'set' && change.field === 'data' && row?.on && !row.locked && row.fields.data === change.before) {
                    row.fields.data = change.after;
                    writeWorldEntry(data,row,wid);
                    changes.push({...change,uid:row.uid});
                } else if (change.legacyV10 && change.type === 'status' && row?.on && !row.locked && row.status === change.before && JSON.stringify(row.at) === JSON.stringify(change.beforeAt)) {
                    row.status = change.after;
                    row.at = change.afterAt;
                    writeWorldEntry(data,row,wid);
                    changes.push({...change,uid:row.uid});
                } else if (change.type === 'create' && change.entry && !row) {
                    const recreated = {...structuredClone(change.entry),uid:newWorldEntry(data,change.kind).uid};
                    writeWorldEntry(data,recreated,wid);
                    changes.push({...change,uid:recreated.uid});
                }
            }
        }
        if (changes.length) { await saveWorld(wid, data); redone += shownChanges(changes).length; }
        rec.update.changes = changes;
        log.items[t] = { world: rec.update.world, changes };
    }
    if (undone || redone) {
        saveChatState();
        try { ctx().saveChat?.(); } catch { /* saved with the next change */ }
        addLog({ what: 'Story world update', ok: true, result: `${undone ? `${undone} ${undone === 1 ? 'change was' : 'changes were'} undone because the reply that made ${undone === 1 ? 'it' : 'them'} is no longer in the chat. ` : ''}${redone ? `${redone} ${redone === 1 ? 'change was' : 'changes were'} made again because that reply is back.` : ''}`.trim(), details: [], got: '' });
    }
}
export const syncWorld = (onDone) => enqueue(async () => {
    const chatId = String(ctx().getCurrentChatId?.() || '');
    try { await ownWorld(); }
    catch (e) {
        if (String(ctx().getCurrentChatId?.() || '') !== chatId) return;
        const cs = chatState();
        if (cs) { cs.branchPendingWorld = cs.branchPendingWorld || cs.world || ''; cs.world = ''; saveChatState(); }
        console.warn(LOG, 'branch world', e);
        toast('error', 'The branch story world could not be created. The parent world has been disconnected to protect it; reopen the branch to retry.');
        addLog({ what: 'Branch world', ok: false, result: `Could not create the branch world: ${e.message}. The parent world is disconnected until retry.`, details: [], got: '' });
        onDone?.(); return;
    }
    await invalidateFrom(staleHistoryStart());
    await syncNow(); onDone?.();
});

// ---------- a branch gets its own copy of the story world ----------

/** What makes this chat this chat: SillyTavern gives every new chat and every branch its own integrity mark. */
const chatMark = () => String(ctx().chatMetadata?.integrity || ctx().getCurrentChatId?.() || '');

/** Mark the open chat as the owner of the world it uses now (a new chat, a chat that picked a world, a new chapter). */
export function claimWorld() {
    const cs = chatState();
    if (!cs) return;
    cs.worldOwner = chatMark();
    saveChatState();
}

/** Every record of a message, on the message and on each of its swipes. */
function allRecords() {
    const out = [];
    for (const m of ctx().chat || []) {
        if (m?.extra?.[KEY]) out.push(m.extra[KEY]);
        for (const s of m?.swipe_info || []) if (s?.extra?.[KEY] && s.extra[KEY] !== m.extra?.[KEY]) out.push(s.extra[KEY]);
    }
    return out;
}

/**
 * A branch starts with the records and the world of the chat it came from. The first time it is opened, it gets a
 * copy of that world, and its records are pointed at the copy, so what happens in the branch stays in the branch.
 */
async function ownWorld() {
    const cs = chatState();
    if (!cs) return;
    const mark = chatMark();
    if (!mark) return;
    const isBranch = !!ctx().chatMetadata?.main_chat && (!cs.worldOwner || cs.worldOwner !== mark);
    if (!isBranch) { if (cs.worldOwner !== mark) { cs.worldOwner = mark; saveChatState(); } return; }
    const removedOverrides = trimBranchOverrides(cs);
    if (cs.worldDetached) { cs.worldOwner = mark; saveChatState(); return; }
    if (!(ctx().chat || []).some(m => m?.extra?.[KEY]?.stateStale)) { cs.historyNeedsReview = false; delete cs.historyInvalidFrom; }
    const from = cs.branchPendingWorld || cs.world;
    // A branch gets its own world by default, even when its parent had none.
    // Sharing an existing world remains an explicit user setting.
    if (from && !enabledV10() && settings().world.copyOnBranch === false) { cs.world = from; delete cs.branchPendingWorld; cs.worldOwner = mark; saveChatState(); return; }
    const info = from ? setInfo(from) : { name: 'Story world', shared: false };
    const source = from ? await loadWorld(from).catch(() => null) : { entries: {} };
    if (!source) throw new Error('The parent story world could not be read; the branch was not linked to a copy.');
    const data = JSON.parse(JSON.stringify(source));
    // The parent's metadata has its world-change ledger. Undo the abandoned
    // future on the copy before renumbering its entries, newest reply first.
    const retained = new Set((ctx().chat || []).map(m => String(m?.extra?.[KEY]?.time || '')).filter(Boolean));
    const invalidated = new Set((ctx().chat || []).filter(m => m?.extra?.[KEY]?.stateStale && m.extra[KEY].update?.undone).map(m => String(m.extra[KEY].time || '')).filter(Boolean));
    const items = cs.worldLog?.items || {};
    const anchors = new Set(['seed']);
    for (const m of ctx().chat || []) {
        if (m?.extra?.[KEY]?.time) anchors.add(`record:${m.extra[KEY].time}`);
        if (m?.send_date) anchors.add(`message:${m.send_date}`);
    }
    const manual = Array.isArray(cs.manualWorldChanges) ? cs.manualWorldChanges : [];
    const future = [
        ...Object.entries(items).filter(([time, item]) => (!retained.has(String(time)) || invalidated.has(String(time))) && item?.world === from).map(([time, item]) => ({ time: Number(time), item })),
        ...manual.filter(item => item.world === from && item.anchor && !anchors.has(item.anchor)).map(item => ({ time: Number(item.time), manual: item })),
    ].sort((a, b) => b.time - a.time);
    const retainedHides = new Set(Object.entries(items).filter(([time])=>retained.has(time) && !invalidated.has(time))
        .flatMap(([,item])=>(item.changes || []).filter(change=>change.type==='hide').flatMap(change=>change.dates || [])));
    const discardedHides = future.flatMap(change=>(change.item?.changes || [])
        .filter(item=>item.type==='hide').flatMap(item=>item.dates || [])).filter(mark=>!retainedHides.has(mark));
    for (const change of future) {
        if (change.item) revertChanges(data, from, (change.item.changes || []).filter(c => c.type !== 'hide'));
        else {
            const item = change.manual, current = data.entries?.[item.uid] || null;
            // Do not overwrite an entry changed independently since the recorded edit.
            if (JSON.stringify(current) !== JSON.stringify(item.after)) continue;
            if (item.before) data.entries[item.uid] = item.before; else delete data.entries[item.uid];
        }
    }
    cs.manualWorldChanges = manual.filter(item => item.world !== from || !item.anchor || anchors.has(item.anchor));
    const copy = { entries: {} };
    let i = 0;
    for (const e of entriesOf(data, from)) {
        const c = JSON.parse(JSON.stringify(e));
        c.uid = i; c.displayIndex = i;
        c.extensions = { ...(c.extensions || {}), ri: { ...(c.extensions?.ri || {}), copyOf: e.uid } };
        delete c.extensions.ri.set; // the branch is a standalone lorebook
        copy.entries[i++] = c;
    }
    const taken = new Set([...knownSets('world').map(id => setInfo(id).name), ...(ctx().getWorldInfoNames?.() || [])]);
    let name = `${info.name} (branch)`;
    for (let n = 2; taken.has(name); n++) name = `${info.name} (branch ${n})`;
    const to = await createSet(name, 'world', copy, '');
    const made = await loadWorld(to);
    const uids = {};
    for (const e of entriesOf(made, to)) {
        const was = e.extensions?.ri?.copyOf;
        if (was !== undefined) { uids[String(was)] = e.uid; delete e.extensions.ri.copyOf; }
    }
    await saveWorld(to, made);
    if (chatState()!==cs || chatMark()!==mark) return;
    showAgain(discardedHides,{persist:false});
    // The records of this branch now point at the copy.
    let moved = 0;
    for (const rec of allRecords()) {
        if (rec.recall?.book===from) {
            rec.recall.book=to;
            rec.recall.fresh=(rec.recall.fresh || []).filter(id=>uids[id]!==undefined).map(id=>String(uids[id]));
        }
        if (rec.update?.world !== from) continue;
        rec.update.world = to;
        for (const c of rec.update.changes || []) if (c && uids[String(c.uid)] !== undefined) c.uid = uids[String(c.uid)];
        moved++;
    }
    for (const rec of allRecords()) for (const it of rec.items || []) if (it.worldOrder && uids[String(it.worldOrder.uid)] !== undefined) it.worldOrder.uid = uids[String(it.worldOrder.uid)];
    const targetInfo = setInfo(to);
    const remapEntry = (entry, uid) => {
        if (!entry) return null;
        const mapped = JSON.parse(JSON.stringify(entry)); mapped.uid = uid; mapped.displayIndex = uid;
        if (mapped.extensions?.ri) { if (targetInfo.shared) mapped.extensions.ri.set = targetInfo.group; else delete mapped.extensions.ri.set; delete mapped.extensions.ri.copyOf; }
        return mapped;
    };
    for (const change of cs.manualWorldChanges || []) if (change.world === from && uids[String(change.uid)] !== undefined) {
        const uid = uids[String(change.uid)]; change.world = to; change.uid = uid;
        change.before = remapEntry(change.before, uid); change.after = remapEntry(change.after, uid);
    }
    cs.branchHistoryNotice = !!from;
    cs.world = to;
    delete cs.branchPendingWorld;
    cs.worldFrom = from;
    cs.worldOwner = mark;
    cs.worldLog = null;   // rebuilt from the records, which now name the copy
    saveChatState();
    try { await ctx().saveChat?.(); } catch { /* saved with the next change */ }
    addLog({ what: 'Story world for a branch', ok: true, result: `This chat is a branch, so it got its own copy of the story world "${info.name}", named "${name}", with ${Object.keys(uids).length} entries. What happens in this branch now changes the copy, and the chat it came from keeps the original. ${moved} replies were pointed at the copy.${removedOverrides ? ` ${removedOverrides} protected corrections from after the branch point or without a known date were left out.` : ''}` });
}

/**
 * A new reply is about to replace the newest one (a swipe). What that reply and its earlier swipes filed is undone
 * first, so the new reply is written from the world as it stood before them. Swiping back files it again.
 */
export function undoForSwipe() {
    return enqueue(async () => {
        const cs = chatState();
        const chat = ctx().chat || [];
        const m = chat[chat.length - 1];
        if (!cs || !m || m.is_user || cs.branchPendingWorld) return;
        await syncNow();
        const log = worldLog(cs);
        const times = new Set();
        if (m.extra?.[KEY]?.time) times.add(String(m.extra[KEY].time));
        for (const info of Array.isArray(m.swipe_info) ? m.swipe_info : []) if (info?.extra?.[KEY]?.time) times.add(String(info.extra[KEY].time));
        let undone = 0;
        for (const t of times) { if (!log.items[t]) continue; undone += await revertItem(log.items[t]); delete log.items[t]; }
        if (undone) { saveChatState(); addLog({ what: 'Story world update', ok: true, result: `${undone} ${undone === 1 ? 'change was' : 'changes were'} undone because the reply that made ${undone === 1 ? 'it' : 'them'} is being replaced by a new one.`, details: [], got: '' }); }
    });
}

/** Prepare a guided swipe transaction without overwriting user-edited world facts. */
export function prepareGuidedSwipe(id, {keepManualEdits = false} = {}) {
    return enqueue(async () => {
        const c = ctx(), cs = chatState(), m = c.chat?.[id], rec = m?.extra?.[KEY];
        if (!cs || !m || id !== c.chat.length - 1 || m.is_user || m.is_system) throw new Error('The latest character reply is no longer selected.');
        if (cs.branchPendingWorld) throw new Error('The branch world is not ready. Reopen the branch and retry.');
        const existingLog = cs.worldLog;
        const currentTime = String(rec?.time || '');
        if (rec?.update?.changes?.length && !rec.update.undone && existingLog?.chat === String(c.getCurrentChatId?.() || '') && !existingLog.fresh && !existingLog.items?.[currentTime]) throw new Error('The reply’s world-change history is unavailable. Review its world changes before retrying.');
        await syncNow();
        const log = worldLog(cs), time = String(rec?.time || ''), item = log.items[time];
        const tx = { chat: String(c.getCurrentChatId?.() || ''), id, time, world: '', before: null, after: null, item: item ? structuredClone(item) : null };
        if (!item?.changes?.length) {
            if (rec?.update?.changes?.length && !rec.update.undone && !item) throw new Error('The reply’s world-change history is unavailable. Review its world changes before retrying.');
            return tx;
        }
        if (item.world !== chatWorld()) throw new Error('The reply changed a different story world. Select that world and review its changes before retrying.');
        const data = await loadWorld(item.world);
        if (!data) throw new Error('The story world could not be read.');
        const before = structuredClone(data), after = structuredClone(data);
        const unsupported = item.changes.find(x => !['set', 'status', 'off', 'create', 'clock'].includes(x.type) || (x.type === 'clock' && !Object.hasOwn(x, 'afterAt')) || (x.type === 'status' && !Object.hasOwn(x, 'afterAt') && !/ordered into the scene/.test(x.why || '')));
        if (unsupported) throw new Error('This reply changed chapter or timing data that cannot be safely reversed automatically. Review the story world before guiding a swipe.');
        const corrections = keepManualEdits && rec?.v10
            ? new Set((cs.manualWorldChanges || []).filter(change=>change.world===item.world && change.anchor===`record:${rec.time}`).map(change=>change.uid))
            : new Set();
        const reversible = item.changes.filter(x => ['set','status','off','create','clock'].includes(x.type) && !corrections.has(x.uid));
        if (revertChanges(after, item.world, reversible) !== reversible.length) throw new Error('Some world facts were changed since this reply. Review them in Story World before guiding a swipe; nothing was changed.');
        await saveWorld(item.world, after);
        Object.assign(tx, { world: item.world, before, after: structuredClone(after) });
        return tx;
    }, { propagate: true });
}

/** On an aborted guided swipe, restore only if the world has not changed since rollback. */
export function restoreGuidedSwipe(tx) {
    return enqueue(async () => {
        if (!tx) return false;
        const sameChat = String(ctx().getCurrentChatId?.() || '') === tx.chat;
        const cs = sameChat ? chatState() : null;
        if (tx.world) {
            const current = await loadWorld(tx.world);
            if (!current || JSON.stringify(current) !== JSON.stringify(tx.after)) {
                toast('warning', 'The guided swipe stopped, but the world changed meanwhile. Review the Story World; it was not overwritten.');
                return false;
            }
            await saveWorld(tx.world, tx.before);
        }
        if (cs && tx.item) worldLog(cs).items[tx.time] = tx.item;
        if (cs) saveChatState();
        return true;
    }, { propagate: true });
}

/** "Undo these changes" on one reply, from What Was Sent. */
export function undoReplyChanges(id, onDone) {
    return enqueue(async () => {
        const cs = chatState();
        const rec = ctx().chat?.[id]?.extra?.[KEY];
        if (!cs || !rec?.update || rec.update.undone) return;
        await revertItem({ world: rec.update.world, changes: rec.update.changes });
        rec.update.undone = true;
        const log = worldLog(cs);
        log.items[String(rec.time)] = { world: rec.update.world, changes: [] };
        saveChatState();
        try { ctx().saveChat?.(); } catch { /* saved with the next change */ }
        onDone?.();
    });
}

/** Explicit character/plot edits use the same native book and branch history. */
export async function saveV10Record(input) {
    if (!enabledV10()) throw new Error('Enable the v10 story tools first.');
    const cs = chatState();
    const wid = await ensureWorld();
    return enqueue(async () => {
        if (chatState() !== cs || chatWorld() !== wid) throw new Error('The story world changed.');
        const data = await loadWorld(wid);
        if (!data) throw new Error('Could not load the story world.');
        if (chatState() !== cs) throw new Error('The chat changed.');
        const rows = listWorld(data,wid);
        const record = normalizeRecord(input,{ modules:effectiveModules(), rows:recordMap(rows), sceneId:(ctx().chat || []).map(message=>message.extra?.[KEY]?.v10SceneId).filter(Boolean).at(-1), base:baseWorld(), manual:true });
        if (!record) throw new Error('The record has missing or invalid fields.');
        const kind = record.kind === 'seed' ? 'payoff' : record.kind;
        const w = rows.find(row => readRecord(row)?.id === record.id) || newWorldEntry(data,kind);
        const before = data.entries[w.uid] ? structuredClone(data.entries[w.uid]) : null;
        w.name = record.id;
        record.atIndex = (ctx().chat || []).length - 1;
        record.source = 'user';
        w.fields.data = JSON.stringify(record);
        writeWorldEntry(data,w,wid);
        await saveWorld(wid,data);
        if (chatState() === cs) recordManualWorldChange(wid,w.uid,before,data.entries[w.uid]);
        return record;
    }, {propagate:true});
}
