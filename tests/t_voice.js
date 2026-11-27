// V1: cloned character voices on the desktop. One script in two halves.
//
// The node half (always runs, `node tests/t_voice.js --unit` runs only it) checks the code paths with no host: which
// quote goes to which speaker, the spelled-out lines and their pauses, the reference clip check on synthetic clips, the
// voice route's tailnet rule, the client's request and headers, and a reading's cache, receipt and failure path against
// a stub fetch.
//
// The browser half drives a SillyTavern host at 523 x 1021 and 1006 x 909 with touch, against a mock voice server this
// script starts on 127.0.0.1 (an ephemeral port, CORS like the real server, a request log). It sets up the desktop voice,
// refuses a short, a clipped and a noisy upload with their reasons, accepts a good one, records a persona voice through
// Chrome's fake microphone fed a synthetic clip, reads a reply through the message menu (each line in its speaker's
// voice, an unattributed quote in the main character's), replays it from the cache with no call, drops the cache on an
// edit, and shows the voice as unavailable when the mock is stopped. Every clip is synthetic; no real voice is used.
//
// Environment: RI_HOST_URL, RI_PLAYWRIGHT, RI_CHROME, RI_EVIDENCE (screenshots), TEMP for the synthetic WAV files.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');

let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) { failed++; process.exitCode = 1; } };
const src = file => pathToFileURL(path.join(__dirname, '..', 'src', file)).href;
const RATE = 24000;

/** A synthetic speech-like clip: three-syllable words of harmonic tones with 20 ms ramps, over a faint noise floor. */
function synthClip(seconds, { gain = 0.3, noise = 0.0004, seed = 7 } = {}) {
    let state = seed;
    const random = () => { state = (state * 1103515245 + 12345) & 0x7fffffff; return state / 0x7fffffff; };
    const out = new Float32Array(Math.round(seconds * RATE));
    let at = Math.round(0.4 * RATE), syllable = 0;
    while (at < out.length - RATE * 0.3) {
        const length = Math.round(0.18 * RATE), ramp = Math.round(0.02 * RATE), f0 = 160 + random() * 80;
        for (let i = 0; i < length && at + i < out.length; i++) {
            const env = Math.min(1, i / ramp, (length - i) / ramp);
            const t = i / RATE;
            out[at + i] += gain * env * (Math.sin(2 * Math.PI * f0 * t) * 0.6 + Math.sin(4 * Math.PI * f0 * t) * 0.25 + Math.sin(6 * Math.PI * f0 * t) * 0.15);
        }
        syllable++;
        at += length + Math.round((syllable % 3 === 0 ? 0.15 : 0.05) * RATE);
    }
    for (let i = 0; i < out.length; i++) out[i] += (random() * 2 - 1) * noise;
    return out;
}

function wavFile(samples, file) {
    const out = Buffer.alloc(44 + samples.length * 2);
    out.write('RIFF', 0); out.writeUInt32LE(36 + samples.length * 2, 4); out.write('WAVE', 8); out.write('fmt ', 12);
    out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22); out.writeUInt32LE(RATE, 24); out.writeUInt32LE(RATE * 2, 28);
    out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(samples.length * 2, 40);
    for (let i = 0; i < samples.length; i++) out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
    fs.writeFileSync(file, out);
    return file;
}

const CLIPS = {
    good: () => synthClip(13),
    short: () => synthClip(6),
    clipped: () => synthClip(13).map(v => Math.max(-1, Math.min(1, v * 6))),
    noisy: () => synthClip(13, { noise: 0.08 }),
    soft: () => synthClip(13, { gain: 0.004, noise: 0.00001 }),
    long: () => synthClip(24),
};

