import { promptGroup } from './prompts.js';
// Random Story Events tab and Random Writing Style tab. Both are a list of sets and an editor for one set:
// categories of items, with dice settings. They differ in wording and in when the order is sent.
import { h, button, toggle, select, choiceList, numberInput, textInput, textArea, field, section, versionText, chip, download } from './dom.js';
import { knownSets, loadSet, editSet, createSet, forgetSet, exportSet, setName, setInfo, wrapText, SENT_AS } from '../books.js';
import { keptIn, removeText, deleteButton } from './sets.js';
import { MODES, newEvent, newStyle, newCategory, newId, findEventEntry, readEvent, writeEvent, rollEvent, snapshotSettings, loadSettings, pairList } from '../events.js';
import { settings, saveSettings, chatState, saveChatState } from '../store.js';
import { validateVersion, swapNames, userDrives } from '../validate.js';
import { writeItems, rewriteAnywhere, itemContextPromptIds } from '../writer.js';
import { toast, confirmBox, inputBox, sub, isChatOpen } from '../st.js';
import { eventLeft, unburnSet } from '../engine.js';
import { contextField } from './context.js';
import { NEEDS } from '../pacing.js';
import { ORIGINS, originOf, STAKES, STAKES_NAME, listRole } from '../events.js';
import { enabledV10, effectiveModules } from '../v10.js';

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
const itemWriterPrompts = category => promptGroup(cfg.kind === 'style'
    ? ['styleWriterRules', 'systemStyleItems'] : ['eventWriterRules', ...itemContextPromptIds(category), 'systemItems'],
    'Customize Write with AI prompts', { contextual: true });

export function renderEvents(body, app) {
    cfg = EVENTS;
    if (app.eroute.view === 'edit') return renderEdit(body, app);
    if (enabledV10()) body.append(h('div',{class:'ri-note'},
        h('p',{},`Autonomous world events are ${effectiveModules().worldEvents ? 'on' : 'off'} for this chat. They offer optional developments independently of the event sets below.`),
        button('Change autonomous world events',()=>app.openSetting('v10','ri-module-worldEvents','chat'),{kind:'ghost'})));
    body.appendChild(promptGroup(['event', 'eventWriterRules', 'anywhere', 'situationRules', 'complicationRules', 'driverRules', 'toneRules', 'stakeRules', 'rewriteRules', 'systemItems', 'systemRewrite']));
    return renderList(body, app);
}
export function renderStyle(body, app) { cfg = STYLE; if (app.sroute.view !== 'edit') body.appendChild(promptGroup(['style', 'styleWriterRules', 'systemStyleItems'])); return app.sroute.view === 'edit' ? renderEdit(body, app) : renderList(body, app); }

const go = (app, route, c = cfg) => { app[c.route] = route; app.resetScroll = true; app.render(); app.root?.scrollIntoView?.({ block: 'start' }); };

function onForChat(name) {
    const cs = chatState();
    if (!cs) return h('span', { class: 'ri-muted' }, 'Open a chat to turn this on');
    const active = cs.activeSets.includes(name);
    const status = h('span',{},active ? 'On for this chat' : 'Off for this chat');
    return h('label', { class: 'ri-switch-row' }, status,
        toggle(active, (v) => {
            cs.activeSets = cs.activeSets.filter(n => n !== name);
            if (v) cs.activeSets.push(name);
            status.textContent=v ? 'On for this chat' : 'Off for this chat';
            saveChatState();
        }, `Turn ${setName(name)} on or off for this chat`));
}

async function openSet(app, name, {created=false} = {}) {
    const c = cfg;
    const data = await loadSet(name);
    const entry = findEventEntry(data, c.type, name);
    if (!entry) { toast('error', `This lorebook is not a ${c.set}.`); return; }
    go(app, { view: 'edit', name, draft: readEvent(entry, setName(name)), open: {}, created }, c);
}

// ---------- list of event sets ----------

