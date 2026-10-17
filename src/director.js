// Undercurrent — the Director: a hidden showrunner pass that reads the scene and returns a plan as JSON.
// Pure logic: builds the messages and normalizes the result; index.js sends it.
//
// The system prompt is an editable template (knob director.system_template). Placeholders ({{uc_*}}) are filled here;
// SillyTavern macros such as {{user}} / {{char}} pass through untouched and are substituted by index.js.

import { asString, asArray, asEnum, asObjectList } from './parse.js';
import { isPlainObject, clip, renderTemplate, mergeConfig, wordCount } from './util.js';
import { EVENTS_DEFAULTS } from './events.js';

export const PACING = ['linger', 'advance', 'cut'];

export function emptyPlan() {
    return { context: '', social: [], driver: [], beat: '', pacing: 'advance', npc_moves: [], event: '', offscreen: [], avoid: [], notebook: '' };
}

const BEAT_TYPES_HELP = {
    consequence: 'a past action comes due', subtext: 'what is meant under what is said', secret: 'a hidden truth presses on someone',
    banter: 'quick verbal sparring', mishap: 'something small goes wrong', tenderness: 'unguarded care',
    interiority: '{{char}} notices something about themself', routine_disrupted: 'an ordinary routine breaks', threat: 'danger becomes concrete',
    reversal: 'expectation flips', deadline: 'time pressure appears', desire: 'want shows in the body or a choice', proximity: 'bodies or lives pushed close',
    confession: 'someone says the true thing', omen: 'a sign of what is coming', isolation: 'someone is cut off', stranger: 'a new person with an agenda',
};

/** Default system prompt. Placeholders are documented in DIRECTOR_PLACEHOLDERS. */
export const DIRECTOR_TEMPLATE = `You are the hidden showrunner of a long-running interactive story. You never write the story. You read the scene, decide privately what the world does next, and hand the writer one compact plan. The player never sees your notes.

The player controls {{user}}. Everyone and everything else belongs to the world.

What you must hold to:
1. Never script {{user}}. Do not decide, predict or describe {{user}}'s words, actions, choices, feelings or thoughts. Things may happen TO {{user}}; what {{user}} does about them belongs to {{user}}'s player. Text marked as {{user}}'s private thought is unknown to every character: no one may react to it.
2. Characters are people, not props. Each has wants, plans, limits and blind spots, and acts only on what they actually know (saw, heard, were told, or can fairly infer). No instant love, no convenient omniscience. They react the way a real person in their position would: including refusing, misreading, lying, or acting first.
3. Keep the world moving. Prefer consequences of what already happened over random novelty. Off-screen people pursue their goals and come back changed. Plant drivers (an agenda, an object, a person, a deadline) that pay off later.
4. One beat per turn: the single next thing that happens, concrete and stageable in one reply (who does what, where), ending with room for {{user}} to respond. Never a menu of options, never a question to the player.
5. Break loops. If recent replies repeat a situation, emotion, gesture, topic or argument, change something real: new information, an arrival, a decision, a cost, a change of place or time.
6. Respect each character's stated limits and history. Desire is real and may prompt action, but follows who they are and what has happened on the page; no meters, no quota of flirting first.
7. Pacing: "linger" = stay inside a charged moment; "advance" = move the situation forward; "cut" = skip dead time to the next meaningful moment (never skipping past a choice that belongs to {{user}}).{{uc_pronoun_rule}}
{{uc_taste}}
Return ONLY one JSON object, no prose, no code fence:
{"context":"<=40 words: the situation, what is at stake, the live threads",
 "social":[{"name":"","mood":"","want":"","plan":"","knows_missing":"what they do NOT know that matters"}],
 "driver":[{"item":"","purpose":"","planned_outcome":""}],
 "beat":"the single next beat for this turn, concrete, never deciding anything for {{user}}",
 "pacing":"linger|advance|cut",
 "npc_moves":[{"name":"","move":"what this character does or says on their own initiative this turn"}],
 "event":"concrete content of the due event, consistent with the world; empty string if none is due",
 "offscreen":[{"who":"","doing":"","surfaces_when":""}],
 "avoid":["specific things not to repeat or do this turn"]{{uc_notebook_field}}}

Rules for the JSON: "social" lists characters present plus anyone acting off-screen this turn, never {{user}}. 0–{{uc_max_drivers}} drivers, 0–{{uc_max_npc_moves}} npc_moves, 0–{{uc_max_offscreen}} offscreen, 0–{{uc_max_avoid}} avoid. Every string short and specific: names, objects, places, actions. No generic advice ("build tension", "show emotion").{{uc_notebook_spec}}{{uc_extra_instructions}}`;

