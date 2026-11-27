// V2: delivery controls for character speech. One script in two halves.
//
// The node half (always runs; `node tests/t_voice_delivery.js --unit` runs only it) records every request the client
// sends through a stub fetch: each slider moves the knobs it names and no speed value is ever sent; a moment change
// reads one reply with its change and leaves the character's settings and every other reply as they were; cached
// lines are reused only when the line and every setting match; the line lift is off by default and lifts exclaimed
// and shouted lines when on; V1's raw knobs read back into the three settings; presets save, replace and delete.
//
// The browser half drives a SillyTavern host at 523 x 1021 and 1006 x 909 with touch against a mock voice server this
// script starts on an ephemeral 127.0.0.1 port (CORS like the real server, a request recorder). It moves each slider on
// a card and plays its test line, saves a preset, reads a reply from the message menu, which opens the Play sheet, and
// taps More feeling and Faster there. No real voice or clip is used: the voices are mock ids.
//
// Environment: RI_HOST_URL, RI_PLAYWRIGHT, RI_CHROME, RI_EVIDENCE (screenshots).
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');

let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) { failed++; process.exitCode = 1; } };
const src = file => pathToFileURL(path.join(__dirname, '..', 'src', file)).href;
const RATE = 24000;

/** A stub fetch with the real server's headers; records every request body it answers. */
function recorder() {
    const log = [];
    const fetcher = async (url, init = {}) => {
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
        log.push({ url: String(url), body, raw: typeof init.body === 'string' ? init.body : '' });
        const answer = (status, data, extra = {}) => ({ ok: status < 300, status, headers: { get: name => extra[name] ?? null }, json: async () => data, arrayBuffer: async () => data });
        if (String(url).endsWith('/status')) return answer(200, { ok: true, defaults: { exaggeration: 0.65, cfg_weight: 0.5, temperature: 0.8, steps: 24 }, speed: false });
        if (String(url).endsWith('/v1/models')) return answer(200, { data: [] });
        const pcm = new Int16Array(Math.round(RATE * 0.3));
        for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(Math.sin(i / 8) * 6000);
        return answer(200, pcm.buffer, { 'X-Chatterbox-Seed': String(body.seed), 'X-Chatterbox-Check': body.verify ? 'passed' : 'off' });
    };
    const speech = () => log.filter(entry => entry.url.endsWith('/v1/audio/speech'));
    return { fetcher, log, speech };
}

