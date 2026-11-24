// The memory store in chat data (memory DESIGN 2.1, 3.2, 3.4, 3.5). Per-reply change entries go into the reply's extra
// and its swipe slot; range entries go into one log in chat metadata. Entries are appended and never edited: undo is a
// revert entry, protection is a lock entry, and both travel with the chat.
//
// createStore(host) works over any host that gives { chat(), meta(), chatId(), save(), now() }; hostStore() is the one
// wired to SillyTavern. Commits for one chat run one at a time and each is followed by a chat save, so a background
// write never lands on a newer revision or overwrites a newer save. A capture result carries the revision it read and
// is committed only while that revision still shows; otherwise it is discarded and logged (DESIGN 3.2, writes that
// arrive late).
import { MEMORY, chatMemory, ensureMarks, fold, forgetFold, historyOf, makeEntry, memoryBytes, revisionOf, storedMark, swipeEntries, swipeOf } from './fold.js';

const JOB_LOG_MAX = 50;
const chains = new Map();   // chat id -> the tail of its commit chain

/** Run fn after every earlier commit of the same chat. */
function serial(chatId, fn) {
    const tail = chains.get(chatId) || Promise.resolve();
    const run = tail.then(fn, fn);
    chains.set(chatId, run.then(() => {}, () => {}));
    return run;
}

/** Append frozen entries to the showing swipe of a message: into its extra and its swipe slot together. */
export function appendToReply(message, entries) {
    const swipe = swipeOf(message);
    const mark = storedMark(message);
    if (!message.extra || typeof message.extra !== 'object') message.extra = {};
    const list = [...swipeEntries(message), ...entries];
    message.extra[MEMORY] = { ...(message.extra[MEMORY] || {}), mark, entries: list };
    const info = message.swipe_info?.[swipe];
    if (info && typeof info === 'object') {
        if (!info.extra || typeof info.extra !== 'object') info.extra = {};
        info.extra[MEMORY] = { ...(info.extra[MEMORY] || {}), mark, entries: list };
    }
}

/** Append frozen entries to the chat log in metadata. */
export function appendToLog(meta, entries) {
    const mem = chatMemory(meta);
    mem.log = [...mem.log, ...entries];
}

