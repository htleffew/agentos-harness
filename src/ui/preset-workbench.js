import { h, button, select } from './dom.js';
import { promptEditor, promptGroup, roastVoiceEditor } from './prompts.js';
import { promptComparison, variationEditor } from './prompt-variations.js';
import { promptOwner } from '../prompt-variations.js';
import { executionAction, functionExecution } from './execution.js';
import { executionReceipt } from '../execution.js';
import { ctx } from '../st.js';
import { saveChatState } from '../store.js';
import { moduleOrder, MODULE_PROMPTS } from '../module-layout.js';
import { activePreset, prefs, MODULES, enabledV10, blockCompanions, effectiveModules, setModuleOwner } from '../v10.js';
import { presetRows, hasPresetEdit, editPresetBlock, savePair, evaluateParity, presetBlockRevision, presetBlockVariation,
    validateBlockVariation, presetRestoreBaselines, presetRestoreFileName, presetRestoreUndo, linkPresetRestoreFile } from '../preset-workbench.js';

const hint = text=>h('p',{class:'ri-help'},text);
const label = (name,input)=>h('label',{class:'ri-field'},h('span',{class:'ri-label'},name),input);
const btns = (...items)=>h('div',{class:'ri-row ri-row-tight'},items);
const choices = pairs=>pairs.map(([value,label])=>({value,label}));
const keyFor = () => JSON.stringify([ctx().getCurrentChatId?.(),activePreset()]);
const blockFields = {name:'Name',content:'Wording',role:'Message role',absolute:'Fixed depth',depth:'Depth',priority:'Priority',
    triggers:'Generation triggers',listed:'Listed in prompt order',enabled:'Enabled',preceding:'Earlier blocks',following:'Later blocks'};
function expandOnce(details, render) {
    let built=false;
    const show=()=>{if (details.open && !built) {built=true;details.append(render());}};
    details.addEventListener('toggle',show);
    show();
    return details;
}
function extensionEditors(key,profile) {
    return h('div',{},hint('Instruction wording saved here applies across chats. Live values and required response fields are assembled at generation.'),
        prefs() && profile?.(key),key==='roast' && roastVoiceEditor(),
        MODULE_PROMPTS[key].map(id=>promptEditor(id)));
}

