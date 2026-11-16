// Story World tab: the people, places, groups, secrets, open threads, planted details and things going on
// elsewhere of one story, and how they are sent as story notes.
import { h, button, toggle, select, numberInput, textInput, textArea, field, section, chip, download } from './dom.js';
import { settings, saveSettings, chatState } from '../store.js';
import { createSet, setInfo, setName, exportSet } from '../books.js';
import { WORLD_KINDS, KIND_ORDER, MAX_ACTIVITIES, chatWorld, setChatWorld, knownWorlds, loadWorld, saveWorld, listWorld, newWorldEntry, writeWorldEntry, entryFlags, renderEntry, buildNotes, writeWorldEntryWithAI } from '../world.js';
import { toast, confirmBox, inputBox, names, isChatOpen } from '../st.js';
import { contextField } from './context.js';
import { keptIn, deleteButton } from './sets.js';

const go = (app, route) => { app.wroute = route; app.resetScroll = true; app.render(); app.root?.scrollIntoView?.({ block: 'start' }); };

export function renderWorld(body, app) {
    if (!app.wroute) app.wroute = { view: 'list' };
    if (!isChatOpen()) { body.appendChild(h('div', { class: 'ri-empty' }, 'Open a chat to choose or make its story world.')); return; }
    if (app.wroute.view === 'edit') return renderEdit(body, app);
    return renderList(body, app);
}

// ---------- the world of this chat ----------

function worldPicker(app) {
    const id = chatWorld();
    const worlds = knownWorlds();
    const options = [{ value: '', label: 'No story world for this chat' }, ...worlds.map(w => { const i = setInfo(w); return { value: w, label: i.shared ? `${i.name} (in "${i.book}")` : i.name }; })];
    return section('The story world of this chat',
        h('div', { class: 'ri-help' }, 'A story world holds what is true in one story: its people, places, groups, secrets, open threads, planted details and what is going on elsewhere. One chat uses one world. Before each reply the extension reads who is in the scene and sends the entries that matter as one block of story notes. This makes no extra AI request.'),
        field('World used by this chat', id ? '' : 'Choose a world, or make a new one for this story.',
            select(options, id, (v) => { setChatWorld(v); go(app, { view: 'list' }); })),
        id ? keptIn(id) : null,
        h('div', { class: 'ri-row' }, button('Make a new story world', async () => {
            const name = await inputBox('Name for the new story world:', `${names().char}'s story`);
            if (!name) return;
            try { const made = await createSet(name, 'world'); setChatWorld(made); go(app, { view: 'list' }); toast('success', `"${setName(made)}" was made and is now the world of this chat.`); }
            catch (e) { toast('error', e.message); }
        }, { kind: id ? '' : 'primary' }),
        id ? button('Export this world', async () => {
            const data = await exportSet(id);
            if (!data || !download(`${setName(id)}.json`, JSON.stringify(data, null, 4))) toast('info', 'Export did not start here. You can also export the lorebook from the World Info screen.');
        }, { kind: 'ghost', title: 'Download this world as a lorebook file' }) : null,
        id ? deleteButton(app, id, 'Delete this world') : null),
        id && !setInfo(id).shared ? h('div', { class: 'ri-help' }, 'This world has a lorebook of its own. To delete the world, delete that lorebook in World Info.') : null);
}

function oneLine(w) {
    const text = renderEntry(w, { full: false });
    return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}

