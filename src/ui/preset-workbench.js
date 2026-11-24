import { h, button, select } from './dom.js';
import { promptEditor, promptGroup, roastVoiceEditor } from './prompts.js';
import { promptComparison, variationEditor } from './prompt-variations.js';
import { promptOwner } from '../prompt-variations.js';
import { functionExecution } from './execution.js';
import { executionReceipt } from '../execution.js';
import { ctx } from '../st.js';
import { saveChatState } from '../store.js';
import { estimateTokens } from '../context-budget.js';
import { moduleOrder, MODULE_PROMPTS } from '../module-layout.js';
import { activePreset, prefs, MODULES, enabledV10, blockCompanions, stripPresetComments } from '../v10.js';
import { FEATURES, plainName } from '../preset-library.js';
import { presetRows, hasPresetEdit, editPresetBlock, savePair, evaluateParity, presetBlockRevision, presetBlockVariation,
    validateBlockVariation, presetRestoreBaselines, presetRestoreFileName, presetRestoreUndo, linkPresetRestoreFile,
    switchContext, resolvedSwitches, workingCopyOff } from '../preset-workbench.js';
// Registers Setup, Presets with the page registry when the panel loads this module.
import './presets-page.js';
// Registers Setup, Presets, Cleanup (B18).
import './preset-cleanup.js';

const hint = text=>h('p',{class:'ri-help'},text);
const label = (name,input)=>h('label',{class:'ri-field'},h('span',{class:'ri-label'},name),input);
const btns = (...items)=>h('div',{class:'ri-row ri-row-tight'},items);
const choices = pairs=>pairs.map(([value,label])=>({value,label}));
const chip = (text,kind='')=>h('span',{class:`ri-ps-chip${kind ? ' ri-ps-chip-'+kind : ''}`},text);
const keyFor = () => JSON.stringify([ctx().getCurrentChatId?.(),activePreset()]);
const PAGE = 'presets';
const blockFields = {name:'Name',content:'Wording',role:'Message role',absolute:'Fixed depth',depth:'Depth',priority:'Priority',
    triggers:'Generation triggers',listed:'Listed in prompt order',enabled:'Enabled',preceding:'Earlier blocks',following:'Later blocks'};

