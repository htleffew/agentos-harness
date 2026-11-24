import { memoryComponents } from '../components.js';
import { slot, home, homeLink } from './homes.js';
import { refreshUnderReplies } from './sent.js';
// Story World tab: the people, places, groups, secrets, open threads, planted details and things going on
// elsewhere of one story, and how they are sent as story notes.
import { h, button, toggle, select, numberInput, textInput, textArea, field, section, chip } from './dom.js';
import { settings, saveSettings, chatState } from '../store.js';
import { setInfo, setName } from '../books.js';
import { setChatWorld, knownWorlds } from '../world.js';
import { WORLD_KINDS, KIND_ORDER, isStructuredWorldKind, MAX_ACTIVITIES, chatWorld, entries } from '../records.js';
import { toast, confirmBox, isChatOpen } from '../st.js';
import { contextField } from './context.js';
import { keptIn } from './sets.js';
import { draftNewChapter, startNewChapter, draftStarterWorld, addStarterWorld, otherSummaryOn, writeChapterNow, chapterBusy } from '../chapters.js';
import { burnedSoFar } from '../engine.js';

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
        id && chatState()?.worldFrom && knownWorlds().includes(chatState().worldFrom) && chatState().worldFrom !== id ? h('div', { class: 'ri-note' }, `This chat uses its own copy of "${setName(chatState().worldFrom)}". What happens here changes only the copy. To share the original world with the chat this came from, choose "${setName(chatState().worldFrom)}" above. Replies written before that keep pointing at the copy.`) : null,
        homeLink(app, ['world-create','world-export','world-delete'], 'Create, export or delete the Story World in World Info, Story World.'),
        id ? h('div', { class: 'ri-row' }, button('Fill this world from the character card', () => { app.wroute.sheet = { kind: 'starter', busy: false, error: '', result: null }; app.render(); },
            { title: 'One AI request reads the character card, its own lorebook and the opening message, and proposes entries. Nothing is added until you say so.' })) : null);
}

/** Write a chapter now. Its one home is Story, Story World, The story so far. */
export function writeChapterControl(onSaved = () => {}) {
    const status = h('p', { class: 'ri-help', role: 'status' });
    const action = executionAction(button('Write a chapter now', async () => {
        action.disabled = true;
        status.textContent = 'Writing the chapter…';
        try {
            const name = await writeChapterNow();
            status.textContent = `Saved “${name}” to Story World.`;
            refreshUnderReplies();
            onSaved();
        } catch (error) { status.textContent = error.message; }
        finally {
            action.disabled = false;
            receipt.replaceChildren(functionExecution('chapterSummary', { receipt: executionReceipt('chapterSummary') }));
        }
    }, { kind: 'primary', disabled: chapterBusy() }));
    const receipt = h('div', {}, functionExecution('chapterSummary', { receipt: executionReceipt('chapterSummary') }));
    return home('write-chapter', h('div', {}, action, status, receipt));
}

// ---------- the story so far, and a new chapter ----------

function summarySection(app, id) {
    const components = memoryComponents();
    const section_ = section('The story so far',
        otherSummaryOn() && components.chapters && h('p', { class: 'ri-note ri-note-warn' },
            'SillyTavern’s own Summarize is also adding a summary to the prompt in this chat. Choose which summary source to use.'),
        h('p', { class: 'ri-help' }, 'Chapters and the condensed account of this story. Chapter schedules and history windows are set in Setup, Memory.'),
        homeLink(app, 'catch-up', 'Catch up and rebuild a chat in Setup, Memory.'),
        id ? components.chapters && writeChapterControl(() => app.render())
            : h('div', { class: 'ri-muted' }, 'Choose or create a Story World to store chapters.'),
        home('new-chapter', h('div', { id: 'ri-new-chapter' },
            h('div', { class: 'ri-label' }, 'Continue in a new chat'),
            h('div', { class: 'ri-help' }, 'When a chat has grown long, carry the story into a brand new chat. One AI request writes a very detailed summary and a first message, which you can change. The new chat has its own Story World book with the approved summary and a copy of this world’s records. The active reusable books, sets, goal and pronouns carry forward.'),
            h('div', { class: 'ri-row' }, button('Start a new chapter in a new chat', () => { app.wroute.sheet = { kind: 'chapter', wish: '', busy: false, error: '', draft: null }; app.render(); }, { kind: 'primary' })))));
    section_.id = 'ri-story-so-far';
    return section_;
}

