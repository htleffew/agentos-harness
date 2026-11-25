// Upkeep (memory DESIGN 7.1 levels 0 and 4, 7.3 to 7.5, 3.5). Code first, then one Cleanup call, then the review list.
//
// Level 0, every reply, in code with no model: merge identical duplicates (normalized text, kind, subject and attribute equal,
// the main record kept); queue near duplicates and the M1f candidate pairs (supersede?, merge?) as clusters for a model
// ruling; rank each open thread's likely closing exchange; prune the recall pool; hold out records that repeat your World
// Info entries; add alias keywords to your entries where the book allows (additions.js).
//
// Level 4, Tidy: clusters go to the Cleanup tier in batches (6 on the desktop, 12 on mid routes, 16 on frontier routes). The
// call sees the full text of every record in each cluster. Code picks the main record (locked, else most cited, else the
// earliest); the model writes one merged text that quotes each source; a claim check refuses a merge that drops a name, a
// number or a detail, and the cluster stays as linked records. Clashes with your entries and locked records become flags.
// The interval adapts: the next run comes sooner when the last one found a lot, later when it found little.
//
// Every automatic change is an entry in the chat's change log, so it shows in the tray's Story changes card and in Story
// World, History, each with Undo (a revert entry, which survives a reload) and, for a record a merge retired, Restore.
import { MEMORY, chatMemory, fold as foldChat, storedMark, swipeEntries, swipeOf } from './fold.js';
import { moodWord, quoteIn } from './validate.js';
import { REGISTER_RULE } from './story-so-far.js';
import { bm25, candidatePairs, coverage, identical, pairKey, threshold, bare, contentWords, stem } from './similarity.js';
import { entryPairs, flagInputs, keptPairs, raisedPairs } from './flags.js';
import { reconcileAdditions, runAdditions, undoAddition } from './additions.js';

export const MERGE_MAX = 600;
export const QUEUE_TRIGGER = 8;          // clusters queued before a Tidy run is due
export const FLAG_AGE_REPLIES = 50;      // a flag older than this many replies makes a run due
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const EVERY = Object.freeze({ start: 40, min: 10, max: 160 });
export const BATCH = Object.freeze({ local: 6, mid: 12, frontier: 16 });
const ROUTE_CLASS = { desktop: 'local', phone: 'local', nanogpt: 'mid', openrouterFree: 'mid', googleFree: 'mid', openrouter: 'frontier', main: 'frontier' };
const OUT = ['retired', 'replaced', 'merged'];
const SKIP_KINDS = new Set(['chapter', 'condensed', 'arc', 'scene']);

/** The clusters one Cleanup call takes on a route: 6 on the desktop, 12 on mid routes, 16 on frontier routes. */
export const batchSize = route => BATCH[ROUTE_CLASS[route] || 'mid'];

/** The upkeep state of a chat in metadata: the cluster queue and the last run. */
export function upkeepState(meta) {
    const mem = chatMemory(meta);
    if (!mem.upkeep || typeof mem.upkeep !== 'object') mem.upkeep = {};
    const u = mem.upkeep;
    if (!Array.isArray(u.queue)) u.queue = [];
    if (!Number.isInteger(u.every)) u.every = EVERY.start;
    return u;
}

// ---------------------------------------------------------------- level 0 (pure)

const live = records => records.filter(r => !OUT.includes(r.status) && r.status !== 'suspect' && !SKIP_KINDS.has(r.kind));
const firstAt = r => r.versions?.[0]?.at ?? 0;
const firstIndex = r => r.versions?.[0]?.index ?? Infinity;
/** Story order: the reply each record first came from, then save time. */
const storyOrder = records => [...records].sort((a, b) => (firstIndex(a) - firstIndex(b)) || (firstAt(a) - firstAt(b)));

/** The main record of a cluster: one you locked, else the one cited most, else the earliest (DESIGN 3.5, M1f 3). */
export function mainOf(records) {
    return [...records].sort((a, b) => (Number(!!b.locked) - Number(!!a.locked)) || ((b.entries?.length || 0) - (a.entries?.length || 0))
        || (firstIndex(a) - firstIndex(b)) || (firstAt(a) - firstAt(b)) || (String(a.id) < String(b.id) ? -1 : 1))[0];
}

/** Groups of identical records among the current ones: [[main, ...rest]]. Code merges these alone. */
export function exactGroups(records) {
    const groups = [];
    for (const r of live(records)) {
        const g = groups.find(group => identical(group[0], r));
        if (g) g.push(r); else groups.push([r]);
    }
    return groups.filter(g => g.length > 1).map(g => { const main = mainOf(g); return [main, ...g.filter(r => r !== main)]; });
}

