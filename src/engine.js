import { correctedLoreEntry, characterCorrectionFields, replaceUnique, storyCorrectionPrompt } from './correction-rules.js';
import { rememberStoryTimeline, refreshAfterReplyEdit, refreshAfterDeletion, flushStoryDeletion, refreshAfterChatOpen } from './story-refresh.js';
import { beginBookTriggers, bookTriggerSource, scopedBookEntry, scopedTriggerTexts } from './book-triggers.js';
import { streamUpdate } from './stream-update.js';
import { filterExcludedBooks, observeHostBooks } from './chat-books.js';
import { memoryOnly, memoryComponents } from './components.js';
import { proseDialogue } from './dialogue.js';
import { separateReply, hasReplyScaffolding, trimPartialReplyTag } from './reply-format.js';
import { replyProgress, showReplyProgress, clearReplyProgress, setReplyPreview, setReplySections } from './reply-progress.js';
import { enabledV10, pairedPreset, effectiveModules, prepareTurn, rowsForWorld, addConfiguredBooks, loreReceipt, prefs, resolveCheck, replyDiagnostics, ensureWorld, registerSpeakers, recordMap, portrayalSources, extractUpdate, baseWorld } from './v10.js';
import { captureContext } from './context-budget.js';
import { promptText } from './prompts.js';
import { changesFromProfiles, normalizeScene, sceneFromReplyHeader, sceneAt, statePrompt, blockedEventTags, reanchorRemovedCorrections } from './state.js';
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
import { buildSceneAsk, cardsOn, PROFILE_STABLE, keptProfile, parseUpdate } from './worldflow.js';
import { ASK_WORLD, ORDER_WORLD, PACE_WORLD, DICE_WORLD, isAsk, isOrder, isPace, isDice, askEntry, orderEntry, paceEntry, diceEntry, isOocTurn, prepareWorld, liftBlock, afterReply, applyEffect, syncWorld, undoForSwipe, prepareGuidedSwipe, restoreGuidedSwipe, acceptGuidedSwipe, worldIdle, stripUpdateBlock } from './worldflow.js';
import { GOAL_WORLD, isGoal, goals, goalEntry, goalProgress, goalDone, buildGoalOrder, advanceIfDone } from './goals.js';
import { USER_LINE, parseContent, readInstruction, wrapText, toStore, setOptions, setInfo, setName, setOfEntry, canonSet, pickWeighted, rollInt, SENT_AS, stickyToKeep, cooldownToWait, delayToReplyNumber } from './books.js';

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

async function loadMemory(lore, arrays) {
    // Keep native World Info entries. Suppress managed instructions even if their books are also indexed by the host.
    for (const list of arrays) for (let i=list.length-1;i>=0;i--) if (isManaged(list[i])) list.splice(i,1);
    if (!Array.isArray(lore.chatLore) || gen?.skip) return;
    const turn = gen;
    const type = turn?.type || 'normal';
    const components = memoryComponents();
    if (turn && ['swipe','regenerate'].includes(type)) undoForSwipe();
    await worldIdle();
    await addConfiguredBooks(lore,arrays,{}, {}, {base:components.world,guidelines:false,reference:components.world,type});
    filterExcludedBooks(arrays);
    for (const entries of arrays) for (let index=0;index<entries.length;index++) entries[index] = correctedLoreEntry(entries[index]);
    const flow = await prepareWorld(type,0,{memory:true,components});
    const notes = [components.world && storyCorrectionPrompt(),flow?.notes?.text].filter(Boolean).join('\n');
    if (notes) {
        lore.chatLore.push(notesEntry(notes));
    }
    if (turn) turn.memoryFlow = notes ? {...flow,notes:{...flow?.notes,text:notes}} : flow;
}

