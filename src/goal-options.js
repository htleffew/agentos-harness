// Undercurrent — Goals & Tasks runtime options: the knob schema the settings panel renders, defaults, validation and the
// template filler. Pure logic. Every threshold, count, cap, cadence, phrase and prompt the Goals module uses lives here,
// so the user can change any of it at runtime without touching code.
//
// Scopes:
//   "chat"   — stored per chat in state.goals.settings; the global value is the default for chats that have none yet.
//   "global" — stored in extensionSettings.undercurrent (keyed "goals.<name>").
// Effective options for a chat = resolveGoalOptions({...globalValues, ...state.goals.settings}).
//
// Templates use {{placeholders}}. Placeholders not listed for a template are left untouched, so SillyTavern macros such
// as {{user}} and {{char}} pass through and are substituted by SillyTavern later. In multi-line templates, a line whose
// placeholders all come out empty is dropped (so optional lines vanish when there is nothing to say).

import { isPlainObject, clamp } from './util.js';

/** Safety ceilings applied when stored data is normalized (the user-facing caps are knobs below, each <= its ceiling). */
export const HARD_LIMITS = Object.freeze({ goals: 100, tasksPerGoal: 300, depth: 8, title: 500, description: 2000, task: 1000, evidence: 1000, owner: 80, duration: 200 });

const TASKGEN_SYSTEM = `You plan story progress for a long-running interactive story. The player controls {{user}}. Everyone and everything else belongs to the world: {{char}}, every other character, places, objects, weather, institutions, chance.

Turn the goal into an ordered, numbered list of story tasks.

Rules:
1. Every task is something that happens in the story through the world, {{char}} or another character, or a situation that arises. Name who or what acts.
2. Never require, describe or presume {{user}}'s words, actions, thoughts, feelings or choices. Things may happen to {{user}}, or be offered, shown, said or done to {{user}}; how {{user}} responds belongs to the player. A task is complete once the world's part has happened, whatever {{user}} does about it.
3. Extrapolate from who the characters are: the personality, history, wants and limits in the cast notes, and what the persona notes say about {{user}} as others would perceive them. Characters pursue the goal the way they actually would; nobody acts out of character to serve it.
4. Concrete and observable on the page: a reader could point to the line where it happened. No vague tasks ("build tension", "deepen the bond").
5. Sequenced: each task follows from the one before and fits in one to three replies. The last task is the goal achieved, seen from the world's side.
6. Consistent with established facts and with what has already happened. Never repeat or rephrase an existing task.
7. One sentence per task. Refer to {{user}} and {{char}} by name, never by pronoun.

Output only the numbered list, one task per line, in the form "1. task". No heading, no commentary.`;

const TASKGEN_USER = `<cast>
{{cast}}
</cast>

<continuity>
{{continuity}}
</continuity>

<recent>
{{recent}}
</recent>

<goal>
{{goal_block}}
</goal>

<existing_tasks>
{{existing}}
</existing_tasks>

{{ask}} Each task happens through the world, {{char}} or another character; none decides anything for {{user}}. Output only the numbered list.`;

const CHECK_SYSTEM = `You check whether story tasks have already happened in an interactive story. The player controls {{user}}.

For each task, read the recent messages and decide whether the task has CLEARLY HAPPENED on the page.
- done = true only when the text shows it happened. Planned, hinted, promised, imagined, about to happen or half done = false.
- Text marked as {{user}}'s private thought did not happen in the story and never counts.
- Evidence: copy {{evidence_min_words}} to 30 consecutive words EXACTLY as written in the recent messages that show the task happening. No paraphrase, no added words. If done is false, evidence is "".
- Judge each task on its own. When unsure, false.

Return ONLY one JSON object, no prose, no code fence:
{"results":[{"task_id":"<id>","done":true,"evidence":"<verbatim quote>"}]}
with exactly one result per task id given.`;

const CHECK_USER = `<tasks>
{{tasks}}
</tasks>

<recent>
{{recent}}
</recent>

Return the JSON now.`;

const DIRECTOR_HEADER = 'Author-set goals, most pressing first. Plan the beat so the world, NPCs or {{char}} move the most pressing current task forward when it fits the scene (urgency 2–3: this turn). Never advance a goal by deciding {{user}}\'s words, actions, thoughts or choices; things may happen to or around {{user}}, and the response belongs to the player. Never name a goal inside the story.';

