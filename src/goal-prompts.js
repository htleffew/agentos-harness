// Undercurrent — prompts and parsers for the Goals & Tasks hidden passes. Pure logic.
//
// Two passes, both sent by index.js through runHidden() with the extension's own compact context (never the RP preset):
//   - task generation: goal → numbered list of story tasks, extrapolated from the card, the persona and the chat;
//   - completion check: ONE batched call for every due task, answering JSON with a verbatim quote as evidence.
// Every prompt, count and threshold comes from the options (goal-options.js knobs).
// Hard rule (BUILD_SPEC §1): a task is something the world, {{char}} or another character does, or a situation that
// arises. Tasks never require, describe or presume {{user}}'s words, actions, thoughts or choices; filterUserActorTasks()
// drops generated tasks that break this. Nothing here assumes a name, gender or pronoun for {{user}} or {{char}}: the
// cast and persona come from the loaded card at runtime.

import { stripReasoning, normText, clip, isPlainObject, escapeRegex } from './util.js';
import { extractJson } from './parse.js';
import { walkTasks, durationMet } from './goals.js';
import { resolveGoalOptions, fillTemplate } from './goal-options.js';

// ---------------------------------------------------------------------------------------------------------------------
// Task generation

/**
 * @param {object} p
 * @param {object} p.goal goal object (title, description, owner, tasks)
 * @param {object|null} [p.branch] a task to break into sub-steps instead of the whole goal
 * @param {string} [p.cardBlock] buildCardBlock() output (card + persona, loaded at runtime)
 * @param {string} [p.stateBlock] summarizeState() output
 * @param {string} [p.transcript] buildTranscript() output
 * @param {(string|{text:string, done?:boolean})[]} [p.existingTasks] defaults to the goal's (or branch's) tasks
 * @param {number} [p.count] how many new tasks (default: options.taskgen_count / taskgen_more_count)
 * @param {boolean} [p.more] continue an existing list
 * @param {object} [p.options] resolved goal options
 * @returns {{systemPrompt:string, messages:{role:string, content:string}[]}}
 */
export function buildTaskGenMessages({ goal, branch = null, cardBlock = '', stateBlock = '', transcript = '', existingTasks, count, more = false, options } = {}) {
    const o = resolveGoalOptions(options);
    const def = more ? o.taskgen_more_count : o.taskgen_count;
    const n = Math.max(1, Math.min(o.taskgen_max_count, Math.round(Number(count) || def)));
    const existing = existingTasks ?? listExisting(branch ? [branch] : goal?.tasks || []);
    const exLines = existing.map((t, i) => (typeof t === 'string' ? `${i + 1}. ${t}` : `${i + 1}. ${t.done ? o.taskgen_done_mark : ''}${t.text}`));
    const owner = goal?.owner && goal.owner !== 'story' ? goal.owner : '';
    const goalBlock = fillTemplate(o.taskgen_goal_block, {
        goal_title: goal?.title || '',
        description: goal?.description || '',
        owner,
        owner_note: owner ? fillTemplate(o.taskgen_owner_character, { owner }) : o.taskgen_owner_story,
        branch_note: branch ? fillTemplate(o.taskgen_branch_note, { task: branch.text }) : '',
    });
    const askTpl = more && exLines.length ? o.taskgen_ask_more : exLines.length ? o.taskgen_ask_existing : o.taskgen_ask_new;
    const content = fillTemplate(o.taskgen_user, {
        cast: cardBlock,
        continuity: stateBlock,
        recent: transcript || '(the story has just begun)',
        goal_block: goalBlock,
        existing: exLines.join('\n'),
        ask: fillTemplate(askTpl, { count: n }),
        count: n,
    }).replace(/<(\w+)>\s*<\/\1>\s*/g, ''); // drop sections left empty
    const style = o[`taskgen_style_${o.taskgen_style}`] || o.taskgen_style_loose || '';
    return { systemPrompt: fillTemplate(o.taskgen_system, { count: n, style }), messages: [{ role: 'user', content }] };
}

function listExisting(tasks) {
    const out = [];
    walkTasks(tasks, (t) => { out.push({ text: t.text, done: t.done }); });
    return out;
}

