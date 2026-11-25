// B20: the parity cards and sections (src/ui/cards/, src/cards/catalog.js). A fixture chat holds one reply shaped like
// each of Vexa, Neon Sola, Deus Ex Machina (add-ons on) and Pura's Director (trackers on), in our own words, with the
// per-reply values capture saves; every B20 card and section is drawn from them through buildTrayCards. Also: the
// catalog switches and capture's field list, merged overlaps, the Choices Options call and its Sent receipt, New faces,
// stars and severity marks, and no emoji or dashes in anything drawn. The host pass (390 px, the four story styles,
// screenshots and the request log) is recorded in docs/ux-overhaul/tickets/B20.md.
// Run with: node --test tests/t_parity_cards.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, test } from 'node:test';

// A small DOM, enough for the templates and the card buttons.
class Node_ { constructor() { this.children = []; this.parentNode = null; } }
class Text_ extends Node_ { constructor(text) { super(); this.nodeValue = String(text); } get textContent() { return this.nodeValue; } }
class El_ extends Node_ {
    constructor(tag) { super(); this.tagName = tag.toUpperCase(); this.attrs = {}; this.style = {}; this.listeners = {}; this.dataset = {}; }
    get className() { return this.attrs.class || ''; }
    set className(value) { this.attrs.class = value; }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    getAttribute(name) { return this.attrs[name] ?? null; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    appendChild(node) { node.parentNode = this; this.children.push(node); return node; }
    append(...nodes) { for (const node of nodes) this.appendChild(typeof node === 'string' ? new Text_(node) : node); }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    matches() { return false; }
    get textContent() { return this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this.children = [new Text_(value)]; }
    get lastChild() { return this.children.at(-1) || null; }
    find(predicate, out = []) { if (predicate(this)) out.push(this); for (const child of this.children) if (child instanceof El_) child.find(predicate, out); return out; }
}
globalThis.Node = Node_;
globalThis.document = { createElement: tag => new El_(tag), createTextNode: text => new Text_(text), documentElement: {}, body: { dataset: {} }, querySelectorAll: () => [], querySelector: () => null };
globalThis.MutationObserver ??= class { observe() {} };

const KEY = 'roleplay_instructions';
let host;
const makeHost = chat => ({ name1: 'Heather', name2: 'Hale of Verath', extensionSettings: {}, chat, chatMetadata: {}, characters: [], getCurrentChatId: () => 'chat-a',
    saveSettingsDebounced() {}, saveMetadataDebounced() {}, saveChat: async () => {} });
host = makeHost([]);
globalThis.SillyTavern = { getContext: () => host };

const catalog = await import('../src/cards/catalog.js');
const { buildTrayCards } = await import('../src/ui/reply-cards.js');
const parity = await import('../src/ui/cards/index.js');
const choices = await import('../src/ui/cards/choices.js');
const faces = await import('../src/ui/cards/new-faces.js');
const achievements = await import('../src/ui/cards/achievements.js');
const conditions = await import('../src/ui/cards/characters.js');
const inventory = await import('../src/ui/cards/inventory.js');
const knowledge = await import('../src/ui/cards/knowledge.js');
const map = await import('../src/ui/cards/map.js');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const EMOJI = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\u{FE0F}]/u;
// Typographic marks the templates use on purpose: block meters, stars and the carets of a change chip are not emoji.
const ALLOWED = /[▮▯★☆]/gu;
const DASH = /[–—]/;

const flat = nodes => [nodes].flat(8).filter(node => node instanceof Node_);
const textOf = nodes => flat(nodes).map(node => node.textContent).join('\n');
const all = (nodes, predicate) => flat(nodes).flatMap(node => (node instanceof El_ ? node.find(predicate) : []));
const buttons = (nodes, label) => all(nodes, el => el.tagName === 'BUTTON' && el.textContent === label);
const icons = nodes => all(nodes, el => el.tagName === 'I').map(el => el.className);

// ---------- the fixture chat: four replies in the shape of each preset, our own words ----------

const B20_CARDS = ['map', 'holding_back', 'knowledge', 'inventory', 'plot', 'new_faces', 'reputation', 'achievements', 'plan', 'choices', 'notebook', 'roast',
    'emotions', 'relationships', 'characters', 'scene'];

