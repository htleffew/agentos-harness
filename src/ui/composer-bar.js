// The composer bar (DESIGN.md 4.1, 4.6, 4.8, 4.9, 4.10): one row above SillyTavern's send form,
// in a container the extension owns. The jobs a tap runs live in quick-actions.js (the runner).
import { h } from './dom.js';
import { accessibleName, barPins, composerBar, costWords, kindOf, listQuickActions, moveBarPin, pinToBar,
    QUICK_ACTION_KINDS, setBarFolded } from '../quick-actions.js';
import { LOOK_DEFAULTS, lookSettings, SCALE_RANGE, saveLook } from './theme/styles.js';
import { fitBottom } from './generate-sheet.js';
import { applyWrap, saveInlineSettings, shownWraps } from '../inline-direction.js';
import { installInlineUi } from './inline-direction.js';
import { touchLayoutRow } from './touch-layout.js';

export const HOLD_MS = 450;
export const SLOP_PX = 10;

/**
 * Pointer cancellation (WCAG 2.5.2): a tap acts on release inside the control; moving off,
 * a scroll (pointercancel) or a hold of HOLD_MS cancels it, and the hold opens the popover.
 */
export function createPressTracker({ onTap, onHold, holdMs = HOLD_MS, slop = SLOP_PX, setTimer = setTimeout, clearTimer = clearTimeout }) {
    let press = null;
    const reset = () => {
        if (press?.timer) clearTimer(press.timer);
        press = null;
    };
    return {
        get active() { return !!press; },
        down({ x, y, id = 0 }) {
            reset();
            press = { x, y, id, held: false };
            const mine = press;
            press.timer = setTimer(() => {
                if (press !== mine) return;
                mine.held = true;
                mine.timer = null;
                onHold?.();
            }, holdMs);
        },
        move({ x, y, id = 0 }) {
            if (!press || press.id !== id) return;
            if (Math.hypot(x - press.x, y - press.y) > slop) reset();
        },
        up({ inside, id = 0 }) {
            if (!press || press.id !== id) return false;
            const tap = !press.held && inside;
            reset();
            if (tap) onTap?.();
            return tap;
        },
        cancel: reset,
    };
}

/** How many pins fit beside the status slot and More (DESIGN.md 4.1, 4.10). */
export function fitPins({ width, hit, gap, status, more, queue = 0, count }) {
    // Row children are the pins, the status slot and More (and the queue chip while something waits),
    // with one gap between neighbors; n pins take n * hit + (n - 1) * gap.
    const room = width - status - more - 2 * gap - (queue ? queue + gap : 0);
    const fits = Math.max(0, Math.floor((room + gap) / (hit + gap)));
    const shown = Math.min(count, fits);
    return { shown, overflow: count - shown, fits };
}

const icon = name => h('i', { class: `fa-solid ${name}`, 'aria-hidden': 'true' });
const dot = () => h('span', { class: 'ri-bar-dot', 'aria-hidden': 'true' });
const iconOf = action => action.icon || QUICK_ACTION_KINDS[kindOf(action)]?.icon || 'fa-star';
const inkOf = action => QUICK_ACTION_KINDS[kindOf(action)]?.ink || 'setup';
const calls = action => QUICK_ACTION_KINDS[kindOf(action)]?.call !== 'code';

const state = {
    root: null, runner: null, popover: null, hostGenerating: false, live: null, timer: null,
    status: { state: 'idle' }, notice: null,
};

export const barElement = () => state.root;

function announce(text) {
    if (!state.live || !text) return;
    // Clearing first makes a repeated message speak again.
    state.live.textContent = '';
    setTimeout(() => { if (state.live) state.live.textContent = text; }, 30);
}

/** 4.6 status: idle, running, ready, failed or cancelled. */
export function setBarStatus(next) {
    const previous = state.status;
    state.status = { ...next, at: Date.now() };
    clearTimeout(state.cancelTimer);
    if (next.state === 'cancelled') state.cancelTimer = setTimeout(() => {
        if (state.status.state === 'cancelled') setBarStatus({ state: 'idle' });
    }, 3000);
    const words = {
        running: `${next.title || 'Request'} running.`,
        ready: `${next.count} ${next.count === 1 ? 'option' : 'options'} ready.`,
        failed: `${next.title || 'Request'} failed. ${next.error || ''}`.trim(),
        cancelled: `${next.title || 'Request'} cancelled.`,
        done: next.message,
    }[next.state];
    if (words && (previous.state !== next.state || next.message)) announce(words);
    if (next.state === 'done') state.status = { state: 'idle' };
    renderBar();
}

