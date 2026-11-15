// What happens on each reply: which instructions are sent, which version, the record of what was sent,
// and the check that it happened. World Info rolls chance, timing and groups; this module works on the result.
import { ctx, on, KEY, LOG, sub, scanLength, isChatOpen, parseJson, names, triggerSwipe, loadBook, isGenerating, toast } from './st.js';
import { request } from './ai.js';
import { settings, saveSettings, chatState, saveChatState, applyPronouns } from './store.js';
import { isEvent, isStyle, rollEvent, rerollCategory, withPreset, checkRules } from './events.js';
import { GOAL_WORLD, isGoal, goals, goalEntry, goalProgress, goalDone, buildGoalOrder, advanceIfDone } from './goals.js';
import { parseContent, wrapText, toStore, setOptions, pickWeighted, rollInt, SENT_AS, stickyToKeep, cooldownToWait, delayToReplyNumber } from './books.js';

let gen = null;            // the generation in progress: { type, dryRun, skip, handled }
let pending = null;        // what was sent for the reply being written: { items, type }
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
const managedWorlds = () => new Set([...Object.keys(settings().sets), GOAL_WORLD]);

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
        if (!m || m.is_user || m.is_system) continue;
        if (i === 0) continue; // the greeting is not a reply
        replies++;
        for (const it of m.extra?.[KEY]?.items || []) {
            const prev = last.get(it.key);
            if (it.kind === 'continuing' && prev) prev.version = it.version;
            else last.set(it.key, { start: replies, version: it.version });
            if (it.event) events.set(it.key, it.event);
        }
        // Writing style sets keep their category state on the reply even when nothing was sent that time.
        for (const [key, st] of Object.entries(m.extra?.[KEY]?.states || {})) events.set(key, st);
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
    for (const e of entries) {
        const st = state.get(e);
        if (st === 'continuing') { e.content = `@@activate\n${e.content || ''}`; e.useProbability = false; }
        else if (st === 'waiting') e.content = `@@dont_activate\n${e.content || ''}`;
    }
}

/** True when this instruction will be sent with the next reply anyway because it keeps sending. */
function keepsGoing(key) {
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
        const managed = managedWorlds();
        const arrays = [lore.globalLore, lore.characterLore, lore.chatLore, lore.personaLore].filter(Array.isArray);
        const cs = chatState();
        if (cs && Array.isArray(lore.chatLore)) {
            const present = new Set(arrays.flat().map(e => e.world));
            for (const name of cs.activeSets) {
                if (!managed.has(name) || present.has(name)) continue;
                const data = await loadBook(name).catch(() => null);
                if (!data?.entries) continue;
                lore.chatLore.push(...Object.values(data.entries).map(e => ({ ...e, world: name })));
            }
        }
        // The character goal travels as one entry that is made here for each scan.
        if (cs && Array.isArray(lore.chatLore) && !(gen && !gen.dryRun && gen.skip)) {
            const g = goals();
            if (g?.on && String(g.goal || '').trim() && !goalDone(g, goalProgress(gen && !gen.dryRun ? gen.type : 'normal'))) lore.chatLore.push(goalEntry());
        }
        for (const arr of arrays) {
            for (const e of arr) if (managed.has(e.world)) rawByKey.set(keyOf(e), { content: e.content, role: e.role });
        }
        // Requests that are not a reply from the character (impersonate, background requests) carry no instructions.
        if (gen && !gen.dryRun && gen.skip) {
            for (const arr of arrays) {
                for (let i = arr.length - 1; i >= 0; i--) if (managed.has(arr[i].world)) arr.splice(i, 1);
            }
            return;
        }
        if (cs) applyTiming(arrays.flat().filter(e => managed.has(e.world)), cs);
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
    const item = { key: keyOf(entry), world: entry.world, uid: entry.uid, name: String(entry.comment || `Instruction ${entry.uid}`), sentAs, version, text, misses, kind, repeat, status: 'sent', quote: '' };
    // A story event also keeps what the dice picked, and the state of its categories after this event.
    if (extra?.event || extra?.parts) { item.event = extra.event; item.parts = extra.parts; }
    if (extra?.noCheck) item.noCheck = true;
    if (extra && 'goalTask' in extra) { item.goalTask = extra.goalTask; item.checkText = extra.checkText; }
    return item;
}

