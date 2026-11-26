// Dice (DESIGN 6.9, decision 17, memory/m1l-dice-mechanics.md). Before each reply a judgment call (src/dice-judge.js) spots
// each attempt whose outcome is uncertain, in her message or an NPC's, with its stat, difficulty step and stance. Code
// rolls here: a d20 plus the actor's stat modifier (src/stat-sheets.js) against the difficulty, and the margin (total minus
// difficulty) sets one of six degrees. The reply gets one verdict per roll and an instruction to keep dice out of the
// prose, never a list of raw rolls. Each roll is stored in the reply's chat data with its swipe.
import { ctx, names, KEY, sub } from './st.js';
import { settings, chatState, saveChatState } from './store.js';
import { rollInt } from './books.js';
import { DEFAULT_STATS, MOD_MIN, MOD_MAX, statNames, statsOf, modifierOf, setStatByHand, subjectOf } from './stat-sheets.js';

export { DEFAULT_STATS, MOD_MIN, MOD_MAX, statNames };

/** The five difficulty steps and their numbers (M1l 5). Fair is the middle step. */
export const STEPS = Object.freeze([['Easy', 8], ['Fair', 11], ['Hard', 14], ['Very hard', 17], ['Extreme', 20]]);
export const STANCES = Object.freeze(['helping', 'neutral', 'resisting']);

/** The six degrees, by margin (decision 17). Each carries what it means for the story. */
export const DEGREES = Object.freeze([
    Object.freeze({ id: 'overwhelming-success', label: 'Overwhelming success', min: 5, max: Infinity, means: 'it succeeds completely, and something more goes their way' }),
    Object.freeze({ id: 'success', label: 'Success', min: 2, max: 4, means: 'it succeeds as intended' }),
    Object.freeze({ id: 'partial-success', label: 'Partial success', min: 0, max: 1, means: 'it succeeds, but only in part or at a cost' }),
    Object.freeze({ id: 'partial-failure', label: 'Partial failure', min: -2, max: -1, means: 'it falls short, though something is gained or a way stays open' }),
    Object.freeze({ id: 'failure', label: 'Failure', min: -4, max: -3, means: 'it fails' }),
    Object.freeze({ id: 'overwhelming-failure', label: 'Overwhelming failure', min: -Infinity, max: -5, means: 'it fails badly, and the situation turns worse' }),
]);

/** The one degree a margin falls in. */
export function degreeOf(margin) {
    const m = Math.round(Number(margin) || 0);
    return DEGREES.find(d => m >= d.min && m <= d.max);
}

/** The difficulty of a step once the stance moves it: helping is one step easier, resisting one harder, within Easy and Extreme. */
export function difficultyOf(step = 'Fair', stance = 'neutral') {
    const at = Math.max(0, STEPS.findIndex(([name]) => name.toLowerCase() === String(step || '').toLowerCase()));
    const moved = Math.max(0, Math.min(STEPS.length - 1, at + (stance === 'helping' ? -1 : stance === 'resisting' ? 1 : 0)));
    return { step: STEPS[at][0], moved: STEPS[moved][0], dc: STEPS[moved][1] };
}

/** The step nearest a typed difficulty number, for a die button saved with a number. */
export function stepOfNumber(dc) {
    const n = Number(dc);
    if (!Number.isFinite(n)) return 'Fair';
    return STEPS.reduce((best, step) => Math.abs(step[1] - n) < Math.abs(best[1] - n) ? step : best)[0];
}

/** The outcome words of a roll saved before degrees (today's chats): the total alone decides. */
export function outcome(natural, total) {
    if (total <= 2) return 'fails badly';
    if (total <= 7) return 'fails';
    if (total <= 11) return 'partly succeeds';
    if (total <= 16) return 'succeeds';
    if (total <= 21) return 'succeeds well';
    return 'succeeds brilliantly';
}

/** The stat modifiers of 'user', 'char' or an NPC's name: this chat's sheet. Missing stats count as 0. */
export function sheet(who) {
    return statsOf(who);
}

/** Set a stat by hand: it is marked as hers, and no later inference changes it. */
export function setStat(who, stat, value) {
    return setStatByHand(who, stat, value);
}

/** The display name of an actor. */
export function actorName(actor) {
    if (actor === 'user') return names().user;
    if (actor === 'char') return names().char;
    return String(actor || '').trim() || names().user;
}

/** Who acts, as a sheet subject: the persona, the character, or an NPC by name. */
export function actorOf(actor) {
    const raw = String(actor || '').trim();
    if (!raw || /^(user|player|you|\{\{user\}\})$/i.test(raw)) return 'user';
    if (/^(char|\{\{char\}\})$/i.test(raw)) return 'char';
    const subject = subjectOf(raw);
    return subject === 'user' || subject === 'char' ? subject : raw;
}