async function unit() {
    const store = { roleplay_instructions: {} };
    globalThis.toastr = { info() {}, warning() {}, error() {}, success() {} };
    const host = {
        extensionSettings: store, saveSettingsDebounced() {}, chatMetadata: {}, characters: [{ name: 'Hale', avatar: 'hale.png' }],
        characterId: 0, name1: 'Sam', name2: 'Hale', getCurrentChatId: () => 'chat-v2', eventSource: { on() {} }, eventTypes: {},
        chat: [
            { name: 'Hale', is_user: false, swipe_id: 0, mes: '"Get down!" Hale shouted. "They are coming over the ridge."\n\nSam crouched. "How many?" Sam asked.' },
            { name: 'Hale', is_user: false, swipe_id: 0, mes: '"Three of them," Hale said.' },
        ],
    };
    globalThis.SillyTavern = { getContext: () => host };
    const D = await import(src('voice/delivery.js'));
    const C = await import(src('voice/client.js'));
    const P = await import(src('voice/player.js'));
    const LOG = await import(src('log.js'));
    store.roleplay_instructions.voice = { url: 'http://100.97.15.107:8125', key: 'k', verify: true, voices: {
        'char:hale.png': { id: 'ri-char-hale', delivery: { ...D.DELIVERY_DEFAULT } },
        'persona:Sam': { id: 'ri-persona-sam', delivery: { ...D.DELIVERY_DEFAULT } },
    } };
    const voices = C.voiceSettings().voices;

    // Criterion 1: each slider changes the request as stated, and no speed value is sent.
    check(JSON.stringify(D.knobsFor(D.DELIVERY_DEFAULT)) === JSON.stringify({ exaggeration: 0.65, cfg_weight: 0.5, temperature: 0.8 }), 'the default delivery is her King County settings');
    const sent = async delivery => {
        const r = recorder();
        await C.speak({ text: 'Hold on.', voice: 'ri-char-hale', seed: 3, knobs: D.knobsFor(delivery), fetcher: r.fetcher });
        return r.speech()[0];
    };
    const base = await sent(D.DELIVERY_DEFAULT);
    check(!('exaggeration' in base.body) && !('cfg_weight' in base.body) && !('temperature' in base.body), 'King County sends no knob, the server defaults apply');
    const livelier = await sent({ ...D.DELIVERY_DEFAULT, expressiveness: 0.9 });
    check(livelier.body.exaggeration === 0.9 && !('cfg_weight' in livelier.body) && !('temperature' in livelier.body), `Expressiveness 0.9 sends exaggeration 0.9 alone (${JSON.stringify(livelier.body)})`);
    const flatter = await sent({ ...D.DELIVERY_DEFAULT, expressiveness: 0.3 });
    check(flatter.body.exaggeration === 0.3, 'Expressiveness 0.3 sends exaggeration 0.3');
    const steadier = await sent({ ...D.DELIVERY_DEFAULT, steadiness: 1 });
    check(steadier.body.temperature === 0.7 && steadier.body.cfg_weight === 0.55 && !('exaggeration' in steadier.body), `Steadier moves temperature down and cfg_weight up together (${steadier.body.temperature}, ${steadier.body.cfg_weight})`);
    const looser = await sent({ ...D.DELIVERY_DEFAULT, steadiness: -2 });
    check(looser.body.temperature === 1 && looser.body.cfg_weight === 0.4, `Much looser: temperature 1.0, cfg_weight 0.4 (${looser.body.temperature}, ${looser.body.cfg_weight})`);
    const faster = await sent({ ...D.DELIVERY_DEFAULT, pace: 1 });
    check(faster.body.cfg_weight === 0.58 && !('temperature' in faster.body) && !('exaggeration' in faster.body), `Faster moves cfg_weight alone, to 0.58 (${JSON.stringify(faster.body)})`);
    const slower = await sent({ ...D.DELIVERY_DEFAULT, pace: -2 });
    check(slower.body.cfg_weight === 0.34, `Much slower lowers cfg_weight to 0.34, the documented slower pacing (${slower.body.cfg_weight})`);
    check(D.pauseFactor({ ...D.DELIVERY_DEFAULT, pace: 1 }) === 0.85 && D.pauseFactor({ ...D.DELIVERY_DEFAULT, pace: -2 }) === 1.3, 'Pace also shortens or lengthens the pauses between lines');
    const extreme = D.knobsFor({ expressiveness: 1, steadiness: 2, pace: 2 }, { feeling: 'feeling', pace: 'faster' }, 0.2);
    check(extreme.exaggeration === 1.2 && extreme.cfg_weight === 0.8 && extreme.temperature === 0.6, `every knob stops at its limit (${JSON.stringify(extreme)})`);
    const everyBody = [base, livelier, flatter, steadier, looser, faster, slower].map(entry => entry.raw);
    check(everyBody.every(raw => !/speed/i.test(raw)), 'no request carries a speed value');

    // The Pace test line is read one sentence per call, with the paced pause between.
    const sample = recorder();
    const paced = await P.playSample({ text: D.TEST_LINES.pace, voice: 'ri-char-hale', delivery: { ...D.DELIVERY_DEFAULT, pace: -1 }, fetcher: sample.fetcher });
    check(paced.lines === 2 && sample.speech().length === 2 && paced.pause === 0.44 && sample.speech().every(entry => entry.body.cfg_weight === 0.42 && !/speed/i.test(entry.raw)),
        `the Pace test line plays two sentences at cfg_weight 0.42 with a 0.44 s pause (${paced.lines} lines, ${paced.pause} s)`);

    // Criterion 2: a moment change applies to one reply and leaves the sheet alone.
    const sheetBefore = JSON.stringify(voices);
    const r = recorder();
    const plain = await P.readReply(0, { host, fetcher: r.fetcher });
    const plainCalls = r.speech().map(entry => entry.body);
    check(plain.status === 'done' && plainCalls.length === 3 && plainCalls.every(body => !('exaggeration' in body)), `reply 0 reads 3 lines with each speaker's settings (${plainCalls.length} calls)`);
    const key0 = P.cacheKey(host, 0, host.chat[0]);
    D.setMoment(key0, { feeling: 'feeling', pace: 'faster' });
    const before = r.speech().length;
    const moved = await P.readReply(0, { host, fetcher: r.fetcher });
    const movedCalls = r.speech().slice(before).map(entry => entry.body);
    check(moved.status === 'done' && movedCalls.length === 3 && movedCalls.every(body => body.exaggeration === 0.8 && body.cfg_weight === 0.58),
        `More feeling and Faster read reply 0 with exaggeration 0.8 and cfg_weight 0.58 (${movedCalls.map(body => `${body.exaggeration}/${body.cfg_weight}`).join(', ')})`);
    check(moved.lines.every(line => line.pause === 0 || [0.6, 0.32].includes(line.pause)), `Faster shortens this reply's pauses (${moved.lines.map(line => line.pause).join(', ')})`);
    check(JSON.stringify(voices) === sheetBefore, 'the characters\' settings on the sheet did not change');
    const other = recorder();
    await P.readReply(1, { host, fetcher: other.fetcher });
    check(other.speech().length === 1 && !('exaggeration' in other.speech()[0].body) && !('cfg_weight' in other.speech()[0].body), 'the next reply reads with the characters\' own settings');
    check(JSON.stringify(D.momentFor(P.cacheKey(host, 1, host.chat[1]))) === '{}' && D.momentWords(D.momentFor(key0)) === 'More feeling and Faster', 'the change is held for reply 0 only');
    const receipt = LOG.logEntries().filter(entry => entry.what === 'Read aloud').find(entry => /More feeling and Faster for this reply/.test(entry.details[0]));
    check(!!receipt && receipt.details.some(line => /exaggeration 0\.8, cfg_weight 0\.58/.test(line)), 'the receipt names the change and the knobs each line used');
    check(D.toggleMoment({ feeling: 'feeling' }, 'calmer').feeling === 'calmer' && !('feeling' in D.toggleMoment({ feeling: 'feeling' }, 'feeling')), 'More feeling and Calmer take turns; a second tap turns one off');
    const calm = D.knobsFor(D.DELIVERY_DEFAULT, { feeling: 'calmer' });
    check(calm.exaggeration === 0.5 && calm.temperature === 0.7 && calm.cfg_weight === 0.55, `Calmer lowers expressiveness and steadies (${JSON.stringify(calm)})`);
    P.dropReply(0);
    check(JSON.stringify(D.momentFor(key0)) === '{}', 'an edit or a swipe of the reply forgets its change');

    // Criterion 3: cached audio is reused only when the line and every setting match.
    const c = recorder();
    await P.readReply(0, { host, fetcher: c.fetcher });
    const calls = () => c.speech().length;
    const first = calls();
    await P.readReply(0, { host, fetcher: c.fetcher });
    check(first === 3 && calls() === 3, 'the same lines and settings replay from the cache with no call');
    voices['persona:Sam'].delivery = { ...D.DELIVERY_DEFAULT, expressiveness: 0.9 };
    await P.readReply(0, { host, fetcher: c.fetcher });
    const changed = c.speech().slice(3);
    check(changed.length === 1 && changed[0].body.voice === 'ri-persona-sam' && changed[0].body.exaggeration === 0.9, `a change to Sam's settings renders Sam's line alone (${changed.length} call)`);
    voices['persona:Sam'].delivery = { ...D.DELIVERY_DEFAULT };
    await P.readReply(0, { host, fetcher: c.fetcher });
    check(calls() === 4, 'back to Sam\'s earlier settings, the earlier audio is reused');
    await P.readReply(0, { host, fetcher: c.fetcher, moment: { pace: 'slower' } });
    check(calls() === 7, 'a moment change renders every line it changes');
    await P.readReply(0, { host, fetcher: c.fetcher, moment: {} });
    check(calls() === 7, 'turning the moment off replays the cached lines');
    C.voiceSettings().verify = false;
    await P.readReply(0, { host, fetcher: c.fetcher });
    check(calls() === 10, 'turning the line check off renders again: a checked take is not an unchecked one');
    C.voiceSettings().verify = true;
    host.chat[0].swipe_id = 1;
    await P.readReply(0, { host, fetcher: c.fetcher });
    check(calls() === 13, 'another swipe has its own lines');
    host.chat[0].swipe_id = 0;
    const lk = line => P.lineKey('r', { voice: 'v', seed: 1, text: 'Hi.', knobs: D.knobsFor(D.DELIVERY_DEFAULT), ...line }, true);
    check(new Set([lk({}), lk({ text: 'Hi!' }), lk({ voice: 'w' }), lk({ seed: 2 }), lk({ knobs: D.knobsFor({ ...D.DELIVERY_DEFAULT, steadiness: 1 }) })]).size === 5, 'the line key differs for the words, the voice, the seed and the knobs');

    // The line lift: off by default, decided in code when on.
    check(C.voiceSettings().lift === undefined && P.planReading(host.chat[0], host).every(line => line.lift === 0), 'the line lift is off by default');
    const lifted = P.planReading(host.chat[0], host, { lift: true });
    check(lifted[0].text === 'Get down!' && lifted[0].lift === 0.2 && lifted[0].knobs.exaggeration === 0.85 && /exclamation/.test(lifted[0].liftWhy.join()) && /shouted/.test(lifted[0].liftWhy.join()),
        `"Get down!" Hale shouted lifts that line by 0.2 (${lifted[0].lift}: ${lifted[0].liftWhy.join(', ')})`);
    check(lifted[1].lift === 0.1 && lifted[2].lift === 0, `the quote's second sentence keeps the shout verb's lift, and Sam's plain question has none (${lifted[1].lift}, ${lifted[2].lift})`);
    check(D.liftFor('Do NOT touch that.').lift === 0.05 && D.liftFor('What?!').lift === 0.15 && D.liftFor('Fine.', 'she whispered').lift === 0, 'capitals and "?!" lift a little; a whisper lifts nothing');
    store.roleplay_instructions.voice.lift = true;
    const liftCall = recorder();
    P.dropReply();
    await P.readReply(0, { host, fetcher: liftCall.fetcher });
    check(liftCall.speech()[0].body.exaggeration === 0.85 && LOG.logEntries().some(entry => entry.details.some(line => /lifted 0\.2 for an exclamation and "shouted" beside it/.test(line))), 'with the lift on, the request and the receipt carry it');
    store.roleplay_instructions.voice.lift = false;

    // V1's raw knobs read back into the three settings.
    const migrated = D.deliveryOf({ knobs: { exaggeration: 0.8, temperature: 0.7, cfg_weight: 0.55 } });
    check(JSON.stringify(migrated) === JSON.stringify({ expressiveness: 0.8, steadiness: 1, pace: 0 }), `a V1 voice's knobs carry over (${JSON.stringify(migrated)})`);
    check(D.deliveryOf({ knobs: { cfg_weight: 0.66 } }).pace === 2 && D.deliveryOf(null).expressiveness === 0.65, 'a V1 cfg_weight reads back as pace, and no voice reads as King County');
    check(D.deliveryOf({ delivery: { expressiveness: 2, steadiness: 9, pace: 'x' } }).expressiveness === 1 && D.deliveryOf({ delivery: { steadiness: 9 } }).steadiness === 2, 'stored settings are held to the sliders');

    // Presets.
    const config = { presets: [] };
    check(D.savePreset(config, '  ', D.DELIVERY_DEFAULT) !== '', 'a preset needs a name');
    check(D.savePreset(config, 'Hale, angry', { expressiveness: 0.95, steadiness: -1, pace: 1 }) === '' && D.savePreset(config, 'Hale, tired', { expressiveness: 0.4, steadiness: 1, pace: -1 }) === '', 'two presets save');
    D.savePreset(config, 'hale, ANGRY', { expressiveness: 1, steadiness: -1, pace: 1 });
    const listed = D.listPresets(config);
    check(listed.length === 2 && listed.find(item => item.name === 'hale, ANGRY')?.expressiveness === 1, 'saving under the same name replaces the preset');
    D.removePreset(config, 'Hale, tired');
    check(D.listPresets(config).map(item => item.name).join() === 'hale, ANGRY', 'a preset deletes');

    // Writing standard: no em or en dash and no emoji in the strings she reads.
    for (const file of ['voice/delivery.js', 'voice/play-sheet.js', 'voice/ui.js', 'voice/player.js']) {
        const text = fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');
        check(!/[\u2013\u2014]/.test(text) && !/\p{Extended_Pictographic}/u.test(text), `${file} has no em or en dash and no emoji`);
    }
}