export const barStatus = () => state.status;

/**
 * A note in the status slot while the bar is idle (B19: a route fallback, a route back, the spend warning).
 * notice: null, or { id, label, text, tone, count, actions: [{ label, run }], onDismiss }. The slot shows the short label;
 * a tap opens a popover with the full text, the actions and Dismiss. Running, ready and failed states take the slot first.
 */
export function setBarNotice(notice, slot = 'main') {
    // Each caller owns one slot (the spend notes 'main', the trim guard 'memory'), so clearing one never clears another.
    state.notices ||= new Map();
    if (notice) state.notices.set(slot, notice); else state.notices.delete(slot);
    state.notice = state.notices.get('memory') || state.notices.get('main') || [...state.notices.values()][0] || null;
    // Only the notice's own popover closes with it. A background job that clears a notice nobody saw must not shut the
    // More menu or a pin's options under her finger.
    if (!state.notice && state.popover?.riAnchor?.classList?.contains('ri-bar-notice')) closePopover();
    renderBar();
}

function closePopover() {
    state.popover?.remove();
    state.popover = null;
    document.removeEventListener('pointerdown', outsidePopover, true);
    document.removeEventListener('keydown', popoverKeys, true);
}
function outsidePopover(event) {
    if (state.popover && !state.popover.contains(event.target)) closePopover();
}
function popoverKeys(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    const anchor = state.popover?.riAnchor;
    closePopover();
    anchor?.focus?.({ preventScroll: true });
}

/** A popover anchored from the bottom, above its control and inside the visible viewport. */
function openPopover(anchor, content, label) {
    closePopover();
    const pop = h('div', { class: 'ri-bar-pop', role: 'dialog', 'aria-label': label }, content);
    pop.riAnchor = anchor;
    document.body.append(pop);
    const rect = anchor.getBoundingClientRect();
    fitBottom(pop, Math.max(pop.offsetHeight + 4, rect.top - 6));
    const width = pop.offsetWidth;
    pop.style.left = `${Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, innerWidth - width - 8))}px`;
    state.popover = pop;
    setTimeout(() => {
        document.addEventListener('pointerdown', outsidePopover, true);
        document.addEventListener('keydown', popoverKeys, true);
    }, 0);
    pop.querySelector('button')?.focus({ preventScroll: true });
    return pop;
}

function popButton(label, action, extra = {}) {
    return h('button', { type: 'button', class: 'ri-bar-btn', ...extra, onclick: action }, label);
}

function holdPopover(action, anchor) {
    const kind = kindOf(action);
    const connection = state.runner?.connection?.(action) || '';
    const pins = composerBar().pins;
    const at = pins.indexOf(action.id);
    const content = [
        h('p', { class: 'ri-bar-pop-title' }, action.title),
        h('p', { class: 'ri-bar-pop-meta' }, QUICK_ACTION_KINDS[kind]?.name || 'Quick action'),
        h('p', { class: 'ri-bar-pop-cost', 'data-call': QUICK_ACTION_KINDS[kind]?.call },
            QUICK_ACTION_KINDS[kind]?.call === 'extra' && dot(), costWords(kind, connection)),
        h('div', { class: 'ri-bar-pop-actions' },
            popButton('Edit', () => { closePopover(); state.runner?.edit?.(action); }),
            popButton('Move left', () => { moveBarPin(action.id, -1); closePopover(); renderBar(); }, { disabled: at <= 0 }),
            popButton('Move right', () => { moveBarPin(action.id, 1); closePopover(); renderBar(); }, { disabled: at < 0 || at >= pins.length - 1 }),
            popButton('Unpin', () => { pinToBar(action.id, false); closePopover(); renderBar(); announce(`${action.title} unpinned.`); })),
    ];
    openPopover(anchor, content, `${action.title} options`);
}

