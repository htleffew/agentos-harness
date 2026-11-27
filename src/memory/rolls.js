// Roll records in memory (memory DESIGN 3.3 and 7.7, MB14). A roll is a tracker value of its reply: B22's judge rolls
// before the reply (src/dice-judge.js) and stores the turn's rolls in the reply's extra with its swipe (src/dice.js,
// storeRolls). This file reads those values as memory's roll records, so capture, the fold's consumers and the evidence
// scripts see one shape:
//   { actor, name, attempt, stat, modifier, step, difficulty, stance, die, total, margin, degree, degreeId, source, route, model }
// Swipes, deletes and branches need no code here, because the value lives in the reply's own swipe data (DESIGN 2.1):
//   a new swipe runs the judgment and rolls again, and keeps its own roll (DECISIONS 2026-11-26, B22b);
//   switching swipes shows that swipe's roll; deleting the reply removes its rolls; a branch copies the messages and
//   their rolls; editing her message makes the next reply or swipe judge the edited text and roll afresh.
// What a roll caused in the story is filed by capture as ordinary records anchored to the reply, so capture is told the
// turn's rolls (captureRollLines).
import { KEY } from '../st.js';
import { DEGREES, degreeOf, diceOf, rollsOf } from '../dice.js';
import { storedMark, swipeOf } from './fold.js';

/** The fields every roll record carries (memory DESIGN 7.7). */
export const ROLL_FIELDS = Object.freeze(['actor', 'name', 'attempt', 'stat', 'modifier', 'step', 'difficulty', 'stance', 'die', 'total', 'margin', 'degree', 'degreeId', 'source', 'route', 'model']);

const num = value => (Number.isFinite(Number(value)) ? Number(value) : 0);

/**
 * One stored roll as a memory roll record. The degree comes from the margin (total minus difficulty) in six bands; a roll
 * saved before degrees (today's action checks, source 'saved') keeps the words it was saved with.
 */
export function rollRecord(roll) {
    if (!roll || typeof roll !== 'object') return null;
    const total = num(roll.total), difficulty = num(roll.dc ?? roll.difficulty);
    const margin = Number.isFinite(Number(roll.margin)) ? Number(roll.margin) : total - difficulty;
    const band = degreeOf(margin);
    const saved = roll.source === 'saved';
    return {
        actor: String(roll.actor || 'user'), name: String(roll.name || roll.actor || ''), attempt: String(roll.attempt || ''), stat: String(roll.stat || ''),
        modifier: num(roll.mod ?? roll.modifier), step: String(roll.step || ''), difficulty, stance: String(roll.stance || 'neutral'),
        die: num(roll.die), total, margin,
        degree: saved ? String(roll.degree || '') : band.label, degreeId: saved ? '' : band.id,
        source: String(roll.source || 'detected'), route: String(roll.route || ''), model: String(roll.model || ''),
    };
}

/** The degree id and label a margin falls in, for callers that hold only numbers. */
export const degreeFor = margin => { const d = degreeOf(margin); return { id: d.id, label: d.label }; };
export { DEGREES };

/** The roll records of one swipe of a reply (the showing swipe by default). Another swipe's value never counts. */
export function rollsAt(message, swipe = swipeOf(message)) {
    if (!message || message.is_user) return [];
    if (swipe === swipeOf(message)) return rollsOf(message).map(rollRecord).filter(Boolean);
    return (diceOf(message, swipe)?.rolls || []).map(rollRecord).filter(Boolean);
}

/** The judgment receipt of one swipe: route, model, time taken and every route tried with its own time. */
export function judgmentAt(message, swipe = swipeOf(message)) {
    const judge = diceOf(message, swipe)?.judge;
    if (!judge) return null;
    return { route: judge.route || '', model: judge.model || '', ms: num(judge.ms), skipped: !!judge.skipped, reason: judge.reason || '', at: num(judge.at),
        tried: (judge.tried || []).map(t => ({ route: t.route, outcome: t.outcome, ...(t.ms != null ? { ms: num(t.ms) } : {}) })), found: num(judge.found), copied: !!judge.copied };
}

/** Every reply of a chat that holds rolls on its showing swipe: [{ index, mark, swipe, rolls, judge }], oldest first. */
export function chatRolls(chat) {
    const out = [];
    (chat || []).forEach((message, index) => {
        if (!message || message.is_user) return;
        const rolls = rollsAt(message);
        const judge = judgmentAt(message);
        if (rolls.length || judge) out.push({ index, mark: storedMark(message), swipe: swipeOf(message), rolls, judge });
    });
    return out;
}

/** The judgment calls of a chat with their route and time, newest last: the timing record of each route (phone included). */
export function judgmentTimings(chat) {
    return chatRolls(chat).filter(row => row.judge && !row.judge.skipped && !row.judge.copied)
        .map(row => ({ index: row.index, swipe: row.swipe, route: row.judge.route, model: row.judge.model, ms: row.judge.ms, tried: row.judge.tried }));
}

/** One line for capture: who attempted what, the stat and difficulty, and the degree code sent the reply. */
export function rollCaptureLine(record) {
    const mod = `${record.modifier >= 0 ? '+' : ''}${record.modifier}`;
    return `${record.name || record.actor} attempts to ${String(record.attempt).replace(/^to\s+/i, '')}; ${record.stat} d20 ${record.die} ${mod} = ${record.total} against ${record.difficulty} (${record.step}): ${String(record.degree).toLowerCase()}.`;
}

/** The turn's rolls as capture reads them, or '' when the reply holds none (capture.js, rollOf). */
export function captureRollLines(message) {
    if (!message?.extra?.[KEY]?.dice) return '';
    return rollsAt(message).map(rollCaptureLine).join(' ');
}