/** A stub fetch with the real server's headers, logging every request it answers. */
function stubFetch({ down = false, key = 'k' } = {}) {
    const log = [];
    const fetcher = async (url, init = {}) => {
        log.push({ url: String(url), method: init.method || 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : null, auth: init.headers?.Authorization });
        if (down) throw new TypeError('Failed to fetch');
        const headers = new Map();
        const answer = (status, body, extra = {}) => ({ ok: status < 300, status, headers: { get: name => extra[name] ?? null },
            json: async () => body, arrayBuffer: async () => body });
        if (init.headers?.Authorization !== `Bearer ${key}` && !String(url).endsWith('/status')) return answer(401, { error: 'Invalid key' });
        if (String(url).endsWith('/status')) return answer(200, { ok: true, defaults: { exaggeration: 0.65, cfg_weight: 0.5, temperature: 0.8, steps: 24 }, eq: 'x', speed: false, check: true });
        if (String(url).endsWith('/v1/models')) return answer(200, { data: [] });
        if (String(url).endsWith('/v1/audio/speech')) {
            const body = JSON.parse(init.body);
            const pcm = new Int16Array(Math.round(RATE * 0.4));
            for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(Math.sin(i / 8) * 6000);
            return answer(200, pcm.buffer, { 'X-Chatterbox-Seed': String(body.seed), 'X-Chatterbox-Check': body.verify ? 'passed' : 'off',
                'X-Chatterbox-Names': body.names?.length ? encodeURIComponent(body.names[0].toLowerCase()) : null, 'X-Chatterbox-Renders': '1',
                'X-Chatterbox-Waited': body.input.includes('wait') ? '2.5' : '0', 'X-Chatterbox-Waited-For': body.input.includes('wait') ? 'room on the graphics card' : null,
                'X-Chatterbox-Settings': JSON.stringify({ exaggeration: body.exaggeration ?? 0.65 }) });
        }
        void headers;
        return answer(404, { error: 'no' });
    };
    return { fetcher, log };
}

