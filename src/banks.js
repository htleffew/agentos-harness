// Option banks (A12, B37). A bank is a value list for one dimension (genre, tone, author's style and the rest).
// The extension ships its default banks in src/banks/*.json, one file per dimension, each item crediting its
// source. On first use they are copied into one ordinary World Info book, "RI Option banks", with one disabled
// entry per dimension, so the book sends nothing itself. She edits that book; a later shipped update adds new
// items tagged "new" and leaves her edits as they are. Imported lists land in the same book.
//
// A category of an event or writing style set links to one bank (cat.bank) and keeps its own pool (the ticked
// item ids) and pick count, so two sets can share a bank with different pools. Rolls read the banks from the
// in-memory copy kept here, so a roll is synchronous and makes no request of any kind.
import { loadBook, saveBook, worldNames, refreshWorldList, ctx } from './st.js';

export const BANK_BOOK = 'RI Option banks';

/** How several picks of one category share the reply. */
export const SEND_RULES = {
    together: { label: 'All together' },
    beat: { label: 'One per beat' },
    paragraph: { label: 'One per paragraph' },
};

/** The category cap of one roll, after Pura's two-randomiser warning (A12 d.4). */
export const DEFAULT_CAP = 6;
/** Hidden subtext and ambient items active at once (A12 d.2, HawThorne). */
export const DEFAULT_GATE_MAX = 2;

let shipped = null;   // { version, banks: Map(id -> bank) }
let mine = null;      // Map(id -> bank) read from her book, or null before it is read
let loading = null;

const clone = value => structuredClone(value);
const clean = text => String(text ?? '').replace(/\s*\n+\s*/g, ' ').replace(/::/g, ':').trim();

// ---------- the shipped banks ----------

async function fetchJson(file) {
    const response = await fetch(new URL(`./banks/${file}`, import.meta.url));
    if (!response.ok) throw new Error(`The option bank file ${file} could not be read.`);
    return response.json();
}

/** Read the shipped banks once. read(file) returns parsed JSON; tests pass a reader over the files on disk. */
export async function loadShipped(read = fetchJson) {
    const index = await read('index.json');
    const list = await Promise.all(index.banks.map(b => read(`${b.id}.json`)));
    shipped = { version: Number(index.version) || 1, banks: new Map(list.map(b => [b.id, b])) };
    return shipped;
}

/** Set the shipped banks directly (tests). */
export function setShipped(data) {
    shipped = data ? { version: Number(data.version) || 1, banks: new Map((data.banks || []).map(b => [b.id, b])) } : null;
    return shipped;
}

export const shippedBanks = () => shipped;

// ---------- her book ----------

function normalBankItem(it) {
    const out = { id: String(it.id), label: String(it.label ?? it.text ?? ''), text: String(it.text ?? it.label ?? ''), on: it.on !== false,
        weight: Math.max(1, Math.round(Number(it.weight) || 1)), tags: String(it.tags || '') };
    if (it.source) out.source = clone(it.source);
    if (it.gate) out.gate = clone(it.gate);
    if (it.from) out.from = it.from;
    if (it.new) out.new = true;
    if (it.group) out.group = String(it.group);
    return out;
}

/** One bank's World Info entry. The plain list goes in content, the items with their sources in extensions.ri. */
export function bankEntry(uid, bank, extra = {}) {
    const items = (bank.items || []).map(normalBankItem);
    const on = items.filter(it => it.on && it.text.trim());
    return {
        uid, displayIndex: uid, key: [], keysecondary: [], comment: `Option bank: ${bank.name}`,
        content: on.length ? `{{random::${on.map(it => clean(it.text)).join('::')}}}` : '',
        constant: false, selective: false, disable: true, order: 100, position: 0, depth: 4, probability: 100, useProbability: true,
        excludeRecursion: true, preventRecursion: true,
        extensions: { ri: { v: 1, type: 'bank', dim: bank.id, name: bank.name, kind: bank.kind || 'both', adult: !!bank.adult,
            rev: Number(extra.rev) || 1, shipped: Number(extra.shipped) || 0, dropped: [...(extra.dropped || [])], items } },
    };
}

/** A fresh book holding every shipped bank. */
export function bookFromShipped(data = shipped) {
    const book = { entries: {}, extensions: { ri: { v: 1, type: 'banks', version: data?.version || 1 } } };
    let uid = 0;
    for (const bank of data?.banks.values() || []) { book.entries[uid] = bankEntry(uid, bank, { shipped: data.version }); uid++; }
    return book;
}

