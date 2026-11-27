// Story, Story World as the record browser (memory DESIGN 12.2): the records of this chat from chat data, filtered by
// People, Facts, Plot, Secrets, Chapters, Retired and Needs you, with search; each record with its history, sources,
// Undo, Lock, Pin and Restore; the story so far; Open as World Info book and Export as World Info book (2.2, MB13).
// Story, Facts and Story, Plot are two of its filters (UI design 3.5). Every write goes through the memory store, the
// upkeep functions of MB7 or the Story World book of MB13; nothing here calls a model, apart from the chapter buttons,
// which carry the Cost chip.
import { h, button, chip, field, section, select, textInput, toggle } from './dom.js';
import { executionAction } from './execution.js';
import { registerPage } from './page-registry.js';
import { MEMORY, OUT_OF_FORCE, fold } from '../memory/fold.js';
import { memoryStore } from '../memory/store.js';
import { historyRows, undoChange, restoreRecord, JOB_LABELS } from '../memory/upkeep.js';
import { storyWorld } from '../memory/story-world-book.js';
import { setMeterByHand, AXES, METER_MIN, METER_MAX } from '../memory/capture.js';
import { latestTracker } from '../tracker-book.js';
import { readTemperament, setTemperament, SPEED_KEYS, SPEED_DEFAULT } from '../memory/temperament.js';
import { isPaused, endsWhenOf, setThreadEnds, setThreadPaused } from '../memory/thread-state.js';
import { ctx, KEY, isChatOpen, toast } from '../st.js';
import { memoryActive } from '../memory/import.js';
import { gateModelButtons } from './memory-settings.js';
import { catchUpStatusLine } from './context-dashboard.js';
import { RECORD_KINDS, canAddRecord, editableRecord, readRecordById } from '../records.js';

// ---------------------------------------------------------------- filters (pure)

export const FILTERS = Object.freeze([
    { id: 'all', label: 'All' },
    { id: 'people', label: 'People', kinds: ['person', 'trait', 'relationship', 'emotion', 'reputation'] },
    { id: 'facts', label: 'Facts', kinds: ['fact', 'place', 'item', 'achievement', 'scene'] },
    { id: 'plot', label: 'Plot', kinds: ['thread'] },
    { id: 'secrets', label: 'Secrets', kinds: ['secret'] },
    { id: 'chapters', label: 'Chapters', kinds: ['chapter', 'condensed', 'arc'] },
    { id: 'retired', label: 'Retired' },
    { id: 'needs', label: 'Needs you' },
]);
const KIND_WORDS = { person: 'Person', trait: 'Trait', relationship: 'Relationship', emotion: 'Emotion', reputation: 'Reputation', fact: 'Fact', place: 'Place', item: 'Item',
    achievement: 'Achievement', scene: 'Scene', thread: 'Thread', secret: 'Secret', chapter: 'Chapter', condensed: 'Condensed account', arc: 'Arc record' };
/** The record types Add record offers under each filter: the types the old Facts, Plot, Portrayal and Emotions pages offered. */
export const FILTER_KINDS = Object.freeze({
    all: Object.keys(RECORD_KINDS), people: ['profile', 'emotion', 'relationship'], facts: ['fact'], plot: ['arc', 'seed', 'agenda', 'event'], secrets: ['knowledge'],
});
/** The page ids that open Story World on one filter (UI design 3.5). */
const FILTER_PAGES = Object.freeze({ facts: 'facts', plots: 'plot' });
export const kindWord = kind => KIND_WORDS[kind] || kind;
/** A long text cut for a one-line row; the record itself keeps the whole text. */
const clip = (text, max = 160) => (String(text).length > max ? `${String(text).slice(0, max - 3).trimEnd()}...` : String(text));

/** Every reply index a record has a version on. */
export const repliesOf = r => new Set((r.versions || []).map(v => v.index).filter(Number.isInteger));

/**
 * The records one filter shows. result: the fold; pins: the pinned ids; query: words to match; reply: a reply index
 * (Memory from this reply) or null; flagged: the record ids a review flag names.
 */
