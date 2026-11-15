// Settings tab.
import { h, select, numberInput, textInput, field, section } from './dom.js';
import { settings, saveSettings, chatPronouns, setPronouns, PRONOUN_LABELS, FORMS } from '../store.js';
import { listProfiles, names, isChatOpen, hasEvent, toast } from '../st.js';
import { ensureRegexScript } from '../engine.js';
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

export function renderSettings(body, app) {
    const st = settings();
    const save = () => { saveSettings(); };

    body.appendChild(section('Pronouns for this chat',
        isChatOpen() ? [pronounControl('char', app), pronounControl('user', app)] : h('div', { class: 'ri-muted' }, 'Open a chat to set pronouns for it.'),
        h('div', { class: 'ri-help' }, 'Your choice is remembered for this character and this persona in new chats.')));

    const profiles = listProfiles();
    body.appendChild(section('AI connection for writing and checking',
        field('Which AI connection to use', profiles.length ? 'Used when you write versions with AI and when a reply is checked. A small, fast model is enough.' : 'You have no connection profiles yet, so the chat\'s own connection is used. Make one in SillyTavern\'s Connection Profiles to use a cheaper model here.',
            select([{ value: '', label: 'Same connection as the chat' }, ...profiles.map(p => ({ value: p.id, label: `Connection profile: ${p.name}` }))], st.profileId, (v) => { st.profileId = v; save(); }))));

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
        h('div', { class: 'ri-help' }, `Roleplay Instructions 3.1.0. Version 3: Random Instructions, Random Story Events and Random Writing Style. ${need.every(hasEvent) ? 'This app has everything the extension needs.' : `Missing in this app: ${need.filter(n => !hasEvent(n)).join(', ')}.`}`),
        h('div', { class: 'ri-help' }, 'Instruction sets are ordinary lorebooks. With this extension off, a set still works if you turn the lorebook on in World Info, without limits, checking or the What Was Sent record.')));
}
