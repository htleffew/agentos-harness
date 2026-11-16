// Keeping the story world up to date by itself.
//  1. With each reply the extension asks the model to add one short block that records what the reply made true.
//     The block is lifted out of the reply and filed as world entries. No extra AI request is made.
//  2. Open threads build by themselves, and now and then something that is ready is ordered into the scene.
//  3. Every automatic change is stored with the reply that caused it, and is undone when that reply is swiped
//     away or deleted.
import { ctx, KEY, LOG, names, isReply } from './st.js';
import { settings, chatState, saveChatState } from './store.js';
import { addLog } from './log.js';
import { rollInt, pickWeighted } from './books.js';
import { worldOffers, rememberStory } from './pacing.js';
import { WORLD_KINDS, MAX_ACTIVITIES, DONE, HUD_BLOCKS, namedIn, listWorld, newWorldEntry, writeWorldEntry, chatWorld, loadWorld, saveWorld, buildNotes } from './world.js';

export const ASK_WORLD = 'Roleplay Instructions story update';
export const ORDER_WORLD = 'Story world';
export const isAsk = e => e?.world === ASK_WORLD;
export const isOrder = e => e?.world === ORDER_WORLD;
export const PACE_WORLD = 'Roleplay Instructions story phase';
export const isPace = e => e?.world === PACE_WORLD;
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
const PLACEHOLDER = /^(name|short title|thread title|secret title|planted detail title|title|none|nothing|n\/a|-+|\.+)$/i;

/** The text that asks for the block. list: the world's entries. */
export function buildAsk(list) {
    const on = list.filter(w => w.on);
    const names = (kind, keep = () => true) => on.filter(w => w.kind === kind && keep(w)).map(w => clean(w.name)).filter(Boolean).slice(0, 40).join(', ') || 'none yet';
    return [
        '[Story update. After the story text of this reply, add one block in exactly this form. It is filed away and removed from the page. Write a line only for something this reply made true, one item per line, and leave out every line that has nothing new. Plain statements of fact.',
        '<story_update>',
        ...FORM.map(([k, v]) => `${k}: ${v}`),
        'scene: continues (or "ended" when the story moved on to a new time or place)',
        '</story_update>',
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
    const m = src.match(BLOCK);
    if (!m) return { found: false, ops: [], ended: false, block: '', clean: src };
    const ops = [];
    let ended = false;
    for (const raw of m[1].split('\n')) {
        const line = raw.replace(/^[\s\-*•]+/, '').replace(/\*\*/g, '').trim();
        const hit = line.match(/^([a-z]+)\s*:\s*(.+)$/i);
        if (!hit) continue;
        const k = hit[1].toLowerCase();
        if (k === 'scene') { ended = /^\W*ended\b/i.test(hit[2]); continue; }
        if (!ARITY[k]) continue;
        const parts = hit[2].split('|').map(clean);
        if (!parts[0] || PLACEHOLDER.test(parts[0]) || parts[0].length > 80) continue;
        // A line copied from the form with nothing filled in is left out.
        if (FORM.some(([fk, fv]) => fk === k && norm(fv) === norm(hit[2]))) continue;
        ops.push({ k, a: parts[0], b: parts[1] || '', c: parts.slice(2).join(' | ') });
    }
    return { found: true, ops, ended, block: clean(m[0]), clean: stripUpdateBlock(src).trimEnd() };
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
    const may = (w, field) => !w.locked && (w.auto || (mode === 'all' && (LIVE[w.kind] || []).includes(field)));
    const mayStatus = (w) => !w.locked && (w.auto || mode === 'all');
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
        changes.push({ uid: w.uid, name: w.name, kind: w.kind, type: 'status', before: w.status, after: to, why });
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
        changes.push({ uid: w.uid, name: w.name, kind, type: 'create' });
        return w;
    };

    for (const op of ops) {
        const { k, a, b, c } = op;
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
        if (!w.at || w.at.chat !== meta.chat) { w.at = { chat: meta.chat, n: meta.n }; writeWorldEntry(data, w, id); changes.push({ uid: w.uid, type: 'clock' }); continue; }
        if (meta.n - w.at.n < build) continue;
        const to = WORLD_KINDS.thread.steps[stepIndex('thread', w.status) + 1][0];
        changes.push({ uid: w.uid, name: w.name, kind: 'thread', type: 'status', before: w.status, after: to, why: `${build} replies went by with no movement` });
        w.status = to; w.at = { chat: meta.chat, n: meta.n };
        writeWorldEntry(data, w, id);
    }
    return changes;
}

