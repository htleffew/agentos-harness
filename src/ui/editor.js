import { BOOK_TRIGGER_SOURCES } from '../book-triggers.js';
import { promptGroup } from './prompts.js';
// The instruction editor: one screen, top to bottom. Also the "Write versions with AI" sheet.
import { h, button, select, choiceList, numberInput, textInput, textArea, field, section, versionText, insertAtCursor, chip, clear } from './dom.js';
import { SENT_AS, ACTORS, TARGETS, instructionActors, instructionTargets, editSet, deleteInstruction, setName, freeUid, writeInstruction, wrapText, listInstructions } from '../books.js';
import { settings, saveSettings, pronounForms } from '../store.js';
import { validateVersion, swapNames, pairingNote, actorNote } from '../validate.js';
import { writeVersions, rewriteVersion, nameHint, versionPromptId } from '../writer.js';
import { ctx, toast, confirmBox, sub, names, isChatOpen } from '../st.js';
import { contextField } from './context.js';

const writerPrompts = actor => promptGroup([versionPromptId(actor), 'systemVersions'], 'Customize Write with AI prompts', { contextual: true });
const modelExample = "Review the last five replies for drift from {{char}}'s established personality ({{personality}}). Apply the corrections to the next reply.";

const opts = (map) => Object.entries(map).map(([value, v]) => ({ value, label: v.label }));

/** Buttons that put a name or pronoun placeholder into the text box. */
function insertRow(getBox) {
    const n = names();
    const row = (role, who, name) => {
        const f = pronounForms(role);
        const items = [
            [name, `{{${role}}}`, `${who} name`],
            [f[0], `{{${role}.they}}`, `${who} pronoun, as in "${f[0]} smiles"`],
            [f[1], `{{${role}.them}}`, `${who} pronoun, as in "looks at ${f[1]}"`],
            [`${f[2]} (owns)`, `{{${role}.their}}`, `${who} pronoun, as in "${f[2]} hand"`],
            [f[4], `{{${role}.themself}}`, `${who} pronoun, as in "talks to ${f[4]}"`],
        ];
        return h('div', { class: 'ri-insert' }, h('span', { class: 'ri-insert-label' }, role === 'char' ? 'Character:' : 'You:'),
            items.map(([label, token, title]) => h('button', { type: 'button', class: `ri-token ri-token-${role} ri-token-btn`, title, onclick: () => insertAtCursor(getBox(), token) }, label)));
    };
    return h('div', { class: 'ri-inserts' },
        h('div', { class: 'ri-help' }, 'Tap to insert a name or pronoun. It is filled in for whichever character and persona are in the chat.'),
        row('char', "The character's", n.char), row('user', 'Your', n.user));
}

function flagsFor(text, actor = '') {
    const { blocks, checks, warns } = validateVersion(text);
    if (actor && !blocks.length) { const note = actorNote(text, actor); if (note) warns.push(note); }
    return { blocks, checks, warns, node: (blocks.length || checks.length || warns.length) ? h('div', { class: 'ri-flags' }, blocks.map(b => h('div', { class: 'ri-flag ri-flag-block' }, `Must fix: ${b}`)), checks.map(c => h('div', { class: 'ri-flag ri-flag-check' }, `Check: ${c}`)), warns.map(w => h('div', { class: 'ri-flag ri-flag-warn' }, w))) : null };
}

/** Editing one version in place. */
function versionEditor(initial, onDone, onCancel, actor) {
    let value = initial;
    const box = textArea(value, (v) => { value = v; }, { rows: 4, placeholder: actor === 'model' ? modelExample : 'Example: {{char}} must pay {{user}} a compliment.' });
    return h('div', { class: 'ri-vedit' }, box, insertRow(() => box),
        h('div', { class: 'ri-row' },
            button('Done', () => { const t = value.replace(/\s+/g, ' ').trim(); if (!t) { toast('info', 'Type the version first.'); return; } onDone(t); }, { kind: 'primary' }),
            button('Cancel', onCancel, { kind: 'ghost' })));
}