/** A mock voice server like the real one: CORS, a key, speech as 24 kHz PCM, and a request recorder. */
function mockVoiceServer() {
    const log = [];
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            const url = req.url.split('?')[0];
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
            res.setHeader('Access-Control-Expose-Headers', 'X-Chatterbox-Seed, X-Chatterbox-Check, X-Chatterbox-Renders, X-Chatterbox-Settings, X-Chatterbox-Seconds');
            if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
            const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
            if (url === '/status') return json(200, { ok: true, defaults: { exaggeration: 0.65, cfg_weight: 0.5, temperature: 0.8, steps: 24 }, eq: 'x', speed: false, check: true });
            if (req.headers.authorization !== 'Bearer mock-key') return json(401, { error: 'Invalid key' });
            if (url === '/v1/models') return json(200, { data: [{ id: 'chatterbox' }] });
            if (url === '/v1/audio/speech') {
                const raw = Buffer.concat(chunks).toString('utf8');
                const request = JSON.parse(raw);
                log.push({ request, raw, at: Date.now() });
                const seconds = 0.4;
                const pcm = Buffer.alloc(Math.round(seconds * RATE) * 2);
                for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 9) * 5000 * Math.min(1, i / 2000)), i * 2);
                res.writeHead(200, { 'Content-Type': 'audio/pcm;rate=24000', 'X-Chatterbox-Seed': String(request.seed), 'X-Chatterbox-Check': request.verify ? 'passed' : 'off',
                    'X-Chatterbox-Renders': '1', 'X-Chatterbox-Seconds': String(seconds) });
                res.end(pcm);
                return;
            }
            json(404, { error: 'not here' });
        });
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, log, port: server.address().port })));
}

