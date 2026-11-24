'use strict';
// MB4: the production search (src/memory/search.js, index.js, embed.js) behind the functions of the MB11 harness's
// reference model (memory/evidence/m1g/harness/mb11/ref/retrieval.js). MB11's README says the code of an MB ticket replaces
// the matching ref/ module behind the same function names, and the same scenario rows then run against it. `install()`
// patches the reference module's exports in place; call it before the scenarios are required.
//
//   const adapter = require('./mb4_adapter.cjs');
//   await adapter.install({ embedder });          // embedder: an embedder of src/memory/embed.js
//   const { retrieval } = require('<harness>/scen_retrieval.js');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const HARNESS = path.join(ROOT, 'docs', 'ux-overhaul', 'memory', 'evidence', 'm1g', 'harness', 'mb11');
const url = rel => pathToFileURL(path.join(ROOT, rel)).href;

const original = require(path.join(HARNESS, 'ref', 'retrieval.js'));
const { norm } = require(path.join(HARNESS, 'ref', 'util.js'));

let M = null, state = null;

async function modules() {
    if (!M) M = { search: await import(url('src/memory/search.js')), index: await import(url('src/memory/index.js')), device: await import(url('src/memory/device-db.js')), embed: await import(url('src/memory/embed.js')) };
    return M;
}

/** The plain sources of the production index, read from a harness engine. */
function sourcesOf(engine) {
    const fold = engine.store.fold();
    const replies = engine.replies();
    const ordinal = new Map(replies.map((m, i) => [m.mark, i + 1]));
    const records = [], recordMarks = new Map();
    for (const r of fold.current) {
        if (['chapter', 'condensed', 'scene'].includes(r.kind)) continue;
        const mark = r.versions?.at(-1)?.mark || null;
        records.push({ ...r, srcTurn: ordinal.get(mark) ?? 0, importance: r.importance || 5 });
        if (mark) (recordMarks.get(mark) || recordMarks.set(mark, []).get(mark)).push(r.id);
    }
    const chapters = [], exchanges = [];
    for (const ch of engine.chapters()) {
        chapters.push({ id: ch.id, order: ch.order, title: '', text: ch.text, srcTurn: ordinal.get(ch.to) ?? 0 });
        const msgs = ch.marks.map(mk => engine.chat.find(mk));
        for (let i = 0; i < msgs.length; i++) {
            const m = msgs[i];
            if (m.role !== 'assistant') continue;
            const sc = engine.sceneAt(m.mark);
            exchanges.push({
                id: m.mark, header: `Chapter ${ch.order} | ${sc.where || ''} | ${sc.date || ''} | ${sc.present || ''}`,
                user: msgs[i - 1]?.role === 'user' ? engine.chat.text(msgs[i - 1]) : '', reply: engine.chat.text(m),
                srcTurn: ordinal.get(m.mark) ?? 0, records: recordMarks.get(m.mark) || [],
            });
        }
    }
    const entries = Object.entries(engine.lore.entries).filter(([, e]) => !e.constant).map(([uid, e]) => ({ book: 'lore', uid, title: e.comment, content: e.content }));
    const groups = [...engine.aliases].map(([k, list]) => [k, ...list]);
    return { records, chapters, exchanges, entries, groups, turn: replies.length };
}

const sceneOf = engine => {
    const sc = engine.sceneAt(engine.chat.messages.at(-1)?.mark) || {};
    return { place: sc.where || '', time: sc.date || sc.time || '', present: String(sc.present || '').split(',').map(x => x.trim()).filter(Boolean) };
};

const perEngine = new WeakMap();
async function indexFor(engine, embedder) {
    const { index, device } = await modules();
    let entry = perEngine.get(engine);
    if (!entry) {
        const booster = process.env.MB4_BOOSTER ? (await modules()).embed.ollamaBooster({ base: process.env.MB4_BOOSTER, limitMs: Number(process.env.MB4_BOOSTER_MS || 400) }) : null;
        entry = { index: index.createSearchIndex({ embedder, booster, db: device.memoryItems(), now: () => Date.now() }) };
        perEngine.set(engine, entry);
    }
    return entry.index;
}

