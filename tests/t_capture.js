// MB3: capture after each reply (memory DESIGN 5.1, 7.1, 7.2). The extension's own modules run in Node on a host in
// SillyTavern's shape; the capture chain is replaced by scripted model answers, so every check here runs with no model.
//   node --test tests/t_capture.js
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE = path.join(here, '..', 'docs', 'ux-overhaul', 'memory', 'evidence', 'MB3');
const KEY = 'roleplay_instructions';
const t0 = Date.parse('2026-11-23T10:00:00Z');

function message(i, text, user = false) {
    const send_date = new Date(t0 + i * 60000).toISOString();
    return { name: user ? 'Heather' : 'Hale of Verath', is_user: user, mes: text, send_date, swipe_id: 0, swipes: [text], swipe_info: [{ send_date, extra: {} }], extra: {} };
}
const host = {
    chat: [message(0, 'Hale waits at the gatehouse of Elerian Keep.')],
    chatMetadata: {}, extensionSettings: {}, name1: 'Heather', name2: 'Hale of Verath', characters: [{ name: 'Hale of Verath' }], characterId: 0,
    saves: 0, getCurrentChatId: () => 'mb3-chat',
    saveChat: async () => { host.saves += 1; }, saveSettingsDebounced() {}, saveMetadataDebounced() {}, saveMetadata() {},
    eventSource: { on() {} }, eventTypes: {},
};
globalThis.SillyTavern = { getContext: () => host };
globalThis.toastr = { warning() {}, info() {}, error() {}, success() {} };

const C = await import('../src/memory/capture.js');
const V = await import('../src/memory/validate.js');
const F = await import('../src/memory/fold.js');
const S = await import('../src/memory/store.js');
const K = await import('../src/cards/catalog.js');
const STATE = await import('../src/state.js');
const CLOCK = await import('../src/story-clock.js');
const V10 = await import('../src/v10.js');
const WF = await import('../src/worldflow.js');
const I = await import('../src/memory/import.js');

const out = { suite: 'tests/t_capture.js', run: new Date().toISOString() };
const store = S.memoryStore();
const say = (player, reply) => { const n = host.chat.length; host.chat.push(message(n, player, true), message(n + 1, reply)); return n + 1; };
/** A scripted capture chain: returns the answers in order and records each request. */
function scripted(...answers) {
    const sent = [];
    const run = async request => { sent.push(request); const value = answers.shift(); return value === undefined ? { ok: false, reason: 'no answer' } : { ok: true, value, route: 'desktop', model: 'gemma4:12b' }; };
    return { run, sent };
}
const op = (o) => ({ target: [], kind: 'fact', subject: '', ...o });

// ---------------------------------------------------------------- the request

test('the chat request carries no update-block instructions and the reply keeps prose and its header line', async () => {
    const turn = V10.prepareTurn([], { where: 'Elerian Keep', present: 'Hale' }, 'normal', { ...V10.DEFAULT_MODULES, roast: false }, null);
    assert.doesNotMatch(turn.text, /story_update|repairChanges|changes: an array/);
    assert.equal(turn.repair, null);
    const roast = V10.prepareTurn([], {}, 'normal', { ...V10.DEFAULT_MODULES, roast: true }, null);
    assert.match(roast.text, /<roast>/, 'the Roast card still asks for its own block');
    assert.doesNotMatch(roast.text, /story_update/);
    assert.equal(typeof WF.buildAsk, 'function');
    const flow = await WF.prepareWorld('normal', 1, {});
    assert.ok(!flow || !('ask' in flow), 'prepareWorld returns no update request');
    out.request = { turnChars: turn.text.length, roastChars: roast.text.length };
});

test('the capture request imports its field list from the card catalog; a field switched off is absent', () => {
    const today = K.captureFields(K.normalizeConfig({}));
    const req = C.buildCaptureRequest({ exchanges: [{ player: 'I ask Edren what he packs.', prose: 'Edren packed two waterskins.', reply: 1 }], fields: today, cast: ['Hale', 'Heather'] });
    for (const f of today) assert.ok(req.system.includes(`${f.card}.${f.field} `), `${f.key} asked`);
    const off = K.setOn(K.normalizeConfig({}), K.fieldKey('scene', 'weather'), false);
    const fewer = K.captureFields(off);
    const req2 = C.buildCaptureRequest({ exchanges: [{ player: 'x', prose: 'y', reply: 1 }], fields: fewer });
    assert.ok(!req2.system.includes('scene.weather'));
    assert.ok(!('weather' in req2.schema.properties.state.properties.scene.properties));
    // Every card on: each enabled field is in the state schema.
    const all = { on: {}, mode: {} };
    for (const { card, section, key } of K.allFields()) { all.on[key] = true; all.on[K.sectionKey(card.id, section.id)] = true; }
    for (const card of K.CARDS) all.mode[card.id] = 'tray';
    const every = K.captureFields(K.normalizeConfig(all));
    const schema = C.captureSchema(every);
    for (const f of every) {
        const cardSchema = schema.properties.state.properties[f.card];
        const props = [].concat(cardSchema.type).includes('array') ? cardSchema.items.properties : cardSchema.properties;
        assert.ok(props[f.field], `${f.key} in the state schema`);
    }
    out.fields = { today: today.length, every: every.length, weatherOff: fewer.length };
});

