// Random Instructions tab: the list of instruction sets, and the list of instructions inside one set.
import { h, button, toggle, select, numberInput, chip, field, download } from './dom.js';
import { knownSets, setOptions, setInfo, setName, patchSet, loadSet, saveSet, createSet, adoptSet, forgetSet, exportSet, deleteSharedSet, listInstructions, estimateTokens, newInstruction, writeInstruction, frequencyText, LIMITS } from '../books.js';
import { settings, chatState, saveChatState } from '../store.js';
import { worldNames, toast, confirmBox, inputBox, isChatOpen } from '../st.js';
import { renderEditor } from './editor.js';

export function renderInstructions(body, app) {
    if (app.route.view === 'edit') return renderEditor(body, app);
    if (app.route.view === 'set') return renderSet(body, app);
    return renderSets(body, app);
}

async function cached(app, name) {
    if (!app.cache[name]) app.cache[name] = await loadSet(name);
    return app.cache[name];
}

function limitControl(name, onDone) {
    const o = setOptions(name);
    return field('How many instructions can be sent per reply', LIMITS[o.limit].help,
        select(Object.entries(LIMITS).map(([value, v]) => ({ value, label: v.label })), o.limit, (v) => { patchSet(name, { limit: v }); onDone(); }),
        o.limit === 'max' ? numberInput(o.max, { min: 1, max: 20, unit: 'per reply' }, (n) => { patchSet(name, { max: n }); }) : null);
}

/** One line that says which lorebook a set is kept in. */
export function keptIn(id) {
    const i = setInfo(id);
    return h('div', { class: 'ri-kept' }, i.shared ? `Kept in the shared lorebook "${i.book}"` : 'Kept in a lorebook of its own');
}

function onForChat(name) {
    const cs = chatState();
    if (!cs) return h('span', { class: 'ri-muted' }, 'Open a chat to turn this on');
    return h('label', { class: 'ri-switch-row' },
        h('span', {}, 'On for this chat'),
        toggle(cs.activeSets.includes(name), (v) => {
            cs.activeSets = cs.activeSets.filter(n => n !== name);
            if (v) cs.activeSets.push(name);
            saveChatState();
        }, `Turn ${setName(name)} on or off for this chat`));
}

// ---------- list of instruction sets ----------