/** retrieve(engine, question, opts) as ref/retrieval.js has it: { items, query, candidates }. */
async function retrieve(engine, question, opts = {}) {
    const { search } = await modules();
    const embedder = state.embedder;
    const idx = await indexFor(engine, embedder);
    const sources = sourcesOf(engine);
    await idx.sync(sources, { embed: opts.mode === 'bm25' ? 'none' : 'wait' });
    if (process.env.MB4_BOOSTER && opts.mode === 'fused') await idx.fillBooster();
    const mode = opts.mode || 'fused';
    const scene = sceneOf(engine);
    const hay = [question, ...engine.chat.messages.slice(-4).map(m => engine.chat.text(m))].join('\n');
    const fired = [];
    for (const [uid, e] of Object.entries(engine.lore.entries)) {
        if (!e.constant && !e.disable && original.loreKeyHit(e, hay)) fired.push({ book: 'lore', uid, title: e.comment, content: e.content });
    }
    const pov = opts.pov || 'Hale';
    const hiddenQuotes = [];
    if (opts.holderRule !== false) {
        const hidden = new Set(fold(engine).current.filter(r => r.kind === 'secret' && !search.holderAllows(r.holders, pov)).map(r => r.id));
        for (const e of engine.chat.meta.entries) if (e.record && hidden.has(e.record.id) && fold(engine).applied.includes(e.id)) for (const q of e.evidence || []) if (q.quote) hiddenQuotes.push(q.quote);
    }
    const common = {
        message: question, scene, turn: sources.turn + 1, pov, pinned: new Set(opts.pinned || []),
        staticTexts: opts.staticText ? [opts.staticText] : [], hiddenQuotes, fired,
        options: { itemCap: opts.cap, loreShare: opts.loreShare, tokenCap: opts.tokenCap, candidates: opts.candidates ?? (process.env.MB4_CANDIDATES ? Number(process.env.MB4_CANDIDATES) : undefined), decay: opts.decay, holderRule: opts.holderRule },
    };
    for (const k of Object.keys(common.options)) if (common.options[k] === undefined) delete common.options[k];
    let result;
    if (process.env.MB4_REFBM25 && mode === 'fused') {
        const bm = new original.BM25([...idx.units.values()].map(u => ({ id: u.id, text: u.text })));
        const word = { search: (q, n) => bm.search(q).slice(0, n).map(h => ({ id: h.id, score: h.score })) };
        const query = search.expandQuery({ message: question, scene, groups: [...search.aliasGroups(sources.records), ...sources.groups] });
        const queryVec = (await embedder.embed([query]))[0];
        result = search.searchTurn({ units: [...idx.units.values()], records: idx.records, word, query, queryVec, vectors: idx.vectors, boosted: null, count: t => embedder.count(t), ...common }, common.options);
        result.query = query;
    } else if (mode === 'fused') {
        result = await idx.search(common);
    } else {
        // the ablations of M1c question 10: one list alone, through the same scoring and filters
        const query = search.expandQuery({ message: question, scene, groups: [...search.aliasGroups(sources.records), ...sources.groups] });
        const queryVec = mode === 'bm25' ? null : (await embedder.embed([query]))[0];
        result = search.searchTurn({
            units: [...idx.units.values()], records: idx.records, word: mode === 'embed' ? null : idx.word, query, queryVec, vectors: idx.vectors, boosted: null, count: t => embedder.count(t), ...common,
        }, common.options);
        result.query = query;
    }
    const items = result.items.map(it => {
        if (it.type === 'record') return { key: it.key, type: 'record', rec: it.rec, srcIdx: it.srcTurn, importance: it.importance, rel: it.rel, score: it.score, pool: !!it.pool, rendered: it.rendered };
        if (it.type === 'lore') return { key: it.key, type: 'lore', lore: engine.lore.entries[it.uid], srcIdx: 0, rel: it.rel, score: it.score, fired: !!it.fired, rendered: it.rendered };
        return { key: it.key, type: 'excerpt', text: it.text, mark: it.mark, srcIdx: it.srcTurn, rel: it.rel, score: it.score, rendered: it.rendered };
    });
    return { items, query: result.query, candidates: result.candidates, time: result.time, dropped: result.dropped, ranked: result.ranked, pool: result.pool, mode: result.mode };
}
const fold = engine => engine.store.fold();

/** buildUnits(engine) as ref/retrieval.js has it, for the 256-token row: the production units. */
function buildUnits(engine) {
    const { search } = M;
    return search.buildUnits({ ...sourcesOf(engine), count: t => state.embedder.count(t) });
}

async function install({ embedder }) {
    await modules();
    state = { embedder };
    Object.assign(original, { retrieve, buildUnits });
    return { sourcesOf, indexFor, retrieve };
}

module.exports = { install, sourcesOf, sceneOf, original, HARNESS, modules };
void norm;
