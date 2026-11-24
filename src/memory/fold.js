// The fold (memory DESIGN 3.1 to 3.5): replays the change entries that belong to the chat as it stands and yields the
// current-state set. Pure code over SillyTavern's chat shape, so tests run it with no host.
//
// Where entries live (DESIGN 2.1):
//   message.extra.ri_memory = { mark, entries }             per-reply entries of the showing swipe, also kept in
//   message.swipe_info[k].extra.ri_memory                    the matching swipe slot, so a swipe carries its own
//   chat_metadata.ri_memory = { v, seq, log, ... }           range entries (chapters, imports, your edits, upkeep)
//
// An entry counts when its anchor message is in the chat, shows the anchored swipe and still hashes the same; when every
// source revision it `depends` on is present; when no revert cancels it; and when every entry it depends on still counts.
// Entries apply in story order of their anchor, then save time, then id. An entry is never edited after it is saved:
// each carries a checksum, and one that no longer matches it is held out and named in History.

export const MEMORY = 'ri_memory';
export const OPS = Object.freeze(['add', 'revise', 'supersede', 'retire', 'merge', 'complete', 'link', 'keep', 'flag', 'revert', 'lock']);
export const ORIGINS = Object.freeze(['capture', 'chapter', 'upkeep', 'catch-up', 'carry-over', 'import', 'inference', 'you']);
export const RANGE_KINDS = Object.freeze(['chapter', 'condensed', 'arc']);
export const OUT_OF_FORCE = Object.freeze(['retired', 'replaced', 'merged']);
const TEXT_MAX = 300, RANGE_MAX = 4000, REASON_MAX = 160, QUOTE_MAX = 200;

/** A short mark for a text (FNV-1a, 32 bits, 8 hex digits), the same function as the queue's revOf. */
export function hashText(text) {
    let hash = 0x811c9dc5;
    for (const ch of String(text ?? '')) {
        hash ^= ch.codePointAt(0);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

/** The prose a reply's revision is read from: the shown text without the extension's sent-instructions block. */
export const proseOf = message => String(message?.mes ?? '').replace(/\s*<sent_instructions>[\s\S]*?<\/sent_instructions>/gi, '').trim();
export const swipeOf = message => Number.isInteger(message?.swipe_id) ? message.swipe_id : 0;

/** A JSON string with sorted keys, so the same value always prints the same. */
export function canonical(value) {
    if (value === undefined) return 'null';
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

// ---------------------------------------------------------------- message marks

/** The mark stored on a message: in its extra, or in any swipe slot. Empty when none was ever written. */
export function storedMark(message) {
    const own = message?.extra?.[MEMORY]?.mark;
    if (own) return String(own);
    for (const info of message?.swipe_info || []) if (info?.extra?.[MEMORY]?.mark) return String(info.extra[MEMORY].mark);
    return '';
}

/** A new mark: the first send time plus a hash of the first swipe's text and speaker (DESIGN 1). Written once, never recomputed. */
export function newMark(message, index = 0) {
    const first = message?.swipe_info?.[0]?.send_date || message?.send_date || '';
    const time = Date.parse(first);
    const text = Array.isArray(message?.swipes) && typeof message.swipes[0] === 'string' ? message.swipes[0] : String(message?.mes ?? '');
    const stamp = Number.isFinite(time) ? time.toString(36) : `i${index}`;
    return `m${stamp}-${hashText(`${message?.is_user ? 'u' : 'a'}|${message?.name || ''}|${text}`).slice(0, 6)}`;
}

function holderOf(message, swipe, create) {
    if (!message) return null;
    if (swipe === swipeOf(message)) {
        if (create && (!message.extra || typeof message.extra !== 'object')) message.extra = {};
        return message.extra || null;
    }
    const info = message.swipe_info?.[swipe];
    if (!info) return null;
    if (create && (!info.extra || typeof info.extra !== 'object')) info.extra = {};
    return info.extra || null;
}

function writeMark(message, mark) {
    const own = holderOf(message, swipeOf(message), true);
    own[MEMORY] = { ...(own[MEMORY] || {}), mark };
    for (const info of message.swipe_info || []) {
        if (!info || typeof info !== 'object') continue;
        if (!info.extra || typeof info.extra !== 'object') info.extra = {};
        if (info.extra[MEMORY]?.mark !== mark) info.extra[MEMORY] = { ...(info.extra[MEMORY] || {}), mark };
    }
}

/** Give every message a mark, keeping the ones it has. Returns the number of messages that got a new mark. */
export function ensureMarks(chat) {
    const used = new Set();
    let added = 0;
    (chat || []).forEach((message, index) => {
        if (!message) return;
        let mark = storedMark(message);
        if (mark) {
            // A stored mark that has not yet reached every swipe slot is copied there.
            if (message.extra?.[MEMORY]?.mark !== mark || (message.swipe_info || []).some(info => info && info.extra?.[MEMORY]?.mark !== mark)) writeMark(message, mark);
            used.add(mark);
            return;
        }
        mark = newMark(message, index);
        for (let n = 2; used.has(mark); n++) mark = `${newMark(message, index)}-${n}`;
        writeMark(message, mark);
        used.add(mark);
        added += 1;
    });
    return added;
}

/** The revision of the swipe a message shows: { mark, swipe, hash }. */
export function revisionOf(message) {
    return { mark: storedMark(message), swipe: swipeOf(message), hash: hashText(proseOf(message)) };
}

/** The per-reply entries of one swipe of a message. */
export function swipeEntries(message, swipe = swipeOf(message)) {
    const holder = holderOf(message, swipe, false);
    const list = holder?.[MEMORY]?.entries;
    return Array.isArray(list) ? list : [];
}

/** The chat-level part of memory in chat metadata, created when absent. */
export function chatMemory(meta) {
    if (!meta[MEMORY] || typeof meta[MEMORY] !== 'object') meta[MEMORY] = {};
    const mem = meta[MEMORY];
    if (mem.v !== 1) mem.v = 1;
    if (!Array.isArray(mem.log)) mem.log = [];
    if (!Number.isInteger(mem.seq)) mem.seq = 0;
    return mem;
}

// ---------------------------------------------------------------- entries

const clip = (text, max) => {
    const value = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (value.length <= max) return value;
    const cut = value.slice(0, max);
    return cut.replace(/\s+\S*$/, '') || cut;
};
const isSource = value => value && typeof value === 'object' && typeof value.mark === 'string' && value.mark;
const readSource = value => ({ mark: String(value.mark), ...(Number.isInteger(value.swipe) ? { swipe: value.swipe } : {}), ...(value.hash ? { hash: String(value.hash) } : {}) });

function readRecordInput(record) {
    if (!record || typeof record !== 'object') return null;
    const out = structuredClone(record);
    if (out.id !== undefined) out.id = String(out.id);
    if (out.text !== undefined) out.text = clip(out.text, RANGE_KINDS.includes(out.kind) ? RANGE_MAX : TEXT_MAX);
    if (out.importance !== undefined) out.importance = Math.max(1, Math.min(10, Math.round(Number(out.importance) || 5)));
    if (out.holders !== undefined && out.holders !== null) out.holders = [].concat(out.holders).map(String);
    if (out.aliases !== undefined) out.aliases = [].concat(out.aliases || []).map(String);
    return out;
}

/** The checksum of an entry: a hash of everything in it except the checksum itself. */
export const entrySum = entry => hashText(canonical({ ...entry, sum: undefined }));

function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const key of Object.keys(value)) deepFreeze(value[key]);
    }
    return value;
}

