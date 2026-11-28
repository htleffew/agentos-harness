import { refreshComposerToolbar } from './quick-actions.js';
import { renderV10 } from './v10.js';
// The menu shell (DESIGN.md 3.1 to 3.3): a three-row header with the extension switch, Back, search and
// close; five top tabs; a nested row; and one page shape. It lives in the Extensions drawer and opens full screen.
import { h, clear, toggle, button, captureView, restoreView } from './dom.js';
import { settings, saveSettings } from '../store.js';
import { onChange } from '../engine.js';
import { renderInstructions } from './sets.js';
import { renderEvents, renderStyle } from './events.js';
import { renderSetList } from './set-list.js';
import { renderGoals } from './goals.js';
import { renderCurrentState } from './state.js';
import { renderWorld } from './world.js';
import { renderSent, refreshUnderReplies } from './sent.js';
import { renderSettings } from './settings.js';
import { renderContext } from './context-dashboard.js';
import { renderCorrections } from './corrections.js';
import { renderLog } from './log.js';
import { onLog } from '../log.js';
import { confirmBox, isChatOpen } from '../st.js';
import { buildTree, locate, pathName, startingPage } from './destinations.js';
import { registeredPages, renderRegistered } from './page-registry.js';
import { harvest, pageEntries, searchMenu } from './menu-search.js';
import { HELP_PAGE, setHelpTarget } from './help.js';
import { PROMPTS, promptStatus } from '../prompts.js';
import { executionScope } from '../execution.js';
import { guidedTarget } from '../guided-context.js';
import { activePreset, effectiveModules, enabledV10 } from '../v10.js';

const V10_PAGES = new Set(['v10','display','opening','books','facts','plots','portrayal','emotion','speakers','writing']);

const editorRoutes = {instructions:'route',events:'eroute',style:'sroute',world:'wroute'};
const rootRoutes = {route:{view:'sets'},eroute:{view:'list'},sroute:{view:'list'},wroute:{view:'list'}};
// The three set editors open from the one list on the page 'sets'. An editor page whose route is back at its
// root has nothing of its own to show, so the menu draws the list instead.
const SET_EDITORS = {instructions:'route',events:'eroute',style:'sroute'};
const atRoot = (key, route) => route?.view===rootRoutes[key].view && !route.dirty;
const draftScope=()=>JSON.stringify([executionScope(),activePreset()]);
// The old accent names still drive the colors of controls style.css draws.
const ACCENTS = {story:'green',direction:'cyan',reply:'cyan',review:'blue',setup:'sky'};

const tree = () => buildTree(registeredPages());
const destination = id => locate(tree(), id)?.page;

function loadShellStyles() {
    if (document.getElementById('ri-menu-shell')) return;
    const link = document.createElement('link');
    link.id = 'ri-menu-shell';
    link.rel = 'stylesheet';
    link.href = new URL('./menu-shell.css', import.meta.url).href;
    document.head.append(link);
}

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
        const page=destination(draft.page) || {label:'a page'};
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

const flat = text => String(text ?? '').replace(/\s+/g,' ').trim().toLowerCase();

/** Find a control by selector, or by the start of a section title or field label, open its folds and focus it. */
function landOn({anchor, match} = {}) {
    let control=anchor && app.root.querySelector(anchor);
    if (!control && match) {
        const wanted=flat(match);
        const caption=[...app.body.querySelectorAll('.ri-section-title, summary, h3, .ri-field > .ri-label, [role="switch"][aria-label], .ri-prompt-editor textarea[aria-label]')]
            .filter(node=>!node.closest('[data-ri-shell]'))
            .find(node=>flat(node.getAttribute('aria-label') || node.textContent).startsWith(wanted));
        if (caption?.matches('.ri-label')) control=caption.htmlFor && document.getElementById(caption.htmlFor)
            || caption.parentElement.querySelector('input:not([type="hidden"]), select, textarea, button, summary') || caption;
        else if (caption?.matches('.ri-section-title')) control=caption.closest('.ri-section') || caption;
        else control=caption;
    }
    if (!control) return false;
    if (control.matches('details')) {
        control.open=true;
        control=control.querySelector(':scope > summary') || control;
    }
    for (let section=control.parentElement?.closest('details'); section; section=section.parentElement?.closest('details')) section.open=true;
    control.scrollIntoView({block:'center'});
    if (control.tabIndex<0 && !control.matches('button, input, select, textarea, summary, a[href]')) control.tabIndex=-1;
    control.focus({preventScroll:true});
    control.classList.add('ri-shell-landed');
    setTimeout(()=>control.classList.remove('ri-shell-landed'),2000);
    return true;
}
const focusTarget = selector => landOn({anchor:selector});

