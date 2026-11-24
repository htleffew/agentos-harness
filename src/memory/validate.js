// The five checks code applies to a capture answer (memory DESIGN 7.2, M1f 7.3), plus the no-change filter MB11 asked for.
// Pure code over the answer, the exchange it read and the current records, so tests and the harness run it with no host.
//
//   1. The answer has the schema's shape (the route already parsed it; one repair retry ran there).
//   2. Each quote is in its cited message after folding case and whitespace, or within Dice 0.9 for punctuation drift.
//   3. Every target id exists and is in force.
//   4. An entry aimed at a locked record becomes a review flag.
//   5. An add identical to a current record is dropped; one that only resembles one is held as a suspect.
// Then the no-change filter: an answer that says nothing lasting changed files nothing, and an op that only repeats what a
// record already holds is dropped. A claim found only inside a character's spoken line is filed as that speaker's statement.
// Every record this writes keeps the report register (DECISIONS, 23 November): an op whose text carries mood language outside
// a quoted line is dropped, except on the Emotion and Relationship kinds, which hold that state by design.

export const KINDS = Object.freeze(['fact', 'person', 'trait', 'place', 'item', 'secret', 'relationship', 'emotion', 'reputation', 'achievement', 'thread']);
export const THREAD_TYPES = Object.freeze(['Open', 'Plotline', 'Track', 'Seed', 'Detail', 'Pending', 'Plan', 'Elsewhere']);
export const CAPTURE_OPS = Object.freeze(['add', 'revise', 'supersede', 'retire', 'complete']);
export const MAX_OPS = 12;
export const diceNearDuplicate = 0.85;     // Dice on character bigrams; DESIGN 4.3 names each threshold for its measure
export const diceQuoteDrift = 0.9;
export const diceRestatement = 0.6;
const TEXT_MAX = 300, QUOTE_MAX = 200;