function renderList(body, app) {
    body.appendChild(worldPicker(app));
    const id = chatWorld();
    if (!id) return;
    const listBox = h('div', {}, h('div', { class: 'ri-muted' }, 'Loading...'));
    body.appendChild(listBox);
    const preview = h('div', {});
    body.appendChild(preview);
    body.appendChild(sendSettings(app));

    loadWorld(id).then((data) => {
        if (!data) { listBox.replaceChildren(h('div', { class: 'ri-empty' }, 'The lorebook of this world could not be read. It may have been renamed or deleted.')); return; }
        const list = listWorld(data, id);
        const out = [];
        for (const kind of KIND_ORDER) {
            const def = WORLD_KINDS[kind];
            const mine = list.filter(w => w.kind === kind);
            const rows = mine.map(w => h('div', { class: `ri-card ri-inscard ${w.on ? '' : 'ri-off'}` },
                h('div', { class: 'ri-card-top' },
                    h('button', { type: 'button', class: 'ri-card-name', onclick: () => go(app, { view: 'edit', draft: structuredClone(w) }) }, w.name || def.label),
                    h('label', { class: 'ri-switch-row' }, h('span', {}, w.on ? 'On' : 'Off'),
                        toggle(w.on, async (v) => { data.entries[w.uid].disable = !v; await saveWorld(id, data); app.render(); }, `Turn ${w.name} on or off`))),
                h('div', { class: 'ri-world-line' }, oneLine(w)),
                h('div', { class: 'ri-chips' },
                    def.steps ? chip(def.steps.find(s => s[0] === w.status)?.[1] || '', 'ri-chip-group') : null,
                    w.kind === 'secret' && w.status === 'kept' ? chip(w.show === 'full' ? 'The AI is shown the whole secret' : 'The AI is shown one line only') : null,
                    w.auto ? chip('Added automatically', 'ri-chip-wait') : null,
                    w.aliases.length ? chip(`Also called: ${w.aliases.join(', ')}`) : null)));
            const tooMany = kind === 'activity' && mine.filter(w => w.on && w.status !== 'done').length > MAX_ACTIVITIES;
            out.push(section(`${def.plural} (${mine.length})`,
                tooMany ? h('div', { class: 'ri-note ri-note-warn' }, `Only the first ${MAX_ACTIVITIES} that are still going on are sent. Mark the others as finished, or turn them off.`) : null,
                rows.length ? h('div', { class: 'ri-list' }, rows) : h('div', { class: 'ri-muted' }, EMPTY[kind]),
                h('div', { class: 'ri-row' }, button(def.add, () => go(app, { view: 'edit', draft: newWorldEntry(data, kind) }), { kind: mine.length ? '' : 'primary' }))));
        }
        listBox.replaceChildren(...out);

        // What the extension reads from the last reply, and what it would send now.
        const notes = buildNotes(list);
        preview.replaceChildren(section('What would be sent with the next reply',
            notes ? [
                h('div', { class: 'ri-grid' },
                    kv('Read as present', notes.present.length ? `${notes.present.join(', ')} (read from ${notes.how})` : 'Nobody who has an entry'),
                    notes.place ? kv('Place', notes.place) : null,
                    notes.missing.length ? kv('Named in the scene, with no entry yet', notes.missing.join(', ')) : null,
                    kv('Size', `about ${notes.tokens} tokens of the ${settings().world.budget} allowed, ${notes.ids.length} ${notes.ids.length === 1 ? 'entry' : 'entries'}`)),
                h('div', { class: 'ri-label' }, 'Exactly what the AI would receive'),
                h('div', { class: 'ri-preview' }, notes.text),
            ] : h('div', { class: 'ri-muted' }, list.length ? 'Nothing right now: no entry is on, in the scene, named in the last messages, or an open thread.' : 'Nothing yet. Add an entry above.')));
    }).catch((e) => listBox.replaceChildren(h('div', { class: 'ri-empty' }, `This world could not be read: ${e.message}`)));
}

const kv = (k, v) => h('div', { class: 'ri-kv' }, h('span', { class: 'ri-k' }, k), h('span', { class: 'ri-v' }, v));

const EMPTY = {
    character: 'No characters yet. Add the people of this story: who they are, what they want, what they know.',
    place: 'No places yet.',
    faction: 'No groups yet.',
    thread: 'No open threads yet. An open thread is a matter the story has raised and not settled. Open threads are always sent.',
    secret: 'No secrets yet. A secret is sent when its keeper is in the scene. While it is kept, the AI can be shown one line only.',
    seed: 'No planted details yet. A planted detail is something small the story showed that can matter later.',
    activity: `Nothing yet. Up to ${MAX_ACTIVITIES} things that people are doing away from the scene, always sent in one line each.`,
};

function sendSettings(app) {
    const o = settings().world;
    const save = () => { saveSettings(); app.render(); };
    return section('How story notes are sent',
        h('div', { class: 'ri-grid2' },
            field('Room for story notes (tokens)', 'Open threads and what is going on elsewhere go in first, then the people in the scene, the place, their secrets, and last whatever the recent messages name. People in the scene are shortened when room runs out.',
                numberInput(o.budget, { min: 100, max: 4000, unit: 'tokens' }, (n) => { o.budget = n; save(); })),
            field('Where the notes are placed', o.place === 'depth' ? 'In the chat, a few messages up from the end. Works with every preset.' : 'With the lorebook entries of the preset. The preset must have that World Info marker, or the notes are dropped.',
                select([{ value: 'depth', label: 'In the chat, a few messages up' }, { value: 'after', label: 'With the lorebook entries after the character' }, { value: 'before', label: 'With the lorebook entries before the character' }], o.place, (v) => { o.place = v; save(); })),
            o.place === 'depth' ? field('How many messages up', '0 is the very end of the chat.', numberInput(o.depth, { min: 0, max: 20, unit: 'messages' }, (n) => { o.depth = n; save(); })) : null,
            field('Messages read for names', 'When the reply has no scene header or HUD, people named in this many recent messages count as present. Other entries named there are added while room is left.',
                numberInput(o.lookback, { min: 1, max: 20, unit: 'messages' }, (n) => { o.lookback = n; save(); }))));
}

