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
import { renderCorrections } from './corrections.js';
import { renderLog } from './log.js';
import { onLog } from '../log.js';
import { ctx, confirmBox, isChatOpen } from '../st.js';

const GROUPS = [
    { id:'story', label:'Story', accent:'green', tabs:[
        ['opening','Opening'],['state','Current State'],['corrections','Corrections'],['books','Reusable Lorebooks'],['facts','Chat Facts'],['plots','Plot Records'],['world','Story World'],
    ] },
    { id:'characters', label:'Characters', accent:'sky', tabs:[
        ['portrayal','Portrayal & Knowledge'],['emotion','Emotions & Relationships'],['goals','Character Goals'],['speakers','Dialogue Colors'],
    ] },
    { id:'direction', label:'Direction', accent:'cyan', tabs:[
        ['instructions','Random Instructions'],['events','Random Story Events'],['style','Random Writing Style'],['writing','Writing Guidance'],['checks','Action Checks'],
    ] },
    { id:'review', label:'Review', accent:'blue', tabs:[
        ['sent','What Was Sent'],['context','Context & Memory'],['log','Log'],
    ] },
    { id:'setup', label:'Setup', accent:'sky', tabs:[
        ['v10','Preset & Extension'],['display','Reply Display'],['settings','Settings'],
    ] },
];
const V10_PAGES = new Set(['v10','display','opening','books','facts','plots','portrayal','emotion','speakers','writing','checks']);

async function canLeaveDraft() {
    const routeKey = {instructions:'route',events:'eroute',style:'sroute',world:'wroute'}[app.tab];
    const route = app[routeKey];
    if (!route?.dirty && !app.root?.querySelector('[data-ri-dirty]')) return true;
    const chat = ctx().getCurrentChatId?.();
    if (!await confirmBox('Discard your unsaved changes?') || ctx().getCurrentChatId?.()!==chat) return false;
    if (route?.dirty) app[routeKey] = routeKey==='route' ? {view:'set',name:route.name} : {view:'list'};
    return true;
}

async function navigate(id, groupId, loreTarget = null) {
    if (app.tab !== id || app.loreTarget !== loreTarget) {
        if (!await canLeaveDraft()) return false;
        app.tab = id;
        app.loreTarget = loreTarget;
        app.resetScroll = true;
        render();
    }
    app.root?.querySelector(groupId ? `[data-ri-group="${groupId}"]` : `[data-ri-page="${id}"]`)?.focus({preventScroll:true});
    return true;
}

export const app = {
    tab: 'instructions',
    route: { view: 'sets' },   // inside Random Instructions: sets | set | edit
    eroute: { view: 'list' },  // inside Random Story Events: list | edit
    sroute: { view: 'list' },  // inside Random Writing Style: list | edit
    wroute: { view: 'list' },  // inside Story World: list | edit
    loreTarget: null,
    cache: {},                 // lorebook name -> data, for counts on the cards
    root: null,
    body: null,
    home: null,
    missing: [],
    render,
    setExpanded,
    openPage: navigate,
    async openSetting(page, controlId, moduleScope) {
        if (!await navigate(page)) return;
        if (moduleScope && app.moduleScope!==moduleScope) {
            app.moduleScope=moduleScope;
            render();
        }
        const control = controlId && document.getElementById(controlId);
        const disclosure = control?.closest('details');
        if (disclosure) disclosure.open=true;
        control?.scrollIntoView({block:'center'});
        control?.focus({preventScroll:true});
    },
    async openLoreEntry(entry) {
        if (await navigate('books',null,entry) && !app.root?.classList.contains('ri-expanded')) await setExpanded(true);
    },
    go(route) { app.route = route; app.resetScroll = true; render(); app.root?.scrollIntoView?.({ block: 'start' }); },
};

