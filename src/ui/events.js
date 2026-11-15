// Random Story Events tab: the list of event sets, and the editor for one event set.
import { h, button, toggle, select, numberInput, textInput, textArea, field, section, versionText, chip, download } from './dom.js';
import { knownSets, loadSet, saveSet, createSet, forgetSet, wrapText, SENT_AS } from '../books.js';
import { MODES, newEvent, newCategory, newId, findEventEntry, readEvent, writeEvent, rollEvent } from '../events.js';
import { settings, saveSettings, chatState, saveChatState } from '../store.js';
import { validateVersion, swapNames } from '../validate.js';
import { writeItems } from '../writer.js';
import { toast, confirmBox, inputBox, sub } from '../st.js';

export function renderEvents(body, app) {
    return app.eroute.view === 'edit' ? renderEdit(body, app) : renderList(body, app);
}

const go = (app, route) => { app.eroute = route; app.resetScroll = true; app.render(); app.root?.scrollIntoView?.({ block: 'start' }); };

function onForChat(name) {
    const cs = chatState();
    if (!cs) return h('span', { class: 'ri-muted' }, 'Open a chat to turn this on');
    return h('label', { class: 'ri-switch-row' }, h('span', {}, 'On for this chat'),
        toggle(cs.activeSets.includes(name), (v) => { cs.activeSets = cs.activeSets.filter(n => n !== name); if (v) cs.activeSets.push(name); saveChatState(); }, `Turn ${name} on or off for this chat`));
}

async function openSet(app, name) {
    const data = await loadSet(name);
    const entry = findEventEntry(data);
    if (!entry) { toast('error', 'This lorebook has no story event in it.'); return; }
    go(app, { view: 'edit', name, draft: readEvent(entry, name), open: {} });
}

// ---------- list of event sets ----------

function renderList(body, app) {
    const sets = knownSets('events');
    body.appendChild(h('div', { class: 'ri-intro' }, 'A story event set holds lists of story ingredients, sorted into categories. When an event fires, dice pick one item from each category that is on, and the AI must make an event happen from them in that reply.'));
    body.appendChild(h('div', { class: 'ri-row' }, button('Add story event set', async () => {
        const name = await inputBox('Name for the new story event set:');
        if (!name) return;
        try {
            const ev = newEvent(name);
            const data = { entries: {} };
            writeEvent(data, ev);
            const made = await createSet(name, 'events', data);
            await openSet(app, made);
        } catch (e) { toast('error', e.message); }
    }, { kind: 'primary' })));
    if (!sets.length) { body.appendChild(h('div', { class: 'ri-empty' }, 'No story event sets yet. Press "Add story event set" to make the first one.')); return; }

    for (const name of sets) {
        const info = h('div', { class: 'ri-grid' }, h('div', { class: 'ri-kv' }, h('span', { class: 'ri-k' }, 'Categories'), h('span', { class: 'ri-v' }, '...')));
        loadSet(name).then((data) => {
            const entry = findEventEntry(data);
            if (!entry) { info.replaceChildren(h('span', { class: 'ri-muted' }, 'This lorebook has no story event in it.')); return; }
            const ev = readEvent(entry, name);
            const on = ev.categories.filter(c => c.on);
            const kv = (k, v) => h('div', { class: 'ri-kv' }, h('span', { class: 'ri-k' }, k), h('span', { class: 'ri-v' }, v));
            info.replaceChildren(
                kv('Categories turned on', on.length ? on.map(c => `${c.name} (${c.items.filter(i => i.on).length})`).join(', ') : 'none'),
                kv('How often', `${ev.chance}% chance each reply${ev.wait ? `, then waits ${ev.wait} ${ev.wait === 1 ? 'reply' : 'replies'}` : ''}`));
        }).catch(() => info.replaceChildren(h('span', { class: 'ri-muted' }, 'This lorebook could not be read.')));
        body.appendChild(h('div', { class: 'ri-card ri-setcard' },
            h('div', { class: 'ri-card-top' }, h('button', { type: 'button', class: 'ri-card-name', onclick: () => openSet(app, name) }, name), onForChat(name)),
            info,
            h('div', { class: 'ri-row' },
                button('Open', () => openSet(app, name), { kind: 'primary', title: 'See and edit the categories and items' }),
                button('Export', async () => { const data = await loadSet(name); if (!data || !download(`${name}.json`, JSON.stringify(data, null, 4))) toast('info', 'Export did not start here. You can also export this lorebook from the World Info screen.'); }, { kind: 'ghost' }),
                button('Remove from this list', async () => {
                    if (!await confirmBox(`Remove "${name}" from this list? The lorebook itself is kept.`)) return;
                    forgetSet(name);
                    const cs = chatState();
                    if (cs) { cs.activeSets = cs.activeSets.filter(n => n !== name); saveChatState(); }
                    app.render();
                }, { kind: 'ghost' }))));
    }
}

