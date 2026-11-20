import { renderChatBooks } from './chat-books.js';
import { memoryOnly, memoryComponents } from '../components.js';
import { setMemoryComponent } from '../hide.js';
import { dialogueAttributions, thoughtAttributions } from '../dialogue.js';
import { h, button, select, section, field, textArea, textInput } from './dom.js';
import { ctx, KEY, isChatOpen, toast, isGenerating, loadBook } from '../st.js';
import { settings, chatState, saveSettings, saveChatState } from '../store.js';
import { acceptV10Opening, guideSwipe } from '../engine.js';
import { saveV10Record } from '../worldflow.js';
import { statNames } from '../dice.js';
import {
    MODULES, DEFAULT_MODULES, KIND_MODULE, PLOT_KINDS, AXES, defaultWritingGuidance, OPENING,
    PRESET, activePreset, activeHostPrompts, presetDefaults, savePresetDefault, moduleOwnership, setModuleOwner, prefs, enabledV10, effectiveModules, pinBase, selectGuidelines, reusableBookNames, uploadBaseBook, createGuidelines, queueCheck, checkText, rowsForWorld,
    readRecord, portrayalSources, baselineFor, effectivePortrayal, greetings, draftOpening, setSpeakerColor, displayColor,
} from '../v10.js';

const options = names => names.map(name => ({ value:name, label:name }));
const choices = [{value:'inherit',label:'Inherit preset'}, {value:'on',label:'On'}, {value:'off',label:'Off'}];
const mode = value => value === undefined ? 'inherit' : value ? 'on' : 'off';
const problem = error => toast('error', error.message || String(error));
const entryLabel = kind => ({fact:'Fact',profile:'Portrayal',knowledge:'Knowledge',emotion:'Emotion',relationship:'Relationship',arc:'Arc milestone',seed:'Seed',agenda:'Agenda',event:'Event'})[kind];
const scoped = (label, control) => h('label',{class:'ri-field'},h('span',{class:'ri-label'},label),control);

function profileEditor(local, key, label, fallback, redraw) {
    const box = textArea(local[key] ?? fallback, () => {}, {rows:5,'aria-label':label});
    return h('details',{class:'ri-card ri-tight'},h('summary',{},label),box,
        h('div',{class:'ri-row'}, button('Save guidance',() => { local[key] = box.value.trim(); saveChatState(); }),
            button('Restore default',() => { delete local[key]; saveChatState(); redraw(); })));
}

