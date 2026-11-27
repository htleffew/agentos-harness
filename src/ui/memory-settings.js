// Setup, Memory (memory DESIGN 12.1): seven sections in the page anatomy of UI design 3.3, each a row whose settings show
// only while its switch is on. Status, Recall, Budgets, Chapters, Upkeep, This chat and the Review list. The page header's
// status pill reads, for example, "ON · DESKTOP · US$0.40". The settings that were here before (recall placement, the
// budgets, the upkeep fields, catch-up and rebuild) keep their one home on this page, folded under the section they
// belong to. Spend settings stay on Setup, Connections, Spend (B19).
import { h, button, chip, field, section, select, toggle } from './dom.js';
import { executionAction } from './execution.js';
import { openGenerateSheet, fitBottom } from './generate-sheet.js';
import { registerPage } from './page-registry.js';
import { renderMemory as legacyMemory } from './context-dashboard.js';
import { settings, saveSettings } from '../store.js';
import { isChatOpen, ctx, toast, worldNames } from '../st.js';
import { memoryComponents } from '../components.js';
import { setMemoryComponent } from '../hide.js';
import { ROUTES, detectRoutes, routeHealth, chainFor } from '../routing.js';
import { spendState } from '../spend.js';
import { SIZE_CAPS } from '../memory/inject.js';
import { CLOSE_DEFAULTS } from '../memory/story-so-far.js';
import { SEARCH_MODEL } from '../memory/embed.js';
import { fold, chatMemory } from '../memory/fold.js';
import { retireModelMade, modelMadeIds } from '../memory/catchup.js';
import { memoryStore, memoryIsOn } from '../memory/store.js';
import { desktopQueue } from '../memory/queue.js';
import { recallRuntime } from '../recall.js';
import { THRESHOLDS } from '../memory/similarity.js';
import { EVERY } from '../memory/upkeep.js';
import { memorySize } from '../context-budget.js';
import { reviewList, resolveFlag, ACTION_LABELS, FLAG_KINDS } from '../memory/flags.js';
import { resolveSeed } from '../memory/event-seeds.js';
import { storyWorld, FLAG_KIND } from '../memory/story-world-book.js';
import { isRecallManaged } from '../book-triggers.js';
import { memoryActive } from '../memory/import.js';

export const PAGE_ID = 'memory';
const SHORT = { desktop: 'DESKTOP', nanogpt: 'NANOGPT', openrouterFree: 'FREE', googleFree: 'FREE', openrouter: 'PAID', phone: 'PHONE', main: 'MAIN' };
const money = n => `US$${Number(n || 0).toFixed(2)}`;
const memorySettings = () => (settings().memory ||= {});
const THRESHOLD_WORDS = { diceNearDuplicate: 'Near duplicate text', jaccardNearDuplicate: 'Near duplicate words', attributeOverlap: 'Same attribute', jaccardRelated: 'Related records', coverageRepeat: 'Repeats your entry' };

// ---------------------------------------------------------------- the Generate sheet before a model call (D1 decision 4)

/**
 * Put the composer bar's Generate sheet (generate-sheet.js, B1) in front of every model-calling button inside `node`, the
 * buttons executionAction marked. A tap opens the sheet and makes no call; Generate presses the button for real, and
 * Close, Escape or Back leaves the chat untouched. Memory jobs take no direction, so the sheet shows its title, the Cost
 * chip and the Generate button without the text box. Buttons that only open a form (skip) are left alone.
 */
export function gateModelButtons(node, { skip = /new chat/i } = {}) {
    const found = node?.matches?.('button[data-ri-model-cost]') ? [node] : [...(node?.querySelectorAll?.('button[data-ri-model-cost]') || [])];
    for (const target of found) {
        if (target.dataset.riGated || skip.test(target.textContent)) continue;
        target.dataset.riGated = 'true';
        let pressing = false;
        target.addEventListener('click', event => {
            if (pressing) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            openMemorySheet(target, () => { pressing = true; try { target.click(); } finally { pressing = false; } });
        }, true);
    }
    return node;
}

