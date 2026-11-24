// B21: the Tracker World Info book. Run with:
//   node --test tests/t_tracker_book.js
// Chats are built in SillyTavern's own shape (replies with swipes, extra and chat metadata) and the book is written through
// the real modules in src/ with a World Info host in memory. The host's browser suite is t_tracker_book_host.js.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrackerBook, buildTrackerBook, latestTracker, trackerBookName, trackerEntries, addTrackerEntries, cardOfEntry, valueText } from '../src/tracker-book.js';
import { markerOf, bookMarkerOf, STAMP_ID } from '../src/memory/book-writer.js';
import { filterGeneratedEntries } from '../src/memory/story-world-book.js';
import { trackerCardsOf, trackerCarries, SIZE_CAPS } from '../src/memory/inject.js';
import { enabledFields } from '../src/memory/capture.js';
import { normalizeConfig, setMode, setOn } from '../src/cards/catalog.js';
import { MEMORY } from '../src/memory/fold.js';

const KEY = 'roleplay_instructions';
const clone = value => JSON.parse(JSON.stringify(value));
const results = [];
const record = (name, pass, detail = '') => { results.push({ name, pass: !!pass }); assert.ok(pass, `${name}: ${detail}`); };

const TRACKER = {
    scene: { place: 'The Gilded Hound, taproom', time: 'Day 3, Thursday, 21:40', weather: 'rain, cold', present: ['Hale', 'Marten'] },
    characters: [
        { name: 'Hale', doing: 'Wiping the same cup', mind: 'Counting exits' },
        { name: 'Marten', doing: 'Reading the ledger', mind: 'Weighing the offer' },
        { name: 'Dorn', doing: 'Asleep upstairs', mind: 'Nothing' },
    ],
    emotions: [{ name: 'Hale', axes: { tenderness: 2, fury: 1, dread: 4, yearning: 0 }, outward: 'Calm', counterweight: 'Relief' }, { name: 'Dorn', axes: { dread: 1 }, outward: 'Asleep' }],
    relationships: [{ name: 'Hale and Marten', pair: 'Hale and Marten', level: 3 }, { name: 'Dorn and Marten', pair: 'Dorn and Marten', level: 1 }],
};
const reply = (tracker, extra = {}) => ({ name: 'Hale', is_user: false, mes: 'The rain kept on.', swipe_id: 0, swipes: ['The rain kept on.'], swipe_info: [{ extra: {} }], extra: { [KEY]: { tracker: clone(tracker), ...extra } } });
const player = text => ({ name: 'You', is_user: true, mes: text, extra: {} });
const chatOf = (...trackers) => [reply({}), ...trackers.flatMap((t, i) => [player(`Move ${i + 1}`), reply(t)])];

// the tray as the extension ships it, with the relationship level switched on so a pair has a value to publish
const CONFIG = setOn(normalizeConfig({}), 'relationships.level', true);
const ENABLED = () => new Set(enabledFields({ trayCards: CONFIG }, {}).map(f => `${f.card}.${f.field}`));

/** A World Info host in memory. */
function makeHost({ chat, name = 'Hale, chat 1', books = new Map(), meta = {}, view = null } = {}) {
    const saves = [];
    const config = CONFIG;
    const host = {
        chat: () => chat,
        chatInfo: () => ({ id: name, name, avatar: 'hale.png', group: '' }),
        books: {
            load: async bookName => (books.has(bookName) ? clone(books.get(bookName)) : null),
            save: async (bookName, data) => { saves.push(bookName); books.set(bookName, clone(data)); },
            names: () => [...books.keys()], remove: async bookName => { books.delete(bookName); },
        },
        now: () => Date.now(), meta: () => meta, saveMeta: async () => {},
        view: async () => view || { config, theirs: new Set(), enabled: ENABLED(), cap: SIZE_CAPS.mid.tracker },
    };
    return { host, books, saves, meta, book: createTrackerBook({ host }) };
}
const bodyOf = data => Object.values(data.entries).filter(entry => markerOf(entry)?.id !== STAMP_ID);
const titles = data => bodyOf(data).map(entry => entry.comment);

