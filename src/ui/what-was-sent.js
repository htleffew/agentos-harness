// What was sent (memory DESIGN 11): what the model saw with a request, and why. Review, Context shows it for the next
// request and for any past reply; the message menu, Review, Replies and the tray's Sent card link here.
//
// The record of a request is saved when the request goes out: the chapter view, the recall block and the depth-0 block as
// they left after any trimming, each recalled record with its source and scores, the held-out list with reasons, the
// block sizes, the cache line and the Tracker book entries. It is kept in the device database under the reply's mark and
// swipe, and the reply's `extra` keeps the list of record ids (`ri_sent`), so the essentials travel with the chat. A past
// reply's view reads that saved copy and never rebuilds it from the fold, so a later edit, preset change or chapter
// rebuild leaves it as it was.
//
// The first half is pure (the record from an assembled request, the reasons, the rows); the second half wires the host
// and draws the page. Nothing here calls a model.
import { h, button, section, chip } from './dom.js';
import { layoutOf, tokensOf, prefixReport, SIZE_CAPS } from '../memory/inject.js';
import { registerPage } from './page-registry.js';

export const WHAT_WAS_SENT_PAGE = 'what-was-sent';

export const SENT_KEY = 'ri_sent';
export const SENT_VERSION = 1;
const DB_PREFIX = 'sent:';
export const dbKey = (chatId, mark, swipe) => `${DB_PREFIX}${chatId}:${mark}:${swipe}`;

const plain = content => (typeof content === 'string' ? content : Array.isArray(content) ? content.map(p => (typeof p?.text === 'string' ? p.text : '')).join('') : '');
const between = (text, open, close) => { const a = text.indexOf(open), b = text.indexOf(close); return a >= 0 && b > a ? text.slice(a, b + close.length) : ''; };

// ---------------------------------------------------------------- the reasons a candidate was held out (11, Held out)

/** The five reasons of memory DESIGN 11, from the search's own words. Returns { label, detail }. */
export function heldReason(reason) {
    const text = String(reason || '');
    if (text === 'holder') return { label: 'Secret holder absent', detail: 'No one in the scene knows it.' };
    if (text.startsWith('repeats')) return { label: 'Repeats your entry', detail: 'One of your World Info entries already says it.' };
    if (text.startsWith('older record') || text === 'replaced' || text === 'retired' || text === 'merged') return { label: 'Replaced', detail: text === 'retired' ? 'Retired by upkeep.' : text === 'merged' ? 'Merged into another record.' : 'A newer record on the same subject holds.' };
    if (text.startsWith('below the cut')) { const score = text.match(/\(([^)]+)\)/)?.[1]; return { label: 'Below the cut', detail: score ? `Relevance ${score} is under the cut.` : 'Relevance is under the cut.' }; }
    if (text.startsWith('over the')) return { label: 'Over the cap', detail: `${text.replace(/^over the /, 'Over the ')}.` };
    return { label: text || 'Held out', detail: '' };
}

// ---------------------------------------------------------------- the record of one request (pure)

/**
 * The scores of one recalled record, as the search weighs them: relevance (as the search measured it), recency (the decay
 * over replies since its source reply) and importance (0 to 10). source: { srcTurn, index }, turn: the reply number now.
 */
export function scoresOf({ rel = null, srcTurn = 0, importance = 5, decay = 0.995, turn = 0, ageless = false }) {
    const recency = ageless ? 1 : Math.pow(decay, Math.max(0, turn - srcTurn));
    return { relevance: Number.isFinite(rel) ? +Number(rel).toFixed(3) : null, recency: +recency.toFixed(3), importance: Number.isFinite(Number(importance)) ? Number(importance) : 5 };
}

