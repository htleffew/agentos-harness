// Undercurrent — every built-in knob (setting / toggle / template) and the mapping from resolved knob values to each
// engine's config. Pure data + functions. Defaults are taken from the engines' own *_DEFAULTS so they cannot drift.
// Other engines (goals, rules, …) register their own arrays at runtime with knobs.registerKnobs().

import { EVENTS_DEFAULTS, EVENT_KINDS } from './events.js';
import { DIRECTOR_DEFAULTS, DIRECTOR_PLACEHOLDERS, builtinDirectorTemplate, builtinNotebookSpec, PACING } from './director.js';
import { SCRIBE_DEFAULTS, SCRIBE_PLACEHOLDERS, INREPLY_PLACEHOLDERS, PATH_GROUPS, PORT_RECORD_GROUPS, SCRIBE_TEMPLATE, INREPLY_TEMPLATE } from './scribe.js';
import { portScribePathGuide } from './ports/port-state.js';
import { INTIMACY_DEFAULTS, SEED_TEMPLATE, SEED_PLACEHOLDERS } from './intimacy.js';
import { INJECT_DEFAULTS, INJECT_SECTIONS } from './inject.js';
import { TICGUARD_DEFAULTS, TIC_TEXT_PLACEHOLDERS } from './ticguard.js';
import { CARD_DEFAULTS } from './context.js';
import { LIMITS_DEFAULTS, SCENE_MODES } from './state.js';
import { MODEL_PROFILES } from './slop.js';
import { registerKnobs, registerGroups } from './knobs.js';

export const CORE_GROUPS = [
    { id: 'core', label: 'General', order: 10, description: 'Master switches, mode and director cadence.' },
    { id: 'display', label: 'Display', order: 15, description: 'Undercurrent never prints into the chat. At most, an optional closed "Behind the scenes" panel under each reply (screen only).' },
    { id: 'hidden', label: 'Hidden passes', order: 20, description: 'Connection, timeouts and token budgets for the director, scribe and seed passes.' },
    { id: 'note', label: 'Note style', order: 25, description: 'How the injected note reads: the narrator persona\'s backstage notebook, or terse labeled lines.' },
    { id: 'director', label: 'Director', order: 30, description: 'What the director sees, how big its plan may be, and its taste.' },
    { id: 'events', label: 'Events', order: 40, description: 'Random pulse / twist / curiosity dice: chances, cooldowns and suppression.' },
    { id: 'inject', label: 'Injection', order: 50, description: 'Where and how the note reaches the model: placement, depth, role, word cap, sections, order, labels.' },
    { id: 'scribe', label: 'Scribe', order: 60, description: 'What the post-reply clerk may record.' },
    { id: 'intimacy', label: 'Intimacy', order: 70, description: 'Seeding, evidence rules and what is tracked. Hard limits and negative evidence always win.' },
    { id: 'ticguard', label: 'Tic guard', order: 80, description: 'Repetition, slop, echo, mind-read, opening and stall detection, and the correction wording.' },
    { id: 'context', label: 'Context budgets', order: 90, description: 'How much of the card, persona and chat the hidden passes read.' },
    { id: 'state', label: 'Memory limits', order: 100, description: 'Caps on stored facts, threads, ledger, snapshots and caches.' },
    { id: 'templates', label: 'Prompt templates', order: 110, description: 'Full text of every hidden prompt and fixed phrase. Empty = built-in default.' },
];

const b = (key, group, label, def, help = '', x = {}) => ({ key, group, label, type: 'bool', default: def, help, ...x });
const i = (key, group, label, def, min, max, help = '', x = {}) => ({ key, group, label, type: 'int', default: def, min, max, step: 1, help, ...x });
const n = (key, group, label, def, min, max, step, help = '', x = {}) => ({ key, group, label, type: 'number', default: def, min, max, step, help, ...x });
const sel = (key, group, label, def, options, help = '', x = {}) => ({ key, group, label, type: 'select', default: def, options: options.map(o => (typeof o === 'object' ? o : { value: o, label: String(o) })), help, ...x });
const t = (key, group, label, def, help = '', x = {}) => ({ key, group, label, type: 'text', default: def, help, ...x });
const ta = (key, group, label, def, help = '', x = {}) => ({ key, group, label, type: 'textarea', default: def, help, ...x });
const tpl = (key, label, def, help, placeholders = [], x = {}) => ({ key, group: 'templates', label, type: 'textarea', default: def, help, placeholders, template: true, rows: 10, ...x });

const KIND_LABEL = { pulse: 'Pulse', twist: 'Twist', curiosity: 'Curiosity' };
const SECTION_LABEL = {
    clock: 'Clock / place / weather', present: 'Who is here', beat: 'Beat (+ pacing)', pacing: 'Pacing (when there is no beat)', event: 'Event',
    author: 'Author\'s note (/uc-direct)', stall: 'Stall nudge', moves: 'NPC moves', minds: 'NPC minds', intimacy: 'Intimacy',
    facts: 'Facts', offscreen: 'Off-screen threads', avoid: 'Avoid list', tics: 'Tic-guard corrections', goals: 'Goals (Goals engine)', sparks: 'Sparks (Chance rules)',
    scene_intimacy: 'Intimate-scene continuity (ports)', desire: 'Desire impulse (ports)', psyche: 'Feelings and memories (ports)',
    reply_shape: 'Reply shape (ports)', critic: 'Critic corrections (ports)', drama: 'Drama cadence (ports)',
};
const SECTION_OPTIONS = INJECT_SECTIONS.map(s => ({ value: s, label: SECTION_LABEL[s] || s }));
const PRI_LABEL = { ...SECTION_LABEL, intimacy: 'Intimacy (intimate scene)', intimacy_attraction: 'Intimacy (live attraction only)', facts: 'Facts', facts_impersonate: 'Facts (impersonation)' };
const LABEL_HELP = {
    now: 'Prefix of the clock/place/weather line.', here: 'Prefix of the "who is here" line.', beat: 'Prefix of the beat line.', pacing: 'Prefix of the pacing-only line.',
    event: 'Prefix of the event line.', author: 'Prefix of your /uc-direct note.', acts: 'Word between an NPC\'s name and their move.', facts: 'Prefix of the facts line.',
    offscreen: 'Prefix of the off-screen line.', avoid: 'Prefix of the avoid line.', prose: 'Prefix of each tic-guard correction.', intimacy: 'Prefix of each intimacy line.',
    wants: 'Word before an NPC\'s want.', plan: 'Word before an NPC\'s plan.', doesnt_know: 'Words before what an NPC does not know.', surfaces: 'Words before when an off-screen thread surfaces.',
};
const PATH_HELP = { intimacy: 'Also needs the intimacy engine on.' };
const PROFILE_OPTIONS = [{ value: 'auto', label: 'Auto (from the active model)' }, { value: 'none', label: 'None (custom bans only)' }, ...MODEL_PROFILES.map(p => ({ value: p, label: p }))];