// ---------- one entry ----------

function flagNode(flags) {
    const { blocks, checks, warns } = flags;
    if (!blocks.length && !checks.length && !warns.length) return null;
    return h('div', { class: 'ri-flags' },
        blocks.map(b => h('div', { class: 'ri-flag ri-flag-block' }, `Must fix: ${b}`)),
        checks.map(c => h('div', { class: 'ri-flag ri-flag-check' }, `Check: ${c}`)),
        warns.map(w => h('div', { class: 'ri-flag ri-flag-warn' }, w)));
}

function renderEdit(body, app) {
    const id = chatWorld();
    const r = app.wroute;
    const draft = r.draft;
    const def = WORLD_KINDS[draft.kind];
    const ui = r.ui || (r.ui = { ai: null, others: null });
    const redraw = () => app.render();
    const dirty = () => { r.dirty = true; };
    if (!id) { go(app, { view: 'list' }); return; }
    if (!ui.others) { ui.others = []; loadWorld(id).then((data) => { ui.others = data ? listWorld(data, id) : []; redraw(); }).catch(() => {}); }

    body.appendChild(h('div', { class: 'ri-row' }, button(`‹ Back to ${setName(id)}`, async () => {
        if (r.dirty && !await confirmBox('Leave without saving your changes to this entry?')) return;
        go(app, { view: 'list' });
    }, { kind: 'ghost' })));
    body.appendChild(h('div', { class: 'ri-h2' }, draft.isNew ? `New ${def.label.toLowerCase()}` : `${def.label}: ${draft.name}`));

    if (ui.ai) { body.appendChild(aiBox(app, draft, ui, redraw, dirty)); return; }
    body.appendChild(h('div', { class: 'ri-row' }, button('Write this entry with AI', () => { ui.ai = { about: draft.name || '', busy: false, error: '' }; redraw(); }, { kind: 'primary', title: 'One AI request fills in the lines. Nothing is saved until you press Save.' })));

    body.appendChild(section('Name',
        field(def.nameLabel, def.nameHelp, textInput(draft.name, (v) => { draft.name = v; dirty(); }, { placeholder: def.nameLabel })),
        field('Other names', 'Other names the story uses for it, separated by commas. The extension uses them to tell when it is in the scene or being talked about.',
            textInput(draft.aliases.join(', '), (v) => { draft.aliases = v.split(',').map(x => x.trim()).filter(Boolean); dirty(); }, { placeholder: 'None' }))));

    const lines = def.fields.map(f => field(f.label, f.help, f.long
        ? textArea(draft.fields[f.key], (v) => { draft.fields[f.key] = v; dirty(); }, { rows: 2 })
        : textInput(draft.fields[f.key], (v) => { draft.fields[f.key] = v; dirty(); })));
    body.appendChild(section(draft.kind === 'character' ? 'About this person' : 'Details',
        h('div', { class: 'ri-help' }, 'Plain statements of fact work best, such as "Tom has a secret" or "Hale feels responsible for his crew". Leave a line empty when there is nothing to say.'),
        lines));

    if (def.steps || draft.kind === 'secret') {
        body.appendChild(section('Where it stands',
            def.steps ? field(draft.kind === 'secret' ? 'Is it still kept' : 'Status', STEP_HELP[draft.kind] || '', select(def.steps.map(s => ({ value: s[0], label: s[1] })), draft.status, (v) => { draft.status = v; dirty(); redraw(); })) : null,
            draft.kind === 'secret' && draft.status === 'kept' ? field('What the AI is shown while it is kept', draft.show === 'full'
                ? 'The AI reads the whole secret, with the order that it stays unsaid and unseen until an order says it comes out.'
                : 'The AI reads only the one line above. It cannot give away what it has not been told.',
                select([{ value: 'shadow', label: 'One line only' }, { value: 'full', label: 'The whole secret, with an order to keep it' }], draft.show, (v) => { draft.show = v; dirty(); redraw(); })) : null));
    }

    const flags = entryFlags(draft, ui.others);
    body.appendChild(section('What the AI would receive for this entry',
        h('div', { class: 'ri-preview' }, `- ${renderEntry(draft)}`),
        flagNode(flags)));

    const save = async () => {
        const now = entryFlags(draft, ui.others);
        if (now.blocks.length) { toast('error', now.blocks[0]); return; }
        try {
            const data = await loadWorld(id);
            if (!data) throw new Error('The lorebook could not be read.');
            if (draft.isNew && data.entries[draft.uid]) draft.uid = newWorldEntry(data, draft.kind).uid;
            writeWorldEntry(data, draft, id);
            await saveWorld(id, data);
            toast('success', `${def.label} saved.`);
            go(app, { view: 'list' });
        } catch (e) { toast('error', `Could not save: ${e.message}`); }
    };
    body.appendChild(h('div', { class: 'ri-row ri-savebar' },
        button(`Save ${def.label.toLowerCase()}`, save, { kind: 'primary' }),
        button('Cancel', () => go(app, { view: 'list' }), { kind: 'ghost' }),
        draft.isNew ? null : button('Delete', async () => {
            if (!await confirmBox(`Delete "${draft.name}" from this world?`)) return;
            try { const data = await loadWorld(id); delete data.entries[draft.uid]; await saveWorld(id, data); go(app, { view: 'list' }); }
            catch (e) { toast('error', `Could not delete: ${e.message}`); }
        }, { kind: 'danger' })));
}

