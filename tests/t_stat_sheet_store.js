// MB14: stat sheets as Stat sheet records in the memory log. Run with: node --test tests/t_stat_sheet_store.js
// A fake SillyTavern host records every model request. Covers: the persona's and the character's sheets after the first
// reply, each stat with its quoted reason, anchored to the first message so a branch keeps them; a locked stat through
// inference, a level-up capture, a rebuild and a catch-up; an NPC described in World Info getting one added, disabled entry
// in its book with every other entry byte-identical, and nothing written at "Story may add to this book" Off; an NPC who
// first appears in play losing the sheet with that reply (delete or swipe) and getting it again at the next appearance;
// the move of 10.0.48's per-chat sheets; and capture's new Person records starting a sheet.
import assert from 'node:assert/strict';
import test from 'node:test';

const KEY = 'roleplay_instructions';
const listeners = new Map();
const requests = [];
const books = new Map();
let answers = [];
const host = {
    extensionSettings: { [KEY]: {}, connectionManager: { profiles: [] }, disabledExtensions: [] },
    saveSettingsDebounced() {}, saveMetadata() {}, saveMetadataDebounced() {}, saveChat: async () => {}, saveChatDebounced() {},
    getCurrentChatId: () => 'chat-1', chat: [], chatMetadata: {}, name1: 'Mira', name2: 'Captain Hale', characterId: 0,
    characters: [{ avatar: 'hale.png', description: 'A scarred harbor captain, strong as an ox and slow to trust.', personality: 'Stern.', scenario: '' }],
    powerUserSettings: { persona_description: 'Mira is a quick-witted smuggler with nimble fingers.' },
    mainApi: 'openai', chatCompletionSettings: { chat_completion_source: 'openrouter', custom_include_body: '' },
    getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
    getPresetManager: () => ({ getCompletionPresetByName: () => undefined }),
    ConnectionManagerRequestService: { getSupportedProfiles: () => [] },
    substituteParams: text => String(text).replaceAll('{{user}}', host.name1).replaceAll('{{char}}', host.name2),
    setExtensionPrompt() {},
    eventTypes: Object.fromEntries(['GENERATION_AFTER_COMMANDS', 'MESSAGE_RECEIVED', 'GENERATION_ENDED', 'GENERATION_STOPPED', 'CHAT_CHANGED', 'CHAT_CREATED'].map(n => [n, n])),
    eventSource: { on: (type, fn) => { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); } },
    getWorldInfoNames: () => [...books.keys()],
    loadWorldInfo: async name => structuredClone(books.get(name)),
    saveWorldInfo: async (name, data) => { books.set(name, structuredClone(data)); },
    generateRaw: async args => { requests.push(args); return answers.shift() ?? '{"sheets":[]}'; },
};
globalThis.SillyTavern = { getContext: () => host };
globalThis.toastr = { warning() {}, info() {}, error() {} };
globalThis.document ??= { createElement: () => ({ getContext: () => ({}) }), documentElement: {}, body: {} };
globalThis.MutationObserver ??= class { observe() {} };

const dice = await import('../src/dice.js');
const judgeMod = await import('../src/dice-judge.js');
const sheets = await import('../src/stat-sheets.js');
const routing = await import('../src/routing.js');
const store = await import('../src/store.js');
const fold = await import('../src/memory/fold.js');
const memStore = await import('../src/memory/store.js');
const catchup = await import('../src/memory/catchup.js');
const sheetStore = await import('../src/memory/stat-sheet-store.js');
await judgeMod.startDice();
dice.setDiceFeatureReader(null);
const records = await sheetStore.installSheetStore();
const memory = memStore.memoryStore();

const T0 = Date.parse('2026-11-26T10:00:00.000Z');
let minute = 0;
const stamp = () => new Date(T0 + (minute++) * 60000).toISOString();
const user = text => ({ is_user: true, name: 'Mira', mes: text, send_date: stamp(), extra: {} });
const reply = text => { const send_date = stamp(); return { is_user: false, name: 'Captain Hale', mes: text, send_date, swipe_id: 0, swipes: [text], swipe_info: [{ send_date, extra: {} }], extra: {} }; };
const sheetLog = () => (host.chatMetadata.ri_memory?.log || []).filter(e => e.record?.kind === 'stat sheet');