// ---------------------------------------------------------------- the checks

test('the quote check replaces supportsClaim: the three M1a completions it rejected now pass with a model ruling', () => {
    // The three scripted completions of the M1a run (memory/evidence/m1a/harness/turns.js), each rejected by supportsClaim (M1a W2).
    const cases = [
        { claim: "Hale paid a hundred silver from Aldric's purse.", record: { id: 'valen-toll', kind: 'thread', threadType: 'Seed', subject: 'Darius', text: 'Lord Darius doubled the toll at Valen Ford, and every rider must pay.', status: 'current' },
            prose: 'At Valen Ford a toll keeper stood on the bank with a tally stick. "Two silver a rider," he said. Hale counted out a hundred silver from Aldric\'s purse and the column crossed the river.',
            op: { op: 'complete', id: 'valen-toll', target: ['valen-toll'], kind: 'thread', subject: 'Darius', text: 'The toll was paid.', outcome: "Hale paid a hundred silver from Aldric's purse.", quote: "Hale counted out a hundred silver from Aldric's purse" } },
        { claim: 'the edge of the Northwood', record: { id: 'northwood-riders', kind: 'thread', threadType: 'Plan', subject: 'Northwood riders', text: 'Twenty bannerless riders are moving in the Northwood.', status: 'current' },
            prose: 'Twenty riders came out of the Northwood at first light. Their leader showed the black tower of Crossroads on his shield. "Lord Darius sends his patrol to escort you," he said. Hale lowered his sword.',
            op: { op: 'complete', id: 'northwood-riders', target: ['northwood-riders'], kind: 'thread', subject: 'Northwood riders', text: 'The riders are an escort.', outcome: 'The Northwood riders are a Crossroads patrol sent by Lord Darius as an escort.', quote: 'Lord Darius sends his patrol to escort you' } },
        { claim: 'The column reached Crossroads Keep on the fourth day.', record: { id: 'reach-crossroads', kind: 'thread', threadType: 'Plotline', subject: 'Hale', text: 'Hale must bring the column to Crossroads Keep within six days.', status: 'current' },
            prose: 'Lord Darius met them in the gate yard in a plain coat. He clasped Hale\'s arm too long and smiled too widely. "The General\'s hound," Darius said. "Welcome." Hale returned the grip and said nothing.',
            op: { op: 'complete', id: 'reach-crossroads', target: ['reach-crossroads'], kind: 'thread', subject: 'Hale', text: 'The column reached Crossroads Keep.', outcome: 'The column reached Crossroads Keep on the fourth day.', quote: 'Lord Darius met them in the gate yard' } },
    ];
    // supportsClaim as it stood in src/v10.js before MB3, kept here only to show what it decided on these three.
    const normalize = v => String(v || '').toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
    const common = new Set('with from into that this then they there their were have will would about after before could what when where while present heard saw said observed reported rumor belief completed finishes finish arrived started went gone'.split(' '));
    const terms = v => normalize(v).match(/[\p{L}\p{N}]+/gu)?.filter(w => w.length >= 4 && !common.has(w)).map(w => w.replace(/(?:ing|ed|s)$/u, '')) || [];
    const mentions = (text, value) => normalize(text).includes(normalize(value));
    const supportsClaim = (claim, quote, subject, prose) => {
        const who = terms(subject), wanted = terms(claim).filter(t => !who.includes(t)), supplied = new Set(terms(quote));
        const source = normalize(prose), target = normalize(quote), at = source.indexOf(target);
        const nearby = at < 0 ? '' : source.slice(Math.max(0, at - 110), at + target.length + 110);
        return (!subject || mentions(nearby, subject) || terms(nearby).some(t => who.includes(t))) && wanted.some(t => supplied.has(t));
    };
    const rows = [];
    for (const c of cases) {
        // The claim each was checked against in M1a: the outcome, or for an agenda its whereabouts (M1a W2).
        const old = supportsClaim(c.claim, c.op.quote, c.record.subject, c.prose);
        const res = V.checkCapture({ decisions: { durable_change: true }, ops: [c.op] }, { prose: c.prose, player: '', mark: 'm', swipe: 0 }, { records: [c.record] });
        rows.push({ id: c.record.id, supportsClaim: old, quoteCheck: V.quoteIn(c.op.quote, c.prose), filed: res.inputs.map(i => i.op) });
        assert.equal(old, false, `${c.record.id}: supportsClaim rejected it`);
        assert.deepEqual(res.inputs.map(i => i.op), ['complete'], `${c.record.id}: the quote check passes the model's ruling`);
    }
    out.m1aCompletions = rows;
});

test('quotes are stored as the message has them, and a quote not in the exchange drops its entry', () => {
    const prose = 'Hale ran his hand down Night’s left foreleg and lifted the hoof. The shoe was loose.';
    const res = V.checkCapture({ decisions: { durable_change: true }, ops: [
        op({ op: 'add', id: 'night-shoe', subject: 'Night', text: 'Night\'s left fore shoe is loose.', quote: "Hale ran his hand down Night's left foreleg and lifted the hoof... The shoe was loose" }),
        op({ op: 'add', id: 'made-up', subject: 'Night', text: 'Night threw a shoe.', quote: 'Night threw his shoe in the mud' }),
    ] }, { prose, player: '', mark: 'm', swipe: 0 }, { records: [] });
    assert.equal(res.inputs.length, 1);
    assert.ok(prose.includes(res.inputs[0].evidence[0].quote), 'the stored quote is in its message word for word');
    assert.match(res.dropped[0].why, /quote is not in the exchange/);
});

