import { changesFromProfiles, statePrompt, blockedEventTags, reanchorRemovedCorrections } from './state.js';
// What happens on each reply: which instructions are sent, which version, the record of what was sent,
// and the check that it happened. World Info rolls chance, timing and groups; this module works on the result.
import { ctx, on, KEY, LOG, sub, scanLength, isReply, notePromptSent, isChatOpen, parseJson, names, triggerSwipe, loadBook, isGenerating, toast } from './st.js';
import { request, isOwnPrompt } from './ai.js';
import { settings, saveSettings, chatState, saveChatState, applyPronouns } from './store.js';
import { isEvent, isStyle, rollEvent, rerollCategory, eventAllowed, withPreset, checkRules, burnStatus } from './events.js';
import { NOTES_WORLD, isNotes, notesEntry, readScene } from './world.js';
import { phaseFor, quietNow, previousRecord, countPresent } from './pacing.js';
import { rollDice, DICE_QUESTION } from './dice.js';
import { shownChanges } from './worldflow.js';
import { chapterAfterReply } from './chapters.js';
import { buildSceneAsk, cardsOn, PROFILE_STABLE, keptProfile } from './worldflow.js';
import { ASK_WORLD, ORDER_WORLD, PACE_WORLD, DICE_WORLD, isAsk, isOrder, isPace, isDice, askEntry, orderEntry, paceEntry, diceEntry, isOocTurn, prepareWorld, liftBlock, afterReply, applyEffect, syncWorld, undoForSwipe, prepareGuidedSwipe, restoreGuidedSwipe, invalidateAfterEdit, worldIdle, stripUpdateBlock } from './worldflow.js';
import { GOAL_WORLD, isGoal, goals, goalEntry, goalProgress, goalDone, buildGoalOrder, advanceIfDone } from './goals.js';
import { USER_LINE, parseContent, wrapText, toStore, setOptions, setInfo, setName, setOfEntry, canonSet, pickWeighted, rollInt, SENT_AS, stickyToKeep, cooldownToWait, delayToReplyNumber } from './books.js';

const sentEntries = new Map();   // key -> the lorebook entry whose text is being sent in this reply

/**
 * The line about {{user}}'s words closes every note as it is stored, so a set works with the extension off.
 * When several notes go out in one reply, the line is said once, on the last of them.
 */
function sayUserLineOnce(items) {
    const tail = `${sub(USER_LINE)}]`;
    const having = items.filter(it => typeof it.text === 'string' && it.text.endsWith(tail));
    for (const it of having.slice(0, -1)) {
        it.text = `${it.text.slice(0, -tail.length)}]`;
        const entry = sentEntries.get(it.key);
        if (entry) entry.content = it.text;
    }
    sentEntries.clear();
}

let gen = null;            // the generation in progress: { type, dryRun, skip, handled }
let pending = null;        // what was sent for the reply being written: { items, type }
let guided = null;         // one in-flight guided swipe, never a standing prompt
let guidedPreparing = false;
let pickAgain = false;     // set by "Pick again": the next swipe rolls fresh instead of repeating
let rerollCat = null;      // set by "Pick again" on one picked item: { key, catId } to re-pick on the next swipe
let checkPromise = null;
const rawByKey = new Map(); // "lorebook.uid" -> { content, role } as stored, for lorebooks this extension did not write
const timing = new Map();   // "lorebook.uid" -> { keep, wait } in replies, as set on the instruction
let plan = { continuing: new Map() }; // for the scan that follows: instructions that keep sending -> their version
const listeners = new Set();

export function onChange(fn) { listeners.add(fn); }
function changed(what, id) {
    for (const fn of listeners) { try { fn(what, id); } catch (e) { console.error(LOG, e); } }
}

const keyOf = e => `${e.world}.${e.uid}`;
/** The set an entry belongs to ('' when it is in no set in the list). A shared lorebook holds several sets. */
const setOf = e => isGoal(e) ? GOAL_WORLD : isNotes(e) ? NOTES_WORLD : isAsk(e) ? ASK_WORLD : isOrder(e) ? ORDER_WORLD : isPace(e) ? PACE_WORLD : isDice(e) ? DICE_WORLD : setOfEntry(e);
const isManaged = e => !!setOf(e);

// ---------- sets that were moved ----------
//
// Moving a set into or out of a shared lorebook gives its entries new keys. Each entry remembers the keys it had
// before, so the records on older replies, and this chat's own state, still count for it.

const alias = new Map();   // former key -> the key the entry has now
const canon = key => alias.get(key) || key;

function learnAliases(entries) {
    const live = new Set(entries.map(keyOf));
    for (const e of entries) for (const old of e.extensions?.ri?.was || []) if (!live.has(old)) alias.set(String(old), keyOf(e));
}

/** Read the lorebooks of sets that were moved, so former keys are known before the first reply. */
async function refreshAliases() {
    const books = new Set(Object.keys(settings().sets).map(setInfo).filter(i => i.was.length).map(i => i.book));
    for (const book of books) {
        const data = await loadBook(book).catch(() => null);
        if (data?.entries) learnAliases(Object.values(data.entries).map(e => ({ ...e, world: book })));
    }
}

/** Bring this chat's own state in line with where the sets and their entries are now. */
function syncChat(cs) {
    let dirty = false;
    const sets = [...new Set(cs.activeSets.map(canonSet))];
    if (sets.join('\n') !== cs.activeSets.join('\n')) { cs.activeSets = sets; dirty = true; }
    for (const id of Object.keys(cs.presets)) {
        const now = canonSet(id);
        if (now !== id) { if (!(now in cs.presets)) cs.presets[now] = cs.presets[id]; delete cs.presets[id]; dirty = true; }
    }
    if (alias.size) {
        for (const map of [cs.used, cs.picks, cs.locks]) {
            for (const key of Object.keys(map)) {
                const now = canon(key);
                if (now !== key) { if (!(now in map)) map[now] = map[key]; delete map[key]; dirty = true; }
            }
        }
        for (const o of cs.overdue) { const now = canon(o.key); if (now !== o.key) { o.key = now; dirty = true; } }
        for (const it of cs.lastScan?.items || []) { const now = canon(it.key); if (now !== it.key) { it.key = now; dirty = true; } }
        const states = cs.lastScan?.states;
        if (states) for (const key of Object.keys(states)) { const now = canon(key); if (now !== key) { states[now] = states[key]; delete states[key]; dirty = true; } }
    }
    if (dirty) saveChatState();
}

/** Called by the panel after a set was moved: the open chat follows it right away. */
export async function setsMoved() {
    await refreshAliases();
    const cs = chatState();
    if (cs) syncChat(cs);
    changed('messages');
}

// ---------- timing, counted in replies from the records kept on the replies ----------
//
// World Info's own "sticky", "cooldown" and "delay" count the messages it is handed for the scan. Setups that hand
// it only a window of recent messages (a summarizer, a context limit) freeze that count, and the timers stop
// working. So while the extension is on it does the timing itself: it reads what was sent with each reply from the
// records on the replies. That also makes timing follow deletes, branches and swipes exactly.

/** What the chat's records say, up to the reply that is about to be written. */
function history(type = 'normal') {
    const chat = ctx().chat || [];
    let end = chat.length;
    if (type === 'swipe' || type === 'continue') end -= 1; // the reply being rewritten does not count yet
    let replies = 0;
    const last = new Map(); // key -> { start: reply number where it last started, version }
    const events = new Map(); // key -> the category state stored with that event set's latest event
    for (let i = 0; i < end; i++) {
        const m = chat[i];
        if (!isReply(m)) continue;   // a reply that was hidden from the AI is still a reply of the story
        if (i === 0) continue; // the greeting is not a reply
        replies++;
        for (const it of m.extra?.[KEY]?.items || []) {
            const key = canon(it.key);
            const prev = last.get(key);
            if (it.kind === 'continuing' && prev) prev.version = it.version;
            else last.set(key, { start: replies, version: it.version });
            if (it.event) events.set(key, it.event);
        }
        // Writing style sets keep their category state on the reply even when nothing was sent that time.
        for (const [key, st] of Object.entries(m.extra?.[KEY]?.states || {})) events.set(canon(key), st);
    }
    return { next: replies + 1, last, events };
}

const groupsOf = e => String(e.group || '').split(',').map(g => g.trim()).filter(Boolean);