/** The anchor of the newest source in a group, so the change shows on the reply that caused it and leaves with it. */
function newestAnchor(records) {
    const anchors = records.flatMap(r => (r.versions || []).map(v => ({ anchor: v.anchor, index: v.index ?? -1 }))).filter(x => x.anchor?.mark);
    anchors.sort((a, b) => a.index - b.index);
    const top = anchors.at(-1)?.anchor;
    return top ? { mark: top.mark } : undefined;
}

/** Store inputs for a code merge of identical records. */
export function codeMergeInput(group) {
    const [main, ...rest] = group;
    return {
        op: 'merge', target: [main.id, ...rest.map(r => r.id)],
        record: { id: main.id, text: main.text, aliases: [...new Set(group.flatMap(r => r.aliases || []))] },
        origin: { type: 'upkeep', route: 'code', job: 'level0' }, anchor: newestAnchor(group),
        reason: `Identical records merged by code into ${main.id}.`.slice(0, 160),
    };
}

/**
 * Clusters for a model ruling: near duplicates (Dice 0.85 with the same subject and kind) that are not identical, and
 * the M1f candidate pairs supersede? and merge?, joined where they share a record. keep: pair keys ruled two true facts.
 * Returns [{ id, ids, verdicts, why }].
 */
export function clustersFor(records, { names = [], keep = new Set(), maxSize = 6 } = {}) {
    const recs = storyOrder(live(records));
    const pairs = candidatePairs(recs, { names, keep }).filter(p => ['duplicate', 'supersede?', 'merge?'].includes(p.verdict))
        .filter(p => !identical(recs.find(r => r.id === p.a), recs.find(r => r.id === p.b)));
    const clusters = [];
    for (const p of pairs) {
        const hit = clusters.filter(c => c.ids.includes(p.a) || c.ids.includes(p.b));
        if (hit.length) {
            const into = hit[0];
            for (const other of hit.slice(1)) { into.ids.push(...other.ids); into.pairs.push(...other.pairs); clusters.splice(clusters.indexOf(other), 1); }
            for (const id of [p.a, p.b]) if (!into.ids.includes(id)) into.ids.push(id);
            into.pairs.push(p);
        } else clusters.push({ ids: [p.a, p.b], pairs: [p] });
    }
    return clusters.filter(c => c.ids.length <= maxSize).map(c => {
        const ids = recs.filter(r => c.ids.includes(r.id)).map(r => r.id);
        return { id: `c-${bare(ids.join(' ')).replace(/ /g, '-').slice(0, 48)}-${hashIds(ids)}`, ids, verdicts: [...new Set(c.pairs.map(p => p.verdict))], why: c.pairs.map(p => `${p.a} and ${p.b}: ${p.verdict} (${p.why})`).join('; ').slice(0, 400) };
    });
}
const hashIds = ids => { let h = 0; for (const ch of ids.join('|')) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0; return h.toString(36); };

/**
 * Each open thread's likely closing exchanges after it opened, by BM25 over the exchange and its scene header; exchanges
 * with a completion cue score 1.5 times (M1f 5.4). exchanges: [{ index, text, header }]. Returns { threadId: [index] }.
 */
export function threadCandidates(records, exchanges, { top = 3 } = {}) {
    const CUE = /\b(paid|counted out|met them|came out|crossed|reached|arrived|handed over|found|returned|delivered|caught|ended|finished|settled|signed)\b/i;
    const out = {};
    for (const thread of records.filter(r => r.kind === 'thread' && !['done', 'failed', ...OUT].includes(r.status))) {
        const opened = firstIndex(thread);
        const later = exchanges.filter(x => x.index > (Number.isFinite(opened) ? opened : -1));
        if (!later.length) continue;
        const index = bm25(later.map(x => ({ id: x.index, text: `${x.header || ''} ${x.text}` })));
        out[thread.id] = index.search(`${thread.subject || ''} ${thread.text || ''}`).map(h => ({ ...h, score: h.score * (CUE.test(later.find(x => x.index === h.id).text) ? 1.5 : 1) }))
            .sort((a, b) => b.score - a.score).slice(0, top).map(h => h.id);
    }
    return out;
}

/**
 * The recall pool: records eligible for recall. Retired, replaced, merged and suspect records leave; a thread that closed
 * ages out once a chapter closed after it; the rest are scored by importance and recency (M1c rule 14).
 */
export function recallPool(result, { chapters = [] } = {}) {
    const lastChapterEnd = Math.max(-1, ...chapters.map(c => c.toIndex ?? -1));
    const newest = Math.max(1, ...result.current.map(r => r.versions?.at(-1)?.index ?? 0));
    return live(result.current).filter(r => !(r.kind === 'thread' && ['done', 'failed'].includes(r.status) && (r.versions?.at(-1)?.index ?? 0) <= lastChapterEnd))
        .map(r => ({ id: r.id, score: (r.importance || 5) / 10 + 0.5 * ((r.versions?.at(-1)?.index ?? 0) / newest) }))
        .sort((a, b) => b.score - a.score);
}