function renderOpening(local, redraw) {
    const list = greetings();
    const state = h('div',{class:'ri-note','role':'status'});
    const chatId = ctx().getCurrentChatId?.();
    let draft;
    const area = textArea('',()=>{}, {rows:8, 'aria-label':'Opening preview'});
    area.addEventListener('input',()=>{area.dataset.v10Draft='';});
    const direction = textArea('',()=>{}, {oninput:()=>{area.dataset.v10Draft='';},placeholder:'Optional direction for a new opening', 'aria-label':'Opening direction'});
    const card = select([{value:'new',label:'Generate a new opening'},...list.map((_,i)=>({value:String(i),label:i ? `Alternate greeting ${i}` : 'Main greeting'}))], list.length ? '0':'new',value=>{
        draft = null; area.value = value === 'new' ? '' : list[Number(value)];
    },{'aria-label':'Opening source'});
    area.value = list[0] || '';
    const run = async (event, stateOnly) => {
        const trigger = event.currentTarget;
        trigger.disabled = true;
        state.textContent = 'Preparing opening…';
        try {
            if (stateOnly && !area.value.trim()) throw new Error('Choose or enter a greeting first.');
            area.dataset.v10Draft='';
            draft = await draftOpening(stateOnly ? {text:area.value} : {direction:direction.value});
            area.value = draft.prose;
            state.textContent = 'Review the draft before using it. Edits are checked against the proposed story facts.';
        } catch (error) { state.textContent = error.message; } finally { trigger.disabled = false; }
    };
    const accept = button('Use this opening',async () => {
        accept.disabled = true;
        try {
            if (ctx().getCurrentChatId?.() !== chatId) throw new Error('The chat changed.');
            const text = area.value;
            if (!text.trim()) throw new Error('Choose, generate, or enter an opening first.');
            if (!draft && !/<story_update[ >]/i.test(text)) {
                state.textContent = 'Reading opening state…';
                draft = await draftOpening({text});
            }
            await acceptV10Opening(draft,text); redraw();
        } catch(error) { state.textContent=error.message; accept.disabled=false; }
    }, {kind:'primary'});
    const available = (ctx().chat || []).length <= 1 && !ctx().chat?.[0]?.extra?.[KEY]?.v10;
    return section('Opening setup',profileEditor(local,'opening','Opening message guidance',OPENING,redraw),
        available ? [scoped('Greeting source',card),direction,
            h('label',{class:'ri-row'},h('input',{type:'checkbox',checked:local.openingPlayerThoughts===true,onchange:event=>{
                local.openingPlayerThoughts=event.currentTarget.checked;saveChatState();
            }}),'Allow the generated opening to write my character’s internal thoughts'),
            h('div',{class:'ri-row'},button('Generate opening',event=>run(event,false)),button('Read state from selected greeting',event=>run(event,true))),
            scoped('Review or edit opening',area), accept,state] : h('p',{class:'ri-help'},'Opening setup is available at the start of a chat.'));
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

function guidelineScopes(local) {
    const book = local.guidelines;
    if (!book || local.guidelinesOn===false) return null;
    const entries = h('div',{class:'ri-help'},'Loading entries…');
    loadBook(book).then(data=>{
        if (!entries.isConnected) return;
        const scopes = local.guidelineScopes || {};
        const existing = Object.hasOwn(scopes,book) ? scopes[book] : {};
        const rows = Object.values(data?.entries || {});
        entries.replaceChildren(...(rows.length ? rows.map(entry=>{
            const scope = {...existing[entry.uid]};
            const save = (key,value) => {
                if (value==='' || value===true) delete scope[key];
                else scope[key]=value;
                existing[entry.uid]=scope;
                Object.defineProperty(scopes,book,{value:existing,writable:true,configurable:true,enumerable:true});
                local.guidelineScopes=scopes;
                saveChatState();
            };
            return h('details',{class:'ri-card ri-tight'},
                h('summary',{},entry.comment || entry.key?.[0] || `Entry ${entry.uid}`),
                scoped('Use this entry in this chat',h('input',{type:'checkbox',checked:scope.enabled!==false,onchange:event=>save('enabled',event.currentTarget.checked)})),
                scoped('Required extension module',select([{value:'',label:'Any'},...Object.entries(MODULES).map(([value,label])=>({value,label}))],scope.module || '',value=>save('module',value))),
                scoped('Character in scene',textInput(scope.character || '',value=>save('character',value.trim()),{placeholder:'Any character'})),
                scoped('Scene location',textInput(scope.location || '',value=>save('location',value.trim()),{placeholder:'Any location'})),
                entry.disable && h('p',{class:'ri-help'},'This entry is disabled in World Info.'));
        }) : [h('p',{},'No entries in this book.')]));
    }).catch(error=>{entries.textContent=error.message;});
    return h('details',{class:'ri-card ri-tight'},h('summary',{},'Guideline entry scopes'),
        h('p',{class:'ri-help'},'Apply extra conditions for this chat. Eligible entries still use their World Info triggers.'),entries);
}

function renderBooks(local, redraw, app, baseOnly = false) {
    const books = [{value:'',label:'None'},...options(reusableBookNames())];
    const base = select(books,local.base?.name || '',async name=>{try { await pinBase(name); redraw(); } catch(error) { problem(error); redraw(); }});
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
    const guidelines = select(books,local.guidelines || '',name=>{selectGuidelines(name);redraw();});
    const name = textInput('',()=>{},{placeholder:'Name for a reusable guidelines book','aria-label':'Guidelines book name'});
    const content = textArea('',()=>{},{placeholder:'Writing or behavior guidance','aria-label':'Guidelines text'});
    const pins = local.base ? h('details',{class:'ri-card ri-tight'},h('summary',{},'Pinned facts for opening'),
        Object.values(local.base.entries || {}).filter(row=>!row.disable).map(row=>h('label',{class:'ri-row'},
            h('input',{type:'checkbox',checked:local.base.pins?.includes(String(row.uid)),onchange:event=>{
                const ids = new Set(local.base.pins || []);
                if (event.currentTarget.checked) ids.add(String(row.uid)); else ids.delete(String(row.uid));
                local.base.pins = [...ids];
                saveChatState();
            }}),row.comment || row.key?.[0] || `Entry ${row.uid}`))) : null;
    return section('Reusable lorebooks',
        field('Base World','Choose an existing World Info book or upload a native JSON export. The pinned copy keeps its triggers.',base,
            local.base ? button('Refresh pinned copy',()=>pinBase(local.base.name).then(redraw).catch(problem)) : null,
            h('div',{class:'ri-row'},file,upload)),
        pins,
        !baseOnly && field('Behavior & Guidelines','Select a reusable book. Set its entry triggers in World Info.',guidelines,
            local.guidelines ? select([{value:'on',label:'Enabled'}, {value:'off',label:'Disabled'}], local.guidelinesOn === false ? 'off':'on', value=>{local.guidelinesOn=value==='on';saveChatState();redraw();}) : null),
        !baseOnly && guidelineScopes(local),
        !baseOnly && h('details',{class:'ri-card'},h('summary',{},'Create a guidelines book'),name,content,
            button('Create and select',async()=>{try{await createGuidelines(name.value.trim(),content.value.trim());if(prefs()!==local)return;local.guidelinesOn=true;selectGuidelines(name.value.trim());redraw();}catch(error){problem(error);}})),
        h('div',{class:'ri-row'},
            button('Review World Info selections',()=>app.openPage('sent'),{kind:'ghost'}),
            !baseOnly && button('World Info display settings',()=>app.openPage('display'),{kind:'ghost'})));
}

function editRecord(original, save, cancel, kinds) {
    const modules = effectiveModules();
    const type = select(options(kinds.filter(k=>k===original?.kind || modules[KIND_MODULE[k]])),original?.kind || kinds.find(k=>modules[KIND_MODULE[k]]),render,{'aria-label':'Record type'});
    type.disabled = !!original;
    const root = h('div',{class:'ri-state-editor'});
    const id = textInput(original?.id || '',()=>{}, {'aria-label':'Record ID'});
    const subject = textInput(original?.subject || '',()=>{}, {'aria-label':'Subject or speaker'});
    const text = textArea(original?.text || '',()=>{}, {'aria-label':'Record text'});
    const lock = h('input',{type:'checkbox',checked:original?.protected ?? !original});
    const chosenLocks = new Set();
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
        root.replaceChildren(scoped('Record type',type),scoped('Stable ID (letters, digits, hyphens)',id),scoped('Subject',subject),scoped('Record',text),
            h('label',{},lock,' Protect this record from automatic changes'));
        if (k === 'knowledge') root.append(choice('basis','Source type',['observed','reported','rumor','belief'],'observed'),flag('private','Limit to relevant character',true));
        if (k === 'fact') {
            const pinned = Object.values(prefs()?.base?.entries || {});
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
                },{kind:'ghost'}) : null;
                root.append(h('div',{class:'ri-row'},h('label',{},profileLocks[key],` Protect ${label.toLowerCase()}`),
                    info ? h('span',{class:'ri-help'},`Revision ${info.revision} · ${info.source}`) : null,reset));
            }
        }
        if (k === 'emotion') {
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
                await save(value);
            } catch(error) {failure.textContent=error.message;submit.disabled=false;}
        },{kind:'primary'});
        root.append(h('div',{class:'ri-row'},submit,button('Cancel',cancel)),failure);
    }
    render();
    return root;
}