/** Decide, before the scan, which instructions keep sending, which are waiting, and which are free to roll. */
function applyTiming(entries, cs) {
    const h = history(gen && !gen.dryRun ? gen.type : 'normal');
    const queued = new Set((cs?.overdue || []).map(o => o.key));
    const state = new Map();
    plan = { continuing: new Map(), events: h.events };
    for (const e of entries) {
        const key = keyOf(e);
        const keep = stickyToKeep(e.sticky);
        const wait = cooldownToWait(e.cooldown, e.sticky);
        const notBefore = delayToReplyNumber(e.delay);
        timing.set(key, { keep, wait });
        e.sticky = null; e.cooldown = null; e.delay = null; // the extension does the timing for this scan
        if (e.disable) continue;
        const l = h.last.get(key);
        const since = l ? h.next - l.start : Infinity;
        if (since <= keep && !queued.has(key)) { state.set(e, 'continuing'); plan.continuing.set(key, l.version); }
        else if (since <= keep + wait || (notBefore > 1 && h.next < notBefore)) state.set(e, 'waiting');
    }
    // An instruction that keeps sending holds its Only-one group: the others in that group wait.
    const busy = new Set(entries.filter(e => state.get(e) === 'continuing').flatMap(groupsOf));
    for (const e of entries) {
        if (!e.disable && !state.has(e) && groupsOf(e).some(g => busy.has(g))) state.set(e, 'waiting');
    }
    // A story phase raises or lowers the chance that something new starts.
    const ph = phaseFor(h.next);
    for (const e of entries) {
        const st = state.get(e);
        if (st === 'continuing') { e.content = `@@activate\n${e.content || ''}`; e.useProbability = false; }
        else if (st === 'waiting') e.content = `@@dont_activate\n${e.content || ''}`;
        else if (ph && ph.chance !== 100 && !e.disable && !isStyle(e) && !isGoal(e) && !isNotes(e) && !isAsk(e) && !isOrder(e) && !isPace(e) && !isDice(e)) {
            const base = e.useProbability === false ? 100 : Number(e.probability ?? 100);
            e.probability = Math.max(0, Math.min(100, Math.round(base * ph.chance / 100)));
            e.useProbability = true;
        }
    }
}

/** True when this instruction will be sent with the next reply anyway because it keeps sending. */
function keepsGoing(key) {
    key = canon(key);
    const t = timing.get(key);
    if (!t?.keep) return false;
    const h = history('normal');
    const l = h.last.get(key);
    return !!l && h.next - l.start <= t.keep;
}

// ---------- before the scan: add this chat's instruction sets ----------

async function onEntriesLoaded(lore) {
    try {
        const st = settings();
        if (!st.enabled || !lore) return;
        const arrays = [lore.globalLore, lore.characterLore, lore.chatLore, lore.personaLore].filter(Array.isArray);
        const cs = chatState();
        if (cs) syncChat(cs);
        if (cs && Array.isArray(lore.chatLore)) {
            const present = new Set(arrays.flat().map(e => e.world));
            const active = new Set(cs.activeSets.filter(id => st.sets[id]));
            const byBook = new Map();   // lorebook -> the sets in it that are on for this chat
            for (const id of active) { const info = setInfo(id); if (!byBook.has(info.book)) byBook.set(info.book, []); byBook.get(info.book).push(info); }
            for (const [book, infos] of byBook) {
                if (present.has(book)) continue;
                const data = await loadBook(book).catch(() => null);
                if (!data?.entries) continue;
                // A lorebook of its own is added whole. From a shared lorebook, only the sets that are on.
                const whole = infos.some(i => !i.shared);
                const groups = new Set(infos.filter(i => i.shared).map(i => i.group));
                lore.chatLore.push(...Object.values(data.entries).filter(e => whole || groups.has(e.extensions?.ri?.set)).map(e => ({ ...e, world: book })));
            }
            // A shared lorebook that World Info added by itself: its sets that are off for this chat stay out.
            // Entries of a story world never go out one by one: this chat's world is sent as one block of story notes.
            for (const arr of arrays) {
                for (let i = arr.length - 1; i >= 0; i--) {
                    const id = setOfEntry(arr[i]);
                    if (!id) continue;
                    const info = setInfo(id);
                    if (info.kind === 'world' || (info.shared && !active.has(id))) arr.splice(i, 1);
                }
            }
        }
        const quiet = !!(gen && !gen.dryRun && gen.skip);
        // The story world: its notes, the request for an update block, and now and then an order of its own.
        const kind = gen && !gen.dryRun ? gen.type : 'normal';
        if (kind === 'swipe' && cs && !gen?.guided) undoForSwipe();
        await worldIdle();
        const phase = cs ? phaseFor(history(kind).next) : null;
        const flow = cs && Array.isArray(lore.chatLore) ? await prepareWorld(kind, history(kind).next, { quiet, scale: phase?.chance ?? 100 }).catch((e) => { console.warn(LOG, 'story world', e); return null; }) : null;
        // A story phase can have a line of its own, sent with every reply of the phase.
        if (phase?.line && !quiet && Array.isArray(lore.chatLore)) lore.chatLore.push(paceEntry(phase.line));
        // Dice: rolled in code for every reply while they are on (not for background requests or out-of-character turns).
        if (cs && settings().dice?.on && !quiet && !isOocTurn() && Array.isArray(lore.chatLore)) lore.chatLore.push(diceEntry());
        const stateText = cs && !quiet && !isOocTurn() ? statePrompt(kind, Math.max(100, Math.min(1000, Number(settings().cards?.stateBudget) || 350)) * 4, { includeCharacters: cardsOn(), excludeTargetOverrides: !!gen?.guided }) : '';
        const direction = gen?.guided && kind === 'swipe' ? `[Direction for this replacement reply only: ${gen.guided.direction}\nThis replaces the discarded reply. Follow the direction while respecting established story facts and the user's agency.]` : '';
        const notes = flow?.notes || null;
        if (notes) lore.chatLore.push(notesEntry(notes.text));
        if (flow?.ask) lore.chatLore.push(askEntry([stateText, direction, flow.ask].filter(Boolean).join('\n')));
        // With no story world, the scene lines are still asked for, so who is present, where and when are known under any preset.
        else if (cs && !quiet && (settings().scene?.track !== false || cardsOn()) && !isOocTurn() && Array.isArray(lore.chatLore)) { const a = buildSceneAsk(kind); if (a) lore.chatLore.push(askEntry([stateText, direction, a].filter(Boolean).join('\n'))); }
        else if (direction && Array.isArray(lore.chatLore)) lore.chatLore.push(askEntry([stateText, direction].filter(Boolean).join('\n')));
        if (flow) lore.chatLore.push(orderEntry());
        // The character goal travels as one entry that is made here for each scan.
        if (cs && Array.isArray(lore.chatLore) && !(gen && !gen.dryRun && gen.skip)) {
            const g = goals();
            if (g?.on && String(g.goal || '').trim() && !goalDone(g, goalProgress(gen && !gen.dryRun ? gen.type : 'normal'))) lore.chatLore.push(goalEntry());
        }
        for (const arr of arrays) {
            for (const e of arr) if (isManaged(e)) rawByKey.set(keyOf(e), { content: e.content, role: e.role });
        }
        learnAliases(arrays.flat().filter(isManaged));
        if (cs) syncChat(cs);
        // Requests that are not a reply from the character (impersonate, background requests) carry no instructions.
        if (gen && !gen.dryRun && gen.skip) {
            for (const arr of arrays) {
                for (let i = arr.length - 1; i >= 0; i--) if (isManaged(arr[i])) arr.splice(i, 1);
            }
            return;
        }
        if (cs) applyTiming(arrays.flat().filter(isManaged), cs);
        plan.notes = notes;
        plan.flow = flow;
        plan.phase = phase;
    } catch (e) { console.error(LOG, 'entries-loaded', e); }
}

// ---------- after the scan: limits, re-sends, picked versions, the record ----------

function versionsOf(entry) {
    const saved = entry.extensions?.ri;
    if (saved && Array.isArray(saved.versions) && saved.versions.length) {
        return { sentAs: SENT_AS[saved.sentAs] ? saved.sentAs : 'plain', versions: saved.versions.map(v => typeof v === 'string' ? v : String(v.text ?? '')).filter(Boolean) };
    }
    const raw = rawByKey.get(keyOf(entry));
    const p = parseContent(raw?.content ?? entry.content, raw?.role ?? entry.role);
    return { sentAs: p.sentAs, versions: p.versions };
}

