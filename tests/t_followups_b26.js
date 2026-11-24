// B26: pinned characters on the Characters card, the Dismiss button on every Spend notice, and the "prompt manager"
// search synonym. A small DOM stands in for the page; the browser pass (reload, touch, screenshots) is run on the
// host and recorded in docs/ux-overhaul/tickets/B26.md.
// Run with: node --test tests/t_followups_b26.js
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

class Node_ { constructor() { this.children = []; this.parentNode = null; } }
class Text_ extends Node_ { constructor(text) { super(); this.nodeValue = String(text); } get textContent() { return this.nodeValue; } }
class El_ extends Node_ {
    constructor(tag) { super(); this.tagName = tag.toUpperCase(); this.attrs = {}; this.style = {}; this.listeners = {}; this.dataset = {}; this.isConnected = true; }
    get className() { return this.attrs.class || ''; }
    set className(value) { this.attrs.class = value; }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    getAttribute(name) { return this.attrs[name] ?? null; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    appendChild(node) { node.parentNode = this; this.children.push(node); return node; }
    append(...nodes) { for (const node of nodes) this.appendChild(typeof node === 'string' ? new Text_(node) : node); }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    contains(node) { return node === this || this.children.some(child => child.contains?.(node)); }
    matches() { return false; }
    click() { for (const fn of this.listeners.click || []) fn({ stopPropagation() {}, preventDefault() {}, currentTarget: this }); }
    get textContent() { return this.children.map(child => child.textContent).join(''); }
    find(predicate, out = []) { if (predicate(this)) out.push(this); for (const child of this.children) if (child instanceof El_) child.find(predicate, out); return out; }
    byClass(name) { return this.find(el => el.className.split(' ').includes(name)); }
}
globalThis.Node = Node_;
globalThis.document = { createElement: tag => (tag === 'canvas' ? { getContext: () => ({}) } : new El_(tag)), createTextNode: text => new Text_(text),
    documentElement: {}, body: {}, activeElement: null };
globalThis.MutationObserver ??= class { observe() {} };

const KEY = 'roleplay_instructions';
let host;
let saves;
const flat = nodes => [nodes].flat(6).filter(node => node instanceof Node_);
const textOf = nodes => flat(nodes).map(node => node.textContent).join('\n');
const sections = nodes => flat(nodes).flatMap(node => node.find(el => el.attrs['data-person']));
const buttonsNamed = (root, label) => flat(root).flatMap(node => node.find(el => el.tagName === 'BUTTON' && el.textContent === label));

host = { name1: 'Heather', name2: 'Hale of Verath', extensionSettings: {}, chat: [], chatMetadata: {}, characters: [], getCurrentChatId: () => 'chat-a',
    saveSettingsDebounced() {}, saveMetadataDebounced() {} };
globalThis.SillyTavern = { getContext: () => host };

const catalog = await import('../src/cards/catalog.js');
const cards = await import('../src/ui/reply-cards.js');
const spendUi = await import('../src/ui/connections-spend.js');
const { monthOf } = await import('../src/spend.js');
const { searchMenu, SILLYTAVERN_TERMS, pageEntries } = await import('../src/ui/menu-search.js');
const { buildTree, pathName } = await import('../src/ui/destinations.js');

beforeEach(() => {
    saves = 0;
    host = { name1: 'Heather', name2: 'Hale of Verath', extensionSettings: {}, chat: [], chatMetadata: {}, characters: [], getCurrentChatId: () => 'chat-a',
        saveSettingsDebounced() {}, saveMetadataDebounced() { saves++; } };
    globalThis.SillyTavern = { getContext: () => host };
});

// ---------- pinned characters ----------

const reply = (extra = {}) => ({ is_user: false, mes: 'A reply.', extra: { [KEY]: { time: 'x', ...extra } } });
const user = () => ({ is_user: true, mes: 'go on', extra: {} });
const state = (name, fields) => ({ name, fields });
const person = (name, fields = { mind: `${name} is thinking` }) => ({ name, fields, protected: {} });

const view = (id, people, over = {}) => ({ id, rec: host.chat[id]?.extra?.[KEY] || {}, modules: { state: true }, snapshot: {}, showState: true, people, profiles: [],
    records: [], planning: '', roast: '', strip: null, presentNames: people.map(item => item.name), saved: null, redraw() { this.redrawn = (this.redrawn || 0) + 1; }, extras: {}, ...over });
const characters = (v, config = catalog.normalizeConfig(undefined)) => cards.buildTrayCards(v, config).find(card => card.id === 'characters');

test('pins are saved in the chat, per chat, and survive a reload', () => {
    assert.deepEqual(cards.pinnedCharacters(), []);
    assert.equal(cards.setPinnedCharacter('Marten', true), true);
    assert.equal(cards.setPinnedCharacter('Edren', true), true);
    assert.equal(cards.setPinnedCharacter('marten', true), true, 'the same name in another case pins once');
    assert.deepEqual(cards.pinnedCharacters(), ['Edren', 'marten']);
    assert.ok(saves >= 3, 'each change is saved');
    // A host that can write the chat file at once is asked to, so a reload right after the tap keeps the pin.
    let immediate = 0;
    host.saveMetadata = () => { immediate++; };
    cards.setPinnedCharacter('Sera', true);
    cards.setPinnedCharacter('Sera', false);
    assert.equal(immediate, 2, 'the pin is written now, not after the debounce');
    delete host.saveMetadata;
    // A reload hands the same chat file back: the chat metadata round-trips through JSON.
    host.chatMetadata = JSON.parse(JSON.stringify(host.chatMetadata));
    assert.deepEqual(cards.pinnedCharacters(), ['Edren', 'marten']);
    // Another chat has its own pins.
    const here = host.chatMetadata;
    host.chatMetadata = {};
    assert.deepEqual(cards.pinnedCharacters(), []);
    host.chatMetadata = here;
    cards.setPinnedCharacter('Edren', false);
    assert.deepEqual(cards.pinnedCharacters(), ['marten']);
    host.getCurrentChatId = () => '';
    assert.equal(cards.setPinnedCharacter('Hale', true), false, 'with no chat open nothing is pinned');
});

test('the card shows up to 3 present characters plus every pinned one, pinned first', () => {
    const names = ['Hale', 'Marten', 'Edren', 'Sera', 'Joss'];
    host.chat = [reply(), user(), reply()];
    const people = names.map(name => person(name));
    let card = characters(view(2, people));
    assert.deepEqual(sections(card.body()[0]).map(node => node.attrs['data-person']), ['Hale', 'Marten', 'Edren'], 'three, the rest folded');
    assert.match(textOf(card.body()), /2 more characters/);
    assert.equal(card.first, 'Hale: Hale is thinking +4');
    cards.setPinnedCharacter('Joss', true);
    card = characters(view(2, people));
    const drawn = sections(card.body()[0]).map(node => node.attrs['data-person']);
    assert.deepEqual(drawn, ['Joss', 'Hale', 'Marten', 'Edren'], 'a present pinned character leads and takes no slot');
    assert.match(textOf(card.body()), /1 more character(?!s)/);
    assert.equal(sections(card.body()).find(node => node.attrs['data-person'] === 'Joss').attrs['data-pinned'], 'true');
});

test('every character row has Pin or Unpin and the control changes the pin', () => {
    host.chat = [reply(), user(), reply()];
    const v = view(2, [person('Hale'), person('Marten')]);
    let card = characters(v);
    const pins = buttonsNamed(card.body(), 'Pin');
    assert.equal(pins.length, 2, 'one Pin per row');
    assert.equal(pins[0].attrs['aria-pressed'], 'false');
    assert.match(pins[0].attrs['aria-label'], /Pin Hale to the Characters card/);
    pins[1].click();
    assert.deepEqual(cards.pinnedCharacters(), ['Marten']);
    assert.equal(v.redrawn, 1, 'the tray redraws');
    card = characters(v);
    const unpin = buttonsNamed(card.body(), 'Unpin');
    assert.equal(unpin.length, 1);
    assert.equal(unpin[0].attrs['aria-pressed'], 'true');
    unpin[0].click();
    assert.deepEqual(cards.pinnedCharacters(), []);
    assert.equal(buttonsNamed(characters(v).body(), 'Unpin').length, 0);
});

test('a pinned character absent from the reply shows its last values muted as from reply N', () => {
    host.chat = [
        { is_user: false, mes: 'Opening', extra: {} },
        user(),
        reply({ stateChanges: [state('Hale', { mind: 'Counting the riders', heart: 'Irritated' }), state('Marten', { mind: 'Carrying the steward\'s message', body: 'Wet from the yard' })],
            tracker: { characters: [{ name: 'Marten', outfit: 'Wet wool cloak', thoughts: 'The steward will not forgive this.' }] } }),
        user(),
        reply({ stateChanges: [state('Hale', { heart: 'Calm' })] }),
    ];
    cards.setPinnedCharacter('Marten', true);
    let config = catalog.setOn(catalog.setOn(catalog.normalizeConfig(undefined), 'characters:now', true), 'characters.thoughts', true);
    config = catalog.setOn(config, 'characters.outfit', true);
    const here = [person('Hale', { mind: 'Counting the riders', heart: 'Calm' })];
    const card = characters(view(4, here), config);
    const [marten, hale] = sections(card.body());
    assert.equal(marten.attrs['data-person'], 'Marten');
    assert.equal(marten.attrs['data-absent'], 'true');
    const body = textOf(marten);
    assert.match(body, /not in this reply, last seen in reply 1/);
    assert.match(body, /Carrying the steward's message.*from reply 1/s);
    assert.match(body, /Wet wool cloak.*from reply 1/s);
    assert.match(body, /The steward will not forgive this\..*from reply 1/s);
    const rows = marten.find(el => el.className.split(' ').includes('ri-c-row'));
    assert.ok(rows.length >= 4 && rows.every(row => row.attrs['data-carried'] === 'true'), 'every row is marked carried, which mutes it');
    assert.equal(hale.attrs['data-absent'], undefined, 'a present character is not marked absent');
    assert.match(textOf(hale), /Calm/);
});

test('a pinned character with nothing recorded still shows, and a pin alone keeps the card', () => {
    host.chat = [{ is_user: false, mes: 'Opening', extra: {} }, user(), reply()];
    cards.setPinnedCharacter('Edren', true);
    const card = characters(view(2, [], { presentNames: [] }));
    assert.ok(card, 'the card shows with nobody present');
    const [edren] = sections(card.body());
    assert.equal(edren.attrs['data-person'], 'Edren');
    assert.match(textOf(edren), /not in this reply/);
    assert.match(textOf(edren), /No values recorded for this character yet/);
    cards.setPinnedCharacter('Edren', false);
    assert.equal(characters(view(2, [], { presentNames: [] })), undefined, 'no pin and nobody present: no card');
});

test('no pinned character leaves the card as it was and draws no emoji', () => {
    host.chat = [reply(), user(), reply()];
    const card = characters(view(2, [person('Hale')]));
    assert.deepEqual(sections(card.body()).map(node => node.attrs['data-person']), ['Hale']);
    assert.doesNotMatch(textOf(card.body()), /\p{Emoji_Presentation}/u);
});

// ---------- Spend notices ----------

const NOTES = [
    { id: 'fallback:desktop:1', kind: 'fallback', route: 'desktop', text: 'Desktop unreachable; background jobs use the next route' },
    { id: 'back:desktop:1', kind: 'back', route: 'desktop', text: 'Desktop back; background jobs on the desktop again' },
    { id: 'warning:now', kind: 'warning', text: 'US$4.00 of US$5.00 used this month; paid background calls pause at the ceiling' },
    { id: 'ceiling:now', kind: 'ceiling', text: 'US$5.00 monthly ceiling reached; paid background calls are paused, free and local routes carry on' },
];

function openSpend() {
    host.extensionSettings[KEY] = { spendView: { month: monthOf(Date.now()), notes: NOTES.map(note => ({ ...note })), calls: {}, health: {}, outages: {} } };
    const body = new El_('div');
    spendUi.renderSpendPage(body);
    return body;
}
const notices = body => flat(body).flatMap(node => node.find(el => el.className.split(' ').includes('ri-spend-notice')));

test('Spend lists every active fallback, back, warning and ceiling notice, each with its own Dismiss', () => {
    const body = openSpend();
    const rows = notices(body);
    assert.deepEqual(rows.map(row => row.attrs['data-kind']), ['fallback', 'back', 'warning', 'ceiling']);
    for (const row of rows) {
        const dismiss = row.find(el => el.tagName === 'BUTTON');
        assert.equal(dismiss.length, 1, `${row.attrs['data-kind']} has one control`);
        assert.equal(dismiss[0].textContent, 'Dismiss');
        assert.match(dismiss[0].attrs['aria-label'], /^Dismiss /);
    }
    assert.equal(new Set(rows.flatMap(row => row.find(el => el.tagName === 'BUTTON').map(button => button.attrs['aria-label']))).size, 4, 'each name is distinct');
});

test('Dismiss on the page clears that notice for the bar too, and a dismissal in the bar clears the page', () => {
    const body = openSpend();
    const click = kind => notices(body).find(row => row.attrs['data-kind'] === kind).find(el => el.tagName === 'BUTTON')[0].click();
    click('back');
    assert.deepEqual(spendUi.activeNotes().map(note => note.kind), ['fallback', 'warning', 'ceiling'], 'only the back note went');
    assert.deepEqual(notices(body).map(row => row.attrs['data-kind']), ['fallback', 'warning', 'ceiling'], 'and left the page');
    // The bar's Dismiss calls dismissNote with the note's id; the page follows.
    assert.equal(spendUi.dismissNote('warning:now'), true);
    assert.deepEqual(notices(body).map(row => row.attrs['data-kind']), ['fallback', 'ceiling']);
    click('ceiling');
    click('fallback');
    assert.deepEqual(spendUi.activeNotes(), []);
    assert.deepEqual(notices(body), []);
});

// ---------- menu search ----------

test('searching "prompt manager" lands on Setup, Prompts', () => {
    const tree = buildTree([{ id: 'prompts', group: 'setup', label: 'Prompts', tab: 'prompts', withoutChat: true, aliases: 'prompt manager', render() {} }]);
    const entries = pageEntries(tree);
    const results = searchMenu(entries, 'prompt manager', id => pathName(tree, id));
    assert.equal(results[0].page, 'prompts');
    assert.equal(results[0].path, 'Setup › Prompts');
    assert.equal(results[0].synonym, 'Prompt Manager');
    assert.equal(searchMenu(entries, 'presets')[0]?.synonym, 'Presets', 'the Presets word keeps its own target');
    assert.ok(!searchMenu(entries, 'presets').some(item => item.page === 'prompts' && item.synonym), 'Presets no longer points at Prompts');
    assert.ok(SILLYTAVERN_TERMS.some(term => term.words.includes('prompt manager')));
});