function moreMenu(anchor, overflow) {
    const pinned = new Set(composerBar().pins);
    const rows = [];
    if (overflow.length) {
        rows.push(h('p', { class: 'ri-bar-pop-group' }, 'Pinned'));
        for (const action of overflow) rows.push(moreRow(action, true));
    }
    const others = listQuickActions('', { allKinds: true }).filter(action => !pinned.has(action.id));
    for (const [kind, def] of Object.entries(QUICK_ACTION_KINDS)) {
        const group = others.filter(action => kindOf(action) === kind);
        if (!group.length) continue;
        rows.push(h('p', { class: 'ri-bar-pop-group' }, def.name));
        for (const action of group) rows.push(moreRow(action, false));
    }
    rows.push(h('p', { class: 'ri-bar-pop-group' }, 'More'),
        popButton('All quick actions', () => { closePopover(); state.runner?.openAll?.(anchor); }),
        state.runner?.openSettings && popButton('Bar settings', () => { closePopover(); state.runner.openSettings(); }));
    openPopover(anchor, rows, 'More quick actions');
}

function moreRow(action, pinned) {
    const disabled = calls(action) && busy();
    const run = h('button', { type: 'button', class: 'ri-bar-btn', 'data-ink': inkOf(action), disabled,
        'aria-label': accessibleName(action),
        onclick: event => { closePopover(); state.runner?.run(action, state.root?.querySelector('.ri-bar-more') || event.currentTarget); } },
    icon(iconOf(action)), action.title, kindOf(action) === 'options' && dot());
    const pin = popButton(pinned ? 'Unpin' : 'Pin', () => {
        pinToBar(action.id, !pinned);
        closePopover();
        renderBar();
        announce(`${action.title} ${pinned ? 'unpinned' : 'pinned'}.`);
    }, { 'aria-label': `${pinned ? 'Unpin' : 'Pin'} ${action.title}` });
    return h('div', { class: 'ri-bar-pop-row' }, run, pin);
}

// Model-calling icons wait while a bar request runs or SillyTavern generates its own reply.
const busy = () => state.status.state === 'running' || state.hostGenerating || globalThis.document?.body?.dataset?.generating === 'true';

function pinButton(action) {
    const control = h('button', { type: 'button', class: 'ri-bar-icon ri-bar-pin', 'data-ink': inkOf(action),
        'data-kind': kindOf(action), 'data-action-id': action.id, 'aria-label': accessibleName(action), title: action.title,
        'aria-haspopup': QUICK_ACTION_KINDS[kindOf(action)]?.sheet ? 'dialog' : null },
    icon(iconOf(action)), kindOf(action) === 'options' && dot());
    wirePress(control, () => state.runner?.run(action, control), () => holdPopover(action, control));
    return control;
}

/**
 * Tap on release, cancel on move-off, scroll or hold; keyboard activation uses click.
 * `keepFocus` never lets the control take focus from the message box (the wrap buttons, B42).
 */
function wirePress(control, onTap, onHold, { keepFocus = false } = {}) {
    const tracker = createPressTracker({ onTap: () => { if (!control.disabled) onTap(); }, onHold });
    if (keepFocus) control.addEventListener('mousedown', event => event.preventDefault());
    control.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        // Keep the message box focused so the keyboard and cursor stay as they were.
        if (keepFocus || document.activeElement?.id === 'send_textarea') event.preventDefault();
        tracker.down({ x: event.clientX, y: event.clientY, id: event.pointerId });
    });
    control.addEventListener('pointermove', event => {
        tracker.move({ x: event.clientX, y: event.clientY, id: event.pointerId });
        if (!tracker.active) return;
        const rect = control.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) tracker.cancel();
    });
    control.addEventListener('pointerup', event => {
        const rect = control.getBoundingClientRect();
        const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
        tracker.up({ inside, id: event.pointerId });
    });
    // The tap already acted on release. Without this, the browser's follow-up mouse events and click
    // land on whatever now sits under the finger (the Generate sheet's text box) and focus it.
    control.addEventListener('touchend', event => { if (event.cancelable) event.preventDefault(); });
    control.addEventListener('pointercancel', () => tracker.cancel());
    control.addEventListener('pointerleave', () => tracker.cancel());
    control.addEventListener('contextmenu', event => event.preventDefault());
    control.addEventListener('click', event => {
        // Pointer taps were handled on release; a click with no pointer detail is the keyboard.
        if (event.detail === 0) onTap();
    });
    control.addEventListener('keydown', event => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); onHold(); }
    });
}

// ---------- The wrap buttons (B42) ----------