/** Pick a version. Every version is used once before any is used again. */
function pickVersion(cs, key, versions) {
    let used = (cs.used[key] || []).filter(i => i < versions.length);
    let options = versions.map((_, i) => i).filter(i => !used.includes(i));
    if (!options.length) {
        const last = cs.picks[key]?.idx;
        used = [];
        options = versions.map((_, i) => i).filter(i => versions.length === 1 || i !== last);
    }
    const idx = options[rollInt(options.length)];
    used.push(idx);
    cs.used[key] = used;
    cs.picks[key] = { idx, text: versions[idx] };
    return versions[idx];
}

function makeItem(entry, sentAs, version, misses, kind, repeat = false, extra = null) {
    const text = sub(wrapText(sentAs, version, misses));
    entry.content = text;
    sentEntries.set(keyOf(entry), entry);
    const item = { key: keyOf(entry), world: entry.world, set: setOf(entry), uid: entry.uid, name: String(entry.comment || `Instruction ${entry.uid}`), sentAs, version, text, misses, kind, repeat, status: 'sent', quote: '' };
    // A story event also keeps what the dice picked, and the state of its categories after this event.
    if (extra?.event || extra?.parts) { item.event = extra.event; item.parts = extra.parts; }
    if (extra?.noCheck) item.noCheck = true;
    if (extra?.notes) item.notes = extra.notes;
    if (extra?.big) item.big = true;
    if (Array.isArray(extra?.dice)) { item.dice = extra.dice; item.name = 'Dice'; }
    if (extra?.pace) { item.pace = extra.pace; item.name = `Story phase: ${extra.pace}`; }
    if (Array.isArray(extra?.ask) && extra.ask.length) item.ask = extra.ask;
    if (extra?.worldOrder) { item.worldOrder = extra.worldOrder; item.name = extra.worldOrder.label || item.name; }
    if (extra && 'goalTask' in extra) { item.goalTask = extra.goalTask; item.checkText = extra.checkText; }
    return item;
}

/** Apply "How many instructions can be sent per reply" for one instruction set. Returns the new instructions to hold back. */
function applyLimit(set, fresh, continuing) {
    const o = setOptions(set);
    if (o.limit === 'none' || !fresh.length) return [];
    const weight = e => e.groupWeight ?? 100;
    let keep = fresh;
    if (o.limit === 'one') {
        keep = continuing.length ? [] : pickWeighted(fresh, weight, 1);
    } else if (o.limit === 'max') {
        keep = pickWeighted(fresh, weight, Math.max(0, o.max - continuing.length));
    } else if (o.limit === 'together') {
        const groupOf = e => String(e.extensions?.ri?.sendTogether || '').trim() || `\u0000solo ${e.uid}`;
        const active = new Set(continuing.map(groupOf));
        if (active.size) {
            keep = fresh.filter(e => active.has(groupOf(e)));
        } else {
            const groups = [...new Set(fresh.map(groupOf))];
            const best = g => Math.max(...fresh.filter(e => groupOf(e) === g).map(weight));
            const chosen = pickWeighted(groups, best, 1)[0];
            keep = fresh.filter(e => groupOf(e) === chosen);
        }
    }
    return fresh.filter(e => !keep.includes(e));
}

/** The record on the newest reply. While a swipe is being written it is found on the reply's earlier swipes. */
function lastRecord() {
    const chat = ctx().chat || [];
    const m = chat[chat.length - 1];
    if (!m || m.is_user) return null;
    if (m.extra?.[KEY]?.items) return m.extra[KEY];
    const infos = Array.isArray(m.swipe_info) ? m.swipe_info : [];
    for (let i = infos.length - 1; i >= 0; i--) if (infos[i]?.extra?.[KEY]?.items) return infos[i].extra[KEY];
    return null;
}

/** Every record still in the chat, by the time it was made. */
function liveRecordTimes() {
    const times = new Set();
    for (const m of ctx().chat || []) {
        if (m.extra?.[KEY]?.time) times.add(m.extra[KEY].time);
        for (const info of Array.isArray(m.swipe_info) ? m.swipe_info : []) if (info?.extra?.[KEY]?.time) times.add(info.extra[KEY].time);
    }
    return times;
}

/**
 * Bring the waiting list in line with the chat as it stands now. Called after messages are deleted, when a chat
 * or branch opens, and before each scan.
 * - Anything waiting to be sent again whose reply is gone from this chat is dropped.
 * - If the newest reply still says an instruction is overdue, that instruction is put back on the list.
 */
function reconcile() {
    const cs = chatState();
    if (!cs) return;
    const times = liveRecordTimes();
    const kept = cs.overdue.filter(o => !o.from || times.has(o.from)).map(o => canon(o.key) === o.key ? o : { ...o, key: canon(o.key) });
    const chat = ctx().chat || [];
    const last = chat[chat.length - 1];
    const rec = last && !last.is_user ? last.extra?.[KEY] : null;
    for (const it of rec?.items || []) {
        if (!['overdue', 'queued'].includes(it.status) || kept.some(o => o.key === canon(it.key))) continue;
        kept.push({ key: canon(it.key), world: it.world, uid: it.uid, name: it.name, sentAs: it.sentAs, version: it.version, misses: it.resend ?? Math.min(2, (it.misses || 0) + 1), from: rec.time, event: it.event, parts: it.parts, worldOrder: it.worldOrder, big: it.big });
    }
    if (JSON.stringify(kept) !== JSON.stringify(cs.overdue)) { cs.overdue = kept; saveChatState(); }
}

/**
 * What has already happened in this chat, read from the records on the replies that still exist.
 * keys: instructions and events that happened. ids: for each story event set, the list items that were used.
 * With the check on, "happened" means the check found it. With the check off, it means it was sent.
 */
function happened() {
    const keys = new Set();
    const ids = new Map();
    const checkOff = settings().check.mode === 'off';
    // A chat started with "New chapter" brings along what had already happened for good in the chat before it.
    const carried = chatState()?.burned;
    for (const k of carried?.keys || []) keys.add(canon(k));
    for (const [k, list] of Object.entries(carried?.ids || {})) ids.set(canon(k), new Set(list));
    // "Bring the used items back" for a set: what happened before that moment no longer counts for that set.
    const fresh = chatState()?.unburn || {};
    for (const k of Object.keys(fresh)) { keys.delete(canon(k)); ids.delete(canon(k)); }
    for (const m of ctx().chat || []) {
        const rec = m?.extra?.[KEY];
        for (const it of rec?.items || []) {
            const did = it.status === 'done' || ((checkOff || it.noCheck) && it.status === 'sent');
            if (!did) continue;
            const key = canon(it.key);
            if (fresh[key] && Number(rec.time) <= Number(fresh[key])) continue;
            keys.add(key);
            if (Array.isArray(it.parts)) {
                const set = ids.get(key) || new Set();
                for (const p of it.parts) for (const id of p.ids || []) set.add(id);
                ids.set(key, set);
            }
        }
    }
    return { keys, ids };
}

/** How much of each retiring list of a story event set is left in this chat. */
export function eventLeft(book, e) {
    const key = `${book}.${e.uid}`;
    return burnStatus(e.extensions?.ri, happened().ids.get(canon(key)) || new Set());
}

/** Bring back for this chat every item of a set that already happened. Earlier replies keep their record. */
export function unburnSet(book, e) {
    const cs = chatState();
    if (!cs) return;
    const key = canon(`${book}.${e.uid}`);
    cs.unburn = { ...(cs.unburn || {}), [key]: Date.now() };
    if (cs.usedUp) delete cs.usedUp[key];
    if (cs.burned?.ids) delete cs.burned.ids[key];
    saveChatState();
}

/** What has happened for good in this chat so far, for "New chapter" to carry into the next chat. */
export function burnedSoFar() { return happened(); }

/** What the scene and the story world offer the dice of a story event right now. */
function sceneNow(type) {
    const read = countPresent(readScene(type).present);
    const notes = plan.notes;
    const count = read || (notes ? notes.present.length + notes.missing.length : 0);
    const offers = plan.flow?.offers || { threads: [], secrets: [], plans: [] };
    return { count, ...offers };
}