const HEADING = /^(?:here(?:'s| is| are)\b|sure\b|okay\b|ok\b|tasks?\s*:|task list\b|the (?:tasks|list)\b|#+\s|note\s*:|these tasks\b|i hope\b|let me know\b)/i;

/**
 * Parse a task list from model output: numbered ("1." "1)" "(1)" "Task 1:"), bulleted ("-" "*" "•"), bold markers,
 * code fences, reasoning blocks and JSON arrays ({tasks:[…]} or ["…"]). Deduplicated, in order.
 * @returns {string[]}
 */
export function parseTaskList(text) {
    let s = stripReasoning(String(text ?? ''));
    if (!s) return [];
    if (/^\s*[[{]/.test(s.replace(/```(?:json)?/gi, ''))) {
        const j = extractJson(s, { prefer: 'any' });
        const arr = Array.isArray(j) ? j : (isPlainObject(j) && Array.isArray(j.tasks) ? j.tasks : null);
        if (arr) return dedupe(arr.map(x => (typeof x === 'string' ? x : (isPlainObject(x) ? (x.text ?? x.task ?? x.description ?? '') : ''))).map(cleanTask));
    }
    s = s.replace(/```[a-z]*\n?/gi, '');
    const lines = s.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const marker = /^(?:\*\*|__)?\s*(?:(?:task|step)\s*\d+\s*[:.)-]|\(?\d{1,2}\s*[.):]|\d{1,2}\s+-|[-*•·‣◦–—]|\[\s?[x ]?\s?\])\s*(?:\*\*|__)?\s*/i;
    let items;
    if (lines.some(l => marker.test(l))) {
        items = [];
        let lastMarked = false;
        for (const l of lines) {
            if (marker.test(l)) {
                let item = l.replace(marker, '');
                for (let i = 0; i < 2 && marker.test(item); i++) item = item.replace(marker, ''); // stacked: "• Task 5: …"
                items.push(item);
                lastMarked = true;
            } else if (lastMarked && /^[a-z(]/.test(l) && !HEADING.test(l)) {
                items[items.length - 1] += ` ${l}`; // wrapped continuation of the previous item
            } else lastMarked = false;
        }
    } else {
        items = lines.filter(l => !HEADING.test(l) && !/:$/.test(l));
    }
    return dedupe(items.map(cleanTask));
}

function cleanTask(t) {
    return String(t ?? '')
        .replace(/\*\*|__/g, '')
        .replace(/^["'“”]+|["'“”]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function dedupe(list) {
    const seen = new Set();
    return list.filter((t) => {
        const k = normText(t);
        if (!k || k.length < 3 || HEADING.test(t) || seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

// ---------------------------------------------------------------------------------------------------------------------
// {{user}}-as-actor filter

/** Regex alternation of verb forms built from base forms (go → go|goes|gone|going|went is not derivable; list irregulars). */
function verbForms(list) {
    const forms = new Set();
    for (const raw of list || []) {
        const v = String(raw).trim().toLowerCase();
        if (!v) continue;
        if (v.includes(' ')) { forms.add(escapeRegex(v).replace(/\s+/g, '\\s+')); continue; }
        forms.add(escapeRegex(v));
        if (!/^(?:must|should|will|would|can|could|is|was)$/.test(v)) {
            const stem = v.replace(/e$/, '');
            forms.add(`${escapeRegex(v)}(?:s|es|d|ed)`);
            forms.add(`${escapeRegex(stem)}(?:ing|ed)`);
            if (/y$/.test(v)) forms.add(`${escapeRegex(v.slice(0, -1))}(?:ies|ied)`);
            if (/[^aeiou][aeiou][bdgklmnprt]$/.test(v)) forms.add(`${escapeRegex(v)}${v.slice(-1)}(?:ing|ed)`);
        }
    }
    return `(?:${[...forms].sort((a, b) => b.length - a.length).join('|')})`;
}

function aliasPattern(userName, aliases) {
    const names = ['\\{\\{user\\}\\}'];
    for (const a of aliases || []) if (String(a).trim()) names.push(escapeRegex(String(a).trim()).replace(/\s+/g, '\\s+'));
    const u = String(userName ?? '').trim();
    if (u && !/^\{\{user\}\}$/i.test(u)) names.push(escapeRegex(u).replace(/\s+/g, '\\s+'));
    return `(?:${names.join('|')})`;
}

const MODALS = '(?:finally|then|eventually|slowly|quietly|willingly|also|actually|really|must|should|will|would|can|could|may|might)';

/** Compile the filter once per (options, userName). */
function compileFilter(o, userName) {
    const U = aliasPattern(userName, o.user_aliases);
    const V = verbForms(o.user_filter_verbs);
    const C = verbForms(o.user_filter_coerce_verbs);
    const A = verbForms(o.user_filter_attempt_verbs);
    const N = `(?:${(o.user_filter_choice_nouns || []).map(x => escapeRegex(String(x).trim())).filter(Boolean).join('|') || '(?!)'})`;
    const NA = verbForms(o.user_filter_choice_allow);
    const notPoss = '(?![\'’]s\\b|[\'’](?=\\s))';
    const extra = (o.user_filter_patterns || []).map((p) => {
        try { return new RegExp(String(p).replaceAll('{USER}', U), 'i'); } catch { return null; }
    }).filter(Boolean);
    return {
        subject: new RegExp(`^(?:(?:then|finally|next|first|eventually|later),?\\s+)?(?:(?:[\\w.'’-]+\\s+){0,3}(?:and|&|with)\\s+)?${U}${notPoss}(?:\\s+(?:and|&)\\s+[\\w.'’-]+(?:\\s+[\\w.'’-]+)?)?\\s+(?:${MODALS}\\s+)*${V}\\b`, 'i'),
        joint: new RegExp(`^(?:(?:then|finally|next|first|eventually|later),?\\s+)?(?:(?:[\\w.'’-]+\\s+){1,3}(?:and|&)\\s+${U}${notPoss}|${U}${notPoss}\\s+(?:and|&)\\s+[\\w.'’-]+)\\s+(?!is\\b|are\\b|was\\b|were\\b)\\w+`, 'i'),
        second: new RegExp(`^(?:then\\s+|finally\\s+)?you\\s+(?:${MODALS}\\s+)*${V}\\b`, 'i'),
        clause: new RegExp(`(?:\\b(?:until|when|after|once|so that|so|and|but|while|before|because|then|if)\\s+|[,;:]\\s*)${U}${notPoss}\\s+(?:${MODALS}\\s+)*${V}\\b`, 'i'),
        coerce: new RegExp(`\\b${C}\\s+${U}${notPoss}\\s+(?:to\\s+)?(?!to\\b)\\w+`, 'i'),
        attempt: new RegExp(`\\b${A}\\s+(?:to\\s+)?${C}\\s+${U}`, 'i'),
        choice: new RegExp(`(?<![\\w])${U}[’']s\\s+${N}\\b`, 'i'),
        choiceAllow: new RegExp(`\\b${NA}\\b`, 'i'),
        extra,
    };
}

const filterCache = new Map();

function getFilter(options, userName) {
    const o = resolveGoalOptions(options);
    const sig = JSON.stringify([userName, o.user_aliases, o.user_filter_verbs, o.user_filter_coerce_verbs, o.user_filter_attempt_verbs, o.user_filter_choice_nouns, o.user_filter_choice_allow, o.user_filter_patterns]);
    let f = filterCache.get(sig);
    if (!f) {
        f = compileFilter(o, userName);
        if (filterCache.size > 20) filterCache.clear();
        filterCache.set(sig, f);
    }
    return { f, o };
}

/**
 * Does this task make the player the actor (say, do, decide, feel something) or require the player's choice?
 * Allowed: things done to, said to, offered to, shown to {{user}}; {{user}}'s possessions or relations ("{{user}}'s phone rings").
 * @param {string} task
 * @param {{userName?:string, options?:object}} [opts] userName = the active persona name (runtime)
 * @returns {string} '' when fine, otherwise the reason
 */
export function userActorReason(task, { userName = '', options } = {}) {
    const t = String(task ?? '').replace(/’/g, '\'').trim();
    if (!t) return '';
    const { f } = getFilter(options, userName);
    if (f.subject.test(t)) return 'the player is the actor';
    if (f.joint.test(t)) return 'the player shares the action';
    if (f.second.test(t)) return 'second person addresses the player as the actor';
    if (f.clause.test(t)) return 'the player acts in a clause';
    if (f.coerce.test(t) && !f.attempt.test(t)) return 'decides the player\'s response';
    if (f.choice.test(t) && !f.choiceAllow.test(t)) return 'requires the player\'s choice';
    for (const re of f.extra) if (re.test(t)) return 'matches a custom filter pattern';
    return '';
}

/**
 * Drop generated tasks that script the player (when options.user_filter is on).
 * @returns {{kept:string[], dropped:{task:string, reason:string}[]}}
 */
export function filterUserActorTasks(tasks, { userName = '', options } = {}) {
    const o = resolveGoalOptions(options);
    const list = Array.isArray(tasks) ? tasks : [];
    if (!o.user_filter) return { kept: [...list], dropped: [] };
    const kept = [];
    const dropped = [];
    for (const t of list) {
        const reason = userActorReason(t, { userName, options: o });
        if (reason) dropped.push({ task: t, reason });
        else kept.push(t);
    }
    return { kept, dropped };
}

/** Word count of a task, counting a {{macro}} as one word. */
export function taskWordCount(task) {
    return String(task ?? '').replace(/\{\{[^}]*\}\}/g, 'X').split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;
}

/**
 * Drop over-long (over-specified) generated tasks when options.task_max_words > 0. If every task is too long the batch
 * is kept as it is, so a generation is never lost entirely.
 * @returns {{kept:string[], dropped:{task:string, reason:string}[]}}
 */
export function filterLongTasks(tasks, { options } = {}) {
    const o = resolveGoalOptions(options);
    const list = Array.isArray(tasks) ? tasks : [];
    const max = Math.round(Number(o.task_max_words) || 0);
    if (max <= 0) return { kept: [...list], dropped: [] };
    const kept = list.filter(t => taskWordCount(t) <= max);
    if (!kept.length) return { kept: [...list], dropped: [] };
    const dropped = list.filter(t => taskWordCount(t) > max).map(task => ({ task, reason: `too detailed (over ${max} words)` }));
    return { kept, dropped };
}

/** parseTaskList + filterUserActorTasks + filterLongTasks in one step. */
export function tasksFromOutput(text, { userName = '', options } = {}) {
    const a = filterUserActorTasks(parseTaskList(text), { userName, options });
    const b = filterLongTasks(a.kept, { options });
    return { kept: b.kept, dropped: [...a.dropped, ...b.dropped] };
}

// ---------------------------------------------------------------------------------------------------------------------
// Completion check (one batched call)

/**
 * @param {{items:{goal:object, task:object}[], transcript:string, options?:object}} p
 * @returns {{systemPrompt:string, messages:{role:string, content:string}[]}}
 */
export function buildCheckMessages({ items = [], transcript = '', options } = {}) {
    const o = resolveGoalOptions(options);
    const lines = items.map(({ goal, task }) => fillTemplate(o.check_task_line, {
        task_id: task.id, goal_title: goal?.title || '', task: task.text, owner: goal?.owner === 'story' ? '' : (goal?.owner || ''),
    }, { dropEmptyLines: false }));
    const content = fillTemplate(o.check_user, { tasks: lines.join('\n'), recent: transcript || '(no messages)' });
    return { systemPrompt: fillTemplate(o.check_system, { evidence_min_words: o.evidence_min_words }), messages: [{ role: 'user', content }] };
}

/** Lowercase, unify quotes/dashes, drop markup asterisks and marked private-thought segments, collapse whitespace. */
export function normEvidence(text) {
    return String(text ?? '')
        .replace(/⟦private thought[^⟧]*⟧/g, ' ')
        .replace(/[‘’`]/g, '\'')
        .replace(/[“”«»„]/g, '"')
        .replace(/[–—]/g, '-')
        .replace(/\*+/g, '')
        .replace(/_+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

/** Remove *thought* segments from raw message text before matching (they never count as evidence). */
function withoutThoughts(text) {
    return String(text ?? '').replace(/(^|[^*])\*(?!\*)([^*\n]+?)\*(?!\*)/g, '$1 ');
}

/**
 * Is `evidence` a verbatim quote from `haystack`? Fragments split by an ellipsis must each appear, in order.
 * Minimum length/word counts and fragment size come from the options.
 */
export function evidenceInText(evidence, haystack, options) {
    const o = resolveGoalOptions(options);
    const ev = normEvidence(evidence).replace(/^["'\s]+|["'\s]+$/g, '');
    if (ev.length < o.evidence_min_chars || ev.split(' ').length < o.evidence_min_words) return false;
    const hay = normEvidence(haystack);
    const parts = ev.split(/\s*(?:\.\.\.|…|\[\s*(?:\.\.\.|…)\s*\])\s*/).map(p => p.replace(/^["'\s]+|["'\s]+$/g, '').trim()).filter(p => p.length >= o.evidence_fragment_min_chars);
    if (!parts.length) return false;
    let at = 0;
    for (const p of parts) {
        const i = hay.indexOf(p, at);
        if (i === -1) return false;
        at = i + p.length;
    }
    return true;
}

/** Index of the message (from sources [{index, text}]) holding the evidence, newest first; -1 if none. */
export function locateEvidence(evidence, sources = [], options) {
    for (let i = sources.length - 1; i >= 0; i--) {
        const s = sources[i];
        if (s && evidenceInText(evidence, withoutThoughts(s.text), options)) return s.index;
    }
    return -1;
}

/**
 * Parse and validate a check result. done=true is rejected unless the evidence is a verbatim quote from the transcript
 * (private thoughts excluded; skippable only by turning off check_require_evidence) and the task's minimum duration has
 * passed. Unknown task ids are ignored; a bare true/false answer carries no evidence and never completes anything.
 * @param {string} text model output
 * @param {{items:{goal:object, task:object}[], transcript:string, turn:number, sources?:{index:number, text:string}[], options?:object}} ctx
 *   sources: the raw chat messages the transcript was built from (finds which message holds the evidence)
 * @returns {{ok:boolean, results:object[], accepted:object[], rejected:{task_id:string, reason:string}[]}}
 */
export function parseCheck(text, { items = [], transcript = '', turn = 0, sources = null, options } = {}) {
    const o = resolveGoalOptions(options);
    const j = extractJson(text, { prefer: 'any' });
    let list = null;
    if (Array.isArray(j)) list = j;
    else if (isPlainObject(j)) list = Array.isArray(j.results) ? j.results : (Array.isArray(j.tasks) ? j.tasks : (j.task_id ? [j] : null));
    if (!list) return { ok: false, results: [], accepted: [], rejected: items.map(it => ({ task_id: it.task.id, reason: 'unparseable output' })) };
    const byId = new Map(items.map(it => [String(it.task.id), it]));
    const hay = withoutThoughts(transcript);
    const results = [];
    const accepted = [];
    const rejected = [];
    const seen = new Set();
    for (const r of list) {
        if (!isPlainObject(r)) continue;
        const id = String(r.task_id ?? r.id ?? '').trim();
        const it = byId.get(id);
        if (!it || seen.has(id)) continue;
        seen.add(id);
        const done = r.done === true || r.done === 'true' || r.completed === true;
        const evidence = clip(String(r.evidence ?? r.quote ?? '').trim(), o.evidence_max_chars);
        const out = { task_id: id, done, evidence };
        results.push(out);
        if (!done) continue;
        if (o.check_require_evidence) {
            if (!evidence) { rejected.push({ task_id: id, reason: 'no evidence' }); continue; }
            if (!evidenceInText(evidence, hay, o)) { rejected.push({ task_id: id, reason: 'evidence not found verbatim in the recent messages' }); continue; }
        }
        if (!durationMet(it.task, turn)) { rejected.push({ task_id: id, reason: `minimum duration not met (${it.task.duration} turns)` }); continue; }
        if (Array.isArray(sources) && evidence) out.evidence_index = locateEvidence(evidence, sources, o);
        accepted.push(out);
    }
    return { ok: true, results, accepted, rejected };
}
