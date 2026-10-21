// Shared tab scaffolding: section header, per-tab Advanced switch, generic settings sections.

import { h, icon, setText, store } from '../dom.js';
import { buildControl, accordionGroup, switchEl, setSwitch } from '../controls.js';
import { groupSections, entriesForTab, TABS } from '../model.js';

const SECTION_NAMES = { shape: 'Shape of a reply', lenses: 'Lenses', config: 'Story config', model: 'Model' };

/** Section label shown above a group; null when it would repeat the tab title. */
export function sectionLabel(section, tabId) {
    const s = String(section || '').trim();
    if (!s) return null;
    const def = TABS.find(t => t.id === tabId);
    const low = s.toLowerCase();
    if (def && (low === def.id || low === def.label.toLowerCase() || low === def.title.toLowerCase())) return null;
    return SECTION_NAMES[low] || s;
}

/** Section header: icon tile, amber accent bar, title, subtitle, status pill. */
export function sectionHeader(def) {
    const pillText = h('span', { class: 'uc2-pill-text' });
    const pill = h('span', { class: 'uc2-status-pill', attrs: { role: 'status' } }, icon('fa-circle-check', 'uc2-pill-on'), icon('fa-circle', 'uc2-pill-off'), pillText);
    const el = h('header', { class: 'uc2-sect-head' },
        h('div', { class: 'uc2-sect-tile', aria: { hidden: 'true' } }, icon(def.icon)),
        h('div', { class: 'uc2-sect-titles' }, h('h2', { class: 'uc2-sect-title' }, def.title), h('p', { class: 'uc2-sect-sub' }, def.subtitle)),
        pill);
    return {
        el,
        setStatus(status) {
            setText(pillText, status?.text || '');
            pill.classList.toggle('is-on', !!status?.on);
            pill.hidden = !status?.text;
        },
    };
}

/** "Show advanced" switch for a tab; toggles .uc2-show-adv on the tab element; remembered per viewer. */
export function advancedSwitch(tabId, tabEl) {
    const key = `uc2.ui.adv.${tabId}`;
    const sw = switchEl(false, 'Show advanced settings');
    sw.classList.add('uc2-switch-sm');
    const apply = on => {
        setSwitch(sw, on);
        tabEl.classList.toggle('uc2-show-adv', on);
    };
    const wrap = h('label', { class: 'uc2-adv-toggle' }, h('span', {}, 'Advanced'), sw);
    const flip = () => {
        const on = sw.getAttribute('aria-checked') !== 'true';
        apply(on);
        store.set(key, on);
    };
    sw.addEventListener('click', e => { e.preventDefault(); flip(); });
    apply(!!store.get(key, false));
    return wrap;
}

/**
 * Draw the schema entries of a tab into sections. Returns the list of controls (for refresh).
 * opts.skip(entry) → true to leave an entry out; opts.before[key] → Node inserted before that control;
 * opts.accordionOnly → one accordion group across the whole tab (Story Config).
 */
export function renderSettings(container, entries, ctx, opts = {}) {
    const controls = [];
    const group = accordionGroup();
    for (const sec of groupSections(entries)) {
        const list = h('div', { class: 'uc2-stack' });
        let visible = 0;
        let advOnly = true;
        for (const entry of sec.entries) {
            if (opts.skip?.(entry)) continue;
            const ctl = buildControl(entry, ctx, group);
            if (!ctl) continue;
            const pre = opts.before?.(entry);
            if (pre) {
                if (entry.advanced) pre.classList.add('uc2-adv');
                list.appendChild(pre);
            }
            list.appendChild(ctl.el);
            controls.push(ctl);
            visible++;
            if (!entry.advanced) advOnly = false;
        }
        if (!visible) continue;
        const label = opts.flat ? null : (opts.label?.(sec.section) ?? sectionLabel(sec.section, opts.tabId));
        const node = label ? h('div', { class: 'uc2-section' }, h('h3', { class: 'uc2-section-label' }, label), list) : list;
        if (advOnly) node.classList.add('uc2-adv');
        container.appendChild(node);
    }
    return controls;
}

export function hasAdvanced(schema, tab) {
    return entriesForTab(schema, tab).some(e => e.advanced);
}

/** Empty-state block. */
export function emptyState(iconName, title, text) {
    return h('div', { class: 'uc2-empty' }, icon(iconName, 'uc2-empty-icon'), h('div', { class: 'uc2-empty-title' }, title), h('p', {}, text));
}