/** Give a later scan of the same reply the notes the first scan chose. */
function reapply(result, args) {
    if (!result) return;
    const map = args.activated.entries;
    const sorted = Array.isArray(args.sortedEntries) ? args.sortedEntries : [];
    for (const e of [...map.values()]) { if (isManaged(e)) map.delete(keyOf(e)); }
    for (const [key, text] of result.texts) {
        const e = sorted.find(x => keyOf(x) === key && isManaged(x));
        if (!e) continue;
        e.content = text;
        map.set(key, e);
    }
}

function onScanDone(args) {
    try {
        const st = settings();
        if (!st.enabled || !gen) return;
        if (Date.now() - gen.started > 15 * 60 * 1000) { gen = null; return; } // a reply that never finished
        if (args?.state?.next) return; // more passes follow; work on the final result only
        const map = args?.activated?.entries;
        if (!(map instanceof Map)) return;
        // SillyTavern can scan twice while one reply is being written (once for real, once to count tokens).
        // The first scan decides what is sent. Any later scan gets exactly the same notes.
        if (gen.handled) { reapply(gen.result, args); return; }
        gen.handled = true;
        const cs = chatState();
        if (!cs) return;
        const sorted = Array.isArray(args.sortedEntries) ? args.sortedEntries : [];
        const fired = [...map.values()].filter(isManaged);
        const isSticky = e => plan.continuing.has(keyOf(e));
        const type = gen.type;

        if (gen.skip) {
            for (const e of fired) map.delete(keyOf(e));
            gen.result = { texts: new Map() };
            return;
        }

        const len = scanLength(type);
        const items = [];
        let states = {};
        const find = key => sorted.find(e => keyOf(e) === canon(key) && isManaged(e) && !e.disable);
        reconcile();
        // Swipe, regenerate and continue send the same instructions again. The list comes from the last scan when it
        // was for this same reply, and otherwise from the record kept on the reply itself.
        const sameReply = cs.lastScan && cs.lastScan.len === len;
        const own = type === 'continue' || (type === 'swipe' && !sameReply) ? lastRecord() : null;
        // The request for the update block and the world's own order travel as entries made for this scan.
        const askE = fired.find(isAsk) || null;
        const orderE = fired.find(isOrder) || null;
        const isRepeat = !!gen.guided || type === 'continue' || (['swipe', 'regenerate'].includes(type) && !pickAgain && (sameReply || !!own));

        if (isRepeat) {
            const source = gen.guided?.prior || own || cs.lastScan || {};
            gen.quiet = source.pace?.quiet || null;
            const before = ((!gen.guided && !own && type === 'continue') ? [] : (source.items || [])).map(it => canon(it.key) === it.key ? it : { ...it, key: canon(it.key) });
            states = Object.fromEntries(Object.entries(source.states || {}).map(([k, v]) => [canon(k), v]));
            for (const e of fired) map.delete(keyOf(e));
            for (const it of before) {
                const e = find(it.key);
                if (!e) continue;
                if (gen.guided && !gen.guided.repeatOrders && (isEvent(e) || it.worldOrder || (!it.noCheck && !('goalTask' in it)))) continue;
                if (isEvent(e) && !eventAllowed(withPreset(e.extensions?.ri, cs.presets?.[setOf(e)]), it.parts, blockedEventTags())) continue;
                let misses = it.misses || 0;
                const od = type === 'continue' ? null : cs.overdue.find(o => o.key === it.key);
                if (od) { misses = od.misses; cs.overdue = cs.overdue.filter(o => o !== od); }
                map.set(it.key, e);
                let src = it;
                if (rerollCat && rerollCat.key === it.key && Array.isArray(it.parts)) {
                    // "Pick again" for one picked item: that category gets a new pick, everything else stays.
                    const again = rerollCategory(withPreset(e.extensions?.ri, cs.presets?.[setOf(e)]), it.parts, it.event || states[it.key], rerollCat.catId, isEvent(e) ? blockedEventTags() : []);
                    if (again) {
                        src = { ...it, version: again.text, parts: again.parts, event: it.event ? again.state : it.event };
                        if (!it.event) states = { ...states, [it.key]: again.state };
                    }
                }
                items.push(makeItem(e, src.sentAs, src.version, misses, src.kind && src.kind !== 'repeat' ? src.kind : 'new', true, src));
            }
            if (askE) map.set(keyOf(askE), askE);
        } else {
            pickAgain = false;
            // Burn after it happens: an instruction marked "only once per chat" that already happened is retired.
            const was = happened();
            for (const e of [...fired]) {
                if (e.extensions?.ri?.once && !isStyle(e) && !isGoal(e) && !isNotes(e) && was.keys.has(keyOf(e))) { map.delete(keyOf(e)); fired.splice(fired.indexOf(e), 1); }
            }
            // Writing style is sent with every reply and stands apart from limits, holds and re-sends.
            const styles = fired.filter(isStyle);
            // A style item can carry three more lines while it is the pick: a sentence added to story events, a
            // question asked about the reply, and a note for the reply after it.
            const dirs = [];
            let carried = (previousRecord(type)?.items || []).flatMap(it => (it.parts || []).flatMap(p => (p.dir || []).map(d => d.next).filter(Boolean)));
            carried = [...new Set(carried)];
            for (const e of styles) {
                const key = keyOf(e);
                const ri = e.extensions.ri;
                const rolled = rollEvent(withPreset(ri, cs.presets?.[setOf(e)]), plan.events?.get(key) || null, { locks: cs.locks?.[key] });
                states[key] = rolled.state;
                const mine = rolled.parts.flatMap(p => p.dir || []);
                dirs.push(...mine);
                const note = carried.length ? `A note carried over from the style of the last reply: ${carried.join(' ')}` : '';
                carried = [];
                const text = [rolled.text, note].filter(Boolean).join(' ');
                if (!text) { map.delete(key); continue; }
                items.push(makeItem(e, ri.sentAs === 'ooc' ? 'ooc' : 'system', text, 0, 'new', false, { parts: rolled.parts, noCheck: true, ask: mine.filter(d => d.check).map(d => ({ q: d.check, pick: d.pick })) }));
            }
            const eventLine = dirs.filter(d => d.event).map(d => (/[.!?]$/.test(d.event) ? d.event : `${d.event}.`)).join(' ');
            // The line of the story phase, when the phase has one.
            const paceE = fired.find(isPace) || null;
            if (paceE) {
                if (plan.phase?.line) items.push(makeItem(paceE, 'system', `the story is in its phase "${plan.phase.name}". ${plan.phase.line}`, 0, 'new', false, { noCheck: true, pace: plan.phase.name }));
                else map.delete(keyOf(paceE));
            }
            // Story notes are facts, with nothing to carry out, so they also stand apart from limits and the check.
            const notesE = fired.find(isNotes) || null;
            if (notesE) {
                const nt = plan.notes;
                if (nt) items.push(makeItem(notesE, 'plain', nt.text, 0, 'new', false, { noCheck: true, notes: { ids: nt.ids, extra: nt.extra, present: nt.present, missing: nt.missing, place: nt.place, how: nt.how, tokens: nt.tokens } }));
                else map.delete(keyOf(notesE));
            }
            // The character goal also stands apart: the goal line goes with every reply, and it has at most one task.
            // Its order is worked out here and added below, once the cap on new things per reply is known.
            const goalE = fired.find(isGoal) || null;
            const g = goalE ? goals() : null;
            const gp = g ? goalProgress(type) : null;
            let goalOrder = g ? buildGoalOrder(g, gp) : null;
            // Dice, rolled in code. Like the writing style they are sent with every reply and are not a new thing.
            const diceE = fired.find(isDice) || null;
            if (diceE) {
                const r = rollDice();
                if (r) items.push(makeItem(diceE, 'system', r.text, 0, 'new', false, { noCheck: true, dice: r.rolls, ask: [{ q: DICE_QUESTION, pick: 'Dice' }] }));
                else map.delete(keyOf(diceE));
            }
            const orders = fired.filter(e => !isStyle(e) && !isGoal(e) && !isNotes(e) && !isAsk(e) && !isOrder(e) && !isPace(e) && !isDice(e));
            const continuing = orders.filter(isSticky);
            let fresh = orders.filter(e => !isSticky(e));
            const overdue = cs.overdue.filter(o => find(o.key));

            // Hold back new instructions while one is overdue, or apply each set's per-reply limit.
            let held = [];
            // Quiet after a big event: for a set number of replies nothing new starts. What is under way carries on.
            const quiet = quietNow(type);
            if (quiet) gen.quiet = quiet;
            if (quiet || (overdue.length && st.check.holdNew)) {
                held = fresh;
            } else {
                for (const set of new Set(fresh.map(setOf))) {
                    held.push(...applyLimit(set, fresh.filter(e => setOf(e) === set), continuing.filter(e => setOf(e) === set)));
                }
            }
            for (const e of held) map.delete(keyOf(e));
            fresh = fresh.filter(e => !held.includes(e));

            // The story world's own order (a thread comes to a head, a planted detail matters) is one more new thing.
            const orderKey = orderE ? keyOf(orderE) : '';
            let worldNew = !!(orderE && plan.flow?.order && !quiet && !overdue.some(o => o.key === orderKey) && !(overdue.length && st.check.holdNew));
            if (quiet && goalOrder?.task && !goalOrder.misses) goalOrder = buildGoalOrder(g, gp, { noNewTask: true });

            // One thing per reply: across every set and the goal, at most this many new things start in one reply.
            // Something already under way (kept for more replies, or sent again) uses up the room first.
            const cap = Math.max(0, Math.round(Number(st.perReply) || 0));
            if (cap > 0) {
                const goalAgain = !!(goalOrder?.task && goalOrder.misses > 0);
                const goalNew = !!(goalOrder?.task && !goalOrder.misses);
                const room = Math.max(0, cap - continuing.length - overdue.length - (goalAgain ? 1 : 0));
                const tickets = [...fresh.map(e => ({ e })), ...(goalNew ? [{ goal: true }] : []), ...(worldNew ? [{ world: true }] : [])];
                const winners = pickWeighted(tickets, () => 1, room);
                if (worldNew && !winners.some(w => w.world)) worldNew = false;
                const waiting = fresh.filter(e => !winners.some(w => w.e === e));
                for (const e of waiting) map.delete(keyOf(e));
                fresh = fresh.filter(e => !waiting.includes(e));
                if (goalNew && !winners.some(w => w.goal)) goalOrder = buildGoalOrder(g, gp, { noNewTask: true });
            }
            if (goalE) {
                if (!goalOrder) map.delete(keyOf(goalE));
                else items.push(makeItem(goalE, 'system', goalOrder.version, goalOrder.misses, 'new', false, { noCheck: goalOrder.noCheck, goalTask: goalOrder.task, checkText: goalOrder.checkText }));
            }

            if (orderE) {
                if (worldNew) items.push(makeItem(orderE, 'system', [plan.flow.order.text, plan.flow.order.effect?.silent ? '' : eventLine].filter(Boolean).join(' '), 0, 'new', false, { worldOrder: plan.flow.order.effect, big: plan.flow.order.effect?.kind === 'thread' }));
                else if (!overdue.some(o => o.key === orderKey)) map.delete(orderKey);
            }

            // Send overdue instructions again, ahead of new ones.
            const resent = new Set();
            for (const od of overdue) {
                const e = find(od.key);
                map.set(od.key, e);
                resent.add(od.key);
                items.push(makeItem(e, od.sentAs, od.version, od.misses, 'resend', false, od));
            }
            cs.overdue = [];

            for (const e of [...continuing, ...fresh]) {
                const key = keyOf(e);
                if (resent.has(key)) continue;
                if (isEvent(e)) {
                    // A story event: an event that keeps sending repeats its text; a new one rolls the dice.
                    const ri = e.extensions.ri;
                    const sentAs = ri.sentAs === 'ooc' ? 'ooc' : 'system';
                    const keptText = continuing.includes(e) ? plan.continuing.get(key) : null;
                    const prev = plan.events?.get(key) || null;
                    if (keptText) { items.push(makeItem(e, sentAs, keptText, 0, 'continuing', false, { event: prev, parts: null })); continue; }
                    const rolled = rollEvent(withPreset(ri, cs.presets?.[setOf(e)]), prev, { locks: cs.locks?.[key], burned: was.ids.get(key), scene: sceneNow(type), blockedTags: blockedEventTags() });
                    if (!rolled) {
                        map.delete(key);
                        // Tell the user once per chat when a set's main list is used up.
                        const bs = burnStatus(withPreset(ri, cs.presets?.[setOf(e)]), was.ids.get(key));
                        if (bs.usedUp) {
                            if (!cs.usedUp) cs.usedUp = {};
                            if (!cs.usedUp[key]) { cs.usedUp[key] = Date.now(); gen.usedUp = [...(gen.usedUp || []), setName(setOf(e))]; }
                        }
                        continue;
                    }
                    items.push(makeItem(e, sentAs, [rolled.text, eventLine].filter(Boolean).join(' '), 0, 'new', false, { event: rolled.state, parts: rolled.parts, big: !!ri.big }));
                    continue;
                }
                const { sentAs, versions } = versionsOf(e);
                if (!versions.length) { map.delete(key); continue; }
                const kept = continuing.includes(e) ? plan.continuing.get(key) : null;
                const version = kept && versions.includes(kept) ? kept : pickVersion(cs, key, versions);
                items.push(makeItem(e, sentAs, version, 0, continuing.includes(e) ? 'continuing' : 'new'));
            }
        }

        sayUserLineOnce(items);
        gen.result = { texts: new Map(items.map(it => [it.key, it.text])) };
        if (askE && map.has(keyOf(askE))) gen.result.texts.set(keyOf(askE), askE.content);
        const pace = { phase: plan.phase ? { name: plan.phase.name, chance: plan.phase.chance } : null, quiet: gen.quiet || null };
        cs.lastScan = { len, states, pace, items: items.map(it => ({ key: it.key, sentAs: it.sentAs, version: it.version, misses: it.misses, kind: it.kind, event: it.event, parts: it.parts, noCheck: it.noCheck, notes: it.notes, worldOrder: it.worldOrder, big: it.big, pace: it.pace, ask: it.ask, dice: it.dice, ...('goalTask' in it ? { goalTask: it.goalTask, checkText: it.checkText } : {}) })) };
        if (gen.guided) { gen.guided.afterLastScan = structuredClone(cs.lastScan); gen.guided.afterOverdue = structuredClone(cs.overdue); }
        pending = { items, type, states, pace, usedUp: gen.usedUp || null, guided: gen.guided ? { direction: gen.guided.direction, repeatOrders: gen.guided.repeatOrders } : null };
        if (gen.usedUp) toast('info', `Used up in this chat: ${gen.usedUp.map(n => `"${n}"`).join(', ')}. Every item of its main list has happened, so it sends no more events here. To use it again in this chat, open the Random Story Events tab and press "Bring the used items back".`);
        rerollCat = null;
        saveChatState();
    } catch (e) { console.error(LOG, 'scan-done', e); }
}