test('an identical add is dropped; one that only resembles a record is held out of recall as a suspect and ruled by the next call', async () => {
    const records = [{ id: 'edren-waterskins', kind: 'fact', subject: 'Edren', attribute: 'waterskins', text: 'Edren packed two spare waterskins into the armor chest.', status: 'current' }];
    const prose = 'Edren packed two spare waterskins into the armor chest. He counted them again: two waterskins, both full.';
    const same = V.checkCapture({ decisions: { durable_change: true }, ops: [op({ op: 'add', id: 'x', subject: 'Edren', attribute: 'waterskins', text: 'Edren packed two spare waterskins into the armor chest.', quote: 'Edren packed two spare waterskins' })] }, { prose, mark: 'm', swipe: 0 }, { records });
    assert.equal(same.inputs.length, 0);
    assert.match(same.dropped[0].why, /identical to edren-waterskins/);
    const like = V.checkCapture({ decisions: { durable_change: true }, ops: [op({ op: 'add', id: 'edren-full-skins', subject: 'Edren', attribute: 'waterskins', text: 'Both of Edren\'s waterskins are full of fresh water now.', quote: 'two waterskins, both full' })] }, { prose, mark: 'm', swipe: 0 }, { records });
    assert.equal(like.inputs[0].record.status, 'suspect');
    assert.equal(like.inputs[0].record.suspectOf, 'edren-waterskins');

    // In the store: the suspect is held out of the request and the page, and the next capture rules on it.
    const i1 = say('I watch Edren pack.', prose);
    store.marks();
    const job = store.begin(i1);
    await store.commit(job, [{ op: 'add', record: records[0], origin: { type: 'capture' } }, like.inputs[0]]);
    let folded = F.fold(host.chat, host.chatMetadata);
    assert.equal(folded.byId.get('edren-full-skins').status, 'suspect');
    const views = [...I.viewsFromFold(folded).values()].map(v => v.name);
    assert.ok(views.includes('edren-waterskins') && !views.includes('edren-full-skins'), 'a suspect is not in recall');
    const i2 = say('I ride on.', 'The column rode north along the river for an hour.');
    const chain = scripted({ decisions: { durable_change: false, scene_ended: false, out_of_character: false }, ops: [], state: {}, rulings: [{ id: 'edren-full-skins', ruling: 'keep' }] });
    const res = await C.runCapture([i2], { runChainFn: chain.run, store, settingsValue: { trayCards: { mode: Object.fromEntries(K.CARDS.map(c => [c.id, 'off'])) } } });
    assert.ok(res.ok);
    assert.match(chain.sent[0].user, /Suspects to rule[\s\S]*edren-full-skins resembles edren-waterskins/);
    folded = F.fold(host.chat, host.chatMetadata);
    assert.equal(folded.byId.get('edren-full-skins').status, 'current', 'ruled a separate record');
    out.suspect = { raised: 'edren-full-skins', ruling: 'keep' };
});

test('replies with no change file nothing: the call\'s answer and the restatement filter', () => {
    const records = [{ id: 'aldric-purse', kind: 'fact', subject: 'Hale', text: "A hundred silver of the General's purse is left after the toll.", status: 'current' }];
    const prose = '"A hundred silver of the General\'s," Hale said. "Darius has not asked us for anything at his own gate yet."';
    const quiet = V.checkCapture({ decisions: { durable_change: false }, ops: [op({ op: 'revise', id: 'aldric-purse', target: ['aldric-purse'], subject: 'Hale', text: 'Hale has a hundred silver.', quote: "A hundred silver of the General's" })] }, { prose, mark: 'm', swipe: 0 }, { records });
    assert.equal(quiet.inputs.length, 0);
    const repeat = V.checkCapture({ decisions: { durable_change: true }, ops: [op({ op: 'revise', id: 'aldric-purse', target: ['aldric-purse'], subject: 'Hale', text: "A hundred silver of the General's purse is left.", quote: "A hundred silver of the General's" })] }, { prose, mark: 'm', swipe: 0 }, { records });
    assert.equal(repeat.inputs.length, 0);
    assert.match(repeat.dropped[0].why, /repeats the record/);
});

test('dialogue-only claims file with the speaker as source', () => {
    const prose = '"Darius had the Saltmar road watched," Hale said, and shrugged. Heather looked at the candle.';
    const res = V.checkCapture({ decisions: { durable_change: true }, ops: [op({ op: 'add', id: 'saltmar-watch', subject: 'Darius', text: 'Darius had the Saltmar road watched.', quote: 'Darius had the Saltmar road watched' })] }, { prose, mark: 'm', swipe: 0 }, { records: [] });
    const rec = res.inputs[0].record;
    assert.deepEqual(rec.source, { speaker: 'Hale' });
    assert.equal(rec.text, 'Hale said that Darius had the Saltmar road watched.');
    const narrated = V.checkCapture({ decisions: { durable_change: true }, ops: [op({ op: 'add', id: 'candle', subject: 'Heather', text: 'Heather looked at the candle.', quote: 'Heather looked at the candle' })] }, { prose, mark: 'm', swipe: 0 }, { records: [] });
    assert.equal(narrated.inputs[0].record.source, undefined);
    out.dialogue = { text: rec.text, source: rec.source };
});