/**
 * Add what a shipped update brings to her book: banks she does not have, and items of banks she has that are not in
 * her entry and that she did not remove. Her own edits stay. Returns the number of items added.
 */
export function mergeShipped(book, data = shipped) {
    if (!book.entries) book.entries = {};
    let added = 0;
    const byDim = new Map(Object.values(book.entries).filter(e => e?.extensions?.ri?.type === 'bank').map(e => [e.extensions.ri.dim, e]));
    let uid = Math.max(-1, ...Object.keys(book.entries).map(Number).filter(Number.isFinite)) + 1;
    for (const bank of data?.banks.values() || []) {
        const entry = byDim.get(bank.id);
        if (!entry) { book.entries[uid] = bankEntry(uid, { ...bank, items: bank.items.map(it => ({ ...it, new: true })) }, { shipped: data.version }); added += bank.items.length; uid++; continue; }
        const ri = entry.extensions.ri;
        const have = new Set(ri.items.map(it => it.id));
        const dropped = new Set(ri.dropped || []);
        const fresh = bank.items.filter(it => !have.has(it.id) && !dropped.has(it.id));
        if (!fresh.length && ri.shipped >= data.version) continue;
        const next = bankEntry(entry.uid, { id: ri.dim, name: ri.name, kind: ri.kind, adult: ri.adult, items: [...ri.items, ...fresh.map(it => ({ ...it, new: true }))] },
            { rev: ri.rev + (fresh.length ? 1 : 0), shipped: data.version, dropped: ri.dropped });
        Object.assign(entry, { content: next.content, extensions: { ...entry.extensions, ri: next.extensions.ri } });
        added += fresh.length;
    }
    book.extensions = { ...(book.extensions || {}), ri: { v: 1, type: 'banks', version: data?.version || 1 } };
    return added;
}

/** Read her book into memory. Returns the map of banks. */
export function readBankData(book) {
    const out = new Map();
    for (const e of Object.values(book?.entries || {})) {
        const ri = e?.extensions?.ri;
        if (ri?.type !== 'bank' || !ri.dim) continue;
        out.set(ri.dim, { id: ri.dim, name: ri.name || ri.dim, kind: ri.kind || 'both', adult: !!ri.adult, rev: Number(ri.rev) || 1,
            items: (ri.items || []).map(normalBankItem), uid: e.uid });
    }
    return out;
}

/** Use this book as her banks (also used by tests). */
export function setBankData(book) { mine = book ? readBankData(book) : null; return mine; }

/** Read her book if it exists. Never creates it. */
export async function readBankBook() {
    if (!worldNames().includes(BANK_BOOK)) return null;
    const book = await loadBook(BANK_BOOK);
    if (book?.entries) mine = readBankData(book);
    return mine;
}

/**
 * First use: make "RI Option banks" from the shipped banks, or bring a shipped update into the book she has.
 * Safe to call often; the work runs once at a time.
 */
export function ensureBankBook() {
    if (loading) return loading;
    loading = (async () => {
        if (!shipped) await loadShipped();
        let book = worldNames().includes(BANK_BOOK) ? await loadBook(BANK_BOOK) : null;
        if (!book?.entries) {
            book = bookFromShipped();
            await saveBook(BANK_BOOK, book);
            await refreshWorldList();
        } else if (mergeShipped(book) || book.extensions?.ri?.version !== shipped.version) {
            await saveBook(BANK_BOOK, book);
        }
        mine = readBankData(book);
        return mine;
    })().finally(() => { loading = null; });
    return loading;
}

/** Change her book: edit(book) changes the book data, then it is saved and read again. */
export async function editBankBook(edit) {
    await ensureBankBook();
    const book = await loadBook(BANK_BOOK);
    edit(book);
    await saveBook(BANK_BOOK, book);
    mine = readBankData(book);
    return mine;
}

/** Replace the items of one bank in her book. Shipped items she removed are remembered so an update leaves them out. */
export function setBankItems(book, dim, items) {
    const entry = Object.values(book.entries || {}).find(e => e?.extensions?.ri?.type === 'bank' && e.extensions.ri.dim === dim);
    if (!entry) return false;
    const ri = entry.extensions.ri;
    const kept = new Set(items.map(it => it.id));
    const dropped = new Set(ri.dropped || []);
    for (const it of ri.items) if (!kept.has(it.id) && !it.group) dropped.add(it.id);
    const next = bankEntry(entry.uid, { id: dim, name: ri.name, kind: ri.kind, adult: ri.adult, items }, { rev: ri.rev + 1, shipped: ri.shipped, dropped: [...dropped] });
    Object.assign(entry, { content: next.content, extensions: { ...entry.extensions, ri: next.extensions.ri } });
    return true;
}

