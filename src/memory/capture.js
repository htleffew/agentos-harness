// Capture after each reply (memory DESIGN 5.1, 7.1 level 0 and 1, 7.2). The chat request carries prose rules and the scene
// header only; about a second after a reply lands, one Quick call reads the exchange and returns `decisions`, `state` (the
// tracker values of every enabled card field, from src/cards/catalog.js) and up to 12 change entries. Code then applies the
// checks of src/memory/validate.js and commits the result only to the revision it read (DESIGN 3.2).
//
// What lives where:
//   message.extra.ri_memory.capture = { hash, at, route, model, ops }   the capture stamp of the showing swipe (and its slot)
//   message.extra[KEY].tracker                                          the tracker values of that swipe (catalog header)
//   chat_metadata.ri_memory.capture = { watermark: { mark, reply } }    the newest reply whose showing swipe is captured
//
// The first half of this file is pure (request, schema, level 0 scene, tracker shape); the second half wires it to the host.
import { MEMORY, fold as foldChat, hashText, proseOf, revisionOf, storedMark, swipeOf, chatMemory } from './fold.js';
import { checkCapture, quoteIn, KINDS, THREAD_TYPES } from './validate.js';
import { captureFields, normalizeConfig } from '../cards/catalog.js';
import { parseSceneHeader, headerMode } from '../scene-header.js';
import { outcome } from '../dice.js';
import { sameStoryDay } from '../story-clock.js';
import { firedForCapture } from './fired-entries.js';
import { captureRollLines } from './rolls.js';
import { temperamentMap, speedOf, scaleStep, SPEED_KEYS } from './temperament.js';

export const BATCH_EVERY = 5;
export const RECORDS_BUDGET_CHARS = 4000;     // about 1,000 tokens of current records on a local route (DESIGN 7.2)
const PER_SUBJECT = Object.freeze({ characters: 'name', emotions: 'name', relationships: 'name' });
const SCENE_FROM_HEADER = ['place', 'time', 'present'];

// ---------------------------------------------------------------- out of character (DESIGN 3.4)

/** True for a message that opens with an out-of-character mark: (OOC, ((, [OOC, or one of the persona's own aside marks. */
export function isOutOfCharacter(text, marks = []) {
    const t = String(text ?? '').trimStart();
    if (/^(?:\(\s*OOC\b|\(\(|\[\s*OOC\b|<\s*OOC\b|OOC\s*:)/i.test(t)) return true;
    return marks.some(mark => mark && t.startsWith(mark));
}

// ---------------------------------------------------------------- the exchange

const isReply = m => m && !m.is_user && !m.is_system;

/** The exchange a capture reads: the reply at `index` and the player message before it. */
export function exchangeOf(chat, index) {
    const message = chat[index];
    let playerIndex = -1;
    for (let i = index - 1; i >= 0; i--) { if (chat[i]?.is_user) { playerIndex = i; break; } if (isReply(chat[i])) break; }
    const player = playerIndex >= 0 ? chat[playerIndex] : null;
    const rev = revisionOf(message);
    return { index, prose: proseOf(message), player: player ? String(player.mes ?? '') : '', playerIndex, playerMark: player ? storedMark(player) : '', ...rev, speaker: String(message?.name || '') };
}

/** The reply number of a chat index: reply 1 is the first reply after the opening message. */
export function replyNumber(chat, index) {
    let n = 0;
    for (let i = 1; i <= index && i < chat.length; i++) if (isReply(chat[i])) n += 1;
    return n;
}

// ---------------------------------------------------------------- fields and the schema

/** The fields capture asks for, grouped by card: { card: [field] }. A field switched off is not in the request. */
export function fieldsByCard(fields) {
    const out = {};
    for (const f of fields) (out[f.card] ||= []).push(f);
    return out;
}

// Meters move in steps (B40, her ruling of 25 November): the answer carries how far each emotion axis and relationship
// level moved, -5 to +5 with 0 the default, and the reason in the reply's own words or a character's action. Code adds
// the step to the value of the previous reply and holds it between 0 and 10 (applySteps below).
export const STEP_MIN = -5;
export const STEP_MAX = 5;
export const METER_MIN = 0;
export const METER_MAX = 10;
export const METER_START = 5;
export const AXES = Object.freeze(['tenderness', 'fury', 'dread', 'yearning']);
const STEP_VALUES = Object.freeze(Array.from({ length: STEP_MAX - STEP_MIN + 1 }, (_, i) => STEP_MIN + i));

/** One movement. The provider's form lists the allowed steps; the form code reads with accepts any number and clamps it. */
const stepSchema = loose => (loose
    ? { type: ['object', 'integer', 'null'], properties: { step: { type: ['integer', 'number', 'null'] }, reason: { type: ['string', 'null'] } } }
    : { type: 'object', required: ['step', 'reason'], properties: { step: { type: 'integer', enum: STEP_VALUES }, reason: { type: 'string' } } });

const MOVES = new Set(['meter', 'gauge']);
/** The fields capture asks for: a change field is dropped when its card has a level gauge, whose step carries the reason. */
export function askedFields(fields) {
    const gauged = new Set(fields.filter(f => f.type === 'gauge').map(f => f.card));
    return fields.filter(f => !(f.type === 'change' && gauged.has(f.card)));
}

function fieldSchema(field, loose = false) {
    switch (field.type) {
        case 'chips': case 'list': case 'timeline': return { type: 'array', items: { type: 'string' } };
        case 'meter': return { type: 'object', properties: Object.fromEntries(AXES.map(axis => [axis, stepSchema(loose)])) };
        case 'gauge': return stepSchema(loose);
        case 'faculty': return { type: 'integer' };
        default: return { type: 'string' };
    }
}

/** The JSON schema of `state` for the enabled fields. Per-subject cards return a list of objects with a name. */
export function stateSchema(fields, loose = false) {
    const properties = {};
    for (const [card, list] of Object.entries(fieldsByCard(askedFields(fields)))) {
        const props = Object.fromEntries(list.map(f => [f.field, fieldSchema(f, loose)]));
        if (PER_SUBJECT[card]) properties[card] = { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, ...props }, required: ['name'] } };
        else properties[card] = { type: 'object', properties: props };
    }
    return { type: 'object', properties };
}

const opSchema = loose => ({
    type: 'object',
    required: ['op', 'id', 'target', 'kind', 'subject', 'text', 'quote'],
    properties: {
        op: { type: 'string', enum: ['add', 'revise', 'supersede', 'retire', 'complete'] },
        id: { type: 'string' },
        target: { type: 'array', items: { type: 'string' } },
        kind: { type: 'string', enum: [...KINDS] },
        thread_type: { type: 'string', enum: [...THREAD_TYPES] },
        subject: { type: 'string' },
        attribute: { type: 'string' },
        text: { type: 'string' },
        quote: { type: 'string' },
        speaker: { type: 'string' },
        ends_when: { type: 'string' },
        thread_state: { type: 'string', enum: ['open', 'paused'] },
        temperament: { type: 'object', properties: Object.fromEntries(SPEED_KEYS.map(k => [k, { type: 'number' }])) },
        holders: { type: 'array', items: { type: 'string' } },
        believes: { type: 'string' },
        axes: { type: 'object', properties: Object.fromEntries(AXES.map(axis => [axis, stepSchema(loose)])) },
        outcome: { type: 'string' },
        importance: { type: 'integer' },
        aliases: { type: 'array', items: { type: 'string' } },
        details: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, value: { type: 'string' } }, required: ['field', 'value'] } },
        exchange: { type: 'integer' },
    },
});

