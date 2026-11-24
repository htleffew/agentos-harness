// B37: option banks, pools, pick counts, seeded rolls and roll records. Runs with node --test, no host needed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const extensionSettings = {};
globalThis.SillyTavern = { getContext: () => ({ extensionSettings, chat: [{ is_user: false, mes: 'The last reply.' }], saveSettingsDebounced() {} }) };
const load = rel => import(pathToFileURL(path.join(root, rel)).href);
const read = file => JSON.parse(fs.readFileSync(path.join(root, 'src/banks', file), 'utf8'));
const ROLLS = 1000;

let B; let E;
const ready = (async () => { B = await load('src/banks.js'); E = await load('src/events.js'); await B.loadShipped(async f => read(f)); })();

// A12 tables d.2 and d.3.
const TARGETS = { genre: 44, tone: 36, situation: 72, complication: 48, constraint: 36, twist: 28, stake: 30, consequence: 36, driver: 5, engine: 10, social: 24, ambient: 30, subtext: 30, pace: 12,
    author: 30, stance: 12, lens: 18, mood: 24, register: 8, rhythm: 6, density: 6, figurative: 6, distance: 6, showtell: 5, dialogue: 5, texture: 4, sense: 8, pacing: 10, rule: 20, habits: 24, pov: 8, length: 5 };

const category = (name, items, extra = {}) => E.newCategory(name, items, extra);
const roll = (ri, prev, seed, extra = {}) => E.rollEvent(ri, prev, { seed, ...extra });

test('every shipped item names its source and the banks meet the A12 counts', async () => {
    await ready;
    const index = read('index.json');
    for (const entry of index.banks) {
        const bank = read(`${entry.id}.json`);
        assert.ok(bank.items.length > 0, `${entry.id} is empty`);
        for (const it of bank.items) {
            assert.ok(it.source && typeof it.source === 'object', `${it.id} has no source field`);
            assert.ok(it.source.author && it.source.file, `${it.id} source names no author and file`);
            assert.ok(String(it.text).trim() && String(it.label).trim(), `${it.id} is empty`);
            assert.doesNotMatch(`${it.label} ${it.text}`, /\p{Emoji_Presentation}|\uFE0F/u, `${it.id} has an emoji`);
            if (it.source.ours) assert.equal(it.source.file, 'ours');
        }
        assert.equal(new Set(bank.items.map(i => i.id)).size, bank.items.length, `${entry.id} repeats an id`);
    }
    for (const [id, n] of Object.entries(TARGETS)) assert.ok(read(`${id}.json`).items.length >= n, `${id} has fewer than ${n} items`);
    const sources = new Set(index.banks.flatMap(b => read(`${b.id}.json`).items.map(i => i.source.work)));
    for (const work of ["Pura's Director Preset 16.0", "Writer's Block Unlimited 2.1", 'HawThorne V3, loadout General', "Writer's Workbench", 'From AI anti-slop to a classic writer (LoreBary plugin)', 'Roleplay Instructions']) assert.ok(sources.has(work), `no item from ${work}`);
    const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    for (const name of ['Pura', 'bell333', 'Deiomo', "Writer's Block Unlimited", 'HawThorne']) assert.match(readme, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `the README credits name no ${name}`);
});

test('adult banks ship off: flagged, hidden from the default choices, never linked by default', async () => {
    await ready;
    const adult = read('index.json').banks.filter(b => b.adult);
    assert.ok(adult.length >= 1);
    assert.ok(!B.bankChoices('event').some(b => b.adult));
    assert.ok(B.bankChoices('event', { adult: true }).some(b => b.adult));
    const linked = [...E.defaultCategories(), ...E.defaultStyleCategories()].map(c => c.bank);
    assert.ok(!linked.some(id => adult.some(a => a.id === id)));
});

test('first use makes one disabled entry per dimension; her edits survive an update that adds new items', async () => {
    await ready;
    const shipped = B.shippedBanks();
    const book = B.bookFromShipped(shipped);
    const entries = Object.values(book.entries);
    assert.equal(entries.length, shipped.banks.size);
    assert.ok(entries.every(e => e.disable === true && e.extensions.ri.type === 'bank'));
    assert.ok(entries.every(e => e.content.startsWith('{{random::')));
    const tone = entries.find(e => e.extensions.ri.dim === 'tone');
    const [first, second] = tone.extensions.ri.items;
    B.setBankItems(book, 'tone', tone.extensions.ri.items.filter(i => i.id !== second.id).map(i => i.id === first.id ? { ...i, text: 'MY OWN WORDING', on: false } : i));
    const update = { version: shipped.version + 1, banks: [...shipped.banks.values()].map(b => b.id === 'tone' ? { ...b, items: [...b.items, { id: 'tone.ours.brand-new', label: 'Brand new', text: 'brand new tone', source: { author: 'x', file: 'ours', ours: true } }] } : b) };
    const added = B.mergeShipped(book, B.setShipped(update));
    assert.equal(added, 1);
    const after = Object.values(book.entries).find(e => e.extensions.ri.dim === 'tone').extensions.ri.items;
    assert.equal(after.find(i => i.id === first.id).text, 'MY OWN WORDING');
    assert.equal(after.find(i => i.id === first.id).on, false);
    assert.ok(!after.some(i => i.id === second.id), 'a removed shipped item came back');
    assert.equal(after.find(i => i.id === 'tone.ours.brand-new').new, true);
    assert.equal(B.mergeShipped(book, B.shippedBanks()), 0);
    B.setShipped({ version: shipped.version, banks: [...shipped.banks.values()] });
});

