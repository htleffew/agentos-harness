// Random Story Events tab and Random Writing Style tab. Both are a list of sets and an editor for one set:
// categories of items, with dice settings. They differ in wording and in when the order is sent.
import { h, button, toggle, select, numberInput, textInput, textArea, field, section, versionText, chip, download } from './dom.js';
import { knownSets, loadSet, saveSet, createSet, forgetSet, exportSet, setName, freeUid, wrapText, SENT_AS } from '../books.js';
import { keptIn, removeText, deleteButton } from './sets.js';
import { MODES, newEvent, newStyle, newCategory, newId, findEventEntry, readEvent, writeEvent, rollEvent, snapshotSettings, loadSettings, pairList } from '../events.js';
import { settings, saveSettings, chatState, saveChatState } from '../store.js';
import { validateVersion, swapNames, userDrives } from '../validate.js';
import { writeItems } from '../writer.js';
import { toast, confirmBox, inputBox, sub } from '../st.js';
import { contextField } from './context.js';

const EVENTS = {
    kind: 'events', type: 'event', route: 'eroute', make: newEvent, tick: 'events', set: 'story event set', sets: 'story event sets', Set: 'Story event set',
    intro: 'A story event set holds lists of story ingredients, sorted into categories. When an event fires, dice pick one item from each category that is on, and the AI must make an event happen from them in that reply.',
    catTitle: 'Categories (the dice pick from each one that is on)',
    catHelp: 'Tap a category to open it. Each category is a list of short items. {{user}} never drives an event: items can only make things happen to {{user}}.',
    newCat: 'Name for the new category (for example: Place, Secret, Stakes):', example: 'Roll an example event',
    exampleHelp: 'Each press rolls the next event in a row, so you can see items rotate. Nothing is sent or saved.',
    itemPlaceholder: 'Type a new item, for example: a letter arrives', themeLabel: 'Kind of story', themeHelp: 'A few words. The AI writes items that fit it.', themePlaceholder: 'Example: slow-burn romance in a small coastal town',
};
const STYLE = {
    kind: 'style', type: 'style', route: 'sroute', make: newStyle, tick: 'replies', set: 'writing style set', sets: 'writing style sets', Set: 'Writing style set',
    intro: 'A writing style set changes how replies are written: mood, prose style, author, pacing, rules for one reply. It leaves the events of the story alone. While a set is on for a chat, one style order is sent with every reply, built from the categories that are on.',
    catTitle: 'Categories (each one that is on adds one line to the style order)',
    catHelp: 'Tap a category to open it. Each category keeps its pick for as long as you set, so a mood can last many replies while a rule changes every time.',
    newCat: 'Name for the new category (for example: Humour, Vocabulary, Paragraph length):', example: "Roll the next reply's style",
    exampleHelp: 'Each press rolls the style for the next reply in a row, so you can see what stays and what changes. Nothing is sent or saved.',
    itemPlaceholder: 'Type a new item, for example: short sentences and concrete nouns', themeLabel: 'What you want from this category', themeHelp: 'A few words about the story or the kind of writing you like. The AI writes items that fit.', themePlaceholder: 'Example: tense, grounded fantasy with dry humour',
};
let cfg = EVENTS;

export function renderEvents(body, app) { cfg = EVENTS; return app.eroute.view === 'edit' ? renderEdit(body, app) : renderList(body, app); }
export function renderStyle(body, app) { cfg = STYLE; return app.sroute.view === 'edit' ? renderEdit(body, app) : renderList(body, app); }

const go = (app, route, c = cfg) => { app[c.route] = route; app.resetScroll = true; app.render(); app.root?.scrollIntoView?.({ block: 'start' }); };

function onForChat(name) {
    const cs = chatState();
    if (!cs) return h('span', { class: 'ri-muted' }, 'Open a chat to turn this on');
    return h('label', { class: 'ri-switch-row' }, h('span', {}, 'On for this chat'),
        toggle(cs.activeSets.includes(name), (v) => { cs.activeSets = cs.activeSets.filter(n => n !== name); if (v) cs.activeSets.push(name); saveChatState(); }, `Turn ${setName(name)} on or off for this chat`));
}

async function openSet(app, name) {
    const c = cfg;
    const data = await loadSet(name);
    const entry = findEventEntry(data, c.type, name);
    if (!entry) { toast('error', `This lorebook is not a ${c.set}.`); return; }
    go(app, { view: 'edit', name, draft: readEvent(entry, setName(name)), open: {} }, c);
}

