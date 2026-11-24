// The search index of one chat (memory DESIGN 4.1 and 4.2): units from the fold, their word index and their vectors.
// Vectors live in the device database under the id of the model that made them, keyed by a hash of the embedded text, so
// a branch reuses its parent's vectors, a changed record embeds once, and switching the model drops the old model's
// vectors and builds new ones. The desktop booster keeps a second set of vectors under its own model id; its list joins
// the others by rank and its scores are never compared with the search model's.
import { deviceDb } from './device-db.js';
import { OUT_OF_FORCE, canonical, hashText, proseOf, storedMark } from './fold.js';
import { SEARCH, aliasGroups, buildUnits, cosine, createWordIndex, expandQuery, searchTurn } from './search.js';

const isUser = message => !!message?.is_user;
const isHiddenReply = message => message?.is_system === true && !message.extra?.type && message.role !== 'tool' && !(message.extra && 'tool_invocations' in message.extra);
/** A reply of the story: a message you did not write, whether or not it is hidden from the model now. */
export const isStoryReply = message => !!message && !isUser(message) && (!message.is_system || isHiddenReply(message));

/** The text a vector is made from is hashed twice, so two units do not share a key by chance. */
const textKey = text => `${hashText(text)}${hashText(`~${String(text).length}~${text}`)}`;

// ---------------------------------------------------------------- the plain sources of one turn

/**
 * The inputs of buildUnits for a chat as it stands: current records with their source reply number, the closed chapters,
 * the exchanges those chapters cover, and the entries of the books Recall manages.
 *   result  the fold of the chat
 *   books   [{ name, entries: [{ uid, comment, content, key, constant, disable }] }] for the managed books only
 */
export function sourcesFromChat({ chat = [], result, books = [] } = {}) {
    const ordinals = new Map();
    let n = 0;
    chat.forEach((message, i) => { if (i > 0 && isStoryReply(message)) ordinals.set(i, ++n); });
    const turnAt = index => { let at = Math.min(index ?? 0, chat.length - 1); while (at > 0 && !ordinals.has(at)) at--; return ordinals.get(at) || 0; };
    const markIndex = new Map();
    chat.forEach((message, i) => { const mark = storedMark(message); if (mark && !markIndex.has(mark)) markIndex.set(mark, i); });

    const current = (result?.current || []).filter(r => !OUT_OF_FORCE.includes(r.status));
    const records = [], chapterRecords = [];
    for (const r of current) {
        const at = r.versions?.at(-1)?.index;
        const srcTurn = turnAt(Number.isFinite(at) ? at : 0);
        if (r.kind === 'chapter') chapterRecords.push({ r, srcTurn, at: Number.isFinite(at) ? at : 0 });
        else if (!['condensed', 'arc'].includes(r.kind)) records.push({ ...r, srcTurn });
    }
    chapterRecords.sort((a, b) => a.at - b.at);
    const recordsByMark = new Map();
    for (const r of records) { const mark = r.versions?.at(-1)?.anchor?.mark; if (mark) (recordsByMark.get(mark) || recordsByMark.set(mark, []).get(mark)).push(r.id); }

    const chapters = [], exchanges = [];
    chapterRecords.forEach(({ r, srcTurn }, k) => {
        const order = k + 1;
        chapters.push({ id: r.id, order, title: r.subject || '', text: r.text || '', srcTurn });
        const header = `Chapter ${order}${r.subject ? `: ${r.subject}` : ''}${r.story_time ? ` | ${r.story_time}` : ''}${r.people?.length ? ` | ${r.people.join(', ')}` : ''}`;
        const covered = (r.covers || []).map(src => markIndex.get(src.mark)).filter(i => i !== undefined).sort((a, b) => a - b);
        for (const i of covered) {
            const message = chat[i];
            if (!isStoryReply(message)) continue;
            const before = chat[i - 1];
            const mark = storedMark(message);
            exchanges.push({ id: mark || `i${i}`, header, user: isUser(before) ? proseOf(before) : '', reply: proseOf(message), srcTurn: ordinals.get(i) || 0, records: recordsByMark.get(mark) || [] });
        }
    });

    const entries = [];
    for (const book of books) for (const e of book.entries || []) {
        if (!e || e.constant || e.disable) continue;
        const content = String(e.content ?? '').trim();
        if (content) entries.push({ book: book.name, uid: e.uid, title: e.comment || (Array.isArray(e.key) ? e.key[0] : '') || `Entry ${e.uid}`, content });
    }
    return { records, chapters, exchanges, entries, turn: n };
}