/**
 * One copy of a fact across your books and the records (M1c rule 5): the ids of records that only repeat one of your
 * World Info entries, held out at injection. entries: [{ content }].
 */
export function repeatsOfEntries(records, entries, { spec } = {}) {
    const cut = threshold('coverageRepeat', 'coverage', spec);
    const texts = entries.map(e => String(e.content || '')).filter(Boolean);
    const corpus = [...records.map(r => r.text || ''), ...texts];
    return live(records).filter(r => texts.some(t => coverage(r.text, t, corpus) >= cut)).map(r => r.id);
}

/**
 * Level 0 over a fold result: code merges, the clusters to queue and the thread candidates. Pure.
 * Returns { merges: [input], clusters, keep }.
 */
export function levelZero(result, { names = [], keep = new Set() } = {}) {
    const groups = exactGroups(result.records);
    const merged = new Set(groups.flatMap(g => g.slice(1).map(r => r.id)));
    const records = result.records.filter(r => !merged.has(r.id));
    return { merges: groups.map(codeMergeInput), clusters: clustersFor(records, { names, keep }) };
}

// ---------------------------------------------------------------- level 4: the Cleanup call (pure)

export const TIDY_RULES = [
    'You tidy the records of a roleplay story. Answer in JSON.',
    'Each cluster lists records that code found alike. Read the full text of every record and rule on the cluster:',
    '"merge" when the records state one fact, or when one adds detail to another and all of them still hold;',
    '"supersede" when one record is a newer state of the same thing; put that record\'s id in newer;',
    '"keep" when they are separate facts that all hold;',
    '"flag" when they contradict each other and the story does not show which one holds.',
    'For "merge", text is one record of 600 characters or fewer that keeps every name, number, place, distance, deadline and detail of every record in the cluster, and quotes lists, for each record id, the exact words of that record your text keeps.',
    'Each entry pair compares one of the player\'s World Info entries with a story record or with another entry. Rule "clash" when they contradict each other, "duplicate" when they say the same thing, "fine" otherwise. You never change an entry.',
    REGISTER_RULE,
].join('\n');

export const TIDY_SCHEMA = Object.freeze({
    type: 'object', required: ['clusters', 'entries'], additionalProperties: false,
    properties: {
        clusters: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['cluster', 'ruling', 'newer', 'text', 'quotes', 'reason'], properties: {
            cluster: { type: 'string' }, ruling: { type: 'string', enum: ['merge', 'supersede', 'keep', 'flag'] }, newer: { type: ['string', 'null'] }, text: { type: ['string', 'null'] },
            quotes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'quote'], properties: { id: { type: 'string' }, quote: { type: 'string' } } } },
            reason: { type: 'string' } } } },
        entries: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['pair', 'ruling', 'reason'], properties: {
            pair: { type: 'string' }, ruling: { type: 'string', enum: ['clash', 'duplicate', 'fine'] }, reason: { type: 'string' } } } },
    },
});

const recordLine = r => `[${r.id}] ${r.kind}${r.threadType ? `/${r.threadType}` : ''} | ${r.subject || '-'} | ${String(r.text || '').replace(/\s+/g, ' ')}${r.evidence?.[0]?.quote ? ` | quote: "${r.evidence[0].quote}"` : ''}`;

/**
 * The Cleanup request for some clusters and entry pairs: the full text of every record and entry, never a preview.
 * quotes: record id -> the source quote of its newest version (quotesOf).
 */
export function tidyRequest(clusters, result, { pairs = [], quotes = new Map() } = {}) {
    const parts = [];
    for (const c of clusters) {
        parts.push(`Cluster ${c.id} (code found: ${c.why}):`);
        for (const id of c.ids) { const r = result.byId.get(id); if (r) parts.push(recordLine({ ...r, evidence: quotes.get(id) ? [{ quote: quotes.get(id) }] : [] })); }
        parts.push('');
    }
    // Pairs go out under short ids (P1, P2), which a model copies back more reliably than book names with spaces.
    pairs.forEach((p, i) => parts.push(`Pair P${i + 1}:`, `A: [${p.a.ref}] ${p.a.title}: ${p.a.text}`, `B: [${p.b.ref}] ${p.b.title}: ${p.b.text}${p.b.quote ? ` | quote: "${p.b.quote}"` : ''}`, ''));
    return { system: TIDY_RULES, user: parts.join('\n').trim() || '(nothing to tidy)', schema: TIDY_SCHEMA };
}

