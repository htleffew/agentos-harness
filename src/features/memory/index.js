// Undercurrent 2 · FEATURES — memory (off by default).
//
// Working window raw; older messages archived in chunks addressed by uc_id ranges (./archive.js); optional summary job
// per chunk after a reply (content.jobs.memory_summary, strict parse, story-time header from the chunk's own <Scene>
// time, invalidated and re-queued when any message in the range changes); recall into 'uc_recall' (after the chat
// history, so the cached prompt prefix survives): every valid summary, newest first within the word budget, plus the
// top-k archived chunks for the newest player message by keyword TF-IDF (./tfidf.js) or, when the recall setting is
// "semantic" and CORE provides ctx.vectors, by SillyTavern's vector store (falls back to keywords).
//
// Removing archived messages from the prompt: interceptor(ctx, chat). CORE calls it from the manifest's
// generate_interceptor. Evidence (vendor/st118, SillyTavern 1.18):
//   - public/scripts/extensions.js:2015-2040 runGenerationInterceptors(chat, contextSize, type) awaits
//     globalThis[manifest.generate_interceptor](chat, contextSize, abort, type) for each manifest, in loading order;
//   - public/script.js:4437 `coreChat = chat.filter(x => !x.is_system …)` and :4442-4469 map every item to a shallow
//     copy `{...chatItem, mes: regexedMessage, index}` — a fresh array, but `extra` is still the SAME object as in the
//     real chat; :4503-4512 the interceptors get that coreChat, and only when !dryRun (token counts / previews skip it);
//   - script.js:4565 world info scans coreChat[].mes; :4775 setOpenAIMessages(coreChat) builds the chat-completion
//     history; openai.js:575 and script.js:5782 skip any item with extra[IGNORE_SYMBOL]; constants.js:25
//     IGNORE_SYMBOL = Symbol.for('ignore') (also exposed as getContext().symbols.ignore, st-context.js:301).
// So for every archived message we REPLACE the array slot with {...msg, mes: '', extra: {...msg.extra,
// [Symbol.for('ignore')]: true}}: the history builder skips it, world info sees an empty string, and the real chat
// message (and its shared `extra`) is never touched, so nothing persists past this generation. Mutating the shared
// `extra` in place would leak the flag into the live chat. The slot is kept (not spliced) so depth counting and
// non-OpenAI doChatInject (script.js:4686) positions stay put.

import { str, isPlainObject, clip, clipWords, stripThink, hashText, hashNumber, publicPart, fillProvided, usesToken } from '../common/text.js';
import { anchor, cleanOf, userName, charName } from '../common/chat.js';
import { optBool, optNum, opt, jobPrompt, sget, sset } from '../common/settings.js';
import { reconcile, storable, chunkMessages } from './archive.js';
import { buildIndex, rank, passageScore, recallTokens } from './tfidf.js';

export const DEFAULTS = Object.freeze({
    'memory.enabled': false,
    'memory.window': 30,
    'memory.chunk': 10,
    'memory.summaries': true,
    'memory.recall': 'keyword',
    'memory.recall_slots': 3,
    'memory.recall_words': 190,
});