/**
 * Make one change entry in the shape of DESIGN 3.2. seq and at come from the caller (the chat's counter and the clock).
 * The result is frozen; saving it is the caller's job.
 */
export function makeEntry(input, { seq, at }) {
    if (!OPS.includes(input?.op)) throw new Error(`Unknown change entry op: ${input?.op}`);
    const origin = typeof input.origin === 'string' ? { type: input.origin } : { ...(input.origin || {}) };
    if (!ORIGINS.includes(origin.type)) throw new Error(`Unknown change entry origin: ${origin.type}`);
    const entry = {
        id: String(input.id || `e${Number(at).toString(36)}${Number(seq).toString(36)}`),
        op: input.op,
        target: [].concat(input.target || []).filter(item => item !== undefined && item !== null && item !== '').map(String),
        record: readRecordInput(input.record),
        evidence: [].concat(input.evidence || []).filter(Boolean).slice(0, 3).map(quote => ({
            ...(quote.mark ? { mark: String(quote.mark) } : {}), ...(Number.isInteger(quote.swipe) ? { swipe: quote.swipe } : {}), quote: clip(quote.quote, QUOTE_MAX),
        })),
        origin: Object.fromEntries(Object.entries(origin).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)])),
        anchor: isSource(input.anchor) ? readSource(input.anchor) : null,
        depends: [].concat(input.depends || []).filter(Boolean).map(item => isSource(item) ? readSource(item) : item.entry ? { entry: String(item.entry) } : null).filter(Boolean),
        reason: clip(input.reason, REASON_MAX),
        at: Number(at),
        seq: Number(seq),
    };
    if (!entry.record) delete entry.record;
    if (!entry.evidence.length) delete entry.evidence;
    if (!entry.depends.length) delete entry.depends;
    if (!entry.target.length) delete entry.target;
    if (!entry.reason) delete entry.reason;
    entry.sum = entrySum(entry);
    return deepFreeze(entry);
}

