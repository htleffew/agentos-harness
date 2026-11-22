import { refreshComposerToolbar } from './quick-actions.js';
import { renderV10 } from './v10.js';
// The panel: one drawer in the Extensions menu, with an Expand button that shows the same panel full screen.
import { h, clear, toggle, button, captureView, restoreView, textInput } from './dom.js';
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

import { destination, findDestinations, groups, startingPage, normalizeGroup } from './destinations.js';
import { executionScope } from '../execution.js';
import { guidedTarget } from '../guided-context.js';
import { activePreset } from '../v10.js';

const V10_PAGES = new Set(['v10','display','opening','books','facts','plots','portrayal','emotion','speakers','writing','checks']);

const editorRoutes = {instructions:'route',events:'eroute',style:'sroute',world:'wroute'};
const draftScope=()=>JSON.stringify([executionScope(),activePreset()]);

function keepInterruptedDraft() {
    if (!app.displayScope || app.displayScope===draftScope()) return;
    const key=editorRoutes[app.tab];
    const editor=app[key]?.dirty && structuredClone(app[key]);
    const fields=[...app.body?.querySelectorAll('[data-ri-dirty] textarea, [data-ri-dirty] input, [data-ri-dirty] select, [data-ri-dirty]:is(input,textarea,select)') || []]
        .filter(node=>!node.readOnly && !['file','hidden'].includes(node.type)).map(node=>({
            label:node.getAttribute('aria-label') || node.labels?.[0]?.innerText || 'Draft wording',
            value:['checkbox','radio'].includes(node.type) ? (node.checked ? 'Selected' : 'Clear') : node.value,
        }));
    if (!editor && !fields.length) return;
    const drafts=app.interruptedDrafts.get(app.displayScope) || [];
    app.interruptedDrafts.set(app.displayScope,[{editor,fields,page:app.tab},...drafts]);
}

function interruptedDrafts() {
    const scope=draftScope(), drafts=app.interruptedDrafts.get(scope) || [];
    return drafts.map((draft,index)=>{
        const page=destination(draft.page);
        const dismiss=()=>{
            const remaining=(app.interruptedDrafts.get(scope) || []).filter(item=>item!==draft);
            if (remaining.length) app.interruptedDrafts.set(scope,remaining);
            else app.interruptedDrafts.delete(scope);
            render();
        };
        const title=`Unsaved work from ${page.label}${drafts.length>1 ? ` (${index+1} of ${drafts.length})` : ''}`;
        return h('details',{class:'ri-card ri-tight',open:index===0},h('summary',{},title),
            h('p',{class:'ri-help'},draft.editor ? 'Review and save the reopened draft when ready.' : 'Copy the wording you want back into its editor.'),
            draft.fields.map(field=>h('label',{class:'ri-field'},`Recovered ${field.label.toLowerCase()}`,
                h('textarea',{class:'ri-input',readOnly:true,rows:2,value:field.value}))),
            h('div',{class:'ri-row'},
                button(draft.editor ? 'Reopen draft' : `Open ${page.label}`,async()=>{
                    if (scope!==draftScope()) return;
                    if (await navigate(draft.page,{editor:draft.editor || undefined,focusPage:true}) && draft.editor) dismiss();
                }),
                button('Dismiss recovered draft',dismiss,{kind:'ghost'})));
    });
}

async function canLeaveDraft() {
    const routeKey = editorRoutes[app.tab];
    const route = app[routeKey];
    if (!route?.dirty && !app.root?.querySelector('[data-ri-dirty]')) return true;
    if (app.confirmingDraft) return false;
    const scope = draftScope();
    app.confirmingDraft=true;
    try {
        if (!await confirmBox('Discard your unsaved changes?') || draftScope()!==scope) return false;
        if (route?.dirty) app[routeKey] = routeKey==='route' ? {view:'set',name:route.name} : {view:'list'};
        return true;
    } finally { app.confirmingDraft=false; }
}

function panelLocation(view = captureView(app.body)) {
    const key=editorRoutes[app.tab];
    return {id:app.tab,view,lore:app.loreTarget,reply:app.replyTarget,anchor:app.anchor,
        ...(key && {editor:app[key]}),scope:draftScope()};
}

