// Undercurrent ports — drama cadence, curiosity queue and plot-beat menu. Pure logic.
//
// Reproduces, natively, the drama trigger of a long-romance engine and the movers/plot scout of an event-kernel plugin:
//  - Drama is due when replies have gone flat for N turns in a row (short, no interiority, tic-heavy, stalled) OR when
//    the story has gone long enough without one (overdue), with a roll, a minimum gap, a hold, a low/normal/high dial,
//    and suppression in heavy scene modes. Code decides IF; the content comes from the beat menu or the director.
//  - Curiosity queue: planted questions/mysteries carry a payoff window [earliest, latest]; reminders surface while the
//    window is open and an "overdue" nudge after it closes. "Ask" topics (a character wants to learn something about
//    {{user}} they have not been told) surface one at a time outside heavy scenes; if the player deflects, the topic is
//    deferred and comes back later.
//  - Plot-beat menu: future beats with earliest/latest turn windows, offered to the director at most one per turn
//    (soonest-closing first); a beat is spent when the scribe closes it, and stops being offered after N offers.
//  - Optional scout pass (one hidden call every N turns when the menu runs low) proposes 1–3 future beats tied to
//    threads already in play.
//
// Deliberately not reproduced: per-character relationship stages / evidence ladders, pregnancy and labor clocks,
// footer parsing, fixed twist banks, and resetting switches every request (the source's /hold never persisted).

import {
    kb, ki, kn, kt, kta, klist, makeResolver, str, beginTurn, chance, capNewest, renderTemplate, isPlainObject, normText,
    sameThing, isUserName, thoughtSpans, deepClone,
} from './common.js';
import { wordCount } from '../util.js';

const G = 'Drama cadence';
const P = 'drama.';

export const DRAMA_PATHS = ['observe', 'question', 'ask', 'beat', 'scouted'];
export const DIALS = ['off', 'low', 'normal', 'high'];

export const DRAMA_PLACEHOLDERS = [
    { name: 'uc_beat', help: 'A beat from the menu.' },
    { name: 'uc_turns', help: 'Turns until the window closes, or since it closed.' },
    { name: 'uc_question', help: 'A planted question / mystery.' },
    { name: 'uc_name', help: 'Who wants to know (ask topics).' },
    { name: 'uc_topic', help: 'What they want to know about {{user}}.' },
    { name: 'uc_reason', help: 'Why drama fired: "flat" or "overdue".' },
    { name: 'uc_max', help: 'Max beats (scout prompt).' },
];

export const DRAMA_SCOUT_SYSTEM = `You are the plot scout of an interactive story. You never write the story and never file anything as history. You propose FUTURE beats only: things that could happen later, grown from people, objects, promises, secrets or consequences already in play.

Return ONLY JSON: {"beats":[{"text":"one concrete sentence: who/what does what","earliest":<turns from now>,"latest":<turns from now>,"kind":"inch|twist|antagonist"}]} with 1 to {{uc_max}} beats.
- Never decide what {{user}} says, does, thinks or feels; beats happen in the world or to {{user}}.
- No beats already on the menu, no copying card backstory, no cosmic coincidences.`;

