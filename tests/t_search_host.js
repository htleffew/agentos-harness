// MB4 on a real SillyTavern 1.19 host with touch and the mock model: the search model loads once and then from cache,
// the library comes from the extension folder, a managed book's entries leave the host's request above the history and
// join the recall block with the host's own scan still deciding what fires, a behavior book stays with the host, and a
// secret only the persona holds never reaches the request. Set RI_MB4_EVIDENCE to save the observations.
//
// The extension folder must hold vendor/ (the helper suites in lib.js do not copy it); install it with the host's own sync.
const fs = require('fs');
const path = require('path');
const L = require('./lib.js');

const WIDTH = Number(process.env.RI_WIDTH || 523), HEIGHT = Number(process.env.RI_HEIGHT || 1021);
const PARTS = (process.env.RI_PARTS || 'model,book,secret,timing').split(',');
const EVIDENCE = process.env.RI_MB4_EVIDENCE || '';
const EXT = L.BASE;
const out = { width: WIDTH, checks: [], notes: {} };
const check = (name, pass, detail = '') => { out.checks.push({ name, pass: !!pass, detail: String(detail) }); console.log(pass ? 'PASS' : 'FAIL', name, detail ? `| ${detail}` : ''); if (!pass) process.exitCode = 1; };
const save = (name, value) => { out.notes[name] = value; };

const requestText = r => (r.messages || []).map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n--\n');
const chatReplies = () => L.chatRequests();
const overview = r => r.messages.map((m, i) => ({ i, role: m.role, chars: (m.content || '').length, constantEntry: /kingdom of Ostrem/.test(m.content || ''), head: String(m.content || '').slice(0, 70).replace(/\n/g, ' ') }));
const lastReply = () => chatReplies().at(-1);
const firstChanged = (a, b) => { const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return i; return n; };

async function ready(page) {
    await page.waitForFunction(async ext => { const c = globalThis.SillyTavern.getContext(); return !!c.chatMetadata?.ri_memory?.imported; }, EXT, { timeout: 30000 });
}

async function newChat(page) {
    await L.openChat(page);
    await ready(page);
}

async function makeBook(page, name, entries) {
    return page.evaluate(async ({ name, entries }) => {
        const wi = await import('/scripts/world-info.js');
        const data = { entries: {} };
        for (const spec of entries) { const entry = wi.createWorldInfoEntry(name, data); Object.assign(entry, spec); }
        await wi.saveWorldInfo(name, data, true);
        await wi.updateWorldInfoList();
        const c = globalThis.SillyTavern.getContext();
        c.chatMetadata.world_info = name;
        await c.saveMetadata();
        return Object.keys(data.entries).length;
    }, { name, entries });
}
const detach = page => page.evaluate(async () => { const c = globalThis.SillyTavern.getContext(); delete c.chatMetadata.world_info; await c.saveMetadata(); });

