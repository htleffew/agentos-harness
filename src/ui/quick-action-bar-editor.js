// Quick actions, Bar (DESIGN.md 4.7): the pin editor with a Global and This chat switch. Every control is a
// single tap (WCAG 2.5.7), and a preview shows which pins overflow into More at the width the bar has now.
import { h } from './dom.js';
import { barPins, costWords, hasChatBar, kindOf, listQuickActions, moveBarPin, pinToBar, QUICK_ACTION_KINDS, useChatBar } from '../quick-actions.js';
import { barElement, fitPins, renderBar } from './composer-bar.js';
import { isChatOpen } from '../st.js';
import { KIND_ORDER } from './quick-action-fields.js';

const icon = name => h('i', { class: `fa-solid ${name}`, 'aria-hidden': 'true' });
const iconOf = action => action.icon || QUICK_ACTION_KINDS[kindOf(action)]?.icon || 'fa-star';
const kindName = action => QUICK_ACTION_KINDS[kindOf(action)]?.name || 'Quick action';

/** How many pins fit and how many go to More for a bar of this width (the arithmetic of DESIGN.md 4.1). */
export function previewFit({ width, hit, gap, count, padding = 0, status = 0 }) {
    return fitPins({ width: width - padding, hit, gap, status, more: hit, count });
}

/** Words for the preview line. */
export function previewWords(shown, total) {
    if (!total) return 'Nothing is pinned yet.';
    if (shown >= total) return `All ${total} pinned ${total === 1 ? 'action fits' : 'actions fit'} on the bar at this width.`;
    const overflow = total - shown;
    return `${shown} of ${total} fit at this width; ${overflow} ${overflow === 1 ? 'goes' : 'go'} to the top of More.`;
}

const state = { scope: '' };