export const DRAMA_KNOBS = [
    kb(`${P}enabled`, G, 'Drama cadence', true, 'Flat/overdue drama, the curiosity queue and the plot-beat menu.'),
    { key: `${P}dial`, group: G, label: 'Drama dial', type: 'select', default: 'normal', options: DIALS.map(v => ({ value: v, label: v })), scope: 'chat', help: 'How readily drama fires. Off = never (the menu and curiosity reminders still work).' },
    ki(`${P}flat_low`, G, 'Flat replies before drama (low)', 6, 1, 100, ''),
    ki(`${P}flat_normal`, G, 'Flat replies before drama (normal)', 4, 1, 100, ''),
    ki(`${P}flat_high`, G, 'Flat replies before drama (high)', 2, 1, 100, ''),
    ki(`${P}overdue_low`, G, 'Drama overdue after (turns, low)', 30, 1, 1000, ''),
    ki(`${P}overdue_normal`, G, 'Drama overdue after (turns, normal)', 18, 1, 1000, ''),
    ki(`${P}overdue_high`, G, 'Drama overdue after (turns, high)', 10, 1, 1000, ''),
    ki(`${P}min_gap`, G, 'Minimum turns between dramas', 5, 0, 200, ''),
    kn(`${P}chance`, G, 'Chance a due drama fires (%)', 35, 0, 100, 1, 'Rolled each turn while drama is due.'),
    klist(`${P}suppressed_modes`, G, 'No drama in scene modes', ['intimate', 'grief', 'argument'], ''),
    ki(`${P}flat_words`, G, 'A reply is flat under (words)', 160, 0, 3000, ''),
    kb(`${P}flat_no_thought`, G, 'A reply without *private thoughts* is flat', true, ''),
    ki(`${P}flat_tic_hits`, G, 'A reply with this many tic findings is flat', 2, 1, 50, '0 findings never count.'),
    kb(`${P}flat_on_stall`, G, 'A stalled or near-identical reply is flat', true, 'From the tic guard.'),
    kta(`${P}drama_template`, G, 'Drama line (no beat on the menu)', 'Drama ({{uc_reason}}): bring one complication into this reply, grown from what is already established (a person, an object, a promise, a secret); leave it open for {{user}}.', '', DRAMA_PLACEHOLDERS),
    kta(`${P}drama_beat_template`, G, 'Drama line (from the menu)', 'Drama ({{uc_reason}}): put this beat in the room now, one inch, not a speech: {{uc_beat}}', '', DRAMA_PLACEHOLDERS),
    ki(`${P}beat_earliest`, G, 'New beats: earliest (turns from now)', 1, 0, 200, 'When a beat comes without its own window.'),
    ki(`${P}beat_latest`, G, 'New beats: latest (turns from now)', 12, 1, 500, ''),
    ki(`${P}max_beats`, G, 'Beats on the menu at most', 8, 1, 60, ''),
    ki(`${P}max_offers`, G, 'Stop offering a beat after (offers)', 3, 1, 50, 'A beat the story never used is retired after this many offers.'),
    kb(`${P}offer_overdue`, G, 'Keep offering beats past their window', true, 'Off = a beat expires when its latest turn passes.'),
    kta(`${P}beat_template`, G, 'Beat offer line', 'Beat available (window closes in {{uc_turns}} turns): {{uc_beat}}. Use it if it fits this reply; the director decides.', '', DRAMA_PLACEHOLDERS),
    kta(`${P}beat_overdue_template`, G, 'Overdue beat line', 'Overdue beat ({{uc_turns}} turns past its window): {{uc_beat}}. Use it now, change it, or let it go.', '', DRAMA_PLACEHOLDERS),
    ki(`${P}payoff_min`, G, 'Questions: earliest payoff (turns after planting)', 4, 0, 500, ''),
    ki(`${P}payoff_max`, G, 'Questions: latest payoff (turns after planting)', 15, 1, 1000, ''),
    ki(`${P}remind_every`, G, 'Remind about an open question every (turns)', 4, 1, 100, ''),
    ki(`${P}reminders_per_turn`, G, 'Question reminders per turn', 1, 0, 6, ''),
    ki(`${P}max_questions`, G, 'Open questions kept', 10, 1, 60, ''),
    kta(`${P}question_template`, G, 'Question reminder', 'Open question, ripe to pay off or deepen: {{uc_question}}.', '', DRAMA_PLACEHOLDERS),
    kta(`${P}question_overdue_template`, G, 'Overdue question', 'Overdue question ({{uc_turns}} turns past its window): {{uc_question}}. Pay it off, deepen it, or retire it on the page.', '', DRAMA_PLACEHOLDERS),
    ki(`${P}ask_every`, G, 'Ask topics: at most one every (turns)', 5, 1, 100, ''),
    kn(`${P}ask_chance`, G, 'Ask topics: chance per eligible turn (%)', 25, 0, 100, 1, ''),
    klist(`${P}busy_modes`, G, 'No ask topics in scene modes', ['intimate', 'grief', 'argument', 'action'], ''),
    klist(`${P}deflections`, G, 'Player deflection phrases', ['not now', 'later', 'don\'t want to talk', 'do not want to talk', 'another time', 'drop it', 'leave it', 'not tonight', 'none of your business', 'change the subject'], 'If the player\'s spoken/acted text (not private thoughts) contains one right after a topic surfaced, the topic is deferred.'),
    ki(`${P}defer_turns`, G, 'Deferred topics return after (turns)', 8, 1, 500, ''),
    kta(`${P}ask_template`, G, 'Ask topic line', '{{uc_name}} is curious about {{user}}: {{uc_topic}}. A question may come up if the moment allows; never answer it for {{user}}.', '', DRAMA_PLACEHOLDERS),
    kb(`${P}scout_enabled`, G, 'Plot scout pass', true, 'One hidden call proposes future beats when the menu runs low.'),
    ki(`${P}scout_every`, G, 'Scout at most every (turns)', 8, 1, 200, ''),
    ki(`${P}scout_min_open`, G, 'Scout when fewer open beats than', 1, 0, 20, ''),
    ki(`${P}scout_after_turn`, G, 'No scouting before turn', 3, 0, 200, ''),
    ki(`${P}scout_max_beats`, G, 'Beats per scout', 3, 1, 6, ''),
    ki(`${P}scout_max_tokens`, G, 'Scout response tokens', 400, 50, 2000, ''),
    kta(`${P}scout_system`, G, 'Scout prompt (system)', DRAMA_SCOUT_SYSTEM, 'Placeholder: {{uc_max}}. Must ask for {"beats":[...]}.', DRAMA_PLACEHOLDERS, { rows: 10 }),
    kt(`${P}scout_final`, G, 'Scout final instruction', 'Propose the future beats JSON now.', ''),
    ki(`${P}pri_drama`, G, 'Note priority: drama', 86, 0, 100, ''),
    ki(`${P}pri_beat`, G, 'Note priority: beat offer', 60, 0, 100, ''),
    ki(`${P}pri_question`, G, 'Note priority: question reminders', 52, 0, 100, ''),
    ki(`${P}pri_ask`, G, 'Note priority: ask topic', 46, 0, 100, ''),
];