const clip = (text, n) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * Roll one attempt. spec: { actor, attempt, stat, step, stance, source, route, model, dc? }. dc, when given (a die button
 * saved with a number), replaces the step's number. random is for tests: () => 0..19.
 */
export function rollAttempt(spec, { random } = {}) {
    const actor = actorOf(spec.actor);
    const stat = statNames().includes(spec.stat) ? spec.stat : statNames()[0] || 'Wits';
    const diff = difficultyOf(spec.step, spec.stance);
    const dc = Number.isInteger(spec.dc) && spec.dc > 0 ? spec.dc : diff.dc;
    const mod = modifierOf(actor, stat);
    const die = (random ? random() : rollInt(20)) + 1;
    const total = die + mod;
    const margin = total - dc;
    const degree = degreeOf(margin);
    return {
        actor, name: actorName(actor), attempt: clip(spec.attempt, 160) || 'an attempt', stat, mod,
        step: Number.isInteger(spec.dc) && spec.dc > 0 ? stepOfNumber(dc) : diff.moved, dc, stance: STANCES.includes(spec.stance) ? spec.stance : 'neutral',
        die, total, margin, degree: degree.label, source: spec.source || 'detected', route: spec.route || '', ...(spec.model ? { model: spec.model } : {}),
    };
}

// ---------------------------------------------------------------- what the reply is told

export const VERDICT_HEAD = 'Dice verdicts for this reply, already settled. Write each attempt with the outcome its verdict sets.';
export const VERDICT_RULE = 'Keep dice, rolls, numbers, stats and degree names out of the prose; show the outcome only through what happens.';
export const USER_RULE = 'For {{user}}, the verdict settles only how the attempt turns out. Leave {{user}}\'s own words, choices and feelings to {{user}}.';

/** An attempt as a verb phrase: "persuade the lord", with no leading "to" or "tries to". */
export function attemptPhrase(text) {
    return String(text || 'act').trim().replace(/^(?:(?:tries|try|attempts?|wants?)\s+)?to\s+/i, '').replace(/[.!?]+$/, '') || 'act';
}

/** One verdict: who, the attempt and its degree with what the degree means. No number. */
export function verdictLine(roll) {
    const degree = DEGREES.find(d => d.label === roll.degree) || degreeOf(roll.margin);
    const who = roll.actor === 'user' ? names().user : roll.actor === 'char' ? names().char : roll.name;
    return `- ${who}'s attempt to ${attemptPhrase(roll.attempt)}: ${degree.label.toLowerCase()}, so ${degree.means}.`;
}

/** The text sent at depth 0 with the reply, or '' when no roll. */
export function verdictText(rolls) {
    if (!rolls?.length) return '';
    return sub([VERDICT_HEAD, ...rolls.map(verdictLine), VERDICT_RULE, rolls.some(r => r.actor === 'user') ? USER_RULE : ''].filter(Boolean).join('\n'));
}

/** The extension prompt key the verdict goes out under (SillyTavern's extension prompts, in chat at depth 0). */
export const DICE_PROMPT_KEY = 'RI_DICE';

/** Put the verdict into the next request, or take it out with an empty text. */
export function publishVerdict(text) {
    try { ctx().setExtensionPrompt?.(DICE_PROMPT_KEY, text || '', 1, 0, false, 0); } catch { /* the host has no extension prompts */ }
}

/** The one-line form of the Roll card: the parts the shared rollLine template draws. */
const cap = text => text.charAt(0).toLocaleUpperCase() + text.slice(1);

export function lineParts(roll) {
    return { who: roll.name, attempt: cap(attemptPhrase(roll.attempt)), stat: roll.stat, difficulty: roll.step, total: roll.total, against: roll.dc,
        degree: roll.degree, die: roll.die, modifier: roll.mod };
}

/** The same line as plain text, for the Sent card and copies. */
export function lineText(roll) {
    const mod = `${roll.mod >= 0 ? '+' : ''}${roll.mod}`;
    return `${roll.name}: ${cap(attemptPhrase(roll.attempt))}, ${roll.stat}, ${roll.step}: ${roll.total} vs ${roll.dc}, ${String(roll.degree).toLowerCase()} · d20 ${roll.die} ${mod}`;
}

// ---------------------------------------------------------------- stored with the reply

const swipeOf = message => Number.isInteger(message?.swipe_id) ? message.swipe_id : 0;

