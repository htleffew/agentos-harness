// The Generate sheet (DESIGN.md 4.4): one small bottom sheet with an optional text box and one
// Generate button, for Options, Swipe, Continue and Impersonate. Opening it makes no request.
import { h } from './dom.js';
import { costWords, QUICK_ACTION_KINDS } from '../quick-actions.js';

const truncate = (text, length = 70) => {
    const plain = String(text || '').replace(/\s+/g, ' ').trim();
    return plain.length > length ? plain.slice(0, length - 1).trimEnd() + '…' : plain;
};
const icon = name => h('i', { class: `fa-solid ${name}`, 'aria-hidden': 'true' });
const dot = () => h('span', { class: 'ri-bar-dot', 'aria-hidden': 'true' });

/** Everything the sheet says for an action of a kind, kept pure so it can be tested without a page. */
export function sheetText(kind, action, connection = '') {
    const def = QUICK_ACTION_KINDS[kind];
    if (!def?.sheet) throw new Error(`The ${kind || 'unknown'} kind has no Generate sheet.`);
    const count = Math.min(12, Math.max(1, Math.round(Number(action.count)) || 4));
    const generate = kind === 'options' ? `Generate ${count} ${count === 1 ? 'option' : 'options'}` : def.generate;
    const text = String(action.text || '').trim();
    let saved;
    if (kind === 'options') saved = `Prompt: ${truncate(action.prompt || action.title)}`;
    else if (!text) saved = kind === 'impersonate' && action.prompt ? `Prompt: ${truncate(action.prompt)}` : 'No saved direction';
    else saved = `Direction: ${action.title && action.title !== def.name ? action.title : truncate(text)}`;
    return {
        title: action.title || def.name,
        cost: costWords(kind, connection),
        call: def.call,
        dot: def.call === 'extra',
        boxLabel: def.boxLabel,
        generate,
        saved,
    };
}

/**
 * Pin a fixed surface's bottom edge to a viewport y. Its containing block can differ from the
 * viewport (B16 found a test host where it sat above the screen), so the edge is measured and
 * corrected after it is placed.
 */
export function fitBottom(element, bottomY) {
    element.style.bottom = '0px';
    const offset = element.getBoundingClientRect().bottom - bottomY;
    element.style.bottom = `${Math.round(offset * 100) / 100}px`;
}

let current = null;
// Our own history.back() after a Close lands as a popstate later; it must not close the next sheet.
let ownBacks = 0;

export const generateSheetOpen = () => current;

/**
 * Open the sheet.
 * @param {object} options
 * @param {string} options.kind
 * @param {object} options.action
 * @param {string} [options.connection]
 * @param {string} [options.draft] text kept from an earlier close of this action's sheet
 * @param {(text:string, sheet:object)=>void} options.onGenerate
 * @param {(text:string)=>void} [options.onClose] receives the box text, which the caller keeps as the draft
 * @param {()=>void} [options.onEdit] opens the quick action's settings
 * @param {HTMLElement} [options.returnFocus]
 */