test('records keep the report register: mood language outside a stated line is not filed, feelings stay on the Emotion kind', () => {
    const prose = 'Heather told the general she would not marry Lord Valyren. She fled the keep on a stolen horse through the eastern gate.';
    const res = V.checkCapture({ decisions: { durable_change: true }, ops: [
        op({ op: 'add', id: 'fled', subject: 'Heather', text: 'Heather fled the keep on a stolen horse through the eastern gate.', quote: 'She fled the keep on a stolen horse through the eastern gate' }),
        op({ op: 'add', id: 'terrified', subject: 'Heather', text: 'Terrified, Heather fled with a heavy heart.', quote: 'She fled the keep' }),
        op({ op: 'add', id: 'refusal', kind: 'emotion', subject: 'Heather', text: 'Heather is angry at the general.', quote: 'Heather told the general she would not marry Lord Valyren' }),
    ] }, { prose, mark: 'm', swipe: 0 }, { records: [] });
    assert.deepEqual(res.inputs.map(i => i.record.id), ['fled', 'refusal']);
    assert.match(res.dropped[0].why, /mood language/);
    for (const i of res.inputs.filter(x => x.record.kind !== 'emotion')) assert.equal(V.moodWord(i.record.text), '');
});

// ---------------------------------------------------------------- level 0: the scene

test('scene weather from an earlier day is no longer sent as current (M1a W11, M1g B4 T13)', () => {
    const mark = (text, scene) => { const m = message(host.chat.length, text); m.extra[KEY] = { v: 1, scene }; return m; };
    const saved = host.chat;
    host.chat = [message(0, 'Opening.'), message(1, 'I ride.', true), mark('Rain came from the west.', { where: 'Saltmar road', date: 'Blossomtide 18, 348', time: 'dusk', weather: 'rain from the west' }),
        message(3, 'I sleep.', true), mark('Dawn on the Saltmar road.', { where: 'Saltmar road', date: 'Blossomtide 19, 348', time: 'dawn' })];
    assert.equal(STATE.sceneAt().weather, undefined, 'the rain of the 18th is not current on the 19th');
    host.chat.push(message(5, 'I wait.', true), mark('Fog lay on the road.', { date: 'Blossomtide 19, 348', time: 'morning', weather: 'fog' }));
    assert.equal(STATE.sceneAt().weather, 'fog');
    // T13: the fog burns off in the prose only; capture reports the change and the scene follows it.
    const burn = mark('By noon the fog burned off.', { time: 'noon' });
    burn.extra[KEY].tracker = { scene: { weather: 'clear' } };
    host.chat.push(message(7, 'I look up.', true), burn);
    assert.equal(STATE.sceneAt().weather, 'clear');
    assert.equal(CLOCK.sameStoryDay('Day 3, Thursday, 21:40', 'Day 4, Friday, dawn'), false);
    // The capture-side carry: weather carried only within the same story day.
    const next = C.sceneFor({ captured: { time: 'Day 4, dawn' }, previous: { time: 'Day 3, 21:40', weather: 'rain' }, headerReliable: false, previousReply: 3 });
    assert.equal(next.weather, undefined);
    const same = C.sceneFor({ captured: { time: 'Day 3, 23:00' }, previous: { time: 'Day 3, 21:40', weather: 'rain' }, headerReliable: false, previousReply: 3 });
    assert.deepEqual(same.weather, { v: 'rain', from: 3 });
    host.chat = saved;
});

test('level 0 reads the scene header into the scene; with the header unreliable the Scene card fills from capture', () => {
    const header = '**◆ The Gilded Hound, taproom** · ◷ Day 3, Thursday, 21:40 · ≈ rain, cold · ◎ Hale, Marten\n\nHale set down his cup.';
    const scene = STATE.sceneFromReplyHeader(header);
    assert.equal(scene.where, 'The Gilded Hound, taproom');
    assert.equal(scene.weather, 'rain, cold');
    assert.match(scene.date, /Day 3/);
    const h = { place: 'The Gilded Hound, taproom', time: 'Day 3, Thursday, 21:40', weather: 'rain, cold', present: ['Hale', 'Marten'] };
    const reliable = C.sceneFor({ header: h, captured: { place: 'somewhere else', weather: 'clear' }, headerReliable: true });
    assert.equal(reliable.place, h.place, 'the header gives the place while it is reliable');
    assert.equal(reliable.weather, 'clear', 'capture reports a weather change after the header');
    const unreliable = C.sceneFor({ header: h, captured: { place: 'the stable yard', time: 'Day 3, 22:10', present: 'Hale' }, headerReliable: false });
    assert.equal(unreliable.place, 'the stable yard');
    assert.deepEqual(unreliable.present, ['Hale']);
    const req = C.buildCaptureRequest({ exchanges: [{ player: 'x', prose: 'y', reply: 1 }], fields: K.captureFields(K.normalizeConfig({})), headerReliable: false });
    assert.doesNotMatch(req.system, /scene header line/, 'with the header unreliable, capture reads the scene from the prose');
});

