import { promptGroup } from './prompts.js';
import { h, button } from './dom.js';
import { ctx, KEY, toast, confirmBox } from '../st.js';
import { STATE_FIELDS, SCENE_FIELDS, stateAt, sceneAt, sceneProtected, editState, editScene, editSnapshot, editSceneSnapshot, blockedEventTags, setBlockedEventTags } from '../state.js';
import { chatWorld, loadWorld, listWorld, writeWorldEntry, saveWorld, WORLD_KINDS } from '../world.js';
import { buildAsk, buildSceneAsk, parseUpdate, afterReply, worldIdle, recordManualWorldChange } from '../worldflow.js';
import { changesFromProfiles } from '../state.js';
import { request } from '../ai.js';
import { settings, saveChatState } from '../store.js';

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
                const before = data.entries[entry.uid] ? structuredClone(data.entries[entry.uid]) : null;
                entry.fields[select.value] = value; entry.auto = false;
                writeWorldEntry(data, entry, id); await saveWorld(id, data);
                recordManualWorldChange(id, entry.uid, before, data.entries[entry.uid]);
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
function rebuildEditor(refresh) {
    const box = h('div', { class: 'ri-state-editor' });
    const signature = () => JSON.stringify((ctx().chat || []).map(m => [m?.is_user, m?.is_system, m?.mes]));
    let preparedSignature = '';
    const info = h('div', { class: 'ri-help' }, 'One AI request proposes a new state from the visible story. Review and edit its update block before applying it. This does not rewrite story text; review world entries and chapter summaries too.');
    const draft = h('textarea', { class: 'ri-input ri-textarea', rows: 12, placeholder: 'The proposed story update will appear here.' });
    const status = h('div', { class: 'ri-help' });
    const ask = button('Draft a state update with AI', async () => {
        ask.disabled = true; status.textContent = 'Reading the story…';
        try {
            await worldIdle();
            const c = ctx(), chatId = String(c.getCurrentChatId?.() || ''), originalSignature = signature();
            const messages = (c.chat || []).filter(m => m && !m.is_system && typeof m.mes === 'string').map(m => `${m.is_user ? 'User' : 'Character'}: ${m.mes}`).join('\n\n');
            if (!messages.trim()) throw new Error('There is no story text to review.');
            const clipped = messages.length > 40000;
            const wid = chatWorld(), data = wid ? await loadWorld(wid) : null;
            const form = data ? buildAsk(listWorld(data, wid)) : buildSceneAsk();
            const answer = await request({ what: 'Rebuild edited story state', system: 'Extract only facts supported by the story. Preserve uncertainty and private knowledge. Never invent an event, character, relationship or motivation. Return only the requested story_update block.', user: `Review the story as it now stands. ${clipped ? 'Only the most recent portion fits; do not infer anything missing.' : ''}\n\n${messages.slice(-40000)}\n\n${form}\nReturn only the update block.`, tokens: 1200, profileId: settings().profileId });
            if (String(ctx().getCurrentChatId?.() || '') !== chatId || signature() !== originalSignature) throw new Error('The story changed while drafting; start the rebuild again.');
            preparedSignature = originalSignature;
            if (!parseUpdate(answer.text).found) throw new Error('The model did not return a readable story_update block.');
            draft.value = answer.text; answer.note('Draft ready for review; no changes applied.');
            status.textContent = clipped ? 'Draft ready. Only the most recent 40,000 characters were read; check earlier facts by hand.' : 'Draft ready. Review it before applying.';
        } catch (e) { status.textContent = `Could not draft: ${e.message}`; }
        finally { ask.disabled = false; }
    });
    const apply = button('Apply reviewed update', async () => {
        if (!preparedSignature || signature() !== preparedSignature) { status.textContent = 'The story changed since this draft was prepared. Draft it again.'; return; }
        const parsed = parseUpdate(draft.value);
        if (!parsed.found || !parsed.block || !/<\/story_update\s*>/i.test(draft.value)) { status.textContent = 'A complete <story_update> block is required.'; return; }
        const c = ctx(), id = lastReply(), m = c.chat?.[id], rec = m?.extra?.[KEY];
        if (!rec) { status.textContent = 'There is no recorded character reply to attach this update to.'; return; }
        apply.disabled = true;
        const previous = structuredClone(rec);
        try {
            // Preserve user overrides, but never re-enable the stale automatic changes.
            rec.stateChanges = changesFromProfiles(parsed.profiles);
            rec.profiles = parsed.profiles;
            rec.scene = parsed.scene || {};
            rec.stateStale = false; rec.stateOutdated = false;
            if (Array.isArray(m.swipe_info) && m.swipe_info[m.swipe_id]) { m.swipe_info[m.swipe_id].extra ||= {}; m.swipe_info[m.swipe_id].extra[KEY] = rec; }
            await afterReply(id, rec, parsed, 0, () => {}, { rebuild: true, propagate: true });
            saveChatState(); await c.saveChat?.();
            toast('success', settings().world.update === 'off' ? 'The reviewed state was applied. Automatic Story World updates are off; review world facts by hand.' : 'The reviewed state was applied. Review any manually edited chapters and world facts.'); refresh();
        } catch (e) { Object.keys(rec).forEach(k => delete rec[k]); Object.assign(rec, previous); status.textContent = `Could not apply: ${e.message}`; }
        finally { apply.disabled = false; }
    });
    box.append(info, ask, draft, status, apply, button('Close', refresh, { kind: 'ghost' }));
    return box;
}

export function renderCurrentState(body, refresh) {
    body.appendChild(promptGroup(['rebuild'], 'Customize rebuild instruction'));
    const id = lastReply(), scene = sceneAt();
    const needsReview = !!ctx().chatMetadata?.[KEY]?.historyNeedsReview;
    body.append(h('div', { class: 'ri-h2' }, 'Current story state'), h('div', { class: 'ri-help' }, 'These details guide future replies. Edits are protected until you allow automatic changes. Lasting facts can be saved to Story World.'));
    if (ctx().chatMetadata?.[KEY]?.branchHistoryNotice) body.append(h('div', { class: 'ri-note' }, 'This branch has its own story world. Review it for older edits or changes made outside this extension; those may not have a history to rewind.'), button('Dismiss branch note', () => { ctx().chatMetadata[KEY].branchHistoryNotice = false; try { ctx().saveMetadataDebounced?.(); } catch {} refresh(); }, { kind: 'ghost' }));
    if (needsReview) {
        const recovery = h('div', {});
        recovery.append(button('Rebuild state from the edited story', () => recovery.replaceChildren(rebuildEditor(refresh)), { kind: 'ghost' }));
        body.append(h('div', { class: 'ri-note ri-note-warn' }, 'A previous reply was edited. Its generated state and later automatic world changes were withdrawn. Overlapping chapter summaries are withheld until you mark the story reviewed. Review this state, Story World and any manually edited summaries.'), recovery, button('I have reviewed the story', () => { ctx().chatMetadata[KEY].historyNeedsReview = false; delete ctx().chatMetadata[KEY].historyInvalidFrom; try { ctx().saveMetadataDebounced?.(); } catch {} refresh(); }, { kind: 'ghost' }));
    }
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
