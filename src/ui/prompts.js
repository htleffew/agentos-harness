// Prompt editors. Each prompt is stored once; promptEditor and promptGroup draw the mirrored editor of
// prompt-mirror.js, the same view that Setup, Prompts lists. No model calls are made by this UI.
import { createVoice, exportVoice, importVoice, voiceRecords } from '../voices.js';
import { h, button, download } from './dom.js';
import { promptDefinition, promptStatus, selectedVoice } from '../prompts.js';
import { settings, saveSettings } from '../store.js';
import { mirroredPrompt, problemNote, watchPrompts } from './prompt-mirror.js';
import './prompts-home.js';

/** One mirrored editor for a stored prompt. An unknown id draws a Problem note in its place. */
export function promptEditor(id, { onChange = () => {} } = {}) {
    return mirroredPrompt(id, { onChange });
}

/** A fold of mirrored editors for one feature. The ids are the stored prompts the feature uses. */
export function promptGroup(ids, label = 'Customize AI instructions', { contextual = false, onChange = () => {} } = {}) {
    const known = ids.filter(id => promptDefinition(id));
    const badge = h('span', { class: 'ri-prompt-badge' });
    const refresh = () => {
        const customized = known.filter(id => promptStatus(id).customized).length;
        badge.textContent = customized ? `Customized (${customized})` : 'Default';
    };
    const options = { onChange: () => { if (contextual) refresh(); onChange(); } };
    const group = h('details', { class: contextual ? 'ri-prompt-group ri-prompt-contextual' : 'ri-prompt-group', 'data-ri-prompt-ids': ids.join(' ') },
        h('summary', {}, h('span', {}, label), contextual ? badge : null),
        h('div', { class: 'ri-help' }, 'Edits apply to this feature across chats and appear in Setup, Prompts at once. Live chat data and required output formats are assembled separately.'),
        ids.map(id => mirroredPrompt(id, options)));
    if (contextual) {
        refresh();
        watchPrompts(group, changed => { if (known.includes(changed)) refresh(); });
    }
    return group;
}

export function roastVoiceEditor(otherIds = [], title = 'Customize Roast voice') {
    const group = h('details',{class:'ri-prompt-group'},h('summary',{},title));
    const content = h('div');
    const picker = h('select',{class:'ri-input','aria-label':'Commentator voice'});
    const editors = new Map();
    let shown = '';
    // The picker and the editor below it always name the same voice, so an edit never lands on a voice the picker does not show.
    const showEditor = () => {
        if (!editors.has(picker.value)) editors.set(picker.value,promptEditor(picker.value,{onChange:refreshLabels}));
        content.replaceChildren(editors.get(picker.value));
        shown = picker.value;
    };
    function refreshLabels() {
        const current=selectedVoice();
        picker.replaceChildren(...voiceRecords().map(({id,name})=>h('option',{value:id},name+(promptStatus(id).customized ? ' · Customized' : ''))));
        picker.value=current;
        if (shown && shown!==picker.value) showEditor();
    }
    function showVoice() {
        refreshLabels();
        showEditor();
    }
    picker.onchange = () => {
        settings().roastVoiceId = picker.value;
        saveSettings();
        showVoice();
    };
    const name=h('input',{class:'ri-input',maxLength:80,'aria-label':'New commentator voice name'});
    const direction=h('textarea',{class:'ri-input ri-textarea',rows:4,maxLength:12000,'aria-label':'New commentator voice direction'});
    const note=h('p',{class:'ri-help','aria-live':'polite'});
    const file=h('input',{type:'file',accept:'.json,application/json','aria-label':'Import voice JSON',hidden:true});
    file.onchange=async()=>{
        const source=file.files?.[0];
        if (!source) return;
        try {
            if (source.size>2000000) throw new Error('The voice JSON file is too large.');
            importVoice(JSON.parse(await source.text())); showVoice(); note.textContent='Voice and variations imported.';
        } catch (error) { note.textContent=error.message; } finally { file.value=''; }
    };
    group.append(h('label',{class:'ri-field'},'Commentator voice',picker),
        h('p',{class:'ri-help'},'Used for future Roast cards across chats. Each voice keeps its own edits.'),content,
        h('details',{},h('summary',{},'New commentator voice'),h('label',{class:'ri-field'},'Voice name',name),
            h('label',{class:'ri-field'},'Voice direction',direction),button('Save new voice',()=>{
                try { createVoice(name.value,direction.value); name.value=direction.value=''; showVoice(); note.textContent='Created and selected a voice.'; }
                catch (error) { note.textContent=error.message; }
            })),
        h('details',{},h('summary',{},'Import or export a voice'),button('Choose voice JSON',()=>file.click()),file,
            button('Export selected voice',()=>{
                const voice=exportVoice(selectedVoice());
                if (download(`${voice.name.replace(/[\\/:*?"<>|]/g,'-')}.json`,JSON.stringify(voice,null,2))) note.textContent='Export started.';
                else note.textContent='This host could not start the download.';
            })),note,...otherIds.map(id=>promptEditor(id)));
    watchPrompts(group,()=>{ if (group.isConnected) refreshLabels(); });
    showVoice();
    return group;
}
