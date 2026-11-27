import { slot, home, homeLink } from './homes.js';
import { executionSettings } from './execution.js';
// Settings tab.
import { h, select, numberInput, textInput, textArea, field, section, button, foldCard, download } from './dom.js';
import { BACKUP_KEY, backupFile, restoreBackup } from '../legacy-retire.js';
import { DEFAULT_WORDS, DEFAULT_WRITER_RULES, wordList } from '../pacing.js';
import { settings, saveSettings, chatPronouns, setPronouns, PRONOUN_LABELS, FORMS, HOME_BOOK } from '../store.js';
import { ctx, names, isChatOpen, hasEvent, toast, inputBox, confirmBox } from '../st.js';
import { setTreeHints } from './destinations.js';
import { ensureRegexScript, setsMoved } from '../engine.js';
import { knownSets, setInfo, sharedBooks, moveSet, cleanSetName, KINDS } from '../books.js';
import { refreshUnderReplies } from './sent.js';
import { registerPage } from './page-registry.js';
import { worldOrdersSection } from './world.js';
import { eventTagsSection } from './state.js';
import { sceneMarkersSection } from './scene-markers.js';

/** Pronouns. Their one home is Story, Characters (top). */
export function pronounsSection(app) {
    return home('pronouns', h('div', { id: 'ri-pronouns' }, section('Pronouns',
        isChatOpen() ? [pronounControl('char', app), pronounControl('user', app)] : h('div', { class: 'ri-muted' }, 'Open a chat to set pronouns for it.'),
        h('div', { class: 'ri-help' }, 'Your choice is remembered for this character and this persona in new chats.'))));
}

function pronounControl(role, app) {
    const p = chatPronouns()[role];
    const n = names();
    const who = role === 'char' ? `${n.char} (the character)` : `${n.user} (you)`;
    const examples = ['they', 'them', 'their', 'theirs', 'themself'];
    return field(`Pronouns for ${who}`, 'Versions use these wherever they have a pronoun label, so one instruction set works with any character.',
        select(Object.entries(PRONOUN_LABELS).map(([value, label]) => ({ value, label })), p.preset, (v) => { setPronouns(role, v, p.custom); app.render(); }),
        p.preset === 'custom' ? h('div', { class: 'ri-grid2' }, FORMS.map((f, i) => field(`Word used for "${examples[i]}"`, '', textInput(p.custom[i], (v) => { const next = [...p.custom]; next[i] = v; setPronouns(role, 'custom', next); }, { placeholder: examples[i] })))) : null);
}

const KIND_LABEL = { instructions: 'Random Instructions', events: 'Random Story Events', style: 'Random Writing Style', world: 'Story World' };
let moving = false;

/** Move one set, then let the open chat and the panel follow. Returns the result, or null when it failed. */
async function move(app, id, home) {
    if (moving) return null;
    moving = true;
    try {
        const from = setInfo(id);
        const res = await moveSet(id, home);
        await setsMoved();
        app.cache = {};
        const now = setInfo(res.id);
        if (res.id !== id) {
            toast('success', now.shared
                ? `"${now.name}" is now kept in the shared lorebook "${now.book}".${from.shared ? '' : ` Its old lorebook "${from.book}" was left as it was. Delete it in World Info when you no longer want it.`}`
                : `"${now.name}" now has a lorebook of its own.`);
        }
        return res;
    } catch (e) { toast('error', `Could not move the set: ${e.message}`); return null; }
    finally { moving = false; }
}

function whereFold(app, count, rows) {
    const fold = foldCard([h('span', { class: 'ri-sent-title' }, `Where each set is kept (${count} sets)`)], [h('div', { class: 'ri-where-list' }, rows)], { open: !!app.whereOpen });
    fold.addEventListener('toggle', () => { app.whereOpen = fold.open; });
    return fold;
}