/** Every card in the tray and every section and field switched on. */
function everythingOn() {
    const config = { on: {}, mode: {} };
    for (const { card, section, key } of catalog.allFields()) { config.on[key] = true; config.on[catalog.sectionKey(card.id, section.id)] = true; }
    for (const card of catalog.CARDS) config.mode[card.id] = 'tray';
    return catalog.normalizeConfig(config);
}

const reply = (tracker, extra = {}) => ({ is_user: false, name: 'Hale of Verath', mes: 'The lamp gutters in the taproom.', swipe_id: 0, extra: { [KEY]: { time: 't', tracker, ...extra } } });
const player = text => ({ is_user: true, name: 'Heather', mes: text, extra: {} });

// Vexa: World Map, Dam, Memory, Inventory, Notebook.
const VEXA = {
    map: { grid: ['#########', '#H..T..D#', '#...M...#', '####=####', 'H: Hale', 'M: Marten', 'T: the long table', 'D: the cellar door'] },
    holding_back: { dam: 'Hale to Heather | answers every question about the ledger | that he signed it himself | strain rising' },
    knowledge: { remembers: ['Hale: the night the warehouse burned', 'Marten: the price Heather paid for the boat'] },
    inventory: { items: 'Heather: brass key (gained) | taken from the clerk\'s desk\nHale: ledger page (given) | handed to Marten' },
    notebook: { narrator: ['Marten has not said where he slept.', 'Does the cellar door lock from inside?'] },
};
// Sola: Director's Desk (Dare, Course, Branches, Graded) and Horizon.
const SOLA = {
    plan: { course: 'The ledger leads to the harbor master by nightfall.', pressure: 'Marten dares Heather to open the cellar door.',
        branches: ['Open the cellar now', 'Follow Marten to the docks', 'Burn the ledger page'], graded: 'The reveal landed: Hale stopped lying.' },
};
// Deus with add-ons: Psychological States, Hidden Truths, New Faces, Diaries, Companions.
const DEUS = {
    emotions: [{ name: 'Hale', side: 'the careful clerk', read: 'as a test of loyalty', feeling: 'cornered pride', acted: 'he slid the ledger across', ends: 'waiting for her verdict' }],
    knowledge: { secrets: ['Hale forged the harbor seal | owner: Hale | also known by: Marten'], beliefs: ['Heather believes: Marten works for the guild | truth: he works for the harbor master'] },
    new_faces: { sheet: ['Ilse Varga (major) | harbor master\'s clerk | grey coat, ink on both hands | precise, never hurried | the forged seal found | who signed the ledger',
        'Tobin (minor) | a dock boy who runs messages for coin'] },
    notebook: { diaries: ['Hale: I gave her the page. I do not know yet if that was courage.', 'Marten: She trusts the wrong man, and the wrong man is me.'] },
    roast: { panel: ['Wren: Three people in one room and nobody says the obvious thing.', 'Odo: That cellar door is doing a lot of work.'] },
};
// Pura with trackers on: Relationship, Status and Conditions, Achievements, Reputation, World Detail.
const PURA = {
    relationships: [{ name: 'Hale', route: 'reluctant ally', stands: 'owes her a debt', feels: 'wary respect', trust_want: 'trusts her with the ledger, wants her silence',
        delights: 'her bluntness; repelled by her temper', moment: 'the burned warehouse', next: 'her keeping the forged seal to herself' }],
    characters: [{ name: 'Hale', conditions: 'burned left hand (moderate); no sleep (mild)' }, { name: 'Marten', conditions: [{ condition: 'knife wound', severity: 'severe' }] }],
    achievements: { earned: 'Ledger Breaker | 3 | made Hale confess the forgery' },
    reputation: { standing: 'Dock guild | a debtor who pays | rising | she paid the fine in coin\nHarbor watch | a nuisance | falling | seen near the burned warehouse' },
    scene: { place: 'The Gilded Hound, taproom', time: 'Day 3, 21:40', detail: 'Rain drums on the tin roof over the cellar stairs.' },
};

const CHOICES = { hash: '', reply: 4, route: 'main', model: '', attempts: 1, at: 1, outcome: 'completed', reason: '',
    items: [{ title: 'Open the cellar', text: 'I take the brass key and open the cellar door.', skill: 'Nerve' },
        { title: 'Ask Ilse', text: 'I ask Ilse who signed the ledger.', skill: 'Persuasion' },
        { title: 'Follow Marten', text: 'I follow Marten out to the docks.', skill: 'Stealth' },
        { title: 'Burn the page', text: 'I hold the ledger page to the lamp.', skill: '' }] };

