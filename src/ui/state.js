import { h, button } from './dom.js';
import { ctx, KEY, toast, confirmBox } from '../st.js';
import { STATE_FIELDS, SCENE_FIELDS, stateAt, sceneAt, sceneProtected, editState, editScene, editSnapshot, editSceneSnapshot, blockedEventTags, setBlockedEventTags } from '../state.js';
import { chatWorld, loadWorld, listWorld, writeWorldEntry, saveWorld, WORLD_KINDS } from '../world.js';

const lastReply = () => {
    const chat = ctx().chat || [];
    for (let i = chat.length - 1; i >= 0; i--) if (!chat[i]?.is_user && chat[i]?.extra?.[KEY]) return i;
    return -1;
};

export function stateEditor(id, person, onSaved, { historical = false } = {}) {
    const form = h('div', { class: 'ri-state-editor' });
    const inputs = {}, locks = {};
    for (const [key, label] of STATE_FIELDS) {
        const input = h('textarea', { class: 'ri-input ri-textarea', rows: 2 });
        input.value = person.fields[key] || '';
        const lock = h('input', { type: 'checkbox', checked: !!person.protected[key] });
        inputs[key] = input; locks[key] = lock;
        input.addEventListener('input', () => { lock.checked = true; });
        form.append(h('label', { class: 'ri-label' }, label), input);
        if (!historical) form.append(h('label', { class: 'ri-state-lock' }, lock, ' Protect from automatic changes'));
    }
    const changed = key => inputs[key].value.trim() !== (person.fields[key] || '');
    if (historical) {
        form.append(h('div', { class: 'ri-help' }, 'Correct this snapshot alone, or apply the changes to the current state too. Later story text is not rewritten.'));
        const save = apply => {
            for (const [key] of STATE_FIELDS) if (changed(key)) {
                editSnapshot(id, person.name, key, inputs[key].value);
                if (apply) editState(lastReply(), person.name, key, inputs[key].value, true);
            }
            onSaved();
        };
        form.append(button('Save snapshot only', () => save(false)), button('Save and apply to current state', () => save(true), { kind: 'ghost' }));
    } else form.append(button('Save state', () => {
        for (const [key] of STATE_FIELDS) if (changed(key) || locks[key].checked !== !!person.protected[key]) editState(id, person.name, key, inputs[key].value, locks[key].checked);
        onSaved();
    }));
    form.append(button('Cancel', onSaved, { kind: 'ghost' }));
    return form;
}

function worldEditor(person, done) {
    const area = h('textarea', { class: 'ri-input ri-textarea', rows: 3, placeholder: 'Enter the lasting fact to save' });
    const select = h('select', { class: 'ri-input' }, WORLD_KINDS.character.fields.map(f => h('option', { value: f.key }, f.label)));
    select.value = 'boundary';
    return h('div', { class: 'ri-state-editor' },
        h('div', { class: 'ri-help' }, 'Save an enduring fact to this character’s existing Story World entry. The selected field is replaced; review the value first.'),
        select, area,
        button('Save to Story World', async () => {
            try {
                const id = chatWorld();
                if (!id) throw new Error('Choose a Story World first.');
                const data = await loadWorld(id);
                if (!data) throw new Error('The Story World could not be read.');
                const matches = listWorld(data, id).filter(w => w.kind === 'character' && w.name.trim().toLocaleLowerCase() === person.name.trim().toLocaleLowerCase());
                if (matches.length !== 1) throw new Error(matches.length ? 'More than one character has this name; edit the correct entry in Story World.' : 'No matching character entry exists; add one in Story World first.');
                const value = area.value.trim();
                if (!value) throw new Error('Enter the fact to save.');
                const entry = matches[0];
                if (entry.fields[select.value] && !await confirmBox(`Replace the existing ${select.selectedOptions[0].textContent} value for ${person.name}?`)) return;
                entry.fields[select.value] = value; entry.auto = false;
                writeWorldEntry(data, entry, id); await saveWorld(id, data);
                toast('success', 'Saved to the Story World.'); done();
            } catch (e) { toast('error', `Could not save: ${e.message}`); }
        }), button('Cancel', done, { kind: 'ghost' }));
}

