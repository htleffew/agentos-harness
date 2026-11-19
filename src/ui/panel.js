import { renderV10 } from './v10.js';
// The panel: one drawer in the Extensions menu, with an Expand button that shows the same panel full screen.
import { h, clear, toggle, button } from './dom.js';
import { settings, saveSettings } from '../store.js';
import { onChange } from '../engine.js';
import { renderInstructions } from './sets.js';
import { renderEvents, renderStyle } from './events.js';
import { renderGoals } from './goals.js';
import { renderCurrentState } from './state.js';
import { renderWorld } from './world.js';
import { renderSent, refreshUnderReplies } from './sent.js';
import { renderSettings } from './settings.js';
import { renderContext } from './context-dashboard.js';
import { renderLog } from './log.js';
import { onLog } from '../log.js';
import { isChatOpen } from '../st.js';

const TABS = [
    { id: 'instructions', label: 'Random Instructions', accent: 'cyan' },
    { id: 'events', label: 'Random Story Events', accent: 'blue' },
    { id: 'style', label: 'Random Writing Style', accent: 'green' },
    { id: 'goals', label: 'Character Goals', accent: 'sky' },
    { id: 'state', label: 'Current State', accent: 'green' },
    { id: 'world', label: 'Story World', accent: 'green' },
    { id: 'v10', label: 'V10 Story', accent: 'sky' },
    { id: 'sent', label: 'What Was Sent', accent: 'blue' },
    { id: 'context', label: 'Context & Memory', accent: 'sky' },
    { id: 'log', label: 'Log', accent: 'sky' },
    { id: 'settings', label: 'Settings', accent: 'cyan' },
];

export const app = {
    tab: 'instructions',
    route: { view: 'sets' },   // inside Random Instructions: sets | set | edit
    eroute: { view: 'list' },  // inside Random Story Events: list | edit
    sroute: { view: 'list' },  // inside Random Writing Style: list | edit
    wroute: { view: 'list' },  // inside Story World: list | edit
    cache: {},                 // lorebook name -> data, for counts on the cards
    root: null,
    body: null,
    home: null,
    missing: [],
    render,
    go(route) { app.route = route; app.resetScroll = true; render(); app.root?.scrollIntoView?.({ block: 'start' }); },
};

function setExpanded(on) {
    const st = settings();
    st.expanded = !!on;
    saveSettings();
    if (on) {
        let overlay = document.getElementById('ri_overlay');
        if (!overlay) { overlay = h('div', { id: 'ri_overlay', class: 'ri-overlay' }); document.body.appendChild(overlay); }
        overlay.appendChild(app.root);
        app.root.classList.add('ri-expanded');
    } else {
        app.home.appendChild(app.root);
        app.root.classList.remove('ri-expanded');
        document.getElementById('ri_overlay')?.remove();
    }
    render();
}