// ---------- after the reply: keep the record, check that it happened ----------

const SENT_BLOCK = /\s*<sent_instructions>[\s\S]*?<\/sent_instructions>/g;
export const stripSentBlock = text => String(text ?? '').replace(SENT_BLOCK, '');

function attach(message, rec) {
    if (!message.extra || typeof message.extra !== 'object') message.extra = {};
    message.extra[KEY] = rec;
    const info = Array.isArray(message.swipe_info) ? message.swipe_info[message.swipe_id] : null;
    if (info) {
        if (!info.extra || typeof info.extra !== 'object') info.extra = {};
        info.extra[KEY] = rec;
    }
}

/** The character profile cards and the roast of a reply. Who a person is comes from the reply, or else from an earlier card in this chat. */
function keepCards(rec, parsed, earlier, id) {
    const profiles = (parsed.profiles || []).map(p => ({ name: p.name, now: { ...p.now }, stable: { ...p.stable } }));
    for (const p of profiles) {
        const kept = keptProfile(p.name, id);
        if (kept) for (const [k] of PROFILE_STABLE) if (!p.stable[k] && kept[k]) p.stable[k] = kept[k];
    }
    // A continued reply keeps the cards of its first part unless the new part wrote its own.
    if (profiles.length) rec.profiles = profiles; else if (earlier?.profiles) rec.profiles = earlier.profiles;
    const roast = parsed.roast || '';
    if (roast) rec.roast = roast; else if (earlier?.roast) rec.roast = earlier.roast;
}

