// A plain log of every request the extension makes to the AI: what was asked, what came back, and why it failed.
// Kept on this device only (browser storage). Nothing in it is sent anywhere.
const STORE = 'roleplay_instructions_log';
const MAX = 120;      // entries kept
const CLIP = 6000;    // characters kept of each prompt and answer

let entries = null;
const listeners = new Set();

function load() {
    if (entries) return entries;
    try {
        const saved = JSON.parse(globalThis.localStorage?.getItem(STORE) || '[]');
        entries = Array.isArray(saved) ? saved : [];
    } catch { entries = []; }
    return entries;
}

function save() {
    try { globalThis.localStorage?.setItem(STORE, JSON.stringify(entries)); }
    catch {
        // Storage is full: keep the newer half and try once more.
        entries = entries.slice(-Math.floor(MAX / 2));
        try { globalThis.localStorage?.setItem(STORE, JSON.stringify(entries)); } catch { /* the log stays in memory only */ }
    }
    for (const fn of listeners) { try { fn(); } catch { /* a listener must not break logging */ } }
}

const clip = (s) => {
    const t = String(s ?? '');
    return t.length > CLIP ? `${t.slice(0, CLIP)}\n[${t.length - CLIP} more characters are left out of the log]` : t;
};

/**
 * Add one entry and return it. The caller may change it afterwards and call update().
 * what: plain name of the job. ok: true, false, or null while it is still running.
 */
export function addLog({ what, ok = null, status = '', result = '', details = [], sent = '', got = '', reply }) {
    load();
    const entry = { time: Date.now(), what: String(what), ok, status, result: String(result), details: details.map(String), sent: clip(sent), got: clip(got),
        ...(reply && {reply}) };
    entries.push(entry);
    if (entries.length > MAX) entries.splice(0, entries.length - MAX);
    save();
    return entry;
}

/** Save changes made to an entry returned by addLog. */
export function updateLog(entry, patch = {}) {
    if (!entry) return;
    if ('got' in patch) patch.got = clip(patch.got);
    if (patch.details) entry.details.push(...patch.details.map(String));
    for (const [k, v] of Object.entries(patch)) { if (k !== 'details') entry[k] = v; }
    save();
}

/** Newest first. */
export function logEntries() { return [...load()].reverse(); }

export function clearLog() { entries = []; save(); }

export function onLog(fn) { listeners.add(fn); return () => listeners.delete(fn); }

const stamp = (t) => { try { return new Date(t).toLocaleString(); } catch { return String(t); } };
export const logStatus = entry => entry.status || (entry.ok===true ? 'Worked' : entry.ok===false ? 'Failed' :
    entry.result && !entry.sent ? 'Recorded' : 'Running');

/** The whole log as plain text, newest first, for copying or saving. */
export function logText() {
    return logEntries().map(e => [
        `${stamp(e.time)}  ${e.what}  ${logStatus(e)}`,
        e.result ? `Result: ${e.result}` : '',
        ...e.details.map(d => `- ${d}`),
        e.sent ? `--- What was sent ---\n${e.sent}` : '',
        e.got ? `--- What came back ---\n${e.got}` : '',
    ].filter(Boolean).join('\n')).join('\n\n==========\n\n');
}

export const logTime = stamp;
