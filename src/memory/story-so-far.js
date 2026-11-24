// Chapters and the story so far (memory DESIGN 6). Pure code over SillyTavern's chat shape and the fold, so the tests and
// the harness run it with no host. src/chapters.js wires it to SillyTavern, the queue and the Writer chain.
//
//   When a chapter closes (6.1)   closeDecision: a scene end after enough exchanges, the open chapter's share of the
//                                 request ceiling, the exchange cap, or by hand.
//   The chapter call (6.2)        chapterPrompt, CHAPTER_SCHEMA and checkChapter: evidence first, quotes and names checked
//                                 by code, one repair retry, then the chapter stays open.
//   Hiding at assembly (6.3)      coverage and leaveOut: messages leave a request only while a valid chapter covers
//                                 them, and the chapter view goes into the same request at the same place.
//   The story so far (6.4)        condensedPlan, condensedPrompt and checkCondensed: from the third close, one Writer call
//                                 rebuilds the condensed account from stored chapter records (or arc records) alone.
//   The chapter view (5.3, 6.4)   chapterView: the condensed account, then the two newest chapters in full, under the cap;
//                                 the condensed targets shrink before a full chapter is cut, so the newest is always there.
import { MEMORY, OUT_OF_FORCE, hashText, proseOf, revisionOf, storedMark } from './fold.js';

/** Chapter close rules. MB11 measured 6 to 20 exchanges as the best setting (results.md 4.2); 8 and 30 were the starting values. */
export const CLOSE_DEFAULTS = Object.freeze({ minExchanges: 6, maxExchanges: 20, ceilingShare: 0.5 });

/** Sizes by chat model (DESIGN 5.3). The chapter view cap and the request ceiling. */
export const SIZE_CLASSES = Object.freeze({
    small: { label: 'Small', view: 1000, ceiling: 16000 },
    mid: { label: 'Mid', view: 2000, ceiling: 24000 },
    frontier: { label: 'Frontier', view: 4000, ceiling: 32000 },
});

/** The size class of a chat model from its context length in tokens: under 32K is small, under 200K mid. */
export function sizeClass(contextTokens) {
    const n = Number(contextTokens) || 0;
    if (!n || n < 32000) return 'small';
    return n < 200000 ? 'mid' : 'frontier';
}

/** Words per part of the condensed account by age (6.4): the two chapters behind the full ones, older chapters, arcs. */
export const TARGETS = Object.freeze({ near: 90, older: 30, arc: 60, nearCount: 2, arcAfter: 8, arcMin: 4, arcMax: 6 });