/** All built-in knobs. */
export const CORE_KNOBS = [
    // ---- General
    b('core.enabled', 'core', 'Enabled', true, 'Master switch. Off clears the note immediately and stops every hidden pass.', { keepOnProfile: true }),
    sel('core.mode', 'core', 'Mode', 'separate', [{ value: 'separate', label: 'Separate passes (director before, scribe after)' }, { value: 'inreply', label: 'In-reply (main model appends a hidden record)' }],
        'Separate: a hidden director pass before each reply and a scribe pass after it. In-reply: the main model appends a hidden <!--uc {…} --> record that is parsed and stripped (one call fewer per turn).'),
    sel('core.cadence', 'core', 'Director cadence', 'every', [{ value: 'every', label: 'Every player turn' }, { value: '2', label: 'Every 2 turns' }, { value: '3', label: 'Every 3 turns' }, { value: 'stall', label: 'Only on stall, event or /uc-direct' }],
        'How often the director plans. Between plans the last plan\'s minds/avoid lines are reused without its beat.'),
    b('core.pre_reply', 'core', 'Run the director before the reply', true, 'On: the director sees your latest message (adds latency up to the timeout). Off: it plans the next turn in the background right after each reply.'),
    b('core.paused', 'core', 'Paused (all chats)', false, 'Same as /uc-pause: no hidden passes and no note until resumed.', { keepOnProfile: true }),
    b('core.chat_paused', 'core', 'Paused in this chat', false, 'Pause Undercurrent for the current chat only (/uc-pause chat=true).', { scope: 'chat', keepOnProfile: true }),
    b('core.reroll_reuse_plan', 'core', 'Swipes reuse the turn\'s plan', true, 'Swipes and regenerations reuse the plan made for the same player message instead of running the director again.', { advanced: true }),
    i('core.plan_cache_size', 'core', 'Plan cache size', 20, 1, 500, 'How many recent per-message plans are kept in memory for swipes.', { advanced: true }),
    b('core.toast_on_failure', 'core', 'Warn when hidden passes keep failing', true, 'Show a toast after several failures in a row.'),
    i('core.failure_toast_after', 'core', 'Failures before warning', 3, 1, 50, 'Consecutive hidden-pass failures before the warning toast.', { advanced: true }),
    n('core.failure_toast_cooldown_min', 'core', 'Warning cooldown (minutes)', 5, 0, 240, 1, 'Minimum time between two failure toasts.', { advanced: true }),
    b('core.debug', 'core', 'Debug logging', false, 'Log plans, ops, rejections and the final note to the browser console with the [Undercurrent] prefix.', { keepOnProfile: true }),

    // ---- Display (nothing is ever printed into the chat)
    sel('display.peek', 'display', '"Behind the scenes" peek', 'off', [{ value: 'off', label: 'Off (fully invisible)' }, { value: 'collapsed', label: 'Collapsed panel under each reply' }],
        'Collapsed: a closed panel under each reply shows that turn\'s direction, characters, goals, fired rules and events, engine lines and corrections. Screen only: never in the message text, the chat file or anything sent to the model. Hidden goals stay masked. Per chat: /uc-peek on|off.'),
    sel('display.toasts', 'display', 'Pop-up notices', 'failures', [{ value: 'failures', label: 'Only repeated failures and replies to my commands' }, { value: 'all', label: 'Also progress (goal completions)' }],
        'Undercurrent stays silent by default; "all" also announces goal tasks completed in the background.'),

    // ---- Hidden passes
    t('hidden.profile_id', 'hidden', 'Hidden-pass connection', '', 'A Connection Manager profile for the director, scribe and seed passes (e.g. a cheaper model). Empty = your current connection.', { ui: 'connection-profile', keepOnProfile: true }),
    b('hidden.include_preset', 'hidden', 'Use the profile\'s preset settings', true, 'When a connection profile is set: apply its sampler preset to hidden passes.', { advanced: true }),
    i('hidden.timeout_sec', 'hidden', 'Timeout (s)', 45, 5, 300, 'Generation is never held up longer than this. On timeout the last plan is used.'),
    i('hidden.max_tokens', 'hidden', 'Max tokens', 900, 200, 8000, 'Response budget for hidden passes.', { step: 50 }),
    i('hidden.director_max_tokens', 'hidden', 'Director max tokens', 0, 0, 8000, '0 = same as Max tokens. Notebook style needs a little more room than terse.', { step: 50, advanced: true }),
    i('hidden.scribe_max_tokens', 'hidden', 'Scribe max tokens', 0, 0, 8000, '0 = same as Max tokens.', { step: 50, advanced: true }),
    i('hidden.seed_max_tokens', 'hidden', 'Seed max tokens', 700, 200, 8000, 'Cap for the one-time intimacy seed pass (never above Max tokens).', { step: 50, advanced: true }),
    i('hidden.min_tokens', 'hidden', 'Token floor', 200, 1, 8000, 'No hidden pass asks for fewer tokens than this.', { advanced: true }),
    n('hidden.wait_for_scribe_sec', 'hidden', 'Wait for the scribe (s)', 12, 0, 120, 1, 'Before the director runs, wait up to this long for a still-running scribe pass so the director sees the latest facts. 0 = never wait.'),
    n('hidden.wait_for_scribe_share', 'hidden', 'Scribe wait share of the timeout', 0.3, 0, 1, 0.05, 'The wait is also capped at this share of the remaining timeout.', { advanced: true }),
    n('hidden.seed_budget_share', 'hidden', 'Seed share of the timeout', 0.4, 0, 1, 0.05, 'The first-turn seed pass may use at most this share of the remaining timeout.', { advanced: true }),
    n('hidden.seed_budget_max_sec', 'hidden', 'Seed time cap (s)', 20, 0, 300, 1, 'Absolute cap for the seed pass inside the interceptor.', { advanced: true }),
    n('hidden.seed_min_budget_sec', 'hidden', 'Seed minimum time (s)', 2, 0, 60, 0.5, 'Skip seeding this turn when less time than this is left.', { advanced: true }),
    n('hidden.director_min_budget_sec', 'hidden', 'Director minimum time (s)', 3, 0, 60, 0.5, 'Skip the director this turn when less time than this is left.', { advanced: true }),

    // ---- Note style
    sel('note.style', 'note', 'Note style', 'notebook', [{ value: 'notebook', label: 'Notebook (persona\'s backstage voice)' }, { value: 'terse', label: 'Terse (labeled bullet lines)' }],
        'Notebook: the director writes a first-person backstage scribble in the narrator persona\'s voice, matching the preset\'s register; facts, clock, intimacy and tic lines follow. Falls back to terse when the notebook is missing. Terse: v1.0 labeled lines.'),
    i('note.notebook_min_words', 'note', 'Notebook length: min words', 60, 10, 400, 'Asked of the director.'),
    i('note.notebook_max_words', 'note', 'Notebook length: max words', 140, 20, 600, 'Asked of the director. The whole note is still capped by Injection → Word cap.'),
    i('note.min_valid_words', 'note', 'Shortest usable notebook (words)', 12, 1, 200, 'A notebook shorter than this counts as missing (terse lines are used instead).', { advanced: true }),
    i('note.notebook_priority', 'note', 'Notebook priority', 90, 0, 200, 'Priority of the notebook against the word cap (higher = kept longer).', { advanced: true }),
    { key: 'note.follow', group: 'note', label: 'Lines that follow the notebook', type: 'list', default: [...INJECT_DEFAULTS.notebookFollow], options: SECTION_OPTIONS,
        help: 'Which terse sections are still added after the notebook (the notebook itself covers beat, minds, event, off-screen and avoid).' },
    t('note.label_now', 'note', 'Notebook label: clock', INJECT_DEFAULTS.notebookLabels.now, 'Casual prefix for the clock line in notebook style.', { advanced: true }),
    t('note.label_here', 'note', 'Notebook label: who is here', INJECT_DEFAULTS.notebookLabels.here, '', { advanced: true }),
    t('note.label_facts', 'note', 'Notebook label: facts', INJECT_DEFAULTS.notebookLabels.facts, '', { advanced: true }),
    t('note.label_prose', 'note', 'Notebook label: tic corrections', INJECT_DEFAULTS.notebookLabels.prose, '', { advanced: true }),
    t('note.label_intimacy', 'note', 'Notebook label: intimacy', INJECT_DEFAULTS.notebookLabels.intimacy, '', { advanced: true }),

    // ---- Director
    sel('director.prompt_style', 'director', 'Director prompt voice', 'voiced', [{ value: 'voiced', label: 'Voiced (the narrator persona backstage)' }, { value: 'plain', label: 'Plain (neutral showrunner)' }],
        'Voiced writes the director\'s instructions in the active narrator persona\'s own loud backstage voice (same rules, still strict JSON). The invisible author always gets the plain prompt.'),
    ta('director.extra_instructions', 'director', 'Extra director instructions', '', 'Appended to the director prompt as "Additional instructions from the author". Keep them about the world, never about {{user}}\'s choices.', { rows: 4 }),
    sel('director.pacing_bias', 'director', 'Preferred pacing', 'auto', [{ value: 'auto', label: 'Auto (director decides)' }, ...PACING.map(p => ({ value: p, label: p }))], 'Tells the director which pacing to prefer unless the scene needs another.'),
    b('director.include_taste', 'director', 'Use persona / tone / genre taste', true, 'Flavor the director with the preset\'s narrator persona, tone, genre lens and favored beat types.'),
    b('director.include_pronoun', 'director', 'Pass the {{user}} pronoun rule', true, 'From the preset\'s pronoun toggle.'),
    b('director.include_cast', 'director', 'Show the director the card', true, 'The <cast> block (character card + persona).'),
    b('director.include_continuity', 'director', 'Show the director the state summary', true, 'The <continuity> block (characters, facts, threads, arcs).'),
    b('director.include_recent', 'director', 'Show the director recent messages', true, 'The <recent> transcript (length under Context budgets).'),
    b('director.include_used_beats', 'director', 'List recently used beats', true, 'So the director does not repeat itself.'),
    b('director.include_tic_notes', 'director', 'Pass tic-guard findings', true, 'The writer\'s recent tics, so the plan steers away from them.'),
    b('director.include_last_beat', 'director', 'Show the previous beat', true),
    b('director.include_goals', 'director', 'Show the director the story goals', true, 'The <goals> block from Goals & Tasks (advance them through the world, never through {{user}}).'),
    b('director.include_rule_hints', 'director', 'Pass Chance-rule hints', true, 'Director hints fired by your Chance rules this turn.'),
    i('director.max_rule_hints', 'director', 'Rule hints shown', 3, 0, 10, '', { advanced: true }),
    i('director.rule_hint_chars', 'director', 'Rule hint length (chars)', 200, 20, 1000, '', { advanced: true }),
    i('director.max_social', 'director', 'Max characters in "social"', 6, 0, 30),
    i('director.max_drivers', 'director', 'Max drivers per plan', 2, 0, 10, 'Planted agendas / objects / people / deadlines.'),
    i('director.max_npc_moves', 'director', 'Max NPC moves per plan', 3, 0, 12),
    i('director.max_offscreen', 'director', 'Max off-screen threads per plan', 3, 0, 12),
    i('director.max_avoid', 'director', 'Max avoid items per plan', 5, 0, 20),
    i('director.used_beats_shown', 'director', 'Used beats shown', 6, 0, 30, 'How many recent beats the director is told not to repeat (how many are remembered: Memory limits → Used beats).'),
    i('director.tic_notes_shown', 'director', 'Tic notes shown', 3, 0, 10),
    i('director.beat_favor_max', 'director', 'Favored beat types listed', 6, 0, 20, '', { advanced: true }),
    i('director.used_beat_chars', 'director', 'Used beat length (chars)', 80, 20, 400, '', { advanced: true }),
    i('director.nudge_chars', 'director', '/uc-direct note length (chars)', 400, 40, 2000, '', { advanced: true }),
    i('director.last_beat_chars', 'director', 'Previous beat length (chars)', 160, 20, 1000, '', { advanced: true }),
    i('director.context_chars', 'director', 'Plan context length (chars)', 400, 40, 2000, '', { advanced: true }),
    i('director.beat_chars', 'director', 'Plan beat length (chars)', 400, 40, 2000, '', { advanced: true }),
    i('director.event_chars', 'director', 'Plan event length (chars)', 300, 40, 2000, '', { advanced: true }),
    i('director.avoid_chars', 'director', 'Avoid item length (chars)', 120, 20, 600, '', { advanced: true }),
    i('director.notebook_chars', 'director', 'Notebook length cap (chars)', 1400, 100, 6000, '', { advanced: true }),

    // ---- Events
    n('events.drama', 'events', 'Drama', 1, 0, 5, 0.1, '0 = no random events · 1 = default · 2 = twice as eventful. Clamped to the drama ceiling.', { ui: 'slider' }),
    n('events.drama_max', 'events', 'Drama ceiling', EVENTS_DEFAULTS.dramaMax, 0.5, 5, 0.1, 'Highest effective drama value.', { advanced: true }),
    ...EVENT_KINDS.map(k => b(`events.enable_${k}`, 'events', `${KIND_LABEL[k]} events`, true, { pulse: 'Ambient life in the scene.', twist: 'Complications and reversals.', curiosity: 'Mysteries and questions planted.' }[k])),
    ...EVENT_KINDS.map(k => n(`events.base_${k}`, 'events', `${KIND_LABEL[k]} base chance`, EVENTS_DEFAULTS.base[k], 0, 1, 0.01, 'Per-turn chance at drama 1, before lens biases.')),
    ...EVENT_KINDS.map(k => i(`events.cooldown_${k}`, 'events', `${KIND_LABEL[k]} cooldown (turns)`, EVENTS_DEFAULTS.cooldown[k], 0, 100)),
    ...EVENT_KINDS.map(k => n(`events.stall_boost_${k}`, 'events', `${KIND_LABEL[k]} stall boost`, EVENTS_DEFAULTS.stallBoost[k], 0, 10, 0.1, 'Chance multiplier while the story is stalled.', { advanced: true })),
    n('events.max_chance', 'events', 'Max chance per kind', EVENTS_DEFAULTS.maxChance, 0, 1, 0.01, 'Ceiling after drama and biases.'),
    i('events.min_gap', 'events', 'Minimum turns between events', EVENTS_DEFAULTS.minGap, 0, 50),
    b('events.one_per_turn', 'events', 'At most one event per turn', true, 'Off: every kind that rolls under its chance fires together.'),
    b('events.use_lens_bias', 'events', 'Apply persona / tone / genre event biases', true),
    { key: 'events.suppressed_modes', group: 'events', label: 'No events in these scenes', type: 'list', default: [...EVENTS_DEFAULTS.suppressedModes], options: SCENE_MODES.map(m => ({ value: m, label: m })), help: 'Scene modes (recorded by the scribe) in which no random event fires.' },
    i('events.content_chars', 'events', 'Stored event length (chars)', EVENTS_DEFAULTS.contentChars, 20, 2000, '', { advanced: true }),

    // ---- Injection
    sel('inject.placement', 'inject', 'Placement', 'note', [{ value: 'note', label: 'Note (one system note in the chat)' }, { value: 'macros', label: 'Macros (preset blocks pull {{uc_*}} macros)' }],
        'Note: one note at the depth below. Macros: no note; your preset places {{uc_note}}, {{uc_beat}}, {{uc_minds}}, {{uc_intimacy}}, {{uc_facts}}, {{uc_scene}}, {{uc_tics}}, {{uc_goals}}, {{uc_sparks}} wherever it wants. The macros are empty in Note placement, so nothing is ever injected twice.'),
    i('inject.max_words', 'inject', 'Word cap', INJECT_DEFAULTS.maxWords, 20, 3000, 'Hard cap on the note; lowest-priority lines are dropped first.'),
    i('inject.depth', 'inject', 'Depth', 1, 0, 100, 'In-chat depth of the note (1 = right before your latest message).'),
    sel('inject.role', 'inject', 'Role', 'system', ['system', 'user', 'assistant'], 'Message role of the note.'),
    sel('inject.position', 'inject', 'Position', 'in_chat', [{ value: 'in_chat', label: 'In chat (at depth)' }, { value: 'in_prompt', label: 'After the story string' }, { value: 'before_prompt', label: 'Before the story string' }], '', { advanced: true }),
    b('inject.scan', 'inject', 'Let World Info scan the note', false, '', { advanced: true }),
    t('inject.wrapper_tag', 'inject', 'Wrapper tag', INJECT_DEFAULTS.wrapperTag, 'The note is wrapped in <tag>…</tag>. The Undercurrent preset expects "undercurrent". Empty = no wrapper.'),
    t('inject.bullet', 'inject', 'Line bullet', INJECT_DEFAULTS.bullet, '', { advanced: true }),
    i('inject.line_chars', 'inject', 'Max line length (chars)', INJECT_DEFAULTS.lineChars, 40, 4000, '', { advanced: true }),
    { key: 'inject.order', group: 'inject', label: 'Section order', type: 'list', default: [...INJECT_SECTIONS], options: SECTION_OPTIONS, ui: 'order', help: 'Order of the lines in the note. Sections missing from the list go last.' },
    ...INJECT_SECTIONS.map(s => b(`inject.show_${s}`, 'inject', `Show: ${SECTION_LABEL[s]}`, true)),
    ...Object.keys(INJECT_DEFAULTS.pri).map(k => i(`inject.pri_${k}`, 'inject', `Priority: ${PRI_LABEL[k] || k}`, INJECT_DEFAULTS.pri[k], 0, 200, 'Higher = kept longer when the word cap is reached.', { advanced: true })),
    i('inject.max_npcs', 'inject', 'Max NPCs listed', 0, 0, 40, 'NPC-mind lines for at most this many characters present. 0 = all.'),
    i('inject.max_facts', 'inject', 'Max facts', INJECT_DEFAULTS.maxFacts, 0, 30, 'Most relevant open facts per note.'),
    i('inject.max_facts_impersonate', 'inject', 'Max facts (impersonation)', INJECT_DEFAULTS.maxFactsImpersonate, 0, 30),
    i('inject.max_offscreen', 'inject', 'Max off-screen threads', INJECT_DEFAULTS.maxOffscreen, 0, 12),
    i('inject.max_avoid', 'inject', 'Max avoid items', INJECT_DEFAULTS.maxAvoid, 0, 20),
    i('inject.max_tics', 'inject', 'Max tic corrections', INJECT_DEFAULTS.maxTics, 0, 10),
    i('inject.nudge_chars', 'inject', '/uc-direct note length in the note (chars)', INJECT_DEFAULTS.nudgeChars, 20, 2000, '', { advanced: true }),
    b('inject.assume_char_present', 'inject', 'Assume {{char}} is present', true, 'Until the scribe records who is here, treat {{char}} as present.'),
    b('inject.pacing_in_beat', 'inject', 'Pacing inside the beat line', true, '', { advanced: true }),
    sel('inject.intimacy_when', 'inject', 'Intimacy lines appear', 'auto', [{ value: 'auto', label: 'Intimate scene or live attraction' }, { value: 'intimate', label: 'Intimate scenes only' }, { value: 'always', label: 'Whenever the character is present' }, { value: 'never', label: 'Never' }]),
    b('inject.intimacy_history', 'inject', 'Last intimate event in intimate scenes', true),
    sel('inject.impersonate', 'inject', 'On impersonation', 'facts', [{ value: 'facts', label: 'World facts only' }, { value: 'none', label: 'No note' }], 'Impersonation never gets director beats.'),
    sel('inject.on_continue', 'inject', 'On continue', 'reuse', [{ value: 'reuse', label: 'Reuse the last note' }, { value: 'rebuild', label: 'Rebuild without a beat' }, { value: 'none', label: 'No note' }], '', { advanced: true }),
    ...Object.keys(INJECT_DEFAULTS.labels).map(k => t(`inject.label_${k}`, 'inject', `Label: ${k.replace('_', ' ')}`, INJECT_DEFAULTS.labels[k], LABEL_HELP[k] || '', { advanced: true })),
    ...Object.keys(INJECT_DEFAULTS.pacingText).map(k => t(`inject.pacing_${k}`, 'inject', `Pacing text: ${k}`, INJECT_DEFAULTS.pacingText[k], '', { advanced: true })),

    // ---- Scribe
    ta('scribe.extra_instructions', 'scribe', 'Extra scribe instructions', '', 'Added to the scribe rules, one bullet per line.', { rows: 3 }),
    i('scribe.max_ops', 'scribe', 'Max ops per reply', SCRIBE_DEFAULTS.maxOps, 0, 64),
    ...PATH_GROUPS.map(g => b(`scribe.record_${g.id}`, 'scribe', `Record: ${g.label}`, true, PATH_HELP[g.id] || '')),
    ...PORT_RECORD_GROUPS.map(g => b(`scribe.record_${g.id}`, 'scribe', `Record: ${g.label}`, true, g.id === 'clothing' ? 'Clothing state per character during intimate scenes (scene_intimacy.wardrobe). Physical continuity only.' : 'A native port engine\'s recordable paths (also needs that engine on).')),
    b('scribe.verify_quotes', 'scribe', 'Verify evidence quotes', true, 'Intimacy evidence quotes must really appear in the reply or your message. Off: any quote is accepted.'),
    b('scribe.include_pronoun', 'scribe', 'Pass the {{user}} pronoun rule', true),
    b('scribe.include_cast', 'scribe', 'Show the scribe the card', true),
    b('scribe.include_record', 'scribe', 'Show the scribe the current record', true),
    b('scribe.include_earlier', 'scribe', 'Show the scribe earlier messages', true),
    i('scribe.inreply_depth', 'scribe', 'In-reply instruction depth', 0, 0, 50, 'Depth of the in-reply record instruction (in-reply mode).', { advanced: true }),
    sel('scribe.inreply_role', 'scribe', 'In-reply instruction role', 'system', ['system', 'user', 'assistant'], '', { advanced: true }),

    // ---- Intimacy
    b('intimacy.enabled', 'intimacy', 'Intimacy engine', true, 'Per-character sexual personality, preferences and hard limits; changes only on in-story evidence. Off: no intimacy ops accepted, no intimacy lines.'),
    b('intimacy.seed', 'intimacy', 'Seed profiles from the card', true, 'Read the character card once per chat to seed orientation, style, preferences and limits.'),
    i('intimacy.seed_max_attempts', 'intimacy', 'Seed attempts', 2, 0, 10, 'Give up seeding after this many failed reads.'),
    b('intimacy.seed_include_examples', 'intimacy', 'Seed reads example dialogue', true),
    b('intimacy.seed_include_scenario', 'intimacy', 'Seed reads the scenario', true),
    i('intimacy.max_inferred', 'intimacy', 'Max inferred preferences', INTIMACY_DEFAULTS.maxInferred, 0, 16, 'Preferences the seed may infer from personality (not stated in the card).'),
    b('intimacy.require_quotes', 'intimacy', 'Evidence needs a quote', true, 'Preferences and limits change only with a quoted line from the story. Off: the scribe\'s word is enough (limits still drop only by explicit in-story choice).'),
    b('intimacy.phase_tracking', 'intimacy', 'Track relationship phase', true, 'first time / new / established / tension / reunion.'),
    b('intimacy.attraction_tracking', 'intimacy', 'Track unacted attraction', true),
    i('intimacy.attraction_live_turns', 'intimacy', 'Attraction stays live (turns)', INTIMACY_DEFAULTS.attractionLiveTurns, 0, 200),
    i('intimacy.history_live_turns', 'intimacy', 'Recent intimacy stays live (turns)', INTIMACY_DEFAULTS.historyLiveTurns, 0, 200),
    i('intimacy.max_likes_shown', 'intimacy', 'Likes shown in the note', INTIMACY_DEFAULTS.maxLikesShown, 0, 24),
    i('intimacy.max_prefs', 'intimacy', 'Max preferences stored', INTIMACY_DEFAULTS.maxPrefs, 1, 200, '', { advanced: true }),
    i('intimacy.max_limits', 'intimacy', 'Max limits stored', INTIMACY_DEFAULTS.maxLimits, 1, 200, '', { advanced: true }),
    i('intimacy.max_history', 'intimacy', 'Max history entries', INTIMACY_DEFAULTS.maxHistory, 1, 200, '', { advanced: true }),
    i('intimacy.max_evidence', 'intimacy', 'Evidence quotes kept per preference', INTIMACY_DEFAULTS.maxEvidence, 1, 50, '', { advanced: true }),
    i('intimacy.seed_max_prefs', 'intimacy', 'Seed: preferences read', INTIMACY_DEFAULTS.seedMaxPrefs, 0, 100, '', { advanced: true }),
    i('intimacy.seed_max_limits', 'intimacy', 'Seed: limits read', INTIMACY_DEFAULTS.seedMaxLimits, 0, 100, '', { advanced: true }),
    i('intimacy.seed_max_history', 'intimacy', 'Seed: history entries read', INTIMACY_DEFAULTS.seedMaxHistory, 0, 100, '', { advanced: true }),

    // ---- Tic guard
    b('ticguard.enabled', 'ticguard', 'Tic guard', true, 'Code-only repetition, slop, echo, mind-read, opening and stall detection with short, escalating corrections.'),
    b('ticguard.detect_repeats', 'ticguard', 'Detect repeated phrases', true),
    b('ticguard.detect_slop', 'ticguard', 'Detect slop phrases', true),
    b('ticguard.detect_echo', 'ticguard', 'Detect echoing your words', true),
    b('ticguard.detect_mindread', 'ticguard', 'Detect reactions to your *private thoughts*', true),
    b('ticguard.detect_opening', 'ticguard', 'Detect repeated openings', true),
    b('ticguard.detect_samey', 'ticguard', 'Detect near-identical replies', true),
    sel('ticguard.slop_profile', 'ticguard', 'Slop list', 'auto', PROFILE_OPTIONS, 'Which model\'s slop list to use (the common list is always included unless None).'),
    { key: 'ticguard.custom_bans', group: 'ticguard', label: 'Your banned phrases', type: 'list', default: [], help: 'One per line; merged with the model slop list. Wrap in /slashes/ for a regular expression.' },
    { key: 'ticguard.custom_slop', group: 'ticguard', label: 'Custom slop entries (JSON)', type: 'json', default: [], help: 'Advanced: [{"pattern":"…","kind":"phrase|regex","note":"…","min":1}] — min > 1 needs that many hits across recent replies.', advanced: true, rows: 4 },
    i('ticguard.stall_turns', 'ticguard', 'Stall after (turns)', 4, 2, 50, 'Turns without a new fact, place, time or character that count as a stall.'),
    i('ticguard.window', 'ticguard', 'Replies compared', 4, 1, 20, 'How many previous replies repetition is checked against.'),
    i('ticguard.ngram_min', 'ticguard', 'Shortest repeated phrase (words)', TICGUARD_DEFAULTS.ngramMin, 2, 10),
    i('ticguard.ngram_max', 'ticguard', 'Longest repeated phrase (words)', TICGUARD_DEFAULTS.ngramMax, 2, 12),
    i('ticguard.repeat_threshold', 'ticguard', 'Repeated phrases before flagging', TICGUARD_DEFAULTS.repeatMinPhrases, 1, 10),
    i('ticguard.max_repeats', 'ticguard', 'Repeated phrases collected', TICGUARD_DEFAULTS.maxRepeats, 1, 20, '', { advanced: true }),
    i('ticguard.echo_min_words', 'ticguard', 'Echo threshold (words)', TICGUARD_DEFAULTS.echoMinWords, 2, 20, 'A span of your spoken words this long repeated in the reply counts as an echo.'),
    i('ticguard.echo_max_words', 'ticguard', 'Longest echo checked (words)', TICGUARD_DEFAULTS.echoMaxWords, 2, 40, '', { advanced: true }),
    i('ticguard.mindread_min_words', 'ticguard', 'Mind-read threshold (words)', TICGUARD_DEFAULTS.mindreadMinWords, 2, 10),
    i('ticguard.opening_window', 'ticguard', 'Opening-repeat window (replies)', TICGUARD_DEFAULTS.openingWindow, 1, 10),
    i('ticguard.opening_words', 'ticguard', 'Opening words compared', TICGUARD_DEFAULTS.openingWords, 1, 10, '', { advanced: true }),
    i('ticguard.opening_class_run', 'ticguard', 'Same opening type in a row', TICGUARD_DEFAULTS.openingClassRun, 0, 10, 'Flag when this many recent replies open the same way (dialogue / thought). 0 = off.', { advanced: true }),
    n('ticguard.samey_threshold', 'ticguard', 'Near-identical threshold', TICGUARD_DEFAULTS.sameyThreshold, 0, 1, 0.05, 'Content-word overlap with the previous reply that counts as near-identical.'),
    i('ticguard.slop_recent', 'ticguard', 'Replies counted for weak slop', TICGUARD_DEFAULTS.slopRecent, 0, 10, '', { advanced: true }),
    n('ticguard.decay', 'ticguard', 'Tic memory decay per clean reply', TICGUARD_DEFAULTS.decay, 0, 5, 0.1, '', { advanced: true }),
    i('ticguard.counts_max', 'ticguard', 'Tics remembered', TICGUARD_DEFAULTS.countsMax, 1, 500, '', { advanced: true }),
    i('ticguard.max_level', 'ticguard', 'Highest escalation level', TICGUARD_DEFAULTS.maxLevel, 1, 3, '1 = nudge, 2 = firm, 3 = hard ban.'),
    i('ticguard.level2_streak', 'ticguard', 'Firm after (dirty replies in a row)', TICGUARD_DEFAULTS.level2Streak, 1, 20),
    i('ticguard.level3_streak', 'ticguard', 'Hard ban after (dirty replies in a row)', TICGUARD_DEFAULTS.level3Streak, 1, 20),
    i('ticguard.max_lines', 'ticguard', 'Max correction lines', TICGUARD_DEFAULTS.maxLines, 0, 10),
    i('ticguard.slop_items_soft', 'ticguard', 'Slop items named (nudge)', TICGUARD_DEFAULTS.slopItemsSoft, 1, 10, '', { advanced: true }),
    i('ticguard.slop_items_firm', 'ticguard', 'Slop items named (firm / ban)', TICGUARD_DEFAULTS.slopItemsFirm, 1, 10, '', { advanced: true }),
    i('ticguard.repeat_items', 'ticguard', 'Repeated phrases named', TICGUARD_DEFAULTS.repeatItems, 1, 10, '', { advanced: true }),
    t('ticguard.verb_1', 'ticguard', 'Escalation word: nudge', TICGUARD_DEFAULTS.verbs[1]),
    t('ticguard.verb_2', 'ticguard', 'Escalation word: firm', TICGUARD_DEFAULTS.verbs[2]),
    t('ticguard.verb_3', 'ticguard', 'Escalation word: hard ban', TICGUARD_DEFAULTS.verbs[3]),

    // ---- Context budgets
    i('context.director_messages', 'context', 'Director: recent messages', 12, 0, 100),
    i('context.director_message_chars', 'context', 'Director: chars per message', 1400, 100, 20000),
    i('context.scribe_messages', 'context', 'Scribe: earlier messages', 4, 0, 50),
    i('context.scribe_message_chars', 'context', 'Scribe: chars per message', 900, 100, 20000),
    i('context.desc_chars', 'context', 'Director: card description (chars)', CARD_DEFAULTS.descChars, 0, 50000),
    i('context.scribe_desc_chars', 'context', 'Scribe: card description (chars)', 1200, 0, 50000),
    i('context.personality_chars', 'context', 'Card personality (chars)', CARD_DEFAULTS.personalityChars, 0, 20000),
    i('context.scenario_chars', 'context', 'Card scenario (chars)', CARD_DEFAULTS.scenarioChars, 0, 20000),
    i('context.persona_chars', 'context', 'Your persona description (chars)', CARD_DEFAULTS.personaChars, 0, 20000),
    i('context.examples_chars', 'context', 'Example dialogue for the seed (chars)', 1200, 0, 20000),
    b('context.include_description', 'context', 'Include the card description', true),
    b('context.include_personality', 'context', 'Include the card personality', true),
    b('context.include_scenario', 'context', 'Include the scenario', true),
    b('context.include_persona', 'context', 'Include your persona description', true),
    i('context.state_max_facts', 'context', 'Facts in the state summary', 15, 0, 200),
    i('context.state_max_characters', 'context', 'Characters in the state summary', 14, 0, 200),

    // ---- Memory limits
    i('state.facts', 'state', 'Open facts kept', LIMITS_DEFAULTS.facts, 1, 1000),
    i('state.closed_keep_turns', 'state', 'Closed items kept for (turns)', LIMITS_DEFAULTS.closedKeepTurns, 0, 1000),
    i('state.char_list', 'state', 'Items per character list', LIMITS_DEFAULTS.charList, 1, 200),
    i('state.threads', 'state', 'Threads per list', LIMITS_DEFAULTS.threads, 1, 200),
    i('state.used_beats', 'state', 'Used beats remembered', LIMITS_DEFAULTS.usedBeats, 1, 500, 'The director\'s beat memory.'),
    i('state.characters', 'state', 'Characters tracked', LIMITS_DEFAULTS.characters, 1, 500),
    i('state.ledger', 'state', 'Ledger entries', LIMITS_DEFAULTS.ledger, 1, 1000, 'Recorded batches (for rollback on edit/swipe/delete).'),
    i('state.snapshots', 'state', 'Snapshots kept', LIMITS_DEFAULTS.snapshots, 1, 500, 'How far back an edit can roll state back.'),
    i('state.swipe_cache', 'state', 'Swipe cache size', LIMITS_DEFAULTS.swipeCache, 0, 200, 'Batches remembered for swiping back.'),
    i('state.events_history', 'state', 'Event history length', LIMITS_DEFAULTS.eventsHistory, 1, 1000),
    i('state.ops_per_batch', 'state', 'Ops applied per batch', LIMITS_DEFAULTS.opsPerBatch, 1, 500, '', { advanced: true }),

    // ---- Prompt templates (empty = built-in)
    tpl('director.system_template', 'Director system prompt', '', 'Empty = the built-in prompt for the director prompt voice (voiced or plain). Must still ask for the JSON plan.', DIRECTOR_PLACEHOLDERS,
        { builtin: v => builtinDirectorTemplate(v?.['director.prompt_style'] === 'plain' ? 'plain' : 'voiced'), rows: 16 }),
    tpl('note.notebook_spec', 'Director: notebook instructions', '', 'Empty = built-in (voiced or plain). Used only in notebook note style.', [
        { name: 'uc_notebook_min', help: 'Min words (knob note.notebook_min_words).' }, { name: 'uc_notebook_max', help: 'Max words (knob note.notebook_max_words).' },
        { name: 'uc_persona_name', help: 'Narrator persona name.' }, { name: 'uc_notebook_extra', help: 'Extra wildness line for the most chaotic personas, or empty.' },
    ], { builtin: v => builtinNotebookSpec(v?.['director.prompt_style'] === 'plain' ? 'plain' : 'voiced'), rows: 6 }),
    tpl('director.stall_text', 'Director: stall signal', DIRECTOR_DEFAULTS.stallText, 'Told to the director when the story has stalled.', [{ name: 'uc_stall_turns', help: 'Stall threshold in turns.' }], { rows: 3 }),
    tpl('director.scene_hint_romantic', 'Director: romantic scene hint', DIRECTOR_DEFAULTS.sceneHints.romantic, 'Told to the director while the scene mode is "romantic".', [], { rows: 2 }),
    tpl('director.scene_hint_flirt', 'Director: flirt scene hint', DIRECTOR_DEFAULTS.sceneHints.flirt, 'Told to the director while the scene mode is "flirt".', [], { rows: 2 }),
    tpl('director.final_instruction', 'Director: closing instruction', DIRECTOR_DEFAULTS.finalInstruction, 'Last line of the director\'s input.', [], { rows: 3 }),
    tpl('scribe.system_template', 'Scribe system prompt', SCRIBE_TEMPLATE, 'The continuity clerk\'s instructions.', SCRIBE_PLACEHOLDERS, { rows: 16 }),
    tpl('scribe.inreply_template', 'In-reply record instruction', INREPLY_TEMPLATE, 'Depth-0 instruction in in-reply mode.', INREPLY_PLACEHOLDERS),
    tpl('scribe.final_instruction', 'Scribe: closing instruction', SCRIBE_DEFAULTS.finalInstruction, '', [], { rows: 2 }),
    tpl('intimacy.seed_template', 'Intimacy seed prompt', SEED_TEMPLATE, 'One-time card read for each character\'s intimacy profile.', SEED_PLACEHOLDERS),
    ...EVENT_KINDS.map(k => tpl(`events.fallback_${k}`, `Event fallback: ${k}`, EVENTS_DEFAULTS.fallback[k], 'Used in the note when the director could not describe the event.', [], { rows: 3 })),
    ...EVENT_KINDS.map(k => tpl(`events.help_${k}`, `Event meaning for the director: ${k}`, EVENTS_DEFAULTS.directorHelp[k], 'How the director is told what this event kind means.', [], { rows: 2 })),
    tpl('inject.stall_text', 'Note: stall line', INJECT_DEFAULTS.stallText, 'Added when the story idles and there is no fresh beat.', [], { rows: 2 }),
    ...Object.keys(TICGUARD_DEFAULTS.text).map(k => tpl(`ticguard.text_${k.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)}`, `Tic correction: ${k.replace(/([A-Z])/g, ' $1').toLowerCase()}`, TICGUARD_DEFAULTS.text[k], '', TIC_TEXT_PLACEHOLDERS, { rows: 2 })),
];

