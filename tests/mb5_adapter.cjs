'use strict';
// MB5: the production request layout (src/memory/inject.js) behind the MB11 harness's reference model of DESIGN section 5
// (memory/evidence/m1g/harness/mb11/ref/assemble.js). It stacks on mb4_adapter.cjs, so the recall block is the production
// search rendered by the production renderBlock, with the production memory instruction at the end of the stable prefix and
// the production rule reminder at depth 0. The chapter view stays the reference model's (MB6 tests its own). `install()`
// replaces the exports of ref/assemble.js in place; call it before scen_retrieval.js is required.
const path = require('path');
const { pathToFileURL } = require('url');
const mb4 = require('./mb4_adapter.cjs');

const ROOT = path.join(__dirname, '..');
const url = rel => pathToFileURL(path.join(ROOT, rel)).href;

async function install({ embedder }) {
    await mb4.install({ embedder });
    const inject = await import(url('src/memory/inject.js'));
    const search = await import(url('src/memory/search.js'));
    const ref = require(path.join(mb4.HARNESS, 'ref', 'assemble.js'));
    const { retrieve } = require(path.join(mb4.HARNESS, 'ref', 'retrieval.js'));
    const { tokens } = require(path.join(mb4.HARNESS, 'ref', 'util.js'));
    const { newEngine, playTurn } = require(path.join(mb4.HARNESS, 'ref', 'play.js'));
    const refStatic = ref.staticPrefix;

    // the stable prefix of the reference run, with the production memory instruction in place of the reference one
    let staticCache = null;
    const staticPrefix = () => (staticCache ||= [...refStatic().filter(m => m.content !== ref.MEMORY_INSTRUCTION), { role: 'system', content: inject.MEMORY_INSTRUCTION }]);

    async function assemble(engine, question, opts = {}) {
        const o = { size: 'mid', pov: 'Hale', ...opts };
        const r = await retrieve(engine, question, { ...(o.retrieval || {}), tokenCap: inject.SIZE_CAPS[o.size].recall, embedder: o.embedder, pov: o.pov, staticText: o.staticText, holderRule: engine.faults.has('noHolderRule') ? false : undefined });
        const recall = search.renderBlock(r.items, { scene: mb4.sceneOf(engine), sceneLine: o.sceneLine !== false });
        const view = ref.chapterView(engine, o.size, o.pov, o.chapterScale || 1);
        const covered = engine.covered();
        const history = engine.chat.messages.filter(m => !covered.has(m.mark)).map(m => ({ role: m.role, content: engine.chat.text(m) }));
        const messages = [...(o.static || []).map(m => ({ ...m }))];
        if (view.text) messages.push({ role: 'system', content: view.text });
        messages.push(...history);
        if (recall) messages.push({ role: 'system', content: recall });
        messages.push({ role: 'user', content: question });
        messages.push({ role: 'system', content: inject.RULE_REMINDER });
        return { messages, parts: { recall, recallTokens: tokens(recall), view, hidden: covered.size, items: r.items, query: r.query } };
    }

    async function runDesign({ turns = Infinity, size = 'mid', embedder: e2, retrieval = {}, faults, cfg, story, label = 'design', onTurn } = {}) {
        const e = newEngine({ faults: faults || new Set(), cfg, story });
        const staticMsgs = staticPrefix();
        const staticText = staticMsgs.map(m => m.content).join(' ');
        const lines = [];
        const N = Math.min(turns, e.story.turns.length);
        for (let n = 1; n <= N; n++) {
            const t = e.story.turns[n - 1];
            const req = await assemble(e, t.player, { size, embedder: e2, retrieval, static: staticMsgs, staticText });
            lines.push({ run: label, mode: label, turn: n, seq: 0, kind: 'reply', messages: req.messages, answer: t.prose, parts: { recallTokens: req.parts.recallTokens, viewTokens: req.parts.view.tokens, hidden: req.parts.hidden, items: req.parts.items.length } });
            playTurn(e, n);
            if (onTurn) onTurn(n, e, req);
        }
        return { engine: e, capture: lines };
    }

    Object.assign(ref, { assemble, runDesign, staticPrefix, opts_static: staticPrefix, MEMORY_INSTRUCTION: inject.MEMORY_INSTRUCTION, REMINDER: inject.RULE_REMINDER });
    return { assemble, runDesign, inject };
}

module.exports = { install, HARNESS: mb4.HARNESS };
