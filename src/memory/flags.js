// The review list (memory DESIGN 7.4, 3.5 Lock). Model findings that clash with your World Info entries or with records you
// locked become flags; nothing in a flag changes your book or your records. Each flag shows both texts and their quotes,
// with four actions:
//   Edit my entry      opens the entry in SillyTavern's World Info editor;
//   Keep mine          marks the pair so it is not raised again;
//   The story changed  adds a record that replaces your entry for this chat only and leaves the entry as written;
//   Dismiss            takes the flag off the list.
// Flags are `flag` entries in the chat's change log, so they travel with the chat; Keep mine is a `keep` entry and the story
// record is an `add` from you, so each action survives a reload and can be undone.
import { MEMORY, swipeEntries } from './fold.js';
import { bare, canonicalSubject, contentWords, overlapCoefficient, pairKey } from './similarity.js';

export const FLAG_KINDS = Object.freeze({
    entryClash: 'entry-clash',         // the story contradicts one of your entries
    entryDuplicate: 'entry-duplicate', // two of your entries say the same thing (TunnelVision's planted paraphrases)
    entryContradiction: 'entry-contradiction', // two of your entries contradict each other
    recordClash: 'record-clash',       // two records contradict and the story does not show which holds
    locked: 'locked-record',           // a model entry would change a record you locked (raised by the fold)
});
export const ACTIONS = Object.freeze(['edit-mine', 'keep-mine', 'story-changed', 'dismiss']);
export const ACTION_LABELS = Object.freeze({ 'edit-mine': 'Edit my entry', 'keep-mine': 'Keep mine', 'story-changed': 'The story changed', dismiss: 'Dismiss' });

/** The id of an entry in a book: "book#uid". */
export const entryRef = (book, uid) => `${book}#${uid}`;
const titleOf = entry => String(entry.comment || [].concat(entry.key || [])[0] || `Entry ${entry.uid}`);
const keyNames = entry => [titleOf(entry), ...[].concat(entry.key || [])].map(String).filter(k => k && !k.startsWith('/'));

/** True when two entries name the same subject: a shared key or title, or the same first proper word of the title. */
function sameSubjectEntries(a, b) {
    const A = new Set(keyNames(a).map(bare)), B = keyNames(b).map(bare);
    if (B.some(k => A.has(k))) return true;
    const ca = canonicalSubject(titleOf(a)), cb = canonicalSubject(titleOf(b));
    return !!ca && ca.length >= 3 && ca === cb;
}

/** True when an entry is about a record's subject (a key, the title, or the record's aliases). */
function entryNamesRecord(entry, record) {
    const mine = new Set(keyNames(entry).map(bare));
    if ([record.subject, ...(record.aliases || [])].filter(Boolean).some(n => mine.has(bare(n)))) return true;
    const head = canonicalSubject(record.subject);
    return !!head && head.length >= 3 && [...mine].some(n => canonicalSubject(n) === head);
}

/**
 * Candidate pairs for the Cleanup call to rule on: each of your entries against the current records about its subject
 * that share some of its words, and pairs of your entries that name the same subject. books: [{ name, data }].
 * kept: pair keys you marked Keep mine. Returns [{ pair, a, b }] where a and b are { ref, book?, uid?, record?, title, text }.
 */
export function entryPairs(books, records = [], { kept = new Set(), limit = 40 } = {}) {
    const out = [];
    const all = books.flatMap(book => Object.values(book.data?.entries || {}).filter(e => e && !e.disable && String(e.content || '').trim()).map(entry => ({ book: book.name, entry })));
    const side = ({ book, entry }) => ({ ref: entryRef(book, entry.uid), book, uid: entry.uid, title: titleOf(entry), text: String(entry.content || '') });
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
        if (!sameSubjectEntries(all[i].entry, all[j].entry)) continue;
        const a = side(all[i]), b = side(all[j]);
        const pair = pairKey(a.ref, b.ref);
        if (!kept.has(pair)) out.push({ pair, a, b });
    }
    const live = records.filter(r => !['retired', 'replaced', 'merged', 'suspect'].includes(r.status) && !['chapter', 'condensed', 'arc', 'scene'].includes(r.kind) && !r.overrides);
    for (const item of all) for (const record of live) {
        if (!entryNamesRecord(item.entry, record)) continue;
        if (overlapCoefficient(contentWords(record.text), contentWords(item.entry.content)) < 0.2) continue;
        const a = side(item);
        const pair = pairKey(a.ref, `record:${record.id}`);
        if (!kept.has(pair)) out.push({ pair, a, b: { ref: `record:${record.id}`, record: record.id, title: record.subject || record.id, text: String(record.text || ''), quote: record.evidence?.[0]?.quote || '' } });
    }
    return out.slice(0, limit);
}

/**
 * Flag entries for the pairs a Cleanup answer ruled a clash or a duplicate. rulings: [{ pair, ruling, reason }] with ruling
 * one of clash, duplicate, fine. Returns store inputs (op flag); nothing else changes.
 */
