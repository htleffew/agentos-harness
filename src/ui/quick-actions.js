import { ctx, heldGroupContinuationComposer, isChatOpen, isGenerating, KEY, on } from '../st.js';
import { saveChatState, settings } from '../store.js';
import { memoryOnly } from '../components.js';
import { app } from './panel.js';
import { taskLabels } from './destinations.js';
import { button, field, h, select, textArea, textInput, captureView, restoreView } from './dom.js';
import { executionDetails } from './execution.js';
import { executionPreview } from '../execution.js';
import { impersonationInspector } from './impersonation.js';
import { listQuickActions, loadQuickActionSources, quickActionOwner, readQuickAction, resolveQuickAction, rollQuickActionDie } from '../quick-actions.js';
import { renderQuickActionLibrary } from './quick-action-library.js';
import { cancelGuidedTurn, guidedPreview, guidedTarget, guidedVersions, runGuidedTurn, selectGuidedVersion, undoGuidedContinuation } from '../guided-turns.js';
import { freshHistoryCapability } from '../guided-context.js';
import { armFreshStart, cancelQueued, freshRemaining, moveQuickPin, pinQuickAction, queueCapability,
    queueDirections, queuedRetry, quickChat, quickChatIdentity, rememberQuickActions, restoreHeldRetryDraft, retryQueuedReply, stopFreshStart } from '../quick-action-chat.js';

const families = {
    steer: { title:'Steer the next reply', primary:'Queue with my next message', add:'Add nudge' },
    swipe: { title:taskLabels.alternate, primary:taskLabels.generateAlternate, add:'Add swipe option' },
    continue: { title:taskLabels.continue, primary:taskLabels.continue, add:'Add continuation option' },
    draft: { title:'Draft my reply', primary:'Generate my draft', add:'Add player draft option' },
};
const sessions = new Map();
let session;
let overlay;
let opener;
let composerAtOpen;
let focusComposer;
let returnToPanel;
let knownChat;
let composer;
const composerDrafts = new Map();
const isolated = new Set();
const actionRow = (...children) => h('div', {class:'ri-quick-row'}, children);
const info = value => h('p', {class:'ri-help'}, value);
const status = value => h('p', {class:'ri-quick-status', role:'status'}, value);
const unit = family => ({family, cues:[], direction:'', mode:'', freshStart:'', visibility:'default', required:false, twist:'',
    repeatOrders:false, keepManualEdits:false, rerollDice:false});
const editorFor = family => session.editors[family] ||= unit(family);
const openComposer = () => document.querySelector('#send_textarea');

function snapshot(input) {
    return input && {value:input.value, start:input.selectionStart, end:input.selectionEnd, direction:input.selectionDirection};
}

function restoreComposer(value) {
    const input = openComposer();
    if (!input || !value) return;
    if (input.value !== value.value) {
        input.value = value.value;
        input.dispatchEvent(new Event('input', {bubbles:true}));
    }
    input.setSelectionRange(value.start ?? input.value.length, value.end ?? input.value.length, value.direction || 'none');
}

function resizeSheet() {
    const viewport = globalThis.visualViewport;
    if (!overlay || !viewport) return;
    overlay.style.setProperty('--ri-quick-height', `${viewport.height}px`);
    overlay.style.setProperty('--ri-quick-top', `${viewport.offsetTop}px`);
    overlay.style.setProperty('--ri-quick-left', `${viewport.offsetLeft}px`);
    overlay.style.setProperty('--ri-quick-width', `${viewport.width}px`);
    requestAnimationFrame(()=>{
        const active=document.activeElement;
        if (overlay?.contains(active) && active.matches('input,textarea,select')) active.scrollIntoView({block:'nearest'});
    });
}

function releaseBackground() {
    for (const node of isolated) node.inert=false;
    isolated.clear();
}

function isolateBackground(preserveComposer=false) {
    const input=preserveComposer ? openComposer() : null;
    releaseBackground();
    const isolate=(parent)=>{
        for (const node of parent.children) {
            if (node===overlay || node===input || node.inert) continue;
            if (input && node.contains(input)) { isolate(node); continue; }
            node.inert=true;
            isolated.add(node);
        }
    };
    isolate(document.body);
}

function enterSheet() {
    isolateBackground();
}

function closeSheet({restore = true} = {}) {
    if (!overlay) return;
    const resume=returnToPanel;
    returnToPanel=null;
    overlay.removeEventListener('focusin',enterSheet);
    overlay.remove();
    releaseBackground();
    overlay = null;
    document.removeEventListener('keydown',tabInSheet,true);
    globalThis.visualViewport?.removeEventListener('resize', resizeSheet);
    globalThis.visualViewport?.removeEventListener('scroll', resizeSheet);
    if (restore && knownChat === quickChatIdentity()) {
        if (focusComposer && composerAtOpen) {
            openComposer()?.focus({preventScroll:true});
            openComposer()?.setSelectionRange(composerAtOpen.start, composerAtOpen.end, composerAtOpen.direction);
        } else opener?.focus({preventScroll:true});
    }
    opener = composerAtOpen = null;
    if (restore) resume?.();
}

function tabInSheet(event) {
    if (event.key==='Enter' && event.target===openComposer()) {
        event.preventDefault();
        event.stopPropagation();
    }
    if (event.key === 'Escape') {
        if (event.target.closest('select')) return;
        event.preventDefault();
        closeSheet();
        return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...overlay.querySelectorAll('button, a[href], summary, input, select, textarea, [tabindex="0"]')]
        .filter(node => !node.disabled && node.getClientRects().length > 0 && node.tabIndex >= 0);
    const edges = event.shiftKey ? [focusable[0], focusable.at(-1)] : [focusable.at(-1), focusable[0]];
    if (document.activeElement === edges[0] || !overlay.contains(document.activeElement)) {
        event.preventDefault();
        edges[1]?.focus();
    }
}