// ---------------------------------------------------------------- the host flow

const allOff = { trayCards: { mode: Object.fromEntries(K.CARDS.map(c => [c.id, 'off'])) } };
const today = { trayCards: {} };

test('capture runs after a reply and fills the tray; the watermark is kept per chat and a pending reply shows "As of reply N"', async () => {
    const before = host.chat.length;
    const i1 = say('I ask Hale where we sleep tonight.', 'Hale pointed at the ridge. "Crying Rock," he said. "The spring there never freezes." They made camp under the rock before dark.');
    const answer = { decisions: { durable_change: true, scene_ended: false, out_of_character: false },
        ops: [op({ op: 'add', id: 'crying-rock', kind: 'place', subject: 'Crying Rock', text: 'Crying Rock has a spring that does not freeze.', quote: 'The spring there never freezes' })],
        state: { scene: { place: 'Crying Rock', time: 'Blossomtide 17, 348, dusk', present: ['Hale', 'Heather'] }, characters: [{ name: 'Hale', mind: 'Choosing the camp', body: 'Unhurt', doing: 'not asked' }] } };
    const events = [];
    const off = C.onCapture(e => events.push(e.phase));
    const chain = scripted(answer);
    const started = Date.now();
    const res = await C.runCapture([i1], { runChainFn: chain.run, store, settingsValue: today });
    off();
    assert.ok(res.ok && res.commits[0].committed);
    assert.deepEqual(events, ['capturing', 'done']);
    // The chain receives the schema as routing.js reads it ({ name, value }), so a Custom profile sends response_format.
    assert.equal(chain.sent[0].schema.name, 'capture');
    assert.ok(chain.sent[0].schema.value.properties.ops && chain.sent[0].schema.value.properties.state);
    const rec = host.chat[i1].extra[KEY];
    assert.equal(rec.tracker.scene.place, 'Crying Rock');
    assert.equal(rec.tracker.characters[0].mind, 'Choosing the camp');
    assert.equal(rec.tracker.characters[0].doing, undefined, 'a field that was not asked is not kept');
    assert.ok(C.isCaptured(host.chat[i1]));
    const wm = C.watermarkOf(host.chat);
    assert.equal(wm.index, i1);
    assert.equal(host.chatMetadata.ri_memory.capture.watermark.reply, wm.reply);
    // A fast next send: the new reply waits for capture, and its cards say which reply their state describes.
    const i2 = say('I take first watch.', 'Heather sat by the fire with her sword across her knees.');
    const status = C.captureStatus(host.chat, i2);
    assert.equal(status.pending, true);
    assert.equal(status.label, `As of reply ${wm.reply}`);
    assert.equal(host.chat[i2].extra[KEY]?.tracker, undefined, 'no stale state is stored as the new reply\'s own');
    out.flow = { captureMs: Date.now() - started, watermark: wm, pendingLabel: status.label, events, savesAfter: host.saves, firstIndex: before };
});

test('a capture that returns after a swipe commits nothing to the new swipe and is logged; a swipe shows its own tracker values', async () => {
    const i = host.chat.length - 1;   // the reply waiting from the last test
    const answer = { decisions: { durable_change: false }, ops: [], state: { scene: { place: 'Crying Rock', time: 'night' } } };
    const slow = async () => {
        // SillyTavern swipes: the shown extra goes to its slot, the new swipe starts from a copy, the text changes.
        const m = host.chat[i];
        m.swipe_info[0].extra = structuredClone(m.extra);
        m.swipes.push('Heather slept while Hale kept the watch.');
        m.swipe_info.push({ send_date: new Date().toISOString(), extra: structuredClone(m.extra) });
        m.swipe_id = 1; m.mes = m.swipes[1];
        return { ok: true, value: answer, route: 'desktop', model: 'gemma4:12b' };
    };
    const res = await C.runCapture([i], { runChainFn: slow, store, settingsValue: today });
    assert.equal(res.commits[0].discarded, true);
    assert.match(res.commits[0].reason, /another version/);
    assert.ok(!C.isCaptured(host.chat[i]));
    // Capture the new swipe, then swipe back: each swipe shows its own tracker values.
    await C.runCapture([i], { runChainFn: scripted({ decisions: { durable_change: false }, ops: [], state: { scene: { place: 'Crying Rock', time: 'midnight' } } }).run, store, settingsValue: today });
    const m = host.chat[i];
    assert.equal(m.extra[KEY].tracker.scene.time, 'midnight');
    assert.equal(m.swipe_info[1].extra[KEY].tracker.scene.time, 'midnight');
    m.swipe_info[1].extra = structuredClone(m.extra); m.swipe_id = 0; m.mes = m.swipes[0]; m.extra = structuredClone(m.swipe_info[0].extra);
    assert.equal(m.extra[KEY]?.tracker, undefined, 'the first swipe was never captured, so it shows no captured values');
    assert.ok(!C.isCaptured(m));
    m.swipe_info[0].extra = structuredClone(m.extra); m.swipe_id = 1; m.mes = m.swipes[1]; m.extra = structuredClone(m.swipe_info[1].extra);
    assert.equal(m.extra[KEY].tracker.scene.time, 'midnight');
    assert.ok(C.isCaptured(m));
});

