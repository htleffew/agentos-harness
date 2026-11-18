import { h, button } from './dom.js';
import { ctx, KEY } from '../st.js';
import { STATE_FIELDS, stateAt, editState } from '../state.js';

const lastReply = () => {
    const chat = ctx().chat || [];
    for (let i = chat.length - 1; i >= 0; i--) if (!chat[i]?.is_user && chat[i]?.extra?.[KEY]) return i;
    return -1;
};

export function stateEditor(id, person, onSaved) {
    const form = h('div', { class: 'ri-state-editor' });
    const inputs = {};
    const locks = {};
    for (const [key, label] of STATE_FIELDS) {
        const input = h('textarea', { class: 'ri-input ri-textarea', rows: 2 });
        input.value = person.fields[key] || '';
        const lock = h('input', { type: 'checkbox', checked: !!person.protected[key] });
        inputs[key] = input; locks[key] = lock;
        input.addEventListener('input', () => { lock.checked = true; });
        form.append(h('label', { class: 'ri-label' }, label), input,
            h('label', { class: 'ri-state-lock' }, lock, ' Protect from automatic changes'));
    }
    form.append(button('Save state', () => {
        for (const [key] of STATE_FIELDS) {
            const value = inputs[key].value.trim();
            if (value !== (person.fields[key] || '') || locks[key].checked !== !!person.protected[key]) editState(id, person.name, key, value, locks[key].checked);
        }
        onSaved();
    }), button('Cancel', onSaved, { kind: 'ghost' }));
    return form;
}

export function characterStateCard(person, id, refresh, { historical = false } = {}) {
    const card = h('details', { class: 'ri-profile' }, h('summary', { class: 'ri-profile-name' }, person.name));
    const content = h('div', { class: 'ri-state-body' });
    const show = () => {
        content.replaceChildren();
        for (const [key, label] of STATE_FIELDS) if (person.fields[key]) content.append(h('div', { class: 'ri-state-field' }, h('span', { class: 'ri-state-label' }, label, person.protected[key] ? ' · protected' : ''), h('div', {}, person.fields[key])));
        if (!Object.keys(person.fields).length) content.append(h('div', { class: 'ri-muted' }, 'No current state recorded.'));
        if (!historical && id >= 0) content.append(button('Edit state', () => { content.replaceChildren(stateEditor(id, person, refresh)); }, { kind: 'ghost' }));
    };
    show(); card.append(content); return card;
}

export function renderCurrentState(body, refresh) {
    const id = lastReply();
    body.append(h('div', { class: 'ri-h2' }, 'Current story state'), h('div', { class: 'ri-help' }, 'These character details guide future replies. Edits are protected until you allow automatic changes. Lasting character facts can be edited in Story World.'));
    const values = Object.values(stateAt());
    if (!values.length) body.append(h('div', { class: 'ri-empty' }, 'No character state has been recorded yet.'));
    else values.forEach(p => body.append(characterStateCard(p, id, refresh)));
}