export function openQuickActions(family, index, trigger = document.activeElement, returning, resumePanel) {
    if (!isChatOpen() || !settings().enabled) return;
    knownChat = quickChatIdentity();
    session = sessions.get(knownChat);
    if (!session) {
        session = {chat:knownChat, view:'root', editors:{}};
        sessions.set(knownChat, session);
    }
    const drafts = session.editors.draft;
    if (drafts) saveDraftBatches(drafts,session);
    opener = trigger;
    const input = openComposer();
    composerAtOpen = snapshot(input);
    focusComposer = document.activeElement === input;
    returnToPanel=returning?.resumePanel || resumePanel;
    if (!overlay) {
        overlay = h('div',{class:'ri-quick-overlay',onclick:event=>{ if (event.target === overlay) closeSheet(); }});
        document.body.append(overlay);
        overlay.addEventListener('focusin',enterSheet,{once:true});
        document.addEventListener('keydown',tabInSheet,true);
        globalThis.visualViewport?.addEventListener('resize', resizeSheet);
        globalThis.visualViewport?.addEventListener('scroll', resizeSheet);
        resizeSheet();
    }
    session.history=[];
    session.view='root';
    session.family='';
    if (returning) {
        composerAtOpen=returning.composer;
        focusComposer=returning.focusComposer;
        session.history=returning.history;
        session.view=returning.view;
        session.family=returning.family;
        renderSheet();
        restoreView(overlay.querySelector('.ri-quick-scroll'),returning.snapshot,overlay.querySelector('#ri-quick-heading'));
        return;
    }
    if (family) chooseFamily(family, index);
    else renderSheet();
    if (!focusComposer) overlay.querySelector('[data-quick-close]')?.focus({preventScroll:true});
    else isolateBackground(true);
}

function sheetLocation() {
    return {view:session.view,family:session.family,
        snapshot:captureView(overlay.querySelector('.ri-quick-scroll'))};
}

function show(view, family = session.family, replace = false) {
    if (!replace && (session.view!==view || session.family!==family)) session.history.push(sheetLocation());
    session.view=view;
    session.family=family;
    renderSheet();
}

function backInSheet() {
    const previous=session.history.pop();
    if (!previous) return closeSheet();
    session.view=previous.view;
    session.family=previous.family;
    renderSheet();
    restoreView(overlay.querySelector('.ri-quick-scroll'),previous.snapshot,overlay.querySelector('#ri-quick-heading'));
}

function chooseFamily(family, index) {
    const edit = editorFor(family);
    if (family === 'swipe' || family === 'continue') {
        // Reopening an unfinished action keeps the exact target until the user selects another.
        if (index !== undefined || !edit.target || (!edit.direction && !edit.cues.length && !edit.lastAttempt)) edit.target = guidedTarget(index);
    }
    show('family',family);
}

function joinGuidance(edit) {
    return [...(edit.cues || []).map(cue => cue.text), edit.direction].filter(Boolean).join('\n\n');
}

const referenceKey = reference => typeof reference === 'string' ? reference : JSON.stringify(reference);
const pinLabel = (id, pins) => pins.some(pin => pin.key === referenceKey(id)) ? 'Unpin' : 'Pin';

async function resolveForSheet(edit, reference) {
    const action = typeof reference === 'string' ? readQuickAction(reference) : reference;
    if (!action) throw new Error('This shortcut was removed. Open Manage to recover it.');
    const sources = action.source ? await loadQuickActionSources({family:edit.family}) : [];
    return {...resolveQuickAction(action, {sources, twist:edit.twist, variables:{direction:edit.direction}}),
        reference, usesDirection:action.text?.includes('{{direction}}')};
}

function addResolved(edit, cue) {
    const existing = edit.cues.findIndex(picked => picked.id === cue.id);
    if (existing >= 0) edit.cues[existing] = cue;
    else edit.cues.push(cue);
}

async function selectFavorite(edit, shortcut, customize = false) {
    const owner = session;
    try {
        if (edit.running) return;
        const selected=edit.cues.findIndex(cue=>cue.reference===shortcut.reference);
        if (selected>=0 && !customize) {
            edit.cues.splice(selected,1);
            renderSheet();
            return;
        }
        // A translated menu command opens the extension's own pending review.
        const action = readQuickAction(shortcut.reference);
        if (action?.operation === 'queue') { show('pending'); return; }
        if (customize || action?.twistTypes?.length || action?.requiresDirection || action?.operation === 'repair' || edit.family === 'draft' && !shortcut.pinned) {
            edit.mode = 'select';
            if (action?.requiresDirection && !edit.direction.trim()) {
                edit.awaiting = shortcut;
                renderSheet();
                return;
            }
        }
        const cue = await resolveForSheet(edit, shortcut.reference);
        if (session !== owner || owner.chat !== quickChatIdentity()) return;
        const hasInput = edit.mode === 'select' || edit.direction.trim() || edit.cues.length;
        addResolved(edit, cue);
        edit.error = '';
        if (!hasInput && shortcut.pinned) await submit(edit);
        else renderSheet();
    } catch (error) {
        edit.error = `${shortcut.title || 'This action'}: ${error.message}`;
        if (session === owner) renderSheet();
    }
}

function immediateLabel(entry, stage) {
    const title = entry.title;
    const prefix = {steer:'Queue',swipe:'Swipe with',continue:'Continue with',draft:'Draft with'}[entry.family];
    return `${prefix} ${title}${stage==='additional' ? ' · 1 model call' : ''}`;
}

function shelf(entries, edit) {
    return h('div',{class:'ri-quick-shelf'}, entries.map(entry => {
        const chosen = edit.cues.some(cue=>cue.reference === entry.reference);
        const preview = previewFor(edit);
        const definition=readQuickAction(entry.reference);
        const canRun = entry.pinned && !edit.mode && !edit.direction && !edit.cues.length &&
            !definition?.operation && !definition?.requiresDirection && !definition?.twistTypes?.length;
        const label = canRun ? immediateLabel({...entry,family:edit.family},preview.stages.at(-1)?.stage) : entry.title;
        const pick = button(label, () => selectFavorite(edit, entry));
        if (entry.pinned && !definition?.operation && !definition?.requiresDirection && !definition?.twistTypes?.length) {
            pick.dataset.favoriteLabel=entry.title;
            pick.dataset.favoriteRun=immediateLabel({...entry,family:edit.family},preview.stages.at(-1)?.stage);
        }
        if (!canRun) {
            pick.setAttribute('aria-label',label);
            pick.setAttribute('aria-pressed',String(chosen));
        }
        return h('div',{class:'ri-quick-shelf-option'},actionRow(pick, entry.pinned && button('Customize', () => selectFavorite(edit, entry, true)),
            button(pinLabel(entry.reference, quickChat()?.pins || []), () => { pinQuickAction(entry.reference, entry.title, edit.family); renderSheet(); }, {title:entry.title})),
            definition && info(quickActionOwner(definition)));

    }));
}

