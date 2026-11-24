// The background job queue (memory DESIGN 10). One saved queue in the device database, keyed so a repeat merges,
// resumed after the app pauses and rebuilt from the chat when the database is gone. Jobs run one at a time, in the
// order of PRIORITY, with the oldest uncaptured reply first inside a chat. The desktop keeps gemma4:12b and
// nomic-embed-text loaded during play; a job that names another model waits for an idle window (no message for 10
// minutes, or the end of the session) and runs with every other such job as one group, after which the resident
// model loads again. Judgment calls take the desktop ahead of any waiting job and give up at their own deadline.
// Every swap of the desktop model is counted, so a play session can show it caused none.
import { askFull, on, toast } from '../st.js';
import { chainFor, resolveRoute } from '../routing.js';
import { autoDownloadPhoneModel } from './phone-model.js';

/** Lower runs first. Judgment calls are dropped when they are late. */
export const PRIORITY = Object.freeze({
    judgment: 0, capture: 1, statSheets: 1, chapter: 2, storySoFar: 2, catchUp: 3, catchUpNow: 3, tidy: 4, tidyScreen: 4, booster: 5,
});
export const RESIDENT = Object.freeze(['gemma4:12b', 'nomic-embed-text']);
export const IDLE_MS = 10 * 60 * 1000;
const RETRY_MS = 30 * 1000;
const WAIT_MS = 10 * 60 * 1000;