export const resolveDramaOptions = makeResolver(P, DRAMA_KNOBS, (o) => {
    if (o.beat_latest < o.beat_earliest) o.beat_latest = o.beat_earliest;
    if (o.payoff_max < o.payoff_min) o.payoff_max = o.payoff_min;
    return o;
});

let CFG = resolveDramaOptions({});
export function setDramaConfig(values) {
    CFG = resolveDramaOptions(values || {});
    return CFG;
}

// ---------------------------------------------------------------------------------------------------------------------
// State

export function emptyDramaRt() {
    return { turn: -1, prev: null, last_drama: 0, fired_turn: -1, hold_until: -1, force: false, offers: {}, retired: [], reminded: {}, ask_last: -1000, ask_surfaced: null, deferred: {} };
}

export function emptyDrama() {
    return { obs: [], questions: [], beats: [], last_scout_turn: -1000, rt: emptyDramaRt() };
}

function slug(s) {
    return normText(s).replace(/\s+/g, '_').slice(0, 40) || 'item';
}

export function normalizeDrama(raw) {
    const s = emptyDrama();
    if (!isPlainObject(raw)) return s;
    s.obs = (Array.isArray(raw.obs) ? raw.obs : []).filter(x => isPlainObject(x) && Number.isFinite(x.turn)).map(x => ({ turn: x.turn, flat: !!x.flat })).slice(-40);
    s.questions = (Array.isArray(raw.questions) ? raw.questions : []).filter(q => isPlainObject(q) && str(q.text)).map(q => ({
        id: str(q.id, 60) || slug(q.text), kind: q.kind === 'ask' ? 'ask' : 'mystery', text: str(q.text, 200), who: str(q.who, 60),
        planted_turn: Number.isFinite(q.planted_turn) ? q.planted_turn : 0, earliest: Number.isFinite(q.earliest) ? q.earliest : 0,
        latest: Number.isFinite(q.latest) ? q.latest : 0, status: ['open', 'paid', 'dropped'].includes(q.status) ? q.status : 'open',
        closed_turn: Number.isFinite(q.closed_turn) ? q.closed_turn : null,
    })).slice(-60);
    s.beats = (Array.isArray(raw.beats) ? raw.beats : []).filter(b => isPlainObject(b) && str(b.text)).map(b => ({
        id: str(b.id, 60) || slug(b.text), text: str(b.text, 240), kind: str(b.kind, 20), source: str(b.source, 20),
        earliest: Number.isFinite(b.earliest) ? b.earliest : 0, latest: Number.isFinite(b.latest) ? b.latest : 0,
        status: ['open', 'used', 'dropped'].includes(b.status) ? b.status : 'open', added_turn: Number.isFinite(b.added_turn) ? b.added_turn : 0,
        closed_turn: Number.isFinite(b.closed_turn) ? b.closed_turn : null,
    })).slice(-60);
    s.last_scout_turn = Number.isFinite(raw.last_scout_turn) ? raw.last_scout_turn : -1000;
    const rt = isPlainObject(raw.rt) ? raw.rt : {};
    const e = emptyDramaRt();
    s.rt = {
        turn: Number.isFinite(rt.turn) ? rt.turn : e.turn, prev: isPlainObject(rt.prev) ? rt.prev : null,
        last_drama: Number.isFinite(rt.last_drama) ? rt.last_drama : e.last_drama, fired_turn: Number.isFinite(rt.fired_turn) ? rt.fired_turn : -1,
        hold_until: Number.isFinite(rt.hold_until) ? rt.hold_until : -1, force: !!rt.force,
        offers: isPlainObject(rt.offers) ? Object.fromEntries(Object.entries(rt.offers).filter(([, v]) => Number.isFinite(v))) : {},
        retired: (Array.isArray(rt.retired) ? rt.retired : []).map(String).slice(-60),
        reminded: isPlainObject(rt.reminded) ? Object.fromEntries(Object.entries(rt.reminded).filter(([, v]) => Number.isFinite(v))) : {},
        ask_last: Number.isFinite(rt.ask_last) ? rt.ask_last : -1000,
        ask_surfaced: isPlainObject(rt.ask_surfaced) ? { id: str(rt.ask_surfaced.id, 60), turn: Number.isFinite(rt.ask_surfaced.turn) ? rt.ask_surfaced.turn : -1 } : null,
        deferred: isPlainObject(rt.deferred) ? Object.fromEntries(Object.entries(rt.deferred).filter(([, v]) => Number.isFinite(v))) : {},
    };
    return s;
}