async function onEntriesLoaded(lore) {
    try {
        const st = settings();
        if (!st.enabled || !lore) return;
        beginBookTriggers();
        const arrays = [lore.globalLore, lore.characterLore, lore.chatLore, lore.personaLore].filter(Array.isArray);
        observeHostBooks(lore);
        if (gen?.memory ?? memoryOnly()) { await loadMemory(lore,arrays); return; }
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
            // Native book attachments must respect the per-chat switch for managed sets.
            // Entries of a story world never go out one by one: this chat's world is sent as one block of story notes.
            for (const arr of arrays) {
                for (let i = arr.length - 1; i >= 0; i--) {
                    const id = setOfEntry(arr[i]);
                    if (!id) continue;
                    const info = setInfo(id);
                    if (info.kind === 'world' || !active.has(id)) arr.splice(i, 1);
                }
            }
        }
        const native = !!cs && enabledV10();
        const quiet = !!(gen && !gen.dryRun && gen.skip);
        if (native && gen && !gen.handled && !quiet && !isOocTurn() && !replyProgress()) {
            const chat = ctx().chat || [];
            const replaces = ['swipe','regenerate','continue'].includes(gen.type) && !chat.at(-1)?.is_user;
            showReplyProgress(gen,'context',replaces ? chat.length-1 : chat.length);
        }
        // The story world: its notes, the request for an update block, and now and then an order of its own.
        const kind = gen && !gen.dryRun ? gen.type : 'normal';
        if (kind === 'swipe' && cs && !gen?.guided) undoForSwipe();
        await worldIdle();
        const phase = cs ? phaseFor(history(kind).next) : null;
        const scale = phase?.chance ?? 100;
        const modules = native ? effectiveModules() : null;
        const activeScene = native ? readScene(kind) : null;
        if (native) await addConfiguredBooks(lore, arrays,{present:activeScene.present,where:activeScene.location},modules,{base:memoryComponents().world,reference:memoryComponents().world,type:kind});
        filterExcludedBooks(arrays);
        for (const entries of arrays) for (let index=0;index<entries.length;index++) entries[index] = correctedLoreEntry(entries[index]);
        const chance = Math.max(0,Math.min(100,Math.round(Number(settings().world.head)*scale/100) || 0));
        if (gen && gen.v10Schedule === undefined && native && !gen.dryRun) gen.v10Schedule = !quiet && kind === 'normal' && modules.worldEvents && chance > 0 && rollInt(100) < chance;
        const schedule = gen?.v10Schedule === true;
        const flow = cs && Array.isArray(lore.chatLore) ? await prepareWorld(kind, history(kind).next, { quiet, scale, native, opportunities:schedule && modules?.plots }).catch((e) => { console.warn(LOG, 'story world', e); return null; }) : null;
        // A story phase can have a line of its own, sent with every reply of the phase.
        if (phase?.line && !quiet && Array.isArray(lore.chatLore)) lore.chatLore.push(paceEntry(phase.line));
        // Dice: rolled in code for every reply while they are on (not for background requests or out-of-character turns).
        if (cs && !native && settings().dice?.on && !quiet && !isOocTurn() && Array.isArray(lore.chatLore)) lore.chatLore.push(diceEntry());
        const stateText = cs && !quiet && !isOocTurn() ? statePrompt(kind, Math.max(100, Math.min(1000, Number(settings().cards?.stateBudget) || 350)) * 4, { includeCharacters: native ? modules.state : cardsOn(), excludeTargetOverrides: !!gen?.guided && !gen.guided.correction }) : '';
        const direction = gen?.guided && kind === 'swipe' ? `[${promptText('guided', { direction: gen.guided.direction })}]` : '';
        const corrections = !quiet && !isOocTurn() ? storyCorrectionPrompt(activeScene?.present,activeScene?.location) : '';
        const notes = flow?.notes || null;
        if (notes) lore.chatLore.push(notesEntry(notes.text));
        let contextAsk = '';
        let v10Turn = null;
        let v10Rows = [];
        if (native && !quiet && !isOocTurn() && Array.isArray(lore.chatLore)) {
            v10Rows = await rowsForWorld().catch(() => []);
            const old = gen?.guided?.prior || (kind === 'swipe' || kind === 'continue' ? lastRecord() : null);
            const check = modules.dice ? (gen?.check ?? old?.v10Check ?? null) : null;
            v10Turn = prepareTurn(v10Rows,{where:activeScene.location,present:activeScene.present},kind,modules,check,{schedule,recallFacts:memoryComponents().world});
            if (schedule && !v10Turn.offer && !flow?.order) {
                v10Turn.offer = {id:'world-event',text:'If the scene has room, introduce one plausible outside development that follows from the current place and circumstances.'};
            }
            contextAsk = [corrections, modules.state && stateText, direction, v10Turn.text].filter(Boolean).join('\n');
            if (contextAsk) lore.chatLore.push(askEntry(contextAsk));
        }
        else if (native && direction && Array.isArray(lore.chatLore)) { contextAsk = direction; lore.chatLore.push(askEntry(direction)); }
        else if (!native && flow?.ask) { contextAsk = [corrections, stateText, direction, flow.ask].filter(Boolean).join('\n'); lore.chatLore.push(askEntry(contextAsk)); }
        // With no story world, the scene lines are still asked for, so who is present, where and when are known under any preset.
        else if (!native && cs && !quiet && (settings().scene?.track !== false || cardsOn()) && !isOocTurn() && Array.isArray(lore.chatLore)) { const a = buildSceneAsk(kind); if (a || corrections) { contextAsk = [corrections, stateText, direction, a].filter(Boolean).join('\n'); lore.chatLore.push(askEntry(contextAsk)); } }
        else if ((direction || corrections) && Array.isArray(lore.chatLore)) { contextAsk = [corrections, stateText, direction].filter(Boolean).join('\n'); lore.chatLore.push(askEntry(contextAsk)); }
        if (flow && (!native || (flow.order && !v10Turn?.offer))) lore.chatLore.push(orderEntry());
        // The character goal travels as one entry that is made here for each scan.
        if (cs && Array.isArray(lore.chatLore) && !(gen && !gen.dryRun && gen.skip)) {
            const g = goals();
            if (g?.on && String(g.goal || '').trim() && !goalDone(g, goalProgress(gen && !gen.dryRun ? gen.type : 'normal'))) lore.chatLore.push(goalEntry());
        }
        for (const arr of arrays) {
            for (const e of arr) if (isManaged(e)) {
                const raw = { content:e.content, role:e.role };
                const set = setOf(e);
                if (Object.hasOwn(settings().sets,set) && setInfo(set).kind==='instructions') {
                    const {when,triggerSource,chance,keep,wait} = readInstruction(e);
                    raw.recallRule = {when,triggerSource,chance,keep,wait};
                }
                rawByKey.set(keyOf(e),raw);
            }
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
        const scopedInstructions = arrays.flat().filter(entry =>
            isManaged(entry) && setInfo(setOf(entry)).kind === 'instructions' && !entry.constant && bookTriggerSource(entry) !== 'chat');
        if (scopedInstructions.length) {
            const texts = scopedTriggerTexts(ctx().chat || [], kind);
            for (const entry of scopedInstructions) Object.assign(entry, scopedBookEntry(entry, texts));
        }
        if (cs) applyTiming(arrays.flat().filter(isManaged), cs);
        plan.v10Turn = v10Turn;
        plan.v10Rows = v10Rows;
        plan.contextAsk = contextAsk;
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
    const rule = repeat ? extra?.recallRule : rawByKey.get(item.key)?.recallRule;
    if (rule) item.recallRule = rule;
    // A story event also keeps what the dice picked, and the state of its categories after this event.
    if (extra?.event || extra?.parts) { item.event = extra.event; item.parts = extra.parts; }
    if (entry.extensions?.ri?.actor === 'model') item.modelDirection = true;
    if (extra?.noCheck || item.modelDirection) item.noCheck = true;
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
        if (gen.memory) {
            for (const entry of map.values()) if (isManaged(entry) && !isNotes(entry)) map.delete(keyOf(entry));
            if (!gen.skip) {
                const flow = gen.memoryFlow;
                const selectedNotes = [...map.values()].some(isNotes) ? flow?.notes : null;
                pending = {memory:true,type:gen.type,recall:{book:flow?.id,fresh:selectedNotes?.fresh || []},notes:selectedNotes?.text || '',lore:loreReceipt(map.values(),selectedNotes,flow?.rows || [],flow?.id)};
            }
            return;
        }
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
                if (gen.guided && !gen.guided.repeatOrders && (isEvent(e) || it.worldOrder || it.modelDirection || e.extensions?.ri?.actor === 'model' || (!it.noCheck && !('goalTask' in it)))) continue;
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
                if (nt) items.push(makeItem(notesE, 'plain', nt.text, 0, 'new', false, { noCheck: true, notes: { ids: nt.ids, fresh: nt.fresh, extra: nt.extra, present: nt.present, missing: nt.missing, place: nt.place, how: nt.how, tokens: nt.tokens } }));
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
                // Required directions take precedence over optional world opportunities in v10.
                const required = plan.v10Turn ? tickets.filter(ticket => !ticket.world) : [];
                const winners = required.length ? pickWeighted(required, () => 1, room) : pickWeighted(tickets, () => 1, room);
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
                if (plan.v10Turn && (fresh.length || continuing.length || overdue.length || items.some(it=>!it.noCheck))) worldNew = false;
                if (worldNew && plan.v10Turn && askE && map.has(keyOf(askE))) {
                    const effect = plan.flow.order.effect;
                    if (['seed','thread','activity'].includes(effect.kind)) {
                        plan.v10Turn.legacyOffer = effect;
                        askE.content += `\nTo confirm the optional legacy opportunity only if it happens in the prose, include legacyOutcome with the exact evidence quote as its value.`;
                        plan.contextAsk = askE.content;
                    }
                }
                if (worldNew) items.push(makeItem(orderE, 'system', [plan.v10Turn ? `Optional opportunity. Use it only if it fits; otherwise defer: ${plan.flow.order.text.replace(/\bmust\b/gi,'could')}` : plan.flow.order.text, plan.v10Turn || plan.flow.order.effect?.silent ? '' : eventLine].filter(Boolean).join(' '), 0, 'new', false, { worldOrder: plan.flow.order.effect, big: !plan.v10Turn && plan.flow.order.effect?.kind === 'thread', noCheck: !!plan.v10Turn }));
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

        const offer = !isRepeat && !gen.quiet && askE && map.has(keyOf(askE)) && !items.some(it => !it.noCheck || it.worldOrder) ? plan.v10Turn?.offer : null;
        if (offer) {
            const completion = offer.id === 'world-event' ? 'Record a new event only if it occurs in the prose.' : 'Mark done only if it occurs in the prose.';
            askE.content += `\nOptional plot opportunity (${offer.id}): ${offer.payoff || offer.text} Defer if it does not fit. ${completion}`;
            plan.contextAsk = askE.content;
        }
        sayUserLineOnce(items);
        gen.result = { texts: new Map(items.map(it => [it.key, it.text])) };
        if (askE && map.has(keyOf(askE))) gen.result.texts.set(keyOf(askE), askE.content);
        const pace = { phase: plan.phase ? { name: plan.phase.name, chance: plan.phase.chance } : null, quiet: gen.quiet || null };
        cs.lastScan = { len, states, pace, items: items.map(it => ({ key: it.key, sentAs: it.sentAs, version: it.version, misses: it.misses, kind: it.kind, event: it.event, parts: it.parts, noCheck: it.noCheck, notes: it.notes, worldOrder: it.worldOrder, big: it.big, pace: it.pace, ask: it.ask, dice: it.dice, ...('goalTask' in it ? { goalTask: it.goalTask, checkText: it.checkText } : {}) })) };
        if (gen.guided) { gen.guided.afterLastScan = structuredClone(cs.lastScan); gen.guided.afterOverdue = structuredClone(cs.overdue); }
        const notesItem = items.find(item=>item.notes);
        const receiptNotes = notesItem && { ids:notesItem.notes.ids,text:notesItem.text };
        const notesFresh = notesItem?.notes.fresh ?? (plan.notes?.fresh || []).filter(uid=>receiptNotes?.ids?.some(id=>String(id)===uid));
        const guidanceSelected = askE && map.has(keyOf(askE));
        pending = { items, type, states, pace, v10:plan.v10Turn,
            recall:{book:plan.flow?.id,fresh:[...new Set([...notesFresh,...(guidanceSelected ? plan.v10Turn?.recallFresh || [] : [])])]}, progressTurn:replyProgress()?.turn, offer:offer?.id,
            lore:plan.v10Turn ? loreReceipt(map.values(),receiptNotes,plan.v10Rows,plan.flow?.id,guidanceSelected ? plan.v10Turn.recalled : []) : null, usedUp: gen.usedUp || null,
            guided: gen.guided ? {direction:gen.guided.direction,repeatOrders:gen.guided.repeatOrders,correctionId:gen.guided.correction?.id} : null };
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
        if (pending?.memory || (gen?.memory ?? memoryOnly())) {
            const turn = pending;
            if (!turn?.memory || type==='first_message') return;
            const message = ctx().chat?.[id];
            if (!message || message.is_user || message.is_system) return;
            pending = null;
            const previous = turn.type==='continue' ? message.extra?.[KEY] : null;
            const time = previous?.time || Date.now();
            const v10Lore = turn.lore.map(({text,...entry})=>entry);
            attach(message,{...previous,v:1,memory:true,items:previous?.items || [],type:turn.type,time,v10Lore,recall:turn.recall});
            try { ctx().saveChat?.(); } catch { /* saved with the next change */ }
            chapterAfterReply(time,history('normal').next-1,()=>changed('messages'));
            changed('sent',id);
            return;
        }
        // The update block is taken out of the reply first, so it is never shown, checked or sent back.
        const m = ctx().chat?.[id];
        if (!m || m.is_user || m.is_system) return;
        const parsed = settings().enabled ? liftBlock(id, type !== 'first_message' && pairedPreset(), pending?.v10?.modules) : { found: false, ops: [], ended: false, block: '' };
        if (!pending || type === 'first_message') return;
        // A continued reply keeps the time of its record, so what its first part filed in the story world still belongs to it.
        const earlier = pending.type === 'continue' ? m.extra?.[KEY] || null : null;
        const rec = { v: 1, recall:pending.recall, items: pending.items, type: pending.type, time: earlier?.time || Date.now(), agency: null, checking: false, note: '' };
        if (pending.states && Object.keys(pending.states).length) rec.states = pending.states;
        if (pending.pace && (pending.pace.phase || pending.pace.quiet)) rec.pace = pending.pace;
        if (pending.usedUp) rec.usedUp = pending.usedUp;
        if (pending.guided) rec.guided = pending.guided;
        // Who is present, where and when, from the reply's own block. A continued reply keeps what its first part said.
        const previousRecord = [...(ctx().chat || []).slice(0,id)].reverse()
            .map(row=>row?.extra?.[KEY]).find(record=>record?.scene && !record.stateStale);
        const previousScene = normalizeScene(previousRecord?.scene || sceneAt(id,{overrides:false}));
        const turn = pending.v10;
        const plainDialogue = turn && (turn.modules.colors || pairedPreset()) ? proseDialogue(m.mes) : m.mes;
        const rewrittenDialogue = plainDialogue !== m.mes;
        if (rewrittenDialogue) {
            m.mes = plainDialogue;
            if (m.swipes?.[m.swipe_id] !== undefined) m.swipes[m.swipe_id] = plainDialogue;
        }
        const progressTurn = turn && pending.progressTurn;
        if (turn) {
            rec.v10 = true;
            if (parsed.plan || earlier?.v10Plan) rec.v10Plan = parsed.plan || earlier.v10Plan;
            rec.v10Check = turn.check || null;
            rec.v10Offer = pending.offer;
            rec.v10Plot = turn.plotAudit?.filter(row=>row.recalled || row.eligible || row.id===pending.offer).slice(0,40);
            if (pending.offer && !rec.v10Plot?.some(row=>row.id===pending.offer)) (rec.v10Plot ||= []).push({id:pending.offer,eligible:true,recalled:false});
            rec.v10Lore = pending.lore?.map(({text, ...entry})=>entry);
            if (typeof pending.guidanceConfirmed==='boolean') rec.v10Guidance = pending.guidanceConfirmed;
            if (pending.v10Request) rec.v10Request = pending.v10Request;
            const cardIssues = [];
            if (pending.guidanceConfirmed === false) cardIssues.push('The extension could not find its story guidance in the assembled request.');
            if (turn.expectsPlan && !parsed.plan && !earlier?.v10Plan) cardIssues.push('Reply planning was enabled. The reply contained no readable outline.');
            if (turn.modules.roast && !parsed.roast && !earlier?.roast) cardIssues.push('Roast generation was enabled. The reply contained no readable Roast.');
            if (cardIssues.length) rec.cardIssues = cardIssues;
            rec.v10Invalid = parsed.invalid === true || !!parsed.issues?.length;
            if (parsed.issues?.length) rec.v10Issues = parsed.issues;
            rec.v10RepairAttempt = !!turn.repair;
            rec.v10Changes = [...(earlier?.v10Changes || [])];
            const recent = (ctx().chat || []).slice(Math.max(0,id-10),id).filter(isReply)
                .slice(-4).map(reply=>String(reply.mes || ''));
            rec.v10Diagnostics = replyDiagnostics(parsed.clean || m.mes,{
                recent,avoid:turn.modules.style ? prefs()?.avoidPhrases : '',metrics:prefs()?.proseMetrics===true,
            });
            if (turn.modules.colors) registerSpeakers(parsed.clean || m.mes,turn.records);
            if (!turn.modules.roast) parsed.roast = '';
            if (!turn.modules.state) { parsed.scene = null; parsed.elapsed = undefined; parsed.minutes = undefined; parsed.ops = []; parsed.profiles = []; }
            if (Number.isInteger(parsed.minutes) && (!Number.isInteger(turn.clock) || parsed.minutes >= turn.clock)) rec.v10Minutes = parsed.minutes;
            else if (Number.isInteger(turn.clock)) {
                rec.v10Minutes = turn.clock + (parsed.elapsed ?? 0);
                if (Number.isInteger(parsed.minutes) && parsed.minutes<turn.clock) {
                    rec.v10Invalid = true;
                    (rec.v10Issues ||= []).push('Story time cannot move backwards within the current scene.');
                }
            }
            if (prefs()?.check === turn.check) { delete prefs().check; saveChatState(); }
        }
        const header = turn?.modules.state ? parsed.legacyScene || sceneFromReplyHeader(parsed.clean || m.mes) : {};
        const acceptedScene = normalizeScene({...header,...normalizeScene(parsed.scene || {})});
        const scene = { ...(turn?.modules.state ? previousScene : {}), ...(earlier?.scene || {}), ...acceptedScene };
        if (turn?.modules.state) {
            const moved = parsed.scene?.where && previousScene.where && parsed.scene.where.toLowerCase()!==previousScene.where.toLowerCase();
            rec.v10SceneId = earlier?.v10SceneId ?? (moved || previousRecord?.v10SceneEnded ? rec.time : previousRecord?.v10SceneId ?? previousRecord?.time ?? rec.time);
            rec.v10SceneEnded = parsed.ended === true || (earlier?.v10SceneEnded && !parsed.scene?.where);
            if (acceptedScene.when!==undefined && acceptedScene.time===undefined) delete scene.time;
            if (scene.weather && acceptedScene.weather===undefined) rec.weatherInherited = true;
            if ((moved || previousRecord?.v10SceneEnded || parsed.ended) && parsed.scene?.environment===undefined) delete scene.environment;
        }
        if (!turn?.modules.state && !parsed.ended && scene.environment === undefined && (!scene.where || scene.where === previousScene.where)) scene.environment = previousScene.environment || '';
        if (Object.keys(scene).length) rec.scene = scene;
        keepCards(rec, parsed, earlier, id);
        rec.stateChanges = [...(earlier?.stateChanges || []), ...changesFromProfiles(parsed.profiles)];
        if (earlier?.stateEdits) rec.stateEdits = earlier.stateEdits;
        pending = null;
        // A reply that carried nothing still gets an (empty) record, so a later swipe knows to send nothing again.
        attach(m, rec);
        const guidedAttempt = rec.guided && guided;
        if (guidedAttempt) {
            guidedAttempt.completed = true;
            if (guidedAttempt.ending) guided = null;
            if (guidedAttempt.correction) {
                const meta = chatState();
                const anchor = `record:${rec.time}`;
                const previousAnchor = `record:${guidedAttempt.tx.time}`;
                if (guidedAttempt.correction.anchor===previousAnchor) guidedAttempt.correction.anchor=anchor;
                for (const change of meta?.manualWorldChanges || []) {
                    if (change.anchor===previousAnchor && guidedAttempt.correction.sources.some(source=>source.kind==='world' && source.uid===change.uid)) change.anchor=anchor;
                }
                reanchorRemovedCorrections();
                acceptGuidedSwipe(guidedAttempt.tx);
            }
        }
        if (rewrittenDialogue) {
            try { ctx().updateMessageBlock?.(id,m); } catch { /* drawn on the next redraw */ }
        }
        // File what the reply established in the story world. With checking off, a world order counts as done when sent.
        if (earlier) rec.update = earlier.update;
        if (progressTurn) showReplyProgress(progressTurn,'filing',id);
        afterReply(id, rec, parsed, history('normal').next - 1, () => {
            changed('checked',id);
            if (!progressTurn) return;
            if (!parsed.found || rec.v10Invalid) { clearReplyProgress(progressTurn); return; }
            showReplyProgress(progressTurn,'ready');
        }, { v10:turn }).finally(() => {
            guidedAttempt?.finish?.(true);
            if (progressTurn && replyProgress()?.turn === progressTurn) {
                if (replyProgress().phase === 'ready') setTimeout(()=>clearReplyProgress(progressTurn),520);
                else clearReplyProgress(progressTurn);
            }
        });
        if (!turn && settings().check.mode === 'off') for (const it of rec.items) if (it.worldOrder) applyEffect(rec, it.worldOrder, () => changed('checked', id));
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
        promptText('checker'),
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
            if (it.worldOrder && !rec.v10) applyEffect(rec, it.worldOrder, () => changed('checked', id));
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
    if (it.modelDirection) return 'Sent (reply-writing guidance)';
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
        const record = !data.dryRun && !gen?.skip && !isOwnPrompt(data.chat);
        const paired = pairedPreset();
        const plainDialogue = paired || (enabledV10() && effectiveModules().colors);
        const memory = gen?.memory ?? memoryOnly();
        if (record && settings().enabled && chatState()?.storyCorrections?.length) {
            const fields = characterCorrectionFields().filter(field=>field.before!==field.after)
                .map(field=>({before:sub(field.before).trim(),after:sub(field.after).trim()}));
            for (const message of data.chat) {
                if (message.role!=='system' || typeof message.content!=='string') continue;
                for (const {before,after} of fields) if (before.length>=12 || before===message.content.trim()) {
                    message.content = replaceUnique(message.content,before,after) ?? message.content;
                }
            }
        }
        if (!memory) for (const msg of data.chat) {
            // An update block that was left in an older reply is kept out of the prompt. The request itself shows the form, so only replies are cleaned.
            if (msg.role === 'assistant') {
                const cleanAssistant = value => {
                    const prose = stripUpdateBlock(paired ? separateReply(value).text : value);
                    return plainDialogue ? proseDialogue(prose) : prose;
                };
                if (typeof msg.content === 'string') msg.content = cleanAssistant(msg.content);
                if (Array.isArray(msg.content)) for (const part of msg.content) if (typeof part?.text === 'string') part.text = cleanAssistant(part.text);
            }
            if (typeof msg.content === 'string' && msg.content.includes('<sent_instructions>')) msg.content = stripSentBlock(msg.content);
            else if (Array.isArray(msg.content)) for (const part of msg.content) if (typeof part?.text === 'string' && part.text.includes('<sent_instructions>')) part.text = stripSentBlock(part.text);
        }
        if (record && pending?.lore) {
            const full = data.chat.flatMap(({content})=>Array.isArray(content) ? content.map(part=>part?.text || '') : typeof content === 'string' ? [content] : []).join('\n');
            const instructions = !memory && plan.contextAsk && sub(plan.contextAsk).trim();
            if (pending.v10 && instructions) {
                pending.guidanceConfirmed = full.includes(instructions);
                if (prefs()?.keepTurnGuidance && pending.guidanceConfirmed) pending.v10Request = instructions;
            }
            for (const entry of pending.lore) {
                const expanded = typeof entry.text === 'string' ? sub(entry.text).trim() : '';
                entry.confirmed = !!expanded && full.includes(expanded);
            }
        }
        if (record && gen && replyProgress()?.phase === 'context') showReplyProgress(gen,'waiting');
        if (record) { notePromptSent(data.chat); captureContext(data.chat, { items: memory && pending?.notes ? [{notes:true,text:pending.notes}] : pending?.items || [], ask: memory ? '' : plan.contextAsk || '' }); }
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
        if (rec?.v10 || rec?.items?.length || rec?.v10Lore?.length || rec?.v10Request || rec?.v10Offer || rec?.v10Check || rec?.cardIssues?.length || shownChanges(rec?.update?.changes).length || rec?.pace?.quiet) out.push({ id: i, rec, isLast: i === chat.length - 1, name: chat[i].name });
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
    try {
        const restored = await restoreGuidedSwipe(attempt.tx);
        if (!restored || String(ctx().getCurrentChatId?.() || '') !== attempt.chatId) return;
        const cs = chatState();
        if (!cs) return;
        if (attempt.afterLastScan && JSON.stringify(cs.lastScan) === JSON.stringify(attempt.afterLastScan)) cs.lastScan = attempt.beforeLastScan;
        if (attempt.afterOverdue && JSON.stringify(cs.overdue) === JSON.stringify(attempt.afterOverdue)) cs.overdue = attempt.beforeOverdue;
        saveChatState();
    } finally { attempt.finish?.(false); }
}

export function correctionSwipeTarget() {
    const c = ctx(), index = (c.chat?.length || 0)-1, message = c.chat?.[index];
    if (memoryOnly() || !settings().enabled || !isReply(message) || message.is_system || !message.extra?.[KEY]) return null;
    return {chatId:c.getCurrentChatId?.(), index, message, swipe:message.swipe_id};
}

export async function regenerateStoryCorrection(correction, target) {
    const latest = correctionSwipeTarget();
    if (!latest || !target || latest.chatId!==target.chatId || latest.message!==target.message || latest.swipe!==target.swipe) {
        throw new Error('The selected reply changed. Open Corrections on the reply you want to regenerate.');
    }
    const recordTime = latest.message.extra[KEY].time;
    const note = (status) => {
        if (ctx().getCurrentChatId?.()!==target.chatId) return;
        correction.regeneration = {status,recordTime};
        saveChatState();
    };
    const facts = correction.truth;
    const direction = 'Regenerate this reply using the following accepted correction. Keep the same point in the story and retain unrelated established details. Apply the correction in the fiction without discussing the edit.\n\n'+facts;
    note('running');
    try {
        if (!await guideSwipe(direction,{correction,keepManualEdits:true})) {
            if (ctx().getCurrentChatId?.()===target.chatId && target.message===ctx().chat?.at(-1) &&
                Number.isInteger(target.swipe) && target.message.swipe_id!==target.swipe && typeof ctx().swipe?.to==='function') {
                await ctx().swipe.to(null,'left',{message:target.message,forceSwipeId:target.swipe});
            }
            throw new Error('The guided reply stopped before a replacement was saved.');
        }
        note('ready');
    } catch(error) { note('failed'); throw error; }
}

/** Guide one newly generated swipe of the latest character reply. */
export async function guideSwipe(direction, { repeatOrders = false, keepManualEdits = false, rerollDice = false, correction } = {}) {
    const c = ctx(), chat = c.chat || [], id = chat.length - 1, m = chat[id];
    const value = String(direction || '').trim();
    if (!settings().enabled) throw new Error('Turn the extension on first.');
    if (memoryOnly()) throw new Error('Guided swipes are available in the full extension workflow.');
    if (!value || value.length > 2000) throw new Error('Enter a direction of at most 2,000 characters.');
    if (guided || guidedPreparing || isGenerating()) throw new Error('Wait for the current generation to finish.');
    if (!m || m.is_user || m.is_system || !m.extra?.[KEY]) throw new Error('A recorded character reply must be the latest message.');
    if (!correction && Array.isArray(m.swipes) && Number(m.swipe_id || 0) < m.swipes.length - 1) throw new Error('Move to the newest existing swipe first, then use Guide a swipe.');
    const anchors = new Set([m.extra[KEY].time ? `record:${m.extra[KEY].time}` : '', m.send_date ? `message:${m.send_date}` : '']);
    const meta = c.chatMetadata?.[KEY] || {};
    if (!correction && [...Object.values(meta.stateOverrides || {}), ...Object.values(meta.sceneOverrides || {})].some(x => !x?.anchor || anchors.has(x.anchor))) throw new Error('A protected state or scene correction was made on this reply. Review or unlock it in Current State before replacing the reply; include any desired correction in the direction.');
    if (!keepManualEdits && (meta.manualWorldChanges || []).some(x => x?.anchor && anchors.has(x.anchor))) throw new Error('The story world was manually edited after this reply. Review those edits, then select “Keep my manual world edits” if you want them to remain.');
    const chatId = String(c.getCurrentChatId?.() || ''), selectedTime = m.extra[KEY].time;
    guidedPreparing = true;
    let tx, completion, attempt;
    try {
        await worldIdle();
        tx = await prepareGuidedSwipe(id,{keepManualEdits,correction});
        if (String(ctx().getCurrentChatId?.() || '') !== chatId || ctx().chat?.[id]?.extra?.[KEY]?.time !== selectedTime) { await restoreGuidedSwipe(tx); throw new Error('The chat changed. Try again on the intended reply.'); }
        const cs = chatState();
        pickAgain = false; rerollCat = null;
        attempt = guided = { direction: value, check:rerollDice && m.extra[KEY].v10Check ? resolveCheck(m.extra[KEY].v10Check) : undefined, repeatOrders: !!repeatOrders, prior: structuredClone(m.extra[KEY]), tx, chatId, started: false, completed: false, beforeLastScan: structuredClone(cs?.lastScan), beforeOverdue: structuredClone(cs?.overdue || []), correction };
        if (correction) completion = new Promise(resolve=>{attempt.finish=resolve;});
    } finally { guidedPreparing = false; }
    try {
        const ok = await triggerSwipe({append:!!correction});
        if (!ok) throw new Error('Could not start the swipe.');
        if (guided && !guided.started) {
            const attempt = guided;
            setTimeout(() => { if (guided === attempt && !attempt.started) { guided = null; cancelGuided(attempt).catch(e => console.warn(LOG, 'restore guided swipe', e)); toast('warning', 'The swipe did not start. The extension is restoring the earlier world state.'); } }, 10000);
        }
    } catch (e) { if (guided===attempt) { guided = null; await cancelGuided(attempt); } throw e; }
    return completion;
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
        if (guided?.ending) {
            const attempt = guided;
            guided = null;
            if (!attempt.completed) cancelGuided(attempt).catch(e => console.warn(LOG, 'restore guided swipe', e));
        }
        clearReplyProgress();
        if (guided && type === 'swipe' && guided.chatId === String(ctx().getCurrentChatId?.() || '')) guided.started = true;
        gen = { memory:memoryOnly(), guided: guided?.started ? guided : null, type: String(type || 'normal'), dryRun: false, skip: type === 'impersonate' || type === 'quiet' || !!opts?.quiet_prompt, handled: false, result: null, started: Date.now() };
        if (!gen.skip) {
            pending = null;
            if (enabledV10()) gen.check = gen.guided?.check ?? (['swipe','regenerate','continue'].includes(gen.type) ? lastRecord()?.v10Check : prefs()?.check);
        }
    });
    on('GENERATION_AFTER_COMMANDS', async (_type, _opts, dryRun) => {
        if (dryRun || !settings().enabled) return;
        if (!gen?.skip) await flushStoryDeletion();
        if (!chatState()?.worldDetached && enabledV10() && !gen?.skip && !isOocTurn() && isChatOpen()) await ensureWorld().catch(e => console.warn(LOG,'v10 story world',e));
        if (!chatState()?.worldDetached && (gen?.memory || chatState()?.carried) && !gen?.skip && memoryComponents().chapters && isChatOpen()) await ensureWorld().catch(e=>console.warn(LOG,'chapter story world',e));
        if (gen?.memory || !checkPromise) return;
        // Let a running check finish first, so an instruction that did not happen can be sent again with this reply.
        await Promise.race([checkPromise, new Promise(r => setTimeout(r, 20000))]);
    });
    on('MESSAGE_RECEIVED', onMessageReceived);
    on('MESSAGE_RECEIVED', rememberStoryTimeline);
    on('STREAM_TOKEN_RECEIVED', text => {
        const progress = replyProgress();
        if (!gen || progress?.turn !== gen || typeof text !== 'string' || !text.trim()) return;
        const paired = gen.paired ??= pairedPreset();
        const partial = paired ? trimPartialReplyTag(text) : text;
        const previewNeeded = paired && (partial!==text || progress.preview!==undefined || hasReplyScaffolding(partial) || /<story_update\b/i.test(partial));
        const visible = previewNeeded ? separateReply(partial).text : text;
        if (previewNeeded) setReplyPreview(gen,stripUpdateBlock(visible));
        if (!['context','waiting','writing','receiving'].includes(progress.phase)) return;
        const sections = streamUpdate(visible);
        if (sections) setReplySections(gen,sections);
        if (sections || /<story_update\b/i.test(visible)) showReplyProgress(gen,'receiving');
        else if (progress.phase !== 'writing') showReplyProgress(gen,'writing');
    });
    on('GENERATION_ENDED', () => {
        // Streaming unlocks the host UI before it announces the accepted message.
        // Keep the card available for that event, with cleanup for empty or failed generations.
        const finished = replyProgress()?.turn;
        if (finished) setTimeout(() => {
            if (replyProgress()?.turn === finished && !['filing','ready'].includes(replyProgress().phase)) clearReplyProgress(finished);
        },1200);
        gen = null;
        const attempt = guided;
        if (!attempt || attempt.completed) { guided = null; return; }
        // The host unlocks streaming controls before it emits MESSAGE_RECEIVED.
        // Give that event a chance to file the new swipe before rolling back.
        attempt.ending = true;
        setTimeout(() => {
            if (guided!==attempt) return;
            guided = null;
            if (!attempt.completed) {
                pending = null;
                cancelGuided(attempt).catch(e => console.warn(LOG, 'restore guided swipe', e));
            }
        },1200);
    });
    on('GENERATION_STOPPED', () => { clearReplyProgress(); const attempt = guided; guided = null; gen = null; pending = null; pickAgain = false; rerollCat = null; if (attempt && !attempt.completed) { pending = null; cancelGuided(attempt).catch(e => console.warn(LOG, 'restore guided swipe', e)); } });
    on('CHAT_COMPLETION_PROMPT_READY', onPromptReady);
    on('OAI_PRESET_CHANGED_AFTER', () => changed('preset'));
    on('CHAT_CHANGED', () => {
        clearReplyProgress();
        const attempt = guided; guided = null; if (attempt && !attempt.completed) { pending = null; cancelGuided(attempt).catch(e => console.warn(LOG, 'restore guided swipe', e)); }
        gen = null; pending = null; pickAgain = false; checkPromise = null;
        rawByKey.clear();
        if (isChatOpen()) { if (!memoryOnly()) applyPronouns(); if (settings().enabled) { reconcile(); refreshAfterChatOpen(() => changed('messages')); } }
        changed('chat');
        // Former keys of moved sets are read in the background, then this chat's state is brought in line.
        if (isChatOpen() && settings().enabled) refreshAliases().then(() => { const cs = chatState(); if (cs) { syncChat(cs); reconcile(); changed('messages'); } }).catch(e => console.warn(LOG, 'aliases', e));
    });
    for (const name of ['MESSAGE_SWIPED', 'MESSAGE_UPDATED']) on(name, () => changed('messages'));
    // What a reply changed in the story world is undone when that reply is swiped away or deleted.
    on('MESSAGE_SWIPED', () => { rememberStoryTimeline(); if (settings().enabled && !guided) syncWorld(() => changed('messages')); });
    on('MESSAGE_DELETED', () => { if (settings().enabled) { reanchorRemovedCorrections(); reconcile(); refreshAfterDeletion(() => changed('messages')); } changed('messages'); });
    on('MESSAGE_EDITED', (id) => {
        // Editing the newest reply by hand can make an instruction happen, or remove it. Check that reply again.
        id = Number(id);
        if (settings().enabled && ctx().chat?.[id] && !ctx().chat[id].is_user) refreshAfterReplyEdit(id,()=>changed('messages'));
        else if (settings().enabled && ctx().chat?.[id]?.is_user) syncWorld(() => changed('messages'));
        if (!memoryOnly() && settings().enabled && id === (ctx().chat || []).length - 1 && !isGenerating()) checkAgain(id);
        changed('messages');
    });
    return missing;
}


