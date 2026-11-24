import { DEFAULT_NPC_AVOID } from '../npc-names.js';
import { DEFAULT_STORY_AVOID } from '../defaults.js';
import { executionAction, executionDetails, functionExecution } from './execution.js';
import { executionPreview, executionReceipt, executionScope } from '../execution.js';
import { presetWorkbench } from './preset-workbench.js';
import { copyGuidelinesToInstructions } from '../books.js';
import { bookEntryEditor, receiptEntryEditor } from './book-entry-editor.js';
import { roastVoiceEditor } from './prompts.js';
import { slot, home, homeLink } from './homes.js';
import { listRecords, writeRecord, baseEntries, kindsFor } from '../records.js';
import { impersonationInspector } from './impersonation.js';
import { promptComparison, variationEditor } from './prompt-variations.js';
import { promptOwner } from '../prompt-variations.js';
import { renderChatBooks, storyWorldSection } from './chat-books.js';
import { renderReplyDisplayOptions, sceneCardControl, pronounsSection, diceSection, versionLine } from './settings.js';
import { memoryOnly, memoryComponents } from '../components.js';
import { dialogueAttributions, thoughtAttributions } from '../dialogue.js';
import { h, button, select, section, field, textArea, textInput } from './dom.js';
import { ctx, KEY, isChatOpen, toast, isGenerating, confirmBox } from '../st.js';
import { settings, chatState, saveSettings, saveChatState } from '../store.js';
import { acceptV10Opening, guideSwipe } from '../engine.js';
import { statNames } from '../dice.js';
import {
    MODULES, DEFAULT_MODULES, KIND_MODULE, PLOT_KINDS, AXES, defaultWritingGuidance, OPENING, PREFLIGHT, WRITING_PROFILES, writingProfileText, SCENE_CHECKS, sceneCheckId, hostSceneChecks, avoidPhrases,
    isCompanionPreset, activePreset, activeHostPrompts, presetDefaults, savePresetDefault, moduleOwnership, setModuleOwner, prefs, enabledV10, effectiveModules, pinBase, reusableAssignments, reusableBookRoles, assignReusableBook, unassignReusableBook, reusableBookNames, uploadBaseBook, uploadReusableBook, createReusableBook, queueCheck, checkText,
    greetings, draftOpening, setSpeakerColor, chooseAutomaticSpeakerColor, displayColor, baseWorld,
} from '../v10.js';

const options = names => names.map(name => ({ value:name, label:name }));
const choices = [{value:'inherit',label:'Inherit preset'}, {value:'on',label:'On'}, {value:'off',label:'Off'}];
const mode = value => value === undefined ? 'inherit' : value ? 'on' : 'off';
const problem = error => toast('error', error.message || String(error));
const entryLabel = kind => ({fact:'Fact',profile:'Portrayal',knowledge:'Knowledge',emotion:'Emotion',relationship:'Relationship',arc:'Arc milestone',seed:'Seed',agenda:'Agenda',event:'Event'})[kind];
const scoped = (label, control) => h('label',{class:'ri-field'},h('span',{class:'ri-label'},label),control);

function profileEditor(local, key, label, fallback, standalone=true, list=false) {
    const chatId=ctx().getCurrentChatId?.();
    const box = textArea(local[key] ?? fallback, () => {}, {rows:5,id:standalone ? `ri-profile-${key}` : undefined,'aria-label':label});
    const badge = h('span',{class:'ri-prompt-badge'});
    const status = h('p',{class:'ri-help',role:'status'});
    const discard = button('Discard draft',()=>{
        box.value=local[key] ?? fallback;
        update('Draft discarded.');
        box.focus();
    },{kind:'ghost'});
    const addDefaults = list ? button('Add missing defaults to draft', () => {
        box.value = avoidPhrases([box.value, fallback].join('\n')).join('\n');
        update('Defaults added to the draft. Save list to apply.');
    }, {kind:'ghost'}) : null;
    const validate = value=> typeof value==='string' && value.length<=12000 ? '' : 'Keep the guidance within 12,000 characters.';
    function assertScope() { if (ctx().getCurrentChatId?.()!==chatId) throw new Error('Open the originating chat to save its guidance.'); }
    function commit() {
        assertScope();
        const problem=validate(box.value);
        if (problem) throw new Error(problem);
        local[key]=box.value.trim();
        box.value=local[key];
        saveChatState();
        update('Saved for this chat.');
    }
    let restoreValue;
    const undo=button('Undo restore',()=>{
        try {
            assertScope();
            if (local[key]!==undefined) throw new Error('The active guidance changed after the restore.');
            local[key]=restoreValue;
            box.value=restoreValue;
            saveChatState();
            restoreValue=undefined; undo.hidden=true;
            update('Previous guidance restored.');
        } catch (error) { update(error.message); }
    },{kind:'ghost'});
    undo.hidden=true;
    const variations = !list && variationEditor({owner:promptOwner('chat',chatId,key),readDraft:()=>box.value,
        readActive:()=>local[key] ?? fallback,loadDraft:value=>{box.value=value;update('');},applyDraft:commit,validate});
    const compare = h('details',{},h('summary',{},'Compare with installed default'));
    const differences=h('div'); compare.append(differences);
    function refreshCompare() {
        if (compare.open) differences.replaceChildren(promptComparison({before:fallback,after:box.value,beforeLabel:'Installed default'}));
    }
    compare.ontoggle=refreshCompare;
    const form = h('details',{class:'ri-card ri-tight'},h('summary',{},label,' ',badge),
        h('p',{class:'ri-help'},list ? 'One entry per line. Matches appear in reply Notes. Changes apply to this chat.' : 'Changes apply to this chat.'),box,
        h('div',{class:'ri-row'},button(list ? 'Save list' : 'Save guidance',()=>{
            try { commit(); } catch (error) { update(error.message); }
        },{kind:'primary'}),discard,button('Restore default',()=>{
            try {
                assertScope();
                restoreValue=local[key]; undo.hidden=restoreValue===undefined;
                delete local[key];
                box.value=fallback;
                saveChatState();
                update('Restored the default for this chat.');
            } catch (error) { update(error.message); }
        },{kind:'ghost'}),undo,addDefaults),compare,variations && variations.root,status);
    function update(message) {
        badge.textContent = Object.hasOwn(local,key) ? 'Customized' : 'Default';
        const dirty = box.value!==(local[key] ?? fallback);
        form.toggleAttribute('data-ri-dirty',dirty);
        discard.hidden=!dirty;
        status.textContent=message;
        variations && variations.updateDraftStatus();
        refreshCompare();
    }
    box.addEventListener('input',()=>update(''));
    update('');
    return form;
}

