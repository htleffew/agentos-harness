// Settings tab.
import { h, select, numberInput, textInput, textArea, field, section, button, foldCard } from './dom.js';
import { DEFAULT_WORDS, DEFAULT_WRITER_RULES, wordList } from '../pacing.js';
import { settings, saveSettings, chatPronouns, setPronouns, PRONOUN_LABELS, FORMS, HOME_BOOK } from '../store.js';
import { listProfiles, names, isChatOpen, hasEvent, toast, inputBox } from '../st.js';
import { ensureRegexScript, setsMoved } from '../engine.js';
import { knownSets, setInfo, sharedBooks, moveSet, cleanSetName, KINDS } from '../books.js';
import { refreshUnderReplies } from './sent.js';

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

function whereSection(app) {
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

function paceSection(app) {
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
        field('Quiet after a big event (replies)', 'After a big event has happened, nothing new starts for this many replies, across every set, the goal and the story world. What is already under way carries on. Big events are: story event sets marked "Events from this set are big", and an open thread of the story world coming to a head. 0 turns this off.',
            numberInput(o.quiet, { min: 0, max: 20, unit: 'replies' }, (n) => { o.quiet = n; save(); })),
        field('Order a character who has gone quiet (replies)', 'Needs a story world. A character of the world who has been in the scene for this many replies, and is named in the story text of none of them, is ordered to speak or act. The order counts as the one new thing of that reply and is checked. 0 turns this off.',
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
            field('Your word list', 'Separate words with commas. A star at the end stands for any ending: "ledger*" also finds "ledgers". Capital letters make no difference.',
                textArea(st.words.list, (v) => { st.words.list = v; save(); }, { rows: 5 })),
            h('div', { class: 'ri-row ri-row-tight' }, button('Put the starting list back', () => { st.words.list = DEFAULT_WORDS; save(); app.render(); }, { kind: 'ghost' })),
            field('Also ask the AI writer to leave these words out', 'On: the list is added to every writing request, so fewer flagged words come back.',
                onOff(st.words.tell !== false, (v) => { st.words.tell = v; save(); })),
        ] : null);
}

export function renderSettings(body, app) {
    const st = settings();
    const save = () => { saveSettings(); };

    body.appendChild(section('Pronouns for this chat',
        isChatOpen() ? [pronounControl('char', app), pronounControl('user', app)] : h('div', { class: 'ri-muted' }, 'Open a chat to set pronouns for it.'),
        h('div', { class: 'ri-help' }, 'Your choice is remembered for this character and this persona in new chats.')));

    const profiles = listProfiles();
    body.appendChild(section('AI connection for writing and checking',
        field('Which AI connection to use', profiles.length ? 'Used when you write versions with AI and when a reply is checked. A small, fast model is enough.' : 'You have no connection profiles yet, so the chat\'s own connection is used. Make one in SillyTavern\'s Connection Profiles to use a cheaper model here.',
            select([{ value: '', label: 'Same connection as the chat' }, ...profiles.map(p => ({ value: p.id, label: `Connection profile: ${p.name}` }))], st.profileId, (v) => { st.profileId = v; save(); })),
        field('Give the AI more room to answer', 'Turn this on for models that think before they answer (DeepSeek, GLM, Kimi and others). Without it, the thinking can use up the room and the answer comes back empty. It turns itself on when an empty answer is fixed by a second try with more room.',
            select([{ value: 'no', label: 'Off' }, { value: 'yes', label: 'On' }], st.writer.moreRoom ? 'yes' : 'no', (v) => { st.writer.moreRoom = v === 'yes'; save(); }))));

    body.appendChild(whereSection(app));

    body.appendChild(section('One thing per reply',
        field('How many new things can start in one reply', 'Counted across every instruction set, every story event set and the goal task together. When more are ready, one is picked at random and the others wait for a later reply. Something already under way (kept for more replies, or sent again because it did not happen) uses up the room first. Writing style and the goal line are how the reply is written and are always sent. 0 turns this off.',
            numberInput(st.perReply, { min: 0, max: 5, unit: 'per reply' }, (n) => { st.perReply = n; save(); }))));

    body.appendChild(paceSection(app));
    body.appendChild(writerSection(app));

    body.appendChild(section('Check that it happened',
        field('Check each reply that was sent an instruction', 'On: after the reply, one short AI request checks whether each instruction happened, and finds the words that show it. Off: nothing is checked or sent again.',
            select([{ value: 'full', label: 'On' }, { value: 'off', label: 'Off' }], st.check.mode, (v) => { st.check.mode = v; save(); app.render(); })),
        st.check.mode === 'off' ? null : [
            field('Send again if it did not happen', 'How many more times an instruction is sent, with firmer wording each time, before it stops. 0 never sends it again.',
                numberInput(st.check.maxResend, { min: 0, max: 5, unit: 'more times' }, (n) => { st.check.maxResend = n; save(); })),
            field('While one is waiting to be sent again, hold back new instructions', 'On: the overdue instruction goes alone, so the AI has one thing to do.',
                select([{ value: 'yes', label: 'On' }, { value: 'no', label: 'Off' }], st.check.holdNew ? 'yes' : 'no', (v) => { st.check.holdNew = v === 'yes'; save(); })),
            field('Write a new reply right away when an instruction did not happen', 'On: the reply is swiped to a new one automatically, once. Off: the instruction is sent again with your next message.',
                select([{ value: 'no', label: 'Off' }, { value: 'yes', label: 'On' }], st.check.regenOnMiss ? 'yes' : 'no', (v) => { st.check.regenOnMiss = v === 'yes'; save(); })),
            field('Check that the reply did not write for you', 'Checked in the same request, only on replies that were sent an instruction.',
                select([{ value: 'off', label: 'Off' }, { value: 'flag', label: 'Show a warning in What Was Sent' }, { value: 'regen', label: 'Show a warning and write a new reply' }], st.check.agency, (v) => { st.check.agency = v; save(); })),
        ]));

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

    body.appendChild(section('Look',
        field('Accent colour', 'The colour of buttons and highlights in this panel.',
            select([{ value: 'auto', label: 'Blues and greens, a different one for each tab' }, { value: 'cyan', label: 'Cyan' }, { value: 'sky', label: 'Sky blue' }, { value: 'blue', label: 'Blue' }, { value: 'green', label: 'Green' }, { value: 'yellow', label: 'Yellow' }, { value: 'violet', label: 'Violet' }, { value: 'magenta', label: 'Pink' }], st.accent || 'auto', (v) => { st.accent = v; save(); app.render(); }))));

    const need = ['WORLDINFO_ENTRIES_LOADED', 'WORLDINFO_SCAN_DONE', 'MESSAGE_RECEIVED', 'GENERATION_STARTED'];
    body.appendChild(section('About',
        h('div', { class: 'ri-help' }, `Roleplay Instructions 5.5.0. Version 5 (in progress): Random Instructions, Random Story Events, Random Writing Style and Character Goals. ${need.every(hasEvent) ? 'This app has everything the extension needs.' : `Missing in this app: ${need.filter(n => !hasEvent(n)).join(', ')}.`}`),
        h('div', { class: 'ri-help' }, 'Sets are kept in ordinary lorebooks. With this extension off, a set still works if you turn its lorebook on in World Info, without limits, checking or the What Was Sent record. A shared lorebook turned on that way sends from every set inside it.')));
}