/** Apply "How many instructions can be sent per reply" for one instruction set. Returns the new instructions to hold back. */
function applyLimit(world, fresh, continuing) {
    const o = setOptions(world);
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
    const kept = cs.overdue.filter(o => !o.from || times.has(o.from));
    const chat = ctx().chat || [];
    const last = chat[chat.length - 1];
    const rec = last && !last.is_user ? last.extra?.[KEY] : null;
    for (const it of rec?.items || []) {
        if (!['overdue', 'queued'].includes(it.status) || kept.some(o => o.key === it.key)) continue;
        kept.push({ key: it.key, world: it.world, uid: it.uid, name: it.name, sentAs: it.sentAs, version: it.version, misses: it.resend ?? Math.min(2, (it.misses || 0) + 1), from: rec.time, event: it.event, parts: it.parts });
    }
    if (JSON.stringify(kept) !== JSON.stringify(cs.overdue)) { cs.overdue = kept; saveChatState(); }
}

function onScanDone(args) {
    try {
        const st = settings();
        if (!st.enabled || !gen || gen.dryRun || gen.handled) return;
        if (args?.state?.next) return; // more passes follow; work on the final result only
        const map = args?.activated?.entries;
        if (!(map instanceof Map)) return;
        gen.handled = true;
        const cs = chatState();
        if (!cs) return;
        const managed = managedWorlds();
        const sorted = Array.isArray(args.sortedEntries) ? args.sortedEntries : [];
        const fired = [...map.values()].filter(e => managed.has(e.world));
        const isSticky = e => plan.continuing.has(keyOf(e));
        const type = gen.type;

        if (gen.skip) {
            for (const e of fired) map.delete(keyOf(e));
            return;
        }

        const len = scanLength(type);
        const items = [];
        let states = {};
        const find = key => sorted.find(e => keyOf(e) === key && managed.has(e.world) && !e.disable);
        reconcile();
        // Swipe, regenerate and continue send the same instructions again. The list comes from the last scan when it
        // was for this same reply, and otherwise from the record kept on the reply itself.
        const sameReply = cs.lastScan && cs.lastScan.len === len;
        const own = type === 'continue' || (type === 'swipe' && !sameReply) ? lastRecord() : null;
        const isRepeat = type === 'continue' || (['swipe', 'regenerate'].includes(type) && !pickAgain && (sameReply || !!own));

        if (isRepeat) {
            const before = own ? (own.items || []) : (type === 'continue' ? [] : (cs.lastScan.items || []));
            states = (own ? own.states : cs.lastScan.states) || {};
            for (const e of fired) map.delete(keyOf(e));
            for (const it of before) {
                const e = find(it.key);
                if (!e) continue;
                let misses = it.misses || 0;
                const od = type === 'continue' ? null : cs.overdue.find(o => o.key === it.key);
                if (od) { misses = od.misses; cs.overdue = cs.overdue.filter(o => o !== od); }
                map.set(it.key, e);
                let src = it;
                if (rerollCat && rerollCat.key === it.key && Array.isArray(it.parts)) {
                    // "Pick again" for one picked item: that category gets a new pick, everything else stays.
                    const again = rerollCategory(withPreset(e.extensions?.ri, cs.presets?.[e.world]), it.parts, it.event || states[it.key], rerollCat.catId);
                    if (again) {
                        src = { ...it, version: again.text, parts: again.parts, event: it.event ? again.state : it.event };
                        if (!it.event) states = { ...states, [it.key]: again.state };
                    }
                }
                items.push(makeItem(e, src.sentAs, src.version, misses, src.kind && src.kind !== 'repeat' ? src.kind : 'new', true, src));
            }
        } else {
            pickAgain = false;
            // Writing style is sent with every reply and stands apart from limits, holds and re-sends.
            const styles = fired.filter(isStyle);
            for (const e of styles) {
                const key = keyOf(e);
                const ri = e.extensions.ri;
                const rolled = rollEvent(withPreset(ri, cs.presets?.[e.world]), plan.events?.get(key) || null, { locks: cs.locks?.[key] });
                states[key] = rolled.state;
                if (!rolled.text) { map.delete(key); continue; }
                items.push(makeItem(e, ri.sentAs === 'ooc' ? 'ooc' : 'system', rolled.text, 0, 'new', false, { parts: rolled.parts, noCheck: true }));
            }
            // The character goal also stands apart: the goal line goes with every reply, and it has at most one task.
            for (const e of fired.filter(isGoal)) {
                const g = goals();
                const order = g ? buildGoalOrder(g, goalProgress(type)) : null;
                if (!order) { map.delete(keyOf(e)); continue; }
                items.push(makeItem(e, 'system', order.version, order.misses, 'new', false, { noCheck: order.noCheck, goalTask: order.task, checkText: order.checkText }));
            }
            const orders = fired.filter(e => !isStyle(e) && !isGoal(e));
            const continuing = orders.filter(isSticky);
            let fresh = orders.filter(e => !isSticky(e));
            const overdue = cs.overdue.filter(o => find(o.key));

            // Hold back new instructions while one is overdue, or apply each set's per-reply limit.
            let held = [];
            if (overdue.length && st.check.holdNew) {
                held = fresh;
            } else {
                for (const world of new Set(fresh.map(e => e.world))) {
                    held.push(...applyLimit(world, fresh.filter(e => e.world === world), continuing.filter(e => e.world === world)));
                }
            }
            for (const e of held) map.delete(keyOf(e));
            fresh = fresh.filter(e => !held.includes(e));

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
                    const rolled = rollEvent(withPreset(ri, cs.presets?.[e.world]), prev, { locks: cs.locks?.[key] });
                    if (!rolled) { map.delete(key); continue; }
                    items.push(makeItem(e, sentAs, rolled.text, 0, 'new', false, { event: rolled.state, parts: rolled.parts }));
                    continue;
                }
                const { sentAs, versions } = versionsOf(e);
                if (!versions.length) { map.delete(key); continue; }
                const kept = continuing.includes(e) ? plan.continuing.get(key) : null;
                const version = kept && versions.includes(kept) ? kept : pickVersion(cs, key, versions);
                items.push(makeItem(e, sentAs, version, 0, continuing.includes(e) ? 'continuing' : 'new'));
            }
        }

        cs.lastScan = { len, states, items: items.map(it => ({ key: it.key, sentAs: it.sentAs, version: it.version, misses: it.misses, kind: it.kind, event: it.event, parts: it.parts, noCheck: it.noCheck, ...('goalTask' in it ? { goalTask: it.goalTask, checkText: it.checkText } : {}) })) };
        pending = { items, type, states };
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

