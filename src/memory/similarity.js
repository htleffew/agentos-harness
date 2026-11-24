// Code measures for upkeep (memory DESIGN 7.1 level 0, 7.3; M1f 4 and 5). Pure code with no host and no library, so the
// phone runs it on every reply and tests run it in Node.
//
// Every threshold is named for the measure it belongs to and is read through threshold(name, measure), which throws when a
// setting of one measure is used in a comparison of another. TunnelVision passed a 0.85 cosine setting as a trigram cutoff
// and its dedupe never fired (M1b-10 4.3); the self-test below catches that class of mistake.

// ---------------------------------------------------------------- thresholds named for their measure (DESIGN 4.3)

export const MEASURES = Object.freeze({ dice: 'character-bigram Dice', jaccard: 'word Jaccard', overlap: 'attribute overlap coefficient', coverage: 'weighted term coverage' });
export const THRESHOLDS = Object.freeze({
    diceNearDuplicate: { measure: 'dice', value: 0.85 },
    jaccardNearDuplicate: { measure: 'jaccard', value: 0.8 },
    attributeOverlap: { measure: 'overlap', value: 0.3 },
    jaccardRelated: { measure: 'jaccard', value: 0.15 },
    coverageRepeat: { measure: 'coverage', value: 0.8 },
});

/** The value of a named threshold, read for one measure. A setting read under another measure throws. */
export function threshold(name, measure, spec = THRESHOLDS) {
    const t = spec[name];
    if (!t) throw new Error(`No threshold named ${name}.`);
    if (t.measure !== measure) throw new Error(`The threshold ${name} is a ${t.measure} setting and was read for a ${measure} comparison.`);
    return t.value;
}

/** Problems with a threshold table: a name that does not carry its measure, or a usage under another measure. */
export function selfTestThresholds(spec = THRESHOLDS, usages = []) {
    const problems = [];
    const word = { dice: 'dice', jaccard: 'jaccard', overlap: 'overlap', coverage: 'coverage' };
    for (const [name, t] of Object.entries(spec)) {
        if (!MEASURES[t.measure]) problems.push(`${name}: unknown measure ${t.measure}`);
        else if (!name.toLowerCase().includes(word[t.measure])) problems.push(`${name}: the name does not carry its measure (${t.measure})`);
    }
    for (const u of usages) if (spec[u.name] && spec[u.name].measure !== u.measure) problems.push(`${u.name}: a ${spec[u.name].measure} setting is compared as ${u.measure}`);
    return problems;
}

// ---------------------------------------------------------------- words

