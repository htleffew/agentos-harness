// Undercurrent 2 · FEATURES — keyword recall: a small, pure TF-IDF ranker (BM25 weighting) over archived chunks.
// Tokenizer: Intl.Segmenter word segmentation when available (handles CJK), else a Unicode-letter regex. Latin tokens
// need 3+ letters; CJK tokens 1+. Stopwords and roleplay filler ("smiled", "eyes", "room"…) never count. Terms found
// in half the documents or more are ignored once there are 4+ documents (they identify nothing).

import { str } from '../common/text.js';
import { STOPWORDS, RECALL_STOPWORDS } from '../common/lexicon.js';

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
let segmenter = null;
try { segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null; } catch { segmenter = null; }

export function recallTokens(text) {
    const s = str(text).toLowerCase().replace(/[’‘]/g, '\'');
    const raw = [];
    if (segmenter) {
        for (const seg of segmenter.segment(s)) if (seg.isWordLike) raw.push(seg.segment);
    } else {
        raw.push(...(s.match(/[\p{L}\p{N}']+/gu) || []));
    }
    const out = [];
    for (let t of raw) {
        t = t.replace(/^'+|'+$/g, '').replace(/'s$/, '');
        if (!t || /^\d+$/.test(t)) continue;
        if (CJK.test(t)) { out.push(t); continue; }
        if (t.length < 3 || STOPWORDS.has(t) || RECALL_STOPWORDS.has(t)) continue;
        out.push(t);
    }
    return out;
}

const docCache = new Map();
function docStats(text) {
    const hit = docCache.get(text);
    if (hit) return hit;
    const toks = recallTokens(text);
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    const v = { len: toks.length, tf };
    docCache.set(text, v);
    if (docCache.size > 400) docCache.delete(docCache.keys().next().value);
    return v;
}

/** Build an index over [{id, text}] (per-document term counts are cached by text, so growing archives stay cheap). */
export function buildIndex(docs) {
    const items = (Array.isArray(docs) ? docs : []).map(d => ({ id: d.id, ...docStats(str(d.text)) }));
    const df = new Map();
    for (const it of items) for (const t of it.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    const avg = items.length ? items.reduce((s, x) => s + x.len, 0) / items.length : 0;
    return { items, df, n: items.length, avg: avg || 1 };
}

/**
 * Rank documents for a query. Returns [{id, score, terms:[matched terms]}] with score > 0, best first, at most k.
 */
export function rank(index, query, k = 3, { k1 = 1.2, b = 0.75 } = {}) {
    if (!index || !index.n) return [];
    const q = [...new Set(recallTokens(query))];
    const terms = q.filter(t => index.df.has(t) && !(index.n >= 4 && index.df.get(t) / index.n >= 0.5));
    if (!terms.length) return [];
    const out = [];
    for (const it of index.items) {
        let score = 0;
        const hit = [];
        for (const t of terms) {
            const f = it.tf.get(t);
            if (!f) continue;
            const df = index.df.get(t);
            const idf = Math.log(1 + (index.n - df + 0.5) / (df + 0.5));
            score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * (it.len / index.avg)));
            hit.push(t);
        }
        if (score > 0) out.push({ id: it.id, score, terms: hit });
    }
    out.sort((x, y) => y.score - x.score || String(x.id).localeCompare(String(y.id)));
    return out.slice(0, Math.max(0, k));
}

/** Weight of query terms in a passage (for picking the best excerpt inside a chunk). */
export function passageScore(text, terms) {
    if (!terms.length) return 0;
    const toks = recallTokens(text);
    const set = new Set(terms);
    let s = 0;
    for (const t of toks) if (set.has(t)) s++;
    return s;
}