export const SCHEMA = [
    { key: 'memory.enabled', tab: 'memory', section: 'Memory', type: 'toggle', default: false, label: 'Long-chat memory',
        help: 'Keep the newest messages raw; older ones leave the prompt and come back as summaries and relevant recalls (after the chat history, so prompt caching survives).', scope: 'setup' },
    { key: 'memory.window', tab: 'memory', section: 'Memory', type: 'slider', default: 30, min: 6, max: 200, step: 2, label: 'Working window (messages)',
        help: 'The newest messages always sent as written.', scope: 'setup' },
    { key: 'memory.chunk', tab: 'memory', section: 'Memory', type: 'slider', default: 10, min: 4, max: 40, step: 2, label: 'Chunk size (messages)',
        help: 'Older messages are archived (and summarized) in groups of this size.', scope: 'setup' },
    { key: 'memory.summaries', tab: 'memory', section: 'Memory', type: 'toggle', default: true, label: 'Summaries (background job)',
        help: 'After a reply, one short background request summarizes each new chunk. Off = archived chunks come back only through recall.', scope: 'setup' },
    { key: 'memory.recall', tab: 'memory', section: 'Memory', type: 'select', default: 'keyword', label: 'Recall',
        options: [{ value: 'keyword', label: 'Keywords' }, { value: 'semantic', label: 'Semantic (SillyTavern vectors)' }, { value: 'off', label: 'Off' }],
        help: 'How older passages relevant to your newest message are found. Semantic uses SillyTavern\'s local embeddings when available, else keywords.', scope: 'setup' },
    { key: 'memory.recall_slots', tab: 'memory', section: 'Memory', type: 'slider', default: 3, min: 0, max: 6, step: 1, label: 'Recalled passages',
        help: 'At most this many older passages per turn.', scope: 'setup' },
    { key: 'memory.recall_words', tab: 'memory', section: 'Memory', type: 'number', default: 190, min: 60, max: 1200, advanced: true, label: 'Memory words per turn',
        help: 'Word budget for summaries and recalls together.', scope: 'setup' },
];

const SUMMARY_SYSTEM = [
    'You are the archivist of a long interactive story. Turn the messages you are given into a compact factual record for later recall.',
    'Output format, exactly, with nothing before or after:',
    '## <story time> — <place>',
    '- <fact>',
    'One "##" header per distinct time or place, in story order, each followed by 2 to 8 bullets. At most 180 words in total. Story time is in-story time; write "time unclear" when the text never says.',
    'Keep what matters later: events, decisions, promises, injuries, objects, secrets and who knows them, changes between people, open threads. For {{user}}: only what was visibly done or said aloud, never feelings, intentions or private thoughts. Nothing invented.',
].join('\n');
const SUMMARY_USER = '<previous_summary>\n{previous}\n</previous_summary>\n<messages range="{range}">\n{messages}\n</messages>\nWrite the record now.';
const MAX_SUMMARY_WORDS = 180;

function options(ctx, { forceSummaries = false } = {}) {
    return {
        window: optNum(ctx, 'memory.window', 30, 6, 400),
        chunk: optNum(ctx, 'memory.chunk', 10, 2, 60),
        summaries: forceSummaries || optBool(ctx, 'memory.summaries', true),
    };
}

/**
 * The chat the archive is computed over. During a swipe CORE hands providers ctx.chat WITHOUT the reply being
 * regenerated (ctx.regenerating = {index, ucId}); counting the window over that shorter list would shift the window by
 * one message, invalidate (and persist the loss of) the newest chunk, and give every swipe a different archive than
 * the reply it replaces. So while regenerating, the archive is computed over ctx.fullChat: the regenerated reply keeps
 * its place in the working window and the archive is exactly the one built after that reply arrived.
 */
export function archiveChat(ctx) {
    if (ctx?.regenerating && Array.isArray(ctx.fullChat)) return ctx.fullChat;
    return ctx?.chat;
}

/** Reconcile the archive with the chat; persists chunk changes to the store. */
export function view(ctx, opts = {}) {
    const stored = sget(ctx, 'chunks', []);
    const cache = sget(ctx, 'summary_cache', null);
    const summaryLookup = isPlainObject(cache) ? (id, hashes) => cache[`${id}|${hashText(hashes.join(','))}`] || null : null;
    const r = reconcile(archiveChat(ctx), stored, { ...options(ctx, opts), summaryLookup });
    if (r.changed) sset(ctx, 'chunks', storable(r.chunks));
    return r;
}