function renderSets(body, app) {
    const sets = knownSets();
    body.appendChild(h('div', { class: 'ri-intro' }, 'An instruction set is a group of instructions saved in a lorebook. Turn a set on for a chat, and its instructions are sent at random with the timing you set. Settings has the choice between one shared lorebook for every set and a lorebook for each.'));

    body.appendChild(h('div', { class: 'ri-row' },
        button('Add instruction set', async () => {
            const name = await inputBox('Name for the new instruction set:');
            if (!name) return;
            try { const made = await createSet(name); app.cache = {}; app.go({ view: 'set', name: made }); }
            catch (e) { toast('error', e.message); }
        }, { kind: 'primary' }),
        button('Open a lorebook', async () => {
            const options = openable();
            if (!options.length) { toast('info', 'Every lorebook you have is already in this list.'); return; }
            app.route = { view: 'sets', picking: true };
            app.render();
        }, { title: 'Use a lorebook you already have as an instruction set' })));

    if (app.route.picking) {
        const options = openable();
        let chosen = options[0];
        body.appendChild(h('div', { class: 'ri-card ri-pick' },
            field('Lorebook to open as an instruction set', 'The lorebook file is left as it is until you edit one of its instructions. A shared lorebook made by this extension adds every set kept inside it.',
                select(options.map(n => ({ value: n, label: n })), chosen, (v) => { chosen = v; })),
            h('div', { class: 'ri-row' },
                button('Open', async () => {
                    try {
                        const added = await adoptSet(chosen);
                        app.cache = {};
                        if (added.length === 1 && setInfo(added[0]).kind === 'instructions') { app.go({ view: 'set', name: added[0] }); return; }
                        toast(added.length ? 'success' : 'info', added.length ? `${added.length} ${added.length === 1 ? 'set was' : 'sets were'} added from "${chosen}". Each one is listed in its own tab.` : `Every set in "${chosen}" is already in the list.`);
                        app.go({ view: 'sets' });
                    } catch (e) { toast('error', e.message); }
                }, { kind: 'primary' }),
                button('Cancel', () => app.go({ view: 'sets' }), { kind: 'ghost' }))));
    }

    if (!sets.length) {
        body.appendChild(h('div', { class: 'ri-empty' }, 'No instruction sets yet. Add one, or open a lorebook you already have.'));
        return;
    }

    for (const name of sets) {
        const counts = h('div', { class: 'ri-grid' }, h('div', { class: 'ri-kv' }, h('span', { class: 'ri-k' }, 'Instructions'), h('span', { class: 'ri-v' }, '...')));
        cached(app, name).then((data) => {
            if (!data) return;
            const list = listInstructions(data, name);
            const withText = list.filter(i => i.versions.length);
            const avg = withText.length ? Math.round(withText.reduce((n, i) => n + estimateTokens(i), 0) / withText.length) : 0;
            counts.replaceChildren(
                h('div', { class: 'ri-kv' }, h('span', { class: 'ri-k' }, 'Instructions'), h('span', { class: 'ri-v' }, `${list.length} (${list.filter(i => i.on).length} turned on)`)),
                h('div', { class: 'ri-kv' }, h('span', { class: 'ri-k' }, 'Size when one is sent'), h('span', { class: 'ri-v' }, avg ? `about ${avg} tokens` : 'nothing to send yet')),
                h('div', { class: 'ri-kv' }, h('span', { class: 'ri-k' }, 'How often'), h('span', { class: 'ri-v' }, frequencyText(list))));
        }).catch(() => counts.replaceChildren(h('span', { class: 'ri-muted' }, 'This lorebook could not be read.')));

        body.appendChild(h('div', { class: 'ri-card ri-setcard' },
            h('div', { class: 'ri-card-top' },
                h('button', { type: 'button', class: 'ri-card-name', onclick: () => app.go({ view: 'set', name }) }, setName(name)),
                onForChat(name)),
            keptIn(name),
            counts,
            limitControl(name, app.render),
            h('div', { class: 'ri-row' },
                button('Open', () => app.go({ view: 'set', name }), { kind: 'primary', title: 'See and edit the instructions in this set' }),
                button('Export', async () => {
                    const data = await exportSet(name);
                    if (!data || !download(`${setName(name)}.json`, JSON.stringify(data, null, 4))) toast('info', 'Export did not start here. You can also export this lorebook from the World Info screen.');
                }, { kind: 'ghost', title: 'Download this set as a lorebook file' }),
                button('Remove from this list', async () => {
                    if (!await confirmBox(removeText(name))) return;
                    forgetSet(name);
                    const cs = chatState();
                    if (cs) { cs.activeSets = cs.activeSets.filter(n => n !== name); saveChatState(); }
                    app.render();
                }, { kind: 'ghost' }),
                deleteButton(app, name))));
    }
}

/** Lorebooks that "Open a lorebook" can add: every lorebook that is not already a set of its own. */
function openable() {
    const sets = settings().sets;
    return worldNames().filter(n => !(sets[n] && !sets[n].book)).sort((a, b) => a.localeCompare(b));
}

/** "Delete this set", for a set kept inside a shared lorebook. A set with a lorebook of its own is deleted in World Info. */
export function deleteButton(app, id, label = 'Delete this set') {
    const i = setInfo(id);
    if (!i.shared) return null;
    return button(label, async () => {
        if (!await confirmBox(`Delete "${i.name}" for good? Its entries are removed from the shared lorebook "${i.book}". The other sets in that lorebook are left alone.`)) return;
        try {
            await deleteSharedSet(id);
            const cs = chatState();
            if (cs) { cs.activeSets = cs.activeSets.filter(n => n !== id); saveChatState(); }
            app.cache = {};
            toast('success', `"${i.name}" was deleted.`);
        } catch (e) { toast('error', `Could not delete: ${e.message}`); }
        app.render();
    }, { kind: 'danger' });
}

export function removeText(id) {
    const i = setInfo(id);
    return i.shared
        ? `Remove "${i.name}" from this list? Its entries stay in the shared lorebook "${i.book}", and opening that lorebook brings it back.`
        : `Remove "${i.name}" from this list? The lorebook itself is kept and can be opened again.`;
}

// ---------- one instruction set ----------