/**
 * Build the saved record of one request from what the host knows at send time.
 *   messages   the assembled Chat Completion messages, after any trimming
 *   recall     lastRecall() of src/recall.js for this turn, or null
 *   held       recallRuntime().held: { overridden, repeats, outside }
 *   result     the fold of the chat; sources: sourcesFromChat() of src/memory/index.js
 *   chapter    chapterState().view plus the condensed record: { ids, full, condensedFrom, tokens, condensedAt }
 *   tracker    [{ book, uid, title, content }] Tracker book entries the scan fired, with the reply they reflect
 *   previous   the messages of the previous request of this chat, for the cache line
 *   expect     { view, recall }: whether the extension put each block in this request (the trim guard)
 * Returns a plain object, safe to store as is.
 */
export function buildSentRecord({ messages = [], recall = null, held = null, result = null, sources = null, chapter = null, tracker = [], trackerReply = null, previous = null, expect = {}, size = 'mid', decay = 0.995, at = Date.now(), type = 'normal', chatId = '' } = {}) {
    const layout = layoutOf(messages);
    const text = i => (i >= 0 ? plain(messages[i]?.content) : '');
    const blocks = {
        view: between(text(layout.view), '<story_so_far>', '</story_so_far>'),
        recall: between(text(layout.recall), '<recall>', '</recall>'),
        depth0: layout.reminder >= 0 ? text(layout.reminder) : '',
    };
    const cut = [];
    if (expect.view && layout.view < 0) cut.push('chapter view');
    if (expect.recall && layout.recall < 0) cut.push('recall block');
    const total = messages.reduce((sum, m) => sum + tokensOf(plain(m.content)), 0);
    const caps = SIZE_CAPS[size] || SIZE_CAPS.mid;
    const byId = result?.byId || new Map();
    const srcOf = new Map((sources?.records || []).map(r => [r.id, r.srcTurn]));
    const turn = sources?.turn ?? 0;
    const recalled = [];
    for (const item of recall?.items || []) {
        const key = String(item.key || '');
        if (key.startsWith('rec:')) {
            const id = key.slice(4);
            const r = byId.get(id) || {};
            const index = r.versions?.at(-1)?.index ?? r.versions?.[0]?.index ?? null;
            recalled.push({ key, id, kind: r.kind || 'record', subject: r.subject || id, text: String(r.text || '').slice(0, 300), tokens: item.tokens || 0,
                source: Number.isInteger(index) ? { index, mark: r.versions?.at(-1)?.anchor?.mark || '' } : null,
                scores: scoresOf({ rel: item.rel, srcTurn: srcOf.get(id) ?? 0, importance: r.importance, decay, turn }),
                why: r.pinned || (result?.pins || []).includes(id) ? 'Pinned by you' : item.fired ? 'Its World Info entry fired' : 'Ranked by relevance, recency and importance' });
        } else if (key.startsWith('lore:')) {
            const [, book, uid] = key.match(/^lore:(.*):([^:]+)$/) || [];
            recalled.push({ key, id: key, kind: 'entry', subject: book ? `${book}, entry ${uid}` : key, text: '', tokens: item.tokens || 0, source: null,
                scores: scoresOf({ rel: item.rel, ageless: true, importance: 5 }), why: item.fired ? 'Its World Info entry fired' : 'Found by meaning search' });
        } else {
            recalled.push({ key, id: key, kind: item.type || 'excerpt', subject: key, text: '', tokens: item.tokens || 0, source: null, scores: scoresOf({ rel: item.rel, ageless: true }), why: 'A passage of an earlier reply' });
        }
    }
    const heldOut = [];
    const label = key => { const id = String(key).replace(/^rec:/, ''); const r = byId.get(id); return r ? `${r.subject || id}` : String(key).replace(/^lore:/, ''); };
    for (const d of recall?.dropped || []) heldOut.push({ key: d.key, subject: label(d.key), ...heldReason(d.reason) });
    for (const id of held?.repeats || []) heldOut.push({ key: `rec:${id}`, subject: label(id), ...heldReason('repeats') });
    for (const id of held?.outside || []) { const st = byId.get(id)?.status; if (['retired', 'replaced', 'merged'].includes(st)) heldOut.push({ key: `rec:${id}`, subject: label(id), ...heldReason(st) }); }
    for (const ref of held?.overridden || []) heldOut.push({ key: `entry:${ref}`, subject: String(ref).replace(/:(\d+)$/, ', entry $1'), label: 'Replaced', detail: 'A "The story changed" record replaces this entry in this chat.' });
    const trackerRows = (tracker || []).map(e => ({ book: e.book || e.world || '', uid: String(e.uid ?? ''), title: e.title || e.comment || `Entry ${e.uid}`, tokens: tokensOf(e.content) }));
    const trackerTokens = trackerRows.reduce((s, e) => s + e.tokens, 0);
    return {
        v: SENT_VERSION, at, type, chatId,
        chapter: chapter ? { ids: [...(chapter.ids || [])], full: [...(chapter.full || [])], condensedFrom: chapter.condensedFrom || '', condensedAt: chapter.condensedAt || null, tokens: layout.tokens.view || chapter.tokens || 0 } : null,
        recall: recalled, held: heldOut,
        sizes: { view: layout.tokens.view, recall: layout.tokens.recall, instruction: layout.tokens.instruction, tracker: trackerTokens, depth0: tokensOf(blocks.depth0), total, ceiling: caps.ceiling, caps: { view: caps.view, recall: caps.recall, tracker: caps.tracker } },
        cache: previous ? prefixReport(previous, messages.map(m => ({ role: m.role, content: plain(m.content) }))) : null,
        tracker: { entries: trackerRows, tokens: trackerTokens, cap: caps.tracker, reply: trackerReply },
        cut, blocks, ids: recalled.filter(r => r.key.startsWith('rec:')).map(r => r.id),
    };
}