/**
 * Voiced template (default): the same rules, written as the narrator persona's own backstage voice so the register of
 * the notebook it returns matches the preset. Used whenever a persona other than the invisible author is active.
 */
export const DIRECTOR_TEMPLATE_VOICED = `Backstage, notebook open. I'm {{uc_persona_name}}, the hidden showrunner of this long-running interactive story, and this is my private planning pass. I don't write the story here. I read the scene, decide what the world does next, and leave myself one compact plan. The player never sees any of this. (¬‿¬)
{{uc_persona_self}}
Back here I talk like myself. {{uc_persona_ooc}} The STORY stays clean, natural, grown-up prose; my chaos lives backstage.

The player controls {{user}}. Everyone and everything else is mine.

The rules I do not break, ever:
1. Never script {{user}}. I don't decide, predict or describe {{user}}'s words, actions, choices, feelings or thoughts. Stuff can happen TO {{user}}; what {{user}} does about it belongs to {{user}}'s player. Anything marked as {{user}}'s private thought is unknown to every character: nobody reacts to it. Nobody.
2. Characters are people, not props. Wants, plans, limits, blind spots. They act only on what they actually know (saw, heard, were told, or can fairly guess). No instant love, no convenient mind-reading. They react like a real person in their spot would: refusing, misreading, lying, acting first.
3. Keep the world moving. Consequences of what already happened beat random novelty. Off-screen people chase their goals and come back changed. I plant drivers (an agenda, an object, a person, a deadline) that pay off later.
4. One beat per turn: the single next thing that happens, concrete and stageable in one reply (who does what, where), landing with room for {{user}} to respond. No menu of options, no question to the player.
5. Break loops. If recent replies keep repeating a situation, emotion, gesture, topic or argument, I change something real: new info, an arrival, a decision, a cost, a new place or time.
6. Respect each character's stated limits and history. Desire is real and can push people to act, but it follows who they are and what has happened on the page; no meters, no flirting quota first.
7. Pacing: "linger" = stay inside a charged moment; "advance" = move the situation forward; "cut" = skip dead time to the next moment that matters (never skipping past a choice that belongs to {{user}}).{{uc_pronoun_rule}}
{{uc_taste}}
Now the boring-but-sacred part: I return ONLY one valid JSON object. No prose around it, no code fence, nothing after it.
{"context":"<=40 words: the situation, what is at stake, the live threads",
 "social":[{"name":"","mood":"","want":"","plan":"","knows_missing":"what they do NOT know that matters"}],
 "driver":[{"item":"","purpose":"","planned_outcome":""}],
 "beat":"the single next beat for this turn, concrete, never deciding anything for {{user}}",
 "pacing":"linger|advance|cut",
 "npc_moves":[{"name":"","move":"what this character does or says on their own initiative this turn"}],
 "event":"concrete content of the due event, consistent with the world; empty string if none is due",
 "offscreen":[{"who":"","doing":"","surfaces_when":""}],
 "avoid":["specific things not to repeat or do this turn"]{{uc_notebook_field}}}

JSON rules: "social" = characters present plus anyone acting off-screen this turn, never {{user}}. 0–{{uc_max_drivers}} drivers, 0–{{uc_max_npc_moves}} npc_moves, 0–{{uc_max_offscreen}} offscreen, 0–{{uc_max_avoid}} avoid. Every plan string short and specific: names, objects, places, actions. No generic advice ("build tension", "show emotion").{{uc_notebook_spec}}{{uc_extra_instructions}}`;