/** For CORE's api.memoryStats(). */
export function memoryStats(ctx) {
    if (!optBool(ctx, 'memory.enabled', false)) return { enabled: false, working: 0, archived: 0, summarized: 0, pending: 0, tokensSaved: 0, chunks: 0 };
    const v = view(ctx);
    const archived = v.chunks.filter(c => c.archived);
    const byUid = new Map(v.all.map(x => [x.uid, x]));
    const archivedChars = archived.reduce((n, c) => n + c.uids.reduce((m, u) => m + str(byUid.get(u)?.m?.mes).length, 0), 0);
    const summaryChars = archived.reduce((n, c) => n + (c.summaryValid ? str(c.summary.text).length : 0), 0);
    return {
        enabled: true,
        working: v.working,
        archived: archived.reduce((n, c) => n + c.uids.length, 0),
        summarized: v.chunks.filter(c => c.summaryValid).reduce((n, c) => n + c.uids.length, 0),
        pending: v.pendingCount,
        chunks: v.chunks.length,
        tokensSaved: Math.max(0, Math.ceil((archivedChars - summaryChars) / 3.5)),
    };
}

/** Mark archived messages so ST leaves them out of this generation's prompt. Returns how many were hidden. */
export function interceptor(ctx, chat) {
    if (!optBool(ctx, 'memory.enabled', false) || !Array.isArray(chat)) return 0;
    const v = view(ctx);
    if (!v.archivedUids.size) return 0;
    const sym = typeof ctx?.ignoreSymbol === 'symbol' ? ctx.ignoreSymbol : Symbol.for('ignore');
    let n = 0;
    for (let i = 0; i < chat.length; i++) {
        const m = chat[i];
        const uid = m?.extra?.uc_id;
        if (!uid || !v.archivedUids.has(String(uid)) || m.is_system) continue;
        chat[i] = { ...m, mes: '', extra: { ...m.extra, [sym]: true } };
        n++;
    }
    return n;
}

// ---------------------------------------------------------------------------------------------------------------------
// Recall

function queryText(ctx) {
    const a = anchor(ctx);
    const said = a.user ? publicPart(a.user.mes) : str(ctx?.lastUserText);
    if (said.length >= 16) return clip(said, 1200);
    return clip(`${said} ${a.reply ? cleanOf(a.reply).slice(-600) : ''}`, 1200);
}

const indexCache = new Map();
function chunkIndex(ctx, v) {
    const archived = v.chunks.filter(c => c.archived);
    const key = archived.map(c => `${c.id}:${hashText(c.hashes.join(','))}`).join('|');
    if (indexCache.has(key)) return indexCache.get(key);
    const names = { userName: userName(ctx), charName: charName(ctx) };
    const docs = archived.map(c => ({ id: c.id, msgs: chunkMessages(c, v.all, names), chunk: c }));
    const idx = { index: buildIndex(docs.map(d => ({ id: d.id, text: d.msgs.map(m => `${m.name}: ${m.text}`).join('\n') }))), docs };
    indexCache.set(key, idx);
    if (indexCache.size > 4) indexCache.delete(indexCache.keys().next().value);
    return idx;
}