function pendingView() {
    const state = quickChat();
    const entries = state?.pending || [];
    const remaining = freshRemaining();
    return h('div',{}, !entries.length && info('No directions are waiting for a player message.'),
        remaining > 0 && actionRow(info(`Fresh start · ${remaining} story replies remaining`), button('Stop Fresh start', () => { stopFreshStart(); renderSheet(); })),
        ...entries.map((entry, index) => h('article',{class:'ri-quick-card'},
            h('strong',{},entry.rows.map(row=>row.title).filter(Boolean).join(' · ') || `Direction ${index + 1}`),
            entry.rows.map(row=>h('p',{},`${row.visibility === 'visible' ? 'Visible OOC' : 'Private'} · ${row.required ? 'Required direction' : 'Nudge'}`, h('br'),row.text)),
            entry.freshStart && info(entry.freshStart === 'five' ? 'Fresh start for five story replies' : 'Fresh start for this action'),
            entry.roll && info(entry.roll.text),
            session.pendingEdit === entry.id && h('div',{},entry.rows.map((row, i) => field(row.title || `Direction ${i + 1}`, '',
                textArea(row.text,text=>{session.queueEdits[i] = text;},{'aria-label':row.title || `Direction ${i + 1}`})))),
            actionRow(session.pendingEdit === entry.id ? button('Save wording', () => {
                if (state.bindings?.some(binding=>binding.entries.some(row=>row.id===entry.id))) {
                    session.notice = 'This direction is attached to a sent message. Retry or cancel it to start over.';
                } else if (session.queueEdits.some(text=>!text.trim())) session.notice = 'Enter wording for each direction.';
                else {
                    entry.rows.forEach((row,i)=>{ row.text = session.queueEdits[i]; });
                    saveChatState();
                    session.pendingEdit = null;
                }
                renderSheet();
            }) : button('Edit wording', () => { session.pendingEdit = entry.id; session.queueEdits = entry.rows.map(row=>row.text); renderSheet(); }),
            button('Cancel direction', () => { cancelQueued(entry.id); renderSheet(); })))),
        queuedRetry() && button(session.retrying ? 'Retrying…' : 'Retry reply to this message', async () => {
            session.retrying = true;
            renderSheet();
            try { await retryQueuedReply(); } catch (error) { session.notice = error.message; }
            session.retrying = false;
            renderSheet();
        },{disabled:session.retrying}),
        state?.lastReceipt && executionDetails(state.lastReceipt));
}

function catalogView(mode) {
    const owner = session;
    const host = h('div');
    renderQuickActionLibrary(host,{
        family:owner.family || '', mode,
        initialDirection:owner.family ? editorFor(owner.family).direction : '',
        getPins:()=>quickChat()?.pins || [],
        state:mode==='add' ? (owner.actionEditor ||= {}) : (owner.library ||= {}),
        onSelect:(resolved, action) => {
            if (session !== owner || owner.chat !== quickChatIdentity()) return;
            if (resolved.operation === 'queue') { show('pending'); return; }
            const family = resolved.family || session.family || 'steer';
            const edit = editorFor(family);
            if ((family === 'swipe' || family === 'continue') && !edit.target) edit.target = guidedTarget();
            edit.mode = 'select';
            addResolved(edit, {...resolved, reference:action?.origin==='source' ? undefined : action?.id || resolved.id, usesDirection:resolved.embedsDirection});
            show('family',family,true);
        },
        onChange:()=>{ if (session===owner && session.view==='add') {
            owner.actionEditor=null;
            backInSheet();
        } },
        onPin:pinQuickAction,
        onRestore:({family,undoId})=>{
            const state=quickChat();
            state.pinUndo={id:undoId,pins:structuredClone(state.pins)};
            state.pins=state.pins.filter(pin=>family && pin.family!==family);
            saveChatState();
        },
        onUndo:undoId=>{
            const state=quickChat();
            if (!state?.pinUndo || state.pinUndo.id!==undoId) return;
            state.pins=state.pinUndo.pins;
            delete state.pinUndo;
            saveChatState();
        },
        onOpenTool:tool=>openPanel(tool==='Notes'?'sent':'context'),
        onClose:backInSheet,
        onCancelPending:()=>show('pending'),
    });
    return host;
}

function pinRow(pin,index,count) {
    const move=(offset,control)=>{
        moveQuickPin(index,offset);
        renderSheet();
        const row=[...overlay.querySelectorAll('[data-quick-pin]')].find(node=>node.dataset.quickPin===pin.key);
        const preferred=row?.querySelector(`[data-move="${control}"]:enabled`) || row?.querySelector('[data-move]:enabled');
        preferred?.focus({preventScroll:true});
    };
    const up=button('Move up',()=>move(-1,'up'),{disabled:index===0});
    const down=button('Move down',()=>move(1,'down'),{disabled:index===count-1});
    up.dataset.move='up';
    down.dataset.move='down';
    const row=actionRow(h('span',{class:'ri-quick-pin-label'},pin.title),up,down,
        button('Unpin',()=>{pinQuickAction(pin.reference,pin.title,pin.family);renderSheet();}));
    row.dataset.quickPin=pin.key;
    return row;
}