function applyLocation(location) {
    if (location.id!=='log') app.logClearReviewed=null;
    app.tab=location.id;
    app.loreTarget=location.lore ?? null;
    app.replyTarget=location.reply ?? null;
    app.anchor=location.anchor ?? '';
    const key=editorRoutes[location.id];
    if (key && location.editor) app[key]=location.editor;
    app.resetScroll=true;
    render();
}

function focusTarget(selector) {
    let control=selector && app.root.querySelector(selector);
    if (!control) return false;
    if (control.matches('details')) {
        control.open=true;
        control=control.querySelector(':scope > summary') || control;
    }
    for (let section=control.parentElement?.closest('details'); section; section=section.parentElement?.closest('details')) section.open=true;
    control.scrollIntoView({block:'center'});
    if (control.tabIndex<0) control.tabIndex=-1;
    control.focus({preventScroll:true});
    return true;
}

async function navigate(id, {group, lore, reply, anchor = '', external, editor, focusPage = false} = {}) {
    group=normalizeGroup(group);
    if (!destination(id) || !app.root) return false;
    const view=captureView(app.body), scope=draftScope();
    if (app.tab!==id || app.loreTarget!== (lore ?? null) || app.replyTarget!== (reply ?? null) ||
        anchor!==app.anchor || external || editor) {
        if (!await canLeaveDraft() || draftScope()!==scope) return false;
        const previous=panelLocation(view);
        if (external) {
            app.history=[];
            app.external={...external,scope};
        } else {
            app.history.push(previous);
            if (app.history.length>24) app.history.shift();
        }
        app.userNavigated=true;
        applyLocation({id,lore,reply,anchor,editor});
    }
    const focus=group ? `[data-ri-group="${group}"]`
        : focusPage ? '[data-ri-heading]' : `[data-ri-page="${id}"]`;
    if (!focusTarget(anchor)) app.root.querySelector(focus)?.focus({preventScroll:true});
    return true;
}

async function back() {
    const previous=app.history.at(-1);
    if (!previous) return app.external && setExpanded(false);
    if (previous.scope!==draftScope() || !await canLeaveDraft() || previous.scope!==draftScope()) return false;
    app.history.pop();
    applyLocation(previous);
    restoreView(app.body,previous.view,app.body.querySelector('[data-ri-heading]'));
    return true;
}

function toolFinder() {
    const results=h('div',{class:'ri-tool-results'});
    const announcement=h('p',{class:'ri-help',role:'status'});
    const search=textInput(app.toolQuery || '',value=>{
        app.toolQuery=value;
        update();
    },{type:'search','aria-label':'Find a tool',placeholder:'Search for a task'});
    search.id='ri-find-tool';
    function update() {
        const query=search.value.trim();
        const matches=findDestinations(query);
        announcement.textContent=query ? (matches.length ? `${matches.length} matching tools.` :
            'No matching tools. Browse the groups above or try a different word.') : 'Try “fix a fact” or “connection”.';
        results.replaceChildren(...matches.map(page=>{
            const unavailable=(!page.withoutChat && !isChatOpen()) || !!(page.family && !settings().enabled);
            return h('div',{class:'ri-tool-result'},
                button(`${page.label} · ${page.section}`,event=>page.family
                    ? openChatTool(page.family,event.currentTarget) : navigate(page.page || page.id,{anchor:page.anchor,focusPage:true}),{disabled:unavailable}),
                h('p',{class:'ri-help'},unavailable ? `${page.help} ${isChatOpen()?'Enable Roleplay Instructions first.':'Open a chat to use it.'}` : page.help));
        }));
    }
    update();
    return h('details',{class:'ri-tool-finder'},h('summary',{},'Find a tool'),search,announcement,results);
}

