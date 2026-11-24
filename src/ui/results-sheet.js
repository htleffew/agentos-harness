// Options results (DESIGN.md 4.4): the titled option cards that fill the Generate sheet after
// Generate, the header's progress, Cancel and Generate again, and the results cache that lets a
// re-tap reopen saved options with no request.
import { h } from './dom.js';
import { isGenerating, readComposer, writeComposer } from '../st.js';
import { guidedTarget } from '../guided-turns.js';
import { quickChatIdentity } from '../quick-action-chat.js';

const STYLE_ID = 'ri-results-sheet';
const icon = name => h('i', { class: `fa-solid ${name}`, 'aria-hidden': 'true' });
const dot = () => h('span', { class: 'ri-bar-dot', 'aria-hidden': 'true' });

/** Adds this module's stylesheet once, after the composer bar's, so its rules take precedence. */
export function loadResultsStyles(doc = globalThis.document) {
    if (!doc?.head || doc.getElementById(STYLE_ID)) return;
    const link = doc.createElement('link');
    link.id = STYLE_ID;
    link.rel = 'stylesheet';
    link.href = new URL('./results-sheet.css', import.meta.url).href;
    doc.head.append(link);
}

// A short stable digest, so the cache key holds no reply text.
const digest = value => {
    let hash = 5381;
    for (const char of String(value ?? '')) hash = (hash * 33 + char.codePointAt(0)) >>> 0;
    return hash.toString(36);
};

/**
 * The cache key of 4.4: the chat, the selected reply and swipe, the reply's text, and the action's
 * settings. Any change to one of them makes saved options stale.
 */
export function optionsCacheKey({ chat = '', target = null, action = {} }) {
    const settings = ['count', 'length', 'prompt', 'set', 'title', 'icon'].map(key => action[key] ?? '');
    return JSON.stringify([String(chat), target ? [target.index, target.swipe, digest(target.text)] : null, action.id || '', digest(JSON.stringify(settings))]);
}

const cache = new Map();
const slot = (chat, action) => JSON.stringify([String(chat), action?.id || '']);

/** The key for the open chat and its latest reply, as it stands now. */
export const currentOptionsKey = action => optionsCacheKey({ chat: quickChatIdentity(), target: guidedTarget(), action });

/** Save options under the key taken when their request started. */
export function rememberOptions(action, options, key = currentOptionsKey(action)) {
    const chat = JSON.parse(key)[0];
    cache.set(slot(chat, action), { key, options: options.map(option => ({ ...option })) });
}

/** Saved options for this action when they still match the chat, reply and settings; otherwise null. */
export function cachedOptions(action, key = currentOptionsKey(action)) {
    const chat = JSON.parse(key)[0];
    const saved = cache.get(slot(chat, action));
    if (!saved) return null;
    if (saved.key !== key) {
        cache.delete(slot(chat, action));
        return null;
    }
    return saved.options.map(option => ({ ...option }));
}

export const clearOptionsCache = () => cache.clear();

/** What a card shows for one option, kept pure for tests. */
export function cardModel(option, index) {
    const text = String(option?.text ?? '').trim();
    const title = String(option?.title ?? '').trim() || `Option ${index + 1}`;
    return { title, text, incomplete: !!option?.incomplete || !text, usable: !!text };
}

/** The running line in the header: "2 of 4". */
export const progressText = (arrived, count) => `${arrived} of ${count}`;

async function copyText(text) {
    try {
        await globalThis.navigator.clipboard.writeText(text);
        return true;
    } catch {
        // Older WebViews without the async clipboard: a selected, off-screen textarea and the copy command.
        const doc = globalThis.document;
        const area = h('textarea', { value: text, readOnly: true, style: { position: 'fixed', left: '-9999px', top: '0' } });
        doc.body.append(area);
        area.select();
        let ok = false;
        try { ok = doc.execCommand('copy'); } catch { ok = false; }
        area.remove();
        return ok;
    }
}

/**
 * Send one option as the player's message and keep the draft that was in the message box: the option
 * goes through SillyTavern's own Send button, then the draft and its cursor come back.
 */