function fixtureChat() {
    return [{ is_user: false, name: 'Hale of Verath', mes: 'Opening.', extra: {} },
        player('I ask about the ledger.'), reply(VEXA),
        player('I watch Marten.'), reply(SOLA),
        player('I ask who forged the seal.'), reply(DEUS),
        player('I wait.'), reply(PURA, { choices: CHOICES })];
}

/** Thread records as capture files them, in the chat log, for the Plot sections. */
function threadLog() {
    const thread = (id, threadType, text, extra = {}) => ({ id: `e-${id}`, seq: Number(id.replace(/\D/g, '')) || 1, at: 1, op: 'add', record: { id, kind: 'thread', threadType, subject: 'Harbor', text, ...extra } });
    return { log: [thread('t1', 'Track', 'The guild war | Marten met the guild at the docks'), thread('t2', 'Pending', 'Pay the harbor fine | the boat is seized | Day 5', { story_time: 'Day 5' }),
        thread('t3', 'Plotline', 'The forged seal | rising'), thread('t4', 'Elsewhere', 'Marten | meets the guild at the docks'), thread('t5', 'Detail', 'The cellar door locks from inside | someone hides there'),
        thread('t6', 'Open', 'Who burned the warehouse')] };
}

const viewFor = (chat, index, extra = {}) => ({ id: index, rec: chat[index].extra[KEY], modules: {}, snapshot: {}, showState: false, people: [], profiles: [], records: [],
    planning: '', roast: '', strip: null, presentNames: [], saved: null, latest: true, redraw() {}, extras: {}, ...extra });

beforeEach(() => {
    host = makeHost(fixtureChat());
    host.chatMetadata = { ri_memory: threadLog() };
    globalThis.SillyTavern = { getContext: () => host };
});

function drawAll() {
    const config = everythingOn();
    const out = {};
    for (const index of [2, 4, 6, 8]) for (const card of buildTrayCards(viewFor(host.chat, index), config)) (out[card.id] ||= []).push({ index, card, body: card.body ? flat(card.body()) : [] });
    return out;
}

// ---------- the catalog ----------

test('every B20 card, section and field is built and starts off', () => {
    const config = catalog.normalizeConfig(undefined);
    let checked = 0;
    for (const card of catalog.CARDS) for (const section of card.sections) {
        if (section.owner !== 'B20') continue;
        assert.ok(catalog.isBuilt(section), `${card.id}:${section.id} is built`);
        for (const field of section.fields) {
            assert.equal(catalog.fieldOn(config, card.id, field.id), section.today === true, `${card.id}.${field.id} default`);
            checked++;
        }
    }
    for (const id of ['map', 'holding_back', 'inventory', 'new_faces', 'reputation', 'achievements', 'choices', 'notebook']) assert.equal(catalog.cardMode(config, id), 'off', `${id} starts off`);
    assert.ok(checked >= 35, `checked ${checked} fields`);
});

test('the default capture list asks for no B20 field; switching one card or section on adds only its own fields; off adds nothing', () => {
    const base = catalog.captureFields(catalog.normalizeConfig(undefined)).map(item => item.key);
    const b20 = new Set(catalog.allFields().filter(({ field }) => field.owner === 'B20').map(({ key }) => key));
    assert.deepEqual(base.filter(key => b20.has(key)), [], 'nothing of B20 is asked for by default');
    for (const card of catalog.CARDS) for (const section of card.sections) {
        if (section.owner !== 'B20') continue;
        let config = catalog.setMode(catalog.normalizeConfig(undefined), card.id, 'tray');
        for (const other of card.sections) if (other.owner === 'B20') config = catalog.setOn(config, catalog.sectionKey(card.id, other.id), other === section);
        for (const field of section.fields) config = catalog.setOn(config, catalog.fieldKey(card.id, field.id), true);
        const keys = catalog.captureFields(config).map(item => item.key).filter(key => !base.includes(key));
        const own = section.fields.filter(field => !field.derived).map(field => catalog.fieldKey(card.id, field.id));
        assert.deepEqual(keys.sort(), own.sort(), `${card.id}:${section.id} adds its own fields`);
        const off = catalog.setMode(config, card.id, 'off');
        assert.deepEqual(catalog.captureFields(off).map(item => item.key).filter(key => !base.includes(key)), [], `${card.id} off adds nothing`);
    }
});

