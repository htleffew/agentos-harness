import { h, button, field, select } from './dom.js';
import { slot, homeLink } from './homes.js';
import { promptComparison, variationEditor } from './prompt-variations.js';
import { promptOwner } from '../prompt-variations.js';
import { sub } from '../st.js';
import { draftImpersonation, hasHostImpersonationDefault, impersonationBaselines, impersonationMode, impersonationSource, playerPrompt, readHostImpersonationDefault,
    saveImpersonationField, setImpersonationSource } from '../impersonation.js';

const readout = (label,text) => h('div',{class:'ri-field'},h('strong',{},label),
    h('pre',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},text));

function sharedFieldEditor(initial, onChange) {
    let source=initial, undo=null;
    const root=h('details',{class:'ri-card ri-tight'},h('summary',{},`Edit shared preset ${source.preset}`));
    const box=h('textarea',{class:'ri-input ri-textarea',value:source.text,rows:6,maxLength:12000,'aria-label':'Shared impersonation instruction'});
    const status=h('p',{class:'ri-help','aria-live':'polite'});
    const controls=h('div',{class:'ri-row'});
    const preview=h('div');
    const comparison=h('div');
    function inspect(value) {
        preview.replaceChildren(readout('Preview with this chat’s macros',sub(value) || '(blank)'));
        root.toggleAttribute('data-ri-dirty',value!==source.text);
        variants.updateDraftStatus();
    }
    async function save() {
        source=await saveImpersonationField(source,box.value);
        inspect(box.value); refreshRestores(); onChange();
    }
    const run = (action,message) => async()=>{
        try { await action(); status.textContent=message; }
        catch (error) { status.textContent=error.message; }
    };
    function refreshRestores() {
        const {before,file}=impersonationBaselines(source);
        controls.replaceChildren();
        comparison.replaceChildren();
        for (const baseline of [file,before].filter(Boolean)) {
            const label=baseline===file ? 'Restore from original preset file' : 'Restore before extension edits';
            comparison.append(h('details',{},h('summary',{},baseline.label),baseline.captured && h('small',{},`Captured ${new Date(baseline.captured).toLocaleString()}`),
                promptComparison({before:baseline.text,after:source.text,beforeLabel:baseline.label,afterLabel:'Current host field'})));
            controls.append(button(label,run(async()=>{
                const previous=source.text;
                box.value=baseline.text;
                await save(); undo=previous; refreshRestores();
            },`${baseline.label} restored.`)));
        }
        if (undo!==null) controls.append(button('Undo restore',run(async()=>{
            box.value=undo; await save(); undo=null; refreshRestores();
        },'Previous shared wording restored.')));
    }
    const variants=variationEditor({owner:promptOwner('preset',source.preset,'impersonation_prompt'),readDraft:()=>box.value,readActive:()=>source.text,
        loadDraft:value=>{box.value=value;inspect(value);},applyDraft:save,applyLabel:`Apply to ${source.preset}`,
        validate:value=>typeof value==='string' && value.length<=12000 ? '' : 'Choose a text variation of up to 12,000 characters.'});
    box.oninput=()=>inspect(box.value);
    root.append(h('p',{class:'ri-help'},`Saving applies to every chat that uses ${source.preset}. Keep host macros in the saved text.`),
        field('Shared impersonation instruction','',box),preview,
        button('Save shared impersonation prompt',run(save,'Saved in the active host preset.'),{kind:'primary'}),
        variants.root,comparison,controls,
        hasHostImpersonationDefault() && button('Load host utility default into draft',run(()=>{
            box.value=readHostImpersonationDefault(source); inspect(box.value);
        },'Host utility default loaded into the draft. Save to apply it to this preset.')),status);
    inspect(box.value); refreshRestores();
    return root;
}

export function impersonationInspector({ operation = 'playerDraft', guidance = () => '', mode = 'helper', onChange = () => {}, editable = true, link = true } = {}) {
    const initial=impersonationSource();
    const base=h('span');
    const preview=h('div');
    const editors=h('div');
    const note=h('p',{class:'ri-help','aria-live':'polite'});
    const root=h('details',{class:'ri-impersonation'},h('summary',{style:{minHeight:'44px',alignContent:'center'}},'Impersonation prompt ',base));
    function refresh() {
        const current=impersonationSource();
        const selectedMode=typeof mode==='function' ? mode() : mode;
        const selectedOperation=typeof operation==='function' ? operation() : operation;
        const active=draftImpersonation({mode:selectedMode,operation:selectedOperation});
        base.textContent=`· ${current.preset || current.source} · ${active.status}`;
        if (!root.open) return;
        const blocks=[];
        if (current.kind==='opaque') blocks.push(h('p',{class:'ri-help'},`${current.source}: ${current.status}.`));
        else if (current.source!==active.source || current.text!==active.text) blocks.push(readout(current.source,current.text || '(blank)'));
        blocks.push(readout(`Base used · ${active.source}`,active.text==='' ? '(blank)' : active.text ?? '(unavailable)'));
        if (active.text!==active.expanded) blocks.push(readout('Preview with this chat’s macros',active.expanded || '(blank)'));
        if (['playerChoices','playerExpansion'].includes(selectedOperation)) {
            const instruction=playerPrompt(selectedOperation,{count:3});
            blocks.push(readout(selectedOperation==='playerChoices' ? 'Choices instruction' : 'Expansion instruction',instruction.expanded));
            if (instruction.privateMacro) blocks.push(h('p',{class:'ri-help'},'This instruction uses the installed default to keep host context macros out of the player request.'));
        }
        if (active.privateMacro) blocks.push(h('p',{class:'ri-help'},'The draft uses the extension template to keep host context macros out of the player request.'));
        const cue=typeof guidance==='function' ? guidance() : guidance;
        blocks.push(readout('Directions for this action',Array.isArray(cue) ? cue.join('\n') || '(none selected)' : cue || '(none selected)'));
        if (selectedMode==='native' && !active.include) blocks.push(h('p',{class:'ri-help'},'The native request supplies this base.'));
        preview.replaceChildren(...blocks);
    }
    root.refresh=refresh;
    const readable=['prompt','blank'].includes(initial.kind);
    if (editable && readable) editors.append(field('Base for direct player helpers',`A choice for ${initial.preset || 'this host connection'}.`,
        select([{value:'preset',label:'Follow host preset'},{value:'extension',label:'Use extension instruction'}],
            impersonationMode(initial),value=>{
                try { setImpersonationSource(initial,value); refresh(); onChange(); }
                catch (error) { note.textContent=error.message; }
            },{'aria-label':'Base for direct player helpers'})));
    if (editable && initial.writable) editors.append(sharedFieldEditor(initial,refresh));
    if (editable) editors.append(slot(['playerDraft','playerChoices','playerExpansion'],'Impersonation prompts',{bare:true,onChange:refresh}));
    root.append(preview,editable ? editors : link ? homeLink(null,'impersonation-prompts','The impersonation prompts are edited in Setup, Features, Advanced prompts.') : '',note);
    root.addEventListener('toggle',refresh);
    refresh();
    return root;
}