// ---------- list of event sets ----------

function renderList(body, app) {
    const sets = knownSets(cfg.kind);
    body.appendChild(h('div', { class: 'ri-intro' }, cfg.intro));
    body.appendChild(h('div', { class: 'ri-row' }, button(`Add ${cfg.set}`, async () => {
        const c = cfg;
        const name = await inputBox(`Name for the new ${c.set}:`);
        if (!name) return;
        try {
            const ev = c.make(name);
            const data = { entries: {} };
            writeEvent(data, ev);
            const made = await createSet(name, c.kind, data);
            cfg = c;
            await openSet(app, made);
        } catch (e) { toast('error', e.message); }
    }, { kind: 'primary' })));
    if (!sets.length) { body.appendChild(h('div', { class: 'ri-empty' }, `No ${cfg.sets} yet. Press "Add ${cfg.set}" to make the first one.`)); return; }

    for (const name of sets) {
        const info = h('div', { class: 'ri-grid' }, h('div', { class: 'ri-kv' }, h('span', { class: 'ri-k' }, 'Categories'), h('span', { class: 'ri-v' }, '...')));
        const c = cfg;
        loadSet(name).then((data) => {
            const entry = findEventEntry(data, c.type, name);
            if (!entry) { info.replaceChildren(h('span', { class: 'ri-muted' }, `This lorebook is not a ${c.set}.`)); return; }
            const ev = readEvent(entry, setName(name));
            const on = ev.categories.filter(c => c.on);
            const kv = (k, v) => h('div', { class: 'ri-kv' }, h('span', { class: 'ri-k' }, k), h('span', { class: 'ri-v' }, v));
            info.replaceChildren(
                kv('Categories turned on', on.length ? on.map(c => `${c.name} (${c.items.filter(i => i.on).length})`).join(', ') : 'none'),
                kv('How often', c.kind === 'style' ? 'With every reply while it is on for the chat' : `${ev.chance}% chance each reply${ev.wait ? `, then waits ${ev.wait} ${ev.wait === 1 ? 'reply' : 'replies'}` : ''}`));
        }).catch(() => info.replaceChildren(h('span', { class: 'ri-muted' }, 'This lorebook could not be read.')));
        body.appendChild(h('div', { class: 'ri-card ri-setcard' },
            h('div', { class: 'ri-card-top' }, h('button', { type: 'button', class: 'ri-card-name', onclick: () => openSet(app, name) }, setName(name)), onForChat(name)),
            keptIn(name),
            info,
            h('div', { class: 'ri-row' },
                button('Open', () => openSet(app, name), { kind: 'primary', title: 'See and edit the categories and items' }),
                button('Export', async () => { const data = await exportSet(name); if (!data || !download(`${setName(name)}.json`, JSON.stringify(data, null, 4))) toast('info', 'Export did not start here. You can also export this lorebook from the World Info screen.'); }, { kind: 'ghost' }),
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

// ---------- one event set ----------

function itemFlags(cat, text) {
    const { blocks, checks, warns } = validateVersion(text);
    if (cat.driver && userDrives(text)) checks.push('This item makes {{user}} the one who drives the event. Events work best when someone else, or the surroundings, drives them. If it reads right to you, keep it.');
    // Items are short phrases, so the checks for full orders that do not apply here are left out.
    const keep = warns.filter(w => !/makes this optional/.test(w));
    if (cfg.kind === 'style' && /\b(arrives?|appears?|enters?|bursts? in|interrupts?|attacks?|a stranger|a storm|a letter|a knock|discovers?|finds? out|confess(?:es)?|reveals?)\b/i.test(text)) keep.push('This reads like something that happens in the story. Writing style items change how the reply is written. Story happenings belong in Random Story Events.');
    return { blocks, checks, node: (blocks.length || checks.length || keep.length) ? h('div', { class: 'ri-flags' }, blocks.map(b => h('div', { class: 'ri-flag ri-flag-block' }, `Must fix: ${b}`)), checks.map(c => h('div', { class: 'ri-flag ri-flag-check' }, `Check: ${c}`)), keep.map(w => h('div', { class: 'ri-flag ri-flag-warn' }, w))) : null };
}

function categoryCard(app, draft, cat, index, redraw, dirty) {
    const r = app[cfg.route];
    const tick = cfg.tick;
    const modeLabel = { new: 'New pick every time', keepRandom: `Keep for a random number of ${tick}`, keepFixed: 'Keep until I turn it off' };
    const modeHelp = { new: tick === 'events' ? 'Each event gets a fresh pick from this category.' : 'Each reply gets a fresh pick from this category.', keepRandom: `The pick stays for several ${tick} in a row, then changes.`, keepFixed: tick === 'events' ? 'You choose the item. Every event uses it until you change this.' : 'You choose the item. Every reply uses it until you change this.' };
    const ui = r.cat?.[cat.id] || ((r.cat = r.cat || {})[cat.id] = { adding: '', editing: '', ai: null });
    const usable = cat.items.filter(i => i.on);
    const summary = [h('span', { class: 'ri-sent-title' }, versionText(cat.name || 'Category')),
        h('span', { class: 'ri-sent-sub' }, cat.locked ? 'Locked' : cat.on ? `${usable.length} ${usable.length === 1 ? 'item' : 'items'} · ${modeLabel[cat.mode]}` : 'Turned off')];
    const body = [];

    if (cat.locked) body.push(h('div', { class: 'ri-note ri-note-warn' }, 'This category is locked, so the point of view your preset sets is never changed by accident.',
        h('div', { class: 'ri-row ri-row-tight' }, button('Unlock this category', () => { cat.locked = false; dirty(); redraw(); }))));

    body.push(h('div', { class: 'ri-grid2' },
        field('Name of this category', tick === 'events' ? 'Shown to the AI in front of the picked item, for example "Complication: a locked door".' : 'Shown to the AI in front of the picked item, for example "Prose style: short sentences".', textInput(cat.name, (v) => { cat.name = v; dirty(); }, { placeholder: 'Example: Complication' })),
        cat.locked ? null : field('Use this category', tick === 'events' ? 'Off leaves it out of every event.' : 'Off leaves it out of the style order.', select([{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], cat.on ? 'on' : 'off', (v) => { cat.on = v === 'on'; dirty(); redraw(); }))));
    body.push(h('div', { class: 'ri-grid2' },
        field('How it changes', modeHelp[cat.mode], select(Object.keys(MODES).map(value => ({ value, label: modeLabel[value] })), cat.mode, (v) => { cat.mode = v; dirty(); redraw(); })),
        cat.mode === 'keepRandom' ? field(`Keep the pick for at least (${tick})`, '', numberInput(cat.keepMin, { min: 1, max: 200, unit: tick }, (n) => { cat.keepMin = n; if (cat.keepMax < n) cat.keepMax = n; dirty(); })) : null,
        cat.mode === 'keepRandom' ? field(`Keep the pick for at most (${tick})`, 'A number between the two is rolled each time.', numberInput(cat.keepMax, { min: 1, max: 200, unit: tick }, (n) => { cat.keepMax = Math.max(n, cat.keepMin); dirty(); })) : null,
        cat.mode === 'keepRandom' ? field('Chance to change once that time is over (%)', `100 changes the pick as soon as the time is up. 30 lets it stay on a little longer: each of the following ${tick} it has a 30% chance to change.`, numberInput(cat.changeChance, { min: 1, max: 100, unit: '%' }, (n) => { cat.changeChance = n; dirty(); })) : null,
        cat.mode === 'keepFixed' ? field('Item to keep', tick === 'events' ? 'Every event uses this item.' : 'Every reply uses this item.', select([{ value: '', label: usable.length ? 'Choose an item' : 'Add an item first' }, ...usable.map(i => ({ value: i.id, label: i.text.slice(0, 70) }))], cat.fixed || '', (v) => { cat.fixed = v; dirty(); })) : null,
        cat.mode === 'keepFixed' ? null : field('Items per pick', tick === 'events' ? 'How many items from this category go into one event.' : 'How many items from this category are used at the same time.', numberInput(cat.count, { min: 1, max: 5, unit: 'items' }, (n) => { cat.count = n; dirty(); })),
        cat.mode === 'keepFixed' || cfg.kind === 'style' ? null : field('Retire an item once it has happened', 'On: an item from this list that has happened in a chat never comes back in that chat. When every item is used up, this event stops. With checking on, an item retires when the check finds the event happened. With checking off, it retires when it is sent.', select([{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], cat.burn ? 'on' : 'off', (v) => { cat.burn = v === 'on'; dirty(); })),
        cat.mode === 'keepFixed' ? null : field('Use every item before repeating', 'On: no item comes back until all the others have had a turn.', select([{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], cat.useAll ? 'on' : 'off', (v) => { cat.useAll = v === 'on'; dirty(); })),
        cat.mode === 'keepFixed' ? null : field('Wait before an item can return (picks)', 'An item that was just used sits out this many fresh picks. 0 turns this off.', numberInput(cat.itemWait, { min: 0, max: 50, unit: 'picks' }, (n) => { cat.itemWait = n; dirty(); })),
        cfg.kind !== 'style' || cat.mode === 'keepFixed' ? null : field('Chance to be used when a new pick is due (%)', '100 always uses this category. 50 leaves it out about half the time.', numberInput(cat.chance, { min: 0, max: 100, unit: '%' }, (n) => { cat.chance = n; dirty(); })),
        cfg.kind !== 'style' || cat.mode === 'keepFixed' ? null : field('Rest after each pick ends (replies)', 'After its pick ends, the category is left out for this many replies. With "New pick every time", 1 means it is never used two replies in a row.', numberInput(cat.restAfter, { min: 0, max: 50, unit: 'replies' }, (n) => { cat.restAfter = n; dirty(); })),
        field('Never use items tagged', 'Items with any of these tags are left out. Separate tags with commas.', textInput(cat.neverTags, (v) => { cat.neverTags = v; dirty(); }, { placeholder: 'No tags' }))));
    if (cfg.kind === 'style') body.push(field('Words added after the pick', 'Sent in brackets after the picked item, to say how the pick is to be applied. Leave empty for nothing.', textInput(cat.after, (v) => { cat.after = v; dirty(); }, { placeholder: 'Nothing added' })));

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
        list.appendChild(h('div', { class: `ri-version ${flags.blocks.length ? 'ri-version-blocked' : flags.checks.length ? 'ri-version-flagged' : ''}` },
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
    body.push(h('div', { class: 'ri-help' }, `Tags are your own words for grouping items, separated by commas. They are used by "Never use items tagged" and "Never together".${cfg.kind === 'style' ? ' Four tags are also checked against the reply and shown in What Was Sent: rule:no-dialogue, rule:mostly-dialogue, rule:max-sentences-2 and rule:max-words-200 (any number works).' : ''}`));

    const addBox = textInput(ui.adding, (v) => { ui.adding = v; }, { placeholder: cfg.itemPlaceholder });
    const addItem = () => {
        const t = swapNames(String(ui.adding || '').trim()).text;
        if (!t) { toast('info', 'Type the item first.'); return; }
        cat.items.push({ id: newId(), text: t, on: true, weight: 1, tags: '', always: false });
        ui.adding = ''; dirty(); redraw();
    };
    addBox.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addItem(); } });
    body.push(h('div', { class: 'ri-control' }, addBox), h('div', { class: 'ri-row' },
        button('Add this item', addItem),
        button('Write items with AI', () => { ui.ai = { theme: app[cfg.route].lastTheme || '', count: 12, busy: false, error: '', results: null }; redraw(); }, { kind: 'primary' })));

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
            field(cfg.themeLabel, cfg.themeHelp, textInput(ai.theme, (v) => { ai.theme = v; }, { placeholder: cfg.themePlaceholder })),
            h('div', { class: 'ri-grid2' },
                field('How many items to write', '', numberInput(ai.count, { min: 1, max: 40, unit: 'items' }, (n) => { ai.count = n; })),
                contextField()));
        if (ai.error) box.appendChild(h('div', { class: 'ri-note ri-note-warn' }, ai.error));
        box.appendChild(h('div', { class: 'ri-row' },
            button(ai.busy ? 'Writing...' : 'Write the items', async () => {
                if (ai.busy) return;
                if (!ai.theme.trim()) { ai.error = 'Type a few words in the first box.'; redraw(); return; }
                ai.busy = true; ai.error = ''; redraw();
                app[cfg.route].lastTheme = ai.theme;
                try {
                    const list = await writeItems({ style: cfg.kind === 'style', category: cat, theme: ai.theme.trim(), count: ai.count, context: settings().writer.context, existing: cat.items.map(i => i.text), others: draft.categories.filter(c => c !== cat && c.on).map(c => c.name) });
                    ai.results = list.map(x => ({ text: x.text, keep: (f => f.blocks.length === 0 && f.checks.length === 0)(itemFlags(cat, x.text)) }));
                } catch (e) { ai.error = e.message; }
                ai.busy = false; redraw();
            }, { kind: 'primary', disabled: ai.busy }),
            button('Cancel', () => { ui.ai = null; redraw(); }, { kind: 'ghost', disabled: ai.busy })));
        return box;
    }
    box.appendChild(h('div', { class: 'ri-help' }, 'Tick the items to add. Everything the AI wrote is shown here; nothing is added until you press the button. An item marked "Check" starts unticked: tick it if it reads right to you.'));
    const list = h('div', { class: 'ri-versions' });
    ai.results.forEach((x) => {
        const flags = itemFlags(cat, x.text);
        if (flags.blocks.length) x.keep = false;
        const tick = h('input', { type: 'checkbox', class: 'ri-check', checked: x.keep, disabled: flags.blocks.length > 0, onchange: () => { x.keep = tick.checked; } });
        list.appendChild(h('div', { class: `ri-version ${flags.blocks.length ? 'ri-version-blocked' : flags.checks.length ? 'ri-version-flagged' : ''}` }, h('label', { class: 'ri-vpick' }, tick, h('span', { class: 'ri-vbody' }, versionText(x.text))), flags.node));
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
    const r = app[cfg.route];
    const { name, draft } = r;
    const redraw = () => app.render();
    const dirty = () => { r.dirty = true; };

    body.appendChild(h('div', { class: 'ri-row' }, button(`‹ Back to ${cfg.sets}`, async () => {
        if (r.dirty && !await confirmBox(`Leave without saving your changes to this ${cfg.set}?`)) return;
        go(app, { view: 'list' });
    }, { kind: 'ghost' })));
    body.appendChild(h('div', { class: 'ri-card ri-setcard' }, h('div', { class: 'ri-card-top' }, h('div', { class: 'ri-h2' }, name), onForChat(name))));

    if (cfg.kind === 'style') body.appendChild(section('When it is sent',
        h('div', { class: 'ri-help' }, 'With every reply, while this set is on for the chat. Each category below decides for itself how long its pick lasts. Writing style is sent as a style order and is not checked afterwards.'),
        field('Sent as', SENT_AS[draft.sentAs].help, select([{ value: 'system', label: SENT_AS.system.label }, { value: 'ooc', label: SENT_AS.ooc.label }], draft.sentAs, (v) => { draft.sentAs = v; dirty(); redraw(); }))));
    else body.appendChild(section('When an event happens',
        h('div', { class: 'ri-grid2' },
            field('Chance of an event each reply (%)', '10 gives an event about once in 10 replies. Big story moments feel right at 2 to 10.', numberInput(draft.chance, { min: 0, max: 100, unit: '%' }, (n) => { draft.chance = n; dirty(); })),
            field('Wait after an event (replies)', 'After an event, no new event from this set for this many replies.', numberInput(draft.wait, { min: 0, max: 500, unit: 'replies' }, (n) => { draft.wait = n; dirty(); })),
            field('Keep sending the event for (replies)', 'The same event order is sent again with this many more replies. 0 sends it once.', numberInput(draft.keep, { min: 0, max: 50, unit: 'replies' }, (n) => { draft.keep = n; dirty(); })),
            field('No events before reply number', '0 lets events happen from the start of the chat.', numberInput(draft.notBefore, { min: 0, max: 1000, unit: '' }, (n) => { draft.notBefore = n; dirty(); })),
            field('Sent as', SENT_AS[draft.sentAs].help, select([{ value: 'system', label: SENT_AS.system.label }, { value: 'ooc', label: SENT_AS.ooc.label }], draft.sentAs, (v) => { draft.sentAs = v; dirty(); redraw(); })))));

    const cats = h('div', {}, draft.categories.map((cat, i) => categoryCard(app, draft, cat, i, redraw, dirty)));
    body.appendChild(section(cfg.catTitle,
        h('div', { class: 'ri-help' }, cfg.catHelp),
        cats,
        h('div', { class: 'ri-row' }, button('Add category', async () => {
            const n = await inputBox(cfg.newCat);
            if (!n) return;
            const cat = newCategory(n);
            draft.categories.push(cat); r.open[cat.id] = true; dirty(); redraw();
        }))));

    // Never together
    const pairs = pairList(draft.neverTogether);
    body.appendChild(section('Never together',
        field('Pairs of tags that are never picked together', pairs.length ? `In use: ${pairs.map(p => `"${p[0]}" with "${p[1]}"`).join(', ')}.` : 'Write each pair as tag+tag and separate pairs with commas, for example: past+future, calm+frantic. When one item is picked, items with the other tag are left out of that roll.',
            textInput(draft.neverTogether || '', (v) => { draft.neverTogether = v; dirty(); }, { placeholder: 'No pairs' }))));

    // Saved category settings
    const names = Object.keys(draft.presets || {}).sort((a, b) => a.localeCompare(b));
    const csNow = chatState();
    const inUse = csNow?.presets?.[name] && names.includes(csNow.presets[name]) ? csNow.presets[name] : '';
    body.appendChild(section('Saved category settings',
        h('div', { class: 'ri-help' }, 'Save how the categories are set up right now (which are on, how long each pick lasts, and so on) under a name, for example "Slow burn". Items are not part of it. A chat can then use one of the saved setups while the set itself stays as it is.'),
        h('div', { class: 'ri-row' }, button('Save the current settings under a name', async () => {
            const n = await inputBox('Name for these settings (for example: Slow burn):');
            if (!n) return;
            draft.presets = { ...(draft.presets || {}), [n]: snapshotSettings(draft.categories) };
            dirty(); redraw();
        })),
        names.map(n => h('div', { class: 'ri-version' }, h('div', { class: 'ri-vbody' }, n), h('div', { class: 'ri-row ri-row-tight' },
            button('Load into the editor', () => { loadSettings(draft.categories, draft.presets[n]); dirty(); redraw(); toast('info', `The categories now use "${n}". Press Save to keep it that way for every chat.`); }, { kind: 'ghost' }),
            button('Delete', () => { delete draft.presets[n]; dirty(); redraw(); }, { kind: 'danger' })))),
        csNow && names.length ? field('Settings used in this chat', 'Applies right away to this chat only. Saved settings you just added can be chosen here after you press Save.',
            select([{ value: '', label: "The set's own settings" }, ...names.map(n => ({ value: n, label: n }))], inUse, (v) => { if (v) csNow.presets[name] = v; else delete csNow.presets[name]; saveChatState(); })) : null));

    // Try it
    const preview = h('div', { class: 'ri-preview' }, r.example || 'Press the button to see one example of what the AI would receive.');
    body.appendChild(section('Try it',
        h('div', { class: 'ri-row' }, button(cfg.example, () => {
            const rolled = rollEvent({ type: cfg.type, categories: draft.categories, neverTogether: draft.neverTogether }, r.exampleState || null);
            if (!rolled) { r.example = 'Nothing to roll yet. Turn on a category and give it at least one item.'; r.exampleState = null; }
            else if (!rolled.text) { r.example = 'For this reply no category is in use (resting, or left out by chance), so nothing would be sent.'; r.exampleState = rolled.state; }
            else { r.example = sub(wrapText(draft.sentAs, rolled.text, 0)); r.exampleState = rolled.state; }
            redraw();
        })),
        field('Exactly what the AI would receive', cfg.exampleHelp, preview)));

    body.appendChild(section('Notes', field('Notes for yourself', 'Never sent in the chat.', textArea(draft.notes, (v) => { draft.notes = v; dirty(); }, { rows: 2 }))));

    const save = async () => {
        const blocked = draft.categories.flatMap(c => c.items.filter(i => itemFlags(c, i.text).blocks.length).map(() => c.name));
        if (blocked.length) { toast('error', `${blocked.length} ${blocked.length === 1 ? 'item is' : 'items are'} empty (in ${[...new Set(blocked)].join(', ')}). Type something or delete ${blocked.length === 1 ? 'it' : 'them'} first.`); return; }
        const fixedMissing = draft.categories.find(c => c.on && c.mode === 'keepFixed' && !c.items.some(i => i.on && i.id === c.fixed));
        if (fixedMissing) { toast('info', `Choose the item to keep in "${fixedMissing.name}", or change how it changes.`); return; }
        try {
            const data = await loadSet(name);
            if (!data) throw new Error('The lorebook could not be read.');
            const existing = findEventEntry(data, cfg.type, name);
            if (existing) draft.uid = existing.uid;
            else if (data.entries[draft.uid]) draft.uid = freeUid(data);
            writeEvent(data, draft, name);
            await saveSet(name, data);
            r.dirty = false;
            const ready = draft.categories.some(c => c.on && c.items.some(i => i.on));
            toast('success', ready ? `${cfg.Set} saved.` : 'Saved. It has no items to pick yet, so it sends nothing.');
            go(app, { view: 'list' });
        } catch (e) { toast('error', `Could not save: ${e.message}`); }
    };
    body.appendChild(h('div', { class: 'ri-row ri-savebar' },
        button(`Save ${cfg.set}`, save, { kind: 'primary' }),
        button('Cancel', () => go(app, { view: 'list' }), { kind: 'ghost' })));
}