// ---------------------------------------------------------------- the fold

const where = new WeakMap();   // the cache: meta object -> { key, value }

/** The key a fold is cached under: every message's mark, swipe, text hash and entry count, and the log's length. */
export function foldKey(chat, meta, before = Infinity) {
    const parts = (chat || []).map(message => `${storedMark(message)}:${swipeOf(message)}:${hashText(proseOf(message))}:${swipeEntries(message).length}`);
    return `${hashText(parts.join('|'))}#${(meta?.[MEMORY]?.log || []).length}#${Number.isFinite(before) ? before : 'all'}`;
}

/** Drop the cached fold of a chat, for a caller that wrote entries in place. */
export const forgetFold = meta => { if (meta) where.delete(meta); };

const NOTE = {
    gone: 'no longer applies: its message is not in this chat',
    swipe: 'no longer applies: its reply shows another version',
    edited: 'held out: its reply was edited and waits to be captured again',
    source: 'no longer applies: a message it read changed or left the chat',
    depends: 'no longer applies: an entry it depended on was reverted',
    reverted: 'reverted',
    changed: 'held out: the entry changed after it was saved',
    later: 'held out for this request: its reply is being written again',
    locked: 'held for review: the record is locked',
};

/**
 * Fold a chat. chat: SillyTavern's message list; meta: its chat metadata.
 * before: a chat index; per-reply entries of that message and later ones are left out (a swipe or regenerate request).
 * Returns { records, current, byId, flags, history, applied, dropped, notes, locked, key }.
 */