/** The essentials a reply carries in its `extra`, per swipe: the record ids sent and when. */
export function sentEssentials(record, swipe) {
    return { v: SENT_VERSION, swipe, at: record.at, ids: [...record.ids], tokens: record.sizes.total };
}

/** Write the essentials onto a message's showing swipe (and its swipe_info slot). */
export function stampSent(message, record, swipe) {
    const value = sentEssentials(record, swipe);
    message.extra ||= {};
    message.extra[SENT_KEY] = value;
    const info = Array.isArray(message.swipe_info) ? message.swipe_info[swipe] : null;
    if (info && typeof info === 'object') { info.extra ||= {}; info.extra[SENT_KEY] = structuredClone(value); }
    return value;
}

/** The essentials of the swipe that shows, or null. */
export function sentOf(message, swipe) {
    const value = message?.extra?.[SENT_KEY];
    return value && value.swipe === swipe ? value : null;
}

// ---------------------------------------------------------------- the host

let H = null;
async function host() {
    if (H) return H;
    const [st, fold, store, recall, index, chapters, deviceDb, budget, storyWorldBook, trackerBook, fired, settingsMod] = await Promise.all([
        import('../st.js'), import('../memory/fold.js'), import('../memory/store.js'), import('../recall.js'), import('../memory/index.js'), import('../chapters.js'),
        import('../memory/device-db.js'), import('../context-budget.js'), import('../memory/story-world-book.js'), import('../tracker-book.js'), import('../memory/fired-entries.js'), import('../store.js'),
    ]);
    H = { st, fold, store, recall, index, chapters, db: deviceDb.deviceDb(), budget, storyWorldBook, trackerBook, fired, settingsMod };
    return H;
}

const turn = { active: false, at: 0, type: 'normal', tracker: [], pending: null };
let previous = null;
const kept = new Map();

const chatIdOf = c => String(c.getCurrentChatId?.() || '');