function openMemorySheet(target, run) {
    const title = target.textContent.trim();
    const cost = `${target.dataset.riModelCost || '1 model call'} · extra request`;
    const sheet = openGenerateSheet({ kind: 'swipe', action: { title }, returnFocus: target, onGenerate: () => { sheet.close({ reason: 'generate' }); run(); } });
    const root = sheet.element;
    root.dataset.riMemory = 'true';
    // The menu overlay (z-index 30000) covers the sheet's own layer, and the composer bar it stands on sits under the overlay,
    // so on these pages the sheet goes above the overlay and rests on the bottom of the visible viewport.
    const view = globalThis.visualViewport;
    const bottom = view ? view.offsetTop + view.height : globalThis.innerHeight;
    root.style.zIndex = '30020';
    root.style.setProperty('--ri-room', `${Math.max(120, bottom)}px`);
    fitBottom(root, bottom);
    root.querySelector('.ri-gsheet-title').textContent = title;
    const line = root.querySelector('.ri-gsheet-cost');
    line.dataset.call = 'extra';
    line.replaceChildren(h('span', { class: 'ri-bar-dot', 'aria-hidden': 'true' }), h('i', { class: 'fa-solid fa-microchip', 'aria-hidden': 'true' }), cost);
    for (const part of root.querySelectorAll('.ri-gsheet-saved, .ri-gsheet-label, .ri-gsheet-box')) { part.hidden = true; part.style.display = 'none'; }
    sheet.generateButton.firstChild.textContent = 'Generate';
    sheet.generateButton.setAttribute('aria-label', `Generate, ${cost}`);
}

// ---------------------------------------------------------------- status (pure over what the host reports)

/**
 * One line per route with its state: ready, down, or over the ceiling (a paid route once paid calls pause).
 * detected: detectRoutes(); health: routeHealth(); spend: spendState().
 */
export function routeLines(detected = {}, health = {}, spend = { atCeiling: false }) {
    return Object.keys(detected).filter(id => ROUTES[id]).map(id => {
        const paid = ROUTES[id].cost === 'paid';
        const state = paid && spend.atCeiling ? 'over the ceiling' : health[id]?.down ? 'down' : 'ready';
        return { id, label: ROUTES[id].label, state, reason: state === 'down' ? health[id]?.reason || '' : '' };
    });
}

/** The route capture runs on now: the first route of its chain that is found and not down. */
export function activeRoute(chain = [], detected = {}, health = {}, spend = { atCeiling: false }) {
    for (const entry of chain) {
        const id = entry.route;
        if (!detected[id] || health[id]?.down) continue;
        if (ROUTES[id]?.cost === 'paid' && spend.atCeiling) continue;
        return id;
    }
    return '';
}

/** The status pill: "ON · DESKTOP · US$0.40", or "OFF". */
export function pillText({ on, route, spent }) {
    if (!on) return 'OFF';
    return ['ON', SHORT[route] || (route ? route.toUpperCase() : 'NO ROUTE'), money(spent)].join(' · ');
}

function hostStatus() {
    let detected = {}, health = {}, spend = { total: 0, ceiling: 5, atCeiling: false }, chain = [];
    try { detected = detectRoutes(); } catch { /* no host */ }
    try { health = routeHealth(); } catch { /* none checked */ }
    try { spend = spendState(); } catch { /* no meter */ }
    try { chain = chainFor('capture'); } catch { /* unknown */ }
    return { detected, health, spend, chain, route: activeRoute(chain, detected, health, spend) };
}

export function memoryPill() {
    const s = hostStatus();
    return pillText({ on: settings().enabled !== false && isChatOpen() && memoryActive(), route: s.route, spent: s.spend.total });
}

// ---------------------------------------------------------------- the review list (shared with Story World, Needs you)