/** Add a bank for an imported list ("New dimension: name"). Returns its id. */
export function addBank(book, name, kind = 'both', adult = false) {
    const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'list';
    const have = new Set(Object.values(book.entries || {}).map(e => e?.extensions?.ri?.dim).filter(Boolean));
    let id = `mine-${base}`;
    for (let n = 2; have.has(id); n++) id = `mine-${base}-${n}`;
    const uid = Math.max(-1, ...Object.keys(book.entries || {}).map(Number).filter(Number.isFinite)) + 1;
    book.entries[uid] = bankEntry(uid, { id, name, kind, adult, items: [] });
    return id;
}

// ---------- what rolls read ----------

/** The banks in use: her book once read, else the shipped banks. */
export function banksNow() {
    if (mine) return mine;
    return shipped ? new Map([...shipped.banks].map(([id, b]) => [id, { ...b, rev: 1, items: b.items.map(normalBankItem) }])) : new Map();
}

/** The items of one bank, or null when the bank is not known. */
export function bankItems(id) {
    if (!id) return null;
    const b = (mine || null)?.get(id) || shipped?.banks.get(id);
    return b ? b.items.map(normalBankItem) : null;
}

export function bankInfo(id) {
    const b = mine?.get(id) || shipped?.banks.get(id);
    return b ? { id: b.id, name: b.name, kind: b.kind, adult: !!b.adult, count: b.items.length, rev: b.rev || 1 } : null;
}

/** The banks a set of this type may link to. adult banks only when asked. */
export function bankChoices(type, { adult = false } = {}) {
    return [...banksNow().values()].filter(b => (adult || !b.adult) && (b.kind === 'both' || b.kind === type || String(b.id).startsWith('mine-')))
        .map(b => ({ id: b.id, name: b.name, count: b.items.length, adult: !!b.adult }));
}

/** The bank version a roll records: the shipped version and the revision of every bank it read. */
export function bankVersion(ids) {
    const revs = {};
    for (const id of new Set(ids.filter(Boolean))) revs[id] = bankInfo(id)?.rev || 0;
    return { v: shipped?.version || 0, revs };
}

// ---------- seeded dice ----------

/** A new seed from the system's random source. */
export function newSeed() {
    try { const b = new Uint32Array(1); crypto.getRandomValues(b); return b[0] >>> 1; } catch { return Math.floor(Math.random() * 0x7fffffff); }
}

/** A generator of whole numbers from 0 to n - 1 that gives the same sequence for the same seed (mulberry32). */
export function seededRandom(seed) {
    let a = (Number(seed) >>> 0) || 1;
    const next = () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return n => (n <= 1 ? 0 : Math.floor(next() * n));
}

/** Pick up to count different items, each with a chance in proportion to its weight, from a seeded generator. */
export function pickSeeded(items, weightOf, count, rnd) {
    const pool = [...items];
    const out = [];
    while (pool.length && out.length < count) {
        const weights = pool.map(x => Math.max(1, Math.round(Number(weightOf(x)) || 1)));
        let r = rnd(weights.reduce((a, b) => a + b, 0));
        let i = 0;
        while (r >= weights[i]) { r -= weights[i]; i++; }
        out.push(pool.splice(i, 1)[0]);
    }
    return out;
}

/** A whole number from lo to hi with the seeded generator. */
export const between = (range, rnd) => { const [lo, hi] = Array.isArray(range) ? range : [range, range]; const a = Math.round(Number(lo) || 0); const b = Math.max(a, Math.round(Number(hi) || a)); return a + rnd(b - a + 1); };

// ---------- from picks to prompt text (A12 d.1a) ----------