async function setExpanded(on) {
    const st = settings();
    st.expanded = !!on;
    saveSettings();
    if (on) {
        const active = document.activeElement;
        app.returnFocus = active && active!==document.body && !app.root.contains(active) ? active : null;
        app.restoreDrawer = Boolean(app.home.getClientRects().length);
        let overlay = document.getElementById('ri_overlay');
        if (!overlay) { overlay = h('div', { id: 'ri_overlay', class: 'ri-overlay' }); document.body.appendChild(overlay); }
        overlay.appendChild(app.root);
        app.root.classList.add('ri-expanded');
        app.root.setAttribute('role','dialog');
        app.root.setAttribute('aria-modal','true');
        app.root.setAttribute('aria-label','Roleplay Instructions');
    } else {
        app.home.appendChild(app.root);
        app.root.classList.remove('ri-expanded');
        for (const name of ['role','aria-modal','aria-label']) app.root.removeAttribute(name);
        document.getElementById('ri_overlay')?.remove();
        if (app.restoreDrawer && !app.home.getClientRects().length) {
            app.home.closest('.drawer')?.querySelector(':scope > .drawer-toggle')?.click();
        }
    }
    const control = app.root.querySelector('[data-ri-expand]');
    control.textContent = on ? 'Close full screen' : 'Expand';
    control.title = on ? 'Go back to the small panel' : 'Show this panel full screen';
    const returnFocus = !on && app.returnFocus?.isConnected && app.returnFocus.getClientRects().length
        ? app.returnFocus : control;
    returnFocus.focus({preventScroll:true});
    if (!on) app.returnFocus=null;
    return true;
}

function expandedKeyboard(event) {
    if (!app.root.classList.contains('ri-expanded') || event.defaultPrevented) return;
    if (event.key==='Escape' && event.target.tagName!=='SELECT') {
        event.preventDefault();event.stopPropagation();
        setExpanded(false);
    }
    if (event.key!=='Tab') return;
    const tabbable = [...app.root.querySelectorAll('button, a[href], input, select, textarea, summary, [tabindex]')]
        .filter(node=>!node.disabled && node.tabIndex>=0 && node.getClientRects().length);
    const first = tabbable[0], last = tabbable.at(-1);
    if (event.shiftKey && event.target===first || !event.shiftKey && event.target===last) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
    }
}