/** Store rolls on a reply's showing swipe: its extra and the matching swipe slot. A branch copies both with the message. */
export function storeRolls(message, rolls, receipt = null) {
    if (!message) return null;
    const swipe = swipeOf(message);
    const value = { swipe, rolls: structuredClone(rolls || []), ...(receipt ? { judge: structuredClone(receipt) } : {}) };
    const holders = [message.extra ||= {}];
    const slot = Array.isArray(message.swipe_info) ? message.swipe_info[swipe] : null;
    if (slot && typeof slot === 'object') holders.push(slot.extra ||= {});
    for (const holder of holders) {
        const rec = holder[KEY] && typeof holder[KEY] === 'object' ? holder[KEY] : (holder[KEY] = {});
        rec.dice = structuredClone(value);
    }
    return value;
}

/** The dice of a reply's showing swipe: { swipe, rolls, judge } or null. A value left from another swipe does not count. */
export function diceOf(message, swipe = swipeOf(message)) {
    const holder = swipe === swipeOf(message) ? message?.extra : message?.swipe_info?.[swipe]?.extra;
    const value = holder?.[KEY]?.dice;
    if (!value || !Array.isArray(value.rolls)) return null;
    return value.swipe === swipe || value.swipe === undefined ? value : null;
}

/** The rolls of a reply, with today's saved results (an action check of an older reply) as one line each. */
export function rollsOf(message) {
    const saved = diceOf(message);
    if (saved) return saved.rolls;
    const check = message?.extra?.[KEY]?.v10Check;
    if (!check) return [];
    // Today's chats keep their saved results: an older action check shows as it was rolled, with no degree worked out again.
    return [{ actor: check.actor || 'user', name: check.name || actorName(check.actor), attempt: check.action || 'an attempt', stat: check.stat || '',
        mod: Number(check.mod) || 0, step: stepOfNumber(check.dc), dc: Number(check.dc) || 0, die: Number(check.natural) || 0, total: Number(check.total) || 0,
        margin: (Number(check.total) || 0) - (Number(check.dc) || 0), degree: check.result || outcome(check.natural, check.total), source: 'saved', route: '' }];
}

// ---------------------------------------------------------------- the feature switch and the display setting

// The v10 module switch (Ours or Theirs for dice) is read through this, so this file never imports v10.js.
let featureReader = () => true;
export const setDiceFeatureReader = fn => { featureReader = typeof fn === 'function' ? fn : () => true; };

/** Dice are on: the extension, its Dice setting and the dice feature of the selected preset (Ours). */
export function diceOn() {
    const st = settings();
    if (st.enabled === false || st.dice?.on === false) return false;
    try { return featureReader() !== false; } catch { return true; }
}

export const DISPLAY = Object.freeze({ line: 'One line', hidden: 'Hidden' });

/** How rolls show in the tray: 'line' (one line inside the Roll card) or 'hidden' (still sent, kept in the Sent card). */
export function diceDisplay() {
    return settings().dice?.display === 'hidden' ? 'hidden' : 'line';
}

export function setDiceDisplay(value) {
    const st = settings();
    st.dice = st.dice && typeof st.dice === 'object' ? st.dice : {};
    st.dice.display = value === 'hidden' ? 'hidden' : 'line';
    try { ctx().saveSettingsDebounced(); } catch { /* not fatal */ }
}

// ---------------------------------------------------------------- the die button

/**
 * Queue a named roll for the next message: { actor, attempt, stat, step | dc, stance }. For that actor's attempt it
 * replaces what detection would set.
 */
export function queueRoll(spec) {
    const cs = chatState();
    if (!cs) throw new Error('Open a chat to queue a roll.');
    if (!diceOn()) throw new Error('Dice are off.');
    const actor = actorOf(spec?.actor || spec?.who || 'user');
    const stat = statNames().includes(spec?.stat) ? spec.stat : '';
    const dc = Number(spec?.dc);
    cs.diceQueued = { actor, attempt: clip(spec?.attempt, 160), stat, step: spec?.step || (Number.isFinite(dc) && dc > 0 ? stepOfNumber(dc) : 'Fair'),
        ...(Number.isInteger(dc) && dc > 0 ? { dc } : {}), stance: STANCES.includes(spec?.stance) ? spec.stance : 'neutral', at: Date.now() };
    saveChatState();
    return cs.diceQueued;
}

export const queuedRoll = () => chatState()?.diceQueued || null;
export function clearQueuedRoll() {
    const cs = chatState();
    if (!cs?.diceQueued) return false;
    delete cs.diceQueued;
    saveChatState();
    return true;
}

// ---------------------------------------------------------------- today's callers

// The story world's legacy dice entry (engine.js, the path for chats without v10) now gets nothing from here: the verdict
// goes out once, under DICE_PROMPT_KEY, for every chat. B13 retires the entry with the legacy path.
export const rollDice = () => null;
export const DICE_QUESTION = 'The reply wrote each attempt with the outcome its dice verdict set.';