/**
 * Go to a page. Tab taps pass via:'tab': they clear Back and become the reopening page. Everything else
 * is a cross-link, which keeps the way back.
 */
async function navigate(id, {lore, reply, anchor = '', match = '', external, editor, via = 'link'} = {}) {
    if (!destination(id) || !app.root) return false;
    const view=captureView(app.body), scope=draftScope();
    const moving=app.tab!==id || app.loreTarget!== (lore ?? null) || app.replyTarget!== (reply ?? null) ||
        anchor!==app.anchor || external || editor;
    if (moving || via==='tab') {
        if (!await canLeaveDraft() || draftScope()!==scope) return false;
        const previous=panelLocation(view);
        if (via==='tab') {
            app.history=[];
            app.external=null;
            app.arrivedByLink=false;
            settings().menuPage=id;
            saveSettings();
        } else if (external) {
            app.history=[];
            app.external={...external,scope};
            app.arrivedByLink=true;
        } else if (moving) {
            app.history.push(previous);
            if (app.history.length>24) app.history.shift();
            app.arrivedByLink=true;
        }
        app.userNavigated=true;
        app.searchOpen=false;
        applyLocation({id,lore,reply,anchor,editor});
    }
    if (!landOn({anchor,match})) {
        app.root.querySelector(via==='tab' ? '[data-ri-nested][aria-current="page"]' : '[data-ri-heading]')?.focus({preventScroll:true});
    }
    return true;
}

async function back() {
    const previous=app.history.at(-1);
    if (!previous) return app.external && setExpanded(false);
    if (previous.scope!==draftScope() || !await canLeaveDraft() || previous.scope!==draftScope()) return false;
    app.history.pop();
    if (!app.history.length && !app.external) app.arrivedByLink=false;
    applyLocation(previous);
    restoreView(app.body,previous.view,app.body.querySelector('[data-ri-heading]'));
    return true;
}

const initialPage = () => {
    const saved=settings().menuPage;
    return saved && destination(saved) ? saved : startingPage(isChatOpen());
};

/** Leave a cross-linked page behind: the menu reopens on the last page reached through the tabs. */
function reopenOnTabPage() {
    if (!app.arrivedByLink) return;
    app.arrivedByLink=false;
    app.history=[];
    app.external=null;
    app.loreTarget=app.replyTarget=null;
    app.anchor='';
    app.tab=initialPage();
    app.resetScroll=true;
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
    cache: {},                 // World Info book name -> data, for counts on the cards
    root: null,
    body: null,
    home: null,
    missing: [],
    searchOpen: false,
    searchQuery: '',
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
            fallbackFocus:()=>document.querySelector(`#chat .mes[mesid="${index}"] .extraMesButtonsHint`)};
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

function expandControl(control, on) {
    control.setAttribute('aria-label', on ? 'Close full screen' : 'Full screen');
    control.title = on ? 'Go back to the small panel' : 'Show this menu full screen';
    control.querySelector('i').className = `fa-solid ${on ? 'fa-xmark' : 'fa-expand'}`;
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
    expandControl(control, on);
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
        }
        if (!handoff) reopenOnTabPage();
        render();
    }
    return true;
}

