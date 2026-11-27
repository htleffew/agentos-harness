// The mirrored prompt editor (DESIGN.md 3.3). Each prompt is stored once, in the extension settings.
// This editor is one view of that record. The same editor draws beside a feature and in Setup, Prompts,
// and a change made in either place reaches the other at once through announcePromptChange().
// It makes no model calls. It holds no fold of its own, so it counts as the item level on any page.
import { h, button, download } from './dom.js';
import { promptDefinition, promptStatus, validatePrompt, savePrompt, restorePrompt } from '../prompts.js';
import { settings } from '../store.js';
import { promptOwner, listVariations, readVariationFile, saveVariation, setVariationRemoved, variationFile } from '../prompt-variations.js';
import { promptComparison } from './prompt-variations.js';

// ---------- One stored record, many views ----------

const views = new Set();

/** Register an element to hear about prompt changes. The registry holds the element weakly. */
export function watchPrompts(element, listener) {
    element._riPromptListener = listener;
    views.add(new WeakRef(element));
    if (views.size > 600) for (const ref of views) if (!ref.deref()) views.delete(ref);
}

/** Tell every other view that the stored prompt, or its variations, changed. */
export function announcePromptChange(id, source = null) {
    for (const ref of [...views]) {
        const element = ref.deref();
        if (!element) { views.delete(ref); continue; }
        if (element !== source) try { element._riPromptListener?.(id); } catch (error) { console.warn('Roleplay Instructions prompt view', error); }
    }
}

export const variationCount = id => listVariations(promptOwner('extension', id)).length;
export const countWords = n => `${n} ${n === 1 ? 'variation' : 'variations'}`;

/** A Problem note (DESIGN.md 1.9) for a slot that names a prompt the Prompts list does not have. */
export function problemNote(id) {
    return h('div', { class: 'ri-note ri-note-problem', role: 'alert', 'data-ri-problem': String(id) },
        h('i', { class: 'fa-solid fa-triangle-exclamation', 'aria-hidden': 'true' }),
        h('strong', {}, 'Problem'),
        ` The prompt "${id}" is not in Setup, Prompts, so there is nothing to edit here.`);
}

const saidAlready = 'This prompt changed in another view. Discard your draft to see the new wording, then edit again.';

/**
 * @param {string} id stored prompt id
 * @param {{onChange?:Function, lazy?:boolean, open?:boolean}} options lazy builds the body when first opened
 */