function renderOpening(local, redraw) {
    const list = greetings();
    const state = h('div',{class:'ri-note',id:'ri-opening-feedback',role:'status',hidden:true});
    const notice = text=>{state.textContent=text;state.hidden=false;};
    const execution=h('div');
    const scope=executionScope(), preset=activePreset();
    const form=h('div');
    let draft, controller;
    const area = textArea('',()=>{}, {rows:8, 'aria-label':'Opening preview'});
    const initialGreeting=list.length ? '0' : 'new';
    const markDraft=()=>{area.dataset.v10Draft='';form.dataset.riDirty='';};
    area.addEventListener('input',()=>{markDraft();refreshExecution();});
    const direction = textArea('',markDraft, {placeholder:'Optional direction for a new opening', 'aria-label':'Opening direction'});
    const card = select([{value:'new',label:'Start a blank opening'},...list.map((_,i)=>({value:String(i),label:i ? `Alternate greeting ${i}` : 'Main greeting'}))], initialGreeting,value=>{
        draft = null; area.value = value === 'new' ? '' : list[Number(value)]; markDraft(); refreshExecution();
    },{'aria-label':'Opening source'});
    area.value = list[0] || '';
    const cancel=button('Cancel opening request',()=>controller?.abort(new Error('Opening request cancelled. Your draft is still available.')));
    cancel.hidden=true;
    async function requestOpening(options) {
        area.dataset.v10Draft='';
        controller=new AbortController();
        cancel.hidden=false;
        try { return await draftOpening({...options,signal:controller.signal}); }
        finally { controller=null;cancel.hidden=true; }
    }
    const run = async (event, stateOnly) => {
        if (card.disabled) return;
        const trigger = event.currentTarget;
        trigger.disabled = card.disabled = accept.disabled = area.disabled = direction.disabled = true;
        notice('Preparing opening…');
        try {
            if (stateOnly && !area.value.trim()) throw new Error('Choose or enter a greeting first.');
            draft = await requestOpening(stateOnly ? {text:area.value} : {direction:direction.value});
            if (!stateOnly) card.value='new';
            area.value = draft.prose;
            markDraft();
            notice('Review the draft before using it. Edits are checked against the proposed story facts.');
        } catch (error) { notice(error.message); }
        finally {trigger.disabled=card.disabled=accept.disabled=area.disabled=direction.disabled=false;refreshExecution();}
    };
    const needsRead=()=>!!area.value.trim() && !draft && !/<story_update[ >]/i.test(area.value);
    const accept = button('Use this opening',async () => {
        accept.disabled = card.disabled = area.disabled = direction.disabled = true;
        try {
            if (executionScope() !== scope || activePreset() !== preset) throw new Error('The chat or preset changed.');
            const text = area.value;
            if (!text.trim()) throw new Error('Choose, generate, or enter an opening first.');
            if (needsRead()) {
                notice('Reading opening state…');
                draft = await requestOpening({text});
            }
            if (executionScope() !== scope || activePreset() !== preset) throw new Error('The chat or preset changed.');
            await acceptV10Opening(draft,text); redraw();
        } catch(error) {
            notice(error.message);
            state.scrollIntoView({block:'nearest'});
            accept.disabled=card.disabled=area.disabled=direction.disabled=false;
            refreshExecution();
        }
    }, {kind:'primary'});
    function refreshExecution() {
        accept.textContent=needsRead() ? 'Read state and use this opening' : 'Use this opening';
        if (needsRead()) executionAction(accept);
        else { delete accept.dataset.riModelCost; accept.removeAttribute('aria-description'); }
        execution.replaceChildren(functionExecution('storyOpening',{receipt:executionReceipt('storyOpening')}));
    }
    refreshExecution();
    const available = (ctx().chat || []).length <= 1 && !ctx().chat?.[0]?.extra?.[KEY]?.v10;
    form.append(scoped('Choose a greeting',card),scoped('Opening direction',direction),
            h('label',{class:'ri-row'},h('input',{type:'checkbox',checked:local.openingPlayerThoughts===true,onchange:event=>{
                local.openingPlayerThoughts=event.currentTarget.checked;saveChatState();
            }}),'Allow the generated opening to write my character’s internal thoughts'),
            h('div',{class:'ri-row'},executionAction(button('Generate opening',event=>run(event,false))),executionAction(button('Read state from selected greeting',event=>run(event,true))),cancel),state,execution,
            scoped('Review or edit opening',area),h('p',{class:'ri-help'},'Using this opening sets the first reply and files its story facts in this chat.'),accept);
    return section('Opening setup',available ? form : h('p',{class:'ri-help'},'Opening setup is available at the start of a chat.'),
        profileEditor(local,'opening','Opening message guidance',OPENING),
        slot(['systemOpening','readGreeting','openingPlayerThoughts','sceneOpening'],'Customize opening and greeting prompts'));
}

function renderDice(local, redraw) {
    const actor = select([{value:'user',label:ctx().name1 || 'Player'}, {value:'char',label:ctx().name2 || 'Character'}], 'user',()=>{}, {'aria-label':'Actor'});
    const stat = select(options(statNames()), statNames()[0],()=>{}, {'aria-label':'Stat'});
    const action = textInput('',()=>{}, {placeholder:'What are they attempting?', 'aria-label':'Action to check'});
    const difficulty = h('input',{type:'number',min:1,max:40,value:12,'aria-label':'Difficulty'});
    const receipt = h('p',{class:'ri-help','role':'status'},checkText(local.check) || 'No check queued.');
    const last = ctx().chat?.at(-1)?.extra?.[KEY]?.v10Check;
    return section('Action check', h('p',{class:'ri-help'},'Choose the actor, action, stat, and difficulty before rolling. Send your next message normally to use the result.'),
        h('div',{class:'ri-grid2'}, scoped('Actor',actor),scoped('Action',action),scoped('Stat',stat),scoped('Difficulty',difficulty)),
        h('div',{class:'ri-row'},button('Roll for next reply',()=>{try { receipt.textContent=checkText(queueCheck(action.value,stat.value,Number(difficulty.value),actor.value)); } catch(error){problem(error);} }),
            button('Clear queued check',()=>{delete local.check;saveChatState();redraw();}),
            last ? button('Reroll check and replace latest reply',()=>guideSwipe('Rewrite this reply using the newly resolved action check. Preserve the attempted action and other applicable directions.',{repeatOrders:true,rerollDice:true}).catch(problem)) : null), receipt);
}

function guidelineScope(local, book, entry) {
    const old = local.guidelineScopes;
    const scope = { ...(old && Object.hasOwn(old, book) ? old[book][entry.uid] : null) };
    const save = (key, value) => {
        if (prefs() !== local) return;
        const scopes = local.guidelineScopes ||= {};
        const entries = Object.hasOwn(scopes, book) ? scopes[book] : {};
        if (value === '' || value === true) delete scope[key];
        else scope[key] = value;
        entries[entry.uid] = scope;
        Object.defineProperty(scopes, book, { value:entries, writable:true, configurable:true, enumerable:true });
        saveChatState();
    };
    return h('details', { class:'ri-book-scope' },
        h('summary', {}, 'Chat-specific conditions'),
        scoped('Use this entry in this chat', h('input', { type:'checkbox', checked:scope.enabled!==false, onchange:event=>save('enabled',event.currentTarget.checked) })),
        scoped('Required extension module', select([{value:'',label:'Any'}, ...Object.entries(MODULES).map(([value,label])=>({value,label}))],scope.module || '',value=>save('module',value))),
        scoped('Character in scene', textInput(scope.character || '',value=>save('character',value.trim()),{placeholder:'Any character'})),
        scoped('Scene location', textInput(scope.location || '',value=>save('location',value.trim()),{placeholder:'Any location'})));
}

