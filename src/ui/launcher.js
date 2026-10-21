// Floating launcher: tap to open, drag (pointer events, 6px threshold) to move; snaps to the nearest
// side edge; never rests over ST's send form; hidden on phones while a text field outside our UI is focused.

import { h, icon, store, isPhone, call } from './dom.js';

const SIZE_DESKTOP = 48;
const SIZE_PHONE = 46;
const DRAG_THRESHOLD = 6;
const STORE_KEY = 'uc2.ui.launcher';

/** Pure: snap a dragged point to a side edge and clamp vertically, avoiding a forbidden rect. */
export function snapPosition({ x, y, vw, vh, size, gutter, margin, avoid }) {
    const side = x + size / 2 < vw / 2 ? 'left' : 'right';
    const left = side === 'left' ? gutter : vw - size - gutter;
    let top = Math.min(Math.max(y, margin), Math.max(margin, vh - size - margin));
    if (avoid && avoid.height > 0) {
        const pad = 8;
        const overlaps = top + size > avoid.top - pad && top < avoid.bottom + pad && left + size > avoid.left - pad && left < avoid.right + pad;
        if (overlaps) {
            const above = avoid.top - size - pad;
            top = above >= margin ? above : Math.min(avoid.bottom + pad, vh - size - margin);
        }
    }
    return { side, left, top };
}

/**
 * Pure: hide the launcher for a focus event? Only on phones, only for text fields outside our UI, and only when the
 * focus followed a real touch/click (an on-screen keyboard is then opening). SillyTavern focuses #send_textarea by
 * script after every chat load (script.js, CHAT_LOADED path); no keyboard opens then, and hiding on that focus left the
 * launcher invisible on phones until the user happened to blur the textarea (found in the e2e run at 390px).
 */
export function shouldHideForFocus({ phone, editable, insideUi, sinceGestureMs }) {
    return !!phone && !!editable && !insideUi && Number(sinceGestureMs) >= 0 && Number(sinceGestureMs) <= GESTURE_MS;
}
const GESTURE_MS = 1200;

export function createLauncher(api, { onOpen } = {}) {
    const btn = h('button', { class: 'uc2-root uc2-launcher', type: 'button', aria: { label: 'Open Undercurrent' },
        attrs: { title: 'Undercurrent (drag to move)' } }, icon('fa-water'));
    document.body.appendChild(btn);

    // Position lives in extension_settings.undercurrent2.ui.launcher via CORE's uiState()/saveUiState()
    // (src/core/api.js); localStorage is the fallback when CORE does not offer it.
    const uiObj = () => {
        const o = call(api, 'uiState');
        return o && typeof o === 'object' && typeof api?.saveUiState === 'function' ? o : null;
    };
    const load = () => {
        const o = uiObj();
        const v = o && o.launcher && typeof o.launcher === 'object' ? o.launcher : store.get(STORE_KEY, null);
        return v && typeof v === 'object' ? v : { x: 1, y: 0.24 };
    };
    const save = pos => {
        const o = uiObj();
        if (o) { o.launcher = pos; call(api, 'saveUiState'); } else store.set(STORE_KEY, pos);
    };

    const metrics = () => {
        const phone = isPhone();
        return { size: phone ? SIZE_PHONE : SIZE_DESKTOP, gutter: phone ? 10 : 18, margin: phone ? 56 : 48 };
    };
    const avoidRect = () => {
        const el = document.getElementById('form_sheld') || document.getElementById('send_form');
        const r = el?.getBoundingClientRect?.();
        return r && r.width > 0 ? r : null;
    };

    function place(left, top) {
        btn.style.setProperty('--uc2-lx', `${Math.round(left)}px`);
        btn.style.setProperty('--uc2-ly', `${Math.round(top)}px`);
    }

    function applySaved() {
        const { size, gutter, margin } = metrics();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const pos = load();
        const x = Number(pos.x) >= 0.5 ? vw : 0;
        const y = (Number.isFinite(Number(pos.y)) ? Number(pos.y) : 0.24) * vh;
        const p = snapPosition({ x, y, vw, vh, size, gutter, margin, avoid: avoidRect() });
        btn.dataset.side = p.side;
        place(p.left, p.top);
    }

    // ---- drag ---------------------------------------------------------------------------
    let start = null;
    let dragging = false;
    let suppressClick = false;

    btn.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        const r = btn.getBoundingClientRect();
        start = { x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, id: e.pointerId };
        dragging = false;
        // Capture now so a fast flick that leaves the 48px button before the threshold still drags.
        try { btn.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    btn.addEventListener('pointermove', e => {
        if (!start || e.pointerId !== start.id) return;
        if (!dragging) {
            if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_THRESHOLD) return;
            dragging = true;
            btn.classList.add('is-dragging');
        }
        e.preventDefault();
        const { size } = metrics();
        const left = Math.min(Math.max(e.clientX - start.dx, 0), window.innerWidth - size);
        const top = Math.min(Math.max(e.clientY - start.dy, 0), window.innerHeight - size);
        place(left, top);
    });
    const end = e => {
        if (!start || (e && e.pointerId !== start.id)) return;
        if (dragging) {
            const { size, gutter, margin } = metrics();
            const r = btn.getBoundingClientRect();
            const p = snapPosition({ x: r.left, y: r.top, vw: window.innerWidth, vh: window.innerHeight, size, gutter, margin, avoid: avoidRect() });
            btn.classList.remove('is-dragging');
            btn.dataset.side = p.side;
            place(p.left, p.top);
            save({ x: p.side === 'left' ? 0 : 1, y: +(p.top / window.innerHeight).toFixed(4) });
            suppressClick = true;
            setTimeout(() => { suppressClick = false; }, 350);
        }
        start = null;
        dragging = false;
    };
    btn.addEventListener('pointerup', end);
    btn.addEventListener('pointercancel', end);
    btn.addEventListener('click', e => {
        if (suppressClick) { e.preventDefault(); return; }
        onOpen?.();
    });

    // ---- keep clear of the keyboard on phones --------------------------------------------
    const isEditable = el => el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button'].includes(el.type)) || el.isContentEditable);
    let lastGesture = -Infinity;
    const onGesture = () => { lastGesture = Date.now(); };
    const onFocusIn = e => {
        const hide = shouldHideForFocus({ phone: isPhone(), editable: isEditable(e.target), insideUi: !!e.target.closest?.('.uc2-root'),
            sinceGestureMs: Date.now() - lastGesture });
        if (hide) btn.classList.add('is-kbd-hidden');
    };
    const onFocusOut = () => {
        setTimeout(() => {
            if (!isEditable(document.activeElement) || document.activeElement.closest?.('.uc2-root')) btn.classList.remove('is-kbd-hidden');
        }, 50);
    };
    document.addEventListener('pointerdown', onGesture, true);
    document.addEventListener('touchstart', onGesture, { capture: true, passive: true });
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);

    let resizeT = null;
    const onResize = () => { clearTimeout(resizeT); resizeT = setTimeout(applySaved, 120); };
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);

    applySaved();
    // ST lays out #form_sheld after extensions load; re-check once it settles.
    setTimeout(applySaved, 1500);

    return {
        el: btn,
        reposition: applySaved,
        destroy() {
            document.removeEventListener('pointerdown', onGesture, true);
            document.removeEventListener('touchstart', onGesture, { capture: true });
            document.removeEventListener('focusin', onFocusIn);
            document.removeEventListener('focusout', onFocusOut);
            window.removeEventListener('resize', onResize);
            window.visualViewport?.removeEventListener('resize', onResize);
            btn.remove();
        },
    };
}
