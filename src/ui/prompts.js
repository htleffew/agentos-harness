// Inline prompt editors. No model calls are made by this UI.
import { h, button } from './dom.js';
import { PROMPTS, promptText, promptStatus, validatePrompt, savePrompt, restorePrompt } from '../prompts.js';
import { settings, saveSettings } from '../store.js';

export function promptEditor(id, { saveLabel = 'Save instruction', onChange = () => {} } = {}) {
    const def = PROMPTS[id];
    if (!def) throw new Error(`Unknown instruction: ${id}`);
    const title = h('span', {}, def.label);
    const badge = h('span', { class: 'ri-prompt-badge' });
    const note = h('div', { class: 'ri-help', role: 'status' });
    const box = h('textarea', { class: 'ri-input ri-textarea', rows: Math.max(3, Math.min(10, def.text.split('\n').length + 1)), maxLength: 12000, 'aria-label': def.label });
    // Show the saved template, not rendered chat data or substituted placeholders.
    box.value = settings().prompts?.[id]?.text ?? def.text;
    let savedText = box.value;
    const defaultView = h('details', { class: 'ri-prompt-default' }, h('summary', {}, 'View current default'), h('pre', {}, def.text));
    const required = def.required.length ? `Keep ${def.required.map(x => `{${x}}`).join(', ')}; the extension fills ${def.required.length === 1 ? 'it' : 'them'} in.` : 'Live story details and any required response format are supplied separately.';
    const update = () => {
        const status = promptStatus(id);
        badge.textContent = status.customized ? 'Customized' : 'Default';
        defaultView.hidden = !status.defaultChanged;
        if (status.defaultChanged) note.textContent = 'The built-in default has changed since you saved this instruction. Your wording is still in use.';
    };
    const save = button(saveLabel, () => {
        const error = validatePrompt(id, box.value);
        if (error) { note.textContent = error; return; }
        try { savePrompt(id, box.value); savedText=box.value; syncDraft(); update(); onChange(); note.textContent = 'Saved.'; } catch (e) { note.textContent = e.message; }
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
        const st = settings(); st.prompts ||= {}; st.prompts[id] = undoValue; saveSettings();
        box.value = savedText = undoValue.text; syncDraft(); undoValue = null; undo.hidden = true; update(); onChange(); note.textContent = 'Your previous instruction was restored.';
    }, { kind: 'ghost' });
    undo.hidden = true;
    const restore = button('Restore default', () => {
        const previous = settings().prompts?.[id];
        undoValue = previous ? structuredClone(previous) : null;
        restorePrompt(id); box.value = savedText = def.text; syncDraft(); undo.hidden = !undoValue; update(); onChange(); note.textContent = 'Restored to the installed default.';
    }, { kind: 'ghost' });
    const wrap = h('details', { class: 'ri-prompt-editor' },
        h('summary', {}, title, badge),
        h('div', { class: 'ri-prompt-body' }, h('div', { class: 'ri-help' }, [def.help, required].filter(Boolean).join(' ')), box, defaultView,
            h('div', { class: 'ri-row ri-row-tight' }, save, discard, restore, undo), note));
    function syncDraft() {
        const dirty = box.value!==savedText;
        wrap.toggleAttribute('data-ri-dirty',dirty);
        discard.hidden = !dirty;
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