function reset() {
    host.extensionSettings[KEY] = {};
    host.chatMetadata = {};
    host.chat = [reply('The harbor is grey with fog when Captain Hale meets you on the pier.')];
    requests.length = 0; answers = []; books.clear();
    routing.setJobChain('statSheets', [{ route: 'main' }]);
    store.settings().dice.on = true;
    // What CHAT_CHANGED does when a chat opens: earlier per-chat sheets move into records (none in a new chat).
    records.moveLegacy();
}

const CARD_ANSWER = JSON.stringify({ sheets: [
    { who: 'Mira', stats: [{ stat: 'Agility', value: 3, reason: '"nimble fingers"' }, { stat: 'Wits', value: 2, reason: '"quick-witted"' }] },
    { who: 'Captain Hale', stats: [{ stat: 'Strength', value: 4, reason: '"strong as an ox"' }, { stat: 'Charm', value: -1, reason: '"slow to trust"' }] },
] });

// ---------------------------------------------------------------- persona and character

test('after the first reply of a new chat the persona and character sheets exist as records, each stat with a quoted reason, anchored to the first message', async () => {
    reset();
    answers = [CARD_ANSWER];
    await sheets.inferChatSheets();
    host.chat.push(user('I try to climb onto the deck.'), reply('You haul yourself over the rail.'));
    const all = records.sheets();
    assert.deepEqual(Object.keys(all).sort(), ['char', 'user']);
    assert.deepEqual(all.user.stats, { Agility: 3, Wits: 2 });
    assert.deepEqual(all.char.stats, { Strength: 4, Charm: -1 });
    for (const sheet of [all.user, all.char]) for (const stat of Object.keys(sheet.stats)) assert.match(sheet.reasons[stat], /^".+"$/, `${sheet.name} ${stat} quotes its source`);
    const log = sheetLog();
    assert.equal(log.length, 2, 'two Stat sheet records in the chat metadata log');
    for (const e of log) {
        assert.equal(e.origin.type, 'inference');
        assert.equal(e.anchor.mark, fold.storedMark(host.chat[0]), 'anchored to the first message');
        assert.equal(e.anchor.swipe, undefined, 'no swipe in the anchor, so another greeting keeps it');
    }
    assert.equal(dice.sheet('user').Agility, 3, 'a roll reads the record');
    // a branch copies the messages up to its point and the metadata: the sheets come with it
    const branchChat = structuredClone(host.chat.slice(0, 2));
    const branchMeta = structuredClone(host.chatMetadata);
    const saved = [host.chat, host.chatMetadata];
    host.chat = branchChat; host.chatMetadata = branchMeta;
    assert.deepEqual(records.sheets().user.stats, { Agility: 3, Wits: 2 }, 'a branch keeps the sheets');
    [host.chat, host.chatMetadata] = saved;
});

