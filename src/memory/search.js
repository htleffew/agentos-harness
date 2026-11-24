// Retrieval, the part that is pure code (memory DESIGN 4): what is searchable, the word index, rank fusion, the
// three-part score, the filters and admission. It reads plain inputs and holds no host state, so a test runs it on any
// chat and the harness of MB11 can replace its reference model with it. The model, the vectors and the host events live
// in embed.js, index.js and recall.js.
//
// A unit is one searchable piece of text with a stable id. Four types: `record` (a record of the current-state set),
// `exchange` (a cut of a closed chapter's exchanges, header line first), `chapter` (a chapter record's summary, cut the
// same way) and `lore` (an entry of a book that Recall manages). Every unit, header included, is cut to fit the tokens
// the search model reads.
// The word index and the stemmer ship in vendor/. If that folder is missing from an install, the extension still loads: word
// search finds nothing and the search runs on meaning alone (or on nothing, when the model is missing too).
let MiniSearch = null;
let stemmer = word => word;
try {
    ({ default: MiniSearch } = await import('../../vendor/minisearch/index.js'));
    ({ stemmer } = await import('../../vendor/stemmer/index.js'));
} catch (error) { console.warn('[Roleplay Instructions] the word search library did not load', error); }

// ---------------------------------------------------------------- starting values and named thresholds (4.3)

/**
 * The starting values MB11 measured (memory/evidence/MB11/results.md section 4): item cap 6, lore share 400 tokens, cut 0.4.
 * meaningShare (MB5) is the room for book entries meaning search found with no keyword, apart from the fired entries' share:
 * at 200 the section 13 Injection row holds at most 1,000 lost cache tokens a turn (873) and the Retrieval row keeps 92.5;
 * with no share of their own, entries filled the item cap and lore-only turns sent blocks of 975 tokens.
 */
export const SEARCH = Object.freeze({
    itemCap: 6, loreShare: 400, meaningShare: 200, tokenCap: 2000, candidates: 30, pool: 60, rrfK: 60, decay: 0.99, unitTokens: 256,
});

/** Block caps by chat model size (5.3). */
export const RECALL_TOKEN_CAP = Object.freeze({ small: 1000, mid: 2000, frontier: 4000 });

/** What each comparison measures. A threshold carries its measure in its name and in its record. */
export const MEASURES = Object.freeze({ cosine: 'embedding cosine', dice: 'character-bigram Dice' });
const MEASURE_WORD = Object.freeze({ cosine: 'Cosine', dice: 'Dice' });

// loreCosineCut is the cut for an entry of a managed book that meaning search found with no keyword of its own. Book entries
// are written as reference text, so a player's line about them sits further from them than from a story record: the 12
// reworded Hale questions reach their entries at cosines of 0.20 to 0.61. MB5 swept it from 0.40 down to 0.15 and took the
// lowest step where more than half the entries sent are the ones asked about (M1c rule 6): within the meaning share, 0.35
// sends 8 of the 12 with 3 other entries, 0.40 sends 5, and 0.30 sends the same 8 with 8 others (memory/evidence/MB5/lore-cut-sweep.json).
export const THRESHOLD_SPEC = Object.freeze({
    cosineCut: Object.freeze({ measure: 'cosine', value: 0.4 }),
    loreCosineCut: Object.freeze({ measure: 'cosine', value: 0.35 }),
    diceNearDuplicate: Object.freeze({ measure: 'dice', value: 0.85 }),
});

/**
 * The thresholds of one run. `get(name, measure)` is the only way a comparison reads one, and the call names the measure
 * the comparison is about to make: a setting of another measure throws, and every read is logged for the self-test.
 */
export function createThresholds(spec = THRESHOLD_SPEC) {
    const usages = [];
    return {
        spec,
        usages,
        get(name, measure) {
            const found = spec[name];
            if (!found) throw new Error(`no threshold named ${name}`);
            usages.push({ name, measure });
            if (found.measure !== measure) throw new Error(`threshold ${name} is a ${found.measure} setting and was used in a ${measure} comparison`);
            return found.value;
        },
    };
}

// ---------------------------------------------------------------- small measures