export function characterStateCard(person, id, refresh, { historical = false } = {}) {
    const card = h('details', { class: 'ri-profile' }, h('summary', { class: 'ri-profile-name' }, person.name));
    const content = h('div', { class: 'ri-state-body' });
    const show = () => {
        content.replaceChildren();
        for (const [key, label] of STATE_FIELDS) if (person.fields[key]) content.append(h('div', { class: 'ri-state-field' }, h('span', { class: 'ri-state-label' }, label, person.protected[key] ? ' · protected' : ''), h('div', {}, person.fields[key])));
        if (!Object.keys(person.fields).length) content.append(h('div', { class: 'ri-muted' }, 'No current state recorded.'));
        const foundation = Object.entries(person.foundation || {}).filter(([, value]) => value);
        if (foundation.length) content.append(h('details', { class: 'ri-profile-who' }, h('summary', {}, 'Foundation at this reply'), foundation.map(([key, value]) => h('div', { class: 'ri-state-field' }, h('span', { class: 'ri-state-label' }, key), h('div', {}, value)))));
        if (id >= 0 || !historical) content.append(button(historical ? 'Edit this snapshot' : 'Edit state', () => { content.replaceChildren(stateEditor(id, person, refresh, { historical })); }, { kind: 'ghost' }));
        if (!historical) content.append(button('Save a lasting fact to Story World', () => { content.replaceChildren(worldEditor(person, show)); }, { kind: 'ghost' }));
    };
    show(); card.append(content); return card;
}

export function sceneEditor(scene, refresh, { historicalId = null } = {}) {
    const form = h('div', { class: 'ri-state-editor' }), inputs = {}, locks = {};
    for (const [key, label] of SCENE_FIELDS) {
        const input = h('textarea', { class: 'ri-input ri-textarea', rows: 2 }); input.value = scene[key] || '';
        const lock = h('input', { type: 'checkbox', checked: sceneProtected(key) });
        inputs[key] = input; locks[key] = lock;
        input.addEventListener('input', () => { lock.checked = true; });
        form.append(h('label', { class: 'ri-label' }, label), input);
        if (historicalId === null) form.append(h('label', { class: 'ri-state-lock' }, lock, ' Protect from automatic changes'));
    }
    if (historicalId !== null) {
        const save = apply => {
            for (const [key] of SCENE_FIELDS) if (inputs[key].value.trim() !== (scene[key] || '')) {
                editSceneSnapshot(historicalId, key, inputs[key].value);
                if (apply) editScene(key, inputs[key].value, true);
            }
            refresh();
        };
        form.append(h('div', { class: 'ri-help' }, 'Correct only this snapshot, or also apply the changes to the current scene. Later story text is not rewritten.'),
            button('Save snapshot only', () => save(false)), button('Save and apply to current scene', () => save(true), { kind: 'ghost' }));
    } else form.append(button('Save scene', () => {
        for (const [key] of SCENE_FIELDS) if (inputs[key].value.trim() !== (scene[key] || '') || locks[key].checked !== sceneProtected(key)) editScene(key, inputs[key].value, locks[key].checked);
        refresh();
    }));
    form.append(button('Cancel', refresh, { kind: 'ghost' }));
    return form;
}
export function renderCurrentState(body, refresh) {
    const id = lastReply(), scene = sceneAt();
    body.append(h('div', { class: 'ri-h2' }, 'Current story state'), h('div', { class: 'ri-help' }, 'These details guide future replies. Edits are protected until you allow automatic changes. Lasting facts can be saved to Story World.'));
    const sceneCard = h('details', { class: 'ri-profile' }, h('summary', { class: 'ri-profile-name' }, 'Scene'));
    const content = h('div', { class: 'ri-state-body' });
    for (const [key, label] of SCENE_FIELDS) if (scene[key]) content.append(h('div', { class: 'ri-state-field' }, h('span', { class: 'ri-state-label' }, label, sceneProtected(key) ? ' · protected' : ''), h('div', {}, scene[key])));
    content.append(button('Edit scene', () => content.replaceChildren(sceneEditor(scene, refresh)), { kind: 'ghost' }));
    sceneCard.append(content); body.append(sceneCard);
    const tagInput = h('input', { class: 'ri-input', type: 'text', value: blockedEventTags().join(', '), placeholder: 'e.g. betrayal, violence' });
    body.append(h('details', { class: 'ri-profile' }, h('summary', { class: 'ri-profile-name' }, 'Story event limits'), h('div', { class: 'ri-help' }, 'Skip event items with any of these exact tags, separated by commas. This only filters tagged random event items; it does not interpret prose or constrain other instructions.'), tagInput, button('Save event limits', () => { setBlockedEventTags(tagInput.value); refresh(); }, { kind: 'ghost' })));
    const values = Object.values(stateAt());
    if (!values.length) body.append(h('div', { class: 'ri-empty' }, 'No character state has been recorded yet.'));
    else values.forEach(p => body.append(characterStateCard(p, id, refresh)));
}