export function presetWorkbench(preset,app,profile) {
    const context=keyFor();
    if (app.presetWorkspace?.context!==context) app.presetWorkspace={context,drafts:new Map(),matches:[]};
    const ui=app.presetWorkspace;
    const details=h('details',{class:'ri-card ri-preset-workbench',open:ui.open});
    const body=h('div');
    const status=h('p',{class:'ri-help',role:'status'},ui.message || '');
    const redraw=(element=document.activeElement)=>{
        if (keyFor()!==context || app.tab!=='v10') return;
        const row=element?.closest('[data-preset-block]');
        const id=row?.dataset.presetBlock, aria=element?.getAttribute('aria-label');
        const caption=element?.tagName==='BUTTON' ? element.textContent : '';
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
    const modes=choices([['none','Both off'],['preset','Preset only'],['extension','Extension only'],['both','Both on']]);
    function companion(block,key) {
        const active=!!prefs() && enabledV10(), ext=active && effectiveModules()[key];
        const current=block.enabled ? ext ? 'both' : 'preset' : ext ? 'extension' : 'none';
        const control=select(modes,current,value=>run(async()=>{
            const host=['preset','both'].includes(value), extension=['extension','both'].includes(value);
            if (host!==block.enabled) await editPresetBlock(preset,block.id,{type:'enabled',value:host,expected:block.revision});
            if (keyFor()!==context) throw new Error('The chat changed while saving the preset. Reopen the original chat to change its module.');
            (prefs().modules ||= {})[key]=extension;
            setModuleOwner(preset,key,extension ? 'both' : 'preset');
        },'Instruction sources saved.'),{'aria-label':`Instruction sources for ${key} and ${block.name}`,disabled:!active});
        return h('div',{class:'ri-module-row'},label(MODULES[key],control),
            !active && hint('Select Structured story workflow to control the extension side.'),
            active && (Object.hasOwn(prefs().modules || {},key) || Object.hasOwn(prefs().moduleOwners?.[preset] || {},key)) &&
                button('Reset extension activation to default',()=>{
                    if (prefs().modules) delete prefs().modules[key];
                    setModuleOwner(preset,key,undefined);redraw();
                }),
            expandOnce(h('details',{},h('summary',{},'Edit extension instructions')),()=>extensionEditors(key,profile)));
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
        return h('div',{},label('Preset block name',name),label('Preset instruction',content),label('Message role',role),
            h('details',{},h('summary',{},'Placement and generation triggers'),label('Prompt placement',placement),depthBox,
                triggerField),

            btns(button('Save preset block',()=>apply().catch(()=>{}),{kind:'primary'}),button('Discard draft',()=>{ui.drafts.delete(id); redraw();})),variations.root);
    }
    function row(block, index, total) {
        const id=block.id, customized=hasPresetEdit(preset,id), keys=blockCompanions(block,preset);
        const card=h('details',{class:'ri-card ri-tight','data-preset-block':id,open:ui.current===id},
            h('summary',{},block.name+' · '+(block.enabled ? 'On' : 'Off')+(customized ? ' · Edited' : ''),
                keys.length ? h('small',{class:'ri-block-pairs'},keys.map(key=>MODULES[key]).join(' · ')) : null));
        const panel=h('div'); card.append(panel);
        function expand() {
            if (panel.childNodes.length) return;
            const move=delta=>run(()=>editPresetBlock(preset,id,{type:'move',delta,expected:block.revision}),'Preset order saved.');
            panel.append(btns(button(block.enabled ? 'Turn preset block off' : 'Turn preset block on',()=>run(()=>editPresetBlock(preset,id,{type:'enabled',value:!block.enabled,expected:block.revision}),'Preset activation saved.')),
                button('Move up',()=>move(-1),{disabled:!block.listed || index===0}),
                button('Move down',()=>move(1),{disabled:!block.listed || index===total-1})));
            if (block.absolute) panel.append(hint('This block uses a fixed chat depth. SillyTavern applies its depth and priority when assembling the request.'));
            panel.append(block.marker ? hint('SillyTavern or TauriTavern fills this section from the current chat, card, or World Info.') : editable(block,card));
            const sources=presetRestoreBaselines(preset,id);
            for (const [key,source] of Object.entries(sources).filter(([,source])=>source)) {
                const snapshot=source.snapshot;
                const preview=h('details',{},h('summary',{},`Compare with ${source.label}`),
                    source.captured && hint(`Captured ${new Date(source.captured).toLocaleString()}.`),
                    snapshot.block ? promptComparison({before:snapshot.block.content || '',after:block.content,beforeLabel:source.label,afterLabel:'Current preset block'})
                        : hint('This block was added in the workbench. Restoring this baseline removes it.'));
                const caption=key==='file' ? 'Restore from original preset file' : 'Restore before extension edits';
                panel.append(preview,button(caption,()=>run(async()=>{
                    await editPresetBlock(preset,id,{type:'restore',from:key,expected:block.revision});ui.drafts.delete(id);
                },`${source.label} restored.`)));
            }
            if (presetRestoreUndo(preset)?.id===id) panel.append(button('Undo restore',()=>run(()=>editPresetBlock(preset,id,{type:'undo'}),'Previous preset block restored.')));
            for (const key of keys) panel.append(companion(block,key));
            if (!keys.length) panel.append(hint('Choose a matching module below to compare its instructions and pick which source runs.'));
            const mapping=h('details',{},h('summary',{},'Choose matching extension modules'));
            const boxes=Object.keys(MODULES).map(key=>h('input',{type:'checkbox',checked:keys.includes(key),value:key}));
            mapping.append(...boxes.map(box=>h('label',{class:'ri-vpick'},box,MODULES[box.value])),
                btns(button('Save matches',()=>{savePair(preset,id,boxes.filter(box=>box.checked).map(box=>box.value));redraw();}),
                    button('Restore automatic matches',()=>{savePair(preset,id,null);redraw();})));
            panel.append(mapping);
        }
        if (card.open) expand();
        card.ontoggle=()=>{if(card.open){ui.current=id;expand();}else if(ui.current===id){ui.current=null;}};
        return card;
    }
    function orderEditor() {
        const local=prefs(), order=moduleOrder(local.moduleOrder);
        const editor=h('details',{open:ui.orderOpen},h('summary',{},'Extension instruction order'));
        editor.ontoggle=()=>ui.orderOpen=editor.open;
        editor.append(hint('For this chat, choose the order of module guidance within the Structured request and its update format. Each feature runs when its conditions apply.'));
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
            }},h('summary',{},MODULES[key]+(moved ? ' · Order changed' : '')),btns(moved && button('Restore module position',restorePosition),button('Move earlier',()=>move(-1),{disabled:i===0}),button('Move later',()=>move(1),{disabled:i===order.length-1}))),()=>extensionEditors(key,profile)));
        });
        if(local.moduleOrder) editor.append(button('Restore extension order',()=>{delete local.moduleOrder;saveChatState();redraw();}));
        return editor;
    }
    function build() {
        const rows=presetRows().map(row=>({...row,revision:presetBlockRevision(row.id)})), listed=rows.filter(row=>row.listed).length;
        const list=h('div'), filter=h('input',{type:'search',class:'ri-input',value:ui.query || '',placeholder:'Filter by block or module'});
        function showRows() {
            ui.query=filter.value;
            const term=ui.query.toLowerCase().trim();
            const matches=rows.map((block,i)=>({block,i})).filter(({block})=>[block.name,...blockCompanions(block,preset).map(key=>MODULES[key])].join(' ').toLowerCase().includes(term));
            list.replaceChildren(...matches.filter(({block})=>block.listed).map(({block,i})=>row(block,i,listed)));
            const unused=matches.filter(({block})=>!block.listed);
            if(unused.length) list.append(h('details',{open:!!term || unused.some(({block})=>block.id===ui.current)},h('summary',{},`Available outside the prompt order (${unused.length})`),unused.map(({block})=>row(block,-1,listed))));
            if(!matches.length) list.append(hint('No matching blocks.'));
        }
        filter.oninput=showRows;showRows();
        const title=h('input',{class:'ri-input',value:ui.newName || ''});
        const text=h('textarea',{class:'ri-input ri-textarea',value:ui.newText || ''});
        title.oninput=()=>{ui.newName=title.value;};text.oninput=()=>{ui.newText=text.value;};
        const compare=h('details',{open:ui.compare},h('summary',{},'Compare preset and extension with AI'),
            hint('One optional request sends preset names, instruction excerpts and extension guidance to the saved connection. Suggestions change settings when you accept a match.'),
            promptGroup(['parityEvaluation'],'Edit comparison instructions'),
            functionExecution('presetParity',{receipt:executionReceipt('presetParity')}),
            button('Compare with one model call',()=>run(async()=>{ui.matches=await evaluateParity(rows);ui.compare=true;},'Comparison complete.')));
        compare.ontoggle=()=>ui.compare=compare.open;
        for(const item of ui.matches) {
            const block=rows.find(row=>row.id===item.id); if(!block) continue;
            const keys=blockCompanions(block,preset);
            compare.append(h('div',{class:'ri-card ri-tight'},h('strong',{},block.name+' → '+MODULES[item.module]),hint((['close','partial','conflicting'].includes(item.coverage) ? item.coverage+' match · ' : '')+item.reason),
                button(keys.includes(item.module) ? 'Already matched' : 'Use this match',()=>{savePair(preset,item.id,[...keys,item.module]);redraw();},{disabled:keys.includes(item.module)})));
        }
        if(ui.message==='Comparison complete.' && !ui.matches.length) compare.append(hint('No matching functions were suggested.'));
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
        body.replaceChildren(hint('Preset changes apply to every chat using this saved preset. Extension activation applies to this chat. A source choice controls the displayed preset block and the entire paired extension module. Other preset blocks keep their own settings.'),
            restoreFile,undo && !rows.some(row=>row.id===undo.id) && button('Undo last preset restore',()=>run(()=>editPresetBlock(preset,undo.id,{type:'undo'}),'Previous preset block restored.')),
            h('details',{},h('summary',{},'Add a preset block'),label('New block name',title),label('New instruction',text),
                button('Add to end of preset',()=>run(async()=>{
                    const id=crypto.randomUUID?.() || 'ri-'+Date.now().toString(36)+Math.random().toString(36).slice(2);
                    await editPresetBlock(preset,id,{type:'add',name:title.value,content:text.value});ui.current=id;ui.query=ui.newName=ui.newText='';
                },'Added an enabled system block.'))),prefs() && enabledV10() ? orderEditor() : hint('Extension instruction order is available in Structured workflow.'),compare,label('Find a preset block',filter),list);
        body.inert=!!ui.busy;
    }
    details.append(h('summary',{},'Edit preset blocks and pair extension modules'),status,body);
    if(details.open) build();
    details.ontoggle=()=>{ui.open=details.open;if(details.open && !body.childNodes.length) build();};
    return details;
}
