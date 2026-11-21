import { h, button, download } from './dom.js';
import { listVariations, readVariationFile, saveVariation, setVariationRemoved, variationFile } from '../prompt-variations.js';

const same = (left,right) => JSON.stringify(left)===JSON.stringify(right);
const format = value => typeof value==='string' ? value : JSON.stringify(value,null,2);

export function promptComparison({ before, after, beforeLabel = 'Saved instruction', afterLabel = 'Draft', fields } = {}) {
    const body = h('div',{class:'ri-variation-diff'});
    if (same(before,after)) body.append(h('p',{class:'ri-help'},'Both versions match.'));
    else if (fields && before && after) {
        for (const [key,label] of Object.entries(fields)) {
            if (same(before[key],after[key])) continue;
            body.append(h('div',{},h('strong',{},label),h('span',{},beforeLabel),h('pre',{},format(before[key])),h('span',{},afterLabel),h('pre',{},format(after[key]))));
        }
    } else {
        body.append(h('strong',{},beforeLabel),h('pre',{},format(before)),h('strong',{},afterLabel),h('pre',{},format(after)));
    }
    for (const pre of body.querySelectorAll('pre')) Object.assign(pre.style,{whiteSpace:'pre-wrap',overflowWrap:'anywhere'});
    return body;
}

export function variationEditor({ owner, readDraft, readActive, loadDraft, applyDraft, validate = () => '', fields, applyLabel = 'Apply variation' }) {
    const root = h('details',{class:'ri-variations'});
    const summary = h('summary',{style:{minHeight:'44px',alignContent:'center'}},'Named variations');
    const fieldStyle = {minHeight:'44px'};
    const picker = h('select',{class:'ri-input','aria-label':'Saved variation',style:fieldStyle});
    const name = h('input',{class:'ri-input','aria-label':'Variation name',maxLength:80,style:fieldStyle});
    const file = h('input',{type:'file',accept:'.json,application/json','aria-label':'Import variation JSON',style:{...fieldStyle,maxWidth:'100%'}});
    const note = h('p',{class:'ri-help','aria-live':'polite'});
    const status = h('p',{class:'ri-help'});
    const compare = h('div');
    const archive = h('div');
    const label = (caption,control) => h('label',{class:'ri-field'},caption,control);
    const row = (...buttons) => h('div',{class:'ri-row ri-row-tight'},buttons);
    const action = (caption,run,options) => {
        const control = button(caption,async()=>{
            try { await run(); } catch (error) { note.textContent=String(error?.message || error); }
        },options);
        control.style.minHeight='44px';
        return control;
    };
    let selectedId = '', loadedId = '', comparing = false;
    const selected = () => listVariations(owner).find(entry=>entry.id===selectedId);
    function checked(value) {
        const error = validate(value);
        if (error) throw new Error(error);
        return value;
    }
    function showStatus(items) {
        const loaded = items.find(item=>item.id===loadedId);
        const active = items.find(item=>same(item.value,readActive()));
        status.textContent = [active && `${active.name} matches the active instruction.`,
            loaded && `Loaded ${loaded.name}${same(loaded.value,readDraft()) ? '.' : ' · draft edited.'}`].filter(Boolean).join(' ');
    }
    function refresh() {
        const items = listVariations(owner);
        const picked = items.find(item=>item.id===selectedId);
        picker.replaceChildren(h('option',{value:''},'Choose a saved variation'),...items.map(item=>h('option',{value:item.id},item.name)));
        picker.value = picked?.id || '';
        name.value = picked?.name || '';
        showStatus(items);
        for (const control of [load,apply,update,rename,duplicate,remove,exportFile,compareButton]) control.disabled = !picked;
        compare.replaceChildren(...(comparing && picked ? [promptComparison({before:readActive(),after:picked.value,afterLabel:picked.name,fields})] : []));
        const removed = listVariations(owner,{removed:true});
        archive.replaceChildren(...removed.map(item=>action(`Recover ${item.name}`,()=>{
            setVariationRemoved(owner,item.id,false); selectedId=item.id; refresh(); note.textContent='Variation recovered.';
        })));
        archive.hidden = !removed.length;
    }
    function selectEntry(entry,message) {
        selectedId=entry.id;
        refresh(); note.textContent=message;
    }
    function setDraft() {
        const entry = selected();
        loadDraft(structuredClone(checked(entry.value)));
        loadedId=entry.id;
        refresh();
        return entry;
    }
    const load = action('Load variation into draft',()=>{
        const entry=setDraft(); note.textContent=`Loaded ${entry.name} into the editor. Save to apply it.`;
    });
    const apply = action(applyLabel,async()=>{
        const entry=setDraft(); await applyDraft(); refresh(); note.textContent=`Applied ${entry.name}.`;
    });
    const saveAs = action('Save draft as variation',()=>{
        selectEntry(saveVariation(owner,{name:name.value,value:checked(readDraft())}),'Variation saved.');
    });
    const update = action('Update variation from draft',()=>{
        const entry=selected(); selectEntry(saveVariation(owner,{...entry,value:checked(readDraft())}),'Variation updated.');
    });
    const rename = action('Rename variation',()=>{
        selectEntry(saveVariation(owner,{...selected(),name:name.value}),'Variation renamed.');
    });
    const duplicate = action('Duplicate variation',()=>{
        const entry=selected();
        const used=new Set(listVariations(owner).map(item=>item.name.toLowerCase()));
        let suffix=' (copy)', count=1;
        while (used.has((entry.name.slice(0,80-suffix.length)+suffix).toLowerCase())) suffix=` (copy ${++count})`;
        selectEntry(saveVariation(owner,{name:entry.name.slice(0,80-suffix.length)+suffix,value:entry.value}),'Variation copied.');
    });
    const remove = action('Remove variation',()=>{
        setVariationRemoved(owner,selectedId,true); selectedId=''; refresh(); note.textContent='Variation removed. Use Undo removal below to recover it.';
    });
    const exportFile = action('Export variation',()=>{
        const entry=selected();
        if (!download(`${entry.name.replace(/[\\/:*?"<>|]/g,'-')}.json`,JSON.stringify(variationFile(entry),null,2))) throw new Error('This host could not start the download.');
        note.textContent='Export started.';
    });
    const compareButton = action('Compare with active instruction',()=>{ comparing=!comparing; refresh(); });
    picker.onchange=()=>{ selectedId=picker.value; comparing=!!selectedId; refresh(); };
    file.onchange=async()=>{
        const source=file.files?.[0];
        if (!source) return;
        try {
            if (source.size>200000) throw new Error('The variation JSON file is too large.');
            const entry=readVariationFile(JSON.parse(await source.text()));
            selectEntry(saveVariation(owner,{name:entry.name,value:checked(entry.value)}),'Variation imported.');
        } catch (error) { note.textContent=String(error?.message || error); }
        finally { file.value=''; }
    };
    root.append(summary,label('Saved variation',picker),status,compare,
        row(compareButton,load,applyDraft && apply),label('Variation name',name),row(saveAs,update,rename,duplicate),
        row(remove,exportFile),h('details',{},h('summary',{style:fieldStyle},'Import variation'),file),
        h('details',{open:true},h('summary',{style:fieldStyle},'Undo removal'),archive),note);
    refresh();
    return { root, updateDraftStatus:()=>showStatus(listVariations(owner)) };
}