function starterSheet(app) {
    const sh = app.wroute.sheet;
    const close = () => { app.wroute.sheet = null; app.render(); };
    const box = h('div', { class: 'ri-sheet-box' }, h('div', { class: 'ri-h2' }, 'Fill this world from the character card'));
    if (!sh.result) {
        box.append(h('div', { class: 'ri-help' }, 'One AI request reads the character card (description, personality, scenario), your persona, the card\'s own lorebook and the opening message of this chat, including a different greeting if you swiped to one. It proposes people, places, groups, open threads, secrets and planted details. You see them before anything is added.'));
        if (sh.error) box.appendChild(h('div', { class: 'ri-note ri-note-warn' }, sh.error));
        box.appendChild(h('div', { class: 'ri-row' },
            button(sh.busy ? 'Reading the card...' : 'Read the card and propose entries', async () => {
                if (sh.busy) return;
                sh.busy = true; sh.error = ''; app.render();
                try { sh.result = await draftStarterWorld(); sh.keep = sh.result.ops.map(() => true); } catch (e) { sh.error = e.message; }
                sh.busy = false; app.render();
            }, { kind: 'primary', disabled: sh.busy }),
            button('Cancel', close, { kind: 'ghost', disabled: sh.busy })));
        return box;
    }
    box.append(h('div', { class: 'ri-help' }, 'Untick what you do not want. Lines about someone who is already in this world update that entry. Everything added is marked "Added automatically" until you save it yourself.'),
        h('div', { class: 'ri-versions' }, sh.result.lines.map((line, i) => {
            const tick = h('input', { type: 'checkbox', class: 'ri-check', checked: sh.keep[i], onchange: () => { sh.keep[i] = tick.checked; } });
            return h('label', { class: 'ri-version ri-vpick' }, tick, h('span', { class: 'ri-vbody' }, line));
        })),
        h('div', { class: 'ri-row' },
            button('Add the ticked lines to the world', async () => {
                const ops = sh.result.ops.filter((_, i) => sh.keep[i]);
                const added = await addStarterWorld(ops);
                toast(added.length ? 'success' : 'info', added.length ? `${added.length} ${added.length === 1 ? 'change was' : 'changes were'} made to the world.` : 'Nothing new was added: everything was already in the world.');
                close();
            }, { kind: 'primary' }),
            button('Read the card again', () => { sh.result = null; app.render(); }, { kind: 'ghost' }),
            button('Cancel', close, { kind: 'ghost' })));
    return box;
}