/** Every flag waiting for her, each with its actions. Edits typed into a generated book take File as my edit and Dismiss. */
export function reviewListView(app) {
    if (!isChatOpen() || !memoryActive()) return h('p', { class: 'ri-muted' }, 'Open a chat whose memory lives in chat data.');
    const c = ctx();
    const result = fold(c.chat || [], c.chatMetadata || {});
    const rows = reviewList(c.chat || [], c.chatMetadata || {}, result);
    const status = h('p', { class: 'ri-help', role: 'status', 'data-ri-review-status': '' }, app.reviewNote || '');
    const done = text => { app.reviewNote = text; app.render(); };
    const run = async (fn, text) => {
        try { const out = await fn(); done(typeof text === 'function' ? text(out) : text); }
        catch (error) { toast('error', error.message); }
    };
    const rowView = row => {
        let actions;
        if (row.kind === FLAG_KIND) {
            const flag = result.flags.find(f => f.entry === row.entry);
            actions = [
                button('File as my edit', () => run(() => storyWorld().fileEdit(flag), out => (out.clipped ? 'Filed as your edit and locked. The record was shortened to 300 characters.' : 'Filed as your edit and locked.')), { kind: 'primary' }),
                button('Dismiss', () => run(() => storyWorld().dismiss(flag), 'Dismissed. The text you typed stays out of the records.'), { kind: 'ghost' }),
            ];
        } else if (row.kind === FLAG_KINDS.eventSeed) {
            actions = row.actions.map(a => button(ACTION_LABELS[a] || a, () => run(() => resolveSeed(row, a), a === 'dismiss' ? 'Dismissed.' : 'Added to the book that receives story events.'), { kind: a === 'dismiss' ? 'ghost' : 'primary' }));
        } else {
            actions = row.actions.map(a => button(ACTION_LABELS[a] || a, () => run(() => resolveFlag(memoryStore(), row, a, {
                openBook: async (book) => { if (app.root?.classList.contains('ri-expanded')) await app.setExpanded(false); const { openHostBook } = await import('../chat-books.js'); return openHostBook(book); },
            }), a === 'dismiss' ? 'Dismissed.' : a === 'keep-mine' ? 'Kept yours.' : a === 'story-changed' ? 'Filed for this chat: the story changed. Your entry stays as you wrote it.' : ''), { kind: a === 'dismiss' ? 'ghost' : '' }));
        }
        const kindWord = row.kind === FLAG_KIND ? 'Edit typed into a generated book' : row.kind === FLAG_KINDS.eventSeed ? 'Story event waiting for a book'
            : row.kind === FLAG_KINDS.locked ? 'Change near a locked record' : 'Clash with your entry';
        return h('li', { class: 'ri-card ri-tight', 'data-ri-flag': row.entry, 'data-ri-flag-kind': row.kind },
            h('div', { class: 'ri-card-top' }, h('strong', {}, row.title || result.flags.find(f => f.entry === row.entry)?.record?.title || 'Untitled'), chip(kindWord, 'ri-chip-warn')),
            row.mine?.text ? h('div', { class: 'ri-kv' }, h('span', { class: 'ri-k' }, 'Yours'), h('span', { class: 'ri-v' }, row.mine.text)) : null,
            row.theirs?.text ? h('div', { class: 'ri-kv' }, h('span', { class: 'ri-k' }, row.kind === FLAG_KIND ? 'You typed' : 'The story'), h('span', { class: 'ri-v' }, row.theirs.text)) : null,
            row.kind === FLAG_KIND ? h('div', { class: 'ri-kv' }, h('span', { class: 'ri-k' }, 'You typed'), h('span', { class: 'ri-v' }, result.flags.find(f => f.entry === row.entry)?.record?.content || '')) : null,
            row.theirs?.quote ? h('div', { class: 'ri-help' }, `"${row.theirs.quote}"`) : null,
            row.reason ? h('div', { class: 'ri-help' }, row.reason) : null,
            h('div', { class: 'ri-row ri-review-actions' }, actions));
    };
    return h('div', { class: 'ri-review-list', id: 'ri-review-list' }, status,
        rows.length ? h('ul', { class: 'ri-chat-books' }, rows.map(rowView)) : h('p', { class: 'ri-muted' }, 'Nothing waits for you.'));
}

// ---------------------------------------------------------------- the page