/** The schema of one capture answer. */
// The story time a reply's events took (lead decision, 24 November): minutes, with the reply's own words that state it.
const TIME_SCHEMA = { type: 'object', required: ['elapsed', 'cue'], properties: { elapsed: { type: 'integer' }, cue: { type: 'string' } } };

/** The schema of one capture answer, in the strict form of strictSchema, which providers receive. */
export const captureSchema = (fields, options) => strictSchema(plainCapture(fields, options));

/** The schema code reads an answer with: only decisions and ops are required, so an older or terse answer still files. */
export const captureReadSchema = (fields, options) => ({ ...plainCapture(fields, { ...options, loose: true }), required: ['decisions', 'ops'] });

/** The capture answer's shape. The ops list is capped at 12 by code. */
function plainCapture(fields, { batch = false, suspects = false, loose = false } = {}) {
    const OP_SCHEMA = opSchema(loose);
    const props = {
        decisions: { type: 'object', required: ['durable_change', 'scene_ended', 'out_of_character'], properties: { durable_change: { type: 'boolean' }, scene_ended: { type: 'boolean' }, out_of_character: { type: 'boolean' } } },
        time: batch ? { type: 'array', items: { type: 'object', required: ['exchange', 'elapsed', 'cue'], properties: { exchange: { type: 'integer' }, ...TIME_SCHEMA.properties } } } : TIME_SCHEMA,
        ops: { type: 'array', items: batch ? { ...OP_SCHEMA, required: [...OP_SCHEMA.required, 'exchange'] } : OP_SCHEMA },
    };
    if (fields.length) props.state = batch ? { type: 'array', items: { type: 'object', properties: { exchange: { type: 'integer' }, ...stateSchema(fields, loose).properties }, required: ['exchange'] } } : stateSchema(fields, loose);
    if (suspects) props.rulings = { type: 'array', items: { type: 'object', required: ['id', 'ruling'], properties: { id: { type: 'string' }, ruling: { type: 'string', enum: ['keep', 'drop', 'replaces'] } } } };
    return { type: 'object', required: ['decisions', 'time', 'ops', ...(fields.length ? ['state'] : [])], properties: props };
}

/**
 * The strict form providers that enforce strict json_schema accept (OpenAI, NanoGPT): every object lists all of its
 * properties as required and allows no others, and a property that was optional takes null as well.
 */
export function strictSchema(schema) {
    if (!schema || typeof schema !== 'object') return schema;
    const out = { ...schema };
    if (out.items) out.items = strictSchema(out.items);
    if (out.type === 'object' || out.properties) {
        const props = out.properties || {};
        const required = new Set(out.required || []);
        out.properties = Object.fromEntries(Object.entries(props).map(([key, sub]) => {
            const strict = strictSchema(sub);
            return [key, required.has(key) ? strict : nullable(strict)];
        }));
        out.required = Object.keys(props);
        out.additionalProperties = false;
    }
    return out;
}
function nullable(schema) {
    const types = [].concat(schema.type || []);
    const out = { ...schema, type: types.includes('null') ? types : [...types, 'null'] };
    if (Array.isArray(out.enum) && !out.enum.includes(null)) out.enum = [...out.enum, null];
    return out;
}

export const DEFAULT_ELAPSED = 5;   // minutes a reply takes when it states no time of its own
const MAX_ELAPSED = 5256000;         // ten years, the clock's own bound (story-clock.js validElapsed)
/**
 * The minutes the reply's events took: the capture answer's elapsed when its cue is the reply's own words, else the
 * default of 5 minutes. Returns { minutes, cue, source }.
 */
export function elapsedOf(time, prose) {
    const n = Number(time?.elapsed);
    const cue = typeof time?.cue === 'string' && time.cue.trim() && quoteIn(time.cue, prose) ? time.cue.trim().slice(0, 120) : '';
    if (cue && Number.isInteger(n) && n >= 0 && n <= MAX_ELAPSED) return { minutes: n, cue, source: 'capture' };
    return { minutes: DEFAULT_ELAPSED, cue: '', source: 'default' };
}

/** The story minute before chat[index]: the newest earlier reply's clock, or the chat's starting clock. */
export function minutesBefore(chat, index, key, seed) {
    for (let i = index - 1; i >= 0; i--) {
        const value = isReply(chat[i]) ? chat[i]?.extra?.[key]?.v10Minutes : undefined;
        if (Number.isSafeInteger(value)) return value;
    }
    return Number.isSafeInteger(seed) ? seed : null;
}

// ---------------------------------------------------------------- the prompt