function chapterSheet(app) {
    const sh = app.wroute.sheet;
    const close = () => { app.wroute.sheet = null; app.render(); };
    const box = h('div', { class: 'ri-sheet-box' }, h('div', { class: 'ri-h2' }, 'A new chapter in a new chat'));
    if (!sh.draft) {
        box.append(
            h('div', { class: 'ri-help' }, 'One AI request writes two things from the story so far: a very detailed summary, and the first message of the new chat. You can change both before the new chat is made.'),
            field('What you want for the new chapter (you can leave this empty)', 'For example: "the next morning, on the ship" or "a week later". Left empty, the story carries on from where it stands.',
                textInput(sh.wish, (v) => { sh.wish = v; }, { placeholder: 'Carry on from where the story stands' })));
        if (sh.error) box.appendChild(h('div', { class: 'ri-note ri-note-warn' }, sh.error));
        box.appendChild(h('div', { class: 'ri-row' },
            button(sh.busy ? 'Writing...' : 'Write the summary and the first message', async () => {
                if (sh.busy) return;
                sh.busy = true; sh.error = ''; app.render();
                try { sh.draft = await draftNewChapter(sh.wish); } catch (e) { sh.error = e.message; }
                sh.busy = false; app.render();
            }, { kind: 'primary', disabled: sh.busy }),
            button('Cancel', close, { kind: 'ghost', disabled: sh.busy })));
        return box;
    }
    const scene = sh.draft.scene ||= {};
    const recall = sh.draft.activation ||= {mode:'window',window:6};
    const recallMode = select([{value:'window',label:'Initial window, then triggers'},
        {value:'always',label:'Always eligible'},{value:'triggered',label:'Triggers only'},{value:'off',label:'Off'}],
        recall.mode,value=>{recall.mode=value;});

    box.append(
        field('Summary of the story so far', 'Saved in the new chat’s Story World as “The story before this chat” and recalled when Chapter summaries is on.',
            textArea(sh.draft.summary, (v) => { sh.draft.summary = v; }, { rows: 12 })),
        field('First message of the new chat', 'It takes the place of the character\'s greeting in the new chat.', textArea(sh.draft.first, (v) => { sh.draft.first = v; }, { rows: 10 })),
        h('div',{class:'ri-grid2'},[['time','Opening time'],['date','Opening date'],['where','Opening location'],['weather','Opening weather']].map(([key,label])=>
            field(label,'',textInput(scene[key] || '',value=>{scene[key]=value;},{'aria-label':label})))),
        field('Carryover summary recall','Trigger phrases default to the opening location and cast. Edit these in Reusable Lorebooks.',recallMode,
            numberInput(recall.window,{min:0,max:200,unit:'initial replies'},value=>{recall.window=value;})),
        h('div', { class: 'ri-help' }, 'The new chat brings along: the story world, the sets that are on, the goal with the steps already done, the pronouns, locked picks, and what has already happened for good ("only once" instructions and retired story event items). The chat you are in stays exactly as it is, and you can go back to it.'));
    if (sh.error) box.appendChild(h('div', { class: 'ri-note ri-note-warn' }, sh.error));
    box.appendChild(h('div', { class: 'ri-row' },
        button(sh.busy ? 'Starting the new chat...' : 'Start the new chat', async () => {
            if (sh.busy) return;
            sh.busy = true; sh.error = ''; app.render();
            try {
                await startNewChapter(sh.draft, burnedSoFar);
                app.wroute = { view: 'list' };
                toast('success', 'The new chat is open. The chat you were in is unchanged.');
            } catch (e) { sh.error = e.message; sh.busy = false; }
            app.render();
        }, { kind: 'primary', disabled: sh.busy }),
        button('Write them again', () => { sh.draft = null; app.render(); }, { kind: 'ghost', disabled: sh.busy }),
        button('Cancel', close, { kind: 'ghost', disabled: sh.busy })));
    return box;
}

function oneLine(w) {
    const text = entries.text(w, { full: false });
    return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}