async function openChatTool(family,trigger) {
    const scope=draftScope(), view=captureView(app.body);
    const {openQuickActions}=await import('./quick-actions.js');
    if (scope!==draftScope() || !await canLeaveDraft() || scope!==draftScope()) return;
    const expanded=app.root.classList.contains('ri-expanded');
    const returnToDrawer=app.restoreDrawer;
    const drawer=document.querySelector('#extensions-settings-button > .drawer-toggle');
    if (expanded) await setExpanded(false,{handoff:true});
    const restoreDrawer=!!app.home.getClientRects().length;
    if (restoreDrawer) drawer?.click();
    openQuickActions(family,undefined,trigger,undefined,async()=>{
        if (scope!==draftScope()) return;
        if (expanded) { await setExpanded(true); app.restoreDrawer=returnToDrawer; }
        else if (restoreDrawer && !app.home.getClientRects().length) drawer?.click();
        restoreView(app.body,view,app.body.querySelector('[data-ri-heading]'));
    });
}

export const app = {
    tab: null,
    history: [],
    anchor: '',
    external: null,
    interruptedDrafts: new Map(),
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
    focusTarget,
    back,
    async openSetting(page, controlId, moduleScope) {
        const anchor=controlId ? `#${CSS.escape(controlId)}` : '';
        if (!await navigate(page,{anchor})) return false;
        if (moduleScope && app.moduleScope!==moduleScope) {
            app.moduleScope=moduleScope;
            render();
            focusTarget(anchor);
        }
        return true;
    },
    async openLoreEntry(entry, trigger) {
        const outside=!app.root?.contains(trigger || document.activeElement);
        const external=outside && {label:'Back to chat',returnFocus:trigger || document.activeElement};
        if (!await navigate('books',{lore:entry,external,focusPage:true})) return false;
        if (!app.root.classList.contains('ri-expanded')) await setExpanded(true);
        return true;
    },
    async openReplyTask(page,index,trigger,anchor = '') {
        const reply=guidedTarget(index);
        if (!reply) return false;
        const external={label:'Back to chat',returnFocus:trigger,
            fallbackFocus:()=>[...document.querySelectorAll(`#chat .mes[mesid="${index}"] .ri-guided-actions button`)]
                .find(control=>control.textContent===trigger?.textContent)};
        if (!await navigate(page,{reply,anchor,external,focusPage:true})) return false;
        await setExpanded(true);
        if (!focusTarget(anchor)) app.body.querySelector('[data-ri-heading]')?.focus({preventScroll:true});
        return true;
    },
    go(route) { app.route = route; app.resetScroll = true; render(); app.root?.scrollIntoView?.({ block: 'start' }); },
};

function resizeExpandedPanel() {
    const viewport=globalThis.visualViewport;
    const panel=document.getElementById('ri_overlay');
    if (!viewport || !panel) return;
    panel.style.setProperty('--ri-panel-height',`${viewport.height}px`);
    panel.style.setProperty('--ri-panel-top',`${viewport.offsetTop}px`);
    panel.style.setProperty('--ri-panel-left',`${viewport.offsetLeft}px`);
    panel.style.setProperty('--ri-panel-width',`${viewport.width}px`);
    requestAnimationFrame(()=>{
        const active=document.activeElement;
        if (panel.contains(active) && active.matches('input,textarea,select')) active.scrollIntoView({block:'nearest'});
    });
}