function onMessageReceived(id, type) {
    try {
        // The update block is taken out of the reply first, so it is never shown, checked or sent back.
        const parsed = settings().enabled ? liftBlock(id) : { found: false, ops: [], ended: false, block: '' };
        if (!pending || type === 'first_message') return;
        const m = ctx().chat?.[id];
        if (!m || m.is_user || m.is_system) return;
        // A continued reply keeps the time of its record, so what its first part filed in the story world still belongs to it.
        const earlier = pending.type === 'continue' ? m.extra?.[KEY] || null : null;
        const rec = { v: 1, items: pending.items, type: pending.type, time: earlier?.time || Date.now(), agency: null, checking: false, note: '' };
        if (pending.states && Object.keys(pending.states).length) rec.states = pending.states;
        if (pending.pace && (pending.pace.phase || pending.pace.quiet)) rec.pace = pending.pace;
        if (pending.usedUp) rec.usedUp = pending.usedUp;
        if (pending.guided) { rec.guided = pending.guided; if (guided) guided.completed = true; }
        // Who is present, where and when, from the reply's own block. A continued reply keeps what its first part said.
        const previousScene = [...(ctx().chat || []).slice(0, id)].reverse().find(x => x?.extra?.[KEY]?.scene && !x.extra[KEY].stateStale)?.extra?.[KEY]?.scene || {};
        const scene = { ...(earlier?.scene || {}), ...(parsed.scene || {}) };
        if (!parsed.ended && scene.environment === undefined && (!scene.where || scene.where === previousScene.where)) scene.environment = previousScene.environment || '';
        if (Object.keys(scene).length) rec.scene = scene;
        keepCards(rec, parsed, earlier, id);
        rec.stateChanges = [...(earlier?.stateChanges || []), ...changesFromProfiles(parsed.profiles)];
        if (earlier?.stateEdits) rec.stateEdits = earlier.stateEdits;
        pending = null;
        // A reply that carried nothing still gets an (empty) record, so a later swipe knows to send nothing again.
        attach(m, rec);
        // File what the reply established in the story world. With checking off, a world order counts as done when sent.
        if (earlier) rec.update = earlier.update;
        afterReply(id, rec, parsed, history('normal').next - 1, () => changed('checked', id));
        if (settings().check.mode === 'off') for (const it of rec.items) if (it.worldOrder) applyEffect(rec, it.worldOrder, () => changed('checked', id));
        // The story so far: a chapter is written in the background when a scene ended or enough replies went by.
        chapterAfterReply(rec.time, history('normal').next - 1, () => changed('messages'));
        if (!rec.items.length) { try { ctx().saveChat?.(); } catch { /* saved with the next change */ } changed('sent', id); return; }
        for (const it of rec.items) {
            const tags = (it.parts || []).flatMap(p => p.rules || []);
            if (tags.length) it.rules = checkRules(stripSentBlock(m.mes), tags);
        }
        if (rec.items.every(it => it.noCheck)) { try { ctx().saveChat?.(); } catch { /* saved with the next change */ } changed('sent', id); return; }
        try { ctx().saveChat?.(); } catch { /* saved with the next change */ }
        changed('sent', id);
        const run = runCheck(id).catch(e => { console.warn(LOG, 'check failed', e); return null; });
        checkPromise = run;
        run.then((regen) => {
            if (checkPromise === run) checkPromise = null;
            if (regen) autoRegenerate(regen).catch(e => console.warn(LOG, 'new reply failed', e));
        });
    } catch (e) { console.error(LOG, 'message-received', e); }
}

const norm = s => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function quoteFound(reply, quote) {
    const q = norm(quote);
    if (q.split(' ').filter(Boolean).length < 2) return false;
    const r = norm(reply);
    if (r.includes(q)) return true;
    // A quote with "..." in the middle: every part must be in the reply.
    const parts = String(quote).split(/\.{3,}|…/).map(norm).filter(p => p.split(' ').length >= 2);
    return parts.length > 1 && parts.every(p => r.includes(p));
}

function queueResend(cs, it, misses, from) {
    it.resend = misses;
    const key = canon(it.key);
    cs.overdue = cs.overdue.filter(o => o.key !== key);
    cs.overdue.push({ key, world: it.world, uid: it.uid, name: it.name, sentAs: it.sentAs, version: it.version, misses, from, event: it.event, parts: it.parts, worldOrder: it.worldOrder, big: it.big });
}

function markMissed(cs, it, from) {
    const st = settings();
    if (keepsGoing(it.key)) { it.status = 'continuing'; return false; }
    if ((it.misses || 0) >= st.check.maxResend) { it.status = 'missed'; return false; }
    queueResend(cs, it, (it.misses || 0) + 1, from);
    it.status = 'overdue';
    return true;
}

async function runCheck(id) {
    const st = settings();
    const c = ctx();
    const chatId = c.getCurrentChatId();
    const m = c.chat?.[id];
    const rec = m?.extra?.[KEY];
    if (!rec) return;
    const stale = () => ctx().getCurrentChatId() !== chatId || ctx().chat?.[id]?.extra?.[KEY] !== rec;
    const finish = () => {
        rec.checking = false;
        if (st.showUnder === 'saved') writeIntoMessage(id);
        try { ctx().saveChat?.(); } catch { /* saved with the next change */ }
        saveChatState();
        changed('checked', id);
    };
    if (st.check.mode === 'off') { finish(); return; }

    rec.checking = true;
    changed('sent', id);
    const reply = stripSentBlock(m.mes);
    const n = names();
    const lines = rec.items.map((it, i) => it.noCheck ? null : `ID a${i + 1}: ${sub(toStore(it.checkText || it.version))}`).filter(Boolean);
    if (!lines.length) { finish(); return; }
    // Questions that the current writing style asks about the reply ride along with a check that runs anyway.
    const asks = rec.items.flatMap(it => it.ask || []);
    asks.forEach((a, i) => lines.push(`ID q${i + 1}: The answer to this question about the reply is yes: ${a.q}`));
    if (st.check.agency !== 'off') lines.push(`ID user: The reply writes spoken words, actions, decisions, thoughts or feelings for ${n.user}.`);
    const user = [
        'Below is one reply from a roleplay and a list of instructions that were given for that reply. Decide for each instruction whether the reply carried it out.',
        '', 'REPLY:', '"""', reply, '"""', '', 'INSTRUCTIONS:', ...lines, '',
        'Answer with only a JSON list, one object per ID, in this form:',
        '[{"id": "a1", "done": true, "quote": "words copied exactly from the REPLY that show it happened"}]',
        'Rules: "quote" is 3 to 25 words copied exactly from the REPLY. When an instruction was not carried out, use "done": false and "quote": "".',
    ].join('\n');

    let results = null;
    try {
        const res = await request({ what: 'Check that it happened', system: 'You check whether instructions were carried out in a roleplay reply. You answer with JSON only.', user, tokens: 500, profileId: st.profileId });
        results = parseJson(res.text);
        if (Array.isArray(results)) {
            const asked = results.filter(r => r && typeof r === 'object' && /^a\d+$/.test(String(r.id)));
            res.note(`The AI marked ${asked.filter(r => r.done).length} of ${asked.length} ${asked.length === 1 ? 'instruction' : 'instructions'} as done. One is only counted when its quote is found in the reply.`, true);
        }
        else res.note('The answer could not be read as a list, so nothing was marked.', false);
    } catch (e) {
        rec.note = `The check could not run: ${e?.message || e}`;
    }
    if (stale()) return;
    const cs = chatState();
    if (!Array.isArray(results) || !cs) {
        if (!rec.note) rec.note = 'The check gave no usable answer, so nothing was marked.';
        finish();
        return;
    }
    rec.note = '';
    const byId = new Map(results.filter(r => r && typeof r === 'object').map(r => [String(r.id), r]));
    let anyOverdue = false;
    rec.items.forEach((it, i) => {
        const r = byId.get(`a${i + 1}`);
        if (!r) return;
        if (r.done === true && quoteFound(reply, r.quote)) {
            it.status = 'done'; it.quote = String(r.quote).trim();
            if (it.worldOrder) applyEffect(rec, it.worldOrder, () => changed('checked', id));
            cs.overdue = cs.overdue.filter(o => !(o.key === canon(it.key) && (!o.from || o.from === rec.time)));
        } else if ('goalTask' in it) {
            // A one-time step of the character goal: it is sent again with every reply until it happens.
            it.quote = ''; it.status = 'pending';
        } else { it.quote = ''; if (markMissed(cs, it, rec.time)) anyOverdue = true; }
    });
    if (rec.items.some(it => it.goalTask && it.status === 'done') && advanceIfDone()) toast('success', 'The goal is done. The next goal from your list has started.');
    if (asks.length) rec.asked = asks.map((a, i) => { const r = byId.get(`q${i + 1}`); return { q: a.q, pick: a.pick, yes: !r ? null : r.done === true, quote: r && r.done === true && quoteFound(reply, r.quote) ? String(r.quote).trim() : '' }; });
    const u = byId.get('user');
    rec.agency = u && u.done === true && quoteFound(reply, u.quote) ? { quote: String(u.quote).trim() } : null;
    finish();

    // Optional: regenerate right away, once per reply.
    const wantRegen = (anyOverdue && st.check.regenOnMiss) || (rec.agency && st.check.agency === 'regen');
    if (!wantRegen || !cs.lastScan || cs.autoRegenLen === cs.lastScan.len) return null;
    return { id, rec, chatId, missed: anyOverdue };
}

