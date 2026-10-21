// Modal shell: scrim + glass panel, icon rail (bottom pill bar on phones), hero banner, header buttons,
// lazily-built tab panels that are kept alive (no whole-tab re-renders; scroll and focus survive).

import { h, icon, call, settle, setText, debounce, store, isPhone, scrollWithin } from './dom.js';
import { TABS, TAB_IDS, cssUrl, formatTokens, tabStatus, heroSources } from './model.js';
import { setMacroName } from './controls.js';
import { sectionHeader, advancedSwitch, hasAdvanced } from './tabs/common.js';
import { createSettingsTab } from './tabs/settings.js';
import { createNarratorTab } from './tabs/narrator.js';
import { createCharactersTab } from './tabs/characters.js';
import { createMemoryTab } from './tabs/memory.js';
import { createRulesTab } from './tabs/rules.js';
import { createAdvancedTab } from './tabs/advanced.js';
import { confirmPopup, toast } from './st-adapter.js';

const LAST_TAB_KEY = 'uc2.ui.lastTab';

function tabFactory(id, ctx) {
    switch (id) {
        case 'narrator': return createNarratorTab(ctx);
        case 'characters': return createCharactersTab(ctx);
        case 'memory': return createMemoryTab(ctx);
        case 'rules': return createRulesTab(ctx);
        case 'advanced': return createAdvancedTab(ctx);
        default: return createSettingsTab(id, ctx);
    }
}