test('out-of-character exchanges skip capture', () => {
    assert.ok(C.isOutOfCharacter('(OOC: can we skip ahead?)'));
    assert.ok(C.isOutOfCharacter('((brb))'));
    assert.ok(C.isOutOfCharacter('[OOC] pause'));
    assert.ok(C.isOutOfCharacter('~ aside', ['~']));
    assert.ok(!C.isOutOfCharacter('I open the door.'));
    const i = say('(OOC: what time is it in the story?)', 'It is dusk on the 17th.');
    assert.ok(!C.uncaptured(host.chat).includes(i));
});

test('with the state cards off, uncaptured exchanges batch every five replies and the rest ride with the chapter', async () => {
    const fieldsOff = C.enabledFields(allOff, {});
    assert.equal(fieldsOff.length, 0);
    assert.equal(C.captureEvery({ ...allOff, memory: { capture: 'five' } }, fieldsOff), 'five');
    assert.equal(C.captureEvery({ ...today, memory: { capture: 'five' } }, C.enabledFields(today, {})), 'reply', 'with state cards on, every reply is captured');
    // Mark everything so far captured, then add replies one at a time.
    for (const i of C.uncaptured(host.chat)) C.stampMessage(host.chat[i], { hash: F.hashText(F.proseOf(host.chat[i])), at: Date.now() });
    const added = [];
    for (let k = 1; k <= 4; k++) { added.push(say(`I walk ${k} miles.`, `The road ran on for mile ${k}.`)); assert.deepEqual(C.dueNow(host.chat, { mode: 'five' }), [], `no call after ${k}`); }
    added.push(say('I walk 5 miles.', 'The road ran on for mile 5. A courier from Valen passed them going south.'));
    assert.deepEqual(C.dueNow(host.chat, { mode: 'five' }), added, 'one call for the five');
    const answer = { decisions: { durable_change: true }, ops: [op({ op: 'add', id: 'valen-courier', subject: 'Valen courier', text: 'A courier from Valen passed the column going south.', quote: 'A courier from Valen passed them going south', exchange: 5 })] };
    const chain = scripted(answer);
    const res = await C.runCapture(added, { runChainFn: chain.run, store, settingsValue: allOff });
    assert.equal(res.commits.length, 5);
    assert.match(chain.sent[0].user, /Exchange 5 \(reply \d+\)/);
    assert.equal(F.fold(host.chat, host.chatMetadata).byId.get('valen-courier').versions[0].index, added[4], 'the entry is filed on the reply its quote came from');
    // Two more replies, then a chapter closes: they ride in the chapter call, which commits them before they leave the request.
    const rest = [say('I ask about the courier.', 'Hale did not know him.'), say('We camp.', 'They camped at the ford.')];
    const ride = await C.remainderForChapter(rest[1], { store, settingsValue: allOff });
    assert.deepEqual(ride.indices, rest);
    assert.match(ride.request.user, /Exchange 2/);
    const committed = await ride.commit({ decisions: { durable_change: false }, ops: [], state: [] });
    assert.ok(rest.every(i => C.isCaptured(host.chat[i])), JSON.stringify(committed));
    assert.equal(await C.remainderForChapter(rest[1], { store, settingsValue: allOff }), null);
    out.batch = { calls: chain.sent.length, replies: added.length, remainder: rest.length };
});

// ---------------------------------------------------------------- record kinds of 3.3