test('pools: none ticked draws from every item that is on, one ticked is fixed, several limit the draw', async () => {
    await ready;
    B.setBankData(B.bookFromShipped());
    const base = () => category('Tone', [], { bank: 'tone' });
    const items = B.bankItems('tone');
    const off = items[3].id;
    const book = B.bookFromShipped();
    B.setBankItems(book, 'tone', items.map(i => i.id === off ? { ...i, on: false } : i));
    B.setBankData(book);
    const none = base(); const seen = new Set();
    for (let s = 0; s < ROLLS; s++) { const r = roll({ type: 'event', categories: [none] }, null, s); assert.notEqual(r.parts[0].ids[0], off); seen.add(r.parts[0].ids[0]); }
    assert.equal(seen.size, items.length - 1, 'with none ticked every item that is on is drawn');
    const one = base(); one.pool = [items[5].id];
    for (let s = 0; s < ROLLS; s++) assert.deepEqual(roll({ type: 'event', categories: [one] }, null, s).parts[0].ids, [items[5].id]);
    const several = base(); several.pool = [items[1].id, items[2].id, items[7].id];
    const got = new Set();
    for (let s = 0; s < ROLLS; s++) { const id = roll({ type: 'event', categories: [several] }, null, s).parts[0].ids[0]; assert.ok(several.pool.includes(id)); got.add(id); }
    assert.equal(got.size, 3);
    B.setBankData(null);
});

test('pick counts draw different values, the whole pool when the count is larger, joined by the send rule', async () => {
    await ready;
    const cat = category('Tone', ['wry', 'tense', 'warm', 'cold', 'bright'], { count: 3 });
    for (let s = 0; s < ROLLS; s++) { const r = roll({ type: 'style', categories: [cat] }, null, s); assert.equal(new Set(r.parts[0].ids).size, 3); }
    const small = category('Tone', ['wry', 'tense'], { count: 5 });
    assert.equal(roll({ type: 'style', categories: [small] }, null, 1).parts[0].ids.length, 2);
    assert.equal(B.joinValues(['a', 'b'], 'together'), 'a and b');
    assert.equal(B.joinValues(['a', 'b', 'c'], 'together'), 'a, b and c');
    assert.equal(B.joinValues(['a', 'b'], 'beat'), 'one for each beat, in turn: a, then b');
    assert.equal(B.joinValues(['a', 'b'], 'paragraph'), 'one for each paragraph, in turn: a, then b');
    const beat = category('Tone', ['wry', 'tense', 'warm'], { count: 2, send: 'beat' });
    assert.match(roll({ type: 'style', categories: [beat] }, null, 3).text, /Tone: one for each beat, in turn: \w+, then \w+/);
    const held = category('Mood', ['a', 'b', 'c', 'd', 'e'], { count: 2, mode: 'keepRandom', keepMin: 3, keepMax: 3 });
    const ri = { type: 'style', categories: [held] };
    let prev = null; let first = null;
    for (let n = 0; n < 4; n++) { const r = roll(ri, prev, 100 + n); if (!first) first = r.parts[0].ids; else if (n < 3) assert.deepEqual(r.parts[0].ids, first, 'a held pick keeps all its values together'); prev = r.state; }
});

test('pools and counts save per set, survive a reload and an export and import, and recipes restore them', async () => {
    await ready;
    const make = (name, pool, count) => { const ev = E.newStyle(name); const c = ev.categories.find(x => x.bank === 'tone'); c.pool = pool; c.count = count; return ev; };
    const ids = B.bankItems('tone').map(i => i.id);
    const a = make('A', ids.slice(0, 2), 2); const b = make('B', ids.slice(5, 9), 3);
    const books = [a, b].map(ev => { const data = { entries: {} }; E.writeEvent(data, ev); return JSON.parse(JSON.stringify(data)); });
    const back = books.map(data => E.readEvent(E.findEventEntry(data, 'style'), 'x'));
    assert.deepEqual(back[0].categories.find(c => c.bank === 'tone').pool, ids.slice(0, 2));
    assert.equal(back[0].categories.find(c => c.bank === 'tone').count, 2);
    assert.deepEqual(back[1].categories.find(c => c.bank === 'tone').pool, ids.slice(5, 9));
    assert.equal(back[1].categories.find(c => c.bank === 'tone').count, 3);
    const recipe = E.snapshotSettings(back[0].categories);
    const tone = back[0].categories.find(c => c.bank === 'tone');
    tone.pool = []; tone.count = 1; tone.send = 'paragraph';
    E.loadSettings(back[0].categories, recipe);
    assert.deepEqual(tone.pool, ids.slice(0, 2));
    assert.equal(tone.count, 2);
    assert.equal(tone.send, 'beat');
});