test('a locked stat is unchanged after inference, a level-up capture, a rebuild and a catch-up', async () => {
    reset();
    answers = [CARD_ANSWER];
    await sheets.inferChatSheets();
    host.chat.push(user('I try to slip the knot.'), reply('The rope gives.'));
    dice.setStat('user', 'Agility', -2);
    let mine = records.sheet('user');
    assert.equal(mine.stats.Agility, -2);
    assert.equal(mine.mine.Agility, true, 'marked as hers');
    const you = sheetLog().at(-1);
    assert.equal(you.origin.type, 'you', 'her edit is a you entry');
    assert.deepEqual(you.record.set, { Agility: -2 });
    // 1. inference again
    answers = [JSON.stringify({ sheets: [{ who: 'Mira', stats: [{ stat: 'Agility', value: 5, reason: 'nimble' }, { stat: 'Wits', value: 4, reason: 'clever' }] }] })];
    await sheets.inferChatSheets({ force: true });
    assert.equal(records.sheet('user').stats.Agility, -2, 'inference');
    assert.equal(records.sheet('user').stats.Wits, 4, 'other stats still infer');
    // 2. a level-up capture files from the story
    records.levelUp('user', { Agility: 2, Strength: 1 }, { index: 2 });
    assert.equal(records.sheet('user').stats.Agility, -2, 'level-up');
    assert.equal(records.sheet('user').stats.Strength, 1, 'the level-up lands on stats she did not set');
    assert.deepEqual(sheetLog().at(-1).anchor, { mark: fold.storedMark(host.chat[2]), swipe: 0 }, 'the level-up hangs on its reply');
    // a capture-origin entry that writes the stat anyway (a model that ignored the lock) is overruled by her entry
    const job = memory.begin(2);
    await memory.commit(job, [{ op: 'revise', target: ['sheet:user'], record: { id: 'sheet:user', kind: 'stat sheet', who: 'user', stats: { Agility: 6, Wits: 4, Strength: 1 } }, origin: { type: 'capture', route: 'desktop' } }]);
    assert.equal(records.sheet('user').stats.Agility, -2, 'capture entry on the reply');
    // 3. a rebuild retires every record a model made, but not stat sheets
    const rebuilt = await catchup.retireModelMade(memory, { type: 'catch-up' });
    assert.ok(!catchup.modelMadeIds(memory.view()).includes('sheet:user'), 'a rebuild leaves stat sheets');
    void rebuilt;
    assert.equal(records.sheet('user').stats.Agility, -2, 'rebuild');
    // 4. a catch-up entry in the log
    await memory.record([{ op: 'revise', target: ['sheet:user'], record: { id: 'sheet:user', kind: 'stat sheet', who: 'user', stats: { Agility: 4 } }, origin: { type: 'catch-up', route: 'desktop' }, anchor: null }]);
    assert.equal(records.sheet('user').stats.Agility, -2, 'catch-up');
    // she gives it back: the model-made value shows again, here the capture entry filed on the reply (later in the story
    // than the chat-start inference, so it applies last)
    assert.equal(sheets.releaseStat('user', 'Agility'), true);
    assert.equal(records.sheet('user').stats.Agility, 6, 'released: the story\'s value shows');
    assert.equal(records.sheet('user').mine.Agility, undefined);
});

test('a sheet carried over locked stays locked: an inference becomes a review flag and changes nothing', async () => {
    reset();
    await memory.record([{ op: 'add', record: { id: 'sheet:npc:brannic', kind: 'stat sheet', subject: 'Brannic', text: 'Strength 2, Wits 1' }, origin: { type: 'carry-over' }, anchor: null }]);
    await memory.record([{ op: 'lock', target: ['sheet:npc:brannic'], origin: { type: 'carry-over' }, anchor: null }]);
    assert.deepEqual(records.sheet('Brannic').stats, { Strength: 2, Wits: 1 }, 'read from the carried text');
    sheets.applyInferred('Brannic', { name: 'Brannic', stats: { Strength: 5, Will: 3 } });
    assert.deepEqual(records.sheet('Brannic').stats, { Strength: 2, Wits: 1 });
    assert.ok(memory.view().flags.some(f => f.kind === 'locked-record'), 'held for review');
});

// ---------------------------------------------------------------- NPCs

const HARBOR = { entries: {
    0: { uid: 0, key: ['Brannic'], comment: 'Brannic', content: 'Brannic is a hulking dockhand who can lift a cask alone but cannot read.', disable: false, order: 100 },
    1: { uid: 1, key: ['harbor', 'pier'], comment: 'The harbor', content: 'Fog most mornings.\nGulls everywhere.', disable: false, order: 50 },
} };
const BRANNIC = JSON.stringify({ sheets: [{ who: 'Brannic', stats: [{ stat: 'Strength', value: 5, reason: '"lift a cask alone"' }, { stat: 'Wits', value: -2, reason: '"cannot read"' }] }] });