// Stable parts first so a provider can reuse them (DESIGN 7.2). Rules from M1i 4 and 8, M1b-4 5 and the MB11 findings.
export const CAPTURE_RULES = [
    'You keep the records of a roleplay story. Read the newest exchange and answer in JSON.',
    'Step 1, decisions.durable_change: true only when the newest reply makes something true that will still matter in later scenes and that the stored records do not already hold. Examples: a new named person, place or item; an item changing hands, breaking or being used up; a wound or condition that lasts; an agreement with its terms, a price, a deadline or a number; a secret told or found out; a thread that opens, moves or ends; a change in how two characters stand.',
    'durable_change is false for: answers to the player\'s questions that repeat stored facts, travel, arrivals, crossings and who is present (the scene keeps those), time passing, weather and scenery, routine actions, small talk, and descriptions of what is already known. Most replies change nothing lasting. When it is false, ops is [].',
    'Step 2, ops: one entry per lasting change, at most 12. op "add" files a new record with a new short lowercase id of words and hyphens. op "revise" gives an existing record a new text and keeps its id. op "supersede" files a new record whose newer state replaces an older one; put the older id in target. op "complete" ends an open thread; put its id in target and say how it ended in outcome. op "retire" says a record no longer holds; put its id in target.',
    'Reuse an existing id when the fact is already filed. Do not file what a stored record already says.',
    'kind is one of fact, person, trait, place, item, secret, relationship, emotion, reputation, achievement, thread. A thread has thread_type Open, Plotline, Track, Seed, Detail, Pending, Plan or Elsewhere. A secret lists its holders, the characters who know it; a false belief is a secret with believes set to what the holder wrongly believes. An item names its holder and what changed in details. A relationship names the other person in details (field "other"). An emotion gives axes: for each of tenderness, fury, dread and yearning, a step from -5 to 5 for how far the newest reply moved it (0 when it moved nothing) and a reason, a quote from the reply or an action a character takes in it.',
    'quote: copy the exact words from the newest exchange, 200 characters or fewer, that show the change. text: one plain sentence of 300 characters or fewer.',
    'Write text like an incident report: who did what, when, where, how many, on what terms and with what result. Keep names, numbers, places, distances, deadlines and agreements exact. Leave out emotions, inner thoughts, opinions, motives and mood; a feeling enters only as an action or as a line a character spoke.',
    'A claim files the same way whether a character speaks it or the narration states it, about the speaker or about anyone else: a trait or fact on the person or thing it describes, with text stating the claim itself ("Mira dislikes tea"). When a spoken line carries it, set speaker to who said it and quote that line. A claim the story shows to be a lie, and a secret only some characters know, are secret records: holders lists who knows it and believes holds what a deceived character takes as true. When a later line, spoken or narrated, contradicts a stored record, use op supersede with the older id in target. A feeling a character states aloud moves that person\'s emotion axes and files no trait.',
    'A Plotline or Pending thread carries ends_when: one plain line naming what has to happen for the thread to end ("when Hale learns who sent the letter"). Each stored thread lists its ends when line. When the newest reply makes that line true, use op complete for that thread with a quote from the reply; otherwise the thread stays open. When the story sets an open thread aside, use op revise with thread_state "paused"; when the story returns to a paused thread, use op revise with thread_state "open". A revise repeats the thread\'s text.',
    'temperament: on an op add that files a person for the first time, rate how fast that person\'s feelings move from how the story introduces them: for each of tenderness, fury, dread, yearning and level (their relationship level) a number from 0.5 (guarded, moves slowly) to 1.5 (volatile, moves fast), 1 for typical. Every other op leaves temperament null.',
    'decisions.scene_ended: true when the reply moves the story to a new time or place or closes the scene. decisions.out_of_character: true when the player message is an aside to the writer outside the story.',
    'time.elapsed: the minutes of story time the reply\'s events took, counting any jump ("an hour later" is 60). time.cue: the reply\'s own words that state that time, copied exactly; null when the reply states no time.',
].join('\n');

const STATE_RULE = 'state: the values of the listed fields for the newest reply, as the story stands at its end, each in a few words. Leave out a field the story does not establish. Per-character cards list one object per character present, by name.';
const HEADER_RULE = 'The reply opens with a scene header line. Copy place, time and who is present from it; report weather from the prose when it changes after the header.';
const DUE_RULE = 'Pending threads listed as due during the time skip fell due while the story jumped ahead. Use op complete, op revise or no op for each, by what the newest reply shows.';
const dueOf = rec => { const b = rec?.v10SceneBreak; return b && b.ruled !== true && Array.isArray(b.due) ? b.due.filter(d => d && String(d.text || '').trim()) : []; };
const STEP_RULE = 'Meters and levels report movement. Each emotion axis (tenderness, fury, dread, yearning) and each relationship level is { step, reason }: step is a whole number from -5 to 5 for how far the newest reply moved it, 0 when it moved nothing; reason is a quote from the reply or an action a character takes in it. Code keeps the running value.';
// The Recording prompts she can edit on the Prompts page (B60). They sit with the stable rules, after them and before the
// field list, so they change the prefix only when she edits one or switches a module.
const RECORDING_RULE = 'Recording guidance from the player\'s settings. Follow it within the answer form above:';
const SUSPECT_RULE = 'rulings: for each suspect listed, "keep" when it is a separate record, "drop" when it repeats the record it resembles, "replaces" when its newer state replaces that record.';

const fieldLine = f => `${f.card}.${f.field} (${f.label}, ${f.type})${f.hint ? `: ${f.hint}` : ''}`;
const recordLine = r => `${r.id} | ${r.kind}${r.threadType ? `/${r.threadType}` : ''} | ${r.subject || '-'} | ${r.status === 'done' ? '(closed) ' : ''}${String(r.text || '').replace(/\s+/g, ' ')}${r.holders?.length ? ` | known by ${r.holders.join(', ')}` : ''}${r.kind === 'thread' && r.endsWhen ? ` | ends when ${r.endsWhen}` : ''}${r.kind === 'thread' && r.paused ? ' | paused' : ''}`;
const normName = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();

/** The records whose subject or aliases the exchange names, open threads first, within the budget. */
export function recordsFor(text, records, { budget = RECORDS_BUDGET_CHARS, present = [] } = {}) {
    const t = ` ${normName(text)} `;
    const named = r => [r.subject, ...(r.aliases || [])].filter(Boolean).some(n => { const k = normName(n); return k.length >= 3 && (t.includes(` ${k} `) || k.split(' ').some(w => w.length >= 4 && t.includes(` ${w} `))); });
    const here = new Set(present.map(normName));
    const live = records.filter(r => !['retired', 'replaced', 'merged', 'suspect'].includes(r.status) && !['chapter', 'condensed', 'arc', 'stat sheet', 'scene'].includes(r.kind));
    const ranked = live.map(r => ({ r, score: (named(r) ? 2 : 0) + (r.kind === 'thread' && r.status !== 'done' && !r.paused ? 1 : 0) + (here.has(normName(r.subject)) ? 1 : 0) })).filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score || (b.r.importance || 5) - (a.r.importance || 5));
    const out = [];
    let used = 0;
    for (const { r } of ranked) { const line = recordLine(r); if (used + line.length + 1 > budget) continue; out.push(r); used += line.length + 1; }
    return out;
}

/**
 * The capture request for one exchange, or for a batch. Returns { system, user, schema }.
 *   exchanges: [{ prose, player, header, roll, fired, reply }]
 *   records: the fold's records; suspects: records held as suspects; fields: from captureFields; cast: names
 *   recording: the Recording prompt texts of the modules that are on (src/v10.js recordingPrompts, B60)
 */