export function whereSection(app) {
    const st = settings();
    const books = [...new Set([...sharedBooks(), ...(st.home ? [st.home] : [])])].sort((a, b) => a.localeCompare(b));
    const ids = KINDS.flatMap(k => knownSets(k));
    const NEW = '::new';
    const askName = async () => cleanSetName(await inputBox('Name for the shared lorebook:', HOME_BOOK));

    const homeOptions = [...books.map(b => ({ value: b, label: `One shared lorebook: "${b}"` })), ...(books.includes(HOME_BOOK) ? [] : [{ value: HOME_BOOK, label: `One shared lorebook: "${HOME_BOOK}"` }]), { value: NEW, label: 'One shared lorebook with another name' }, { value: '', label: 'A lorebook of its own for each set' }];
    const homeField = field('New sets are kept in', st.home
        ? `Every set you add from now on is kept inside the lorebook "${st.home}". The lorebook is made when the first set is added.`
        : 'Every set you add from now on gets a lorebook of its own, named after the set.',
        select(homeOptions, st.home, async (v) => {
            if (v === NEW) { const n = await askName(); if (n) st.home = n; }
            else st.home = v;
            saveSettings(); app.render();
        }));

    const rows = ids.map((id) => {
        const i = setInfo(id);
        const options = [{ value: '', label: 'A lorebook of its own' }, ...books.map(b => ({ value: b, label: `Shared lorebook: "${b}"` }))];
        return h('div', { class: 'ri-where' },
            h('div', { class: 'ri-where-name' }, i.name, h('span', { class: 'ri-where-kind' }, KIND_LABEL[i.kind])),
            select(options, i.shared ? i.book : '', async (v) => { await move(app, id, v); app.render(); }, { 'aria-label': `Where ${i.name} is kept` }));
    });

    const outside = st.home ? ids.filter(id => { const i = setInfo(id); return !(i.shared && i.book === st.home); }) : [];
    return section('Where your sets are kept',
        h('div', { class: 'ri-help' }, 'Every set is saved in a lorebook. One shared lorebook keeps everything this extension makes in one place. A lorebook for each set keeps them apart. Either way, each set is turned on or off per chat, keeps its own limit, and "One thing per reply" counts across all of them.'),
        homeField,
        outside.length ? h('div', { class: 'ri-row' }, button(`Move all ${ids.length === outside.length ? '' : 'other '}sets into "${st.home}" (${outside.length})`, async () => {
            let done = 0;
            for (const id of outside) { if (await move(app, id, st.home)) done++; }
            if (done > 1) toast('success', `${done} sets are now kept in "${st.home}". The lorebooks they came from were left as they were.`);
            app.render();
        }, { kind: 'primary', title: 'Each set keeps its versions, timing and what the chats recorded about it' })) : null,
        ids.length ? [
            // A long list starts closed so the rest of Settings stays in reach.
            ids.length > 8 ? whereFold(app, ids.length, rows)
                : [h('div', { class: 'ri-label' }, 'Where each set is kept'), h('div', { class: 'ri-where-list' }, rows)],
            h('div', { class: 'ri-help' }, 'Moving a set copies every entry whole: versions, timing and notes. What your chats recorded about it still counts, so waits, "only once" and retired items carry on. When a set leaves a lorebook of its own, that lorebook is left as it was, as a spare copy.')]
            : h('div', { class: 'ri-muted' }, 'You have no sets yet.'));
}