// ---------------------------------------------------------------------------------------------------------------------
// Op reducer: "drama.<field>"

function textOf(v, max = 240) {
    return isPlainObject(v) ? str(v.text ?? v.topic ?? v.item ?? '', max) : str(v, max);
}

function uniqueId(list, base) {
    let id = base;
    let n = 2;
    while (list.some(x => x.id === id)) id = `${base}_${n++}`;
    return id;
}

export function applyDramaOp(slice, op, ctx = {}) {
    const o = ctx.options || CFG;
    const turn = Number.isFinite(ctx.turn) ? ctx.turn : 0;
    const v = op.value;
    const system = ctx.trusted || ctx.source === 'ports' || ctx.source === 'replay';
    switch (op.field) {
        case 'observe': {
            if (!system) return 'observe is system-only';
            const flat = isPlainObject(v) ? !!v.flat : !!v;
            slice.obs = capNewest([...slice.obs.filter(x => x.turn !== turn), { turn, flat }], 40);
            return 'ok';
        }
        case 'scouted': {
            if (!system) return 'scouted is system-only';
            slice.last_scout_turn = turn;
            return 'ok';
        }
        case 'question':
        case 'ask': {
            const kind = op.field === 'ask' ? 'ask' : 'mystery';
            const text = textOf(v, 200);
            if (!text) return `${op.field} needs text`;
            const who = isPlainObject(v) ? str(v.who, 60) : '';
            if (kind === 'ask' && (!who || isUserName(who, ctx.userName))) return 'ask needs the curious character (never {{user}})';
            if (op.op === 'append') {
                if (slice.questions.some(q => q.status === 'open' && q.kind === kind && sameThing(q.text, text, 0.7))) return 'ok';
                const pin = isPlainObject(v) && Number.isFinite(Number(v.payoff_in)) ? Math.max(0, Math.round(Number(v.payoff_in))) : o.payoff_min;
                const by = isPlainObject(v) && Number.isFinite(Number(v.by)) ? Math.max(pin, Math.round(Number(v.by))) : Math.max(pin, o.payoff_max);
                slice.questions.push({ id: uniqueId(slice.questions, `${kind}_${slug(text)}`), kind, text, who, planted_turn: turn, earliest: turn + pin, latest: turn + by, status: 'open', closed_turn: null });
                const open = slice.questions.filter(q => q.status === 'open');
                if (open.length > o.max_questions) {
                    const drop = new Set(open.slice(0, open.length - o.max_questions).map(q => q.id));
                    slice.questions = slice.questions.filter(q => !drop.has(q.id));
                }
                slice.questions = slice.questions.slice(-60);
                return 'ok';
            }
            const idx = slice.questions.findIndex(q => q.kind === kind && (q.id === text || sameThing(q.text, text, 0.5)) && (op.op === 'remove' || q.status === 'open'));
            if (idx === -1) return `no matching ${op.field}`;
            if (op.op === 'remove') slice.questions.splice(idx, 1);
            else { slice.questions[idx].status = isPlainObject(v) && v.dropped ? 'dropped' : 'paid'; slice.questions[idx].closed_turn = turn; }
            return 'ok';
        }
        case 'beat': {
            const text = textOf(v, 240);
            if (!text) return 'beat needs text';
            if (op.op === 'append') {
                if (slice.beats.some(b => b.status === 'open' && sameThing(b.text, text, 0.7))) return 'ok';
                const e = isPlainObject(v) && Number.isFinite(Number(v.earliest)) ? Math.max(0, Math.round(Number(v.earliest))) : o.beat_earliest;
                const l = isPlainObject(v) && Number.isFinite(Number(v.latest)) ? Math.max(e, Math.round(Number(v.latest))) : Math.max(e, o.beat_latest);
                slice.beats.push({
                    id: uniqueId(slice.beats, `beat_${slug(text)}`), text, kind: isPlainObject(v) ? str(v.kind, 20) : '', source: str(ctx.source || 'scribe', 20),
                    earliest: turn + e, latest: turn + l, status: 'open', added_turn: turn, closed_turn: null,
                });
                const open = slice.beats.filter(b => b.status === 'open');
                if (open.length > o.max_beats) {
                    const drop = new Set(open.slice(0, open.length - o.max_beats).map(b => b.id));
                    slice.beats = slice.beats.filter(b => !drop.has(b.id));
                }
                slice.beats = slice.beats.slice(-60);
                return 'ok';
            }
            const idx = slice.beats.findIndex(b => (b.id === text || sameThing(b.text, text, 0.5)) && (op.op === 'remove' || b.status === 'open'));
            if (idx === -1) return 'no matching beat';
            if (op.op === 'remove') slice.beats.splice(idx, 1);
            else { slice.beats[idx].status = isPlainObject(v) && v.dropped ? 'dropped' : 'used'; slice.beats[idx].closed_turn = turn; }
            return 'ok';
        }
        default:
            return 'unknown drama field';
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Observation of a finished reply (code-side)

/**
 * Is this reply flat? Short, no private thoughts, tic-heavy, or stalled.
 * @param {{reply:string, ticFindings?:object, stall?:boolean, options?:object}} p
 */
export function isFlatReply({ reply = '', ticFindings = null, stall = false, options } = {}) {
    const o = resolveDramaOptions(options || {});
    const words = wordCount(reply);
    if (words < o.flat_words) return true;
    if (o.flat_no_thought && !thoughtSpans(reply).length) return true;
    if (o.flat_on_stall && (stall || ticFindings?.samey)) return true;
    if (ticFindings) {
        const n = (ticFindings.slop?.length || 0) + (ticFindings.repeats?.length || 0) + (ticFindings.echo?.length || 0)
            + (ticFindings.mindread?.length || 0) + (ticFindings.opening ? 1 : 0);
        if (n >= o.flat_tic_hits) return true;
    }
    return false;
}

/** Consecutive flat observations at the end, counting only replies after the last drama. */
export function flatStreak(slice, sinceTurn = -Infinity) {
    const obs = (slice?.obs || []).filter(x => x.turn > sinceTurn).sort((a, b) => a.turn - b.turn);
    let n = 0;
    for (let i = obs.length - 1; i >= 0 && obs[i].flat; i--) n++;
    return n;
}

// ---------------------------------------------------------------------------------------------------------------------
// Interceptor-time pass

function publicText(text) {
    return String(text ?? '').replace(/(^|[^*])\*(?!\*)([^*\n]+?)\*(?!\*)/g, '$1').replace(/\s+/g, ' ').trim();
}

/** Open beats in their window (or overdue), soonest-closing first. */
export function dueBeats(slice, rt, turn, o) {
    return slice.beats
        .filter(b => b.status === 'open' && !rt.retired.includes(b.id) && turn >= b.earliest && (o.offer_overdue || turn <= b.latest))
        .sort((a, b) => a.latest - b.latest || a.added_turn - b.added_turn);
}

/**
 * @param {object} p
 * @param {object} p.state
 * @param {number} p.turn
 * @param {string} [p.userMessage] the player's latest message (deflection check uses only the public part)
 * @param {() => number} [p.rng]
 * @param {object} [p.options]
 * @param {string} [p.type]
 * @returns {{lines:object[], director:string[], fired:object|null, beat:object|null, rt:object, reason:string}}
 */
export function dramaTurn({ state, turn = 0, userMessage = '', rng = Math.random, options, type = 'normal' } = {}) {
    const o = resolveDramaOptions(options || {});
    const slice = normalizeDrama(state?.ports?.drama);
    const empty = { lines: [], director: [], fired: null, beat: null, rt: slice.rt, reason: 'off' };
    if (!o.enabled || type === 'quiet' || type === 'impersonate') return empty;
    const rt = beginTurn(slice.rt, turn, emptyDramaRt);
    const lines = [];
    const director = [];
    const mode = String(state?.scene?.mode || '');
    const T = (tpl, vars) => renderTemplate(tpl, vars).replace(/\s+/g, ' ').trim();

    // Deflection: the player turned away from a topic surfaced last turn.
    if (rt.ask_surfaced && rt.ask_surfaced.turn === turn - 1) {
        const pub = ` ${normText(publicText(userMessage))} `;
        if (o.deflections.some(d => { const n = normText(d); return n && pub.includes(` ${n} `); })) rt.deferred[rt.ask_surfaced.id] = turn + o.defer_turns;
        rt.ask_surfaced = null;
    }
    for (const [id, until] of Object.entries(rt.deferred)) if (until <= turn) delete rt.deferred[id];

    // 1. Drama.
    let fired = null;
    let reason = 'not due';
    const beats = dueBeats(slice, rt, turn, o);
    if (o.dial !== 'off' || rt.force) {
        const flat = flatStreak(slice, rt.last_drama);
        const overdue = turn - rt.last_drama >= o[`overdue_${o.dial}`];
        const blocked = !rt.force && (o.suppressed_modes.includes(mode) || turn < rt.hold_until || turn - rt.last_drama < o.min_gap);
        if (rt.force || (!blocked && (flat >= o[`flat_${o.dial}`] || overdue))) {
            const why = rt.force ? 'requested' : flat >= o[`flat_${o.dial}`] ? 'flat' : 'overdue';
            if (rt.force || chance(o.chance, rng)) {
                const beat = beats[0] || null;
                fired = { reason: why, beat: beat ? beat.id : null };
                lines.push({ text: beat ? T(o.drama_beat_template, { uc_beat: beat.text, uc_reason: why }) : T(o.drama_template, { uc_reason: why }), pri: o.pri_drama, section: 'drama' });
                director.push(beat ? `DRAMA DUE (${why}): use this beat from the menu: ${beat.text}` : `DRAMA DUE (${why}): one complication grown from what is established.`);
                if (beat) rt.offers[beat.id] = (rt.offers[beat.id] || 0) + 1;
                rt.last_drama = turn;
                rt.fired_turn = turn;
                rt.force = false;
                reason = `fired (${why})`;
            } else reason = `due (${why}), roll failed`;
        } else if (blocked) reason = 'blocked (mode, hold or gap)';
    }

    // 2. Beat menu: at most one offer per turn (the drama beat counts).
    let offered = null;
    if (!fired?.beat) {
        const b = beats.find(x => (rt.offers[x.id] || 0) < o.max_offers);
        if (b) {
            offered = b;
            rt.offers[b.id] = (rt.offers[b.id] || 0) + 1;
            const late = turn > b.latest;
            lines.push({ text: T(late ? o.beat_overdue_template : o.beat_template, { uc_beat: b.text, uc_turns: late ? turn - b.latest : b.latest - turn }), pri: o.pri_beat, section: 'drama' });
            director.push(`Beat menu (one per turn): ${b.text}${late ? ' (overdue)' : ` (window closes in ${b.latest - turn} turns)`}`);
        }
    }
    for (const b of slice.beats) if (b.status === 'open' && (rt.offers[b.id] || 0) >= o.max_offers && !rt.retired.includes(b.id) && b !== offered && fired?.beat !== b.id) rt.retired.push(b.id);
    rt.retired = rt.retired.slice(-60);

    // 3. Curiosity queue: mysteries with payoff windows.
    let reminders = 0;
    for (const q of slice.questions.filter(x => x.kind === 'mystery' && x.status === 'open').sort((a, b) => a.latest - b.latest)) {
        if (reminders >= o.reminders_per_turn) break;
        if (turn < q.earliest) continue;
        if (Number.isFinite(rt.reminded[q.id]) && turn - rt.reminded[q.id] < o.remind_every) continue;
        const late = turn > q.latest;
        lines.push({ text: T(late ? o.question_overdue_template : o.question_template, { uc_question: q.text, uc_turns: turn - q.latest }), pri: o.pri_question, section: 'drama' });
        rt.reminded[q.id] = turn;
        reminders++;
    }
    // Ask topics: one at a time, outside heavy scenes, deferred when the player deflects.
    if (!o.busy_modes.includes(mode) && turn - rt.ask_last >= o.ask_every) {
        const ask = slice.questions.find(q => q.kind === 'ask' && q.status === 'open' && !(q.id in rt.deferred));
        if (ask && chance(o.ask_chance, rng)) {
            lines.push({ text: T(o.ask_template, { uc_name: ask.who, uc_topic: ask.text }), pri: o.pri_ask, section: 'drama' });
            rt.ask_last = turn;
            rt.ask_surfaced = { id: ask.id, turn };
        }
    }
    return { lines, director, fired, beat: fired?.beat ? slice.beats.find(b => b.id === fired.beat) : offered, rt, reason };
}

// ---------------------------------------------------------------------------------------------------------------------
// Scout pass

export function scoutDue({ state, turn = 0, options } = {}) {
    const o = resolveDramaOptions(options || {});
    if (!o.enabled || !o.scout_enabled || turn < o.scout_after_turn) return false;
    const s = normalizeDrama(state?.ports?.drama);
    const open = s.beats.filter(b => b.status === 'open' && !s.rt.retired.includes(b.id)).length;
    return open < o.scout_min_open && turn - s.last_scout_turn >= o.scout_every;
}

export function buildScoutMessages({ state, cardBlock = '', stateBlock = '', transcript = '', options } = {}) {
    const o = resolveDramaOptions(options || {});
    const s = normalizeDrama(state?.ports?.drama);
    const menu = s.beats.filter(b => b.status === 'open').map(b => `- ${b.text}`).join('\n');
    const content = [
        cardBlock && `<cast>\n${cardBlock}\n</cast>`,
        stateBlock && `<continuity>\n${stateBlock}\n</continuity>`,
        `<recent>\n${transcript || '(the story has just begun)'}\n</recent>`,
        `<menu>\n${menu || '(empty)'}\n</menu>`,
        o.scout_final,
    ].filter(Boolean).join('\n\n');
    return { systemPrompt: renderTemplate(o.scout_system, { uc_max: o.scout_max_beats }), messages: [{ role: 'user', content }], responseLength: o.scout_max_tokens };
}

/** Parse the scout's answer into ops (drama.beat appends + drama.scouted). Beats that script {{user}} are dropped. */
export function parseScoutResult(raw, { userName = '', options } = {}) {
    const o = resolveDramaOptions(options || {});
    let obj = raw;
    if (typeof raw === 'string') {
        const m = raw.replace(/<(think|thinking|reasoning)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').match(/\{[\s\S]*\}/);
        try { obj = m ? JSON.parse(m[0]) : null; } catch { obj = null; }
    }
    const list = Array.isArray(obj) ? obj : (isPlainObject(obj) && Array.isArray(obj.beats) ? obj.beats : []);
    const names = ['{{user}}', userName].filter(Boolean).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const userActs = names ? new RegExp(`(?:^|[^\\w'])(?:${names})\\s+(?:decides|says|agrees|feels|realizes|chooses|falls|confesses|admits|wants|thinks)\\b`, 'i') : null;
    const ops = [];
    for (const b of list.slice(0, o.scout_max_beats)) {
        const text = str(isPlainObject(b) ? b.text ?? b.beat : b, 240);
        if (!text || (userActs && userActs.test(text))) continue;
        const value = { text };
        if (isPlainObject(b)) {
            if (Number.isFinite(Number(b.earliest))) value.earliest = Math.max(0, Math.round(Number(b.earliest)));
            if (Number.isFinite(Number(b.latest))) value.latest = Math.max(value.earliest ?? 0, Math.round(Number(b.latest)));
            if (b.kind) value.kind = str(b.kind, 20);
        }
        ops.push({ op: 'append', path: 'drama.beat', value, reason: 'scout' });
    }
    ops.push({ op: 'set', path: 'drama.scouted', value: true, reason: 'scout' });
    return ops;
}

// ---------------------------------------------------------------------------------------------------------------------
// Slash commands: /uc-drama off|low|normal|high|fire|hold N|status · /uc-beat add <text> [in=N] [by=M] | done <text> | list
//                 /uc-ask <Name> <topic> · /uc-question <text> [in=N] [by=M]

/**
 * Execute a drama command against the state's drama slice. Pure: returns what to change.
 * @returns {{ok:boolean, message:string, rt?:object, ops?:object[], knob?:{key:string, value:any}}}
 */
export function executeDramaCommand(state, command, args = {}, { turn = 0, options } = {}) {
    const o = resolveDramaOptions(options || {});
    const s = normalizeDrama(state?.ports?.drama);
    const rt = deepClone(s.rt);
    const text = String(args.text ?? args.unnamed ?? '').trim();
    const nums = k => (Number.isFinite(Number(args[k])) ? Math.round(Number(args[k])) : undefined);
    switch (command) {
        case 'drama': {
            const [verb, n] = text.split(/\s+/);
            if (DIALS.includes(verb)) return { ok: true, message: `Drama dial: ${verb}.`, knob: { key: 'drama.dial', value: verb } };
            if (verb === 'fire') { rt.force = true; return { ok: true, message: 'Drama will fire on the next reply.', rt }; }
            if (verb === 'hold') {
                const k = Math.max(0, Math.round(Number(n) || 0));
                rt.hold_until = turn + k;
                return { ok: true, message: k ? `Drama held for ${k} turns.` : 'Hold cleared.', rt };
            }
            const flat = flatStreak(s, s.rt.last_drama);
            return { ok: true, message: `Dial ${o.dial}; flat replies in a row: ${flat}; turns since drama: ${turn - s.rt.last_drama}; open beats: ${s.beats.filter(b => b.status === 'open').length}; open questions: ${s.questions.filter(q => q.status === 'open').length}.` };
        }
        case 'beat': {
            const m = text.match(/^(add|done|drop|list)\b\s*(.*)$/i);
            const verb = m ? m[1].toLowerCase() : 'add';
            const body = m ? m[2].trim() : text;
            if (verb === 'list') {
                const open = s.beats.filter(b => b.status === 'open');
                return { ok: true, message: open.length ? open.map(b => `${b.text} [turns ${b.earliest}–${b.latest}]`).join('\n') : 'The beat menu is empty.' };
            }
            if (!body) return { ok: false, message: 'Give the beat text.' };
            if (verb === 'add') return { ok: true, message: 'Beat added.', ops: [{ op: 'append', path: 'drama.beat', value: { text: body, earliest: nums('in'), latest: nums('by') }, reason: 'author' }] };
            return { ok: true, message: verb === 'done' ? 'Beat marked used.' : 'Beat dropped.', ops: [{ op: 'close', path: 'drama.beat', value: { text: body, dropped: verb === 'drop' }, reason: 'author' }] };
        }
        case 'question':
            if (!text) return { ok: false, message: 'Give the question.' };
            return { ok: true, message: 'Question planted.', ops: [{ op: 'append', path: 'drama.question', value: { text, payoff_in: nums('in'), by: nums('by') }, reason: 'author' }] };
        case 'ask': {
            const who = String(args.who ?? text.split(/\s+/)[0] ?? '').trim();
            const topic = String(args.topic ?? text.split(/\s+/).slice(1).join(' ')).trim();
            if (!who || !topic) return { ok: false, message: 'Usage: /uc-ask <Name> <topic>' };
            return { ok: true, message: 'Topic queued.', ops: [{ op: 'append', path: 'drama.ask', value: { who, text: topic }, reason: 'author' }] };
        }
        default:
            return { ok: false, message: `Unknown command ${command}.` };
    }
}

/** Scribe path guide lines. */
export function dramaPathGuide() {
    return [
        'drama.question — append {"text":"a question or mystery the story just planted","payoff_in":turns,"by":turns} | close "text" when it was answered on the page',
        'drama.ask — append {"who":"Name","text":"what that character wants to learn about {{user}} and has not been told"} | close {"who","text"} once {{user}} told them',
        'drama.beat — close "text" when a beat from the menu happened (beats are added by the director, the scout or the author)',
    ];
}
