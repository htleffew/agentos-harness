import { promptGroup } from './prompts.js';
// Random Instructions tab: the list of instruction sets, and the list of instructions inside one set.
import { h, button, toggle, select, numberInput, chip, field, download } from './dom.js';
import { knownSets, setOptions, setInfo, setName, patchSet, loadSet, editSet, createSet, adoptSet, forgetSet, exportSet, deleteSet, listInstructions, estimateTokens, newInstruction, writeInstruction, frequencyText, LIMITS } from '../books.js';
import { settings, chatState, saveChatState } from '../store.js';
import { worldNames, toast, confirmBox, inputBox, isChatOpen } from '../st.js';
import { renderEditor, deleteInstructionButton } from './editor.js';

export function renderInstructions(body, app) {
    if (app.route.view === 'edit') return renderEditor(body, app);
    const sets = app.route.view === 'set' ? null : knownSets();
    if (sets?.length===0) body.append(h('div',{class:'ri-note'},
        h('p',{},'Random instruction sets are optional. Add a set when you want occasional directions sent with replies.'),
        isChatOpen() && button('Set up this chat',()=>app.openSetting('v10','ri-story-workflow'),{kind:'ghost'})));
    body.appendChild(promptGroup(['instructionOrder', 'overdueOrder', 'finalOrder', 'instructionAgency', 'versionRules', 'modelVersionRules', 'systemVersions']));
    if (app.route.view === 'set') return renderSet(body, app);
    return renderSets(body, app, sets);
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
    const active = cs.activeSets.includes(name);
    const status = h('span',{},active ? 'On for this chat' : 'Off for this chat');
    return h('label', { class: 'ri-switch-row' },
        status,
        toggle(active, (v) => {
            cs.activeSets = cs.activeSets.filter(n => n !== name);
            if (v) cs.activeSets.push(name);
            status.textContent=v ? 'On for this chat' : 'Off for this chat';
            saveChatState();
        }, `Turn ${setName(name)} on or off for this chat`));
}

// ---------- list of instruction sets ----------

function renderSets(body, app, sets) {
    if (sets.length) body.appendChild(h('div', { class: 'ri-intro' }, 'Turn a set on to send its instructions at random with the timing you set.'));

    body.appendChild(h('div', { class: 'ri-row' },
        button('Add instruction set', async () => {
            const name = await inputBox('Name for the new instruction set:');
            if (!name) return;
            try { const made = await createSet(name); app.cache = {}; app.go({ view: 'set', name: made }); }
            catch (e) { toast('error', e.message); }
        }, { kind: 'primary' }),
        button('Use a lorebook as an instruction set', async () => {
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

/** The extension deletes the set's entries and leaves the physical book available in World Info. */
export function deleteButton(app, id, label = 'Delete this set', onDone = app.render) {
    const i = setInfo(id);
    if (i.kind === 'world' && !i.shared) return null;
    let busy = false;
    return button(label, async () => {
        if (busy) return;
        busy = true;
        try {
            if (!await confirmBox(`Delete "${i.name}" and its entries from "${i.book}"? This applies to every chat using the set. The World Info book is kept.`)) return;
            await deleteSet(id);
            const cs = chatState();
            if (cs) { cs.activeSets = cs.activeSets.filter(n => n !== id); saveChatState(); }
            app.cache = {};
            toast('success', `"${i.name}" was deleted.`);
            onDone();
        } catch (e) { toast('error', `Could not delete: ${e.message}`); }
        finally { busy = false; }
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
    if (app.route.notice) body.appendChild(h('p',{class:'ri-note',role:'status'},app.route.notice));
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
        const change = async edit => {
            try {
                app.cache[name] = await editSet(name, edit);
                app.render();
            } catch (e) { toast('error', `Could not update: ${e.message}`); }
        };
        const move = (uid, by) => change(fresh => {
            const rows = listInstructions(fresh, name);
            const index = rows.findIndex(row => row.uid === uid);
            const other = index + by;
            if (index < 0 || other < 0 || other >= rows.length) return;
            [rows[index], rows[other]] = [rows[other], rows[index]];
            rows.forEach((ins, i) => { fresh.entries[ins.uid].order = 100 + i; fresh.entries[ins.uid].displayIndex = i; });
        });
        listBox.replaceChildren(...list.map((ins, index) => h('div', { class: `ri-card ri-inscard ${ins.on ? '' : 'ri-off'}` },
            h('div', { class: 'ri-card-top' },
                h('button', { type: 'button', class: 'ri-card-name', onclick: () => app.go({ view: 'edit', name, draft: structuredClone(ins) }) }, ins.name),
                h('label', { class: 'ri-switch-row' }, h('span', {}, ins.on ? 'On' : 'Off'),
                    toggle(ins.on, v => change(fresh => { if (fresh.entries[ins.uid]) fresh.entries[ins.uid].disable = !v; }), `Turn ${ins.name} on or off`))),
            h('div', { class: 'ri-chips' }, summaryChips(ins)),
            h('div', { class: 'ri-row' },
                button('Edit', () => app.go({ view: 'edit', name, draft: structuredClone(ins) }), { kind: 'primary' }),
                button('Move up', () => move(ins.uid, -1), { kind: 'ghost', disabled: index === 0 }),
                button('Move down', () => move(ins.uid, 1), { kind: 'ghost', disabled: index === list.length - 1 }),
                button('Copy', () => change(fresh => {
                    const source = listInstructions(fresh, name).find(row => row.uid === ins.uid);
                    if (!source) throw new Error('This instruction has been deleted.');
                    const copy = { ...source, uid: newInstruction(fresh, name).uid, name: `${source.name} (copy)`, isNew: true };
                    writeInstruction(fresh, copy, name);
                }), { kind: 'ghost', title: 'Make a second instruction with the same settings and versions' }),
                deleteInstructionButton(app, name, ins, app.render)))));
    }).catch((e) => listBox.replaceChildren(h('div', { class: 'ri-empty' }, `This lorebook could not be read: ${e.message}`)));

    if (!isChatOpen()) body.appendChild(h('div', { class: 'ri-help' }, 'Names and pronouns in versions are shown for the chat that is open. Open a chat to see them filled in.'));
}