function wrapPopover(wrap, anchor) {
    openPopover(anchor, [
        h('p', { class: 'ri-bar-pop-title' }, wrap.label),
        h('p', { class: 'ri-bar-pop-meta' }, wrap.help),
        h('div', { class: 'ri-bar-pop-actions' },
            popButton('Hide', () => {
                saveInlineSettings({ [wrap.id]: false });
                closePopover();
                renderBar();
                announce(`${wrap.label} button hidden. Turn it back on in Direction, Notes inside your message.`);
            })),
    ], `${wrap.label} button`);
}

function wrapButton(wrap) {
    const control = h('button', { type: 'button', class: 'ri-bar-icon ri-bar-wrap', 'data-ink': wrap.ink, 'data-wrap': wrap.id,
        'aria-label': `${wrap.name}, ${wrap.label}`, title: wrap.label }, icon(wrap.icon));
    wirePress(control, () => applyWrap(wrap), () => wrapPopover(wrap, control), { keepFocus: true });
    return control;
}

function noticeButton(notice) {
    const full = notice.count > 1 ? `${notice.text} (${notice.count} notes)` : notice.text;
    const control = h('button', { type: 'button', class: 'ri-bar-status-button ri-bar-notice', 'data-tone': notice.tone || 'problem',
        'aria-label': full, 'aria-haspopup': 'dialog', title: full }, icon('fa-circle-info'), notice.label);
    control.addEventListener('click', () => {
        if (state.popover?.riAnchor === control) { closePopover(); return; }
        const done = () => closePopover();
        const actions = (notice.actions || []).map(action => h('button', { type: 'button', class: 'ri-bar-btn',
            onclick: () => { done(); action.run?.(); } }, action.label));
        const dismiss = h('button', { type: 'button', class: 'ri-bar-btn', onclick: () => { done(); notice.onDismiss?.(); } }, 'Dismiss');
        openPopover(control, [h('p', { class: 'ri-bar-notice-text' }, full), h('div', { class: 'ri-bar-notice-actions' }, actions, dismiss)], notice.label);
    });
    return control;
}

/** The status slot. While it has nothing to say, the wrap buttons (B42) take its reserved width, clear of the middle of the bar. */
function statusSlot(wraps) {
    const { status } = state;
    const slot = h('div', { class: 'ri-bar-status' });
    if (status.state === 'idle' || status.state === 'done') {
        if (state.notice) slot.append(noticeButton(state.notice));
        else if (wraps) slot.append(wraps);
        return slot;
    }
    const runner = state.runner;
    let control;
    if (status.state === 'running') {
        const elapsed = Math.floor((Date.now() - status.startedAt) / 1000);
        control = h('button', { type: 'button', class: 'ri-bar-status-button', 'data-tone': status.kind === 'options' ? 'call' : 'reply',
            'aria-label': `Stop ${status.title || 'request'}`, onclick: () => runner?.stop?.() },
        icon('fa-stop'), 'Stop', elapsed >= 10 && h('span', { class: 'ri-bar-elapsed' }, `${elapsed}s`));
        // Redraw only when the elapsed counter changes, from 10 s on, so a press on Stop is not
        // interrupted by a redraw that replaces the button under the finger.
        clearTimeout(state.timer);
        const tick = () => {
            if (state.status !== status) return;
            const seconds = Math.floor((Date.now() - status.startedAt) / 1000);
            const counter = state.root?.querySelector('.ri-bar-status-button .ri-bar-elapsed');
            if (counter) counter.textContent = `${seconds}s`;
            else if (seconds >= 10) { renderBar(); return; }
            state.timer = setTimeout(tick, seconds >= 9 ? 1000 : (10 - seconds) * 1000);
        };
        state.timer = setTimeout(tick, elapsed >= 9 ? 1000 : (10 - elapsed) * 1000);
    } else if (status.state === 'ready') {
        control = h('button', { type: 'button', class: 'ri-bar-status-button', 'data-tone': 'ready',
            'aria-label': `View ${status.count} ${status.count === 1 ? 'option' : 'options'}`, onclick: () => runner?.view?.() },
        icon('fa-circle-check'), `View ${status.count}`);
    } else if (status.state === 'failed') {
        control = h('button', { type: 'button', class: 'ri-bar-status-button', 'data-tone': 'problem',
            'aria-label': `${status.title || 'Request'} failed. Open the error`, onclick: () => runner?.showFailure?.() },
        icon('fa-triangle-exclamation'), 'Failed');
    } else if (status.state === 'cancelled') {
        control = h('span', { class: 'ri-bar-status-button', role: 'note' }, icon('fa-ban'), 'Cancelled');
    }
    if (control) slot.append(control);
    return slot;
}