export function render() {
    if (!app.root) return;
    const st = settings();
    const expanded = app.root.classList.contains('ri-expanded');
    const tab = TABS.find(t => t.id === app.tab) || TABS[0];
    app.root.dataset.accent = st.accent && st.accent !== 'auto' ? st.accent : tab.accent;
    // Keep the page from jumping while the panel is rebuilt.
    const keepScroll = app.resetScroll ? 0 : (app.body?.scrollTop || 0);
    app.resetScroll = false;
    app.root.style.minHeight = `${app.root.offsetHeight}px`;
    clear(app.root);

    const head = h('div', { class: 'ri-head' },
        h('div', { class: 'ri-title' }, 'Roleplay Instructions'),
        h('div', { class: 'ri-head-right' },
            h('span', { class: 'ri-onoff' }, st.enabled ? 'On' : 'Off'),
            toggle(st.enabled, (v) => { st.enabled = v; saveSettings(); render(); }, 'Turn the whole extension on or off'),
            button(expanded ? 'Close full screen' : 'Expand', () => setExpanded(!expanded), { kind: 'ghost', title: expanded ? 'Go back to the small panel' : 'Show this panel full screen' })));

    const tabs = h('div', { class: 'ri-tabs', role: 'tablist' }, TABS.map(t =>
        h('button', { type: 'button', class: `ri-tab ${t.id === app.tab ? 'ri-tab-on' : ''}`, role: 'tab', 'aria-selected': String(t.id === app.tab), onclick: () => { app.tab = t.id; render(); } }, t.label)));

    app.body = h('div', { class: 'ri-body' });
    if (!st.enabled) app.body.appendChild(h('div', { class: 'ri-note ri-note-warn' }, 'The extension is off. Nothing is added, changed or checked until you turn it on at the top.'));
    if (app.missing.length) app.body.appendChild(h('div', { class: 'ri-note ri-note-warn' }, `This version of SillyTavern is missing something this extension needs (${app.missing.join(', ')}). Update SillyTavern or TauriTavern to 1.19 or later.`));
    if (!isChatOpen() && app.tab !== 'settings' && app.tab !== 'log') app.body.appendChild(h('div', { class: 'ri-note' }, 'No chat is open. Open a chat to turn instruction sets on for it and to see what was sent.'));

    if (app.tab === 'instructions') renderInstructions(app.body, app);
    else if (app.tab === 'events') renderEvents(app.body, app);
    else if (app.tab === 'style') renderStyle(app.body, app);
    else if (app.tab === 'goals') renderGoals(app.body, app);
    else if (app.tab === 'state') renderCurrentState(app.body, () => { refreshUnderReplies(); render(); });
    else if (app.tab === 'v10') renderV10(app.body, app);
    else if (app.tab === 'world') renderWorld(app.body, app);
    else if (app.tab === 'sent') renderSent(app.body, app);
    else if (app.tab === 'context') renderContext(app.body, app);
    else if (app.tab === 'log') renderLog(app.body, app);
    else renderSettings(app.body, app);

    app.root.append(head, tabs, app.body);
    app.body.scrollTop = keepScroll;
    requestAnimationFrame(() => { if (app.root) app.root.style.minHeight = ''; });
}

export function mount(missing) {
    app.missing = missing || [];
    const tryMount = () => {
        const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
        if (!host) { setTimeout(tryMount, 400); return; }
        if (document.getElementById('ri_drawer')) return;
        app.root = h('div', { id: 'ri_root', class: 'ri-root' });
        app.home = h('div', { class: 'inline-drawer-content ri-home' }, app.root);
        const drawer = h('div', { id: 'ri_drawer', class: 'ri-drawer' },
            h('div', { class: 'inline-drawer' },
                h('div', { class: 'inline-drawer-toggle inline-drawer-header' },
                    h('b', {}, 'Roleplay Instructions'),
                    h('div', { class: 'inline-drawer-icon fa-solid fa-circle-chevron-down down' })),
                app.home));
        host.appendChild(drawer);
        render();
    };
    tryMount();

    let timer = null;
    onLog(() => { if (app.tab === 'log') { clearTimeout(timer); timer = setTimeout(render, 80); } });
    onChange((what) => {
        if (what === 'chat') { app.route = { view: 'sets' }; app.eroute = { view: 'list' }; app.sroute = { view: 'list' }; app.wroute = { view: 'list' }; app.cache = {}; }
        refreshUnderReplies();
        // Keep unsaved wording in an open prompt editor during background updates.
        if (what !== 'chat' && app.root?.querySelector('.ri-prompt-editor[open]')) return;
        // Typing in the editor must not be interrupted by a redraw.
        if (app.tab === 'instructions' && app.route.view === 'edit' && what !== 'chat') return;
        if (app.tab === 'events' && app.eroute.view === 'edit' && what !== 'chat') return;
        if (app.tab === 'style' && app.sroute.view === 'edit' && what !== 'chat') return;
        if (app.tab === 'v10' && what !== 'chat' && (app.root?.querySelector('.ri-state-editor, [data-v10-draft]') ||
            (app.root?.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '')))) return;
        if (app.tab === 'world' && (app.wroute.view === 'edit' || app.wroute.sheet) && what !== 'chat') return;
        if (app.tab === 'state' && what !== 'chat' && app.root?.querySelector('.ri-state-editor')) return;
        if (app.tab === 'context' && what !== 'chat' && app.root?.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement?.tagName || '')) return;
        if (app.tab === 'goals' && what !== 'chat' && app.root?.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) return;
        clearTimeout(timer);
        timer = setTimeout(render, 80);
    });
}
