// B11: the card catalog against DESIGN.md 6.2 and 6.3, the card switches and capture's field list, the shared
// templates, and the card builder (order, modes, defaults, carried values). Rendered cards are checked for emoji.
// The host pass (screenshots, touch) runs through the scratchpad drivers named in the ticket's Notes.
// Run with: node --test tests/t_reply_cards.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import needsDocs from './needs-docs.cjs';
needsDocs('t_reply_cards', ['docs/ux-overhaul/DESIGN.md']);
import { beforeEach, test } from 'node:test';

// A small DOM, enough for the templates: elements, text, attributes, classes and text content.
class Node_ { constructor() { this.children = []; this.parentNode = null; } }
class Text_ extends Node_ { constructor(text) { super(); this.nodeValue = String(text); } get textContent() { return this.nodeValue; } }
class El_ extends Node_ {
    constructor(tag) { super(); this.tagName = tag.toUpperCase(); this.attrs = {}; this.style = {}; this.listeners = {}; }
    get className() { return this.attrs.class || ''; }
    set className(value) { this.attrs.class = value; }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    getAttribute(name) { return this.attrs[name] ?? null; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    appendChild(node) { node.parentNode = this; this.children.push(node); return node; }
    append(...nodes) { for (const node of nodes) this.appendChild(typeof node === 'string' ? new Text_(node) : node); }
    matches() { return false; }
    get textContent() { return this.children.map(child => child.textContent).join(''); }
    find(predicate, out = []) { if (predicate(this)) out.push(this); for (const child of this.children) if (child instanceof El_) child.find(predicate, out); return out; }
    byClass(name) { return this.find(el => el.className.split(' ').includes(name)); }
}
globalThis.Node = Node_;
globalThis.document = { createElement: tag => (tag === 'canvas' ? { getContext: () => ({}) } : new El_(tag)), createTextNode: text => new Text_(text), documentElement: {}, body: {} };
globalThis.MutationObserver ??= class { observe() {} };

const catalog = await import('../src/cards/catalog.js');
const T = await import('../src/ui/card-templates.js');
const { buildTrayCards, carriedFrom, replyNumber } = await import('../src/ui/reply-cards.js');
const { effectiveModules } = await import('../src/v10.js');
const tray = await import('../src/ui/reply-tray.js');
const settingsUi = await import('../src/ui/tray-settings.js');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const design = readFileSync(join(root, 'docs/ux-overhaul/DESIGN.md'), 'utf8');
const EMOJI = /\p{Emoji_Presentation}|️/u;

let host;
beforeEach(() => {
    host = { name1: 'Heather', name2: 'Hale of Verath', extensionSettings: {}, chat: [], chatMetadata: {}, characters: [], getCurrentChatId: () => 'chat-a',
        saveSettingsDebounced() {}, saveMetadataDebounced() {} };
    globalThis.SillyTavern = { getContext: () => host };
});

// ---------- the tables of DESIGN.md ----------

const tableRows = (text, from, to) => text.slice(text.indexOf(from), to ? text.indexOf(to, text.indexOf(from)) : undefined)
    .split('\n').filter(line => line.startsWith('|') && !/^\|\s*-/.test(line)).map(line => line.split('|').slice(1, -1).map(cell => cell.trim()));

function cardTable() {
    return tableRows(design, '| Card | Family and icon |', '\nThree preset parts are covered outside').slice(1).map(([card, family, sections]) => {
        const [fam, icon] = family.split(',').map(part => part.trim().replace(/`/g, ''));
        return { card, family: fam.toLowerCase(), icon, sections };
    });
}

function presetRows() {
    const block = design.slice(design.indexOf('### 6.3 Card parity'), design.indexOf('### 6.4 Loading states'));
    const out = [];
    let preset = '';
    for (const line of block.split('\n')) {
        const heading = /^\*\*(Vexa|Neon Sola|Deus Ex Machina|Pura's Director)/.exec(line);
        if (heading) { preset = { Vexa: 'Vexa', 'Neon Sola': 'Sola', 'Deus Ex Machina': 'Deus', "Pura's Director": 'Pura' }[heading[1]]; continue; }
        if (!line.startsWith('|') || /^\|\s*(-|Vexa section|Sola part|Deus part|Pura tracker)/.test(line)) continue;
        const [part, where, built] = line.split('|').slice(1, -1).map(cell => cell.trim());
        out.push({ key: `${preset}|${part}`, where, built: built.split(',').map(item => item.trim()) });
    }
    return out;
}

test('the catalog lists every card of 6.2 in its order, with its family and icon', () => {
    const table = cardTable();
    assert.equal(table.length, 22, 'the 6.2 table has 22 cards');
    assert.deepEqual(catalog.CARDS.map(card => card.label), table.map(row => row.card));
    for (const [index, row] of table.entries()) {
        const card = catalog.CARDS[index];
        assert.equal(card.family, row.family, `${card.label} family`);
        assert.equal(card.icon, row.icon, `${card.label} icon`);
        assert.ok(card.effect.length > 10 && !card.effect.includes('\n'), `${card.label} has a one-line effect`);
    }
    assert.equal(new Set(catalog.CARDS.map(card => card.id)).size, catalog.CARDS.length, 'no duplicate card');
});

test('Plot lists the sections the 6.2 table names', () => {
    const plot = cardTable().find(row => row.card === 'Plot');
    for (const name of ['Open threads', 'Plotlines', 'Tracks', 'Elsewhere', 'Planted details', 'Pending events']) {
        assert.ok(plot.sections.includes(name), `6.2 names ${name}`);
        assert.ok(catalog.cardById('plot').sections.some(section => section.label === name), `catalog has ${name}`);
    }
});

test('every row of the 6.3 tables has a home in the catalog, owned by the ticket the table names', () => {
    const rows = presetRows();
    assert.ok(rows.length >= 55, `read ${rows.length} rows`);
    const fields = catalog.allFields();
    const sections = catalog.CARDS.flatMap(card => card.sections.map(section => ({ card, section })));
    let checked = 0;
    for (const row of rows) {
        const owners = row.built.filter(owner => ['B11', 'B20', 'B22'].includes(owner));
        if (!owners.length) continue;   // B10 (scene header), B12 (conflict chip) and existing features have no card
        const homes = fields.filter(({ field }) => field.from.includes(row.key)).map(({ field }) => field.owner)
            .concat(sections.filter(({ section }) => section.from.includes(row.key)).map(({ section }) => section.owner));
        assert.ok(homes.length, `${row.key} has a field`);
        assert.ok(homes.some(owner => owners.includes(owner)), `${row.key} is owned by ${owners.join(' or ')}, found ${homes.join(', ')}`);
        checked++;
    }
    assert.ok(checked >= 50, `checked ${checked} rows`);
});

test('the B20 and B22 rows are built and start off', () => {
    for (const id of ['map', 'holding_back', 'inventory', 'new_faces', 'reputation', 'achievements', 'choices', 'notebook']) {
        const card = catalog.cardById(id);
        assert.ok(catalog.isBuilt(card), `${id} is built (B20)`);
        assert.equal(catalog.defaultMode(card), 'off');
    }
    for (const id of ['stats', 'roll']) {
        const card = catalog.cardById(id);
        assert.ok(catalog.isBuilt(card), `${id} is built (B22 marks it when its renderer registers)`);
        assert.equal(catalog.defaultMode(card), 'off');
    }
    assert.ok(catalog.isBuilt(catalog.cardById('plot').sections.find(section => section.id === 'tracks')));
    assert.ok(catalog.isBuilt(catalog.cardById('scene')) && catalog.isBuilt(catalog.cardById('characters')));
});

// ---------- defaults and switches ----------

const TODAY = ['scene', 'characters', 'emotions', 'relationships', 'knowledge', 'plot', 'changes', 'lore', 'plan', 'roast', 'sent', 'notes'];

test('cards drawn today keep today\'s setting; every new card, section and field starts off', () => {
    const config = catalog.normalizeConfig(undefined);
    for (const card of catalog.CARDS) assert.equal(catalog.cardMode(config, card.id), TODAY.includes(card.id) ? 'tray' : 'off', card.id);
    const NEW_IN_TODAY = ['scene.ambient', 'scene.facts', 'scene.places', 'characters.avatar', 'characters.doing', 'characters.thoughts', 'characters.outfit',
        'characters.holding', 'characters.ego', 'characters.nerve', 'characters.faculty_body', 'characters.faculty_psyche', 'relationships.level', 'relationships.change'];
    for (const key of NEW_IN_TODAY) {
        const [card, field] = key.split('.');
        assert.equal(catalog.fieldOn(config, card, field), false, `${key} starts off`);
    }
    for (const key of ['scene.place', 'scene.time', 'scene.weather', 'scene.environment', 'scene.present', 'characters.mind', 'characters.heart', 'characters.body',
        'characters.psyche', 'characters.facet', 'characters.voice', 'characters.who', 'emotions.axes', 'relationships.pair', 'plot.threads', 'plot.plotlines', 'plot.details', 'plot.elsewhere']) {
        const [card, field] = key.split('.');
        assert.equal(catalog.fieldOn(config, card, field), true, `${key} keeps today's setting`);
    }
    for (const { card, section, field } of catalog.allFields()) {
        if (TODAY.includes(card.id) && section.today && (field.today || section.fields.length === 1)) continue;
        assert.equal(catalog.fieldOn(config, card.id, field.id), false, `${card.id}.${field.id} is not on by default`);
    }
});

test('Capture asks only for built, switched-on fields the reply does not fill itself', () => {
    const config = catalog.normalizeConfig(undefined);
    const keys = catalog.captureFields(config, effectiveModules()).map(item => item.key);
    assert.ok(keys.includes('scene.place') && keys.includes('characters.mind'), 'today\'s fields are asked for');
    assert.ok(!keys.includes('scene.facts') && !keys.includes('characters.ego'), 'new fields are not asked for');
    assert.ok(!keys.includes('plot.tracks') && !keys.includes('map.grid') && !keys.includes('roll.lines'), 'unbuilt fields are never asked for');
    assert.ok(!keys.includes('roast.voice') && !keys.includes('plan.plan'), 'fields the reply fills itself are not asked for');
});

test('a field switched off leaves the list; so does a section, a card and a card on Theirs', () => {
    let config = catalog.normalizeConfig(undefined);
    const keys = (modules = {}) => catalog.captureFields(config, modules).map(item => item.key);
    assert.ok(keys().includes('scene.weather'));
    config = catalog.setOn(config, 'scene.weather', false);
    assert.ok(!keys().includes('scene.weather') && keys().includes('scene.place'), 'one field off');
    config = catalog.setOn(config, 'characters:inner', false);
    assert.deepEqual(keys().filter(key => ['characters.mind', 'characters.heart', 'characters.body', 'characters.psyche'].includes(key)), [], 'a section off');
    assert.ok(keys().includes('characters.facet'), 'its neighbours stay');
    config = catalog.setMode(config, 'emotions', 'off');
    assert.ok(!keys().includes('emotions.axes'), 'a card off');
    assert.ok(keys({ state: false }).every(key => !key.startsWith('scene.') && !key.startsWith('characters.')), 'a card on Theirs');
    config = catalog.setMode(config, 'emotions', 'strip');
    assert.ok(keys().includes('emotions.axes'), 'Strip only still asks for its marks');
});

test('switching a new section on turns its fields on; a new field in an old section stays off until switched', () => {
    let config = catalog.normalizeConfig(undefined);
    config = catalog.setOn(config, 'characters:faculty', true);
    config = catalog.setMode(config, 'characters', 'tray');
    for (const field of ['ego', 'nerve', 'faculty_body', 'faculty_psyche']) assert.equal(catalog.fieldOn(config, 'characters', field), true, field);
    assert.equal(catalog.fieldOn(config, 'characters', 'thoughts'), false);
    config = catalog.setOn(config, 'characters.thoughts', true);
    assert.equal(catalog.fieldOn(config, 'characters', 'thoughts'), true);
    config = catalog.setOn(config, 'scene:facts', true);
    assert.equal(catalog.fieldOn(config, 'scene', 'facts'), true, 'a section\'s only field follows the section');
    assert.ok(catalog.captureFields(config).some(item => item.key === 'scene.facts'));
});

test('the order moves up and down and keeps every card', () => {
    let config = catalog.normalizeConfig(undefined);
    const ids = () => catalog.orderedCards(config).map(card => card.id);
    assert.deepEqual(ids(), catalog.CARDS.map(card => card.id));
    config = catalog.moveCard(config, 'characters', -1);
    assert.deepEqual(ids().slice(0, 3), ['scene', 'characters', 'map']);
    config = catalog.moveCard(config, 'scene', 1);
    assert.deepEqual(ids().slice(0, 3), ['characters', 'scene', 'map']);
    assert.equal(ids().length, catalog.CARDS.length);
    assert.deepEqual(ids(), catalog.orderedCards(catalog.normalizeConfig(JSON.parse(JSON.stringify(config)))).map(card => card.id), 'survives a save');
    assert.equal(catalog.moveCard(config, 'characters', -1).order[0], 'characters', 'the first card stays first');
    assert.deepEqual(catalog.normalizeConfig({ mode: { scene: 'bogus', plot: 'strip' }, on: { 'nope.x': true, 'scene.place': false }, order: ['plot', 'plot', 'nope'] }),
        { mode: { plot: 'strip' }, on: { 'scene.place': false }, order: ['plot'] }, 'unknown ids and modes are dropped');
});

test('Not requested names the switched-off sections and fields of a built card', () => {
    const config = catalog.normalizeConfig(undefined);
    const names = catalog.notRequested(config, 'scene').map(item => item.label);
    assert.ok(names.includes('Observable facts') && names.includes('Known places') && names.includes('Ambient people'));
    assert.ok(names.includes('World detail'), 'a built section that starts off is offered (B20)');
    assert.deepEqual(catalog.notRequested(catalog.setOn(catalog.setMode(config, 'roll', 'tray'), 'roll:lines', true), 'roll'), [], 'a card in the tray whose one section is on offers nothing (B22)');
    assert.deepEqual(catalog.notRequested(catalog.setOn(config, 'scene:facts', true), 'scene').map(item => item.label).includes('Observable facts'), false);
    assert.match(settingsUi.switchAnchor('scene:facts'), /^#ri-card-switch-scene-s-facts$/);
    assert.match(settingsUi.switchAnchor('scene.place'), /^#ri-card-switch-scene-f-place$/);
});

// ---------- templates ----------

const text = node => node.textContent;
const all = nodes => nodes.filter(Boolean).map(text).join('\n');

test('every template draws, with no emoji and no text below 12 px set inline', () => {
    const nodes = [
        T.row('Mind', 'Getting the column out by the second bell'),
        T.blockMeter(6, { label: 'Tenderness' }),
        T.changeChip(2, 'she kept the secret'), T.changeChip(-1), T.gauge(7, { label: 'Level', delta: 1, reason: 'trust' }),
        T.chipList(['Hale', 'Marten']), T.timelineRows([{ text: 'The column rides at the second bell.', status: 'open' }, { text: 'Wagon loaded', status: 'done', note: 'reply 2' }]),
        T.quoteBlock('He wants an audience for it.', { italic: true }), T.avatar('Hale of Verath'), T.textGrid(['#####', '#.@.#']),
        T.starRow(3), T.severityMark('severe', 'Bruised shoulder'), ...T.FACULTIES.map(item => T.emblem(item, 7)),
        T.rollLine({ who: 'Heather', attempt: 'Persuade the lord', stat: 'Charm', difficulty: 'Very hard', total: 15, against: 17, degree: 'Partial failure', die: 12, modifier: 3 }),
        T.bulletList(['A cart with a split axle', 'The bell is cracked']),
    ];
    for (const node of nodes) {
        assert.ok(node, 'drew');
        assert.doesNotMatch(text(node), EMOJI);
        for (const el of node.find(item => item.style && item.style.fontSize)) assert.fail(`inline font size on ${el.tagName}`);
    }
    assert.equal(all([T.blockMeter(6)]), '▮▮▮▮▮▮▯▯▯▯6', 'block meter');
    assert.equal(text(T.blockMeter(3, { max: 5, blocks: 5 })), '▮▮▮▯▯3');
    assert.equal(text(T.starRow(3)), '★★★☆☆', 'typographic stars');
    assert.equal(T.blockMeter('x'), null);
    assert.match(text(T.rollLine({ who: 'Heather', attempt: 'Persuade the lord', stat: 'Charm', difficulty: 'Very hard', total: 15, against: 17, degree: 'Partial failure', die: 12, modifier: 3 })),
        /Heather: Persuade the lord, Charm, Very hard: 15 vs 17, partial failure\s*d20 12 \+3/);
    assert.match(text(T.changeChip(2, 'trust')), /\+2 trust/);
    assert.match(text(T.changeChip(-1)), /−1/);
    assert.match(text(T.severityMark('severe', 'Bruised shoulder')), /Bruised shoulder.*Severe/);
});

test('a long value folds to one line and keeps its full text; a short one stays plain', () => {
    const long = 'Rain on the stable roof; the first riders wait under the gatehouse arch while the steward finishes his speech at the gate.';
    const folded = T.foldedValue(long);
    assert.equal(folded.tagName, 'DETAILS');
    assert.equal(text(folded), long, 'the full text is in place');
    assert.equal(T.foldedValue('Light rain').tagName, 'SPAN');
    assert.equal(T.row('Empty', ''), null, 'an empty value draws no row');
    assert.equal(T.rows([null, T.row('A', '')]), null, 'and an empty group draws nothing');
});

test('carried values show their source reply', () => {
    assert.equal(text(T.carried(12, 14)), 'from reply 12');
    assert.equal(T.carried(14, 14), null, 'a value set in this reply shows no source');
    assert.equal(T.carried(null, 14), null);
    const line = T.row('Mind', 'Waiting', { from: 12, current: 14 });
    assert.match(text(line), /Mind.*Waiting.*from reply 12/s);
    assert.equal(line.attrs['data-carried'], 'true');
    assert.deepEqual(T.unwrap({ v: 'x', from: 3 }), { value: 'x', from: 3 });
    assert.deepEqual(T.unwrap('plain'), { value: 'plain', from: null });
});

// ---------- the builder ----------

const reply = (extra = {}) => ({ is_user: false, mes: 'prose', extra: { roleplay_instructions: { time: String(Math.random()), v10: true, ...extra } } });

function chatOf(...records) {
    host.chat = [{ is_user: false, mes: 'Opening', extra: {} }, ...records];
    return host.chat;
}

const view = (over = {}) => ({ id: 1, rec: host.chat?.[1]?.extra?.roleplay_instructions || {}, modules: { state: true, emotions: true, relationships: true, plots: true, knowledge: true },
    snapshot: { where: 'Elerian Keep stables', time: '6:40 AM', date: 'Blossomtide 14, 348', weather: 'light rain', present: 'Hale of Verath, Marten', environment: 'Rain on the stable roof.' },
    showState: true, people: [{ name: 'Hale of Verath', fields: { mind: 'Getting the column out', heart: 'Protective' }, protected: {} }], profiles: [{ subject: 'Hale of Verath', facet: 'Dry', voice: 'Clipped', text: 'A marcher lord' }],
    records: [], planning: '', roast: '', strip: { place: 'Elerian Keep stables', time: '6:40 AM', present: ['Hale of Verath'], source: 'header' }, presentNames: ['Hale of Verath'],
    saved: null, redraw() {}, extras: {}, ...over });

test('the builder draws cards in the saved order and mode, from saved values', () => {
    chatOf(reply({ tracker: { scene: { facts: ['A cart with a split axle'], ambient: ['stable hands'], places: [{ name: 'Gatehouse arch', note: 'riders wait here' }] } } }));
    const config = catalog.setOn(catalog.setOn(catalog.setOn(catalog.normalizeConfig(undefined), 'scene:facts', true), 'scene:places', true), 'scene.ambient', true);
    const cards = buildTrayCards(view(), config);
    assert.deepEqual(cards.map(card => card.id), ['scene', 'characters']);
    const scene = cards[0];
    assert.equal(scene.first, 'Elerian Keep stables · Blossomtide 14, 348, 6:40 AM');
    const body = all(scene.body().flat(5).filter(node => node instanceof Node_));
    assert.match(body, /Observable facts/);
    assert.match(body, /A cart with a split axle/);
    assert.match(body, /Gatehouse arch/);
    assert.match(body, /stable hands/);
    assert.equal(cards[1].names[0], 'Hale of Verath');
    const off = buildTrayCards(view(), catalog.setMode(config, 'scene', 'off'));
    assert.deepEqual(off.map(card => card.id), ['characters']);
    const stripOnly = buildTrayCards(view(), catalog.setMode(config, 'scene', 'strip'));
    assert.equal(stripOnly[0].stripOnly, true, 'Strip only keeps the marks and draws no card');
    assert.ok(stripOnly[0].strip, 'with its Strip mark');
    const moved = buildTrayCards(view(), catalog.moveCard(catalog.moveCard(config, 'characters', -1), 'characters', -1));
    assert.deepEqual(moved.map(card => card.id), ['characters', 'scene']);
});

test('a card with nothing in it is left out, and a switched-off field is not drawn', () => {
    chatOf(reply());
    const bare = buildTrayCards(view({ snapshot: {}, people: [], profiles: [], strip: null, presentNames: [], showState: true }));
    assert.deepEqual(bare, []);
    const config = catalog.setOn(catalog.normalizeConfig(undefined), 'scene.weather', false);
    const scene = buildTrayCards(view(), config)[0];
    assert.doesNotMatch(all(scene.body().flat(5).filter(node => node instanceof Node_)), /light rain/);
});

test('characters show the faculty set, the thoughts and avatars only when their switches are on', () => {
    chatOf(reply({ tracker: { characters: [{ name: 'Hale of Verath', doing: 'Checking the girth', thoughts: 'He wants an audience.', ego: 7, nerve: 4, faculty_body: 8, faculty_psyche: 5 }] } }));
    const plain = buildTrayCards(view(), catalog.normalizeConfig(undefined)).find(card => card.id === 'characters');
    const plainText = all(plain.body().flat(5).filter(node => node instanceof Node_));
    assert.doesNotMatch(plainText, /Ego|Nerve|audience|Checking/);
    assert.match(plainText, /Mind.*Getting the column out/s);
    let config = catalog.setOn(catalog.setOn(catalog.normalizeConfig(undefined), 'characters:faculty', true), 'characters:now', true);
    config = catalog.setOn(config, 'characters.thoughts', true);
    const rich = buildTrayCards(view(), config).find(card => card.id === 'characters');
    const richText = all(rich.body().flat(5).filter(node => node instanceof Node_));
    assert.match(richText, /Checking the girth/);
    assert.match(richText, /Ego/);
    assert.match(richText, /Nerve/);
    assert.match(richText, /He wants an audience/);
    assert.doesNotMatch(richText, EMOJI);
});

test('values carried from an earlier reply say which reply they came from', () => {
    const first = reply({ time: 'a', stateChanges: [{ name: 'Hale of Verath', fields: { mind: 'Getting the column out', heart: 'Protective' } }] });
    const second = reply({ time: 'b', stateChanges: [{ name: 'Hale of Verath', fields: { heart: 'Wary' } }] });
    chatOf({ is_user: true, mes: 'go', extra: {} }, first, { is_user: true, mes: 'on', extra: {} }, second);
    assert.equal(replyNumber(2), 1);
    assert.equal(replyNumber(4), 2);
    assert.equal(carriedFrom(4, 'Hale of Verath', 'mind'), 1, 'mind was set in reply 1');
    assert.equal(carriedFrom(4, 'Hale', 'heart'), null, 'a short name does not match; heart was set here for the full name only');
    assert.equal(carriedFrom(4, 'Hale of Verath', 'heart'), null, 'heart was set in this reply');
    const cards = buildTrayCards(view({ id: 4, rec: second.extra.roleplay_instructions, people: [{ name: 'Hale of Verath', fields: { mind: 'Getting the column out', heart: 'Wary' }, protected: {} }] }), catalog.normalizeConfig(undefined));
    const characters = cards.find(card => card.id === 'characters');
    const body = all(characters.body().flat(5).filter(node => node instanceof Node_));
    assert.match(body, /Getting the column out.*from reply 1/s);
    assert.doesNotMatch(body, /Wary.*from reply 2/s);
});

test('a Strip only card keeps its Strip marks and draws no card in Compact or Expanded', () => {
    chatOf(reply());
    const cards = buildTrayCards(view(), catalog.setMode(catalog.normalizeConfig(undefined), 'scene', 'strip'));
    const shown = tray.visibleCards(cards, {});
    assert.equal(tray.stripMarks(shown).scene.place, 'Elerian Keep stables', 'the Strip keeps the place');
    assert.deepEqual(shown.filter(card => !card.stripOnly).map(card => card.id), ['characters'], 'the tray draws the rest');
});

test('Roll draws one line per stored roll and nothing for a reply with none (B22)', () => {
    let config = catalog.setMode(catalog.setMode(catalog.normalizeConfig(undefined), 'roll', 'tray'), 'stats', 'tray');
    config = catalog.setOn(config, 'roll:lines', true);
    chatOf(reply());
    assert.ok(!buildTrayCards(view(), config).some(card => card.id === 'roll'), 'no roll, no Roll card');
    const roll = { actor: 'user', name: 'Mira', attempt: 'persuade the lord', stat: 'Charm', mod: 2, step: 'Very hard', dc: 17, stance: 'resisting', die: 13, total: 15, margin: -2, degree: 'Partial failure', source: 'detected', route: 'desktop' };
    chatOf(reply({ dice: { swipe: 0, rolls: [roll] } }));
    const card = buildTrayCards(view(), config).find(item => item.id === 'roll');
    assert.ok(card, 'the Roll card draws');
    const lines = [card.body()].flat(3).flatMap(node => node.byClass('ri-c-oneline'));
    assert.equal(lines.length, 1);
    assert.match(lines[0].textContent, /Persuade the lord, Charm, Very hard: 15 vs 17, partial failure/);
    assert.match(lines[0].textContent, /d20 13 \+2$/);
    assert.equal(catalog.cardById('roll').owner, 'B22');
    assert.equal(catalog.cardById('stats').owner, 'B22');
});

test('no emoji in the catalog, the templates or the settings text', () => {
    for (const file of ['src/cards/catalog.js', 'src/ui/card-templates.js', 'src/ui/reply-cards.js', 'src/ui/reply-world.js', 'src/ui/tray-settings.js']) {
        assert.doesNotMatch(readFileSync(join(root, file), 'utf8'), EMOJI, file);
    }
    for (const card of catalog.CARDS) assert.doesNotMatch(JSON.stringify(card), EMOJI, card.id);
});