test('each record kind of section 3.3 is filed from a fixture reply written to need it', async () => {
    const fixtures = [
        ['person', 'I ask who the old man is.', 'The old man was Tobin Ashe, the innkeeper of the Gilded Hound for thirty years.', { subject: 'Tobin Ashe', text: 'Tobin Ashe is the innkeeper of the Gilded Hound and has kept it for 30 years.', quote: 'Tobin Ashe, the innkeeper of the Gilded Hound for thirty years' }],
        ['place', 'I look at the ford.', 'Valen Ford was a stone shelf under knee-deep water, forty yards across.', { subject: 'Valen Ford', text: 'Valen Ford is a stone shelf under knee-deep water, 40 yards across.', quote: 'Valen Ford was a stone shelf under knee-deep water, forty yards across' }],
        ['item', 'I give Jory my knife.', 'Heather handed Jory her bone-handled knife, and Jory slid it into his boot.', { subject: 'bone-handled knife', text: 'Heather gave her bone-handled knife to Jory.', quote: 'Heather handed Jory her bone-handled knife', details: [{ field: 'holder', value: 'Jory' }, { field: 'change', value: 'given' }] }],
        ['secret', 'I listen at the door.', 'Behind the door Piers Vell told the courier that the iron went to Saltmar, not to the General. Hale believed the shipments were lost to bandits.', { subject: 'Piers Vell', text: 'Piers Vell sends the missing iron to Saltmar.', quote: 'the iron went to Saltmar, not to the General', holders: ['Piers Vell', 'Heather'], believes: 'Hale believes the shipments were lost to bandits.' }],
        ['relationship', 'I thank Marten.', 'Marten clasped Heather\'s hand. "You can count on my sword now," he said.', { subject: 'Marten', text: 'Marten pledged his sword to Heather.', quote: 'You can count on my sword now', details: [{ field: 'other', value: 'Heather' }, { field: 'stand', value: 'sworn ally' }, { field: 'holding_back', value: 'his wound' }] }],
        ['reputation', 'We leave Saltmar.', 'The Saltmar fishers spat as the Vanguard rode by; three of them had lost boats to the General\'s levy.', { subject: 'Saltmar fishers', text: 'The Saltmar fishers spat at the Vanguard over the boats lost to the General\'s levy.', quote: 'The Saltmar fishers spat as the Vanguard rode by', details: [{ field: 'standing', value: 'hostile' }, { field: 'direction', value: 'falling' }] }],
        ['achievement', 'I hold the bridge.', 'Heather held the drawbridge alone until the gate came down, and the garrison cheered her name.', { subject: 'Heather', text: 'Heather held the drawbridge alone until the gate came down.', quote: 'Heather held the drawbridge alone until the gate came down', details: [{ field: 'title', value: 'Holder of the Bridge' }, { field: 'rarity', value: 'rare' }] }],
    ];
    const threads = ['Open', 'Plotline', 'Track', 'Seed', 'Detail', 'Pending', 'Plan', 'Elsewhere'].map((type, k) => [
        'thread', `I ask about lead ${k}.`, `Hale named lead ${k} for the ${type} line: the ${['salt marks', 'iron road', 'six days', 'wooden button', 'cut posts', 'Midsummer levy', 'night watch', 'Valen riders'][k]}.`,
        { subject: `lead ${k}`, thread_type: type, text: `Hale named lead ${k}, the ${['salt marks', 'iron road', 'six days', 'wooden button', 'cut posts', 'Midsummer levy', 'night watch', 'Valen riders'][k]}.`, quote: `the ${['salt marks', 'iron road', 'six days', 'wooden button', 'cut posts', 'Midsummer levy', 'night watch', 'Valen riders'][k]}` }]);
    const filed = {};
    for (const [kind, player, reply, o] of [...fixtures, ...threads]) {
        const i = say(player, reply);
        const id = `${kind}-${Object.keys(filed).length}`;
        const res = await C.runCapture([i], { runChainFn: scripted({ decisions: { durable_change: true }, ops: [op({ op: 'add', id, kind, ...o })], state: {} }).run, store, settingsValue: allOff });
        assert.ok(res.commits[0].committed, `${kind} committed`);
        const rec = F.fold(host.chat, host.chatMetadata).byId.get(id);
        assert.ok(rec, `${kind} filed`);
        assert.equal(rec.kind, kind);
        filed[id] = { kind, threadType: rec.threadType || undefined, holders: rec.holders, believes: rec.believes, holder: rec.holder, other: rec.other, standing: rec.standing, rarity: rec.rarity, stand: rec.stand, holding_back: rec.holding_back };
    }
    const kinds = new Set(Object.values(filed).map(f => f.kind));
    for (const k of ['person', 'place', 'item', 'secret', 'relationship', 'reputation', 'achievement', 'thread']) assert.ok(kinds.has(k));
    assert.deepEqual(Object.values(filed).filter(f => f.kind === 'thread').map(f => f.threadType), ['Open', 'Plotline', 'Track', 'Seed', 'Detail', 'Pending', 'Plan', 'Elsewhere']);
    const secret = Object.values(filed).find(f => f.kind === 'secret');
    assert.deepEqual(secret.holders, ['Piers Vell', 'Heather']);
    assert.match(secret.believes, /bandits/);
    assert.equal(Object.values(filed).find(f => f.kind === 'item').holder, 'Jory');
    const rel = Object.values(filed).find(f => f.kind === 'relationship');
    assert.equal(rel.other, 'Heather'); assert.equal(rel.holding_back, 'his wound');
    // Each record reaches the request as the structured kind today's request reads.
    const views = new Map([...I.viewsFromFold(F.fold(host.chat, host.chatMetadata)).values()].map(v => [v.name, v.kind]));
    assert.equal(views.get('person-0'), 'profile');
    assert.equal(views.get('secret-3'), 'knowledge');
    assert.equal(views.get('relationship-4'), 'relationship');
    out.kinds = filed;
});

// ---------------------------------------------------------------- strict schemas and the story clock (lead, 24 November)

/** The strict json_schema rules of OpenAI and NanoGPT: every object requires all of its properties and allows no others. */
function strictProblems(schema, path = 'schema', out = []) {
    const types = [].concat(schema.type || []);
    for (const word of ['maxItems', 'minItems', 'default', 'pattern', 'format', 'minimum', 'maximum']) if (word in schema) out.push(`${path} uses ${word}`);
    if (types.includes('object') || schema.properties) {
        const keys = Object.keys(schema.properties || {});
        if (schema.additionalProperties !== false) out.push(`${path} allows other properties`);
        if (JSON.stringify([...(schema.required || [])].sort()) !== JSON.stringify([...keys].sort())) out.push(`${path} does not require every property`);
        for (const key of keys) strictProblems(schema.properties[key], `${path}.${key}`, out);
    }
    if (schema.items) strictProblems(schema.items, `${path}[]`, out);
    if (Array.isArray(schema.enum) && types.includes('null') && !schema.enum.includes(null)) out.push(`${path} is nullable and its enum lacks null`);
    return out;
}