test('every B20 field capture fills has a hint in the card\'s shape, passed with the field; hints hold no emoji or dash', () => {
    const fields = catalog.captureFields(everythingOn());
    for (const { field, key } of catalog.allFields()) {
        if (field.owner !== 'B20' || field.derived) continue;
        assert.ok(catalog.HINTS[key], `${key} has a hint`);
        assert.equal(fields.find(item => item.key === key)?.hint, catalog.HINTS[key], `${key} hint reaches capture`);
    }
    for (const [key, hint] of Object.entries(catalog.HINTS)) {
        assert.ok(!EMOJI.test(hint) && !DASH.test(hint), `${key} hint is plain`);
        assert.ok(catalog.allFields().some(item => item.key === key), `${key} is a catalog field`);
    }
    assert.ok(fields.find(item => item.key === 'choices.moves') === undefined, 'Choices comes from its own call, never capture');
});

test('a new card switched on shows its sections; a card with a section on keeps its sections as they were', () => {
    const base = catalog.normalizeConfig(undefined);
    const notebook = catalog.setMode(base, 'notebook', 'tray');
    assert.ok(catalog.sectionOn(notebook, 'notebook', 'narrator') && catalog.sectionOn(notebook, 'notebook', 'diaries'));
    assert.ok(catalog.captureFields(notebook).some(item => item.key === 'notebook.diaries'));
    const partial = catalog.setMode(catalog.setMode(catalog.setOn(notebook, 'notebook:diaries', false), 'notebook', 'off'), 'notebook', 'strip');
    assert.equal(catalog.sectionOn(partial, 'notebook', 'diaries'), false, 'a section she switched off stays off');
    const knowledgeOn = catalog.setMode(catalog.setMode(base, 'knowledge', 'off'), 'knowledge', 'tray');
    assert.equal(catalog.sectionOn(knowledgeOn, 'knowledge', 'secrets'), false, 'a card drawn today keeps its new sections off');
    assert.equal(choices.choicesOn(catalog.setOn(catalog.setMode(base, 'choices', 'tray'), 'choices:moves', false)), false, 'Moves off: no call');
});

test('overlaps stay merged: one Plot card holds the thread trackers of all four presets, one Knowledge card the four knowledge trackers', () => {
    assert.equal(catalog.CARDS.filter(card => card.id === 'plot').length, 1);
    assert.equal(new Set(catalog.CARDS.map(card => card.label)).size, catalog.CARDS.length, 'no duplicate card label');
    const sources = id => new Set(catalog.cardById(id).sections.flatMap(section => [...section.from, ...section.fields.flatMap(field => field.from)]).map(from => from.split('|')[0]));
    assert.deepEqual([...sources('plot')].sort(), ['Deus', 'Pura', 'Sola', 'Vexa']);
    const known = catalog.cardById('knowledge').sections.flatMap(section => section.fields.flatMap(field => field.from));
    for (const part of ['Vexa|Memory', 'Deus|Hidden Truths', 'Pura|Secrets Tracker']) assert.ok(known.includes(part), part);
    assert.ok(catalog.cardById('knowledge').sections.some(section => section.kinds.includes('knowledge')), 'our own Knowledge records');
    // No card outside Plot carries a thread tracker, and none outside Knowledge a knowledge tracker.
    for (const card of catalog.CARDS.filter(item => !['plot', 'knowledge', 'changes', 'plan'].includes(item.id))) {
        const from = card.sections.flatMap(section => section.fields.flatMap(field => field.from)).join(' ');
        assert.ok(!/Story Threads|Plotlines|Tracks|Chekhov|Meanwhile|Parallel Off-Screen|Pending Events|Hidden Truths|Secrets Tracker|\|Memory/.test(from), `${card.id} holds no merged tracker`);
    }
    assert.deepEqual(parity.NEW_CARDS.map(mod => mod.id).filter(id => parity.EXTENDED_CARDS.some(mod => mod.id === id)), [], 'one module per card');
});

// ---------- drawing from saved values ----------