/** Fold case, quotes and whitespace so a quote matches across the punctuation drift models add. */
export const fold = text => String(text ?? '').normalize('NFKC').toLowerCase()
    .replace(/[‘’‛`]/g, "'").replace(/[“”„]/g, '"').replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ').trim();
const bare = text => fold(text).replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();

function bigrams(text) {
    const s = bare(text).replace(/ /g, '');
    const out = new Map();
    for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); out.set(g, (out.get(g) || 0) + 1); }
    return out;
}
/** Dice coefficient on character bigrams, 0 to 1. */
export function dice(a, b) {
    const x = bigrams(a), y = bigrams(b);
    let n = 0, total = 0;
    for (const v of x.values()) total += v;
    for (const v of y.values()) total += v;
    if (!total) return 0;
    for (const [g, v] of x) n += Math.min(v, y.get(g) || 0);
    return (2 * n) / total;
}

/** True when `quote` occurs in `text`: folded containment, or a window of the same length within Dice 0.9. */
export function quoteIn(quote, text) {
    const q = fold(quote).replace(/^["'\s.…]+|["'\s.…]+$/g, '');
    const t = fold(text);
    if (q.length < 4) return false;
    if (t.includes(q)) return true;
    const qb = bare(q), tb = bare(t);
    if (qb.length >= 4 && tb.includes(qb)) return true;
    // Two quoted pieces joined with an ellipsis: each piece must be there, in order.
    const pieces = q.split(/\s*(?:\.\.\.|…)\s*/).map(p => bare(p)).filter(p => p.length >= 4);
    if (pieces.length > 1) {
        let at = 0;
        if (pieces.every(p => { const i = tb.indexOf(p, at); if (i < 0) return false; at = i + p.length; return true; })) return true;
    }
    const words = tb.split(' '), size = qb.split(' ').length;
    for (let i = 0; i + size <= words.length; i++) {
        const window = words.slice(i, i + size).join(' ');
        if (dice(window, qb) >= diceQuoteDrift) return true;
    }
    return false;
}

// ---------------------------------------------------------------- dialogue and speakers

/** The spoken spans of a text: everything inside straight or curly double quotes. */
export function spokenSpans(text) {
    const s = String(text ?? '');
    const spans = [];
    for (const m of s.matchAll(/"([^"]+)"|“([^”]+)”/g)) spans.push({ start: m.index, end: m.index + m[0].length, text: m[1] ?? m[2] });
    return spans;
}

const SAID = '(?:said|says|asked|told|answered|replied|called|shouted|whispered|added|went on|reported|warned|admitted|explained)';
/** Who speaks a span: "X said" just after it, or "X said," just before it, else the name that opens the paragraph. */
export function speakerOf(text, span, cast = []) {
    const s = String(text ?? '');
    const after = s.slice(span.end, span.end + 60);
    const before = s.slice(Math.max(0, span.start - 80), span.start);
    const name = "([A-Z][\\p{L}'-]+(?: [A-Z][\\p{L}'-]+){0,2})";
    const a = new RegExp(`^[,.!?]?\\s*${name}\\s+${SAID}\\b`, 'u').exec(after) || new RegExp(`^[,.!?]?\\s*${SAID}\\s+${name}`, 'u').exec(after);
    if (a) return a[1];
    const b = new RegExp(`${name}\\s+${SAID}[^."]{0,30}[,:]?\\s*$`, 'u').exec(before);
    if (b && !PRONOUN.test(b[1])) return b[1];
    // "he said" and "she said" point at the person the narration last named before the line.
    const pronoun = new RegExp(`^[,.!?]?\\s*(?:he|she|they)\\s+${SAID}\\b`, 'iu').test(after) || new RegExp(`\\b(?:he|she|they)\\s+${SAID}[^."]{0,30}[.,:]?\\s*$`, 'iu').test(before);
    const para = s.lastIndexOf('\n', span.start);
    const lead = s.slice(Math.max(para + 1, span.start - 240), span.start).replace(/"[^"]*"|“[^”]*”/g, ' ');
    const names = [...lead.matchAll(/(?:^|[^\p{L}])([A-Z][\p{L}'-]{1,})/gu)].map(m => m[1]).filter(w => !PRONOUN.test(w) && !NOT_NAMES.has(w.toLowerCase()));
    if (pronoun && names.length) return names.at(-1);
    const opening = /^\s*([A-Z][\p{L}'-]+)/u.exec(s.slice(para + 1, span.start));
    if (opening && cast.some(c => fold(c).split(' ')[0] === fold(opening[1]))) return opening[1];
    return '';
}
const PRONOUN = /^(?:he|she|they|it|i|we|you)$/i;
const NOT_NAMES = new Set('the a an and but then when while after before at in on by for with from his her their its this that there these those one two at last ahead'.split(' '));

const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The words of `piece` as they are written in `text` (case, punctuation and quote marks as in the message), or ''. */
function spanOf(piece, text) {
    const words = bare(piece).split(' ').filter(Boolean);
    if (!words.length) return '';
    const m = new RegExp(words.map(escape).join('[^\\p{L}\\p{N}]+'), 'iu').exec(String(text ?? ''));
    return m ? m[0] : '';
}
/**
 * The quote as the message has it. A quote stored with an entry is copied from its message, so it is always in the
 * message word for word: a quote the model wrote with drifted punctuation or an ellipsis keeps the longest exact piece.
 */
export function exactQuote(quote, text) {
    const pieces = fold(quote).replace(/^["'\s]+|["'\s]+$/g, '').split(/\s*(?:\.\.\.|…)\s*/).filter(p => bare(p).length >= 4);
    const found = pieces.map(p => spanOf(p, text)).filter(Boolean).sort((a, b) => b.length - a.length);
    if (found.length) return found[0];
    const words = bare(text).split(' '), size = bare(quote).split(' ').length;
    let best = '', score = 0;
    for (let i = 0; i + size <= words.length; i++) {
        const window = words.slice(i, i + size).join(' ');
        const d = dice(window, quote);
        if (d > score) { score = d; best = window; }
    }
    return score >= diceQuoteDrift ? spanOf(best, text) : '';
}

/** Where a quote sits in the exchange: { in: 'reply'|'player'|'', exact, spoken, speaker }. */
export function locateQuote(quote, { prose = '', player = '', cast = [] } = {}) {
    const where = quoteIn(quote, prose) ? 'reply' : quoteIn(quote, player) ? 'player' : '';
    const exact = where ? exactQuote(quote, where === 'reply' ? prose : player) : '';
    if (where !== 'reply') return { in: exact ? where : '', exact, spoken: false, speaker: '' };
    if (!exact) return { in: '', exact, spoken: false, speaker: '' };
    // Spoken when most of the quote's letters sit inside quotation marks; the speaker is the one of the first such line.
    const at = String(prose).indexOf(exact), end = at + exact.length;
    const spans = spokenSpans(prose).filter(span => span.end > at && span.start < end);
    const inside = spans.reduce((n, span) => n + Math.max(0, Math.min(end, span.end) - Math.max(at, span.start)), 0);
    if (at >= 0 && spans.length && inside >= 0.6 * exact.length) return { in: where, exact, spoken: true, speaker: speakerOf(prose, spans[0], cast) };
    return { in: where, exact, spoken: false, speaker: '' };
}

// ---------------------------------------------------------------- register

// Mood language outside a quoted line (the MB11 register scenario's list, kept here so the extension needs no harness file).
const MOOD = ['terrified', 'terror', 'afraid', 'fear', 'feared', 'fearful', 'dread', 'dreaded', 'anxious', 'anxiety', 'worried', 'worry', 'nervous', 'panic', 'panicked',
    'heart', 'tears', 'tearful', 'wept', 'sobbed', 'longing', 'yearned', 'yearning', 'ached', 'aching', 'felt', 'feeling', 'feelings', 'hoped', 'hopeful', 'wished',
    'loved', 'adored', 'cherished', 'hated', 'despair', 'desperate', 'desperately', 'grief', 'grieved', 'sorrow', 'sorrowful', 'joy', 'joyful', 'happy', 'sad', 'sadly', 'bitterly',
    'angry', 'furious', 'rage', 'resentful', 'resentment', 'jealous', 'ashamed', 'shame', 'guilt', 'guilty', 'lonely', 'loneliness', 'miserable', 'anguish', 'anguished', 'haunted',
    'trembling', 'trembled', 'shuddered', 'wondered', 'thought', 'believed', 'sensed', 'suspected', 'realized', 'dreamed', 'imagined', 'inwardly', 'mood', 'atmosphere', 'ominous', 'foreboding', 'uneasy', 'uneasily', 'bittersweet'];
const MOOD_RE = new RegExp(`\\b(${MOOD.join('|')})\\b`, 'i');
const unquoted = text => String(text ?? '').replace(/"[^"]*"/g, ' ').replace(/“[^”]*”/g, ' ');
/** Mood words outside quotation marks, or ''. */
export const moodWord = text => (MOOD_RE.exec(unquoted(text)) || [])[1] || '';
const FEELING_KINDS = new Set(['emotion', 'relationship']);

// ---------------------------------------------------------------- restatement

const STOP = new Set('the a an and or of to in on at by for with from into that this then they them their there were was is are be been has have had his her its he she it we you i not no but as so if than after before about over under again still now one two'.split(' '));
/** The content of a claim: numbers and words of four letters or more, stemmed lightly, without stop words. */
export function contentTerms(text) {
    return [...new Set(bare(text).split(' ').filter(w => /\d/.test(w) || (w.length >= 4 && !STOP.has(w))).map(w => w.replace(/(?:ing|ed|es|s)$/u, '')))];
}
/** True when every content term of `text` is already in one of `texts` (the op adds nothing a record holds). */
export function restates(text, texts) {
    const terms = contentTerms(text);
    if (!terms.length) return true;
    return texts.some(other => {
        const have = new Set(contentTerms(other));
        return terms.every(term => have.has(term)) || dice(text, other) >= diceNearDuplicate;
    });
}

// An arrival, a crossing or who stands where (MB11: most no-change replies that still filed something filed these). A claim
// with a purpose, a carried thing, a count or a report stays: "Dunn rode ahead to ask the harbormaster to hold the gate".
const MOVEMENT = /\b(arrived|arrives|crossed|crosses|came into|comes into|reached|reaches|was present|is present|were present|stood on|stood at|entered|enters)\b/i;
const MOVEMENT_KEEP = /\b(to ask|to find|to fetch|to warn|to hold|in order|so that|because|with (?:his|her|their|the|a)|carrying|bringing|said|says|reported|told|wagons?|ago)\b/i;

/** True when the player's message asks something: a question mark, or "I ask". */
export const asksQuestion = text => /\?|\b(?:ask|asks|asking|question)\b/i.test(String(text ?? ''));
const NUMBER_WORDS = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand dozen'.split(' ');
const numbersIn = text => new Set((bare(text).match(/\b(?:\d+|[a-z]+)\b/g) || []).filter(w => /^\d+$/.test(w) || NUMBER_WORDS.includes(w)));
/** True when `text` holds a number (digits or a number word) that none of `texts` holds. */
export function numbersNew(text, texts) {
    const have = new Set(texts.flatMap(t => [...numbersIn(t)]));
    return [...numbersIn(text)].some(n => !have.has(n));
}

// ---------------------------------------------------------------- the checks

const clip = (text, max) => { const v = String(text ?? '').replace(/\s+/g, ' ').trim(); return v.length <= max ? v : (v.slice(0, max).replace(/\s+\S*$/, '') || v.slice(0, max)); };
const slug = text => bare(text).split(' ').filter(Boolean).slice(0, 6).join('-').slice(0, 60) || 'record';
// Lower the first letter only when the sentence opens with a common word, so a name keeps its capital.
const lcFirst = text => text && /^(?:The|A|An|He|She|They|It|There|This|That|His|Her|Their|Its|We|You|Every|No|One|Two|Three)\b/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
const inForce = rec => rec && !['retired', 'replaced', 'merged', 'suspect'].includes(rec.status);
const sameRecord = (a, b) => fold(a.kind) === fold(b.kind) && fold(a.subject) === fold(b.subject) && fold(a.attribute || '') === fold(b.attribute || '') && bare(a.text) === bare(b.text);
const resembles = (a, b) => fold(a.kind) === fold(b.kind) && fold(a.subject) === fold(b.subject)
    && ((a.attribute && fold(a.attribute) === fold(b.attribute || '')) || dice(a.text, b.text) >= diceNearDuplicate);

/** The record an op carries, in the shape of DESIGN 3.2 and the kinds of 3.3. */
export function recordOf(op, { id }) {
    const kind = KINDS.includes(op.kind) ? op.kind : 'fact';
    const rec = { id, kind, subject: clip(op.subject, 120), text: clip(op.text, TEXT_MAX), status: 'current', importance: Math.max(1, Math.min(10, Math.round(Number(op.importance) || 5))) };
    if (op.attribute) rec.attribute = clip(op.attribute, 60);
    if (kind === 'thread') { rec.threadType = THREAD_TYPES.includes(op.thread_type) ? op.thread_type : 'Open'; if (op.status === 'done' || op.status === 'failed') rec.status = op.status; }
    if (Array.isArray(op.holders) && op.holders.length) rec.holders = op.holders.map(h => clip(h, 80)).filter(Boolean).slice(0, 8);
    if (Array.isArray(op.aliases) && op.aliases.length) rec.aliases = op.aliases.map(a => clip(a, 80)).filter(Boolean).slice(0, 8);
    if (op.outcome) rec.outcome = clip(op.outcome, TEXT_MAX);
    if (op.story_time) rec.story_time = clip(op.story_time, 60);
    // Kind fields (3.3): item holder and change, relationship pair and route, reputation standing, achievement rarity,
    // a secret's false belief, a pending thread's due time and stakes.
    for (const { field, value } of [].concat(op.details || [])) {
        const key = String(field || '').toLowerCase().replace(/[^a-z_]/g, '');
        if (key && value !== undefined && value !== '' && !['id', 'kind', 'status', 'text', 'subject'].includes(key)) rec[key] = clip(value, 200);
    }
    if (op.believes) rec.believes = clip(op.believes, 200);
    // An Emotion record keeps its four axes, each 0 to 10 (the Emotions card reads them).
    if (kind === 'emotion' && op.axes && typeof op.axes === 'object') rec.axes = Object.fromEntries(['tenderness', 'fury', 'dread', 'yearning'].filter(a => Number.isFinite(Number(op.axes[a]))).map(a => [a, Math.max(0, Math.min(10, Math.round(Number(op.axes[a]))))]));
    return rec;
}

/**
 * Apply the checks to one capture answer.
 *   answer: { decisions, state, ops, rulings }
 *   exchange: { prose, player, cast, mark, swipe, playerMark }
 *   records: the fold's records (all of them, with status); suspects: records held as suspects
 * Returns { inputs, dropped, flags, suspectsRuled, state, decisions } where inputs are store entries without anchors.
 */
export function checkCapture(answer, exchange, { records = [], route = '', model = '', callId = '' } = {}) {
    const dropped = [];
    const inputs = [];
    const decisions = { scene_ended: !!answer?.decisions?.scene_ended, durable_change: answer?.decisions?.durable_change !== false, out_of_character: !!answer?.decisions?.out_of_character };
    const byId = new Map(records.map(r => [String(r.id), r]));
    const current = records.filter(inForce);
    const origin = { type: 'capture', route, model, call: callId };
    const ops = Array.isArray(answer?.ops) ? answer.ops.slice(0, MAX_OPS) : [];
    if (Array.isArray(answer?.ops) && answer.ops.length > MAX_OPS) dropped.push({ op: null, why: `only the first ${MAX_OPS} entries are read` });
    if (decisions.out_of_character) { for (const op of ops) dropped.push({ op, why: 'the exchange was out of character' }); return { inputs, dropped, decisions, state: answer?.state || {}, rulings: [] }; }
    if (!decisions.durable_change) for (const op of ops) dropped.push({ op, why: 'the call answered that nothing lasting changed' });

    const taken = new Set(records.map(r => String(r.id)));
    const evidence = loc => [{ mark: loc.in === 'player' ? exchange.playerMark || exchange.mark : exchange.mark, ...(loc.in === 'reply' && Number.isInteger(exchange.swipe) ? { swipe: exchange.swipe } : {}), quote: '' }];
    for (const op of decisions.durable_change ? ops : []) {
        if (!op || typeof op !== 'object' || !CAPTURE_OPS.includes(op.op) || !String(op.text ?? '').trim() && op.op !== 'retire') { dropped.push({ op, why: 'the entry does not have the schema\'s shape' }); continue; }
        // 2. The quote.
        const loc = locateQuote(op.quote, exchange);
        if (!loc.in) { dropped.push({ op, why: 'its quote is not in the exchange' }); continue; }
        const quote = clip(loc.exact, QUOTE_MAX);
        // Register: no mood outside a quoted line, except where the kind holds feelings by design.
        const mood = !FEELING_KINDS.has(op.kind) && moodWord(op.text);
        if (mood) { dropped.push({ op, why: `mood language in a record ("${mood}")` }); continue; }
        // A claim made only in a spoken line is filed as what that speaker said.
        const claim = clip(op.text, TEXT_MAX);
        let text = claim;
        let speaker = '';
        if (loc.spoken && !['emotion', 'relationship', 'person'].includes(op.kind)) {
            speaker = clip(op.speaker || loc.speaker, 80);
            if (speaker && !new RegExp(`^${speaker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[^.]{0,40}\\b(said|says|told|reported|claimed|stated|asked)\\b`, 'i').test(text)) text = clip(`${speaker} said that ${lcFirst(text.replace(/\.$/, ''))}.`, TEXT_MAX);
        }
        const targets = [].concat(op.target || []).map(String).filter(Boolean);
        // A complete or retire that names its record only in `id` acts on that record.
        if (!targets.length && ['retire', 'complete'].includes(op.op) && inForce(byId.get(String(op.id || '')))) targets.push(String(op.id));
        const ev = [{ ...evidence(loc)[0], quote }];
        // 3. Targets in force. A complete, retire or supersede with no target has nothing to act on.
        if (['supersede', 'retire', 'complete'].includes(op.op) && !targets.length) { dropped.push({ op, why: 'it names no record to act on' }); continue; }
        // An answer to the player's question, spoken by a character about a subject already on record, is no change unless it
        // brings a number the record lacks (MB11: these were most of the remaining no-change replies that filed something).
        if (['add', 'revise'].includes(op.op) && loc.spoken && asksQuestion(exchange.player)) {
            const related = current.filter(r => (op.op === 'revise' && targets.concat(String(op.id || '')).includes(String(r.id))) || (op.subject && fold(r.subject) === fold(op.subject)) || (op.subject && fold(r.text).includes(fold(op.subject))));
            if (related.length && !numbersNew(claim, related.map(r => r.text || ''))) { dropped.push({ op, why: 'it answers the player\'s question with what the records hold' }); continue; }
        }
        // Who went where and who is present is scene state, which the tracker keeps; an add that only moves people is no change.
        if (op.op === 'add' && (op.kind || 'fact') === 'fact' && MOVEMENT.test(claim) && !MOVEMENT_KEEP.test(claim)) { dropped.push({ op, why: 'it only moves people, which the scene keeps' }); continue; }
        if (['revise', 'supersede', 'retire', 'complete'].includes(op.op)) {
            const want = op.op === 'revise' && !targets.length ? [String(op.id || '')] : targets;
            const missing = want.filter(t => !inForce(byId.get(t)));
            if (op.op === 'revise' && want.length && missing.length === want.length && !byId.has(String(op.id || ''))) {
                // A revise of a record that was never filed is an add of a new record.
                op.op = 'add';
            } else if (missing.length) { dropped.push({ op, why: `its target is not in force (${missing.join(', ')})` }); continue; }
        }
        const id = op.op === 'add' ? uniqueId(op.id || slug(`${op.subject} ${op.text}`), taken) : String(op.op === 'revise' ? (targets[0] || op.id) : op.id || slug(`${op.subject} ${op.text}`));
        const record = op.op === 'retire' ? null : recordOf({ ...op, text }, { id });
        if (record && speaker) record.source = { speaker };
        const target = op.op === 'revise' ? [id] : op.op === 'add' ? [] : targets;
        // 4. Locks.
        const lockedTarget = [...target, record?.id].filter(Boolean).find(t => byId.get(t)?.locked);
        if (lockedTarget) {
            inputs.push({ op: 'flag', target: [lockedTarget], record: { kind: 'locked-record', subject: record?.subject || '', text: record?.text || '', proposed: op.op }, evidence: ev, origin, reason: 'Capture proposed a change to a record you locked.' });
            continue;
        }
        // The no-change filter: a revise or complete that only repeats its record, and an add that repeats a current record.
        if (op.op === 'revise') {
            const old = byId.get(id);
            if (old && restates(claim, [old.text || ''])) { dropped.push({ op, why: 'it repeats the record it revises' }); continue; }
        }
        if (op.op === 'add') {
            // 5. Identical adds are dropped; resemblance makes a suspect, held out of recall until the next call rules.
            const same = current.find(r => sameRecord(r, record));
            if (same) { dropped.push({ op, why: `identical to ${same.id}` }); continue; }
            const about = current.filter(r => fold(r.subject) === fold(record.subject) || (record.subject && fold(r.text).includes(fold(record.subject))));
            if (about.length && restates(claim, about.map(r => r.text || ''))) { dropped.push({ op, why: 'it repeats what a current record holds' }); continue; }
            const like = current.find(r => resembles(r, record));
            if (like) {
                record.status = 'suspect';
                record.suspectOf = like.id;
                inputs.push({ op: 'add', record, evidence: ev, origin, reason: `Held as a suspect: it resembles ${like.id}.` });
                taken.add(id);
                continue;
            }
            taken.add(id);
        }
        if (op.op === 'complete' && record) { record.status = 'done'; record.outcome = record.outcome || text; }
        const input = { op: op.op, target, evidence: ev, origin, reason: clip(op.reason || `${op.op} from capture`, 160) };
        if (record && op.op !== 'complete') input.record = record;
        if (op.op === 'complete') input.record = { id: target[0], outcome: record?.outcome || text };
        inputs.push(input);
    }

    // Rulings on suspects raised by an earlier capture: keep it as its own record, drop it, or let it replace the record it resembles.
    const rulings = [];
    for (const ruling of [].concat(answer?.rulings || [])) {
        const suspect = byId.get(String(ruling?.id || ''));
        if (!suspect || suspect.status !== 'suspect') continue;
        const verdict = ['keep', 'drop', 'replaces'].includes(ruling.ruling) ? ruling.ruling : '';
        if (!verdict) continue;
        rulings.push({ id: suspect.id, ruling: verdict });
        if (verdict === 'keep') inputs.push({ op: 'revise', target: [suspect.id], record: { ...stripMeta(suspect), status: 'current', suspectOf: undefined }, origin, reason: 'Ruled a separate record.' });
        else if (verdict === 'drop') inputs.push({ op: 'retire', target: [suspect.id], origin, reason: `Ruled the same as ${suspect.suspectOf}.` });
        else if (inForce(byId.get(suspect.suspectOf))) inputs.push({ op: 'supersede', target: [suspect.suspectOf], record: { ...stripMeta(suspect), status: 'current', suspectOf: undefined }, origin, reason: `Ruled to replace ${suspect.suspectOf}.` });
    }
    return { inputs, dropped, decisions, state: answer?.state && typeof answer.state === 'object' ? answer.state : {}, rulings };
}

function stripMeta(record) {
    const { versions, entries, locked, view, ...rest } = record;
    return rest;
}

function uniqueId(base, taken) {
    const root = String(base).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'record';
    let id = root;
    for (let n = 2; taken.has(id); n++) id = `${root}-${n}`;
    return id;
}