function reusableBookControls(local, redraw, memory, app) {
    const assigned = reusableAssignments(local);
    const available = reusableBookNames().filter(name => name !== local.base?.name && !assigned.some(book => book.name === name));
    const roles = Object.entries(reusableBookRoles).filter(([key]) => !memory || key === 'reference');
    const role = select(roles.map(([value,label]) => ({value,label})), memory ? 'reference' : 'guidelines', () => {}, {'aria-label':'Reusable book role'});
    const picker = select([{value:'',label:'Choose an existing book'}, ...options(available)], '', () => {}, {'aria-label':'Existing reusable book'});
    const files = h('input', {type:'file', multiple:true, accept:'.json,application/json', 'aria-label':'Reusable book JSON files'});
    const name = textInput('', () => {}, { 'aria-label':'New book name', placeholder:'New book name' });
    const upload = button('Upload and assign books', async () => {
        const batch = [...files.files];
        if (!batch.length) { files.click(); return; }
        upload.disabled = true;
        const chosenRole = role.value;
        let imported = 0;
        for (const file of batch) {
            if (prefs() !== local) break;
            try { await uploadReusableBook(file, chosenRole); imported++; }
            catch (error) { toast('error', `${file.name}: ${error.message}`); }
        }
        if (imported) toast('success', `Assigned ${imported} ${imported === 1 ? 'book' : 'books'}.`);
        redraw();
    });
    return section('Guideline and reference books',
        field('Role for books you add', 'Guidelines supply writing nudges. Reference books hold facts about people, places, or anything else.', role),
        assigned.length ? h('p', {class:'ri-help'}, 'Pausing a book stops its use here. Unassigning leaves any host World Info selection in effect.') : null,
        h('div', {class:'ri-row'}, picker, button('Assign book', () => {
            if (!picker.value) return;
            try { assignReusableBook(picker.value, role.value); redraw(); } catch (error) { problem(error); }
        })),
        h('div', {class:'ri-row'}, files, upload),
        h('details', {}, h('summary', {}, 'Create an empty book'),
            field('Name', 'The new book uses the selected role. Add entries from the new book’s card.', name),
            button('Create and assign', async () => {
                const chosenRole = role.value;
                try {
                    const book = await createReusableBook(name.value);
                    if (prefs() !== local) return;
                    assignReusableBook(book, chosenRole);
                    redraw();
                } catch (error) { problem(error); }
            })),
        assigned.map(book => h('div', {class:'ri-card ri-tight ri-assigned-book', 'data-book-name':book.name},
            h('strong', {}, book.name),
            h('p', {class:'ri-help'}, reusableBookRoles[book.role]),
            h('div', {class:'ri-row'},
                button(book.on === false ? 'Enable in this chat' : 'Pause in this chat', () => { assignReusableBook(book.name, book.role, book.on === false); redraw(); }),
                button('Unassign', () => { unassignReusableBook(book.name); redraw(); }, {kind:'ghost'}),
                book.role === 'guidelines' && !memory ? button('Copy to Random Instructions', async event => {
                    const control = event.currentTarget;
                    control.disabled = true;
                    try {
                        const name = await copyGuidelinesToInstructions(book.name);
                        toast('success','Created an inactive instruction set. Review it before turning it on.');
                        if (prefs() === local) {
                            await app.openPage('instructions',{editor:{view:'set',name},focusPage:true});
                        }
                    } catch (error) { problem(error); }
                    finally { control.disabled = false; }
                }, {kind:'ghost', title:'Create an inactive set so you can review the guidance and its triggers'}) : null),
            bookEntryEditor(book.name, { reusable:true,
                entryOptions: book.role === 'guidelines' && !memory ? entry => guidelineScope(local, book.name, entry) : null,
            }))));
}

function renderBooks(local, redraw, app, baseOnly = false) {
    const books = [{value:'',label:'None'},...options(reusableBookNames())];
    const pinned = baseWorld(local);
    const base = select(books,pinned?.name || '',async name=>{try { await pinBase(name); redraw(); } catch(error) { problem(error); redraw(); }});
    const file = h('input',{type:'file',accept:'.json,application/json','aria-label':'Base World JSON file'});
    const upload = button('Upload and assign Base World',async()=>{
        if (!file.files[0]) { file.click(); return; }
        upload.disabled = true;
        try {
            const imported = await uploadBaseBook(file.files[0]);
            toast('success',`Assigned "${imported}" as Base World.`);
            redraw();
        } catch (error) { problem(error); }
        finally { upload.disabled = false; }
    });
    const pins = pinned ? h('details',{class:'ri-card ri-tight'},h('summary',{},'Pinned facts for opening'),
        Object.values(pinned.entries || {}).filter(row=>!row.disable).map(row=>h('label',{class:'ri-row'},
            h('input',{type:'checkbox',checked:pinned.pins?.includes(String(row.uid)),onchange:event=>{
                const ids = new Set(pinned.pins || []);
                if (event.currentTarget.checked) ids.add(String(row.uid)); else ids.delete(String(row.uid));
                pinned.pins = [...ids];
                saveChatState();
            }}),row.comment || row.key?.[0] || `Entry ${row.uid}`))) : null;
    return section('Reusable lorebooks',
        field('Base World','Choose an existing World Info book or upload a native JSON export. The pinned copy keeps its triggers.',base,
            pinned ? button('Refresh pinned copy',()=>pinBase(pinned.name).then(redraw).catch(problem)) : null,
            local.base && !pinned && h('p',{class:'ri-help'},'The previously pinned Base World is no longer available. Choose another book to replace it.'),
            h('div',{class:'ri-row'},file,upload)),
        pins,
        reusableBookControls(local, redraw, baseOnly, app),
        h('div',{class:'ri-row'},
            button('Review World Info selections',()=>app.openPage('sent'),{kind:'ghost'}),
            !baseOnly && button('World Info display settings',()=>app.openPage('display'),{kind:'ghost'})));
}