test('the capture schema is strict: every property required, optional ones nullable, no other properties', () => {
    const all = { on: {}, mode: {} };
    for (const { card, section, key } of K.allFields()) { all.on[key] = true; all.on[K.sectionKey(card.id, section.id)] = true; }
    for (const card of K.CARDS) all.mode[card.id] = 'tray';
    const cases = { today: K.captureFields(K.normalizeConfig({})), every: K.captureFields(K.normalizeConfig(all)), none: [] };
    const seen = {};
    for (const [name, fields] of Object.entries(cases)) for (const options of [{}, { batch: true }, { suspects: true }, { batch: true, suspects: true }]) {
        const schema = C.captureSchema(fields, options);
        assert.deepEqual(strictProblems(schema), [], `${name} ${JSON.stringify(options)}`);
        seen[`${name}${options.batch ? '+batch' : ''}${options.suspects ? '+suspects' : ''}`] = JSON.stringify(schema).length;
    }
    const op = C.captureSchema([]).properties.ops.items;
    assert.deepEqual(op.properties.attribute.type, ['string', 'null'], 'an optional field takes null');
    assert.deepEqual(op.properties.op.type, 'string', 'a field that was required stays non-null');
    assert.ok(op.properties.thread_type.enum.includes(null));
    // An answer with nulls in every optional field files as before.
    const nulls = Object.fromEntries(Object.keys(op.properties).map(k => [k, null]));
    const res = V.checkCapture({ decisions: { durable_change: true }, ops: [{ ...nulls, op: 'add', id: 'gate', target: [], kind: 'fact', subject: 'Elerian Keep', text: 'The gate is barred with an iron beam.', quote: 'barred with an iron beam' }] },
        { prose: 'The gate was barred with an iron beam.', mark: 'm', swipe: 0 }, { records: [] });
    assert.equal(res.inputs.length, 1);
    assert.equal(res.inputs[0].record.attribute, undefined);
    out.strict = seen;
});

test('the story clock moves by the minutes capture reports; a reply with no time cue moves it 5 minutes', async () => {
    assert.equal(C.DEFAULT_ELAPSED, 5);
    assert.deepEqual(C.elapsedOf({ elapsed: 60, cue: 'An hour later' }, 'An hour later the patrol returned.'), { minutes: 60, cue: 'An hour later', source: 'capture' });
    assert.equal(C.elapsedOf({ elapsed: 60, cue: null }, 'The patrol returned.').minutes, 5, 'no cue: the default');
    assert.equal(C.elapsedOf({ elapsed: 600, cue: 'ten hours later' }, 'The patrol returned.').source, 'default', 'a cue that is not in the reply counts for nothing');
    const seed = (i, minutes) => { host.chat[i].extra[KEY] = { ...(host.chat[i].extra[KEY] || {}), v10Minutes: minutes }; };
    const i1 = say('I wait for the patrol.', 'An hour later the patrol rode back through the gate.');
    seed(i1 - 2 >= 1 ? i1 - 2 : 0, 120);
    const before = C.minutesBefore(host.chat, i1, KEY);
    assert.equal(before, 120);
    await C.runCapture([i1], { runChainFn: scripted({ decisions: { durable_change: false }, time: { elapsed: 60, cue: 'An hour later' }, ops: [], state: {} }).run, store, settingsValue: allOff });
    assert.equal(host.chat[i1].extra[KEY].v10Minutes, 180, 'an hour later advances 60 minutes');
    assert.deepEqual(host.chat[i1].extra[KEY].v10Elapsed, { minutes: 60, cue: 'An hour later', source: 'capture' });
    const i2 = say('I nod.', 'Hale nodded back.');
    await C.runCapture([i2], { runChainFn: scripted({ decisions: { durable_change: false }, time: { elapsed: 0, cue: null }, ops: [], state: {} }).run, store, settingsValue: allOff });
    assert.equal(host.chat[i2].extra[KEY].v10Minutes, 185, 'no time cue advances the default 5 minutes');
    // A reply whose own block set the clock keeps it.
    const i3 = say('I wait.', 'They waited.');
    host.chat[i3].extra[KEY] = { v10Minutes: 300, v10ClockFromReply: true };
    await C.runCapture([i3], { runChainFn: scripted({ decisions: { durable_change: false }, time: { elapsed: 60, cue: 'They waited' }, ops: [], state: {} }).run, store, settingsValue: allOff });
    assert.equal(host.chat[i3].extra[KEY].v10Minutes, 300);
    out.clock = { hourLater: 180, noCue: 185, defaultMinutes: C.DEFAULT_ELAPSED };
});

test.after(() => {
    fs.mkdirSync(EVIDENCE, { recursive: true });
    fs.writeFileSync(path.join(EVIDENCE, 'capture-node.json'), JSON.stringify(out, null, 1));
});