export function createStore(host) {
    const receipts = [];   // discarded late writes and other job notes on this device, newest last
    const note = item => { receipts.push({ at: host.now(), ...item }); if (receipts.length > JOB_LOG_MAX) receipts.shift(); };

    const chat = () => host.chat() || [];
    const meta = () => host.meta() || {};
    const indexOf = mark => chat().findIndex(message => storedMark(message) === mark);

    /** Give every message its mark. Returns true when a mark was added (the chat then needs a save). */
    const marks = () => ensureMarks(chat()) > 0;

    // Each entry that acts on records depends on the version of each target it read (DESIGN 3.2), so reverting that
    // version drops it too. A revert or lock names entries or records the user chose and depends on nothing.
    function nextEntries(inputs) {
        const mem = chatMemory(meta());
        const current = inputs.some(input => input.target && !['revert', 'lock'].includes(input.op)) ? fold(chat(), meta()) : null;
        return inputs.map(input => {
            mem.seq += 1;
            const versions = current && !['revert', 'lock'].includes(input.op)
                ? [].concat(input.target || []).map(t => current.byId.get(String(t))?.entries?.at(-1)).filter(Boolean).map(entry => ({ entry }))
                : [];
            const depends = [...[].concat(input.depends || []), ...versions.filter(v => ![].concat(input.depends || []).some(d => d?.entry === v.entry))];
            return makeEntry({ ...input, depends }, { seq: mem.seq, at: host.now() });
        });
    }

    function logJob(item) {
        const mem = chatMemory(meta());
        mem.jobs = [...(mem.jobs || []), { at: host.now(), ...item }].slice(-JOB_LOG_MAX);
        note(item);
    }

    /** The revision a job reads before it starts: the chat, the reply's mark, the showing swipe and its text hash. */
    function begin(index) {
        marks();
        const message = chat()[index];
        if (!message) throw new Error(`No message at ${index}.`);
        return { chatId: host.chatId(), index, ...revisionOf(message) };
    }

    /** True while the job's revision still shows in the open chat. */
    function stillShows(job) {
        if (host.chatId() !== job.chatId) return 'chat';
        const at = indexOf(job.mark);
        if (at < 0) return 'gone';
        const now = revisionOf(chat()[at]);
        if (now.swipe !== job.swipe) return 'swipe';
        if (now.hash !== job.hash) return 'edited';
        return '';
    }

    /**
     * Commit a model result for one reply. inputs: change entries without anchors; each is anchored to the revision the
     * job read and depends on it. onMessage(message) runs on the reply before the save, only when the revision still shows
     * (capture writes its stamp and the swipe's tracker values there). Resolves { committed, entries } or { discarded, reason }.
     */
    function commit(job, inputs, { reason = '', onMessage = null } = {}) {
        return serial(job.chatId, async () => {
            const why = stillShows(job);
            if (why) {
                const item = { kind: 'discarded-late-write', mark: job.mark, swipe: job.swipe, reason: why === 'chat' ? 'the chat changed' : why === 'gone' ? 'the reply was deleted' : why === 'swipe' ? 'another version of the reply shows' : 'the reply was edited' };
                if (why === 'chat') note(item); else logJob(item);
                return { discarded: true, reason: item.reason };
            }
            const anchor = { mark: job.mark, swipe: job.swipe, hash: job.hash };
            const message = chat()[indexOf(job.mark)];
            const entries = nextEntries(inputs.map(input => ({ ...input, anchor, depends: [].concat(input.depends || []).filter(d => d?.entry || d?.mark), reason: input.reason || reason })));
            appendToReply(message, entries);
            onMessage?.(message);
            forgetFold(meta());
            await host.save();
            return { committed: true, entries };
        });
    }

    /**
     * Append chat-level entries (range records, imports, your edits, upkeep). Each input names its own anchor (a message
     * mark) and depends; inputs with neither are anchored to the newest message. Serialized and saved like commit.
     */
    function record(inputs, { save = true } = {}) {
        const chatId = host.chatId();
        return serial(chatId, async () => {
            if (host.chatId() !== chatId) return { discarded: true, reason: 'the chat changed' };
            marks();
            const tip = chat().length ? storedMark(chat()[chat().length - 1]) : '';
            const entries = nextEntries(inputs.map(input => ({ ...input, anchor: input.anchor === undefined ? (tip ? { mark: tip } : null) : input.anchor })));
            appendToLog(meta(), entries);
            forgetFold(meta());
            if (save) await host.save();
            return { committed: true, entries };
        });
    }

    /** Append per-reply entries to the showing swipe of chat[index], anchored to it now (import of staged changes). */
    function recordOnReply(index, inputs, { save = true } = {}) {
        const job = begin(index);
        return serial(job.chatId, async () => {
            const message = chat()[index];
            const anchor = { mark: job.mark, swipe: job.swipe, hash: job.hash };
            const entries = nextEntries(inputs.map(input => ({ ...input, anchor, depends: [].concat(input.depends || []).filter(d => d?.entry || d?.mark) })));
            appendToReply(message, entries);
            forgetFold(meta());
            if (save) await host.save();
            return { committed: true, entries };
        });
    }

    const view = (options = {}) => fold(chat(), meta(), options);

    /** Undo one entry (DESIGN 3.5, Revert). The revert is an entry too, so it survives a reload. */
    function revert(entryId, reason = 'Undone.') {
        return record([{ op: 'revert', target: [entryId], origin: { type: 'you' }, reason }]);
    }

    /** Protect records: a model entry that would change them becomes a review flag. */
    const lock = (recordIds, reason = 'Locked by you.') => record([{ op: 'lock', target: [].concat(recordIds), origin: { type: 'you' }, reason }]);

    /** Remove a lock by reverting the lock entries on the record. */
    async function unlock(recordId) {
        const f = view();
        const ids = (f.byId.get(recordId)?.entries || []).filter(id => entryById(id)?.op === 'lock');
        const out = [];
        for (const id of ids) out.push(await revert(id, 'Unlocked by you.'));
        return out;
    }

    function entryById(id) {
        for (const message of chat()) for (const e of swipeEntries(message)) if (e.id === id) return e;
        return (meta()[MEMORY]?.log || []).find(e => e.id === id) || null;
    }

    /**
     * Restore a record that a retire, supersede, merge or revert took out of force: the newest such entry that counts is
     * reverted, or, when the record's own entries were reverted, the newest of those reverts is.
     */
    async function restore(recordId, reason = 'Restored by you.') {
        const f = view();
        const rows = historyOf(chat(), meta(), recordId, f);
        const takers = rows.filter(row => row.counts && ['retire', 'supersede', 'merge'].includes(row.op) && row.text === '');
        const taker = takers.at(-1) || rows.filter(row => row.counts && ['retire', 'merge'].includes(row.op)).at(-1);
        if (taker) return revert(taker.entry, reason);
        const undo = rows.filter(row => row.op === 'revert' && row.counts).at(-1);
        if (undo) return revert(undo.entry, reason);
        return { committed: false, reason: 'Nothing took this record out of force.' };
    }

    return {
        marks, begin, stillShows, commit, record, recordOnReply, view, revert, lock, unlock, restore, entryById,
        history: recordId => historyOf(chat(), meta(), recordId, view()),
        bytes: () => memoryBytes(chat(), meta()),
        receipts: () => receipts.slice(),
        jobs: () => [...(meta()[MEMORY]?.jobs || [])],
        settled: chatId => chains.get(chatId) || Promise.resolve(),
    };
}

/** The store wired to SillyTavern's open chat. */
export function hostStore(getContext = () => globalThis.SillyTavern.getContext()) {
    return createStore({
        chat: () => getContext().chat,
        meta: () => getContext().chatMetadata,
        chatId: () => String(getContext().getCurrentChatId?.() || ''),
        save: async () => { const c = getContext(); await (c.saveChat?.() ?? c.saveChatConditional?.()); },
        now: () => Date.now(),
    });
}

let shared = null;
/** The one store of this page. */
export const memoryStore = () => shared ||= hostStore();