/** Undo a list of changes, newest first. A line that was changed again since is left as it is. */
export function revertChanges(data, id, changes) {
    let done = 0;
    for (const c of [...changes].reverse()) {
        const entry = data.entries?.[c.uid];
        if (!entry) continue;
        const w = listWorld(data, id).find(x => x.uid === c.uid);
        if (!w) continue;
        if (c.type === 'create') { if (w.auto) { delete data.entries[c.uid]; done++; } continue; }
        if (c.type === 'set' && clean(w.fields[c.field]) === c.after) { w.fields[c.field] = c.before; writeWorldEntry(data, w, id); done++; }
        if (c.type === 'status' && w.status === c.after) { w.status = c.before; writeWorldEntry(data, w, id); done++; }
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
        return { text: `${w.name} must speak or act in this reply, in a way that fits who ${w.name} is${wants ? ` and what ${w.name} wants (${wants})` : ''}.`, name: `Character: ${w.name}`,
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
            options.push({ weight: 3, w, to: 'happening', text: `the open matter "${w.name}" must come to a head${v(w, 'open') ? `: ${v(w, 'open')}` : ''}.${v(w, 'sets_off') ? ` What brings it on: ${v(w, 'sets_off')}.` : ''} It happens in the scene, where it can be seen and heard.` });
        } else if (w.kind === 'seed' && bring.seed && w.status !== DONE.seed && age(w) >= minAge) {
            options.push({ weight: 2, w, to: DONE.seed, text: `a detail planted earlier must matter now: ${v(w, 'detail') || w.name}.${v(w, 'payoff') ? ` What it leads to: ${v(w, 'payoff')}.` : ''} Someone other than {{user}} acts on it in the scene.` });
        } else if (w.kind === 'activity' && bring.activity && w.status !== DONE.activity && age(w) >= minAge) {
            const who = v(w, 'who') || 'someone';
            options.push({ weight: 2, w, to: DONE.activity, text: `what ${who} has been doing away from the scene must reach the scene now${v(w, 'what') ? ` (${v(w, 'what')}${v(w, 'step') ? `; so far: ${v(w, 'step')}` : ''})` : ''}: its result arrives, or ${who} arrives with it.` });
        } else if (w.kind === 'secret' && bring.secret && w.status === 'kept' && v(w, 'secret') && here.some(n => n && norm(w.fields.holder).includes(n))) {
            options.push({ weight: 1, w, to: 'out', text: `a secret must come out: ${v(w, 'secret')}${v(w, 'holder') ? ` (it is ${v(w, 'holder')}'s secret)` : ''}. Someone in the scene learns it by seeing it, hearing it or being told.` });
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
export async function prepareWorld(type, replyNo, { quiet = false, scale = 100 } = {}) {
    const id = chatWorld();
    if (quiet) return null;
    if (!id) {
        // A chat that was started with "New chapter" and has no story world carries its summary in the chat itself.
        const carried = clean(chatState()?.carried);
        if (!carried || settings().summary.on === false) return null;
        const text = `[The story before this chat. These are facts already true in this story. Write the reply so that they stay true.\n${carried}]`;
        rememberStory(carried);
        return { id: '', notes: { text, tokens: Math.round(text.length / 4), ids: [], extra: [], present: [], missing: [], place: '', location: '', how: '' }, ask: '', order: null };
    }
    const data = await loadWorld(id).catch(() => null);
    if (!data) return null;
    const o = settings().world;
    const list = listWorld(data, id);
    const notes = buildNotes(list, type);
    const ooc = isOocTurn();
    const ask = o.update !== 'off' && !ooc ? buildAsk(list) : '';
    const meta = { chat: String(ctx().getCurrentChatId() || ''), n: replyNo };
    const order = ooc ? null : rollOrder(list, notes?.present || [], meta, o, { type, scale });
    // What a story event item may ask for: an open thread, a kept secret or a plan of someone in the scene.
    return { id, notes, ask, order, offers: worldOffers(list, notes?.present || [], meta) };
}

// ---------- after the reply ----------

let queue = Promise.resolve();
/** World changes run one after another, so two of them never write the lorebook at the same time. */
export function enqueue(fn) {
    queue = queue.then(fn).catch(e => console.warn(LOG, 'story world', e));
    return queue;
}
export const worldIdle = () => queue;

function worldLog(cs) {
    const chat = String(ctx().getCurrentChatId() || '');
    if (!cs.worldLog || cs.worldLog.chat !== chat) cs.worldLog = { chat, items: {}, fresh: true };
    return cs.worldLog;
}

/** Take the block out of a reply, on the message and on its swipe. Returns what parseUpdate found. */
export function liftBlock(id) {
    const c = ctx();
    const m = c.chat?.[id];
    if (!m || typeof m.mes !== 'string' || !/<story_update\b/i.test(m.mes)) return { found: false, ops: [], ended: false, block: '' };
    const parsed = parseUpdate(m.mes);
    m.mes = parsed.clean;
    if (Array.isArray(m.swipes) && typeof m.swipe_id === 'number' && m.swipes[m.swipe_id] !== undefined) m.swipes[m.swipe_id] = m.mes;
    try { c.updateMessageBlock?.(id, m); } catch { /* drawn without the block on the next redraw */ }
    return parsed;
}

/** File what a reply established. parsed: from liftBlock. rec: the record on that reply. effects: world orders that count as done. */
export function afterReply(id, rec, parsed, replyNo, onDone) {
    return enqueue(async () => {
        const cs = chatState();
        const wid = chatWorld();
        if (!cs || !wid || !rec) return;
        await syncNow();
        const o = settings().world;
        const data = await loadWorld(wid);
        if (!data) return;
        const meta = { chat: String(ctx().getCurrentChatId() || ''), n: replyNo };
        const ooc = isOocTurn();
        const changes = [];
        if (parsed.found && o.update !== 'off' && !ooc) changes.push(...applyOps(data, wid, parsed.ops, meta, o.update));
        if (!ooc) changes.push(...tick(data, wid, meta));
        if (changes.length) await saveWorld(wid, data);
        // A reply that was continued keeps what its first part filed.
        const before = rec.update && rec.update.world === wid && !rec.update.undone ? rec.update : null;
        rec.update = { world: wid, ops: [...(before?.ops || []), ...parsed.ops], ended: !!parsed.ended, changes: [...(before?.changes || []), ...changes] };
        worldLog(cs).items[String(rec.time)] = { world: wid, changes: rec.update.changes };
        saveChatState();
        try { ctx().saveChat?.(); } catch { /* saved with the next change */ }
        const shown = shownChanges(changes);
        if (parsed.found || shown.length) {
            addLog({ what: 'Story world update', ok: true, result: parsed.found
                ? `The reply's update block had ${parsed.ops.length} ${parsed.ops.length === 1 ? 'line' : 'lines'}. ${shown.length} ${shown.length === 1 ? 'change was' : 'changes were'} made to the world.${ooc ? ' Nothing was filed, because your message was out of character.' : ''}`
                : `${shown.length} ${shown.length === 1 ? 'change was' : 'changes were'} made by the clock. The reply had no update block.`,
                details: shown.map(describeChange), got: parsed.block });
        } else if (o.update !== 'off' && !ooc) {
            addLog({ what: 'Story world update', ok: null, result: 'The reply had no update block, so nothing was filed from it. This is normal now and then. If it happens every time, the model is leaving the block out.', details: [], got: '' });
        }
        onDone?.();
    });
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
    const cs = chatState();
    if (!cs) return false;
    const rec = (ctx().chat || []).map(m => m?.extra?.[KEY]).find(r => r && String(r.time) === String(time));
    if (!rec) return false;
    if (!rec.update) rec.update = { world: wid, ops: [], ended: false, changes: [] };
    rec.update.changes.push(change);
    const log = worldLog(cs);
    const item = log.items[String(time)] || (log.items[String(time)] = { world: wid, changes: rec.update.changes });
    if (item.changes !== rec.update.changes) item.changes.push(change);
    saveChatState();
    try { ctx().saveChat?.(); } catch { /* saved with the next change */ }
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

/** Bring the world in line with the replies that are in the chat now. */
async function syncNow() {
    const cs = chatState();
    if (!cs || !settings().enabled) return;
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
    for (const t of Object.keys(log.items)) {
        if (current.has(t)) continue;
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
            if (changes.length) { await saveWorld(wid, data); redone += shownChanges(changes).length; }
        }
        rec.update.changes = changes;
        log.items[t] = { world: rec.update.world, changes };
    }
    if (undone || redone) {
        saveChatState();
        try { ctx().saveChat?.(); } catch { /* saved with the next change */ }
        addLog({ what: 'Story world update', ok: true, result: `${undone ? `${undone} ${undone === 1 ? 'change was' : 'changes were'} undone because the reply that made ${undone === 1 ? 'it' : 'them'} is no longer in the chat. ` : ''}${redone ? `${redone} ${redone === 1 ? 'change was' : 'changes were'} made again because that reply is back.` : ''}`.trim(), details: [], got: '' });
    }
}
export const syncWorld = (onDone) => enqueue(async () => { await syncNow(); onDone?.(); });

/**
 * A new reply is about to replace the newest one (a swipe). What that reply and its earlier swipes filed is undone
 * first, so the new reply is written from the world as it stood before them. Swiping back files it again.
 */
export function undoForSwipe() {
    return enqueue(async () => {
        const cs = chatState();
        const chat = ctx().chat || [];
        const m = chat[chat.length - 1];
        if (!cs || !m || m.is_user) return;
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