export function createModal(api, { onClose } = {}) {
    let overlay = null;
    let isOpen = false;
    let current = null;
    let lastFocus = null;
    let overlayValues = {};
    let packsCache = [];
    let activeCache = true;
    const tabs = new Map(); // id → {def, panel, header, inst}
    const unsub = [];

    const ctx = {
        api,
        get content() { return call(api, 'getContent') || {}; },
        get schema() { const s = call(api, 'getSchema'); return Array.isArray(s) ? s : []; },
        /** Option lists that live outside content (optionsRef → list). */
        get extraOptions() {
            const profiles = call(api, 'listConnectionProfiles');
            return {
                connectionProfiles: [{ id: '', label: 'Current connection' },
                    ...(Array.isArray(profiles) ? profiles : []).map(p => ({ id: String(p.id ?? p.name), label: String(p.name ?? p.id) }))],
            };
        },
        getSettings: () => ({ ...(call(api, 'getSettings') || {}), ...overlayValues }),
        getState: () => call(api, 'getState') || {},
        set(key, value) {
            overlayValues[key] = value;
            call(api, 'setSetting', key, value);
            afterChange();
        },
        reset(key, def) {
            if (typeof api.resetSetting === 'function') call(api, 'resetSetting', key);
            else call(api, 'setSetting', key, def);
            overlayValues[key] = def;
            afterChange();
        },
        onPacks(p) { packsCache = p; updateStatus(); },
        onActive(on) { activeCache = on; updateStatus(); },
    };

    // ---- DOM ------------------------------------------------------------------------------
    const rail = h('nav', { class: 'uc2-rail', attrs: { role: 'tablist' }, aria: { label: 'Undercurrent sections', orientation: 'vertical' } });
    const railButtons = new Map();
    for (const def of TABS) {
        if (def.pinned) rail.appendChild(h('div', { class: 'uc2-rail-spacer', aria: { hidden: 'true' } }));
        const b = h('button', { class: 'uc2-rail-item', type: 'button', id: `uc2-tabbtn-${def.id}`,
            attrs: { role: 'tab', title: def.title }, aria: { selected: 'false', controls: `uc2-tab-${def.id}`, label: def.title } },
        icon(def.icon), h('span', { class: 'uc2-rail-label' }, def.label));
        b.addEventListener('click', () => { rail.classList.add('is-resting'); show(def.id); });
        railButtons.set(def.id, b);
        rail.appendChild(b);
    }
    // After picking a tab the rail collapses (is-resting) until the pointer leaves it: an expanded rail left under the
    // pointer would cover the start of the content (style.css, rail section).
    rail.addEventListener('pointerleave', () => rail.classList.remove('is-resting'));
    rail.addEventListener('keydown', e => {
        const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
        if (!keys.includes(e.key)) return;
        e.preventDefault();
        const i = TAB_IDS.indexOf(current);
        let j = i;
        if (e.key === 'Home') j = 0;
        else if (e.key === 'End') j = TAB_IDS.length - 1;
        else j = (i + (e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 1) + TAB_IDS.length) % TAB_IDS.length;
        show(TAB_IDS[j]);
        railButtons.get(TAB_IDS[j]).focus();
    });

    const hero = h('div', { class: 'uc2-hero', aria: { hidden: 'true' } }, h('div', { class: 'uc2-hero-img' }), h('div', { class: 'uc2-hero-shade' }));

    // token pill + popover
    const tokText = h('span', { class: 'uc2-btn-label uc2-keep' }, '~…');
    const tokPop = h('div', { class: 'uc2-pop', attrs: { role: 'tooltip' }, id: 'uc2-tok-pop', hidden: true });
    const tokBtn = h('button', { class: 'uc2-hbtn uc2-hbtn-tokens', type: 'button', aria: { label: 'Estimated prompt tokens', describedby: 'uc2-tok-pop' } },
        icon('fa-microchip'), tokText);
    const tokWrap = h('div', { class: 'uc2-pop-wrap' }, tokBtn, tokPop);
    const showPop = on => { tokPop.hidden = !on; };
    tokBtn.addEventListener('mouseenter', () => showPop(true));
    tokBtn.addEventListener('mouseleave', () => showPop(false));
    tokBtn.addEventListener('focus', () => showPop(true));
    tokBtn.addEventListener('blur', () => showPop(false));
    tokBtn.addEventListener('click', () => showPop(tokPop.hidden));

    const globalLabel = h('span', { class: 'uc2-btn-label uc2-keep' });
    const globalIcon = h('i', { class: 'fa-solid fa-earth-americas', aria: { hidden: 'true' } });
    const globalBtn = h('button', { class: 'uc2-hbtn uc2-hbtn-global', type: 'button', attrs: { role: 'switch' } }, globalIcon, globalLabel);
    globalBtn.addEventListener('click', () => {
        const on = !call(api, 'getGlobalMode', current);
        call(api, 'setGlobalMode', current, on);
        overlayValues = {};
        paintGlobal();
        refreshAll();
        toast('info', on ? 'This tab now saves to Global (all characters).' : `This tab now saves to ${characterName()} only.`);
    });

    const resetBtn = h('button', { class: 'uc2-hbtn uc2-hbtn-danger', type: 'button', aria: { label: 'Reset this tab to defaults' } },
        icon('fa-rotate-left'), h('span', { class: 'uc2-btn-label' }, 'Reset'));
    resetBtn.addEventListener('click', async () => {
        const def = TABS.find(t => t.id === current);
        const ok = await confirmPopup(`Reset “${def.title}” to defaults for ${scopeText()}?`, 'Reset');
        if (!ok) return;
        call(api, 'resetTab', current);
        overlayValues = {};
        refreshAll();
    });

    const devBtn = h('button', { class: 'uc2-hbtn uc2-hbtn-dev', type: 'button', aria: { label: 'Developer: payload preview' } },
        icon('fa-code'), h('span', { class: 'uc2-btn-label' }, 'Dev'));
    devBtn.addEventListener('click', () => {
        show('advanced');
        requestAnimationFrame(() => tabs.get('advanced')?.inst.showPayload?.());
    });

    const saveBtn = h('button', { class: 'uc2-hbtn uc2-hbtn-save', type: 'button', aria: { label: 'Save and close' } },
        icon('fa-floppy-disk'), h('span', { class: 'uc2-btn-label' }, 'Save & Close'));
    saveBtn.addEventListener('click', () => close());

    const closeBtn = h('button', { class: 'uc2-hbtn uc2-hbtn-close', type: 'button', aria: { label: 'Close' } }, icon('fa-xmark'));
    closeBtn.addEventListener('click', () => close());

    const topbar = h('div', { class: 'uc2-topbar' }, tokWrap, globalBtn, resetBtn, devBtn, saveBtn, closeBtn);
    const scroller = h('div', { class: 'uc2-scroll' });
    const main = h('div', { class: 'uc2-main' }, hero, topbar, scroller);
    const modal = h('div', { class: 'uc2-modal', attrs: { role: 'dialog', tabindex: '-1' }, aria: { modal: 'true', label: 'Undercurrent settings' } }, rail, main);

    function build() {
        overlay = h('div', { class: 'uc2-root uc2-overlay', hidden: true }, h('div', { class: 'uc2-glow', aria: { hidden: 'true' } }), modal);
        // Close on scrim click only when the press started on the scrim (drag-selecting text must not close).
        let downOnScrim = false;
        overlay.addEventListener('pointerdown', e => { downOnScrim = e.target === overlay; });
        overlay.addEventListener('click', e => { if (downOnScrim && e.target === overlay) close(); downOnScrim = false; });
        overlay.addEventListener('keydown', onKey);
        document.body.appendChild(overlay);
    }

    function onKey(e) {
        if (e.key === 'Escape') {
            if (!tokPop.hidden) { showPop(false); return; }
            e.stopPropagation();
            close();
            return;
        }
        if (e.key !== 'Tab') return;
        // Keep focus inside the dialog.
        const f = [...modal.querySelectorAll('button:not([disabled]), input, textarea, select, summary, [tabindex="0"]')]
            .filter(x => x.offsetParent !== null);
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    // ---- tabs -----------------------------------------------------------------------------
    function ensureTab(id) {
        if (tabs.has(id)) return tabs.get(id);
        const def = TABS.find(t => t.id === id);
        const header = sectionHeader(def);
        const panelEl = h('section', { class: 'uc2-tabpanel', id: `uc2-tab-${id}`, data: { tab: id },
            attrs: { role: 'tabpanel', tabindex: '-1' }, aria: { labelledby: `uc2-tabbtn-${id}` }, hidden: true });
        let inst;
        try {
            inst = tabFactory(id, ctx);
        } catch (err) {
            console.error('[Undercurrent UI] tab failed', id, err);
            inst = { el: h('div', { class: 'uc2-empty' }, 'This tab failed to load. See the console.'), refresh() {} };
        }
        const tools = h('div', { class: 'uc2-tab-tools' });
        if (id === 'advanced') panelEl.classList.add('uc2-show-adv');
        else if (hasAdvanced(ctx.schema, id)) tools.appendChild(advancedSwitch(id, panelEl));
        panelEl.append(header.el, tools, inst.el);
        scroller.appendChild(panelEl);
        const rec = { def, panel: panelEl, header, inst, scroll: 0 };
        tabs.set(id, rec);
        inst.refresh?.(ctx.getSettings());
        inst.onState?.(ctx.getState());
        return rec;
    }

    function show(id) {
        if (!TAB_IDS.includes(id)) id = 'story';
        if (current && tabs.has(current)) tabs.get(current).scroll = scroller.scrollTop;
        const rec = ensureTab(id);
        for (const [tid, r] of tabs) r.panel.hidden = tid !== id;
        for (const [tid, b] of railButtons) {
            b.setAttribute('aria-selected', String(tid === id));
            b.tabIndex = tid === id ? 0 : -1;
            b.classList.toggle('is-active', tid === id);
        }
        const changed = current !== id;
        current = id;
        store.set(LAST_TAB_KEY, id);
        scroller.scrollTop = changed ? rec.scroll || 0 : scroller.scrollTop;
        rec.inst.onShow?.();
        paintGlobal();
        updateStatus();
        if (isPhone()) scrollWithin(railButtons.get(id), rail, { axis: 'x', align: 'center' });
    }

    // ---- live data ------------------------------------------------------------------------
    const characterName = () => call(api, 'getCharacter')?.name || 'this character';
    setMacroName(() => call(api, 'getCharacter')?.name || '');
    const scopeText = () => (call(api, 'getGlobalMode', current) ? 'Global (all characters)' : characterName());

    function paintGlobal() {
        const hasMode = typeof api.getGlobalMode === 'function';
        globalBtn.hidden = !hasMode;
        if (!hasMode) return;
        const on = !!call(api, 'getGlobalMode', current);
        globalBtn.setAttribute('aria-checked', String(on));
        globalBtn.classList.toggle('is-on', on);
        globalIcon.className = `fa-solid ${on ? 'fa-earth-americas' : 'fa-user'}`;
        const scope = call(api, 'getScopeLabel', current);
        const label = on ? 'Global' : (scope && scope !== 'Global' ? scope : characterName());
        setText(globalLabel, on ? 'Global: On' : `${label} only`);
        globalBtn.title = on
            ? 'Changes on this tab apply to every character. Click to keep them for this character only.'
            : `Changes on this tab apply to ${label} only. Click to make this tab Global.`;
        globalBtn.setAttribute('aria-label', on ? 'Global: on for this tab' : `Global: off, saving to ${label}`);
    }

    function paintHero() {
        const ch = call(api, 'getCharacter');
        const img = hero.firstChild;
        const layers = heroSources(ch?.avatarUrl).map(u => cssUrl(new URL(u, document.baseURI).href));
        img.style.setProperty('--uc2-hero-img', layers.length ? layers.join(', ') : 'none');
        hero.classList.toggle('has-img', layers.length > 0);
    }

    async function refreshTokens() {
        const est = await settle(() => call(api, 'estimateTokens'), null);
        if (!est) { setText(tokText, '~–'); tokPop.replaceChildren(h('div', {}, 'No estimate yet')); return; }
        setText(tokText, `~${formatTokens(est.total ?? (Number(est.static) || 0) + (Number(est.turn) || 0))}`);
        tokPop.replaceChildren(
            h('div', { class: 'uc2-pop-title' }, 'Prompt estimate'),
            h('div', { class: 'uc2-pop-row' }, h('span', {}, 'Static (cached prefix)'), h('b', {}, `~${formatTokens(est.static)}`)),
            h('div', { class: 'uc2-pop-row' }, h('span', {}, 'Turn block (after history)'), h('b', {}, `~${formatTokens(est.turn)}`)),
            Number.isFinite(Number(est.history)) && est.history !== undefined
                ? h('div', { class: 'uc2-pop-row' }, h('span', {}, 'Chat history'), h('b', {}, `~${formatTokens(est.history)}`)) : null,
            h('div', { class: 'uc2-pop-row uc2-pop-total' }, h('span', {}, 'Total'), h('b', {}, `~${formatTokens(est.total)}`)),
            h('div', { class: 'uc2-pop-note' }, 'Estimate from a dry build; nothing is sent. The static part stays cached between turns.'));
        tokBtn.classList.remove('is-flash');
        void tokBtn.offsetWidth;
        tokBtn.classList.add('is-flash');
    }
    const refreshTokensSoon = debounce(refreshTokens, 350);

    function updateStatus() {
        const settings = ctx.getSettings();
        for (const [id, rec] of tabs) {
            rec.header.setStatus(tabStatus(id, { settings, schema: ctx.schema, content: ctx.content, state: ctx.getState(),
                packs: packsCache, active: activeCache }));
        }
    }

    function afterChange() {
        refreshTokensSoon();
        updateStatus();
    }

    function refreshAll() {
        const settings = ctx.getSettings();
        for (const rec of tabs.values()) {
            try { rec.inst.refresh?.(settings); } catch (err) { console.warn('[Undercurrent UI] refresh', err); }
        }
        paintGlobal();
        updateStatus();
        refreshTokensSoon();
    }

    function onSettingsEvent() {
        overlayValues = {};
        if (isOpen) refreshAll();
    }
    function onStateEvent() {
        if (!isOpen) return;
        const st = ctx.getState();
        for (const rec of tabs.values()) rec.inst.onState?.(st);
        updateStatus();
        refreshTokensSoon();
    }
    function onJobsEvent() {
        if (!isOpen) return;
        for (const rec of tabs.values()) rec.inst.onJobs?.();
    }
    function onChatEvent() {
        if (!isOpen) return;
        overlayValues = {};
        paintHero();
        refreshAll();
        onStateEvent();
    }

    if (typeof api.on === 'function') {
        const sub = (ev, fn) => { try { api.on(ev, fn); unsub.push(() => call(api, 'off', ev, fn)); } catch { /* ignore */ } };
        sub('settings', onSettingsEvent);
        sub('state', onStateEvent);
        sub('jobs', onJobsEvent);
        sub('chat', onChatEvent);
    }

    // ---- open/close -----------------------------------------------------------------------
    function open(tab) {
        if (!overlay) build();
        lastFocus = document.activeElement;
        overlayValues = {};
        activeCache = call(api, 'isActive') !== false;
        paintHero();
        const id = TAB_IDS.includes(tab) ? tab : (isOpen ? current : store.get(LAST_TAB_KEY, 'story'));
        overlay.hidden = false;
        document.documentElement.classList.add('uc2-modal-open');
        requestAnimationFrame(() => overlay.classList.add('is-open'));
        isOpen = true;
        refreshAll();
        show(id);
        onStateEvent();
        tabs.get('rules') ? tabs.get('rules').inst.load?.() : settle(() => call(api, 'listRulePacks'), []).then(p => { packsCache = Array.isArray(p) ? p : []; updateStatus(); });
        refreshTokens();
        // Focus the dialog itself (not a rail item: keyboard-opened /uc would expand the rail over the content).
        requestAnimationFrame(() => modal.focus({ preventScroll: true }));
    }

    function close() {
        if (!isOpen) return;
        isOpen = false;
        showPop(false);
        // Flush any pending text edits by blurring the focused field inside the modal.
        if (modal.contains(document.activeElement)) document.activeElement.blur?.();
        overlay.classList.remove('is-open');
        document.documentElement.classList.remove('uc2-modal-open');
        const done = () => { if (!isOpen) overlay.hidden = true; };
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        if (reduce) done(); else setTimeout(done, 200);
        try { lastFocus?.focus?.({ preventScroll: true }); } catch { /* ignore */ }
        onClose?.();
    }

    function destroy() {
        for (const u of unsub) u();
        overlay?.remove();
        overlay = null;
        tabs.clear();
        isOpen = false;
    }

    return { open, close, destroy, isOpen: () => isOpen, get current() { return current; } };
}
