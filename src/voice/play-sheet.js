// V2: the Play sheet. Read aloud in a reply's message menu starts the reading and opens this small bottom sheet beside
// it: the reading's state, Stop or Play again, and four changes for this reply only (More feeling, Calmer, Faster,
// Slower), applied on top of each speaker's own settings. A change reads the reply again at once; lines whose audio
// it does not change come from the cache. The changes stay in memory under this reply and swipe, so the characters'
// settings on the Voices page never move. It closes with Close, Escape, the back gesture or a tap outside, and makes
// no model call: the desktop voice renders audio only.
import { h } from '../ui/dom.js';
import { ctx, toast } from '../st.js';
import { fitBottom } from '../ui/generate-sheet.js';
import { MOMENTS, momentFor, momentWords, setMoment, toggleMoment } from './delivery.js';
import { cacheKey, onVoiceState, readReply, stopReading, voiceState } from './player.js';

const icon = name => h('i', { class: `fa-solid ${name}`, 'aria-hidden': 'true' });
let current = null;
let ownBacks = 0;

const STATUS = {
    rendering: 'Rendering on your desktop...',
    playing: 'Reading aloud.',
    done: 'Finished.',
    stopped: 'Stopped. Play again replays what was rendered.',
    empty: 'No spoken dialogue in double quotes, so nothing to read.',
};

/**
 * Open the sheet for a reply. host is a test hook. returnFocus is the Read aloud entry, which takes focus back on close.
 * The caller starts the reading; the sheet follows its state.
 */
export function openPlaySheet(mesId, { returnFocus, host = ctx() } = {}) {
    const id = Number(mesId);
    if (current?.mesId === id && !current.closed) return current;
    current?.close({ reason: 'replaced' });
    const doc = globalThis.document;
    const viewport = globalThis.visualViewport;
    const message = host.chat?.[id];
    const key = cacheKey(host, id, message);
    const titleId = `ri-psheet-title-${Date.now().toString(36)}`;
    const status = h('p', { class: 'ri-psheet-status', role: 'status', 'aria-live': 'polite' });
    const primary = h('button', { type: 'button', class: 'ri-bar-btn ri-bar-btn-primary', 'data-ri-play': '', onclick: () => sheet.primary() });
    const chips = Object.entries(MOMENTS).map(([momentId, spec]) => h('button', { type: 'button', class: 'ri-bar-btn ri-psheet-moment',
        'data-ri-moment': momentId, 'aria-pressed': 'false', onclick: () => sheet.toggle(momentId) }, spec.label));
    const applied = h('p', { class: 'ri-psheet-note' });
    const title = h('h2', { class: 'ri-gsheet-title', id: titleId, tabIndex: -1 }, `Read aloud: ${message?.name || 'reply'}`);
    const element = h('section', { class: 'ri-gsheet ri-psheet', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': titleId, 'data-kind': 'voice', 'data-ri-mesid': String(id) },
        h('div', { class: 'ri-gsheet-grab', 'aria-hidden': 'true' }),
        h('header', { class: 'ri-gsheet-head' },
            h('div', { class: 'ri-gsheet-titles' }, title,
                h('p', { class: 'ri-gsheet-cost' }, icon('fa-desktop'), 'Rendered by your desktop voice, no model call')),
            h('button', { type: 'button', class: 'ri-bar-btn ri-bar-btn-text', 'data-ri-close': '', onclick: () => sheet.close({ reason: 'close' }) }, 'Close')),
        h('div', { class: 'ri-gsheet-body' },
            status,
            h('div', { class: 'ri-gsheet-actions' }, primary),
            h('div', { class: 'ri-psheet-moments', role: 'group', 'aria-label': 'For this reply only' },
                h('p', { class: 'ri-gsheet-label' }, 'For this reply only'),
                h('div', { class: 'ri-psheet-row' }, chips)),
            applied));

    let state = { status: 'rendering', reason: '' };
    const busy = () => state.status === 'rendering' || state.status === 'playing';
    const draw = () => {
        const moment = momentFor(key);
        primary.replaceChildren(icon(busy() ? 'fa-stop' : 'fa-play'), busy() ? 'Stop' : 'Play again');
        primary.setAttribute('aria-label', busy() ? 'Stop reading' : 'Play this reply again');
        status.setAttribute('role', state.status === 'failed' ? 'alert' : 'status');
        status.textContent = state.status === 'failed' ? `Failed. ${state.reason}` : STATUS[state.status] || '';
        for (const chip of chips) chip.setAttribute('aria-pressed', String(Object.values(moment).includes(chip.dataset.riMoment)));
        const words = momentWords(moment);
        applied.textContent = words
            ? `${words} on top of each speaker's settings, for this reply only. The Voices page keeps their settings.`
            : 'Each speaker reads with their own settings from Story, Characters, Voices.';
    };
    const read = moment => readReply(id, { host, ...(moment ? { moment } : {}) }).then(out => {
        if (out?.status === 'empty') { state = { status: 'empty', reason: '' }; draw(); }
    }).catch(error => toast('error', String(error?.message || error)));

    const unsubscribe = onVoiceState(next => {
        if (next.mesId !== id) return;
        state = { status: next.status, reason: next.reason || '' };
        if (!sheet.closed) draw();
    });
    const outside = event => {
        if (!element.isConnected || element.contains(event.target)) return;
        if (event.target.closest?.('.ri-voice-button')) return;
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
    const place = () => {
        const visibleBottom = viewport ? viewport.offsetTop + viewport.height : globalThis.innerHeight;
        const bar = doc.querySelector('#ri_composer_bar');
        const barTop = bar?.getClientRects().length ? bar.getBoundingClientRect().top : visibleBottom;
        const bottom = Math.min(visibleBottom, barTop);
        element.style.setProperty('--ri-room', `${Math.max(120, bottom - (viewport?.offsetTop || 0))}px`);
        fitBottom(element, bottom);
    };

    const sheet = {
        mesId: id, key, element, closed: false,
        /** Stop while reading; otherwise read the reply again with this reply's changes. */
        primary() {
            if (busy()) { stopReading(); return; }
            state = { status: 'rendering', reason: '' };
            draw();
            read();
        },
        /** Turn a change on or off for this reply and read it again with it. */
        toggle(momentId) {
            const next = toggleMoment(momentFor(key), momentId);
            setMoment(key, next);
            state = { status: 'rendering', reason: '' };
            draw();
            read(next);
        },
        close({ reason = 'close', fromHistory = false } = {}) {
            if (sheet.closed) return;
            sheet.closed = true;
            if (current === sheet) current = null;
            unsubscribe();
            doc.removeEventListener('pointerdown', outside, true);
            doc.removeEventListener('keydown', keys, true);
            globalThis.removeEventListener('popstate', back);
            viewport?.removeEventListener('resize', place);
            element.remove();
            if (!fromHistory && globalThis.history?.state?.riPlaySheet) {
                ownBacks++;
                globalThis.history.back();
            }
            if (reason !== 'replaced' && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
        },
    };
    const now = voiceState();
    if (now?.mesId === id) state = { status: now.status, reason: now.reason || '' };
    doc.body.append(element);
    draw();
    place();
    viewport?.addEventListener('resize', place);
    try { globalThis.history?.pushState({ ...(globalThis.history.state || {}), riPlaySheet: true }, ''); } catch { /* history is optional */ }
    globalThis.addEventListener('popstate', back);
    setTimeout(() => { if (!sheet.closed) doc.addEventListener('pointerdown', outside, true); }, 0);
    doc.addEventListener('keydown', keys, true);
    title.focus({ preventScroll: true });
    current = sheet;
    return sheet;
}