async function main() {
    const app = await L.open({ width: WIDTH, height: HEIGHT, hasTouch: true, isMobile: true });
    const { page, errors } = app;
    page.setDefaultTimeout(30000);
    const hosts = new Map(), requests = [];
    page.on('request', r => { const u = new URL(r.url()); hosts.set(u.host, (hosts.get(u.host) || 0) + 1); requests.push(r.url()); });
    await L.setupApi(page);
    await L.setSettings(page, { check: { mode: 'off' } });

    // ------------------------------------------------------------ the search model: shipped library, one download, then the cache
    if (PARTS.includes('model')) {
        const probe = () => page.evaluate(async ext => {
            const R = await import(`${ext}/src/recall.js`);
            const { embedder } = R.recallRuntime();
            const t0 = performance.now();
            const loaded = await embedder.load();
            const loadMs = performance.now() - t0;
            const status = embedder.status();
            const vecs = loaded ? await embedder.embed(['Night, the black stallion, has a loose left foreshoe.', 'The horse has a loose shoe.', 'The harbor fee at Saltmar is twenty silver.']) : [];
            const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
            const files = await indexedDB.databases?.().then(list => list.map(d => d.name)).catch(() => []);
            return { loaded, loadMs: Math.round(loadMs), status, dim: vecs[0]?.length || 0, similar: vecs.length ? +dot(vecs[0], vecs[1]).toFixed(3) : 0, different: vecs.length ? +dot(vecs[0], vecs[2]).toFixed(3) : 0, tokens: embedder.count('Night, the black stallion, has a loose left foreshoe.'), databases: files };
        }, EXT);
        const before = requests.length;
        const first = await probe();
        const firstRequests = requests.slice(before);
        const hf = urls => urls.filter(u => /huggingface\.co|hf\.co/.test(new URL(u).host));
        save('model-first-load', { ...first, requests: firstRequests.map(u => new URL(u).host + new URL(u).pathname).filter(u => !/\/api\//.test(u)).slice(0, 40) });
        check('the search model loads in the page and embeds (384 dimensions)', first.loaded && first.dim === 384 && first.status.state === 'ready', JSON.stringify({ loadMs: first.loadMs, state: first.status.state, downloaded: !first.status.fromCache }));
        check('the first load downloads the model files from Hugging Face', hf(firstRequests).some(u => /onnx\/model_quantized\.onnx/.test(u)) && first.status.fromCache === false, `${hf(firstRequests).length} requests to Hugging Face`);
        check('similar sentences score higher than unrelated ones', first.similar > first.different + 0.2 && first.tokens >= 8, `similar ${first.similar}, different ${first.different}, ${first.tokens} tokens`);
        check('the runtime library and the WebAssembly runtime come from the extension folder, not from a CDN', requests.some(u => /vendor\/transformers\/transformers\.min\.js/.test(u)) && requests.some(u => /vendor\/transformers\/ort-wasm-simd-threaded\.wasm/.test(u)) && !requests.some(u => /jsdelivr|unpkg|cdnjs/.test(u)), `hosts: ${[...new Set(requests.map(u => new URL(u).host))].join(", ")}`);
        // a second load in the same page needs no download, and a reload of the page loads from the database
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => globalThis.SillyTavern?.getContext && document.getElementById('send_textarea') && !document.getElementById('preloader'), null, { timeout: 90000 });
        await page.waitForTimeout(1500);
        await L.setupApi(page);
        const before2 = requests.length;
        const second = await probe();
        const secondRequests = requests.slice(before2);
        save('model-second-load', { ...second, hfRequests: hf(secondRequests).length });
        check('after a reload the model loads from the cache with no request to Hugging Face', second.loaded && second.status.fromCache === true && hf(secondRequests).length === 0, `${second.loadMs} ms, ${hf(secondRequests).length} requests to Hugging Face, ${secondRequests.filter(u => /vendor\//.test(u)).length} to the extension's vendor folder`);
        check('the loaded vectors are the same as the first load', Math.abs(second.similar - first.similar) < 0.01, `${first.similar} then ${second.similar}`);
    }

    // ------------------------------------------------------------ a managed book: the host's scan decides, the entries move into the recall block
    let r1, r2, rOff1, rOff2;
    if (PARTS.includes('book')) {
        await newChat(page);
        const BOOK = 'MB4 Lore';
        const entries = [
            { key: ['dragon'], comment: 'Veyrath', content: 'The dragon Veyrath sleeps under Mount Calder and wakes at each new moon.' },
            { key: ['river'], keysecondary: ['frozen'], selective: true, selectiveLogic: 2, comment: 'Alder', content: 'The river Alder runs east through the marsh and is shallow at the ford.' },
            { key: ['castle'], group: 'castles', comment: 'Castle A', content: 'Castle Brenholt stands on the northern ridge with two towers.' },
            { key: ['castle'], group: 'castles', groupWeight: 100, comment: 'Castle B', content: 'Castle Dunmere stands on the southern shore with one tower.' },
            { key: [], constant: true, comment: 'Ostrem', content: 'The kingdom of Ostrem lies in the north and keeps four seasons.' },
            { key: ['moon'], comment: 'Moon', content: 'The new moon is the night of the harbor market in Saltmar.' },
        ];
        await makeBook(page, BOOK, entries);
        await L.setSettings(page, { recall: { books: {} } });
        const has = (text, snippet) => text.includes(snippet);
        const FIRED = ['dragon Veyrath', 'river Alder', 'new moon is the night'];
        const CASTLES = ['Castle Brenholt', 'Castle Dunmere'];
        const messages = ['I ask about the dragon and the river by the castle.', 'I ask about the new moon and the river.', 'I talk about the dragon only.'];

        // the host alone: the book is not managed
        L.resetLog(); L.mode({});
        for (const m of messages) await L.send(page, m);
        const off = chatReplies();
        save('host-only-requests', off.map(r => ({ messages: r.messages.length, overview: overview(r) })));
        const offFired = off.map(r => FIRED.filter(s => has(requestText(r), s)).concat(CASTLES.filter(s => has(requestText(r), s))));
        const offBlock = off.map(r => /<recall>/.test(requestText(r)));

        // the book is managed: Recall takes the fired entries into its block
        await newChat(page);
        await makeBook(page, BOOK, entries);
        await page.evaluate(async ext => { const { setRecallManages } = await import(`${ext}/src/chat-books.js`); setRecallManages('MB4 Lore', true); }, EXT);
        L.resetLog();
        for (const m of messages) await L.send(page, m);
        const on = chatReplies();
        const blockOf = r => (requestText(r).match(/<recall>[\s\S]*?<\/recall>/) || [''])[0];
        save('managed-requests', on.map(r => ({ messages: r.messages.length, overview: overview(r), recallBlock: blockOf(r) })));
        const onFired = on.map(r => FIRED.filter(s => has(requestText(r), s)).concat(CASTLES.filter(s => has(requestText(r), s))));
        // MB5: an entry meaning search finds with no keyword (the lore cosine cut) may join the managed run's recall block too,
        // so every entry the host fired reaches the managed request, and anything more sits inside the recall block
        const plain = x => x.filter(s => !CASTLES.includes(s));
        check('SillyTavern\'s scan decides what fires: the same entries reach the request with the book managed and not, Optional Filters and the inclusion group intact', offFired.every((x, i) => plain(x).every(s => onFired[i].includes(s))) && onFired.every((x, i) => plain(x).filter(s => !offFired[i].includes(s)).every(s => has(blockOf(on[i]), s))) && onFired.every((x, i) => x.filter(s => CASTLES.includes(s)).length === offFired[i].filter(s => CASTLES.includes(s)).length && x.filter(s => CASTLES.includes(s)).length <= 1), `host alone ${JSON.stringify(offFired)}; managed ${JSON.stringify(onFired)}`);
        check('the filtered entry is held back when its second key is missing, and the group sends at most one castle', onFired[0].filter(s => CASTLES.includes(s)).length === 1, `first turn: ${JSON.stringify(onFired[0])}`);
        check('without Recall no recall block exists for the book, and with it the fired entries sit in the recall block', offBlock.every(b => !b || !/Veyrath/.test(blockOf(off[offBlock.indexOf(b)]))) && onFired[0].filter(s => FIRED.includes(s)).every(s => has(blockOf(on[0]), s)), `block of the first managed request: ${blockOf(on[0]).slice(0, 220).replace(/\n/g, ' ')}`);
        check('the constant entry stays with the host in both runs, outside the recall block', off.every(r => has(requestText(r), 'kingdom of Ostrem')) && on.every(r => has(requestText(r), 'kingdom of Ostrem') && !has(blockOf(r), 'Ostrem')), '');
        check('a fired entry is sent once: in the recall block and nowhere else', on.every(r => FIRED.every(s => (requestText(r).split(s).length - 1) <= 1)), '');

        // the first changed message: the host's top-of-request entries change between requests, the managed book's do not
        // requests 2 and 3: SillyTavern drops the example dialogue after the first reply, which changes the top of request 2 for any chat
        const idxOff = firstChanged(off[1].messages, off[2].messages), idxOn = firstChanged(on[1].messages, on[2].messages);
        const histOff = off[1].messages.length, histOn = on[1].messages.length;
        save('first-changed-message', { hostOnly: { earlierRequestMessages: histOff, firstChanged: idxOff }, managed: { earlierRequestMessages: histOn, firstChanged: idxOn } });
        // the old recall block is the first change; MB5's reminder at depth 0 sits after the last user message
        const oldRecall = on[1].messages.findIndex(m => /<recall>/.test(String(m.content)));
        check('a managed book\'s entries no longer change the request above the history', idxOn >= (oldRecall >= 0 ? oldRecall : histOn - 2) && idxOn > idxOff, `first changed message: ${idxOn} of ${histOn} with the book managed, ${idxOff} of ${histOff} with the host alone`);
        r1 = on[0]; r2 = on[1]; rOff1 = off[0]; rOff2 = off[1];

        // a behavior book keeps its entries with the host even when switched on by hand
        await newChat(page);
        const BEHAVIOR = 'MB4 Behavior';
        await makeBook(page, BEHAVIOR, [
            { key: ['storm'], comment: 'Storm', content: 'A sudden hail storm crosses the road and scatters the horses.', useProbability: true, probability: 100, sticky: 2 },
            { key: ['bell'], comment: 'Bell', content: 'The chapel bell rings thirteen times at dusk.', group: 'omens', useProbability: true, probability: 100 },
            { key: ['gate'], comment: 'Gate', content: 'The east gate sticks in the cold.' },
        ]);
        const offer = await page.evaluate(async ({ ext, name }) => { const { bookRecallState, setRecallManages } = await import(`${ext}/src/chat-books.js`); setRecallManages(name, true); return bookRecallState(name); }, { ext: EXT, name: BEHAVIOR });
        save('behavior-book-state', offer);
        check('a book with chance, groups or timing is never offered the switch by default', offer.kind === 'behavior' && offer.offered === false && offer.traits.groups === 1 && offer.traits.timing === 1, JSON.stringify(offer));
        L.resetLog();
        await L.send(page, 'The storm breaks as the bell tolls at the gate.');
        const b = lastReply();
        const bt = requestText(b);
        const bblock = (bt.match(/<recall>[\s\S]*?<\/recall>/) || [''])[0];
        check('behavior entries stay with the host: they fire where they were set, not inside the recall block', /hail storm/.test(bt) && !/hail storm/.test(bblock) && !/chapel bell/.test(bblock), `block: ${bblock.replace(/\n/g, ' ').slice(0, 200)}`);
        check('the plain entry of the same book moves to the recall block', /east gate sticks/.test(bblock), '');
        await page.evaluate(async ext => { const { setRecallManages } = await import(`${ext}/src/chat-books.js`); setRecallManages('MB4 Lore', false); setRecallManages('MB4 Behavior', false); }, EXT);
        await detach(page);
    }

    // ------------------------------------------------------------ the holder rule on the final payload
    if (PARTS.includes('secret')) {
        await newChat(page);
        const names = await page.evaluate(() => { const c = globalThis.SillyTavern.getContext(); return { persona: c.name1, char: c.name2 }; });
        save('names', names);
        await page.evaluate(async ({ ext, persona, char }) => {
            const { memoryStore } = await import(`${ext}/src/memory/store.js`);
            const store = memoryStore();
            await store.record([
                { op: 'add', record: { id: 'persona-secret', kind: 'secret', subject: 'Brannic', attribute: 'letter', text: 'Brannic burned the copper letter in the forge before the vanguard arrived.', holders: [persona], status: 'current', importance: 8 }, origin: { type: 'you', route: 'test' } },
                { op: 'add', record: { id: 'shared-secret', kind: 'secret', subject: 'Brannic', attribute: 'debt', text: 'Brannic owes Darius forty silver for the stolen mule.', holders: [char, persona], status: 'current', importance: 8 }, origin: { type: 'you', route: 'test' } },
                { op: 'add', record: { id: 'plain', kind: 'fact', subject: 'Brannic', attribute: 'forge', text: 'Brannic keeps the forge at the keep gate and shoes the vanguard horses.', status: 'current', importance: 5 }, origin: { type: 'you', route: 'test' } },
            ]);
        }, { ext: EXT, persona: names.persona, char: names.char });
        L.resetLog();
        await L.send(page, 'I ask Brannic what happened to the copper letter in the forge and whether he owes Darius for the mule.');
        const t = requestText(lastReply());
        const block = (t.match(/<recall>[\s\S]*?<\/recall>/) || [''])[0];
        save('secret-request-block', block);
        check('a secret held only by the persona stays out of the request (final payload)', !/burned the copper letter|before the vanguard arrived/.test(t), `block: ${block.replace(/\n/g, ' ').slice(0, 300)}`);
        check('a secret the viewpoint character knows is sent, with its holders named', /owes Darius forty silver/.test(block) && new RegExp(`known_by="[^"]*${names.char}`).test(block), '');
        check('the plain fact is sent in the recall block', /shoes the vanguard horses/.test(block), '');
    }

    // ------------------------------------------------------------ timings in this browser, with the CPU slowed to stand in for a phone
    if (PARTS.includes('timing')) {
        const cdp = await page.context().newCDPSession(page);
        const rows = [];
        for (const rate of [1, 4, 6]) {
            await cdp.send('Emulation.setCPUThrottlingRate', { rate });
            rows.push({ cpuSlowdown: rate, ...await page.evaluate(async ext => {
                const R = await import(`${ext}/src/recall.js`);
                const S = await import(`${ext}/src/memory/search.js`);
                const I = await import(`${ext}/src/memory/index.js`);
                const D = await import(`${ext}/src/memory/device-db.js`);
                const E = await import(`${ext}/src/memory/embed.js`);
                const median = xs => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
                const { embedder } = R.recallRuntime();
                await embedder.load();
                const passage = 'Chapter 2 | Heather\'s room | Blossomtide 23 | Hale, Heather\nI ask Hale what he carries. He keeps his mother\'s wooden bird button in the inner pocket of his left saddlebag and turns it over while the column waits at the ford. '.repeat(3);
                const tokens = embedder.count(passage);
                const embedTimes = [];
                for (let i = 0; i < 8; i++) { const t0 = performance.now(); await embedder.embed([`Who keeps the button ${i} in the saddlebag?`]); embedTimes.push(performance.now() - t0); }
                const passTimes = [];
                for (let i = 0; i < 6; i++) { const t0 = performance.now(); await embedder.embed([passage.slice(0, 700) + i]); passTimes.push(performance.now() - t0); }
                const records = Array.from({ length: 2000 }, (_, i) => ({ id: `r${i}`, kind: 'fact', subject: `Subject ${i % 80}`, text: `Subject ${i % 80} did thing ${i} near place ${i % 37} with person ${i % 53} on day ${i % 90}.`, importance: 3 + (i % 7), srcTurn: (i % 400) + 1 }));
                const index = I.createSearchIndex({ embedder: E.hashEmbedder(), db: D.memoryItems() });
                const t0 = performance.now();
                await index.sync({ records, chapters: [], exchanges: [], entries: [], turn: 400 });
                const buildMs = performance.now() - t0;
                const t2 = performance.now();
                await index.sync({ records, chapters: [], exchanges: [], entries: [], turn: 400 }, { embed: 'wait' });
                const resyncMs = performance.now() - t2;
                const scoreTimes = [], totalTimes = [];
                for (let i = 0; i < 20; i++) { const res = await index.search({ message: `What did subject ${i} do near place ${i % 37} with person ${i % 53}?`, turn: 401, scene: { place: 'Gatehouse', time: 'Dusk', present: ['Hale'] } }); scoreTimes.push(res.time.score); totalTimes.push(res.time.total); }
                const word = S.createWordIndex();
                for (const u of S.buildUnits({ records })) word.add(u);
                const wordTimes = [];
                for (let i = 0; i < 20; i++) { const q = `subject ${i} place ${i % 37} person ${i % 53} day ${i}`; const t1 = performance.now(); word.search(q); wordTimes.push(performance.now() - t1); }
                return {
                    units: 2000, passageTokens: tokens,
                    queryEmbedMs: +median(embedTimes).toFixed(1), passageEmbedMs: +median(passTimes).toFixed(1),
                    miniSearchQueryMs: +median(wordTimes).toFixed(2), scoreAndAdmitMs: +median(scoreTimes).toFixed(2), searchWithMockEmbedderMs: +median(totalTimes).toFixed(2), buildIndexMs: Math.round(buildMs), resyncUnchangedMs: Math.round(resyncMs),
                    queryCostWithRealModelMs: +(median(embedTimes) + median(scoreTimes)).toFixed(1),
                };
            }, EXT) });
        }
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
        save('timings-desktop-chrome', rows);
        for (const row of rows) console.log('timing', JSON.stringify(row));
        check('a query costs 0.15 s or less at 2,000 units on this browser at 1x, 4x and 6x CPU slowdown', rows.every(r => r.queryCostWithRealModelMs <= 150), rows.map(r => `${r.cpuSlowdown}x ${r.queryCostWithRealModelMs} ms`).join(', '));
    }

    check('no page error', errors.length === 0, errors.slice(0, 3).join(' | '));
    await app.browser.close();
    if (EVIDENCE) { fs.mkdirSync(EVIDENCE, { recursive: true }); fs.writeFileSync(path.join(EVIDENCE, `host-${WIDTH}.json`), JSON.stringify(out, null, 1)); }
    void r1; void r2; void rOff1; void rOff2;
}

main().catch(error => { console.error('FAIL', error); process.exitCode = 1; });