test('an NPC described in World Info gets one added, disabled entry in its book; every other entry stays byte-identical; deleting the reply keeps the sheet', async () => {
    reset();
    books.set('Harbor book', structuredClone(HARBOR));
    host.chatMetadata.world_info = 'Harbor book';
    host.chat.push(user('I wave at the dockhand.'), reply('Brannic looks up from the casks.'));
    answers = [BRANNIC];
    const before = Object.fromEntries(Object.entries(HARBOR.entries).map(([uid, e]) => [uid, JSON.stringify(e)]));
    const sheet = await sheets.inferNpcSheet('Brannic');
    assert.deepEqual(sheet.stats, { Strength: 5, Wits: -2 });
    assert.equal(sheet.source, 'book');
    const saved = books.get('Harbor book');
    assert.equal(Object.keys(saved.entries).length, 3, 'one entry added');
    for (const [uid, text] of Object.entries(before)) assert.equal(JSON.stringify(saved.entries[uid]), text, `entry ${uid} is byte-identical`);
    const added = Object.values(saved.entries).find(e => e.comment === 'Stats: Brannic');
    assert.equal(added.disable, true, 'disabled, never sent');
    const row = host.chatMetadata.ri_memory.additions.find(r => r.what === 'stat sheet');
    assert.deepEqual([row.book, row.kind, row.uid], ['Harbor book', 'entry', added.uid], 'listed in the additions log for History and Undo');
    // the chat's record hangs on the first message, so deleting the reply where Brannic appeared keeps it
    assert.equal(sheetLog().find(e => e.record.who === 'npc:brannic').anchor.mark, fold.storedMark(host.chat[0]));
    host.chat.splice(1, 2);
    assert.deepEqual(records.sheet('Brannic')?.stats, { Strength: 5, Wits: -2 }, 'the base sheet stays');
    // this chat's change is a record over the base sheet; the book entry is unchanged by it
    dice.setStat('Brannic', 'Wits', 1);
    assert.equal(records.sheet('Brannic').stats.Wits, 1);
    assert.match(Object.values(books.get('Harbor book').entries).find(e => e.comment === 'Stats: Brannic').content, /Wits: -2/, 'each chat keeps its own sheet');
});

test('at "Story may add to this book" Off the NPC sheet stays in chat data and the book is not written', async () => {
    reset();
    books.set('Harbor book', structuredClone(HARBOR));
    host.chatMetadata.world_info = 'Harbor book';
    store.settings().memory = { bookAdditions: { 'Harbor book': 'off' } };
    answers = [BRANNIC];
    const sheet = await sheets.inferNpcSheet('Brannic');
    assert.equal(sheet.stats.Strength, 5);
    assert.equal(JSON.stringify(books.get('Harbor book')), JSON.stringify(HARBOR), 'the book is byte-identical');
});

test('an NPC who first appears in play: the sheet hangs on that reply; deleting or swiping it away removes the sheet, and the next appearance infers it again', async () => {
    reset();
    host.chat.push(user('I walk to the market.'), reply('Old Tess watches everything from her stall.'));
    answers = [JSON.stringify({ sheets: [{ who: 'Old Tess', stats: [{ stat: 'Senses', value: 3, reason: '"watches everything"' }] }] })];
    const sheet = await sheets.inferNpcSheet('Old Tess', { storyText: 'Old Tess watches everything from her stall.' });
    assert.equal(sheet.stats.Senses, 3);
    const entries = sheetLog().filter(e => e.record.who === 'npc:old tess');
    assert.ok(entries.length >= 1);
    for (const e of entries) assert.deepEqual(e.anchor, { mark: fold.storedMark(host.chat[2]), swipe: 0 }, 'anchored to the reply where she appeared');
    // swipe that reply away: the sheet goes with it, and comes back on swiping back
    const m = host.chat[2];
    m.swipe_info[0].extra = structuredClone(m.extra);
    m.swipes.push('The market is empty.'); m.swipe_info.push({ send_date: stamp(), extra: structuredClone(m.extra) }); m.swipe_id = 1; m.mes = 'The market is empty.';
    assert.equal(records.sheet('Old Tess'), null, 'swiped away');
    m.swipe_id = 0; m.mes = m.swipes[0];
    assert.equal(records.sheet('Old Tess')?.stats.Senses, 3, 'back with the swipe');
    // delete the reply
    host.chat.splice(2, 1);
    assert.equal(records.sheet('Old Tess'), null, 'deleting the reply removes the sheet');
    assert.equal(sheets.sheetOf('Old Tess'), null, 'B22\'s reads agree');
    // she appears again: one more inference call, anchored to the new reply
    host.chat.push(reply('Old Tess counts her coins twice.'));
    requests.length = 0;
    answers = [JSON.stringify({ sheets: [{ who: 'Old Tess', stats: [{ stat: 'Wits', value: 1, reason: '"counts her coins twice"' }] }] })];
    const again = await sheets.inferNpcSheet('Old Tess', { storyText: 'Old Tess counts her coins twice.' });
    assert.equal(requests.length, 1, 'inferred again');
    assert.deepEqual(again.stats, { Wits: 1 });
});