function chapterInfo(Hx) {
    try {
        const state = Hx.chapters.chapterState({ forRequest: turn.type });
        const condensed = state.condensed;
        return { ...state.view, condensedAt: condensed?.versions?.at(-1)?.at || null };
    } catch { return null; }
}

/** At send time: build the record from the assembled request and hold it until the reply lands. */
export async function onSendReady(data) {
    if (!turn.active || data?.dryRun || !Array.isArray(data?.chat)) return null;
    const Hx = await host();
    const c = Hx.st.ctx();
    if (!c.chatMetadata?.[Hx.fold.MEMORY]?.imported) return null;
    const chat = c.chat || [];
    const replacing = ['swipe', 'regenerate', 'continue'].includes(turn.type) && chat.length > 0 && !chat.at(-1)?.is_user;
    const result = Hx.fold.fold(chat, c.chatMetadata, replacing ? { before: chat.length - 1 } : {});
    const sources = Hx.index.sourcesFromChat({ chat, result });
    const last = Hx.recall.lastRecall?.();
    const recall = last && last.kind === 'turn' && last.at >= turn.at ? last : null;
    const assembly = Hx.chapters && (await import('../hide.js')).lastChapterAssembly?.();
    const chatId = chatIdOf(c);
    const messages = data.chat.map(m => ({ role: m.role, content: plain(m.content) }));
    const latest = Hx.trackerBook.latestTracker(chat);
    const record = buildSentRecord({
        messages, recall, held: recall ? Hx.recall.recallRuntime().held : null, result: { ...result, pins: c.chatMetadata?.[Hx.fold.MEMORY]?.pins || [] }, sources,
        chapter: chapterInfo(Hx), tracker: turn.tracker, trackerReply: latest ? latest.number : null,
        previous: previous && previous.chatId === chatId ? previous.messages : null,
        expect: { view: !!(assembly && assembly.inserted && assembly.at >= turn.at && assembly.chatId === chatId), recall: !!(recall && recall.chars > 0) },
        size: Hx.budget.memorySize?.().key || 'mid', decay: Hx.recall.recallValues?.().decay ?? 0.995, at: Date.now(), type: turn.type, chatId,
    });
    previous = { chatId, messages };
    turn.pending = record;
    return record;
}

/** When the reply lands: key the held record by the reply's mark and swipe, stamp the essentials on the reply, save. */
export async function onReplyLanded(index) {
    const record = turn.pending;
    if (!record) return null;
    turn.pending = null;
    const Hx = await host();
    const c = Hx.st.ctx();
    const at = Number.isInteger(Number(index)) ? Number(index) : (c.chat || []).length - 1;
    const message = c.chat?.[at];
    if (!message || message.is_user || chatIdOf(c) !== record.chatId) return null;
    Hx.store.memoryStore().marks();
    const mark = Hx.fold.storedMark(message);
    const swipe = Hx.fold.swipeOf(message);
    if (!mark) return null;
    const saved = { ...record, mark, swipe, index: at };
    const key = dbKey(record.chatId, mark, swipe);
    kept.set(key, saved);
    stampSent(message, saved, swipe);
    await Hx.db.put(key, saved).catch(() => {});
    try { (c.saveChatDebounced || c.saveChat)?.call(c); } catch { /* the next save carries it */ }
    return saved;
}

/** The saved record of one reply's showing swipe: the device copy, or null with the essentials when it was saved elsewhere. */
export async function savedFor(index) {
    const Hx = await host();
    const c = Hx.st.ctx();
    const message = c.chat?.[index];
    if (!message) return { record: null, essentials: null };
    const mark = Hx.fold.storedMark(message);
    const swipe = Hx.fold.swipeOf(message);
    const key = dbKey(chatIdOf(c), mark, swipe);
    const record = kept.get(key) || await Hx.db.get(key).catch(() => null);
    return { record: record || null, essentials: sentOf(message, swipe), swipe };
}