/** A short revision mark for a source text (FNV-1a, 32 bits). Two texts with the same mark are treated as the same. */
export function revOf(text) {
    let hash = 0x811c9dc5;
    for (const ch of String(text ?? '')) {
        hash ^= ch.codePointAt(0);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

/** The revision of a job: every source it reads with its own revision, in a fixed order. */
export const sourcesRev = sources => revOf(Object.keys(sources || {}).sort().map(key => `${key}=${sources[key]}`).join('|'));
export const jobKey = ({ chatId = '', kind = '', subject = '' }) => `${chatId}|${kind}|${subject}`;
const bare = model => String(model || '').replace(/:latest$/, '');

/** A queue store held in memory. Tests use it, and the queue falls back to it where no device database exists. */
export function memoryStore() {
    const jobs = new Map(), done = new Map();
    return {
        async all() { return [...jobs.values()].map(job => structuredClone(job)); },
        async put(job) { jobs.set(job.key, structuredClone(job)); },
        async remove(key) { jobs.delete(key); },
        async isDone(key, rev) { return done.get(key) === rev; },
        async markDone(key, rev) { done.set(key, rev); },
        async clear() { jobs.clear(); done.clear(); },
    };
}

/** The queue store in the device database (IndexedDB): one table of jobs and one of finished job revisions. */
export function deviceStore({ name = 'roleplay_instructions_memory', idb = globalThis.indexedDB } = {}) {
    if (!idb) return memoryStore();
    let opened = null;
    const db = () => opened ||= new Promise((resolve, reject) => {
        const request = idb.open(name, 1);
        request.onupgradeneeded = () => {
            const base = request.result;
            if (!base.objectStoreNames.contains('jobs')) base.createObjectStore('jobs', { keyPath: 'key' });
            if (!base.objectStoreNames.contains('done')) base.createObjectStore('done');
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    const step = async (table, mode, act) => {
        const base = await db();
        return new Promise((resolve, reject) => {
            const tx = base.transaction(table, mode);
            const request = act(tx.objectStore(table));
            tx.oncomplete = () => resolve(request?.result);
            tx.onerror = () => reject(tx.error);
        });
    };
    return {
        all: () => step('jobs', 'readonly', table => table.getAll()).then(list => list || []),
        put: job => step('jobs', 'readwrite', table => table.put(structuredClone(job))),
        remove: key => step('jobs', 'readwrite', table => table.delete(key)),
        isDone: (key, rev) => step('done', 'readonly', table => table.get(key)).then(saved => saved === rev),
        markDone: (key, rev) => step('done', 'readwrite', table => table.put(rev, key)),
        clear: async () => { await step('jobs', 'readwrite', table => table.clear()); await step('done', 'readwrite', table => table.clear()); },
    };
}

/**
 * Create a queue.
 * store: memoryStore() or deviceStore(). handlers: { [kind]: { run(job, { signal }), commit(job, result), saved?(job, result) } }.
 * run returns { ok, value, route, waiting }; route 'desktop' means the desktop answered with the job's model.
 * warm: a function that loads the resident model with one tiny call; it returns true when the desktop answered.
 * clock: test hook for time. onEvent: hears { type, ... } for receipts and tests.
 */
export function createQueue({ store = memoryStore(), handlers = {}, warm = null, clock = Date.now, resident = RESIDENT, idleMs = IDLE_MS, onEvent = null, timers = true } = {}) {
    const jobs = new Map();
    const residentSet = new Set(resident.map(bare));
    let loaded = new Set();
    let swaps = 0, lastActivity = clock(), sessionEnded = false, running = null, judgmentsWaiting = 0, opened = null, pumping = null, inGroup = false, timer = null;
    const log = event => { try { onEvent?.({ time: clock(), ...event }); } catch { /* a listener must not stop the queue */ } };

    /** Record that the desktop now holds a model, counting a swap whenever a loaded model had to make room. */
    function use(model) {
        const name = bare(model);
        if (!name || loaded.has(name)) return;
        const together = residentSet.has(name) && [...loaded].every(m => residentSet.has(m));
        if (!together && loaded.size) {
            swaps += 1;
            log({ type: 'swap', from: [...loaded], to: name });
        }
        loaded = together ? new Set([...loaded, name]) : new Set([name]);
    }

    const isResident = job => !job.model || residentSet.has(bare(job.model));
    const idle = () => sessionEnded || clock() - lastActivity >= idleMs;

    async function open() {
        return opened ||= (async () => {
            for (const job of await store.all()) {
                // A job that was running when the app stopped goes back to waiting under the same key, so it runs once.
                if (job.state === 'running') {
                    job.state = 'queued';
                    job.tries = (job.tries || 0) + 1;
                    await store.put(job);
                }
                jobs.set(job.key, job);
            }
            log({ type: 'open', jobs: jobs.size });
        })();
    }

    /**
     * Add a job, or merge it with the waiting job under the same key. A job whose sources changed replaces the old one;
     * a job whose result is already saved for these sources is not added.
     */
    // A capture job is made only for a reply with no capture stamp, so its done record never decides (the handler's saved()
    // check still guards a retry). A reply deleted and sent again with the same words in the same minute has the same key
    // and sources as the first, and the first one's records left the chat with it.
    const doneBefore = job => job.kind !== 'capture' && store.isDone(job.key, job.rev);

    async function enqueue(input) {
        await open();
        const key = jobKey(input);
        const sources = { ...(input.sources || {}) };
        const rev = sourcesRev(sources);
        if (await doneBefore({ kind: input.kind, key, rev })) { log({ type: 'skip-done', key }); return null; }
        const existing = jobs.get(key);
        if (existing && existing.rev === rev) {
            existing.payload = { ...existing.payload, ...(input.payload || {}) };
            await store.put(existing);
            log({ type: 'merge', key });
            return existing;
        }
        const job = {
            key, kind: String(input.kind), chatId: String(input.chatId || ''), subject: String(input.subject ?? ''),
            sources, rev, order: Number.isFinite(Number(input.order)) ? Number(input.order) : 0,
            model: input.model ? String(input.model) : '', priority: PRIORITY[input.kind] ?? 9,
            deadline: input.deadline || 0, payload: input.payload || {}, state: 'queued', tries: 0,
            added: existing?.added ?? clock(), notBefore: 0,
        };
        jobs.set(key, job);
        await store.put(job);
        log({ type: existing ? 'replace' : 'add', key });
        return job;
    }

    /** Rebuild missing work from the chat: each candidate is added unless it waits already or its result is saved. */
    async function rebuild(candidates) {
        const added = [];
        for (const candidate of candidates) {
            const before = jobs.get(jobKey(candidate));
            const job = await enqueue(candidate);
            if (job && job !== before) added.push(job.key);
        }
        log({ type: 'rebuild', added: added.length });
        return added;
    }

    const order = (a, b) => a.priority - b.priority || (a.chatId === b.chatId ? a.order - b.order : 0) || a.added - b.added || (a.key < b.key ? -1 : 1);

    /** The next job to run, or null. In an idle window the jobs for other models run first, grouped by model. */
    function pick() {
        const now = clock();
        const waiting = [...jobs.values()].filter(job => job.state === 'queued' && job.notBefore <= now);
        const held = waiting.filter(job => !isResident(job));
        if (idle() && held.length) {
            held.sort((a, b) => (bare(a.model) === [...loaded][0] ? -1 : 0) - (bare(b.model) === [...loaded][0] ? -1 : 0)
                || bare(a.model).localeCompare(bare(b.model)) || order(a, b));
            return held[0];
        }
        return waiting.filter(isResident).sort(order)[0] || null;
    }

    async function settle(job, patch) {
        Object.assign(job, patch);
        if (jobs.get(job.key) === job) await store.put(job);
    }

    async function runOne(job) {
        const handler = handlers[job.kind];
        if (!handler?.run) {
            await settle(job, { state: 'queued', notBefore: clock() + WAIT_MS, why: 'No handler takes this job yet.' });
            return;
        }
        if (job.kind === 'judgment' && job.deadline && clock() > job.deadline) {
            jobs.delete(job.key);
            await store.remove(job.key);
            log({ type: 'drop-late', key: job.key });
            return;
        }
        await settle(job, { state: 'running' });
        const controller = new AbortController();
        running = { job, controller };
        log({ type: 'start', key: job.key, model: job.model });
        let result = null;
        try {
            result = await handler.run(job, { signal: controller.signal });
        } catch (error) {
            result = { ok: false, reason: String(error?.message || error) };
        } finally {
            running = null;
        }
        if (result?.route === 'desktop') use(job.model || resident[0]);
        const current = jobs.get(job.key);
        if (!result?.ok) {
            if (current === job) await settle(job, { state: 'queued', tries: job.tries + 1, notBefore: clock() + (result?.waiting ? WAIT_MS : Math.min(WAIT_MS, RETRY_MS * 2 ** job.tries)), why: result?.reason || '' });
            log({ type: 'fail', key: job.key, waiting: !!result?.waiting });
            return;
        }
        // A newer job under the same key read newer sources; this result is out of date and is not filed.
        if (current && current !== job) { log({ type: 'stale', key: job.key }); return; }
        const already = await doneBefore(job) || await handler.saved?.(job, result);
        if (!already) await handler.commit?.(job, result);
        await store.markDone(job.key, job.rev);
        jobs.delete(job.key);
        await store.remove(job.key);
        log({ type: already ? 'already-saved' : 'done', key: job.key, route: result.route || '' });
    }

    /** Load the resident model again after a group that used another model. */
    async function warmBack() {
        if (!warm) return false;
        const ok = await warm(resident[0]);
        if (ok) use(resident[0]);
        log({ type: 'warm', ok: !!ok, after: 'group' });
        return ok;
    }

    /** Run waiting jobs one at a time until none can run now. Resolves when the queue is quiet. */
    function pump() {
        return pumping ||= (async () => {
            await open();
            try {
                for (;;) {
                    if (judgmentsWaiting) break;
                    const job = pick();
                    if (!job) break;
                    const grouped = !isResident(job);
                    if (grouped && !inGroup) { inGroup = true; log({ type: 'group-start', model: job.model }); }
                    await runOne(job);
                    // The group ends when no job for another model is left, or when play resumes.
                    if (inGroup && (!idle() || !pick() || isResident(pick()))) {
                        inGroup = false;
                        log({ type: 'group-end' });
                        if ([...loaded].some(m => !residentSet.has(m))) await warmBack();
                    }
                }
            } finally {
                pumping = null;
                schedule();
            }
        })();
    }

    /** Wake the queue when the next held job may run: a retry time, or the start of the idle window. */
    function schedule() {
        if (!timers) return;
        clearTimeout(timer);
        const now = clock();
        const times = [...jobs.values()].filter(job => job.state === 'queued').map(job => Math.max(job.notBefore, isResident(job) ? 0 : lastActivity + idleMs));
        if (!times.length) return;
        timer = setTimeout(() => pump(), Math.max(50, Math.min(...times) - now));
        timer.unref?.();
    }

    /**
     * Run a judgment call on the desktop ahead of waiting jobs. A running job is never interrupted; when it does not
     * finish before the deadline the call is late and fn is not run. Returns { late: true } or fn's result.
     */
    async function desktopTurn(fn, { withinMs = 0, deadline = clock() + (withinMs || 1000) } = {}) {
        if (withinMs) deadline = clock() + withinMs;
        judgmentsWaiting += 1;
        try {
            while (running) {
                const left = deadline - clock();
                if (left <= 0) return { late: true };
                await Promise.race([pumping || Promise.resolve(), new Promise(resolve => setTimeout(resolve, Math.min(left, 25)))]);
            }
            if (deadline - clock() <= 0) return { late: true };
            const result = await fn({ deadline });
            if (result?.route === 'desktop') use(result.model || resident[0]);
            return result;
        } finally {
            judgmentsWaiting -= 1;
            if (!judgmentsWaiting) pump();
        }
    }

    /** A message was sent or received: play is on, so the idle window closes. */
    function activity() {
        lastActivity = clock();
        sessionEnded = false;
        schedule();
    }

    /** The chat closed or the app went to the background: an idle window opens now. */
    function endSession() {
        sessionEnded = true;
        return pump();
    }

    /** Load the resident model with one tiny call, so the first job of a chat meets a warm model. */
    async function warmUp() {
        if (!warm) return false;
        const ok = await warm(resident[0]);
        if (ok) use(resident[0]);
        log({ type: 'warm', ok: !!ok, after: 'open' });
        return ok;
    }

    /** Register the runner and filer for one kind of job. MB3, MB6, MB7 and MB9 add theirs. */
    function handle(kind, handler) {
        handlers[kind] = handler;
    }

    return {
        open, enqueue, rebuild, pump, desktopTurn, activity, endSession, warmUp, handle,
        /** Counts for the status line and the tests. */
        stats: () => ({ waiting: [...jobs.values()].filter(job => job.state === 'queued').length, held: [...jobs.values()].filter(job => !isResident(job)).length,
            running: running?.job.key || '', swaps, loaded: [...loaded], idle: idle() }),
        jobs: () => [...jobs.values()].map(job => ({ ...job })),
    };
}

/**
 * Capture jobs for every reply past the capture watermark, oldest first. captured(message, index) tells whether a
 * reply's capture is already filed (MB3 keeps that mark); a reply's revision is the text of its shown swipe.
 */
export function captureCandidates(chat, { chatId, captured = () => false, model = RESIDENT[0] } = {}) {
    const out = [];
    (chat || []).forEach((message, index) => {
        if (!message || message.is_user || message.is_system || captured(message, index)) return;
        const mark = String(message.send_date || index);
        out.push({ chatId, kind: 'capture', subject: mark, order: index, model, sources: { [mark]: revOf(message.mes) }, payload: { index } });
    });
    return out;
}

// The queue this device runs, wired to the host: a warm-up at chat open and when the app comes back after a pause,
// activity on every message, and an idle window when the app goes to the background.
let shared = null;
const rebuilders = [];
const WARM_TIMEOUT_MS = 15000;

/** One tiny call that loads the model on the desktop. True when the desktop answered. */
export async function warmDesktop(model = RESIDENT[0]) {
    const target = resolveRoute({ route: 'desktop' });
    if (!target || target.kind !== 'profile') return false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('The warm-up ran past its time limit.')), WARM_TIMEOUT_MS);
    try {
        const res = await askFull({ user: 'Reply with OK.', tokens: 4, profileId: target.profileId, model, effort: 'none', signal: controller.signal });
        return !!String(res?.text || '').trim();
    } catch { return false; }
    finally { clearTimeout(timer); }
}

/** Add a function that lists the missing work of a chat: (chat, chatId) => candidates for enqueue. */
export function addRebuilder(fn) {
    if (typeof fn === 'function') rebuilders.push(fn);
}

/** The desktop model a job names: the model of its chain's desktop entry. */
export function desktopModelFor(kind) {
    try { return chainFor(kind).find(entry => entry.route === 'desktop')?.model || ''; } catch { return ''; }
}

/** The queue on this device, created on first use with the device database. */
export function desktopQueue() {
    return shared ||= createQueue({ store: deviceStore(), warm: warmDesktop });
}

function onPhone(nav = globalThis.navigator) {
    return !!nav?.userAgentData?.mobile || /Android|iPhone|iPad|Mobile/i.test(String(nav?.userAgent || ''));
}

/** Start the queue and listen to the host. Called once when the extension loads. */
export function startDesktopQueue({ doc = globalThis.document } = {}) {
    const queue = desktopQueue();
    let lastWarm = 0;
    const warm = () => { lastWarm = Date.now(); return queue.warmUp(); };
    const reopen = async () => {
        const c = globalThis.SillyTavern?.getContext?.();
        const chatId = String(c?.getCurrentChatId?.() || '');
        if (!chatId) return;
        warm();
        for (const fn of rebuilders) {
            try { await queue.rebuild(await fn(c.chat || [], chatId)); } catch { /* one rebuilder must not stop the others */ }
        }
        queue.pump();
    };
    on('CHAT_CHANGED', reopen);
    on('MESSAGE_SENT', () => queue.activity());
    on('MESSAGE_RECEIVED', () => { queue.activity(); queue.pump(); });
    doc?.addEventListener?.('visibilitychange', () => {
        if (doc.visibilityState === 'hidden') queue.endSession();
        else if (Date.now() - lastWarm > IDLE_MS - 60 * 1000) warm();
    });
    queue.open().then(() => queue.pump());
    // The 2.0 GB on-phone model is for phones (DECISIONS, routing row): a desktop browser or the desktop app never
    // starts it by itself, and Download in Background jobs stays available there.
    if (onPhone()) autoDownloadPhoneModel({ note: text => toast('info', text) }).catch(() => {});
    return queue;
}