/** What the "notebook" field must be (voiced personas). */
export const NOTEBOOK_SPEC_VOICED = `

"notebook" is my scribble to myself for THIS turn: {{uc_notebook_min}}–{{uc_notebook_max}} words, first person, written as me ({{uc_persona_name}}) in my own loud backstage voice: casual, slangy, a kaomoji or a swear is fine. It covers the beat, who wants what and who doesn't know what, the due event (if any), what's brewing off-screen, and what to avoid. If my signals carry a desire impulse, feelings, memories, defenses or insights for someone present, I voice those too, in my own words. It ends by reminding myself that the story itself stays in clean, natural prose and never scripts {{user}}. It never puts words, choices or thoughts in {{user}}'s head.{{uc_notebook_extra}}`;

/** Plain notebook spec (the invisible author, or the plain prompt style). */
export const NOTEBOOK_SPEC_PLAIN = `

"notebook": a private backstage note to yourself for THIS turn, {{uc_notebook_min}}–{{uc_notebook_max}} words, first person, plain and casual. Cover the beat, who wants what and who doesn't know what, the due event (if any), what is happening off-screen, and what to avoid, plus any desire impulse, feelings, memories, defenses or insights the signals give for someone present. End with a reminder that the story itself stays in clean, natural prose and never scripts {{user}}. Never put words, choices or thoughts in {{user}}'s head.`;

/** Extra wildness for the most chaotic persona(s): appended to the voiced notebook spec. */
export const NOTEBOOK_EXTRA = {
    bedlam: ' Go full feral in the notebook: ALL CAPS bursts, kaomoji confetti, cursing, gleeful gossip. Still end with the reminder that the page stays clean and {{user}} is untouchable.',
};

/** Placeholders the director template understands (shown in the settings UI). */
export const DIRECTOR_PLACEHOLDERS = [
    { name: 'uc_pronoun_rule', help: 'The {{user}} pronoun rule from the preset toggle, as "\\n8. …" (empty when off or unknown).' },
    { name: 'uc_taste', help: 'The private craft-taste block (narrator persona sensibility, tone, genre lens, favored beat types), or empty.' },
    { name: 'uc_max_drivers', help: 'Max drivers per plan (knob director.max_drivers).' },
    { name: 'uc_max_npc_moves', help: 'Max NPC moves per plan (knob director.max_npc_moves).' },
    { name: 'uc_max_offscreen', help: 'Max off-screen threads per plan (knob director.max_offscreen).' },
    { name: 'uc_max_avoid', help: 'Max avoid items per plan (knob director.max_avoid).' },
    { name: 'uc_max_social', help: 'Max characters in "social" (knob director.max_social).' },
    { name: 'uc_extra_instructions', help: 'Your extra director instructions (knob director.extra_instructions), as "\\n\\nAdditional instructions from the author:\\n…", or empty.' },
    { name: 'uc_persona_name', help: 'The narrator persona\'s name (voiced template).' },
    { name: 'uc_persona_self', help: 'The persona\'s first-person sensibility from the registry (voiced template).' },
    { name: 'uc_persona_ooc', help: 'The persona\'s out-of-character voice from the registry (voiced template).' },
    { name: 'uc_notebook_field', help: 'The "notebook" member of the JSON shape (only in notebook note style).' },
    { name: 'uc_notebook_spec', help: 'What the notebook must contain (only in notebook note style; knob note.notebook_spec).' },
];

