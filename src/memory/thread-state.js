// B49: a thread's "ends when" line and its paused state. Capture writes both; she can edit both. A paused thread stays on
// file and leaves the pacing pool until it is resumed.

const ENDS_MAX = 160;
const clip = text => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, ENDS_MAX);
const dataOf = entry => { try { return JSON.parse(entry?.fields?.data || 'null'); } catch { return null; } };

/** True for a thread that is paused, as a record or as a Story World entry. Anything else is false. */
export function isPaused(entry) {
    if (!entry || typeof entry !== 'object') return false;
    return entry.paused === true || entry.status === 'paused' || dataOf(entry)?.paused === true;
}

/** The "ends when" line of a thread record or entry, or ''. */
export const endsWhenOf = entry => clip(entry?.endsWhen ?? dataOf(entry)?.endsWhen ?? '');

async function revise(id, change, reason, store) {
    const s = store || (await import('./store.js')).memoryStore();
    const record = s.view().byId.get(String(id));
    if (!record || record.kind !== 'thread') return { committed: false, reason: 'No thread record with that id.' };
    const { versions, entries, locked, view, ...rest } = record;
    return s.record([{ op: 'revise', target: [record.id], record: { ...rest, ...change }, origin: { type: 'you' }, reason }]);
}

/** Her edit of a thread's "ends when" line (an empty line clears it). */
export const setThreadEnds = (id, line, { store } = {}) => revise(id, { endsWhen: clip(line) || undefined }, 'Ends-when line set by you.', store);

/** Her edit of a thread's status: paused true or false. */
export const setThreadPaused = (id, paused, { store } = {}) => revise(id, { paused: paused === true }, paused ? 'Paused by you.' : 'Resumed by you.', store);