export function buildCaptureRequest({ exchanges, records = [], fields = [], suspects = [], cast = [], headerReliable = true, recording = [] }) {
    const batch = exchanges.length > 1;
    const askFields = askedFields(fields);
    const system = [
        CAPTURE_RULES,
        askFields.length && STATE_RULE,
        askFields.some(f => MOVES.has(f.type)) && STEP_RULE,
        askFields.length && headerReliable && askFields.some(f => f.card === 'scene' && SCENE_FROM_HEADER.includes(f.field)) && HEADER_RULE,
        suspects.length && SUSPECT_RULE,
        exchanges.some(x => x.dueSkip?.length) && DUE_RULE,
        recording.length && `${RECORDING_RULE}\n${recording.join('\n')}`,
        batch && 'Several exchanges follow, numbered. Give each op the number of the exchange its quote comes from in "exchange", and give state one object per exchange with its number.',
        askFields.length ? `Fields to fill in state:\n${askFields.map(fieldLine).join('\n')}` : 'No state fields are switched on; return state as {}.',
    ].filter(Boolean).join('\n');
    const text = exchanges.map(x => `${x.player}\n${x.prose}`).join('\n');
    const known = recordsFor(text, records, { present: cast });
    const aliases = [...new Set(records.flatMap(r => (r.aliases || []).length && ['person', 'place'].includes(r.kind) ? [`${r.subject}: ${r.aliases.join(', ')}`] : []))].slice(0, 30);
    const parts = [
        cast.length ? `Cast: ${cast.join(', ')}.` : '',
        aliases.length ? `Names in use:\n${aliases.join('\n')}` : '',
        `Stored records (id | kind | subject | text):\n${known.map(recordLine).join('\n') || '(none yet)'}`,
        suspects.length ? `Suspects to rule (each resembles a stored record):\n${suspects.map(s => `${s.id} resembles ${s.suspectOf} (raised at reply ${s.raisedAt ?? '?'}): ${s.text}`).join('\n')}` : '',
        ...exchanges.map((x, i) => [
            batch ? `Exchange ${i + 1} (reply ${x.reply}):` : 'Newest exchange:',
            `The player wrote:\n${x.player || '(nothing)'}`,
            x.roll ? `Roll for this turn: ${x.roll}` : '',
            x.fired?.length ? `Behavior entries that fired: ${x.fired.join('; ')}` : '',
            ...(x.dueSkip || []).map(d => `Due during the time skip: ${String(d.text).replace(/\s+/g, ' ').trim()}`),
            `The reply${x.header ? ` (scene header: ${x.header})` : ''}:\n${x.prose}`,
        ].filter(Boolean).join('\n')),
    ];
    return { system, user: parts.filter(Boolean).join('\n\n'), schema: captureSchema(askFields, { batch, suspects: suspects.length > 0 }), read: captureReadSchema(askFields, { batch, suspects: suspects.length > 0 }) };
}

/** One line for a roll stored with the turn: the actor, the attempt, the total and the verdict code gave the reply. */
export function rollLine(check) {
    if (!check || !Number.isFinite(Number(check.total))) return '';
    const verdict = check.degree || check.result || outcome(check.natural, check.total);
    return `${check.name || check.actor || 'someone'} attempts ${check.action || 'an action'}; ${check.stat || 'stat'} d20 ${check.natural} + ${check.mod ?? 0} = ${check.total}${check.dc ? ` against ${check.dc}` : ''}: ${verdict}.`;
}

// ---------------------------------------------------------------- level 0: the scene in code (DESIGN 7.1)

const scenePart = v => (v && typeof v === 'object' && !Array.isArray(v) && Object.hasOwn(v, 'v') ? v.v : v);
const presentList = v => (Array.isArray(v) ? v : String(v || '').split(/\s*,\s*|\s+and\s+/)).map(s => String(s).trim()).filter(Boolean);

/**
 * The scene of a reply: the header line when it is reliable, else capture's state alone; weather from the prose when
 * capture reports a change; values not set in this reply carried from the previous scene with `from`, except weather
 * from an earlier story day, which expires (M1a W11, M1g B4).
 */
export function sceneFor({ header = null, captured = {}, previous = {}, headerReliable = true, reply = 0, previousReply = 0 }) {
    const own = {};
    if (headerReliable && header) {
        if (header.place) own.place = header.place;
        if (header.time) own.time = header.time;
        if (header.weather) own.weather = header.weather;
        if (header.present?.length) own.present = header.present;
    }
    for (const [key, value] of Object.entries(captured || {})) {
        if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) continue;
        if (headerReliable && header && SCENE_FROM_HEADER.includes(key) && own[key] !== undefined) continue;
        own[key] = key === 'present' ? presentList(value) : value;
    }
    const scene = { ...own };
    const day = scenePart(own.time) ?? scenePart(previous.time);
    for (const [key, raw] of Object.entries(previous || {})) {
        if (Object.hasOwn(scene, key)) continue;
        if (key === 'weather' && sameStoryDay(scenePart(previous.time), day) === false) continue;
        scene[key] = raw && typeof raw === 'object' && !Array.isArray(raw) && Object.hasOwn(raw, 'v') ? raw : { v: raw, from: previousReply || null };
    }
    return scene;
}

// ---------------------------------------------------------------- steps that code applies (B40)

const foldName = value => String(value ?? '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const clampMeter = n => Math.max(METER_MIN, Math.min(METER_MAX, n));
const plain = raw => (raw && typeof raw === 'object' && !Array.isArray(raw) && Object.hasOwn(raw, 'v') ? raw.v : raw);
const finite = raw => { const n = Number(plain(raw)); return raw === null || raw === undefined || raw === '' || !Number.isFinite(n) ? null : n; };

/** A captured movement as { step, reason, note }: an integer clamped to -5..5 (note says why), a missing step counts as 0. */
export function readStep(raw) {
    const entry = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
    const reason = typeof entry?.reason === 'string' ? entry.reason.trim().slice(0, 200) : '';
    const n = Number(entry?.step);
    if (!entry || entry.step === null || entry.step === undefined || entry.step === '' || !Number.isFinite(n)) return { step: 0, reason, note: entry ? 'no step, counted as 0' : (raw === undefined || raw === null ? '' : 'a bare number is not a step, counted as 0') };
    const whole = Math.round(n);
    const step = Math.max(STEP_MIN, Math.min(STEP_MAX, whole));
    return { step, reason, note: step !== n ? `step ${n} clamped to ${step}` : '' };
}

/**
 * The value a subject's meter held in the newest reply before `index` that carries it (old chats' absolute numbers read
 * the same way), or null. Looks at the tracker of each reply's showing swipe.
 */
export function previousMeter(chat, index, key, card, name, field, axis = '') {
    for (let i = index - 1; i > 0; i--) {
        if (!isReply(chat[i])) continue;
        const raw = chat[i]?.extra?.[key]?.tracker?.[card];
        const items = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? [raw] : []);
        const item = items.find(x => !name || foldName(x?.name) === foldName(name));
        if (!item) continue;
        const cell = plain(item[field]);
        const value = axis ? finite(cell?.[axis]) : finite(cell);
        if (value !== null) return clampMeter(value);
    }
    return null;
}

/** The chat's starting value for a subject's meter, from chat data (`ri_memory.meterStart[card][name][axis]`), else 5. */
export function meterStart(meta, card, name, field, axis = '') {
    const at = meta?.[MEMORY]?.meterStart?.[card]?.[foldName(name)]?.[axis || field];
    return finite(at) === null ? METER_START : clampMeter(finite(at));
}

const lockId = (card, name, field, axis) => [card, foldName(name), field, axis].join('|');

/**
 * Turn a captured state of steps into values: each meter axis and gauge becomes the previous reply's value plus the step,
 * held between 0 and 10. A value she set by hand on this reply (`own.locks`) stays as she set it. Returns
 * { state, steps, notes }: `state` holds numbers, `steps` the movements as captured per card and subject, `notes` what
 * code corrected for the receipt.
 */