const DIRECTOR_GOAL = `{{n}}. [{{owner_tag}} · {{priority}} priority · urgency {{level}}: {{urgency}} · {{done}}/{{total}} done] {{goal_title}}
   About: {{description}}
   Current task ({{turns}} turns on it): {{task}}
   {{no_tasks}}
   After that: {{next}}
   Recently done: {{recent}}`;

const DECIDE_VERBS = ('agree accept decide choose chose say said tell told ask admit confess reveal realize realise feel felt fall fell kiss touch hug go goes went ' +
    'follow leave left stay return answer reply respond think wonder notice see hear find discover learn remember forgive trust love like want need try ' +
    'attempt begin start open take give help join meet visit call write read buy pay sign promise apologize apologise laugh smile cry blush nod refuse ' +
    'reject confront spend must should will would can could become get grow come came arrive enter step walk run sit stand lie lay sleep wake ' +
    'dance sing play eat drink share show hold grab pull push wear put use escape flee fight attack win lose kill save steal hide search ' +
    'investigate explore travel move cook work study ride drive climb swim sneak reach solve convince persuade seduce marry betray kiss').split(' ');
const COERCE_VERBS = 'make made has have get got let force forced convince convinced persuade persuaded manipulate trick tricked compel lead cause'.split(' ');
const ATTEMPT_VERBS = 'try tries trying attempt attempting want wants hope hopes plan plans'.split(' ');
const CHOICE_NOUNS = 'decision choice answer reply consent agreement forgiveness trust love feeling feelings thought thoughts heart resolve'.split(' ');
const CHOICE_ALLOW = 'ask asks asked seek seeks wait waits waiting hope hopes wonder wonders test tests offer offers request requests'.split(' ');

/**
 * The knob schema. key is "goals.<name>"; the options object uses <name>.
 * type: number | bool | select | text | textarea | list. list items are strings unless itemType is "number".
 */