function layoutPins(row, pins, more) {
    const controls = [...row.querySelectorAll('.ri-bar-pin')];
    controls.forEach(control => { control.hidden = false; });
    if (!controls.length || !row.clientWidth) return [];
    const styles = getComputedStyle(row);
    const gap = parseFloat(styles.columnGap) || 0;
    const padding = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
    const queue = row.querySelector('.ri-bar-queue:not([hidden])')?.offsetWidth || 0;
    const wraps = row.querySelector(':scope > .ri-bar-wraps');
    const { shown } = fitPins({ width: row.clientWidth - padding, hit: controls[0].offsetWidth, gap,
        status: row.querySelector('.ri-bar-status').offsetWidth, more: more.offsetWidth + (wraps ? wraps.offsetWidth + gap : 0), queue, count: controls.length });
    controls.forEach((control, index) => { control.hidden = index >= shown; });
    return pins.slice(shown);
}

/**
 * SillyTavern saves its settings a second after the last change, so a page closed or reloaded inside that second
 * loses it. Folding the bar and restoring a quick action write at once.
 */
export async function saveSettingsNow() {
    try { await (await import('/script.js')).saveSettings(); } catch { /* the delayed save still runs */ }
}

// ---------- The fold handle and other fixed controls (B25) ----------

const HANDLE_EDGE_PX = 4;
const HANDLE_STEP_PX = 8;
const CLICKABLE = 'button, a, input, select, textarea, summary, label, [role="button"], [tabindex], [onclick]';
const clickable = node => node.matches?.(CLICKABLE) || getComputedStyle(node).cursor === 'pointer';

/** The elements that sit above the fold handle at five by three points of its hit box. */
function handleBlockers(fold) {
    const box = fold.getBoundingClientRect();
    const found = new Set();
    for (const fx of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        for (const fy of [0.15, 0.5, 0.85]) {
            const stack = document.elementsFromPoint(box.x + box.width * fx, box.y + box.height * fy);
            const mine = stack.findIndex(node => fold.contains(node));
            for (const node of mine < 0 ? stack : stack.slice(0, mine)) if (!state.root.contains(node)) found.add(node);
        }
    }
    return [...found];
}

/** One more than the highest z-index in the blockers' ancestry, so the handle takes the tap they would have taken. */
function zAbove(blockers) {
    let top = 2;
    for (const node of blockers) {
        for (let at = node; at && at !== document.body; at = at.parentElement) {
            const z = Number.parseInt(getComputedStyle(at).zIndex, 10);
            if (Number.isFinite(z)) top = Math.max(top, z);
        }
    }
    return top + 1;
}

/**
 * Keep the fold handle tappable. Another extension's fixed bar can sit on the handle's box (Pathweaver's bar
 * does when ours is folded). With nothing above the handle it stays where the stylesheet puts it. Otherwise it
 * moves sideways, in 8 px steps, to the nearest spot with no control from another extension under it, and
 * takes a z-index above whatever plain surface still covers that spot. With no free spot it stays put.
 */
export function clearFoldHandle() {
    const root = state.root;
    const fold = root?.querySelector('.ri-bar-fold');
    if (!fold || root.hidden || !fold.getClientRects().length) return;
    const set = (shift, z) => {
        fold.style.setProperty('--ri-fold-shift', `${shift}px`);
        if (z) fold.style.setProperty('--ri-fold-z', String(z)); else fold.style.removeProperty('--ri-fold-z');
    };
    set(0, 0);
    if (!handleBlockers(fold).length) return;
    const limit = Math.floor((root.getBoundingClientRect().width - fold.getBoundingClientRect().width) / 2) - HANDLE_EDGE_PX;
    for (let step = 0; step <= limit; step += HANDLE_STEP_PX) {
        for (const shift of step ? [-step, step] : [0]) {
            set(shift, 0);
            const covering = handleBlockers(fold);
            if (covering.some(clickable)) continue;
            if (covering.length) set(shift, zAbove(covering));
            return;
        }
    }
    set(0, 0);
}

