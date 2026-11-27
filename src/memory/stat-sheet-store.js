// Stat sheets as memory records (memory DESIGN 3.3 and 7.7, MB14). Each actor's sheet is one Stat sheet record in the chat
// metadata log, kind 'stat sheet', id 'sheet:<subject>' (subject 'user', 'char' or 'npc:<folded name>'), holding
// { subject, who, actor, stats, reasons, locks, source, book, plain, text }. B22's src/stat-sheets.js keeps the inference
// call and the World Info entry; once this store is installed it reads every sheet from here and sends every write here.
//
// Anchors decide what survives what (DESIGN 3.4):
//   persona and character: the chat's first message, so every branch keeps them;
//   an NPC described in World Info: the first message too, because its base sheet lives in that book;
//   an NPC who first appears during play: the reply where they first appeared, so deleting or swiping that reply away
//     removes the sheet, and the next appearance infers it again.
//
// A stat she sets is a `you` entry that names the stat and its value (record.set). The value shown for that stat is
// replayed from her own entries, so no inference, level-up capture, rebuild or catch-up can change it, whatever those
// writes carry; she gives a stat back with a `you` entry that releases it. A sheet carried over locked stays locked by the
// fold's own lock. Stats an import or carry-over set are kept too: inference fills only the stats a sheet lacks.
import { MEMORY, chatMemory, ensureMarks, fold, forgetFold, makeEntry, storedMark, swipeEntries, swipeOf } from './fold.js';
import { MOD_MIN, MOD_MAX, INFER_MIN, INFER_MAX, statNames, subjectOf } from '../stat-sheets.js';

export const SHEET_KIND = 'stat sheet';
export const KEPT_ORIGINS = Object.freeze(['import', 'carry-over']);