export const GOALS_KNOBS = [
    // Cadence ------------------------------------------------------------------------------------------------------------
    { key: 'goals.enabled', section: 'General', label: 'Goals & Tasks', type: 'bool', default: true, scope: 'global', help: 'Master switch for goals: injection, director brief, checks and task generation.' },
    { key: 'goals.check_every', section: 'Checks', label: 'Check for completed tasks every N replies', type: 'number', default: 3, min: 0, max: 50, step: 1, scope: 'chat', help: 'One batched hidden request checks every active goal\'s current task. 0 = only when you press Check now.' },
    { key: 'goals.swipes_count', section: 'Checks', label: 'Swipes and regenerations count toward the check cadence', type: 'bool', default: false, scope: 'chat', help: 'Off: only new replies to a new player message count.' },
    { key: 'goals.uncounted_types', section: 'Checks', label: 'Reply types that never count', type: 'list', default: ['quiet', 'impersonate', 'continue', 'append', 'appendFinal', 'first_message', 'command', 'extension'], scope: 'global', help: 'SillyTavern MESSAGE_RECEIVED types skipped by the cadence counter, one per line.' },
    { key: 'goals.check_transcript_messages', section: 'Checks', label: 'Messages the check reads', type: 'number', default: 8, min: 1, max: 40, step: 1, scope: 'global', help: 'How many recent chat messages the completion check sees.' },
    { key: 'goals.check_max_tokens', section: 'Checks', label: 'Check response tokens', type: 'number', default: 600, min: 100, max: 4000, step: 50, scope: 'global', help: 'Max tokens for the check reply.' },
    { key: 'goals.check_require_evidence', section: 'Checks', label: 'Require a verbatim quote to auto-complete', type: 'bool', default: true, scope: 'global', help: 'On: a task completes only when the checker quotes the recent messages word for word. Strongly recommended.' },
    { key: 'goals.evidence_min_chars', section: 'Checks', label: 'Minimum evidence length (characters)', type: 'number', default: 12, min: 1, max: 200, step: 1, scope: 'global', help: 'Shorter quotes are rejected.' },
    { key: 'goals.evidence_min_words', section: 'Checks', label: 'Minimum evidence length (words)', type: 'number', default: 3, min: 1, max: 30, step: 1, scope: 'global', help: 'Fewer words are rejected. Also shown to the checker as {{evidence_min_words}}.' },
    { key: 'goals.evidence_fragment_min_chars', section: 'Checks', label: 'Minimum quoted fragment between ellipses', type: 'number', default: 4, min: 1, max: 50, step: 1, scope: 'global', help: 'Quotes may skip text with "…"; fragments shorter than this are ignored.' },
    { key: 'goals.evidence_max_chars', section: 'Checks', label: 'Stored evidence length (characters)', type: 'number', default: 300, min: 40, max: HARD_LIMITS.evidence, step: 10, scope: 'global', help: 'Evidence kept with a completed task.' },
    { key: 'goals.reconcile_window', section: 'Checks', label: 'Re-find moved messages within N positions', type: 'number', default: 8, min: 0, max: 50, step: 1, scope: 'global', help: 'After deletions, a completion\'s evidence message is searched this far before the completion is undone.' },
    { key: 'goals.check_system', section: 'Checks', label: 'Check prompt (system)', type: 'textarea', default: CHECK_SYSTEM, scope: 'global', help: 'Placeholders: {{evidence_min_words}}. {{user}}/{{char}} are SillyTavern macros. Must ask for {"results":[{"task_id","done","evidence"}]}. Empty = default.' },
    { key: 'goals.check_user', section: 'Checks', label: 'Check prompt (message)', type: 'textarea', default: CHECK_USER, scope: 'global', help: 'Placeholders: {{tasks}} (one task line each), {{recent}} (transcript). Empty = default.' },
    { key: 'goals.check_task_line', section: 'Checks', label: 'Check task line', type: 'text', default: '- task_id: {{task_id}} | goal: {{goal_title}} | task: {{task}}', scope: 'global', help: 'Placeholders: {{task_id}}, {{goal_title}}, {{task}}, {{owner}}.' },

    // Injection ----------------------------------------------------------------------------------------------------------
    { key: 'goals.max_active_injected', section: 'Injection', label: 'Goals in the note at most', type: 'number', default: 3, min: 0, max: 10, step: 1, scope: 'chat', help: 'Most urgent first. 0 = goals never enter the note (the director still sees them).' },
    { key: 'goals.inject_completed', section: 'Injection', label: 'Recently completed tasks shown', type: 'number', default: 2, min: 0, max: 10, step: 1, scope: 'chat', help: 'Per goal, in the progress line.' },
    { key: 'goals.inject_upcoming', section: 'Injection', label: 'Upcoming tasks shown', type: 'number', default: 2, min: 0, max: 10, step: 1, scope: 'chat', help: 'Per goal, in the progress line.' },
    { key: 'goals.note_extra_words', section: 'Injection', label: 'Extra words the note may use for goals', type: 'number', default: 120, min: 0, max: 600, step: 10, scope: 'global', help: 'Added to the note\'s word cap when goal lines are present, so goals do not crowd out the beat and world facts.' },
    { key: 'goals.inject_hidden', section: 'Injection', label: 'Hidden goals still steer the story', type: 'bool', default: true, scope: 'global', help: 'Hidden goals are masked in the panel and lists; on = they still reach the private note and the director.' },
    { key: 'goals.header_template', section: 'Injection', label: 'Goals header line', type: 'text', default: 'Goals: advance them through the world, NPCs and {{char}}; never decide {{user}}\'s words, actions, thoughts or choices.', scope: 'global', help: 'First goals line in the note. Empty = no header.' },
    { key: 'goals.line_template', section: 'Injection', label: 'Goal line', type: 'textarea', default: '{{owner_label}} ({{goal_title}}{{priority_note}}) — current task: {{task}}. {{Urgency}}.', scope: 'global', help: 'Placeholders: {{owner_label}}, {{owner}}, {{goal_title}}, {{description}}, {{priority_note}}, {{priority}}, {{task}}, {{urgency}}, {{Urgency}} (capitalized), {{level}}, {{turns}}, {{done}}, {{total}}.' },
    { key: 'goals.line_empty_template', section: 'Injection', label: 'Goal line (no tasks yet)', type: 'textarea', default: '{{owner_label}} ({{goal_title}}{{priority_note}}) — no tasks yet; let it steer what the world does when it fits.', scope: 'global', help: 'Same placeholders as the goal line, without {{task}}.' },
    { key: 'goals.progress_template', section: 'Injection', label: 'Progress line', type: 'text', default: '{{goal_title}} progress — {{progress}}', scope: 'global', help: 'Placeholders: {{goal_title}}, {{progress}} (the parts below joined).' },
    { key: 'goals.progress_done_template', section: 'Injection', label: 'Progress: completed part', type: 'text', default: 'done: {{tasks}}', scope: 'global', help: 'Placeholder: {{tasks}}.' },
    { key: 'goals.progress_next_template', section: 'Injection', label: 'Progress: upcoming part', type: 'text', default: 'later: {{tasks}}', scope: 'global', help: 'Placeholder: {{tasks}}.' },
    { key: 'goals.progress_joiner', section: 'Injection', label: 'Progress part separator', type: 'text', default: ' · ', scope: 'global', help: '' },
    { key: 'goals.list_joiner', section: 'Injection', label: 'Task list separator', type: 'text', default: '; ', scope: 'global', help: '' },
    { key: 'goals.owner_story_label', section: 'Injection', label: 'Owner label: story', type: 'text', default: 'Story goal', scope: 'global', help: '' },
    { key: 'goals.owner_character_label', section: 'Injection', label: 'Owner label: a character', type: 'text', default: '{{owner}}\'s goal', scope: 'global', help: 'Placeholder: {{owner}}.' },
    { key: 'goals.priority_notes', section: 'Injection', label: 'Priority notes (high, normal, low)', type: 'list', default: [', high priority', '', ', low priority'], length: 3, allowEmptyItems: true, scope: 'global', help: 'Inserted as {{priority_note}}. Three lines: high, normal, low.' },
    { key: 'goals.title_chars_in_note', section: 'Injection', label: 'Goal title length in the note', type: 'number', default: 80, min: 10, max: 500, step: 5, scope: 'global', help: '' },
    { key: 'goals.task_chars_in_note', section: 'Injection', label: 'Current task length in the note', type: 'number', default: 160, min: 20, max: 1000, step: 10, scope: 'global', help: '' },
    { key: 'goals.progress_task_chars', section: 'Injection', label: 'Task length in progress lines', type: 'number', default: 70, min: 10, max: 500, step: 5, scope: 'global', help: '' },
    { key: 'goals.progress_title_chars', section: 'Injection', label: 'Title length in progress lines', type: 'number', default: 40, min: 10, max: 500, step: 5, scope: 'global', help: '' },
    { key: 'goals.pri_base', section: 'Injection', label: 'Note priority: goal line base', type: 'number', default: 70, min: 0, max: 100, step: 1, scope: 'global', help: 'Under the note\'s word cap, lower-priority lines are dropped first (beat = 90, NPC minds = 70, facts = 50).' },
    { key: 'goals.pri_per_level', section: 'Injection', label: 'Note priority: added per urgency level', type: 'number', default: 5, min: 0, max: 30, step: 1, scope: 'global', help: '' },
    { key: 'goals.pri_per_priority', section: 'Injection', label: 'Note priority: added per goal priority step', type: 'number', default: 1, min: 0, max: 30, step: 1, scope: 'global', help: 'High priority gets 2 steps, normal 1, low 0.' },
    { key: 'goals.progress_pri_base', section: 'Injection', label: 'Note priority: progress line base', type: 'number', default: 40, min: 0, max: 100, step: 1, scope: 'global', help: '' },
    { key: 'goals.progress_pri_per_level', section: 'Injection', label: 'Note priority: progress line per urgency level', type: 'number', default: 2, min: 0, max: 30, step: 1, scope: 'global', help: '' },

    // Urgency ------------------------------------------------------------------------------------------------------------
    { key: 'goals.urgency_thresholds', section: 'Urgency', label: 'Turns on a task before urgency 1, 2, 3', type: 'list', itemType: 'number', default: [4, 8, 12], length: 3, ascending: true, min: 1, max: 500, scope: 'global', help: 'Three ascending numbers (player turns), for a normal-priority goal; scaled by the priority factors below.' },
    { key: 'goals.priority_scale_high', section: 'Urgency', label: 'Threshold factor: high priority', type: 'number', default: 0.5, min: 0.05, max: 10, step: 0.05, scope: 'global', help: 'Smaller = escalates sooner.' },
    { key: 'goals.priority_scale_normal', section: 'Urgency', label: 'Threshold factor: normal priority', type: 'number', default: 1, min: 0.05, max: 10, step: 0.05, scope: 'global', help: '' },
    { key: 'goals.priority_scale_low', section: 'Urgency', label: 'Threshold factor: low priority', type: 'number', default: 1.5, min: 0.05, max: 10, step: 0.05, scope: 'global', help: '' },
    { key: 'goals.urgency_phrases', section: 'Urgency', label: 'Urgency phrasing (levels 0–3)', type: 'list', default: ['when it fits', 'work toward it soon', 'advance it this turn', 'this is overdue: make concrete progress now'], length: 4, scope: 'global', help: 'Four lines, from relaxed to overdue. Used as {{urgency}} / {{Urgency}}.' },
    { key: 'goals.priority_names', section: 'Urgency', label: 'Priority names (high, normal, low)', type: 'list', default: ['high', 'normal', 'low'], length: 3, scope: 'global', help: 'Used in lists, the director brief and {{priority}}; also accepted by /uc-goal add priority=…' },

    // Director -----------------------------------------------------------------------------------------------------------
    { key: 'goals.director_max', section: 'Director', label: 'Goals in the director brief', type: 'number', default: 5, min: 0, max: 20, step: 1, scope: 'global', help: '0 = the director does not see goals.' },
    { key: 'goals.director_upcoming', section: 'Director', label: 'Upcoming tasks in the brief', type: 'number', default: 2, min: 0, max: 10, step: 1, scope: 'global', help: '' },
    { key: 'goals.director_recent', section: 'Director', label: 'Recently done tasks in the brief', type: 'number', default: 2, min: 0, max: 10, step: 1, scope: 'global', help: '' },
    { key: 'goals.director_header', section: 'Director', label: 'Director brief header', type: 'textarea', default: DIRECTOR_HEADER, scope: 'global', help: 'First lines of the goals block in the director\'s message.' },
    { key: 'goals.director_goal_template', section: 'Director', label: 'Director brief: one goal', type: 'textarea', default: DIRECTOR_GOAL, scope: 'global', help: 'Placeholders: {{n}}, {{owner_tag}}, {{owner}}, {{priority}}, {{level}}, {{urgency}}, {{turns}}, {{done}}, {{total}}, {{goal_title}}, {{description}}, {{task}}, {{no_tasks}}, {{next}}, {{recent}}. Lines whose placeholders are all empty are dropped.' },
    { key: 'goals.director_owner_story', section: 'Director', label: 'Brief owner tag: story', type: 'text', default: 'story', scope: 'global', help: '' },
    { key: 'goals.director_owner_character', section: 'Director', label: 'Brief owner tag: a character', type: 'text', default: 'owner: {{owner}}', scope: 'global', help: 'Placeholder: {{owner}}.' },
    { key: 'goals.director_no_tasks', section: 'Director', label: 'Brief note when a goal has no tasks', type: 'text', default: 'No tasks yet: let it shape choices when it fits.', scope: 'global', help: '' },

    // Task generation ----------------------------------------------------------------------------------------------------
    { key: 'goals.taskgen_count', section: 'Task generation', label: 'Tasks per Generate', type: 'number', default: 5, min: 1, max: 30, step: 1, scope: 'global', help: '' },
    { key: 'goals.taskgen_more_count', section: 'Task generation', label: 'Tasks per Generate more', type: 'number', default: 3, min: 1, max: 30, step: 1, scope: 'global', help: '' },
    { key: 'goals.taskgen_max_count', section: 'Task generation', label: 'Most tasks one request may ask for', type: 'number', default: 12, min: 1, max: 30, step: 1, scope: 'global', help: 'Caps the count argument of /uc-tasks.' },
    { key: 'goals.taskgen_transcript_messages', section: 'Task generation', label: 'Messages task generation reads', type: 'number', default: 12, min: 0, max: 60, step: 1, scope: 'global', help: '' },
    { key: 'goals.taskgen_max_tokens', section: 'Task generation', label: 'Task generation response tokens', type: 'number', default: 700, min: 100, max: 4000, step: 50, scope: 'global', help: '' },
    { key: 'goals.taskgen_system', section: 'Task generation', label: 'Task generation prompt (system)', type: 'textarea', default: TASKGEN_SYSTEM, scope: 'global', help: '{{user}}/{{char}} are SillyTavern macros. Must produce a numbered list. Empty = default.' },
    { key: 'goals.taskgen_user', section: 'Task generation', label: 'Task generation prompt (message)', type: 'textarea', default: TASKGEN_USER, scope: 'global', help: 'Placeholders: {{cast}} (card + persona), {{continuity}} (Undercurrent state), {{recent}} (transcript), {{goal_block}}, {{existing}} (numbered existing tasks), {{ask}}, {{count}}. Lines whose placeholders are all empty are dropped. Empty = default.' },
    { key: 'goals.taskgen_goal_block', section: 'Task generation', label: 'Goal block', type: 'textarea', default: 'Goal: {{goal_title}}\nDetails: {{description}}\n{{owner_note}}\n{{branch_note}}', scope: 'global', help: 'Placeholders: {{goal_title}}, {{description}}, {{owner}}, {{owner_note}}, {{branch_note}}.' },
    { key: 'goals.taskgen_owner_story', section: 'Task generation', label: 'Owner note: story', type: 'textarea', default: 'The story itself pursues this goal: tasks are what the world and its characters do.', scope: 'global', help: '' },
    { key: 'goals.taskgen_owner_character', section: 'Task generation', label: 'Owner note: a character', type: 'textarea', default: '{{owner}} pursues this goal as their own: tasks are mostly what {{owner}} does, plans or sets in motion, true to their personality, plus what the world does in response.', scope: 'global', help: 'Placeholder: {{owner}}.' },
    { key: 'goals.taskgen_branch_note', section: 'Task generation', label: 'Branch note', type: 'textarea', default: 'Break down only this step of the goal into smaller tasks: {{task}}', scope: 'global', help: 'Used when generating sub-steps for one task. Placeholder: {{task}}.' },
    { key: 'goals.taskgen_ask_new', section: 'Task generation', label: 'Ask: first list', type: 'text', default: 'Write {{count}} tasks.', scope: 'global', help: 'Placeholder: {{count}}.' },
    { key: 'goals.taskgen_ask_existing', section: 'Task generation', label: 'Ask: list with existing tasks', type: 'text', default: 'Write {{count}} tasks. Do not repeat or rephrase the existing tasks.', scope: 'global', help: 'Placeholder: {{count}}.' },
    { key: 'goals.taskgen_ask_more', section: 'Task generation', label: 'Ask: generate more', type: 'text', default: 'Write {{count}} NEW tasks that continue after the existing ones. Do not repeat or rephrase any existing task.', scope: 'global', help: 'Placeholder: {{count}}.' },
    { key: 'goals.taskgen_done_mark', section: 'Task generation', label: 'Mark for done tasks in the existing list', type: 'text', default: '[done] ', scope: 'global', help: '' },
    { key: 'goals.dedupe_similarity', section: 'Task generation', label: 'Skip new tasks this similar to existing ones', type: 'number', default: 0.8, min: 0.3, max: 1, step: 0.05, scope: 'global', help: 'Word-overlap ratio (1 = only exact duplicates).' },
    { key: 'goals.user_filter', section: 'Task generation', label: 'Drop tasks that make {{user}} the actor', type: 'bool', default: true, scope: 'global', help: 'Heuristic guard for the player-autonomy rule: drops generated tasks where {{user}} says, does, decides or feels something.' },
    { key: 'goals.user_aliases', section: 'Task generation', label: 'Other names for the player', type: 'list', default: ['the user', 'the player', 'the protagonist'], scope: 'global', help: '{{user}} and the active persona name are always included.' },
    { key: 'goals.user_filter_verbs', section: 'Task generation', label: 'Filter: verbs that make the player the actor', type: 'list', default: DECIDE_VERBS, scope: 'global', help: 'Base forms; -s/-es/-ed/-ing are matched automatically.' },
    { key: 'goals.user_filter_coerce_verbs', section: 'Task generation', label: 'Filter: verbs that decide the player\'s response', type: 'list', default: COERCE_VERBS, scope: 'global', help: 'As in "X makes {{user}} laugh".' },
    { key: 'goals.user_filter_attempt_verbs', section: 'Task generation', label: 'Filter: attempt words that make coercion verbs fine', type: 'list', default: ATTEMPT_VERBS, scope: 'global', help: 'As in "X tries to convince {{user}}" (allowed).' },
    { key: 'goals.user_filter_choice_nouns', section: 'Task generation', label: 'Filter: the player\'s inner life/choices', type: 'list', default: CHOICE_NOUNS, scope: 'global', help: 'As in "wins {{user}}\'s trust" (dropped unless an allowed verb below is present).' },
    { key: 'goals.user_filter_choice_allow', section: 'Task generation', label: 'Filter: verbs that make those nouns fine', type: 'list', default: CHOICE_ALLOW, scope: 'global', help: 'As in "asks for {{user}}\'s answer" (allowed).' },
    { key: 'goals.user_filter_patterns', section: 'Task generation', label: 'Filter: extra patterns to drop', type: 'list', default: [], scope: 'global', help: 'Regular expressions (case-insensitive), one per line. {USER} stands for any player name.' },

    // Defaults and limits ------------------------------------------------------------------------------------------------
    { key: 'goals.default_priority', section: 'Limits', label: 'Default priority for new goals', type: 'select', default: 'normal', options: ['high', 'normal', 'low'], scope: 'global', help: 'Resolved options also carry default_priority_level (1 = high, 2 = normal, 3 = low).' },
    { key: 'goals.default_duration', section: 'Limits', label: 'Default minimum turns before a task can auto-complete', type: 'number', default: 0, min: 0, max: HARD_LIMITS.duration, step: 1, scope: 'global', help: 'Per task; editable on each task.' },
    { key: 'goals.max_goals', section: 'Limits', label: 'Goals per chat', type: 'number', default: 20, min: 1, max: HARD_LIMITS.goals, step: 1, scope: 'global', help: '' },
    { key: 'goals.max_tasks', section: 'Limits', label: 'Tasks per goal', type: 'number', default: 80, min: 1, max: HARD_LIMITS.tasksPerGoal, step: 1, scope: 'global', help: '' },
    { key: 'goals.max_depth', section: 'Limits', label: 'Task tree depth', type: 'number', default: 5, min: 1, max: HARD_LIMITS.depth, step: 1, scope: 'global', help: '' },
    { key: 'goals.title_chars', section: 'Limits', label: 'Goal title length', type: 'number', default: 120, min: 10, max: HARD_LIMITS.title, step: 10, scope: 'global', help: '' },
    { key: 'goals.description_chars', section: 'Limits', label: 'Goal description length', type: 'number', default: 500, min: 0, max: HARD_LIMITS.description, step: 50, scope: 'global', help: '' },
    { key: 'goals.task_chars', section: 'Limits', label: 'Task length', type: 'number', default: 220, min: 20, max: HARD_LIMITS.task, step: 10, scope: 'global', help: '' },
    { key: 'goals.max_duration', section: 'Limits', label: 'Largest per-task minimum duration', type: 'number', default: 50, min: 0, max: HARD_LIMITS.duration, step: 1, scope: 'global', help: '' },
].map(k => Object.freeze({ ...k, group: k.section === 'General' ? 'Goals' : `Goals · ${k.section}` }));