/** Optional: write a new reply right away, once per reply. Runs after the check has fully finished. */
async function autoRegenerate({ id, rec, chatId, missed }) {
    // The check can finish while SillyTavern is still closing the reply. Wait for it, then make sure nothing moved on.
    for (let waited = 0; isGenerating() && waited < 15000; waited += 200) await new Promise(r => setTimeout(r, 200));
    const c = ctx();
    const cs = chatState();
    if (!cs || isGenerating() || c.getCurrentChatId() !== chatId || id !== (c.chat || []).length - 1 || c.chat[id]?.extra?.[KEY] !== rec) return;
    cs.autoRegenLen = cs.lastScan?.len;
    saveChatState();
    toast('info', missed ? 'An instruction did not happen. Writing a new reply.' : 'The reply wrote for you. Writing a new reply.');
    await triggerSwipe();
}

// ---------- "Saved in the message" display mode ----------

const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

export function statusLabel(it) {
    if ('goalTask' in it && it.noCheck) return it.goalTask?.type === 'action' ? 'Sent (repeatable actions are not checked)' : it.goalTask ? 'Sent (not checked)' : 'Sent (goal line)';
    if (it.notes) return 'Sent (story notes are facts, with nothing to check)';
    if (it.pace) return 'Sent (the line of the story phase)';
    if (it.dice) return 'Sent (dice results, to be used only for an attempt with real stakes)';
    if (it.noCheck) return 'Sent (writing style is not checked)';
    switch (it.status) {
        case 'pending': return 'Not yet: it is sent again with the next reply';
        case 'done': return 'Done';
        case 'overdue': return `Overdue ${Math.min((it.misses || 0) + 1, 9)}: will be sent again`;
        case 'missed': return 'Missed: stopped sending';
        case 'continuing': return 'Not yet: still being sent';
        case 'queued': return 'Will be sent again';
        default: return 'Sent';
    }
}

function writeIntoMessage(id) {
    const c = ctx();
    const m = c.chat?.[id];
    const rec = m?.extra?.[KEY];
    if (!m || !rec?.items?.length) return;
    const rows = rec.items.map(it => `<li><b>${esc(statusLabel(it))}.</b> ${esc(it.text)}${it.quote ? ` <i>Shown by: "${esc(it.quote)}"</i>` : ''}</li>`).join('');
    const block = `\n\n<sent_instructions><details><summary>What was sent with this reply (${rec.items.length})</summary><ul>${rows}</ul></details></sent_instructions>`;
    m.mes = stripSentBlock(m.mes) + block;
    if (Array.isArray(m.swipes) && typeof m.swipe_id === 'number' && m.swipes[m.swipe_id] !== undefined) m.swipes[m.swipe_id] = m.mes;
    try { c.updateMessageBlock?.(id, m); } catch { /* shown on the next redraw */ }
}

function onPromptReady(data) {
    try {
        if (!Array.isArray(data?.chat)) return;
        if (!data.dryRun && !isOwnPrompt(data.chat)) notePromptSent(data.chat);
        for (const msg of data.chat) {
            // An update block that was left in an older reply is kept out of the prompt. The request itself shows the form, so only replies are cleaned.
            if (msg.role === 'assistant' && typeof msg.content === 'string' && msg.content.includes('<story_update')) msg.content = stripUpdateBlock(msg.content);
            if (typeof msg.content === 'string' && msg.content.includes('<sent_instructions>')) msg.content = stripSentBlock(msg.content);
            else if (Array.isArray(msg.content)) for (const part of msg.content) if (typeof part?.text === 'string' && part.text.includes('<sent_instructions>')) part.text = stripSentBlock(part.text);
        }
    } catch (e) { console.error(LOG, 'prompt-ready', e); }
}

const REGEX_ID = 'roleplay-instructions-hide-sent';

/** A SillyTavern regex script that keeps the saved "what was sent" section out of prompts even if this extension is removed. */
export function ensureRegexScript() {
    const root = ctx().extensionSettings;
    if (!Array.isArray(root.regex)) root.regex = [];
    if (root.regex.some(s => s?.id === REGEX_ID)) return false;
    root.regex.push({
        id: REGEX_ID,
        scriptName: 'Roleplay Instructions: keep "what was sent" out of prompts',
        findRegex: '/\\s*<sent_instructions>[\\s\\S]*?<\\/sent_instructions>/g',
        replaceString: '', trimStrings: [], placement: [2], disabled: false, markdownOnly: false, promptOnly: true,
        runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: null,
    });
    saveSettings();
    return true;
}

// ---------- actions from the What Was Sent tab ----------

/** Recent replies that carried instructions, newest first. */
export function recentRecords(limit = 30) {
    const chat = ctx().chat || [];
    const out = [];
    for (let i = chat.length - 1; i >= 0 && out.length < limit; i--) {
        const rec = chat[i]?.extra?.[KEY];
        if (rec?.items?.length || shownChanges(rec?.update?.changes).length || rec?.pace?.quiet) out.push({ id: i, rec, isLast: i === chat.length - 1, name: chat[i].name });
    }
    return out;
}

function touch(id) {
    try { ctx().saveChat?.(); } catch { /* saved with the next change */ }
    saveChatState();
    changed('checked', id);
}

export function sendAgain(id, index) {
    const cs = chatState();
    const it = ctx().chat?.[id]?.extra?.[KEY]?.items?.[index];
    if (!cs || !it) return;
    queueResend(cs, it, it.status === 'done' ? 0 : Math.min(2, (it.misses || 0) + 1), ctx().chat[id].extra[KEY].time);
    it.status = 'queued';
    touch(id);
}

export function undoDone(id, index) {
    const cs = chatState();
    const it = ctx().chat?.[id]?.extra?.[KEY]?.items?.[index];
    if (!cs || !it) return;
    it.quote = '';
    it.status = 'sent';
    markMissed(cs, it, ctx().chat[id].extra[KEY].time);
    touch(id);
}

export function cancelResend(id, index) {
    const cs = chatState();
    const it = ctx().chat?.[id]?.extra?.[KEY]?.items?.[index];
    if (!cs || !it) return;
    cs.overdue = cs.overdue.filter(o => o.key !== canon(it.key));
    it.status = 'sent';
    touch(id);
}

/** Check a reply again, for example after you edited it. */
export function checkAgain(id) {
    const rec = ctx().chat?.[id]?.extra?.[KEY];
    if (!rec?.items?.length || rec.checking || settings().check.mode === 'off') return;
    const run = runCheck(id).catch(e => { console.warn(LOG, 'check failed', e); return null; });
    checkPromise = run;
    run.then(() => { if (checkPromise === run) checkPromise = null; });
}

/** Stop everything that is waiting to be sent again. */
export function clearQueue() {
    const cs = chatState();
    if (!cs) return;
    const keys = new Set(cs.overdue.map(o => o.key));
    cs.overdue = [];
    for (const m of ctx().chat || []) for (const it of m.extra?.[KEY]?.items || []) if (keys.has(canon(it.key)) && ['overdue', 'queued'].includes(it.status)) it.status = 'sent';
    touch(-1);
}

/** Pick again for one picked item of the newest reply, and write a new reply. */
export async function rerollPartNow(key, catId) {
    if (isGenerating()) { toast('info', 'Wait for the current reply to finish.'); return; }
    rerollCat = { key: canon(key), catId };
    await triggerSwipe();
}