async function unit() {
    const settingsStore = { roleplay_instructions: {} };
    globalThis.toastr = { info() {}, warning() {}, error() {}, success() {} };
    const host = {
        extensionSettings: settingsStore, saveSettingsDebounced() {}, chat: [], chatMetadata: {}, characters: [{ name: 'Seraphina', avatar: 'seraphina.png' }],
        characterId: 0, name1: 'Sam', name2: 'Seraphina', getCurrentChatId: () => 'chat-1', eventSource: { on() {} }, eventTypes: {},
    };
    globalThis.SillyTavern = { getContext: () => host };
    const T = await import(src('voice/text.js'));
    const A = await import(src('voice/audio.js'));
    const R = await import(src('routing.js'));
    const C = await import(src('voice/client.js'));
    const P = await import(src('voice/player.js'));
    const LOG = await import(src('log.js'));

    // Attribution: named by a speech verb, the nearest name in the paragraph, and the main character.
    const cast = [{ name: 'Seraphina', key: 'char:s', kind: 'character' }, { name: 'Sam Reyes', key: 'persona:Sam', kind: 'persona' }, { name: 'Hale', key: 'char:h', kind: 'character' }];
    const reply = '"Stay close," Seraphina whispered.\n\nSam looked back. "Who is there?" "Answer me." He waited.\n\n"Run." The word hung in the dark.\n\nHale stepped out. "I owe Mr. Vance $17 million by 3:30."';
    const quotes = T.quoteSpeakers(reply, { cast, main: cast[0] });
    check(quotes.map(q => `${q.speaker?.name}/${q.how}`).join('|') === 'Seraphina/named|Sam Reyes/nearest name|Sam Reyes/nearest name|Seraphina/main character|Hale/nearest name',
        `each quote goes to its speaker, an unattributed one to the main character: ${quotes.map(q => `${q.speaker?.name}/${q.how}`).join('|')}`);
    const lines = T.replyLines(reply, { cast, main: cast[0] });
    check(lines.at(-1).text === 'I owe Mister Vance seventeen million dollars by three thirty.', `numbers and abbreviations are spelled out: ${lines.at(-1).text}`);
    check(lines.map(l => l.pause).join() === '0.7,0.38,0.7,0.7,0', `pauses: 0.38 s inside a paragraph, 0.70 s between paragraphs, none at the end (${lines.map(l => l.pause).join()})`);
    const narration = T.replyLines('She waited. *He will come back,* she thought. Nobody spoke.', { cast, main: cast[0] });
    check(narration.length === 0, 'narration and thoughts are not read');
    const long = T.splitLines(`${'The long road ran on past the farms and the mill, '.repeat(6)}and then it ended.`);
    check(long.length > 1 && long.every(l => l.text.length <= 230) && long.at(-1).end === 'sentence' && long[0].end === 'clause', `a long sentence is cut at clauses under 230 characters (${long.map(l => l.text.length).join(', ')})`);
    check(T.splitLines('One. Two? Three!').map(l => l.text).join('|') === 'One.|Two?|Three!', 'one sentence per line');
    check(T.seedFor('Run.', 'v1') === T.seedFor('Run.', 'v1') && T.seedFor('Run.', 'v1') !== T.seedFor('Run.', 'v2') && T.seedFor('Run.', 'v1') < 2 ** 31, 'a line has a fixed seed per voice');
    check(T.spellOut('65.0% in 1999, the 21st, No. 4 vs. 2,500 & e.g. $4.50') === 'sixty-five point zero percent in nineteen ninety-nine, the twenty-first, number four versus two thousand five hundred and for example four dollars and fifty cents',
        `spellOut: ${T.spellOut('65.0% in 1999, the 21st, No. 4 vs. 2,500 & e.g. $4.50')}`);

    // The reference clip check.
    const good = A.checkClip(CLIPS.good());
    check(good.ok && good.kept >= 10 && good.kept <= 15, `a 13 s synthetic clip passes (${good.kept} s kept, ${good.speechSeconds} s of speech, ${good.snrDb} dB above the noise)`);
    const short = A.checkClip(CLIPS.short());
    check(!short.ok && /^Too short/.test(short.problems[0]), `a 6 s clip is refused: ${short.problems.join(' ')}`);
    const clipped = A.checkClip(CLIPS.clipped());
    check(!clipped.ok && clipped.problems.some(p => /^Clipped/.test(p)), `a clipped clip is refused: ${clipped.problems.join(' ')}`);
    const noisy = A.checkClip(CLIPS.noisy());
    check(!noisy.ok && noisy.problems.some(p => /^Noisy/.test(p)), `a noisy clip is refused: ${noisy.problems.join(' ')}`);
    const soft = A.checkClip(CLIPS.soft());
    check(!soft.ok && soft.problems.some(p => /^Too soft/.test(p)), `a too-soft clip is refused: ${soft.problems.join(' ')}`);
    const cut = A.checkClip(CLIPS.long());
    check(cut.ok && cut.cutTo >= 12 && cut.cutTo <= 15 && cut.clip.length / RATE <= 15.01, `a 24 s clip is cut to ${cut.cutTo} s at a pause`);
    const silent = new Float32Array(RATE * 3);
    silent.set(CLIPS.good().slice(0, RATE), RATE);
    const trimmed = A.trimEdges(silent);
    check(trimmed.length < RATE * 1.1, 'edge silence is trimmed');
    const faded = A.fadeEdges(new Float32Array(RATE).fill(0.5));
    check(faded[0] === 0 && Math.abs(faded[200] - 0.5) < 1e-6, '5 ms fades at each end');
    const levelled = [A.levelRms(new Float32Array(RATE).fill(0.05)), A.levelRms(new Float32Array(RATE).fill(0.6))]
        .map(s => Math.sqrt(s.reduce((sum, v) => sum + v * v, 0) / s.length));
    check(Math.abs(levelled[0] - levelled[1]) < 0.005, `lines are levelled to one RMS (${levelled.map(v => v.toFixed(3)).join(', ')})`);
    const wav = A.wavBytes(new Float32Array([0, 0.5, -0.5]));
    check(String.fromCharCode(...wav.slice(0, 4)) === 'RIFF' && wav.length === 50 && A.pcm16ToFloat(wav.slice(44))[1] > 0.49, 'clips are sent as 16-bit WAV');

    // The voice route stays on her devices.
    const refused = ['https://msi-aegis.tail7b1d19.ts.net', 'https://msi-aegis.tail7b1d19.ts.net:8443', 'https://msi-aegis.tail7b1d19.ts.net:10000', 'http://192.168.1.20:8125', 'https://voice.example.com', 'http://100.128.0.1:8125', 'ftp://100.97.15.107'];
    check(refused.every(url => R.voiceUrlProblem(url)), 'Funnel ports, LAN addresses and public hosts are refused as the voice address');
    const allowed = ['http://100.97.15.107:8125', 'http://[fd7a:115c:a1e0::6401:fc5]:8125', 'http://msi-aegis.tail7b1d19.ts.net:8125', 'http://127.0.0.1:9000'];
    check(allowed.every(url => !R.voiceUrlProblem(url)), 'tailnet addresses, a ts.net name on its own port and this machine are allowed');
    check(/Funnel/.test(R.voiceUrlProblem('https://x.ts.net:8443')), 'the refusal names Funnel');
    check(R.ROUTES.voice?.kind === 'voice' && !('voice' in R.detectRoutes()), 'the voice route is its own route and joins no text chain');

    // The client sends only what she changed and reads the server's answer.
    settingsStore.roleplay_instructions.voice = { url: 'http://100.97.15.107:8125', key: 'k', voices: {} };
    const ok = stubFetch();
    const probed = await C.probe({ fetcher: ok.fetcher });
    check(probed.ok && probed.mode === 'direct' && probed.status.speed === false, 'the probe reaches the server directly and reads its defaults');
    const said = await C.speak({ text: 'Hold on.', voice: 'ri-char-x', seed: 5, knobs: { exaggeration: 0.65, temperature: 0.7 }, verify: true, names: ['Seraphina'], fetcher: ok.fetcher });
    const body = ok.log.at(-1).body;
    check(body.seed === 5 && body.temperature === 0.7 && !('exaggeration' in body) && !('speed' in body) && body.verify === true, 'a request carries the seed and only the changed knobs, never speed');
    check(said.info.check === 'passed' && said.info.names === 'seraphina' && said.samples.length === Math.round(RATE * 0.4), 'the check, the names and the audio come back');
    const wrongKey = stubFetch({ key: 'other' });
    C.forgetReach();
    const refusedKey = await C.probe({ fetcher: wrongKey.fetcher });
    check(!refusedKey.ok && /refused the key/.test(refusedKey.reason), 'a wrong key is named');
    C.forgetReach();
    const off = await C.probe({ fetcher: stubFetch({ down: true }).fetcher, ms: 200 });
    check(!off.ok && /unavailable/.test(off.reason), `a desktop that is off reads as unavailable: ${off.reason.slice(0, 80)}`);
    check(R.routeHealth().voice?.down === true, 'route health shows the voice route down');

    // A reading: each line in its speaker's voice, cached per reply and swipe, dropped on an edit, failing plainly.
    settingsStore.roleplay_instructions.voice.voices = { 'char:seraphina.png': { id: 'ri-char-seraphina', knobs: {} }, 'persona:Sam': { id: 'ri-persona-sam', knobs: { exaggeration: 0.8 } } };
    host.chat = [{ name: 'Seraphina', is_user: false, mes: '"Stay close," Seraphina whispered. Sam frowned. "Why?" Sam asked.\n\n"Because I wait for no one."', swipe_id: 0 }];
    const plan = P.planReading(host.chat[0], host);
    check(plan.map(l => l.voice).join() === 'ri-char-seraphina,ri-persona-sam,ri-char-seraphina', `each line in its speaker's voice: ${plan.map(l => l.voice).join()}`);
    check(plan[1].knobs.exaggeration === 0.8 && plan.every(l => l.seed === T.seedFor(l.text, l.voice)), 'a voice keeps its delivery and every line its seed');
    const reading = stubFetch();
    C.forgetReach();
    const first = await P.readReply(0, { host, fetcher: reading.fetcher });
    const speechCalls = () => reading.log.filter(r => r.url.endsWith('/v1/audio/speech'));
    check(first.status === 'done' && speechCalls().length === 3, `the reply is read in ${speechCalls().length} line calls`);
    const receipt = LOG.logEntries().find(entry => entry.what === 'Read aloud');
    const text = receipt?.details.join('\n') || '';
    check(/Line 1 of 3: Seraphina \(named\), voice ri-char-seraphina, seed \d+, check passed/.test(text), 'the receipt names each line, voice, seed and check');
    check(/waited 2\.5 s for room on the graphics card/.test(text), 'the receipt says when a line waited its turn on the card');
    check(/Names to judge by ear: seraphina/.test(text), 'the receipt lists names for her ear');
    const again = await P.readReply(0, { host, fetcher: reading.fetcher });
    check(again.status === 'done' && speechCalls().length === 3, 'a replay costs nothing');
    check(/from the cache, no call/.test(LOG.logEntries().find(entry => entry.what === 'Read aloud').details.join('\n')), 'the replay receipt says it came from the cache');
    host.chat[0].swipe_id = 1;
    host.chat[0].mes = '"New words," Seraphina said.';
    await P.readReply(0, { host, fetcher: reading.fetcher });
    check(speechCalls().length === 4, 'a swipe reads its own text');
    P.dropReply(0);
    check(!P.cachedReplies().some(k => k.split('|')[1] === '0'), 'an edit or swipe drops the cached lines');
    host.chat[0].mes = '"Nobody here," the stranger said.';
    const borrowed = P.planReading(host.chat[0], host);
    check(borrowed[0].voice === 'ri-char-seraphina' && borrowed[0].how === 'main character', 'an unattributed quote uses the main character\'s voice');
    settingsStore.roleplay_instructions.voice.voices = {};
    check(P.planReading(host.chat[0], host)[0].voice === 'default', 'with no clip at all the built-in voice reads it');
    C.forgetReach();
    const down = await P.readReply(0, { host, fetcher: stubFetch({ down: true }).fetcher });
    check(down.status === 'failed' && /unavailable/.test(down.reason), 'with the desktop off, Read aloud says the voice is unavailable');
    settingsStore.roleplay_instructions.voice.url = 'https://x.ts.net:8443';
    const funnel = await P.readReply(0, { host, fetcher: reading.fetcher });
    check(funnel.status === 'failed' && /Funnel/.test(funnel.reason), 'a Funnel address is never called');
}