export function cosine(a, b) {
    if (!a || !b) return 0;
    const n = Math.min(a.length, b.length);
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const normText = text => String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const bigrams = text => { const t = normText(text).replace(/ /g, '_'); const out = new Map(); for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); out.set(g, (out.get(g) || 0) + 1); } return out; };
/** Dice coefficient over character bigrams, 0 to 1 (the diceNearDuplicate measure). */
export function dice(a, b) {
    const x = bigrams(a), y = bigrams(b);
    let hit = 0, nx = 0, ny = 0;
    for (const v of x.values()) nx += v;
    for (const v of y.values()) ny += v;
    if (!nx || !ny) return 0;
    for (const [g, v] of x) hit += Math.min(v, y.get(g) || 0);
    return (2 * hit) / (nx + ny);
}

/** A token count for a build with no model loaded: words and marks with a margin. Real counts come from the model's tokenizer. */
export const approxTokens = text => Math.ceil(((String(text ?? '').match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) || []).length) * 1.25) + 2;

// ---------------------------------------------------------------- the holder rule (4.2 step 8)

const holds = (holders, names) => {
    const want = new Set(names.map(normText).filter(Boolean));
    return holders.some(holder => want.has(normText(holder)));
};
/**
 * True when the character the reply is written from knows a secret. `holders` empty or missing counts as known to all.
 * `pov` is the viewpoint character and `povAliases` the other names the story uses for them.
 */
export function holderAllows(holders, pov, povAliases = []) {
    if (!Array.isArray(holders) || !holders.length) return true;
    return holds(holders, [pov, ...povAliases]);
}
/** A carry-over book states a secret's holders in a fixed last line ("Known to: Hale, Brannic."); the holder rule reads it (8.3). */
export function loreHolderOk(text, pov, povAliases = []) {
    const m = String(text ?? '').match(/Known to: ([^.\n]*)\.?\s*$/i);
    return !m || holderAllows(m[1].split(',').map(x => x.trim()).filter(Boolean), pov, povAliases);
}
/** The secret lines of a chapter record that the viewpoint character may be sent: a line with no holders goes to every reader. */
export function chapterSecretLines(chapter, pov, povAliases = []) {
    const lines = Array.isArray(chapter?.secrets) ? chapter.secrets : [];
    return lines.filter(line => holderAllows(line?.holders, pov, povAliases));
}

// ---------------------------------------------------------------- queries

/** Alias groups from the records: each subject with the names the story uses for it. */
export function aliasGroups(records) {
    const groups = [];
    for (const record of records || []) {
        const names = [record.subject, ...(record.aliases || [])].map(x => String(x || '').trim()).filter(Boolean);
        if (names.length > 1) groups.push([...new Set(names)]);
    }
    return groups;
}
const wordIn = (text, name) => {
    const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(text);
};
/**
 * The query of one turn (4.2 step 1): the new message plus the scene line, with each name the message uses followed by
 * the other names of the same subject.
 */
export function expandQuery({ message = '', scene = null, groups = [] } = {}) {
    const sceneLine = scene ? [scene.place, scene.time, ...(scene.present || [])].filter(Boolean).join(' ') : '';
    let query = `${message}${sceneLine ? ` ${sceneLine}` : ''}`.trim();
    const seen = new Set();
    for (const group of groups) {
        if (!group.some(name => wordIn(message, name))) continue;
        for (const name of group) if (!seen.has(name.toLowerCase()) && !wordIn(query, name)) { seen.add(name.toLowerCase()); query += ` ${name}`; }
    }
    return query;
}

// ---------------------------------------------------------------- units