function editRecord(original, save, cancel, kinds) {
    const modules = effectiveModules();
    const type = select(options(kinds.filter(k=>k===original?.kind || modules[KIND_MODULE[k]])),original?.kind || kinds.find(k=>modules[KIND_MODULE[k]]),render,{'aria-label':'Record type'});
    type.disabled = !!original;
    const root = h('div',{class:'ri-state-editor'});
    const id = textInput(original?.id || '',()=>{}, {'aria-label':'Record ID',disabled:!!original,maxLength:64});
    const subject = textInput(original?.subject || '',()=>{}, {'aria-label':'Subject or speaker'});
    const text = textArea(original?.text || '',()=>{}, {'aria-label':'Record text'});
    const lock = h('input',{type:'checkbox',checked:original?.protected ?? !original});
    const chosenLocks = new Set();
    const dirty = () => {root.dataset.riDirty='';};
    root.addEventListener('input',dirty);
    root.addEventListener('change',dirty);
    function render() {
        const k = type.value;
        const inputs = {};
        const string = (key,label) => {
            const value = Array.isArray(original?.[key]) ? original[key].join(', ') : original?.[key] ?? '';
            inputs[key] = textInput(value,()=>{}, {'aria-label':label});
            return scoped(label,inputs[key]);
        };
        const choice = (key,label,values,fallback) => {
            inputs[key] = select(options(values),original?.[key] ?? fallback,()=>{}, {'aria-label':label});
            return scoped(label,inputs[key]);
        };
        const flag = (key,label,initial) => {
            inputs[key] = h('input',{type:'checkbox',checked:original?.[key] ?? initial});
            return h('label',{},inputs[key], ' ',label);
        };
        const axes = {};
        const profileLocks = {};
        root.replaceChildren(h('p',{class:'ri-help'},'This chat · Saves to the current story records.'),
            scoped('Record type',type),scoped(original ? 'Record ID' : 'Record ID (optional)',id),scoped('Subject',subject),scoped('Record',text),
            h('label',{},lock,' Protect this record from automatic changes'));
        if (k === 'knowledge') root.append(choice('basis','Source type',['observed','reported','rumor','belief'],'observed'),flag('private','Limit to relevant character',true));
        if (k === 'fact') {
            const pinned = baseEntries();
            const entries = pinned.map(entry=>({value:String(entry.uid),label:entry.comment || entry.key?.[0] || `Entry ${entry.uid}`}));
            inputs.baseEntry=select([{value:'',label:'None'},...entries],original?.baseEntry || '',()=>{}, {'aria-label':'Base World entry'});
            root.append(string('aliases','Relevance aliases'),string('link','Related plot record ID'),
                scoped('Base World entry',inputs.baseEntry),choice('baseRelation','Relationship to Base World',['extends','updates-present','contradicts'],'extends'));
        }
        if (k === 'relationship') root.append(string('other','Other character'),string('perspective','One-sided perspective'));
        if (k === 'profile') {
            root.append(string('voice','Voice'),string('facet','Current facet or mask'),string('aliases','Aliases'));
            for (const [key,label] of [['text','Portrayal'],['voice','Voice'],['aliases','Aliases'],['facet','Facet']]) {
                const info = original?.profileFields?.[key];
                profileLocks[key] = h('input',{type:'checkbox',checked:info?.locked ?? false,onchange:()=>chosenLocks.add(key)});
                const target = key === 'text' ? text : inputs[key];
                target.addEventListener('input',()=>{
                    if (!chosenLocks.has(key)) profileLocks[key].checked = true;
                });
                const reset = original?.baseline?.[key] !== undefined ? button('Restore source',()=>{
                    const source = original.baseline[key];
                    target.value = Array.isArray(source) ? source.join(', ') : source;
                    profileLocks[key].checked = false;
                    chosenLocks.add(key);
                    dirty();
                },{kind:'ghost'}) : null;
                root.append(h('div',{class:'ri-row'},h('label',{},profileLocks[key],` Protect ${label.toLowerCase()}`),
                    info ? h('span',{class:'ri-help'},`Revision ${info.revision} · ${info.source}`) : null,reset));
            }
        }
        if (k === 'emotion') {
            root.append(string('target','Feeling toward'),string('counterweight','Coexisting feeling'));
            const scores = h('div',{class:'ri-grid2'});
            for (const axis of AXES) {
                axes[axis] = h('input',{type:'number',min:0,max:10,value:original?.axes?.[axis] ?? '', 'aria-label':axis});
                scores.append(scoped(axis,axes[axis]));
            }
            root.append(scores,string('outward','Outward behavior'));
        }
        if (k === 'agenda') root.append(string('whereabouts','Established whereabouts'));
        if (k === 'agenda') for (const [key,label] of [['from','Starting place'],['to','Destination'],['departed','Departure story minute'],['minutes','Minimum travel minutes']]) {
            const input = textInput(original?.travel?.[key] ?? '',()=>{}, {'aria-label':label});
            inputs[`travel.${key}`] = input;
            root.append(scoped(label,input));
        }
        if (PLOT_KINDS.includes(k)) root.append(choice('status','Status',['open','done','retired'],'open'),
            string('parent','Parent arc ID'),string('requires','Required record IDs (comma separated)'),string('location','Required location'),string('due','Due story minute'),
            string('payoff','Optional payoff guidance'),string('outcome','Established outcome'),flag('schedule','Allow automatic scheduling',false),string('weight','Selection weight'),string('spacing','Minimum spacing in replies'));
        const failure = h('p',{role:'status',class:'ri-help'});
        const submit = button('Save record',async()=>{
            submit.disabled=true;
            try {
                const value = {kind:k,id:id.value.trim(),subject:subject.value,text:text.value,protected:lock.checked};
                if (!value.text.trim()) {text.focus();throw new Error('Enter the record text.');}
                if (value.id && !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value.id)) {id.focus();throw new Error('Use a letter or number to start the record ID. Use letters, numbers, hyphens, or underscores.');}
                if (['profile','knowledge','emotion','relationship','agenda'].includes(k) && !value.subject.trim()) {
                    subject.focus();throw new Error('Enter the character’s name in Subject.');
                }
                for (const [key,input] of Object.entries(inputs)) {
                    if (key.startsWith('travel.')) {
                        if (!input.value.trim()) continue;
                        const field = key.slice(7);
                        (value.travel||={})[field]=['departed','minutes'].includes(field) ? Number(input.value) : input.value.trim();
                    } else if (input.type === 'checkbox') value[key]=input.checked;
                    else if (['requires','aliases'].includes(key)) value[key]=input.value.split(',').map(x=>x.trim()).filter(Boolean);
                    else if (['due','weight','spacing'].includes(key)) { if (input.value.trim()) value[key]=Number(input.value); }
                    else value[key]=input.value;
                }
                if (Object.keys(axes).length) value.axes=Object.fromEntries(Object.entries(axes).filter(([,input])=>input.value!=='').map(([key,input])=>[key,Number(input.value)]));
                if (k === 'profile') {
                    value.lockFields=Object.keys(profileLocks).filter(key=>profileLocks[key].checked);
                    if (original?.source) value.changedFields=Object.keys(profileLocks).filter(key=>{
                        const fallback = key==='aliases' ? [] : '';
                        return chosenLocks.has(key) || JSON.stringify(value[key] ?? fallback) !== JSON.stringify(original[key] ?? fallback);
                    });
                    value.baseline=original?.baseline;
                }
                await save(value,{create:!original});
            } catch(error) {failure.textContent=error.message;submit.disabled=false;}
        },{kind:'primary'});
        root.append(h('div',{class:'ri-row'},submit,button('Cancel',cancel)),failure);
    }
    render();
    return root;
}