const onOff = (v, set) => select([{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], v ? 'on' : 'off', (x) => set(x === 'on'));

export function paceSection(app) {
    const st = settings();
    const o = st.pace;
    const save = () => { saveSettings(); };
    const rows = (Array.isArray(o.phases) ? o.phases : []).map((p, i) => h('div', { class: 'ri-card ri-inscard' },
        h('div', { class: 'ri-grid2' },
            field('Name of the phase', '', textInput(p.name, (v) => { p.name = v; save(); }, { placeholder: 'Phase' })),
            field('Starts at reply number', '', numberInput(p.from, { min: 1, max: 5000, unit: '' }, (n) => { p.from = n; save(); })),
            field('Chance that something new starts (% of the usual chance)', '100 leaves every chance as you set it. 50 halves the chance of each instruction, story event and order of the story world. 150 raises it by half. 0 starts nothing new.',
                numberInput(p.chance, { min: 0, max: 400, unit: '%' }, (n) => { p.chance = n; save(); }))),
        field('Line sent with every reply of this phase', 'Optional. Say in plain words what the story is doing in this phase. Example: "People and places are being met. Large turns wait." Left empty, nothing is sent.',
            textInput(p.line || '', (v) => { p.line = v; save(); }, { placeholder: 'Nothing is sent' })),
        h('div', { class: 'ri-row ri-row-tight' }, button('Delete this phase', () => { o.phases.splice(i, 1); save(); app.render(); }, { kind: 'danger' }))));
    return section('Pacing',
        field('Calm after a big event (replies)', 'After a big event has happened, nothing new starts for this many replies, across every set, the goal and the story world. What is already under way carries on. Big events are: story event sets marked "Events from this set are big", and an open thread of the story world coming to a head. 0 turns this off.',
            numberInput(o.quiet, { min: 0, max: 20, unit: 'replies' }, (n) => { o.quiet = n; save(); })),
        field('Order a character who has gone silent (replies)', 'Needs a story world. A character of the world who has been in the scene for this many replies, and is named in the story text of none of them, is ordered to speak or act. The order counts as the one new thing of that reply and is checked. 0 turns this off.',
            numberInput(o.silent, { min: 0, max: 30, unit: 'replies' }, (n) => { o.silent = n; save(); })),
        field('Story phases', o.phasesOn ? 'A phase starts at a reply number and lasts until the next one starts. It changes how often something new starts, and it can send a line of its own.' : 'Off: every chance stays as you set it for the whole chat.',
            onOff(o.phasesOn, (v) => { o.phasesOn = v; save(); app.render(); })),
        o.phasesOn ? [
            h('div', { class: 'ri-list' }, rows),
            h('div', { class: 'ri-row' }, button('Add a phase', () => {
                const last = Math.max(0, ...o.phases.map(p => Number(p.from) || 0));
                o.phases.push({ name: 'New phase', from: last + 20, chance: 100, line: '' }); save(); app.render();
            })),
        ] : null);
}

function writerSection(app) {
    const st = settings();
    const save = () => { saveSettings(); };
    const count = wordList().length;
    return section('What the AI writes for you',
        h('div', { class: 'ri-help' }, 'These apply whenever the AI writes something for this panel: versions, list items, goals, story world entries and the first message of a new chapter.'),
        field('Rules given to the AI writer', 'One rule per line, in plain words. They are added to every writing request.',
            textArea(st.writer.rules ?? DEFAULT_WRITER_RULES, (v) => { st.writer.rules = v; save(); }, { rows: 5 })),
        h('div', { class: 'ri-row ri-row-tight' }, button('Put the starting rules back', () => { st.writer.rules = DEFAULT_WRITER_RULES; save(); app.render(); }, { kind: 'ghost' })),
        field('Flag words from your list', st.words.on ? `On: ${count} ${count === 1 ? 'word is' : 'words are'} on the list. Text that uses one gets the line "On your word list" where you review it. It is a flag: you can always keep the text.` : 'Off: no words are flagged.',
            onOff(st.words.on, (v) => { st.words.on = v; save(); app.render(); })),
        st.words.on ? [
            field('Your word list', 'This list runs locally. Separate words with commas. A star at the end matches any ending. Capital letters make no difference.',
                textArea(st.words.list, (v) => { st.words.list = v; save(); }, { rows: 5 })),
            h('div', { class: 'ri-row ri-row-tight' }, button('Put the starting list back', () => { st.words.list = DEFAULT_WORDS; save(); app.render(); }, { kind: 'ghost' })),
        ] : null);
}

export function renderReplyDisplayOptions(body, app) {
    const st=settings(), save=()=>saveSettings();
    const underHelp = {
        off: 'Nothing is added to the chat screen. What was sent is always in the What Was Sent tab.',
        display: 'A closed section is drawn under each reply that was sent an instruction. The message text is unchanged and the AI never sees it. It is gone if the extension is turned off.',
        saved: 'The section is written into the message text inside <sent_instructions> tags. The extension removes it from every prompt, and a regex script is added so it stays out of prompts even without the extension.',
    };
    body.appendChild(section('Show what was sent under each reply',
        field('Under each reply', underHelp[st.showUnder],
            select([{ value: 'off', label: 'Off' }, { value: 'display', label: 'Show it (display only)' }, { value: 'saved', label: 'Show it and save it in the message' }], st.showUnder, (v) => {
                st.showUnder = v; save();
                if (v === 'saved' && ensureRegexScript()) toast('info', 'A regex script was added that keeps this section out of prompts.');
                refreshUnderReplies(); app.render();
            }))));

}

/** Follow-through checks. Their one home is Direction, Random sets. */
export function followThroughSection(app) {
    const st = settings();
    const save = () => { saveSettings(); };
    return section('Follow-through checks',
        field('Check each reply that was sent an instruction', 'Automatic checks also need the permission below. Each check uses one additional model call to look for evidence in the reply.',
            select([{ value: 'full', label: 'On' }, { value: 'off', label: 'Off' }], st.check.mode, (v) => { st.check.mode = v; save(); app.render(); })),
        button('Instruction check connection & permission',()=>app.openSetting('settings','ri-operation-instructionCheck'),{kind:'ghost'}),
        st.check.mode === 'off' ? null : [
            field('Send again if it did not happen', 'How many more times an instruction is sent, with firmer wording each time, before it stops. 0 never sends it again.',
                numberInput(st.check.maxResend, { min: 0, max: 5, unit: 'more times' }, (n) => { st.check.maxResend = n; save(); })),
            field('While one is waiting to be sent again, hold back new instructions', 'On: the overdue instruction goes alone, so the AI has one thing to do.',
                select([{ value: 'yes', label: 'On' }, { value: 'no', label: 'Off' }], st.check.holdNew ? 'yes' : 'no', (v) => { st.check.holdNew = v === 'yes'; save(); })),
            field('Write a new reply right away when an instruction did not happen', 'When automatic replacement is permitted, the host makes one additional swipe request after a missed instruction.',
                select([{ value: 'no', label: 'Off' }, { value: 'yes', label: 'On' }], st.check.regenOnMiss ? 'yes' : 'no', (v) => { st.check.regenOnMiss = v === 'yes'; save(); })),
            button('Automatic swipe connection & permission',()=>app.openSetting('settings','ri-operation-automaticSwipe'),{kind:'ghost'}),
            field('Check that the reply did not write for you', 'Checked in the same request, only on replies that were sent an instruction.',
                select([{ value: 'off', label: 'Off' }, { value: 'flag', label: 'Show a warning in What Was Sent' }, { value: 'regen', label: 'Show a warning and write a new reply' }], st.check.agency, (v) => { st.check.agency = v; save(); })),
        ],
        slot(['checker', 'systemCheck'], 'Customize checking instructions'));
}

/** How many new things can start in one reply. Its one home is Direction, Random sets. */
export function perReplyControl(app) {
    const st = settings();
    return home('per-reply', field('How many new things can start in one reply', 'Counted across every instruction set, every story event set, the goal and the world orders together. When more are ready, one is picked at random and the others wait for a later reply. Something already under way (kept for more replies, or sent again because it did not happen) uses up the room first. Writing style and the goal line are how the reply is written and are always sent. 0 turns this off.',
        numberInput(st.perReply, { min: 0, max: 5, unit: 'per reply', label: 'New things in one reply' }, (n) => { st.perReply = n; saveSettings(); })));
}

/** The settings backup: every extension setting and custom prompt in one file, and reading one back in. */
function backupSection(app) {
    const saved = settings()[BACKUP_KEY];
    const picker = h('input', { type: 'file', accept: '.json,application/json', hidden: true, 'aria-label': 'Settings backup file to restore',
        onchange: async event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (!file) return;
            try {
                const text = await file.text();
                if (!await confirmBox(`Replace every Roleplay Instructions setting with the ones in "${file.name}"? Your chats and World Info books stay as they are.`)) return;
                const result = restoreBackup(text);
                toast('success', `Settings restored from the backup${result.created ? ` of ${result.created.slice(0, 10)}` : ''}, with ${result.prompts} custom ${result.prompts === 1 ? 'prompt' : 'prompts'}.`);
                app.render();
            } catch (error) { toast('error', error.message || String(error)); }
        } });
    return section('Settings backup',
        h('p', { class: 'ri-help', id: 'ri-legacy-backup' }, saved?.name
            ? `A backup of your settings was saved during this update, as ${saved.name} in SillyTavern's user files (${String(saved.created || '').slice(0, 10)}).`
            : 'A backup is saved in SillyTavern\'s user files the first time the extension starts after this update.'),
        h('div', { class: 'ri-row' }, button('Save a backup file', () => {
            const file = backupFile('Saved from Setup, Connections.');
            if (!download(file.name, file.text)) toast('info', 'The download did not start here.');
        }, { kind: 'ghost' }), button('Restore from a backup file', () => picker.click(), { kind: 'ghost' }), picker),
        h('p', { class: 'ri-help' }, 'Restoring replaces every setting and custom prompt with the ones in the file. Your chats and World Info books stay as they are.'));
}