const SENTENCE = /(?<=[.!?"”])\s+/u;
/**
 * Cut `body` into pieces, each prefixed by `header` and no longer than `max` tokens by `count`. Breaks at sentences; one
 * sentence that is too long is cut at words. Returns the full texts, header first.
 */
export function cutToUnits(header, body, count, max = SEARCH.unitTokens, sep = '\n') {
    const head = String(header ?? '').trim();
    const join = parts => (head ? `${head}${sep}` : '') + parts.join(' ');
    const out = [];
    let cur = [];
    const flush = () => { if (cur.length) { out.push(join(cur)); cur = []; } };
    const sentences = String(body ?? '').split(SENTENCE).map(s => s.trim()).filter(Boolean);
    for (const sentence of sentences) {
        if (count(join([...cur, sentence])) <= max) { cur.push(sentence); continue; }
        flush();
        if (count(join([sentence])) <= max) { cur.push(sentence); continue; }
        // a sentence longer than a unit: cut it at words
        let words = [];
        for (const word of sentence.split(/\s+/)) {
            if (count(join([[...words, word].join(' ')])) > max && words.length) { out.push(join([words.join(' ')])); words = []; }
            words.push(word);
        }
        if (words.length) cur.push(words.join(' '));
    }
    flush();
    return out;
}

// Range records reach the request through the chapter view; the current scene is a tracker value with its own line.
const RANGE = new Set(['chapter', 'condensed', 'arc', 'scene']);
/**
 * Every searchable unit for the chat as it stands.
 *   records   current records, range records left out: { id, kind, subject, attribute, text, aliases, holders, importance, srcTurn }
 *   chapters  closed chapters: { id, order, title, text, srcTurn }
 *   exchanges exchanges of closed chapters: { id, header, user, reply, srcTurn, records: [ids] }
 *   entries   entries of books Recall manages, constant ones left out: { book, uid, title, content }
 *   count     token count by the search model's tokenizer
 */
export function buildUnits({ records = [], chapters = [], exchanges = [], entries = [], count = approxTokens, max = SEARCH.unitTokens } = {}) {
    const units = [];
    for (const r of records) {
        if (!r || RANGE.has(r.kind)) continue;
        const subject = String(r.subject || r.view?.name || r.kind || '').trim();
        const text = cutToUnits('', `${subject}: ${r.text || ''}`, count, max)[0] || `${subject}`;
        units.push({ id: `rec:${r.id}`, type: 'record', recordId: r.id, text, extra: (r.aliases || []).join(' '), srcTurn: r.srcTurn ?? 0, importance: r.importance ?? 5 });
    }
    for (const chapter of chapters) {
        cutToUnits(`Chapter ${chapter.order}${chapter.title ? `: ${chapter.title}` : ''}`, chapter.text, count, max)
            .forEach((text, i) => units.push({ id: `chap:${chapter.id}:${i}`, type: 'chapter', chapterId: chapter.id, text, srcTurn: chapter.srcTurn ?? 0, importance: 7 }));
    }
    for (const ex of exchanges) {
        const body = `${ex.user ? `You: ${ex.user}\n` : ''}${ex.reply || ''}`;
        cutToUnits(ex.header, body, count, max)
            .forEach((text, i) => units.push({ id: `ex:${ex.id}:${i}`, type: 'exchange', mark: ex.id, text, body: text.slice(text.indexOf('\n') + 1), srcTurn: ex.srcTurn ?? 0, importance: 5, records: ex.records || [] }));
    }
    for (const e of entries) {
        const title = e.title || `Entry ${e.uid}`;
        cutToUnits(`${title}:`, e.content, count, max, ' ')
            .forEach((text, i) => units.push({ id: `lore:${e.book}:${e.uid}:${i}`, type: 'lore', book: e.book, uid: String(e.uid), title, text, body: text.slice(title.length + 1).trim(), srcTurn: 0, importance: 5 }));
    }
    return units;
}

// ---------------------------------------------------------------- the word index (MiniSearch, BM25)

const STOP = new Set('the a an and or of to in on at is are was were be been do does did how what when where who which i we you he she it my me our that this with for from about before after again still now than then there their his her its them they by as so not no but if into out up down over under too very can will would could should has have had said says say'.split(' '));
const processTerm = term => { const t = term.toLowerCase(); return t.length < 3 || STOP.has(t) ? null : stemmer(t); };
/** The terms of a query, each once: a name repeated in the message and the scene line counts as one term. */
const queryTerms = text => {
    const seen = new Map();
    for (const word of String(text || '').match(/[\p{L}\p{N}]+/gu) || []) { const stem = processTerm(word); if (stem && !seen.has(stem)) seen.set(stem, word); }
    return [...seen.values()];
};

/** A word index over units. Each unit is a document of its text and, for a record, its aliases. */
export function createWordIndex() {
    if (!MiniSearch) return { has: () => false, add() {}, remove() {}, size: () => 0, search: () => [], vacuum() {} };
    const mini = new MiniSearch({
        fields: ['text'], idField: 'id', processTerm,
        searchOptions: { combineWith: 'OR', prefix: false, fuzzy: false, bm25: { k: 1.2, b: 0.75, d: 0 } },
    });
    const have = new Map();
    return {
        has: id => have.has(id),
        add(unit) { if (have.has(unit.id)) return; have.set(unit.id, true); mini.add({ id: unit.id, text: unit.extra ? `${unit.text} ${unit.extra}` : unit.text }); },
        remove(id) { if (!have.has(id)) return; have.delete(id); mini.discard(id); },
        size: () => have.size,
        /** Ranked ids with their scores. */
        search(query, limit = SEARCH.pool) {
            const terms = queryTerms(query);
            return terms.length ? mini.search({ combineWith: 'OR', queries: terms }).slice(0, limit).map(hit => ({ id: hit.id, score: hit.score })) : [];
        },
        vacuum: () => mini.vacuum?.(),
    };
}

// ---------------------------------------------------------------- fusion

/** Reciprocal rank fusion: lists of ids in rank order merge by rank alone. */
export function rrf(lists, k = SEARCH.rrfK) {
    const score = new Map();
    for (const list of lists) (list || []).forEach((id, rank) => score.set(id, (score.get(id) || 0) + 1 / (k + rank + 1)));
    return [...score].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

// ---------------------------------------------------------------- rendering (5.1)

const esc = text => String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = text => esc(text).replace(/"/g, '&quot;');
const TAGS = { secret: 'secret', thread: 'thread', person: 'person' };

/** One item of the recall block, in fixed XML with attributes and plain sentences inside. */
export function renderItem(item) {
    if (item.type === 'lore') return `<lore title="${attr(item.title || '')}">${esc(item.text)}</lore>`;
    if (item.type === 'excerpt') return `<excerpt from="reply ${item.srcTurn ?? ''}">${esc(item.text)}</excerpt>`;
    const r = item.rec;
    const tag = TAGS[r.kind] || 'fact';
    const attrs = [
        `subject="${attr(r.subject || '')}"`,
        r.attribute ? `attribute="${attr(r.attribute)}"` : '',
        r.story_time ? `when="${attr(r.story_time)}"` : '',
        item.srcTurn ? `from="reply ${item.srcTurn}"` : '',
        r.holders?.length ? `known_by="${attr(r.holders.join(', '))}"` : '',
    ].filter(Boolean).join(' ');
    const body = r.status === 'done' && r.outcome ? `${r.text} Outcome: ${r.outcome}` : r.text;
    return `<${tag} ${attrs}>${esc(body)}</${tag}>`;
}

/** The recall block: the scene line when asked for, then the items in story order. An empty result is an empty string. */
export function renderBlock(items, { scene = null, sceneLine = true } = {}) {
    const lines = [];
    if (sceneLine && scene) {
        const text = [scene.place, scene.time, scene.present?.length ? `present: ${scene.present.join(', ')}` : ''].filter(Boolean).join(' | ');
        if (text) lines.push(`<scene>${esc(text)}</scene>`);
    }
    for (const item of items || []) lines.push(item.rendered || renderItem(item));
    return lines.length ? `<recall>\n${lines.join('\n')}\n</recall>` : '';
}

// ---------------------------------------------------------------- one turn (4.2 steps 5 to 9)

/**
 * Run the merge, score, filter and admit steps for one query.
 *
 * input:
 *   units, records (id -> record), word (a word index), query, queryVec, vectors (unit id -> vector), boosted (ranked
 *   unit ids from the desktop booster or null), turn (reply ordinal now), pov, povAliases, pinned (record ids),
 *   scene { present: [] }, staticTexts (constant entries already in the prefix), hiddenQuotes (quotes of secrets the
 *   viewpoint character does not know), fired (entries SillyTavern's own scan fired in a managed book), count (tokens).
 * options: itemCap, loreShare, tokenCap, candidates, pool, decay, thresholds, pools { threads, stateKinds }.
 */
export function searchTurn(input, options = {}) {
    const o = { ...SEARCH, thresholds: createThresholds(), ...options };
    const {
        units = [], records = new Map(), word, query = '', queryVec = null, vectors = new Map(), boosted = null, turn = 0,
        pov = '', povAliases = [], pinned = new Set(), scene = null, staticTexts = [], hiddenQuotes = [], fired = [], count = approxTokens,
    } = input;
    const byId = new Map(units.map(u => [u.id, u]));
    const cut = o.thresholds.get('cosineCut', 'cosine');
    const loreCut = o.thresholds.get('loreCosineCut', 'cosine');

    // 2. word search and 3. meaning search, 4. the booster list
    const wordList = word ? word.search(query, o.pool) : [];
    const wordScore = new Map(wordList.map(h => [h.id, h.score]));
    const wordMax = wordList[0]?.score || 1;
    const cos = new Map();
    let vecList = [];
    if (queryVec) {
        for (const u of units) { const v = vectors.get(u.id); if (v) cos.set(u.id, cosine(queryVec, v)); }
        vecList = [...cos].sort((a, b) => b[1] - a[1]).slice(0, o.pool).map(([id]) => id);
    }
    const mode = queryVec ? (boosted?.length ? 'fused+booster' : 'fused') : 'word';

    // 5. merge by rank
    const fusedIds = rrf([wordList.map(h => h.id), vecList, (boosted || []).slice(0, o.pool)], o.rrfK).slice(0, o.candidates);

    // an exchange contributes the records extracted from it; one with no record contributes its two most relevant sentences
    const cand = new Map();
    const rel = id => cos.has(id) ? { value: cos.get(id), measure: 'cosine' } : { value: (wordScore.get(id) || 0) / wordMax, measure: 'bm25' };
    const add = (item, r) => { const prev = cand.get(item.key); if (!prev || prev.rel < r.value) cand.set(item.key, { ...item, rel: r.value, measure: r.measure }); };
    const chapterHits = new Map();
    const queryStems = new Set((String(query).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).map(w => stemmer(w)));
    for (const id of fusedIds) {
        const u = byId.get(id); if (!u) continue;
        const r = rel(id);
        if (u.type === 'record') {
            const rec = records.get(u.recordId); if (!rec) continue;
            add({ key: `rec:${rec.id}`, type: 'record', rec, srcTurn: u.srcTurn, importance: u.importance }, r);
        } else if (u.type === 'lore') {
            add({ key: `lore:${u.book}:${u.uid}`, type: 'lore', book: u.book, uid: u.uid, title: u.title, text: u.body, srcTurn: 0, ageless: true, importance: 5 }, r);
        } else if (u.type === 'exchange') {
            const withRecords = (u.records || []).map(rid => records.get(rid)).filter(Boolean);
            if (withRecords.length) for (const rec of withRecords) add({ key: `rec:${rec.id}`, type: 'record', rec, srcTurn: byId.get(`rec:${rec.id}`)?.srcTurn ?? u.srcTurn, importance: rec.importance ?? 5 }, r);
            else {
                const best = u.body.split(SENTENCE).map(s => ({ s, n: (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(w => queryStems.has(stemmer(w))).length }))
                    .sort((a, b) => b.n - a.n).slice(0, 2).map(x => x.s);
                add({ key: u.id, type: 'excerpt', text: best.join(' '), mark: u.mark, srcTurn: u.srcTurn, importance: 5 }, r);
            }
        } else if (u.type === 'chapter') {
            const prev = chapterHits.get(u.chapterId);
            if (!prev || prev.rel < r.value) chapterHits.set(u.chapterId, { id: u.chapterId, rel: r.value, measure: r.measure });
        }
    }

    // 6. other pools: open threads whose people or place are in the scene, and (card off) the state of the people present
    const present = (scene?.present || []).map(normText).filter(Boolean);
    const place = normText(scene?.place);
    const near = rec => present.some(p => normText(rec.subject) === p || normText(rec.text).includes(p)) || (place && normText(rec.text).includes(place));
    for (const rec of records.values()) {
        const u = byId.get(`rec:${rec.id}`);
        if (!u) continue;
        const thread = rec.kind === 'thread' && rec.status === 'open' && near(rec);
        const state = o.pools?.stateKinds?.includes(rec.kind) && present.includes(normText(rec.subject));
        if (thread || state) { const r = rel(u.id); add({ key: `rec:${rec.id}`, type: 'record', rec, srcTurn: u.srcTurn, importance: u.importance, pool: true }, { value: Math.max(0.3, r.value), measure: r.measure }); }
    }
    // pinned records are always candidates
    for (const id of pinned) { const rec = records.get(id); const u = byId.get(`rec:${id}`); if (rec && u) add({ key: `rec:${rec.id}`, type: 'record', rec, srcTurn: u.srcTurn, importance: u.importance, pinned: true }, rel(u.id)); }

    // 7. score: relevance scaled over this query's candidates, plus recency, plus importance, equal weights
    const list = [...cand.values()];
    const scaleOf = measure => { const xs = list.filter(c => c.measure === measure).map(c => c.rel); return { lo: Math.min(...xs, 0), hi: Math.max(...xs, 1e-9) }; };
    const scales = { cosine: scaleOf('cosine'), bm25: scaleOf('bm25') };
    for (const c of list) {
        const { lo, hi } = scales[c.measure];
        c.scaledRel = hi > lo ? (c.rel - lo) / (hi - lo) : 1;
        c.recency = c.ageless ? 1 : Math.pow(o.decay, Math.max(0, turn - c.srcTurn));
        c.score = c.scaledRel + c.recency + c.importance / 10;
    }

    // 8. filter
    const dropped = [], flags = [];
    const dupDice = o.thresholds.get('diceNearDuplicate', 'dice');
    const rule = o.holderRule !== false;
    const quotes = rule ? hiddenQuotes.map(normText).filter(Boolean) : [];
    const keep = [];
    for (const c of list) {
        if (c.type === 'record') {
            const r = c.rec;
            if (rule && r.kind === 'secret' && !holderAllows(r.holders, pov, povAliases)) { dropped.push({ key: c.key, reason: 'holder' }); continue; }
            const same = staticTexts.find(t => dice(r.text, t) >= dupDice);
            if (same) { dropped.push({ key: c.key, reason: 'repeats a constant entry' }); continue; }
            const about = staticTexts.find(t => r.subject && normText(t).includes(normText(r.subject)));
            if (about) flags.push({ key: c.key, kind: 'replaces-constant', subject: r.subject });
        } else if (c.type === 'excerpt') {
            const text = normText(c.text);
            if (quotes.some(q => text.includes(q))) { dropped.push({ key: c.key, reason: 'holder' }); continue; }
        } else if (rule && c.type === 'lore' && !loreHolderOk(c.text, pov, povAliases)) { dropped.push({ key: c.key, reason: 'holder' }); continue; }
        keep.push(c);
    }
    // between two records on the same subject and attribute, the one from the later reply stays
    const seen = new Map();
    const later = [];
    for (const c of keep.sort((a, b) => b.srcTurn - a.srcTurn)) {
        if (c.type !== 'record' || !c.rec.attribute) { later.push(c); continue; }
        const k = `${c.rec.kind}|${normText(c.rec.subject)}|${normText(c.rec.attribute)}`;
        if (seen.has(k)) { dropped.push({ key: c.key, reason: 'older record of the same subject and attribute' }); continue; }
        seen.set(k, true); later.push(c);
    }
    // the relevance cut applies where a cosine was computed; a pinned record is never cut
    const eligible = later.filter(c => {
        if (c.pinned || pinned.has(c.rec?.id)) return true;
        const limit = c.type === 'lore' ? loreCut : cut;
        if (c.measure === 'cosine' && c.rel < limit) { dropped.push({ key: c.key, reason: `below the cut (${c.rel.toFixed(2)})` }); return false; }
        return true;
    });

    // 9. admit: fired lore first within its own share, then pinned, then score order until the cap, the size or the cut
    const out = [];
    let loreUsed = 0, meaningUsed = 0, used = 0;
    const size = c => { c.rendered ||= renderItem(c); return count(c.rendered); };
    for (const entry of fired) {
        if (rule && !loreHolderOk(entry.content ?? entry.text, pov, povAliases)) { dropped.push({ key: `lore:${entry.book}:${entry.uid}`, reason: 'holder' }); continue; }
        const item = { key: `lore:${entry.book}:${entry.uid}`, type: 'lore', book: entry.book, uid: String(entry.uid), title: entry.title, text: entry.content ?? entry.text, srcTurn: 0, ageless: true, importance: 5, fired: true, score: 9 };
        const t = size(item);
        if (loreUsed + t <= o.loreShare) { out.push(item); loreUsed += t; item.tokens = t; }
        else dropped.push({ key: item.key, reason: 'over the lore share' });
    }
    const order = eligible.filter(c => !out.some(x => x.key === c.key))
        .sort((a, b) => ((b.pinned || pinned.has(b.rec?.id)) ? 1 : 0) - ((a.pinned || pinned.has(a.rec?.id)) ? 1 : 0) || b.score - a.score);
    let n = 0;
    for (const c of order) {
        if (n >= o.itemCap) { dropped.push({ key: c.key, reason: 'over the item cap' }); continue; }
        const t = size(c);
        if (used + t > o.tokenCap) { dropped.push({ key: c.key, reason: 'over the size cap' }); continue; }
        // entries meaning search found have a lore share of their own, apart from the fired entries' share, so book entries
        // never crowd the records out and the block stays near its measured size (MB5: lore-only turns reached 975 tokens)
        if (c.type === 'lore') {
            if (meaningUsed + t > o.meaningShare) { dropped.push({ key: c.key, reason: 'over the lore share' }); continue; }
            meaningUsed += t;
            c.tokens = t; out.push(c); n++;
            continue;
        }
        c.tokens = t; out.push(c); used += t; n++;
    }
    out.sort((a, b) => a.srcTurn - b.srcTurn);
    return { items: out, mode, ranked: fusedIds, candidates: list.length, pool: list.map(c => ({ key: c.key, rel: +c.rel.toFixed(3), measure: c.measure, score: +c.score.toFixed(3) })), dropped, flags, chapters: [...chapterHits.values()].sort((a, b) => b.rel - a.rel), loreTokens: loreUsed + meaningUsed, tokens: used + loreUsed + meaningUsed };
}

// ---------------------------------------------------------------- the self-test (4.3)

/**
 * Fails when a threshold's name does not carry its measure, when a comparison reads a threshold of another measure, or
 * when a run never reached one of the two comparisons. It runs a small fixed turn through searchTurn with an instrumented
 * threshold set and reads the log of what each comparison asked for.
 */
export function selfTestThresholds(spec = THRESHOLD_SPEC) {
    const problems = [];
    for (const [name, t] of Object.entries(spec)) {
        if (!MEASURES[t.measure]) { problems.push(`${name}: unknown measure ${t.measure}`); continue; }
        if (!new RegExp(MEASURE_WORD[t.measure], 'i').test(name)) problems.push(`${name}: the name does not carry its measure (${t.measure})`);
    }
    const thresholds = createThresholds(spec);
    const units = [
        { id: 'rec:a', type: 'record', recordId: 'a', text: 'Night: the shoe is loose', srcTurn: 1, importance: 5 },
        { id: 'rec:b', type: 'record', recordId: 'b', text: 'Hale: owes a debt', srcTurn: 2, importance: 5 },
    ];
    const records = new Map([['a', { id: 'a', kind: 'fact', subject: 'Night', text: 'the shoe is loose' }], ['b', { id: 'b', kind: 'fact', subject: 'Hale', text: 'owes a debt' }]]);
    const vectors = new Map([['rec:a', [1, 0]], ['rec:b', [0, 1]]]);
    try {
        searchTurn({ units, records, vectors, queryVec: [1, 0], query: 'shoe', turn: 3, staticTexts: ['the shoe is loose'] }, { thresholds });
    } catch (error) { problems.push(String(error.message || error)); }
    for (const use of thresholds.usages) if (spec[use.name] && spec[use.name].measure !== use.measure) problems.push(`${use.name}: a ${spec[use.name].measure} setting is compared as ${use.measure} (mixed measure)`);
    for (const measure of Object.keys(MEASURES)) if (!thresholds.usages.some(use => use.measure === measure)) problems.push(`no comparison of measure ${measure} was reached by the test turn`);
    return { ok: !problems.length, problems };
}