const STEP_HELP = {
    secret: 'A kept secret is sent in the way you choose below. Once it is out in the open, the whole of it is sent.',
    thread: 'How close this matter is to coming to a head. A finished thread is no longer sent.',
    seed: 'A detail that has paid off is no longer sent.',
    activity: 'Something that is finished is no longer sent.',
};

function aiBox(app, draft, ui, redraw, dirty) {
    const ai = ui.ai;
    const def = WORLD_KINDS[draft.kind];
    const box = h('div', { class: 'ri-sheet-box' }, h('div', { class: 'ri-h2' }, `Write this ${def.label.toLowerCase()} with AI`));
    box.append(
        field('What it is about (you can leave this empty)', `A name or a few words. Left empty, the AI picks a ${def.label.toLowerCase()} from what you let it read below.`,
            textInput(ai.about, (v) => { ai.about = v; }, { placeholder: draft.kind === 'character' ? 'Example: Mira, the fruit seller' : 'A name or a few words' })),
        contextField(),
        h('div', { class: 'ri-help' }, 'The AI can only write what it is shown. Tick the character card and the recent messages for the best result.'));
    if (ai.error) box.appendChild(h('div', { class: 'ri-note ri-note-warn' }, ai.error));
    box.appendChild(h('div', { class: 'ri-row' },
        button(ai.busy ? 'Writing...' : 'Write the entry', async () => {
            if (ai.busy) return;
            ai.busy = true; ai.error = ''; redraw();
            try {
                const res = await writeWorldEntryWithAI({ kind: draft.kind, about: ai.about.trim(), context: settings().writer.context, existing: (ui.others || []).filter(o => o.kind === draft.kind && o.uid !== draft.uid).map(o => o.name) });
                // Lines you already filled in are kept. The AI's text goes into the empty ones.
                if (!draft.name.trim() && res.name) draft.name = res.name;
                draft.aliases = [...new Set([...draft.aliases, ...res.aliases])].filter(a => a.toLowerCase() !== draft.name.toLowerCase());
                let filled = 0;
                for (const f of def.fields) if (!String(draft.fields[f.key] || '').trim() && res.fields[f.key]) { draft.fields[f.key] = res.fields[f.key]; filled++; }
                dirty();
                ui.ai = null;
                toast('success', filled ? `${filled} ${filled === 1 ? 'line was' : 'lines were'} filled in. Read them, change what you like, then press Save.` : 'The AI had nothing to add to the lines that were empty.');
            } catch (e) { ai.error = e.message; }
            if (ui.ai) ui.ai.busy = false;
            redraw();
        }, { kind: 'primary', disabled: ai.busy }),
        button('Cancel', () => { ui.ai = null; redraw(); }, { kind: 'ghost', disabled: ai.busy })));
    return box;
}
