import { h, button, select, section, field, textArea, textInput } from './dom.js';
import { ctx, KEY, isChatOpen, toast, isGenerating } from '../st.js';
import { saveSettings, saveChatState } from '../store.js';
import { acceptV10Opening, guideSwipe } from '../engine.js';
import { saveV10Record } from '../worldflow.js';
import { statNames } from '../dice.js';
import {
    MODULES, DEFAULT_MODULES, KIND_MODULE, PLOT_KINDS, AXES, STYLE, OPENING,
    activePreset, presetDefaults, savePresetDefault, moduleOwnership, setModuleOwner, prefs, enabledV10, effectiveModules, pinBase, reusableBookNames, uploadBaseBook, createGuidelines, queueCheck, checkText, rowsForWorld,
    readRecord, greetings, draftOpening, setSpeakerColor, displayColor, SPEECH,
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

function renderBooks(local, redraw, app) {
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
    const guidelines = select(books,local.guidelines || '',name=>{local.guidelines=name;saveChatState();redraw();});
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
        field('Behavior & Guidelines','Select a reusable book. Set its entry triggers in World Info.',guidelines,
            local.guidelines ? select([{value:'on',label:'Enabled'}, {value:'off',label:'Disabled'}], local.guidelinesOn === false ? 'off':'on', value=>{local.guidelinesOn=value==='on';saveChatState();redraw();}) : null),
        h('details',{class:'ri-card'},h('summary',{},'Create a guidelines book'),name,content,
            button('Create and select',async()=>{try{await createGuidelines(name.value.trim(),content.value.trim());if(prefs()!==local)return;local.guidelines=name.value.trim();local.guidelinesOn=true;saveChatState();redraw();}catch(error){problem(error);}})),
        h('div',{class:'ri-row'},
            button('Review World Info selections',()=>app.openPage('sent'),{kind:'ghost'}),
            button('World Info display settings',()=>app.openPage('display'),{kind:'ghost'})));
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
        if (k === 'fact') root.append(string('aliases','Relevance aliases'),string('link','Related plot record ID'));
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
        if (PLOT_KINDS.includes(k)) root.append(choice('status','Status',['open','done','retired'],'open'),
            string('parent','Parent arc ID'),string('requires','Required record IDs (comma separated)'),string('location','Required location'),string('due','Due story minute'),
            string('payoff','Optional payoff guidance'),string('outcome','Established outcome'),flag('schedule','Allow automatic scheduling',false),string('weight','Selection weight'),string('spacing','Minimum spacing in replies'));
        const failure = h('p',{role:'status',class:'ri-help'});
        const submit = button('Save record',async()=>{
            submit.disabled=true;
            try {
                const value = {kind:k,id:id.value.trim(),subject:subject.value,text:text.value,protected:lock.checked};
                for (const [key,input] of Object.entries(inputs)) {
                    if (input.type === 'checkbox') value[key]=input.checked;
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
        for (const row of rows.filter(row=>kinds.includes('profile') && row.on && row.kind==='character')) {
            const id = `character-${row.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,50) || row.uid}`;
            const baseline={text:row.fields.who || row.fields.role,voice:row.fields.voice,aliases:row.aliases};
            if (!baseline.text && !baseline.voice) continue;
            const existing=records.find(record=>record.kind==='profile' && record.subject.toLowerCase()===row.name.toLowerCase());
            if (existing) existing.baseline=baseline;
            else records.push({kind:'profile',id,subject:row.name,text:baseline.text || baseline.voice,voice:baseline.voice,aliases:baseline.aliases,baseline});
        }
        const card=ctx().characters?.[ctx().characterId];
        const character=ctx().name2;
        const source=card?.personality || card?.data?.personality || card?.description || card?.data?.description;
        if (kinds.includes('profile') && source && character && !records.some(record=>record.kind==='profile' && record.subject===character)) {
            records.push({kind:'profile',id:'card-portrayal',subject:character,text:source.slice(0,900),baseline:{text:source.slice(0,900)}});
        }
        const shown = records.filter(record=>kinds.includes(record.kind));
        list.replaceChildren(...(shown.length ? shown.map(record=>h('details',{class:'ri-card ri-tight'},
            h('summary',{},`${entryLabel(record.kind)} · ${record.subject || record.id}`),
            h('p',{},record.text),h('p',{class:'ri-help'},[record.id,record.basis,record.status,record.protected?'Protected':'',record.source==='user'?'Edited by player':record.quote].filter(Boolean).join(' · ')),
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
        }), !Object.keys(local.speakers || {}).length ? h('p',{class:'ri-help'},'Assigned speakers appear here after a reply uses speaker labels.') : null);
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
    colors: 'Assigns editable colors to attributed dialogue and renders them in the chat.',
    roast: 'Asks the model for optional commentary in the same reply.',
    roastFeedback: 'Includes recent Roast commentary as writing feedback in later prompts.',
};
function hostOverlap(key, owner, preset, redraw) {
    const id = `ri-owner-${key}`;
    return h('div',{class:'ri-module-overlap'},
        h('label',{htmlFor:id},'Instruction source'),
        select([{value:'preset',label:'Host preset'}, {value:'extension',label:'Roleplay Instructions'}],owner.choice,value=>{
            setModuleOwner(preset,key,value);
            redraw();
            document.getElementById(id)?.focus({preventScroll:true});
        },{id,'aria-describedby':`${id}-status`}),
        h('p',{class:'ri-help',id:`${id}-status`},owner.usesExtension
            ? 'Roleplay Instructions owns this feature.'
            : owner.choice === 'extension'
                ? 'Roleplay Instructions is waiting for these blocks to be off in the host preset editor.'
                : owner.blocks.some(block=>block.enabled===true)
                    ? 'The host preset owns this feature.'
                    : 'The extension is off for this feature. See the host block status below.'),
        h('ul',{},owner.blocks.map(block=>h('li',{},`${block.name} · ${block.enabled===null ? 'Status unavailable' : onOff(block.enabled)} in host preset`))));
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
        const source = override !== undefined ? 'Chat override' : presetValue !== undefined ? 'Preset default' : 'Built-in default';
        const options = editingPreset ? [
            {value:'inherit',label:`Use built-in default (${onOff(DEFAULT_MODULES[key])})`},
            {value:'on',label:'On by default'},
            {value:'off',label:'Off by default'},
        ] : [
            {value:'inherit',label:`Use ${canEditPreset ? 'preset' : 'built-in'} default (${onOff(defaultOn)})`},
            {value:'on',label:'On for this chat'},
            {value:'off',label:'Off for this chat'},
        ];
        const controlId = `ri-module-${key}`;
        const control = select(options,mode(editingPreset ? presetValue : override),value=>{
            if (editingPreset) {
                savePresetDefault(preset,key,value==='inherit' ? undefined : value==='on');
                saveSettings();
            } else {
                const over = local.modules ||= {};
                if (value==='inherit') delete over[key];
                else over[key]=value==='on';
                saveChatState();
            }
            redraw();
            document.getElementById(controlId)?.focus({preventScroll:true});
        },{id:controlId,disabled:owner && !owner.usesExtension,'aria-describedby':`${controlId}-help ${controlId}-status ${controlId}-comparison`});
        const comparison = h('div',{class:'ri-module-comparison',id:`${controlId}-comparison`},
            h('span',{},`${owner ? 'Extension default' : 'Preset default'} · ${onOff(defaultOn)}${presetValue === undefined ? ' (built-in)' : ''}`),
            h('span',{},override === undefined ? 'This chat · Inherits default' : `Chat override · ${onOff(override)}`));
        return h('div',{class:'ri-module-row','data-module':key},
            h('div',{class:'ri-module-heading'},
                h('label',{htmlFor:controlId},label),
                h('span',{class:'ri-module-status',id:`${controlId}-status`,'data-enabled':String(modules[key])},
                    owner && !owner.usesExtension ? 'Extension off · See instruction source' : `${onOff(modules[key])} in this chat · ${source}`)),
            h('p',{class:'ri-help',id:`${controlId}-help`},MODULE_HELP[key]),
            comparison,
            control,
            owner ? hostOverlap(key,owner,preset,redraw) : null);
    });
    return section('Extension modules',
        h('div',{class:'ri-module-scopes',role:'group','aria-label':'Settings scope'},
            h('button',{type:'button',class:'ri-btn ri-btn-ghost','data-module-scope':'chat','aria-pressed':String(controlScope==='chat'),
                onclick:()=>changeScope('chat')},'This chat'),
            h('button',{type:'button',class:'ri-btn ri-btn-ghost','data-module-scope':'preset','aria-pressed':String(controlScope==='preset'),
                disabled:!canEditPreset,onclick:()=>changeScope('preset')},'Preset defaults')),
        h('p',{class:'ri-help'},editingPreset
            ? `Defaults for “${preset}” apply wherever that preset is active and the chat uses its default. Chat overrides take precedence.`
            : canEditPreset ? `Settings for this chat. “Use preset default” follows “${preset}”. Choose On or Off to override it here.`
            : 'The host has no active preset name. You can use the built-in defaults or override them for this chat.'),
        Object.keys(ownership).length ? h('div',{class:'ri-note'},'Instruction source is saved for this chat and preset. Related blocks are managed in the host preset editor. The extension yields while those blocks are on or their status is unavailable.',
            h('div',{class:'ri-row'},button('Refresh source status',redraw,{kind:'ghost'}))) : null,
        h('div',{class:'ri-module-list'},rows));
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
    if (page === 'v10') {
        body.append(section('Preset & Modules',field('Use V10 for this chat',
            preset ? `Active preset: ${preset}. The companion preset enables V10 by default.` : 'Select the companion preset or enable V10 here.',
            select([{value:'inherit',label:'Automatic'},...choices.slice(1)],mode(local.enabled),value=>{
                if(value==='inherit')delete local.enabled;else local.enabled=value==='on';
                saveChatState();redraw();
            },{'aria-label':'Use V10 for this chat'}))));
        if (!enabledV10()) return;
        body.append(moduleSettings(local,app,preset,modules,redraw),
            chatFlag('generatePlan','Request a reply plan','Ask the companion preset for a short optional outline before the scene.'));
        return;
    }
    if (!enabledV10()) {
        body.append(h('p',{class:'ri-note'},'Enable V10 for this chat in Setup → Preset & Modules.'));
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
        case 'books': body.append(renderBooks(local,redraw,app)); break;
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
        case 'writing': body.append(profileEditor(local,'style','Live writing guidance',STYLE,redraw)); break;
        case 'checks': body.append(modules.dice ? renderDice(local,redraw) : h('p',{class:'ri-note'},'Enable Explicit action checks in Setup → Preset & Modules.')); break;
    }
}

export function refreshDialogue() {
    const on = enabledV10() && effectiveModules().colors;
    const speakers = Object.values(ctx().chatMetadata?.[KEY]?.v10?.speakers || {});
    for (const mes of document.querySelectorAll('#chat .mes')) {
        const area = mes.querySelector('.mes_text');
        if (!area || ctx().chat?.[Number(mes.getAttribute('mesid'))]?.is_user) continue;
        for (const span of area.querySelectorAll('.ri-speaker-text')) {
            const speaker = speakers.find(person=>person.aliases.includes(span.dataset.speaker));
            if (on && speaker) colorDialogue(span,speaker.color,area);
            else span.replaceWith(...span.childNodes);
        }
        if (!on || !speakers.length) continue;
        for (const paragraph of area.querySelectorAll('p')) {
            if (paragraph.querySelector('.ri-speaker-text')) continue;
            const nodes = [];
            let source = '';
            const walker = document.createTreeWalker(paragraph,NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
            while (walker.nextNode()) {
                const node = walker.currentNode;
                if (node.nodeName === 'BR') source += '\n';
                if (node.nodeType !== Node.TEXT_NODE) continue;
                nodes.push({node,start:source.length,end:source.length+node.length});
                source += node.textContent;
            }
            for (const match of [...source.matchAll(SPEECH)].reverse()) {
                const key = (match[1] || match[2]).trim().toLowerCase().replace(/\s+/g,' ');
                const speaker = speakers.find(person=>person.aliases.includes(key));
                if (!speaker) continue;
                const start = match.index + match[0].length;
                const end = source.indexOf(source[start] === '“' ? '”' : '"',start+1);
                const lineEnd = source.indexOf('\n',start);
                if (end < 0 || (lineEnd >= 0 && end > lineEnd)) continue;
                const first = nodes.find(item=>item.start <= start && start < item.end);
                const last = nodes.find(item=>item.start <= end && end < item.end);
                if (!first || !last) continue;
                const range = document.createRange();
                range.setStart(first.node,start-first.start);
                range.setEnd(last.node,end+1-last.start);
                const span = h('span',{class:'ri-speaker-text','data-speaker':key,title:speaker.name},range.extractContents());
                colorDialogue(span,speaker.color,area);
                range.insertNode(span);
            }
        }
    }
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