function renderList(body, app) {
    const sets = knownSets(cfg.kind);
    body.appendChild(h('div', { class: 'ri-intro' }, cfg.intro));
    if (app[cfg.route].notice) body.append(h('p',{class:'ri-note',role:'status'},app[cfg.route].notice));
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
            await openSet(app, made,{created:true});
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
            // How much of each list that retires its items is left in the open chat.
            const left = c.kind !== 'style' && isChatOpen() ? eventLeft(setInfo(name).book, entry) : null;
            const leftRow = left && left.lists.length ? [
                kv('Left in this chat', left.lists.map(l => `${l.name}: ${l.left} of ${l.total}${l.main ? ' (main list)' : l.left === 0 ? ' (left out of events now)' : ''}`).join(', ')),
                left.usedUp ? h('div', { class: 'ri-note ri-note-warn' }, 'Used up in this chat: every item of the main list has happened, so this set sends no more events here.',
                    h('div', { class: 'ri-row ri-row-tight' }, button('Bring the used items back', () => { unburnSet(setInfo(name).book, entry); toast('success', `Every item of "${setName(name)}" can be picked again in this chat.`); app.render(); }, { kind: 'ghost', title: 'Earlier replies keep their record. From now on, items that already happened in this chat can be picked again.' }))) : null,
            ] : [];
            info.replaceChildren(
                kv('Categories turned on', on.length ? on.map(c => `${c.name} (${c.items.filter(i => i.on).length})`).join(', ') : 'none'),
                ...leftRow,
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
                deleteButton(app, name, `Delete ${c.set}`))));
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
    const durationFields = [];
    if (cat.mode === 'keepRandom') {
        const maximum = numberInput(cat.keepMax, { min:1, max:200, unit:tick }, n => {
            cat.keepMax = Math.max(cat.keepMin, n);
            dirty();
        });
        const maxInput = maximum.querySelector('input');
        maxInput.min = cat.keepMin;
        maxInput.addEventListener('blur', () => { maxInput.value = cat.keepMax; });
        const minimum = numberInput(cat.keepMin, { min:1, max:200, unit:tick }, n => {
            cat.keepMin = n;
            cat.keepMax = Math.max(cat.keepMax, n);
            maxInput.min = n;
            maxInput.value = cat.keepMax;
            dirty();
        });
        const minInput = minimum.querySelector('input');
        minInput.addEventListener('blur', () => { minInput.value = cat.keepMin; });
        durationFields.push(field(`Keep the pick for at least (${tick})`, '', minimum),
            field(`Keep the pick for at most (${tick})`, 'A number between the two is rolled each time.', maximum));
    }

    if (cat.locked) body.push(h('div', { class: 'ri-note ri-note-warn' }, 'This category is locked, so the point of view your preset sets is never changed by accident.',
        h('div', { class: 'ri-row ri-row-tight' }, button('Unlock this category', () => { cat.locked = false; dirty(); redraw(); }))));

    body.push(h('div', { class: 'ri-grid2' },
        field('Name of this category', tick === 'events' ? 'Shown to the AI in front of the picked item, for example "Complication: a locked door".' : 'Shown to the AI in front of the picked item, for example "Prose style: short sentences".', textInput(cat.name, (v) => { cat.name = v; dirty(); }, { placeholder: 'Example: Complication' })),
        cat.locked ? null : field('Use this category', tick === 'events' ? 'Off leaves it out of every event.' : 'Off leaves it out of the style order.', select([{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], cat.on ? 'on' : 'off', (v) => { cat.on = v === 'on'; dirty(); redraw(); }))));
    body.push(h('div', { class: 'ri-grid2' },
        field('How it changes', modeHelp[cat.mode], select(Object.keys(MODES).map(value => ({ value, label: modeLabel[value] })), cat.mode, (v) => { cat.mode = v; dirty(); redraw(); })),
        ...durationFields,
        cat.mode === 'keepRandom' ? field('Chance to change once that time is over (%)', `100 changes the pick as soon as the time is up. 30 lets it stay on a little longer: each of the following ${tick} it has a 30% chance to change.`, numberInput(cat.changeChance, { min: 1, max: 100, unit: '%' }, (n) => { cat.changeChance = n; dirty(); })) : null,
        cat.mode === 'keepFixed' ? field('Item to keep', tick === 'events' ? 'Every event uses this item.' : 'Every reply uses this item.', select([{ value: '', label: usable.length ? 'Choose an item' : 'Add an item first' }, ...usable.map(i => ({ value: i.id, label: i.text.slice(0, 70) }))], cat.fixed || '', (v) => { cat.fixed = v; dirty(); })) : null,
        cat.mode === 'keepFixed' ? null : field('Items per pick', tick === 'events' ? 'How many items from this category go into one event.' : 'How many items from this category are used at the same time.', numberInput(cat.count, { min: 1, max: 5, unit: 'items' }, (n) => { cat.count = n; dirty(); })),
        cat.mode === 'keepFixed' || cfg.kind === 'style' ? null : field('Retire an item once it has happened', 'On: an item from this list that has happened in a chat never comes back in that chat. The first list that retires its items is the main list (Situation, to start with): when it is used up, the set sends no more events in that chat and you are told so. Any other list that is used up is simply left out of the events that follow. With checking on, an item retires when the check finds the event happened. With checking off, it retires when it is sent.', select([{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], cat.burn ? 'on' : 'off', (v) => { cat.burn = v === 'on'; dirty(); })),
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
            // The edit works on a copy, so Cancel leaves the item as it was.
            const e = ui.edit && ui.edit.id === it.id ? ui.edit : (ui.edit = { id: it.id, text: it.text, from: originOf(it, cat), need: it.need || '', min: it.min || 0, dEvent: it.dEvent || '', dCheck: it.dCheck || '', dNext: it.dNext || '' });
            const box = textInput(e.text, (v) => { e.text = v; }, { 'aria-label': `Item text for ${cat.name}, item ${i + 1}` });
            const more = cfg.kind === 'style' ? [
                h('div', { class: 'ri-label' }, 'While this item is the pick (all three are optional)'),
                field('Added to every story event', 'One sentence that says how events are to go while this style is in use. Example for a tense style: "The event starts with no warning."', textInput(e.dEvent, (v) => { e.dEvent = v; }, { placeholder: 'Nothing is added' })),
                field('Question asked about the reply', 'Asked when the reply is checked anyway, and shown in What Was Sent. It makes no extra AI request, so it is skipped when nothing else is checked. Example: "Does the reply end on something happening?"', textInput(e.dCheck, (v) => { e.dCheck = v; }, { placeholder: 'No question' })),
                field('Note sent with the reply after it', 'Sent once with the next reply. Example: "What was set up in the last reply now happens."', textInput(e.dNext, (v) => { e.dNext = v; }, { placeholder: 'No note' })),
            ] : [
                field(cat.driver ? 'Where events driven by this come from' : 'Where this event comes from', cat.driver ? 'Items in the other lists that are marked with a place of origin are only used with a driver from the same place.' : 'Used only when the dice pick a driver from the same place. "Anyone or anything" fits every driver.', select(Object.entries(ORIGINS).map(([value, o]) => ({ value, label: o.label })), e.from, (v) => { e.from = v; })),
                h('div', { class: 'ri-grid2' },
                    field('Use this item only when', e.need ? NEEDS[e.need].help : 'An item can wait for something in this chat\'s story world. While it is missing, the dice leave the item out.',
                        select(Object.entries(NEEDS).map(([value, n]) => ({ value, label: n.label })), e.need, (v) => { e.need = v; redraw(); })),
                    field('Characters in the scene, at least', '0 uses the item with any number. The count is read from the scene header, the HUD or a "Present:" line of the newest reply, and leaves {{user}} out.',
                        numberInput(e.min, { min: 0, max: 20, unit: 'present' }, (n) => { e.min = n; }))),
            ];
            list.appendChild(h('div', { class: 'ri-version ri-version-editing' }, box, more, h('div', { class: 'ri-row ri-row-tight' },
                button('Done', () => {
                    if (e.text.trim()) {
                        it.text = e.text.trim();
                        for (const k of ['from', 'need', 'min', 'dEvent', 'dCheck', 'dNext']) { const v = typeof e[k] === 'string' ? e[k].trim() : e[k]; if (v) it[k] = v; else delete it[k]; }
                        dirty();
                    }
                    ui.editing = ''; ui.edit = null; redraw();
                }, { kind: 'primary' }),
                button('Cancel', () => { ui.editing = ''; ui.edit = null; redraw(); }, { kind: 'ghost' }))));
            return;
        }
        const tick = h('input', { type: 'checkbox', class: 'ri-check', checked: it.on, title: 'Tick to let the dice use this item', onchange: () => { it.on = tick.checked; dirty(); } });
        list.appendChild(h('div', { class: `ri-version ${flags.blocks.length ? 'ri-version-blocked' : flags.checks.length ? 'ri-version-flagged' : ''}` },
            h('label', { class: 'ri-vpick' }, tick, h('span', { class: 'ri-vbody' }, versionText(it.text))),
            flags.node,
            (it.from || it.need || it.min || it.dEvent || it.dCheck || it.dNext) ? h('div', { class: 'ri-chips' },
                it.from ? chip(`Comes from: ${ORIGINS[it.from].label}`, 'ri-chip-group') : null,
                it.need ? chip(`Only when: ${NEEDS[it.need].label.toLowerCase()}`, 'ri-chip-group') : null,
                it.min ? chip(`Only with ${it.min} or more characters in the scene`, 'ri-chip-group') : null,
                it.dEvent ? chip(`Added to story events: ${it.dEvent}`) : null,
                it.dCheck ? chip(`Question about the reply: ${it.dCheck}`) : null,
                it.dNext ? chip(`Note for the reply after: ${it.dNext}`) : null) : null,
            h('div', { class: 'ri-row ri-row-tight' },
                h('label', { class: 'ri-num' }, h('span', { class: 'ri-unit' }, 'Weight'), numberInput(it.weight, { min: 1, max: 20, label:`Weight for ${it.text}` }, (n) => { it.weight = n; dirty(); })),
                h('label', { class: 'ri-num' }, h('span', { class: 'ri-unit' }, 'Tags'), textInput(it.tags, (v) => { it.tags = v; dirty(); }, { 'aria-label':`Tags for ${it.text}`, placeholder: 'none', style: { width: '120px' } })),
                button(it.always ? 'Always included' : 'Always include', () => { it.always = !it.always; dirty(); redraw(); }, { kind: 'ghost', title: 'An always-included item is in every fresh pick; the dice fill the rest' }),
                button('Edit', () => { ui.editing = it.id; ui.edit = null; redraw(); }, { kind: 'ghost', title: cfg.kind === 'style' ? 'Change the text, and what this item adds while it is the pick' : 'Change the text, and when the dice may use this item' }),
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
        cfg.kind === 'events' && cat.items.length ? button('Make these work anywhere', () => { ui.rw = { busy: false, error: '', results: null, which: 'on' }; ui.ai = null; redraw(); }, { title: 'One AI request rewrites the items of this list so each works in any setting, keeping what it does to the people. You see every change before it is made.' }) : null,
        button('Write items with AI', () => { ui.rw = null; ui.ai = { theme: app[cfg.route].lastTheme || '', count: 12, busy: false, error: '', results: null }; redraw(); }, { kind: 'primary' })));

    if (!ui.ai) body.push(itemWriterPrompts(cat));
    if (ui.ai) body.push(aiBox(app, draft, cat, ui, redraw, dirty));
    if (ui.rw) body.push(rewriteBox(draft, cat, ui, redraw, dirty));

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

function rewriteBox(draft, cat, ui, redraw, dirty) {
    const rw = ui.rw;
    const box = h('div', { class: 'ri-sheet-box' }, h('div', { class: 'ri-h2' }, `Make the items of "${cat.name}" work anywhere`));
    const pool = () => cat.items.filter(it => rw.which === 'all' || it.on);
    if (!rw.results) {
        box.append(
            promptGroup(['rewriteRules', ...itemContextPromptIds(cat), 'systemRewrite'], 'Customize rewrite prompts', { contextual: true }),
            h('div', { class: 'ri-help' }, 'One AI request rewrites each item so that it makes sense wherever the scene is when it fires, and keeps what it does to the people. Items that already work anywhere come back as they were. Nothing changes until you choose.'),
            field('Which items', '', select([{ value: 'on', label: `The items that are on (${cat.items.filter(i => i.on).length})` }, { value: 'all', label: `Every item (${cat.items.length})` }], rw.which, (v) => { rw.which = v; redraw(); })));
        if (rw.error) box.appendChild(h('div', { class: 'ri-note ri-note-warn' }, rw.error));
        box.appendChild(h('div', { class: 'ri-row' },
            button(rw.busy ? 'Rewriting...' : 'Rewrite the items', async () => {
                if (rw.busy) return;
                const items = pool().slice(0, 60);
                if (!items.length) { rw.error = 'There are no items to rewrite.'; redraw(); return; }
                rw.busy = true; rw.error = ''; redraw();
                try { rw.results = (await rewriteAnywhere({ category: cat, items, others: draft.categories.filter(c => c !== cat && c.on).map(c => c.name) })).map(x => ({ ...x, keep: x.changed })); }
                catch (e) { rw.error = e.message; }
                rw.busy = false; redraw();
            }, { kind: 'primary', disabled: rw.busy }),
            button('Cancel', () => { ui.rw = null; redraw(); }, { kind: 'ghost', disabled: rw.busy })));
        return box;
    }
    const changed = rw.results.filter(x => x.changed);
    box.appendChild(h('div', { class: 'ri-help' }, changed.length ? `${changed.length} of ${rw.results.length} items were rewritten. Tick the rewrites to keep. An item keeps its weight, tags, marks and history.` : 'Every item already works anywhere, by the AI\'s judgment. Nothing needs to change.'));
    const list = h('div', { class: 'ri-versions' });
    for (const x of changed) {
        const tick = h('input', { type: 'checkbox', class: 'ri-check', checked: x.keep, onchange: () => { x.keep = tick.checked; } });
        list.appendChild(h('div', { class: 'ri-version' }, h('label', { class: 'ri-vpick' }, tick, h('span', { class: 'ri-vbody' },
            h('div', { class: 'ri-muted' }, 'Was: ', versionText(x.was)), h('div', {}, 'Now: ', versionText(x.text)))), itemFlags(cat, x.text).node));
    }
    box.append(list, h('div', { class: 'ri-row' },
        changed.length ? button('Use the ticked rewrites', () => {
            let n = 0;
            for (const x of changed) { if (!x.keep) continue; const it = cat.items.find(i => i.id === x.id); if (it) { it.text = x.text; n++; } }
            toast(n ? 'success' : 'info', n ? `${n} ${n === 1 ? 'item was' : 'items were'} rewritten. Press Save to keep the change.` : 'Nothing was ticked, so nothing changed.');
            ui.rw = null; if (n) dirty(); redraw();
        }, { kind: 'primary' }) : null,
        button(changed.length ? 'Cancel' : 'Close', () => { ui.rw = null; redraw(); }, { kind: 'ghost' })));
    return box;
}

function aiBox(app, draft, cat, ui, redraw, dirty) {
    const ai = ui.ai;
    const box = h('div', { class: 'ri-sheet-box' }, h('div', { class: 'ri-h2' }, `Write items for "${cat.name}" with AI`));
    if (!ai.results) {
        box.append(
            itemWriterPrompts(cat),
            field(cfg.themeLabel, cfg.themeHelp, textInput(ai.theme, (v) => { ai.theme = v; }, { placeholder: cfg.themePlaceholder })),
            h('div', { class: 'ri-grid2' },
                field('How many items to write', '', numberInput(ai.count, { min: 1, max: 40, unit: 'items' }, (n) => { ai.count = n; })),
                contextField()),
            cfg.kind === 'events' ? field('Let the AI read where the story is now', settings().writer.eventScene ? 'On: the recent messages and the story so far are shown too, when ticked above. Items can then lean toward the scene you are in.' : 'Off: the AI only reads the card, the scenario and your persona (when ticked above), so items fit your kind of story and work wherever the scene is when they fire.', select([{ value: 'off', label: 'Off (recommended)' }, { value: 'on', label: 'On' }], settings().writer.eventScene ? 'on' : 'off', (v) => { settings().writer.eventScene = v === 'on'; saveSettings(); redraw(); })) : null,
            cfg.kind === 'events' ? field('Where these events come from', 'Tick the allowed origins. The writer draws one for each item. Event rolls use the saved origin to match items to the driver.', choiceList('Event origins', ORIGINS, ai.origins || [''], values => { ai.origins = values; })) : null);
        if (ai.error) box.appendChild(h('div', { class: 'ri-note ri-note-warn' }, ai.error));
        box.appendChild(h('div', { class: 'ri-row' },
            button(ai.busy ? 'Writing...' : 'Write the items', async () => {
                if (ai.busy) return;
                if (!ai.theme.trim()) { ai.error = 'Type a few words in the first box.'; redraw(); return; }
                ai.busy = true; ai.error = ''; redraw();
                app[cfg.route].lastTheme = ai.theme;
                try {
                    const list = await writeItems({ style: cfg.kind === 'style', origins: ai.origins || [''], category: cat, theme: ai.theme.trim(), count: ai.count, context: settings().writer.context, existing: cat.items.map(i => i.text), others: draft.categories.filter(c => c !== cat && c.on).map(c => c.name) });
                    ai.results = list.map(x => ({ ...x, keep: x.anywhere !== false && (f => f.blocks.length === 0 && f.checks.length === 0)(itemFlags(cat, x.text)) }));
                } catch (e) { ai.error = e.message; }
                ai.busy = false; redraw();
            }, { kind: 'primary', disabled: ai.busy }),
            button('Cancel', () => { ui.ai = null; redraw(); }, { kind: 'ghost', disabled: ai.busy })));
        return box;
    }
    box.appendChild(h('div', { class: 'ri-help' }, 'Tick the items to add. Everything the AI wrote is shown here; nothing is added until you press the button. An item marked "Check" starts unticked: tick it if it reads right to you.'));
    if (ai.results.some(x => x.anywhere === false)) box.appendChild(h('div', { class: 'ri-note' }, `${ai.results.filter(x => x.anywhere === false).length} of ${ai.results.length} items need a particular setting, by the AI's own judgment.`));
    const list = h('div', { class: 'ri-versions' });
    ai.results.forEach((x) => {
        const flags = itemFlags(cat, x.text);
        if (flags.blocks.length) x.keep = false;
        const tick = h('input', { type: 'checkbox', class: 'ri-check', checked: x.keep, disabled: flags.blocks.length > 0, onchange: () => { x.keep = tick.checked; } });
        const placeBound = x.anywhere === false ? h('div', { class: 'ri-flags' }, h('div', { class: 'ri-flag ri-flag-check' }, 'Check: the AI says this item needs a particular place, object or group, so it may not fit wherever the scene is when it fires. It starts unticked. Tick it if it reads right to you.')) : null;
        list.appendChild(h('div', { class: `ri-version ${flags.blocks.length ? 'ri-version-blocked' : (flags.checks.length || placeBound) ? 'ri-version-flagged' : ''}` }, h('label', { class: 'ri-vpick' }, tick, h('span', { class: 'ri-vbody' }, versionText(x.text))), cfg.kind === 'events' ? chip(ORIGINS[x.from].label, 'ri-chip-group') : null, flags.node, placeBound));
    });
    box.append(list, h('div', { class: 'ri-row' },
        button('Add the ticked items', () => {
            const picked = ai.results.filter(x => x.keep);
            if (!picked.length) { toast('info', 'Tick at least one item to add.'); return; }
            cat.items.push(...picked.map(x => ({ id: newId(), text: x.text, on: true, weight: 1, tags: '', always: false, ...(x.from ? { from: x.from } : {}) })));
            ui.ai = null; dirty(); redraw();
        }, { kind: 'primary' }),
        button('Write more', () => { ai.results = null; redraw(); }, { kind: 'ghost' }),
        button('Cancel', () => { ui.ai = null; redraw(); }, { kind: 'ghost' })));
    return box;
}

function renderEdit(body, app) {
    const c = cfg;
    const r = app[c.route];
    const { name, draft } = r;
    const redraw = () => app.render();
    const dirty = () => { r.dirty = true; };

    body.appendChild(h('div', { class: 'ri-row' }, button(`‹ Back to ${cfg.sets}`, async () => {
        if (r.dirty && !await confirmBox(`Leave without saving your changes to this ${cfg.set}?`)) return;
        go(app, { view: 'list' });
    }, { kind: 'ghost' })));
    body.appendChild(h('div', { class: 'ri-card ri-setcard' }, h('div', { class: 'ri-card-top' }, h('div', { class: 'ri-h2' }, name), onForChat(name))));
    if (r.created) body.append(h('p',{class:'ri-note',role:'status'},`${c.Set} created. Save any changes you make below.`));

    if (cfg.kind === 'style') body.appendChild(section('When it is sent',
        h('div', { class: 'ri-help' }, 'With every reply, while this set is on for the chat. Each category below decides for itself how long its pick lasts. Writing style is sent as a style order and is not checked afterwards.'),
        field('Sent as', SENT_AS[draft.sentAs].help, select([{ value: 'system', label: SENT_AS.system.label }, { value: 'ooc', label: SENT_AS.ooc.label }], draft.sentAs, (v) => { draft.sentAs = v; dirty(); redraw(); }))));
    else body.appendChild(section('When an event happens',
        h('div', { class: 'ri-grid2' },
            field('Chance of an event each reply (%)', '10 gives an event about once in 10 replies. Big story moments feel right at 2 to 10.', numberInput(draft.chance, { min: 0, max: 100, unit: '%' }, (n) => { draft.chance = n; dirty(); })),
            field('Wait after an event (replies)', 'After an event, no new event from this set for this many replies.', numberInput(draft.wait, { min: 0, max: 500, unit: 'replies' }, (n) => { draft.wait = n; dirty(); })),
            field('Keep sending the event for (replies)', 'The same event order is sent again with this many more replies. 0 sends it once.', numberInput(draft.keep, { min: 0, max: 50, unit: 'replies' }, (n) => { draft.keep = n; dirty(); })),
            field('No events before reply number', '0 lets events happen from the start of the chat.', numberInput(draft.notBefore, { min: 0, max: 1000, unit: '' }, (n) => { draft.notBefore = n; dirty(); })),
            field('Events from this set are big', settings().pace.quiet ? `On: after one has happened, nothing new starts for ${settings().pace.quiet} ${settings().pace.quiet === 1 ? 'reply' : 'replies'}, across every set (the number is in Settings, under Pacing). The story gets room to take the event in.` : 'On: after one has happened, nothing new starts for a number of replies. That number is 0 right now, so this does nothing until you set it in Settings, under Pacing.', select([{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], draft.big ? 'on' : 'off', (v) => { draft.big = v === 'on'; dirty(); })),
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
        }),
        cfg.kind === 'events' && !draft.categories.some(c => listRole(c) === 'stake') ? button(`Add the list "${STAKES_NAME}"`, () => {
            const cat = newCategory(STAKES_NAME, STAKES);
            const at = draft.categories.findIndex(c => c.driver);
            draft.categories.splice(at < 0 ? draft.categories.length : at, 0, cat); r.open[cat.id] = true; dirty(); redraw();
        }, { title: 'A list of what an event puts at stake and for whom. It starts with ten items that work in any setting. The dice pick one with every event.' }) : null)));

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
        field('Exactly what the AI would receive', cfg.exampleHelp, preview),
        promptGroup([cfg.kind === 'style' ? 'style' : 'event'], 'Customize in-chat wording', {
            contextual: true,
            onChange: () => {
                if (!r.example) return;
                preview.textContent = 'Roll an example to preview the current wording.';
                delete r.example;
            },
        })));

    body.appendChild(section('Notes', field('Notes for yourself', 'Never sent in the chat.', textArea(draft.notes, (v) => { draft.notes = v; dirty(); }, { rows: 2 }))));

    const save = async () => {
        const blocked = draft.categories.flatMap(c => c.items.filter(i => itemFlags(c, i.text).blocks.length).map(() => c.name));
        if (blocked.length) { toast('error', `${blocked.length} ${blocked.length === 1 ? 'item is' : 'items are'} empty (in ${[...new Set(blocked)].join(', ')}). Type something or delete ${blocked.length === 1 ? 'it' : 'them'} first.`); return; }
        const fixedMissing = draft.categories.find(c => c.on && c.mode === 'keepFixed' && !c.items.some(i => i.on && i.id === c.fixed));
        if (fixedMissing) { toast('info', `Choose the item to keep in "${fixedMissing.name}", or change how it changes.`); return; }
        try {
            await editSet(name, data => {
                const existing = findEventEntry(data, c.type, name);
                if (!existing) throw new Error(`This ${c.set} has been deleted.`);
                draft.uid = existing.uid;
                writeEvent(data, draft, name);
            });
            r.dirty = false;
            const ready = draft.categories.some(c => c.on && c.items.some(i => i.on));
            go(app, {view:'list',notice:ready ? `${c.Set} saved.` : 'Saved. It has no items to pick yet, so it sends nothing.'},c);
        } catch (e) { toast('error', `Could not save: ${e.message}`); }
    };
    body.appendChild(h('div', { class: 'ri-row ri-savebar' },
        button(`Save ${cfg.set}`, save, { kind: 'primary' }),
        button('Back to sets', async () => {
            if (r.dirty && !await confirmBox('Discard unsaved changes to this set?')) return;
            go(app, { view: 'list' }, c);
        }, { kind: 'ghost' }),
        deleteButton(app, name, `Delete ${c.set}`, () => {
            if (app[c.route] === r) go(app, { view: 'list' }, c);
            else app.render();
        })));
}