/** The best ≤maxWords excerpt of a chunk for the matched terms: "Name: …sentence(s)…". */
export function excerpt(msgs, terms, maxWords = 45, { fallback = false } = {}) {
    let best = null;
    for (const m of msgs) {
        const sentences = m.text.split(/(?<=[.!?…]["”)]?)\s+/);
        for (let i = 0; i < sentences.length; i++) {
            const win = [sentences[i], sentences[i + 1] || ''].join(' ').trim();
            const s = passageScore(win, terms);
            if (s > 0 && (!best || s > best.s)) best = { s, name: m.name, text: win };
        }
    }
    if (!best && fallback) {
        // Semantic picks may share no keyword with the query: use the chunk's last reply instead.
        const m = [...msgs].reverse().find(x => !x.isUser) || msgs[msgs.length - 1];
        if (m) best = { name: m.name, text: m.text };
    }
    return best ? `${best.name}: ${clipWords(best.text, maxWords)}` : '';
}

/** Recall lines for the turn: [{slot:'uc_recall', text, priority}]. */
export function recallLines(ctx) {
    const v = view(ctx);
    const archived = v.chunks.filter(c => c.archived);
    if (!archived.length) return [];
    const budget = optNum(ctx, 'memory.recall_words', 190, 60, 1200);
    const lines = [];
    let used = 0;
    const words = t => str(t).split(/\s+/).filter(Boolean).length;
    // Summaries, newest first, within ~60% of the budget (all of it when recall is off).
    const mode = str(opt(ctx, 'memory.recall', 'keyword'));
    const slots = mode === 'off' ? 0 : Math.round(optNum(ctx, 'memory.recall_slots', 3, 0, 6));
    const sumBudget = slots ? budget * 0.6 : budget;
    const summarized = archived.filter(c => c.summaryValid).reverse();
    summarized.forEach((c, i) => {
        const text = Array.isArray(c.summary.sections) && c.summary.sections.length ? summaryLine(c.summary) : `[${c.summary.storyTime || c.storyTime || 'earlier'}] ${str(c.summary.text).replace(/\s+/g, ' ').trim()}`;
        if (used + words(text) > sumBudget && i > 0) return;
        used += words(text);
        lines.push({ slot: 'uc_recall', text, priority: Math.max(30, 64 - i * 2), source: `memory:summary:${c.id}` });
    });
    if (!slots) return lines;
    const q = queryText(ctx);
    const { index, docs } = chunkIndex(ctx, v);
    let picks = [];
    if (mode === 'semantic') {
        const sem = sget(ctx, 'semantic', null);
        if (isPlainObject(sem) && sem.q === hashText(q) && Array.isArray(sem.ids)) {
            const terms = [...new Set(recallTokens(q))];
            picks = sem.ids.filter(id => docs.some(d => d.id === id)).slice(0, slots).map(id => ({ id, terms, semantic: true }));
        }
    }
    if (!picks.length) picks = rank(index, q, slots);
    for (const p of picks) {
        const d = docs.find(x => x.id === p.id);
        if (!d) continue;
        const ex = excerpt(d.msgs, p.terms.length ? p.terms : recallTokens(q), 45, { fallback: !!p.semantic });
        if (!ex) continue;
        const text = `Recalled (${d.chunk.storyTime || 'earlier'}): ${ex}`;
        if (used + words(text) > budget) break;
        used += words(text);
        lines.push({ slot: 'uc_recall', text, priority: 60, source: `memory:recall:${d.id}` });
    }
    return lines;
}

// ---------------------------------------------------------------------------------------------------------------------
// Summary job

/** A summary flattened to one line: "[time — place] fact; fact / [time — place] fact". */
export function summaryLine(summary) {
    const secs = Array.isArray(summary?.sections) ? summary.sections : [];
    if (!secs.length) return str(summary?.text).replace(/\s+/g, ' ').trim();
    return secs.map(sec => `[${[sec.time, sec.place].filter(Boolean).join(' — ') || 'earlier'}] ${sec.bullets.join('; ')}`).join(' / ');
}

export function buildSummary(ctx, chunk, v) {
    const p = jobPrompt(ctx, 'memory_summary');
    const msgs = chunkMessages(chunk, v.all, { userName: userName(ctx), charName: charName(ctx) });
    const messagesText = msgs.map(m => `${m.name}: ${clip(m.text, 3000)}`).join('\n\n');
    const idx = v.chunks.findIndex(c => c.id === chunk.id);
    const prev = idx > 0 && v.chunks[idx - 1].summaryValid ? summaryLine(v.chunks[idx - 1].summary) : '';
    const tokens = {
        previous: prev || 'none',
        range: `${chunk.uids.length} messages${chunk.storyTime ? `, ending ${chunk.storyTime}` : ''}`,
        messages: messagesText,
        story_time: chunk.storyTime || 'time unclear',
    };
    let user = p.user || SUMMARY_USER;
    if (!usesToken(user, 'messages')) user = `${user}\n\n<messages>\n{messages}\n</messages>`;
    return { systemPrompt: p.system || SUMMARY_SYSTEM, prompt: fillProvided(user, tokens), responseLength: 500 };
}

/**
 * Strict parse of the archivist's record: "## <story time> — <place>" headers each followed by "- " bullets, at most
 * 180 words (extra bullets are dropped from the end). A short preamble before the first header is ignored; any other
 * stray line makes the result invalid. Returns {text, sections:[{time, place, bullets[]}], storyTime} or null.
 */
export function parseSummary(text) {
    let s = stripThink(text).replace(/```[a-z]*\n?/gi, '').replace(/<UC\b[\s\S]*?(?:<\/UC>|$)/gi, '');
    const first = s.search(/^\s*##\s/m);
    if (first === -1) return null;
    s = s.slice(first);
    const sections = [];
    for (const raw of s.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        const h = line.match(/^##\s*(.+)$/);
        if (h) {
            const [time, ...rest] = h[1].split(/\s+[—–-]\s+/);
            sections.push({ time: time.replace(/[*_#]/g, '').trim(), place: rest.join(' — ').replace(/[*_#]/g, '').trim(), bullets: [] });
            continue;
        }
        const b = line.match(/^[-*•]\s+(.+)$/);
        if (b && sections.length) { sections[sections.length - 1].bullets.push(b[1].replace(/<[^>]+>/g, '').trim()); continue; }
        return null;
    }
    const usable = sections.filter(x => x.bullets.length);
    if (!usable.length) return null;
    let words = 0;
    for (const sec of usable) {
        sec.bullets = sec.bullets.filter((bl) => { words += bl.split(/\s+/).length; return words <= MAX_SUMMARY_WORDS; });
    }
    const kept = usable.filter(x => x.bullets.length);
    if (!kept.length) return null;
    const timeOf = t => (/^time unclear$/i.test(t) ? '' : t);
    kept.forEach(x => { x.time = timeOf(x.time); });
    const md = kept.map(x => `## ${[x.time || 'time unclear', x.place].filter(Boolean).join(' — ')}\n${x.bullets.map(bl => `- ${bl}`).join('\n')}`).join('\n');
    return { text: md, sections: kept, storyTime: kept[kept.length - 1].time || '' };
}

/** Store a summary for chunk `meta` ({id, hashes, storyTime}). Ignored when the chunk is gone. */
export function applySummary(result, store, meta) {
    if (!result?.text || !meta?.id || !store?.get) return false;
    const chunks = Array.isArray(store.get('chunks')) ? store.get('chunks') : [];
    const summary = { text: result.text, sections: Array.isArray(result.sections) ? result.sections : undefined, hashes: meta.hashes, storyTime: result.storyTime || meta.storyTime || '', at: Date.now() };
    const cache = isPlainObject(store.get('summary_cache')) ? { ...store.get('summary_cache') } : {};
    cache[`${meta.id}|${hashText((meta.hashes || []).join(','))}`] = summary;
    const keys = Object.keys(cache);
    for (const k of keys.slice(0, Math.max(0, keys.length - 60))) delete cache[k];
    store.set('summary_cache', cache);
    let hit = false;
    const next = chunks.map(c => (c.id === meta.id ? (hit = true, { ...c, summary }) : c));
    if (hit) store.set('chunks', next);
    return hit;
}

function summaryMeta(c) {
    return { id: c.id, hashes: c.hashes, storyTime: c.storyTime || '' };
}

export const jobs = {
    memory_summary: {
        build(ctx) {
            const v = view(ctx);
            const c = v.needSummary[0];
            if (!c) return null;
            sset(ctx, 'pending_summary', summaryMeta(c));
            return buildSummary(ctx, c, v);
        },
        parse: parseSummary,
        apply(result, store, spec) { applySummary(result, store, spec?.meta || store?.get?.('pending_summary')); },
    },
};

// ---------------------------------------------------------------------------------------------------------------------
// Semantic recall (optional; CORE provides ctx.vectors and awaits prefetch(ctx) before building the prompt)

function windows(text, size = 1200) {
    const out = [];
    for (let i = 0; i < text.length && out.length < 32; i += size) out.push(text.slice(i, i + size));
    return out;
}

/**
 * Sync archived chunks into the vector store and query it for the newest player message. Never throws.
 * ctx.vectors (CORE st.vectors): {list() → hashes[], insert([{hash, text, index}]), remove(hashes[]), query(text, topK) → {hashes[], metadata[]}}.
 */
export async function prefetch(ctx) {
    try {
        if (!optBool(ctx, 'memory.enabled', false) || str(opt(ctx, 'memory.recall', 'keyword')) !== 'semantic' || !ctx?.vectors) return false;
        const v = view(ctx);
        const { docs } = chunkIndex(ctx, v);
        const want = new Map();
        for (const d of docs) {
            const text = d.msgs.map(m => `${m.name}: ${m.text}`).join('\n');
            windows(text).forEach((w, n) => want.set(hashNumber(`${d.id}#${n}#${hashText(text)}`), { text: w, id: d.id }));
        }
        const vec = isPlainObject(sget(ctx, 'vectors', null)) ? sget(ctx, 'vectors', {}) : { synced: {} };
        const synced = isPlainObject(vec.synced) ? vec.synced : {};
        // What the collection really holds (it may have been purged outside); else what we last inserted.
        let have = null;
        if (typeof ctx.vectors.list === 'function') {
            try { const l = await ctx.vectors.list(); if (Array.isArray(l)) have = new Set(l.map(Number)); } catch { have = null; }
        }
        if (!have) have = new Set(Object.keys(synced).map(Number));
        const insert = [...want.entries()].filter(([h]) => !have.has(h)).map(([hash, x], index) => ({ hash, text: x.text, index }));
        const remove = [...have].filter(h => !want.has(h));
        if (insert.length) await ctx.vectors.insert(insert);
        if (remove.length) await ctx.vectors.remove(remove);
        const next = {};
        for (const [h, x] of want) next[h] = x.id;
        sset(ctx, 'vectors', { synced: next });
        const q = queryText(ctx);
        const res = await ctx.vectors.query(q, 12);
        const ids = [];
        for (const h of Array.isArray(res?.hashes) ? res.hashes : []) {
            const id = next[h] || next[Number(h)];
            if (id && !ids.includes(id)) ids.push(id);
        }
        sset(ctx, 'semantic', { q: hashText(q), ids });
        return true;
    } catch {
        return false;
    }
}

export default {
    id: 'memory',
    settingsKeys: Object.keys(DEFAULTS),
    jobs,
    interceptor,
    prefetch,
    stats: memoryStats,
    turnLines(ctx) {
        if (!optBool(ctx, 'memory.enabled', false)) return [];
        return recallLines(ctx);
    },
    onReply(ctx) {
        // A manual run (Advanced/Memory tab "run now": CORE sets ctx.manualJob) ignores the summaries switch, but still
        // needs memory itself on: without it there is no archive to summarize.
        const manual = ctx?.manualJob === 'memory_summary';
        if (!optBool(ctx, 'memory.enabled', false) || (!manual && !optBool(ctx, 'memory.summaries', true))) return [];
        const v = view(ctx, { forceSummaries: manual });
        return v.needSummary.slice(0, manual ? 1 : 2).map((c) => {
            const meta = summaryMeta(c);
            return {
                kind: 'memory_summary', provider: 'memory', dedupeKey: `memory_summary:${c.id}:${hashText(c.hashes.join(','))}`, meta,
                buildRequest: () => buildSummary(ctx, c, v),
                parse: parseSummary,
                apply: (result, store) => applySummary(result, store || ctx.store, meta),
            };
        });
    },
};