test('an attempt before a sheet exists rolls on a plain sheet, every modifier 0', () => {
    reset();
    host.chat.push(reply('A stranger in grey reaches for your purse.'));
    const plain = sheets.ensurePlainSheet('stranger in grey', 'stranger in grey', 'play');
    assert.equal(plain.plain, true);
    assert.deepEqual(plain.stats, {});
    const roll = dice.rollAttempt({ actor: 'stranger in grey', attempt: 'steal the purse', stat: 'Agility', step: 'Fair', stance: 'resisting' }, { random: () => 9 });
    assert.equal(roll.mod, 0);
});

test('10.0.48 per-chat sheets move into records once: inferred values as inference, hers as hers', () => {
    reset();
    // a chat saved by 10.0.48, opened now
    host.chatMetadata = {};
    host.chatMetadata[KEY] = { statSheets: { user: { name: 'Mira', kind: 'persona', stats: { Agility: 1, Charm: 2 }, reasons: { Agility: 'nimble' }, mine: { Charm: true }, source: 'card' } } };
    const moved = records.moveLegacy();
    assert.equal(moved, 2, 'an add and her values');
    assert.deepEqual(records.sheet('user').stats, { Agility: 1, Charm: 2 });
    assert.deepEqual(records.sheet('user').mine, { Charm: true });
    assert.equal(records.moveLegacy(), 0, 'once per chat');
    sheets.applyInferred('user', { name: 'Mira', stats: { Agility: 4, Charm: 5 } });
    assert.deepEqual(records.sheet('user').stats, { Agility: 4, Charm: 2 }, 'inference changes only what was not hers');
});

test('capture\'s new Person records name the NPCs whose sheets start at first appearance, never the persona or the character', () => {
    const entries = [
        { op: 'add', record: { kind: 'person', subject: 'Old Tess' } },
        { op: 'add', record: { kind: 'person', subject: 'Captain Hale' } },
        { op: 'revise', record: { kind: 'person', subject: 'Brannic' } },
        { op: 'add', record: { kind: 'fact', subject: 'Night' } },
        { op: 'add', record: { kind: 'person', subject: 'Piers Vell' } },
        { op: 'add', record: { kind: 'person', subject: 'Ser Jory' } },
    ];
    assert.deepEqual(sheetStore.newPeople(entries, { user: 'Mira', char: 'Captain Hale' }), ['Old Tess', 'Piers Vell'], 'at most two a reply');
});

test('sheet strings hold no emoji and no dash', () => {
    for (const text of [sheetStore.sheetText({ Strength: 2, Wits: -1 })]) {
        assert.doesNotMatch(text, /\p{Extended_Pictographic}/u);
        assert.doesNotMatch(text, new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`), 'no en or em dash');
    }
    assert.deepEqual(sheetStore.statsFromText('Strength +2, Wits -1, Will 3'), { Strength: 2, Wits: -1, Will: 3 });
});
