// The queue sheet (DESIGN.md 4.5): everything queued for the next message, directions and action
// checks, with Edit, Private or Visible, Required or Optional and Remove on each, plus Clear all.
// Sending a message consumes the queue (quick-action-chat.js); this sheet only reads and edits it.
import { h } from './dom.js';
import { on } from '../st.js';
import { saveChatState } from '../store.js';
import { cancelQueued, freshRemaining, quickChat } from '../quick-action-chat.js';
import { fitBottom } from './generate-sheet.js';
import { renderBar } from './composer-bar.js';
import { loadResultsStyles } from './results-sheet.js';

const icon = name => h('i', { class: `fa-solid ${name}`, 'aria-hidden': 'true' });

/** One line per queued item, kept pure so it can be tested without a page. */
export function queueItems(state) {
    const bound = new Set((state?.bindings || []).flatMap(binding => binding.entries.map(entry => entry.id)));
    return (state?.pending || []).map((entry, index) => ({
        id: entry.id,
        kind: entry.rows?.length ? 'direction' : entry.roll ? 'check' : 'fresh',
        title: entry.rows?.map(row => row.title).filter(Boolean).join(' · ') || (entry.rows?.length ? `Direction ${index + 1}` : entry.roll ? 'Action check' : 'Fresh start'),
        rows: (entry.rows || []).map(row => ({ text: String(row.text || ''), visible: row.visibility === 'visible', required: row.required === true })),
        roll: entry.roll?.text || '',
        fresh: entry.freshStart === 'five' ? 'Fresh start for five story replies' : entry.freshStart ? 'Fresh start for this action' : '',
        bound: bound.has(entry.id),
    }));
}

/** Change one queued row: its wording, Private or Visible, Required or Optional. */
export function updateQueuedRow(state, id, rowIndex, change) {
    const entry = state?.pending?.find(item => item.id === id);
    const row = entry?.rows?.[rowIndex];
    if (!row) return false;
    if ((state.bindings || []).some(binding => binding.entries.some(queued => queued.id === id))) return false;
    if (change.text !== undefined) {
        if (!String(change.text).trim()) return false;
        row.text = String(change.text);
    }
    if (change.visible !== undefined) row.visibility = change.visible ? 'visible' : 'private';
    if (change.required !== undefined) row.required = !!change.required;
    return true;
}

let current = null;
let ownBacks = 0;
let listening = false;

// A reply that consumes the queue, or a chat switch, redraws an open sheet.
function listen() {
    if (listening) return;
    listening = true;
    for (const name of ['MESSAGE_SENT', 'MESSAGE_RECEIVED', 'CHAT_CHANGED']) on(name, () => setTimeout(() => current?.render(), 0));
}
export const queueSheetOpen = () => current;