export function fold(chat, meta, { before = Infinity, cache = true } = {}) {
    const key = foldKey(chat, meta, before);
    const hit = cache && meta ? where.get(meta) : null;
    if (hit && hit.key === key) return hit.value;

    const index = new Map();
    (chat || []).forEach((message, i) => { const mark = storedMark(message); if (mark && !index.has(mark)) index.set(mark, i); });
    const present = source => {
        const i = index.get(source.mark);
        if (i === undefined) return 'gone';
        const message = chat[i];
        if (Number.isInteger(source.swipe) && source.swipe !== swipeOf(message)) return 'swipe';
        if (source.hash && source.hash !== hashText(proseOf(message))) return 'edited';
        return '';
    };

    // Every entry with where it was found: per-reply entries of the showing swipes, then the chat log.
    const found = [];
    // A swipe slot can hold copies of another swipe's entries (SillyTavern clones extra into a new swipe); only its own count.
    (chat || []).forEach((message, i) => { for (const entry of swipeEntries(message)) if (!Number.isInteger(entry?.anchor?.swipe) || entry.anchor.swipe === swipeOf(message)) found.push({ entry, at: i, reply: true }); });
    for (const entry of meta?.[MEMORY]?.log || []) found.push({ entry, at: entry.anchor ? index.get(entry.anchor.mark) ?? -1 : -1, reply: false });

    const notes = new Map();
    const valid = [];
    for (const item of found) {
        const e = item.entry;
        if (!e || typeof e !== 'object' || !e.id) continue;
        if (e.sum && entrySum(e) !== e.sum) { notes.set(e.id, NOTE.changed); continue; }
        if (item.reply && Number.isFinite(before) && item.at >= before) { notes.set(e.id, NOTE.later); continue; }
        const anchorState = e.anchor ? present(e.anchor) : '';
        if (anchorState) { notes.set(e.id, NOTE[anchorState]); continue; }
        const dep = (e.depends || []).filter(isSource).map(present).find(Boolean);
        if (dep) { notes.set(e.id, NOTE.source); continue; }
        valid.push(item);
    }

    // Reverts, in save order: a revert cancels its target; a revert of that revert brings the target back.
    const reverted = new Set();
    const bySeq = [...valid].sort((a, b) => (a.entry.seq - b.entry.seq) || (a.entry.at - b.entry.at) || (a.entry.id < b.entry.id ? -1 : 1));
    const revertsOf = new Map();
    for (const { entry } of bySeq) if (entry.op === 'revert') for (const t of entry.target || []) (revertsOf.get(t) || revertsOf.set(t, []).get(t)).push(entry.id);
    const isReverted = (id, seen = new Set()) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return (revertsOf.get(id) || []).some(r => !isReverted(r, seen));
    };
    const reverts = [];
    for (const { entry } of valid) {
        if (entry.op === 'revert') { if (isReverted(entry.id)) notes.set(entry.id, NOTE.reverted); else reverts.push(entry.id); continue; }
        if (isReverted(entry.id)) { reverted.add(entry.id); notes.set(entry.id, NOTE.reverted); }
    }

    // An entry that depends on a version a revert removed drops out with it, to a fixed point (3.2). A version that left
    // with its message (a swipe, a delete, a branch) takes nothing else with it: a swipe changes no other reply's records.
    const dead = new Set(reverted);
    for (let changed = true; changed;) {
        changed = false;
        for (const { entry } of valid) {
            if (dead.has(entry.id) || entry.op === 'revert') continue;
            if ((entry.depends || []).some(item => item.entry && dead.has(item.entry))) { dead.add(entry.id); notes.set(entry.id, NOTE.depends); changed = true; }
        }
    }
    const live = new Set(valid.filter(item => item.entry.op !== 'revert' && !dead.has(item.entry.id)).map(item => item.entry.id));

    const applies = valid.filter(item => live.has(item.entry.id));
    applies.sort((a, b) => (a.at - b.at) || (a.entry.at - b.entry.at) || (a.entry.seq - b.entry.seq) || (a.entry.id < b.entry.id ? -1 : 1));

    const byId = new Map(), flags = [], locked = new Set(), applied = [];
    const markIndex = mark => index.get(mark);
    const version = (id, e, text) => {
        const rec = byId.get(id);
        if (!rec) return;
        rec.versions.push({ entry: e.id, op: e.op, at: e.at, origin: e.origin, anchor: e.anchor, index: e.anchor ? markIndex(e.anchor.mark) ?? null : null, text: text ?? rec.text ?? '' });
        rec.entries.push(e.id);
    };
    const fresh = (record, e) => ({ ...structuredClone(record), status: record.status || 'current', versions: [], entries: [], locked: locked.has(record.id) });
    for (const { entry: e } of applies) {
        const r = e.record;
        const touches = [...(e.target || []), r?.id].filter(Boolean);
        if (e.origin?.type !== 'you' && !['lock', 'flag', 'link', 'keep'].includes(e.op) && touches.some(t => locked.has(t))) {
            flags.push({ entry: e.id, kind: 'locked-record', target: touches, record: r || null, evidence: e.evidence || [], reason: e.reason || '' });
            notes.set(e.id, NOTE.locked);
            continue;
        }
        applied.push(e.id);
        switch (e.op) {
            case 'add': case 'revise': {
                const id = r?.id || e.target?.[0];
                if (!id) break;
                if (byId.has(id)) {
                    const prev = byId.get(id);
                    const keep = { versions: prev.versions, entries: prev.entries, locked: prev.locked };
                    const status = r.status ?? (OUT_OF_FORCE.includes(prev.status) && e.op === 'add' ? 'current' : prev.status);
                    for (const k of Object.keys(prev)) if (!['versions', 'entries', 'locked', 'id'].includes(k) && r[k] === undefined && e.op === 'add') delete prev[k];
                    Object.assign(prev, structuredClone(r), keep, { id, status });
                } else byId.set(id, fresh({ ...r, id }, e));
                version(id, e, r.text);
                break;
            }
            case 'supersede': {
                for (const t of e.target || []) if (byId.has(t)) Object.assign(byId.get(t), { status: 'replaced', replacedBy: r?.id || '' });
                if (r?.id) {
                    if (byId.has(r.id)) Object.assign(byId.get(r.id), structuredClone(r), { status: r.status || 'current' });
                    else byId.set(r.id, { ...fresh(r, e), supersedes: [...(e.target || [])] });
                    version(r.id, e, r.text);
                }
                for (const t of e.target || []) version(t, e, '');
                break;
            }
            case 'retire': for (const t of e.target || []) if (byId.has(t)) { byId.get(t).status = 'retired'; version(t, e, ''); } break;
            case 'complete': for (const t of e.target || []) if (byId.has(t)) { Object.assign(byId.get(t), { status: 'done', outcome: r?.outcome ?? byId.get(t).outcome ?? null }); version(t, e); } break;
            case 'merge': {
                const [main, ...rest] = e.target || [];
                if (!byId.has(main)) break;
                const rec = byId.get(main);
                Object.assign(rec, { text: r?.text ?? rec.text, aliases: [...new Set([...(rec.aliases || []), ...(r?.aliases || []), ...rest.flatMap(t => byId.get(t)?.aliases || [])])], mergedFrom: [...new Set([...(rec.mergedFrom || []), ...rest])] });
                version(main, e, rec.text);
                for (const t of rest) if (byId.has(t)) { Object.assign(byId.get(t), { status: 'merged', mergedInto: main }); version(t, e, ''); }
                break;
            }
            case 'link': for (const t of e.target || []) if (byId.has(t)) byId.get(t).links = [...new Set([...(byId.get(t).links || []), ...(e.target || []).filter(x => x !== t)])]; break;
            case 'keep': for (const t of e.target || []) if (byId.has(t)) byId.get(t).keep = true; break;
            case 'flag': flags.push({ entry: e.id, kind: r?.kind || 'flag', target: [...(e.target || [])], record: r || null, evidence: e.evidence || [], reason: e.reason || '' }); break;
            case 'lock': for (const t of e.target || []) { locked.add(t); if (byId.has(t)) { byId.get(t).locked = true; version(t, e); } } break;
            default: break;
        }
    }

    const history = [];
    for (const item of found) if (notes.has(item.entry?.id)) history.push({ entry: item.entry.id, note: notes.get(item.entry.id), target: [...(item.entry.target || []), item.entry.record?.id].filter(Boolean) });
    const records = [...byId.values()];
    // A range record (a chapter) whose covered replies changed is stale: it stays in force and waits for its rebuild (3.4).
    const stale = [];
    for (const rec of records) if (Array.isArray(rec.covers) && rec.covers.some(src => isSource(src) && present(src))) { rec.stale = true; stale.push(rec.id); }
    const value = {
        key, records, byId, flags, history, applied, stale, reverts,
        current: records.filter(rec => !OUT_OF_FORCE.includes(rec.status)),
        dropped: found.filter(item => notes.has(item.entry?.id) && !reverted.has(item.entry.id)).map(item => item.entry.id),
        notes, locked,
    };
    if (cache && meta) where.set(meta, { key, value });
    return value;
}