test('prompt text is built in code: one line per category, none for an empty one, in her order; all fixed repeats exactly', async () => {
    await ready;
    const a = category('Second', ['beta'], { mode: 'keepFixed' }); a.fixed = a.items[0].id;
    const b = category('First', ['alpha'], { mode: 'keepFixed' }); b.fixed = b.items[0].id;
    const empty = category('Nothing', []);
    const ri = { type: 'event', categories: [b, empty, a] };
    const first = roll(ri, null, 1);
    assert.match(first.text, /built from these parts: First: alpha; Second: beta\./);
    assert.doesNotMatch(first.text, /Nothing/);
    let prev = first.state;
    for (let s = 2; s < 52; s++) { const r = roll(ri, prev, s); assert.equal(r.text, first.text); prev = r.state; }
    assert.equal(E.buildLine({ name: 'Tone', items: ['wry.', 'warm'], send: 'together', after: '' }), 'Tone: wry and warm');
});

test('a roll makes no network request: fetch and the route layer stay untouched across 1,000 rolls', async () => {
    await ready;
    let calls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => { calls++; throw new Error('no network in a roll'); };
    const routing = await load('src/routing.js');
    const offRoute = routing.onChainResult(() => { calls++; });
    try {
        const ev = E.newEvent('Net'); const st = E.newStyle('Net style');
        st.categories.forEach(c => { if (!c.locked) c.on = true; });
        let pe = null; let ps = null;
        for (let s = 0; s < ROLLS; s++) {
            const r = E.rollEvent(ev, pe, { seed: s, reply: s + 1 }); if (r) { pe = r.state; assert.ok(!r.polish); }
            const t = E.rollEvent(st, ps, { seed: s, reply: s + 1 }); ps = t.state; assert.ok(!t.polish);
        }
    } finally { globalThis.fetch = realFetch; offRoute?.(); }
    assert.equal(calls, 0);
});

test('every roll keeps a record that a replay with its seed reproduces, and that keeps its values after a bank change', async () => {
    await ready;
    const ev = E.newEvent('Record');
    const r = E.rollEvent(ev, null, { seed: 4242, reply: 9 });
    const rec = r.roll;
    assert.equal(rec.seed, 4242);
    assert.equal(rec.reply, 9);
    assert.ok(rec.bank && Number.isInteger(rec.bank.v) && rec.bank.revs.situation >= 1);
    assert.ok(rec.cats.every(c => Array.isArray(c.pool) && Number.isInteger(c.count)));
    assert.equal(rec.drawn.length, r.parts.length);
    assert.ok(rec.drawn.every(d => d.ids.length && d.texts.length === d.ids.length));
    const again = E.replayRoll(ev, rec);
    assert.ok(E.sameDraw(rec, again.roll));
    assert.equal(again.text, r.text);
    for (let s = 0; s < 200; s++) { const x = E.rollEvent(ev, null, { seed: s }); assert.ok(E.sameDraw(x.roll, E.replayRoll(ev, x.roll).roll)); }
    const saved = JSON.parse(JSON.stringify(rec));
    const sit = ev.categories.find(c => c.bank === 'situation'); sit.pool = [B.bankItems('situation')[0].id];
    assert.deepEqual(saved.drawn, rec.drawn, 'the record keeps the values it drew');
    const changed = E.replayRoll({ ...ev, categories: ev.categories }, { ...rec, cats: rec.cats.filter(c => c.id !== sit.id) });
    assert.ok(changed);
});

test('never-together pairs and the active-category cap hold across 1,000 seeded rolls', async () => {
    await ready;
    const cats = [
        category('A', [['calm one', 'calm'], ['loud one', 'loud'], ['plain a', '']], { count: 2 }),
        category('B', [['calm two', 'calm'], ['loud two', 'loud'], ['plain b', '']], { count: 2 }),
        ...['C', 'D', 'E', 'F', 'G', 'H', 'I'].map(n => category(n, [`${n}1`, `${n}2`, `${n}3`])),
    ];
    const ri = { type: 'style', categories: cats, neverTogether: 'calm+loud', cap: 6 };
    let prev = null; const used = new Map();
    for (let s = 0; s < ROLLS; s++) {
        const r = roll(ri, prev, s);
        const tags = r.parts.flatMap(p => p.ids.map(id => cats.flatMap(c => c.items).find(i => i.id === id).tags));
        assert.ok(!(tags.includes('calm') && tags.includes('loud')), `roll ${s} put calm with loud`);
        assert.ok(r.parts.length <= 6, `roll ${s} used ${r.parts.length} categories`);
        for (const p of r.parts) used.set(p.catId, (used.get(p.catId) || 0) + 1);
        prev = r.state;
    }
    assert.equal(used.size, cats.length, 'every category gets a turn under the cap');
});