function renderRecords(redraw, title, kinds, app) {
    const list = h('div');
    const editor = h('div');
    const scope=executionScope();
    const key=JSON.stringify([scope,title]);
    const filters=app.recordFilters ||= new Map();
    const status=h('p',{role:'status',class:'ri-help'},'Loading records…');
    const search=textInput(filters.get(key) || '',value=>{
        filters.set(key,value);
        filter();
    },{type:'search','aria-label':`Search ${title.toLowerCase()}`,placeholder:'Search by name, wording or status'});
    let records=[];
    const save = async (value,options)=>{
        if (scope!==executionScope()) throw new Error('The chat changed. Open this record in its own chat.');
        await writeRecord(value,options);
        if (scope===executionScope()) redraw();
    };
    const open = async record=>{
        if (editor.querySelector('[data-ri-dirty]') && !await confirmBox('Discard your unsaved record edits?')) return;
        if (scope!==executionScope()) return;
        const form=editRecord(record,save,()=>editor.replaceChildren(),kinds);
        editor.replaceChildren(form);
        editor.scrollIntoView({block:'nearest'});
        editor.querySelector('input,select,textarea')?.focus({preventScroll:true});
    };
    listRecords(kinds).then(rows=>{
        records=rows;
        filter();
    }).catch(error=>{status.textContent=error.message;});
    function filter() {
        const words=search.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
        const shown=records.filter(record=>words.every(word=>[record.id,record.subject,record.other,record.text,record.status,
            record.protected ? 'Protected' : '',entryLabel(record.kind)].join(' ').toLowerCase().includes(word)));
        status.textContent=records.length ? `Showing ${shown.length} of ${records.length} records.` : 'No records yet.';
        list.replaceChildren(...(shown.length ? shown.map(record=>h('details',{class:'ri-card ri-tight'},
            h('summary',{},[entryLabel(record.kind),record.subject || record.id,record.other,record.status,record.protected && 'Protected'].filter(Boolean).join(' · ')),
            h('p',{},record.text),record.voice && h('p',{class:'ri-help'},`Voice · ${record.voice}`),
            record.baseline?.sources?.length && h('p',{class:'ri-help'},`Sources · ${record.baseline.sources.join(' · ')}`),
            record.baseEntry && record.baseRelation==='contradicts' && h('p',{class:'ri-note'},'Base World conflict. This correction applies in this chat.'),
            h('p',{class:'ri-help'},['This chat',record.id,record.basis,record.source==='user'?'Edited by player':record.quote].filter(Boolean).join(' · ')),
            button('Edit',()=>open(record))))
            : records.length ? [h('p',{class:'ri-help'},'No records match the search.')] : []));
    }
    const canAdd = kinds.some(kind=>effectiveModules()[KIND_MODULE[kind]]);
    return section(title,h('div',{class:'ri-row'},search,canAdd ? button('Add record',()=>open(null),{kind:'primary'}) : null),status,editor,list);

}

function renderSpeakers(local) {
    const target = document.querySelector('#chat .last_mes .mes_text');
    return section('Dialogue colors',
        Object.entries(local.speakers || {}).map(([key,speaker])=>{
            const picker=h('input',{type:'color',value:speaker.color,'aria-label':`Color for ${speaker.name}`});
            const status=h('span',{class:'ri-help'});
            const sample=h('q',{class:'ri-speaker-sample'},'I’m ready when you are.');
            const update=()=>{
                const theme = target && displayColor(speaker.color,target);
                const rendered = theme || displayColor(speaker.color,null);
                status.textContent=`Saved ${speaker.color}${rendered && rendered!==speaker.color ? ` · Displayed ${rendered}` : ''}${theme || !target ? '' : ' · Contrast background applied'}`;
                sample.style.color=displayColor(speaker.color,null) || 'inherit';
            };
            update();
            picker.addEventListener('input',()=>{try {setSpeakerColor(key,picker.value);update();refreshDialogue();}catch(error){problem(error);}});
            return h('div',{class:'ri-card ri-tight'},h('div',{class:'ri-row'},h('label',{},picker,speaker.name),sample),status,
                h('div',{class:'ri-row'},button('Use automatic color',()=>{
                    try {picker.value=chooseAutomaticSpeakerColor(key);update();refreshDialogue();} catch(error) {problem(error);}
                },{kind:'ghost'})));
        }), !Object.keys(local.speakers || {}).length ? h('p',{class:'ri-help'},'Characters appear here as dialogue or thoughts identify them.') : null);
}

const MODULE_HELP = {
    preflight: 'Adds scene, knowledge, cast, pacing and continuity checks to the same reply request.',
    style: 'Sends your Writing Guidance with the reply to steer prose, voice, and pacing.',
    state: 'Tracks the scene, story clock, character snapshots, and durable story facts.',
    knowledge: 'Tracks what each character has observed, heard, or believes.',
    emotions: 'Tracks tunable NPC emotion axes and outward behavior.',
    relationships: 'Keeps brief notes on relationships and meaningful changes.',
    plots: 'Tracks unresolved threads, planted details, payoffs, and off-screen agendas.',
    worldEvents: 'Uses an automatic chance check to offer an optional development. Random Instructions are controlled separately.',
    dice: 'Rolls once when you queue an action in Direction → Action Checks. Regular replies proceed without a roll.',
    colors: 'Colors dialogue and italic thoughts when the prose identifies the character.',
    roast: 'Asks for one reader reaction in the same reply. Edit its voice under Setup → Reply Display.',
    roastFeedback: 'Includes recent Roast commentary as writing feedback in later prompts.',
};
function advancedPrompts(preset, app) {
    return section('Advanced prompts',
        activeHostPrompts() ? presetWorkbench(preset,app) : h('p',{class:'ri-help'},'This host does not expose preset prompt blocks.'),
        h('div',{id:'ri-planning-prompts'},slot(['planGuidance','proseFirst'],'Customize planning and prose prompts')),impersonationInspector());
}

function presetLinks(app) {
    return h('div',{class:'ri-note ri-home-link','data-home-link':'preset'},
        h('span',{},'The active preset, its blocks, the Ours or Theirs switch for each feature and saved loadouts are in Setup, Presets.'),
        button('Open Setup, Presets',()=>app.openPage('presets'),{kind:'ghost'}));
}

function composerLinks(app) {
    return h('section',{id:'ri-composer-settings',class:'ri-section'},
        h('h3',{class:'ri-section-title'},'Composer quick actions'),
        h('p',{class:'ri-help'},'The bar above the message box, its pins and the library of saved quick actions are set in the Quick actions tab.'),
        h('div',{class:'ri-row'},button('Open Quick actions, Bar',()=>app.openPage('quick-bar',{focusPage:true}),{kind:'ghost'}),
            button('Open Quick actions, Library',()=>app.openPage('quick-library',{focusPage:true}),{kind:'ghost'})));
}

function hostOverlap(key, owner, preset, enabled, redraw) {
    const id = `ri-owner-${key}`;
    const active = owner.blocks.some(block=>block.enabled===true);
    const unknown = owner.blocks.some(block=>block.enabled===null);
    let status;
    if (owner.usesExtension) {
        status=enabled ? 'The extension runs this module in this chat.' : 'The extension is selected. Turn the module on to use it in this chat.';
    } else if (owner.choice==='extension') {
        status=active ? 'The host preset still has a matching block on. Turn off the matching blocks in the host Prompt Manager, then recheck them here. The extension waits until all matching blocks are off.'
            : 'The host has not reported the status of every matching block. The extension waits until it can verify that they are off.';
    } else {
        status=active ? 'The host preset has a matching block on. The extension skips this module.'
            : unknown ? 'The host preset is selected. Block status is unavailable. The extension skips this module.'
                : 'All matching host blocks are off. To use this feature, enable a block in the host Prompt Manager or select the extension here.';
    }
    return h('details',{id:`${id}-details`,class:'ri-module-overlap',open:owner.blocked},
        h('summary',{},'Instruction source & diagnostics'),
        h('label',{htmlFor:id},'Preferred instruction source'),
        select([{value:'preset',label:'Host preset'}, {value:'extension',label:'Roleplay Instructions extension'}, ...(owner.choice==='both' ? [{value:'both',label:'Extension enabled alongside independent preset blocks'}] : [])],owner.choice,value=>{
            setModuleOwner(preset,key,value);
            redraw();
            document.getElementById(id)?.focus({preventScroll:true});
        },{id,'aria-describedby':`${id}-status`}),
        h('p',{class:'ri-help',id:`${id}-status`},status),
        owner.choice==='extension' && owner.blocked && button('Recheck these host blocks',()=>{
            redraw();
            document.getElementById(id)?.focus({preventScroll:true});
        },{kind:'ghost'}),
        h('ul',{},owner.blocks.map(block=>h('li',{},`${block.name} · ${block.enabled===null ? 'Status unavailable' : onOff(block.enabled)} in host preset`,
            block.blocks.filter(entry=>entry.content).map(entry=>h('pre',{class:'ri-v10-prompt-text'},entry.content))))));
}
const onOff = value => value ? 'On' : 'Off';