// The browser half.

function mockVoiceServer() {
    const log = [];
    let key = 'mock-key';
    const voices = new Map();
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            const origin = req.headers.origin;
            if (origin) {
                res.setHeader('Access-Control-Allow-Origin', origin);
                res.setHeader('Vary', 'Origin');
                res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
                res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
                res.setHeader('Access-Control-Expose-Headers', 'X-Chatterbox-Seed, X-Chatterbox-Check, X-Chatterbox-Names, X-Chatterbox-Renders, X-Chatterbox-Waited, X-Chatterbox-Waited-For, X-Chatterbox-Settings, X-Chatterbox-Seconds, X-Chatterbox-Heard, X-Chatterbox-Diffs');
                if (req.headers['access-control-request-private-network']) res.setHeader('Access-Control-Allow-Private-Network', 'true');
            }
            if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
            const body = Buffer.concat(chunks);
            const url = req.url;
            const entry = { method: req.method, url, origin, at: Date.now() };
            log.push(entry);
            const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
            if (url === '/status') return json(200, { ok: true, defaults: { exaggeration: 0.65, cfg_weight: 0.5, temperature: 0.8, steps: 24 }, eq: 'equalizer=f=4200:t=o:w=1.2:g=-3,highshelf=f=7000:g=4', speed: false, check: true });
            if (req.headers.authorization !== `Bearer ${key}`) return json(401, { error: 'Invalid key' });
            if (url === '/v1/models') return json(200, { data: [{ id: 'chatterbox' }] });
            if (url === '/v1/audio/voices' && req.method === 'POST') {
                const text = body.toString('latin1');
                const name = /name="name"\r\n\r\n([^\r]+)/.exec(text)?.[1] || 'voice';
                const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
                const riff = text.indexOf('RIFF');
                const bytes = riff >= 0 ? body.length - riff : 0;
                voices.set(id, bytes);
                entry.voice = { name, id, bytes, riff: riff >= 0 };
                return json(200, { voice_id: id, name, seconds: Math.round((bytes - 44) / 2 / RATE * 10) / 10 });
            }
            if (url.startsWith('/v1/audio/voices/') && req.method === 'DELETE') { voices.delete(decodeURIComponent(url.split('/').pop())); return json(200, { ok: true }); }
            if (url === '/v1/audio/speech') {
                const request = JSON.parse(body.toString('utf8'));
                entry.speech = request;
                const seconds = Math.min(3, 0.3 + request.input.length * 0.02);
                const pcm = Buffer.alloc(Math.round(seconds * RATE) * 2);
                for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 9) * 5000 * Math.min(1, i / 2000)), i * 2);
                const mishear = /MISHEAR/.test(request.input);
                res.writeHead(200, { 'Content-Type': 'audio/pcm;rate=24000', 'X-Chatterbox-Seed': String(mishear ? request.seed + 7919 : request.seed),
                    'X-Chatterbox-Check': request.verify ? (mishear ? 'redone, passed' : 'passed') : 'off', 'X-Chatterbox-Renders': mishear ? '2' : '1',
                    'X-Chatterbox-Names': encodeURIComponent((request.names || []).map(n => n.toLowerCase().split(' ')[0]).filter(n => request.input.toLowerCase().includes(n)).join(', ')),
                    'X-Chatterbox-Waited': '0', 'X-Chatterbox-Settings': JSON.stringify({ exaggeration: request.exaggeration ?? 0.65 }), 'X-Chatterbox-Seconds': String(seconds) });
                res.end(pcm);
                return;
            }
            json(404, { error: 'not here' });
        });
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, log, voices, port: server.address().port, setKey: k => { key = k; } })));
}