export function mirroredPrompt(id, { onChange = () => {}, lazy = false, open = false } = {}) {
    const def = promptDefinition(id);
    if (!def) return problemNote(id);
    const owner = promptOwner('extension', id);
    const originalLabel = 'Default prompt';
    const storeText = () => settings().prompts?.[id]?.text ?? def.text;
    let savedText = storeText();
    let selectedId = '';
    let undoValue = null;
    let mode = '';
    let comparing = false;
    let built = false;

    const chip = h('span', { class: 'ri-prompt-badge ri-chip' });
    const count = h('span', { class: 'ri-prompt-count ri-chip' });
    const wrap = h('details', { class: 'ri-prompt-editor ri-mirror', 'data-ri-prompt': id },
        h('summary', {}, h('span', { class: 'ri-prompt-title' }, def.label), h('span', { class: 'ri-prompt-meta' }, chip, count)));
    const body = h('div', { class: 'ri-prompt-body' });
    wrap.append(body);

    function refreshSummary() {
        const status = promptStatus(id);
        chip.textContent = status.customized ? 'Customized' : 'Default';
        chip.dataset.customized = status.customized ? 'yes' : 'no';
        count.textContent = countWords(variationCount(id));
    }

    // Parts of the body, assigned in build().
    let box, list, status, note, nameRow, nameInput, nameConfirm, comparePane, removedRow, file;
    let update, saveAs, rename, restore, remove, importButton, exportButton, compareButton, discard, undo;

    const items = () => listVariations(owner);
    const picked = () => items().find(item => item.id === selectedId) || null;
    const say = text => { if (note) note.textContent = text; };
    const run = fn => async (...args) => { try { await fn(...args); } catch (error) { say(String(error?.message || error)); } };
    const checked = value => {
        const error = validatePrompt(id, value);
        if (error) throw new Error(error);
        return value;
    };
    const assertCurrent = () => { if (storeText() !== savedText) throw new Error(saidAlready); };

    function chooseSelection() {
        const all = items();
        const keep = all.find(item => item.id === selectedId && item.value === savedText);
        selectedId = (keep || all.find(item => item.value === savedText))?.id || '';
    }

    function refreshList() {
        const all = items();
        chooseSelection();
        list.replaceChildren(h('option', { value: '' }, all.length ? 'No variation' : 'No variations saved'),
            ...all.map(item => h('option', { value: item.id }, item.name)));
        list.value = selectedId;
        const removed = listVariations(owner, { removed: true });
        removedRow.replaceChildren(...removed.map(item => button(`Undo delete ${item.name}`, run(() => {
            setVariationRemoved(owner, item.id, false);
            announce(); refreshAll(); say(`Recovered ${item.name}.`);
        }), { kind: 'ghost' })));
        removedRow.hidden = !removed.length;
        const has = !!picked();
        rename.disabled = remove.disabled = !has;
        refreshSummary();
    }

    function showStatus() {
        const dirty = box.value !== savedText;
        const current = picked();
        status.textContent = [current && `Using ${current.name}.`, dirty && 'Draft edited. Update saves it.'].filter(Boolean).join(' ');
    }

    function refreshAll() {
        const dirty = box.value !== savedText;
        wrap.toggleAttribute('data-ri-dirty', dirty);
        update.disabled = !dirty;
        discard.hidden = !dirty;
        restore.disabled = !promptStatus(id).customized;
        refreshList();
        showStatus();
        comparePane.replaceChildren(...(comparing ? [promptComparison({ before: def.text, after: box.value, beforeLabel: originalLabel, afterLabel: 'This prompt now' })] : []));
        comparePane.hidden = !comparing;
        compareButton.setAttribute('aria-pressed', String(comparing));
        const state = promptStatus(id);
        if (state.defaultChanged && !note.textContent) note.textContent = 'The built-in default prompt has changed since you saved this one. Your wording is still in use.';
    }

    const announce = () => { announcePromptChange(id, wrap); onChange(id); };

    /** Write the stored prompt, then bring this view and every other view up to date. */
    function commit(value) {
        assertCurrent();
        savePrompt(id, checked(value));
        savedText = storeText();
        box.value = savedText;
        refreshAll();
        announce();
    }

    function nameField(next, current = '') {
        mode = next;
        nameRow.hidden = !next;
        nameInput.value = current;
        nameConfirm.textContent = next === 'rename' ? 'Rename' : 'Save';
        if (next) nameInput.focus();
    }

    function build() {
        if (built) return;
        built = true;
        const lines = def.text.split('\n').length;
        box = h('textarea', { class: 'ri-input ri-textarea', rows: Math.max(3, Math.min(10, lines + 1)), maxLength: 12000, 'aria-label': def.label });
        box.value = savedText;
        const required = def.required.length ? `Keep ${def.required.map(x => `{${x}}`).join(', ')}; the extension fills ${def.required.length === 1 ? 'it' : 'them'} in.`
            : 'Live story details and any required response format are supplied separately.';
        list = h('select', { class: 'ri-input', 'aria-label': 'Variation' });
        status = h('p', { class: 'ri-help ri-prompt-status' });
        note = h('div', { class: 'ri-help', role: 'status' });
        nameInput = h('input', { class: 'ri-input', maxLength: 80, 'aria-label': 'Variation name' });
        nameConfirm = button('Save', run(() => {
            if (mode === 'rename') {
                const current = picked();
                if (!current) throw new Error('Choose a variation to rename.');
                saveVariation(owner, { ...current, name: nameInput.value });
                nameField('');
                announce(); refreshAll(); say('Renamed.');
                return;
            }
            const entry = saveVariation(owner, { name: nameInput.value, value: checked(box.value) });
            selectedId = entry.id;
            nameField('');
            commit(box.value);
            say(`Saved as ${entry.name}.`);
        }), { kind: 'primary' });
        nameRow = h('div', { class: 'ri-row ri-row-tight ri-prompt-name', hidden: true },
            h('label', { class: 'ri-field' }, 'Name', nameInput), nameConfirm, button('Cancel', () => nameField(''), { kind: 'ghost' }));
        comparePane = h('div', { hidden: true });
        removedRow = h('div', { class: 'ri-row ri-row-tight', hidden: true });
        file = h('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'Import variation JSON', hidden: true });

        update = button('Update', run(() => {
            const current = picked();
            const value = checked(box.value);
            assertCurrent();
            if (current) saveVariation(owner, { ...current, value });
            commit(value);
            say(current ? `Updated ${current.name}.` : 'Saved.');
        }), { kind: 'primary' });
        saveAs = button('Save as', () => nameField('save-as'));
        rename = button('Rename', () => { const current = picked(); if (current) nameField('rename', current.name); });
        remove = button('Delete', run(() => {
            const current = picked();
            if (!current) throw new Error('Choose a variation to delete.');
            setVariationRemoved(owner, current.id, true);
            selectedId = '';
            announce(); refreshAll(); say(`Deleted ${current.name}. Undo delete brings it back.`);
        }));
        restore = button('Restore default prompt', run(() => {
            assertCurrent();
            undoValue = savedText === def.text ? null : savedText;
            restorePrompt(id);
            savedText = storeText();
            box.value = savedText;
            undo.hidden = !undoValue;
            refreshAll(); announce();
            say(`${originalLabel} restored.`);
        }), { kind: 'ghost' });
        undo = button('Undo restore', run(() => {
            if (!undoValue) return;
            const value = undoValue;
            undoValue = null;
            undo.hidden = true;
            commit(value);
            say('Your previous prompt is back.');
        }), { kind: 'ghost' });
        undo.hidden = true;
        discard = button('Discard draft', () => { box.value = savedText; refreshAll(); say('Draft discarded.'); box.focus(); }, { kind: 'ghost' });
        importButton = button('Import', () => file.click());
        exportButton = button('Export', run(() => {
            const entry = picked() || { name: def.label, value: box.value };
            const name = entry.name.replace(/[\\/:*?"<>|]/g, '-');
            if (!download(`${name}.json`, JSON.stringify(variationFile(entry), null, 2))) throw new Error('SillyTavern could not start the download.');
            say('Export started.');
        }));
        compareButton = button('Compare with default', () => { comparing = !comparing; refreshAll(); }, { kind: 'ghost' });
        file.onchange = run(async () => {
            const source = file.files?.[0];
            if (!source) return;
            try {
                if (source.size > 200000) throw new Error('The variation JSON file is too large.');
                const entry = readVariationFile(JSON.parse(await source.text()));
                if (typeof entry.value !== 'string') throw new Error('Choose a text prompt variation.');
                checked(entry.value);
                const saved = saveVariation(owner, { name: entry.name, value: entry.value });
                announce(); refreshAll(); say(`Imported ${saved.name}. Choose it from the list to use it.`);
            } finally { file.value = ''; }
        });
        list.onchange = run(() => {
            const entry = items().find(item => item.id === list.value);
            if (!entry) { list.value = selectedId; return; }
            if (box.value !== savedText) { list.value = selectedId; throw new Error('Update or discard your draft before choosing another variation.'); }
            try { checked(entry.value); } catch (error) { list.value = selectedId; throw error; }
            selectedId = entry.id;
            commit(entry.value);
            say(`Using ${entry.name}.`);
        });
        box.addEventListener('input', () => { refreshAll(); });

        body.append(h('div', { class: 'ri-help' }, [def.help, required].filter(Boolean).join(' ')), box,
            h('label', { class: 'ri-field ri-prompt-pick' }, 'Variation', list), status, nameRow,
            h('div', { class: 'ri-row ri-row-tight ri-prompt-verbs' }, update, saveAs, rename, remove),
            h('div', { class: 'ri-row ri-row-tight ri-prompt-verbs' }, restore, importButton, exportButton, compareButton),
            h('div', { class: 'ri-row ri-row-tight' }, discard, undo), removedRow, comparePane, file, note);
        refreshAll();
    }

    /** Bring a built view up to date with the stored record. */
    function resync() {
        refreshSummary();
        if (!built) return;
        const stored = storeText();
        if (box.value === savedText && stored !== savedText) { savedText = stored; box.value = stored; }
        else if (stored !== savedText) note.textContent = saidAlready;
        refreshAll();
    }

    watchPrompts(wrap, changed => { if (changed === id) resync(); });
    wrap.addEventListener('toggle', () => { if (wrap.open) { if (!built) build(); else resync(); } });
    refreshSummary();
    if (!lazy || open) build();
    if (open) wrap.open = true;
    return wrap;
}