// Reading a preset's own structure (audit 08, menu recommendations 2, 6 and 7).
const LOCK = /\u{1F512}|\block(?:ed)?\b|\bjailbreak\b|\bguard\b|\bdo not (?:edit|touch|remove|disable)\b|\brequired\b|\bmandatory\b/iu;
const PICK = /\[\s*pick\s*(?:1|one)\s*(?::\s*([^\]]*))?\]/i;
/** A row that only titles the rows under it: short or empty text and a decorated or commented name. */
export function isHeading(block) {
    // A marker row with no text of its own and a ri-head identifier is a heading the companion preset draws (B15).
    if (block.marker) return /^ri-head-/.test(block.id || '') && !block.content.trim();
    if (block.content.trim().length > 80) return false;
    return /[\u{2550}\u{2501}\u{2500}\u{2014}=_~*#]{3,}|^\s*\/\/|^\s*#{1,6}\s|^\s*[\u{2500}-\u{257F}]/u.test(block.name);
}
/** A heading's words without its rule characters. */
export const headingTitle = block => plainName(block.name).replace(/[\u{2500}-\u{257F}=_~*#]+/gu, ' ').replace(/^\s*\/\/\s*/, '').replace(/\s+/g, ' ').trim();
export const isGuard = block => !block.marker && LOCK.test(block.name);
/** The pick-one group a block belongs to, from "[PICK 1: POV]" style names; arrows alone group under the heading. */
export function pickGroup(block, heading = '') {
    const match = PICK.exec(block.name);
    if (!match) return '';
    const named = plainName(match[1] || '').replace(/[^\p{L}\p{N} ]+/gu,'').trim();
    return named || `${heading || 'Pick one'}`;
}
/** Rows grouped under the preset's own headings, in prompt order, with pick-one groups gathered. */
export function groupBlocks(rows) {
    const groups=[]; let current={heading:null,rows:[]};
    for (const row of rows) {
        if (isHeading(row)) { if (current.heading || current.rows.length) groups.push(current); current={heading:row,rows:[]}; }
        else current.rows.push(row);
    }
    if (current.heading || current.rows.length) groups.push(current);
    for (const group of groups) {
        const title=group.heading ? headingTitle(group.heading) : '';
        const picks=new Map();
        for (const row of group.rows) {
            const key=pickGroup(row,title);
            if (!key) continue;
            if (!picks.has(key)) picks.set(key,[]);
            picks.get(key).push(row);
        }
        group.picks=[...picks].filter(([,list])=>list.length>1).map(([name,list])=>({name,rows:list}));
    }
    return groups;
}
export function blockMeta(block) {
    const place=block.absolute ? `Depth ${block.depth}, priority ${block.priority}` : block.listed ? 'In preset order' : 'Not in the prompt order';
    const triggers=block.triggers?.length ? `Only for ${block.triggers.join(', ')}` : '';
    return [block.role[0].toUpperCase()+block.role.slice(1),place,triggers,block.marker ? 'Filled by SillyTavern' : `About ${estimateTokens(stripPresetComments(block.content))} tokens`].filter(Boolean).join(' · ');
}

function expandOnce(details, render) {
    let built=false;
    const show=()=>{if (details.open && !built) {built=true;details.append(render());}};
    details.addEventListener('toggle',show);
    show();
    return details;
}
function extensionEditors(key,profile) {
    return h('div',{},hint('Prompt wording saved here applies across chats. Live values and required response fields are assembled at generation.'),
        prefs() && profile?.(key),key==='roast' && roastVoiceEditor(),
        MODULE_PROMPTS[key].map(id=>promptEditor(id)));
}

/** The old Preset & Extension page keeps a pointer; blocks, switches and loadouts live in Setup, Presets. */
export function presetWorkbench(preset,app) {
    return h('div',{class:'ri-card ri-tight ri-preset-workbench-link'},
        hint(`The blocks of ${preset}, the Ours or Theirs switch for each feature and saved loadouts are in Setup, Presets.`),
        button('Open Setup, Presets',()=>app.openPage(PAGE),{kind:'primary'}));
}

/** Preset blocks grouped by the preset's headings, each editable, for Setup, Presets. */
export function presetBlockEditor(preset,app,profile) {
    const context=keyFor();
    if (app.presetWorkspace?.context!==context) app.presetWorkspace={context,drafts:new Map(),matches:[],confirm:null};
    const ui=app.presetWorkspace;
    const details=h('details',{id:'ri-preset-workbench',class:'ri-card ri-preset-workbench',open:ui.open});
    const body=h('div');
    const status=h('p',{class:'ri-help',role:'status'},ui.message || '');
    const redraw=(element=document.activeElement)=>{
        if (keyFor()!==context || app.tab!==PAGE) return;
        const row=element?.closest('[data-preset-block]');
        const id=row?.dataset.presetBlock, aria=element?.getAttribute('aria-label');
        const caption=element?.tagName==='BUTTON' ? element.textContent : '';
        if (id) ui.current=id;
        app.render();
        if (!id) return;
        const next=app.root?.querySelector(`[data-preset-block="${CSS.escape(id)}"]`);
        const control=aria ? next?.querySelector(`[aria-label="${CSS.escape(aria)}"]`)
            : [...next?.querySelectorAll('button') || []].find(button=>button.textContent===caption && !button.disabled);
        (control || next?.querySelector('summary'))?.focus({preventScroll:true});
    };
    function message(text) { ui.message=text; status.textContent=text; }
    async function run(action, success) {
        if (ui.busy || keyFor()!==context) return false;
        const origin=document.activeElement;
        ui.busy=true; body.inert=true;
        try { await action(); message(success); return true; }
        catch (error) { message(error.message || String(error)); return false; }
        finally { ui.busy=false; body.inert=false; redraw(origin); }
    }
    const switching=switchContext(preset);
    const switches=resolvedSwitches(switching);
    const workingOff=new Set(workingCopyOff(switching));
    const ownerOf=new Map((switching?.features.switched || []).flatMap(item=>item.blocks.map(block=>[block.id,item.key])));
    function supplier(block) {
        const key=ownerOf.get(block.id);
        if (!key) return null;
        const side=switches[key]==='ours' ? 'Ours' : 'Theirs';
        return button(`${FEATURES[key].label}: ${side}`,()=>app.openPage(PAGE,{anchor:`#ri-switch-${key}`}),{kind:'ghost',title:'Change who supplies this feature'});
    }
    function editable(block,card) {
        const id=block.id, draft=ui.drafts.get(id) || block;
        const current = presetBlockVariation(block);
        const revision = draft.revision || block.revision;
        let variant = draft.variant || null;
        const name=h('input',{class:'ri-input',value:draft.name});
        const content=h('textarea',{class:'ri-input ri-textarea',rows:7,value:draft.content});
        const role=select(choices([['system','System'],['user','User'],['assistant','Assistant']]),draft.role,mark,{'aria-label':'Preset message role'});
        const number=value=>h('input',{class:'ri-input',type:'number',min:0,max:9999,value,oninput:mark});
        const placement=select(choices([['relative','In preset order'],['absolute','At a fixed chat depth']]),draft.absolute ? 'absolute' : 'relative',()=>{depthBox.hidden=placement.value!=='absolute';mark();});
        const depth=number(draft.depth), priority=number(draft.priority);
        const depthBox=h('div',{hidden:!draft.absolute},label('Messages from the end',depth),label('Priority at this depth',priority));
        const triggerField=h('fieldset',{},h('legend',{},'Use for these generation types'),hint('Leave all unchecked to allow every type.'));
        const triggerList=h('div'); triggerField.append(triggerList);
        let triggers=[];
        function showTriggers(selected) {
            triggers=[...new Set(['normal','continue','impersonate','swipe','regenerate','quiet',...selected])]
                .map(value=>h('input',{type:'checkbox',value,checked:selected.includes(value),onchange:mark}));
            triggerList.replaceChildren(...triggers.map(box=>h('label',{class:'ri-vpick'},box,box.value)));
        }
        showTriggers(draft.triggers);
        function values() {
            return {name:name.value,content:content.value,role:role.value,absolute:placement.value==='absolute',depth:depth.valueAsNumber,priority:priority.valueAsNumber,triggers:triggers.filter(box=>box.checked).map(box=>box.value)};
        }
        function mark() { ui.drafts.set(id,{...values(),variant,revision});card.dataset.riDirty=''; variations.updateDraftStatus(); }
        async function apply() {
            const success = await run(async()=>{
                if (variant) await editPresetBlock(preset,id,{type:'variation',value:{...variant,...values()},expected:revision});
                else await editPresetBlock(preset,id,{type:'text',...values(),placement:values(),expected:revision});
                ui.drafts.delete(id);
            },variant ? 'Preset variation applied in SillyTavern.' : 'Preset wording saved in SillyTavern.');
            if (!success) throw new Error(ui.message || 'The preset could not be saved.');
        }
        const variations=variationEditor({owner:promptOwner('preset',preset,id),readDraft:()=>({...current,...variant,...values()}),
            readActive:()=>current,validate:validateBlockVariation,fields:blockFields,applyLabel:`Apply to ${preset}`,applyDraft:apply,
            loadDraft:value=>{
                variant=value; name.value=value.name; content.value=value.content; role.value=value.role;
                placement.value=value.absolute ? 'absolute' : 'relative'; depthBox.hidden=!value.absolute;
                depth.value=value.depth; priority.value=value.priority; showTriggers(value.triggers); mark();
            }});
        name.oninput=content.oninput=mark;
        if (ui.drafts.has(id)) card.dataset.riDirty='';
        return h('div',{},label('Preset block name',name),label('Preset prompt',content),label('Message role',role),
            h('details',{},h('summary',{},'Placement and generation triggers'),label('Prompt placement',placement),depthBox,
                triggerField),
            btns(button('Save preset block',()=>apply().catch(()=>{}),{kind:'primary'}),button('Discard draft',()=>{ui.drafts.delete(id); redraw();})),variations.root);
    }
    function toggleButton(block) {
        const guarded=isGuard(block), armed=ui.confirm===block.id;
        const caption=block.enabled ? 'Turn preset block off' : 'Turn preset block on';
        if (guarded && !armed) return button(caption,()=>{ui.confirm=block.id;message(`${plainName(block.name)} guards the preset. Tap again to confirm.`);redraw();});
        return button(armed ? `Confirm: ${caption.toLowerCase()}` : caption,()=>{ui.confirm=null;run(()=>editPresetBlock(preset,block.id,{type:'enabled',value:!block.enabled,expected:block.revision}),'Preset activation saved.');},{kind:armed ? 'primary' : ''});
    }
    function row(block, index, total) {
        const id=block.id, customized=hasPresetEdit(preset,id);
        const chips=[chip(block.enabled ? 'On' : 'Off',block.enabled ? 'on' : ''),
            !block.marker && chip(customized ? 'Edited' : 'Default',customized ? 'edited' : 'default'),
            isGuard(block) && chip('Lock','lock'),
            workingOff.has(id) && chip('Off in working copy','ours')];
        const card=h('details',{class:'ri-card ri-tight ri-ps-block','data-preset-block':id,'data-ri-view-key':`preset-block:${id}`,open:ui.current===id},
            h('summary',{},h('span',{class:'ri-ps-block-name'},plainName(block.name) || id),h('span',{class:'ri-ps-chips'},chips),
                h('small',{class:'ri-ps-meta'},blockMeta(block))));
        const panel=h('div'); card.append(panel);
        function expand() {
            if (panel.childNodes.length) return;
            const move=delta=>run(()=>editPresetBlock(preset,id,{type:'move',delta,expected:block.revision}),'Preset order saved.');
            panel.append(btns(toggleButton(block),
                button('Move up',()=>move(-1),{disabled:!block.listed || index===0}),
                button('Move down',()=>move(1),{disabled:!block.listed || index===total-1}),supplier(block)));
            if (block.absolute) panel.append(hint('This block uses a fixed chat depth. SillyTavern applies its depth and priority when assembling the request.'));
            panel.append(block.marker ? hint('SillyTavern fills this section from the current chat, card, or World Info.') : editable(block,card));
            const sources=presetRestoreBaselines(preset,id);
            for (const [key,source] of Object.entries(sources).filter(([,source])=>source)) {
                const snapshot=source.snapshot;
                const preview=h('details',{},h('summary',{},`Compare with ${source.label}`),
                    source.captured && hint(`Captured ${new Date(source.captured).toLocaleString()}.`),
                    snapshot.block ? promptComparison({before:snapshot.block.content || '',after:block.content,beforeLabel:source.label,afterLabel:'Current preset block'})
                        : hint('This block was added here. Restoring this baseline removes it.'));
                const caption=key==='file' ? 'Restore from original preset file' : 'Restore default';
                panel.append(preview,button(caption,()=>run(async()=>{
                    await editPresetBlock(preset,id,{type:'restore',from:key,expected:block.revision});ui.drafts.delete(id);
                },`${source.label} restored.`)));
            }
            if (presetRestoreUndo(preset)?.id===id) panel.append(button('Undo restore',()=>run(()=>editPresetBlock(preset,id,{type:'undo'}),'Previous preset block restored.')));
            const keys=blockCompanions(block,preset);
            const mapping=h('details',{},h('summary',{},'Choose matching features by hand'));
            const boxes=Object.keys(MODULES).map(key=>h('input',{type:'checkbox',checked:keys.includes(key),value:key}));
            mapping.append(hint('Used when the preset library does not recognise this preset.'),...boxes.map(box=>h('label',{class:'ri-vpick'},box,FEATURES[box.value]?.label || MODULES[box.value])),
                btns(button('Save matches',()=>{savePair(preset,id,boxes.filter(box=>box.checked).map(box=>box.value));redraw();}),
                    button('Restore automatic matches',()=>{savePair(preset,id,null);redraw();})));
            panel.append(mapping);
        }
        if (card.open) expand();
        card.ontoggle=()=>{if(card.open){ui.current=id;expand();}else if(ui.current===id){ui.current=null;}};
        return card;
    }
    function pickOne(group) {
        const name=`ri-pick-${group.name}`;
        const radios=group.rows.map(block=>h('label',{class:'ri-vpick'},h('input',{type:'radio',name,checked:block.enabled,
            onchange:()=>run(async()=>{
                for (const other of group.rows) if (other.id!==block.id && other.enabled) await editPresetBlock(preset,other.id,{type:'enabled',value:false,expected:presetBlockRevision(other.id)});
                if (!block.enabled) await editPresetBlock(preset,block.id,{type:'enabled',value:true,expected:presetBlockRevision(block.id)});
            },`${plainName(block.name)} chosen.`)}),plainName(block.name)));
        const on=group.rows.filter(block=>block.enabled).length;
        return h('fieldset',{class:'ri-ps-pick'},h('legend',{},`Pick one: ${group.name}`),on>1 && chip(`${on} on at once`,'conflict'),radios);
    }
    function orderEditor() {
        const local=prefs(), order=moduleOrder(local.moduleOrder);
        const editor=h('details',{open:ui.orderOpen},h('summary',{},'Extension prompt order'));
        editor.ontoggle=()=>ui.orderOpen=editor.open;
        editor.append(hint('For this chat, choose the order of feature guidance within the Structured request and its update format. Each feature runs when its conditions apply.'));
        const factory=moduleOrder();
        function saveOrder(next) {
            if(next.every((key,i)=>key===factory[i])) delete local.moduleOrder;
            else local.moduleOrder=next;
            saveChatState();redraw();
        }
        order.forEach((key,i)=>{
            const move=delta=>{
                const next=order.slice();next.splice(i+delta,0,...next.splice(i,1));saveOrder(next);
            };
            const moved=local.moduleOrder && i!==factory.indexOf(key);
            const restorePosition=()=>{
                const next=order.filter(item=>item!==key);
                next.splice(factory.indexOf(key),0,key);saveOrder(next);
            };
            editor.append(expandOnce(h('details',{class:'ri-card ri-tight',open:ui.orderKey===key,ontoggle:event=>{
                if(event.target.open)ui.orderKey=key;else if(ui.orderKey===key)ui.orderKey=null;
            }},h('summary',{},(FEATURES[key]?.label || MODULES[key])+(moved ? ' · Order changed' : '')),btns(moved && button('Restore position',restorePosition),button('Move earlier',()=>move(-1),{disabled:i===0}),button('Move later',()=>move(1),{disabled:i===order.length-1}))),()=>extensionEditors(key,profile)));
        });
        if(local.moduleOrder) editor.append(button('Restore extension order',()=>{delete local.moduleOrder;saveChatState();redraw();}));
        return editor;
    }
    function build() {
        const rows=presetRows().map(row=>({...row,revision:presetBlockRevision(row.id)})), listed=rows.filter(row=>row.listed).length;
        const list=h('div'), filter=h('input',{type:'search',class:'ri-input',value:ui.query || '',placeholder:'Filter by block or feature'});
        const index=new Map(rows.filter(row=>row.listed).map((row,i)=>[row.id,i]));
        function showRows() {
            ui.query=filter.value;
            const term=ui.query.toLowerCase().trim();
            const matching=block=>!term || [block.name,...blockCompanions(block,preset).map(key=>FEATURES[key]?.label || MODULES[key])].join(' ').toLowerCase().includes(term);
            const groups=groupBlocks(rows.filter(row=>row.listed));
            list.replaceChildren();
            for (const group of groups) {
                const shown=group.rows.filter(matching);
                if (term && !shown.length) continue;
                const on=group.rows.filter(row=>row.enabled).length;
                const title=group.heading ? headingTitle(group.heading) || group.heading.id : 'Before the first heading';
                const fold=h('details',{class:'ri-ps-group',open:!!term || ui.openGroups?.has(title) || shown.some(row=>row.id===ui.current)},
                    h('summary',{},h('span',{},title),chip(`${on} of ${group.rows.length} on`)),
                    group.picks.map(pickOne),shown.map(block=>row(block,index.get(block.id),listed)),
                    group.heading && h('div',{class:'ri-ps-heading-row'},row(group.heading,index.get(group.heading.id),listed)));
                fold.ontoggle=()=>{(ui.openGroups ||= new Set())[fold.open ? 'add' : 'delete'](title);};
                list.append(fold);
            }
            const unused=rows.filter(row=>!row.listed && matching(row));
            if(unused.length) list.append(h('details',{open:!!term || unused.some(block=>block.id===ui.current)},h('summary',{},`Available outside the prompt order (${unused.length})`),unused.map(block=>row(block,-1,listed))));
            if(!list.childNodes.length) list.append(hint('No matching blocks.'));
        }
        filter.oninput=showRows;showRows();
        const title=h('input',{class:'ri-input',value:ui.newName || ''});
        const text=h('textarea',{class:'ri-input ri-textarea',value:ui.newText || ''});
        title.oninput=()=>{ui.newName=title.value;};text.oninput=()=>{ui.newText=text.value;};
        const compare=h('details',{open:ui.compare},h('summary',{},'Compare preset and extension with AI'),
            hint('One optional request sends preset names, prompt excerpts and extension guidance to the saved connection. Suggestions change settings when you accept a match.'),
            promptGroup(['parityEvaluation'],'Edit comparison prompts'),
            functionExecution('presetParity',{receipt:executionReceipt('presetParity')}),
            button('Compare with 1 model call',()=>run(async()=>{ui.matches=await evaluateParity(rows);ui.compare=true;},'Comparison complete.')));
        compare.ontoggle=()=>ui.compare=compare.open;
        for(const item of ui.matches) {
            const block=rows.find(row=>row.id===item.id); if(!block) continue;
            const keys=blockCompanions(block,preset);
            compare.append(h('div',{class:'ri-card ri-tight'},h('strong',{},plainName(block.name)+' → '+(FEATURES[item.module]?.label || MODULES[item.module])),hint((['close','partial','conflicting'].includes(item.coverage) ? item.coverage+' match · ' : '')+item.reason),
                button(keys.includes(item.module) ? 'Already matched' : 'Use this match',()=>{savePair(preset,item.id,[...keys,item.module]);redraw();},{disabled:keys.includes(item.module)})));
        }
        if(ui.message==='Comparison complete.' && !ui.matches.length) compare.append(hint('No matching features were suggested.'));
        const file=h('input',{type:'file',accept:'.json,application/json','aria-label':'Original preset JSON',hidden:true});
        const originalFileName=presetRestoreFileName(preset);
        const restoreFile=h('details',{},h('summary',{},'Attach an original preset file'),
            hint(originalFileName ? `Restore source for ${preset}: ${originalFileName}.` : `Attach the original JSON for ${preset} to make its matching blocks available as restore sources.`),
            button('Choose original preset JSON',()=>file.click()),file);
        file.onchange=()=>{
            const source=file.files?.[0];
            if (!source) return;
            run(async()=>{
                if (source.size>4000000) throw new Error('The preset JSON file is too large.');
                const parsed=JSON.parse(await source.text());
                linkPresetRestoreFile(preset,source.name,parsed);
            },'Original preset file linked.');
        };
        const undo=presetRestoreUndo(preset);
        body.replaceChildren(...[hint('Block changes here save to the preset itself and apply to every chat using it. The working copy and the feature switches never change the file.'),
            restoreFile,undo && !rows.some(row=>row.id===undo.id) && button('Undo last preset restore',()=>run(()=>editPresetBlock(preset,undo.id,{type:'undo'}),'Previous preset block restored.')),
            h('details',{},h('summary',{},'Add a preset block'),label('New block name',title),label('New prompt',text),
                button('Add to end of preset',()=>run(async()=>{
                    const id=crypto.randomUUID?.() || 'ri-'+Date.now().toString(36)+Math.random().toString(36).slice(2);
                    await editPresetBlock(preset,id,{type:'add',name:title.value,content:text.value});ui.current=id;ui.query=ui.newName=ui.newText='';
                },'Added an enabled system block.'))),prefs() && enabledV10() ? orderEditor() : null,compare,label('Find a preset block',filter),list].filter(Boolean));
        body.inert=!!ui.busy;
    }
    details.append(h('summary',{},`Preset blocks (${presetRows().filter(row=>row.listed && !isHeading(row)).length})`),status,body);
    if(details.open) build();
    details.ontoggle=()=>{ui.open=details.open;if(details.open && !body.childNodes.length) build();};
    return details;
}