/** Lower case, curly quotes made straight, whitespace folded. */
export const norm = text => String(text ?? '').normalize('NFKC').toLowerCase().replace(/[‘’`]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
/** Letters, digits and single spaces only. */
export const bare = text => norm(text).replace(/'s\b/g, '').replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();

const STOP = new Set(('a an the and or but of to in on at by for with from into onto is are was were be been being has have had his her their its he she they him them it this ' +
    'that these those as than then so if not no nor up down out over under again further once there here when where why how all any both each few more most other some such ' +
    'only own same too very can will just one ser lord lady now who whom which what would could should must may might also still yet ever').split(' '));

/** A light suffix stemmer (Porter's first steps), enough that "loose" and "loosened", "wagon" and "wagons" meet. */
export function stem(word) {
    let w = String(word || '').toLowerCase();
    if (w.length <= 3) return w;
    if (/sses$/.test(w)) w = w.slice(0, -2);
    else if (/ies$/.test(w)) w = `${w.slice(0, -3)}y`;
    else if (/[^s]s$/.test(w) && !/(us|is)$/.test(w)) w = w.slice(0, -1);
    if (/eed$/.test(w)) w = w.slice(0, -1);
    else if (/(ed|ing)$/.test(w) && /[aeiouy].*(ed|ing)$/.test(w)) {
        w = w.replace(/(ed|ing)$/, '');
        if (/(at|bl|iz)$/.test(w)) w += 'e';
        else if (/([^aeiouylsz])\1$/.test(w)) w = w.slice(0, -1);
    }
    if (/ened$|ening$/.test(w)) w = w.replace(/en(ed|ing)$/, '');
    return w.replace(/e$/, '') || w;
}

/** The content words of a text: stemmed, stop words and one-letter words left out, numbers kept. */
export const contentWords = text => bare(text).split(' ').filter(w => w && (/\d/.test(w) || (w.length > 1 && !STOP.has(w)))).map(stem);


/** Overlap coefficient: shared items over the smaller set, 0 to 1. One record often adds detail the other lacks. */
export function overlapCoefficient(a, b) {
    const A = new Set(a), B = new Set(b);
    if (!A.size || !B.size) return 0;
    let shared = 0;
    for (const x of A) if (B.has(x)) shared += 1;
    return shared / Math.min(A.size, B.size);
}

// ---------------------------------------------------------------- subjects and attributes

const TITLES = /^(ser|sir|lord|lady|maester|captain|general|master|mistress|king|queen|prince|princess|the)\s+/i;
/** A subject reduced to its first proper word: "Ser Marten Drey" and "Marten" meet. */
export const canonicalSubject = subject => bare(subject).replace(TITLES, '').replace(TITLES, '').split(' ')[0] || '';

// Verbs that narration uses with a record's subject. An attribute is what a record is about (the foreshoe, the rear guard),
// so these words are left out of it; M1f did the same with a part-of-speech tagger.
const VERBS_RAW = ['command', 'ride', 'rode', 'take', 'took', 'reset', 'tie', 'tied', 'give', 'gave', 'let', 'trust', 'worry', 'greet', 'call', 'move', 'stitch',
    'tell', 'told', 'keep', 'kept', 'lost', 'lose', 'bring', 'brought', 'hear', 'heard', 'order', 'doubl', 'pay', 'paid', 'list', 'name', 'found', 'find', 'seal', 'carry',
    'carri', 'hold', 'held', 'say', 'said', 'sold', 'sell', 'buy', 'bought', 'want', 'wrote', 'write', 'saw', 'see', 'stay', 'stayed', 'leave', 'left', 'come', 'came',
    'go', 'went', 'put', 'set', 'get', 'got', 'make', 'made', 'know', 'knew', 'learn', 'read', 'lead', 'led', 'meet', 'met', 'judg', 'plan', 'fit', 'hammer', 'land',
    'count', 'stamp', 'return', 'dismiss', 'charge', 'cross', 'sleep', 'sent', 'send', 'pack', 'lift', 'hand', 'kneel', 'knelt', 'live', 'die', 'dead', 'is', 'has'];
// Both lists are read through the same stemmer as the words they are compared with.
const VERBS = new Set(VERBS_RAW.map(w => stem(w)));
const NUMBER_WORDS = new Set(['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'twenty', 'fifty', 'hundred', 'new', 'first'].map(w => stem(w)));

/** The words a record is about: content words minus cast names, titles, numbers and narration verbs. */
export function attributeWords(record, cast = new Set()) {
    const own = new Set(contentWords(`${record.subject || ''}`));
    // The full name the text gives the subject ("Ser Marten Drey" for Marten) is the subject too.
    const head = stem(canonicalSubject(record.subject));
    for (const run of String(record.text || '').match(/[A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)+/gu) || []) {
        const ws = contentWords(run);
        if (head && ws.includes(head)) for (const w of ws) own.add(w);
    }
    const words = contentWords(`${record.attribute || ''} ${record.text || ''}`);
    return [...new Set(words.filter(w => !cast.has(w) && !own.has(w) && !/^\d/.test(w) && !NUMBER_WORDS.has(w) && !VERBS.has(w) && !TITLES.test(`${w} `)))];
}

/** The cast as stemmed name words, from the subjects of person records and the names given. */
export function castWords(records = [], names = []) {
    const out = new Set();
    for (const name of [...names, ...records.filter(r => ['person', 'profile'].includes(r.kind)).map(r => r.subject)]) for (const w of contentWords(name)) out.add(w);
    for (const r of records) { const c = canonicalSubject(r.subject); if (c && /^[A-Z]/.test(String(r.subject || '').replace(TITLES, ''))) out.add(stem(c)); }
    return out;
}

// Words that announce a new state of an old attribute (M1f 5, rule 3).
export const CHANGE_MARKERS = /\b(now|again|no longer|anymore|instead|moved|takes|took over|replaced|became|has become|is no|has left|switched|swapped|finally|returned|healed)\b/i;
const FAMILY = { fact: 'fact', profile: 'fact', person: 'person', trait: 'trait', place: 'place', item: 'item', secret: 'secret', knowledge: 'secret', relationship: 'relationship', emotion: 'emotion', thread: 'thread', arc: 'thread', seed: 'thread', agenda: 'thread', reputation: 'reputation', achievement: 'achievement' };
export const familyOf = kind => FAMILY[kind] || kind || 'fact';

/** True when code alone may merge two records: normalized text, kind, subject and attribute identical (DESIGN 3.5). */
export function identical(a, b) {
    return bare(a.text) === bare(b.text) && familyOf(a.kind) === familyOf(b.kind) && bare(a.subject) === bare(b.subject) && bare(a.attribute || '') === bare(b.attribute || '');
}

/** The first source quote of a record, read from its evidence when the fold kept it. */
const quoteOf = r => r.quote || r.evidence?.[0]?.quote || '';

export const VERDICTS = Object.freeze(['duplicate', 'supersede?', 'merge?', 'linked', 'related']);

/**
 * Candidate pairs by the M1f rules, in order (M1f 5): linked (same source quote, different kinds); duplicate (same family and
 * subject, near-identical text); supersede? (same subject, shared attribute and a change marker in the newer text); merge?
 * (the same without a marker); related (shared subject or cast, some word overlap). Records are in story order, older first.
 * Returns [{ a, b, verdict, dice, jaccard, attributeOverlap, why }], where a is the older record.
 */
export function candidatePairs(records, { names = [], spec = THRESHOLDS, keep = new Set() } = {}) {
    const dupDice = threshold('diceNearDuplicate', 'dice', spec);
    const dupJaccard = threshold('jaccardNearDuplicate', 'jaccard', spec);
    const attrMin = threshold('attributeOverlap', 'overlap', spec);
    const relMin = threshold('jaccardRelated', 'jaccard', spec);
    const cast = castWords(records, names);
    const attrs = new Map(records.map(r => [r.id, attributeWords(r, cast)]));
    const subj = new Map(records.map(r => [r.id, canonicalSubject(r.subject)]));
    // Each record's bigrams and words are read once; the pair loop only compares them.
    const grams = new Map(records.map(r => [r.id, gramsOf(r.text)]));
    const words = new Map(records.map(r => [r.id, new Set(contentWords(r.text))]));
    // Blocking: every rule needs the same subject, or (linked) the same source quote, so only those pairs are scored.
    const buckets = new Map();
    records.forEach((r, i) => {
        for (const key of [subj.get(r.id) && `s:${subj.get(r.id)}`, quoteOf(r) && `q:${quoteOf(r)}`].filter(Boolean)) (buckets.get(key) || buckets.set(key, []).get(key)).push(i);
    });
    const todo = new Set();
    for (const list of buckets.values()) for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) todo.add(list[x] * records.length + list[y]);
    const out = [];
    for (const n of [...todo].sort((p, q) => p - q)) {
        const a = records[Math.floor(n / records.length)], b = records[n % records.length];
        if (keep.has(pairKey(a.id, b.id))) continue;
        const sameFamily = familyOf(a.kind) === familyOf(b.kind);
        const sameSubject = !!subj.get(a.id) && subj.get(a.id) === subj.get(b.id);
        const d = diceOf(grams.get(a.id), grams.get(b.id)), jac = jaccardOf(words.get(a.id), words.get(b.id));
        const shared = attrs.get(a.id).filter(w => attrs.get(b.id).includes(w));
        const ao = overlapCoefficient(attrs.get(a.id), attrs.get(b.id));
        let verdict = '', why = '';
        if (quoteOf(a) && quoteOf(a) === quoteOf(b) && !sameFamily) { verdict = 'linked'; why = 'same source quote, different kinds'; }
        else if (sameFamily && sameSubject && (d >= dupDice || jac >= dupJaccard)) { verdict = 'duplicate'; why = 'same subject and near-identical text'; }
        else if (sameFamily && sameSubject && ao >= attrMin) { verdict = CHANGE_MARKERS.test(b.text) ? 'supersede?' : 'merge?'; why = `same subject, shared attribute (${shared.join(', ')})${verdict === 'supersede?' ? ', and the newer text carries a change marker' : ''}`; }
        else if (sameSubject && jac >= relMin && ao > 0) { verdict = 'related'; why = `same subject, shared words (${shared.join(', ')})`; }
        if (verdict) out.push({ a: a.id, b: b.id, verdict, dice: round(d), jaccard: round(jac), attributeOverlap: round(ao), why });
    }
    return out;
}
const round = n => Math.round(n * 100) / 100;
/** Character bigram counts of a text, letters and digits only (the same measure as validate.dice). */
function gramsOf(text) {
    const s = norm(text).replace(/[^\p{L}\p{N}]+/gu, '');
    const out = new Map();
    for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); out.set(g, (out.get(g) || 0) + 1); }
    return out;
}
function diceOf(x, y) {
    let n = 0, total = 0;
    for (const v of x.values()) total += v;
    for (const v of y.values()) total += v;
    if (!total) return 0;
    for (const [g, v] of x) n += Math.min(v, y.get(g) || 0);
    return (2 * n) / total;
}
function jaccardOf(A, B) {
    let shared = 0;
    for (const w of A) if (B.has(w)) shared += 1;
    const union = A.size + B.size - shared;
    return union ? shared / union : 0;
}
/** The key of an unordered pair of ids. */
export const pairKey = (a, b) => [String(a), String(b)].sort().join('|');

// ---------------------------------------------------------------- coverage and BM25

/** The share of one text's content words that another holds, weighted by rarity across `corpus`, 0 to 1. */
export function coverage(text, other, corpus = []) {
    const terms = [...new Set(contentWords(text))];
    if (!terms.length) return 0;
    const have = new Set(contentWords(other));
    const docs = corpus.length ? corpus.map(t => new Set(contentWords(t))) : [new Set(terms), have];
    const idf = t => Math.log((docs.length + 1) / (docs.filter(d => d.has(t)).length + 0.5));
    const total = terms.reduce((s, t) => s + idf(t), 0) || 1;
    return terms.filter(t => have.has(t)).reduce((s, t) => s + idf(t), 0) / total;
}

/** A small BM25 index (k1 1.2, b 0.75) over [{ id, text }]. search(query) returns [{ id, score }], best first. */
export function bm25(docs, { k1 = 1.2, b = 0.75 } = {}) {
    const rows = docs.map(d => ({ id: d.id, terms: contentWords(d.text) }));
    const avg = rows.reduce((s, r) => s + r.terms.length, 0) / (rows.length || 1) || 1;
    const df = new Map();
    for (const r of rows) for (const t of new Set(r.terms)) df.set(t, (df.get(t) || 0) + 1);
    const idf = t => Math.log(1 + (rows.length - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));
    return {
        search(query) {
            const q = [...new Set(contentWords(query))];
            return rows.map(r => {
                const tf = new Map();
                for (const t of r.terms) tf.set(t, (tf.get(t) || 0) + 1);
                const score = q.reduce((s, t) => { const f = tf.get(t) || 0; return f ? s + idf(t) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * r.terms.length / avg)) : s; }, 0);
                return { id: r.id, score };
            }).filter(x => x.score > 0).sort((x, y) => y.score - x.score);
        },
    };
}