/** The next request as it stands now, built in code: the chapter view, a recall search on the message box text, the Tracker book. */
export async function nextRequest({ message = null } = {}) {
    const Hx = await host();
    const c = Hx.st.ctx();
    if (!c.chatMetadata?.[Hx.fold.MEMORY]?.imported) return null;
    const chat = c.chat || [];
    const meta = c.chatMetadata;
    const rt = Hx.recall.recallRuntime();
    // the entries of the managed books from the last request stay indexed; passing them keeps them so
    const lore = { globalLore: (rt.books || []).flatMap(b => b.entries.map(e => ({ ...e, world: b.name }))) };
    const typed = message ?? String(globalThis.document?.querySelector('#send_textarea')?.value || '');
    const saveHeld = rt.held;
    let done = null;
    try { done = await Hx.recall.runRecallTurn({ lore, host: { chat, meta, pov: c.name2 || '', type: 'normal', message: typed } }); } catch { done = null; }
    const held = rt.held;
    rt.held = saveHeld;
    const result = Hx.fold.fold(chat, meta);
    const view = chapterInfo(Hx);
    const viewText = view?.text ? `<story_so_far>\n${view.text}\n</story_so_far>` : '';
    const messages = [viewText && { role: 'system', content: viewText }, done?.block && { role: 'system', content: done.block }].filter(Boolean);
    const latest = Hx.trackerBook.latestTracker(chat);
    const trackerEntries = latest ? Hx.trackerBook.trackerEntries(latest) : [];
    const record = buildSentRecord({
        messages, recall: done ? { kind: 'turn', items: done.search.items.map(i => ({ key: i.key, type: i.type, tokens: i.tokens ?? 0, fired: !!i.fired, rel: i.rel ?? null })), dropped: done.search.dropped || [] } : null,
        held, result: { ...result, pins: meta?.[Hx.fold.MEMORY]?.pins || [] }, sources: Hx.index.sourcesFromChat({ chat, result }), chapter: view,
        tracker: trackerEntries.map(e => ({ book: 'Tracker book', uid: e.uid ?? e.card, title: e.comment || e.card, content: e.content })), trackerReply: latest?.number ?? null,
        size: Hx.budget.memorySize?.().key || 'mid', decay: Hx.recall.recallValues?.().decay ?? 0.995, type: 'next', chatId: chatIdOf(c),
    });
    return { ...record, next: true, message: typed };
}

let started = false;
/** Wire the saving to the host once. */
export async function startWhatWasSent() {
    if (started) return;
    started = true;
    const Hx = await host();
    const { on } = Hx.st;
    on('GENERATION_STARTED', (type, opts, dryRun) => {
        if (dryRun) return;
        const quiet = type === 'quiet' || !!opts?.quiet_prompt;
        Object.assign(turn, { active: !quiet, at: Date.now(), type: String(type || 'normal'), tracker: [], pending: null });
    });
    on('WORLDINFO_SCAN_DONE', args => {
        if (!turn.active) return;
        const list = args?.activated?.entries;
        const values = list instanceof Map ? [...list.values()] : Array.isArray(list) ? list : [];
        for (const e of values) if (String(e?.world || '').startsWith(Hx.storyWorldBook.TRACKER_PREFIX) && !turn.tracker.some(t => t.world === e.world && t.uid === e.uid)) turn.tracker.push({ world: e.world, uid: e.uid, comment: e.comment, content: e.content });
    });
    on('CHAT_COMPLETION_PROMPT_READY', data => { onSendReady(data).catch(error => console.warn(Hx.st.LOG, 'what was sent', error)); });
    on('MESSAGE_RECEIVED', index => { onReplyLanded(index).catch(error => console.warn(Hx.st.LOG, 'what was sent', error)); });
    for (const name of ['GENERATION_ENDED', 'GENERATION_STOPPED']) on(name, () => { turn.active = false; });
    on('CHAT_CHANGED', () => { turn.active = false; turn.pending = null; previous = null; });
}