function rootView() {
    const state = quickChat();
    const remaining = freshRemaining();
    const pinned = state?.pins || [];
    const query = textInput(session.query || '', value => {
        session.query = value;
        renderResults();
    },{type:'search','aria-label':'Search quick actions',placeholder:'Search quick actions'});
    const hits = h('div',{class:'ri-quick-shelf'});
    function renderResults() {
        const words = String(session.query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
        hits.replaceChildren();
        if (!words.length) return;
        const found = listQuickActions().filter(action=>words.every(word=>`${action.title} ${action.category} ${action.text}`.toLowerCase().includes(word))).slice(0, 30);
        if (!found.length) hits.append(info('No saved actions match. Browse directions to search source books.'));
        else for (const action of found) hits.append(button(`${action.title} · ${families[action.family].title}`, () => {
            chooseFamily(action.family);
            selectFavorite(editorFor(action.family), {reference:action.id,title:action.title}, true);
        }));
    }
    renderResults();
    return h('div',{},h('div',{class:'ri-quick-families'},Object.entries(families).map(([id,family])=>button(family.title,()=>chooseFamily(id),{kind:'primary'}))),
        button(`Pending directions · ${state?.pending?.length || 0}`,()=>show('pending')),
        remaining > 0 && actionRow(info(`Fresh start · ${remaining} story replies remaining`),button('Stop',()=>{stopFreshStart();renderSheet();})),
        h('div',{class:'ri-quick-shelf'}, [...pinned, ...(state?.recent || []).filter(row=>!pinned.some(pin=>pin.key===row.key)).slice(0,4)].map(row=>{
            const field=editorFor(row.family);
            const definition=readQuickAction(row.reference);
            const canRun=pinned.includes(row) && !field.mode && !field.direction && !field.cues.length &&
                !definition?.requiresDirection && !definition?.twistTypes?.length && !definition?.operation;
            const target=['swipe','continue'].includes(row.family) ? field.target || guidedTarget() : undefined;
            const stage=previewFor({...field,target}).stages.at(-1)?.stage;
            return h('div',{},button(canRun ? immediateLabel(row,stage) : `${row.title} · ${families[row.family].title}`,()=>{
                chooseFamily(row.family);
                selectFavorite(field, {...row,pinned:pinned.includes(row)});
            }),definition && info(quickActionOwner(definition)));
        })),
        field('Search', '', query), hits,
        actionRow(button(taskLabels.browse,()=>show('browse','')),button(taskLabels.manage,()=>show('manage',''))),
        h('details',{},h('summary',{},'Pins and order'), pinned.length ? pinned.map((pin,index)=>pinRow(pin,index,pinned.length))
            : info('Pin a direction from its action menu.')),
        actionRow(button('Context & Memory',()=>openPanel('context',null,'#ri-memory-status')),button('What Was Sent',()=>openPanel('sent')),button('Edit preset prompts',()=>openPanel('v10',null,'#ri-preset-workbench'))));
}

async function openPanel(page, reply = null, anchor = '') {
    const scope=quickChatIdentity(), origin=opener;
    const returning={...sheetLocation(),history:[...session.history],composer:composerAtOpen,focusComposer,resumePanel:returnToPanel};
    const external={label:'Back to Quick actions',returnFocus:origin,resume:()=>{
        if (quickChatIdentity()===scope) openQuickActions(undefined,undefined,origin,returning);
    }};
    if (!await app.openPage(page,{reply,anchor,external,focusPage:true}) || quickChatIdentity()!==scope) return;
    closeSheet({restore:false});
    await app.setExpanded(true);
    app.focusTarget(anchor);
}

function previewFor(edit, mode = 'draft') {
    if (edit.family === 'steer') {
        const reason = memoryOnly() ? 'Directions need the full extension workflow in this chat.' : queueCapability();
        return {available:!reason, reason, history:freshHistoryCapability(),
            stages:[executionPreview('steer',{stage:'reply',label:'Queued directions',trigger:'The reply to your next player message.'})]};
    }
    const fixFacts = edit.cues.some(cue=>cue.operation==='repair');
    const preview = guidedPreview(edit.family,{target:edit.target,freshStart:!!edit.freshStart,mode,fixFacts});
    const repairOnly = fixFacts && edit.cues.every(cue=>cue.operation==='repair') && !edit.direction.trim();
    const stage = preview.stage;
    const stages = [executionPreview(preview.operation,{stage,label:mode==='choices'?'Give me choices':undefined,target:edit.target && `${edit.target.name} · version ${edit.target.swipe + 1}`})];
    if (repairOnly) stages.length=0;
    if (fixFacts) stages.unshift(executionPreview('factRepair',{stage:'code',label:'Audit world facts'}));
    return {...preview,available:repairOnly ? !!edit.target : preview.available,repairOnly,stages};
}

function useDraftWording(text) {
    if (!text.trim()) return;
    const state=quickChat();
    state.draftRecovery=snapshot(openComposer());
    saveChatState();
    restoreComposer({value:text});
    composerAtOpen=snapshot(openComposer());
    focusComposer=true;
    closeSheet();
}

function partialResult(edit) {
    const canUse=edit.family==='draft';
    const original=edit.partial;
    const use=canUse && button('Use edited wording',()=>useDraftWording(edit.partialEdit),{disabled:true});
    return h('details',{},h('summary',{},'Raw output and recovery'),
        info(canUse ? 'Edit the output into the wording you want in the composer.' : 'Copy or edit this output for use in another attempt.'),
        field('Partial result','',textArea(edit.partialEdit ?? original,value=>{
            edit.partialEdit=value;
            if (use) use.disabled=!value.trim() || value.trim()===original.trim();
        })),
        use);
}

function renderCandidate(edit, candidate, index) {
    const textarea = textArea(candidate.text,value=>{
        candidate.text=value;
        const saved=edit.batch.history?.candidates[candidate.historyIndex];
        if (saved) { saved.text=value; saveChatState(); }
    },{'aria-label':candidate.title || `Choice ${index + 1}`,disabled:edit.running});
    textarea.rows = 4;
    return h('article',{class:'ri-quick-card'},h('strong',{},candidate.title || (edit.batch.mode==='choices' ? `Choice ${index + 1}` : 'Your draft')),
        textarea,actionRow(button('Use this wording',()=>{
            if (!candidate.text.trim()) { edit.error='Enter wording to use first.'; renderSheet(); return; }
            useDraftWording(candidate.text);
        },{kind:'primary',disabled:edit.running}),
        edit.batch.mode==='choices' && button('Draft from this choice · 1 model call',()=>submit(edit,'expand',candidate.text,edit.batch.input),{disabled:edit.running}),
        button('Dismiss',()=>{edit.batch.candidates.splice(index,1);renderSheet();},{disabled:edit.running})));
}

function saveDraftBatches(edit, owner) {
    if (!edit.newDraftBatches?.length || owner.chat!==quickChatIdentity()) return;
    const state = quickChat();
    if (!state) return;
    state.draftBatches = [...edit.newDraftBatches,...(state.draftBatches || [])].slice(0,6);
    edit.newDraftBatches = [];
    saveChatState();
}

function rememberDraftBatch(edit, owner, batch) {
    const {mode,candidates,input:{cues,direction,freshStart}} = batch;
    const saved = structuredClone({mode,candidates,input:{cues,direction,freshStart}});
    batch.history = saved;
    candidates.forEach((candidate,index)=>{ candidate.historyIndex=index; });
    (edit.newDraftBatches ||= []).unshift(saved);
    saveDraftBatches(edit,owner);
}

function draftHistory(edit, state) {
    if (!state?.draftBatches?.length) return null;
    return h('details',{},h('summary',{},'Recent drafts and choices'),state.draftBatches.map((batch,index)=>{
        const label=batch.mode==='choices' ? 'Player choices' : batch.mode==='expand' ? 'Expanded choice' : 'Player draft';
        return h('details',{class:'ri-quick-card'},h('summary',{},label+' · '+batch.candidates[0]?.text.slice(0,65)),
            batch.candidates.map(candidate=>info(candidate.text)),
            actionRow(button('Restore for editing',()=>{
                edit.batch=structuredClone(batch);
                edit.batch.history=batch;
                edit.batch.candidates.forEach((candidate,index)=>{ candidate.historyIndex=index; });
                edit.message=batch.mode==='choices' ? 'Choices restored for editing.' : 'Draft restored for editing.';
                edit.showResults=true;
                renderSheet();
            },{disabled:edit.running}),button('Remove from history',()=>{
                state.draftBatches.splice(index,1);
                saveChatState();
                renderSheet();
            })));
    }));
}

function optionEditor(edit, chosen, index) {
    return h('details',{class:'ri-quick-card'},h('summary',{},chosen.title || 'Resolved direction'),
        field('Exact wording','', textArea(chosen.text,value=>{chosen.text=value;})),
        chosen.sources?.map(source=>info([source.book,source.set,source.title].filter(Boolean).join(' · '))),
        chosen.draw && info(`Draw ${chosen.draw.id}`),
        actionRow(button('Move up',()=>{[edit.cues[index-1],edit.cues[index]]=[edit.cues[index],edit.cues[index-1]];renderSheet();},{disabled:index===0}),
            button('Move down',()=>{[edit.cues[index+1],edit.cues[index]]=[edit.cues[index],edit.cues[index+1]];renderSheet();},{disabled:index===edit.cues.length-1}),
            button('Remove',()=>{edit.cues.splice(index,1);renderSheet();})));
}

async function submit(edit, mode = 'draft', choice = '', replay = null) {
    if (edit.running || edit.switching || isGenerating()) return;
    const owner = session;
    const origin = owner.chat;
    const currentPreview = previewFor(edit,mode);
    if (!currentPreview.available) return;
    const input = replay || {target:edit.target, cues:structuredClone(edit.cues), direction:edit.cues.some(cue=>cue.usesDirection)?'':edit.direction,
        freshStart:edit.freshStart, composer:openComposer()?.value || '', fixFacts:edit.cues.some(cue=>cue.operation==='repair'),
        roll:edit.die ? structuredClone(edit.die) : null, repairOnly:currentPreview.repairOnly, repeatOrders:edit.repeatOrders, keepManualEdits:edit.keepManualEdits, rerollDice:edit.rerollDice};
    edit.running = true;
    edit.partial = '';
    edit.partialEdit = null;
    edit.repair = input.repair || null;
    edit.message = '';
    edit.error = '';
    edit.lastAttempt = {input,mode,choice};
    renderSheet();
    try {
        if (edit.family === 'steer') {
            const entry = queueDirections(input.cues,input.direction,{visibility:edit.visibility,required:edit.required,freshStart:input.freshStart,roll:input.roll});
            edit.message = 'Queued with your next player message.';
            edit.lastQueued = entry.id;
        } else {
            const outcome = await runGuidedTurn(edit.family,{...input,freshStart:!!input.freshStart,mode,choice,
                onReceipt:receipt=>{edit.receipt=receipt;}});
            edit.repair = outcome.repair;
            if (outcome.raw && (outcome.partial || !outcome.ok)) edit.partial=outcome.raw;
            edit.receipt = outcome.receipt;
            edit.undo = outcome.undo;
            const candidates = (outcome.choices || (outcome.text ? [outcome.text] : [])).map(candidate=>typeof candidate==='string'?{text:candidate}:{...candidate});
            if (edit.family === 'draft' && !candidates.length) throw Object.assign(new Error('No playable wording was returned. Write your own or retry.'),{receipt:outcome.receipt});
            if (edit.family === 'draft') {
                const batch = {candidates,input,mode};
                if (mode === 'expand') edit.batch.expanded = batch;
                else edit.batch = batch;
                rememberDraftBatch(edit,owner,batch);
                edit.showResults=true;
                edit.message = mode === 'choices' ? `${candidates.length} of 3 choices received.` : 'Draft ready to edit.';
            } else edit.message = input.repairOnly ? 'Source repair reviewed.' : 'Reply updated.';
            if (!outcome.ok && outcome.ok !== undefined) throw Object.assign(new Error(outcome.reason || 'The action did not finish.'),{receipt:outcome.receipt});
            if (origin === quickChatIdentity() && input.freshStart === 'five') armFreshStart();
        }
        if (origin === quickChatIdentity()) rememberQuickActions(input.cues);
        edit.cues = [];
        edit.direction = '';
        edit.mode = '';
        edit.freshStart = '';
        edit.die = null;
        edit.lastAttempt = null;
        // A successful replacement changes the selected revision for the next invocation.
        if (origin === quickChatIdentity() && edit.target) edit.target = guidedTarget(edit.target.index);
    } catch (error) {
        edit.error = error?.message || String(error);
        edit.nativeFallback=error?.code==='native-impersonation-unverified';
        edit.showResults=true;
        if (error.receipt) edit.receipt = error.receipt;
        if (error.repair) { edit.repair=error.repair; edit.lastAttempt.input={...input,repair:error.repair}; }
        if (error.receipt?.partialText) edit.partial = error.receipt.partialText;
    } finally {
        edit.running = false;
        if (session === owner && overlay) renderSheet();
    }
}

function unavailableAction(preview, label = '') {
    if (!preview || preview.available) return null;
    const rejected=preview.stages.find(stage=>stage.problem || stage.profileId);
    const reason=preview.reason || rejected?.problem || 'This route is unavailable.';
    return h('div',{},status(label ? `${label} · ${reason}` : reason),
        rejected?.profileId && button('Connection settings',()=>openConnection(rejected.operation)));
}

function openConnection(operation) {
    return openPanel('settings',null,`#ri-model-request-settings [data-ri-operation="${CSS.escape(operation)}"]`);
}

function familyView(edit) {
    const config = families[edit.family];
    const group = quickChat();
    const pinned = (group?.pins || []).filter(pin=>pin.family===edit.family).map(pin=>({...pin,pinned:true}));
    const recent = (group?.recent || []).filter(row=>row.family===edit.family && !pinned.some(pin=>pin.key===row.key));
    const available = listQuickActions(edit.family).filter(action=>action.operation!=='repair' && ![...pinned,...recent].some(row=>row.reference===action.id));
    const preview = previewFor(edit);
    const reference = edit.target;
    const versions = guidedVersions(reference);
    const previous = reference && ctx().chat?.[reference.index]?.extra?.[KEY];
    const previousRoll = previous?.guided?.roll || previous?.quickActions?.rolls?.at(-1);
    const primary = button(config.primary,()=>submit(edit),{kind:'primary'});
    const choices = edit.family==='draft' && button('Give me choices · 1 model call',()=>submit(edit,'choices'),{kind:'primary'});
    function updateControls() {
        const fresh = previewFor(edit);
        const noInput = edit.family === 'steer' && !edit.direction.trim() && !edit.cues.length && !edit.freshStart && !edit.die;
        primary.disabled = !!edit.running || !!edit.switching || !fresh.available || noInput;
        primary.textContent = edit.running ? 'Running…' : fresh.repairOnly ? 'Audit world facts' : config.primary + (fresh.stages.at(-1).stage==='additional'?' · 1 model call':'');
        if (choices) choices.disabled = !!edit.running || !previewFor(edit,'choices').available;
    }
    const direction = textArea(edit.direction,value=>{
        edit.direction=value;
        edit.lastAttempt=null;
        updateControls();
        for (const favorite of detailNodes.querySelectorAll('[data-favorite-run]')) {
            const selects=edit.mode==='select' || !!edit.direction.trim() || !!edit.cues.length;
            favorite.textContent=selects ? favorite.dataset.favoriteLabel : favorite.dataset.favoriteRun;
            if (selects) {
                favorite.setAttribute('aria-pressed',String(edit.cues.some(cue=>cue.title===favorite.dataset.favoriteLabel)));
                favorite.setAttribute('aria-label',favorite.dataset.favoriteLabel);
            } else {
                favorite.removeAttribute('aria-pressed');
                favorite.removeAttribute('aria-label');
            }
        }
    },{'aria-label':'Your direction',placeholder:'Optional details for this action'});
    const choicesPreview = edit.family==='draft' ? previewFor(edit,'choices') : null;
    const repairStage = edit.repair && edit.receipt?.operation!=='factRepair' && {
        ...executionPreview('factRepair',{stage:'code',label:'Audit world facts'}),
        attempts:0,outcome:'completed',
        result:edit.repair.repaired?.length ? `${edit.repair.repaired.length} updated sources`
            : edit.repair.unresolved?.[0] || 'Reviewed available evidence',
    };
    const stage = edit.receipt ? [repairStage,edit.receipt].filter(Boolean)
        : choicesPreview ? [...preview.stages,...choicesPreview.stages] : preview.stages;
    const twistCue = edit.cues.find(cue=>readQuickAction(cue.reference)?.twistTypes?.length);
    const detailNodes = h('div',{class:'ri-quick-content'},
        reference && info(`${reference.name} · swipe ${reference.swipe + 1} · revision ${String(reference.fingerprint).slice(-8)}`),
        reference && h('details',{},h('summary',{},'Selected reply'),h('p',{},reference.text)),
        reference && versions.length>1 && field('Selected version','A version is called a swipe in the host.',
            select(versions.map(({swipe})=>({value:String(swipe),label:`Version ${swipe + 1}`})),String(reference.swipe),async value=>{
                if (edit.switching || edit.running) return;
                const owner=session;
                edit.switching=true;
                renderSheet();
                try { edit.target=await selectGuidedVersion(reference,Number(value));edit.error='';edit.lastAttempt=null; }
                catch(error) { edit.error=error.message; }
                finally {
                    edit.switching=false;
                    if (session===owner) renderSheet();
                }
            },{'aria-label':'Selected version',disabled:edit.running || edit.switching})),
        edit.switching && status('Switching to the selected swipe…'),
        reference && !reference.latest && button('Use latest reply',()=>{edit.target=guidedTarget();edit.lastAttempt=null;renderSheet();},
            {disabled:edit.running || edit.switching}),
        preview.dependent?.replies > 0 && info(`${preview.dependent.replies} later replies and ${preview.dependent.cards} dependent cards. Later prose stays saved. Affected facts will be reconciled from surviving evidence.`),
        preview.fallback && info(preview.fallback),
        unavailableAction(preview),
        unavailableAction(choicesPreview,'Give me choices'),
        edit.family==='steer' && button(`Pending directions · ${group.pending.length}`,()=>show('pending')),
        (pinned.length || recent.length) ? shelf([...pinned,...recent],edit) : null,
        actionRow(button(taskLabels.browse,()=>show('browse')),button(config.add,()=>show('add')),button(taskLabels.manage,()=>show('manage'))),
        edit.family==='swipe' && actionRow(button('Fix world facts',()=>selectFavorite(edit,{reference:'builtin:swipe:fix-facts',title:'Fix world facts'},true))),
        h('details',{open:!pinned.length},h('summary',{},'Available directions'),
            shelf(available.map(action=>({reference:action.id,title:action.title,operation:action.operation})),edit)),
        edit.cues.length > 0 && h('div',{},h('h3',{},'Selected cues in send order'),edit.cues.map((cue,i)=>optionEditor(edit,cue,i))),
        twistCue && field('Twist type','',select([{value:'',label:'Choose for me'},...readQuickAction(twistCue.reference).twistTypes.map(value=>({value,label:value}))],edit.twist,async value=>{
            edit.twist=value;
            try { addResolved(edit, await resolveForSheet(edit,twistCue.reference)); } catch (error) { edit.error=error.message; }
            renderSheet();
        })),
        field('Your direction','',direction),
        edit.awaiting && button(`Select ${edit.awaiting.title}`,()=>{ const next=edit.awaiting; edit.awaiting=null; selectFavorite(edit,next,true); }),
        edit.family==='steer' && actionRow(
            field('Delivery','',select([{value:'default',label:'Use cue defaults'},{value:'private',label:'Private guidance'},{value:'visible',label:'Visible OOC'}],edit.visibility,value=>{edit.visibility=value;})),
            h('label',{},h('input',{type:'checkbox',checked:edit.required,onchange:event=>{edit.required=event.target.checked;}}),'Required direction')),
        (edit.family==='steer' || edit.family==='swipe') && h('details',{},h('summary',{},'Action roll'),
            info(edit.die?.text || 'Roll in code and keep the result with this action.'),
            executionDetails({...executionPreview('actionRoll',{stage:'code',label:'Roll d20'}),attempts:0,
                outcome:edit.die ? 'completed' : undefined}),
            actionRow(button(edit.die || previousRoll ? 'Reroll d20' : 'Roll d20',()=>{
                edit.die=rollQuickActionDie(previousRoll || {});renderSheet();
            }), previousRoll && edit.die?.id!==previousRoll.id && button('Keep original roll',()=>{edit.die=structuredClone(previousRoll);renderSheet();}),
                edit.die && button('Remove roll',()=>{edit.die=null;renderSheet();}),
                edit.family==='swipe' && h('label',{},h('input',{type:'checkbox',checked:edit.rerollDice,onchange:event=>{edit.rerollDice=event.target.checked;}}),'Reroll the original story check'))),
        h('details',{open:!!edit.freshStart},h('summary',{},'Fresh start'),
            field('Duration','',select([{value:'',label:'Off'},{value:'one',label:'This action'},{value:'five',label:'Next 5 story replies'}],edit.freshStart,value=>{
                edit.freshStart=value;
                renderSheet();
            })),
            info((preview.history?.mode || preview.history)==='retained'?'This route keeps host prose history and adds the Fresh start direction.':'This route can replace earlier prose with established facts.'),
            freshRemaining() > 0 && button(`Stop · ${freshRemaining()} story replies remaining`,()=>{stopFreshStart();renderSheet();})),
        edit.family==='swipe' && h('details',{},h('summary',{},'Prior orders and edits'),
            h('label',{},h('input',{type:'checkbox',checked:edit.repeatOrders,onchange:event=>{edit.repeatOrders=event.target.checked;}}),'Repeat prior orders'),
            h('label',{},h('input',{type:'checkbox',checked:edit.keepManualEdits,onchange:event=>{edit.keepManualEdits=event.target.checked;}}),'Keep manual edits')),
        edit.family==='draft' && impersonationInspector({operation:'playerDraft',guidance:()=>joinGuidance(edit),mode:preview.nativeDraft?'native':'helper',onChange:renderSheet}),
        edit.family==='draft' && h('details',{},h('summary',{},'Choice and expansion prompts'),
            impersonationInspector({operation:'playerChoices',guidance:()=>joinGuidance(edit),mode:'helper'}),
            impersonationInspector({operation:'playerExpansion',guidance:()=>joinGuidance(edit),mode:'helper'})),
        executionDetails(stage,{onSettings:openConnection}),
        edit.error && h('div',{'data-quick-error':true},status(edit.error),
            edit.lastAttempt && edit.nativeFallback && button('Draft through direct helper · 1 model call',()=>{
                const attempt=edit.lastAttempt;
                submit(edit,attempt.mode,attempt.choice,{...attempt.input,forceHelper:true});
            },{kind:'primary'}),
            edit.lastAttempt && !edit.nativeFallback && button(
                'Retry with the same directions'+(previewFor(edit,edit.lastAttempt.mode).stages.at(-1).stage==='additional'?' · 1 model call':''),
                ()=>submit(edit,edit.lastAttempt.mode,edit.lastAttempt.choice,edit.lastAttempt.input))),
        edit.message && status(edit.message),
        edit.repair && h('details',{open:true},h('summary',{},'Fact repair result'),
            edit.repair.repaired?.length ? info('Updated sources · '+edit.repair.repaired.join(', ')) : null,
            edit.repair.unresolved?.map(issue=>status(issue)),
            button('Correct story facts',()=>openPanel('corrections',edit.target))),
        edit.partial && partialResult(edit),
        edit.lastQueued && button('Undo queue',()=>{cancelQueued(edit.lastQueued);edit.lastQueued=null;edit.message='Direction removed.';renderSheet();}),
        edit.undo && button('Undo continuation',async()=>{
            const owner=session;
            const undo=edit.undo;
            try {
                await undoGuidedContinuation(undo);
                if (session===owner && owner.chat===quickChatIdentity()) edit.target=guidedTarget(undo.target.index);
                edit.undo=null;
                edit.message='Continuation undone.';
            }
            catch(error) { edit.error=error.message; }
            if (session===owner) renderSheet();
        },{disabled:edit.running || edit.switching}),
        edit.batch && h('div',{class:'ri-quick-shelf','data-quick-results':true},
            h('h3',{},edit.batch.expanded ? 'Expanded draft and choices' : edit.batch.mode==='choices' ? 'Your choices' : 'Your draft'),
            edit.batch.expanded?.candidates.map((candidate,index)=>renderCandidate({...edit,batch:edit.batch.expanded},candidate,index)),
            edit.batch.candidates.map((candidate,index)=>renderCandidate(edit,candidate,index)),
            h('details',{},h('summary',{},'Directions used'),info(joinGuidance(edit.batch.input))),
            button('Use these directions again',()=>{edit.cues=structuredClone(edit.batch.input.cues);edit.direction=edit.batch.input.direction;edit.mode='select';renderSheet();})),
        edit.family==='draft' && draftHistory(edit,group),
        group?.draftRecovery && edit.family==='draft' && button('Recover previous composer draft',()=>{
            restoreComposer(group.draftRecovery);group.draftRecovery=null;saveChatState(); composerAtOpen=snapshot(openComposer());focusComposer=true;closeSheet();
        }));
    updateControls();
    const footer = actionRow(primary, choices,edit.running && edit.family!=='steer' && button('Cancel request',()=>{
        edit.message=cancelGuidedTurn();renderSheet();
    }));
    footer.classList.add('ri-quick-footer');
    return {content:detailNodes,footer};
}

function renderSheet() {
    if (!overlay || !session || session.chat !== quickChatIdentity()) return;
    const view = session.view;
    const family = session.family;
    let content, footer;
    if (view==='root') content=rootView();
    else if (view==='family') ({content,footer}=familyView(editorFor(family)));
    else if (view==='pending') content=pendingView();
    else content=catalogView(view);
    const header = h('header',{class:'ri-quick-header'},
        session.history.length>0 && button('Back',backInSheet),
        h('h2',{id:'ri-quick-heading',tabIndex:-1},({root:'Quick actions',pending:'Pending directions',browse:taskLabels.browse,manage:taskLabels.manage,add:families[family]?.add})[view] || families[family].title),
        h('button',{type:'button',class:'ri-btn','data-quick-close':'',onclick:()=>closeSheet()},'Close'));
    const old = overlay.querySelector('.ri-quick-scroll');
    const continuing = old?.dataset.view===view;
    const scroll = continuing ? old.scrollTop : 0;
    const active = document.activeElement;
    const restore = continuing && overlay.contains(active) && active?.getAttribute('aria-label')
        ? {label:active.getAttribute('aria-label'), tag:active.tagName, input:snapshot(active)} : null;
    const openFolds = new Set(continuing ? [...old.querySelectorAll('details[open] > summary')].map(summary=>summary.textContent) : []);
    const body = h('div',{class:'ri-quick-scroll','data-view':view},session.notice && status(session.notice),content);
    const sheet = h('section',{class:'ri-root ri-quick-sheet',role:'dialog','aria-modal':'true','aria-labelledby':'ri-quick-heading','data-accent':'sky'},header,body,footer);
    overlay.replaceChildren(sheet);
    for (const summary of body.querySelectorAll('details > summary')) {
        if (openFolds.has(summary.textContent)) summary.parentElement.open=true;
    }
    body.scrollTop=scroll;
    if (old) {
        const field=restore && [...body.querySelectorAll('[aria-label]')]
            .find(node=>node.tagName===restore.tag && node.getAttribute('aria-label')===restore.label);
        if (field) {
            field.focus({preventScroll:true});
            if (restore.input?.start!=null) field.setSelectionRange?.(restore.input.start,restore.input.end,restore.input.direction);
        } else if (!overlay.contains(active) || !active.isConnected) {
            const title=sheet.querySelector('#ri-quick-heading');
            title.tabIndex=-1;
            title.focus({preventScroll:true});
        }
    }
    if (view==='family' && editorFor(family).showResults) {
        editorFor(family).showResults=false;
        const results=body.querySelector(editorFor(family).error?'[data-quick-error]':'[data-quick-results]');
        if (results) body.scrollTop+=results.getBoundingClientRect().top-body.getBoundingClientRect().top;
    }
}

function attachToHost() {
    const input = openComposer();
    if (!input) return;
    const available = isChatOpen() && settings().enabled;
    const row = input.parentElement;
    let entry = row.querySelector('.ri-quick-entry');
    if (!entry) {
        entry = h('button',{class:'ri-quick-entry',type:'button',onpointerdown:event=>{if(document.activeElement===input)event.preventDefault();},
            onclick:event=>openQuickActions(undefined,undefined,event.currentTarget)},'Quick actions');
        input.after(entry);
    }
    entry.hidden = !available;
    if (composer!==input) {
        composer=input;
        const capture = () => {
            if (!knownChat || knownChat !== quickChatIdentity()) return;
            const held = !input.value && heldGroupContinuationComposer();
            composerDrafts.set(knownChat, held ? { value: held.text, start: held.start, end: held.end, direction: held.direction } : snapshot(input));
        };
        input.addEventListener('input',capture);
        input.addEventListener('select',capture);
    }
}

export function mountQuickActions() {
    knownChat=quickChatIdentity();
    attachToHost();
    restoreHeldRetryDraft();
    for (const name of ['CHARACTER_MESSAGE_RENDERED','USER_MESSAGE_RENDERED','MORE_MESSAGES_LOADED','GENERATION_ENDED']) on(name,attachToHost);
    on('CHAT_CHANGED',()=>{
        const next=quickChatIdentity();
        if (next!==knownChat) {
            closeSheet({restore:false});
            const old=knownChat;
            const previous=composerDrafts.get(old);
            knownChat=next;
            const returning=sessions.get(next);
            if (returning?.editors.draft) saveDraftBatches(returning.editors.draft,returning);
            const saved=composerDrafts.get(next);
            const current=openComposer();
            if (saved) restoreComposer(saved);
            else if (previous?.value && current?.value===previous.value) restoreComposer({value:''});
            restoreHeldRetryDraft();
        }
        attachToHost();
    });
    return attachToHost;
}