test('each B20 card and section draws from the saved per-reply values of the fixture chat, with its family icon', () => {
    const drawn = drawAll();
    const expect = {
        map: ['#H..T..D#', 'H Hale', 'D the cellar door'],
        holding_back: ['Hale to Heather', 'Holds back', 'that he signed it himself', 'rising'],
        knowledge: ['What each person remembers', 'the night the warehouse burned', 'Secrets', 'Kept by Hale', 'Marten knows', 'False beliefs', 'Truth: he works for the harbor master'],
        inventory: ['Heather', 'brass key', 'Gained', 'taken from the clerk\'s desk', 'Given'],
        new_faces: ['Ilse Varga', 'harbor master\'s clerk', 'Tobin', 'a dock boy who runs messages for coin'],
        reputation: ['Dock guild', 'Rising', 'Harbor watch', 'Falling'],
        achievements: ['Ledger Breaker', '★★★☆☆', 'made Hale confess the forgery'],
        plan: ['Course', 'The ledger leads to the harbor master by nightfall.', 'Pressure', 'Branches', 'Burn the ledger page', 'Graded'],
        choices: ['Open the cellar', 'Persuasion', '1 model call · extra request'],
        notebook: ['Narrator notes', 'Marten has not said where he slept.', 'Diaries', 'I gave her the page.'],
        roast: ['Panel', 'Three people in one room', 'Wren'],
        emotions: ['Turn psychology', 'Side it brings out', 'the careful clerk', 'Where they end the turn'],
        relationships: ['Route', 'reluctant ally', 'What would move them next'],
        characters: ['Conditions', 'burned left hand', 'Moderate', 'knife wound', 'Severe'],
        scene: ['World detail', 'Rain drums on the tin roof'],
        plot: ['Tracks', 'The guild war', 'Pending events', 'Pay the harbor fine', 'due Day 5', 'Plotlines', 'Planted details', 'Elsewhere', 'Open threads'],
    };
    for (const id of B20_CARDS) {
        const parts = drawn[id];
        assert.ok(parts?.length, `${id} is drawn`);
        const def = catalog.cardById(id);
        for (const { card } of parts) {
            assert.equal(card.icon, def.icon, `${id} carries its icon`);
            assert.equal(card.family, def.family, `${id} carries its family`);
            assert.ok(card.first, `${id} has a first line for Compact`);
        }
        const text = textOf(parts.map(part => part.body));
        for (const want of expect[id]) assert.ok(text.includes(want), `${id} shows "${want}"`);
    }
});

test('a card switched off draws nothing, and a section switched off names itself under Not requested', () => {
    let config = everythingOn();
    config = catalog.setMode(config, 'map', 'off');
    config = catalog.setOn(config, 'knowledge:secrets', false);
    const cards = buildTrayCards(viewFor(host.chat, 6), config);
    assert.ok(!cards.some(card => card.id === 'map'));
    const knowledgeCard = cards.find(card => card.id === 'knowledge');
    const text = textOf(knowledgeCard.body());
    assert.ok(!text.includes('Kept by Hale') && text.includes('Not requested') && text.includes('Secrets'));
});

test('nothing drawn holds an emoji or an em or en dash', () => {
    const drawn = drawAll();
    for (const [id, parts] of Object.entries(drawn)) {
        const text = textOf(parts.map(part => part.body)).replace(ALLOWED, '');
        assert.ok(!EMOJI.test(text), `${id} draws no emoji`);
        assert.ok(!DASH.test(text), `${id} draws no dash`);
        for (const { card } of parts) assert.ok(!EMOJI.test(String(card.first).replace(ALLOWED, '')), `${id} first line`);
    }
});

test('achievements show rarity as typographic stars; conditions show severity with Font Awesome marks and the word', () => {
    for (const [value, stars] of [['3', 3], ['★★★★', 4], ['legendary', 5], ['rarity 1', 1], ['9', 5]]) assert.equal(achievements.rarityOf(value), stars, value);
    assert.equal(achievements.rarityOf(''), null);
    const drawn = drawAll();
    const ach = drawn.achievements.flatMap(part => part.body);
    assert.ok(all(ach, el => el.className === 'ri-c-stars').length === 1);
    const chars = drawn.characters.flatMap(part => part.body);
    const marks = icons(chars);
    assert.ok(marks.some(name => name.includes('fa-triangle-exclamation')), 'moderate mark');
    assert.ok(marks.some(name => name.includes('fa-circle-exclamation')), 'severe mark');
    assert.deepEqual(conditions.readCondition('no sleep (mild)'), { text: 'no sleep', level: 'mild' });
    assert.deepEqual(conditions.readCondition('severe: a broken rib'), { text: 'a broken rib', level: 'severe' });
});