export async function sendOption(text, { wait = 4000 } = {}) {
    const doc = globalThis.document;
    const send = doc.querySelector('#send_but');
    if (!send || isGenerating()) return false;
    const draft = readComposer();
    writeComposer({ text, start: text.length, end: text.length });
    send.click();
    const input = doc.querySelector('#send_textarea');
    const started = Date.now();
    while (input && input.value === text && Date.now() - started < wait) await new Promise(resolve => setTimeout(resolve, 50));
    if (draft?.text && input && !input.value) writeComposer(draft);
    return input?.value !== text || !!draft?.text;
}

function headSlot(sheet) {
    const head = sheet.element.querySelector('.ri-gsheet-head');
    let node = head.querySelector('.ri-results-head');
    if (!node) {
        node = h('div', { class: 'ri-results-head' });
        head.insertBefore(node, head.querySelector('[data-ri-close]'));
    }
    return node;
}

/**
 * Keep the chat readable above the results. The sheet leaves at least one chat line below the chat's
 * top edge when the keyboard shrinks the page, and a spacer as tall as the sheet's overlap lets the
 * chat scroll its latest reply up above the sheet. Both go when the sheet closes.
 */
function fitResults(sheet) {
    const doc = globalThis.document;
    const viewport = globalThis.visualViewport;
    const release = () => {
        viewport?.removeEventListener('resize', place);
        doc.removeEventListener('ri-look-change', relayout);
        sheet.riResultsWatch?.disconnect();
        doc.querySelector('#chat')?.classList.remove('ri-results-open');
    };
    const place = () => {
        if (!sheet.element.isConnected) {
            release();
            return;
        }
        const top = viewport ? viewport.offsetTop : 0;
        const visibleBottom = viewport ? top + viewport.height : globalThis.innerHeight;
        const bar = doc.querySelector('#ri_composer_bar');
        const bottom = Math.min(visibleBottom, bar?.getClientRects().length ? bar.getBoundingClientRect().top : visibleBottom);
        const chat = doc.querySelector('#chat');
        const chatTop = Math.max(top, chat ? chat.getBoundingClientRect().top : top);
        const sample = doc.querySelector('#chat .mes_text') || chat || doc.body;
        const style = globalThis.getComputedStyle(sample);
        const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4 || 20;
        sheet.element.style.setProperty('--ri-results-room', `${Math.max(120, Math.round(bottom - chatTop - line))}px`);
        if (chat) {
            const overlap = Math.max(0, Math.round(chat.getBoundingClientRect().bottom - sheet.element.getBoundingClientRect().top));
            chat.style.setProperty('--ri-results-overlap', `${overlap}px`);
            chat.classList.add('ri-results-open');
            // Bring the latest reply's text to rest just above the sheet, its start first when it is long.
            const reply = [...chat.querySelectorAll('.mes[is_user="false"] .mes_text')].pop()?.getBoundingClientRect();
            const sheetTop = sheet.element.getBoundingClientRect().top;
            if (reply) chat.scrollTop += Math.min(reply.bottom - (sheetTop - 8), reply.top - chatTop - 8);
        }
    };
    // A new height from Setup, Look changes the overlap; measure once the sheet has its new height.
    const relayout = () => (globalThis.requestAnimationFrame ? requestAnimationFrame(place) : place());
    if (!sheet.riResultsFit) {
        sheet.riResultsFit = place;
        viewport?.addEventListener('resize', place);
        doc.addEventListener('ri-look-change', relayout);
        // The Generate sheet removes itself on close; the spacer goes with it.
        sheet.riResultsWatch = new MutationObserver(() => { if (!sheet.element.isConnected) release(); });
        sheet.riResultsWatch.observe(doc.body, { childList: true });
    }
    // Measure after the cards have laid out.
    relayout();
}