test('one book per chat holds one entry per enabled card and one per present character', async () => {
    const chat = chatOf(TRACKER);
    const { book, books } = makeHost({ chat });
    await book.write();
    const data = books.get('RI Tracker, Hale, chat 1');
    record('the book is named for the chat', !!data && trackerBookName('Hale, chat 1') === 'RI Tracker, Hale, chat 1');
    record('it is marked as a generated Tracker book of this chat', bookMarkerOf(data)?.kind === 'tracker' && bookMarkerOf(data).chat.id === 'Hale, chat 1');
    const got = titles(data);
    record('the scene is one entry', got.includes('Scene'), got.join(' | '));
    record('each present character has a character entry and Dorn, who is not present, has none', got.includes('Characters: Hale') && got.includes('Characters: Marten') && !got.includes('Characters: Dorn'), got.join(' | '));
    record('emotions follow the present characters', got.includes('Emotions: Hale') && !got.includes('Emotions: Dorn'), got.join(' | '));
    record('a relationship that names a present character stays', got.includes('Relationships: Hale and Marten'), got.join(' | '));
    const scene = bodyOf(data).find(entry => entry.comment === 'Scene');
    record('an entry holds the values with their field labels', /Place: The Gilded Hound, taproom/.test(scene.content) && /Present: Hale, Marten/.test(scene.content), scene.content);
    const hale = bodyOf(data).find(entry => entry.comment === 'Emotions: Hale');
    record('a meter reads as plain words', /tenderness 2/.test(hale.content) && !/\{/.test(hale.content), hale.content);
    record('a card with no values has no entry', !got.some(title => /Inventory/.test(title)));
});

test('entries are Constant, hold current values only, and their size is kept for Review', async () => {
    const chat = chatOf(TRACKER, { ...TRACKER, scene: { ...TRACKER.scene, place: 'The cellar' } });
    const { book, books, meta } = makeHost({ chat });
    await book.write();
    const data = books.get('RI Tracker, Hale, chat 1');
    const body = bodyOf(data);
    record('every entry is Constant, at depth 1, as a system message', body.every(entry => entry.constant === true && entry.position === 4 && entry.depth === 1 && entry.role === 0 && entry.disable === false));
    record('only the current value is in the book', body.some(entry => /The cellar/.test(entry.content)) && !body.some(entry => /Gilded Hound/.test(entry.content)));
    const info = meta[MEMORY].trackerBook;
    const sum = body.reduce((total, entry) => total + Math.ceil(entry.content.length / 4), 0);
    record('chat data records the size Review shows, the cap and the reply', info.tokens === sum && info.cap === SIZE_CAPS.mid.tracker && info.reply === 2 && info.entries.length === body.length, JSON.stringify({ sum, info: info.tokens }));
    record('the cards the book carries are named for recall', ['scene', 'characters', 'emotions', 'relationships'].every(card => trackerCardsOf(meta).includes(card)), trackerCardsOf(meta).join());
    record('recall then leaves the emotion and relationship records and the scene line to the book', trackerCarries(trackerCardsOf(meta)).kinds.has('emotion') && trackerCarries(trackerCardsOf(meta)).sceneLine);
});

test('a swipe, an edit, a delete and a branch each rewrite the book to match what is shown', async () => {
    const swipeA = { ...TRACKER, scene: { ...TRACKER.scene, place: 'The yard' } };
    const swipeB = { ...TRACKER, scene: { ...TRACKER.scene, place: 'The stairs' } };
    const chat = chatOf(TRACKER, swipeA);
    const last = chat.at(-1);
    last.swipes.push('Another take.');
    last.swipe_info = [{ extra: { [KEY]: { tracker: clone(swipeA) } } }, { extra: { [KEY]: { tracker: clone(swipeB) } } }];
    const { book, books, saves, meta: trunkMeta } = makeHost({ chat });
    const name = 'RI Tracker, Hale, chat 1';
    const place = () => bodyOf(books.get(name)).find(entry => entry.comment === 'Scene').content;
    await book.write();
    record('the shown swipe is in the book', /The yard/.test(place()), place());
    // SillyTavern puts the chosen swipe's extra on the message
    last.swipe_id = 1; last.extra = clone(last.swipe_info[1].extra);
    await book.write();
    record('a swipe change rewrites the book with the other swipe\'s values', /The stairs/.test(place()) && !/The yard/.test(place()), place());
    last.mes = 'Edited reply.'; last.extra[KEY].tracker.scene.place = 'The attic';
    await book.write();
    record('an edit, once capture has read it, rewrites the book', /The attic/.test(place()), place());
    last.swipe_id = 0; last.extra = clone(last.swipe_info[0].extra); last.swipe_info[0].extra[KEY].tracker.scene.place = 'The yard';
    chat.splice(-2, 2);
    await book.write();
    record('a delete rewrites the book to the reply before it', /The Gilded Hound/.test(place()) && book.built().latest.number === 1, place());
    const before = saves.length;
    await book.write();
    record('a write with nothing changed saves nothing', saves.length === before);
    // a branch: its messages and chat data are copies, its chat has another name
    const branchChat = clone(chat);
    const trunkBefore = JSON.stringify(books.get(name));
    const branch = makeHost({ chat: branchChat, name: 'Hale, branch 2', books, meta: clone(trunkMeta) });
    await branch.book.write();
    branchChat.push(player('Branch move'), reply({ ...TRACKER, scene: { ...TRACKER.scene, place: 'The roof' } }));
    await branch.book.write();
    const branchBook = books.get('RI Tracker, Hale, branch 2');
    record('a branch gets its own book', !!branchBook && /The roof/.test(bodyOf(branchBook).find(entry => entry.comment === 'Scene').content));
    record('later changes in the branch never reach the first book', JSON.stringify(books.get(name)) === trunkBefore);
});

test('a chat with no tracker values gets no book, and a reply capture has not reached shows the reply before it', async () => {
    const empty = makeHost({ chat: [reply({}), player('hi'), reply({})] });
    const out = await empty.book.write();
    record('nothing is written for a chat without values', out.skipped === true && empty.books.size === 0);
    const chat = chatOf(TRACKER);
    chat.push(player('Next'), { ...reply({}), extra: {} });
    const late = makeHost({ chat });
    await late.book.write();
    record('a reply not yet captured shows the last captured values', latestTracker(chat).number === 1 && late.books.size === 1);
});

test('features set to Theirs and fields switched off put nothing in the book', async () => {
    const chat = chatOf(TRACKER);
    const config = CONFIG;
    const enabled = ENABLED();
    const theirs = new Set(['state', 'emotions']);
    const { book, books, meta } = makeHost({ chat, view: { config, theirs, enabled, cap: SIZE_CAPS.mid.tracker } });
    await book.write();
    const got = titles(books.get('RI Tracker, Hale, chat 1'));
    record('state on Theirs leaves out the scene and the characters', !got.some(title => /^Scene|^Characters/.test(title)), got.join(' | '));
    record('emotions on Theirs leave out the emotions', !got.some(title => /^Emotions/.test(title)));
    record('relationships stay', got.includes('Relationships: Hale and Marten'), got.join(' | '));
    record('recall keeps what the book does not carry', !trackerCardsOf(meta).includes('scene') && !trackerCardsOf(meta).includes('emotions') && trackerCardsOf(meta).includes('relationships'), trackerCardsOf(meta).join());
    // a field switched off in the tray is not published
    const noWeather = setOn(setMode(config, 'scene', 'tray'), 'scene.weather', false);
    const fields = new Set(enabledFields({ trayCards: noWeather }, {}).map(f => `${f.card}.${f.field}`));
    const quiet = makeHost({ chat, view: { config: noWeather, theirs: new Set(), enabled: fields, cap: SIZE_CAPS.mid.tracker } });
    await quiet.book.write();
    const scene = bodyOf(quiet.books.get('RI Tracker, Hale, chat 1')).find(entry => entry.comment === 'Scene');
    record('a switched-off field is left out', !/Weather/.test(scene.content) && /Place/.test(scene.content), scene.content);
    const off = setMode(config, 'plan', 'off');
    const planned = makeHost({ chat: chatOf({ ...TRACKER }), view: { config: off, theirs: new Set(), enabled, cap: SIZE_CAPS.mid.tracker } });
    planned.host.chat().at(-1).extra[KEY].v10Plan = 'Raise the stakes at the door.';
    await planned.book.write();
    record('the Director\'s desk with its card off is not published', !titles(planned.books.get('RI Tracker, Hale, chat 1')).includes('Director\'s desk'));
});

test('the Director\'s desk is published when its card is on, and goes first when the book is over its cap', async () => {
    const chat = chatOf(TRACKER);
    chat.at(-1).extra[KEY].v10Plan = 'Raise the stakes at the door. '.repeat(40);
    const wide = makeHost({ chat });
    await wide.book.write();
    record('the plan is an entry', titles(wide.books.get('RI Tracker, Hale, chat 1')).includes('Director\'s desk'));
    const tight = buildTrackerBook(chat, { config: normalizeConfig({}), enabled: ENABLED(), cap: 220 });
    record('over its cap the desk is dropped before any story card', !tight.entries.some(entry => entry.card === 'directorsDesk') && tight.dropped[0].card === 'directorsDesk' && tight.tokens <= 220, JSON.stringify(tight.dropped));
    record('the first entry says what was left out', /Left out to stay inside/.test(tight.stamp.text) && /directorsDesk/.test(tight.stamp.text));
});

test('the disabled first entry names the reply and where values are corrected, and an editor edit is replaced at the next rewrite', async () => {
    const chat = chatOf(TRACKER);
    const { book, books, saves, meta: trunkMeta } = makeHost({ chat });
    await book.write();
    const name = 'RI Tracker, Hale, chat 1';
    const stored = books.get(name);
    const first = stored.entries[0];
    record('the first entry is disabled and is the writer\'s stamp', first.disable === true && markerOf(first).id === STAMP_ID);
    record('it says edits in the editor are replaced at the next rewrite', /change made in the World Info editor is replaced at the next rewrite/.test(first.content), first.content);
    record('it points at Correct a story fact and names the reply', /Correct a story fact/.test(first.content) && /Reflects reply 1/.test(first.content), first.content);
    const scene = Object.values(stored.entries).find(entry => entry.comment === 'Scene');
    scene.content = 'Place: Somewhere I typed';
    scene.extensions.ri_generated.sig = 'stale';
    books.set(name, stored);
    const before = saves.length;
    const out = await book.write();
    const after = Object.values(books.get(name).entries).find(entry => entry.comment === 'Scene');
    record('the edit is replaced and nothing goes to the review list', out.saved && saves.length === before + 1 && /Gilded Hound/.test(after.content) && !/Somewhere I typed/.test(after.content) && !out.edits.length, JSON.stringify(out));
});

test('the Tracker book reaches the request: the guard leaves it in and its entries join the scan once', async () => {
    const chat = chatOf(TRACKER);
    const { book, books } = makeHost({ chat });
    await book.write();
    const name = 'RI Tracker, Hale, chat 1';
    const data = books.get(name);
    const lore = { globalLore: [], characterLore: [], chatLore: [], personaLore: [] };
    const added = addTrackerEntries(lore, { book: data, name });
    record('every body entry is added to the chat lore with its book name', added === bodyOf(data).length && lore.chatLore.every(entry => entry.world === name && entry.constant && entry.depth === 1 && entry.position === 4), String(added));
    record('the stamp entry is not added', !lore.chatLore.some(entry => entry.disable || markerOf(entry)?.id === STAMP_ID));
    const guard = filterGeneratedEntries([lore.chatLore]);
    record('the generated-book guard keeps them', guard.removed === 0 && lore.chatLore.length === added);
    record('a second pass adds nothing when the book is attached by hand', addTrackerEntries(lore, { book: data, name }) === 0);
    const theirs = { globalLore: [], characterLore: [], chatLore: [], personaLore: [] };
    addTrackerEntries(theirs, { book: data, name, theirs: new Set(['emotions']) });
    record('an entry whose feature went to Theirs after the write is not sent', !theirs.chatLore.some(entry => /^Emotions/.test(entry.comment)) && theirs.chatLore.some(entry => /^Scene/.test(entry.comment)));
    record('each entry carries its card', bodyOf(data).every(entry => cardOfEntry(entry)));
    record('no emoji in any entry', !Object.values(data.entries).some(entry => /\p{Extended_Pictographic}/u.test(`${entry.comment}${entry.content}${entry.key.join('')}`)));
});

test('values read as plain text and emoji the model wrote are dropped', () => {
    record('a carried value reads as its value', valueText({ v: 'rain', from: 3 }) === 'rain');
    record('a list joins with commas', valueText(['Hale', { v: 'Marten' }]) === 'Hale, Marten');
    record('emoji are removed', valueText('Calm \u{1F600} and still') === 'Calm and still');
    const entries = trackerEntries(latestTracker(chatOf({ scene: { place: 'A \u{1F525} hall' } })), { enabled: new Set(['scene.place']) });
    record('an entry holds no emoji', entries.length === 1 && !/\p{Extended_Pictographic}/u.test(entries[0].content), entries[0]?.content);
});