test('New faces folds each full sheet, gives a minor character one line, and offers Copy and Add to Story World', () => {
    const body = drawAll().new_faces.flatMap(part => part.body);
    const major = all(body, el => el.attrs['data-face'] === 'major');
    const minor = all(body, el => el.attrs['data-face'] === 'minor');
    assert.equal(major.length, 1);
    assert.equal(major[0].tagName, 'DETAILS', 'the full sheet is folded');
    assert.ok(!major[0].attrs.open, 'and starts closed');
    assert.ok(textOf(major[0]).includes('Manner') && textOf(major[0]).includes('precise, never hurried'));
    assert.equal(minor.length, 1);
    assert.ok(!all(minor, el => el.tagName === 'DETAILS').length, 'a minor character is one line');
    assert.equal(buttons(body, 'Copy').length, 2);
    assert.equal(buttons(body, 'Add to Story World').length, 2);
    const ilse = faces.readFace(DEUS.new_faces.sheet[0]);
    assert.equal(faces.faceText(ilse).split('\n')[0], 'Ilse Varga');
    assert.ok(faces.faceText(ilse).includes('Wants: the forged seal found'));
    assert.equal(faces.faceText(faces.readFace(DEUS.new_faces.sheet[1])), 'Tobin: a dock boy who runs messages for coin');
});

test('the item readers accept plain lines and objects alike', () => {
    assert.deepEqual(inventory.readItem({ holder: 'Hale', item: 'lamp', change: 'broke it', note: 'dropped on the stairs' }), { holder: 'Hale', item: 'lamp', change: 'broken', note: 'dropped on the stairs' });
    assert.deepEqual(knowledge.readSecret('The boat is stolen | owner: Marten | also known by: Hale and Ilse'), { text: 'The boat is stolen', owner: 'Marten', known: ['Hale', 'Ilse'] });
    assert.deepEqual(knowledge.readBelief({ who: 'Hale', belief: 'the seal is safe', truth: 'Ilse has it' }), { who: 'Hale', belief: 'the seal is safe', truth: 'Ilse has it' });
    const grid = map.splitGrid('```\n#..#\n#H.#\n```\nH: Hale');
    assert.deepEqual(grid, { grid: ['#..#', '#H.#'], legend: [{ mark: 'H', text: 'Hale' }] });
    assert.ok(map.splitGrid('x'.repeat(80)).grid[0].length <= 32, 'a wide row is cut to the grid width, so the card never scrolls sideways');
});

test('a carried value shows the reply it came from', () => {
    host.chat[8].extra[KEY].tracker.achievements = { earned: { v: 'Ledger Breaker | 3 | made Hale confess', from: 2 } };
    const card = buildTrayCards(viewFor(host.chat, 8), everythingOn()).find(item => item.id === 'achievements');
    assert.ok(textOf(card.body()).includes('from reply 2'));
});

// ---------- Choices ----------

test('the Choices request is an Options request with the player as the one who moves', () => {
    const { system, user } = choices.choicesRequest({ chat: host.chat, index: 8, player: 'Heather' });
    assert.match(system, /Return a JSON array of exactly 4 distinct objects/, 'the shape the Options call and the mock read');
    assert.ok(system.includes('"skill"') && system.includes('Heather'));
    assert.ok(user.trim().endsWith('Write the moves for Heather\'s next message.'));
    assert.ok(user.indexOf('I wait.') < user.lastIndexOf('The lamp gutters'), 'newest last');
    assert.ok(!EMOJI.test(system + user) && !DASH.test(system), 'plain prompt');
    assert.deepEqual(choices.parseChoices('Here: [{"title":"A","text":"I go.","skill":"Nerve"},{"title":"","text":"I stay."},{"text":""},"I run."]'),
        [{ title: 'A', text: 'I go.', skill: 'Nerve' }, { title: 'Move 2', text: 'I stay.', skill: '' }, { title: 'Move 4', text: 'I run.', skill: '' }]);
    assert.deepEqual(choices.parseChoices('no json'), []);
});