export const GOAL_KNOB_PREFIX = 'goals.';
const KNOB_BY_NAME = new Map(GOALS_KNOBS.map(k => [k.key.slice(GOAL_KNOB_PREFIX.length), k]));
/** Names of the per-chat knobs (stored in state.goals.settings). */
export const CHAT_KNOBS = GOALS_KNOBS.filter(k => k.scope === 'chat').map(k => k.key.slice(GOAL_KNOB_PREFIX.length));

function defaultsObject() {
    const o = {};
    for (const [name, k] of KNOB_BY_NAME) o[name] = Array.isArray(k.default) ? [...k.default] : k.default;
    return o;
}

/** The default options (a fresh copy). */
export function goalDefaults() {
    return defaultsObject();
}

function toBool(v, def) {
    if (typeof v === 'boolean') return v;
    if (v === 'true' || v === 1 || v === '1' || v === 'on' || v === 'yes') return true;
    if (v === 'false' || v === 0 || v === '0' || v === 'off' || v === 'no') return false;
    return def;
}

function toNumber(v, k) {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (!Number.isFinite(n)) return k.default;
    let x = clamp(n, k.min ?? -Infinity, k.max ?? Infinity);
    if (Number.isInteger(k.step ?? 1)) x = Math.round(x);
    return x;
}