/** The source quote of each record's newest version that carries one: record id -> quote. */
export function quotesOf(chat, meta, result) {
    const byEntry = new Map(everyEntry(chat, meta).map(({ e }) => [e.id, e]));
    const out = new Map();
    for (const r of result.records) for (const v of [...(r.versions || [])].reverse()) { const q = byEntry.get(v.entry)?.evidence?.[0]?.quote; if (q) { out.set(r.id, q); break; } }
    return out;
}

// Every detail of every source must survive a merge: each number, each name and each content word of five letters or more.
const NUMBER = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|hundred|thousand)\b/gi;
/** The details of a text that a merged text must keep: numbers, names and long content words. */
export function details(text) {
    const s = String(text || '');
    const nums = (s.match(NUMBER) || []).map(n => n.toLowerCase());
    const names = [...s.matchAll(/(?:^|[^.!?]\s)([A-Z][\p{L}'-]+)/gu)].map(m => m[1].replace(/'s$/, '').toLowerCase()).filter(w => !/^(the|a|an|he|she|they|it|his|her|their|its)$/.test(w) && !nums.includes(w));
    // Five letters or more as written ("knots", "branch"), compared after stemming.
    const content = new Set(contentWords(s));
    const long = bare(s).split(' ').filter(w => w.length >= 5 && !nums.includes(w)).map(stem).filter(w => content.has(w));
    return [...new Set([...nums, ...names.map(stem), ...long])];
}

/** The claim check (M1f question 7): every detail of every source in the merged text, which is 600 characters or fewer. */
export function claimCheck(sources, merged) {
    const have = new Set(contentWords(merged));
    const flat = ` ${bare(merged)} `;
    const missing = [];
    for (const s of sources) for (const d of details(s.text)) if (!have.has(d) && !flat.includes(` ${d}`)) missing.push({ source: s.id, detail: d });
    return { ok: !missing.length && String(merged).length <= MERGE_MAX, missing, length: String(merged).length };
}

/**
 * Apply one Cleanup answer. clusters: the clusters asked; result: the fold the request read; pairs: the entry pairs asked.
 * Returns { inputs, refused, flags, counts } where inputs are store entries and refused lists clusters left as they were.
 */
export function applyTidy(answer, { clusters, result, pairs = [], origin = {}, raised = new Set() }) {
    const inputs = [], refused = [];
    const counts = { merge: 0, supersede: 0, keep: 0, flag: 0, refused: 0 };
    const o = { type: 'upkeep', job: 'tidy', ...origin };
    for (const ruling of [].concat(answer?.clusters || [])) {
        const c = clusters.find(x => x.id === ruling?.cluster);
        if (!c) continue;
        const sources = c.ids.map(id => result.byId.get(id)).filter(r => r && !OUT.includes(r.status));
        if (sources.length < 2) { refused.push({ cluster: c.id, why: 'a record of the cluster is no longer in force' }); continue; }
        const locked = sources.filter(r => r.locked);
        const anchor = newestAnchor(sources);
        if (ruling.ruling === 'keep') {
            inputs.push({ op: 'keep', target: sources.flatMap((a, i) => sources.slice(i + 1).map(b => `pair:${pairKey(a.id, b.id)}`)), origin: o, anchor, reason: clip(ruling.reason || 'Ruled separate facts by Tidy.') });
            counts.keep += 1;
        } else if (ruling.ruling === 'flag') {
            inputs.push({ op: 'flag', target: sources.map(r => r.id), record: { kind: 'record-clash', pair: c.id, subject: sources[0].subject, a: { ref: `record:${sources[0].id}`, record: sources[0].id, title: sources[0].subject, text: sources[0].text }, b: { ref: `record:${sources[1].id}`, record: sources[1].id, title: sources[1].subject, text: sources[1].text } }, origin: o, anchor, reason: clip(ruling.reason || 'Records contradict each other.') });
            counts.flag += 1;
        } else if (ruling.ruling === 'supersede') {
            const newer = sources.find(r => r.id === ruling.newer);
            if (!newer) { refused.push({ cluster: c.id, why: 'the newer record named is not in the cluster' }); counts.refused += 1; continue; }
            const older = sources.filter(r => r !== newer);
            if (older.some(r => r.locked)) { inputs.push(lockedFlag(older.find(r => r.locked), newer, o, anchor)); counts.flag += 1; continue; }
            const { versions, entries, locked: l, ...rest } = newer;
            inputs.push({ op: 'supersede', target: older.map(r => r.id), record: { ...rest, status: 'current' }, origin: o, anchor, reason: clip(ruling.reason || `Tidy ruled ${newer.id} the newer state.`) });
            counts.supersede += 1;
        } else if (ruling.ruling === 'merge') {
            const main = mainOf(sources);
            const text = String(ruling.text || '').replace(/\s+/g, ' ').trim();
            const check = claimCheck(sources, text);
            const mood = moodWord(text) && !sources.some(r => moodWord(r.text));
            const quotes = [].concat(ruling.quotes || []);
            const unquoted = sources.filter(r => !quotes.some(q => q?.id === r.id && quoteIn(q.quote, r.text)));
            if (!text || !check.ok || mood || unquoted.length || locked.some(r => r !== main)) {
                const why = !text ? 'no merged text' : !check.ok ? (check.length > MERGE_MAX ? `the merged text runs ${check.length} characters` : `the merged text drops ${check.missing.map(m => m.detail).join(', ')}`)
                    : mood ? `the merged text carries mood language ("${moodWord(text)}")` : unquoted.length ? `the merged text does not quote ${unquoted.map(r => r.id).join(', ')}` : 'a locked record is not the main one';
                inputs.push({ op: 'link', target: sources.map(r => r.id), origin: o, anchor, reason: clip(`Merge refused: ${why}.`) });
                refused.push({ cluster: c.id, why, check });
                counts.refused += 1;
                continue;
            }
            inputs.push({
                op: 'merge', target: [main.id, ...sources.filter(r => r !== main).map(r => r.id)],
                record: { id: main.id, text, aliases: [...new Set(sources.flatMap(r => r.aliases || []))] },
                evidence: sources.slice(0, 3).map(r => ({ ...(sourceMark(r) || {}), quote: quotes.find(q => q.id === r.id).quote })),
                origin: o, anchor, reason: clip(ruling.reason || `Tidy merged ${sources.length} records into ${main.id}.`),
            });
            counts.merge += 1;
        }
    }
    const rulings = [].concat(answer?.entries || []).map(r => ({ ...r, pair: /^P\d+$/.test(String(r?.pair)) ? pairs[Number(String(r.pair).slice(1)) - 1]?.pair : r?.pair }));
    const flags = flagInputs(rulings, pairs, o, { raised });
    counts.flag += flags.length;
    return { inputs: [...inputs, ...flags], refused, counts };
}
const clip = text => String(text || '').replace(/\s+/g, ' ').trim().slice(0, 160);
const sourceMark = r => { const a = [...(r.versions || [])].reverse().find(v => v.anchor?.mark)?.anchor; return a ? { mark: a.mark } : null; };
function lockedFlag(lockedRecord, newer, origin, anchor) {
    return { op: 'flag', target: [lockedRecord.id], record: { kind: 'locked-record', subject: lockedRecord.subject, text: newer.text, proposed: 'supersede' }, origin, anchor, reason: 'Tidy ruled that a newer record replaces a record you locked.' };
}

// ---------------------------------------------------------------- when Tidy runs, and how often

/** True when a Tidy run is due: 8 clusters queued, a flag older than 50 replies, a week since the last run, or the interval passed. */
export function tidyDue(state, { reply = 0, now = Date.now(), oldestFlagReply = Infinity, force = false } = {}) {
    if (force) return 'Tidy now';
    if (state.queue.length >= QUEUE_TRIGGER) return `${state.queue.length} clusters queued`;
    if (Number.isFinite(oldestFlagReply) && reply - oldestFlagReply >= FLAG_AGE_REPLIES) return 'a flag waits longer than 50 replies';
    if (state.last?.at && now - state.last.at >= WEEK_MS) return 'a week since the last run';
    if (reply - (state.last?.reply ?? 0) >= state.every) return `${state.every} replies since the last run`;
    return '';
}

/** The interval after a run: halved when it found 6 changes or more, doubled when it found 1 or none, within 10 to 160 replies. */
export function nextEvery(every, found) {
    const e = Number.isInteger(every) ? every : EVERY.start;
    if (found >= 6) return Math.max(EVERY.min, Math.round(e / 2));
    if (found <= 1) return Math.min(EVERY.max, e * 2);
    return e;
}

// ---------------------------------------------------------------- the change log: Story changes and History (pure)

/** The job an entry belongs to, for the History filter: capture, chapter, code upkeep, Tidy, catch-up, import or you. */
export function jobOf(entry) {
    const o = entry?.origin || {};
    if (o.type === 'upkeep') return o.job === 'tidy' ? 'tidy' : 'level0';
    return o.type || 'you';
}
export const JOB_LABELS = Object.freeze({ capture: 'Capture', chapter: 'Chapter close', level0: 'Code upkeep', tidy: 'Tidy', 'catch-up': 'Catch-up', 'carry-over': 'Carry-over', import: 'Import', inference: 'Stat sheets', additions: 'Additions to your books', you: 'Your edits' });

const OP_WORDS = { add: 'Filed', revise: 'Revised', supersede: 'Replaced', retire: 'Retired', merge: 'Merged', complete: 'Closed', link: 'Linked', keep: 'Kept apart', flag: 'Flagged', lock: 'Locked', revert: 'Undid' };

function everyEntry(chat, meta) {
    const out = [];
    (chat || []).forEach((message, i) => { for (const e of swipeEntries(message)) if (!Number.isInteger(e?.anchor?.swipe) || e.anchor.swipe === swipeOf(message)) out.push({ e, index: i }); });
    const marks = new Map((chat || []).map((m, i) => [storedMark(m), i]));
    for (const e of meta?.[MEMORY]?.log || []) out.push({ e, index: e.anchor ? marks.get(e.anchor.mark) ?? null : null });
    return out;
}

/**
 * Pairs a model already ruled on, so code does not queue them again: kept apart (keep), left linked after a refused merge
 * (link) and flagged (flag), while those entries count.
 */
export function ruledPairs(chat, meta, result) {
    const out = keptPairs(chat, meta, result);
    const applied = new Set(result.applied);
    for (const { e } of everyEntry(chat, meta)) {
        if (!applied.has(e.id) || !['link', 'flag'].includes(e.op)) continue;
        const ids = (e.target || []).filter(t => !String(t).includes('#') && !String(t).startsWith('pair:'));
        for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) out.add(pairKey(ids[i], ids[j]));
    }
    return out;
}

/** One row of the change log for a reader: what changed, which job did it, whether it counts, and its Undo and Restore. */
function rowOf({ e, index }, result) {
    const counts = e.op === 'revert' ? result.reverts.includes(e.id) : result.applied.includes(e.id);
    const ids = [...(e.target || []), e.record?.id].filter(Boolean);
    const subjects = [...new Set(ids.map(id => result.byId.get(id)?.subject).filter(Boolean))];
    const retired = e.op === 'merge' ? (e.target || []).slice(1) : e.op === 'supersede' ? [...(e.target || [])] : e.op === 'retire' ? [...(e.target || [])] : [];
    return {
        entry: e.id, op: e.op, job: jobOf(e), label: `${OP_WORDS[e.op] || e.op}${subjects.length ? `: ${subjects.join(', ')}` : ''}`,
        text: e.record?.text || '', reason: e.reason || '', index, at: e.at, counts, note: counts ? '' : result.notes.get(e.id) || '',
        targets: ids, undo: counts && e.op !== 'revert' ? e.id : '',
        restore: counts ? retired.filter(id => OUT.includes(result.byId.get(id)?.status)) : [],
    };
}

/**
 * Story World, History: every automatic change (and your own when asked), newest first, filtered by job.
 * jobs: a list of job ids, or empty for all automatic jobs. Additions to your books come from the additions log.
 */
export function historyRows(chat, meta, { jobs = [], mine = false, result = foldChat(chat, meta) } = {}) {
    const wanted = job => (jobs.length ? jobs.includes(job) : job !== 'you' || mine);
    const rows = everyEntry(chat, meta).filter(({ e }) => e?.id && !['revert'].includes(e.op) && wanted(jobOf(e))).map(x => rowOf(x, result));
    if (wanted('additions')) {
        const marks = new Map((chat || []).map((m, i) => [storedMark(m), i]));
        for (const a of meta?.[MEMORY]?.additions || []) rows.push({
            entry: a.id, op: a.kind, job: 'additions', label: `${a.kind === 'key' ? 'Keyword added' : a.kind === 'line' ? 'Line added' : 'Entry added'}: ${a.book}`,
            text: a.value, reason: a.note || '', index: marks.get(a.source?.mark) ?? null, at: a.at, counts: a.state === 'live', note: a.state === 'live' ? '' : a.state === 'yours' ? a.note : a.state,
            targets: [`${a.book}#${a.uid}`], undo: a.state === 'live' ? a.id : '', restore: [], addition: true,
        });
    }
    return rows.sort((a, b) => (b.at || 0) - (a.at || 0));
}

/** The tray's Story changes card for one reply: what capture filed from it and what upkeep changed because of it. */
export function storyChanges(chat, meta, index, { result = foldChat(chat, meta) } = {}) {
    const mark = storedMark(chat?.[index]);
    if (!mark) return [];
    const rows = everyEntry(chat, meta).filter(({ e, index: at }) => e?.id && at === index && e.op !== 'revert' && jobOf(e) !== 'you').map(x => rowOf(x, result));
    for (const a of meta?.[MEMORY]?.additions || []) if (a.source?.mark === mark) rows.push({ entry: a.id, op: a.kind, job: 'additions', label: `${a.kind === 'key' ? 'Keyword added' : a.kind === 'line' ? 'Line added' : 'Entry added'}: ${a.book}`, text: a.value, counts: a.state === 'live', note: a.state === 'live' ? '' : a.note || a.state, undo: a.state === 'live' ? a.id : '', restore: [], addition: true, at: a.at });
    return rows;
}

// ================================================================ the host side

let H = null;
async function host() {
    if (H) return H;
    const st = await import('../st.js');
    const settingsMod = await import('../store.js');
    const routing = await import('../routing.js');
    const memStore = await import('./store.js');
    const queue = await import('./queue.js');
    const capture = await import('./capture.js');
    H = { st, settingsMod, routing, memStore, queue, capture };
    return H;
}

const bookIo = st => ({ loadBook: name => st.loadBook(name), saveBook: (name, data) => st.saveBook(name, data), now: () => Date.now() });

/** The World Info books this chat uses that are yours (generated books excluded), with their roles. */
async function yourBooks() {
    const { chatBooks } = await import('../chat-books.js');
    const { isGeneratedName } = await import('./story-world-book.js');
    try { return chatBooks().filter(b => b.exists && !b.excluded && !isGeneratedName(b.name)).map(b => ({ name: b.name, roles: b.roles })); } catch { return []; }
}

/** Your saved "Story may add to this book" levels. */
export async function savedLevels() {
    const { settingsMod } = await host();
    const st = settingsMod.settings();
    st.memory ||= {};
    st.memory.bookAdditions ||= {};
    return st.memory.bookAdditions;
}

/** Set "Story may add to this book" for one book. */
export async function setBookLevel(name, level) {
    const { settingsMod } = await host();
    (await savedLevels())[name] = level;
    settingsMod.saveSettings?.();
}

/** Upkeep after one reply: code merges, the cluster queue, keyword and line additions where books allow, and a due Tidy. */
export async function afterReply({ context, store, force = false } = {}) {
    const { st, memStore, settingsMod } = await host();
    const c = context || st.ctx();
    const meta = c.chatMetadata || {};
    if (!meta[MEMORY]?.imported || !settingsMod.settings().enabled) return { skipped: true };
    const s = store || memStore.memoryStore();
    const names = [st.names().char, st.names().user].filter(Boolean);
    let result = foldChat(c.chat || [], meta);
    const keep = ruledPairs(c.chat || [], meta, result);
    const zero = levelZero(result, { names, keep });
    if (zero.merges.length) await s.record(zero.merges);
    result = foldChat(c.chat || [], meta);
    const state = upkeepState(meta);
    const queued = new Set(state.queue.map(q => q.id));
    for (const cl of zero.clusters) if (!queued.has(cl.id)) state.queue.push({ ...cl, at: Date.now() });
    state.queue = state.queue.filter(q => q.ids.every(id => result.byId.get(id) && !OUT.includes(result.byId.get(id).status)));
    // Additions: keywords (and lines and entries where allowed); Constant entries only when a chapter closed since the last pass.
    const chapters = result.current.filter(r => r.kind === 'chapter');
    const atClose = chapters.length > (state.chapters || 0);
    state.chapters = chapters.length;
    const added = await runAdditions({ books: await yourBooks(), io: bookIo(st), meta, records: result.current, chapters, saved: await savedLevels(), atClose }).catch(() => ({ made: [] }));
    const chat = c.chat || [];
    const repliesTo = i => chat.slice(0, i + 1).filter(m => m && !m.is_user && !m.is_system).length;
    const flagAt = new Map(everyEntry(chat, meta).map(({ e, index }) => [e.id, index]));
    // a story event waiting for a book (MB12) is not a clash for Tidy to rule on
    const oldest = Math.min(Infinity, ...result.flags.filter(f => f.kind !== 'event-seed').map(f => flagAt.get(f.entry)).filter(Number.isInteger).map(repliesTo));
    const due = tidyDue(state, { reply: repliesTo(chat.length - 1), oldestFlagReply: oldest, force });
    await (c.saveChat?.() ?? c.saveMetadata?.());
    if (due) await queueTidy(c, due);
    return { merges: zero.merges.length, queued: state.queue.length, added: added.made.length, due };
}

/** Put a Tidy job on the desktop queue. */
async function queueTidy(c, why) {
    const { queue } = await host();
    const chatId = String(c.getCurrentChatId?.() || '');
    const q = queue.desktopQueue();
    await q.enqueue({ chatId, kind: 'tidy', subject: 'tidy', order: (c.chat || []).length, model: queue.desktopModelFor('tidy'), sources: { queue: String(upkeepState(c.chatMetadata).queue.length) }, payload: { why } });
    q.pump();
}

/**
 * Run Tidy now over the queued clusters and the entry pairs. Builds one request per batch, runs the Cleanup chain and
 * commits the changes. runChainFn and books can be given (tests). Returns { ok, counts, refused, route }.
 */
export async function runTidy({ context, store, runChainFn, books, signal, now = Date.now } = {}) {
    const { st, memStore, routing } = await host();
    const c = context || st.ctx();
    const meta = c.chatMetadata || {};
    const s = store || memStore.memoryStore();
    const state = upkeepState(meta);
    const result = foldChat(c.chat || [], meta);
    const loaded = books || await Promise.all((await yourBooks()).map(async b => ({ name: b.name, data: await st.loadBook(b.name).catch(() => null) })));
    const kept = keptPairs(c.chat || [], meta, result);
    const raised = raisedPairs(result);
    const pairs = entryPairs(loaded.filter(b => b.data), result.records, { kept: new Set([...kept, ...raised]) });
    const run = runChainFn || (options => routing.runChain(routing.chainFor('tidy'), { job: 'tidy', ...options }));
    const quotes = quotesOf(c.chat || [], meta, result);
    const totals = { merge: 0, supersede: 0, keep: 0, flag: 0, refused: 0 };
    const refused = [];
    // The first call carries the entry pairs; the batch size follows the route that answered it.
    let route = '', pending = [...state.queue], askPairs = pairs;
    while (pending.length || askPairs.length) {
        const batch = pending.splice(0, batchSize(route || 'desktop'));
        const req = tidyRequest(batch, result, { pairs: askPairs, quotes });
        const res = await run({ system: req.system, user: req.user, schema: { name: 'tidy', value: req.schema }, tokens: 600 + 220 * batch.length + 80 * askPairs.length, signal, label: `Tidy, ${batch.length} clusters` });
        if (!res?.ok) return { ok: false, reason: res?.reason || 'the Cleanup route did not answer', counts: totals, refused };
        route = res.route || route;
        const applied = applyTidy(res.value, { clusters: batch, result, pairs: askPairs, origin: { route: res.route, model: res.model, call: `${res.route}:${now()}` }, raised });
        if (applied.inputs.length) await s.record(applied.inputs);
        for (const k of Object.keys(totals)) totals[k] += applied.counts[k];
        refused.push(...applied.refused);
        askPairs = [];
    }
    const found = totals.merge + totals.supersede + totals.flag;
    const reply = (c.chat || []).filter(m => m && !m.is_user && !m.is_system).length;
    state.queue = [];
    state.every = nextEvery(state.every, found);
    state.last = { at: now(), reply, found, route };
    await (c.saveChat?.() ?? c.saveMetadata?.());
    return { ok: true, counts: totals, refused, route, every: state.every };
}

/** Take back additions whose reply left the chat (a delete, a swipe away, a branch cut before it). */
export async function reconcileNow({ context } = {}) {
    const { st } = await host();
    const c = context || st.ctx();
    if (!c.chatMetadata?.[MEMORY]?.additions?.length) return { removed: [], kept: [] };
    const out = await reconcileAdditions({ io: bookIo(st), meta: c.chatMetadata, chat: c.chat || [] });
    if (out.removed.length || out.kept.length) await (c.saveChat?.() ?? c.saveMetadata?.());
    return out;
}

/** Undo one row of History or the Story changes card: a revert entry, or the removal of an addition. */
export async function undoChange(row, { context, store } = {}) {
    const { st, memStore } = await host();
    const c = context || st.ctx();
    if (row.addition) {
        const out = await undoAddition(row.undo, { io: bookIo(st), meta: c.chatMetadata, chat: c.chat || [] });
        await (c.saveChat?.() ?? c.saveMetadata?.());
        return out;
    }
    return (store || memStore.memoryStore()).revert(row.undo, `Undone from ${JOB_LABELS[row.job] || 'History'}.`);
}

/** Restore a record a merge, a supersede or a retire took out of force. */
export async function restoreRecord(recordId, { store } = {}) {
    const { memStore } = await host();
    return (store || memStore.memoryStore()).restore(recordId);
}

// One pass at a time: a batch capture ends several replies at once, and two passes must not merge the same pair twice.
// Behavior book jobs (MB12: story events, one-shot events) run in the same line, so two jobs never load and save one
// book at once.
let pass = Promise.resolve();
/** Run fn after every upkeep pass queued before it. Returns the pass. */
export function upkeepPass(fn, label = 'upkeep') {
    pass = pass.then(fn).catch(error => console.warn('[Roleplay Instructions]', label, error));
    return pass;
}

let started = false;
/** Wire upkeep to the host once: level 0 after each capture, the Tidy handler, and take-back on delete, swipe and branch. */
export async function startUpkeep() {
    if (started) return;
    started = true;
    const { st, queue, capture } = await host();
    capture.onCapture(event => {
        if (event.phase !== 'done') return;
        upkeepPass(() => afterReply());
    });
    queue.desktopQueue().handle('tidy', { run: (job, { signal }) => runTidy({ signal }), commit: async () => {}, saved: () => false });
    const take = () => upkeepPass(() => reconcileNow(), 'additions');
    for (const name of ['MESSAGE_DELETED', 'MESSAGE_SWIPED', 'CHAT_CHANGED']) st.on(name, take);
}