test('hidden subtext and ambient items keep their earliest reply, chance, duration, rest and the cap of two', async () => {
    await ready;
    const items = [
        { id: 'light', text: 'light', on: true, weight: 1, tags: '', gate: { reply: 12, die: 3, dur: [2, 3], rest: [10, 15] } },
        { id: 'mid', text: 'mid', on: true, weight: 1, tags: '', gate: { reply: 18, die: 2, dur: [2, 3], rest: [15, 20] } },
        { id: 'heavy', text: 'heavy', on: true, weight: 1, tags: '', gate: { reply: 28, die: 2, dur: [2, 3], rest: [25, 30] } },
        { id: 'amb', text: 'amb', on: true, weight: 1, tags: '', gate: { reply: 8, die: 1, dur: [1, 1], rest: [3, 6] } },
    ];
    const cat = E.newCategory('Hidden subtext', items, { gate: 'tier', gateMax: 2 });
    cat.items.forEach((it, i) => { it.gate = items[i].gate; it.id = items[i].id; });
    const ri = { type: 'event', categories: [cat] };
    let prev = null; const runs = new Map(); const lastEnd = new Map(); let firings = 0;
    for (let reply = 1; reply <= ROLLS; reply++) {
        const r = E.rollEvent(ri, prev, { seed: reply * 7, reply });
        const shown = r ? r.parts[0].ids : [];
        assert.ok(shown.length <= 2, `reply ${reply} had ${shown.length} active`);
        for (const it of items) {
            const on = shown.includes(it.id);
            if (on) assert.ok(reply >= it.gate.reply, `${it.id} before reply ${it.gate.reply}`);
            const run = runs.get(it.id) || 0;
            if (on) {
                if (!run && lastEnd.has(it.id)) assert.ok(reply - lastEnd.get(it.id) > it.gate.rest[0], `${it.id} rested too little`);
                if (!run) firings++;
                runs.set(it.id, run + 1);
            } else if (run) {
                assert.ok(run >= it.gate.dur[0] && run <= it.gate.dur[1], `${it.id} lasted ${run}`);
                runs.set(it.id, 0); lastEnd.set(it.id, reply - 1);
            }
        }
        prev = r ? r.state : prev && { ...prev, reply };
    }
    assert.ok(firings > 20);
});

test('polish is off by default, runs through the routed model when on, and falls back to the raw parts', async () => {
    await ready;
    assert.equal(E.readEvent({ uid: 0, extensions: { ri: { type: 'event', categories: [] } } }, 'x').polish, false);
    const ev = E.newEvent('Polish'); ev.polish = true;
    const rolled = E.rollEvent(ev, null, { seed: 5 });
    assert.equal(rolled.polish, true);
    const ok = await B.polishParts({ type: 'event', parts: rolled.parts, run: async o => ({ ok: true, text: `Smooth: ${o.user.length > 0}` }) });
    assert.deepEqual(ok, { ok: true, text: 'Smooth: true' });
    const slow = await B.polishParts({ type: 'event', parts: rolled.parts, timeoutMs: 30, run: () => new Promise(() => {}) });
    assert.equal(slow.ok, false);
    const item = { key: 'k', sentAs: 'system', version: 'RAW', text: 'RAW', parts: rolled.parts, polishWanted: true, polishType: 'event' };
    const failed = { ...item, key: 'f' };
    const notes = []; const texts = new Map(); const entries = new Map([['k', { content: 'RAW' }]]);
    let call = 0;
    await B.polishItems([item, failed], { entries, texts, lastScan: { items: [{ key: 'k', version: 'RAW' }] }, wrap: (s, t) => `[${t}]`, note: n => notes.push(n),
        run: async () => (call++ === 0 ? { ok: true, text: 'POLISHED' } : { ok: false, reason: 'error' }) });
    assert.equal(item.text, '[POLISHED]');
    assert.equal(entries.get('k').content, '[POLISHED]');
    assert.deepEqual(item.polished, { raw: 'RAW', text: 'POLISHED', ok: true });
    assert.equal(failed.version, 'RAW');
    assert.equal(failed.polished.ok, false);
    assert.equal(notes.length, 1);
    assert.equal(B.POLISH_MS, 8000);
});