function renderList(body, app) {
    // A sheet (the starter world, or a new chapter) takes the whole tab while it is open.
    if (app.wroute.sheet) { body.appendChild(app.wroute.sheet.kind === 'starter' ? starterSheet(app) : chapterSheet(app)); return; }
    const id = chatWorld();
    body.appendChild(worldPicker(app));
    body.appendChild(slot(['entryWriterRules', 'systemWorldEntry', 'starterWorld', 'systemStarter'], 'Customize world-writing instructions'));
    body.appendChild(slot(['chapterSummary', 'systemChapter', 'chapterCombine', 'systemCombine', 'newChapterSummary', 'newChapterFirst', 'systemNewChapter','chapterOpeningScene'], 'Customize chapter instructions'));
    if (!id) { body.appendChild(summarySection(app, '')); return; }
    const listBox = h('div', {}, h('div', { class: 'ri-muted' }, 'Loading...'));
    home('world-entries', listBox);
    listBox.id = 'ri-world-entries';
    body.appendChild(listBox);
    body.appendChild(homeLink(app, 'next-preview', 'What would be sent with the next reply is shown in Review, Context.'));
    body.appendChild(homeLink(app, 'world-budget', 'How story notes are sent (room, placement, messages read for names) is set in Setup, Memory.'));
    body.appendChild(homeLink(app, 'world-update', 'Keeping the world up to date from each reply is set in Setup, Memory.'));
    body.appendChild(homeLink(app, 'world-orders', 'World orders (what can be ordered into the scene) are set in Direction, Random sets.'));
    body.appendChild(summarySection(app, id));

    entries.load(id).then(async (data) => {
        if (!data) { listBox.replaceChildren(h('div', { class: 'ri-empty' }, 'The lorebook of this world could not be read. It may have been renamed or deleted.')); return; }
        const list = entries.list(data, id);
        const out = [];
        // In the tab the chapters come last.
        for (const kind of [...KIND_ORDER.filter(k => k !== 'chapter' && !isStructuredWorldKind(k)), 'chapter']) {
            const def = WORLD_KINDS[kind];
            const mine = list.filter(w => w.kind === kind);
            const rows = mine.map(w => h('div', { class: `ri-card ri-inscard ${w.on ? '' : 'ri-off'}` },
                h('div', { class: 'ri-card-top' },
                    h('button', { type: 'button', class: 'ri-card-name', onclick: () => go(app, { view: 'edit', draft: structuredClone(w) }) }, w.name || def.label),
                    h('label', { class: 'ri-switch-row' }, h('span', {}, w.on ? 'On' : 'Off'),
                        toggle(w.on, async (v) => { data.entries[w.uid].disable = !v; await entries.save(id, data); app.render(); }, `Turn ${w.name} on or off`))),
                h('div', { class: 'ri-world-line' }, oneLine(w)),
                h('div', { class: 'ri-chips' },
                    def.steps ? chip(def.steps.find(s => s[0] === w.status)?.[1] || '', 'ri-chip-group') : null,
                    w.kind === 'secret' && w.status === 'kept' ? chip(w.show === 'full' ? 'The AI is shown the whole secret' : 'The AI is shown one line only') : null,
                    w.kind === 'chapter' && w.rollup ? chip('Everything before the newer chapters', 'ri-chip-group') : null,
                    w.kind === 'chapter' && !w.rollup && w.span ? chip(`Replies ${w.span.from} to ${w.span.to}`) : null,
                    w.auto ? chip('Added automatically', 'ri-chip-wait') : null,
                    w.locked ? chip('Kept as you wrote it', 'ri-chip-keep') : null,
                    w.aliases.length ? chip(`Also called: ${w.aliases.join(', ')}`) : null)));
            const group = section(`${def.plural} (${mine.length})`,
                rows.length ? h('div', { class: 'ri-list' }, rows) : h('div', { class: 'ri-muted' }, EMPTY[kind]),
                h('div', { class: 'ri-row' }, button(def.add, () => go(app, { view: 'edit', draft: entries.blank(data, kind) }), { kind: mine.length || kind === 'chapter' ? '' : 'primary' })));
            group.dataset.worldSection = kind;
            out.push(group);
        }
        listBox.replaceChildren(...out);
    }).catch((e) => listBox.replaceChildren(h('div', { class: 'ri-empty' }, `This world could not be read: ${e.message}`)));
}

const kv = (k, v) => h('div', { class: 'ri-kv' }, h('span', { class: 'ri-k' }, k), h('span', { class: 'ri-v' }, v));

const EMPTY = {
    chapter: 'No chapters yet. A chapter is a short account of a stretch of the story. Chapters are written for you as you play (see "Keeping the story so far" below), or you can add one by hand.',
    character: 'No characters yet. Add the people of this story: who they are, what they want, what they know.',
    place: 'No places yet.',
    faction: 'No groups yet.',
    thread: 'No open threads yet. Open threads can be recalled when tied to the scene or mentioned in recent messages.',
    secret: 'No secrets yet. A secret is sent when its keeper is in the scene. While it is kept, the AI can be shown one line only.',
    seed: 'No planted details yet. A planted detail is something small the story showed that can matter later.',
    activity: `Nothing yet. By default, story notes recall up to ${MAX_ACTIVITIES} off-screen activities relevant to the current scene or recent messages.`,
};

