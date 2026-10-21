// Undercurrent 2 UI entry. CORE's index.js imports this (guarded) and calls mount(api); /uc calls open().
//
//   import { mount, open } from './src/ui/index.js';
//   const ui = mount(api);   // → { open(tab?), close(), destroy() }
//
// Tabs: 'story' | 'narrator' | 'writing' | 'director' | 'characters' | 'memory' | 'rules' | 'advanced'.

import { createModal } from './modal.js';
import { createLauncher } from './launcher.js';
import { createEntryPoints } from './entrypoints.js';
import { createReplyCards } from './replycard.js';

let instance = null;

export function mount(api) {
    if (instance) instance.destroy();
    const parts = [];
    const safe = (label, fn) => {
        try { return fn(); } catch (err) { console.error(`[Undercurrent UI] ${label} failed`, err); return null; }
    };

    const modal = createModal(api);
    const openModal = tab => modal.open(tab);
    const launcher = safe('launcher', () => createLauncher(api, { onOpen: () => openModal() }));
    const entry = safe('entry points', () => createEntryPoints({ onOpen: () => openModal() }));
    const cards = safe('reply cards', () => createReplyCards(api));
    parts.push(launcher, entry, cards);

    // /uc and CORE's own entry points open the modal through the opener CORE keeps (src/core/api.js registerOpener).
    safe('registerOpener', () => { if (typeof api?.registerOpener === 'function') api.registerOpener(tab => openModal(typeof tab === 'string' ? tab : undefined)); });

    instance = {
        open: tab => openModal(tab),
        close: () => modal.close(),
        refreshCards: () => cards?.refresh(),
        destroy() {
            modal.destroy();
            for (const p of parts) safe('destroy', () => p?.destroy());
            if (instance === this) instance = null;
        },
    };
    return instance;
}

/** Open the modal (optionally on a tab). No-op until mount(api) ran. */
export function open(tab) {
    instance?.open(tab);
}

export function close() {
    instance?.close();
}
