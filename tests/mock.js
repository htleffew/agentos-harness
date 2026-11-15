// Mock OpenAI-compatible server for local tests.
const http = require('http');
const fs = require('fs');
const LOG = '/tmp/mock-requests.jsonl';
const MODE = '/tmp/mock-mode.json';
function mode() { try { return JSON.parse(fs.readFileSync(MODE, 'utf8')); } catch { return {}; } }
let n = 0;
function answer(body) {
    const msgs = body.messages || [];
    const all = msgs.map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n');
    const m = mode();
    if (/Reply with exactly this JSON/.test(all)) return '["one","two"]';
    if (/Return only a JSON list of strings/i.test(all)) {
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
        const text = answer(body);
        fs.appendFileSync(LOG, JSON.stringify({ t: Date.now(), url: req.url, stream: !!body.stream, messages: body.messages, answer: text }) + '\n');
        if (body.stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            const parts = text.match(/.{1,40}/gs) || [''];
            for (const p of parts) res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: p } }] })}\n\n`);
            res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
            res.write('data: [DONE]\n\n'); res.end();
        } else {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ id: 'x', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
        }
    });
}).listen(8124, '127.0.0.1', () => console.log('mock on 8124'));