function moduleSettings(local, app, preset, modules, redraw) {
    const canEditPreset = Boolean(preset);
    const editingPreset = canEditPreset && app.moduleScope === 'preset';
    const defaults = presetDefaults(preset);
    const changeScope = scope => {
        app.moduleScope = scope;
        redraw();
        app.root?.querySelector(`[data-module-scope="${scope}"]`)?.focus({preventScroll:true});
    };
    const controlScope = editingPreset ? 'preset' : 'chat';
    const ownership = moduleOwnership(preset);
    const rows = Object.entries(MODULES).map(([key,label])=>{
        const owner = ownership[key];
        const override = local.modules?.[key];
        const presetValue = defaults[key];
        const defaultOn = presetValue ?? DEFAULT_MODULES[key];
        const value = editingPreset ? presetValue : override;
        const fallback = editingPreset ? DEFAULT_MODULES[key] : defaultOn;
        const resetLabel = editingPreset || !canEditPreset ? 'Use extension factory default' : 'Use extension default for this preset';
        const blocked = !editingPreset && owner && !owner.usesExtension;
        const controlId = `ri-module-${key}`;
        const update = next => {
            if (editingPreset) {
                savePresetDefault(preset,key,next);
                saveSettings();
            } else {
                const over = local.modules ||= {};
                if (next === undefined) delete over[key];
                else over[key]=next;
                saveChatState();
            }
            redraw();
            document.getElementById(controlId)?.focus({preventScroll:true});
        };
        const control = select([{value:'on',label:'On'}, {value:'off',label:'Off'}],(blocked ? false : value ?? fallback) ? 'on' : 'off',
            selected=>update(selected==='on'),{id:controlId,disabled:blocked,'aria-describedby':`${controlId}-help ${controlId}-status`});
        const hostBlockOn = blocked && owner.blocks.some(block=>block.enabled===true);
        const message = editingPreset
            ? `Extension default for this preset: ${onOff(value ?? fallback)}`
            : hostBlockOn ? 'Host block on · Extension off' : blocked ? 'Extension off in this chat' : `${onOff(modules[key])} in this chat`;
        const moduleRow = h('div',{class:'ri-module-row','data-module':key},
            h('div',{class:'ri-module-heading'},
                blocked ? h('strong',{},label) : h('label',{htmlFor:controlId},label),
                h('span',{class:'ri-module-status',id:`${controlId}-status`,'data-enabled':String(editingPreset ? value ?? fallback : modules[key])},message)),
            h('p',{class:'ri-help',id:`${controlId}-help`},MODULE_HELP[key]),
            owner && !editingPreset ? hostOverlap(key,owner,preset,modules[key],redraw) : null,
            !blocked && h('div',{class:'ri-row ri-module-actions'},control,value!==undefined
                ? button(`${resetLabel} (${onOff(fallback)})`,()=>update(undefined),{kind:'ghost'}) : null),
            !blocked && h('p',{class:'ri-help'},value===undefined
                ? editingPreset || !canEditPreset ? 'Using the extension’s factory default.' : presetValue===undefined ? 'Following the extension factory default for this preset.' : 'Following the extension default saved for this preset.'
                : editingPreset ? (override===undefined ? 'Applies to chats that follow this preset.' : `This chat keeps its own setting (${onOff(override)}).`)
                    : 'Saved for this chat.'));
        if (key === 'roast') moduleRow.dataset.control = 'roast-switches';
        return moduleRow;
    });
    return section('Extension modules',
        h('div',{class:'ri-module-scopes',role:'group','aria-label':'Settings scope'},
            h('button',{type:'button',class:'ri-btn ri-btn-ghost','data-module-scope':'chat','aria-pressed':String(controlScope==='chat'),
                onclick:()=>changeScope('chat')},'This chat'),
            h('button',{type:'button',class:'ri-btn ri-btn-ghost','data-module-scope':'preset','aria-pressed':String(controlScope==='preset'),
                disabled:!canEditPreset,onclick:()=>changeScope('preset')},'Extension defaults for this preset')),
        h('p',{class:'ri-help'},editingPreset
            ? `Set extension module defaults for chats that use “${preset}”. Chats with their own settings keep them.`
            : canEditPreset ? `Changes here apply only to this chat. Use the extension default to follow the settings saved for “${preset}”.`
            : 'Changes here apply only to this chat. Reset a changed setting to follow the extension again.'),
        !editingPreset && Object.keys(ownership).length ? h('div',{class:'ri-note'},'Instruction source is saved for this chat and preset. Related blocks are managed in the host preset editor. The extension yields while those blocks are on or their status is unavailable.',
            h('div',{class:'ri-row'},button('Refresh source status',redraw,{kind:'ghost'}))) : null,
        ...[
            ['Writing & reply display',['style','preflight','colors','roast','roastFeedback']],
            ['Story state & character continuity',['state','knowledge','emotions','relationships']],
            ['Plot & mechanics',['plots','worldEvents','dice']],
        ].map(([label,keys])=>h('div',{class:'ri-module-list'},
            h('h3',{class:'ri-label'},label),keys.map(key=>rows.find(row=>row.dataset.module===key)))));
}

function statsFold(app) {
    const dice = diceSection(app);
    return h('details',{class:'ri-card ri-tight',id:'ri-dice-stats',open:!!app.legacyControlsOpen,ontoggle:event=>{app.legacyControlsOpen=event.currentTarget.open;}},
        h('summary',{},'Stats'),
        h('p',{class:'ri-help'},'Stats and the legacy dice defaults.'),
        ...[...dice.children].slice(1),
        slot(['dice'],'Customize dice instruction'));
}

const roastVoice = () => {
    const editor = roastVoiceEditor(['structuredRoast','roastFeedback'],'Roast commentator voice and feedback');
    editor.dataset.promptSlot = '';
    editor.dataset.promptIds = 'structuredRoast roastFeedback';
    return home('roast-voice',editor);
};