export function applySteps(state, fields, { chat = [], index = 0, key = '', meta = {}, own = null, temperaments = null } = {}) {
    const out = structuredClone(state || {});
    const steps = {};
    const notes = [];
    const locks = new Set(own?.locks || []);
    const ownItems = card => { const raw = own?.[card]; return Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? [raw] : []); };
    for (const f of fields.filter(x => MOVES.has(x.type))) {
        const raw = out[f.card];
        const subjects = PER_SUBJECT[f.card] ? (Array.isArray(raw) ? raw : []) : (raw && typeof raw === 'object' ? [raw] : []);
        for (const item of subjects) {
            const name = PER_SUBJECT[f.card] ? String(item?.name || '') : '';
            if (!item || (PER_SUBJECT[f.card] && !name.trim())) continue;
            const mine = ownItems(f.card).find(x => !name || foldName(x?.name) === foldName(name));
            const settle = (cell, axis) => {
                const id = lockId(f.card, name, f.field, axis);
                const held = locks.has(id) ? finite(axis ? plain(mine?.[f.field])?.[axis] : mine?.[f.field]) : null;
                const read = readStep(cell);
                if (read.note) notes.push(`${f.card}.${f.field}${axis ? `.${axis}` : ''}${name ? ` (${name})` : ''}: ${read.note}`);
                if (held !== null) return { value: clampMeter(held), step: 0, reason: '' };
                const before = previousMeter(chat, index, key, f.card, name, f.field, axis) ?? meterStart(meta, f.card, name, f.field, axis);
                // B48: the person's temperament scales the step (1 when none is filed); the step kept is the one applied.
                const speed = name ? speedOf(temperaments, name, axis || 'level') : 1;
                const step = speed === 1 ? read.step : scaleStep(read.step, speed);
                return { value: clampMeter(before + step), step, reason: read.reason };
            };
            const record = ((steps[f.card] ||= {})[foldName(name)] ||= { name });
            if (f.type === 'meter') {
                const cells = item[f.field] && typeof item[f.field] === 'object' ? item[f.field] : {};
                const values = {}; const moved = {};
                for (const axis of AXES) { const r = settle(cells[axis], axis); values[axis] = r.value; moved[axis] = { step: r.step, reason: r.reason }; }
                item[f.field] = values; item[`${f.field}_steps`] = moved; record[f.field] = moved;
            } else {
                const r = settle(item[f.field], '');
                item[f.field] = r.value; item[`${f.field}_steps`] = { step: r.step, reason: r.reason }; record[f.field] = item[`${f.field}_steps`];
                item.change = { delta: r.step, reason: r.reason };
            }
        }
    }
    return { state: out, steps, notes };
}

/**
 * Emotion records name their axes as steps too: replace each axis step with the value code computes from the record's
 * latest axes (or the tracker's value for that person, or the chat's start), so validation reads whole 0 to 10 values.
 */
export function stepOps(ops, { records = [], chat = [], index = 0, key = '', meta = {}, temperaments = null } = {}) {
    const notes = [];
    const next = (ops || []).map(op => {
        if (!op || typeof op !== 'object' || !op.axes || typeof op.axes !== 'object') return op;
        const before = records.find(r => r.id === op.id && r.axes)
            || records.find(r => r.kind === 'emotion' && r.axes && foldName(r.subject) === foldName(op.subject) && foldName(r.other || '') === foldName(op.details?.find?.(d => d.field === 'other')?.value || ''));
        const axes = {};
        for (const axis of AXES) {
            if (!Object.hasOwn(op.axes, axis)) continue;
            const read = readStep(op.axes[axis]);
            if (read.note) notes.push(`ops.axes.${axis} (${op.subject || op.id}): ${read.note}`);
            const base = finite(before?.axes?.[axis]) ?? previousMeter(chat, index, key, 'emotions', op.subject, 'axes', axis) ?? meterStart(meta, 'emotions', op.subject, 'axes', axis);
            axes[axis] = clampMeter(base + scaleStep(read.step, speedOf(temperaments, op.subject, axis)));
        }
        return { ...op, axes };
    });
    return { ops: next, notes };
}

/**
 * Set one meter value by hand on a message's showing swipe and lock it: later steps start from her value, and a repeat
 * capture of this reply keeps it. `field` is the catalog field ('axes' or 'level'); `axis` names the axis for a meter.
 */
export function setMeterByHand(message, key, { card, name = '', field, axis = '', value }) {
    const n = finite(value);
    if (n === null) return false;
    const holders = [message.extra ||= {}];
    const slot = message.swipe_info?.[swipeOf(message)];
    if (slot && typeof slot === 'object') holders.push(slot.extra ||= {});
    for (const holder of holders) {
        const rec = holder[key] && typeof holder[key] === 'object' ? holder[key] : (holder[key] = {});
        const tracker = rec.tracker ||= {};
        let item = tracker[card];
        if (PER_SUBJECT[card]) {
            item = (Array.isArray(item) ? item : (tracker[card] = []));
            let hit = item.find(x => foldName(x?.name) === foldName(name));
            if (!hit) item.push(hit = { name });
            item = hit;
        } else item = (tracker[card] ||= {});
        if (axis) item[field] = { ...(item[field] && typeof item[field] === 'object' ? item[field] : {}), [axis]: clampMeter(Math.round(n)) };
        else item[field] = clampMeter(Math.round(n));
        const id = lockId(card, name, field, axis);
        tracker.locks = [...new Set([...(tracker.locks || []), id])];
    }
    return true;
}

/** The tracker values of a reply in the catalog's shape: single-subject cards as objects, per-subject cards as lists. */
export function trackerFrom(state, fields, { scene = null } = {}) {
    const byCard = fieldsByCard(fields);
    const out = {};
    for (const [card, list] of Object.entries(byCard)) {
        const value = state?.[card];
        const keep = new Set(list.flatMap(f => (MOVES.has(f.type) ? [f.field, `${f.field}_steps`, ...(f.type === 'gauge' ? ['change'] : [])] : [f.field])));
        if (PER_SUBJECT[card]) {
            const items = (Array.isArray(value) ? value : []).filter(item => item && String(item.name || '').trim())
                .map(item => Object.fromEntries(Object.entries(item).filter(([k, v]) => (k === 'name' || keep.has(k)) && v !== undefined && v !== null && v !== '')));
            if (items.length) out[card] = items;
        } else if (value && typeof value === 'object') {
            const obj = Object.fromEntries(Object.entries(value).filter(([k, v]) => keep.has(k) && v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)));
            if (Object.keys(obj).length) out[card] = obj;
        }
    }
    if (scene && Object.keys(scene).length) {
        const keep = new Set((byCard.scene || []).map(f => f.field));
        out.scene = Object.fromEntries(Object.entries(scene).filter(([k]) => !byCard.scene || keep.has(k) || ['place', 'time', 'weather', 'present'].includes(k)));
    }
    return out;
}