let registered = false;
/** Register the core groups and knobs once (idempotent). */
export function registerCoreKnobs() {
    if (registered) return { added: [], rejected: [] };
    registerGroups(CORE_GROUPS);
    const r = registerKnobs(CORE_KNOBS, { source: 'core' });
    registered = true;
    return r;
}

// ---------------------------------------------------------------------------------------------------------------------
// Resolved values -> engine configs

const tx = (v, def) => (typeof v === 'string' && v.trim() ? v : def);

/** Config objects for every engine, from flat resolved knob values (see knobs.resolve). */
export function moduleConfigs(v) {
    const per = (prefix, kinds = EVENT_KINDS) => Object.fromEntries(kinds.map(k => [k, v[`${prefix}${k}`]]));
    const events = {
        base: per('events.base_'), cooldown: per('events.cooldown_'), stallBoost: per('events.stall_boost_'),
        maxChance: v['events.max_chance'], minGap: v['events.min_gap'], dramaMax: v['events.drama_max'],
        onePerTurn: v['events.one_per_turn'], useLensBias: v['events.use_lens_bias'], suppressedModes: v['events.suppressed_modes'],
        historyLen: v['state.events_history'], contentChars: v['events.content_chars'],
        fallback: Object.fromEntries(EVENT_KINDS.map(k => [k, tx(v[`events.fallback_${k}`], EVENTS_DEFAULTS.fallback[k])])),
        directorHelp: Object.fromEntries(EVENT_KINDS.map(k => [k, tx(v[`events.help_${k}`], EVENTS_DEFAULTS.directorHelp[k])])),
    };
    const director = {
        promptStyle: v['director.prompt_style'], systemTemplate: v['director.system_template'], extraInstructions: v['director.extra_instructions'],
        noteStyle: v['note.style'], notebookMin: v['note.notebook_min_words'], notebookMax: v['note.notebook_max_words'], notebookChars: v['director.notebook_chars'],
        notebookSpec: v['note.notebook_spec'],
        includeTaste: v['director.include_taste'], includePronoun: v['director.include_pronoun'], beatFavorMax: v['director.beat_favor_max'],
        includeCast: v['director.include_cast'], includeContinuity: v['director.include_continuity'], includeRecent: v['director.include_recent'],
        includeUsedBeats: v['director.include_used_beats'], includeTicNotes: v['director.include_tic_notes'], includeLastBeat: v['director.include_last_beat'],
        usedBeatsShown: v['director.used_beats_shown'], usedBeatChars: v['director.used_beat_chars'], ticNotesShown: v['director.tic_notes_shown'],
        nudgeChars: v['director.nudge_chars'], lastBeatChars: v['director.last_beat_chars'], pacingBias: v['director.pacing_bias'],
        includeGoals: v['director.include_goals'], includeRuleHints: v['director.include_rule_hints'],
        maxRuleHints: v['director.max_rule_hints'], ruleHintChars: v['director.rule_hint_chars'],
        sceneHints: { romantic: tx(v['director.scene_hint_romantic'], DIRECTOR_DEFAULTS.sceneHints.romantic), flirt: tx(v['director.scene_hint_flirt'], DIRECTOR_DEFAULTS.sceneHints.flirt) },
        stallText: tx(v['director.stall_text'], DIRECTOR_DEFAULTS.stallText), finalInstruction: tx(v['director.final_instruction'], DIRECTOR_DEFAULTS.finalInstruction),
        eventHelp: events.directorHelp,
        maxSocial: v['director.max_social'], maxDrivers: v['director.max_drivers'], maxNpcMoves: v['director.max_npc_moves'],
        maxOffscreen: v['director.max_offscreen'], maxAvoid: v['director.max_avoid'],
        contextChars: v['director.context_chars'], beatChars: v['director.beat_chars'], eventChars: v['director.event_chars'], avoidChars: v['director.avoid_chars'],
    };
    const scribe = {
        systemTemplate: tx(v['scribe.system_template'], SCRIBE_TEMPLATE), inreplyTemplate: tx(v['scribe.inreply_template'], INREPLY_TEMPLATE),
        extraInstructions: v['scribe.extra_instructions'], maxOps: v['scribe.max_ops'], includePronoun: v['scribe.include_pronoun'],
        includeCast: v['scribe.include_cast'], includeRecord: v['scribe.include_record'], includeEarlier: v['scribe.include_earlier'],
        finalInstruction: tx(v['scribe.final_instruction'], SCRIBE_DEFAULTS.finalInstruction),
        record: Object.fromEntries([...PATH_GROUPS, ...PORT_RECORD_GROUPS].map(g => [g.id, v[`scribe.record_${g.id}`]])),
        phaseTracking: v['intimacy.phase_tracking'], attractionTracking: v['intimacy.attraction_tracking'],
    };
    // Native port engines add their recordable paths to the scribe's list (clothing has its own switch).
    scribe.extraPathLines = v['ports.enabled'] === false ? [] : portScribePathGuide({ knobs: v, intimacy: v['intimacy.enabled'], record: scribe.record })
        .filter(l => scribe.record.clothing !== false || !l.includes('scene_intimacy.wardrobe'));
    const intimacy = {
        maxPrefs: v['intimacy.max_prefs'], maxLimits: v['intimacy.max_limits'], maxHistory: v['intimacy.max_history'], maxEvidence: v['intimacy.max_evidence'],
        requireQuotes: v['intimacy.require_quotes'], verifyQuotes: v['scribe.verify_quotes'],
        phaseTracking: v['intimacy.phase_tracking'], attractionTracking: v['intimacy.attraction_tracking'],
        attractionLiveTurns: v['intimacy.attraction_live_turns'], historyLiveTurns: v['intimacy.history_live_turns'],
        maxInferred: v['intimacy.max_inferred'], seedMaxPrefs: v['intimacy.seed_max_prefs'], seedMaxLimits: v['intimacy.seed_max_limits'],
        seedMaxHistory: v['intimacy.seed_max_history'], maxLikesShown: v['intimacy.max_likes_shown'],
        seedTemplate: tx(v['intimacy.seed_template'], SEED_TEMPLATE),
        seedIncludeExamples: v['intimacy.seed_include_examples'], seedIncludeScenario: v['intimacy.seed_include_scenario'],
    };
    const inject = {
        maxWords: v['inject.max_words'], wrapperTag: v['inject.wrapper_tag'], bullet: v['inject.bullet'], lineChars: v['inject.line_chars'],
        order: v['inject.order'], show: Object.fromEntries(INJECT_SECTIONS.map(s => [s, v[`inject.show_${s}`]])),
        pri: Object.fromEntries(Object.keys(INJECT_DEFAULTS.pri).map(k => [k, v[`inject.pri_${k}`]])),
        maxNpcs: v['inject.max_npcs'], maxFacts: v['inject.max_facts'], maxFactsImpersonate: v['inject.max_facts_impersonate'],
        maxOffscreen: v['inject.max_offscreen'], maxAvoid: v['inject.max_avoid'], maxTics: v['inject.max_tics'], nudgeChars: v['inject.nudge_chars'],
        assumeCharPresent: v['inject.assume_char_present'], pacingInBeat: v['inject.pacing_in_beat'],
        intimacyWhen: v['inject.intimacy_when'], intimacyHistory: v['inject.intimacy_history'],
        labels: Object.fromEntries(Object.keys(INJECT_DEFAULTS.labels).map(k => [k, v[`inject.label_${k}`]])),
        pacingText: Object.fromEntries(Object.keys(INJECT_DEFAULTS.pacingText).map(k => [k, v[`inject.pacing_${k}`]])),
        stallText: tx(v['inject.stall_text'], INJECT_DEFAULTS.stallText),
        style: v['note.style'], notebookMinWords: v['note.min_valid_words'], notebookPri: v['note.notebook_priority'], notebookFollow: v['note.follow'],
        notebookLabels: { now: v['note.label_now'], here: v['note.label_here'], facts: v['note.label_facts'], prose: v['note.label_prose'], intimacy: v['note.label_intimacy'] },
    };
    const ticguard = {
        detect: { repeats: v['ticguard.detect_repeats'], slop: v['ticguard.detect_slop'], echo: v['ticguard.detect_echo'], mindread: v['ticguard.detect_mindread'], opening: v['ticguard.detect_opening'], samey: v['ticguard.detect_samey'] },
        ngramMin: v['ticguard.ngram_min'], ngramMax: v['ticguard.ngram_max'], maxRepeats: v['ticguard.max_repeats'], repeatMinPhrases: v['ticguard.repeat_threshold'],
        echoMinWords: v['ticguard.echo_min_words'], echoMaxWords: v['ticguard.echo_max_words'], mindreadMinWords: v['ticguard.mindread_min_words'],
        openingWindow: v['ticguard.opening_window'], openingWords: v['ticguard.opening_words'], openingClassRun: v['ticguard.opening_class_run'],
        sameyThreshold: v['ticguard.samey_threshold'], slopRecent: v['ticguard.slop_recent'], decay: v['ticguard.decay'], countsMax: v['ticguard.counts_max'],
        maxLevel: v['ticguard.max_level'], level2Streak: v['ticguard.level2_streak'], level3Streak: v['ticguard.level3_streak'], maxLines: v['ticguard.max_lines'],
        slopItemsSoft: v['ticguard.slop_items_soft'], slopItemsFirm: v['ticguard.slop_items_firm'], repeatItems: v['ticguard.repeat_items'],
        verbs: { 1: v['ticguard.verb_1'], 2: v['ticguard.verb_2'], 3: v['ticguard.verb_3'] },
        text: Object.fromEntries(Object.keys(TICGUARD_DEFAULTS.text).map(k => [k, tx(v[`ticguard.text_${k.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)}`], TICGUARD_DEFAULTS.text[k])])),
    };
    const card = {
        personalityChars: v['context.personality_chars'], scenarioChars: v['context.scenario_chars'], personaChars: v['context.persona_chars'],
        includeDescription: v['context.include_description'], includePersonality: v['context.include_personality'],
        includeScenario: v['context.include_scenario'], includePersona: v['context.include_persona'],
    };
    const limits = {
        facts: v['state.facts'], closedKeepTurns: v['state.closed_keep_turns'], charList: v['state.char_list'], threads: v['state.threads'],
        usedBeats: v['state.used_beats'], ledger: v['state.ledger'], snapshots: v['state.snapshots'], characters: v['state.characters'],
        swipeCache: v['state.swipe_cache'], eventsHistory: v['state.events_history'], opsPerBatch: v['state.ops_per_batch'],
    };
    return {
        events, director, scribe, intimacy, inject, ticguard, limits,
        directorCard: { ...card, descChars: v['context.desc_chars'] },
        scribeCard: { ...card, descChars: v['context.scribe_desc_chars'] },
        directorTranscript: { max: v['context.director_messages'], maxChars: v['context.director_message_chars'] },
        scribeTranscript: { max: v['context.scribe_messages'], maxChars: v['context.scribe_message_chars'] },
        summary: { maxFacts: v['context.state_max_facts'], maxCharacters: v['context.state_max_characters'] },
    };
}