function expandedKeyboard(event) {
    if (event.defaultPrevented) return;
    if (event.key==='Escape' && app.searchOpen) {
        event.preventDefault();event.stopPropagation();
        closeSearch();
        return;
    }
    if (!app.root.classList.contains('ri-expanded')) return;
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

// ---------- Page content ----------

function renderPage(id, body, view) {
    if (renderRegistered(id, body, view)) return;
    if (id === 'sets') renderSetList(body, view);
    else if (id === 'instructions') renderInstructions(body, view);
    else if (id === 'events') renderEvents(body, view);
    else if (id === 'style') renderStyle(body, view);
    else if (id === 'goals') renderGoals(body, view);
    else if (id === 'state') renderCurrentState(body, () => { refreshUnderReplies(); view.render(); });
    else if (id === 'corrections') renderCorrections(body,view.replyTarget,view);
    else if (V10_PAGES.has(id)) renderV10(body,view,id);
    else if (id === 'world') renderWorld(body, view);
    else if (id === 'sent') renderSent(body, view);
    else if (id === 'context') renderContext(body, view);
    else if (id === 'log') renderLog(body, view);
    else if (id === 'settings') renderSettings(body, view);
    else {
        const page = destination(id);
        if (page?.bridge) renderBridge(body, page, view);
    }
}

function renderBridge(body, page, view) {
    if (page.id==='bridge-prompts') return renderPromptsBridge(body, view);
    const target=page.bridge;
    body.append(h('div',{class:'ri-note ri-shell-bridge'},h('p',{},target.text),
        button(`Open ${pathName(tree(),target.page)}`,()=>view.openPage(target.page,{anchor:target.anchor || '',match:target.match || ''}))));
}

// ---------- Search ----------

// Which pages show a control depends on the story workflow too, so the index follows it as well as the chat and preset.
const indexScope=()=>JSON.stringify([draftScope(),enabledV10()]);
const index = { scope:'', pages:new Map(), running:null };

function recordHarvest(id, body) {
    if (index.scope!==indexScope()) { index.scope=indexScope(); index.pages.clear(); }
    index.pages.set(id, harvest(body, id));
}

/** Read the sections and settings of every page once per chat and preset, drawing each into a detached node. */
function harvestAll(done) {
    if (index.scope!==indexScope()) { index.scope=indexScope(); index.pages.clear(); }
    if (index.running) return index.running.then(done);
    const ids=tree().flatMap(top=>top.nested.flatMap(nested=>nested.pages.map(page=>page.id)))
        .filter(id=>!index.pages.has(id) && !id.startsWith('bridge-') && !destination(id)?.sub);
    const quiet=async()=>false;
    index.running=(async()=>{
        for (const id of ids) {
            const body=h('div');
            const view=Object.assign(Object.create(app),{tab:id,body,render(){},go(){},openPage:quiet,openSetting:quiet,
                route:{...rootRoutes.route},eroute:{...rootRoutes.eroute},sroute:{...rootRoutes.sroute},wroute:{...rootRoutes.wroute},
                loreTarget:null,replyTarget:null,anchor:'',history:[]});
            try { renderPage(id, body, view); } catch { /* a page that cannot draw here is found by its name alone */ }
            if (index.scope===indexScope()) index.pages.set(id, harvest(body, id));
            await new Promise(resolve=>setTimeout(resolve,0));
        }
        index.running=null;
    })();
    return index.running.then(done);
}

function searchEntries() {
    const current=tree();
    return [...pageEntries(current), ...[...index.pages.values()].flat().filter(entry=>locate(current,entry.page))];
}

function closeSearch() {
    app.searchOpen=false;
    render();
    app.root.querySelector('[data-ri-search]')?.focus({preventScroll:true});
}

function searchPanel() {
    const results=h('ul',{class:'ri-shell-results','aria-label':'Search results'});
    const status=h('p',{class:'ri-help',role:'status'});
    const input=h('input',{type:'search',class:'ri-input ri-shell-search-input',id:'ri-menu-search',value:app.searchQuery,
        'aria-label':'Search pages, sections and settings',placeholder:'Search the menu',autocomplete:'off',
        oninput:()=>{ app.searchQuery=input.value; update(); refreshIndex(); }});
    // A page drawn after the chat or preset changed clears the index; read the missing pages again on the next keystroke.
    const refreshIndex=()=>{ if (index.scope!==indexScope() || tree().some(top=>top.nested.some(nested=>nested.pages.some(page=>!page.id.startsWith('bridge-') && !page.sub && !index.pages.has(page.id))))) harvestAll(()=>{ if (app.searchOpen && input.isConnected) update(); }); };
    const current=tree();
    const pathOf=id=>{
        const found=locate(current,id);
        if (!found) return id;
        return found.nested.pages[0].id===id ? `${found.top.label} › ${found.nested.label}`
            : `${found.top.label} › ${found.nested.label} › ${found.page.label}`;
    };
    function update() {
        const query=input.value.trim();
        const found=query ? searchMenu(searchEntries(),query,pathOf) : [];
        status.textContent=!query ? 'Try “Author’s Note”, “pronouns” or “budget”.'
            : found.length ? `${found.length} ${found.length===1 ? 'result' : 'results'}.` : 'No match. Try another word.';
        results.replaceChildren(...found.map(item=>h('li',{},h('button',{type:'button',class:'ri-shell-result',
            onclick:()=>navigate(item.page,{anchor:item.anchor || '',match:item.anchor ? '' : item.match || '',focusPage:true})},
            h('span',{class:'ri-shell-result-path'},item.path),
            h('span',{class:'ri-shell-result-label'},item.kind==='page' ? item.label : `${item.label}`),
            item.synonym && h('span',{class:'ri-shell-result-note'},`SillyTavern: ${item.synonym}`),
            item.kind!=='page' && h('span',{class:'ri-shell-result-kind'},item.kind)))));
    }
    update();
    harvestAll(()=>{ if (app.searchOpen && input.isConnected) update(); });
    return h('div',{class:'ri-shell-search',role:'search','data-ri-shell':''},
        h('div',{class:'ri-shell-search-row'},input,button('Close search',closeSearch,{kind:'ghost'})),status,results);
}

// ---------- Prompts ----------

const promptIdByLabel = label => Object.entries(PROMPTS).find(([,definition])=>definition.label===label)?.[0];

function pagePrompts(body) {
    return [...body.querySelectorAll('.ri-prompt-editor textarea[aria-label]')]
        .filter(node=>!node.closest('[data-ri-shell]'))
        .map(node=>({label:node.getAttribute('aria-label'),id:promptIdByLabel(node.getAttribute('aria-label'))}));
}

const customizedCount = prompts => prompts.filter(item=>item.id && promptStatus(item.id).customized).length;

function promptsFoot(pageId, body) {
    const prompts=pagePrompts(body);
    if (!prompts.length) return null;
    const label=`Prompts for this page (${customizedCount(prompts)} customized)`;
    const target=tree().find(top=>top.id==='setup').nested.find(nested=>nested.id==='prompts').pages[0];
    return h('div',{class:'ri-shell-foot','data-ri-shell':''},
        h('button',{type:'button',class:'ri-shell-foot-link',onclick:()=>{
            app.promptsFilter={page:pageId,prompts};
            navigate(target.id,{focusPage:true});
        }},h('i',{class:'fa-solid fa-terminal','aria-hidden':'true'}),label));
}

function renderPromptsBridge(body, view) {
    const filter=app.promptsFilter;
    const current=tree();
    const pageLabel=id=>pathName(current,id);
    const row=(page,item)=>h('li',{class:'ri-shell-prompt'},
        h('span',{},item.label),
        h('span',{class:'ri-chip'},item.id && promptStatus(item.id).customized ? 'Customized' : 'Default'),
        button('Edit beside its feature',()=>view.openPage(page,{anchor:`.ri-prompt-editor textarea[aria-label="${CSS.escape(item.label)}"]`})));
    if (filter && locate(current,filter.page)) {
        body.append(h('div',{class:'ri-section'},
            h('div',{class:'ri-section-title'},`Prompts for ${pageLabel(filter.page)}`),
            h('ul',{class:'ri-shell-prompts'},filter.prompts.map(item=>row(filter.page,item))),
            button('Show every page',()=>{ app.promptsFilter=null; view.render(); },{kind:'ghost'})));
        return;
    }
    const list=h('div',{},h('p',{class:'ri-help'},'Reading every page for its prompts.'));
    const draw=()=>{
        const byPage=[...index.pages.entries()].map(([id,entries])=>[id,entries.filter(entry=>entry.kind==='prompt')])
            .filter(([id,entries])=>entries.length && locate(tree(),id));
        list.replaceChildren(...byPage.map(([id,entries])=>h('div',{class:'ri-section'},
            h('div',{class:'ri-section-title'},pageLabel(id)),
            h('ul',{class:'ri-shell-prompts'},entries.map(entry=>row(id,{label:entry.label,id:promptIdByLabel(entry.label)}))))));
        if (!byPage.length) list.replaceChildren(h('p',{class:'ri-help'},'No page lists a prompt in this chat.'));
    };
    body.append(h('p',{class:'ri-help'},'Every prompt also stays editable beside the feature that uses it.'),list,
        h('div',{class:'ri-row'},button(`Open ${pathName(current,'v10')}, Advanced prompts`,()=>view.openPage('v10',{anchor:'#ri-planning-prompts'}),{kind:'ghost'})));
    harvestAll(()=>{ if (list.isConnected) draw(); });
}

// ---------- Page header, status and breadcrumbs ----------

const MODULE_OF = {facts:'state',plots:'plots',portrayal:'knowledge',emotion:'emotions',speakers:'colors',writing:'style'};

function statusFor(page, nested) {
    const st=settings();
    if (!st.enabled) return {text:'OFF',tone:'off'};
    if (typeof page.status==='function') {
        try { const text=page.status(); if (text) return {text:String(text).toUpperCase()}; } catch { /* fall through */ }
    }
    if (page.bridge) return {text:'LINK',tone:'off'};
    if (!page.withoutChat && !isChatOpen()) return {text:'NO CHAT',tone:'off'};
    if (!isChatOpen()) return {text:'ON'};
    const modules=effectiveModules();
    if (nested.id==='features') {
        const on=Object.values(modules).filter(Boolean).length;
        return {text:`${on} ON`};
    }
    const module=MODULE_OF[page.id];
    if (module && V10_PAGES.has(page.id) && page.id!=='writing' && !enabledV10()) return {text:'OFF',tone:'off'};
    if (module && enabledV10()) return modules[module] ? {text:'ON'} : {text:'OFF',tone:'off'};
    return {text:'ON'};
}

// In-page back buttons ("‹ Back to Dragon set", "Back to sets") become one breadcrumb row.
const IN_PAGE_BACK = /^\s*‹?\s*Back to\s+(.+?)\s*$/i;

function routeDepth() {
    const key=editorRoutes[app.tab];
    const route=key && app[key];
    if (app.tab==='instructions' && route?.view==='edit') return route.ui?.sheet ? 3 : 2;
    return 1;
}

function currentCrumb(after) {
    const route=app.tab==='instructions' && app.route;
    if (route?.view==='edit') return route.ui?.sheet ? 'Write versions with AI' : route.draft?.name || 'New instruction';
    const headings=[...app.body.querySelectorAll('.ri-h2, h3')].filter(node=>!node.closest('[data-ri-shell]') && !node.hidden &&
        (after.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING));
    return headings[0]?.textContent.trim() || 'Edit';
}

function breadcrumbs(slot, nested) {
    const backs=[...app.body.querySelectorAll('button')].filter(node=>!node.closest('[data-ri-shell]') && IN_PAGE_BACK.test(node.textContent));
    if (!backs.length) return;
    for (const node of backs) {
        node.hidden=true;
        node.dataset.riReplacedBack='';
        const row=node.parentElement;
        if (row?.matches('.ri-row') && ![...row.children].some(child=>!child.hidden)) row.hidden=true;
    }
    const up=backs[0];
    const parent=up.textContent.match(IN_PAGE_BACK)[1].replace(/^the\s+/i,'');
    const parentLabel=parent.charAt(0).toUpperCase()+parent.slice(1);
    const depth=routeDepth();
    const toRoot=async()=>{
        if (depth<2) { up.click(); return; }
        if (!await canLeaveDraft()) return;
        const key=editorRoutes[app.tab];
        if (key) app[key]={...rootRoutes[key]};
        app.resetScroll=true;
        render();
    };
    const items=[{label:nested.label,go:toRoot}];
    if (depth>=2) items.push({label:parentLabel,go:()=>up.click()});
    items.push({label:currentCrumb(up)});
    slot.hidden=false;
    slot.replaceChildren(h('ol',{},items.map((item,index)=>h('li',{},
        index>0 && h('span',{class:'ri-shell-crumb-sep','aria-hidden':'true'},'›'),
        item.go ? h('button',{type:'button',class:'ri-shell-crumb',onclick:item.go},item.label)
            : h('span',{class:'ri-shell-crumb','aria-current':'page'},item.label)))));
}

function backLabel() {
    const previous=app.history.at(-1);
    if (previous) return `Back to ${pathName(tree(),previous.id) || 'the last page'}`;
    return app.external?.label || '';
}

// ---------- The shell ----------

/** A tab tap reads the tree at tap time, so a page registered after the last draw is found. */
function openTab(topId, nestedId) {
    const top=tree().find(item=>item.id===topId);
    const nested=nestedId ? top?.nested.find(item=>item.id===nestedId) : top?.nested[0];
    return nested ? navigate(nested.pages[0].id,{via:'tab'}) : false;
}

function arrowKeys(event) {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    const items=[...event.currentTarget.querySelectorAll('button')];
    const at=items.indexOf(document.activeElement);
    if (at<0) return;
    event.preventDefault();
    const next=event.key==='Home' ? 0 : event.key==='End' ? items.length-1
        : (at+(event.key==='ArrowRight' ? 1 : -1)+items.length)%items.length;
    items[next].focus();
}

function keepActiveInView(row) {
    const active=row.querySelector('[aria-current="page"]');
    if (!active || row.scrollWidth<=row.clientWidth) return;
    const left=active.offsetLeft-row.offsetLeft, right=left+active.offsetWidth;
    if (left<row.scrollLeft) row.scrollLeft=Math.max(0,left-8);
    else if (right>row.scrollLeft+row.clientWidth) row.scrollLeft=right-row.clientWidth+8;
}

export function render() {
    if (!app.root) return;
    app.chatPending=false;
    held.page=false;
    app.displayScope=draftScope();
    const st = settings();
    const expanded = app.root.classList.contains('ri-expanded');
    const current=tree();
    if (!locate(current,app.tab)) app.tab=initialPage();
    if (SET_EDITORS[app.tab] && atRoot(SET_EDITORS[app.tab],app[SET_EDITORS[app.tab]])) app.tab='sets';
    // Coming back to the list leaves no half-open editor behind; a saved notice on a root route stays for the list to show.
    if (app.tab==='sets') for (const key of Object.values(SET_EDITORS)) if (app[key].view!==rootRoutes[key].view) app[key]={...rootRoutes[key]};
    const {top, nested, page}=locate(current,app.tab);
    app.root.dataset.accent = ACCENTS[top.family];
    app.root.dataset.family = top.family;
    // Keep the page from jumping while the panel is rebuilt.
    const unchanged=!app.resetScroll && app.body?.dataset.page===app.tab;
    const previous=unchanged && captureView(app.body);
    const searchFocused=app.root.querySelector('#ri-menu-search')===document.activeElement;
    app.resetScroll = false;
    app.root.style.minHeight = `${app.root.offsetHeight}px`;
    clear(app.root);

    const expand=h('button',{type:'button',class:'ri-shell-icon','data-ri-expand':''},h('i',{'aria-hidden':'true'}));
    expandControl(expand,expanded);
    expand.addEventListener('click',()=>setExpanded(!app.root.classList.contains('ri-expanded')));
    const searchButton=h('button',{type:'button',class:'ri-shell-icon','data-ri-search':'','aria-label':'Search the menu',
        title:'Search pages, sections and settings','aria-expanded':String(!!app.searchOpen),'aria-controls':'ri-menu-search',
        onclick:()=>{ app.searchOpen=!app.searchOpen; render(); if (app.searchOpen) app.root.querySelector('#ri-menu-search')?.focus(); }},
    h('i',{class:'fa-solid fa-magnifying-glass','aria-hidden':'true'}));
    const returnLabel=backLabel();
    const backControl=returnLabel && h('button',{type:'button',class:'ri-shell-back','data-ri-back':'','aria-label':returnLabel,title:returnLabel,onclick:back},
        h('i',{class:'fa-solid fa-chevron-left','aria-hidden':'true'}),h('span',{},returnLabel));
    const rowOne=h('div',{class:'ri-shell-row ri-shell-row-one'},
        h('div',{class:'ri-shell-switch'},
            toggle(st.enabled,(v)=>{ st.enabled=v; saveSettings(); render(); refreshUnderReplies(); refreshComposerToolbar(); },'Turn the whole extension on or off'),
            h('span',{class:'ri-shell-onoff','aria-hidden':'true'},st.enabled ? 'On' : 'Off')),
        backControl || h('div',{class:'ri-shell-title'},'Roleplay Instructions'),
        h('div',{class:'ri-shell-tools'},searchButton,expand));
    const topRow=h('nav',{class:'ri-shell-row ri-shell-tabs','aria-label':'Menu',onkeydown:arrowKeys},current.map(item=>
        h('button',{type:'button',class:'ri-shell-tab','data-ri-tab':item.id,'data-family':item.family,'aria-label':item.label,
            'aria-current':item===top ? 'page' : null,
            onclick:()=>openTab(item.id)},
        h('i',{class:`fa-solid ${item.icon}`,'aria-hidden':'true'}),h('span',{'aria-hidden':'true'},item.short))));
    const nestedRow=h('nav',{class:'ri-shell-row ri-shell-nested','aria-label':`${top.label} pages`,onkeydown:arrowKeys},top.nested.map(item=>
        h('button',{type:'button',class:'ri-shell-subtab','data-ri-nested':item.id,
            'aria-current':item===nested ? 'page' : null,
            onclick:()=>openTab(top.id,item.id)},
        h('i',{class:`fa-solid ${item.icon}`,'aria-hidden':'true'}),h('span',{},item.label))));
    const head=h('header',{class:'ri-shell-head','data-ri-shell':''},rowOne,topRow,nestedRow);

    // Page anatomy (DESIGN.md 3.3): icon, title and status pill; one sentence of help; then the page.
    const pill=statusFor(page,nested);
    const heading=h('h2',{class:'ri-page-title',tabIndex:-1,'data-ri-heading':''},nested.label);
    const listed=nested.pages.filter(item=>!item.sub), activeId=page.sub ? listed[0]?.id : page.id;
    const sections=listed.length>1 && h('nav',{class:'ri-shell-sections','aria-label':`Sections of ${nested.label}`,onkeydown:arrowKeys},
        listed.map(item=>h('button',{type:'button',class:'ri-shell-section','data-ri-page':item.id,
            'aria-current':item.id===activeId ? 'page' : null,onclick:()=>navigate(item.id,{via:'tab'})},item.label)));
    const crumbs=h('nav',{class:'ri-shell-crumbs','aria-label':'Breadcrumb',hidden:true});
    app.body = h('div',{id:'ri_panel_page',class:'ri-body','data-page':app.tab},
        h('div',{class:'ri-shell-page','data-ri-shell':''},
            h('div',{class:'ri-shell-pagehead'},
                h('i',{class:`fa-solid ${nested.icon} ri-shell-pageicon`,'aria-hidden':'true'}),heading,
                h('span',{class:`ri-shell-pill${pill.tone ? ` ri-shell-pill-${pill.tone}` : ''}`},pill.text),
                // B58: a Help link in every page header opens this page's entry in Setup, Help.
                page.id!==HELP_PAGE && h('button',{type:'button',class:'ri-shell-helplink','data-ri-help-link':'',
                    'aria-label':`Help for ${pathName(current,page.id)}`,onclick:()=>{ setHelpTarget(page.id); navigate(HELP_PAGE); }},
                h('i',{class:'fa-solid fa-circle-question','aria-hidden':'true'}),h('span',{},'Help'))),
            h('p',{class:'ri-shell-help'},page.help && nested.pages.length>1 ? page.help : nested.help || page.help),
            sections,crumbs),
        interruptedDrafts());

    if (!st.enabled) app.body.appendChild(h('div', { class: 'ri-note ri-note-warn' }, 'The extension is off. Nothing is added, changed or checked until you turn it on at the top.'));
    if (app.missing.length) app.body.appendChild(h('div', { class: 'ri-note ri-note-warn' }, `This version of SillyTavern is missing something this extension needs (${app.missing.join(', ')}). Update SillyTavern or TauriTavern to 1.19 or later.`));
    if (!isChatOpen() && !page.withoutChat) app.body.appendChild(h('div', { class: 'ri-note' },
        ['v10','display'].includes(app.tab) ? 'Open a chat to change its workflow, feature switches and display settings.' : 'Open a character chat to use the '+page.label+' controls.'));

    renderPage(app.tab, app.body, app);
    breadcrumbs(crumbs, nested);
    const foot=promptsFoot(app.tab, app.body);
    if (foot) app.body.append(foot);
    if (!page.sub) recordHarvest(app.tab, app.body);

    app.root.append(head);
    if (app.searchOpen) app.root.append(searchPanel());
    app.root.append(app.body);
    if (previous) {
        restoreView(app.body,previous);
        // A page that draws its body once it is in the document (Setup, Presets draws its stack in a microtask) is still
        // short here, so the scroll above is clamped and a background redraw threw her to the top. Put it back once drawn.
        const body=app.body;
        queueMicrotask(()=>{ if (app.body===body && body.isConnected && body.scrollTop!==previous.scroll) body.scrollTop=previous.scroll; });
    }
    if (searchFocused && app.searchOpen) app.root.querySelector('#ri-menu-search')?.focus({preventScroll:true});
    requestAnimationFrame(() => {
        if (!app.root) return;
        app.root.style.minHeight = '';
        keepActiveInView(nestedRow);
        if (sections) keepActiveInView(sections);
    });
}

// ---------- Background redraws (B63) ----------
// A background update (capture, upkeep, any job that ends while the menu is open) redraws the open page and the trays
// under the replies. Drawn while her finger was down, it replaced the control under it: the tap went to the new copy or
// nowhere (a mouse click lands on the parent both copies share), and on her phone a tap could be lost. The update now
// waits until every pointer is up and the click it makes has run; the page redraw also waits while she types in a field
// of the menu. Then it is applied once, keeping the scroll, open folds and focus (captureView).
const RELEASE_MS = 150;     // a tap's click follows its release within this time
const STUCK_MS = 5000;      // a press with no release seen (the pointer left the window) stops holding after this
const held = { pointers: new Map(), releasedAt: -Infinity, page: false, trays: false, timer: 0, watching: false };

function pressing() {
    const now = performance.now();
    for (const [id, since] of held.pointers) if (now - since > STUCK_MS) held.pointers.delete(id);
    return held.pointers.size > 0 || now - held.releasedAt < RELEASE_MS;
}

/** A field she types or picks in has focus inside the menu (a switch or button with focus does not hold a redraw). */
function typingInMenu() {
    const active = globalThis.document?.activeElement;
    if (!active || !app.root?.contains(active)) return false;
    if (active.isContentEditable || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT') return true;
    return active.tagName === 'INPUT' && !/^(button|checkbox|radio|range|reset|submit|color|file|image)$/i.test(active.type || '');
}

function watchPresses(flush) {
    const doc = globalThis.document;
    if (!doc || held.watching) return;
    held.watching = true;
    const soon = ms => { clearTimeout(held.timer); held.timer = setTimeout(flush, ms); };
    doc.addEventListener('pointerdown', event => { held.pointers.set(event.pointerId, performance.now()); }, true);
    const release = event => {
        if (!held.pointers.delete(event.pointerId)) return;
        held.releasedAt = performance.now();
        soon(RELEASE_MS);
    };
    doc.addEventListener('pointerup', release, true);
    doc.addEventListener('pointercancel', release, true);
    // The click a press makes has run once its listeners return; the held update follows in the next task.
    doc.addEventListener('click', () => { if (!held.pointers.size) { held.releasedAt = -Infinity; soon(0); } }, true);
    doc.addEventListener('focusout', () => soon(0), true);
}

export function mount(missing) {
    app.missing = missing || [];
    loadShellStyles();
    const tryMount = () => {
        const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
        if (!host) { setTimeout(tryMount, 400); return; }
        if (document.getElementById('ri_drawer')) return;
        app.root = h('div', { id: 'ri_root', class: 'ri-root ri-shell' });
        app.root.addEventListener('keydown',expandedKeyboard);
        app.home = h('div', { class: 'inline-drawer-content ri-home' }, app.root);
        const toggleHeader = h('div', { class: 'inline-drawer-toggle inline-drawer-header' },
            h('b', {}, 'Roleplay Instructions'),
            h('div', { class: 'inline-drawer-icon fa-solid fa-circle-chevron-down down' }));
        // Reopening the drawer lands on the last page reached through the tabs.
        toggleHeader.addEventListener('click',()=>{ if (app.arrivedByLink && !app.home.getClientRects().length) { reopenOnTabPage(); render(); } });
        const drawer = h('div', { id: 'ri_drawer', class: 'ri-drawer' }, h('div', { class: 'inline-drawer' }, toggleHeader, app.home));
        host.appendChild(drawer);
        render();
    };
    tryMount();

    let timer = null;
    const focusInField = () => app.root?.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '');
    // A background update redraws the open page and the trays under the replies once her finger is up (B63).
    const flush = () => {
        clearTimeout(held.timer);
        if (!held.page && !held.trays) return;
        if (pressing()) { held.timer = setTimeout(flush, 100); return; }
        if (held.trays) { held.trays = false; refreshUnderReplies(); }
        if (!held.page || !app.chatPending && typingInMenu()) return;
        held.page = false;
        if (app.chatPending || !app.root?.querySelector('[data-ri-dirty]') && !(V10_PAGES.has(app.tab) && focusInField())) render();
    };
    watchPresses(flush);
    const redrawSoon = () => { clearTimeout(timer); timer = setTimeout(() => { held.page = true; flush(); }, 80); };
    onLog(() => { if (app.tab === 'log') redrawSoon(); });
    onChange((what) => {
        const presetChanged=what==='preset' && app.displayScope!==draftScope();
        if (what==='chat' || presetChanged) keepInterruptedDraft();
        // A chat change must redraw even when a later update replaces its timer before it fires.
        if (what==='chat') app.chatPending=true;
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
            app.promptsFilter=null;
            // The menu stays on the page it shows, a cross-linked page included, and redraws it for the new
            // chat. The reopen rule keeps arrivedByLink, so closing and opening the menu still returns to the tab page.
            if (!settings().menuPage && !app.userNavigated) app.tab=initialPage();
        }
        held.trays = true;
        flush();
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
        if (what !== 'chat' && app.searchOpen && app.root?.querySelector('#ri-menu-search')===document.activeElement) return;
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
        redrawSoon();
    });
}
