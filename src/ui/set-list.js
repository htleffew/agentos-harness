// Direction, Random sets: every instruction, story event and writing style set in one list, grouped by kind,
// with one Add set button. A set opens in the editor page of its kind (sets.js and events.js); Back returns here.
// The wording editors for what each kind sends into the chat have their home on this page.
import { h, button, field, select, textInput, section } from './dom.js';
import { slot, home } from './homes.js';
import { knownSets, createSet, adoptSet, setInfo } from '../books.js';
import { toast, isChatOpen } from '../st.js';
import { enabledV10, effectiveModules } from '../v10.js';
import { instructionSetCard, openSet, openable } from './sets.js';
import { EVENT_KINDS, eventSetCard, createEventSet } from './events.js';

const KINDS = [
    { value:'instructions', label:'Instruction set' },
    { value:'events', label:'Story event set' },
    { value:'style', label:'Writing style set' },
    { value:'lorebook', label:'Lorebook you already have, as an instruction set' },
];

// The open Add set form lives here so a redraw while it is open keeps what was typed.
let adding = null;

async function addSet(app) {
    const form = adding;
    try {
        if (form.kind === 'lorebook') {
            const added = await adoptSet(form.lorebook);
            app.cache = {};
            adding = null;
            if (added.length === 1 && setInfo(added[0]).kind === 'instructions') { await openSet(app, added[0]); return; }
            toast(added.length ? 'success' : 'info', added.length ? `${added.length} ${added.length === 1 ? 'set was' : 'sets were'} added from "${form.lorebook}".` : `Every set in "${form.lorebook}" is already in the list.`);
            app.render();
            return;
        }
        const name = form.name.trim();
        if (!name) { form.error = 'Give the set a name.'; app.render(); return; }
        if (form.kind === 'instructions') {
            const made = await createSet(name);
            app.cache = {};
            adding = null;
            await openSet(app, made);
        } else {
            adding = null;
            await createEventSet(app, EVENT_KINDS[form.kind], name);
        }
    } catch (error) { toast('error', error.message); }
}

function addForm(app) {
    const lorebooks = openable();
    if (adding.kind === 'lorebook' && !lorebooks.length) adding.kind = 'instructions';
    const kinds = KINDS.filter(item => item.value !== 'lorebook' || lorebooks.length);
    if (adding.kind === 'lorebook' && !lorebooks.includes(adding.lorebook)) adding.lorebook = lorebooks[0];
    const nameField = adding.kind === 'lorebook'
        ? field('Lorebook to open', 'The lorebook file is left as it is until you edit one of its instructions. A shared lorebook made by this extension adds every set kept inside it.',
            select(lorebooks.map(name => ({ value:name, label:name })), adding.lorebook, value => { adding.lorebook = value; }))
        : field('Name', '', textInput(adding.name, value => { adding.name = value; }, { 'aria-label':'Name for the new set', maxLength:120 }));
    return h('div', { class:'ri-card ri-pick', 'data-add-set':'' },
        field('Kind of set', 'Instruction sets send occasional directions. Story event sets roll a story event. Writing style sets change how replies are written.',
            select(kinds, adding.kind, value => { adding.kind = value; adding.error = ''; app.render(); }, { 'aria-label':'Kind of set' })),
        nameField,
        adding.error && h('p', { class:'ri-note ri-note-warn', role:'status' }, adding.error),
        h('div', { class:'ri-row' },
            button(adding.kind === 'lorebook' ? 'Open' : 'Create', () => addSet(app), { kind:'primary' }),
            button('Cancel', () => { adding = null; app.render(); }, { kind:'ghost' })));
}

function group(title, intro, ...rest) {
    return section(title, intro && h('div', { class:'ri-intro' }, intro), ...rest);
}

function empty(text) {
    return h('div', { class:'ri-empty' }, text);
}

export function renderSetList(body, app) {
    for (const key of ['eroute', 'sroute']) if (app[key]?.notice) body.append(h('p', { class:'ri-note', role:'status' }, app[key].notice));
    const instructions = knownSets(), events = knownSets('events'), style = knownSets('style');
    if (!instructions.length && !events.length && !style.length) body.append(h('div', { class:'ri-note' },
        h('p', {}, 'Sets are optional. Add one when you want occasional directions, story events or a writing style sent with replies.'),
        isChatOpen() && button('Set up this chat', () => app.openSetting('v10', 'ri-story-workflow'), { kind:'ghost' })));

    body.append(h('div', { class:'ri-row' },
        button('Add set', () => { adding ||= { kind:'instructions', name:'', lorebook:'', error:'' }; app.render(); }, { kind:'primary' })));
    if (adding) body.append(addForm(app));

    body.append(group('Instruction sets', 'Turn a set on to send its instructions at random with the timing you set.',
        home('instruction-wording', slot(['instructionOrder', 'overdueOrder', 'finalOrder', 'instructionAgency'], 'Customize in-chat instruction wording', { contextual:true })),
        slot(['versionRules', 'modelVersionRules', 'systemVersions'], 'Customize Write with AI prompts'),
        instructions.length ? instructions.map(name => instructionSetCard(app, name)) : empty('No instruction sets yet. Press "Add set" to make the first one.')));

    body.append(group('Story event sets', EVENT_KINDS.events.intro,
        enabledV10() && h('div', { class:'ri-note' },
            h('p', {}, `Autonomous world events are ${effectiveModules().worldEvents ? 'on' : 'off'} for this chat. They offer optional developments independently of the event sets below.`),
            button('Change autonomous world events', () => app.openSetting('v10', 'ri-module-worldEvents', 'chat'), { kind:'ghost' })),
        home('event-wording', slot(['event'], 'Customize in-chat story event wording', { contextual:true })),
        slot(['eventWriterRules', 'anywhere', 'situationRules', 'complicationRules', 'driverRules', 'toneRules', 'stakeRules', 'rewriteRules', 'systemItems', 'systemRewrite'], 'Customize Write with AI prompts'),
        events.length ? events.map(name => eventSetCard(app, name, EVENT_KINDS.events)) : empty('No story event sets yet. Press "Add set" to make the first one.')));

    body.append(group('Writing style sets', EVENT_KINDS.style.intro,
        home('style-wording', slot(['style'], 'Customize in-chat writing style wording', { contextual:true })),
        slot(['styleWriterRules', 'systemStyleItems'], 'Customize Write with AI prompts'),
        style.length ? style.map(name => eventSetCard(app, name, EVENT_KINDS.style)) : empty('No writing style sets yet. Press "Add set" to make the first one.')));
}
