import { createVoice, exportVoice, importVoice, voiceRecords } from '../voices.js';
// Inline prompt editors. No model calls are made by this UI.
import { h, button, download } from './dom.js';
import { promptDefinition, promptStatus, selectedVoice, validatePrompt, savePrompt, restorePrompt } from '../prompts.js';
import { settings, saveSettings } from '../store.js';
import { promptOwner } from '../prompt-variations.js';
import { promptComparison, variationEditor } from './prompt-variations.js';

export function promptEditor(id, { saveLabel = 'Save instruction', onChange = () => {} } = {}) {
    const def = promptDefinition(id);
    if (!def) throw new Error(`Unknown instruction: ${id}`);
    const title = h('span', {}, def.label);
    const badge = h('span', { class: 'ri-prompt-badge' });
    const note = h('div', { class: 'ri-help', role: 'status' });
    const box = h('textarea', { class: 'ri-input ri-textarea', rows: Math.max(3, Math.min(10, def.text.split('\n').length + 1)), maxLength: 12000, 'aria-label': def.label });
    // Show the saved template, not rendered chat data or substituted placeholders.
    const active = () => settings().prompts?.[id]?.text ?? def.text;
    box.value = active();
    let savedText = box.value;
    const defaultView = h('details', { class: 'ri-prompt-default' }, h('summary', {}, 'Compare with baseline'));
    const original = id.startsWith('voice-') ? 'First saved voice direction' : 'Installed extension default';
    const required = def.required.length ? `Keep ${def.required.map(x => `{${x}}`).join(', ')}; the extension fills ${def.required.length === 1 ? 'it' : 'them'} in.` : 'Live story details and any required response format are supplied separately.';
    const update = () => {
        const status = promptStatus(id);
        badge.textContent = status.customized ? 'Customized' : 'Default';
        if (status.defaultChanged) note.textContent = 'The built-in default has changed since you saved this instruction. Your wording is still in use.';
    };
    function assertCurrent() {
        if (active()!==savedText) throw new Error('This instruction was changed in another editor. Reopen it to compare before saving.');
    }
    function commit() {
        assertCurrent();
        savePrompt(id,box.value);
        savedText=box.value;
        syncDraft(); update(); onChange();
    }
    const save = button(saveLabel, () => {
        try { commit(); note.textContent = 'Saved.'; } catch (e) { note.textContent = e.message; }
    }, { kind: 'primary' });
    const discard = button('Discard draft', () => {
        box.value=savedText;
        syncDraft();
        note.textContent='Draft discarded.';
        box.focus();
    }, {kind:'ghost'});
    let undoValue = null;
    const undo = button('Undo restore', () => {
        if (!undoValue) return;
        try {
            assertCurrent(); savePrompt(id,undoValue);
            box.value = savedText = undoValue; undoValue = null; undo.hidden = true; syncDraft(); update(); onChange();
            note.textContent = 'Your previous instruction was restored.';
        } catch (error) { note.textContent=error.message; }
    }, { kind: 'ghost' });
    undo.hidden = true;
    const restore = button(id.startsWith('voice-') ? 'Restore first saved voice' : 'Restore default', () => {
        try {
            assertCurrent(); undoValue = savedText === def.text ? null : savedText;
            restorePrompt(id); box.value = savedText = def.text; syncDraft(); undo.hidden = !undoValue; update(); onChange();
            note.textContent = `${original} restored.`;
        } catch (error) { note.textContent=error.message; }
    }, { kind: 'ghost' });
    const variants = variationEditor({owner:promptOwner('extension',id),readDraft:()=>box.value,readActive:active,
        loadDraft:value=>{box.value=value;syncDraft();},applyDraft:commit,validate:value=>typeof value==='string' ? validatePrompt(id,value) : 'Choose a text instruction variation.'});
    const wrap = h('details', { class: 'ri-prompt-editor' },
        h('summary', {}, title, badge),
        h('div', { class: 'ri-prompt-body' }, h('div', { class: 'ri-help' }, [def.help, required].filter(Boolean).join(' ')), box, defaultView,
            h('div', { class: 'ri-row ri-row-tight' }, save, discard, restore, undo), variants.root, note));
    const difference = h('div');
    defaultView.append(difference);
    const showDifference = () => {
        if (defaultView.open) difference.replaceChildren(promptComparison({before:def.text,after:box.value,beforeLabel:original}));
    };
    defaultView.ontoggle=showDifference;
    function syncDraft() {
        const dirty = box.value!==savedText;
        wrap.toggleAttribute('data-ri-dirty',dirty);
        discard.hidden = !dirty;
        variants.updateDraftStatus();
        showDifference();
    }
    box.addEventListener('input',syncDraft);
    syncDraft();
    update(); return wrap;
}

export function promptGroup(ids, label = 'Customize AI instructions', { contextual = false, onChange = () => {} } = {}) {
    const badge = h('span', { class: 'ri-prompt-badge' });
    const refresh = () => {
        const customized = ids.filter(id => promptStatus(id).customized).length;
        badge.textContent = customized ? `Customized (${customized})` : 'Default';
    };
    const options = {
        onChange: () => { if (contextual) refresh(); onChange(); },
        saveLabel: contextual ? 'Save prompt' : 'Save instruction',
    };
    const group = h('details', { class: contextual ? 'ri-prompt-group ri-prompt-contextual' : 'ri-prompt-group' },
        h('summary', {}, h('span', {}, label), contextual ? badge : null),
        h('div', { class: 'ri-help' }, 'Edits apply to this feature across chats. Live chat data and required output formats are assembled separately.'),
        ids.map(id => promptEditor(id, options)));
    if (contextual) refresh();
    return group;
}

export function roastVoiceEditor(otherIds = [], title = 'Customize Roast voice') {
    const group = h('details',{class:'ri-prompt-group'},h('summary',{},title));
    const content = h('div');
    const picker = h('select',{class:'ri-input','aria-label':'Commentator voice'});
    const refreshLabels = () => {
        const current=selectedVoice();
        picker.replaceChildren(...voiceRecords().map(({id,name})=>h('option',{value:id},name+(promptStatus(id).customized ? ' · Customized' : ''))));
        picker.value=current;
    };
    const editors = new Map();
    function showVoice() {
        refreshLabels();
        if (!editors.has(picker.value)) editors.set(picker.value,promptEditor(picker.value,{onChange:refreshLabels}));
        content.replaceChildren(editors.get(picker.value));
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
    showVoice();
    return group;
}
