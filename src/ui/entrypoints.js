// ST entry points: the extensions-panel drawer (#extensions_settings, ST inline-drawer markup) and the
// wand menu item (#extensionsMenu, ST list-group-item markup). Both open the modal.
// ST 1.18: #extensions_settings at public/index.html:5759; #extensionsMenu from
// public/scripts/templates/wandMenu.html, appended by addExtensionsButtonAndMenu() (scripts/extensions.js:688).

import { h, icon } from './dom.js';

function waitFor(id, cb, timeoutMs = 20000) {
    const el = document.getElementById(id);
    if (el) { cb(el); return () => {}; }
    let done = false;
    const obs = new MutationObserver(() => {
        const found = document.getElementById(id);
        if (found && !done) { done = true; obs.disconnect(); clearTimeout(t); cb(found); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    const t = setTimeout(() => { done = true; obs.disconnect(); }, timeoutMs);
    return () => { done = true; obs.disconnect(); clearTimeout(t); };
}

export function createEntryPoints({ onOpen }) {
    const nodes = [];

    const drawer = h('div', { class: 'uc2-drawer inline-drawer', id: 'uc2_settings_drawer' },
        h('div', { class: 'inline-drawer-toggle inline-drawer-header' },
            h('b', {}, 'Undercurrent 2'),
            h('div', { class: 'inline-drawer-icon fa-solid fa-circle-chevron-down down' })),
        h('div', { class: 'inline-drawer-content' },
            h('p', { class: 'uc2-drawer-note' }, 'Story settings, narrator, characters, memory and chance rules live in the Undercurrent panel. Also: the floating button, the wand menu, or /uc.'),
            h('div', { class: 'menu_button menu_button_icon uc2-drawer-open', attrs: { role: 'button', tabindex: '0' }, on: {
                click: () => onOpen(),
                keydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } },
            } }, icon('fa-water'), h('span', {}, 'Open Undercurrent'))));

    const menuItem = h('div', { class: 'list-group-item flex-container flexGap5 interactable', id: 'uc2_wand_item',
        attrs: { tabindex: '0', role: 'button', title: 'Open Undercurrent' },
        on: {
            click: () => onOpen(),
            keydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } },
        } },
    h('div', { class: 'fa-solid fa-water extensionsMenuExtensionButton' }), h('span', {}, 'Undercurrent'));

    const stops = [
        waitFor('extensions_settings', host => { host.appendChild(drawer); nodes.push(drawer); }),
        waitFor('extensionsMenu', host => { host.appendChild(menuItem); nodes.push(menuItem); }),
    ];

    return {
        destroy() {
            stops.forEach(s => s());
            nodes.forEach(n => n.remove());
        },
    };
}