async function browserHalf() {
    const { chromium } = require(process.env.RI_PLAYWRIGHT || 'playwright-core');
    const HOST = process.env.RI_HOST_URL || 'http://127.0.0.1:8617';
    const BASE = '/scripts/extensions/third-party/roleplay-instructions';
    const OUT = process.env.RI_EVIDENCE || path.join(__dirname, '../docs/ux-overhaul/audit/evidence/build/V1');
    fs.mkdirSync(OUT, { recursive: true });
    const dir = fs.mkdtempSync(path.join(process.env.TEMP || os.tmpdir(), 'ri-v1-'));
    const files = Object.fromEntries(Object.entries(CLIPS).map(([name, make]) => [name, wavFile(make(), path.join(dir, `${name}.wav`))]));
    const mock = await mockVoiceServer();
    const voiceUrl = `http://127.0.0.1:${mock.port}`;
    const browser = await chromium.launch({ executablePath: process.env.RI_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
        args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${files.good}`, '--autoplay-policy=no-user-gesture-required'] });
    try {
        for (const viewport of [{ width: 523, height: 1021 }, { width: 1006, height: 909 }]) {
            const tag = `${viewport.width}`;
            const context = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: true, isMobile: viewport.width < 1000, colorScheme: 'dark' });
            await context.grantPermissions(['microphone'], { origin: HOST });
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
            // A fresh chat with one reply that holds four quotes: Seraphina by name, the persona by name, and an unattributed one.
            const names = await page.evaluate(async ({ BASE }) => {
                const host = SillyTavern.getContext();
                const idx = host.characters.findIndex(item => item.name);
                if (String(host.characterId) !== String(idx)) await host.selectCharacterById(idx);
                await new Promise(resolve => setTimeout(resolve, 800));
                await host.executeSlashCommandsWithOptions('/newchat');
                await new Promise(resolve => setTimeout(resolve, 1200));
                const S = await import(`${BASE}/src/store.js`);
                S.settings().voice = { url: '', key: '', verify: true, voices: {} };
                S.saveSettings();
                const now = SillyTavern.getContext();
                const char = now.characters[now.characterId].name, user = now.name1;
                now.chat.push({ name: char, is_user: false, is_system: false, send_date: new Date().toISOString(), swipe_id: 0, swipes: [''], extra: {},
                    mes: `"Stay close," ${char} whispered, and the lantern swung.\n\n${user} looked back at the trees. "Who is there, ${char}?" ${user} asked.\n\n"Run." The word hung in the dark, and it cost 17 dollars at 3:30.` });
                now.chat.at(-1).swipes[0] = now.chat.at(-1).mes;
                await now.saveChat();
                await now.reloadCurrentChat();
                return { char, user };
            }, { BASE });
            await page.waitForTimeout(1500);
            const replyId = await page.evaluate(() => SillyTavern.getContext().chat.findLastIndex(m => !m.is_user && !m.is_system));
            check(await page.locator(`#chat .mes[mesid="${replyId}"] .ri-voice-button`).count() === 0, `${tag}: no Read aloud entry before a desktop voice is set up`);

            // The Voices page: address, key, test, and the Funnel refusal.
            await page.evaluate(async ({ BASE }) => { const { app } = await import(BASE + '/src/ui/panel.js'); await app.openPage('voices', { focusPage: true }); await app.setExpanded(true); }, { BASE });
            await page.waitForSelector('#ri-voice-page', { timeout: 10000 });
            const urlBox = page.locator('#ri-voice-page input[type="url"]');
            await urlBox.fill('https://msi.tail7b1d19.ts.net:8443');
            await urlBox.dispatchEvent('change');
            check(/Funnel/.test(await page.locator('.ri-voice-url-problem').textContent()), `${tag}: a Funnel address is refused on the page`);
            await urlBox.fill(voiceUrl);
            await urlBox.dispatchEvent('change');
            await page.locator('#ri-voice-page input[type="password"]').fill('mock-key');
            await page.locator('#ri-voice-page input[type="password"]').dispatchEvent('change');
            await tap(page.getByRole('button', { name: 'Test the connection' }));
            await page.waitForFunction(() => /Connected|unavailable|refused/.test(document.querySelector('.ri-voice-probe')?.textContent || ''), null, { timeout: 10000 });
            const probeText = await page.locator('.ri-voice-probe').textContent();
            check(/Connected directly\. Defaults: expressiveness 0\.65, closeness 0\.5, variety 0\.8, 24 vocoder steps, tone-match EQ/.test(probeText), `${tag}: the test names the King County defaults: ${probeText}`);
            const charCard = page.locator(`.ri-voice-card[data-ri-voice-member^="char:"]`).first();
            const personaCard = page.locator(`.ri-voice-card[data-ri-voice-member^="persona:"]`).first();
            check(await charCard.count() === 1 && await personaCard.count() === 1, `${tag}: one card for the character and one for the persona`);

            // Uploads: short, clipped and noisy are refused with their reasons; a good one is saved and plays the test line.
            // A card's result line changes from "Checking" to its outcome; wait for the outcome of this upload.
            const result = async (selector, act) => {
                await page.evaluate(sel => { const node = document.querySelector(`${sel} .ri-voice-result`); if (node) node.dataset.riSeen = node.textContent; }, selector);
                await act();
                await page.waitForFunction(sel => {
                    const node = document.querySelector(`${sel} .ri-voice-result`);
                    const text = node?.textContent || '';
                    return text && !/^Checking|^Rendering|^Recording/.test(text) && (node.dataset.riSeen === undefined || text !== node.dataset.riSeen);
                }, selector, { timeout: 30000 });
                return page.locator(`${selector} .ri-voice-result`);
            };
            const charSel = '.ri-voice-card[data-ri-voice-member^="char:"]';
            for (const [name, reason] of [['short', /Too short/], ['clipped', /Clipped/], ['noisy', /Noisy/]]) {
                const line = await result(charSel, () => charCard.locator('input[type="file"]').setInputFiles(files[name]));
                const text = await line.textContent();
                check(reason.test(text) && await line.getAttribute('role') === 'alert', `${tag}: a ${name} clip is refused with its reason: ${text.slice(0, 120)}`);
            }
            const before = mock.log.length;
            const savedLine = await result(charSel, () => charCard.locator('input[type="file"]').setInputFiles(files.good));
            check(/^Saved: a 1\d(\.\d)? s clip/.test(await savedLine.textContent()), `${tag}: a good clip is saved: ${(await savedLine.textContent()).slice(0, 120)}`);
            const uploads = mock.log.slice(before).filter(e => e.voice);
            check(uploads.length === 1 && uploads[0].voice.riff && uploads[0].voice.id.startsWith('ri-char-'), `${tag}: the good clip goes to the desktop as a WAV (${uploads[0]?.voice.bytes} bytes)`);
            check(mock.log.slice(before).some(e => e.speech && /rain had stopped/.test(e.speech.input)), `${tag}: the test line plays in the new voice`);
            const saved = await page.evaluate(async ({ BASE }) => (await import(`${BASE}/src/voice/client.js`)).voiceSettings().voices, { BASE });
            const charKey = Object.keys(saved).find(k => k.startsWith('char:'));
            check(saved[charKey]?.id === uploads[0]?.voice.id && saved[charKey].seconds <= 15, `${tag}: the character keeps the voice id and clip length`);

            // Record the persona's voice through the fake microphone (a synthetic clip), and stop by tap.
            await page.evaluate(async ({ BASE }) => { const { app } = await import(BASE + '/src/ui/panel.js'); await app.openPage('voices', { focusPage: true }); }, { BASE });
            await page.waitForSelector('#ri-voice-page');
            const recordButton = page.locator('.ri-voice-card[data-ri-voice-member^="persona:"] .ri-voice-record');
            await tap(recordButton);
            await page.waitForTimeout(500);
            check(/Stop recording/.test(await recordButton.textContent()) && await recordButton.getAttribute('aria-pressed') === 'true', `${tag}: recording shows Stop with a counter`);
            await page.waitForTimeout(13500);
            const recordedLine = await result('.ri-voice-card[data-ri-voice-member^="persona:"]', () => tap(recordButton));
            const recorded = await recordedLine.textContent();
            check(/Saved/.test(recorded), `${tag}: a recorded clip becomes a voice: ${recorded.slice(0, 140)}`);
            await page.screenshot({ path: path.join(OUT, `voices-${tag}.png`), fullPage: false });

            // Targets and reflow on the page.
            const layout = await page.evaluate(() => {
                const page = document.getElementById('ri-voice-page');
                const small = [...page.querySelectorAll('button, label.ri-btn, input[type="range"], input[type="url"], input[type="password"]')]
                    .map(node => node.getBoundingClientRect()).filter(r => r.width && (r.width < 24 || r.height < 24)).length;
                return { small, overflow: document.documentElement.scrollWidth > innerWidth + 1 || page.scrollWidth > page.clientWidth + 1 };
            });
            check(layout.small === 0 && !layout.overflow, `${tag}: every control is at least 24 px and nothing scrolls sideways`);

            // Read aloud from the message menu.
            await page.evaluate(async ({ BASE }) => { const { app } = await import(BASE + '/src/ui/panel.js'); await app.setExpanded(false); await app.close?.(); }, { BASE });
            await page.keyboard.press('Escape');
            await page.waitForTimeout(400);
            await page.evaluate(async ({ BASE }) => (await import(`${BASE}/src/voice/ui.js`)).refreshVoiceButtons(), { BASE });
            const mes = page.locator(`#chat .mes[mesid="${replyId}"]`);
            const entry = mes.locator('.ri-voice-button');
            check(await entry.count() === 1 && await entry.getAttribute('aria-label') === 'Read aloud', `${tag}: the reply's message menu has Read aloud`);
            if (!await entry.isVisible()) await tap(mes.locator('.extraMesButtonsHint'));
            const speechBefore = mock.log.filter(e => e.speech).length;
            await tap(entry);
            await page.waitForFunction(id => {
                const node = document.querySelector(`#chat .mes[mesid="${id}"] .ri-voice-button`);
                return node && (node.dataset.riVoice === 'done' || node.dataset.riVoice === 'failed');
            }, replyId, { timeout: 30000 });
            const spoken = mock.log.filter(e => e.speech).slice(speechBefore).map(e => e.speech);
            const savedNow = await page.evaluate(async ({ BASE }) => (await import(`${BASE}/src/voice/client.js`)).voiceSettings().voices, { BASE });
            const charVoice = savedNow[Object.keys(savedNow).find(k => k.startsWith('char:'))].id;
            const personaVoice = savedNow[Object.keys(savedNow).find(k => k.startsWith('persona:'))].id;
            check(spoken.map(s => s.voice).join() === [charVoice, personaVoice, charVoice].join(), `${tag}: each line in its speaker's voice, the unattributed one in ${names.char}'s (${spoken.map(s => s.voice).join()})`);
            check(spoken.every(s => s.verify === true && Number.isInteger(s.seed) && !('speed' in s) && s.names.includes(names.char)), `${tag}: every line asks for the check, carries a fixed seed and the cast names, and no speed`);
            check(spoken[2]?.input === 'Run.' && !spoken.some(s => /lantern|trees/.test(s.input)), `${tag}: only the quoted dialogue is read`);
            const receipt = await page.evaluate(async ({ BASE }) => (await import(`${BASE}/src/log.js`)).logEntries().find(e => e.what === 'Read aloud')?.details.join('\n'), { BASE });
            check(/Line 1 of 3: .*check passed/.test(receipt) && /Names to judge by ear/.test(receipt), `${tag}: the request log holds the reading's receipt`);
            await tap(entry);
            await page.waitForTimeout(1500);
            await page.waitForFunction(id => ['done', 'stopped'].includes(document.querySelector(`#chat .mes[mesid="${id}"] .ri-voice-button`)?.dataset.riVoice), replyId, { timeout: 15000 });
            check(mock.log.filter(e => e.speech).length === speechBefore + spoken.length, `${tag}: a replay makes no call`);

            // An edit drops the cached lines.
            await page.evaluate(async id => {
                const host = SillyTavern.getContext();
                host.chat[id].mes = '"Wait for me," she said.';
                await host.eventSource.emit(host.eventTypes.MESSAGE_EDITED, id);
            }, replyId);
            await page.waitForTimeout(300);
            const cachedAfterEdit = await page.evaluate(async ({ BASE, id }) => (await import(`${BASE}/src/voice/player.js`)).cachedReplies().filter(k => k.split('|')[1] === String(id)).length, { BASE, id: replyId });
            check(cachedAfterEdit === 0, `${tag}: an edit drops the cached lines`);

            // The desktop off: Read aloud says the voice is unavailable and the entry shows the failure.
            await page.evaluate(async ({ BASE, url }) => { const C = await import(`${BASE}/src/voice/client.js`); C.saveVoiceSettings({ url }); C.forgetReach(); }, { BASE, url: 'http://127.0.0.1:9' });
            await tap(entry);
            await page.waitForFunction(id => document.querySelector(`#chat .mes[mesid="${id}"] .ri-voice-button`)?.dataset.riVoice === 'failed', replyId, { timeout: 20000 });
            const label = await entry.getAttribute('aria-label');
            check(/unavailable/.test(label) && (await entry.getAttribute('class')).includes('fa-volume-xmark'), `${tag}: with the desktop off the entry says the voice is unavailable: ${label.slice(0, 100)}`);
            await page.screenshot({ path: path.join(OUT, `read-aloud-${tag}.png`) });
            check(!errors.length, `${tag}: no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
            // Put the address back for the next width.
            await page.evaluate(async ({ BASE }) => { const S = await import(`${BASE}/src/store.js`); delete S.settings().voice; S.saveSettings(); }, { BASE });
            await context.close();
        }
        const origins = [...new Set(mock.log.map(e => e.origin).filter(Boolean))];
        check(origins.every(o => o === new URL(HOST).origin), `every voice call came from the page's own origin (${origins.join(', ')})`);
    } finally {
        await browser.close();
        mock.server.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

(async () => {
    try {
        await unit();
        if (!process.argv.includes('--unit')) await browserHalf();
    } catch (error) {
        console.log('FAIL ' + (error?.stack || error));
        failed++;
        process.exitCode = 1;
    }
    console.log(failed ? `${failed} failed` : 'all passed');
    process.exit(process.exitCode || 0);
})();