/** A section whose settings show only while its switch is on (UI design 3.3). sw: { on, set, label } or null. */
function switchSection(id, title, help, sw, build) {
    const body = h('div', { class: 'ri-section-body' });
    const node = h('div', { class: 'ri-section', id, 'data-ri-memory-section': title },
        h('div', { class: 'ri-row ri-section-head' }, h('div', { class: 'ri-section-title' }, title),
            sw ? toggle(sw.on, value => sw.set(value), sw.label || title) : null),
        help ? h('p', { class: 'ri-help' }, help) : null, body);
    if (!sw || sw.on) body.append(...[build()].flat().filter(Boolean));
    return node;
}

const more = (title, node) => (node ? h('details', { class: 'ri-card ri-tight ri-memory-more' }, h('summary', {}, title), node) : null);

function statusSection(app) {
    const s = hostStatus();
    const lines = routeLines(s.detected, s.health, s.spend);
    let waiting = 0;
    try { waiting = desktopQueue().stats().waiting ?? 0; } catch { waiting = 0; }
    const node = section('Status',
        h('div', { 'data-ri-routes': '' }, lines.map(line => h('div', { class: 'ri-row ri-row-tight', 'data-ri-route': line.id },
            h('span', { 'aria-hidden': 'true' }, line.state === 'ready' ? '●' : '○'),
            h('span', {}, line.label), chip(line.state, line.state === 'ready' ? 'ri-chip-done' : 'ri-chip-warn'), line.reason ? h('span', { class: 'ri-help' }, line.reason) : null))),
        h('p', { class: 'ri-help', 'data-ri-waiting': '' }, `${waiting} background ${waiting === 1 ? 'job waits' : 'jobs wait'}. Paid spend this month: ${money(s.spend.total)} of ${money(s.spend.ceiling)}.`),
        h('div', { class: 'ri-row' }, button('Open Review, Context', () => app.openPage('context'), { kind: 'ghost' })));
    node.id = 'ri-memory-status-line';
    return node;
}

function recallSection(app, legacy) {
    const components = memoryComponents();
    const managed = (() => { try { return worldNames().filter(isRecallManaged); } catch { return []; } })();
    let model = { state: 'idle', progress: 0 };
    try { model = recallRuntime().embedder.status() || model; } catch { /* not loaded */ }
    return switchSection('ri-memory-recall', 'Recall', 'What memory sends with each reply: recalled records and World Info entries.',
        isChatOpen() ? { on: components.world, set: v => { setMemoryComponent('world', v); app.render(); }, label: 'World Info recall for this chat' } : null,
        () => [
            field('Books Recall manages', managed.length ? managed.join(', ') : 'None yet. Switch a book on in Story, World Info.',
                h('div', { class: 'ri-row' }, button('Open Story, World Info', () => app.openPage('books'), { kind: 'ghost' }))),
            h('div', { class: 'ri-kv', 'data-ri-search-model': '' }, h('span', { class: 'ri-k' }, 'Search model'), h('span', { class: 'ri-v' }, `all-MiniLM-L6-v2 (${Math.round(SEARCH_MODEL.bytes / 1e6)} MB), ${model.state}${model.state === 'downloading' ? ` ${model.progress} percent` : ''}`)),
            h('label', { class: 'ri-row ri-row-tight' }, toggle(settings().recall?.booster === true, v => { (settings().recall ||= {}).booster = v; saveSettings(); }, 'Desktop booster'),
                h('span', {}, 'Desktop booster: adds the desktop\'s own search vectors when it answers')),
            more('More recall settings', legacy.recall),
        ]);
}

