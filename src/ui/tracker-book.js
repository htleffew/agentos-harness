// The Tracker book on two pages (UI DESIGN 6.7): the section on Story, World Info that lists what the book holds and opens
// it in SillyTavern's World Info editor, and the size line on Review, Context. Both read the chat data the book's writer
// keeps (ri_memory.trackerBook), so they never load the book to show a size.
import { h, button, section } from './dom.js';
import { registerPage } from './page-registry.js';
import { ctx, toast, isChatOpen } from '../st.js';
import { MEMORY } from '../memory/fold.js';

const STORY_PAGE = 'tracker-book';
const CONTEXT_PAGE = 'tracker-book-size';

const infoOf = () => { try { return ctx().chatMetadata?.[MEMORY]?.trackerBook || null; } catch { return null; } };
const tokens = n => `${Number(n || 0).toLocaleString('en-US')} ${Number(n) === 1 ? 'token' : 'tokens'}`;

/** The entries as a list: what each card or character holds and how large it is. */
function entryList(info) {
    const rows = (info.entries || []).map(entry => h('li', { class: 'ri-tracker-row', style: { display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '4px 0', borderBottom: '1px solid var(--ri-line, rgba(127,127,127,.25))' } },
        h('span', { class: 'ri-tracker-name' }, entry.comment), h('span', { class: 'ri-tracker-size', style: { whiteSpace: 'nowrap', opacity: '.75' } }, tokens(entry.tokens))));
    return rows.length ? h('ul', { class: 'ri-tracker-list', style: { listStyle: 'none', margin: '8px 0', padding: '0' } }, rows) : null;
}

const droppedNote = info => (info.dropped?.length
    ? h('p', { class: 'ri-note ri-note-warn' }, `Left out to stay inside the size limit: ${[...new Set(info.dropped.map(item => item.card))].join(', ')}. The recall block keeps sending those values.`)
    : null);

/** Story, World Info, Tracker book. */
export function renderTrackerBookPage(body, app) {
    const info = infoOf();
    const root = h('div', { class: 'ri-tracker', id: 'ri-tracker-book' });
    root.append(h('p', { class: 'ri-help' }, 'The current tracker values of this chat, kept as a World Info book the model reads every turn and the recall block leaves alone. It is rewritten after each reply is captured and after a swipe, an edit or a delete. Edits made in the World Info editor are replaced at the next rewrite. Correct a value with Correct a story fact.'));
    if (!isChatOpen()) root.append(h('p', { class: 'ri-help' }, 'Open a chat to see its Tracker book.'));
    else if (!info) root.append(h('p', { class: 'ri-help', id: 'ri-tracker-none' }, 'This chat has no Tracker book yet. It is written once a reply has tracker values.'));
    else if (info.refused) root.append(h('p', { class: 'ri-note ri-note-warn' }, `${info.name} was not written. ${info.refused}`));
    else {
        root.append(
            h('p', { class: 'ri-tracker-head' }, h('strong', {}, info.name)),
            h('p', { class: 'ri-help', id: 'ri-tracker-state' }, `Reflects reply ${info.reply}. Holds ${tokens(info.tokens)} of ${tokens(info.cap)}, sent with every request.`),
            entryList(info) || '', droppedNote(info) || '',
            h('div', { class: 'ri-row' },
                button('Open in World Info', async () => {
                    const { openHostBook } = await import('../chat-books.js');
                    if (!openHostBook(info.name)) toast('info', 'Open the World Info screen and pick this book from its list.');
                }, { kind: 'ghost' }),
                button('Rewrite now', async () => {
                    try {
                        const { trackerBook } = await import('../tracker-book.js');
                        const out = await trackerBook().write();
                        toast(out?.refused ? 'error' : 'success', out?.refused ? out.reason : 'The Tracker book now matches the replies shown.');
                        app?.render?.();
                    } catch (error) { toast('error', error.message); }
                }, { kind: 'ghost' })),
            h('p', { class: 'ri-help' }, 'Export it from the World Info screen with SillyTavern’s Export.'));
    }
    body.append(section('Tracker book', root));
}

/** Review, Context, Tracker book size. */
export function renderTrackerSizePage(body) {
    const info = infoOf();
    const text = !isChatOpen() ? 'Open a chat to see its Tracker book.'
        : !info ? 'This chat has no Tracker book yet.'
        : info.refused ? `${info.name} was not written. ${info.refused}`
        : `The Tracker book holds ${tokens(info.tokens)} of ${tokens(info.cap)}. It goes out with every request at depth 1, after the recall block.`;
    body.append(section('Tracker book', h('p', { class: 'ri-help', id: 'ri-tracker-size' }, text), info && !info.refused && entryList(info), info && droppedNote(info)));
}

let mounted = false;
export function mountTrackerBook() {
    if (mounted || !globalThis.SillyTavern?.getContext) return;
    mounted = true;
    registerPage({ id: STORY_PAGE, group: 'story', tab: 'world-info', subgroup: 'World Info', label: 'Tracker book', order: 1,
        help: 'The current tracker values as a World Info book the model reads, with its size and a link to the World Info editor. The same values are set as chat variables a preset block can read: {{getvar::ri_scene_place}} for the Scene card, {{getvar::ri_rel_<pair>_level}} for a relationship, {{getvar::ri_character_<name>_doing}} for a character, {{getvar::ri_emo_<name>_<field>}} for an emotion, and {{getvar::ri_plan}} for the plan. A card that is off sets none.',
        aliases: 'tracker values world info book constant scene characters emotions relationships export', render: renderTrackerBookPage });
    registerPage({ id: CONTEXT_PAGE, group: 'review', tab: 'context', subgroup: 'Context', label: 'Tracker book', order: 1,
        help: 'How many tokens the Tracker book adds to each request.', aliases: 'tracker book size tokens request', render: renderTrackerSizePage });
}
try { mountTrackerBook(); } catch (error) { console.warn('Roleplay Instructions could not add the Tracker book section.', error); }