// ---------------------------------------------------------------- capture marks and the watermark (pure over the chat)

const holderOf = (message, swipe = swipeOf(message)) => (swipe === swipeOf(message) ? message?.extra : message?.swipe_info?.[swipe]?.extra) || null;

/** The capture stamp of a message's showing swipe, or null. */
export const stampOf = message => holderOf(message)?.[MEMORY]?.capture || null;

/** True when the showing swipe of a reply has a committed capture of its current text. */
export function isCaptured(message) {
    const stamp = stampOf(message);
    return !!stamp && stamp.hash === hashText(proseOf(message));
}

/** The newest reply whose showing swipe is captured: { index, reply, mark }, or reply 0 when none is. */
export function watermarkOf(chat) {
    for (let i = (chat || []).length - 1; i > 0; i--) if (isReply(chat[i]) && isCaptured(chat[i])) return { index: i, reply: replyNumber(chat, i), mark: storedMark(chat[i]) };
    return { index: 0, reply: 0, mark: '' };
}

/** Replies after the opening that wait for capture, oldest first (out-of-character exchanges skip capture). */
export function uncaptured(chat, { upTo = Infinity, from = 1, oocMarks = [] } = {}) {
    const out = [];
    for (let i = Math.max(1, from); i < Math.min((chat || []).length, upTo + 1); i++) {
        if (!isReply(chat[i]) || isCaptured(chat[i])) continue;
        const ex = exchangeOf(chat, i);
        if (isOutOfCharacter(ex.player, oocMarks)) continue;
        out.push(i);
    }
    return out;
}

/** What the tray says about one reply's state: captured, or pending with the reply its cards describe ("As of reply 41"). */
export function captureStatus(chat, index) {
    const message = chat?.[index];
    if (!isReply(message)) return { pending: false };
    if (isCaptured(message)) return { pending: false, captured: true };
    const mark = watermarkOf((chat || []).slice(0, index));
    return { pending: true, asOf: mark.reply, label: mark.reply ? `As of reply ${mark.reply}` : 'Not captured yet' };
}

/** Write a capture stamp and the tracker values on the showing swipe of a message (its extra and its swipe slot). */
export function stampMessage(message, { hash, at, route = '', model = '', ops = 0, tracker = null, notes = [], key = '', clock = null, ruleDue = false }) {
    const stamp = { hash, at, ...(route ? { route } : {}), ...(model ? { model } : {}), ops, ...(notes.length ? { notes: notes.slice(0, 20) } : {}) };
    const holders = [message.extra ||= {}];
    const slot = message.swipe_info?.[swipeOf(message)];
    if (slot && typeof slot === 'object') holders.push(slot.extra ||= {});
    for (const holder of holders) {
        holder[MEMORY] = { ...(holder[MEMORY] || {}), capture: stamp };
        // The threads that fell due in a typed time skip were put to this call once; the reply's ops ruled on them.
        if (ruleDue && key && holder[key]?.v10SceneBreak && typeof holder[key].v10SceneBreak === 'object') holder[key].v10SceneBreak.ruled = true;
        // The story clock moves by the minutes the reply took, unless the reply's own block already set it.
        if (clock && key && !holder[key]?.v10ClockFromReply) {
            const rec = holder[key] && typeof holder[key] === 'object' ? holder[key] : (holder[key] = {});
            rec.v10Elapsed = { minutes: clock.minutes, cue: clock.cue, source: clock.source };
            if (Number.isSafeInteger(clock.base)) rec.v10Minutes = clock.base + clock.minutes;
        }
        if (tracker && key) {
            const rec = holder[key] && typeof holder[key] === 'object' ? holder[key] : (holder[key] = {});
            rec.tracker = structuredClone(tracker);
        }
    }
}

// ---------------------------------------------------------------- applying an answer

/**
 * Split one answer into per-reply commits. A single answer goes to its one exchange; a batch answer's ops and state go to
 * the exchange each names. Returns [{ index, exchange, answer }].
 */
export function splitAnswer(value, exchanges) {
    if (exchanges.length === 1) return [{ index: exchanges[0].index, exchange: exchanges[0], answer: value || {} }];
    const state = Array.isArray(value?.state) ? value.state : [];
    return exchanges.map((x, i) => ({
        index: x.index, exchange: x,
        answer: { decisions: value?.decisions || {}, ops: (value?.ops || []).filter(op => Number(op.exchange) === i + 1), state: state.find(s => Number(s.exchange) === i + 1) || {},
            time: (Array.isArray(value?.time) ? value.time : []).find(t => Number(t.exchange) === i + 1) || null, rulings: i === exchanges.length - 1 ? value?.rulings : [] },
    }));
}

/** The checked inputs for one exchange of an answer (pure): wraps validate.checkCapture with the fold's records. */
export function checkedInputs(answer, exchange, foldResult, origin = {}) {
    return checkCapture(answer, exchange, { records: foldResult?.records || [], ...origin });
}

// ================================================================ the host side

let host = null;
async function hostParts() {
    if (host) return host;
    const st = await import('../st.js');
    const store = await import('../store.js');
    const routing = await import('../routing.js');
    const memStore = await import('./store.js');
    const queue = await import('./queue.js');
    host = { st, store, routing, memStore, queue };
    return host;
}

/**
 * The Recording prompts a capture carries for these modules, in her saved wording (B60). Without modules (the chapter call's
 * remainder) it reads the chat's modules as capture after a reply does. A host that cannot supply them sends none.
 */
async function recordingFor(modules) {
    try {
        const v10 = await import('../v10.js');
        const mods = modules || await (await import('./inject.js')).hostCaptureModules(v10.effectiveModules());
        return v10.recordingPrompts(mods || {});
    } catch (error) { console.warn('Roleplay Instructions could not read the Recording prompts for capture.', error); return []; }
}