function renderRecords(redraw, title, kinds) {
    const list = h('div');
    const editor = h('div');
    const save = async value=>{await saveV10Record(value);redraw();};
    list.append(h('p',{class:'ri-help'},'Loading…'));
    rowsForWorld().then(rows=>{
        const records=rows.map(readRecord).filter(Boolean);
        if (kinds.includes('profile')) {
            const sources = portrayalSources(rows);
            for (const [index,record] of records.entries()) if (record.kind==='profile') {
                const baseline = baselineFor(sources,record.subject,record.aliases);
                records[index]=effectivePortrayal(record,baseline);
            }
            for (const baseline of sources.values()) {
                if (records.some(record=>record.kind==='profile' && baselineFor(sources,record.subject,record.aliases)===baseline)) continue;
                const id = `portrayal-${baseline.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,45) || records.length}`;
                records.push({kind:'profile',id,subject:baseline.name,text:baseline.text || baseline.voice,voice:baseline.voice,aliases:baseline.aliases,baseline});
            }
        }
        const shown = records.filter(record=>kinds.includes(record.kind));
        list.replaceChildren(...(shown.length ? shown.map(record=>h('details',{class:'ri-card ri-tight'},
            h('summary',{},`${entryLabel(record.kind)} · ${record.subject || record.id}`),
            h('p',{},record.text),record.voice && h('p',{class:'ri-help'},`Voice · ${record.voice}`),
            record.baseline?.sources?.length && h('p',{class:'ri-help'},`Sources · ${record.baseline.sources.join(' · ')}`),
            record.baseEntry && record.baseRelation==='contradicts' && h('p',{class:'ri-note'},'Base World conflict. This correction applies in this chat.'),
            h('p',{class:'ri-help'},[record.id,record.basis,record.status,record.protected?'Protected':'',record.source==='user'?'Edited by player':record.quote].filter(Boolean).join(' · ')),
            button('Edit',()=>editor.replaceChildren(editRecord(record,save,()=>editor.replaceChildren(),kinds)))))
            : [h('p',{class:'ri-help'},'No records yet.')]));
    }).catch(error=>list.replaceChildren(h('p',{role:'status'},error.message)));
    const canAdd = kinds.some(kind=>effectiveModules()[KIND_MODULE[kind]]);
    return section(title,list,canAdd ? button('Add record',()=>editor.replaceChildren(editRecord(null,save,()=>editor.replaceChildren(),kinds))) : null,editor);

}