/** The header while options are requested: "0 of 4" and Cancel. Cards already shown stay usable. */
export function showOptionsRunning(sheet, { count, onCancel }) {
    loadResultsStyles();
    const status = h('span', { class: 'ri-results-count', role: 'status' }, progressText(0, count));
    const cancel = h('button', { type: 'button', class: 'ri-bar-btn', 'data-ri-cancel': '', onclick: () => onCancel?.() },
        icon('fa-stop'), 'Cancel');
    headSlot(sheet).replaceChildren(status, cancel);
    sheet.element.dataset.running = 'true';
}

/** The header once the request ends: Generate again when options are showing, nothing otherwise. */
export function clearOptionsRunning(sheet, { onGenerateAgain } = {}) {
    delete sheet.element.dataset.running;
    const showing = sheet.element.dataset.results === 'true';
    const again = showing && h('button', { type: 'button', class: 'ri-bar-btn ri-cost-chip', 'data-ri-again': '',
        'aria-label': 'Generate again, 1 model call, extra request', onclick: () => onGenerateAgain?.() },
    icon('fa-microchip'), 'Generate again', dot());
    headSlot(sheet).replaceChildren(...(again ? [again] : []));
}

function optionCard(option, index, { insert, send, announce }) {
    const model = cardModel(option, index);
    const label = `option ${index + 1}, ${model.title}`;
    const copy = h('button', { type: 'button', class: 'ri-bar-btn', 'data-ri-copy': '', 'aria-label': `Copy ${label}`, disabled: !model.usable,
        onclick: async () => {
            const ok = await copyText(model.text);
            copy.lastChild.textContent = ok ? 'Copied' : 'Copy failed';
            announce(ok ? 'Copied.' : 'Copy failed.');
            setTimeout(() => { copy.lastChild.textContent = 'Copy'; }, 2000);
        } }, icon('fa-copy'), h('span', {}, 'Copy'));
    const actions = h('div', { class: 'ri-option-actions' }, copy,
        h('button', { type: 'button', class: 'ri-bar-btn', 'data-ri-insert': '', 'aria-label': `Insert ${label}`, disabled: !model.usable,
            onclick: () => insert(model.text) }, icon('fa-arrow-turn-down'), 'Insert'),
        h('button', { type: 'button', class: 'ri-bar-btn', 'data-ri-send': '', 'aria-label': `Send ${label}`, disabled: !model.usable,
            onclick: () => send(model.text) }, icon('fa-paper-plane'), 'Send'));
    // The card itself carries no handler, so a tap or a scroll on its text does nothing.
    return h('article', { class: 'ri-option-card', 'data-incomplete': model.incomplete ? 'true' : null, 'aria-label': model.title },
        h('h3', { class: 'ri-option-title' }, model.title),
        model.incomplete && h('p', { class: 'ri-option-note' }, icon('fa-triangle-exclamation'), 'Incomplete option'),
        model.text && h('p', { class: 'ri-option-body' }, model.text),
        actions);
}

/**
 * Fill the Generate sheet with option cards.
 * @param {object} sheet the Generate sheet (B1's generate-sheet.js)
 * @param {object[]} options titled options from guided-turns.js parseOptions
 * @param {object} handlers
 * @param {(text:string)=>void} handlers.insert puts text at the message box cursor (or replaces it, as the action sets)
 * @param {()=>void} [handlers.onGenerateAgain]
 * @param {string} [handlers.note] a line above the cards, for example after a Cancel
 */
export function showOptions(sheet, options, { insert, onGenerateAgain, note = '' }) {
    loadResultsStyles();
    const live = h('p', { class: 'ri-results-live', role: 'status', 'aria-live': 'polite' });
    const announce = text => {
        live.textContent = '';
        setTimeout(() => { live.textContent = text; }, 30);
    };
    const handlers = {
        announce,
        insert: text => { insert(text); sheet.close({ reason: 'insert' }); },
        send: async text => {
            sheet.close({ reason: 'send' });
            await sendOption(text);
        },
    };
    sheet.showResults(...[note && h('p', { class: 'ri-results-note' }, note),
        ...options.map((option, index) => optionCard(option, index, handlers)), live].filter(Boolean));
    clearOptionsRunning(sheet, { onGenerateAgain });
    fitResults(sheet);
}
