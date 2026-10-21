// Undercurrent 2: background job queue (BUILD_SPEC §3.4). Pure: the transport and SillyTavern state come in as functions.
//
// One FIFO, one job at a time. A job: {id?, kind, chatId, buildRequest() -> {systemPrompt, prompt, responseLength},
// apply(result), dedupeKey?, validate?(text) -> result|null}. Jobs wait while SillyTavern is generating, are dropped when
// the chat changed (identity guard, checked before sending AND before apply), time out, and can be cancelled (a user
// send cancels everything). Failures notify once per kind per session. Jobs are only enqueued after a reply.

export function createJobQueue({
    send, // async (request, signal) => string
    isGenerating = () => false,
    getChatId = () => null,
    timeoutMs = () => 60000,
    notifyFailure = () => {}, // (kind, error) — called at most once per kind per session
    onChange = () => {},
    log = () => {},
    timers = globalThis,
    pollMs = 750,
} = {}) {
    const queue = [];
    let running = null; // {job, controller, cancelled}
    let lastError = null;
    let seq = 0;
    let pollTimer = null;
    const failedKinds = new Set();

    const status = () => ({ running: running ? running.job.kind : null, queued: queue.length, lastError });
    const changed = () => { try { onChange(status()); } catch { /* ignore */ } };

    function schedulePoll() {
        if (pollTimer) return;
        pollTimer = timers.setTimeout(() => {
            pollTimer = null;
            pump();
        }, pollMs);
    }

    function fail(job, error) {
        lastError = { kind: job.kind, message: String(error?.message || error), at: Date.now() };
        log('job failed', job.kind, lastError.message);
        if (!failedKinds.has(job.kind)) {
            failedKinds.add(job.kind);
            try { notifyFailure(job.kind, error); } catch { /* ignore */ }
        }
    }

    async function runOne(job) {
        const controller = typeof AbortController === 'function' ? new AbortController() : { abort() {}, signal: null };
        const slot = { job, controller, cancelled: false };
        running = slot;
        changed();
        let timer = null;
        try {
            if (job.chatId !== undefined && job.chatId !== getChatId()) { log('job dropped (chat changed before start)', job.kind); return; }
            const request = await job.buildRequest();
            if (!request) { log('job skipped (no request)', job.kind); return; }
            if (slot.cancelled) return;
            const ms = Math.max(1000, Number(timeoutMs()) || 60000);
            const timeout = new Promise((_, reject) => {
                timer = timers.setTimeout(() => {
                    try { controller.abort(); } catch { /* ignore */ }
                    reject(new Error(`timed out after ${Math.round(ms / 1000)}s`));
                }, ms);
            });
            const cancelled = new Promise((_, reject) => { slot.reject = reject; });
            const text = await Promise.race([Promise.resolve().then(() => send(request, controller.signal, job)), timeout, cancelled]);
            if (slot.cancelled) return;
            if (job.chatId !== undefined && job.chatId !== getChatId()) { log('job dropped (chat changed before apply)', job.kind); return; }
            const result = typeof job.validate === 'function' ? job.validate(String(text ?? '')) : String(text ?? '');
            if (result === null || result === undefined) throw new Error('output failed validation');
            await job.apply(result);
            lastError = null;
        } catch (error) {
            if (!slot.cancelled) fail(job, error);
        } finally {
            if (timer) timers.clearTimeout(timer);
            running = null;
            changed();
        }
    }

    async function pump() {
        if (running || !queue.length) return;
        let generating = false;
        try { generating = !!isGenerating(); } catch { generating = false; }
        if (generating) { schedulePoll(); return; }
        const job = queue.shift();
        await runOne(job);
        if (queue.length) pump();
    }

    return {
        /** Add a job; a queued job with the same dedupeKey is replaced. Returns the job id. */
        enqueue(job) {
            if (!job || typeof job.buildRequest !== 'function' || typeof job.apply !== 'function') return null;
            const j = { ...job, id: job.id || `job${++seq}` };
            if (j.dedupeKey) {
                const i = queue.findIndex(q => q.dedupeKey === j.dedupeKey);
                if (i >= 0) queue.splice(i, 1, j);
                else queue.push(j);
            } else {
                queue.push(j);
            }
            changed();
            Promise.resolve().then(pump);
            return j.id;
        },
        /** Cancel one job (queued or running). */
        cancel(id) {
            const i = queue.findIndex(q => q.id === id);
            if (i >= 0) { queue.splice(i, 1); changed(); return true; }
            if (running && running.job.id === id) {
                running.cancelled = true;
                try { running.controller.abort(); } catch { /* ignore */ }
                try { running.reject?.(new Error('cancelled')); } catch { /* ignore */ }
                return true;
            }
            return false;
        },
        /** Cancel everything (the user sent a message, the chat changed). */
        cancelAll(reason = 'cancelled') {
            const n = queue.length + (running ? 1 : 0);
            queue.length = 0;
            if (running) {
                running.cancelled = true;
                try { running.controller.abort(); } catch { /* ignore */ }
                try { running.reject?.(new Error(reason)); } catch { /* ignore */ }
            }
            if (n) log('jobs cancelled', reason, n);
            changed();
            return n;
        },
        /** Re-check deferred work (call when generation ends). */
        kick() { Promise.resolve().then(pump); },
        status,
        /** Resolves when the queue is idle (tests). */
        async idle(maxMs = 5000) {
            const t0 = Date.now();
            while ((running || queue.length) && Date.now() - t0 < maxMs) await new Promise(r => timers.setTimeout(r, 5));
        },
    };
}