function renderSpeakers(local) {
    const target = document.querySelector('#chat .last_mes .mes_text');
    return section('Dialogue colors',
        Object.entries(local.speakers || {}).map(([key,speaker])=>{
            const picker=h('input',{type:'color',value:speaker.color,'aria-label':`Color for ${speaker.name}`});
            const status=h('span',{class:'ri-help'});
            const update=()=>{
                const theme = target && displayColor(speaker.color,target);
                const rendered = theme || displayColor(speaker.color,null);
                status.textContent=`Saved ${speaker.color}${rendered && rendered!==speaker.color ? ` · Displayed ${rendered}` : ''}${theme || !target ? '' : ' · Contrast background applied'}`;
            };
            update();
            picker.addEventListener('input',()=>{try {setSpeakerColor(key,picker.value);update();refreshDialogue();}catch(error){problem(error);}});
            return h('label',{class:'ri-row'},picker,speaker.name,status);
        }), !Object.keys(local.speakers || {}).length ? h('p',{class:'ri-help'},'Characters appear here as dialogue or thoughts identify them.') : null);
}

const MODULE_HELP = {
    style: 'Sends your Writing Guidance with the reply to steer prose, voice, and pacing.',
    state: 'Tracks the scene, story clock, character snapshots, and durable story facts.',
    knowledge: 'Tracks what each character has observed, heard, or believes.',
    emotions: 'Tracks tunable NPC emotion axes and outward behavior.',
    relationships: 'Keeps brief notes on relationships and meaningful changes.',
    plots: 'Tracks unresolved threads, planted details, payoffs, and off-screen agendas.',
    worldEvents: 'Uses an automatic chance check to offer an optional development. Random Instructions are controlled separately.',
    dice: 'Rolls once when you queue an action in Direction → Action Checks. Regular replies proceed without a roll.',
    colors: 'Colors dialogue and italic thoughts when the prose identifies the character.',
    roast: 'Asks the model for optional commentary in the same reply.',
    roastFeedback: 'Includes recent Roast commentary as writing feedback in later prompts.',
};
function hostPrompt(block) {
    return h('details',{class:'ri-card ri-tight'},
        h('summary',{},`${block.name} · ${onOff(block.enabled)}`),
        block.content ? h('pre',{class:'ri-v10-prompt-text'},block.content)
            : h('p',{class:'ri-help'},block.marker ? 'SillyTavern or TauriTavern fills this section from the current chat, card, or World Info.'
                : 'This preset block contains no prompt text.'));
}