export function flagInputs(rulings, pairs, origin, { raised = new Set() } = {}) {
    const inputs = [];
    for (const ruling of [].concat(rulings || [])) {
        const p = pairs.find(x => x.pair === ruling?.pair);
        if (!p || !['clash', 'duplicate'].includes(ruling.ruling) || raised.has(p.pair)) continue;
        const story = !!p.b.record;
        const kind = story ? FLAG_KINDS.entryClash : ruling.ruling === 'clash' ? FLAG_KINDS.entryContradiction : FLAG_KINDS.entryDuplicate;
        if (story && ruling.ruling !== 'clash') continue;   // a record that repeats your entry is held out at injection (7.3), not flagged
        raised.add(p.pair);
        inputs.push({
            op: 'flag', target: [p.a.ref, p.b.ref],
            record: { kind, pair: p.pair, a: { ...p.a }, b: { ...p.b }, subject: p.a.title },
            origin, reason: String(ruling.reason || (story ? `The story contradicts your entry ${p.a.title}.` : `Your entries ${p.a.title} and ${p.b.title} ${ruling.ruling === 'clash' ? 'contradict each other' : 'say the same thing'}.`)).slice(0, 160),
        });
    }
    return inputs;
}

// ---------------------------------------------------------------- the list

function allEntries(chat, meta) {
    const out = [];
    for (const message of chat || []) out.push(...swipeEntries(message));
    out.push(...(meta?.[MEMORY]?.log || []));
    return out;
}

/** The pair keys you marked Keep mine: `keep` entries on "pair:" targets that count in the fold. */
export function keptPairs(chat, meta, result) {
    const applied = new Set(result.applied);
    const out = new Set();
    for (const e of allEntries(chat, meta)) if (e.op === 'keep' && applied.has(e.id)) for (const t of e.target || []) if (String(t).startsWith('pair:')) out.add(String(t).slice(5));
    return out;
}

/** The pairs flagged at any time that still count (raised, not dismissed), so a run does not raise them again. */
export const raisedPairs = result => new Set(result.flags.map(f => f.record?.pair).filter(Boolean));

/**
 * The review list: every flag that counts, minus pairs you kept, newest first, each with both texts, their quotes and the
 * four actions. Locked-record flags carry the record and the change that was held.
 */
export function reviewList(chat, meta, result) {
    const kept = keptPairs(chat, meta, result);
    return result.flags.filter(f => !(f.record?.pair && kept.has(f.record.pair))).map(f => {
        const r = f.record || {};
        if (f.kind === FLAG_KINDS.locked) {
            const target = result.byId.get(f.target[0]);
            return { entry: f.entry, kind: f.kind, title: target?.subject || f.target[0], mine: { text: target?.text || '', record: f.target[0] }, theirs: { text: r.text || '', quote: f.evidence?.[0]?.quote || '' }, reason: f.reason, actions: ['keep-mine', 'dismiss'] };
        }
        return { entry: f.entry, kind: f.kind, pair: r.pair || '', title: r.subject || r.a?.title || '', mine: r.a || {}, theirs: r.b || {}, reason: f.reason, actions: [...ACTIONS] };
    }).reverse();
}

/**
 * Do one of the four actions on a flag. store: the memory store; flag: a row of reviewList.
 * openBook(book, uid): opens the World Info editor (Edit my entry). Resolves what was done.
 */
export async function resolveFlag(store, flag, action, { openBook = () => false } = {}) {
    if (!ACTIONS.includes(action) || !flag?.actions?.includes(action)) throw new Error(`The action ${action} does not apply to this flag.`);
    if (action === 'edit-mine') return { opened: !!(await openBook(flag.mine.book, flag.mine.uid)), book: flag.mine.book, uid: flag.mine.uid };
    if (action === 'dismiss') { await store.revert(flag.entry, 'Dismissed from the review list.'); return { dismissed: flag.entry }; }
    if (action === 'keep-mine') {
        if (flag.kind === FLAG_KINDS.locked) { await store.revert(flag.entry, 'Kept your locked record.'); return { kept: flag.mine.record }; }
        await store.record([{ op: 'keep', target: [`pair:${flag.pair}`], origin: { type: 'you' }, reason: `Keep mine: ${flag.title}`.slice(0, 160) }]);
        return { kept: flag.pair };
    }
    // The story changed: a record for this chat that replaces the entry and leaves the entry as written.
    const id = `story-${bare(flag.title).replace(/ /g, '-').slice(0, 40) || 'entry'}-${String(flag.entry).slice(-6)}`;
    const text = String(flag.theirs.text || '').slice(0, 300);
    const out = await store.record([
        { op: 'add', record: { id, kind: 'fact', subject: flag.title, attribute: 'replaces your entry', text, status: 'current', importance: 7, overrides: { book: flag.mine.book, uid: flag.mine.uid } },
            ...(flag.theirs.quote ? { evidence: [{ quote: flag.theirs.quote }] } : {}), origin: { type: 'you' }, reason: `The story changed: replaces ${flag.title} for this chat.`.slice(0, 160) },
    ]);
    await store.lock(id, 'Filed by you from the review list.');
    await store.revert(flag.entry, 'Answered: the story changed.');
    return { replaced: { book: flag.mine.book, uid: flag.mine.uid }, record: id, entries: out.entries };
}

/** Your entries that a "The story changed" record replaces in this chat: [{ book, uid, record }]. Injection leaves them out. */
export const overriddenEntries = result => result.current.filter(r => r.overrides?.book !== undefined).map(r => ({ book: r.overrides.book, uid: r.overrides.uid, record: r.id }));