export function openGenerateSheet({ kind, action, connection = '', draft = '', onGenerate, onClose, onEdit, returnFocus }) {
    current?.close({ reason: 'replaced' });
    const text = sheetText(kind, action, connection);
    const doc = globalThis.document;
    const titleId = `ri-gsheet-title-${Date.now().toString(36)}`;
    const box = h('textarea', { class: 'ri-gsheet-box', rows: 1, 'aria-label': text.boxLabel, value: draft, enterkeyhint: 'done' });
    const grow = () => {
        box.style.height = 'auto';
        box.style.height = `${box.scrollHeight + 2}px`;
    };
    box.addEventListener('input', grow);
    const generate = h('button', { type: 'button', class: 'ri-bar-btn ri-bar-btn-primary', 'data-ri-generate': '',
        'aria-label': text.dot ? `${text.generate}, 1 model call, extra request` : text.generate,
        onclick: () => sheet.generate() }, text.generate, text.dot && dot());
    const error = h('p', { class: 'ri-gsheet-error', role: 'alert', hidden: true });
    const results = h('div', { class: 'ri-gsheet-results', 'data-ri-results-mount': '', hidden: true, 'aria-live': 'polite' });
    const title = h('h2', { class: 'ri-gsheet-title', id: titleId, tabIndex: -1 }, text.title);
    const close = h('button', { type: 'button', class: 'ri-bar-btn ri-bar-btn-text', 'data-ri-close': '', onclick: () => sheet.close({ reason: 'close' }) }, 'Close');
    const element = h('section', { class: 'ri-gsheet', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': titleId, 'data-kind': kind },
        h('div', { class: 'ri-gsheet-grab', 'aria-hidden': 'true' }),
        h('header', { class: 'ri-gsheet-head' },
            h('div', { class: 'ri-gsheet-titles' }, title,
                h('p', { class: 'ri-gsheet-cost', 'data-call': text.call }, text.dot && dot(), icon(text.call === 'extra' ? 'fa-microchip' : 'fa-comment'), text.cost)),
            close),
        h('div', { class: 'ri-gsheet-body' },
            h('p', { class: 'ri-gsheet-saved' }, h('span', {}, text.saved),
                onEdit && h('button', { type: 'button', class: 'ri-bar-icon', 'aria-label': `Edit ${text.title}`, onclick: () => { sheet.close({ reason: 'edit' }); onEdit(); } }, icon('fa-pencil'))),
            h('label', { class: 'ri-gsheet-label', for: `${titleId}-box` }, text.boxLabel),
            box,
            error,
            h('div', { class: 'ri-gsheet-actions' }, generate),
            results));
    box.id = `${titleId}-box`;

    const viewport = globalThis.visualViewport;
    // Safety net for a keyboard that overlays the page: keep the sheet's bottom on the visible viewport.
    // The sheet stands on the composer bar, so the bar's status slot (Stop, View) stays in reach;
    // with no bar showing it stands on the bottom of the visible viewport.
    const place = () => {
        const visibleBottom = viewport ? viewport.offsetTop + viewport.height : globalThis.innerHeight;
        const bar = doc.querySelector('#ri_composer_bar');
        const barTop = bar?.getClientRects().length ? bar.getBoundingClientRect().top : visibleBottom;
        const bottom = Math.min(visibleBottom, barTop);
        element.style.setProperty('--ri-vv-height', `${viewport ? viewport.height : globalThis.innerHeight}px`);
        element.style.setProperty('--ri-room', `${Math.max(120, bottom - (viewport?.offsetTop || 0))}px`);
        fitBottom(element, bottom);
    };
    const outside = event => {
        if (!element.isConnected || element.contains(event.target)) return;
        if (event.target.closest?.('.ri-bar, .ri-bar-pop')) return;
        sheet.close({ reason: 'outside' });
    };
    const keys = event => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        sheet.close({ reason: 'escape' });
    };
    const back = () => {
        if (ownBacks > 0) { ownBacks--; return; }
        if (current === sheet) sheet.close({ reason: 'back', fromHistory: true });
    };

    const sheet = {
        kind, action, element, box, results, generateButton: generate,
        closed: false,
        get text() { return box.value; },
        generate() {
            if (generate.disabled) return;
            const typed = box.value;
            error.hidden = true;
            onGenerate?.(typed, sheet);
        },
        setBusy(busy, label) {
            generate.disabled = !!busy;
            box.disabled = !!busy;
            if (label) generate.firstChild.textContent = label;
            else generate.firstChild.textContent = text.generate;
        },
        /** An inline error with its recovery controls (Retry, Connection settings). */
        showError(message, ...controls) {
            error.replaceChildren(icon('fa-triangle-exclamation'), h('span', {}, h('strong', {}, 'Failed. '), message),
                controls.length ? h('span', { class: 'ri-gsheet-actions' }, controls) : null);
            error.hidden = false;
        },
        /** Mount point for the Options results list (B2 renders into it). */
        showResults(...nodes) {
            results.replaceChildren(...nodes);
            results.hidden = !nodes.length;
            element.dataset.results = String(!!nodes.length);
        },
        clearBox() { box.value = ''; grow(); },
        close({ reason = 'close', fromHistory = false } = {}) {
            if (sheet.closed) return;
            sheet.closed = true;
            if (current === sheet) current = null;
            doc.removeEventListener('pointerdown', outside, true);
            doc.removeEventListener('keydown', keys, true);
            globalThis.removeEventListener('popstate', back);
            viewport?.removeEventListener('resize', place);
            viewport?.removeEventListener('scroll', place);
            element.remove();
            if (!fromHistory && globalThis.history?.state?.riGenerateSheet) {
                ownBacks++;
                globalThis.history.back();
            }
            if (reason !== 'replaced' && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
            onClose?.(box.value, reason);
        },
    };
    doc.body.append(element);
    grow();
    place();
    viewport?.addEventListener('resize', place);
    viewport?.addEventListener('scroll', place);
    // The back gesture closes the sheet with no call.
    try { globalThis.history?.pushState({ ...(globalThis.history.state || {}), riGenerateSheet: true }, ''); } catch { /* history is optional */ }
    globalThis.addEventListener('popstate', back);
    setTimeout(() => {
        if (sheet.closed) return;
        doc.addEventListener('pointerdown', outside, true);
    }, 0);
    doc.addEventListener('keydown', keys, true);
    // The box takes no focus, so the keyboard stays down; the title takes it for screen readers.
    title.focus({ preventScroll: true });
    current = sheet;
    return sheet;
}