test('Choices runs only while its card is on; one call per reply text, saved on the reply and its swipe', async () => {
    assert.equal(choices.choicesOn(catalog.normalizeConfig(undefined)), false, 'off by default: no call');
    assert.equal(choices.choicesOn(catalog.setMode(catalog.normalizeConfig(undefined), 'choices', 'tray')), true);
    assert.equal(choices.choicesOn(catalog.setMode(catalog.normalizeConfig(undefined), 'choices', 'strip')), true);
    const message = host.chat[6];
    message.swipe_info = [{ extra: { [KEY]: { time: 't' } } }];
    let calls = 0;
    const run = async ({ system }) => { calls++; assert.match(system, /exactly 4 distinct objects/); return { ok: true, text: JSON.stringify(CHOICES.items), route: 'main', model: 'm', attempts: [{}] }; };
    const first = await choices.runChoices(6, { run });
    assert.equal(calls, 1);
    assert.equal(first.outcome, 'completed');
    assert.equal(message.extra[KEY].choices.items.length, 4);
    assert.equal(message.swipe_info[0].extra[KEY].choices.items.length, 4, 'the swipe keeps its own moves');
    await choices.runChoices(6, { run });
    assert.equal(calls, 1, 'the same reply text makes no second call');
    message.mes = 'A new version of the reply.';
    await choices.runChoices(6, { run });
    assert.equal(calls, 2, 'a new version gets its own moves');
    const failed = await choices.runChoices(4, { run: async () => ({ ok: false, waiting: true, reason: 'Paused, monthly ceiling reached.', attempts: [] }) });
    assert.equal(failed.outcome, 'waiting', 'a call the ceiling held is saved as waiting');
});

test('each choice carries Copy, Insert and Send; a failed call offers Try again with the call words', async () => {
    const config = everythingOn();
    const card = buildTrayCards(viewFor(host.chat, 8), config).find(item => item.id === 'choices');
    const body = card.body();
    assert.equal(all(body, el => el.tagName === 'LI' && el.className === 'ri-c-choice').length, 4);
    for (const label of ['Copy', 'Insert', 'Send']) assert.equal(buttons(body, label).length, 4, label);
    assert.ok(all(body, el => el.attrs['aria-label'] === 'Send move 2, Ask Ilse').length === 1);
    host.chat[8].extra[KEY].choices = { ...CHOICES, items: [], outcome: 'failed', reason: 'No route answered.' };
    const failed = buildTrayCards(viewFor(host.chat, 8), config).find(item => item.id === 'choices');
    const again = buttons(failed.body(), 'Try again');
    assert.equal(again.length, 1);
    assert.match(again[0].attrs['aria-label'], /1 model call, extra request/);
    assert.ok(again[0].className.includes('ri-cost-chip'), 'amber like every extension-added call');
});

test('the Options call shows in the Sent card with the extension-added call words, and marks the Strip', () => {
    const cards = buildTrayCards(viewFor(host.chat, 8), everythingOn());
    const sent = cards.find(card => card.id === 'sent');
    assert.ok(sent, 'a reply whose only receipt is the Choices call still has a Sent card');
    assert.deepEqual(sent.calls, ['Choices']);
    const text = textOf(sent.body());
    assert.ok(text.includes('1 model call · extra request') && text.includes('Main API') && text.includes('After each reply while the Choices card is on'));
    const withCore = buildTrayCards(viewFor(host.chat, 8, { extras: { sent: { first: 'story guidance sent', calls: ['Follow-through check'], body: () => [document.createElement('p')] } } }), everythingOn())
        .find(card => card.id === 'sent');
    assert.deepEqual(withCore.calls, ['Follow-through check', 'Choices']);
    assert.equal(withCore.first, 'story guidance sent');
});

test('the parity stylesheet colors cards only through story style and reserved tokens', () => {
    const css = readFileSync(join(root, 'src/ui/cards/cards.css'), 'utf8');
    assert.ok(!/#[0-9a-f]{3,8}\b|rgb\(/i.test(css), 'no fixed colors: each story style dresses the cards');
    for (const token of css.match(/var\(--[\w-]+/g)) assert.match(token, /--ri-(style-|call|problem|card-|font|hit-)/, token);
});