/** The quotes a viewpoint character must not be sent: the evidence quotes and the text of every secret they do not hold. */
export function hiddenQuotesFor({ chat = [], meta, result, pov, povAliases = [], allows }) {
    const hidden = new Set((result?.current || []).filter(r => r.kind === 'secret' && !allows(r.holders, pov, povAliases)).map(r => r.id));
    if (!hidden.size) return [];
    const quotes = [];
    const note = entry => { if (entry?.record && hidden.has(entry.record.id)) for (const q of entry.evidence || []) if (q?.quote) quotes.push(q.quote); };
    for (const message of chat) for (const entry of message?.extra?.ri_memory?.entries || []) note(entry);
    for (const entry of meta?.ri_memory?.log || []) note(entry);
    for (const r of result.current) if (hidden.has(r.id) && r.text) quotes.push(r.text);
    return quotes;
}

// ---------------------------------------------------------------- the index

/**
 * createSearchIndex({ embedder, booster, db }) -> { sync, search, ... }.
 * `sync(sources)` makes the units, the word index and (when the model is ready) the vectors current.
 */
export function createSearchIndex({ embedder, booster = null, db = deviceDb(), now = () => performance.now() } = {}) {
    const units = new Map();
    const vectors = new Map();
    const boosterVectors = new Map();
    const word = createWordIndex();
    const split = new Map();
    let recordMap = new Map(), groups = [], embedding = Promise.resolve(), boosting = Promise.resolve();
    const stats = { built: 0, reused: 0, reindexed: false, modelId: '', counterId: '' };

    const vecKey = (model, unit) => `vec:${model}:${textKey(unit.text)}`;

    async function checkModel() {
        const marker = await db.get('search:model');
        const id = embedder?.id || '';
        if (marker?.model === id) return;
        // another model made the stored vectors: they are dropped and every unit embeds again
        for (const key of await db.keys('vec:')) if (!key.startsWith(`vec:${id}:`)) await db.remove(key);
        await db.put('search:model', { model: id });
        stats.reindexed = !!marker;
        vectors.clear();
    }

    /** Units for one source item, cut with the counter in force and remembered while the item and the counter stay the same. */
    function unitsFor(category, item) {
        const key = `${category}:${item.id ?? `${item.book}:${item.uid}`}:${hashText(canonical(item))}:${embedder?.counterId || 'approx'}`;
        let hit = split.get(key);
        if (!hit) {
            hit = buildUnits({ [category]: [item], count: text => embedder.count(text) });
            split.set(key, hit);
        }
        return hit;
    }

    async function embedMissing(want) {
        if (!embedder?.isReady?.()) return 0;
        const missing = [];
        for (const unit of want) {
            if (vectors.has(unit.id)) continue;
            const stored = await db.get(vecKey(embedder.id, unit));
            if (stored) { vectors.set(unit.id, stored instanceof Float32Array ? stored : Float32Array.from(stored)); stats.reused += 1; }
            else missing.push(unit);
        }
        for (let i = 0; i < missing.length; i += 16) {
            const batch = missing.slice(i, i + 16);
            const out = await embedder.embed(batch.map(u => u.text));
            for (let k = 0; k < batch.length; k++) {
                if (!units.has(batch[k].id)) continue;
                vectors.set(batch[k].id, out[k]);
                await db.put(vecKey(embedder.id, batch[k]), out[k]);
                stats.built += 1;
            }
        }
        return missing.length;
    }

    const api = {
        units, vectors, boosterVectors, word, stats,
        get records() { return recordMap; },

        /**
         * Bring the index in line with the chat. `embed`: 'wait' embeds what is missing before returning, 'background'
         * returns at once and embeds behind it (await `idle()` to see the end), 'none' leaves vectors alone.
         */
        async sync(sources, { embed = 'wait' } = {}) {
            if (embedder?.isReady?.()) await checkModel();
            stats.modelId = embedder?.id || ''; stats.counterId = embedder?.counterId || 'approx';
            recordMap = new Map(sources.records.map(r => [r.id, r]));
            groups = [...aliasGroups(sources.records), ...(sources.groups || [])];
            const next = new Map();
            for (const [category, list] of [['records', sources.records], ['chapters', sources.chapters], ['exchanges', sources.exchanges], ['entries', sources.entries]]) {
                for (const item of list || []) for (const unit of unitsFor(category, item)) next.set(unit.id, unit);
            }
            for (const id of [...units.keys()]) if (!next.has(id) || next.get(id).text !== units.get(id).text || next.get(id).extra !== units.get(id).extra) { units.delete(id); vectors.delete(id); boosterVectors.delete(id); word.remove(id); }
            for (const [id, unit] of next) {
                units.set(id, unit);
                word.add(unit);
            }
            if (split.size > 4 * (next.size + 50)) { const live = new Set(); for (const category of ['records', 'chapters', 'exchanges', 'entries']) for (const item of sources[category] || []) live.add(`${category}:${item.id ?? `${item.book}:${item.uid}`}:${hashText(canonical(item))}:${stats.counterId}`); for (const key of split.keys()) if (!live.has(key)) split.delete(key); }
            const want = [...units.values()];
            if (embed === 'none') return api;
            const run = () => embedMissing(want).catch(error => { stats.error = String(error?.message || error); });
            if (embed === 'wait') { embedding = embedding.then(run); await embedding; } else embedding = embedding.then(run);
            return api;
        },
        idle: () => Promise.all([embedding, boosting]).then(() => undefined),
        /** Units that still lack a vector from the search model. */
        pending: () => [...units.values()].filter(u => !vectors.has(u.id)).length,

        /** Fill the desktop booster's vectors for every unit that has none, in the background. Returns how many it added. */
        async fillBooster() {
            if (!booster?.available?.()) return 0;
            const missing = [];
            for (const unit of units.values()) {
                if (boosterVectors.has(unit.id)) continue;
                const stored = await db.get(`bvec:${booster.id}:${textKey(unit.text)}`);
                if (stored) boosterVectors.set(unit.id, stored); else missing.push(unit);
            }
            let added = 0;
            for (let i = 0; i < missing.length; i += 16) {
                const batch = missing.slice(i, i + 16);
                const rows = await booster.passages(batch.map(u => u.text));
                if (!rows) break;
                for (let k = 0; k < batch.length; k++) { boosterVectors.set(batch[k].id, rows[k]); await db.put(`bvec:${booster.id}:${textKey(batch[k].text)}`, rows[k]); added++; }
            }
            return added;
        },
        fillBoosterInBackground() { boosting = boosting.then(() => api.fillBooster()).catch(() => 0); return boosting; },

        /**
         * One turn's search. `message` is your new message; `scene` { place, time, present }. Returns the admitted items, with
         * the timings of each step in milliseconds.
         */
        async search({ message = '', scene = null, turn = 0, pov = '', povAliases = [], pinned = new Set(), staticTexts = [], hiddenQuotes = [], fired = [], options = {} } = {}) {
            const t0 = now();
            const query = expandQuery({ message, scene, groups });
            const time = { expand: now() - t0 };
            let queryVec = null, boosted = null;
            const tasks = [];
            if (embedder?.isReady?.() && vectors.size) {
                const t1 = now();
                tasks.push(embedder.embed([query]).then(([v]) => { queryVec = v; time.embed = now() - t1; }).catch(error => { stats.error = String(error?.message || error); }));
            } else if (embedder && !embedder.isReady?.()) embedder.load?.().catch?.(() => {});
            if (booster?.available?.() && boosterVectors.size) {
                const t1 = now();
                tasks.push(booster.query(query).then(v => {
                    time.booster = now() - t1;
                    if (!v) return;
                    boosted = [...boosterVectors].map(([id, vec]) => [id, cosine(v, vec)]).sort((a, b) => b[1] - a[1]).slice(0, options.pool || SEARCH.pool).map(([id]) => id);
                }));
            }
            await Promise.all(tasks);
            const t2 = now();
            const input = {
                units: [...units.values()], records: recordMap, word, query, queryVec, vectors, boosted, turn, pov, povAliases, pinned, scene,
                staticTexts, hiddenQuotes, fired, count: text => embedder?.count?.(text) ?? 0,
            };
            const result = searchTurn(input, options);
            time.score = now() - t2;
            time.total = now() - t0;
            // `again` repeats the merge, score and admit steps with other inputs and no new embedding, for entries the host's scan fires later
            return { ...result, query, queryVec: !!queryVec, time, again: patch => ({ ...searchTurn({ ...input, ...patch }, options), query, time }) };
        },
    };
    return api;
}