function onMessageReceived(id, type) {
    try {
        if (!pending || type === 'first_message') return;
        const m = ctx().chat?.[id];
        if (!m || m.is_user || m.is_system) return;
        const rec = { v: 1, items: pending.items, type: pending.type, time: Date.now(), agency: null, checking: false, note: '' };
        if (pending.states && Object.keys(pending.states).length) rec.states = pending.states;
        pending = null;
        // A reply that carried nothing still gets an (empty) record, so a later swipe knows to send nothing again.
        attach(m, rec);
        if (!rec.items.length) return;
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
    cs.overdue = cs.overdue.filter(o => o.key !== it.key);
    cs.overdue.push({ key: it.key, world: it.world, uid: it.uid, name: it.name, sentAs: it.sentAs, version: it.version, misses, from, event: it.event, parts: it.parts });
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
            const asked = results.filter(r => r && typeof r === 'object' && String(r.id) !== 'user');
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
            cs.overdue = cs.overdue.filter(o => !(o.key === it.key && (!o.from || o.from === rec.time)));
        } else if ('goalTask' in it) {
            // A one-time step of the character goal: it is sent again with every reply until it happens.
            it.quote = ''; it.status = 'pending';
        } else { it.quote = ''; if (markMissed(cs, it, rec.time)) anyOverdue = true; }
    });
    if (rec.items.some(it => it.goalTask && it.status === 'done') && advanceIfDone()) toast('success', 'The goal is done. The next goal from your list has started.');
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
        for (const msg of data.chat) {
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
        if (rec?.items?.length) out.push({ id: i, rec, isLast: i === chat.length - 1, name: chat[i].name });
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
    cs.overdue = cs.overdue.filter(o => o.key !== it.key);
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
    for (const m of ctx().chat || []) for (const it of m.extra?.[KEY]?.items || []) if (keys.has(it.key) && ['overdue', 'queued'].includes(it.status)) it.status = 'sent';
    touch(-1);
}