export const tokensOf = text => Math.ceil(String(text ?? '').length / 4);
const clean = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const norm = text => clean(String(text ?? '').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')).toLowerCase();
const words = text => clean(text).split(' ').filter(Boolean).length;
const list = value => (Array.isArray(value) ? value : []).map(clean).filter(Boolean);
const attr = text => clean(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const body = text => clean(text).replace(/</g, '‹').replace(/>/g, '›');

// ---------------------------------------------------------------- the report register

// The report register (DECISIONS, 23 November): facts, names, numbers, places and terms, with no emotion, inner thought,
// opinion or mood; a feeling enters only as a stated line or an action. The words come from the MB11 register scorer.
export const REGISTER_RULE = 'Write it as an incident report: who did what, when, where, how many, on what terms and with what result. Keep names, numbers, places, distances, deadlines and agreements exact. Leave out emotions, inner thoughts, opinions, motives and descriptions of mood. A feeling may appear only as an action someone took or a line someone said, in quotation marks.';
export const REGISTER_EXAMPLE = 'The general said Heather had to marry Lord Valyren in 10 days in exchange for 30 warships. She fled the keep on a stolen horse through the eastern gate and reached the vanguard camp 20 miles east.';
const MOOD_WORDS = ['terrified', 'terror', 'afraid', 'fear', 'feared', 'fearful', 'dread', 'dreaded', 'anxious', 'anxiety', 'worried', 'worry', 'nervous', 'panic', 'panicked',
    'tears', 'tearful', 'wept', 'sobbed', 'longing', 'yearned', 'yearning', 'ached', 'aching', 'felt', 'feeling', 'feelings', 'hoped', 'hopeful', 'wished',
    'adored', 'cherished', 'hated', 'despair', 'desperate', 'desperately', 'grief', 'grieved', 'sorrow', 'sorrowful', 'joy', 'joyful', 'happy', 'sad', 'sadly', 'bitterly',
    'angry', 'furious', 'rage', 'resentful', 'resentment', 'jealous', 'ashamed', 'shame', 'guilt', 'guilty', 'lonely', 'loneliness', 'miserable', 'anguish', 'anguished', 'haunted',
    'trembling', 'trembled', 'shuddered', 'quivering', 'wondered', 'believed', 'sensed', 'suspected', 'realized', 'dreamed', 'imagined', 'inwardly', 'mood', 'atmosphere', 'ominous', 'foreboding', 'uneasy', 'uneasily', 'heavy-hearted', 'bittersweet'];
const MOOD_PHRASES = [/\b(heavy|sinking|aching|pounding|racing|swelling|breaking)\s+(heart|chest|stomach|spirit)/i, /\b(weight|pang|surge|wave|knot)\s+of\s+(fear|dread|guilt|grief|relief|anger|sorrow|longing|despair|joy)/i,
    /\b(mind|thoughts)\s+(raced|churned|drifted|turned)/i, /\bin\s+(her|his|their)\s+(heart|mind|soul)\b/i, /\b(deeply|bitterly|painfully|fiercely|desperately|silently)\s+(afraid|sad|hurt|moved|troubled|aware|certain)/i];
const MOOD_RE = new RegExp(`\\b(${MOOD_WORDS.map(w => w.replace(/-/g, '\\-')).join('|')})\\b`, 'gi');

/** Mood language outside quotation marks. A stated line inside quotes is allowed. */
export function moodHits(text) {
    const outside = String(text ?? '').replace(/"[^"]*"/g, ' ').replace(/\u201C[^\u201D]*\u201D/g, ' ');
    const hits = [...new Set((outside.match(MOOD_RE) || []).map(w => w.toLowerCase()))];
    for (const pattern of MOOD_PHRASES) { const m = outside.match(pattern); if (m) hits.push(m[0].toLowerCase()); }
    return hits;
}

// ---------------------------------------------------------------- the chat, read for chapters

/** A message that belongs to the story: not a notice of SillyTavern's own and not the extension's view. */
export const storyMessage = message => !!message && !message.is_system && typeof message.mes === 'string' && !message.extra?.ri_chapter_view;

/**
 * The scene signals of a reply, from what today's pipeline and capture store on it: the place and date of its header or
 * scene record, and whether the capture call or the update block said the scene ended in it.
 */
export function sceneOf(message, key = 'roleplay_instructions') {
    const rec = message?.extra?.[key] || {};
    const mem = message?.extra?.[MEMORY] || {};
    const scene = rec.scene || mem.scene || {};
    return {
        where: clean(scene.where || scene.location || ''),
        date: clean(scene.date || ''),
        ended: rec.v10SceneEnded === true || rec.update?.ended === true || mem.decisions?.scene_ended === true || mem.sceneEnded === true,
    };
}

/**
 * The current chapters of a fold, in story order, with their display number, their chat span and whether their coverage
 * is valid now. A chapter is valid when every message it covers still shows the swipe and text it was written from.
 */
export function chaptersOf(chat, folded) {
    const index = new Map();
    (chat || []).forEach((message, i) => { const mark = storedMark(message); if (mark && !index.has(mark)) index.set(mark, i); });
    const out = [];
    for (const rec of folded?.records || []) {
        if (rec.kind !== 'chapter' || OUT_OF_FORCE.includes(rec.status)) continue;
        const covers = Array.isArray(rec.covers) ? rec.covers : [];
        const at = covers.map(src => index.get(src.mark)).filter(i => i !== undefined);
        const last = index.get(rec.to) ?? (at.length ? Math.max(...at) : index.get(rec.versions?.at(-1)?.anchor?.mark));
        if (last === undefined) continue;
        const first = index.get(rec.from) ?? (at.length ? Math.min(...at) : last);
        out.push({ record: rec, id: rec.id, first, last, marks: covers.map(src => src.mark), valid: !rec.stale && covers.length > 0 && at.length === covers.length });
    }
    out.sort((a, b) => a.last - b.last || a.first - b.first || (a.id < b.id ? -1 : 1));
    out.forEach((chapter, i) => { chapter.n = i + 1; });
    return out;
}

/** The marks that leave the request now: those of valid chapters only (6.3). */
export function coverage(chapters) {
    const marks = new Set();
    for (const chapter of chapters) if (chapter.valid) for (const mark of chapter.marks) marks.add(mark);
    return marks;
}

/** Where the open chapter starts: the first chat index after the newest chapter, or 1 (after the greeting). */
export function openStart(chapters) {
    return chapters.length ? Math.max(...chapters.map(c => c.last)) + 1 : 1;
}

/** Spans before the newest chapter that no chapter covers (a delete or a branch took a chapter): each closes on its own. */
export function gaps(chat, chapters, { isStory = storyMessage } = {}) {
    const out = [];
    const end = openStart(chapters);
    const covered = new Set(chapters.flatMap(c => {
        const span = [];
        for (let i = c.first; i <= c.last; i++) span.push(i);
        return span;
    }));
    let span = null;
    for (let i = 1; i < end && i < (chat || []).length; i++) {
        if (covered.has(i) || !isStory(chat[i])) { if (span && covered.has(i)) { out.push(span); span = null; } continue; }
        if (!span) span = { from: i, to: i };
        else span.to = i;
    }
    if (span) out.push(span);
    return out.filter(s => (chat || []).slice(s.from, s.to + 1).some(m => isStory(m) && !m.is_user));
}

/** The replies in chat[from..to], with their indexes. An exchange is one reply and the player message before it. */
export function repliesIn(chat, from, to = (chat || []).length - 1, { isStory = storyMessage } = {}) {
    const out = [];
    for (let i = Math.max(1, from); i <= to && i < (chat || []).length; i++) if (isStory(chat[i]) && !chat[i].is_user) out.push(i);
    return out;
}

// ---------------------------------------------------------------- when a chapter closes (6.1)

/**
 * Decide whether the open chapter closes after the newest reply. Returns { close, from, to, why } with chat indexes.
 * ceiling: the request ceiling of the size class; the open chapter closes at ceilingShare of it, so SillyTavern never
 * has to trim the history.
 * textOf: the prose of a message as the chapter call reads it.
 */
export function closeDecision(chat, chapters, { ceiling = SIZE_CLASSES.mid.ceiling, rules = {}, textOf = proseOf, isStory = storyMessage, sceneKey } = {}) {
    const r = { ...CLOSE_DEFAULTS, ...rules };
    const from = openStart(chapters);
    const replies = repliesIn(chat, from, undefined, { isStory });
    const none = why => ({ close: false, from, to: -1, why });
    if (!replies.length) return none('no replies since the last chapter');
    const newest = replies.at(-1);
    const open = replies.length;
    const spanTokens = (a, b) => { let n = 0; for (let i = a; i <= b; i++) if (isStory(chat[i])) n += tokensOf(textOf(chat[i])); return n; };
    const all = spanTokens(from, newest);
    // A scene ended before this reply when its header names another place or date than the reply before it, or the reply
    // before it said the scene ended; it ended in this reply when capture said so.
    const scene = i => sceneOf(chat[i], sceneKey);
    const prev = replies.length > 1 ? replies.at(-2) : -1;
    const moved = prev >= 0 && ((scene(newest).where && scene(prev).where && scene(newest).where !== scene(prev).where)
        || (scene(newest).date && scene(prev).date && scene(newest).date !== scene(prev).date) || scene(prev).ended);
    if (moved && open - 1 >= r.minExchanges) return { close: true, from, to: newest - 1 >= from ? lastBefore(chat, newest, isStory) : newest, why: 'the scene ended' };
    if (scene(newest).ended && open >= r.minExchanges) return { close: true, from, to: newest, why: 'the scene ended' };
    if (open >= r.maxExchanges) return { close: true, from, to: newest, why: `the open chapter reached ${r.maxExchanges} exchanges` };
    if (ceiling && all >= r.ceilingShare * ceiling) return { close: true, from, to: newest, why: 'the open chapter reached its share of the request ceiling' };
    return none('no close rule applies');
}

function lastBefore(chat, index, isStory) {
    for (let i = index - 1; i > 0; i--) if (isStory(chat[i]) && !chat[i].is_user) return i;
    return index;
}

/** The span a manual close takes: from the open chapter's start through `to` (a reply index), or the newest reply. */
export function manualSpan(chat, chapters, to = -1, { isStory = storyMessage } = {}) {
    const from = openStart(chapters);
    const replies = repliesIn(chat, from, undefined, { isStory });
    const end = to >= from ? replies.filter(i => i <= to).at(-1) : replies.at(-1);
    return end === undefined ? null : { from, to: end };
}

// ---------------------------------------------------------------- the chapter call (6.2)

/** The Writer's answer for one chapter. Evidence comes first, so the model quotes before it writes (M1c rule 13). */
export const CHAPTER_SCHEMA = Object.freeze({
    name: 'chapter_record',
    value: {
        type: 'object',
        required: ['evidence', 'title', 'summary', 'people', 'places'],
        properties: {
            evidence: { type: 'array', items: { type: 'object', required: ['message', 'quote'], properties: { message: { type: 'string' }, quote: { type: 'string' } } } },
            title: { type: 'string' },
            start_time: { type: 'string' },
            end_time: { type: 'string' },
            summary: { type: 'string' },
            people: { type: 'array', items: { type: 'string' } },
            places: { type: 'array', items: { type: 'string' } },
            threads_opened: { type: 'array', items: { type: 'string' } },
            threads_closed: { type: 'array', items: { type: 'string' } },
            importance: { type: 'integer' },
            secrets: { type: 'array', items: { type: 'object', required: ['text', 'holders'], properties: { text: { type: 'string' }, holders: { type: 'array', items: { type: 'string' } } } } },
            final_changes: { type: 'array', items: { type: 'object', required: ['message', 'text'], properties: { message: { type: 'string' }, text: { type: 'string' } } } },
            event_seeds: { type: 'array', items: { type: 'string' } },
        },
    },
});

export const CHAPTER_SYSTEM = 'You keep the chapter records of a roleplay story. You read the messages of one chapter and answer with one JSON object only.';

/** The label of a message in the chapter call: its mark, so a quote names the message it came from. */
export const messageLabel = (message, index) => storedMark(message) || `i${index}`;

/**
 * The user prompt of the chapter call: the chapter's messages in full with their labels, the cast and alias table, and
 * the titles of the last three chapters. Every field is in the record's own words, in the report register.
 */
export function chapterPrompt({ chat, from, to, cast = [], titles = [], textOf = proseOf, isStory = storyMessage, error = '', previous = '' }) {
    const lines = [];
    for (let i = from; i <= to; i++) {
        const m = chat[i];
        if (!isStory(m)) continue;
        lines.push(`[${messageLabel(m, i)}] ${clean(m.name) || (m.is_user ? 'Player' : 'Character')}: ${String(textOf(m)).trim()}`);
    }
    const castLines = cast.map(p => `- ${clean(p.name)}${list(p.aliases).length ? ` (also: ${list(p.aliases).join(', ')})` : ''}`);
    const parts = [
        'Write the record of one chapter of the story.',
        titles.length ? `Titles of the chapters before it, oldest first: ${titles.map(t => `"${clean(t)}"`).join(', ')}.` : 'This is the first chapter.',
        castLines.length ? `The cast and their other names:\n${castLines.join('\n')}` : '',
        `The chapter's messages, oldest first. Each starts with its label in square brackets.\n"""\n${lines.join('\n\n')}\n"""`,
        [
            'Return one JSON object with these keys, in this order:',
            '- "evidence": three to six exact quotes copied from the messages, each with "message" (the label without brackets) and "quote" (8 to 120 characters copied exactly). Quote first, then write the rest from what you quoted.',
            '- "title": 3 to 6 plain words.',
            '- "start_time" and "end_time": the story time at the chapter\'s start and end, as the messages state it, or an empty string.',
            `- "summary": 150 to 250 words. ${REGISTER_RULE} For example: "${REGISTER_EXAMPLE}"`,
            '- "people": the names of the people who take part, as the messages or the cast spell them.',
            '- "places": the names of the places.',
            '- "threads_opened" and "threads_closed": short titles of matters that opened or were settled.',
            '- "importance": 1 to 10.',
            '- "secrets": facts only some characters know, each with "text" and "holders" (the names who know it). Keep them out of the summary.',
            '- "final_changes": lasting facts from the last two messages that the summary does not hold, each with "message" and "text". Use [] when none.',
            '- "event_seeds": up to three short story events this chapter makes possible later, naming only people and places from the messages.',
        ].join('\n'),
        error ? `Your previous answer:\n${previous}\n\nIt could not be used: ${error} Send the corrected JSON only.` : '',
    ];
    return parts.filter(Boolean).join('\n\n');
}

const nameKey = name => norm(name).replace(/^(the|lord|lady|sir|captain|general|king|queen|prince|princess)\s+/, '');

/**
 * Check a chapter answer against its source (6.2). Returns { problems, mood }: a problem is a quote that is not in the
 * message it names (or in any message of the chapter when it names none), a name that is neither in the cast nor in the
 * messages, a summary outside 60 to 400 words, or no evidence at all. mood lists register words outside stated lines.
 */
export function checkChapter(answer, { chat, from, to, cast = [], places = [], textOf = proseOf, isStory = storyMessage }) {
    const problems = [];
    if (!answer || typeof answer !== 'object') return { problems: ['The answer is not a JSON object.'], mood: [] };
    const texts = new Map();
    const all = [];
    for (let i = from; i <= to; i++) {
        if (!isStory(chat[i])) continue;
        const t = norm(textOf(chat[i]));
        texts.set(messageLabel(chat[i], i), t);
        all.push(t);
    }
    const evidence = Array.isArray(answer.evidence) ? answer.evidence : [];
    if (!evidence.length) problems.push('The evidence list is empty; quote the messages first.');
    for (const item of evidence) {
        const quote = norm(item?.quote).replace(/^"|"$/g, '');
        const label = clean(item?.message).replace(/^\[|\]$/g, '');
        if (quote.length < 8) { problems.push(`The quote "${clean(item?.quote)}" is shorter than 8 characters.`); continue; }
        const own = texts.get(label);
        if (own !== undefined ? !own.includes(quote) : !all.some(t => t.includes(quote))) problems.push(`The quote "${clean(item?.quote).slice(0, 80)}" is not in message ${label || '(no label)'}.`);
    }
    const source = all.join(' ');
    const known = new Set(cast.flatMap(p => [p.name, ...list(p.aliases)]).map(nameKey).filter(Boolean));
    const firsts = new Set([...known].map(k => k.split(' ')[0]));
    for (const name of list(answer.people)) {
        const k = nameKey(name);
        if (!known.has(k) && !firsts.has(k.split(' ')[0]) && !source.includes(norm(name))) problems.push(`The name "${name}" is in neither the cast nor the messages.`);
    }
    // A place passes when the messages or the known places hold it, or when every capitalized word of it is in the messages.
    const knownPlaces = new Set(list(places).map(norm));
    const capitals = place => (clean(place).match(/\b[A-Z][\p{L}'-]+/gu) || []).map(w => w.toLowerCase());
    for (const place of list(answer.places)) {
        const caps = capitals(place);
        if (source.includes(norm(place)) || knownPlaces.has(norm(place)) || known.has(nameKey(place)) || (caps.length && caps.every(w => source.includes(w)))) continue;
        problems.push(`The place "${place}" is not in the messages.`);
    }
    const n = words(answer.summary);
    if (n < 60 || n > 400) problems.push(`The summary has ${n} words; it needs 150 to 250.`);
    return { problems, mood: moodHits(answer.summary) };
}

/**
 * The chapter record a checked answer makes, ready for the store's log (kind chapter, DESIGN 3.3 and 6.2). covers holds
 * the revision of every message it covers, so an edit, a swipe or a delete inside it marks it stale (3.4).
 */
export function chapterRecord(answer, { chat, from, to, id, isStory = storyMessage }) {
    const covers = [];
    for (let i = from; i <= to; i++) if (isStory(chat[i])) { const rev = revisionOf(chat[i]); if (rev.mark) covers.push(rev); }
    const secrets = (Array.isArray(answer.secrets) ? answer.secrets : []).map(s => ({ text: clean(s?.text), holders: list(s?.holders) })).filter(s => s.text && s.holders.length);
    return {
        id: id || `ch-${covers[0]?.mark || hashText(String(from))}`,
        kind: 'chapter',
        subject: clean(answer.title) || 'Chapter',
        title: clean(answer.title) || 'Chapter',
        text: clean(answer.summary),
        from: covers[0]?.mark || '',
        to: covers.at(-1)?.mark || '',
        count: covers.length,
        covers,
        when: { start: clean(answer.start_time), end: clean(answer.end_time) },
        people: list(answer.people),
        places: list(answer.places),
        opened: list(answer.threads_opened),
        closed: list(answer.threads_closed),
        importance: Math.max(1, Math.min(10, Math.round(Number(answer.importance) || 6))),
        secrets,
        changes: (Array.isArray(answer.final_changes) ? answer.final_changes : []).map(c => ({ message: clean(c?.message), text: clean(c?.text) })).filter(c => c.text).slice(0, 6),
        seeds: list(answer.event_seeds).slice(0, 3),
        holders: null,
        status: 'current',
    };
}

/** The evidence of an answer as entry quotes (DESIGN 3.2), at most three. */
export const evidenceOf = answer => (Array.isArray(answer?.evidence) ? answer.evidence : []).slice(0, 3)
    .map(item => ({ mark: clean(item?.message).replace(/^\[|\]$/g, ''), quote: clean(item?.quote) })).filter(item => item.quote);

// ---------------------------------------------------------------- the story so far (6.4)

/** Arcs of four to six of the oldest chapters, grouped by shared threads and places. */
export function arcGroups(chapters, { min = TARGETS.arcMin, max = TARGETS.arcMax } = {}) {
    const groups = [];
    let group = [];
    const keys = c => new Set([...list(c.record?.places || c.places), ...list(c.record?.opened || c.opened), ...list(c.record?.closed || c.closed)].map(norm));
    for (const chapter of chapters) {
        if (!group.length) { group.push(chapter); continue; }
        const shared = [...keys(chapter)].some(k => group.some(g => keys(g).has(k)));
        if (group.length >= max || (group.length >= min && !shared)) { groups.push(group); group = [chapter]; }
        else group.push(chapter);
    }
    if (group.length) {
        if (group.length < min && groups.length && groups.at(-1).length + group.length <= max) groups[groups.length - 1].push(...group);
        else groups.push(group);
    }
    return groups;
}

/**
 * The parts of the condensed account and a word target for each (6.4): the two chapters just behind the full ones get
 * about 90 words, older chapters about 30, and chapters older than arcAfter fold into one paragraph per arc. The
 * targets scale down so the whole account fits budgetTokens. older: chapters older than the two full ones, oldest first.
 */
export function condensedPlan(older, { budgetTokens = 1000, targets = TARGETS, scale = 1 } = {}) {
    const n = older.length;
    // Arcs start once at least arcMin chapters are older than the arcAfter chapters kept one by one.
    const spare = n - targets.nearCount - targets.arcAfter;
    const foldUpTo = spare >= targets.arcMin ? spare : 0;
    const parts = [];
    for (const group of arcGroups(older.slice(0, foldUpTo), targets)) parts.push({ kind: 'arc', ids: group.map(c => c.id), chapters: group, target: targets.arc });
    older.slice(foldUpTo).forEach((chapter, i) => {
        const age = n - foldUpTo - 1 - i;
        parts.push({ kind: 'chapter', ids: [chapter.id], chapters: [chapter], target: age < targets.nearCount ? targets.near : targets.older });
    });
    // About 1.4 tokens a word, plus a line label for each part.
    const need = parts.reduce((sum, p) => sum + p.target * 1.4 + 12, 0);
    const k = Math.min(1, scale, need ? budgetTokens / need : 1);
    for (const p of parts) p.target = Math.max(8, Math.round(p.target * k));
    return parts;
}

export const CONDENSED_SCHEMA = Object.freeze({
    name: 'condensed_account',
    value: {
        type: 'object',
        required: ['parts'],
        properties: { parts: { type: 'array', items: { type: 'object', required: ['id', 'text'], properties: { id: { type: 'string' }, text: { type: 'string' } } } } },
    },
});

export const CONDENSED_SYSTEM = 'You condense the stored chapter records of a roleplay story into a shorter account. You answer with one JSON object only.';

/** A stored record as the condensed call reads it: its own fields only, never an earlier condensed account (M1c rule 12). */
function recordLine(rec) {
    const when = [rec.when?.start, rec.when?.end].filter(Boolean).join(' to ');
    return `${rec.title || rec.subject || 'Chapter'}${when ? ` (${when})` : ''}: ${rec.text || ''}`;
}

/**
 * The condensed call's prompt. inputs: [{ id, kind: 'chapter'|'arc', record, target }] in story order, built from the
 * stored chapter records or arc records alone.
 */
export function condensedPrompt(inputs, { error = '', previous = '' } = {}) {
    const lines = inputs.map(p => `[${p.id}] target ${p.target} words. ${recordLine(p.record)}`);
    return [
        'Condense these stored chapter records into one account of the story so far, one part per record, in story order.',
        `"""\n${lines.join('\n\n')}\n"""`,
        `Return one JSON object: "parts", a list with one object per record above, in the same order, each with "id" (the label without brackets) and "text" (close to its target length, never longer than one and a half times it). Keep the names, numbers, places and agreements the record states. ${REGISTER_RULE}`,
        error ? `Your previous answer:\n${previous}\n\nIt could not be used: ${error} Send the corrected JSON only.` : '',
    ].filter(Boolean).join('\n\n');
}

/** Check a condensed answer: one part per input, in order, within one and a half times its target. */
export function checkCondensed(answer, inputs) {
    const problems = [];
    const parts = Array.isArray(answer?.parts) ? answer.parts : [];
    const ids = inputs.map(p => p.id);
    const got = parts.map(p => clean(p?.id).replace(/^\[|\]$/g, ''));
    for (const id of ids) if (!got.includes(id)) problems.push(`The part for ${id} is missing.`);
    for (const id of got) if (!ids.includes(id)) problems.push(`The part ${id} is not one of the records.`);
    for (const p of parts) {
        const input = inputs.find(x => x.id === clean(p?.id).replace(/^\[|\]$/g, ''));
        if (input && words(p.text) > Math.ceil(input.target * 1.5) + 4) problems.push(`The part for ${input.id} has ${words(p.text)} words against a target of ${input.target}.`);
        if (input && !words(p.text)) problems.push(`The part for ${input.id} is empty.`);
    }
    const mood = parts.flatMap(p => moodHits(p?.text));
    return { problems, mood: [...new Set(mood)] };
}

/** The condensed record a checked answer makes: its parts in the inputs' order, and the inputs it was built from. */
export function condensedRecord(answer, inputs) {
    const byId = new Map((answer.parts || []).map(p => [clean(p.id).replace(/^\[|\]$/g, ''), clean(p.text)]));
    return {
        id: 'condensed', kind: 'condensed', subject: 'story so far', attribute: 'condensed', holders: null, status: 'current', importance: 7,
        parts: inputs.map(p => ({ id: p.id, kind: p.kind, ids: p.ids || [p.id], text: byId.get(p.id) || '' })),
        inputs: inputs.flatMap(p => p.ids || [p.id]),
        text: inputs.map(p => byId.get(p.id) || '').join(' ').slice(0, 3900),
    };
}

/** The first sentences of a text, up to about `target` words. */
export function shorten(text, target) {
    const parts = clean(text).split(/(?<=[.!?])\s+/);
    const kept = [];
    let n = 0;
    for (const s of parts) {
        const w = words(s);
        if (kept.length && n + w > target) break;
        kept.push(s);
        n += w;
    }
    let out = kept.join(' ');
    if (words(out) > target * 1.5) out = `${out.split(' ').slice(0, Math.max(4, target)).join(' ')} [...]`;
    return out;
}

/** A condensed account made by code from the stored records, for a view whose Writer-made account is not current. */
export function codeCondensed(plan) {
    return plan.map(p => ({ id: p.kind === 'arc' ? `arc-${p.ids[0]}` : p.ids[0], kind: p.kind, ids: p.ids, text: p.kind === 'arc'
        ? shorten(p.chapters.map(c => c.record.text).join(' '), p.target) : shorten(p.chapters[0].record.text, p.target) }));
}

// ---------------------------------------------------------------- arc records (6.4, the longest stories)

export const ARC_SCHEMA = Object.freeze({
    name: 'arc_record',
    value: {
        type: 'object', required: ['evidence', 'title', 'summary'],
        properties: {
            evidence: { type: 'array', items: { type: 'object', required: ['chapter', 'quote'], properties: { chapter: { type: 'string' }, quote: { type: 'string' } } } },
            title: { type: 'string' }, summary: { type: 'string' },
        },
    },
});

/** The arc call's prompt: the stored records of four to six chapters. */
export function arcPrompt(chapters, { error = '', previous = '' } = {}) {
    return [
        'Write one arc record that stands for these consecutive chapter records of a roleplay story.',
        `"""\n${chapters.map(c => `[${c.id}] ${recordLine(c.record)}`).join('\n\n')}\n"""`,
        `Return one JSON object with "evidence" first (two to four exact quotes copied from the records, each with "chapter", the label without brackets, and "quote"), then "title" (3 to 6 words) and "summary" (80 to 150 words). ${REGISTER_RULE}`,
        error ? `Your previous answer:\n${previous}\n\nIt could not be used: ${error} Send the corrected JSON only.` : '',
    ].filter(Boolean).join('\n\n');
}

/** Check an arc answer: every quote is in the record it names or in that chapter's source messages (M1c rule 7). */
export function checkArc(answer, chapters, sourceOf = () => '') {
    const problems = [];
    const evidence = Array.isArray(answer?.evidence) ? answer.evidence : [];
    if (!evidence.length) problems.push('The evidence list is empty.');
    for (const item of evidence) {
        const chapter = chapters.find(c => c.id === clean(item?.chapter).replace(/^\[|\]$/g, ''));
        const quote = norm(item?.quote);
        const where = chapter ? [norm(chapter.record.text), norm(sourceOf(chapter))] : chapters.flatMap(c => [norm(c.record.text), norm(sourceOf(c))]);
        if (quote.length < 8 || !where.some(t => t.includes(quote))) problems.push(`The quote "${clean(item?.quote).slice(0, 80)}" is not in ${chapter ? chapter.id : 'the records'}.`);
    }
    const n = words(answer?.summary);
    if (n < 30 || n > 250) problems.push(`The summary has ${n} words; it needs 80 to 150.`);
    return { problems, mood: moodHits(answer?.summary) };
}

export function arcRecord(answer, chapters) {
    return {
        id: `arc-${chapters[0].id}`, kind: 'arc', subject: clean(answer.title) || 'Arc', title: clean(answer.title) || 'Arc', text: clean(answer.summary),
        chapters: chapters.map(c => c.id), from: chapters[0].record.from, to: chapters.at(-1).record.to,
        covers: chapters.flatMap(c => c.record.covers || []), holders: null, status: 'current', importance: 7,
        when: { start: chapters[0].record.when?.start || '', end: chapters.at(-1).record.when?.end || '' },
    };
}

/** Several chapter records read as one input: their own stored fields, joined in story order. */
const joined = chapters => ({ title: chapters[0].record.title, text: chapters.map(c => recordLine(c.record)).join(' '),
    when: { start: chapters[0].record.when?.start || '', end: chapters.at(-1).record.when?.end || '' } });

/**
 * The inputs of the condensed call, one per part of the plan, built from stored chapter records. When they and the
 * prompt pass the route's input (inputTokens), the oldest arc parts read their arc record instead, oldest first.
 * Returns { inputs, needArcs }; needArcs lists the chapter groups whose arc record must be written before the call.
 */
export function condensedInputs(older, { budgetTokens, inputTokens = 12000, arcs = [], targets = TARGETS } = {}) {
    const plan = condensedPlan(older, { budgetTokens, targets });
    const inputs = plan.map(p => (p.kind === 'chapter'
        ? { id: p.ids[0], kind: 'chapter', ids: p.ids, record: p.chapters[0].record, target: p.target }
        : { id: `arc-${p.ids[0]}`, kind: 'arc', ids: p.ids, record: joined(p.chapters), target: p.target, chapters: p.chapters }));
    const size = () => tokensOf(condensedPrompt(inputs));
    const needArcs = [];
    for (const input of inputs) {
        if (size() <= inputTokens) break;
        if (input.kind !== 'arc') continue;
        const arc = arcs.find(a => (a.chapters || []).join('|') === input.ids.join('|'));
        if (arc) input.record = arc;
        else { needArcs.push(input.chapters); input.record = { title: input.record.title, text: shorten(input.record.text, input.target * 3) }; }
    }
    return { inputs: inputs.map(({ chapters, ...x }) => x), needArcs };
}

// ---------------------------------------------------------------- the chapter view (5.1, 5.3, 6.4)

const whenOf = rec => [rec.when?.start, rec.when?.end].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' to ');

function renderChapter(chapter, text = chapter.record.text) {
    const rec = chapter.record;
    const secrets = (rec.secrets || []).map(s => `<secret known_by="${attr(s.holders.join(', '))}">${body(s.text)}</secret>`);
    return `<chapter n="${chapter.n}" title="${attr(rec.title || rec.subject || '')}" when="${attr(whenOf(rec))}">${body(text)}${secrets.length ? `\n${secrets.join('\n')}` : ''}</chapter>`;
}

function renderCondensed(parts, chapters) {
    const n = id => chapters.find(c => c.id === id)?.n;
    const lines = parts.filter(p => p.text).map(p => {
        const ns = (p.ids || [p.id]).map(n).filter(Boolean);
        const label = p.kind === 'arc' || ns.length > 1 ? `Chapters ${ns[0]} to ${ns.at(-1)}` : `Chapter ${ns[0] ?? ''}`;
        return `${label}: ${body(p.text)}`;
    });
    return lines.length ? `<condensed>\n${lines.join('\n')}\n</condensed>` : '';
}

/** The condensed record is current when it was built from exactly the chapters older than the two newest, in order. */
export function condensedCurrent(condensed, older) {
    return !!condensed && Array.isArray(condensed.inputs) && condensed.inputs.join('|') === older.map(c => c.id).join('|');
}

/**
 * The chapter view: the condensed account, then the two newest chapters in full, in story order, wrapped in
 * <story_so_far>. chapters: the valid chapters from chaptersOf. cap: the view cap of the size class (5.3).
 * Under a tight cap the condensed targets shrink first, then the condensed lines go oldest first, then the older full
 * chapter is shortened; the newest chapter is cut last and is always present.
 */
export function chapterView(chapters, { condensed = null, cap = SIZE_CLASSES.mid.view, full = 2 } = {}) {
    const valid = chapters.filter(c => c.valid);
    if (!valid.length) return { text: '', tokens: 0, ids: [], full: [], condensedFrom: '', cut: [] };
    const shown = valid.slice(-full);
    const older = valid.slice(0, -full);
    const fullTokens = shown.reduce((s, c) => s + tokensOf(renderChapter(c)), 0);
    const current = condensedCurrent(condensed, older);
    const build = (parts, fullTexts) => {
        const blocks = [renderCondensed(parts, valid), ...shown.map((c, i) => renderChapter(c, fullTexts[i]))].filter(Boolean);
        return `<story_so_far>\n${blocks.join('\n')}\n</story_so_far>`;
    };
    let parts = older.length ? (current ? condensed.parts : codeCondensed(condensedPlan(older, { budgetTokens: Math.max(60, cap - fullTokens - 20) }))) : [];
    let texts = shown.map(c => c.record.text);
    let text = build(parts, texts);
    const cut = [];
    for (let k = 0.85; tokensOf(text) > cap && older.length && k > 0.1; k -= 0.15) {
        parts = codeCondensed(condensedPlan(older, { budgetTokens: Math.max(40, cap - fullTokens - 20), scale: k }));
        text = build(parts, texts);
        if (!cut.includes('condensed targets')) cut.push('condensed targets');
    }
    while (tokensOf(text) > cap && parts.length) { parts = parts.slice(1); text = build(parts, texts); if (!cut.includes('oldest condensed lines')) cut.push('oldest condensed lines'); }
    for (let i = 0; i < texts.length && tokensOf(text) > cap; i++) {
        const over = tokensOf(text) - cap;
        const room = Math.max(20, tokensOf(texts[i]) - over - 4);
        texts[i] = `${String(texts[i]).slice(0, room * 4).replace(/\s+\S*$/, '')} [...]`;
        text = build(parts, texts);
        cut.push(i === texts.length - 1 ? 'newest chapter shortened' : 'older full chapter shortened');
    }
    return { text, tokens: tokensOf(text), ids: valid.map(c => c.id), full: shown.map(c => c.id), condensedFrom: older.length ? (current && !cut.length ? 'writer' : 'code') : '', cut };
}

// ---------------------------------------------------------------- hiding at assembly (6.3)

/**
 * Leave covered messages out of the prompt's chat copy and put the chapter view in their place (6.3), in place.
 * prompt: SillyTavern's coreChat (copies of the chat's messages, extra shared with the originals). covered: marks of
 * valid chapters. view: the chapter view text; it goes where the first covered message was, or, when none of the
 * covered messages is in the copy, just after the greeting. Returns { removed, inserted, at }.
 */
export function leaveOut(prompt, covered, view, { markOf = storedMark } = {}) {
    if (!Array.isArray(prompt)) return { removed: 0, inserted: false, at: -1 };
    let at = -1, removed = 0;
    for (let i = prompt.length - 1; i >= 0; i--) {
        const mark = markOf(prompt[i]);
        if (mark && covered.has(mark)) { prompt.splice(i, 1); removed += 1; at = i; }
    }
    if (!view) return { removed, inserted: false, at };
    if (at < 0) at = Math.min(1, prompt.length);
    prompt.splice(at, 0, viewMessage(view));
    return { removed, inserted: true, at };
}

/** The chapter view as a chat message SillyTavern sends with the system role and no speaker name. */
export function viewMessage(text) {
    return { name: '', is_user: false, is_system: false, send_date: '', mes: text, extra: { type: 'narrator', ri_chapter_view: true } };
}
