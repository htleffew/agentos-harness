// Mock OpenAI-compatible server for local tests. The one mock every suite uses.
//   RI_MOCK_PORT   port (default 8124)          RI_MOCK_LOG   request log, one JSON row per request (messages, answer, raw body)
//   RI_MOCK_MODE   JSON file steering answers   RI_MOCK_DIR   folder holding mode.txt ("leaks") and delay.txt (ms); default: this folder
//   RI_MOCK_MODEL  model id it lists, also logged on each row (the alternate recorder of t_execution_routes.js)
// It answers B2's titled Options, MB6's chapter Writer and condensed account, and the older fixed prompts of the 5.x suites.
const http = require('http');
const fs = require('fs');
const path = require('path');
const LOG = process.env.RI_MOCK_LOG || '/tmp/mock-requests.jsonl';
const MODE = process.env.RI_MOCK_MODE || '/tmp/mock-mode.json';
const DIR = process.env.RI_MOCK_DIR || __dirname;
const NL = String.fromCharCode(10);
// The hash of this file as the process loaded it. run_browser.sh compares it with the file on disk, so a mock started
// before a pull that changed it (and so missing kinds or answers) stops the sweep instead of failing suites oddly.
const SOURCE = require('crypto').createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
function mode() { try { return JSON.parse(fs.readFileSync(MODE, 'utf8')); } catch { return {}; } }
function txt(name) { try { return fs.readFileSync(path.join(DIR, name), 'utf8').trim(); } catch { return ''; } }
const NPCS = [
    ['The Lantern Keeper', 'Old Maren shuffles up from the gate with a ring of keys. She insists the guard owes her a favor. She saw a stranger slip past at dusk and wants someone to listen. Her lantern smokes as she talks, and she keeps glancing at the stable door.'],
    ['A Courier at Full Gallop', 'A mud-splashed rider reins in hard with a sealed letter clenched in one fist. He demands to know which of you answers to the name on it. His horse is lathered and lame. He will not hand the letter over until someone signs for it.'],
    ['The Smiling Pilgrim', 'A traveler in a too-clean robe offers bread to everyone in the courtyard. He asks where you came from and which road you took. His questions are a little too specific. He laughs at the right moments and never eats the bread himself.'],
    ['Captain Ilse Voss', 'The garrison captain arrives with two soldiers, polite and immovable. She announces that nobody leaves the courtyard tonight. She has a list of names and reads them out one by one. Yours is the third, and she looks up when she reaches it.'],
    ['The Herbalist Apprentice', 'A nervous boy with stained fingers recognizes your wound at once. He whispers that his mistress can help, for a price. He keeps a sprig of something bitter behind his ear. He will lead you there now, if you go quietly.'],
];
// The kind of a request, read from the prompt's own task line, so a suite can count only the kinds it asserts.
// reply is the chat generation itself; capture, chapter and condensed are the background memory calls.
const KINDS = [
    ['capture', /You keep the records of a roleplay story/],
    ['tidy', /You tidy the records of a roleplay story/],
    ['chapter', /Write the record of one chapter|Write the summary of one part of a roleplay story/],
    ['condensed', /Condense these stored chapter records|You condense the stored chapter records/],
    ['options', /Return a JSON array of exactly \d+ distinct objects|Return a JSON array of 3 strings/],
    ['draft', /Return only playable first-person draft prose/],
    ['check', /"done"[\s\S]*quote|quote[\s\S]*"done"/],
    ['writer', /Return only a JSON (list|object)/],
    ['behavior', /You draft the entries of a behavior book/],
];
const kindOf = text => (KINDS.find(([, pattern]) => pattern.test(text)) || ['reply'])[0];
let n = 0;
function answer(body) {
    const msgs = body.messages || [];
    const all = msgs.map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join(NL);
    const m = mode();
    if (/You keep the records of a roleplay story/.test(all)) return JSON.stringify(m.capture || { decisions: { durable_change: false, scene_ended: false, out_of_character: false }, ops: [],
        state: { scene: { place: 'The mock scene', time: 'Day 1, evening', present: ['Hale'] } } });
    // MB7: the Cleanup call. Each cluster is ruled from mode.tidy.clusters (keyed by its record ids joined with "|" in the
    // order listed), else merged with every record's text joined and quoted in full. Each entry pair is ruled from
    // mode.tidy.entries (keyed by pair), else "fine".
    if (/You tidy the records of a roleplay story/.test(all)) {
        const t = m.tidy || {};
        const clusters = [];
        let current = null;
        for (const line of all.split(NL)) {
            const head = /^Cluster (\S+) \(/.exec(line);
            if (head) { current = { cluster: head[1], records: [] }; clusters.push(current); continue; }
            const rec = /^\[([^\]]+)\] [^|]+\| [^|]+\| ([^|]+?)(?: \| quote:.*)?$/.exec(line);
            if (current && rec) current.records.push({ id: rec[1], text: rec[2].trim() });
            else if (!line.trim()) current = null;
        }
        const out = clusters.map(c => {
            const set = (t.clusters || {})[c.records.map(r => r.id).join('|')];
            if (set) return { cluster: c.cluster, ruling: set.ruling, newer: set.newer ?? null, text: set.text ?? null, quotes: set.quotes || [], reason: set.reason || 'Ruled by the mock.' };
            return { cluster: c.cluster, ruling: 'merge', newer: null, text: c.records.map(r => r.text.replace(/\.$/, '')).join('; ') + '.', quotes: c.records.map(r => ({ id: r.id, quote: r.text })), reason: 'The records describe one thing.' };
        });
        // A pair is looked up by its two references, sorted and joined with "|" (the extension's own pair key).
        const entries = [...all.matchAll(/^Pair (\S+):\nA: \[([^\]]+)\][^\n]*\nB: \[([^\]]+)\]/gm)]
            .map(x => ({ pair: x[1], ruling: (t.entries || {})[[x[2], x[3]].sort().join('|')] || 'fine', reason: 'Ruled by the mock.' }));
        return JSON.stringify({ clusters: out, entries });
    }
    // MB6: the chapter Writer and the condensed call, answered from the prompt's own messages.
    if (/Write the record of one chapter/.test(all)) {
        if (m.chapterFail) return JSON.stringify({ evidence: [{ message: 'x', quote: 'words that are in no reply at all' }], title: 'Bad', summary: 'Too short.', people: [], places: [] });
        const rows = [...all.matchAll(/^\[(\S+)\] ([^:\n]+): (.+)$/gm)].map(x => ({ label: x[1], name: x[2], text: x[3] }));
        const replies = rows.filter((r, i) => i % 2 === 1 || !/^(User|You)$/.test(r.name));
        const evidence = rows.slice(0, 3).map(r => ({ message: r.label, quote: r.text.slice(0, 40) }));
        let summary = rows.map(r => `${r.name} said or did this: ${r.text}`).join(' ').split(/\s+/).slice(0, 190).join(' ');
        while (summary.split(/\s+/).length < 160) summary += ' The exchange continued at the same table.';
        return JSON.stringify({ evidence, title: `Chapter of ${rows.length} messages`, start_time: '', end_time: '', summary, people: [...new Set(rows.map(r => r.name))], places: [], threads_opened: [], threads_closed: [], importance: 5, secrets: [], final_changes: [], event_seeds: m.chapterSeeds || [] });
    }
    // MB12: Draft entries from a description. mode.behaviorDraft is the answer; else one event keyed on the first name.
    if (/You draft the entries of a behavior book/.test(all)) {
        if (m.behaviorDraft) return JSON.stringify(m.behaviorDraft);
        return JSON.stringify({ entries: [{ kind: 'event', title: 'Rival courier', content: 'A rival courier from Valen arrives asking for Hale.', people: [], places: ['Valen'], once: false }] });
    }
    if (/Condense these stored chapter records/.test(all)) {
        const parts = [...all.matchAll(/^\[(\S+)\] target (\d+) words\. (.+)$/gm)].map(x => ({ id: x[1], text: x[3].split(/\s+/).slice(0, Number(x[2])).join(' ') }));
        return JSON.stringify({ parts });
    }
    const titled = all.match(/Return a JSON array of exactly (\d+) distinct objects/);
    if (titled) {
        const round = i => (i < NPCS.length ? '' : ` ${Math.floor(i / NPCS.length) + 1}`);
        const items = Array.from({ length: +titled[1] }, (_, i) => ({ title: NPCS[i % NPCS.length][0] + round(i), text: NPCS[i % NPCS.length][1] + (round(i) ? ` Visit${round(i)}.` : '') }));
        if (txt('mode.txt') === 'leaks') return JSON.stringify([items[0], '---', { title: 'The Orphaned Title' }, '* * *', items[1]]);
        return JSON.stringify(items);
    }
    if (/Return a JSON array of 3 strings/.test(all)) return m.choices ?? JSON.stringify([
        'I raise a hand and ask for the key.', 'I offer to guard the door.', 'I say I know another way inside.',
    ]);
    if (/Return only playable first-person draft prose/.test(all)) return m.player ?? 'I set the key on the table and ask what she intends to do.';
    if (/Reply with exactly this JSON/.test(all)) return '["one","two"]';
    if (/Return only a JSON object with the keys/i.test(all)) {
        return m.goal || JSON.stringify({ goal: '[[char]] wants [[user]] to trust [[char.them]].', actions: ['compliment [[user]]', 'ask [[user]] a question', 'touch [[user]] on the arm', 'smile at [[user]]', 'agree with [[user]]'], steps: ['tell [[user]] a secret', 'apologise to [[user]]', 'ask [[user]] for help', 'give [[user]] a gift while out on a date at the restaurant tonight', 'make [[user]] a promise'] });
    }
    if (/Return only a JSON list of objects, one per item/i.test(all)) {
        if (m.writer) return m.writer;
        const k = Number((all.match(/Write (\d+) /) || [0, 5])[1]);
        return JSON.stringify(Array.from({ length: k }, (_, i) => ({ text: `story item ${i}`, anywhere: i !== 1 })));
    }
    if (/Return only a JSON list of (\d+ )?strings/i.test(all)) {
        if (m.writerNeedsRoom && (body.max_tokens || body.max_completion_tokens || 0) < m.writerNeedsRoom) return '';
        if (m.writer) return m.writer;
        const k = Number((all.match(/Write (\d+) /) || [0, 5])[1]);
        const out = [];
        for (let i = 0; i < k; i++) out.push(i === 1 ? `Aria might consider giving Sam a small gift number ${i}.` : i === 2 ? `Sam decides to kiss Aria. Variation ${i}.` : `Aria must pay Sam compliment number ${i} about her work.`);
        return 'Here you go:' + NL + '```json' + NL + JSON.stringify(out) + NL + '```';
    }
    if (/"done"/.test(all) && /quote/.test(all)) {
        if (m.checker) return m.checker;
        const ids = [...all.matchAll(/^ID (\S+):/gm)].map(x => x[1]);
        const done = m.done !== false;
        return JSON.stringify(ids.map(id => ({ id, done, quote: done ? 'You look wonderful tonight' : '' })));
    }
    n++;
    return m.reply ?? `Reply ${n}. She leans in. "You look wonderful tonight," she says, and she means it.`;
}
function delayMs() {
    const file = Number(txt('delay.txt'));
    if (file > 0) return file;
    return Number(mode().delayMs) || 0;
}
http.createServer((req, res) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', '*');
        if (req.method === 'OPTIONS') { res.end(); return; }
        if (req.url === '/mock/source') { res.end(SOURCE); return; }
        if (req.url.includes('/models')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ object: 'list', data: [{ id: process.env.RI_MOCK_MODEL || 'mock-model', object: 'model' }] })); return; }
        let body = {};
        try { body = JSON.parse(data || '{}'); } catch { }
        if (req.url.endsWith('/v1/internal/encode')) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ length: Math.ceil(String(body.text || '').length / 4), tokens: [] }));
            return;
        }
        const textCompletion = typeof body.prompt === 'string' && !Array.isArray(body.messages);
        const messages = textCompletion ? [{ role: 'text', content: body.prompt }] : (body.messages || []);
        const text = answer({ ...body, messages });
        const model = process.env.RI_MOCK_MODEL ? { model: body.model } : {};
        fs.appendFileSync(LOG, JSON.stringify({ t: Date.now(), at: Date.now(), url: req.url, kind: kindOf(messages.map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join(NL)), stream: !!body.stream, max_tokens: body.max_tokens || body.max_completion_tokens, ...model, messages, answer: text, body: data }) + NL);
        if (mode().fail) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Fixture provider unavailable' } }));
            return;
        }
        const delay = delayMs();
        if (body.stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            const parts = text.match(/.{1,40}/gs) || [''];
            const gap = Number(mode().chunkMs) || 0;
            const failAfter = Number(mode().streamFailAfter) || 0;
            (async () => {
                if (delay) await new Promise(resolve => setTimeout(resolve, delay));
                for (const [index, p] of parts.entries()) {
                    if (gap) await new Promise(resolve => setTimeout(resolve, gap));
                    if (res.destroyed) return;
                    res.write('data: ' + JSON.stringify({ id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: p } }] }) + NL + NL);
                    if (failAfter === index + 1) {
                        if (gap) await new Promise(resolve => setTimeout(resolve, gap));
                        res.end('data: {interrupted' + NL + NL);
                        return;
                    }
                }
                res.write('data: ' + JSON.stringify({ id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + NL + NL);
                res.end('data: [DONE]' + NL + NL);
            })();
        } else {
            const send = () => {
                if (res.destroyed) return;
                res.setHeader('Content-Type', 'application/json');
                const choice = textCompletion ? { text } : { message: { role: 'assistant', content: text } };
                res.end(JSON.stringify({ id: 'x', object: textCompletion ? 'text_completion' : 'chat.completion', choices: [{ index: 0, ...choice, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
            };
            if (delay > 0) setTimeout(send, delay); else send();
        }
    });
}).listen(Number(process.env.RI_MOCK_PORT || 8124), '127.0.0.1', function () { console.log('mock on', this.address().port); });