export function render() {
    if (!app.root) return;
    const st = settings();
    const expanded = app.root.classList.contains('ri-expanded');
    const group = GROUPS.find(item=>item.tabs.some(([id])=>id===app.tab)) || GROUPS[2];
    (app.lastPages ||= {})[group.id] = app.tab;
    app.root.dataset.accent = st.accent && st.accent !== 'auto' ? st.accent : group.accent;
    // Keep the page from jumping while the panel is rebuilt.
    const keepScroll = app.resetScroll ? 0 : (app.body?.scrollTop || 0);
    app.resetScroll = false;
    app.root.style.minHeight = `${app.root.offsetHeight}px`;
    clear(app.root);

    const expand = button(expanded ? 'Close full screen' : 'Expand', () => setExpanded(!app.root.classList.contains('ri-expanded')),
        {kind:'ghost',title:expanded ? 'Go back to the small panel' : 'Show this panel full screen'});
    expand.dataset.riExpand='';
    const head = h('div', { class: 'ri-head' },
        h('div', { class: 'ri-title' }, 'Roleplay Instructions'),
        h('div', { class: 'ri-head-right' },
            h('span', { class: 'ri-onoff' }, st.enabled ? 'On' : 'Off'),
            toggle(st.enabled, (v) => { st.enabled = v; saveSettings(); render(); }, 'Turn the whole extension on or off'),
            expand));

    const categories = h('nav',{class:'ri-categories','aria-label':'Roleplay sections'},
        GROUPS.map(item=>h('button',{type:'button',class:'ri-category','data-ri-group':item.id,
            'aria-current':item===group ? 'true' : null,onclick:()=>navigate(app.lastPages[item.id] || item.tabs[0][0],item.id)},item.label)));
    const pages = GROUPS.map(item=>h('nav',{class:'ri-tabs ri-page-nav','aria-label':`${item.label} pages`,hidden:item!==group},
        item.tabs.map(([id,label])=>h('button',{type:'button',class:`ri-tab ${id===app.tab ? 'ri-tab-on' : ''}`,
            'data-ri-page':id,'aria-current':id===app.tab ? 'page' : null,'aria-controls':'ri_panel_page',
            onclick:()=>navigate(id)},label))));
    const tabs = h('div',{class:'ri-panel-nav'},categories,pages);

    app.body = h('div', { id:'ri_panel_page', class: 'ri-body' });
    if (!st.enabled) app.body.appendChild(h('div', { class: 'ri-note ri-note-warn' }, 'The extension is off. Nothing is added, changed or checked until you turn it on at the top.'));
    if (app.missing.length) app.body.appendChild(h('div', { class: 'ri-note ri-note-warn' }, `This version of SillyTavern is missing something this extension needs (${app.missing.join(', ')}). Update SillyTavern or TauriTavern to 1.19 or later.`));
    if (!isChatOpen() && app.tab !== 'settings' && app.tab !== 'log') app.body.appendChild(h('div', { class: 'ri-note' },
        ['v10','display'].includes(app.tab) ? 'Open a chat to change its workflow, module activation and display settings.' : 'Open a character chat to use the '+(group.tabs.find(([id])=>id===app.tab)?.[1] || 'story')+' controls.'));

    if (app.tab === 'instructions') renderInstructions(app.body, app);
    else if (app.tab === 'events') renderEvents(app.body, app);
    else if (app.tab === 'style') renderStyle(app.body, app);
    else if (app.tab === 'goals') renderGoals(app.body, app);
    else if (app.tab === 'state') renderCurrentState(app.body, () => { refreshUnderReplies(); render(); });
    else if (app.tab === 'corrections') renderCorrections(app.body);
    else if (V10_PAGES.has(app.tab)) renderV10(app.body,app,app.tab);
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
        app.root.addEventListener('keydown',expandedKeyboard);
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
    const focusInField = () => app.root?.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '');
    onLog(() => { if (app.tab === 'log') { clearTimeout(timer); timer = setTimeout(render, 80); } });
    onChange((what) => {
        if (what === 'chat') { app.route = { view: 'sets' }; app.eroute = { view: 'list' }; app.sroute = { view: 'list' }; app.wroute = { view: 'list' }; app.cache = {}; app.loreTarget = null; }
        refreshUnderReplies();
        // Setup controls save immediately and their handlers belong to the displayed preset.
        if (what === 'preset' && app.tab === 'v10') {
            clearTimeout(timer);
            render();
            return;
        }
        // Keep unsaved wording in an open prompt editor during background updates.
        if (what !== 'chat' && app.root?.querySelector('.ri-prompt-editor[open]')) return;
        if (what !== 'chat' && app.tab === 'corrections') return;
        // Typing in the editor must not be interrupted by a redraw.
        if (app.tab === 'instructions' && app.route.view === 'edit' && what !== 'chat') return;
        if (app.tab === 'events' && app.eroute.view === 'edit' && what !== 'chat') return;
        if (app.tab === 'style' && app.sroute.view === 'edit' && what !== 'chat') return;
        if (V10_PAGES.has(app.tab) && what !== 'chat' && (app.root?.querySelector('.ri-state-editor, [data-v10-draft]') ||
            focusInField())) return;
        if (app.tab === 'world' && (app.wroute.view === 'edit' || app.wroute.sheet) && what !== 'chat') return;
        if (app.tab === 'state' && what !== 'chat' && app.root?.querySelector('.ri-state-editor')) return;
        if (app.tab === 'context' && what !== 'chat' && app.root?.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement?.tagName || '')) return;
        if (app.tab === 'goals' && what !== 'chat' && app.root?.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) return;
        clearTimeout(timer);
        timer = setTimeout(()=>{
            if (what==='chat' || !app.root?.querySelector('[data-ri-dirty]') && !(V10_PAGES.has(app.tab) && focusInField())) render();
        },80);
    });
}