function toList(v, k) {
    let arr = v;
    if (typeof v === 'string') arr = v.split(/\r?\n/);
    if (!Array.isArray(arr)) return [...k.default];
    if (k.itemType === 'number') {
        const nums = arr.map(x => (typeof x === 'string' ? Number(x.trim()) : x)).filter(Number.isFinite)
            .map(x => Math.round(clamp(x, k.min ?? -Infinity, k.max ?? Infinity)));
        if (k.length && nums.length !== k.length) return [...k.default];
        if (k.ascending && nums.some((x, i) => i > 0 && x <= nums[i - 1])) return [...k.default];
        return nums;
    }
    let strs = arr.filter(x => typeof x === 'string' || typeof x === 'number').map(x => String(x));
    if (!k.allowEmptyItems) strs = strs.map(x => x.trim()).filter(Boolean);
    if (k.length && strs.length !== k.length) return [...k.default];
    return strs;
}

function coerce(k, v) {
    if (v === undefined || v === null) return Array.isArray(k.default) ? [...k.default] : k.default;
    switch (k.type) {
        case 'number': return toNumber(v, k);
        case 'bool': return toBool(v, k.default);
        case 'select': {
            const hit = (k.options || []).map(o => (isPlainObject(o) ? o.value : o)).find(o => String(o) === String(v));
            return hit !== undefined ? hit : k.default;
        }
        case 'list': return toList(v, k);
        case 'text':
        case 'textarea': {
            if (typeof v !== 'string') return k.default;
            // Prompts and templates fall back to the default when cleared; plain text knobs keep '' (e.g. no header).
            if (k.type === 'textarea' && !v.trim()) return k.default;
            return v;
        }
        default: return k.default;
    }
}