export function renderV10(body, app, page) {
    if (!isChatOpen()) {
        if (page==='v10') body.append(presetLinks(app),composerLinks(app),roastVoice(),advancedPrompts(activePreset(),app),versionLine());
        if (page==='display') {
            body.append(homeLink(app,'roast-voice','The Roast commentator voice is edited in Setup, Features.'));
            renderReplyDisplayOptions(body,app);
        }
        if (page==='checks') body.append(statsFold(app));
        return;
    }
    const local = prefs();
    const redraw = () => {
        app.render();
        import('./sent.js').then(module=>module.refreshUnderReplies());
    };
    const preset = activePreset();
    const modules = effectiveModules();
    const chatFlag = (key, label, hint, defaultOn = false) => field(label,hint,
        select(choices.slice(1),(local[key] ?? defaultOn) ? 'on':'off',value=>{local[key]=value==='on';saveChatState();redraw();},
            {id:`ri-${key}`,'aria-label':label}));
    const replyScreening = () => section('Reply screening',
        profileEditor(local,'avoidPhrases','Stock phrases to avoid',DEFAULT_STORY_AVOID,true,true),
        home('npc-avoid',profileEditor(local,'avoidNpcNames','New NPC names to avoid',DEFAULT_NPC_AVOID,true,true)),
        chatFlag('proseMetrics','Show turn length and dialogue share','Add word count and the approximate percentage in quotation marks to the reply’s Notes tab.'),
        chatFlag('proseAudit','Review recent writing with the reply','Add a short review of recurring writing patterns when at least two earlier story replies are available. Notes show which revisions support each finding.'),
        slot(['proseReview'],'Customize the writing review prompt'),
        executionDetails([
            executionPreview('prose-screen',{stage:'code',label:'Local prose screening',trigger:'When the reply is accepted.'}),
            executionPreview('prose-audit',{stage:'reply',label:'Review and next-turn guidance',trigger:'On an ordinary story reply when enabled or supported guidance is ready.'}),
        ]));
    if (page === 'books') {
        if (app.loreTarget) {
            const target=app.loreTarget;
            const back = () => app.back();
            body.append(section('World Info entry',receiptEntryEditor(target,back,(name,entry)=>
                reusableAssignments(local).some(book=>book.name===name && book.role==='guidelines') && !memoryOnly()
                    ? guidelineScope(local,name,entry) : null),
                target.fromReview && button('View all World Info books',()=>app.openPage('books'),{kind:'ghost'})));
            return;
        }
        const manage = enabledV10() || memoryOnly() && memoryComponents().world;
        body.append(storyWorldSection(app));
        if (manage) body.append(renderBooks(local,redraw,app,memoryOnly()));
        body.append(renderChatBooks(app, { assignedEditors:manage }));
        return;
    }
    if (page === 'v10') {
        body.append(section('Roleplay Instructions extension',field('Story workflow for this chat',
            'Choose Structured to use the extension’s reply cards and continuity tools. Choose Memory only to use the host preset for writing and presentation. Legacy uses the original instructions, events and story tools.',
            select([{value:'inherit',label:`Follow active preset (${isCompanionPreset(preset) ? 'Structured' : 'Legacy'})`},
                {value:'memory',label:'Memory only'}, {value:'on',label:'Structured story workflow'},
                {value:'off',label:'Legacy story workflow'}],memoryOnly() ? 'memory' : mode(local.enabled),value=>{
                const cs = chatState();
                if (value==='memory') (cs.components ||= {}).mode='memory';
                else {
                    if (cs.components) delete cs.components.mode;
                    if (value==='inherit') delete local.enabled;
                    else local.enabled=value==='on';
                }
                saveChatState();redraw();
            },{id:'ri-story-workflow','aria-label':'Story workflow for this chat'}))));
        body.append(presetLinks(app),composerLinks(app));
        if (enabledV10()) body.append(h('div',{id:'ri-modules'},home('module-switches',moduleSettings(local,app,preset,modules,redraw))),
            isCompanionPreset(preset)
                ? chatFlag('generatePlan','Request a reply plan','The extension asks for a brief outline before the prose. Show Reply planning in Reply Display controls its card.')
                : h('p',{class:'ri-help'},'To request a reply plan from the extension, select the Roleplay Instructions V10 companion preset in AI Response Configuration.'));
        body.append(roastVoice(),homeLink(app,'world-budget','Memory, budgets and catch-up are in Setup, Memory.'),advancedPrompts(preset,app),versionLine());
        return;
    }
    if (!enabledV10()) {
        if (page==='writing' && !memoryOnly()) {
            body.append(replyScreening());
            return;
        }
        if (page==='display') {
            renderReplyDisplayOptions(body,app,{legacy:!memoryOnly()});
            if (memoryOnly()) body.append(h('p',{class:'ri-help'},'The active host preset supplies reply cards in Memory only.'));
            body.append(homeLink(app,'roast-voice','The Roast commentator voice is edited in Setup, Features.'));
            return;
        }
        body.append(h('div',{class:'ri-note'},
            h('p',{},'Choose the Structured story workflow to use this page.'),
            button('Open workflow settings',()=>app.openPage('v10'),{kind:'ghost'})));
        return;
    }
    switch (page) {
        case 'display':
            body.append(section('Reply Display',
                chatFlag('showStreamSections','Show arriving story sections','Preview the reply cards as their fields arrive. Turn off for a single progress line.',true),
                chatFlag('showPlanning','Show Reply planning','Show any emitted outline in a collapsed disclosure.',true),
                chatFlag('showLore','World Info under replies','Show a collapsed card with the selected entries and their source books. This controls visibility only.',true),
                button('Review World Info selections',()=>app.openPage('sent'),{kind:'ghost'}),
                chatFlag('showRoast','Show Roast cards','Show the saved reader reaction beneath its reply. Choose the commentator voice below.',true),
                sceneCardControl(app,()=>{saveSettings();redraw();}),
                chatFlag('keepTurnGuidance','Keep exact story guidance','Save confirmed extension guidance for inspection in What Was Sent.'),
                homeLink(app,'roast-switches','Roast generation and feedback are switched on in Setup, Features.'),
                homeLink(app,'roast-voice','The Roast commentator voice is edited in Setup, Features.')));
            renderReplyDisplayOptions(body,app);
            break;
        case 'opening': body.append(renderOpening(local,redraw)); break;
        case 'facts': body.append(renderRecords(redraw,'Chat Facts',kindsFor('facts'),app),
            slot(['structuredFacts','structuredRepair'],'Customize fact and repair prompts')); break;
        case 'plots': body.append(renderRecords(redraw,'Plot Records',kindsFor('plots'),app),
            slot(['autonomousEvent','optionalOpportunity','structuredSchedule','structuredOutcomes','lockedPayoff','checkPlot'],'Customize plot and event prompts')); break;
        case 'portrayal': body.append(pronounsSection(app),renderRecords(redraw,'Portrayal & Knowledge',kindsFor('portrayal'),app),
            homeLink(app,'npc-avoid','New NPC names to avoid are set in Direction, Writing, Reply screening.'),slot(['structuredPortrayal','structuredKnowledge','checkKnowledge'],'Customize portrayal and knowledge prompts')); break;
        case 'emotion': {
            if (modules.emotions) {
                const tuning=local.emotion ||= {};
                const dial=(key,label,min,max,fallback)=>scoped(label,h('input',{type:'number',min,max,value:tuning[key]??fallback,'aria-label':label,onchange:e=>{
                    tuning[key]=Math.max(min,Math.min(max,Number(e.currentTarget.value)||0));saveChatState();
                }}));
                body.append(section('Emotion tuning',h('div',{class:'ri-grid2'},dial('baseline','Baseline',0,10,3),dial('persistence','Persistence in replies',0,40,3),dial('recovery','Recovery per reply',0,10,1),
                    scoped('Sensitivity',select(options(['flexible','subtle','responsive']),tuning.sensitivity || 'flexible',value=>{tuning.sensitivity=value;saveChatState();})))));
            }
            body.append(renderRecords(redraw,'Emotions & Relationships',kindsFor('emotion'),app),
                slot(['emotionSensitivity','checkEmotion','structuredEmotions','structuredRelationships'],'Customize emotion and relationship prompts'));
            break;
        }
        case 'speakers': body.append(renderSpeakers(local),slot(['speakerGuidance'],'Customize speaker attribution prompt')); break;
        case 'writing': {
            const hostChecks = hostSceneChecks();
            body.append(section('Writing profile',
                field('Portrayal intensity','Choose the shared guidance used in this chat. Existing character material still has priority.',
                    select([{value:'default',label:'Follow live writing guidance'},...Object.keys(WRITING_PROFILES).map(key=>
                        ({value:key,label:key==='grounded' ? 'Grounded realism' : 'Heightened drama'}))],local.writingProfile || 'default',
                    value=>{local.writingProfile=value;saveChatState();redraw();},{'aria-label':'Portrayal intensity'})),
                local.writingProfile && writingProfileText(local.writingProfile) ? h('p',{class:'ri-help'},writingProfileText(local.writingProfile)) : null,
                slot(Object.values(WRITING_PROFILES),'Customize portrayal profiles')),
                home('live-guidance',profileEditor(local,'style','Live writing guidance',defaultWritingGuidance())),
                home('scene-checks',profileEditor(local,'preflight','Scene and character checks',PREFLIGHT)),
                section('Checks for this chat',
                    h('p',{class:'ri-help'},modules.preflight ? 'The extension sends these enabled checks with a normal reply. Any checks marked Host preset are sent by the preset.'
                        : 'The extension’s checks are off for this chat. Any checks marked Host preset are sent by the preset.'),
                    button('Open module settings',()=>app.openPage('v10',{anchor:'#ri-modules'}),{kind:'ghost'}),
                    ...Object.entries(SCENE_CHECKS).map(([key,label])=>h('label',{class:'ri-row'},
                        h('input',{type:'checkbox',disabled:!!hostChecks[key],checked:!!hostChecks[key] || local.sceneChecks?.[key]!==false,onchange:event=>{
                            (local.sceneChecks ||= {})[key]=event.currentTarget.checked;saveChatState();
                        }}),label,hostChecks[key] && h('span',{class:'ri-help'},`Host preset · ${hostChecks[key]}`))),
                    slot([...Object.keys(SCENE_CHECKS).map(sceneCheckId),'sceneSolo','sceneEnsemble','sceneUnknown','sceneContinue'],'Customize individual scene checks')),
                replyScreening());
            break;
        }
        case 'checks': body.append(statsFold(app),slot(['resolvedActionGuidance'],'Customize action check prompt'),
            modules.dice ? renderDice(local,redraw) : h('div',{class:'ri-note'},
                h('p',{},'Turn on Explicit action checks for this chat.'),
                button('Action check settings',()=>app.openSetting('v10','ri-module-dice','chat'),{kind:'ghost'}))); break;
    }
}

