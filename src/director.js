// Undercurrent — the Director: a hidden showrunner pass that reads the scene and returns a plan as JSON.
// Pure logic: builds the messages and normalizes the result; index.js sends it.

import { asString, asArray, asEnum, asObjectList } from './parse.js';
import { isPlainObject, clip } from './util.js';

export const PACING = ['linger', 'advance', 'cut'];

export function emptyPlan() {
    return { context: '', social: [], driver: [], beat: '', pacing: 'advance', npc_moves: [], event: '', offscreen: [], avoid: [] };
}

const BEAT_TYPES_HELP = {
    consequence: 'a past action comes due', subtext: 'what is meant under what is said', secret: 'a hidden truth presses on someone',
    banter: 'quick verbal sparring', mishap: 'something small goes wrong', tenderness: 'unguarded care',
    interiority: '{{char}} notices something about themself', routine_disrupted: 'an ordinary routine breaks', threat: 'danger becomes concrete',
    reversal: 'expectation flips', deadline: 'time pressure appears', desire: 'want shows in the body or a choice', proximity: 'bodies or lives pushed close',
    confession: 'someone says the true thing', omen: 'a sign of what is coming', isolation: 'someone is cut off', stranger: 'a new person with an agenda',
};

/**
 * System prompt. Persona/tone/genre flavor the director's taste; they never appear in the story.
 * @param {{persona?:object, tone?:object, genre?:object, beatFavor?:string[]}} lenses
 */
export function buildDirectorSystem(lenses = {}) {
    const { persona, tone, genre } = lenses;
    const favor = (lenses.beatFavor || []).slice(0, 6);
    const taste = [];
    if (persona && persona.id !== 'none') taste.push(`Sensibility: ${persona.sensibility}`);
    if (tone) taste.push(`Tone: ${tone.name}.`);
    if (genre && genre.id !== 'none') taste.push(`Genre lens: ${genre.name}.`);
    if (favor.length) taste.push(`Beat types you favor when they fit (never force one): ${favor.map(f => (BEAT_TYPES_HELP[f] ? `${f} (${BEAT_TYPES_HELP[f]})` : f.replace(/_/g, ' '))).join('; ')}.`);

    return `You are the hidden showrunner of a long-running interactive story. You never write the story. You read the scene, decide privately what the world does next, and hand the writer one compact plan. The player never sees your notes.

The player controls {{user}}. Everyone and everything else belongs to the world.

What you must hold to:
1. Never script {{user}}. Do not decide, predict or describe {{user}}'s words, actions, choices, feelings or thoughts. Things may happen TO {{user}}; what she does about them is hers. Text marked as {{user}}'s private thought is unknown to every character: no one may react to it.
2. Characters are people, not props. Each has wants, plans, limits and blind spots, and acts only on what they actually know (saw, heard, were told, or can fairly infer). No instant love, no convenient omniscience. They react the way a real person in their position would: including refusing, misreading, lying, or acting first.
3. Keep the world moving. Prefer consequences of what already happened over random novelty. Off-screen people pursue their goals and come back changed. Plant drivers (an agenda, an object, a person, a deadline) that pay off later.
4. One beat per turn: the single next thing that happens, concrete and stageable in one reply (who does what, where), ending with room for {{user}} to respond. Never a menu of options, never a question to the player.
5. Break loops. If recent replies repeat a situation, emotion, gesture, topic or argument, change something real: new information, an arrival, a decision, a cost, a change of place or time.
6. Respect each character's stated limits and history. Desire is real and may prompt action, but follows who they are and what has happened on the page; no meters, no quota of flirting first.
7. Pacing: "linger" = stay inside a charged moment; "advance" = move the situation forward; "cut" = skip dead time to the next meaningful moment (never skipping past a choice that belongs to {{user}}).
${taste.length ? `\nPrivate craft taste (shapes your choices; never named or visible in the story):\n${taste.join('\n')}\n` : ''}
Return ONLY one JSON object, no prose, no code fence:
{"context":"<=40 words: the situation, what is at stake, the live threads",
 "social":[{"name":"","mood":"","want":"","plan":"","knows_missing":"what they do NOT know that matters"}],
 "driver":[{"item":"","purpose":"","planned_outcome":""}],
 "beat":"the single next beat for this turn, concrete, never deciding anything for {{user}}",
 "pacing":"linger|advance|cut",
 "npc_moves":[{"name":"","move":"what this character does or says on their own initiative this turn"}],
 "event":"concrete content of the due event, consistent with the world; empty string if none is due",
 "offscreen":[{"who":"","doing":"","surfaces_when":""}],
 "avoid":["specific things not to repeat or do this turn"]}

Rules for the JSON: "social" lists characters present plus anyone acting off-screen this turn, never {{user}}. 0–2 drivers, 0–3 npc_moves, 0–3 offscreen, 0–5 avoid. Every string short and specific: names, objects, places, actions. No generic advice ("build tension", "show emotion").`;
}