function presetDetails(preset, app) {
    const prompts = activeHostPrompts();
    return section('Host preset',
        h('p',{},preset ? `Active preset: ${preset}` : 'The host has no active Chat Completion preset.'),
        preset===PRESET ? h('p',{class:'ri-help'},'The Roleplay Instructions V10 companion preset supplies writing guidance for viewpoint, character voice, pacing, dialogue, and consequences. Keep its Chat History block on to send the recent messages allowed by Context & Memory.') : null,
        prompts?.length ? h('details',{class:'ri-card'},h('summary',{},'View host preset prompt blocks'),
            h('p',{class:'ri-help'},'On means the block is enabled in the host preset. The host may fill or omit individual blocks when it assembles a reply. Edit these blocks in the host preset editor.'),
            prompts.map(hostPrompt)) : h('p',{class:'ri-help'},'This host connection does not expose an ordered list of preset prompt blocks.'),
        button('Review What Was Sent',()=>app.openPage('sent'),{kind:'ghost'}));
}

function hostOverlap(key, owner, preset, redraw) {
    const id = `ri-owner-${key}`;
    return h('div',{class:'ri-module-overlap'},
        h('label',{htmlFor:id},'Instruction source'),
        select([{value:'preset',label:'Host preset'}, {value:'extension',label:'Roleplay Instructions extension'}],owner.choice,value=>{
            setModuleOwner(preset,key,value);
            redraw();
            document.getElementById(id)?.focus({preventScroll:true});
        },{id,'aria-describedby':`${id}-status`}),
        h('p',{class:'ri-help',id:`${id}-status`},owner.usesExtension
            ? 'The Roleplay Instructions extension supplies this feature here.'
            : owner.choice === 'extension'
                ? 'Roleplay Instructions is waiting for these blocks to be off in the host preset editor.'
                : owner.blocks.some(block=>block.enabled===true)
                    ? 'Enabled host preset blocks supply these instructions. The extension module is off in this chat.'
                    : 'The extension is off for this feature. See the host block status below.'),
        h('ul',{},owner.blocks.map(block=>h('li',{},`${block.name} · ${block.enabled===null ? 'Status unavailable' : onOff(block.enabled)} in host preset`,
            block.blocks.filter(entry=>entry.content).map(entry=>h('details',{class:'ri-card ri-tight'},
                h('summary',{},'View host preset prompt'),h('pre',{class:'ri-v10-prompt-text'},entry.content)))))));;
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
        const parent = editingPreset || !canEditPreset ? 'extension' : 'preset';
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
        const message = editingPreset
            ? `Default for this preset: ${onOff(value ?? fallback)}`
            : blocked ? 'Extension off in this chat' : `${onOff(modules[key])} in this chat`;
        return h('div',{class:'ri-module-row','data-module':key},
            h('div',{class:'ri-module-heading'},
                h('label',{htmlFor:controlId},label),
                h('span',{class:'ri-module-status',id:`${controlId}-status`,'data-enabled':String(editingPreset ? value ?? fallback : modules[key])},message)),
            h('p',{class:'ri-help',id:`${controlId}-help`},MODULE_HELP[key]),
            h('div',{class:'ri-row ri-module-actions'},control,value!==undefined && !blocked
                ? button(`Reset to ${parent} setting (${onOff(fallback)})`,()=>update(undefined),{kind:'ghost'}) : null),
            !blocked && h('p',{class:'ri-help'},value===undefined
                ? `Following the ${parent} setting.`
                : editingPreset ? (override===undefined ? 'Applies to chats that follow this preset.' : `This chat keeps its own setting (${onOff(override)}).`)
                    : 'Saved for this chat.'),
            owner && !editingPreset ? hostOverlap(key,owner,preset,redraw) : null);
    });
    return section('Extension modules',
        h('div',{class:'ri-module-scopes',role:'group','aria-label':'Settings scope'},
            h('button',{type:'button',class:'ri-btn ri-btn-ghost','data-module-scope':'chat','aria-pressed':String(controlScope==='chat'),
                onclick:()=>changeScope('chat')},'This chat'),
            h('button',{type:'button',class:'ri-btn ri-btn-ghost','data-module-scope':'preset','aria-pressed':String(controlScope==='preset'),
                disabled:!canEditPreset,onclick:()=>changeScope('preset')},'Module defaults by preset')),
        h('p',{class:'ri-help'},editingPreset
            ? `Set extension module defaults for chats that use “${preset}”. Chats with their own settings keep them.`
            : canEditPreset ? `Changes here apply only to this chat. Reset a changed setting to follow “${preset}” again.`
            : 'Changes here apply only to this chat. Reset a changed setting to follow the extension again.'),
        !editingPreset && Object.keys(ownership).length ? h('div',{class:'ri-note'},'Instruction source is saved for this chat and preset. Related blocks are managed in the host preset editor. The extension yields while those blocks are on or their status is unavailable.',
            h('div',{class:'ri-row'},button('Refresh source status',redraw,{kind:'ghost'}))) : null,
        ...[
            ['Writing & reply display',['style','colors','roast','roastFeedback']],
            ['Story state & character continuity',['state','knowledge','emotions','relationships']],
            ['Plot & mechanics',['plots','worldEvents','dice']],
        ].map(([label,keys])=>h('div',{class:'ri-module-list'},
            h('h3',{class:'ri-label'},label),keys.map(key=>rows.find(row=>row.dataset.module===key)))));
}