export function refreshDialogue() {
    const active = enabledV10();
    const on = active && effectiveModules().colors;
    const local = ctx().chatMetadata?.[KEY]?.v10;
    const speakers = new Map(Object.values(local?.speakers || {}).flatMap(person=>person.aliases.map(alias=>[alias,person])));
    const owner = active ? moduleOwnership().colors : null;
    const hideLegacy = active && (!owner || owner.usesExtension);
    for (const mes of document.querySelectorAll('#chat .mes')) {
        const area = mes.querySelector('.mes_text');
        const message = ctx().chat?.[Number(mes.getAttribute('mesid'))];
        if (!area || message?.is_user || message?.is_system) continue;
        for (const span of area.querySelectorAll('.ri-speaker-label')) if (!hideLegacy) span.replaceWith(...span.childNodes);
        for (const span of area.querySelectorAll('.ri-speaker-text')) {
            const speaker = speakers.get(span.dataset.speaker);
            if (on && speaker) colorDialogue(span,speaker.color,area);
            else span.replaceWith(...span.childNodes);
        }
        if (!hideLegacy && (!on || !speakers.size)) continue;
        for (const paragraph of area.querySelectorAll('p, li')) {
            if (paragraph.querySelector('.ri-speaker-text') || paragraph.closest('blockquote, pre')) continue;
            const labels = paragraph.querySelectorAll('.ri-speaker-label');
            if (!on && labels.length) continue;
            for (const label of labels) label.replaceWith(...label.childNodes);
            const nodes = [];
            const emphasis = new Map();
            let source = '';
            const walker = document.createTreeWalker(paragraph,NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
            while (walker.nextNode()) {
                const node = walker.currentNode;
                if (node.nodeName === 'BR') source += '\n';
                if (node.nodeType !== Node.TEXT_NODE) continue;
                const start = source.length;
                source += node.textContent;
                const end = source.length;
                nodes.push({node,start,end});
                const italic = node.parentElement?.closest('em, i');
                if (italic) emphasis.set(italic,{start:emphasis.get(italic)?.start ?? start,end,thought:true});
            }
            const thoughts = thoughtAttributions(source,[...emphasis.values()]);
            const matches = [...dialogueAttributions(source),...thoughts].sort((a,b)=>b.start-a.start || Number(b.thought)-Number(a.thought));
            for (const match of matches) {
                const key = match.name.toLowerCase().replace(/\s+/g,' ');
                const speaker = speakers.get(key);
                if (on && speaker) {
                    const span = h('span',{class:`ri-speaker-text${match.thought ? ' ri-speaker-thought' : ''}`,'data-speaker':key,title:speaker.name});
                    if (wrapTextRange(nodes,match.start,match.end,span,match.thought)) colorDialogue(span,speaker.color,area);
                }
                if (hideLegacy && match.labelStart !== undefined) {
                    wrapTextRange(nodes,match.labelStart,match.start,h('span',{class:'ri-speaker-label',hidden:true}));
                }
            }
        }
    }
}

function wrapTextRange(nodes, start, end, span, thought = false) {
    const first = nodes.find(item=>item.start <= start && start < item.end);
    const last = nodes.find(item=>item.start < end && end <= item.end);
    const excluded = thought ? 'code, a, q' : 'code, a, em, i';
    if (!first || !last || first.node.parentElement?.closest(excluded) || last.node.parentElement?.closest(excluded)) return false;
    const range = document.createRange();
    range.setStart(first.node,start-first.start);
    range.setEnd(last.node,end-last.start);
    span.append(range.extractContents());
    range.insertNode(span);
    return true;
}

function colorDialogue(span,saved,area) {
    const theme = displayColor(saved,area);
    span.classList.toggle('ri-speaker-panel',!theme);
    span.style.color = theme || displayColor(saved,null) || '';
}

let refreshTimer;
const themeObserver = new MutationObserver(()=>{
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshDialogue,100);
});
for (const root of [document.documentElement,document.body]) if (root) themeObserver.observe(root,{attributes:true,attributeFilter:['class','style','data-theme']});