/** How story notes are sent. Its one home is Setup, Memory (Recall). The room for story notes sits with the budgets. */
export function storyNotesFields(app) {
    const o = settings().world;
    const save = () => { saveSettings(); app.render(); };
    return [
        field('Where the notes are placed', o.place === 'depth' ? 'In the chat, above your last message. Works with every preset. A chat whose memory lives in chat data sends recall instead of these notes.' : 'With the World Info entries of the preset. The preset must have that World Info marker, or the notes are dropped.',
            select([{ value: 'depth', label: 'In the chat, above your last message' }, { value: 'after', label: 'With the World Info entries after the character' }, { value: 'before', label: 'With the World Info entries before the character' }], o.place, (v) => { o.place = v; save(); })),
        o.place === 'depth' ? field('How many messages up', '0 is the very end of the chat, 1 is above your last message. A deeper place costs the prompt cache more messages each turn.', numberInput(Math.min(1, Number(o.depth ?? 1)), { min: 0, max: 1, unit: 'messages' }, (n) => { o.depth = n; save(); })) : null,
        field('Messages read for names', 'When the reply has no scene header or HUD, people named in this many recent messages count as present. Other entries named there are added while room is left.',
            numberInput(o.lookback, { min: 1, max: 20, unit: 'messages' }, (n) => { o.lookback = n; save(); })),
    ];
}

/** Room for story notes. Its one home is Setup, Memory (Budgets). */
export function storyNotesBudget(app) {
    const o = settings().world;
    return home('world-budget', field('Room for story notes (tokens)', 'Estimated budget for the scene, explicit activations and relevant story entries. Chapters have a separate budget.',
        numberInput(o.budget, { min: 100, max: 4000, unit: 'tokens', label: 'Room for story notes' }, (n) => { o.budget = n; saveSettings(); })));
}