export function filterRecords(result, { filter = 'all', query = '', reply = null, pins = [], flagged = new Set() } = {}) {
    const words = String(query || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    const def = FILTERS.find(f => f.id === filter) || FILTERS[0];
    const out = (result?.records || []).filter(r => {
        const retired = OUT_OF_FORCE.includes(r.status);
        if (def.id === 'retired') { if (!retired) return false; } else if (retired) return false;
        if (def.kinds && !def.kinds.includes(r.kind)) return false;
        if (def.id === 'needs' && !(flagged.has(r.id) || r.stale || r.suspect)) return false;
        if (Number.isInteger(reply) && !repliesOf(r).has(reply)) return false;
        if (words.length) {
            const hay = [r.subject, r.attribute, r.text, ...(r.aliases || []), ...(r.holders || [])].join(' ').toLowerCase();
            if (!words.every(w => hay.includes(w))) return false;
        }
        return true;
    });
    const pinned = new Set(pins);
    return out.sort((a, b) => (pinned.has(b.id) - pinned.has(a.id)) || String(a.subject || '').localeCompare(String(b.subject || '')));
}

/** The counts per filter, for the chips. */
export function filterCounts(result, options = {}) {
    return Object.fromEntries(FILTERS.map(f => [f.id, filterRecords(result, { ...options, filter: f.id, query: '' }).length]));
}

/** The meters a person row shows: the latest Emotions axes and the Relationships level, from the newest reply's tracker. */
export function metersOf(tracker, name) {
    const fold_ = s => String(s || '').trim().toLowerCase();
    const find = card => (Array.isArray(tracker?.[card]) ? tracker[card].find(x => fold_(x?.name) === fold_(name)) : null);
    const out = [];
    const emotion = find('emotions');
    for (const axis of AXES) if (Number.isFinite(Number(emotion?.axes?.[axis]))) out.push({ card: 'emotions', field: 'axes', axis, label: axis[0].toUpperCase() + axis.slice(1), value: Number(emotion.axes[axis]) });
    const rel = find('relationships');
    if (Number.isFinite(Number(rel?.level))) out.push({ card: 'relationships', field: 'level', axis: '', label: 'Relationship level', value: Number(rel.level) });
    const locks = new Set(tracker?.locks || []);
    return out.map(m => ({ ...m, locked: [...locks].some(id => id.includes(m.card) && id.includes(m.field) && (!m.axis || id.includes(m.axis)) && id.toLowerCase().includes(fold_(name))) }));
}

// ---------------------------------------------------------------- the host side

const chatNow = () => { const c = ctx(); return { c, chat: c.chat || [], meta: c.chatMetadata || {} }; };
const pinsOf = meta => (Array.isArray(meta?.[MEMORY]?.pins) ? meta[MEMORY].pins : []);

/** Pin or unpin a record: recall always considers a pinned record (4.2). Kept in chat data. */
export async function setPinned(id, on) {
    const { c, meta } = chatNow();
    const mem = (meta[MEMORY] ||= {});
    const pins = new Set(pinsOf(meta));
    if (on) pins.add(id); else pins.delete(id);
    mem.pins = [...pins];
    await (c.saveMetadata?.() ?? c.saveChat?.());
    return mem.pins;
}

/** A meter she sets by hand on the newest reply that carries tracker values; it locks so later steps start from it. */
export async function setMeter(name, meter, value) {
    const { c, chat } = chatNow();
    const latest = latestTracker(chat);
    if (!latest) throw new Error('No reply carries tracker values yet.');
    const ok = setMeterByHand(chat[latest.index], KEY, { card: meter.card, name, field: meter.field, axis: meter.axis, value });
    if (!ok) throw new Error('The value is not a number.');
    await c.saveChat?.();
    return true;
}

let busy = false;
async function act(app, fn, done = '') {
    if (busy) return;
    busy = true;
    try { await fn(); if (done) toast('success', done); }
    catch (error) { toast('error', error.message); }
    finally { busy = false; app.render(); }
}

// ---------------------------------------------------------------- the view

function historyFold(app, r, chat, meta, result) {
    const rows = historyRows(chat, meta, { mine: true, result }).filter(row => row.targets.includes(r.id));
    const versions = memoryStore().history(r.id);
    const list = versions.map(v => {
        const row = rows.find(x => x.entry === v.entry);
        return h('li', { class: 'ri-row ri-row-tight', 'data-ri-version': v.entry },
            h('span', {}, `${row?.label || v.op}${v.text ? `: ${clip(v.text)}` : ''}`),
            chip(Number.isInteger(v.index) ? `Reply ${v.index}` : 'Chat log'),
            chip(JOB_LABELS[row?.job] || v.origin || 'record'),
            v.counts ? null : chip(v.note || 'does not count', 'ri-chip-wait'),
            row?.undo ? button('Undo', () => act(app, () => undoChange(row), 'Undone.'), { kind: 'ghost', title: 'Take back this change. Undo is saved with the chat.' }) : null);
    });
    const fold_ = h('details', { class: 'ri-card ri-tight ri-record-history' }, h('summary', {}, `History and sources (${versions.length})`),
        list.length ? h('ul', { class: 'ri-chat-books' }, list) : h('p', { class: 'ri-muted' }, 'No saved versions.'),
        (r.evidence || []).length ? h('div', { class: 'ri-help' }, `Quote: ${r.evidence.map(e => `"${e.quote}"`).join(' ')}`) : null);
    return fold_;
}

function meterRow(app, r, tracker) {
    if (r.kind !== 'person') return null;
    const meters = metersOf(tracker, r.subject);
    const rows = meters.map(m => {
        const input = h('input', { type: 'number', class: 'ri-input ri-input-num', min: METER_MIN, max: METER_MAX, value: String(m.value), 'aria-label': `${r.subject} ${m.label}` });
        input.addEventListener('change', () => act(app, () => setMeter(r.subject, m, Number(input.value)), `${r.subject}, ${m.label} set to ${input.value} and locked.`));
        return h('label', { class: 'ri-row ri-row-tight', 'data-ri-meter': `${m.card}.${m.field}${m.axis ? `.${m.axis}` : ''}` }, h('span', {}, m.label), input, m.locked ? chip('Locked', 'ri-chip-keep') : null);
    });
    return h('div', { class: 'ri-meters' }, rows.length ? rows : null, temperamentControl(app, r));
}

/** How fast each of a person's meters moves (B48): capture files it once; she sets it here, from guarded to volatile. */
export const SPEED_WORDS = Object.freeze([[0.5, 'Guarded'], [0.75, 'Slow'], [1, 'Usual'], [1.25, 'Quick'], [1.5, 'Volatile']]);
const SPEED_LABELS = Object.freeze({ tenderness: 'Tenderness', fury: 'Fury', dread: 'Dread', yearning: 'Yearning', level: 'Relationship' });
/** The nearest plain word for a speed. */
export const speedWord = speed => SPEED_WORDS.reduce((best, row) => (Math.abs(row[0] - speed) < Math.abs(best[0] - speed) ? row : best))[0];

function temperamentControl(app, r) {
    const filed = readTemperament(r.temperament) || {};
    return h('details', { class: 'ri-card ri-tight', 'data-ri-temperament': r.id },
        h('summary', {}, `Temperament: ${SPEED_KEYS.map(k => `${SPEED_LABELS[k].toLowerCase()} ${SPEED_WORDS.find(w => w[0] === speedWord(filed[k] ?? SPEED_DEFAULT))[1].toLowerCase()}`).join(', ')}`),
        h('p', { class: 'ri-help' }, 'How far one reply moves each meter. Guarded moves half as far as usual; volatile half as far again.'),
        SPEED_KEYS.map(key => h('label', { class: 'ri-row ri-row-tight' }, h('span', {}, SPEED_LABELS[key]),
            select(SPEED_WORDS.map(([value, word]) => ({ value: String(value), label: word })), String(speedWord(filed[key] ?? SPEED_DEFAULT)),
                v => act(app, () => setTemperament(r.id, { [key]: Number(v) }), `${r.subject}: ${SPEED_LABELS[key].toLowerCase()} set to ${SPEED_WORDS.find(w => String(w[0]) === v)[1].toLowerCase()}.`),
                { 'aria-label': `${r.subject} ${SPEED_LABELS[key]} speed` }))));
}

/** A thread's "ends when" line and its Paused switch (B49). */
function threadControls(app, r) {
    if (r.kind !== 'thread') return null;
    let line = endsWhenOf(r);
    const input = textInput(line, v => { line = v; }, { 'aria-label': `${r.subject} ends when`, placeholder: 'Ends when...' });
    input.addEventListener('change', () => { if (line.trim() !== endsWhenOf(r)) act(app, () => setThreadEnds(r.id, line), 'Ends-when line saved.'); });
    const paused = isPaused(r);
    return h('div', { class: 'ri-thread-state', 'data-ri-thread': r.id },
        field('Ends when', 'The event that closes this thread. Capture reads it.', input),
        h('label', { class: 'ri-row ri-row-tight' }, toggle(paused, v => act(app, () => setThreadPaused(r.id, v), v ? 'Paused: it waits until you resume it.' : 'Resumed.'), `${r.subject} paused`), h('span', {}, 'Paused')));
}

function recordCard(app, r, ctxt) {
    const { chat, meta, result, pins, tracker, openEditor } = ctxt;
    const pinned = pins.includes(r.id);
    const out = OUT_OF_FORCE.includes(r.status);
    const lock = button(r.locked ? 'Unlock' : 'Lock', () => act(app, () => (r.locked ? memoryStore().unlock(r.id) : memoryStore().lock([r.id])), r.locked ? 'Unlocked.' : 'Locked: background jobs will not change it.'), { kind: 'ghost' });
    const pin = button(pinned ? 'Unpin' : 'Pin', () => act(app, () => setPinned(r.id, !pinned), pinned ? 'Unpinned.' : 'Pinned: recall always considers it.'), { kind: 'ghost' });
    const restore = out ? button('Restore', () => act(app, () => restoreRecord(r.id), 'Restored.'), { kind: 'ghost', title: 'Bring the record back into force.' }) : null;
    const form = out ? null : editableRecord(r);
    const edit = form ? button('Edit', () => openEditor(form), { kind: 'ghost', title: 'Change this record. Your edit is kept as you wrote it.' }) : null;
    return h('li', { class: `ri-card ri-inscard ${out ? 'ri-off' : ''}`, 'data-ri-record': r.id },
        h('div', { class: 'ri-card-top' }, h('strong', { class: 'ri-card-name' }, r.subject || r.id), chip(kindWord(r.kind)), r.threadType ? chip(r.threadType) : null),
        r.attribute ? h('div', { class: 'ri-help' }, r.attribute) : null,
        h('div', { class: 'ri-world-line' }, r.status === 'done' && r.outcome ? `${r.text} Outcome: ${r.outcome}` : r.text || ''),
        h('div', { class: 'ri-chips' },
            r.status && r.status !== 'current' ? chip(r.status, out ? 'ri-chip-wait' : 'ri-chip-done') : null,
            r.locked ? chip('Locked', 'ri-chip-keep') : null, pinned ? chip('Pinned', 'ri-chip-keep') : null,
            r.stale ? chip('Waits for a rebuild', 'ri-chip-warn') : null,
            r.holders?.length ? chip(`Known by ${r.holders.join(', ')}`) : null,
            r.aliases?.length ? chip(`Also called ${r.aliases.join(', ')}`) : null),
        meterRow(app, r, tracker),
        threadControls(app, r),
        h('div', { class: 'ri-row' }, edit, lock, pin, restore),
        historyFold(app, r, chat, meta, result));
}

function storySoFar(app, result, chapterControl) {
    const chapters = result.current.filter(r => r.kind === 'chapter');
    const condensed = result.byId.get('condensed');
    const { chat } = chatNow();
    const replies = chat.map((m, i) => (!m.is_user && !m.is_system && i > 0 ? i : -1)).filter(i => i >= 0);
    const at = h('select', { class: 'ri-input', 'aria-label': 'Close the chapter at reply' }, [...replies].reverse().map(i => h('option', { value: String(i) }, `Reply ${i}`)));
    const close = executionAction(button('Close the chapter here', () => act(app, async () => {
        const { closeChapterHere } = await import('../chapters.js');
        const title = await closeChapterHere(Number(at.value));
        if (title) toast('success', `Saved "${title}".`);
    }), { kind: '', disabled: !replies.length }), '1 model call');
    const node = section('The story so far',
        h('p', { class: 'ri-help' }, 'Chapters in order and the condensed account of everything before the newest ones.'),
        chapters.length ? h('ol', { class: 'ri-chat-books', 'data-ri-chapter-list': '' }, chapters.map(ch => h('li', {}, h('details', { class: 'ri-card ri-tight' }, h('summary', {}, ch.subject || ch.id, ch.stale ? chip('Waits for a rebuild', 'ri-chip-warn') : null), h('div', { class: 'ri-world-line' }, ch.text)))))
            : h('p', { class: 'ri-muted' }, 'No chapter has closed yet.'),
        h('div', { class: 'ri-field' }, h('div', { class: 'ri-label' }, 'Condensed account'),
            condensed && !OUT_OF_FORCE.includes(condensed.status) ? h('div', { class: 'ri-world-line', 'data-ri-condensed': '' }, condensed.text) : h('p', { class: 'ri-muted' }, 'Written once older chapters leave the chapter view.')),
        h('div', { class: 'ri-row' }, at, gateModelButtons(close)),
        chapterControl ? gateModelButtons(chapterControl) : null);
    node.id = 'ri-story-so-far';
    return node;
}

function bookActions(app) {
    const leave = h('input', { type: 'checkbox', class: 'ri-check', checked: true, 'aria-label': 'Leave secrets out' });
    const status = h('p', { class: 'ri-help', role: 'status' }, app.worldBookNote || '');
    const open = button('Open as World Info book', () => act(app, async () => {
        const res = await storyWorld().open();
        if (app.root?.classList.contains('ri-expanded') && !await app.setExpanded(false)) return;
        const { openHostBook } = await import('../chat-books.js');
        if (!openHostBook(res.name)) toast('info', `Select "${res.name}" in the World Info editor.`);
    }), { kind: 'ghost', title: 'Write the generated book from the records and open it in SillyTavern\'s World Info screen.' });
    const exporter = button('Export as World Info book', () => act(app, async () => {
        const res = await storyWorld().exportToBook({ leaveSecretsOut: leave.checked });
        app.worldBookNote = `Saved "${res.name}", an ordinary World Info book${res.secretsLeftOut ? ` with ${res.secretsLeftOut} secrets left out` : ''}. The chat's records are unchanged.`;
    }), { kind: '' });
    const node = section('Story World book',
        h('p', { class: 'ri-help' }, 'The generated book shows these records as World Info entries. An edit typed into it goes to the review list in Setup, Memory; an export is a new book of your own.'),
        h('div', { class: 'ri-row' }, open),
        h('label', { class: 'ri-row ri-row-tight' }, leave, h('span', {}, 'Leave secrets out')),
        h('div', { class: 'ri-row' }, exporter), status);
    node.id = 'ri-story-world-book';
    return node;
}

function changeLog(app, chat, meta, result) {
    const rows = historyRows(chat, meta, { result }).slice(0, app.worldLogAll ? 400 : 20);
    return h('details', { class: 'ri-card ri-tight', id: 'ri-story-world-history', open: !!app.worldLogOpen, ontoggle: e => { app.worldLogOpen = e.target.open; } },
        h('summary', {}, 'History of automatic changes'),
        rows.length ? h('ul', { class: 'ri-chat-books' }, rows.map(row => h('li', { class: 'ri-row ri-row-tight', 'data-ri-change': row.entry },
            h('span', {}, `${row.label}${row.text ? `: ${clip(row.text)}` : ''}`), chip(JOB_LABELS[row.job] || row.job), Number.isInteger(row.index) ? chip(`Reply ${row.index}`) : null,
            row.counts ? null : chip(row.note || 'undone', 'ri-chip-wait'),
            row.undo ? button('Undo', () => act(app, () => undoChange(row), 'Undone.'), { kind: 'ghost' }) : null,
            ...row.restore.map(id => button(`Restore ${id}`, () => act(app, () => restoreRecord(id), 'Restored.'), { kind: 'ghost' })))))
            : h('p', { class: 'ri-muted' }, 'No automatic change yet.'),
        !app.worldLogAll && rows.length >= 20 ? button('Show every change', () => { app.worldLogAll = true; app.render(); }, { kind: 'ghost' }) : null);
}

/**
 * The record browser. app.worldFilter holds { filter, query, reply }. chapterControl: the Write a chapter now control from
 * world.js. reviewView(app): the review list of Setup, Memory, shown under Needs you.
 */
export function renderStoryWorld(body, app, { chapterControl = null, reviewView = null, filter = null } = {}) {
    if (!isChatOpen()) { body.append(h('div', { class: 'ri-empty' }, 'Open a chat to see its records.')); return; }
    if (!memoryActive()) { body.append(h('p', { class: 'ri-note' }, 'This chat\'s memory has not moved into chat data yet.')); return; }
    const state = (app.worldFilter ||= { filter: 'people', query: '', reply: null });
    if (filter) state.filter = filter;
    const { chat, meta } = chatNow();
    memoryStore().marks();
    const result = fold(chat, meta);
    const pins = pinsOf(meta);
    const flagged = new Set(result.flags.flatMap(f => f.target || []));
    const counts = filterCounts(result, { pins, flagged, reply: state.reply });
    const chips = h('div', { class: 'ri-row ri-filter-row', role: 'group', 'aria-label': 'Filters' }, FILTERS.map(f => {
        // On Story, Facts or Story, Plot (a page that is one filter) another filter opens Story World itself with that filter.
        const pinned = FILTER_PAGES[app.tab];
        const pick = () => { state.filter = f.id; if (pinned && pinned !== f.id && app.openPage) app.openPage('world'); else app.render(); };
        const node = button(`${f.label} ${f.id === 'needs' ? counts.needs + result.flags.length : counts[f.id]}`, pick, { kind: state.filter === f.id ? 'primary' : 'ghost' });
        node.dataset.riFilter = f.id;
        node.setAttribute('aria-pressed', String(state.filter === f.id));
        return node;
    }));
    const search = textInput(state.query, value => { state.query = value; clearTimeout(app.worldSearchTimer); app.worldSearchTimer = setTimeout(() => app.render(), 350); }, { placeholder: 'Search the records', 'aria-label': 'Search the records', type: 'search' });
    const replyNote = Number.isInteger(state.reply) ? h('div', { class: 'ri-note', 'data-ri-reply-filter': String(state.reply) }, `Showing what reply ${state.reply} filed.`,
        button('Show every reply', () => { state.reply = null; app.render(); }, { kind: 'ghost' })) : null;
    const list = filterRecords(result, { filter: state.filter, query: state.query, reply: state.reply, pins, flagged });
    const tracker = latestTracker(chat)?.tracker || {};
    const kinds = FILTER_KINDS[state.filter] || [];
    const editor = h('div', { 'data-ri-record-editor': '' });
    // The form of the old record pages, with the same fields; a save files your record in chat data (records.js).
    const openEditor = async form => {
        // A portrayal opens with its card and Base World sources merged in, so Restore source works as on Characters, Portrayal.
        const merged = form?.kind === 'profile' ? await readRecordById(form.id, ['profile']).catch(() => null) : null;
        const original = merged ? { ...merged, protected: form.protected } : form;
        const { recordEditorOpener } = await import('./v10.js');
        await recordEditorOpener(editor, original ? [original.kind] : kinds, () => app.render())(original);
    };
    const ctxt = { chat, meta, result, pins, tracker, openEditor };
    const add = canAddRecord(kinds) ? button('Add record', () => openEditor(null), { kind: 'primary' }) : null;
    const records = section(`${FILTERS.find(f => f.id === state.filter)?.label || 'Records'} (${list.length})`,
        add ? h('div', { class: 'ri-row' }, add) : null, editor,
        replyNote,
        state.filter === 'needs' && reviewView ? reviewView(app) : null,
        list.length ? h('ul', { class: 'ri-chat-books', 'data-ri-records': state.filter }, list.slice(0, app.worldAll ? 1000 : 60).map(r => recordCard(app, r, ctxt)))
            : h('p', { class: 'ri-muted' }, state.query ? 'No record matches the search.' : 'No records here yet.'),
        list.length > 60 && !app.worldAll ? button(`Show all ${list.length}`, () => { app.worldAll = true; app.render(); }, { kind: 'ghost' }) : null);
    records.id = 'ri-world-records';
    body.append(h('p', { class: 'ri-help' }, 'The records of this story, kept in the chat. A swipe or a deleted reply takes back what it filed.'),
        catchUpStatusLine(), chips, h('div', { class: 'ri-field' }, search), records, changeLog(app, chat, meta, result),
        storySoFar(app, result, chapterControl), bookActions(app));
}

/** The reply a message menu entry names, as a filter: Memory from this reply. */
export function openFromReply(app, index) {
    app.worldFilter = { filter: 'all', query: '', reply: Number(index) };
}

// Story, Facts and Story, Plot are filters of Story World (UI design 3.5): their page ids land on the browser with the
// filter set. A chat whose memory has not moved into chat data keeps the old record screens.
for (const [id, filter, label] of Object.entries(FILTER_PAGES).map(([page, f]) => [page, f, FILTERS.find(x => x.id === f).label])) {
    registerPage({ id, group: 'story', tab: 'story-world', sub: true, label, help: `The ${label} filter of Story World.`,
        render: async (body, app) => {
            if (memoryActive()) {
                const { renderWorld } = await import('./world.js');
                (app.worldFilter ||= { filter, query: '', reply: null }).filter = filter;
                renderWorld(body, app);
                return;
            }
            const { renderV10 } = await import('./v10.js');
            renderV10(body, app, id);
        } });
}