/** Setup, Connections: which connection each job uses and what the AI writes for you. */
export function renderSettings(body, app) {
    const st = settings();
    const save = () => { saveSettings(); };

    body.appendChild(section('Connections & automatic requests',
        h('p',{class:'ri-help'},'Extension-wide · connection settings take effect when you select them.'),
        h('div',{id:'ri-model-request-settings'},h('h3',{class:'ri-label'},'Model request settings'),executionSettings({canonical:true})),
        field('Give the AI more room to answer', 'Increase the answer budget for models that use part of the answer for reasoning. An empty answer leaves the next attempt up to you.',
            select([{ value: 'no', label: 'Off' }, { value: 'yes', label: 'On' }], st.writer.moreRoom ? 'yes' : 'no', (v) => { st.writer.moreRoom = v === 'yes'; save(); })),
        slot(['guided','guidedContinue','historicalSwipe','historicalContinue','freshStart'], 'Customize guided-turn instructions')));

    const writer=writerSection(app);
    body.appendChild(section('What the AI writes for you', ...[...writer.children].slice(1)));
    body.appendChild(backupSection(app));

    body.appendChild(section('Settings that moved',
        h('p', { class: 'ri-help' }, 'Each of these has one home. The links open it.'),
        homeLink(app, 'pronouns', 'Pronouns are set in Story, Characters.'),
        homeLink(app, 'set-storage', 'Where your sets are kept is set in Direction, Random sets.'),
        homeLink(app, ['pacing','per-reply'], 'Pacing and the number of new things in one reply are set in Direction, Random sets.'),
        homeLink(app, 'follow-through', 'Follow-through checks are set in Direction, Random sets.'),
        homeLink(app, 'dice-stats', 'Dice stats are set in Story, Characters, Stats.'),
        homeLink(app, 'state-budget', 'The current state prompt budget is set in Setup, Memory.')));
}