/**
 * Merge knob values over the defaults, validating and clamping each. Accepts any of:
 * {"goals.check_every": 3}, {check_every: 3}, {goals: {check_every: 3}}, or an already-resolved options object.
 * Unknown keys are ignored. Never throws.
 * @returns {object} options keyed by knob name (without the "goals." prefix)
 */
export function resolveGoalOptions(values = {}) {
    const flat = {};
    const src = isPlainObject(values) ? values : {};
    if (isPlainObject(src.goals)) Object.assign(flat, src.goals);
    for (const [k, v] of Object.entries(src)) {
        if (k === 'goals') continue;
        const name = k.startsWith(GOAL_KNOB_PREFIX) ? k.slice(GOAL_KNOB_PREFIX.length) : k;
        if (KNOB_BY_NAME.has(name)) flat[name] = v;
    }
    const out = {};
    for (const [name, k] of KNOB_BY_NAME) out[name] = coerce(k, flat[name]);
    // Derived (not knobs): numeric priority level for the default_priority select.
    out.default_priority_level = Math.max(1, ['high', 'normal', 'low'].indexOf(out.default_priority) + 1);
    if (out.taskgen_count > out.taskgen_max_count) out.taskgen_count = out.taskgen_max_count;
    if (out.taskgen_more_count > out.taskgen_max_count) out.taskgen_more_count = out.taskgen_max_count;
    return out;
}

/** Validate a single knob value (for the settings panel). Returns the coerced value. */
export function coerceKnob(key, value) {
    const name = String(key).startsWith(GOAL_KNOB_PREFIX) ? String(key).slice(GOAL_KNOB_PREFIX.length) : String(key);
    const k = KNOB_BY_NAME.get(name);
    return k ? coerce(k, value) : undefined;
}

/**
 * Fill {{placeholders}} from vars. Placeholders not present in vars are left as they are (SillyTavern macros pass
 * through). With dropEmptyLines, a line that uses at least one known placeholder and all of them are empty is removed.
 */
export function fillTemplate(tpl, vars = {}, { dropEmptyLines = true } = {}) {
    const out = [];
    for (const line of String(tpl ?? '').split('\n')) {
        let used = 0;
        let filledCount = 0;
        const filled = line.replace(/\{\{([A-Za-z_][\w]*)\}\}/g, (m, key) => {
            if (!Object.prototype.hasOwnProperty.call(vars, key)) return m;
            used++;
            const v = vars[key];
            const s = v === null || v === undefined ? '' : String(v);
            if (s.trim()) filledCount++;
            return s;
        });
        if (dropEmptyLines && used > 0 && filledCount === 0) continue;
        out.push(filled);
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