export function deleteInstructionButton(app, set, instruction, onDone, label = 'Delete') {
    let busy = false;
    return button(label, async () => {
        if (busy) return;
        busy = true;
        try {
            if (!await confirmBox(`Delete "${instruction.name}" and all its versions from "${setName(set)}"? This applies to every chat using the set.`)) return;
            app.cache[set] = await deleteInstruction(set, instruction.uid);
            toast('success', `"${instruction.name}" was deleted.`);
            onDone();
        } catch (e) { toast('error', `Could not delete: ${e.message}`); }
        finally { busy = false; }
    }, { kind: 'danger', title: 'Delete this instruction and all its versions' });
}

export function renderEditor(body, app) {
    const { name, draft } = app.route;
    const actors = instructionActors(draft);
    const targets = instructionTargets(draft);
    const model = actors[0] === 'model';
    const actorHint = actors.length === 1 ? actors[0] : '';
    const ui = app.route.ui || (app.route.ui = { editing: -1, adding: false, busy: -1, sheet: null });
    const redraw = () => app.render();
    const dirty = () => { app.route.dirty = true; };

    // The AI writer takes the whole screen while it is open.
    if (ui.sheet) { body.appendChild(writerSheet(app, draft, ui, redraw, dirty)); return; }

    body.appendChild(h('div', { class: 'ri-row' }, button(`‹ Back to ${setName(name)}`, async () => {
        if (app.route.dirty && !await confirmBox('Leave without saving your changes to this instruction?')) return;
        app.go({ view: 'set', name });
    }, { kind: 'ghost' })));

    // ----- Name -----
    body.appendChild(section('Name',
        field('Name of this instruction', 'Only you see this. It is the title in the list and in What Was Sent.',
            textInput(draft.name, (v) => { draft.name = v; dirty(); }, { placeholder: 'Example: Picks a fight' }))));

    // ----- When it can be sent -----
    const whenHelp = { always: 'It can be sent with any reply. Chance and timing below decide when.', words: 'It can be sent only when a word or phrase matches the selected source.', pattern: 'It can be sent only when this pattern (a regular expression) matches the selected source.' };
    body.appendChild(section('When it can be sent',
        field('When it is allowed', whenHelp[draft.when],
            select([{ value: 'always', label: 'Always allowed' }, { value: 'words', label: 'Only when these words appear' }, { value: 'pattern', label: 'Only when this pattern matches' }], draft.when, (v) => { draft.when = v; dirty(); redraw(); })),
        draft.when !== 'always' ? field('Where to look', 'Previous model reply checks the latest visible model reply when preparing the next response.',
            select(Object.entries(BOOK_TRIGGER_SOURCES).filter(([value])=>value==='chat' || ctx().registerMacro)
                .map(([value,label])=>({value,label})), draft.triggerSource || 'chat', value=>{draft.triggerSource=value;dirty();}, {'aria-label':'Where to look'})) : null,
        draft.when === 'words' ? field('Words', 'Separate words or phrases with commas.', textInput(draft.words, (v) => { draft.words = v; dirty(); }, { placeholder: 'rain, storm, thunder' })) : null,
        draft.when === 'pattern' ? field('Pattern', 'Written like /text/i.', textInput(draft.pattern, (v) => { draft.pattern = v; dirty(); }, { placeholder: '/\\b(rain|storm)\\b/i' })) : null,
        h('div', { class: 'ri-grid2' },
            field('Chance to send each reply (%)', '100 sends it every time it is allowed. 10 sends it about once in 10 replies.', numberInput(draft.chance, { min: 0, max: 100, unit: '%' }, (n) => { draft.chance = n; dirty(); })),
            field('Keep sending for (replies)', 'After it is sent, it is sent again with this many more replies. 0 sends it once.', numberInput(draft.keep, { min: 0, max: 200, unit: 'replies' }, (n) => { draft.keep = n; dirty(); })),
            field('Wait before sending again (replies)', 'After it is sent, it cannot be sent for this many replies.', numberInput(draft.wait, { min: 0, max: 500, unit: 'replies' }, (n) => { draft.wait = n; dirty(); })),
            field('Do not send before reply number', '0 lets it be sent from the start of the chat.', numberInput(draft.notBefore, { min: 0, max: 1000, unit: '' }, (n) => { draft.notBefore = n; dirty(); }))),
        h('div', { class: 'ri-grid2' },
            field('Only-one group', 'Instructions with the same group name compete: only one of them is sent per reply. Leave empty for no group.', textInput(draft.group, (v) => { draft.group = v; dirty(); }, { placeholder: 'No group' })),
            field('Weight in its Only-one group', 'A higher number wins more often. 100 is normal.', numberInput(draft.weight, { min: 1, max: 1000, unit: '' }, (n) => { draft.weight = n; dirty(); })),
            field('Only once per chat', model ? 'On sends this guidance once per chat.' : 'On: once this has happened in a chat, it is retired and never sent again in that chat. With checking on, it retires when the check finds it happened. With checking off, it retires when it is sent.', select([{ value: 'no', label: 'Off' }, { value: 'yes', label: 'On' }], draft.once ? 'yes' : 'no', (v) => { draft.once = v === 'yes'; dirty(); })),
            field('Send-together group', 'Used when the set is limited to "One Send-together group per reply". Instructions with the same name can go out together.', textInput(draft.sendTogether, (v) => { draft.sendTogether = v; dirty(); }, { placeholder: 'No group' })))));

    // ----- What it sends -----
    const positions = [{ value: 4, label: 'In the chat, counted from the newest message' }, { value: 0, label: "Before the character's description" }, { value: 1, label: "After the character's description" }];
    if (![0, 1, 4].includes(draft.position)) positions.push({ value: draft.position, label: 'Another place (set in World Info)' });
    const picker = (key, label, options, values, exclusive) => {
        const control = choiceList(label, options, values, (next, changed) => {
            const scroll = app.body.scrollTop;
            ui.openChoices = key;
            draft[key] = next;
            dirty();
            redraw();
            app.body.scrollTop = scroll;
            app.body.querySelector(`[data-choice="${key}"] input[value="${changed}"]`)?.focus({ preventScroll: true });
        }, exclusive);
        control.dataset.choice = key;
        control.open = ui.openChoices === key;
        return control;
    };
    const pairing = actors.length === 1 && targets.length === 1 ? pairingNote(actors[0], targets[0]) : '';
    const example = draft.versions[0]?.text || (model ? modelExample : '{{char}} must pay {{user}} a compliment.');
    const preview = h('div', { class: 'ri-preview' });
    const refreshPreview = () => { preview.textContent = sub(wrapText(draft.sentAs, example)); };
    refreshPreview();
    body.appendChild(section('What it sends',
        field('Sent as', SENT_AS[draft.sentAs].help, select(opts(SENT_AS), draft.sentAs, (v) => { draft.sentAs = v; dirty(); redraw(); })),
        h('div', { class: 'ri-grid2' },
            field('Where it is placed', 'Closer to the newest message is followed more strongly.', select(positions, draft.position, (v) => { draft.position = Number(v); dirty(); redraw(); })),
            draft.position === 4 ? field('Messages from the newest message', '0 places it after the newest message. 1 places it just before the newest message.', numberInput(draft.depth, { min: 0, max: 100, unit: '' }, (n) => { draft.depth = n; dirty(); })) : null),
        h('div', { class: 'ri-grid2' },
            field('Actor', 'Tick who can act in AI-written versions. Choosing the model clears the scene actors and makes this reply-writing guidance.', picker('actors', 'Actor', ACTORS, actors, 'model')),
            field('Target or subject', 'Tick who can be affected or referred to. Unspecified lets your direction choose or leave this open.', picker('targets', 'Target or subject', TARGETS, targets))),
        model && draft.sentAs === 'char' ? h('div', { class: 'ri-note ri-note-warn' }, 'This is set to a line spoken by the character. Choose System note to address the model directly.') : null,
        model ? h('div', { class: 'ri-help' }, 'This guidance goes with the regular reply request and skips the story-action check.') : null,
        pairing ? h('div', { class: 'ri-note ri-note-warn' }, pairing, ' You can keep it as it is.') : null,
        h('div', { class: 'ri-help' }, 'Write with AI draws from these choices for each new version. In chat, the extension rotates saved versions. Existing wording stays as written.'),
        field('Exactly what the AI will receive', draft.versions.length
            ? (isChatOpen() ? 'Shows the first saved or drafted version with this chat’s names.' : 'Shows the first version. Open a chat to fill in names.')
            : 'Example wording. Add a version to send this instruction during play.',
            preview),
        promptGroup(['instructionOrder', 'overdueOrder', 'finalOrder', 'instructionAgency'], 'Customize in-chat instruction wording',
            { contextual: true, onChange: refreshPreview })));

    // ----- Versions -----
    const versionsBox = h('div', { class: 'ri-versions' });
    let blocked = 0;
    draft.versions.forEach((v, i) => {
        const flags = flagsFor(v.text, actorHint);
        if (flags.blocks.length) blocked++;
        if (ui.editing === i) {
            versionsBox.appendChild(h('div', { class: 'ri-version ri-version-editing' }, h('div', { class: 'ri-vnum' }, `Version ${i + 1} of ${draft.versions.length}`),
                versionEditor(v.text, (t) => { v.text = t; ui.editing = -1; dirty(); redraw(); }, () => { ui.editing = -1; redraw(); }, actorHint)));
            return;
        }
        versionsBox.appendChild(h('div', { class: `ri-version ${flags.blocks.length ? 'ri-version-blocked' : flags.checks.length ? 'ri-version-flagged' : ''}` },
            h('div', { class: 'ri-vnum' }, `Version ${i + 1} of ${draft.versions.length}`, v.keep ? chip('Kept: AI will not replace it', 'ri-chip-keep') : null),
            h('div', { class: 'ri-vbody' }, versionText(v.text)),
            flags.node,
            h('div', { class: 'ri-row ri-row-tight' },
                button('Edit', () => { ui.editing = i; ui.adding = false; redraw(); }, { kind: 'ghost' }),
                button(ui.busy === i ? 'Rewriting...' : 'Rewrite with AI', async () => {
                    if (ui.busy >= 0) return;
                    ui.busy = i; redraw();
                    try { const r = await rewriteVersion({ ins: draft, text: v.text }); v.text = r.text; dirty(); }
                    catch (e) { toast('error', e.message); }
                    ui.busy = -1; redraw();
                }, { kind: 'ghost', disabled: ui.busy >= 0, title: 'Ask the AI for a new wording of this one version' }),
                button(v.keep ? 'Stop keeping' : 'Keep', () => { v.keep = !v.keep; dirty(); redraw(); }, { kind: 'ghost', title: 'Kept versions are never replaced when you write versions with AI' }),
                button('Delete', () => { draft.versions.splice(i, 1); ui.editing = -1; dirty(); redraw(); }, { kind: 'danger' }))));
    });
    if (!draft.versions.length) versionsBox.appendChild(h('div', { class: 'ri-empty' }, 'No versions yet. Write one yourself, or press "Write versions with AI".'));
    if (ui.adding) {
        versionsBox.appendChild(h('div', { class: 'ri-version ri-version-editing' }, h('div', { class: 'ri-vnum' }, 'New version'),
            versionEditor('', (t) => { draft.versions.push({ text: swapNames(t).text, keep: false }); ui.adding = false; dirty(); redraw(); }, () => { ui.adding = false; redraw(); }, actorHint)));
    }
    body.appendChild(section('Versions (one is picked at random each time it is sent)',
        h('div', { class: 'ri-help' }, model
            ? 'Each version tells the model how to compose the reply. Every version is used once before any repeats.'
            : 'Each version is one way to give the order. Say what must happen. Every version is used once before any repeats.'),
        versionsBox,
        h('div', { class: 'ri-row' },
            button('Write versions with AI', () => { ui.sheet = { seed: ui.lastSeed || '', count: settings().writer.count, replace: false, results: null, busy: false, error: '' }; redraw(); }, { kind: 'primary' }),
            button('Add a version yourself', () => { ui.adding = true; ui.editing = -1; redraw(); })),
        writerPrompts(actorHint)));

    // ----- Notes -----
    body.appendChild(section('Notes',
        field('Notes for yourself', 'Never sent in the chat. Shared with the AI when it writes versions.', textArea(draft.notes, (v) => { draft.notes = v; dirty(); }, { rows: 2 }))));

    // ----- Save -----
    const save = async () => {
        if (!draft.name.trim()) { toast('info', 'Give the instruction a name first.'); return; }
        if (draft.when === 'words' && !draft.words.trim()) { toast('info', 'Type the words that allow this instruction, or choose "Always allowed".'); return; }
        if (draft.when === 'pattern' && !/^\/.+\/[a-z]*$/i.test(draft.pattern.trim())) { toast('info', 'Write the pattern like /text/i, or choose "Always allowed".'); return; }
        if (blocked) { toast('error', `${blocked} ${blocked === 1 ? 'version is' : 'versions are'} empty. Type something in ${blocked === 1 ? 'it' : 'them'} or delete ${blocked === 1 ? 'it' : 'them'} first.`); return; }
        try {
            app.cache[name] = await editSet(name, data => {
                const list = listInstructions(data, name);
                if (draft.isNew) {
                    draft.uid = freeUid(data);
                    draft.order = 100 + list.length;
                } else if (!list.some(item => item.uid === draft.uid)) {
                    throw new Error('This instruction has been deleted.');
                }
                writeInstruction(data, draft, name);
            });
            app.go({view:'set',name,notice:draft.versions.length
                ? 'Instruction saved.' : 'Instruction saved. Add a version when you want it to be eligible to send.'});
        } catch (e) { toast('error', `Could not save: ${e.message}`); }
    };
    body.appendChild(h('div', { class: 'ri-row ri-savebar' },
        button('Save instruction', save, { kind: 'primary' }),
        button('Cancel', () => app.go({ view: 'set', name }), { kind: 'ghost' }),
        draft.isNew ? null : deleteInstructionButton(app, name, draft, () => app.go({ view: 'set', name }), 'Delete instruction')));

}