/** Open the queue sheet above the composer bar. */
export function openQueueSheet(trigger) {
    current?.close();
    loadResultsStyles();
    const doc = globalThis.document;
    const viewport = globalThis.visualViewport;
    const titleId = `ri-qsheet-title-${Date.now().toString(36)}`;
    const view = { editing: null, draft: '', notice: '', cleared: null };
    const list = h('div', { class: 'ri-gsheet-results ri-queue-list' });
    const live = h('p', { class: 'ri-results-live', role: 'status', 'aria-live': 'polite' });
    const clearAll = h('button', { type: 'button', class: 'ri-bar-btn ri-bar-btn-danger', 'data-ri-clear': '', onclick: () => sheet.clearAll() },
        icon('fa-trash-can'), 'Clear all');
    const title = h('h2', { class: 'ri-gsheet-title', id: titleId, tabIndex: -1 }, 'Queued for your next message');
    const element = h('section', { class: 'ri-gsheet ri-queue-sheet', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': titleId, 'data-kind': 'queue' },
        h('div', { class: 'ri-gsheet-grab', 'aria-hidden': 'true' }),
        h('header', { class: 'ri-gsheet-head' },
            h('div', { class: 'ri-gsheet-titles' }, title,
                h('p', { class: 'ri-gsheet-cost' }, icon('fa-code'), 'Sent with your next message')),
            clearAll,
            h('button', { type: 'button', class: 'ri-bar-btn ri-bar-btn-text', 'data-ri-close': '', onclick: () => sheet.close() }, 'Close')),
        h('div', { class: 'ri-gsheet-body' }, list, live));

    const announce = text => {
        live.textContent = '';
        setTimeout(() => { live.textContent = text; }, 30);
    };
    const changed = message => {
        saveChatState();
        renderBar();
        if (message) announce(message);
        render();
    };
    const toggle = (label, pressed, onLabel, offLabel, onclick, disabled) => h('button', { type: 'button', class: 'ri-bar-btn ri-queue-toggle',
        'aria-pressed': String(pressed), 'aria-label': `${label}: ${pressed ? onLabel : offLabel}`, disabled, onclick }, pressed ? onLabel : offLabel);

    function rowView(item, row, rowIndex, remove = null) {
        const state = quickChat();
        const key = `${item.id}:${rowIndex}`;
        const set = change => {
            if (updateQueuedRow(state, item.id, rowIndex, change)) changed();
        };
        if (view.editing === key) {
            const box = h('textarea', { class: 'ri-gsheet-box', rows: 3, value: view.draft, 'aria-label': `Wording of ${item.title}`,
                oninput: event => { view.draft = event.target.value; } });
            setTimeout(() => box.focus({ preventScroll: true }), 0);
            return h('div', { class: 'ri-queue-row' }, box,
                h('div', { class: 'ri-option-actions' },
                    h('button', { type: 'button', class: 'ri-bar-btn', onclick: () => { view.editing = null; render(); } }, 'Cancel'),
                    h('button', { type: 'button', class: 'ri-bar-btn ri-bar-btn-primary', onclick: () => {
                        if (!view.draft.trim()) { view.notice = 'Enter wording for this direction.'; render(); return; }
                        view.editing = null;
                        set({ text: view.draft });
                    } }, 'Save')));
        }
        return h('div', { class: 'ri-queue-row' },
            h('p', { class: 'ri-option-body' }, row.text),
            h('div', { class: 'ri-option-actions' },
                h('button', { type: 'button', class: 'ri-bar-btn', 'data-ri-edit': '', disabled: item.bound, 'aria-label': `Edit ${item.title}`,
                    onclick: () => { view.editing = key; view.draft = row.text; view.notice = ''; render(); } }, icon('fa-pencil'), 'Edit'),
                toggle('Shown to the model as', row.visible, 'Visible', 'Private', () => set({ visible: !row.visible }), item.bound),
                toggle('Follow-through', row.required, 'Required', 'Optional', () => set({ required: !row.required }), item.bound),
                remove));
    }

    function render() {
        const state = quickChat();
        const items = queueItems(state);
        const remaining = freshRemaining();
        clearAll.disabled = !items.some(item => !item.bound);
        const removeButton = item => h('button', { type: 'button', class: 'ri-bar-btn ri-bar-btn-danger', 'data-ri-remove': '', disabled: item.bound,
            'aria-label': `Remove ${item.title}`, onclick: () => { if (cancelQueued(item.id)) changed(`${item.title} removed.`); } }, icon('fa-xmark'), 'Remove');
        // A one-row direction keeps Remove beside its other buttons, so each item takes one button row.
        const itemView = item => {
            const inline = item.rows.length === 1 && view.editing !== `${item.id}:0`;
            return h('article', { class: 'ri-option-card ri-queue-item', 'data-kind': item.kind, 'aria-label': item.title },
                h('h3', { class: 'ri-option-title' }, icon(item.kind === 'check' ? 'fa-dice-d20' : 'fa-signs-post'), item.title),
                item.bound && h('p', { class: 'ri-option-note' }, icon('fa-circle-info'), 'Attached to a sent message; it waits for that reply.'),
                ...item.rows.map((row, rowIndex) => rowView(item, row, rowIndex, inline ? removeButton(item) : null)),
                item.roll && h('p', { class: 'ri-option-body' }, item.roll),
                item.fresh && h('p', { class: 'ri-option-note' }, item.fresh),
                !inline && h('div', { class: 'ri-option-actions' }, removeButton(item)));
        };
        // replaceChildren would print null and false, so empty parts are dropped first.
        list.replaceChildren(...[
            view.notice && h('p', { class: 'ri-results-note', role: 'alert' }, view.notice),
            view.cleared && h('p', { class: 'ri-results-note ri-queue-undo' }, `Cleared ${view.cleared.length} queued.`,
                h('button', { type: 'button', class: 'ri-bar-btn', 'data-ri-undo': '', onclick: () => sheet.undoClear() }, 'Undo')),
            !items.length && !view.cleared && h('p', { class: 'ri-results-note' }, 'Nothing is queued for your next message.'),
            remaining > 0 && h('p', { class: 'ri-results-note' }, `Fresh start: ${remaining} story replies remaining.`),
            ...items.map(itemView),
        ].filter(Boolean));
        place();
    }

    const place = () => {
        const visibleBottom = viewport ? viewport.offsetTop + viewport.height : globalThis.innerHeight;
        const bar = doc.querySelector('#ri_composer_bar');
        const bottom = Math.min(visibleBottom, bar?.getClientRects().length ? bar.getBoundingClientRect().top : visibleBottom);
        element.style.setProperty('--ri-vv-height', `${viewport ? viewport.height : globalThis.innerHeight}px`);
        element.style.setProperty('--ri-room', `${Math.max(120, bottom - (viewport?.offsetTop || 0))}px`);
        fitBottom(element, bottom);
    };
    const outside = event => {
        if (!element.isConnected || element.contains(event.target)) return;
        if (event.target.closest?.('.ri-bar')) return;
        sheet.close();
    };
    const keys = event => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        sheet.close();
    };
    const back = () => {
        if (ownBacks > 0) { ownBacks--; return; }
        if (current === sheet) sheet.close({ fromHistory: true });
    };
    listen();

    const sheet = {
        element, closed: false, render,
        clearAll() {
            const state = quickChat();
            const items = queueItems(state).filter(item => !item.bound);
            if (!items.length) return;
            view.cleared = state.pending.filter(entry => items.some(item => item.id === entry.id)).map(entry => structuredClone(entry));
            for (const item of items) cancelQueued(item.id);
            changed(`Cleared ${items.length} queued.`);
        },
        undoClear() {
            const state = quickChat();
            if (!view.cleared || !state) return;
            state.pending.push(...view.cleared.filter(entry => !state.pending.some(item => item.id === entry.id)));
            view.cleared = null;
            changed('Queue restored.');
        },
        close({ fromHistory = false } = {}) {
            if (sheet.closed) return;
            sheet.closed = true;
            if (current === sheet) current = null;
            doc.removeEventListener('pointerdown', outside, true);
            doc.removeEventListener('keydown', keys, true);
            globalThis.removeEventListener('popstate', back);
            viewport?.removeEventListener('resize', place);
            element.remove();
            if (!fromHistory && globalThis.history?.state?.riQueueSheet) {
                ownBacks++;
                globalThis.history.back();
            }
            if (trigger?.isConnected) trigger.focus({ preventScroll: true });
        },
    };
    doc.body.append(element);
    render();
    viewport?.addEventListener('resize', place);
    try { globalThis.history?.pushState({ ...(globalThis.history.state || {}), riQueueSheet: true }, ''); } catch { /* history is optional */ }
    globalThis.addEventListener('popstate', back);
    setTimeout(() => { if (!sheet.closed) doc.addEventListener('pointerdown', outside, true); }, 0);
    doc.addEventListener('keydown', keys, true);
    title.focus({ preventScroll: true });
    current = sheet;
    return sheet;
}