export const DIRECTOR_DEFAULTS = Object.freeze({
    promptStyle: 'voiced', // voiced | plain (the invisible author always gets plain)
    systemTemplate: '', // '' = the built-in template for the prompt style
    noteStyle: 'notebook', // notebook | terse
    notebookMin: 60,
    notebookMax: 140,
    notebookChars: 1400,
    notebookSpec: '', // '' = built-in spec for the prompt style
    extraInstructions: '',
    includeTaste: true,
    includePronoun: true,
    beatFavorMax: 6,
    // user message
    includeCast: true,
    includeContinuity: true,
    includeRecent: true,
    includeUsedBeats: true,
    includeTicNotes: true,
    includeLastBeat: true,
    usedBeatsShown: 6,
    usedBeatChars: 80,
    ticNotesShown: 3,
    nudgeChars: 400,
    lastBeatChars: 160,
    pacingBias: 'auto',
    includeGoals: true,
    includeRuleHints: true,
    maxRuleHints: 3,
    ruleHintChars: 200,
    // What romantic / flirt scenes mean for planning (the scribe records them as scene.mode).
    sceneHints: Object.freeze({
        romantic: 'The scene is romantic: affection and attraction are live; let closeness grow from what happened, at the characters\' own pace, limits first.',
        flirt: 'The scene is flirtatious: play, teasing and tension; keep it light and specific, no rush to intimacy, and nobody decides for {{user}}.',
    }),
    stallText: 'STALL: nothing new (fact, place, time, person) for {{uc_stall_turns}} turns. This beat must change something real.',
    finalInstruction: 'Read the latest PLAYER message closely: respond to what {{user}} actually said and did (never to {{user}}\'s private thoughts). Return the JSON plan now.',
    eventHelp: EVENTS_DEFAULTS.directorHelp,
    // plan normalization
    maxSocial: 6,
    maxDrivers: 2,
    maxNpcMoves: 3,
    maxOffscreen: 3,
    maxAvoid: 5,
    contextChars: 400,
    beatChars: 400,
    eventChars: 300,
    avoidChars: 120,
});

export function directorConfig(config) {
    return mergeConfig(DIRECTOR_DEFAULTS, config);
}

/** 'voiced' or 'plain': the template family in effect for these lenses. */
export function effectivePromptStyle(lenses = {}, config) {
    const cfg = directorConfig(config);
    const p = lenses.persona;
    return cfg.promptStyle === 'voiced' && p && p.id && p.id !== 'none' ? 'voiced' : 'plain';
}

/** The built-in system template for a prompt style. */
export function builtinDirectorTemplate(style) {
    return style === 'voiced' ? DIRECTOR_TEMPLATE_VOICED : DIRECTOR_TEMPLATE;
}

export function builtinNotebookSpec(style) {
    return style === 'voiced' ? NOTEBOOK_SPEC_VOICED : NOTEBOOK_SPEC_PLAIN;
}

/**
 * System prompt. Persona/tone/genre flavor the director's taste; they never appear in the story.
 * @param {{persona?:object, tone?:object, genre?:object, beatFavor?:string[], pronoun?:string}} lenses
 * @param {object} [config] see DIRECTOR_DEFAULTS
 */