const fold1 = value => String(value ?? '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));
const clip = (text, n) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const actorKind = subject => subject === 'user' ? 'persona' : subject === 'char' ? 'character' : 'npc';
export const sheetId = subject => `sheet:${subject}`;

/** "Strength +2, Wits -1": the text a sheet record carries, which carry-over and History read. */
export function sheetText(stats) {
    return clip(Object.entries(stats || {}).map(([stat, value]) => `${stat} ${value > 0 ? '+' : ''}${value}`).join(', '), 300);
}

/** Stats read back from a sheet text ("Strength 2, Wits -1" or "Strength +2"). */
export function statsFromText(text, known = statNames()) {
    const out = {};
    const names = new Set(known);
    for (const m of String(text || '').matchAll(/([\p{L}][\p{L} ]*?)\s*:?\s*([+-]?\d+)/gu)) {
        const stat = m[1].trim();
        if (names.has(stat)) out[stat] = clamp(m[2], MOD_MIN, MOD_MAX);
    }
    return out;
}

const statsOfRecord = record => record?.stats && typeof record.stats === 'object' ? { ...record.stats } : statsFromText(record?.text);

/**
 * The store over a host: { chat(), meta(), save(), now(), names() { user, char }, legacy() (B22's per-chat sheets, for the
 * move), bookLevel(name) ('off' | 'keywords' | 'full' | '') }.
 */
export function createSheetStore(host) {
    const chat = () => host.chat() || [];
    const meta = () => host.meta() || {};
    const subjectFor = who => {
        if (who === 'user' || who === 'char') return who;
        if (String(who).startsWith('npc:')) return String(who);
        return subjectOf(who);
    };

    /** Every entry that counts now, by id, with its record (showing swipes and the chat log). */
    function entriesById() {
        const map = new Map();
        for (const message of chat()) for (const e of swipeEntries(message)) if (e?.id) map.set(e.id, e);
        for (const e of meta()[MEMORY]?.log || []) if (e?.id) map.set(e.id, e);
        return map;
    }

    /** The sheet records of the chat as it stands, grouped by subject: { [subject]: sheet }. */
    function sheets() {
        const result = fold(chat(), meta());
        const byId = entriesById();
        const out = {};
        const herValues = new Map();
        const recs = result.current.filter(r => r.kind === SHEET_KIND)
            .sort((a, b) => (a.versions.at(-1)?.at || 0) - (b.versions.at(-1)?.at || 0));
        for (const rec of recs) {
            const subject = rec.who || subjectFor(rec.subject);
            const known = new Set(statNames());
            const base = statsOfRecord(rec);
            const mine = {}, kept = new Set();
            let origin = null;
            for (const id of rec.entries || []) {
                const e = byId.get(id);
                if (!e?.record) continue;
                const type = e.origin?.type;
                if (type === 'you') {
                    for (const [stat, value] of Object.entries(e.record.set || {})) mine[stat] = clamp(value, MOD_MIN, MOD_MAX);
                    for (const stat of [].concat(e.record.release || [])) delete mine[stat];
                } else if (KEPT_ORIGINS.includes(type)) {
                    const set = statsOfRecord(e.record);
                    for (const stat of Object.keys(set)) kept.add(stat);
                    for (const stat of [].concat(e.record.locks || [])) if (set[stat] !== undefined) mine[stat] = set[stat];
                }
                origin ||= e.origin;
            }
            // A sheet the fold locks whole (carried over locked) is hers in every stat.
            if (rec.locked) for (const [stat, value] of Object.entries(base)) if (mine[stat] === undefined) mine[stat] = value;
            const prev = out[subject];
            const hers = { ...(herValues.get(subject) || {}), ...mine };
            herValues.set(subject, hers);
            const stats = { ...(prev?.stats || {}), ...Object.fromEntries(Object.entries(base).filter(([s]) => known.has(s)).map(([s, v]) => [s, clamp(v, MOD_MIN, MOD_MAX)])), ...hers };
            const last = rec.versions.at(-1) || {};
            out[subject] = {
                id: rec.id, ids: [...(prev?.ids || []), rec.id], subject, name: rec.subject || prev?.name || '', kind: rec.actor || actorKind(subject),
                stats, reasons: { ...(prev?.reasons || {}), ...(rec.reasons || {}) },
                mine: Object.fromEntries(Object.keys(hers).map(s => [s, true])),
                kept: [...new Set([...(prev?.kept || []), ...kept, ...Object.keys(hers)])],
                source: rec.source || prev?.source || (origin?.type === 'you' ? 'you' : origin?.type || ''), route: last.origin?.route || '', model: last.origin?.model || '',
                ...(rec.book ? { book: rec.book } : {}), ...(rec.plain && !Object.keys(stats).length ? { plain: true } : {}),
                anchor: rec.versions[0]?.anchor || null, locked: !!rec.locked, at: last.at || 0,
            };
        }
        return out;
    }

    const sheet = who => sheets()[subjectFor(who)] || null;

    // ------------------------------------------------------------ anchors

    // Every message gets its mark before an anchor is read (fold.js); a mark added is saved with the chat.
    const marks = () => { if (ensureMarks(chat()) > 0) host.saveChat?.(); };
    const firstMark = () => { marks(); const first = chat()[0]; return first ? storedMark(first) : ''; };

    /** Where an NPC first appeared: the newest message naming them, a reply with its swipe. */
    function appearance(name, hintIndex = null) {
        marks();
        const list = chat();
        const at = Number.isInteger(hintIndex) && list[hintIndex] ? hintIndex : (() => {
            const target = fold1(name);
            if (!target) return -1;
            const pattern = new RegExp(`(^| )${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`);
            for (let i = list.length - 1; i >= 0; i--) if (pattern.test(fold1(list[i]?.mes))) return i;
            return list.length - 1;
        })();
        const message = list[at];
        if (!message) return null;
        return message.is_user ? { mark: storedMark(message) } : { mark: storedMark(message), swipe: swipeOf(message) };
    }

    const hints = new Map();   // subject -> chat index where capture saw the NPC first
    /** Tell the store where an NPC first appeared, before their sheet is inferred (capture's Person record). */
    const appearedAt = (who, index) => { hints.set(subjectFor(who), index); };

    function anchorFor(subject, source, existing) {
        // The persona's, the character's and a World Info NPC's sheets hang on the first message, even when a plain sheet
        // stood in for the NPC on a reply before their entry was found.
        if (subject === 'user' || subject === 'char' || source === 'book') { const mark = firstMark(); return mark ? { mark } : null; }
        if (existing?.anchor?.mark) return { mark: existing.anchor.mark, ...(Number.isInteger(existing.anchor.swipe) ? { swipe: existing.anchor.swipe } : {}) };
        return appearance(existing?.name || subject.replace(/^npc:/, ''), hints.get(subject));
    }

    // ------------------------------------------------------------ writes

    function write(inputs) {
        marks();
        const mem = chatMemory(meta());
        const made = inputs.map(input => {
            mem.seq += 1;
            return makeEntry(input, { seq: mem.seq, at: host.now() });
        });
        mem.log = [...mem.log, ...made];
        forgetFold(meta());
        host.save();
        return made;
    }

    function recordFor(subject, name, fields, existing) {
        return { id: existing?.id || sheetId(subject), kind: SHEET_KIND, subject: clip(name || existing?.name || subject, 80), who: subject, actor: actorKind(subject), importance: 5, ...fields };
    }

    /** Store what an inference found. Stats she set, and stats an import or carry-over set, stay as they are. */
    function inferred(who, { name = '', stats = {}, reasons = {}, source = 'card', route = '', model = '', book = '' } = {}, { origin = 'inference', reason = '', anchor = undefined } = {}) {
        const subject = subjectFor(who);
        const existing = sheet(subject);
        const known = new Set(statNames());
        const kept = new Set(existing?.kept || []);
        const next = { ...(existing?.stats || {}) };
        const why = { ...(existing?.reasons || {}) };
        for (const [stat, value] of Object.entries(stats || {})) {
            if (!known.has(stat) || kept.has(stat)) continue;
            next[stat] = origin === 'inference' ? clamp(value, INFER_MIN, INFER_MAX) : clamp(value, MOD_MIN, MOD_MAX);
            if (reasons?.[stat]) why[stat] = clip(reasons[stat], 160);
        }
        const fields = { stats: next, reasons: why, locks: Object.keys(existing?.mine || {}), text: sheetText(next), source: existing?.source === 'you' ? 'you' : source, plain: false, ...(book || existing?.book ? { book: book || existing.book } : {}) };
        write([{ op: existing ? 'revise' : 'add', ...(existing ? { target: [existing.id] } : {}), record: recordFor(subject, name, fields, existing),
            origin: { type: origin, route, model }, anchor: anchor === undefined ? anchorFor(subject, source, existing) : anchor,
            reason: reason || (origin === 'inference' ? `Stat sheet inferred from ${source === 'book' ? `the World Info book${book ? ` "${book}"` : ''}` : source === 'play' ? 'the story so far' : 'the persona and the card'}.` : 'Stat sheet changed.') }]);
        return sheet(subject);
    }

    /** A stat she sets: a `you` entry that locks that stat. */
    function byHand(who, stat, value, name = '') {
        const subject = subjectFor(who);
        const existing = sheet(subject);
        const v = clamp(value, MOD_MIN, MOD_MAX);
        const next = { ...(existing?.stats || {}), [stat]: v };
        const locks = [...new Set([...Object.keys(existing?.mine || {}), stat])];
        write([{ op: existing ? 'revise' : 'add', ...(existing ? { target: [existing.id] } : {}),
            record: recordFor(subject, name, { stats: next, locks, text: sheetText(next), set: { [stat]: v }, ...(existing ? {} : { source: 'you' }), plain: false }, existing),
            origin: { type: 'you' }, anchor: anchorFor(subject, existing?.source || 'play', existing), reason: `You set ${stat} to ${v > 0 ? '+' : ''}${v}.` }]);
        return sheet(subject);
    }

    /** Give a stat back to inference. */
    function release(who, stat) {
        const subject = subjectFor(who);
        const existing = sheet(subject);
        if (!existing?.mine?.[stat]) return false;
        write([{ op: 'revise', target: [existing.id], record: recordFor(subject, existing.name, { locks: Object.keys(existing.mine).filter(s => s !== stat), release: [stat] }, existing),
            origin: { type: 'you' }, anchor: anchorFor(subject, existing.source, existing), reason: `You gave ${stat} back to inference.` }]);
        return true;
    }

    /** A plain sheet, every modifier 0, for an actor with none yet; an attempt rolls on it while inference is queued. */
    function plain(who, name = '', source = 'play') {
        const subject = subjectFor(who);
        const existing = sheet(subject);
        if (existing) return existing;
        write([{ op: 'add', record: recordFor(subject, name, { stats: {}, reasons: {}, text: '', source, plain: true }, null),
            origin: { type: 'inference', route: 'code' }, anchor: anchorFor(subject, source, null), reason: 'A plain sheet until its inference answers.' }]);
        return sheet(subject);
    }

    /**
     * A level-up that capture files from the story: changes by stat, anchored to the reply it came from (index), so it
     * reverts with that reply. Her stats stay as she set them.
     */
    function levelUp(who, changes = {}, { index = null, route = '', model = '', reason = 'Level-up from the story.' } = {}) {
        const existing = sheet(who);
        if (!existing) return null;
        const stats = {};
        for (const [stat, delta] of Object.entries(changes || {})) stats[stat] = (existing.stats[stat] || 0) + Number(delta || 0);
        marks();
        const message = Number.isInteger(index) ? chat()[index] : null;
        const anchor = message ? { mark: storedMark(message), ...(message.is_user ? {} : { swipe: swipeOf(message) }) } : undefined;
        return inferred(who, { name: existing.name, stats, source: existing.source, route, model }, { origin: 'capture', reason, anchor });
    }

    /** Whether the NPC's base sheet may be added to a book: at any "Story may add to this book" level except Off. */
    const mayAddToBook = book => (host.bookLevel?.(book) || '') !== 'off';

    /** Log the added "Stats: <name>" entry in the chat's additions log, so History lists it with Undo (MB7). */
    function addedToBook(book, uid, entry) {
        const mem = chatMemory(meta());
        if (!Array.isArray(mem.additions)) mem.additions = [];
        if (mem.additions.some(row => row.book === book && String(row.uid) === String(uid) && row.kind === 'entry' && row.state === 'live')) return null;
        const id = `a${mem.additions.reduce((n, row) => Math.max(n, Number(String(row.id).slice(1)) || 0), 0) + 1}`;
        const mark = firstMark();
        // A row with no source would read as gone and be taken back at the next reconcile.
        if (!mark) return null;
        const row = { id, book, uid, kind: 'entry', value: String(entry?.content ?? ''), keys: [].concat(entry?.key || []), source: { mark }, at: host.now(), state: 'live', what: 'stat sheet' };
        mem.additions.push(row);
        host.save();
        return row;
    }

    // ------------------------------------------------------------ the move from B22's per-chat sheets

    /** B22 kept sheets in chat state before this store. They become records once: inferred values as inference, hers as hers. */
    function moveLegacy() {
        const mem = chatMemory(meta());
        if (mem.sheetsMoved) return 0;
        const legacy = host.legacy?.() || {};
        const have = new Set(fold(chat(), meta()).current.filter(r => r.kind === SHEET_KIND).map(r => r.who || subjectFor(r.subject)));
        const inputs = [];
        for (const [subject, old] of Object.entries(legacy)) {
            if (!old || typeof old !== 'object' || have.has(subject)) continue;
            const stats = Object.fromEntries(Object.entries(old.stats || {}).map(([s, v]) => [s, clamp(v, MOD_MIN, MOD_MAX)]));
            const anchor = subject === 'user' || subject === 'char' || old.source === 'book' ? (firstMark() ? { mark: firstMark() } : null) : appearance(old.name || subject);
            const id = sheetId(subject);
            inputs.push({ op: 'add', record: { id, kind: SHEET_KIND, subject: clip(old.name || subject, 80), who: subject, actor: actorKind(subject), importance: 5, stats, reasons: { ...(old.reasons || {}) },
                text: sheetText(stats), source: old.source || 'card', ...(old.book ? { book: old.book } : {}), ...(old.plain ? { plain: true } : {}) },
                origin: { type: 'inference', route: old.route || '', model: old.model || '' }, anchor, reason: 'Stat sheet moved into memory from this chat\'s saved sheets.' });
            const hers = Object.keys(old.mine || {}).filter(s => old.mine[s] && stats[s] !== undefined);
            if (hers.length) inputs.push({ op: 'revise', target: [id], record: { id, kind: SHEET_KIND, who: subject, locks: hers, set: Object.fromEntries(hers.map(s => [s, stats[s]])) },
                origin: { type: 'you' }, anchor, reason: 'Your values, moved with the sheet.' });
        }
        mem.sheetsMoved = host.now();
        if (inputs.length) write(inputs); else host.save();
        return inputs.length;
    }

    return { sheets, sheet, inferred, byHand, release, plain, levelUp, mayAddToBook, addedToBook, appearedAt, moveLegacy };
}

// ---------------------------------------------------------------- the host

/** The store wired to SillyTavern's open chat. */
export async function hostSheetStore() {
    const st = await import('../st.js');
    const store = await import('../store.js');
    const ctx = () => st.ctx();
    return createSheetStore({
        chat: () => (st.isChatOpen() ? ctx().chat : []) || [],
        meta: () => (st.isChatOpen() ? ctx().chatMetadata : {}) || {},
        save: () => { try { (ctx().saveMetadataDebounced || ctx().saveMetadata)?.(); } catch { /* not fatal */ } },
        saveChat: () => { try { (ctx().saveChatDebounced || ctx().saveChatConditional)?.(); } catch { /* not fatal */ } },
        now: () => Date.now(),
        legacy: () => { try { return ctx().chatMetadata?.[st.KEY]?.statSheets || {}; } catch { return {}; } },
        bookLevel: name => String(store.settings().memory?.bookAdditions?.[name] || ''),
    });
}

let installed = null;

/**
 * Put the store under B22's stat sheets (src/stat-sheets.js reads and writes through it) and give NPCs met in capture
 * their sheets at first appearance. Called once from the dice wiring.
 */
export async function installSheetStore() {
    if (installed) return installed;
    const sheetsMod = await import('../stat-sheets.js');
    const store = await hostSheetStore();
    const st = await import('../st.js');
    // Reads and writes need an open chat; with none, B22's own path answers (it stores nothing either).
    const guarded = Object.fromEntries(Object.entries(store).map(([name, fn]) => [name, (...args) => (st.isChatOpen() ? fn(...args) : name === 'sheets' ? {} : null)]));
    sheetsMod.setSheetRecords(guarded);
    installed = guarded;
    // B22's per-chat sheets move into records when a chat opens, before anything infers or edits.
    guarded.moveLegacy();
    st.on('CHAT_CHANGED', () => { try { guarded.moveLegacy(); } catch (error) { console.warn(st.LOG, 'stat sheet move', error); } });
    try {
        const capture = await import('./capture.js');
        const { diceOn } = await import('../dice.js');
        capture.onCapture(event => {
            if (event?.phase !== 'done' || !event.result?.committed || !diceOn()) return;
            for (const person of newPeople(event.result.entries, st.names())) {
                store.appearedAt(person, event.index);
                if (store.sheet(person)) continue;
                sheetsMod.inferNpcSheet(person, { storyText: storyAbout(person, st.ctx()) }).catch(error => console.warn(st.LOG, 'NPC stat sheet', error));
            }
        });
    } catch (error) { console.warn('[Roleplay Instructions]', 'NPC stat sheets at first appearance', error); }
    return installed;
}

/** The NPCs a capture just filed as new Person records: never the persona or the character, at most two a reply. */
export function newPeople(entries = [], who = {}) {
    const skip = new Set([who.user, who.char].map(fold1));
    const out = [];
    for (const e of entries || []) {
        if (e?.op !== 'add' || e.record?.kind !== 'person') continue;
        const name = clip(e.record.subject, 80);
        if (!name || skip.has(fold1(name)) || out.some(n => fold1(n) === fold1(name))) continue;
        out.push(name);
    }
    return out.slice(0, 2);
}

/** What capture has filed about an NPC, as the text their sheet is inferred from. */
export function storyAbout(name, c) {
    const result = fold(c.chat || [], c.chatMetadata || {});
    const target = fold1(name);
    return result.current.filter(r => r.kind !== SHEET_KIND && (fold1(r.subject) === target || (r.aliases || []).some(a => fold1(a) === target)))
        .map(r => clip(r.text, 300)).filter(Boolean).slice(0, 12).join('\n');
}