/** Commit only the opening the player has accepted, before other turns exist. */
export async function acceptV10Opening(draft, prose) {
    if (!enabledV10() || isGenerating()) throw new Error('Opening setup requires the Structured story workflow and an idle chat.');
    const c = ctx();
    const chat = c.chat || [];
    const chatId = c.getCurrentChatId?.();
    const ready = () => chat.length <= 1 && !chat[0]?.is_user && !chat[0]?.extra?.[KEY]?.v10;
    if (!ready() || !String(prose || '').trim()) throw new Error('Use opening setup before normal play and enter a greeting.');
    await ensureWorld();
    if (ctx().getCurrentChatId?.() !== chatId || ctx().chat !== chat || !ready()) throw new Error('The chat changed.');
    const rows = await rowsForWorld();
    if (ctx().getCurrentChatId?.() !== chatId || ctx().chat !== chat || !ready()) throw new Error('The chat changed.');
    const modules = effectiveModules();
    const accepted = pairedPreset() ? separateReply(prose).text : prose;
    const embedded = parseUpdate(accepted);
    if (prefs()?.openingPlayerThoughts === true && embedded.modern) Object.assign(embedded,extractUpdate(accepted,{allowPlayerThoughts:true}));
    let parsed = embedded;
    if (draft?.parsed && !draft.parsed.invalid && !embedded.found) {
        parsed = prose === draft.original
            ? { ...draft.parsed, modern:true, ops:[], block:'' }
            : { ...embedded, modern:true, changes:draft.parsed.changes, profiles:draft.parsed.profiles };
    }
    if (parsed.profiles?.length) parsed.profiles = parsed.profiles.filter(profile=>!profile.evidence || embedded.clean.includes(profile.evidence));
    parsed.clean = embedded.clean;
    prose = modules.colors || pairedPreset() ? proseDialogue(embedded.clean) : embedded.clean;
    const m = chat[0] || { name:names().char, is_user:false, is_system:false, send_date:new Date().toISOString(), extra:{} };
    m.mes = prose;
    if (m.extra) delete m.extra.display_text;
    m.swipes = [prose];
    m.swipe_id = 0;
    m.swipe_info = [{ send_date:m.send_date, extra:{} }];
    const newMessage = !chat.length;
    if (newMessage) chat.push(m);
    const rec = { v:2, v10:true, items:[], time:Date.now(), type:'opening', stateChanges:modules.state ? changesFromProfiles(parsed.profiles || []) : [], scene:modules.state ? parsed.scene : null,
        v10Minutes:modules.state ? parsed.minutes : undefined, roast:modules.roast ? parsed.roast : '' };
    rec.v10SceneId = rec.time;
    attach(m,rec);
    if (modules.colors) registerSpeakers(prose,recordMap(rows));
    if (newMessage) c.addOneMessage?.(m);
    else c.updateMessageBlock?.(0,m);
    await afterReply(0,rec,parsed,0,() => changed('messages',0),{ v10:{ modules, records:recordMap(rows), baselines:portrayalSources(rows), base:baseWorld() }, propagate:true });
    await c.saveChat?.();
    changed('messages',0);
}