function summaryChips(ins) {
    const out = [];
    out.push(chip(ins.when === 'always' ? `${ins.chance}% chance each reply` : `${ins.chance}% chance when its ${ins.when === 'words' ? 'words appear' : 'pattern matches'}`));
    if (ins.keep) out.push(chip(`Keeps sending for ${ins.keep} more ${ins.keep === 1 ? 'reply' : 'replies'}`));
    if (ins.wait) out.push(chip(`Waits ${ins.wait} ${ins.wait === 1 ? 'reply' : 'replies'} before sending again`));
    if (ins.notBefore > 1) out.push(chip(`Starts at reply ${ins.notBefore}`));
    if (ins.group) out.push(chip(`Only-one group: ${ins.group}`, 'ri-chip-group'));
    if (ins.sendTogether) out.push(chip(`Send-together group: ${ins.sendTogether}`, 'ri-chip-group'));
    out.push(ins.versions.length ? chip(`${ins.versions.length} ${ins.versions.length === 1 ? 'version' : 'versions'}`) : chip('No versions yet: nothing to send', 'ri-chip-warn'));
    return out;
}

function renderSet(body, app) {
    const name = app.route.name;
    body.appendChild(h('div', { class: 'ri-row' }, button('‹ Back to instruction sets', () => app.go({ view: 'sets' }), { kind: 'ghost' })));
    body.appendChild(h('div', { class: 'ri-card ri-setcard' },
        h('div', { class: 'ri-card-top' }, h('div', { class: 'ri-h2' }, setName(name)), onForChat(name)),
        keptIn(name),
        limitControl(name, app.render)));

    const listBox = h('div', { class: 'ri-list' }, h('div', { class: 'ri-muted' }, 'Loading...'));
    body.appendChild(h('div', { class: 'ri-row' }, button('Add instruction', async () => {
        const data = await cached(app, name);
        if (!data) return;
        app.go({ view: 'edit', name, draft: newInstruction(data, name) });
    }, { kind: 'primary' })));
    const howOften = h('div', { class: 'ri-note' }, '');
    body.appendChild(howOften);
    body.appendChild(listBox);

    cached(app, name).then((data) => {
        if (!data) { listBox.replaceChildren(h('div', { class: 'ri-empty' }, 'This lorebook could not be read. It may have been renamed or deleted.')); return; }
        const list = listInstructions(data, name);
        howOften.textContent = `How often: ${frequencyText(list)}`;
        if (!list.length) { listBox.replaceChildren(h('div', { class: 'ri-empty' }, 'No instructions in this set yet. Press "Add instruction" to make the first one.')); return; }
        const move = async (index, by) => {
            const other = index + by;
            if (other < 0 || other >= list.length) return;
            [list[index], list[other]] = [list[other], list[index]];
            list.forEach((ins, i) => { data.entries[ins.uid].order = 100 + i; data.entries[ins.uid].displayIndex = i; });
            await saveSet(name, data);
            app.render();
        };
        listBox.replaceChildren(...list.map((ins, index) => h('div', { class: `ri-card ri-inscard ${ins.on ? '' : 'ri-off'}` },
            h('div', { class: 'ri-card-top' },
                h('button', { type: 'button', class: 'ri-card-name', onclick: () => app.go({ view: 'edit', name, draft: structuredClone(ins) }) }, ins.name),
                h('label', { class: 'ri-switch-row' }, h('span', {}, ins.on ? 'On' : 'Off'),
                    toggle(ins.on, async (v) => { data.entries[ins.uid].disable = !v; await saveSet(name, data); app.render(); }, `Turn ${ins.name} on or off`))),
            h('div', { class: 'ri-chips' }, summaryChips(ins)),
            h('div', { class: 'ri-row' },
                button('Edit', () => app.go({ view: 'edit', name, draft: structuredClone(ins) }), { kind: 'primary' }),
                button('Move up', () => move(index, -1), { kind: 'ghost', disabled: index === 0 }),
                button('Move down', () => move(index, 1), { kind: 'ghost', disabled: index === list.length - 1 }),
                button('Copy', async () => {
                    const copy = { ...structuredClone(ins), ...{ uid: newInstruction(data, name).uid, name: `${ins.name} (copy)`, isNew: true } };
                    writeInstruction(data, copy, name);
                    await saveSet(name, data);
                    app.render();
                }, { kind: 'ghost', title: 'Make a second instruction with the same settings and versions' })))));
    }).catch((e) => listBox.replaceChildren(h('div', { class: 'ri-empty' }, `This lorebook could not be read: ${e.message}`)));

    if (!isChatOpen()) body.appendChild(h('div', { class: 'ri-help' }, 'Names and pronouns in versions are shown for the chat that is open. Open a chat to see them filled in.'));
}