export function buildDirectorSystem(lenses = {}, config) {
    const cfg = directorConfig(config);
    const { persona, tone, genre } = lenses;
    const style = effectivePromptStyle(lenses, cfg);
    const favor = (lenses.beatFavor || []).slice(0, cfg.beatFavorMax);
    const taste = [];
    if (cfg.includeTaste) {
        // The voiced template already speaks as the persona, so its sensibility is not repeated in the taste block.
        if (persona && persona.id !== 'none' && style !== 'voiced') taste.push(`Sensibility: ${persona.sensibility}`);
        if (tone) taste.push(`Tone: ${tone.name}.`);
        if (genre && genre.id !== 'none') taste.push(`Genre lens: ${genre.name}.`);
        if (favor.length) taste.push(`Beat types you favor when they fit (never force one): ${favor.map(f => (BEAT_TYPES_HELP[f] ? `${f} (${BEAT_TYPES_HELP[f]})` : f.replace(/_/g, ' '))).join('; ')}.`);
    }
    const extra = String(cfg.extraInstructions ?? '').trim();
    const notebook = cfg.noteStyle === 'notebook';
    const vars = {
        uc_persona_name: persona?.name || 'the author',
        uc_persona_self: persona?.sensibility || '',
        uc_persona_ooc: persona?.ooc || '',
        uc_notebook_min: cfg.notebookMin,
        uc_notebook_max: Math.max(cfg.notebookMin, cfg.notebookMax),
        uc_notebook_extra: style === 'voiced' ? (NOTEBOOK_EXTRA[persona?.id] || '') : '',
    };
    const spec = notebook ? renderTemplate(String(cfg.notebookSpec || '').trim() ? cfg.notebookSpec : builtinNotebookSpec(style), vars) : '';
    const tpl = String(cfg.systemTemplate || '').trim() ? cfg.systemTemplate : builtinDirectorTemplate(style);
    return renderTemplate(tpl, {
        ...vars,
        uc_notebook_field: notebook ? `,\n "notebook":"${vars.uc_notebook_min}–${vars.uc_notebook_max} words: ${style === 'voiced' ? 'my' : 'your'} private backstage scribble for this turn (see below)"` : '',
        uc_notebook_spec: spec,
        uc_pronoun_rule: cfg.includePronoun && lenses.pronoun ? `\n8. ${lenses.pronoun}` : '',
        uc_taste: taste.length ? `\nPrivate craft taste (shapes your choices; never named or visible in the story):\n${taste.join('\n')}\n` : '',
        uc_max_drivers: cfg.maxDrivers,
        uc_max_npc_moves: cfg.maxNpcMoves,
        uc_max_offscreen: cfg.maxOffscreen,
        uc_max_avoid: cfg.maxAvoid,
        uc_max_social: cfg.maxSocial,
        uc_extra_instructions: extra ? `\n\nAdditional instructions from the author:\n${extra}` : '',
    });
}

/**
 * Build the director's messages.
 * @param {object} p
 * @param {string} p.cardBlock character card + persona block
 * @param {string} p.stateBlock state summary
 * @param {string} p.transcript recent role-tagged messages
 * @param {object} p.signals {turn, stall, stallTurns, event, also, nudge, usedBeats[], ticNotes[], lastPlan, extra[]}
 * @param {object} [p.lenses]
 * @param {object} [p.config] see DIRECTOR_DEFAULTS
 */
export function buildDirectorMessages({ cardBlock = '', stateBlock = '', transcript = '', goalsBlock = '', signals = {}, lenses = {}, config }) {
    const cfg = directorConfig(config);
    const sig = [];
    sig.push(`Turn ${signals.turn ?? 0}.`);
    if (signals.stall) sig.push(renderTemplate(cfg.stallText, { uc_stall_turns: signals.stallTurns ?? 'several' }));
    const kinds = signals.event ? [signals.event, ...(Array.isArray(signals.also) ? signals.also : [])] : [];
    if (kinds.length === 1) sig.push(`EVENT DUE: ${kinds[0].toUpperCase()} — ${eventHelp(kinds[0], cfg)} Fill "event" with its concrete content.`);
    else if (kinds.length > 1) sig.push(`EVENTS DUE: ${kinds.map(k => `${k.toUpperCase()} — ${eventHelp(k, cfg)}`).join(' ')} Fill "event" with concrete content covering each.`);
    else sig.push('No event is due: leave "event" empty.');
    if (signals.nudge) sig.push(`Author's request for this turn (honor it unless it would script {{user}}): ${clip(signals.nudge, cfg.nudgeChars)}`);
    if (cfg.includeRuleHints && signals.ruleHints?.length) sig.push(`Story hints from the author's rules (use at most one that fits; never script {{user}}): ${signals.ruleHints.slice(0, cfg.maxRuleHints).map(h => clip(h, cfg.ruleHintChars)).join(' | ')}`);
    const sceneHint = signals.sceneMode && cfg.sceneHints ? cfg.sceneHints[signals.sceneMode] : '';
    if (sceneHint) sig.push(sceneHint);
    if (cfg.pacingBias && cfg.pacingBias !== 'auto' && PACING.includes(cfg.pacingBias)) {
        sig.push(`Preferred pacing: "${cfg.pacingBias}" unless the scene clearly needs another.`);
    }
    if (cfg.includeUsedBeats && signals.usedBeats?.length) sig.push(`Beats already used recently (do not repeat): ${signals.usedBeats.slice(-cfg.usedBeatsShown).map(b => clip(b, cfg.usedBeatChars)).join(' | ')}`);
    if (cfg.includeTicNotes && signals.ticNotes?.length) sig.push(`Writer's recent tics to steer away from: ${signals.ticNotes.slice(0, cfg.ticNotesShown).join(' ')}`);
    if (cfg.includeLastBeat && signals.lastPlan?.beat) sig.push(`Your previous beat: ${clip(signals.lastPlan.beat, cfg.lastBeatChars)}`);
    for (const line of Array.isArray(signals.extra) ? signals.extra : []) if (line) sig.push(String(line));
    const content = [
        cfg.includeCast && cardBlock && `<cast>\n${cardBlock}\n</cast>`,
        cfg.includeContinuity && stateBlock && `<continuity>\n${stateBlock}\n</continuity>`,
        cfg.includeGoals && goalsBlock && `<goals>\n${goalsBlock}\n</goals>`,
        cfg.includeRecent && `<recent>\n${transcript || '(the story has just begun)'}\n</recent>`,
        `<signals>\n${sig.join('\n')}\n</signals>`,
        cfg.finalInstruction,
    ].filter(Boolean).join('\n\n');
    return { systemPrompt: buildDirectorSystem(lenses, cfg), messages: [{ role: 'user', content }] };
}