function memorySettings(app, redraw) {
    const active = memoryComponents();
    const defaults = settings().summary;
    const control = (key,label,hint,value) => field(label,hint,
        select(choices.slice(1),value ? 'on' : 'off',next=>{setMemoryComponent(key,next==='on');redraw();},
            {'aria-label':label,disabled:key==='hide' && !active.chapters}));
    return section('Memory components',
        control('world','World Info recall','Include the pinned Base World and relevant entries from the extension’s Story World. Host World Info remains under host control.',active.world),
        control('chapters','Chapter summaries',`Write chapter summaries and recall them. The interval in Context & Memory is ${Number(defaults.every) || 0} replies.`,active.chapters),
        control('hide','Auto-hide summarized messages',active.chapters
            ? 'Hide covered messages from the model after a summary is saved. Turning this off restores messages hidden by the extension.'
            : 'Enable Chapter summaries first.',active.hide),
        h('div',{class:'ri-row'},
            button('Context & Memory',()=>app.openPage('context'),{kind:'ghost'}),
            button('Reusable Lorebooks',()=>app.openPage('books'),{kind:'ghost'}),
            button('Story World',()=>app.openPage('world'),{kind:'ghost'})));
}

export function renderV10(body, app, page) {
    if (!isChatOpen()) return;
    const local = prefs();
    const redraw = () => {
        app.render();
        import('./sent.js').then(module=>module.refreshUnderReplies());
    };
    const preset = activePreset();
    const modules = effectiveModules();
    const chatFlag = (key, label, hint, defaultOn = false) => field(label,hint,
        select(choices.slice(1),(local[key] ?? defaultOn) ? 'on':'off',value=>{local[key]=value==='on';saveChatState();redraw();},
            {'aria-label':label}));
    if (page === 'books') {
        body.append(renderChatBooks(app));
        if (enabledV10() || memoryOnly() && memoryComponents().world) body.append(renderBooks(local,redraw,app,memoryOnly()));
        return;
    }
    if (page === 'v10') {
        body.append(presetDetails(preset,app));
        body.append(section('Roleplay Instructions extension',field('Story workflow for this chat',
            'Memory only leaves writing, planning, checks, and reply rendering to the host preset. The structured and legacy workflows also run their enabled story features.',
            select([{value:'inherit',label:`Automatic (${preset===PRESET ? 'structured' : 'legacy'})`},
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
            },{'aria-label':'Story workflow for this chat'}))));
        body.append(memorySettings(app,redraw));
        if (!enabledV10()) return;
        body.append(moduleSettings(local,app,preset,modules,redraw),
            chatFlag('generatePlan','Request a reply plan','The extension adds an instruction for a brief optional outline before the prose when the companion preset is active.'));
        return;
    }
    if (!enabledV10()) {
        body.append(h('p',{class:'ri-note'},'Choose the Structured story workflow in Setup → Preset & Extension.'));
        return;
    }
    switch (page) {
        case 'display':
            body.append(section('Reply Display',
                chatFlag('showPlanning','Show Reply planning','Show any emitted outline in a collapsed disclosure.',true),
                chatFlag('showLore','World Info under replies','Show a collapsed card with the selected entries and their source books. This controls visibility only.',true),
                button('Review World Info selections',()=>app.openPage('sent'),{kind:'ghost'}),
                chatFlag('showRoast','Show Roast cards','Control Roast display independently of generation and feedback.',true),
                chatFlag('keepTurnGuidance','Keep exact story guidance','Save confirmed extension guidance for inspection in What Was Sent.')));
            break;
        case 'opening': body.append(renderOpening(local,redraw)); break;
        case 'facts': body.append(renderRecords(redraw,'Chat Facts',['fact'])); break;
        case 'plots': body.append(renderRecords(redraw,'Plot Records',PLOT_KINDS)); break;
        case 'portrayal': body.append(renderRecords(redraw,'Portrayal & Knowledge',['profile','knowledge'])); break;
        case 'emotion': {
            if (modules.emotions) {
                const tuning=local.emotion ||= {};
                const dial=(key,label,min,max,fallback)=>scoped(label,h('input',{type:'number',min,max,value:tuning[key]??fallback,'aria-label':label,onchange:e=>{
                    tuning[key]=Math.max(min,Math.min(max,Number(e.currentTarget.value)||0));saveChatState();
                }}));
                body.append(section('Emotion tuning',h('div',{class:'ri-grid2'},dial('baseline','Baseline',0,10,3),dial('persistence','Persistence in replies',0,40,3),dial('recovery','Recovery per reply',0,10,1),
                    scoped('Sensitivity',select(options(['flexible','subtle','responsive']),tuning.sensitivity || 'flexible',value=>{tuning.sensitivity=value;saveChatState();})))));
            }
            body.append(renderRecords(redraw,'Emotions & Relationships',['emotion','relationship']));
            break;
        }
        case 'speakers': body.append(renderSpeakers(local)); break;
        case 'writing': body.append(profileEditor(local,'style','Live writing guidance',defaultWritingGuidance(),redraw)); break;
        case 'checks': body.append(modules.dice ? renderDice(local,redraw) : h('p',{class:'ri-note'},'Turn on the Explicit action checks module in Setup → Preset & Extension.')); break;
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