export function renderBarPage(body, app) {
    const host = h('div', { class: 'ri-qa-page ri-qa-bar', id: 'ri-qa-bar' });
    body.append(host);
    const live = h('p', { class: 'ri-visually-hidden', role: 'status', 'aria-live': 'polite' });

    const chatOpen = () => !!isChatOpen();
    const scope = () => {
        if (!chatOpen()) return 'global';
        if (state.scope === 'chat' && hasChatBar()) return 'chat';
        if (state.scope === 'global') return 'global';
        return hasChatBar() ? 'chat' : 'global';
    };
    const say = text => { live.textContent = ''; setTimeout(() => { live.textContent = text; }, 30); };
    const changed = () => { try { renderBar(); } catch { /* the bar is not mounted yet */ } };

    function draw(focus) {
        const mode = scope();
        state.scope = mode;
        const pins = barPins(mode);
        const pinnedIds = new Set(pins.map(action => action.id));
        const rest = listQuickActions('', { allKinds: true });
        const others = KIND_ORDER.flatMap(kind => rest.filter(action => kindOf(action) === kind && !pinnedIds.has(action.id)));

        const switcher = h('div', { class: 'ri-qa-scope', role: 'group', 'aria-label': 'Which bar to edit' },
            ['global', 'chat'].map(value => h('button', { type: 'button', class: 'ri-bar-btn', 'data-scope': value, 'aria-pressed': String(mode === value),
                disabled: value === 'chat' && !chatOpen(), onclick: () => {
                    if (value === 'chat') useChatBar(true);
                    state.scope = value;
                    draw();
                    changed();
                } }, value === 'global' ? 'Global' : 'This chat')));

        const scopeNote = !chatOpen() ? h('p', { class: 'ri-help' }, 'Open a chat to give it a bar of its own. Global pins show in every chat.')
            : mode === 'chat' ? h('div', { class: 'ri-qa-note' },
                h('p', { class: 'ri-help' }, 'This chat has its own bar. It started as a copy of the global bar and replaces it here only.'),
                h('button', { type: 'button', class: 'ri-bar-btn', 'data-ri-use-global': '', onclick: () => { useChatBar(false); state.scope = 'global'; draw(); changed(); say('This chat uses the global bar.'); } },
                    'Use the global bar in this chat'))
                : hasChatBar() ? h('p', { class: 'ri-help' }, 'This chat has its own bar, so edits to the global bar do not show here. Open This chat to change it.')
                    : h('p', { class: 'ri-help' }, 'Pinned quick actions sit above the message box in this order, in every chat that has no bar of its own.');

        const rows = pins.map((action, index) => {
            const kind = kindOf(action);
            const label = action.title;
            const control = (name, step, extra = {}) => h('button', { type: 'button', class: 'ri-bar-btn', 'data-ri-act': name.toLowerCase().replace(/\s+/g, '-'),
                'aria-label': `${name} ${label}`, onclick: () => {
                    if (step === 'unpin') {
                        pinToBar(action.id, false, mode);
                        say(`${label} unpinned.`);
                        draw();
                    } else if (moveBarPin(action.id, step, mode)) {
                        say(`${label} moved ${step < 0 ? 'up' : 'down'}, position ${index + 1 + step} of ${pins.length}.`);
                        draw([action.id, step < 0 ? 'up' : 'down']);
                    }
                    changed();
                }, ...extra }, name);
            return h('li', { class: 'ri-qa-pin', 'data-action-id': action.id, 'data-ink': QUICK_ACTION_KINDS[kind]?.ink || 'setup' },
                h('span', { class: 'ri-qa-pin-icon' }, icon(iconOf(action)), kind === 'options' && h('span', { class: 'ri-qa-dot', 'aria-hidden': 'true' })),
                h('span', { class: 'ri-qa-pin-text' }, h('strong', {}, label), h('span', { class: 'ri-help' }, `${kindName(action)} · ${costWords(kind)}`)),
                h('span', { class: 'ri-qa-pin-actions' }, control('Move up', -1, { disabled: index === 0 }), control('Move down', 1, { disabled: index === pins.length - 1 }), control('Unpin', 'unpin')));
        });

        const preview = h('div', { class: 'ri-qa-prev', 'aria-hidden': 'true' });
        const previewLine = h('p', { class: 'ri-help ri-qa-prev-line', role: 'note' });
        const previewBox = h('div', { class: 'ri-qa-prev-box' }, h('h4', { class: 'ri-qa-section-title' }, 'Bar preview'), preview, previewLine);

        const addList = others.length ? h('details', { class: 'ri-qa-details', 'data-ri-pin-list': '' }, h('summary', {}, `Pin a quick action · ${others.length}`),
            h('ul', { class: 'ri-qa-list' }, others.map(action => h('li', { class: 'ri-qa-pin', 'data-action-id': action.id, 'data-ink': QUICK_ACTION_KINDS[kindOf(action)]?.ink || 'setup' },
                h('span', { class: 'ri-qa-pin-icon' }, icon(iconOf(action)), kindOf(action) === 'options' && h('span', { class: 'ri-qa-dot', 'aria-hidden': 'true' })),
                h('span', { class: 'ri-qa-pin-text' }, h('strong', {}, action.title), h('span', { class: 'ri-help' }, kindName(action))),
                h('span', { class: 'ri-qa-pin-actions' }, h('button', { type: 'button', class: 'ri-bar-btn', 'aria-label': `Pin ${action.title}`, onclick: () => {
                    pinToBar(action.id, true, mode);
                    say(`${action.title} pinned.`);
                    draw();
                    changed();
                } }, 'Pin')))))) : null;

        const pill = h('span', { class: 'ri-qa-pill' }, `${pins.length} PINNED${mode === 'chat' ? ' · THIS CHAT' : ''}`);
        const open = host.querySelector('[data-ri-pin-list]')?.open;
        host.replaceChildren(
            h('div', { class: 'ri-qa-head' }, icon('fa-bolt'), h('span', { class: 'ri-qa-head-title' }, 'Bar'), pill),
            h('p', { class: 'ri-help' }, 'Choose which quick actions sit above the message box and in what order. Hold an icon on the bar for the same choices.'),
            switcher, scopeNote, previewBox,
            pins.length ? h('ol', { class: 'ri-qa-list', 'aria-label': 'Pinned quick actions' }, rows) : h('p', { class: 'ri-help' }, 'Nothing is pinned. Pin a quick action below.'),
            addList, app?.openPage && h('button', { type: 'button', class: 'ri-bar-btn ri-bar-btn-text', onclick: () => app.openPage('quick-library', { focusPage: true }) }, 'Edit quick actions in the Library'),
            live);
        if (open && host.querySelector('[data-ri-pin-list]')) host.querySelector('[data-ri-pin-list]').open = true;
        fillPreview(preview, previewLine, pins);
        if (focus) {
            const row = [...host.querySelectorAll('.ri-qa-list > .ri-qa-pin')].find(item => item.dataset.actionId === focus[0]);
            const first = row?.querySelector('[data-ri-act="move-up"]'), second = row?.querySelector('[data-ri-act="move-down"]');
            const wanted = focus[1] === 'up' ? first : second;
            (wanted?.disabled ? (focus[1] === 'up' ? second : first) : wanted)?.focus({ preventScroll: true });
        }
    }

    function fillPreview(preview, line, pins) {
        const chips = pins.map(action => h('span', { class: 'ri-qa-prev-icon', 'data-ink': QUICK_ACTION_KINDS[kindOf(action)]?.ink || 'setup', 'data-id': action.id },
            icon(iconOf(action)), kindOf(action) === 'options' && h('span', { class: 'ri-qa-dot' })));
        const more = h('span', { class: 'ri-qa-prev-icon ri-qa-prev-more' }, icon('fa-ellipsis'));
        preview.replaceChildren(...chips, more);
        const place = () => {
            if (!preview.isConnected) return;
            const row = document.querySelector('#ri_composer_bar_row');
            const bar = barElement();
            const width = bar && bar.clientWidth ? bar.clientWidth : Math.min(preview.parentElement.clientWidth || innerWidth, innerWidth);
            const padding = row ? parseFloat(getComputedStyle(row).paddingLeft) + parseFloat(getComputedStyle(row).paddingRight) : 0;
            const hit = more.offsetWidth || 32;
            const gap = parseFloat(getComputedStyle(preview).columnGap) || 0;
            // The bar reserves its status slot first: a target plus 96 px (composer-bar.css).
            const status = row?.querySelector('.ri-bar-status')?.offsetWidth || hit + 96;
            const { shown } = previewFit({ width, hit, gap, count: chips.length, padding, status });
            preview.style.maxWidth = `${width}px`;
            chips.forEach((chip, index) => { chip.dataset.overflow = String(index >= shown); });
            line.textContent = previewWords(shown, chips.length);
            preview.dataset.shown = String(shown);
            preview.dataset.width = String(Math.round(width));
        };
        relayout = place;
        requestAnimationFrame(place);
    }
    // One observer for the page; it stops once the page leaves the document.
    let relayout = null;
    if (globalThis.ResizeObserver) {
        const observer = new ResizeObserver(() => { if (host.isConnected) relayout?.(); else observer.disconnect(); });
        observer.observe(document.body);
    }

    draw();
}