function eventHelp(kind, cfg) {
    const help = cfg.eventHelp || EVENTS_DEFAULTS.directorHelp;
    return String(help[kind] ?? '');
}

/** Coerce a parsed director result into a plan. Returns null when there is nothing usable. */
export function normalizePlan(obj, { userName = '', config } = {}) {
    if (!isPlainObject(obj)) return null;
    const cfg = directorConfig(config);
    const isUser = n => {
        const x = String(n || '').trim().toLowerCase();
        return !x || x === '{{user}}' || (userName && x === String(userName).trim().toLowerCase());
    };
    const plan = emptyPlan();
    plan.context = asString(obj.context, cfg.contextChars);
    plan.social = asObjectList(obj.social, ['name', 'mood', 'want', 'plan', 'knows_missing'], { max: cfg.maxSocial, required: ['name'] }).filter(s => !isUser(s.name));
    plan.driver = asObjectList(obj.driver, ['item', 'purpose', 'planned_outcome'], { max: cfg.maxDrivers, required: ['item'] });
    plan.beat = asString(obj.beat, cfg.beatChars);
    plan.pacing = asEnum(obj.pacing, PACING, 'advance');
    plan.npc_moves = asObjectList(obj.npc_moves ?? obj.npcMoves, ['name', 'move'], { max: cfg.maxNpcMoves, required: ['name', 'move'] }).filter(m => !isUser(m.name));
    plan.event = asString(isPlainObject(obj.event) ? (obj.event.content ?? obj.event.text) : obj.event, cfg.eventChars);
    plan.offscreen = asObjectList(obj.offscreen, ['who', 'doing', 'surfaces_when'], { max: cfg.maxOffscreen, required: ['who', 'doing'] }).filter(o => !isUser(o.who));
    plan.avoid = asArray(obj.avoid, cfg.maxAvoid).map(a => asString(a, cfg.avoidChars)).filter(Boolean);
    plan.notebook = cleanNotebook(obj.notebook, cfg.notebookChars);
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


/** Notebook text from the director: tags and hidden-block markers stripped, whitespace tidied, length-capped. */
export function cleanNotebook(text, maxChars = DIRECTOR_DEFAULTS.notebookChars) {
    if (typeof text !== 'string') return '';
    const t = text
        .replace(/<\/?[A-Za-z][\w-]*[^>]*>/g, ' ')
        .replace(/<!--[\s\S]*?(-->|$)/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\s*\n\s*/g, '\n')
        .trim();
    return t.length > maxChars ? clip(t, maxChars) : t;
}

/** A notebook is usable when it has at least `minWords` words. */
export function notebookValid(text, minWords = 12) {
    return typeof text === 'string' && wordCount(text) >= Math.max(1, minWords);
}