/** Keeping the world up to date and branch copies. Its one home is Setup, Memory (Upkeep). */
export function worldUpkeepFields(app) {
    const o = settings().world;
    const save = () => { saveSettings(); app.render(); };
    const UPDATE_HELP = {
        all: 'With each reply the AI adds a short block that records what the reply made true. The extension takes the block out of the reply and files it here: new people, places, groups, threads, secrets and planted details are added, and what people want, plan and know is kept current. In entries you wrote, only those changing lines are touched. No extra AI request is made.',
        auto: 'The same block is asked for. New entries are added, and only entries the extension added are changed. Entries you wrote stay exactly as written.',
        off: 'No block is asked for and nothing is added or changed. You keep the world by hand.',
    };
    return [
        home('world-update', field('Keep the world up to date from each reply', UPDATE_HELP[o.update] || UPDATE_HELP.all,
            select([{ value: 'all', label: 'On' }, { value: 'auto', label: 'On, and leave my own entries alone' }, { value: 'off', label: 'Off' }], o.update, (v) => { o.update = v; save(); }))),
        field('A branch gets its own copy of the world', o.copyOnBranch !== false ? 'On: the first time a branch is opened, it gets a separate World Info book named after the story world with "(branch)". Recorded later changes are rewound on the copy. What happens in the branch changes the copy, and the chat it came from keeps the original. Swipes and deletes in the branch undo changes in the copy only.' : 'Off: a branch shares an existing parent world, so changes are shared. If the parent has no world, the branch gets a new empty World Info book.',
            select([{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], o.copyOnBranch !== false ? 'on' : 'off', (v) => { o.copyOnBranch = v === 'on'; save(); })),
        h('div', { class: 'ri-help' }, 'Everything filed this way is marked "Added automatically", listed in What Was Sent under the reply that caused it, written to the Log tab, and undone when that reply is swiped away or deleted. Saving an entry yourself makes it yours. An out-of-character message files nothing.'),
    ];
}

/** World orders: what can be ordered into the scene. Its one home is Direction, Random sets. */
export function worldOrdersSection(app) {
    const o = settings().world;
    const save = () => { saveSettings(); app.render(); };
    const onoff = (key, label, help) => field(label, help, select([{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], o.bring[key] ? 'on' : 'off', (v) => { o.bring[key] = v === 'on'; save(); }));
    return home('world-orders', h('details', { class: 'ri-card ri-tight', id: 'ri-world-orders', open: !!app.worldOrdersOpen, ontoggle: event => { app.worldOrdersOpen = event.currentTarget.open; } },
        h('summary', {}, 'World orders'),
        h('div', { class: 'ri-help' }, 'Orders share the one-new-thing-per-reply budget with sets and the goal.'),
        h('div', { class: 'ri-grid2' },
            field('An open thread builds by itself after (replies)', 'A thread that has not moved for this many replies goes up one step, as far as "About to come to a head". 0 leaves the steps to the story and to you.',
                numberInput(o.build, { min: 0, max: 200, unit: 'replies' }, (n) => { o.build = n; saveSettings(); })),
            field('Chance that something ready is ordered into the scene (%)', 'Each reply has this chance that one thing below becomes an order for that reply. It counts as the one new thing per reply, and it is checked like any instruction. 0 turns this off.',
                numberInput(o.head, { min: 0, max: 100, unit: '%' }, (n) => { o.head = n; saveSettings(); })),
            field('Replies before a planted detail or a thing going on elsewhere can be ordered in', 'So that something new has time to sit before it matters.',
                numberInput(o.minAge, { min: 0, max: 200, unit: 'replies' }, (n) => { o.minAge = n; saveSettings(); }))),
        h('div', { class: 'ri-label' }, 'What can be ordered into the scene'),
        h('div', { class: 'ri-grid2' },
            onoff('thread', 'An open thread that is about to come to a head', 'The order: it comes to a head in this reply. When it happens the thread is marked "Happening now".'),
            onoff('seed', 'A planted detail', 'The order: the detail matters in this reply. When it happens it is marked "Paid off".'),
            onoff('activity', 'Something going on elsewhere', 'The order: it reaches the scene in this reply. When it happens it is marked "Finished".'),
            onoff('secret', 'A kept secret of someone in the scene', 'The order: the secret comes out in this reply. When it happens it is marked "Out in the open". Off to start with, so secrets come out only when you or the story decide.')),
        slot(['worldOrder', 'silentCharacter', 'threadOrder', 'seedOrder', 'activityOrder', 'secretOrder'], 'Customize world order instructions')));
}

/** The update prompts sit beside the update switch in Setup, Memory. */
export const worldUpdatePrompts = () => slot(['memoryFacts', 'worldUpdate', 'storyNotes'], 'Customize world-update instructions');

/** What would be sent with the next reply. Its one home is Review, Context. */
export async function nextReplyPreview(id) {
    const body = h('div', {});
    if (!id) return home('next-preview', section('Next reply preview', h('div', { class: 'ri-muted' }, 'Choose or create a Story World to see its notes.')));
    try {
        const data = await entries.load(id);
        const list = data ? entries.list(data, id) : [];
        const effective = await entries.effective(id);
        const { notes } = entries.recall(effective ? entries.list(effective, id) : list);
        body.append(notes ? [
            h('div', { class: 'ri-grid' },
                kv('Read as present', notes.present.length ? `${notes.present.join(', ')} (read from ${notes.how})` : 'Nobody who has an entry'),
                notes.place ? kv('Place', notes.place) : null,
                notes.missing.length ? kv('Named in the scene, with no entry yet', notes.missing.join(', ')) : null,
                kv('Size', `about ${notes.tokens} tokens including any chapters, ${notes.ids.length} ${notes.ids.length === 1 ? 'entry' : 'entries'}`)),
            h('div', { class: 'ri-label' }, 'Exactly what the AI would receive'),
            h('div', { class: 'ri-preview' }, notes.text),
        ] : h('div', { class: 'ri-muted' }, list.length ? 'No eligible story entries would be sent right now.' : 'Nothing yet. Add an entry in Story, Story World.'));
    } catch (e) { body.append(h('div', { class: 'ri-empty' }, `This world could not be read: ${e.message}`)); }
    return home('next-preview', section('Next reply preview', body));
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
    if (!ui.others) { ui.others = []; entries.load(id).then((data) => { ui.others = data ? entries.list(data, id) : []; redraw(); }).catch(() => {}); }

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

    body.appendChild(section('Automatic updates',
        draft.auto ? h('div', { class: 'ri-note' }, 'The extension added this entry from a reply. Saving it here makes it yours.') : null,
        field('Let the extension keep this entry up to date', draft.locked ? 'Off: this entry stays exactly as you wrote it. It is also never ordered into the scene by itself.' : 'On: lines that change with the story (what a person wants, plans and knows; where a thread stands) are kept current from each reply.',
            select([{ value: 'on', label: 'On' }, { value: 'off', label: 'Off: keep it as I wrote it' }], draft.locked ? 'off' : 'on', (v) => { draft.locked = v === 'off'; dirty(); redraw(); }))));

    const flags = entries.flags(draft, ui.others);
    body.appendChild(section('What the AI would receive for this entry',
        h('div', { class: 'ri-preview' }, `- ${entries.text(draft)}`),
        flagNode(flags)));

    const save = async () => {
        const now = entries.flags(draft, ui.others);
        if (now.blocks.length) { toast('error', now.blocks[0]); return; }
        try {
            const data = await entries.load(id);
            if (!data) throw new Error('The World Info book could not be read.');
            if (draft.isNew) draft.uid = entries.blank(entries.reserve(data,id), draft.kind).uid;
            const before = data.entries[draft.uid] ? structuredClone(data.entries[draft.uid]) : null;
            draft.auto = false;   // saved by hand: it is yours now
            entries.put(data, draft, id);
            await entries.save(id, data);
            entries.changed(id, draft.uid, before, data.entries[draft.uid]);
            toast('success', `${def.label} saved.`);
            go(app, { view: 'list' });
        } catch (e) { toast('error', `Could not save: ${e.message}`); }
    };
    body.appendChild(h('div', { class: 'ri-row ri-savebar' },
        button(`Save ${def.label.toLowerCase()}`, save, { kind: 'primary' }),
        button('Cancel', () => go(app, { view: 'list' }), { kind: 'ghost' }),
        draft.isNew ? null : button('Delete', async () => {
            if (!await confirmBox(`Delete "${draft.name}" from this world?`)) return;
            try { const data = await entries.load(id); const before = data.entries[draft.uid] ? structuredClone(data.entries[draft.uid]) : null; delete data.entries[draft.uid]; await entries.save(id, data); entries.changed(id, draft.uid, before, null); go(app, { view: 'list' }); }
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
        functionExecution('writerWorld',{receipt:executionReceipt('writerWorld')}),
        field('What it is about (you can leave this empty)', `A name or a few words. Left empty, the AI picks a ${def.label.toLowerCase()} from what you let it read below.`,
            textInput(ai.about, (v) => { ai.about = v; }, { placeholder: draft.kind === 'character' ? 'Example: Mira, the fruit seller' : 'A name or a few words' })),
        contextField(),
        h('div', { class: 'ri-help' }, 'The AI can only write what it is shown. Tick the character card and the recent messages for the best result.'));
    if (ai.error) box.appendChild(h('div', { class: 'ri-note ri-note-warn' }, ai.error));
    box.appendChild(h('div', { class: 'ri-row' },
        executionAction(button(ai.busy ? 'Writing...' : 'Write the entry', async () => {
            if (ai.busy) return;
            ai.busy = true; ai.error = ''; redraw();
            try {
                const res = await entries.draftWithAI({ kind: draft.kind, about: ai.about.trim(), context: settings().writer.context, existing: (ui.others || []).filter(o => o.kind === draft.kind && o.uid !== draft.uid).map(o => o.name) });
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
        }, { kind: 'primary', disabled: ai.busy })),
        button('Cancel', () => { ui.ai = null; redraw(); }, { kind: 'ghost', disabled: ai.busy })));
    return box;
}
import { executionAction, functionExecution } from './execution.js';
import { executionReceipt } from '../execution.js';