// ---------- one event set ----------

function itemFlags(cat, text) {
    const { blocks, warns } = validateVersion(text);
    if (cat.driver && /\{\{user/i.test(text)) blocks.push('{{user}} cannot be the one who drives an event. Name someone else, or the surroundings.');
    // Items are short phrases, so the checks for full orders that do not apply here are left out.
    const keep = warns.filter(w => !/makes this optional/.test(w));
    return { blocks, node: (blocks.length || keep.length) ? h('div', { class: 'ri-flags' }, blocks.map(b => h('div', { class: 'ri-flag ri-flag-block' }, `Must fix: ${b}`)), keep.map(w => h('div', { class: 'ri-flag ri-flag-warn' }, w))) : null };
}

function categoryCard(app, draft, cat, index, redraw, dirty) {
    const r = app.eroute;
    const ui = r.cat?.[cat.id] || ((r.cat = r.cat || {})[cat.id] = { adding: '', editing: '', ai: null });
    const usable = cat.items.filter(i => i.on);
    const summary = [h('span', { class: 'ri-sent-title' }, cat.name || 'Category'),
        h('span', { class: 'ri-sent-sub' }, cat.on ? `${usable.length} ${usable.length === 1 ? 'item' : 'items'} · ${MODES[cat.mode].label}` : 'Turned off')];
    const body = [];

    body.push(h('div', { class: 'ri-grid2' },
        field('Name of this category', 'Shown to the AI in front of the picked item, for example "Complication: a locked door".', textInput(cat.name, (v) => { cat.name = v; dirty(); }, { placeholder: 'Example: Complication' })),
        field('Use this category', 'Off leaves it out of every event.', select([{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], cat.on ? 'on' : 'off', (v) => { cat.on = v === 'on'; dirty(); redraw(); }))));
    body.push(h('div', { class: 'ri-grid2' },
        field('How it changes', MODES[cat.mode].help, select(Object.entries(MODES).map(([value, m]) => ({ value, label: m.label })), cat.mode, (v) => { cat.mode = v; dirty(); redraw(); })),
        cat.mode === 'keepRandom' ? field('Keep the pick for at least (events)', '', numberInput(cat.keepMin, { min: 1, max: 50, unit: 'events' }, (n) => { cat.keepMin = n; if (cat.keepMax < n) cat.keepMax = n; dirty(); })) : null,
        cat.mode === 'keepRandom' ? field('Keep the pick for at most (events)', 'A number between the two is rolled each time.', numberInput(cat.keepMax, { min: 1, max: 50, unit: 'events' }, (n) => { cat.keepMax = Math.max(n, cat.keepMin); dirty(); })) : null,
        cat.mode === 'keepFixed' ? field('Item to keep', 'Every event uses this item.', select([{ value: '', label: usable.length ? 'Choose an item' : 'Add an item first' }, ...usable.map(i => ({ value: i.id, label: i.text.slice(0, 70) }))], cat.fixed || '', (v) => { cat.fixed = v; dirty(); })) : null,
        cat.mode === 'keepFixed' ? null : field('Items per pick', 'How many items from this category go into one event.', numberInput(cat.count, { min: 1, max: 5, unit: 'items' }, (n) => { cat.count = n; dirty(); })),
        cat.mode === 'keepFixed' ? null : field('Use every item before repeating', 'On: no item comes back until all the others have had a turn.', select([{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], cat.useAll ? 'on' : 'off', (v) => { cat.useAll = v === 'on'; dirty(); })),
        cat.mode === 'keepFixed' ? null : field('Wait before an item can return (events)', 'An item that was just used sits out this many events. 0 turns this off.', numberInput(cat.itemWait, { min: 0, max: 50, unit: 'events' }, (n) => { cat.itemWait = n; dirty(); })),
        field('Never use items tagged', 'Items with any of these tags are left out. Separate tags with commas.', textInput(cat.neverTags, (v) => { cat.neverTags = v; dirty(); }, { placeholder: 'No tags' }))));

    // Items
    const list = h('div', { class: 'ri-versions' });
    cat.items.forEach((it, i) => {
        const flags = itemFlags(cat, it.text);
        if (ui.editing === it.id) {
            let value = it.text;
            const box = textInput(value, (v) => { value = v; });
            list.appendChild(h('div', { class: 'ri-version ri-version-editing' }, box, h('div', { class: 'ri-row ri-row-tight' },
                button('Done', () => { if (value.trim()) { it.text = value.trim(); dirty(); } ui.editing = ''; redraw(); }, { kind: 'primary' }),
                button('Cancel', () => { ui.editing = ''; redraw(); }, { kind: 'ghost' }))));
            return;
        }
        const tick = h('input', { type: 'checkbox', class: 'ri-check', checked: it.on, title: 'Tick to let the dice use this item', onchange: () => { it.on = tick.checked; dirty(); } });
        list.appendChild(h('div', { class: `ri-version ${flags.blocks.length ? 'ri-version-blocked' : ''}` },
            h('label', { class: 'ri-vpick' }, tick, h('span', { class: 'ri-vbody' }, versionText(it.text))),
            flags.node,
            h('div', { class: 'ri-row ri-row-tight' },
                h('span', { class: 'ri-num' }, h('span', { class: 'ri-unit' }, 'Weight'), numberInput(it.weight, { min: 1, max: 20 }, (n) => { it.weight = n; dirty(); })),
                h('span', { class: 'ri-num' }, h('span', { class: 'ri-unit' }, 'Tags'), textInput(it.tags, (v) => { it.tags = v; dirty(); }, { placeholder: 'none', style: { width: '120px' } })),
                button(it.always ? 'Always included' : 'Always include', () => { it.always = !it.always; dirty(); redraw(); }, { kind: 'ghost', title: 'An always-included item is in every fresh pick; the dice fill the rest' }),
                button('Edit', () => { ui.editing = it.id; redraw(); }, { kind: 'ghost' }),
                button('Delete', () => { cat.items.splice(i, 1); if (cat.fixed === it.id) cat.fixed = ''; dirty(); redraw(); }, { kind: 'danger' }))));
    });
    if (!cat.items.length) list.appendChild(h('div', { class: 'ri-empty' }, 'No items yet. Type one below, or press "Write items with AI".'));
    body.push(h('div', { class: 'ri-label' }, 'Items (a higher weight is picked more often)'), list);

    const addBox = textInput(ui.adding, (v) => { ui.adding = v; }, { placeholder: 'Type a new item, for example: a letter arrives' });
    const addItem = () => {
        const t = swapNames(String(ui.adding || '').trim()).text;
        if (!t) { toast('info', 'Type the item first.'); return; }
        cat.items.push({ id: newId(), text: t, on: true, weight: 1, tags: '', always: false });
        ui.adding = ''; dirty(); redraw();
    };
    addBox.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addItem(); } });
    body.push(h('div', { class: 'ri-control' }, addBox), h('div', { class: 'ri-row' },
        button('Add this item', addItem),
        button('Write items with AI', () => { ui.ai = { theme: app.eroute.lastTheme || '', count: 12, includeCard: false, busy: false, error: '', results: null }; redraw(); }, { kind: 'primary' })));

    if (ui.ai) body.push(aiBox(app, draft, cat, ui, redraw, dirty));

    body.push(h('div', { class: 'ri-row' },
        button('Move category up', () => { if (index > 0) { [draft.categories[index - 1], draft.categories[index]] = [draft.categories[index], draft.categories[index - 1]]; dirty(); redraw(); } }, { kind: 'ghost', disabled: index === 0 }),
        button('Move category down', () => { if (index < draft.categories.length - 1) { [draft.categories[index + 1], draft.categories[index]] = [draft.categories[index], draft.categories[index + 1]]; dirty(); redraw(); } }, { kind: 'ghost', disabled: index === draft.categories.length - 1 }),
        button('Delete category', async () => { if (!await confirmBox(`Delete the category "${cat.name}" and its ${cat.items.length} items?`)) return; draft.categories.splice(index, 1); dirty(); redraw(); }, { kind: 'danger' })));

    const card = h('details', { class: `ri-card ri-fold ${cat.on ? '' : 'ri-off'}`, open: !!r.open[cat.id] },
        h('summary', { class: 'ri-fold-head' }, h('span', { class: 'ri-chevron', 'aria-hidden': 'true' }, '›'), h('span', { class: 'ri-fold-title' }, summary)),
        h('div', { class: 'ri-fold-body' }, body));
    card.addEventListener('toggle', () => { r.open[cat.id] = card.open; });
    return card;
}

function aiBox(app, draft, cat, ui, redraw, dirty) {
    const ai = ui.ai;
    const box = h('div', { class: 'ri-sheet-box' }, h('div', { class: 'ri-h2' }, `Write items for "${cat.name}" with AI`));
    if (!ai.results) {
        box.append(
            field('Kind of story', 'A few words. The AI writes items that fit it.', textInput(ai.theme, (v) => { ai.theme = v; }, { placeholder: 'Example: slow-burn romance in a small coastal town' })),
            h('div', { class: 'ri-grid2' },
                field('How many items to write', '', numberInput(ai.count, { min: 1, max: 40, unit: 'items' }, (n) => { ai.count = n; })),
                field('Show the AI the character card', 'Turn on to match the character and story. Uses more tokens.', select([{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }], ai.includeCard ? 'yes' : 'no', (v) => { ai.includeCard = v === 'yes'; }))));
        if (ai.error) box.appendChild(h('div', { class: 'ri-note ri-note-warn' }, ai.error));
        box.appendChild(h('div', { class: 'ri-row' },
            button(ai.busy ? 'Writing...' : 'Write the items', async () => {
                if (ai.busy) return;
                if (!ai.theme.trim()) { ai.error = 'Type the kind of story first.'; redraw(); return; }
                ai.busy = true; ai.error = ''; redraw();
                app.eroute.lastTheme = ai.theme;
                try {
                    const list = await writeItems({ category: cat, theme: ai.theme.trim(), count: ai.count, includeCard: ai.includeCard, existing: cat.items.map(i => i.text), others: draft.categories.filter(c => c !== cat && c.on).map(c => c.name) });
                    ai.results = list.map(x => ({ text: x.text, keep: itemFlags(cat, x.text).blocks.length === 0 }));
                } catch (e) { ai.error = e.message; }
                ai.busy = false; redraw();
            }, { kind: 'primary', disabled: ai.busy }),
            button('Cancel', () => { ui.ai = null; redraw(); }, { kind: 'ghost', disabled: ai.busy })));
        return box;
    }
    box.appendChild(h('div', { class: 'ri-help' }, 'Tick the items to add. Everything the AI wrote is shown here; nothing is added until you press the button.'));
    const list = h('div', { class: 'ri-versions' });
    ai.results.forEach((x) => {
        const flags = itemFlags(cat, x.text);
        if (flags.blocks.length) x.keep = false;
        const tick = h('input', { type: 'checkbox', class: 'ri-check', checked: x.keep, disabled: flags.blocks.length > 0, onchange: () => { x.keep = tick.checked; } });
        list.appendChild(h('div', { class: `ri-version ${flags.blocks.length ? 'ri-version-blocked' : ''}` }, h('label', { class: 'ri-vpick' }, tick, h('span', { class: 'ri-vbody' }, versionText(x.text))), flags.node));
    });
    box.append(list, h('div', { class: 'ri-row' },
        button('Add the ticked items', () => {
            const picked = ai.results.filter(x => x.keep);
            if (!picked.length) { toast('info', 'Tick at least one item to add.'); return; }
            cat.items.push(...picked.map(x => ({ id: newId(), text: x.text, on: true, weight: 1, tags: '', always: false })));
            ui.ai = null; dirty(); redraw();
        }, { kind: 'primary' }),
        button('Write more', () => { ai.results = null; redraw(); }, { kind: 'ghost' }),
        button('Cancel', () => { ui.ai = null; redraw(); }, { kind: 'ghost' })));
    return box;
}

function renderEdit(body, app) {
    const r = app.eroute;
    const { name, draft } = r;
    const redraw = () => app.render();
    const dirty = () => { r.dirty = true; };

    body.appendChild(h('div', { class: 'ri-row' }, button('‹ Back to story event sets', async () => {
        if (r.dirty && !await confirmBox('Leave without saving your changes to this story event set?')) return;
        go(app, { view: 'list' });
    }, { kind: 'ghost' })));
    body.appendChild(h('div', { class: 'ri-card ri-setcard' }, h('div', { class: 'ri-card-top' }, h('div', { class: 'ri-h2' }, name), onForChat(name))));

    body.appendChild(section('When an event happens',
        h('div', { class: 'ri-grid2' },
            field('Chance of an event each reply (%)', '10 gives an event about once in 10 replies. Big story moments feel right at 2 to 10.', numberInput(draft.chance, { min: 0, max: 100, unit: '%' }, (n) => { draft.chance = n; dirty(); })),
            field('Wait after an event (replies)', 'After an event, no new event from this set for this many replies.', numberInput(draft.wait, { min: 0, max: 500, unit: 'replies' }, (n) => { draft.wait = n; dirty(); })),
            field('Keep sending the event for (replies)', 'The same event order is sent again with this many more replies. 0 sends it once.', numberInput(draft.keep, { min: 0, max: 50, unit: 'replies' }, (n) => { draft.keep = n; dirty(); })),
            field('No events before reply number', '0 lets events happen from the start of the chat.', numberInput(draft.notBefore, { min: 0, max: 1000, unit: '' }, (n) => { draft.notBefore = n; dirty(); })),
            field('Sent as', SENT_AS[draft.sentAs].help, select([{ value: 'system', label: SENT_AS.system.label }, { value: 'ooc', label: SENT_AS.ooc.label }], draft.sentAs, (v) => { draft.sentAs = v; dirty(); redraw(); })))));

    const cats = h('div', {}, draft.categories.map((cat, i) => categoryCard(app, draft, cat, i, redraw, dirty)));
    body.appendChild(section('Categories (the dice pick from each one that is on)',
        h('div', { class: 'ri-help' }, 'Tap a category to open it. Each category is a list of short items. {{user}} never drives an event: items can only make things happen to {{user}}.'),
        cats,
        h('div', { class: 'ri-row' }, button('Add category', async () => {
            const n = await inputBox('Name for the new category (for example: Place, Secret, Stakes):');
            if (!n) return;
            const cat = newCategory(n);
            draft.categories.push(cat); r.open[cat.id] = true; dirty(); redraw();
        }))));

    // Try it
    const preview = h('div', { class: 'ri-preview' }, r.example || 'Press the button to see one example of what the AI would receive.');
    body.appendChild(section('Try it',
        h('div', { class: 'ri-row' }, button('Roll an example event', () => {
            const rolled = rollEvent({ categories: draft.categories }, r.exampleState || null);
            if (!rolled) { r.example = 'Nothing to roll yet. Turn on a category and give it at least one item.'; r.exampleState = null; }
            else { r.example = sub(wrapText(draft.sentAs, rolled.text, 0)); r.exampleState = rolled.state; }
            redraw();
        })),
        field('Exactly what the AI would receive', 'Each press rolls the next event in a row, so you can see items rotate. Nothing is sent or saved.', preview)));

    body.appendChild(section('Notes', field('Notes for yourself', 'Never sent in the chat.', textArea(draft.notes, (v) => { draft.notes = v; dirty(); }, { rows: 2 }))));

    const save = async () => {
        const blocked = draft.categories.flatMap(c => c.items.filter(i => itemFlags(c, i.text).blocks.length).map(() => c.name));
        if (blocked.length) { toast('error', `${blocked.length} ${blocked.length === 1 ? 'item is' : 'items are'} marked "Must fix" (in ${[...new Set(blocked)].join(', ')}). Edit or delete ${blocked.length === 1 ? 'it' : 'them'} first.`); return; }
        const fixedMissing = draft.categories.find(c => c.on && c.mode === 'keepFixed' && !c.items.some(i => i.on && i.id === c.fixed));
        if (fixedMissing) { toast('info', `Choose the item to keep in "${fixedMissing.name}", or change how it changes.`); return; }
        try {
            const data = await loadSet(name);
            if (!data) throw new Error('The lorebook could not be read.');
            const existing = findEventEntry(data);
            if (existing) draft.uid = existing.uid;
            writeEvent(data, draft);
            await saveSet(name, data);
            r.dirty = false;
            const ready = draft.categories.some(c => c.on && c.items.some(i => i.on));
            toast('success', ready ? 'Story event set saved.' : 'Saved. It has no items to pick yet, so it sends nothing.');
            go(app, { view: 'list' });
        } catch (e) { toast('error', `Could not save: ${e.message}`); }
    };
    body.appendChild(h('div', { class: 'ri-row ri-savebar' },
        button('Save story event set', save, { kind: 'primary' }),
        button('Cancel', () => go(app, { view: 'list' }), { kind: 'ghost' })));
}
