// Inline notes, the parts she sees (B42): the Direction page with a switch for the marker and one for each wrap
// button, and the refusal of a message that holds only a note. The bar's three wrap buttons are drawn in composer-bar.js.
import { h, field, section, select } from './dom.js';
import { registerPage } from './page-registry.js';
import { boxHoldsOnlyNotes, inlineActive, inlineSettings, saveInlineSettings, WRAPS } from '../inline-direction.js';
import { ctx } from '../st.js';

const SLOT = 'inline';
export const ALONE_TEXT = 'Your message holds only a note. Add a few words of your own for the story, then send again.';

const onOff = (value, change, label) => select([{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], value ? 'on' : 'off',
    next => change(next === 'on'), { 'aria-label': label });

/** Redraw the bar after a switch changes. composer-bar.js already listens for this event. */
const changed = () => document.dispatchEvent(new Event('ri-look-change'));

export function renderInlineNotesPage(body) {
    const config = inlineSettings();
    const set = (key, value) => { saveInlineSettings({ [key]: value }); changed(); };
    body.append(
        section('Notes inside your message',
            h('p', { class: 'ri-help' }, 'Write [[OOC: plain words]] anywhere in a message. The note is cut from the message before it is saved and goes out once, for that reply only, as a private direction that keeps its OOC: prefix. Several notes go in the order you wrote them.'),
            field('Notes in [[OOC: ]]', 'Off leaves the brackets in your message like any other text.',
                onOff(config.marker, value => set('marker', value), 'Notes in [[OOC: ]]'))),
        section('Wrap buttons on the bar',
            h('p', { class: 'ri-help' }, 'One tap wraps the selected text, or puts the pair at the cursor and leaves the cursor between the marks. You can also press and hold a button to hide it.'),
            WRAPS.map(wrap => field(wrap.label, wrap.help,
                onOff(config[wrap.id], value => set(wrap.id, value), `${wrap.label} button`)))));
}

let installed = false;
let noticeShown = false;

/** A send of a message box that holds only [[OOC: ]] notes is refused with a short note on the bar. */
function refuseNoteAlone(event) {
    if (!inlineActive() || !boxHoldsOnlyNotes()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    import('./composer-bar.js').then(({ setBarNotice }) => {
        noticeShown = true;
        setBarNotice({ id: 'inline-alone', label: 'Note alone', tone: 'problem', count: 1, text: ALONE_TEXT,
            onDismiss: () => { noticeShown = false; setBarNotice(null, SLOT); } }, SLOT);
    });
}

/** Register the page and the guard once. Called when the bar mounts. */
export function installInlineUi() {
    if (installed) return;
    installed = true;
    registerPage({ id: 'inline-notes', group: 'direction', tab: 'writing', label: 'Notes inside your message', withoutChat: true,
        help: 'The [[OOC: ]] marker and the wrap buttons on the bar.', aliases: 'inline ooc note private direction brackets wrap italic quote asterisk',
        render: renderInlineNotesPage });
    document.addEventListener('click', event => { if (event.target?.closest?.('#send_but')) refuseNoteAlone(event); }, true);
    document.addEventListener('keydown', event => {
        if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.isComposing) return;
        if (event.target?.id !== 'send_textarea' || !ctx().shouldSendOnEnter?.()) return;
        refuseNoteAlone(event);
    }, true);
    // The note on the bar goes away as soon as the box changes.
    document.addEventListener('input', event => {
        if (!noticeShown || event.target?.id !== 'send_textarea' || boxHoldsOnlyNotes(event.target.value)) return;
        noticeShown = false;
        import('./composer-bar.js').then(({ setBarNotice }) => setBarNotice(null, SLOT));
    }, true);
}