/** Re-check the handle when the page resizes or another extension changes the send area. */
function watchFoldHandle() {
    let queued = 0;
    const later = () => { cancelAnimationFrame(queued); queued = requestAnimationFrame(() => clearFoldHandle()); };
    addEventListener('resize', later);
    const sheld = document.querySelector('#form_sheld');
    if (sheld && globalThis.MutationObserver) {
        new MutationObserver(records => { if (records.some(record => !state.root.contains(record.target))) later(); })
            .observe(sheld, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    }
}

/** Draw or redraw the bar into its container. */
export function renderBar() {
    const root = state.root;
    if (!root || !state.runner) return;
    const context = state.runner.context();
    root.hidden = !context.chatOpen;
    root.dataset.off = String(!context.enabled);
    const folded = composerBar().folded;
    root.dataset.folded = String(folded && context.enabled);
    if (!context.chatOpen) return;
    const pins = barPins();
    const disabled = busy();
    const active = root.contains(document.activeElement) ? document.activeElement : null;
    const focused = active && (active.dataset.actionId ? `[data-action-id="${CSS.escape(active.dataset.actionId)}"]`
        : ['ri-bar-fold', 'ri-bar-more', 'ri-bar-queue', 'ri-bar-status-button'].map(name => `.${name}`).find(name => active.matches(name)));
    const fold = h('button', { type: 'button', class: 'ri-bar-fold', 'aria-expanded': String(!folded),
        'aria-controls': 'ri_composer_bar_row', 'aria-label': folded ? 'Open quick actions' : 'Fold quick actions',
        onclick: () => { setBarFolded(!composerBar().folded); saveSettingsNow(); renderBar(); root.querySelector('.ri-bar-fold')?.focus({ preventScroll: true }); } },
    h('span', { class: 'ri-bar-fold-face' }, icon('fa-chevron-down')));
    const queued = context.queued || 0;
    const queue = h('button', { type: 'button', class: 'ri-bar-icon ri-bar-queue', hidden: !queued,
        'aria-label': `${queued} queued for your next message`, onclick: event => state.runner.openQueue?.(event.currentTarget) },
    icon('fa-signs-post'), h('span', {}, String(queued)));
    const controls = pins.map(action => {
        const control = pinButton(action);
        const running = state.status.state === 'running' && state.status.actionId === action.id;
        control.dataset.running = String(running);
        control.dataset.failed = String(state.status.state === 'failed' && state.status.actionId === action.id);
        if (calls(action) && disabled) control.disabled = true;
        return control;
    });
    const wraps = shownWraps();
    const wrapGroup = wraps.length ? h('div', { class: 'ri-bar-wraps', role: 'group', 'aria-label': 'Wrap text' }, wraps.map(wrapButton)) : null;
    const status = statusSlot(wrapGroup);
    const more = h('button', { type: 'button', class: 'ri-bar-icon ri-bar-more', 'aria-label': 'More quick actions',
        'aria-haspopup': 'dialog', title: 'More quick actions' }, icon('fa-ellipsis'));
    const row = h('div', { class: 'ri-bar-row', id: 'ri_composer_bar_row', role: 'toolbar', 'aria-label': 'Quick actions' },
        queue, h('div', { class: 'ri-bar-pins' }, controls), wrapGroup && !status.contains(wrapGroup) ? wrapGroup : null,
        status, more);
    root.replaceChildren(h('div', { class: 'ri-bar-handle-row' }, context.enabled && fold), row,
        h('div', { class: 'ri-bar-strip', 'aria-hidden': 'true' }), state.live);
    let overflow = [];
    const relayout = () => { overflow = layoutPins(row, pins, more); };
    relayout();
    state.relayout = relayout;
    wirePress(more, () => moreMenu(more, overflow), () => moreMenu(more, overflow));
    if (focused) root.querySelector(focused)?.focus({ preventScroll: true });
    clearFoldHandle();
}

/**
 * Mount the bar above the send form. When an extension that rebuilds the layout hides the
 * send form's row, the bar mounts above the chat form instead.
 */
export function placeBar() {
    const input = document.querySelector('#send_textarea');
    if (!input || !state.root) return;
    const form = input.closest('#send_form');
    const shown = node => node && getComputedStyle(node).display !== 'none' && node.getClientRects().length > 0;
    const sheld = document.querySelector('#form_sheld');
    const anchor = shown(form) ? form : sheld && shown(sheld) ? sheld : input.parentElement;
    if (state.root.nextElementSibling !== anchor) anchor.before(state.root);
    state.root.dataset.placement = anchor === form ? 'send-form' : 'chat-form';
}

/**
 * @param {object} runner the jobs: context(), run(action, trigger), stop(), view(), showFailure(),
 *   openQueue(trigger), openAll(trigger), edit(action), openSettings(), connection(action)
 */
export function mountComposerBar(runner) {
    state.runner = runner;
    if (!state.root) {
        state.live = h('span', { class: 'ri-visually-hidden', 'aria-live': 'polite', role: 'status' });
        state.root = h('div', { id: 'ri_composer_bar', class: 'ri-bar' });
        if (globalThis.ResizeObserver) new ResizeObserver(() => state.relayout?.()).observe(state.root);
        document.addEventListener('ri-look-change', () => renderBar());
        watchFoldHandle();
    }
    installInlineUi();
    placeBar();
    renderBar();
    return state.root;
}

export function setHostGenerating(on) {
    if (state.hostGenerating === !!on) return;
    state.hostGenerating = !!on;
    renderBar();
}

export function toggleBarHidden(force) {
    if (!state.root) return false;
    const hide = typeof force === 'boolean' ? force : !state.root.classList.contains('ri-bar-user-hidden');
    state.root.classList.toggle('ri-bar-user-hidden', hide);
    state.root.style.display = hide ? 'none' : '';
    return !hide;
}

/** Setup, Look (DESIGN.md 1.10): text, icon and touch-target size, each Compact or Comfortable plus a scale. */
export function renderLookPage(body) {
    const look = lookSettings();
    const section = (legend, choiceKey, scaleKey, help) => {
        const [low, high] = SCALE_RANGE[scaleKey];
        const output = h('output', {}, `${look[scaleKey]}%`);
        const choices = ['compact', 'comfortable'].map(value => h('button', { type: 'button', class: 'ri-bar-btn',
            'aria-pressed': String(look[choiceKey] === value), onclick: () => { saveLook({ [choiceKey]: value }); rerender(); } },
        value === 'compact' ? 'Compact' : 'Comfortable'));
        const range = h('input', { type: 'range', min: low, max: high, step: 5, value: look[scaleKey], 'aria-label': `${legend} scale`,
            oninput: event => { output.textContent = `${event.target.value}%`; saveLook({ [scaleKey]: Number(event.target.value) }); } });
        return h('fieldset', {}, h('legend', {}, legend), h('div', { class: 'ri-look-choices' }, choices),
            h('label', {}, 'Scale', range, output), h('p', { class: 'ri-help' }, help));
    };
    const height = h('output', {}, `${look.sheetHeight}%`);
    const host = h('div', { class: 'ri-look', id: 'ri-look' },
        section('Text size', 'text', 'textScale', 'Compact uses 12 to 14 px type; Comfortable 13 to 16 px. The scale multiplies both.'),
        section('Icon size', 'icons', 'iconScale', 'Glyphs on the bar, tabs and tray: 16 px Compact, 20 px Comfortable.'),
        section('Touch targets', 'targets', 'targetScale', 'Bar and sheet targets: 32 px Compact, 44 px Comfortable. Nothing goes below 24 px.'),
        h('fieldset', {}, h('legend', {}, 'Results sheet height'),
            h('label', {}, 'Height', h('input', { type: 'range', min: SCALE_RANGE.sheetHeight[0], max: SCALE_RANGE.sheetHeight[1], step: 5,
                value: look.sheetHeight, 'aria-label': 'Results sheet height',
                oninput: event => { height.textContent = `${event.target.value}%`; saveLook({ sheetHeight: Number(event.target.value) }); } }), height)),
        touchLayoutRow(rerender),
        h('button', { type: 'button', class: 'ri-bar-btn', onclick: () => { saveLook({ ...LOOK_DEFAULTS }); rerender(); } }, 'Restore Compact defaults'));
    function rerender() {
        const fresh = h('div');
        renderLookPage(fresh);
        host.replaceWith(fresh.firstChild);
    }
    body.append(host);
}