async function setExpanded(on, {handoff=false} = {}) {
    if (!app.root) return false;
    const external = !on && !handoff && app.external;
    if (external && !await canLeaveDraft()) return false;
    const st = settings();
    st.expanded = !!on;
    saveSettings();
    if (on) {
        const active = document.activeElement;
        app.returnFocus = app.external?.returnFocus || (active && active!==document.body && !app.root.contains(active) ? active : null);
        app.restoreDrawer = Boolean(app.home.getClientRects().length);
        let overlay = document.getElementById('ri_overlay');
        if (!overlay) { overlay = h('div', { id: 'ri_overlay', class: 'ri-overlay' }); document.body.appendChild(overlay); }
        overlay.appendChild(app.root);
        globalThis.visualViewport?.addEventListener('resize',resizeExpandedPanel);
        globalThis.visualViewport?.addEventListener('scroll',resizeExpandedPanel);
        resizeExpandedPanel();
        app.root.classList.add('ri-expanded');
        app.root.setAttribute('role','dialog');
        app.root.setAttribute('aria-modal','true');
        app.root.setAttribute('aria-label','Roleplay Instructions');
    } else {
        globalThis.visualViewport?.removeEventListener('resize',resizeExpandedPanel);
        globalThis.visualViewport?.removeEventListener('scroll',resizeExpandedPanel);
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
    const source = app.returnFocus?.isConnected ? app.returnFocus : external?.fallbackFocus?.();
    const returnFocus = !on && source?.getClientRects().length ? source : control;
    if (external && external.scope===draftScope() && returnFocus===source) {
        returnFocus.scrollIntoView({block:'nearest',inline:'nearest'});
    }
    returnFocus.focus({preventScroll:true});
    if (!on) {
        app.returnFocus=null;
        if (external) {
            app.external=null;
            app.history=[];
            app.replyTarget=null;
            app.loreTarget=null;
            app.anchor='';
            if (external.scope===draftScope()) external.resume?.();
            render();
        }
    }
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
    app.displayScope=draftScope();
    const st = settings();
    const expanded = app.root.classList.contains('ri-expanded');
    if (!destination(app.tab)) app.tab=startingPage(isChatOpen());
    const current=destination(app.tab);
    const group=groups.find(item=>item.id===current.group);
    (app.lastPages ||= {})[group.id] = app.tab;
    app.root.dataset.accent = st.accent && st.accent !== 'auto' ? st.accent : group.accent;
    // Keep the page from jumping while the panel is rebuilt.
    const unchanged=!app.resetScroll && app.body?.dataset.page===app.tab;
    const previous=unchanged && captureView(app.body);
    const finderOpen=app.root.querySelector('.ri-tool-finder')?.open;
    const finderFocused=app.root.querySelector('#ri-find-tool')===document.activeElement;
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
            toggle(st.enabled, (v) => { st.enabled = v; saveSettings(); render(); refreshUnderReplies();
                refreshComposerToolbar(); }, 'Turn the whole extension on or off'),
            expand));

    const categories = h('nav',{class:'ri-categories','aria-label':'Roleplay sections'},
        groups.map(item=>h('button',{type:'button',class:'ri-category','data-ri-group':item.id,
            'aria-current':item===group ? 'true' : null,onclick:()=>navigate(app.lastPages[item.id] || item.pages[0].id,{group:item.id})},item.label)));
    const pageButton = ({id,label}, choose = false) => h('button',{
        type:'button',class:`ri-tab ${id===app.tab ? 'ri-tab-on' : ''}`,
        'data-ri-page':id,'aria-current':id===app.tab ? 'page' : null,'aria-controls':'ri_panel_page',
        onclick:async()=>{ if (await navigate(id,{focusPage:choose}) && choose) closeChooser(); },
    },label,choose && id===app.tab ? ' ✓' : '');
    const groupedPages = (item, choose = false) => [...new Set(item.pages.map(page=>page.subgroup || item.label))].map(label=>
        h('div',{class:'ri-page-subgroup'},h('h3',{class:'ri-label'},label),
            item.pages.filter(page=>(page.subgroup || item.label)===label).map(page=>pageButton(page,choose))));
    const pages = groups.map(item=>h('nav',{class:'ri-tabs ri-page-nav','aria-label':`${item.label} pages`,hidden:item!==group},groupedPages(item)));
    const chooserTrigger=button(`Page: ${current.label}`,()=>{
        chooser.hidden=false;
        chooserTrigger.setAttribute('aria-expanded','true');
        chooser.querySelector('[aria-current="page"]')?.focus();
    });
    chooserTrigger.classList.add('ri-page-chooser-trigger');
    chooserTrigger.setAttribute('aria-expanded','false');
    chooserTrigger.setAttribute('aria-controls','ri-page-chooser');
    function closeChooser() {
        const surface=app.root.querySelector('#ri-page-chooser');
        if (surface) surface.hidden=true;
        const trigger=app.root.querySelector('.ri-page-chooser-trigger');
        trigger?.setAttribute('aria-expanded','false');
        trigger?.focus({preventScroll:true});
    }
    const chooser=h('div',{id:'ri-page-chooser',class:'ri-page-chooser',hidden:true,
        onclick:event=>{if(event.target===chooser) closeChooser();},
        onkeydown:event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeChooser();}}},
        h('nav',{'aria-label':'Choose a page',class:'ri-section'},button('Close pages',closeChooser),groupedPages(group,true)));
    const tabs = h('div',{class:'ri-panel-nav'},categories,pages,chooserTrigger,chooser);
    const finder=toolFinder();
    finder.open=!!finderOpen;
    const returnLabel=app.history.length ? 'Back' : app.external?.label;
    const heading=h('h2',{class:'ri-page-title',tabIndex:-1,'data-ri-heading':''},current.label);
    app.body = h('div',{id:'ri_panel_page',class:'ri-body','data-page':app.tab},
        h('div',{class:'ri-page-header'},
            h('div',{},h('div',{class:'ri-page-section'},group.label),heading),
            returnLabel && button(returnLabel,back,{kind:'ghost'})),
        finder,interruptedDrafts());
    if (!isChatOpen() && current.id==='v10') app.body.append(h('p',{class:'ri-help'},'Open a character chat to use Quick actions and chat settings.'));
    if (isChatOpen() && current.id==='state' && !app.userNavigated) app.body.append(h('p',{class:'ri-help'},
        'Tap Quick actions beside the message field for composer shortcuts.'));

    if (!st.enabled) app.body.appendChild(h('div', { class: 'ri-note ri-note-warn' }, 'The extension is off. Nothing is added, changed or checked until you turn it on at the top.'));
    if (app.missing.length) app.body.appendChild(h('div', { class: 'ri-note ri-note-warn' }, `This version of SillyTavern is missing something this extension needs (${app.missing.join(', ')}). Update SillyTavern or TauriTavern to 1.19 or later.`));
    if (!isChatOpen() && app.tab !== 'settings' && app.tab !== 'log') app.body.appendChild(h('div', { class: 'ri-note' },
        ['v10','display'].includes(app.tab) ? 'Open a chat to change its workflow, module activation and display settings.' : 'Open a character chat to use the '+current.label+' controls.'));

    if (app.tab === 'instructions') renderInstructions(app.body, app);
    else if (app.tab === 'events') renderEvents(app.body, app);
    else if (app.tab === 'style') renderStyle(app.body, app);
    else if (app.tab === 'goals') renderGoals(app.body, app);
    else if (app.tab === 'state') renderCurrentState(app.body, () => { refreshUnderReplies(); render(); });
    else if (app.tab === 'corrections') renderCorrections(app.body,app.replyTarget,app);
    else if (V10_PAGES.has(app.tab)) {
        renderV10(app.body,app,app.tab);
    }
    else if (app.tab === 'world') renderWorld(app.body, app);
    else if (app.tab === 'sent') renderSent(app.body, app);
    else if (app.tab === 'context') renderContext(app.body, app);
    else if (app.tab === 'log') renderLog(app.body, app);
    else renderSettings(app.body, app);

    app.root.append(head, tabs, app.body);
    if (previous) restoreView(app.body,previous);
    if (finderFocused && finder.open) finder.querySelector('input')?.focus({preventScroll:true});
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
        const presetChanged=what==='preset' && app.displayScope!==draftScope();
        if (what==='chat' || presetChanged) keepInterruptedDraft();
        if (what==='chat') {
            app.route={view:'sets'};
            app.eroute={view:'list'};
            app.sroute={view:'list'};
            app.wroute={view:'list'};
            app.cache={};
            app.history=[];
            app.external=null;
            app.loreTarget=app.replyTarget=null;
            app.anchor='';
            app.resetScroll=true;
            if (!app.userNavigated || !isChatOpen() && !destination(app.tab)?.withoutChat) app.tab=startingPage(isChatOpen());
        }
        refreshUnderReplies();
        // Setup controls save immediately and their handlers belong to the displayed preset.
        if (presetChanged) {
            const key=editorRoutes[app.tab];
            if (app[key]?.dirty) app[key]=key==='route' ? {view:'sets'} : {view:'list'};
            app.history=[];
            app.resetScroll=true;
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