// ---------------------------------------------------------------- the view

const n = v => Number(v || 0).toLocaleString();
const kv = (k, v) => h('div', { class: 'ri-kv' }, h('span', { class: 'ri-k' }, k), h('span', { class: 'ri-v' }, v));
const when = at => (at ? new Date(at).toLocaleString() : 'not yet');

/** The parts of section 11 for one record. app opens the source reply's history in Story World. */
export function sentView(record, { app = null, essentials = null, fired = [], roll = null, receipts = [], note = '' } = {}) {
    const parts = [];
    if (!record) {
        parts.push(h('p', { class: 'ri-note' }, essentials
            ? `This reply's full view was saved on another device. It sent ${essentials.ids.length} records (${essentials.ids.join(', ') || 'none'}), about ${n(essentials.tokens)} tokens in all.`
            : 'Nothing was saved for this reply: it was written before What was sent kept records, or memory was off for this chat.'));
        return parts;
    }
    const c = record.chapter;
    parts.push(section('Chapter view',
        c ? h('div', { class: 'ri-grid' },
            kv('In full', c.full?.length ? c.full.join(', ') : 'none'),
            kv('Condensed account', c.condensedFrom ? `${c.condensedFrom}, rebuilt ${when(c.condensedAt)}` : 'none'),
            kv('Tokens', `${n(c.tokens)} of ${n(record.sizes.caps.view)}`)) : h('p', { class: 'ri-muted' }, record.next ? 'No chapter view would go out.' : 'No chapter view went out.')));
    const openSource = r => app && r.source && button(`Reply ${r.source.index}`, () => { app.worldFilter = { reply: r.source.index }; app.openPage('world'); }, { kind: 'ghost', title: 'Open Story World on what this reply filed' });
    parts.push(section(`Recall block (${record.recall.length})`,
        record.recall.length ? h('ul', { class: 'ri-chat-books ri-sent-recall' }, record.recall.map(r => h('li', { class: 'ri-card ri-tight', 'data-ri-recalled': r.id },
            h('div', { class: 'ri-card-top' }, h('strong', {}, r.subject), chip(r.kind)),
            r.text ? h('div', { class: 'ri-world-line' }, r.text) : null,
            h('div', { class: 'ri-chips' },
                chip(`relevance ${r.scores.relevance ?? 'n/a'}`), chip(`recency ${r.scores.recency}`), chip(`importance ${r.scores.importance}`), chip(`${n(r.tokens)} tokens`)),
            h('div', { class: 'ri-help' }, r.why),
            h('div', { class: 'ri-row' }, openSource(r) || (r.source ? chip(`Reply ${r.source.index}`) : null)))))
            : h('p', { class: 'ri-muted' }, record.next ? 'No recall block would go out.' : 'No recall block went out.')));
    parts.push(section(`Held out (${record.held.length})`,
        record.held.length ? h('ul', { class: 'ri-chat-books ri-sent-held' }, record.held.map(x => h('li', { class: 'ri-row ri-row-tight', 'data-ri-held': x.key },
            h('strong', {}, x.subject), chip(x.label, 'ri-chip-wait'), x.detail ? h('span', { class: 'ri-help' }, x.detail) : null)))
            : h('p', { class: 'ri-muted' }, 'No candidate was held out.')));
    const s = record.sizes;
    parts.push(section('Sizes', h('div', { class: 'ri-grid' },
        kv('Chapter view', `${n(s.view)} of ${n(s.caps.view)} tokens`), kv('Recall block', `${n(s.recall)} of ${n(s.caps.recall)} tokens`),
        kv('Tracker book', `${n(s.tracker)} of ${n(s.caps.tracker)} tokens`), kv('Memory notes', `${n(s.instruction)} tokens`), kv('Depth 0', `${n(s.depth0)} tokens`),
        kv('Whole request', record.next ? 'Known when it is sent' : `${n(s.total)} of ${n(s.ceiling)} tokens`))));
    parts.push(section('Cache', record.cache
        ? h('p', { class: 'ri-help', 'data-ri-cache': '' }, `First changed message: ${n(record.cache.firstChanged + 1)} of ${n(record.cache.messages)}, and about ${n(record.cache.lostTokens)} tokens after it are reprocessed.${record.cache.followsHistory ? 'The change follows the history.' : 'The change starts above the history: a chapter closed, or something above the history changed.'}`)
        : h('p', { class: 'ri-muted' }, record.next ? 'Known when it is sent.' : 'First request of this chat in this session.')));
    const t = record.tracker;
    parts.push(section('Tracker book', t.entries.length
        ? [h('p', { class: 'ri-help' }, `Values from reply ${t.reply ?? 'n/a'}, ${n(t.tokens)} of ${n(t.cap)} tokens.`), h('ul', { class: 'ri-chat-books' }, t.entries.map(e => h('li', {}, `${e.title} (${n(e.tokens)} tokens)`)))]
        : h('p', { class: 'ri-muted' }, record.next ? 'No Tracker book entries would go out.' : 'No Tracker book entries went out.')));
    parts.push(section('Behavior entries and roll',
        fired.length ? h('ul', { class: 'ri-chat-books', 'data-ri-fired': '' }, fired.map(e => h('li', {}, `${e.title}, ${e.book}`))) : h('p', { class: 'ri-muted' }, record.next ? 'Known when SillyTavern scans for the request.' : 'No behavior entry fired.'),
        roll ? h('p', { class: 'ri-help', 'data-ri-roll': '' }, roll) : null));
    parts.push(section('Trim warnings', record.cut.length
        ? h('div', { class: 'ri-note ri-note-problem', role: 'status' }, `SillyTavern cut the ${record.cut.join(' and the ')} from this request.`)
        : h('p', { class: 'ri-muted' }, 'Nothing was cut.')));
    if (receipts.length) parts.push(section('Background receipts', h('ul', { class: 'ri-chat-books' }, receipts.map(r => h('li', {}, r)))));
    if (note) parts.push(h('p', { class: 'ri-help', 'data-ri-generated-note': '' }, note));
    const blocks = [['Chapter view', record.blocks.view], ['Recall block', record.blocks.recall], ['Depth 0', record.blocks.depth0]].filter(([, text]) => text);
    if (blocks.length) parts.push(h('details', { class: 'ri-card ri-tight' }, h('summary', {}, 'The blocks as they went out'),
        blocks.map(([name, text]) => h('div', {}, h('div', { class: 'ri-label' }, name), h('pre', { class: 'ri-sent-block' }, text)))));
    return parts;
}