/**
 * Every saved entry about one record, oldest first, with its source and whether it counts now. Reads all swipes of every
 * message, so versions on a swipe that is not showing are listed too.
 */
export function historyOf(chat, meta, recordId, result = fold(chat, meta)) {
    const index = new Map();
    (chat || []).forEach((message, i) => { const mark = storedMark(message); if (mark && !index.has(mark)) index.set(mark, i); });
    const rows = [];
    const about = e => (e.target || []).includes(recordId) || e.record?.id === recordId;
    const revertTargets = new Map();
    const all = [];
    (chat || []).forEach((message, i) => {
        const swipes = Math.max(1, message?.swipe_info?.length || message?.swipes?.length || 1);
        for (let k = 0; k < swipes; k++) for (const e of swipeEntries(message, k)) if (!Number.isInteger(e?.anchor?.swipe) || e.anchor.swipe === k) all.push({ e, i, k, showing: k === swipeOf(message) });
    });
    for (const e of meta?.[MEMORY]?.log || []) all.push({ e, i: e.anchor ? index.get(e.anchor.mark) ?? null : null, k: null, showing: true });
    for (const { e } of all) if (e.op === 'revert') for (const t of e.target || []) revertTargets.set(t, e.id);
    const ids = new Set(all.filter(({ e }) => about(e)).map(({ e }) => e.id));
    for (const { e } of all) if (e.op === 'revert' && (e.target || []).some(t => ids.has(t))) ids.add(e.id);
    for (const { e, i, k, showing } of all) {
        if (!ids.has(e.id)) continue;
        const counts = e.op === 'revert' ? result.reverts.includes(e.id) : result.applied.includes(e.id);
        rows.push({
            entry: e.id, op: e.op, at: e.at, origin: e.origin?.type || '', route: e.origin?.route || '', model: e.origin?.model || '',
            text: e.record?.text ?? '', reason: e.reason || '', index: i, swipe: k, showing, counts,
            note: counts ? '' : !showing ? 'on another version of its reply' : result.notes.get(e.id) || (e.op === 'revert' ? '' : 'held out'),
            revertedBy: revertTargets.get(e.id) || '',
        });
    }
    return rows.sort((a, b) => a.at - b.at || (a.entry < b.entry ? -1 : 1));
}

/** Bytes of memory data: the chat log plus every swipe's per-reply entries and marks. */
export function memoryBytes(chat, meta) {
    const size = value => (value === undefined ? 0 : new TextEncoder().encode(JSON.stringify(value)).length);
    let extras = 0;
    for (const message of chat || []) {
        extras += size(message?.extra?.[MEMORY]);
        (message?.swipe_info || []).forEach((info, k) => { if (k !== swipeOf(message)) extras += size(info?.extra?.[MEMORY]); });
    }
    return { meta: size(meta?.[MEMORY]), extras, total: size(meta?.[MEMORY]) + extras };
}