function budgetsSection(app, legacy) {
    const o = settings().summary;
    const chosen = ['small', 'mid', 'frontier'].includes(o.size) ? o.size : 'auto';
    let size = chosen;
    if (chosen === 'auto') { try { size = memorySize().key || 'mid'; } catch { size = 'mid'; } }
    const caps = SIZE_CAPS[size] || SIZE_CAPS.mid;
    const node = section('Budgets',
        field('Chat model size', 'Auto reads the context size SillyTavern is set to. The size sets the caps below.',
            select([{ value: 'auto', label: 'Auto' }, { value: 'small', label: 'Small' }, { value: 'mid', label: 'Mid' }, { value: 'frontier', label: 'Frontier' }], chosen,
                v => { if (v === 'auto') delete o.size; else o.size = v; saveSettings(); app.render(); }, { 'aria-label': 'Chat model size' })),
        h('div', { class: 'ri-grid', 'data-ri-caps': size },
            h('div', { class: 'ri-kv' }, h('span', { class: 'ri-k' }, 'Recall block'), h('span', { class: 'ri-v' }, `${caps.recall} tokens`)),
            h('div', { class: 'ri-kv' }, h('span', { class: 'ri-k' }, 'Tracker book'), h('span', { class: 'ri-v' }, `${caps.tracker} tokens`)),
            h('div', { class: 'ri-kv' }, h('span', { class: 'ri-k' }, 'Chapter view'), h('span', { class: 'ri-v' }, `${caps.view} tokens`))),
        more('More budgets', legacy.budgets));
    node.id = 'ri-memory-size';
    return node;
}

function chaptersSection(app) {
    const components = memoryComponents();
    const o = settings().summary;
    const num = (label, key, min, max, step, fallback, help) => {
        const input = h('input', { type: 'number', class: 'ri-input ri-input-num', min, max, step, value: String(o[key] ?? fallback), 'aria-label': label });
        input.addEventListener('change', () => { const v = Math.max(min, Math.min(max, Number(input.value) || fallback)); input.value = String(v); o[key] = v; saveSettings(); });
        return field(label, help, input);
    };
    return switchSection('ri-memory-chapters', 'Chapters', 'When a chapter closes and how much of the story so far each request carries.',
        isChatOpen() ? { on: components.chapters, set: v => { setMemoryComponent('chapters', v); app.render(); }, label: 'Chapter summaries for this chat' } : null,
        () => [
            field('Newest chapters in full', 'The rest go into the condensed account.',
                select([1, 2, 3].map(n => ({ value: String(n), label: String(n) })), String([1, 2, 3].includes(Number(o.fullChapters)) ? o.fullChapters : 2),
                    v => { o.fullChapters = Number(v); saveSettings(); }, { 'aria-label': 'Newest chapters in full' })),
            num('Close at a scene end after at least', 'minExchanges', 1, 100, 1, CLOSE_DEFAULTS.minExchanges, 'Exchanges since the last chapter.'),
            num('Close by itself after', 'maxExchanges', 2, 200, 1, CLOSE_DEFAULTS.maxExchanges, 'Exchanges, at most.'),
            num('Close when the open chapter takes this share of the ceiling', 'ceilingShare', 0.1, 0.9, 0.05, CLOSE_DEFAULTS.ceilingShare, 'A share between 0.1 and 0.9.'),
        ]);
}

function upkeepSection(app, legacy) {
    const m = memorySettings();
    const tidy = executionAction(button('Tidy now', async () => {
        tidy.disabled = true;
        try { const { afterReply } = await import('../memory/upkeep.js'); const out = await afterReply({ force: true }); toast('success', out?.due ? 'Tidy is queued.' : 'Nothing to tidy.'); }
        catch (error) { toast('error', error.message); }
        finally { tidy.disabled = false; }
    }, { disabled: !isChatOpen() || !memoryActive() }), '1 model call');
    return switchSection('ri-memory-upkeep-switch', 'Upkeep', 'Code merges identical records after each reply; Tidy asks a model about near duplicates in batches.',
        { on: m.tidy !== false, set: v => { m.tidy = v; saveSettings(); app.render(); }, label: 'Tidy automatically' },
        () => [
            field('Capture', 'Every five replies is offered while the state cards are off, since nothing then needs the newest values at once.',
                select([{ value: 'reply', label: 'After each reply' }, { value: 'five', label: 'Every five replies while the state cards are off' }], m.capture === 'five' ? 'five' : 'reply',
                    v => { m.capture = v; saveSettings(); }, { 'aria-label': 'Capture' })),
            h('div', { class: 'ri-row' }, gateModelButtons(tidy)),
            more('More upkeep settings', legacy.upkeep),
            more('How it works', h('div', { 'data-ri-thresholds': '' },
                h('p', { class: 'ri-help' }, `Tidy compares records within one subject, starting every ${EVERY.start} replies and adapting between ${EVERY.min} and ${EVERY.max}. It halves the wait after six changes or more, doubles it after one or none, and merges only identical records in code.`),
                Object.entries(THRESHOLDS).map(([key, t]) => h('div', { class: 'ri-kv' }, h('span', { class: 'ri-k' }, THRESHOLD_WORDS[key] || key), h('span', { class: 'ri-v' }, `${t.value} (${t.measure})`))))),
        ]);
}