// ---------- Write versions with AI ----------

function writerSheet(app, draft, ui, redraw, dirty) {
    const sheet = ui.sheet;
    const actors = instructionActors(draft);
    const targets = instructionTargets(draft);
    const model = actors[0] === 'model';
    const close = () => { ui.sheet = null; redraw(); };
    const box = h('div', { class: 'ri-sheet-box' });
    const wrap = h('div', { class: 'ri-sheet' }, h('div', { class: 'ri-row' }, button('‹ Back to the instruction', () => { if (!sheet.busy) close(); }, { kind: 'ghost' })), box);

    box.appendChild(h('div', { class: 'ri-h2' }, 'Write versions with AI'));
    box.appendChild(h('div', { class: 'ri-grid' },
        h('div', { class: 'ri-kv' }, h('span', { class: 'ri-k' }, 'Sent as'), h('span', { class: 'ri-v' }, SENT_AS[draft.sentAs].label)),
        h('div', { class: 'ri-kv' }, h('span', { class: 'ri-k' }, 'Actor'), h('span', { class: 'ri-v' }, actors.map(value => ACTORS[value].label).join(' · '))),
        h('div', { class: 'ri-kv' }, h('span', { class: 'ri-k' }, 'Target or subject'), h('span', { class: 'ri-v' }, targets.map(value => TARGETS[value].label).join(' · ')))));
    box.appendChild(h('div', { class: 'ri-help' }, `These come from the instruction. Close this and change them there if needed. ${isChatOpen() ? nameHint() : ''}`));

    if (!sheet.results) {
        box.appendChild(writerPrompts(actors[0]));
        box.appendChild(field(model ? 'What should the model do?' : 'What should happen', model
            ? 'Describe how to write the next reply. Use {{personality}} or {{description}} to refer to the active character card.'
            : 'One or two sentences. The AI turns this into different versions of the same order.',
            textArea(sheet.seed, (v) => { sheet.seed = v; }, { rows: 3, placeholder: model ? modelExample : 'Example: {{char}} picks a fight with {{user}} over something small.' })));
        box.appendChild(h('div', { class: 'ri-grid2' },
            field('How many versions to write', '', numberInput(sheet.count, { min: 1, max: 30, unit: 'versions' }, (n) => { sheet.count = n; })),
            contextField()));
        if (sheet.error) box.appendChild(h('div', { class: 'ri-note ri-note-warn' }, sheet.error));
        box.appendChild(h('div', { class: 'ri-row' },
            button(sheet.busy ? 'Writing...' : 'Write the versions', async () => {
                if (sheet.busy) return;
                if (!sheet.seed.trim()) { sheet.error = model ? 'Type what the model should do first.' : 'Type what should happen first.'; redraw(); return; }
                sheet.busy = true; sheet.error = ''; redraw();
                const st = settings();
                st.writer.count = sheet.count; saveSettings();
                ui.lastSeed = sheet.seed;
                try {
                    const list = await writeVersions({ ins: draft, seed: sheet.seed.trim(), count: sheet.count, context: settings().writer.context });
                    sheet.results = list.map(r => ({ ...r, keep: (f => f.blocks.length === 0 && f.checks.length === 0)(validateVersion(r.text)), editing: false }));
                } catch (e) { sheet.error = e.message; }
                sheet.busy = false; redraw();
            }, { kind: 'primary', disabled: sheet.busy }),
            button('Cancel', close, { kind: 'ghost', disabled: sheet.busy })));
        if (sheet.busy) box.appendChild(h('div', { class: 'ri-help' }, 'Waiting for the AI. This uses the connection chosen in Settings.'));
        return wrap;
    }

    // Review what came back.
    box.appendChild(h('div', { class: 'ri-help' }, 'Tick the versions to add. A version marked "Check" may have {{user}} acting. It starts unticked: read it, and tick it if it reads right to you.'));
    const list = h('div', { class: 'ri-versions' });
    sheet.results.forEach((r, i) => {
        const flags = flagsFor(r.text, r.actor || (actors.length === 1 ? actors[0] : ''));
        if (flags.blocks.length) r.keep = false;
        if (r.editing) {
            list.appendChild(h('div', { class: 'ri-version ri-version-editing' }, versionEditor(r.text, (t) => { r.text = t; r.editing = false; r.keep = validateVersion(t).blocks.length === 0; redraw(); }, () => { r.editing = false; redraw(); }, actors[0])));
            return;
        }
        const tick = h('input', { type: 'checkbox', class: 'ri-check', checked: r.keep, disabled: flags.blocks.length > 0, onchange: () => { r.keep = tick.checked; } });
        list.appendChild(h('div', { class: `ri-version ${flags.blocks.length ? 'ri-version-blocked' : flags.checks.length ? 'ri-version-flagged' : ''}` },
            h('label', { class: 'ri-vpick' }, tick, h('span', { class: 'ri-vbody' }, versionText(r.text))),
            r.actor !== undefined ? h('div', { class: 'ri-help' }, `Drawn for this version — actor: ${ACTORS[r.actor].label} · Target: ${TARGETS[r.target].label}`) : null,
            r.swaps ? h('div', { class: 'ri-flag ri-flag-info' }, `${r.swaps} ${r.swaps === 1 ? 'name was' : 'names were'} swapped for a placeholder (shown as a coloured label).`) : null,
            flags.node,
            h('div', { class: 'ri-row ri-row-tight' },
                button('Edit', () => { r.editing = true; redraw(); }, { kind: 'ghost' }),
                button('Delete', () => { sheet.results.splice(i, 1); redraw(); }, { kind: 'ghost' }))));
    });
    box.appendChild(list);
    const replaceTick = h('input', { type: 'checkbox', class: 'ri-check', checked: sheet.replace, onchange: () => { sheet.replace = replaceTick.checked; } });
    if (draft.versions.length) box.appendChild(h('label', { class: 'ri-vpick' }, replaceTick, h('span', {}, 'Replace the versions already in this instruction, except the ones marked Keep')));
    box.appendChild(h('div', { class: 'ri-row' },
        button('Add the ticked versions', () => {
            const picked = sheet.results.filter(r => r.keep && validateVersion(r.text).blocks.length === 0);
            if (!picked.length) { toast('info', 'Tick at least one version to add.'); return; }
            if (sheet.replace) draft.versions = draft.versions.filter(v => v.keep);
            draft.versions.push(...picked.map(r => ({ text: r.text, keep: false })));
            dirty();
            close();
        }, { kind: 'primary' }),
        button('Write more', () => { sheet.results = null; redraw(); }, { kind: 'ghost' }),
        button('Cancel', close, { kind: 'ghost' })));
    return wrap;
}