/** The version line, at the foot of Setup. */
export function versionLine() {
    const need = ['WORLDINFO_ENTRIES_LOADED', 'WORLDINFO_SCAN_DONE', 'MESSAGE_RECEIVED', 'GENERATION_STARTED'];
    const line = h('div', { class: 'ri-help' });
    const finish = number => { line.textContent = `Roleplay Instructions${number ? ` ${number}` : ''}. ${need.every(hasEvent) ? 'This app has everything the extension needs.' : `Missing in this app: ${need.filter(n => !hasEvent(n)).join(', ')}.`}`; };
    finish('');
    fetch(new URL('../../manifest.json', import.meta.url)).then(response => response.json()).then(manifest => finish(manifest.version)).catch(() => {});
    return h('div', { class: 'ri-section', id: 'ri-about' }, line,
        h('div', { class: 'ri-help' }, 'Sets are kept in ordinary World Info books. With this extension off, a set still works if you turn its book on in World Info, without limits, checking or the What Was Sent record. A shared book turned on that way sends from every set inside it.'));
}

// ---------- pages this file places in the menu tree ----------

// The Opening section comes first on Story, Scene while the chat holds only its first message.
setTreeHints({ openingFirst: () => isChatOpen() && (ctx().chat || []).length <= 1 });

/** A section drawn as one fold: the title becomes the summary and the rest sits inside. */
const fold = (title, node, { id, open = false } = {}) => h('details', { class: 'ri-card ri-tight', id, open },
    h('summary', {}, title), ...[...node.children].slice(1));

registerPage({ id: 'set-rules', group: 'direction', tab: 'random-sets', label: 'Sets and pacing', withoutChat: true,
    help: 'How often new things start, where sets are kept, follow-through checks, world orders and tags to skip.',
    aliases: 'pacing storage where sets are kept follow-through check world orders tags to skip one new thing per reply phases',
    render: (body, app) => {
        body.append(section('New things in one reply', perReplyControl(app)),
            home('set-storage', fold('Where your sets are kept', whereSection(app), { id: 'ri-set-storage' })),
            home('pacing', fold('Pacing', paceSection(app), { id: 'ri-pacing' })),
            sceneMarkersSection(),
            home('follow-through', fold('Follow-through checks', followThroughSection(app), { id: 'ri-follow-through' })),
            worldOrdersSection(app),
            eventTagsSection(() => app.render()));
    } });