/** A roll as one line: route, margin and degree (7.7). */
export function rollText(check) {
    if (!check || !Number.isFinite(Number(check.total))) return '';
    const margin = Number.isFinite(Number(check.dc)) ? Number(check.total) - Number(check.dc) : null;
    return `Roll: ${check.name || check.actor || 'someone'}, ${check.stat || 'stat'} ${check.total}${check.dc ? ` against ${check.dc}` : ''}${margin !== null ? `, margin ${margin >= 0 ? '+' : ''}${margin}` : ''}, ${check.degree || check.result || 'no degree'}${check.route ? `, route ${check.route}` : ''}.`;
}

/** Review, Context, What was sent: the next request, or the reply app.sentReply (or a reply target) names. */
export function renderWhatWasSent(body, app) {
    const root = h('div', { id: 'ri-what-was-sent' }, h('p', { class: 'ri-muted' }, 'Loading...'));
    body.append(root);
    fillWhatWasSent(root, app).catch(error => root.replaceChildren(h('p', { class: 'ri-note ri-note-warn' }, `What was sent could not be read: ${error.message}`)));
}

async function fillWhatWasSent(body, app) {
    const Hx = await host();
    body.replaceChildren();
    const c = Hx.st.ctx();
    if (!Hx.st.isChatOpen()) { body.append(h('p', { class: 'ri-muted' }, 'Open a chat to see what it sends.')); return; }
    const chat = c.chat || [];
    const replies = chat.map((m, i) => (Hx.st.isReply(m) && i > 0 ? i : -1)).filter(i => i >= 0);
    const reply = Number.isInteger(app.replyTarget) ? app.replyTarget : Number.isInteger(app.replyTarget?.index) ? app.replyTarget.index : null;
    const target = Number.isInteger(app.sentReply) ? app.sentReply : reply;
    const picker = h('select', { class: 'ri-input', 'aria-label': 'Request to show', onchange: () => { app.sentReply = picker.value === 'next' ? null : Number(picker.value); app.render(); } },
        h('option', { value: 'next', selected: target === null }, 'The next request'),
        [...replies].reverse().map(i => h('option', { value: String(i), selected: target === i }, `Reply ${i}${i === replies.at(-1) ? ' (latest)' : ''}`)));
    const holder = h('div', { 'data-ri-sent-view': target === null ? 'next' : String(target) }, h('p', { class: 'ri-muted' }, 'Loading...'));
    body.append(h('p', { class: 'ri-help' }, 'What the model saw with a request, and why. A past reply shows the copy saved when its request was sent.'),
        h('div', { class: 'ri-field' }, h('div', { class: 'ri-label' }, 'Request'), picker), holder);
    const note = Hx.storyWorldBook.generatedBookNote();
    try {
        if (target === null) {
            const record = await nextRequest();
            holder.replaceChildren(...(record ? sentView(record, { app, note }) : [h('p', { class: 'ri-muted' }, 'This chat keeps no memory in chat data yet, so no recall block goes out.')]));
            return;
        }
        const { record, essentials } = await savedFor(target);
        const message = chat[target];
        const rec = message?.extra?.[Hx.st.KEY];
        const fired = Hx.fired.firedOf(message).filter(e => e.behavior !== false);
        const stamp = message?.extra?.[Hx.fold.MEMORY]?.capture;
        const receipts = [
            stamp && ['Capture', stamp.route && `route ${stamp.route}`, stamp.model, `${n(stamp.ops)} changes written`, stamp.at && when(stamp.at), stamp.notes?.length && `${stamp.notes.length} corrections by code`].filter(Boolean).join(', '),
            ...Hx.store.memoryStore().jobs().filter(j => j.mark && j.mark === Hx.fold.storedMark(message)).slice(-6)
                .map(j => [j.kind || 'Job', j.reason, j.at && when(j.at)].filter(Boolean).join(', ')),
            ...Hx.chapters.chapterFailures().filter(f => f.from <= target && f.to >= target).map(f => `Chapter failed: ${(f.problems || []).join(' ') || 'no answer'}. Repair it from the chapter divider in the chat.`),
        ].filter(Boolean);
        holder.replaceChildren(...sentView(record, { app, essentials, fired, roll: rollText(rec?.v10Check || rec?.roll), receipts, note }));
    } catch (error) { holder.replaceChildren(h('p', { class: 'ri-note ri-note-warn' }, `What was sent could not be read: ${error.message}`)); }
}

registerPage({ id: WHAT_WAS_SENT_PAGE, group: 'review', tab: 'context', subgroup: 'Context', label: 'What was sent', order: 0,
    help: 'What the model saw with the next request or a past reply: the chapter view, recalled records with their scores, what was held out and why, sizes and the cache.',
    aliases: 'recall block held out scores cache chapter view tracker book behavior entries roll trim request what the model saw',
    render: (body, app) => renderWhatWasSent(body, app) });

if (globalThis.SillyTavern?.getContext) startWhatWasSent().catch(error => console.warn('[Roleplay Instructions] what was sent', error));
