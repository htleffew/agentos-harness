// Inline prompt editors. No model calls are made by this UI.
import { h, button } from './dom.js';
import { PROMPTS, promptText, promptStatus, validatePrompt, savePrompt, restorePrompt } from '../prompts.js';
import { settings, saveSettings } from '../store.js';

export function promptEditor(id) {
    const def = PROMPTS[id];
    if (!def) throw new Error(`Unknown instruction: ${id}`);
    const title = h('span', {}, def.label);
    const badge = h('span', { class: 'ri-prompt-badge' });
    const note = h('div', { class: 'ri-help', role: 'status' });
    const box = h('textarea', { class: 'ri-input ri-textarea', rows: Math.max(3, Math.min(10, def.text.split('\n').length + 1)), maxLength: 12000, 'aria-label': def.label });
    // Show the saved template, not rendered chat data or substituted placeholders.
    box.value = settings().prompts?.[id]?.text ?? def.text;
    const defaultView = h('details', { class: 'ri-prompt-default' }, h('summary', {}, 'View current default'), h('pre', {}, def.text));
    const required = def.required.length ? `Keep ${def.required.map(x => `{${x}}`).join(', ')}; the extension fills ${def.required.length === 1 ? 'it' : 'them'} in.` : 'Live story details and any required response format are supplied separately.';
    const update = () => {
        const status = promptStatus(id);
        badge.textContent = status.customized ? 'Customized' : 'Default';
        defaultView.hidden = !status.defaultChanged;
        if (status.defaultChanged) note.textContent = 'The built-in default has changed since you saved this instruction. Your wording is still in use.';
    };
    const save = button('Save instruction', () => {
        const error = validatePrompt(id, box.value);
        if (error) { note.textContent = error; return; }
        try { savePrompt(id, box.value); update(); note.textContent = 'Saved.'; } catch (e) { note.textContent = e.message; }
    }, { kind: 'primary' });
    let undoValue = null;
    const undo = button('Undo restore', () => {
        if (!undoValue) return;
        const st = settings(); st.prompts ||= {}; st.prompts[id] = undoValue; saveSettings();
        box.value = undoValue.text; undoValue = null; undo.hidden = true; update(); note.textContent = 'Your previous instruction was restored.';
    }, { kind: 'ghost' });
    undo.hidden = true;
    const restore = button('Restore default', () => {
        const previous = settings().prompts?.[id];
        undoValue = previous ? structuredClone(previous) : null;
        restorePrompt(id); box.value = def.text; undo.hidden = !undoValue; update(); note.textContent = 'Restored to the installed default.';
    }, { kind: 'ghost' });
    const wrap = h('details', { class: 'ri-prompt-editor' },
        h('summary', {}, title, badge),
        h('div', { class: 'ri-prompt-body' }, h('div', { class: 'ri-help' }, [def.help, required].filter(Boolean).join(' ')), box, defaultView,
            h('div', { class: 'ri-row ri-row-tight' }, save, restore, undo), note));
    update(); return wrap;
}

export function promptGroup(ids, label = 'Customize AI instructions') {
    return h('details', { class: 'ri-prompt-group' }, h('summary', {}, label),
        h('div', { class: 'ri-help' }, 'Edit the instruction used by this feature. Live chat data and required output formats are assembled separately. Changes apply across chats.'),
        ids.map(promptEditor));
}