const listeners = new Set();
/** Tell the tray and the Strip when a capture starts or ends: fn({ index, phase: 'capturing'|'done'|'failed'|'waiting' }). */
export function onCapture(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const tell = event => { for (const fn of listeners) { try { fn(event); } catch { /* a listener must not stop capture */ } } };

/** The enabled fields for this chat: catalog fields of cards that are not Off and features that are on. */
export function enabledFields(settingsValue, modules = {}) {
    return captureFields(normalizeConfig(settingsValue?.trayCards), modules);
}

/** True when every card that carries state is Off, so capture may batch every five replies (DESIGN 7.2). */
export const stateCardsOff = fields => !fields.length;

/** The capture setting: 'reply' (after each reply) or 'five' (every five replies while the state cards are off). */
export function captureEvery(settingsValue, fields) {
    return settingsValue?.memory?.capture === 'five' && stateCardsOff(fields) ? 'five' : 'reply';
}

/** The pieces a capture call reads for some replies, with the request built. */
export function captureCall(chat, indices, { records, suspects = [], fields = [], cast = [], headerReliable = true, recording = [], rollOf = () => '', firedOf = () => [], key = '' } = {}) {
    const exchanges = indices.map(index => {
        const ex = exchangeOf(chat, index);
        const header = headerReliable ? parseSceneHeader(chat[index]?.mes) : null;
        const rec = key ? chat[index]?.extra?.[key] : null;
        return { ...ex, reply: replyNumber(chat, index), headerFields: header, header: header ? [header.place, header.time, header.weather, header.present?.join(', ')].filter(Boolean).join(' · ') : '', roll: rollOf(rec, chat[index]), fired: firedOf(rec, chat[index]), dueSkip: dueOf(rec), cast };
    });
    return { exchanges, ...buildCaptureRequest({ exchanges, records, fields, suspects, cast, headerReliable, recording }) };
}

/**
 * Commit one checked answer to its reply through the store, with the tracker values and the capture stamp, only while the
 * revision it read still shows. Resolves the store's result plus { inputs, dropped }.
 */
export async function commitExchange({ store, chat, exchange, answer, foldResult, fields, key, route, model, callId, headerReliable, previousScene = {}, previousReply = 0, baseMinutes = null, chatMeta = null, now = Date.now() }) {
    const meta = chatMeta || {};
    const existing = chat?.[exchange.index]?.extra?.[key]?.tracker || null;
    const temperaments = temperamentMap(foldResult?.records || [], answer?.ops);
    const stepped = stepOps(answer?.ops, { records: foldResult?.records || [], chat, index: exchange.index, key, meta, temperaments });
    const checked = checkedInputs({ ...answer, ops: stepped.ops }, exchange, foldResult, { route, model, callId });
    const applied = applySteps(checked.state, fields, { chat, index: exchange.index, key, meta, own: existing, temperaments });
    checked.state = applied.state;
    const stepNotes = [...stepped.notes, ...applied.notes];
    const header = headerReliable ? exchange.headerFields : null;
    const scene = sceneFor({ header, captured: checked.state?.scene || {}, previous: previousScene, headerReliable, reply: exchange.reply, previousReply });
    const tracker = trackerFrom(checked.state, fields, { scene });
    if (checked.decisions.scene_ended) tracker.sceneEnded = true;
    if (existing?.locks?.length) tracker.locks = [...existing.locks];
    const job = { chatId: exchange.chatId, index: exchange.index, mark: exchange.mark, swipe: exchange.swipe, hash: exchange.hash };
    const result = await store.commit(job, checked.inputs, {
        reason: 'capture',
        onMessage: message => stampMessage(message, { hash: exchange.hash, at: now, route, model, ops: checked.inputs.length, tracker, notes: stepNotes, key, ruleDue: dueOf(chat?.[exchange.index]?.extra?.[key]).length > 0, clock: { ...elapsedOf(answer?.time, exchange.prose), base: baseMinutes } }),
    });
    return { ...result, inputs: checked.inputs, dropped: checked.dropped, tracker, decisions: checked.decisions, stepNotes };
}

/** The scene of the newest captured reply before `index`, with its reply number, for carrying values forward. */
export function previousSceneOf(chat, index, key) {
    for (let i = index - 1; i > 0; i--) {
        if (!isReply(chat[i])) continue;
        const scene = chat[i]?.extra?.[key]?.tracker?.scene;
        if (scene) return { scene, reply: replyNumber(chat, i) };
    }
    return { scene: {}, reply: 0 };
}

const suspectsIn = (result, chat) => (result?.records || []).filter(r => r.status === 'suspect').map(r => ({ ...r, raisedAt: (() => { const v = r.versions?.at(-1); return v?.index != null ? replyNumber(chat, v.index) : undefined; })() }));

/**
 * Run capture for some replies now (the queue's handler calls this). Builds the request from the chat as it stands, runs the
 * capture chain and commits each exchange to the revision it read. Returns { ok, route, model, waiting, commits }.
 */
export async function runCapture(indices, { signal, chain, runChainFn, context, store, settingsValue, modules = {}, now = Date.now } = {}) {
    const H = await hostParts();
    const c = context || H.st.ctx();
    const chat = c.chat || [];
    const chatId = String(c.getCurrentChatId?.() || '');
    const key = H.st.KEY;
    const st = settingsValue || H.store.settings();
    const fields = enabledFields(st, modules);
    const reliable = headerMode() !== 'tray';
    const memoryStore = store || H.memStore.memoryStore();
    memoryStore.marks();
    const live = indices.filter(i => isReply(chat[i]) && !isCaptured(chat[i]));
    if (!live.length) return { ok: true, route: '', model: '', commits: [] };
    const foldResult = foldChat(chat, c.chatMetadata || {});
    const cast = [...new Set([H.st.names().char, H.st.names().user].filter(Boolean))];
    const call = captureCall(chat, live, {
        records: foldResult.records, suspects: suspectsIn(foldResult, chat), fields, cast, headerReliable: reliable, key, recording: await recordingFor(modules),
        // The turn's dice rolls (MB14, src/memory/rolls.js), else a roll saved before degrees.
        rollOf: (rec, message) => captureRollLines(message) || rollLine(rec?.v10Check || rec?.roll), firedOf: firedForCapture,
    });
    for (const i of live) tell({ index: i, phase: 'capturing' });
    const exchanges = call.exchanges.map(x => ({ ...x, chatId }));
    const run = runChainFn || ((options) => H.routing.runChain(chain || H.routing.chainFor('capture'), { job: 'capture', ...options }));
    const res = await run({ system: call.system, user: call.user, schema: { name: 'capture', value: call.schema, read: call.read }, tokens: Math.min(2400, 500 + 120 * fields.length + 200 * live.length), signal, label: live.length > 1 ? `Capture, replies ${exchanges[0].reply} to ${exchanges.at(-1).reply}` : `Capture, reply ${exchanges[0].reply}` });
    if (!res.ok) { for (const i of live) tell({ index: i, phase: res.waiting ? 'waiting' : 'failed' }); return { ok: false, waiting: res.waiting, reason: res.reason, route: '', model: '', commits: [] }; }
    const commits = [];
    for (const part of splitAnswer(res.value, exchanges)) {
        const prev = previousSceneOf(c.chat || [], part.index, key);
        const baseMinutes = minutesBefore(c.chat || [], part.index, key, c.chatMetadata?.[key]?.v10ClockSeed);
        const out = await commitExchange({ store: memoryStore, chat, exchange: part.exchange, answer: part.answer, foldResult, fields, key, route: res.route, model: res.model, callId: `${res.route}:${now()}`, headerReliable: reliable, previousScene: prev.scene, previousReply: prev.reply, baseMinutes, chatMeta: c.chatMetadata, now: now() });
        commits.push({ index: part.index, ...out });
        tell({ index: part.index, phase: out.committed ? 'done' : 'failed', result: out });
    }
    const meta = c.chatMetadata || {};
    const mark = watermarkOf(c.chat || []);
    chatMemory(meta).capture = { watermark: { mark: mark.mark, reply: mark.reply } };
    return { ok: true, route: res.route, model: res.model, commits, usage: res.usage };
}

/** The capture job of some replies, keyed by the newest one so a batch merges. */
export function captureJob(chat, indices, chatId, model = '') {
    const sources = Object.fromEntries(indices.map(i => { const r = revisionOf(chat[i]); return [r.mark, `${r.swipe}:${r.hash}`]; }));
    const newest = revisionOf(chat[indices.at(-1)]);
    return { chatId, kind: 'capture', subject: indices.length > 1 ? `batch:${newest.mark}` : newest.mark, order: indices[0], model, sources, payload: { indices } };
}

/**
 * What capture should do after a reply lands: the replies to capture now, or none while a batch is still filling.
 * mode 'five' waits until five exchanges are uncaptured; 'reply' captures each reply.
 */
export function dueNow(chat, { mode = 'reply', oocMarks = [] } = {}) {
    const waiting = uncaptured(chat, { oocMarks });
    if (mode === 'five') return waiting.length >= BATCH_EVERY ? waiting : [];
    return waiting.slice(-BATCH_EVERY);
}

/**
 * The replies still uncaptured up to a chapter's end, for the chapter call to read before its messages leave the request
 * (DESIGN 7.2, M1f 6.2). Returns { indices, request, commit(answer) } or null when nothing waits. MB6's chapter call puts
 * `request.user` beside its own input and passes back the capture part of its answer.
 */
export async function remainderForChapter(upTo, options = {}) {
    const H = await hostParts();
    const c = options.context || H.st.ctx();
    const chat = c.chat || [];
    const indices = uncaptured(chat, { upTo, from: options.from ?? 1 });
    if (!indices.length) return null;
    const store = options.store || H.memStore.memoryStore();
    store.marks();
    const st = options.settingsValue || H.store.settings();
    const fields = enabledFields(st, options.modules || {});
    const foldResult = foldChat(chat, c.chatMetadata || {});
    const call = captureCall(chat, indices, { records: foldResult.records, fields, cast: [H.st.names().char, H.st.names().user].filter(Boolean), headerReliable: headerMode() !== 'tray', key: H.st.KEY, recording: await recordingFor(options.modules) });
    const chatId = String(c.getCurrentChatId?.() || '');
    return {
        indices, request: call,
        commit: async (answer, { route = 'chapter', model = '' } = {}) => {
            const out = [];
            for (const part of splitAnswer(answer, call.exchanges.map(x => ({ ...x, chatId })))) {
                const prev = previousSceneOf(chat, part.index, H.st.KEY);
                const baseMinutes = minutesBefore(chat, part.index, H.st.KEY, c.chatMetadata?.[H.st.KEY]?.v10ClockSeed);
                out.push(await commitExchange({ store, chat, exchange: part.exchange, answer: part.answer, foldResult, fields, key: H.st.KEY, route, model, callId: `chapter:${Date.now()}`, headerReliable: headerMode() !== 'tray', previousScene: prev.scene, previousReply: prev.reply, baseMinutes, chatMeta: c.chatMetadata }));
            }
            return out;
        },
    };
}

/**
 * The parts a chapter call adds to carry the remainder: a system rule, the exchanges under "Records to file", and the
 * chapter schema with a "capture" property (strict for the provider, plain for code, where capture may be missing).
 */
export function chapterWithCapture(remainder) {
    const r = remainder.request;
    return {
        // The capture call's opening line names its own task; inside the chapter call the rule above takes its place.
        system: `The exchanges under "Records to file" have not been read for the story records yet. Fill "capture" for them by these rules:\n${r.system.replace(/^You keep the records of a roleplay story\.[^\n]*\n/, '')}`,
        user: `Records to file:\n${r.user}`,
        schema: chapter => ({
            ...chapter,
            value: { ...chapter.value, required: [...(chapter.value.required || []), 'capture'], properties: { ...chapter.value.properties, capture: r.schema } },
            read: { ...(chapter.read || chapter.value), properties: { ...(chapter.read || chapter.value).properties, capture: r.read } },
        }),
    };
}

let started = false;
/**
 * Wire capture to the host once: a queue handler for `capture` jobs, a rebuilder that finds replies past the watermark, and
 * listeners that queue a capture after a reply, a swipe, an edit or a continue. Called from src/engine.js.
 */
export async function startCapture({ modules = () => ({}) } = {}) {
    if (started) return;
    started = true;
    const H = await hostParts();
    const queue = H.queue.desktopQueue();
    queue.handle('capture', {
        // a feature on Theirs still has its changes filed from the reply (memory DESIGN 5.4)
        run: async (job, { signal }) => runCapture(job.payload?.indices || [], { signal, modules: await (await import('./inject.js')).hostCaptureModules(modules()) }),
        commit: async () => {},   // runCapture commits each exchange itself, against the revision it read
        saved: () => false,
    });
    H.queue.addRebuilder((chat, chatId) => {
        const fields = enabledFields(H.store.settings(), modules());
        const due = dueNow(chat, { mode: captureEvery(H.store.settings(), fields) });
        return due.length ? [captureJob(chat, due, chatId, H.queue.desktopModelFor('capture'))] : [];
    });
    // Upkeep (MB7) runs level 0 after each committed capture and owns the Tidy jobs.
    await (await import('./upkeep.js')).startUpkeep();
}

/** Queue the capture a reply needs now. Resolves with { job, pending } once queued; pending ends when that capture ends. */
export async function queueCapture({ modules = {}, indices = null } = {}) {
    const H = await hostParts();
    const c = H.st.ctx();
    const chat = c.chat || [];
    if (!H.store.settings().enabled) return null;
    // A chat whose first open has not moved its memory into chat data yet has nothing to commit to (MB2).
    if (!c.chatMetadata?.[MEMORY]?.imported) return null;
    // Memory switched off for this chat (Setup, Memory): nothing is captured and its records stay.
    if (c.chatMetadata[MEMORY].off === true) return null;
    const fields = enabledFields(H.store.settings(), modules);
    // indices names replies the caller wants captured, such as an opening the extension drafted (message 0).
    const due = indices ? indices.filter(i => isReply(chat[i]) && !isCaptured(chat[i])) : dueNow(chat, { mode: captureEvery(H.store.settings(), fields) });
    if (!due.length) return null;
    const chatId = String(c.getCurrentChatId?.() || '');
    const job = captureJob(chat, due, chatId, H.queue.desktopModelFor('capture'));
    const queue = H.queue.desktopQueue();
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const off = onCapture(event => { if (due.includes(event.index) && event.phase !== 'capturing') { off(); release(event); } });
    // Capture runs about a second after the reply lands, so the host's own saves and redraws go first.
    await new Promise(resolve => setTimeout(resolve, 900));
    await queue.enqueue(job);
    queue.pump();
    return { job, pending };
}