/**
 * Build the director's messages.
 * @param {object} p
 * @param {string} p.cardBlock character card + persona block
 * @param {string} p.stateBlock state summary
 * @param {string} p.transcript recent role-tagged messages
 * @param {object} p.signals {turn, stall, stallTurns, event, nudge, usedBeats[], ticNotes[], lastPlan}
 * @param {object} [p.lenses]
 */
export function buildDirectorMessages({ cardBlock = '', stateBlock = '', transcript = '', signals = {}, lenses = {} }) {
    const sig = [];
    sig.push(`Turn ${signals.turn ?? 0}.`);
    if (signals.stall) sig.push(`STALL: nothing new (fact, place, time, person) for ${signals.stallTurns ?? 'several'} turns. This beat must change something real.`);
    if (signals.event) sig.push(`EVENT DUE: ${signals.event.toUpperCase()} — ${eventHelp(signals.event)} Fill "event" with its concrete content.`);
    else sig.push('No event is due: leave "event" empty.');
    if (signals.nudge) sig.push(`Author's request for this turn (honor it unless it would script {{user}}): ${clip(signals.nudge, 400)}`);
    if (signals.usedBeats?.length) sig.push(`Beats already used recently (do not repeat): ${signals.usedBeats.slice(-6).map(b => clip(b, 80)).join(' | ')}`);
    if (signals.ticNotes?.length) sig.push(`Writer's recent tics to steer away from: ${signals.ticNotes.slice(0, 3).join(' ')}`);
    if (signals.lastPlan?.beat) sig.push(`Your previous beat: ${clip(signals.lastPlan.beat, 160)}`);
    const content = [
        cardBlock && `<cast>\n${cardBlock}\n</cast>`,
        stateBlock && `<continuity>\n${stateBlock}\n</continuity>`,
        `<recent>\n${transcript || '(the story has just begun)'}\n</recent>`,
        `<signals>\n${sig.join('\n')}\n</signals>`,
        'Read the latest PLAYER message closely: respond to what {{user}} actually said and did (never to her private thoughts). Return the JSON plan now.',
    ].filter(Boolean).join('\n\n');
    return { systemPrompt: buildDirectorSystem(lenses), messages: [{ role: 'user', content }] };
}

function eventHelp(kind) {
    switch (kind) {
        case 'pulse': return 'ambient life: something small and alive happens in the scene with a visible source, without derailing it.';
        case 'twist': return 'a complication, consequence or reversal grown from what is established.';
        case 'curiosity': return 'plant an unexplained concrete detail, or have a character want to learn something about {{user}} they have not been told.';
        default: return '';
    }
}

/** Coerce a parsed director result into a plan. Returns null when there is nothing usable. */
export function normalizePlan(obj, { userName = '' } = {}) {
    if (!isPlainObject(obj)) return null;
    const isUser = n => {
        const x = String(n || '').trim().toLowerCase();
        return !x || x === '{{user}}' || (userName && x === String(userName).trim().toLowerCase());
    };
    const plan = emptyPlan();
    plan.context = asString(obj.context, 400);
    plan.social = asObjectList(obj.social, ['name', 'mood', 'want', 'plan', 'knows_missing'], { max: 6, required: ['name'] }).filter(s => !isUser(s.name));
    plan.driver = asObjectList(obj.driver, ['item', 'purpose', 'planned_outcome'], { max: 2, required: ['item'] });
    plan.beat = asString(obj.beat, 400);
    plan.pacing = asEnum(obj.pacing, PACING, 'advance');
    plan.npc_moves = asObjectList(obj.npc_moves ?? obj.npcMoves, ['name', 'move'], { max: 3, required: ['name', 'move'] }).filter(m => !isUser(m.name));
    plan.event = asString(isPlainObject(obj.event) ? (obj.event.content ?? obj.event.text) : obj.event, 300);
    plan.offscreen = asObjectList(obj.offscreen, ['who', 'doing', 'surfaces_when'], { max: 3, required: ['who', 'doing'] }).filter(o => !isUser(o.who));
    plan.avoid = asArray(obj.avoid, 5).map(a => asString(a, 120)).filter(Boolean);
    const usable = plan.beat || plan.context || plan.social.length || plan.npc_moves.length;
    return usable ? plan : null;
}

/** Ops that persist the director's off-screen threads, drivers and the used beat (source: 'director'). */
export function planToThreadOps(plan) {
    if (!plan) return [];
    const ops = [];
    for (const o of plan.offscreen || []) ops.push({ op: 'append', path: 'threads.offscreen', value: o, reason: 'director' });
    for (const d of plan.driver || []) ops.push({ op: 'append', path: 'threads.driver', value: d, reason: 'director' });
    if (plan.beat) ops.push({ op: 'append', path: 'threads.used_beats', value: plan.beat, reason: 'director' });
    return ops;
}