/** Rewrite the chat's generated Story World book from the records now showing, when the chat has one. */
async function refreshStoryBook() {
    try {
        const { storyWorld } = await import('../memory/story-world-book.js');
        const book = storyWorld();
        const { loadBook } = await import('../st.js');
        if ((await loadBook(book.name()))?.entries) await book.write();
    } catch (error) { console.warn('[Roleplay Instructions] story book refresh', error); }
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const heldModel = () => { try { const held = chatMemory(ctx().chatMetadata || {}).clearedModel; return held?.entries?.length ? held : null; } catch { return null; } };

/** Retire what a model made and hold the entry ids, so one Undo reverts them. Records you wrote or edited, locked records and stat sheets stay. */
async function clearModelMade(store) {
    const out = await retireModelMade(store, { reason: 'Cleared the records a model made.', type: 'you' });
    if (!out.count) return out;
    const mem = chatMemory(ctx().chatMetadata || {});
    const prior = mem.clearedModel?.entries?.length ? mem.clearedModel : { entries: [], count: 0 };
    mem.clearedModel = { at: Date.now(), entries: [...prior.entries, out.entry], count: prior.count + out.count };
    await (ctx().saveChat?.() ?? ctx().saveMetadata?.());
    return out;
}

/** Revert every entry of the model-made clear, newest first. The held marker goes when they are back. */
async function undoModelMade(store) {
    const mem = chatMemory(ctx().chatMetadata || {});
    const held = mem.clearedModel;
    if (!held?.entries?.length) return { restored: false, reason: 'Nothing was cleared.' };
    for (const id of [...held.entries].reverse()) if (store.entryById(id)) await store.revert(id, 'Undone: the records a model made are back.');
    delete mem.clearedModel;
    await (ctx().saveChat?.() ?? ctx().saveMetadata?.());
    return { restored: true, entries: held.count };
}

/** Memory on for this chat, and Clear this chat's memory with its one Undo (memory DESIGN 12.1; asks which on tap, 25 November). */
function chatControls(app) {
    if (!isChatOpen() || !memoryActive()) return null;
    const store = memoryStore();
    const meta = ctx().chatMetadata || {};
    const on = memoryIsOn(meta);
    const held = store.clearedState();
    const model = held ? null : heldModel();
    const run = async (work, done) => {
        try { const out = await work(); await refreshStoryBook(); toast('success', done(out)); }
        catch (error) { toast('error', error.message); }
        finally { app.render(); }
    };
    const modelCount = modelMadeIds(store.view()).length;
    const choice = h('div', { class: 'ri-card ri-tight', 'data-ri-clear-choice': '', hidden: true },
        h('p', { class: 'ri-help' }, 'Which records should go? Either one has an Undo.'),
        h('div', { class: 'ri-row ri-wrap' },
            button('Model-made only', () => run(() => clearModelMade(store), out => (out.count ? `Cleared ${plural(out.count, 'record', 'records')} a model made. Undo is below.` : 'No model-made records to clear.')), { kind: 'ghost', 'data-ri-clear-model': '' }),
            button('Everything', () => run(() => store.clear(), out => `Cleared ${plural(out.entries, 'record', 'records')}. Undo is below.`), { kind: 'ghost', 'data-ri-clear-all': '' }),
            button('Cancel', () => { choice.hidden = true; }, { kind: 'ghost' })),
        h('p', { class: 'ri-help' }, `Model-made only clears ${plural(modelCount, 'record', 'records')} and keeps the ones you wrote or edited, locked records and stat sheets. Everything clears all of this chat's records.`));
    const clearButton = button('Clear this chat\'s memory', () => { choice.hidden = !choice.hidden; }, { kind: 'ghost' });
    return h('div', { class: 'ri-memory-chat-controls', 'data-ri-chat-controls': '' },
        h('div', { class: 'ri-row', 'data-ri-memory-on': '' }, h('span', {}, 'Memory on for this chat'),
            toggle(on, value => run(() => store.setOn(value), () => (value ? 'Memory is on for this chat.' : 'Memory is off for this chat. Its records stay.')), 'Memory on for this chat')),
        h('p', { class: 'ri-help' }, on ? 'This chat captures and recalls its story.' : 'Capture and recall are off for this chat only. Its records stay and show where they always do.'),
        h('div', { class: 'ri-row' }, clearButton),
        choice,
        h('p', { class: 'ri-help' }, 'Removes this chat\'s records and the entries of its generated Story World book. Your own World Info books are not touched.'),
        held ? h('div', { class: 'ri-row ri-row-tight', 'data-ri-clear-undo': '' }, h('span', {}, `${plural(held.entries, 'record', 'records')} cleared.`),
            button('Undo', () => run(() => store.undoClear(), out => (out.restored ? `Restored ${plural(out.entries, 'record', 'records')}.` : out.reason)), { kind: 'primary' })) : null,
        model ? h('div', { class: 'ri-row ri-row-tight', 'data-ri-clear-undo': 'model' }, h('span', {}, `${plural(model.count, 'model-made record', 'model-made records')} cleared.`),
            button('Undo', () => run(() => undoModelMade(store), out => (out.restored ? `Restored ${plural(out.entries, 'record', 'records')}.` : out.reason)), { kind: 'primary' })) : null);
}

function thisChatSection(app, legacy) {
    const node = section('This chat',
        isChatOpen() ? h('p', { class: 'ri-help' }, memoryActive() ? 'This chat keeps its memory in chat data.' : 'This chat has not moved its memory into chat data yet.') : h('p', { class: 'ri-muted' }, 'Open a chat.'),
        chatControls(app),
        legacy.thisChat ? gateModelButtons(legacy.thisChat) : null);
    node.id = 'ri-memory-this-chat';
    return node;
}

/** Pull the sections the settings page drew before (one home for each of their controls) out of a scratch body. */
function legacyParts(app) {
    const scratch = h('div');
    legacyMemory(scratch, app);
    const take = sel => { const node = scratch.querySelector(sel); node?.remove(); return node; };
    const recall = take('#ri-memory-settings');
    const budgets = take('#ri-memory-budgets');
    const upkeep = take('#ri-memory-upkeep');
    const thisChat = take('[data-control="catch-up"]');
    // their own titles repeat the section they now sit in
    for (const node of [recall, budgets, upkeep]) node?.querySelector(':scope > .ri-section-title')?.remove();
    thisChat?.querySelector(':scope > .ri-section-title')?.replaceChildren('Catch up and rebuild');
    return { recall, budgets, upkeep, thisChat };
}

export function renderMemorySettings(body, app) {
    const legacy = legacyParts(app);
    body.append(
        statusSection(app),
        recallSection(app, legacy),
        budgetsSection(app, legacy),
        chaptersSection(app),
        upkeepSection(app, legacy),
        thisChatSection(app, legacy),
        h('div', { class: 'ri-section', id: 'ri-memory-review' },
            h('div', { class: 'ri-section-title' }, `Review list (${isChatOpen() && memoryActive() ? (() => { const c = ctx(); return reviewList(c.chat || [], c.chatMetadata || {}, fold(c.chat || [], c.chatMetadata || {})).length; })() : 0})`),
            h('p', { class: 'ri-help' }, 'Clashes with your entries, edits typed into a generated book, story events waiting for a book, and changes near a locked record.'),
            reviewListView(app)));
}

registerPage({ id: PAGE_ID, group: 'setup', tab: 'memory', label: 'Memory', withoutChat: true,
    help: 'How story memory is kept, recalled and budgeted.',
    aliases: 'budget recall chapter summary catch up rebuild upkeep story notes editable replies review list tidy booster search model',
    status: memoryPill,
    render: (body, app) => renderMemorySettings(body, app) });