async function browserHalf() {
    const { chromium } = require(process.env.RI_PLAYWRIGHT || 'playwright-core');
    const HOST = process.env.RI_HOST_URL || 'http://127.0.0.1:8621';
    const BASE = '/scripts/extensions/third-party/roleplay-instructions';
    const OUT = process.env.RI_EVIDENCE || path.join(__dirname, '../docs/ux-overhaul/audit/evidence/build/V2');
    fs.mkdirSync(OUT, { recursive: true });
    const mock = await mockVoiceServer();
    const voiceUrl = `http://127.0.0.1:${mock.port}`;
    const browser = await chromium.launch({ executablePath: process.env.RI_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
        args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
    const speech = () => mock.log.map(entry => entry.request);
    try {
        for (const viewport of [{ width: 523, height: 1021 }, { width: 1006, height: 909 }]) {
            const tag = `${viewport.width}`;
            const context = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: true, isMobile: viewport.width < 1000, colorScheme: 'dark' });
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', e => errors.push(e.message));
            page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource|AbortReason/.test(m.text())) errors.push(m.text().slice(0, 200)); });
            await page.goto(HOST, { waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => globalThis.SillyTavern?.getContext()?.characters?.length > 0 && !document.getElementById('preloader'), null, { timeout: 90000 });
            await page.waitForTimeout(1500);
            for (let i = 0; i < 4; i++) {
                const ok = await page.$('dialog[open] .popup-button-ok');
                if (!ok) break;
                await ok.click();
                await page.waitForTimeout(500);
            }
            const tap = async locator => {
                const node = typeof locator === 'string' ? page.locator(locator).first() : locator;
                await node.scrollIntoViewIfNeeded();
                const box = await node.boundingBox();
                if (!box) throw new Error(`not on screen: ${locator}`);
                await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
                await page.waitForTimeout(300);
            };
            const waitCalls = async (count, ms = 15000) => {
                const end = Date.now() + ms;
                while (mock.log.length < count && Date.now() < end) await page.waitForTimeout(100);
                await page.waitForTimeout(400);
            };
            // A fresh chat with one reply: the character twice and the persona once. Both voices are mock ids.
            const names = await page.evaluate(async ({ BASE, voiceUrl }) => {
                const host = SillyTavern.getContext();
                const idx = host.characters.findIndex(item => item.name);
                if (String(host.characterId) !== String(idx)) await host.selectCharacterById(idx);
                await new Promise(resolve => setTimeout(resolve, 800));
                await host.executeSlashCommandsWithOptions('/newchat');
                await new Promise(resolve => setTimeout(resolve, 1200));
                const now = SillyTavern.getContext();
                const char = now.characters[now.characterId];
                const S = await import(`${BASE}/src/store.js`);
                S.settings().voice = { url: voiceUrl, key: 'mock-key', verify: true, presets: [], voices: {
                    [`char:${char.avatar || char.name}`]: { id: 'ri-char-mock', name: char.name, kind: 'character', seconds: 12, at: new Date().toISOString() },
                    [`persona:${now.name1}`]: { id: 'ri-persona-mock', name: now.name1, kind: 'persona', seconds: 12, at: new Date().toISOString() } } };
                S.saveSettings();
                now.chat.push({ name: char.name, is_user: false, is_system: false, send_date: new Date().toISOString(), swipe_id: 0, swipes: [''], extra: {},
                    mes: `"Stay close," ${char.name} whispered.\n\n${now.name1} looked back. "Who is there?" ${now.name1} asked.\n\n"Run." The word hung in the dark.` });
                now.chat.at(-1).swipes[0] = now.chat.at(-1).mes;
                await now.saveChat();
                await now.reloadCurrentChat();
                return { char: char.name, charKey: `char:${char.avatar || char.name}`, user: now.name1 };
            }, { BASE, voiceUrl });
            await page.waitForTimeout(1500);
            const replyId = await page.evaluate(() => SillyTavern.getContext().chat.findLastIndex(m => !m.is_user && !m.is_system));
            const savedDelivery = () => page.evaluate(async ({ BASE, key }) => (await import(`${BASE}/src/voice/client.js`)).voiceSettings().voices[key].delivery, { BASE, key: names.charKey });

            // The character's card: move each slider, hear its test line, and read the request.
            await page.evaluate(async ({ BASE }) => { const { app } = await import(BASE + '/src/ui/panel.js'); await app.openPage('voices', { focusPage: true }); await app.setExpanded(true); }, { BASE });
            await page.waitForSelector('#ri-voice-page', { timeout: 10000 });
            const card = page.locator(`.ri-voice-card[data-ri-voice-member="${names.charKey}"]`);
            check(await card.locator('.ri-voice-delivery').count() === 1, `${tag}: the character's card has its Delivery fold (${errors.join(' | ').slice(0, 300) || (await card.count() ? (await card.locator('.ri-voice-delivery').innerHTML()).slice(0, 1500) : 'no card')})`);
            await tap(card.locator('.ri-voice-delivery > summary'));
            const slide = async (name, value) => {
                const range = card.locator(`input[data-ri-slider="${name}"]`);
                await range.scrollIntoViewIfNeeded();
                await range.fill(String(value));
                await page.waitForTimeout(150);
            };
            const hear = async name => {
                const count = mock.log.length;
                await tap(card.locator(`button[data-ri-hear="${name}"]`));
                await waitCalls(count + 2);
                await page.waitForFunction(() => !/^Rendering/.test(document.querySelector('.ri-voice-card .ri-voice-result')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
                return mock.log.slice(count);
            };
            await slide('expressiveness', 0.9);
            const expressive = await hear('expressiveness');
            check(expressive.length === 2 && expressive.every(e => e.request.exaggeration === 0.9 && !('cfg_weight' in e.request) && !('temperature' in e.request)) && /came back/.test(expressive[0].request.input),
                `${tag}: Expressiveness 0.90 plays its test line with exaggeration 0.9 alone (${expressive.map(e => e.raw).join(' ')})`);
            check(await card.locator('[data-ri-value="expressiveness"]').textContent() === '0.90, livelier', `${tag}: the slider says what it does`);
            await slide('steadiness', 1);
            const steady = await hear('steadiness');
            check(steady.length === 2 && steady.every(e => e.request.temperature === 0.7 && e.request.cfg_weight === 0.55 && e.request.exaggeration === 0.9),
                `${tag}: Steadier sends temperature 0.7 and cfg_weight 0.55 with the expressiveness kept (${steady[0]?.raw})`);
            await slide('pace', -1);
            const paced = await hear('pace');
            await waitCalls(mock.log.length + 0);
            const paceCalls = mock.log.filter(entry => /bell|Not yet/.test(entry.request.input)).slice(-2);
            check(paceCalls.length === 2 && paceCalls.every(entry => entry.request.cfg_weight === 0.47 && entry.request.temperature === 0.7) && paced.length >= 1,
                `${tag}: Slower plays the two-sentence Pace line at cfg_weight 0.47 (${paceCalls.map(e => e.request.cfg_weight).join(', ')})`);
            check(mock.log.every(entry => !/speed/i.test(entry.raw)), `${tag}: no request carries a speed value`);
            const kept = await savedDelivery();
            check(JSON.stringify(kept) === JSON.stringify({ expressiveness: 0.9, steadiness: 1, pace: -1 }), `${tag}: the card saves the three settings (${JSON.stringify(kept)})`);
            check(/Sends exaggeration 0\.9, cfg_weight 0\.47, temperature 0\.7; never a speed value/.test(await card.locator('.ri-voice-sends').textContent()), `${tag}: the card shows what it sends`);

            // A/B: A sends no knob, B sends the sliders, both with the same seed.
            let count = mock.log.length;
            await tap(card.getByRole('button', { name: 'A: King County' }));
            await waitCalls(count + 1);
            await tap(card.getByRole('button', { name: 'B: these settings' }));
            await waitCalls(count + 2);
            const [a, b] = mock.log.slice(count);
            check(a && b && !('exaggeration' in a.request) && b.request.exaggeration === 0.9 && a.request.seed === b.request.seed, `${tag}: A and B differ only in the sliders, with one seed`);

            // A preset: save under a name, then use it on the persona's card.
            await card.locator('.ri-voice-preset-name').fill('Hale, angry');
            await tap(card.getByRole('button', { name: 'Save as preset' }));
            const presets = await page.evaluate(async ({ BASE }) => (await import(`${BASE}/src/voice/client.js`)).voiceSettings().presets, { BASE });
            check(presets.length === 1 && presets[0].name === 'Hale, angry' && presets[0].expressiveness === 0.9, `${tag}: the preset saves`);
            const persona = page.locator(`.ri-voice-card[data-ri-voice-member^="persona:"]`);
            await tap(persona.locator('.ri-voice-delivery > summary'));
            await tap(persona.getByRole('button', { name: 'Use preset' }));
            const personaDelivery = await page.evaluate(async ({ BASE }) => Object.entries((await import(`${BASE}/src/voice/client.js`)).voiceSettings().voices).find(([k]) => k.startsWith('persona:'))[1].delivery, { BASE });
            check(personaDelivery?.expressiveness === 0.9 && personaDelivery.pace === -1, `${tag}: another card uses the preset`);
            await tap(persona.getByRole('button', { name: 'Reset to King County' }));
            await card.locator('.ri-voice-delivery').scrollIntoViewIfNeeded();
            await page.screenshot({ path: path.join(OUT, `delivery-${tag}.png`), fullPage: false });
            const layout = await page.evaluate(() => {
                const root = document.getElementById('ri-voice-page');
                const small = [...root.querySelectorAll('.ri-voice-delivery button, .ri-voice-delivery input, .ri-voice-delivery select')]
                    .map(node => node.getBoundingClientRect()).filter(r => r.width && (r.width < 24 || r.height < 24)).length;
                return { small, overflow: document.documentElement.scrollWidth > innerWidth + 1 || root.scrollWidth > root.clientWidth + 1 };
            });
            check(layout.small === 0 && !layout.overflow, `${tag}: every delivery control is at least 24 px and nothing scrolls sideways (${JSON.stringify(layout)})`);

            // Read aloud opens the Play sheet; More feeling and Faster apply to this reply only.
            await page.evaluate(async ({ BASE }) => { const { app } = await import(BASE + '/src/ui/panel.js'); await app.setExpanded(false); await app.close?.(); }, { BASE });
            await page.keyboard.press('Escape');
            await page.waitForTimeout(400);
            await page.evaluate(async ({ BASE }) => (await import(`${BASE}/src/voice/ui.js`)).refreshVoiceButtons(), { BASE });
            const mes = page.locator(`#chat .mes[mesid="${replyId}"]`);
            const entry = mes.locator('.ri-voice-button');
            if (!await entry.isVisible()) await tap(mes.locator('.extraMesButtonsHint'));
            const done = () => page.waitForFunction(() => /Finished|Failed/.test(document.querySelector('.ri-psheet .ri-psheet-status')?.textContent || ''), null, { timeout: 30000 });
            count = mock.log.length;
            await tap(entry);
            await page.waitForSelector('.ri-psheet', { timeout: 5000 });
            await done();
            const plain = mock.log.slice(count).map(e => e.request);
            check(plain.length === 3 && plain[0].exaggeration === 0.9 && plain[0].cfg_weight === 0.47 && !('exaggeration' in plain[1]), `${tag}: Read aloud reads each speaker with their own settings (${plain.map(p => p.exaggeration ?? 'kc').join(', ')})`);
            check(await page.locator('.ri-psheet').getAttribute('role') === 'dialog' && /no model call/.test(await page.locator('.ri-psheet .ri-gsheet-cost').textContent()), `${tag}: the Play sheet opens and says no model call is made`);
            const sheetBefore = JSON.stringify(await page.evaluate(async ({ BASE }) => (await import(`${BASE}/src/voice/client.js`)).voiceSettings().voices, { BASE }));
            count = mock.log.length;
            await tap(page.locator('.ri-psheet [data-ri-moment="feeling"]'));
            await page.waitForTimeout(300);
            await done();
            await tap(page.locator('.ri-psheet [data-ri-moment="faster"]'));
            await page.waitForTimeout(300);
            await done();
            const felt = mock.log.slice(count).map(e => e.request);
            const last3 = felt.slice(-3);
            check(last3.length === 3 && last3[0].exaggeration === 1.05 && last3[0].cfg_weight === 0.55 && last3[1].exaggeration === 0.8 && last3[1].cfg_weight === 0.58,
                `${tag}: More feeling and Faster sit on top of each speaker's settings (${last3.map(p => `${p.exaggeration}/${p.cfg_weight}`).join(', ')})`);
            check(await page.locator('.ri-psheet [data-ri-moment="feeling"]').getAttribute('aria-pressed') === 'true' && /More feeling and Faster/.test(await page.locator('.ri-psheet-note').textContent()), `${tag}: the sheet shows which changes are on`);
            const sheetAfter = JSON.stringify(await page.evaluate(async ({ BASE }) => (await import(`${BASE}/src/voice/client.js`)).voiceSettings().voices, { BASE }));
            check(sheetAfter === sheetBefore, `${tag}: the character settings did not change`);
            await page.screenshot({ path: path.join(OUT, `play-sheet-${tag}.png`), fullPage: false });
            const sheetLayout = await page.evaluate(() => {
                const sheet = document.querySelector('.ri-psheet');
                const rect = sheet.getBoundingClientRect();
                const small = [...sheet.querySelectorAll('button')].map(node => node.getBoundingClientRect()).filter(r => r.width && (r.width < 24 || r.height < 24)).length;
                return { small, inside: rect.bottom <= innerHeight + 1 && rect.top >= 0, height: Math.round(rect.height) };
            });
            check(sheetLayout.small === 0 && sheetLayout.inside, `${tag}: the Play sheet sits inside the screen with every button at least 24 px (${JSON.stringify(sheetLayout)})`);
            // Turning both off replays the cached lines with no call (Faster alone is a new mix, rendered once first).
            await tap(page.locator('.ri-psheet [data-ri-moment="feeling"]'));
            await page.waitForTimeout(300);
            await done();
            count = mock.log.length;
            await tap(page.locator('.ri-psheet [data-ri-moment="faster"]'));
            await page.waitForTimeout(300);
            await done();
            check(mock.log.length === count, `${tag}: back to each speaker's own settings, the reply replays from the cache with no call (${mock.log.length - count} calls)`);
            // Escape closes the sheet; another reply would read with no change.
            await page.keyboard.press('Escape');
            await page.waitForTimeout(300);
            check(await page.locator('.ri-psheet').count() === 0, `${tag}: Escape closes the Play sheet`);
            check(mock.log.every(entry => !/speed/i.test(entry.raw)), `${tag}: no request in the run carried a speed value`);
            check(errors.length === 0, `${tag}: no page errors (${errors.join(' | ').slice(0, 300)})`);
            await page.evaluate(async ({ BASE }) => { const S = await import(`${BASE}/src/store.js`); delete S.settings().voice; S.saveSettings(); }, { BASE });
            await context.close();
        }
    } finally {
        await browser.close();
        mock.server.close();
    }
}

(async () => {
    await unit();
    if (!process.argv.includes('--unit')) await browserHalf();
    console.log(failed ? `${failed} failed` : 'all passed');
    process.exit(failed ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
