// Mock OpenAI-compatible server for local tests.
const http = require('http');
const fs = require('fs');
const LOG = process.env.RI_MOCK_LOG || '/tmp/mock-requests.jsonl';
const MODE = process.env.RI_MOCK_MODE || '/tmp/mock-mode.json';
function mode() { try { return JSON.parse(fs.readFileSync(MODE, 'utf8')); } catch { return {}; } }
let n = 0;
function answer(body) {
    const msgs = body.messages || [];
    const all = msgs.map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n');
    const m = mode();
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
        return 'Here you go:\n```json\n' + JSON.stringify(out) + '\n```';
    }
    if (/"done"/.test(all) && /quote/.test(all)) {
        if (m.checker) return m.checker;
        const ids = [...all.matchAll(/^ID (\S+):/gm)].map(x => x[1]);
        const done = m.done !== false;
        return JSON.stringify(ids.map(id => ({ id, done, quote: done ? 'You look wonderful tonight' : '' })));
    }
    n++;
    return m.reply || `Reply ${n}. She leans in. "You look wonderful tonight," she says, and she means it.`;
}
http.createServer((req, res) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', '*');
        if (req.method === 'OPTIONS') { res.end(); return; }
        if (req.url.includes('/models')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-model', object: 'model' }] })); return; }
        let body = {};
        try { body = JSON.parse(data || '{}'); } catch { }
        if (req.url.endsWith('/v1/internal/encode')) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ length: Math.ceil(String(body.text || '').length / 4), tokens: [] }));
            return;
        }
        const textCompletion = typeof body.prompt === 'string' && !Array.isArray(body.messages);
        const messages = textCompletion ? [{ role: 'text', content: body.prompt }] : body.messages;
        const text = answer({ ...body, messages });
        fs.appendFileSync(LOG, JSON.stringify({ t: Date.now(), url: req.url, stream: !!body.stream, max_tokens: body.max_tokens || body.max_completion_tokens, messages, answer: text }) + '\n');
        if (mode().fail) {
            res.writeHead(503, { 'Content-Type':'application/json' });
            res.end(JSON.stringify({ error:{ message:'Fixture provider unavailable' } }));
            return;
        }
        if (body.stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            const parts = text.match(/.{1,40}/gs) || [''];
            const gap = Number(mode().chunkMs) || 0;
            (async () => {
                for (const p of parts) {
                    if (gap) await new Promise(resolve => setTimeout(resolve,gap));
                    if (res.destroyed) return;
                    res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: p } }] })}\n\n`);
                }
                res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
                res.end('data: [DONE]\n\n');
            })();
        } else {
            res.setHeader('Content-Type', 'application/json');
            const choice = textCompletion ? { text } : { message: { role: 'assistant', content: text } };
            res.end(JSON.stringify({ id: 'x', object: textCompletion ? 'text_completion' : 'chat.completion', choices: [{ index: 0, ...choice, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
        }
    });
}).listen(Number(process.env.RI_MOCK_PORT || 8124), '127.0.0.1', function () { console.log('mock on',this.address().port); });