// ---------------------------------------------------------------------------------------------------------------------
// Built-in profiles. Profiles only set knob values; loading one resets every other knob (except keepOnProfile ones such
// as Enabled, pause, debug and the hidden-pass connection) to its default first. Nothing here names or describes any
// character or the player: it is pacing, dice and budgets only.

export const BUILTIN_PROFILES = Object.freeze([
    { name: 'Balanced', description: 'The defaults: notebook note, director every turn, moderate events.', values: {} },
    {
        name: 'Quiet & intimate',
        description: 'Few interruptions, lingering pacing, scenes allowed to breathe.',
        values: {
            'events.drama': 0.4, 'events.enable_twist': false, 'events.base_pulse': 0.08, 'events.base_curiosity': 0.05,
            'events.cooldown_pulse': 5, 'events.cooldown_curiosity': 8, 'events.min_gap': 4,
            'events.suppressed_modes': ['intimate', 'grief', 'argument', 'quiet', 'tension'],
            'director.pacing_bias': 'linger', 'director.max_npc_moves': 1, 'director.max_drivers': 1,
            'inject.intimacy_when': 'auto', 'inject.max_npcs': 3,
        },
    },
    {
        name: 'Chaotic',
        description: 'High drama, frequent twists, several events can land at once.',
        values: {
            'events.drama': 2, 'events.drama_max': 3, 'events.base_pulse': 0.16, 'events.base_twist': 0.18, 'events.base_curiosity': 0.12,
            'events.cooldown_pulse': 2, 'events.cooldown_twist': 3, 'events.cooldown_curiosity': 3, 'events.min_gap': 1,
            'events.max_chance': 0.75, 'events.one_per_turn': false, 'events.suppressed_modes': ['intimate', 'grief'],
            'events.stall_boost_pulse': 2, 'events.stall_boost_twist': 2, 'events.stall_boost_curiosity': 1.5,
            'director.pacing_bias': 'advance', 'director.max_drivers': 3, 'director.max_npc_moves': 4,
            'ticguard.stall_turns': 3,
        },
    },
    {
        name: 'Cinematic thriller',
        description: 'Cuts past dead time, pressure from clocks and complications, mysteries planted early.',
        values: {
            'events.drama': 1.4, 'events.base_twist': 0.14, 'events.base_curiosity': 0.12, 'events.cooldown_twist': 4,
            'director.pacing_bias': 'cut', 'director.max_drivers': 3,
            'director.extra_instructions': 'Favor concrete pressure: a deadline, a threat with a source, a plan that can fail. Cut away from dead time. Every scene should end with something unresolved.',
            'ticguard.stall_turns': 3,
        },
    },
    {
        name: 'Slice of life',
        description: 'Ordinary days with texture: small ambient moments, rare twists, gentle pacing.',
        values: {
            'events.drama': 0.8, 'events.base_pulse': 0.18, 'events.base_twist': 0.04, 'events.base_curiosity': 0.06,
            'events.cooldown_twist': 10, 'director.pacing_bias': 'linger',
            'director.extra_instructions': 'Favor routines, errands, small kindnesses and small frictions over big plot. Consequences stay human-sized.',
            'ticguard.stall_turns': 6,
        },
    },
    {
        name: 'Low latency',
        description: 'No director wait before replies: it plans in the background after each reply and only when needed.',
        values: {
            'core.pre_reply': false, 'core.cadence': 'stall', 'hidden.wait_for_scribe_sec': 0,
            'hidden.max_tokens': 700, 'context.director_messages': 8, 'context.scribe_messages': 2,
        },
    },
]);

export function findBuiltinProfile(name) {
    const q = String(name ?? '').trim().toLowerCase();
    return BUILTIN_PROFILES.find(p => p.name.toLowerCase() === q) || null;
}
