// Request stats (B62): one entry for every model request the extension sends, free, local and paid alike, so Setup,
// Connections, Spend can show the count, size and frequency of requests per day and per background job. The replies she
// writes through SillyTavern itself are not extension requests and never reach this file.
// Two stores live in extension settings: a daily total per job for the last 31 days, and the newest entries in full
// (time, job, route, model, tokens in and out, cost) for the median request size. Both are trimmed on every write.
import { settings, saveSettings } from './store.js';

export const KEEP_DAYS = 31;
/** How many full entries are kept. The daily totals keep counting past this. */
export const MAX_ENTRIES = 600;
const DAY_MS = 24 * 60 * 60 * 1000;

const listeners = new Set();

/** The local calendar day a time falls in, as YYYY-MM-DD. */
export const dayOf = (now = Date.now()) => {
    const d = new Date(now);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** A rough token count for text that came back without reported usage: four characters to a token. */
export const estimateTokens = chars => Math.max(0, Math.ceil(Number(chars || 0) / 4));

const money = value => Math.round(Number(value || 0) * 1e6) / 1e6;
const whole = value => Math.max(0, Math.round(Number(value) || 0));

function store() {
    const st = settings();
    const s = st.requestStats && typeof st.requestStats === 'object' ? st.requestStats : (st.requestStats = {});
    s.days = s.days && typeof s.days === 'object' ? s.days : {};
    s.entries = Array.isArray(s.entries) ? s.entries.filter(entry => entry && typeof entry === 'object') : [];
    // A day that is not YYYY-MM-DD with an object of jobs is damage, not data.
    for (const [day, jobs] of Object.entries(s.days)) if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !jobs || typeof jobs !== 'object') delete s.days[day];
    return s;
}

// Drop days older than KEEP_DAYS (today counts as one) and entries older than that or past the cap.
function trim(s, now) {
    const oldest = dayOf(now - (KEEP_DAYS - 1) * DAY_MS);
    for (const day of Object.keys(s.days)) if (day < oldest) delete s.days[day];
    const cutoff = now - KEEP_DAYS * DAY_MS;
    s.entries = s.entries.filter(entry => Number(entry.t) >= cutoff);
    if (s.entries.length > MAX_ENTRIES) s.entries.splice(0, s.entries.length - MAX_ENTRIES);
}

/**
 * Record one model request. usage: the provider's reported { prompt_tokens, completion_tokens } (or { in, out }), which
 * wins over the estimate; without it the counts come from the characters sent (inChars) and received (outChars), and the
 * entry is marked estimated. usd: the cost of a paid request, 0 otherwise. ok: false for a request that got no usable
 * answer. Never throws: a stats problem must not stop a request.
 */
export function recordRequest({ job = '', route = '', model = '', usage = null, inChars = 0, outChars = 0, usd = 0, ok = true } = {}, now = Date.now()) {
    try {
        const reported = usage && typeof usage === 'object'
            && [usage.prompt_tokens, usage.completion_tokens, usage.in, usage.out, usage.input_tokens, usage.output_tokens].some(v => Number.isFinite(Number(v)) && v !== null && v !== undefined);
        const tokensIn = reported ? whole(usage.prompt_tokens ?? usage.in ?? usage.input_tokens) : estimateTokens(inChars);
        const tokensOut = reported ? whole(usage.completion_tokens ?? usage.out ?? usage.output_tokens) : estimateTokens(outChars);
        const cost = money(Math.max(0, Number(usd) || 0));
        const entry = { t: now, j: String(job || 'other'), r: String(route || ''), m: String(model || ''), i: tokensIn, o: tokensOut,
            ...(reported ? {} : { e: 1 }), ...(cost ? { c: cost } : {}), ...(ok ? {} : { f: 1 }) };
        const s = store();
        s.entries.push(entry);
        const day = s.days[dayOf(now)] ||= {};
        const line = day[entry.j] ||= { n: 0, i: 0, o: 0, c: 0, e: 0 };
        line.n += 1;
        line.i += tokensIn;
        line.o += tokensOut;
        line.c = money(line.c + cost);
        if (!reported) line.e += 1;
        trim(s, now);
        saveSettings();
        for (const fn of [...listeners]) { try { fn(entry); } catch { /* a listener must not stop the request */ } }
        return entry;
    } catch (error) {
        console.warn('Roleplay Instructions could not record a request in the stats.', error);
        return null;
    }
}

/** Hear every new entry and every Clear. Returns a function that stops listening. */
export function onRequestStats(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** Forget every entry and daily total. Clear stats calls it after her confirm. */
export function clearRequestStats() {
    const st = settings();
    st.requestStats = { days: {}, entries: [] };
    saveSettings();
    for (const fn of [...listeners]) { try { fn(null); } catch { /* as above */ } }
}

/** The full entries kept, oldest first (a copy). */
export function requestEntries(now = Date.now()) {
    const s = store();
    trim(s, now);
    return s.entries.map(entry => ({ ...entry }));
}

const sum = lines => lines.reduce((acc, line) => ({ n: acc.n + line.n, i: acc.i + line.i, o: acc.o + line.o, c: money(acc.c + line.c), e: acc.e + line.e }),
    { n: 0, i: 0, o: 0, c: 0, e: 0 });

/**
 * One row per day with requests, today first: { day, requests, tokensIn, tokensOut, usd, estimated, jobs }, where jobs
 * holds the same fields per job, most requests first.
 */
export function dailyStats(now = Date.now()) {
    const s = store();
    trim(s, now);
    return Object.keys(s.days).sort().reverse().map(day => {
        const jobs = Object.entries(s.days[day]).map(([job, line]) => ({ job, requests: line.n, tokensIn: line.i, tokensOut: line.o, usd: line.c, estimated: line.e }))
            .sort((a, b) => b.requests - a.requests || a.job.localeCompare(b.job));
        const total = sum(Object.values(s.days[day]));
        return { day, requests: total.n, tokensIn: total.i, tokensOut: total.o, usd: total.c, estimated: total.e, jobs };
    }).filter(row => row.requests > 0);
}

const median = values => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

/**
 * The last 7 days per job, today included: { job, requests, perDay, medianTokens, tokensIn, tokensOut, usd }, most
 * requests first. perDay is requests over 7 days; medianTokens is the median of tokens in plus out over the kept entries.
 */
export function weeklyJobStats(now = Date.now(), days = 7) {
    const s = store();
    trim(s, now);
    const from = dayOf(now - (days - 1) * DAY_MS);
    const lines = {};
    for (const [day, jobs] of Object.entries(s.days)) {
        if (day < from) continue;
        for (const [job, line] of Object.entries(jobs)) (lines[job] ||= []).push(line);
    }
    const sizes = {};
    for (const entry of s.entries) if (dayOf(entry.t) >= from) (sizes[entry.j] ||= []).push(entry.i + entry.o);
    return Object.entries(lines).map(([job, list]) => {
        const total = sum(list);
        return { job, requests: total.n, perDay: Math.round(total.n / days * 10) / 10, medianTokens: median(sizes[job] || []),
            tokensIn: total.i, tokensOut: total.o, usd: total.c };
    }).sort((a, b) => b.requests - a.requests || a.job.localeCompare(b.job));
}