/** The values of one category joined by its send rule. */
export function joinValues(values, send = 'together') {
    const list = (values || []).map(v => String(v).trim().replace(/\.+$/, '')).filter(Boolean);
    if (list.length <= 1) return list[0] || '';
    if (send === 'beat') return `one for each beat, in turn: ${list.join(', then ')}`;
    if (send === 'paragraph') return `one for each paragraph, in turn: ${list.join(', then ')}`;
    return list.length === 2 ? `${list[0]} and ${list[1]}` : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

// ---------- gated items (hidden subtext and ambient pulse) ----------

/**
 * One roll of a gated category. Each item waits for its earliest reply, then rolls its own die (1 in die) while fewer
 * than max are active; an item that fires stays for its duration, then rests. Returns { ids, state }.
 */
export function gatedRoll(pool, old, reply, rnd, max = DEFAULT_GATE_MAX) {
    const active = { ...(old?.active || {}) };
    const rest = { ...(old?.restUntil || {}) };
    const byId = new Map(pool.map(it => [it.id, it]));
    const shown = [];
    for (const id of Object.keys(active)) { if (byId.has(id) && shown.length < max) shown.push(id); else delete active[id]; }
    const order = pickSeeded(pool, () => 1, pool.length, rnd);
    for (const it of order) {
        if (shown.length >= max) break;
        const g = it.gate || {};
        if (active[it.id] || (Number(rest[it.id]) || 0) > reply || reply < (Number(g.reply) || 0)) continue;
        if (rnd(Math.max(1, Number(g.die) || 1)) !== 0) continue;
        active[it.id] = Math.max(1, between(g.dur || [2, 3], rnd));
        shown.push(it.id);
    }
    for (const id of shown) {
        active[id] -= 1;
        if (active[id] <= 0) { delete active[id]; rest[id] = reply + 1 + Math.max(0, between(byId.get(id).gate?.rest || [0, 0], rnd)); }
    }
    return { ids: shown, state: { active, restUntil: rest } };
}

// ---------- the polish step (off by default) ----------

export const POLISH_MS = 8000;

/**
 * Smooth the rolled parts into one or two sentences through the routed background model. Only the rolled parts and
 * the last reply are sent. Returns { ok, text, reason }. Any failure or a wait over timeoutMs returns ok false.
 */
export async function polishParts({ type, parts, lastReply = '', timeoutMs = POLISH_MS, run = null }) {
    const lines = (parts || []).map(p => `${p.name}: ${joinValues(p.items, p.send)}`);
    const system = 'You turn a list of rolled story parts into one or two plain sentences for a roleplay. Keep every part. Add nothing new. Answer with the sentences only.';
    const user = `${type === 'style' ? 'Writing style parts' : 'Story event parts'}:\n${lines.join('\n')}\n\nThe last reply, for context:\n${String(lastReply).slice(-1500)}`;
    const controller = new AbortController();
    let timer;
    try {
        const job = run || (async options => (await import('./routing.js')).runJob('capture', options));
        const answer = await Promise.race([
            job({ system, user, tokens: 200, signal: controller.signal, background: false, label: 'Smooth the rolled parts' }),
            new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve({ ok: false, reason: 'timeout' }); }, timeoutMs); }),
        ]);
        const text = String(answer?.text || answer?.value || '').trim();
        return answer?.ok && text ? { ok: true, text } : { ok: false, reason: answer?.reason || 'no answer' };
    } catch (e) { return { ok: false, reason: e?.message || 'error' }; }
    finally { clearTimeout(timer); }
}

/**
 * The engine hands over the items of one scan that asked for polish. Each is smoothed before the reply request;
 * a failure sends the raw parts and says so once. The record keeps both texts.
 */
export async function polishItems(items, { entries, texts, lastScan, wrap, note, run } = {}) {
    let failed = false;
    const chat = ctx().chat || [];
    const lastReply = [...chat].reverse().find(m => m && !m.is_user && !m.is_system)?.mes || '';
    for (const it of items) {
        const out = await polishParts({ type: it.polishType, parts: it.parts, lastReply, run });
        delete it.polishWanted; delete it.polishType;
        if (!out.ok) { failed = true; it.polished = { raw: it.version, text: '', ok: false, reason: out.reason }; continue; }
        it.polished = { raw: it.version, text: out.text, ok: true };
        it.version = out.text;
        it.text = wrap(it.sentAs, out.text);
        const entry = entries?.get(it.key);
        if (entry) entry.content = it.text;
        texts?.set(it.key, it.text);
        const scanned = lastScan?.items?.find(x => x.key === it.key);
        if (scanned) { scanned.version = it.version; scanned.polished = it.polished; }
    }
    if (failed) note?.('The polish step did not answer in time, so the rolled parts were sent as they are.');
}