/** Pick again for one picked item of the newest reply, and write a new reply. */
export async function rerollPartNow(key, catId) {
    if (isGenerating()) { toast('info', 'Wait for the current reply to finish.'); return; }
    rerollCat = { key, catId };
    await triggerSwipe();
}

/** Lock one category's pick for this chat, or unlock it (ids = null). */
export function setLock(key, catId, ids) {
    const cs = chatState();
    if (!cs) return;
    if (ids && ids.length) { cs.locks[key] = { ...(cs.locks[key] || {}), [catId]: [...ids] }; }
    else if (cs.locks[key]) { delete cs.locks[key][catId]; if (!Object.keys(cs.locks[key]).length) delete cs.locks[key]; }
    saveChatState();
    changed('checked', -1);
}

export function isLocked(key, catId) {
    return !!chatState()?.locks?.[key]?.[catId];
}

/** Roll this reply's instructions again and write a new reply. */
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
        gen = { type: String(type || 'normal'), dryRun: !!dryRun, skip: type === 'impersonate' || type === 'quiet' || !!opts?.quiet_prompt, handled: false };
        if (!dryRun && !gen.skip) pending = null;
    });
    on('GENERATION_AFTER_COMMANDS', async (_type, _opts, dryRun) => {
        if (dryRun || !settings().enabled || !checkPromise) return;
        // Let a running check finish first, so an instruction that did not happen can be sent again with this reply.
        await Promise.race([checkPromise, new Promise(r => setTimeout(r, 20000))]);
    });
    on('MESSAGE_RECEIVED', onMessageReceived);
    on('GENERATION_ENDED', () => { gen = null; });
    on('GENERATION_STOPPED', () => { gen = null; pending = null; pickAgain = false; rerollCat = null; });
    on('CHAT_COMPLETION_PROMPT_READY', onPromptReady);
    on('CHAT_CHANGED', () => {
        gen = null; pending = null; pickAgain = false; checkPromise = null;
        rawByKey.clear();
        if (isChatOpen()) { applyPronouns(); if (settings().enabled) reconcile(); }
        changed('chat');
    });
    for (const name of ['MESSAGE_SWIPED', 'MESSAGE_UPDATED']) on(name, () => changed('messages'));
    on('MESSAGE_DELETED', () => { if (settings().enabled) reconcile(); changed('messages'); });
    on('MESSAGE_EDITED', (id) => {
        // Editing the newest reply by hand can make an instruction happen, or remove it. Check that reply again.
        id = Number(id);
        if (settings().enabled && id === (ctx().chat || []).length - 1 && !isGenerating()) checkAgain(id);
        changed('messages');
    });
    return missing;
}