/** Lock one category's pick for this chat, or unlock it (ids = null). */
export function setLock(key, catId, ids) {
    const cs = chatState();
    if (!cs) return;
    key = canon(key);
    if (ids && ids.length) { cs.locks[key] = { ...(cs.locks[key] || {}), [catId]: [...ids] }; }
    else if (cs.locks[key]) { delete cs.locks[key][catId]; if (!Object.keys(cs.locks[key]).length) delete cs.locks[key]; }
    saveChatState();
    changed('checked', -1);
}

export function isLocked(key, catId) {
    return !!chatState()?.locks?.[canon(key)]?.[catId];
}

/** True only while a guided swipe is being prepared or generated. */
export const guidedSwipeActive = () => !!guided || guidedPreparing;

async function cancelGuided(attempt) {
    if (!attempt) return;
    const restored = await restoreGuidedSwipe(attempt.tx);
    if (!restored || String(ctx().getCurrentChatId?.() || '') !== attempt.chatId) return;
    const cs = chatState();
    if (!cs) return;
    if (attempt.afterLastScan && JSON.stringify(cs.lastScan) === JSON.stringify(attempt.afterLastScan)) cs.lastScan = attempt.beforeLastScan;
    if (attempt.afterOverdue && JSON.stringify(cs.overdue) === JSON.stringify(attempt.afterOverdue)) cs.overdue = attempt.beforeOverdue;
    saveChatState();
}

/** Guide one newly generated swipe of the latest character reply. */
export async function guideSwipe(direction, { repeatOrders = false, keepManualEdits = false } = {}) {
    const c = ctx(), chat = c.chat || [], id = chat.length - 1, m = chat[id];
    const value = String(direction || '').trim();
    if (!settings().enabled) throw new Error('Turn the extension on first.');
    if (!value || value.length > 2000) throw new Error('Enter a direction of at most 2,000 characters.');
    if (guided || guidedPreparing || isGenerating()) throw new Error('Wait for the current generation to finish.');
    if (!m || m.is_user || m.is_system || !m.extra?.[KEY]) throw new Error('A recorded character reply must be the latest message.');
    if (Array.isArray(m.swipes) && Number(m.swipe_id || 0) < m.swipes.length - 1) throw new Error('Move to the newest existing swipe first, then use Guide a swipe.');
    const anchors = new Set([m.extra[KEY].time ? `record:${m.extra[KEY].time}` : '', m.send_date ? `message:${m.send_date}` : '']);
    const meta = c.chatMetadata?.[KEY] || {};
    if ([...Object.values(meta.stateOverrides || {}), ...Object.values(meta.sceneOverrides || {})].some(x => !x?.anchor || anchors.has(x.anchor))) throw new Error('A protected state or scene correction was made on this reply. Review or unlock it in Current State before replacing the reply; include any desired correction in the direction.');
    if (!keepManualEdits && (meta.manualWorldChanges || []).some(x => x?.anchor && anchors.has(x.anchor))) throw new Error('The story world was manually edited after this reply. Review those edits, then select “Keep my manual world edits” if you want them to remain.');
    const chatId = String(c.getCurrentChatId?.() || ''), selectedTime = m.extra[KEY].time;
    guidedPreparing = true;
    let tx;
    try {
        await worldIdle();
        tx = await prepareGuidedSwipe(id);
        if (String(ctx().getCurrentChatId?.() || '') !== chatId || ctx().chat?.[id]?.extra?.[KEY]?.time !== selectedTime) { await restoreGuidedSwipe(tx); throw new Error('The chat changed. Try again on the intended reply.'); }
        const cs = chatState();
        pickAgain = false; rerollCat = null;
        guided = { direction: value, repeatOrders: !!repeatOrders, prior: structuredClone(m.extra[KEY]), tx, chatId, started: false, completed: false, beforeLastScan: structuredClone(cs?.lastScan), beforeOverdue: structuredClone(cs?.overdue || []) };
    } finally { guidedPreparing = false; }
    try {
        const ok = await triggerSwipe();
        if (!ok) throw new Error('Could not start the swipe.');
        if (guided && !guided.started) {
            const attempt = guided;
            setTimeout(() => { if (guided === attempt && !attempt.started) { guided = null; cancelGuided(attempt).catch(e => console.warn(LOG, 'restore guided swipe', e)); toast('warning', 'The swipe did not start. The extension is restoring the earlier world state.'); } }, 10000);
        }
    } catch (e) { const attempt = guided; guided = null; if (attempt) await cancelGuided(attempt); throw e; }
}

export async function pickAgainNow() {
    if (isGenerating()) { toast('info', 'Wait for the current reply to finish.'); return; }
    pickAgain = true;
    await triggerSwipe();
}

export function overdueList() {
    return chatState()?.overdue || [];
}

// ---------- wiring ----------

export function init() {
    const missing = ['WORLDINFO_ENTRIES_LOADED', 'WORLDINFO_SCAN_DONE'].filter(n => !on(n, n === 'WORLDINFO_SCAN_DONE' ? onScanDone : onEntriesLoaded));
    on('GENERATION_STARTED', (type, opts, dryRun) => {
        // A dry run (SillyTavern counting tokens for its prompt list) can start while a real reply is being written.
        // It must leave the state of the real reply alone, so only real generations are tracked.
        if (dryRun) return;
        if (guided && type === 'swipe' && guided.chatId === String(ctx().getCurrentChatId?.() || '')) guided.started = true;
        gen = { guided: guided?.started ? guided : null, type: String(type || 'normal'), dryRun: false, skip: type === 'impersonate' || type === 'quiet' || !!opts?.quiet_prompt, handled: false, result: null, started: Date.now() };
        if (!gen.skip) pending = null;
    });
    on('GENERATION_AFTER_COMMANDS', async (_type, _opts, dryRun) => {
        if (dryRun || !settings().enabled || !checkPromise) return;
        // Let a running check finish first, so an instruction that did not happen can be sent again with this reply.
        await Promise.race([checkPromise, new Promise(r => setTimeout(r, 20000))]);
    });
    on('MESSAGE_RECEIVED', onMessageReceived);
    on('GENERATION_ENDED', () => { const attempt = guided; gen = null; guided = null; if (attempt && !attempt.completed) { pending = null; cancelGuided(attempt).catch(e => console.warn(LOG, 'restore guided swipe', e)); } });
    on('GENERATION_STOPPED', () => { const attempt = guided; guided = null; gen = null; pending = null; pickAgain = false; rerollCat = null; if (attempt && !attempt.completed) { pending = null; cancelGuided(attempt).catch(e => console.warn(LOG, 'restore guided swipe', e)); } });
    on('CHAT_COMPLETION_PROMPT_READY', onPromptReady);
    on('CHAT_CHANGED', () => {
        const attempt = guided; guided = null; if (attempt && !attempt.completed) { pending = null; cancelGuided(attempt).catch(e => console.warn(LOG, 'restore guided swipe', e)); }
        gen = null; pending = null; pickAgain = false; checkPromise = null;
        rawByKey.clear();
        if (isChatOpen()) { applyPronouns(); if (settings().enabled) { reconcile(); syncWorld(); } }
        changed('chat');
        // Former keys of moved sets are read in the background, then this chat's state is brought in line.
        if (isChatOpen() && settings().enabled) refreshAliases().then(() => { const cs = chatState(); if (cs) { syncChat(cs); reconcile(); changed('messages'); } }).catch(e => console.warn(LOG, 'aliases', e));
    });
    for (const name of ['MESSAGE_SWIPED', 'MESSAGE_UPDATED']) on(name, () => changed('messages'));
    // What a reply changed in the story world is undone when that reply is swiped away or deleted.
    on('MESSAGE_SWIPED', () => { if (settings().enabled && !guided) syncWorld(() => changed('messages')); });
    on('MESSAGE_DELETED', () => { if (settings().enabled) { reanchorRemovedCorrections(); reconcile(); syncWorld(() => changed('messages')); } changed('messages'); });
    on('MESSAGE_EDITED', (id) => {
        // Editing the newest reply by hand can make an instruction happen, or remove it. Check that reply again.
        id = Number(id);
        if (settings().enabled && ctx().chat?.[id] && !ctx().chat[id].is_user) invalidateAfterEdit(id, () => { toast('warning', 'The edited reply and later story state need review. Open Current State to review or rebuild them.'); changed('messages'); });
        if (settings().enabled && id === (ctx().chat || []).length - 1 && !isGenerating()) checkAgain(id);
        changed('messages');
    });
    return missing;
}
