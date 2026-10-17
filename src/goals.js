// Undercurrent — Goals & Tasks: author-set story goals broken into task trees. Pure logic: no DOM, no SillyTavern globals.
//
// Lives in the chat state under `goals` (see state.js). Mutators change the goals block IN PLACE and return what they
// touched; callers work on a fresh copy (loadState() already returns one) and save it.
//
// Every threshold, count, cap, phrase and template comes from the options object (goal-options.js: GOALS_KNOBS,
// resolveGoalOptions). Functions take `options` = the resolved global options; this chat's settings
// (state.goals.settings, the "chat"-scope knobs) are layered on top by goalOptions(). Omit options to use defaults.
//
// A goal is pursued by the world: the story itself (owner "story") or one character (owner = that character's name).
// Tasks are things that happen in the story through the world, {{char}} or other characters. Nothing here describes,
// requires or decides {{user}}'s words, actions, thoughts or choices, and nothing assumes a name, gender or pronoun.
//
// Turns are player turns (countUserTurns(chat)), the unit the rest of Undercurrent uses.
// Task tree rules (match and extend ST Objective / SuperObjective):
//   - current task = first incomplete leaf, depth-first (inside the branch focus first, when one is set);
//   - a parent is done exactly when all its children are done (settle());
//   - marking a parent done/undone cascades to its descendants;
//   - auto-completions carry done_key = the chat message whose text proved them; reconcileCompletions() undoes them
//     when that message is swiped, edited or deleted. Manual completions (done_key null) are never undone by reconcile.

import { clip, normText, contentTokens, jaccard, isPlainObject, clamp } from './util.js';
import { resolveGoalOptions, fillTemplate, HARD_LIMITS, CHAT_KNOBS } from './goal-options.js';

export { GOALS_KNOBS, resolveGoalOptions, fillTemplate, HARD_LIMITS, CHAT_KNOBS, coerceKnob, goalDefaults } from './goal-options.js';

export const GOAL_STATUS = ['active', 'paused', 'done'];
export const PRIORITIES = [1, 2, 3]; // 1 = high, 2 = normal, 3 = low

// ---------------------------------------------------------------------------------------------------------------------
// Options

/** Effective options for this goals block: resolved global options with the chat's own settings on top. */
export function goalOptions(goals, options) {
    return resolveGoalOptions({ ...(isPlainObject(options) ? options : {}), ...(isPlainObject(goals?.settings) ? goals.settings : {}) });
}

/**
 * Effective options for a whole Undercurrent state: global knob values < this chat's goals.settings < any "goals.*"
 * entries in state.knob_overrides (when the central settings panel stores per-chat values there).
 */
export function goalOptionsForState(state, globalValues = {}) {
    const ov = isPlainObject(state?.knob_overrides) ? Object.fromEntries(Object.entries(state.knob_overrides).filter(([k]) => k.startsWith('goals.'))) : {};
    return resolveGoalOptions({ ...(isPlainObject(globalValues) ? globalValues : {}), ...(isPlainObject(state?.goals?.settings) ? state.goals.settings : {}), ...ov });
}

/** Set one chat-scope knob on a goals block (validated). Returns the stored value, or undefined for a non-chat knob. */
export function setGoalChatSetting(goals, name, value) {
    const n = String(name).replace(/^goals\./, '');
    if (!CHAT_KNOBS.includes(n)) return undefined;
    goals.settings = normalizeGoalSettings({ ...goals.settings, [n]: value }, goals.settings);
    return goals.settings[n];
}

/** Only the chat-scope knobs, validated: what state.goals.settings holds. */
export function normalizeGoalSettings(raw, defaults = {}) {
    const r = resolveGoalOptions({ ...(isPlainObject(defaults) ? defaults : {}), ...(isPlainObject(raw) ? raw : {}) });
    return Object.fromEntries(CHAT_KNOBS.map(k => [k, r[k]]));
}

// ---------------------------------------------------------------------------------------------------------------------
// Schema

/** A fresh goals block. `defaults` = global knob values (seeds the chat-scope settings). */
export function emptyGoals(defaults = {}) {
    return { settings: normalizeGoalSettings({}, defaults), items: [], counters: { since_check: 0, next_id: 0 } };
}

function int(v, lo, hi, def) {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    return Number.isFinite(n) ? Math.round(clamp(n, lo, hi)) : def;
}

function bool(v, def = false) {
    if (typeof v === 'boolean') return v;
    if (v === 'true' || v === 1 || v === '1' || v === 'on' || v === 'yes') return true;
    if (v === 'false' || v === 0 || v === '0' || v === 'off' || v === 'no') return false;
    return def;
}

function str(v, max) {
    if (typeof v === 'string') return clip(v, max);
    if (typeof v === 'number') return String(v);
    return '';
}

function numOrNull(v) {
    return Number.isFinite(v) ? v : null;
}

/** 1|2|3 from a number or a priority name (options.priority_names, or its first letter). */
export function normalizePriority(v, def = 2, options) {
    if (typeof v === 'string' && v.trim() && !/^\d+$/.test(v.trim())) {
        const names = (options?.priority_names || resolveGoalOptions().priority_names).map(n => String(n).toLowerCase());
        const s = v.trim().toLowerCase();
        const i = names.findIndex(n => n === s || (s.length === 1 && n.startsWith(s)));
        return i === -1 ? def : i + 1;
    }
    return int(v, 1, 3, def);
}

function normKey(k) {
    if (!isPlainObject(k) || !Number.isFinite(k.index) || typeof k.text_hash !== 'string') return null;
    return { index: k.index, swipe_id: Number.isFinite(k.swipe_id) ? k.swipe_id : 0, text_hash: k.text_hash };
}

/** Is this name the player ({{user}}, the persona name, or an alias)? */
export function isUserRef(name, userName = '', aliases = []) {
    const n = String(name ?? '').trim().toLowerCase();
    if (!n) return false;
    if (n === '{{user}}') return true;
    if ((aliases || []).some(a => String(a).trim().toLowerCase() === n)) return true;
    return !!userName && n === String(userName).trim().toLowerCase();
}

/** Owner of a goal: "story" or a character name. The player can never own a goal (that would script {{user}}). */
export function normalizeOwner(v, userName = '', options) {
    const max = options?.title_chars ?? HARD_LIMITS.owner;
    const s = str(v, Math.min(max, HARD_LIMITS.owner)).trim();
    const aliases = options?.user_aliases || resolveGoalOptions().user_aliases;
    if (!s || s.toLowerCase() === 'story' || isUserRef(s, userName, aliases)) return 'story';
    return s;
}

function idNum(id) {
    const m = /^[gt](\d+)$/.exec(String(id ?? ''));
    return m ? Number(m[1]) : 0;
}

function newId(goals, prefix) {
    goals.counters.next_id = (goals.counters.next_id || 0) + 1;
    return `${prefix}${goals.counters.next_id}`;
}

const ID_RE = /^[\w-]{1,24}$/;

function normalizeTask(raw, ctx, depth) {
    if (typeof raw === 'string') raw = { text: raw };
    if (!isPlainObject(raw)) return null;
    const text = str(raw.text ?? raw.description ?? raw.title ?? raw.task, HARD_LIMITS.task).trim();
    if (!text) return null;
    let id = typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : '';
    if (!id || ctx.ids.has(id)) id = '';
    if (id) ctx.ids.add(id);
    const t = {
        id,
        text,
        done: bool(raw.done ?? raw.completed, false),
        done_turn: numOrNull(raw.done_turn),
        done_key: normKey(raw.done_key),
        evidence: str(raw.evidence, HARD_LIMITS.evidence),
        duration: int(raw.duration, 0, HARD_LIMITS.duration, 0),
        started_turn: numOrNull(raw.started_turn),
        children: [],
    };
    if (!t.done) { t.done_turn = null; t.done_key = null; t.evidence = ''; }
    ctx.pending.push(t);
    if (depth < HARD_LIMITS.depth - 1 && Array.isArray(raw.children)) {
        for (const c of raw.children) {
            if (ctx.count >= HARD_LIMITS.tasksPerGoal) break;
            const n = normalizeTask(c, ctx, depth + 1);
            if (n) { ctx.count++; t.children.push(n); }
        }
    }
    return t;
}

function normalizeGoal(raw, ctx) {
    if (typeof raw === 'string') raw = { title: raw };
    if (!isPlainObject(raw)) return null;
    const title = str(raw.title ?? raw.name ?? raw.objective ?? raw.description, HARD_LIMITS.title).trim();
    if (!title) return null;
    let id = typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : '';
    if (!id || ctx.ids.has(id)) id = '';
    if (id) ctx.ids.add(id);
    const g = {
        id,
        title,
        description: str(raw.title !== undefined ? raw.description : '', HARD_LIMITS.description),
        owner: normalizeOwner(raw.owner),
        status: GOAL_STATUS.includes(raw.status) ? raw.status : 'active',
        priority: normalizePriority(raw.priority),
        hidden: bool(raw.hidden, false),
        created_turn: Number.isFinite(raw.created_turn) ? raw.created_turn : 0,
        done_turn: numOrNull(raw.done_turn),
        done_auto: bool(raw.done_auto, false),
        paused_turn: numOrNull(raw.paused_turn),
        focus_id: typeof raw.focus_id === 'string' ? raw.focus_id : null,
        tasks: [],
    };
    ctx.pendingGoals.push(g);
    const tctx = { ids: ctx.ids, pending: ctx.pending, count: 0 };
    for (const t of Array.isArray(raw.tasks) ? raw.tasks : []) {
        if (tctx.count >= HARD_LIMITS.tasksPerGoal) break;
        const n = normalizeTask(t, tctx, 0);
        if (n) { tctx.count++; g.tasks.push(n); }
    }
    return g;
}

/**
 * Repair anything into a valid goals block. Never throws. Stored data is capped by HARD_LIMITS only (the user's
 * knob caps apply when adding), so raising a cap never truncates existing goals on load.
 * @param {any} raw
 * @param {object} [defaults] global knob values: seed the chat settings of a brand-new block
 */
export function normalizeGoals(raw, defaults = {}) {
    const goals = emptyGoals(defaults);
    if (!isPlainObject(raw)) return goals;
    goals.settings = normalizeGoalSettings(isPlainObject(raw.settings) ? raw.settings : {}, { ...defaults, ...goals.settings });
    const c = isPlainObject(raw.counters) ? raw.counters : {};
    goals.counters.since_check = int(c.since_check, 0, Number.MAX_SAFE_INTEGER, 0);
    goals.counters.next_id = int(c.next_id, 0, Number.MAX_SAFE_INTEGER, 0);
    const ctx = { ids: new Set(), pending: [], pendingGoals: [] };
    for (const g of Array.isArray(raw.items) ? raw.items : []) {
        if (goals.items.length >= HARD_LIMITS.goals) break;
        const n = normalizeGoal(g, ctx);
        if (n) goals.items.push(n);
    }
    // Ids: keep the counter ahead of every id in use, then give fresh ids to anything missing or duplicated.
    for (const id of ctx.ids) goals.counters.next_id = Math.max(goals.counters.next_id, idNum(id));
    for (const g of ctx.pendingGoals) if (!g.id) g.id = newId(goals, 'g');
    for (const t of ctx.pending) if (!t.id) t.id = newId(goals, 't');
    for (const g of goals.items) {
        if (g.focus_id && !findIn(g.tasks, g.focus_id)) g.focus_id = null;
        settle(g);
    }
    return goals;
}

// ---------------------------------------------------------------------------------------------------------------------
// Tree helpers

/** Depth-first pre-order walk. fn(task, {parent, siblings, index, depth}); return false to stop. */
export function walkTasks(tasks, fn, parent = null, depth = 0) {
    for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        if (fn(t, { parent, siblings: tasks, index: i, depth }) === false) return false;
        if (walkTasks(t.children, fn, t, depth + 1) === false) return false;
    }
    return true;
}

function findIn(tasks, taskId) {
    let hit = null;
    walkTasks(tasks, (t, info) => {
        if (t.id === taskId) { hit = { task: t, ...info }; return false; }
        return true;
    });
    return hit;
}

export function getGoal(goals, goalId) {
    return (goals?.items || []).find(g => g.id === goalId) || null;
}

/** Locate a task anywhere: {goal, task, parent, siblings, index, depth} or null. */
export function findTask(goals, taskId) {
    for (const goal of goals?.items || []) {
        const hit = findIn(goal.tasks, taskId);
        if (hit) return { goal, ...hit };
    }
    return null;
}

function subtreeDepth(t) {
    return 1 + Math.max(0, ...t.children.map(subtreeDepth));
}

export function countTasks(tasks) {
    let n = 0;
    walkTasks(tasks || [], () => { n++; });
    return n;
}

/** Leaf counts: {total, done}. */
export function goalStats(goal) {
    let total = 0;
    let done = 0;
    walkTasks(goal?.tasks || [], (t) => { if (!t.children.length) { total++; if (t.done) done++; } });
    return { total, done };
}

function firstIncompleteLeaf(tasks) {
    for (const t of tasks) {
        if (t.done) continue;
        if (t.children.length) {
            const r = firstIncompleteLeaf(t.children);
            if (r) return r;
            continue;
        }
        return t;
    }
    return null;
}

function leavesInOrder(goal) {
    const out = [];
    const seen = new Set();
    const push = (tasks) => walkTasks(tasks, (t) => { if (!t.children.length && !seen.has(t.id)) { seen.add(t.id); out.push(t); } });
    const focus = goal.focus_id ? findIn(goal.tasks, goal.focus_id)?.task : null;
    if (focus && !focus.done) push([focus]);
    push(goal.tasks);
    return out;
}

/** The task to work on now: first incomplete leaf, depth-first (inside the branch focus first). */
export function currentTask(goal) {
    if (!goal) return null;
    if (goal.focus_id) {
        const f = findIn(goal.tasks, goal.focus_id)?.task;
        if (f && !f.done) {
            const r = f.children.length ? firstIncompleteLeaf(f.children) : f;
            if (r) return r;
        }
    }
    return firstIncompleteLeaf(goal.tasks || []);
}

/** The next n incomplete leaves after the current task. */
export function upcoming(goal, n) {
    if (!goal || !(n > 0)) return [];
    const cur = currentTask(goal);
    return leavesInOrder(goal).filter(t => !t.done && t !== cur).slice(0, n);
}

/** The n most recently completed leaves, newest first. */
export function recentlyCompleted(goal, n) {
    if (!goal || !(n > 0)) return [];
    const done = leavesInOrder(goal).map((t, i) => ({ t, i })).filter(x => x.t.done);
    done.sort((a, b) => ((b.t.done_turn ?? -1) - (a.t.done_turn ?? -1)) || (b.i - a.i));
    return done.slice(0, n).map(x => x.t);
}

/**
 * Bring a goal back to a consistent state: parents done exactly when all children are done, goal auto-done when every
 * task is done (and back to active when that stops being true), branch focus cleared when finished, and the current
 * task's clock started (when `turn` is known and the goal is active).
 */
export function settle(goal, turn) {
    const fix = (t) => {
        if (!t.children.length) return t.done;
        const all = t.children.map(fix).every(Boolean);
        if (all && !t.done) {
            t.done = true;
            const turns = t.children.map(c => c.done_turn).filter(Number.isFinite);
            t.done_turn = turns.length ? Math.max(...turns) : numOrNull(turn);
            t.done_key = null;
        } else if (!all && t.done) {
            t.done = false;
            t.done_turn = null;
            t.done_key = null;
            t.evidence = '';
        }
        return t.done;
    };
    goal.tasks.forEach(fix);
    const allDone = goal.tasks.length > 0 && goal.tasks.every(t => t.done);
    if (allDone && goal.status === 'active') {
        const turns = goal.tasks.map(t => t.done_turn).filter(Number.isFinite);
        goal.status = 'done';
        goal.done_turn = numOrNull(turn) ?? (turns.length ? Math.max(...turns) : null);
        goal.done_auto = true;
    } else if (!allDone && goal.status === 'done' && goal.done_auto) {
        goal.status = 'active';
        goal.done_turn = null;
        goal.done_auto = false;
    }
    if (goal.focus_id) {
        const f = findIn(goal.tasks, goal.focus_id)?.task;
        if (!f || f.done) goal.focus_id = null;
    }
    if (Number.isFinite(turn) && goal.status === 'active') {
        const cur = currentTask(goal);
        if (cur && cur.started_turn === null) cur.started_turn = turn;
    }
    return goal;
}

/** Start the clock on every active goal's current task. */
export function stampCurrent(goals, turn) {
    for (const g of goals?.items || []) settle(g, turn);
}

// ---------------------------------------------------------------------------------------------------------------------
// Goal CRUD

/**
 * @param {object} goals
 * @param {{title:string, description?:string, owner?:string, priority?:number|string, hidden?:boolean, status?:string, tasks?:string[]}} spec
 * @param {{turn?:number, userName?:string, options?:object}} [opts]
 * @returns {object|null} the new goal
 */
export function addGoal(goals, spec, opts = {}) {
    const o = goalOptions(goals, opts.options);
    const s = typeof spec === 'string' ? { title: spec } : (isPlainObject(spec) ? spec : {});
    const title = str(s.title, o.title_chars).trim();
    if (!title || goals.items.length >= o.max_goals) return null;
    const turn = Number.isFinite(opts.turn) ? opts.turn : 0;
    const g = {
        id: newId(goals, 'g'),
        title,
        description: str(s.description, o.description_chars).trim(),
        owner: normalizeOwner(s.owner, opts.userName, o),
        status: s.status === 'paused' ? 'paused' : 'active',
        priority: normalizePriority(s.priority, o.default_priority_level, o),
        hidden: bool(s.hidden, false),
        created_turn: turn,
        done_turn: null,
        done_auto: false,
        paused_turn: s.status === 'paused' ? turn : null,
        focus_id: null,
        tasks: [],
    };
    goals.items.push(g);
    if (Array.isArray(s.tasks)) addTasks(goals, g.id, s.tasks, { turn, options: opts.options });
    settle(g, turn);
    return g;
}

/** Patch title/description/owner/priority/hidden/status. Returns the goal or null. */
export function updateGoal(goals, goalId, patch = {}, opts = {}) {
    const g = getGoal(goals, goalId);
    if (!g || !isPlainObject(patch)) return null;
    const o = goalOptions(goals, opts.options);
    const turn = Number.isFinite(opts.turn) ? opts.turn : null;
    if (patch.title !== undefined) {
        const t = str(patch.title, o.title_chars).trim();
        if (t) g.title = t;
    }
    if (patch.description !== undefined) g.description = str(patch.description, o.description_chars).trim();
    if (patch.owner !== undefined) g.owner = normalizeOwner(patch.owner, opts.userName, o);
    if (patch.priority !== undefined) g.priority = normalizePriority(patch.priority, g.priority, o);
    if (patch.hidden !== undefined) g.hidden = bool(patch.hidden, g.hidden);
    if (patch.status !== undefined && GOAL_STATUS.includes(patch.status) && patch.status !== g.status) {
        if (patch.status === 'paused') pauseGoal(goals, goalId, { turn });
        else if (patch.status === 'active') resumeGoal(goals, goalId, { turn });
        else { g.status = 'done'; g.done_turn = turn; g.done_auto = false; g.paused_turn = null; }
    }
    settle(g, turn ?? undefined);
    return g;
}

export function removeGoal(goals, goalId) {
    const i = goals.items.findIndex(g => g.id === goalId);
    if (i === -1) return false;
    goals.items.splice(i, 1);
    return true;
}

/** Pause: the goal leaves the prompt and its urgency clock stops. */
export function pauseGoal(goals, goalId, { turn } = {}) {
    const g = getGoal(goals, goalId);
    if (!g || g.status === 'paused') return false;
    g.status = 'paused';
    g.paused_turn = numOrNull(turn);
    g.done_auto = false;
    return true;
}

/** Resume: the current task's clock is shifted by the paused span, so urgency picks up where it stopped. */
export function resumeGoal(goals, goalId, { turn } = {}) {
    const g = getGoal(goals, goalId);
    if (!g || g.status === 'active') return false;
    const cur = currentTask(g);
    if (cur && Number.isFinite(cur.started_turn) && Number.isFinite(g.paused_turn) && Number.isFinite(turn)) {
        cur.started_turn += Math.max(0, turn - g.paused_turn);
    }
    g.status = 'active';
    g.paused_turn = null;
    g.done_turn = null;
    g.done_auto = false;
    settle(g, numOrNull(turn) ?? undefined);
    return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// Task CRUD

/**
 * Add a task to a goal: top level or as a child of `parentId`, at sibling position `index` (default: end).
 * @param {{parentId?:string, index?:number, turn?:number, duration?:number, options?:object}} [opts]
 * @returns {object|null} the task
 */
export function addTask(goals, goalId, text, opts = {}) {
    const g = getGoal(goals, goalId);
    if (!g) return null;
    const o = goalOptions(goals, opts.options);
    const t = str(text, o.task_chars).trim();
    if (!t || countTasks(g.tasks) >= o.max_tasks) return null;
    let list = g.tasks;
    if (opts.parentId) {
        const p = findIn(g.tasks, opts.parentId);
        if (!p || p.depth >= o.max_depth - 1) return null;
        list = p.task.children;
    }
    const task = {
        id: newId(goals, 't'), text: t, done: false, done_turn: null, done_key: null, evidence: '',
        duration: int(opts.duration, 0, o.max_duration, Math.min(o.default_duration, o.max_duration)), started_turn: null, children: [],
    };
    const at = Number.isInteger(opts.index) ? clamp(opts.index, 0, list.length) : list.length;
    list.splice(at, 0, task);
    settle(g, opts.turn);
    return task;
}

/** Are two task texts the same task (exact after normalization, or word overlap >= threshold)? */
export function similarTasks(a, b, threshold) {
    const na = normText(a);
    const nb = normText(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    return jaccard(contentTokens(a), contentTokens(b)) >= threshold;
}

/** Add many tasks (generation), skipping near-duplicates of the goal's existing tasks and of each other. */
export function addTasks(goals, goalId, texts, opts = {}) {
    const g = getGoal(goals, goalId);
    const added = [];
    const skipped = [];
    if (!g) return { added, skipped: [...(texts || [])] };
    const o = goalOptions(goals, opts.options);
    const existing = [];
    walkTasks(g.tasks, (t) => { existing.push(t.text); });
    for (const raw of Array.isArray(texts) ? texts : []) {
        const text = str(raw, o.task_chars).trim();
        if (!text || existing.some(e => similarTasks(e, text, o.dedupe_similarity))) { skipped.push(raw); continue; }
        const t = addTask(goals, goalId, text, { ...opts, index: undefined });
        if (!t) { skipped.push(raw); continue; }
        existing.push(text);
        added.push(t);
    }
    return { added, skipped };
}

/** Edit a task's text and/or minimum duration (turns before auto-completion is allowed). */
export function editTask(goals, taskId, patch = {}, opts = {}) {
    const f = findTask(goals, taskId);
    if (!f || !isPlainObject(patch)) return null;
    const o = goalOptions(goals, opts.options);
    if (patch.text !== undefined) {
        const t = str(patch.text, o.task_chars).trim();
        if (t) f.task.text = t;
    }
    if (patch.duration !== undefined) f.task.duration = int(patch.duration, 0, o.max_duration, f.task.duration);
    return f.task;
}

/** Remove a task with all its descendants. Returns how many tasks were removed. */
export function removeTask(goals, taskId, opts = {}) {
    const f = findTask(goals, taskId);
    if (!f) return 0;
    const n = countTasks([f.task]);
    f.siblings.splice(f.index, 1);
    settle(f.goal, opts.turn);
    return n;
}

/**
 * Remove every task subtree that holds no completed task (used before regenerating a list). Completed tasks and the
 * parents that lead to them are kept. Returns how many tasks were removed.
 */
export function clearOpenTasks(goals, goalId, opts = {}) {
    const g = getGoal(goals, goalId);
    if (!g) return 0;
    let removed = 0;
    const prune = (list) => list.filter((t) => {
        if (t.children.length) t.children = prune(t.children);
        const keep = t.done || t.children.length > 0;
        if (!keep) removed += countTasks([t]);
        return keep;
    });
    g.tasks = prune(g.tasks);
    if (g.focus_id && !findIn(g.tasks, g.focus_id)) g.focus_id = null;
    settle(g, opts.turn);
    return removed;
}

/**
 * Move a task: 'up' | 'down' (among siblings), 'indent' (becomes the last child of its previous sibling),
 * 'outdent' (becomes the sibling right after its parent), or {parentId, index} (reparent; parentId null = top level).
 */
export function moveTask(goals, taskId, how, opts = {}) {
    const f = findTask(goals, taskId);
    if (!f) return false;
    const o = goalOptions(goals, opts.options);
    const { goal, task, siblings, index } = f;
    let ok = false;
    if (how === 'up' || how === 'down') {
        const j = how === 'up' ? index - 1 : index + 1;
        if (j < 0 || j >= siblings.length) return false;
        [siblings[index], siblings[j]] = [siblings[j], siblings[index]];
        ok = true;
    } else if (how === 'indent') {
        if (index === 0) return false;
        const prev = siblings[index - 1];
        if (f.depth + 1 + subtreeDepth(task) > o.max_depth) return false;
        siblings.splice(index, 1);
        prev.children.push(task);
        ok = true;
    } else if (how === 'outdent') {
        if (!f.parent) return false;
        const p = findIn(goal.tasks, f.parent.id);
        siblings.splice(index, 1);
        p.siblings.splice(p.index + 1, 0, task);
        ok = true;
    } else if (isPlainObject(how)) {
        let list = goal.tasks;
        let depth = 0;
        if (how.parentId) {
            if (how.parentId === task.id || findIn(task.children, how.parentId)) return false;
            const p = findIn(goal.tasks, how.parentId);
            if (!p) return false;
            list = p.task.children;
            depth = p.depth + 1;
        }
        if (depth + subtreeDepth(task) > o.max_depth) return false;
        siblings.splice(index, 1);
        const at = Number.isInteger(how.index) ? clamp(how.index, 0, list.length) : list.length;
        list.splice(at, 0, task);
        ok = true;
    }
    if (ok) settle(goal, opts.turn);
    return ok;
}

/**
 * Branch: focus the goal on this task (its subtree is worked first, like Objective's branch), optionally splitting it
 * into sub-steps. Pass taskId null with opts.goalId to clear the focus.
 */
export function branchTask(goals, taskId, texts = [], opts = {}) {
    if (taskId === null || taskId === undefined) {
        const g = getGoal(goals, opts.goalId);
        if (!g) return null;
        g.focus_id = null;
        settle(g, opts.turn);
        return { goal: g, task: null, added: [] };
    }
    const f = findTask(goals, taskId);
    if (!f || f.task.done) return null;
    const added = [];
    for (const raw of Array.isArray(texts) ? texts : []) {
        const t = addTask(goals, f.goal.id, raw, { parentId: taskId, turn: opts.turn, options: opts.options });
        if (t) added.push(t);
    }
    f.goal.focus_id = taskId;
    settle(f.goal, opts.turn);
    return { goal: f.goal, task: f.task, added };
}

/**
 * Mark a task done or not done. Cascades to descendants; ancestors follow via settle().
 * @param {{turn?:number, key?:{index,swipe_id,text_hash}|null, evidence?:string, options?:object}} [opts] key null = manual
 */
export function setTaskDone(goals, taskId, done, opts = {}) {
    const f = findTask(goals, taskId);
    if (!f) return false;
    const o = goalOptions(goals, opts.options);
    const turn = numOrNull(opts.turn);
    const key = normKey(opts.key);
    const mark = (t) => {
        if (done && !t.done) {
            t.done = true;
            t.done_turn = turn;
            t.done_key = key;
            t.evidence = str(opts.evidence, o.evidence_max_chars);
        } else if (!done && t.done) {
            t.done = false;
            t.done_turn = null;
            t.done_key = null;
            t.evidence = '';
            t.started_turn = null; // reopened: its clock restarts
        }
        t.children.forEach(mark);
    };
    mark(f.task);
    settle(f.goal, turn ?? undefined);
    return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// Urgency, injection, director brief

/** Turns on the current task before urgency levels 1..n, scaled by the goal's priority factor. */
export function urgencyThresholds(priority, options) {
    const o = options || resolveGoalOptions();
    const p = normalizePriority(priority, 2, o);
    const scale = [o.priority_scale_high, o.priority_scale_normal, o.priority_scale_low][p - 1];
    return o.urgency_thresholds.map(b => Math.max(1, Math.round(b * scale)));
}

/**
 * How pressing a goal is: turns spent on the current task against thresholds scaled by priority.
 * @returns {{level:number, turns:number, phrase:string, thresholds:number[]}}
 */
export function urgency(goal, turn, options) {
    const o = options || resolveGoalOptions();
    const thresholds = urgencyThresholds(goal?.priority, o);
    const phrases = o.urgency_phrases;
    const cur = goal && goal.status === 'active' ? currentTask(goal) : null;
    if (!cur) return { level: 0, turns: 0, phrase: phrases[0], thresholds };
    const started = Number.isFinite(cur.started_turn) ? cur.started_turn : turn;
    const turns = Math.max(0, (Number.isFinite(turn) ? turn : started) - started);
    const level = Math.min(phrases.length - 1, thresholds.filter(t => turns >= t).length);
    return { level, turns, phrase: phrases[level], thresholds };
}

/** Active goals ranked: most urgent first, then priority, then age. Hidden ones only when hiddenOK. */
export function rankedGoals(goals, turn, { hiddenOK = true, options } = {}) {
    const o = goalOptions(goals, options);
    return (goals?.items || [])
        .map((g, i) => ({ g, i, u: urgency(g, turn, o) }))
        .filter(x => x.g.status === 'active' && (hiddenOK || !x.g.hidden))
        .sort((a, b) => (b.u.level - a.u.level) || (a.g.priority - b.g.priority) || (a.i - b.i));
}

function goalVars(g, u, o, cur) {
    const st = goalStats(g);
    const phrase = String(u.phrase);
    return {
        owner: g.owner === 'story' ? '' : g.owner,
        owner_label: g.owner === 'story' ? o.owner_story_label : fillTemplate(o.owner_character_label, { owner: g.owner }),
        goal_title: clip(g.title, o.title_chars_in_note),
        description: g.description,
        priority: o.priority_names[g.priority - 1],
        priority_note: o.priority_notes[g.priority - 1],
        task: cur ? clip(cur.text, o.task_chars_in_note) : '',
        urgency: phrase,
        Urgency: phrase.charAt(0).toUpperCase() + phrase.slice(1),
        level: u.level,
        turns: u.turns,
        done: st.done,
        total: st.total,
    };
}

/**
 * Lines for the <undercurrent> note, each {text, pri, goal_id}. pri fits inject.js's drop-lowest-first ladder (knobs
 * pri_*); progress lines rank lowest. Empty when there is nothing to say.
 * @param {{goals:object, turn:number, hiddenOK?:boolean, options?:object}} p hiddenOK defaults to options.inject_hidden
 * @returns {{text:string, pri:number, goal_id:string}[]}
 */
export function injectionLines({ goals, turn, hiddenOK, options } = {}) {
    if (!goals?.items?.length) return [];
    const o = goalOptions(goals, options);
    const picked = rankedGoals(goals, turn, { hiddenOK: hiddenOK ?? o.inject_hidden, options }).slice(0, o.max_active_injected);
    if (!picked.length) return [];
    const out = [];
    for (const { g, u } of picked) {
        const cur = currentTask(g);
        const vars = goalVars(g, u, o, cur);
        const text = fillTemplate(cur ? o.line_template : o.line_empty_template, vars).replace(/\s*\n\s*/g, ' ');
        if (text) out.push({ text, pri: o.pri_base + u.level * o.pri_per_level + (3 - g.priority) * o.pri_per_priority, goal_id: g.id });
        const done = recentlyCompleted(g, o.inject_completed).map(t => clip(t.text, o.progress_task_chars));
        const next = upcoming(g, o.inject_upcoming).map(t => clip(t.text, o.progress_task_chars));
        if (cur && (done.length || next.length)) {
            const parts = [];
            if (done.length) parts.push(fillTemplate(o.progress_done_template, { tasks: done.join(o.list_joiner) }));
            if (next.length) parts.push(fillTemplate(o.progress_next_template, { tasks: next.join(o.list_joiner) }));
            const p = fillTemplate(o.progress_template, { goal_title: clip(g.title, o.progress_title_chars), progress: parts.filter(Boolean).join(o.progress_joiner) });
            if (p) out.push({ text: p, pri: o.progress_pri_base + u.level * o.progress_pri_per_level, goal_id: g.id });
        }
    }
    if (!out.length) return [];
    const header = String(o.header_template || '').trim();
    return header ? [{ text: header, pri: Math.max(...out.map(l => l.pri)), goal_id: '' }, ...out] : out;
}

/** Goals block for the director's user message, so it plans beats toward them. '' when there are none. */
export function directorBrief(goals, { turn = 0, hiddenOK, options } = {}) {
    const o = goalOptions(goals, options);
    if (!(o.director_max > 0)) return '';
    const ranked = rankedGoals(goals, turn, { hiddenOK: hiddenOK ?? o.inject_hidden, options }).slice(0, o.director_max);
    if (!ranked.length) return '';
    const L = [];
    if (String(o.director_header).trim()) L.push(String(o.director_header).trim());
    ranked.forEach(({ g, u }, i) => {
        const cur = currentTask(g);
        const st = goalStats(g);
        L.push(fillTemplate(o.director_goal_template, {
            n: i + 1,
            owner: g.owner === 'story' ? '' : g.owner,
            owner_tag: g.owner === 'story' ? o.director_owner_story : fillTemplate(o.director_owner_character, { owner: g.owner }),
            priority: o.priority_names[g.priority - 1],
            level: u.level,
            urgency: u.phrase,
            turns: cur ? u.turns : '',
            done: st.done,
            total: st.total,
            goal_title: g.title,
            description: g.description,
            task: cur ? cur.text : '',
            no_tasks: cur ? '' : o.director_no_tasks,
            next: upcoming(g, o.director_upcoming).map(t => t.text).join(o.list_joiner),
            recent: recentlyCompleted(g, o.director_recent).map(t => t.text).join(o.list_joiner),
        }));
    });
    return L.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------------
// Check cadence and results

/**
 * Count a received reply toward the check cadence and start the clock on current tasks.
 * @param {object} goals
 * @param {{turn:number, type?:string, options?:object}} p type = MESSAGE_RECEIVED type ('normal', 'swipe', 'regenerate', …)
 * @returns {{counted:boolean, due:boolean}}
 */
export function tickGoals(goals, { turn, type = 'normal', options } = {}) {
    const o = goalOptions(goals, options);
    let counted = !o.uncounted_types.includes(type);
    if ((type === 'swipe' || type === 'regenerate') && !o.swipes_count) counted = false;
    if (counted) goals.counters.since_check++;
    stampCurrent(goals, turn);
    const due = counted && o.check_every > 0 && goals.counters.since_check >= o.check_every && checkTargets(goals, turn).length > 0;
    return { counted, due };
}

export function resetCheckCounter(goals) {
    goals.counters.since_check = 0;
}

/** Whether a task's minimum duration (turns since it became current) has passed. */
export function durationMet(task, turn) {
    if (!task || !task.duration) return true;
    const started = Number.isFinite(task.started_turn) ? task.started_turn : turn;
    return (turn - started) >= task.duration;
}

/** The current task of every active goal (hidden ones included) whose duration is met: what a check pass asks about. */
export function checkTargets(goals, turn, { goalId = null } = {}) {
    const out = [];
    for (const g of goals?.items || []) {
        if (g.status !== 'active' || (goalId && g.id !== goalId)) continue;
        const t = currentTask(g);
        if (t && durationMet(t, turn)) out.push({ goal: g, task: t });
    }
    return out;
}

/**
 * Apply validated check results (parseCheck().accepted). The completion key is the chat message that holds the
 * evidence (evidence_index), else the latest assistant message, so editing/swiping/deleting it undoes the completion.
 * @param {{turn:number, keys?:object[], options?:object}} opts keys = chatKeys(chat)
 * @returns {object[]} tasks completed
 */
export function applyCheckResults(goals, accepted, { turn, keys = [], options } = {}) {
    const done = [];
    const lastAssistant = [...keys].reverse().find(k => k && !k.is_user && !k.is_system) || null;
    for (const r of Array.isArray(accepted) ? accepted : []) {
        const f = findTask(goals, r.task_id);
        if (!f || f.task.done) continue;
        const k = Number.isInteger(r.evidence_index) && keys[r.evidence_index] ? keys[r.evidence_index] : lastAssistant;
        const key = k ? { index: k.index, swipe_id: k.swipe_id ?? 0, text_hash: k.text_hash } : null;
        if (setTaskDone(goals, r.task_id, true, { turn, key, evidence: r.evidence, options })) done.push(f.task);
    }
    return done;
}

/**
 * Undo auto-completions whose evidence message no longer matches the chat (swiped, edited or deleted). Messages that
 * merely moved (a deletion above them, within options.reconcile_window) are re-keyed. Manual completions are left alone.
 * @param {{index:number, swipe_id:number, text_hash:string}[]} keys chatKeys(chat)
 * @returns {{changed:boolean, undone:string[]}}
 */
export function reconcileCompletions(goals, keys, { turn, options } = {}) {
    const o = goalOptions(goals, options);
    const undone = [];
    let changed = false;
    const ks = Array.isArray(keys) ? keys : [];
    const matches = (k, dk) => !!k && !k.is_system && (k.swipe_id ?? 0) === dk.swipe_id && k.text_hash === dk.text_hash;
    for (const g of goals?.items || []) {
        let touched = false;
        walkTasks(g.tasks, (t) => {
            if (!t.done || !t.done_key || t.children.length) return;
            const dk = t.done_key;
            if (matches(ks[dk.index], dk)) return;
            let moved = -1;
            for (let d = 1; d <= o.reconcile_window && moved === -1; d++) {
                for (const j of [dk.index - d, dk.index + d]) {
                    if (j >= 0 && j < ks.length && matches(ks[j], dk)) { moved = j; break; }
                }
            }
            if (moved !== -1) {
                t.done_key = { ...dk, index: moved };
            } else {
                t.done = false;
                t.done_turn = null;
                t.done_key = null;
                t.evidence = '';
                undone.push(t.id);
            }
            touched = true;
        });
        if (touched) { settle(g, turn); changed = true; }
    }
    return { changed, undone };
}

// ---------------------------------------------------------------------------------------------------------------------
// Import / export

/**
 * Convert ST Objective / SuperObjective chat metadata (chat_metadata.objective) into goals.
 * Shapes handled: {taskTree:{id, description, completed, parentId, children, duration?, elapsedMessages?}, currentObjectiveId,
 * checkFrequency, hideTasks, swipesDecrement, showCompletedTasks, completedTasksCount, showUpcomingTasks, upcomingTasksCount};
 * the legacy flat {objective:"…", tasks:[{description, completed}]}; a bare task tree; a bare array of tasks; and any of
 * these nested one level under "objective". The root's description becomes the goal title; its children the tasks.
 * @returns {{items:object[], settings:object, warnings:string[]}} items carry temporary ids (importGoals re-ids them)
 */
export function importSuperObjective(meta, { options } = {}) {
    const o = resolveGoalOptions(options);
    const warnings = [];
    const settings = {};
    if (!meta || typeof meta !== 'object') return { items: [], settings, warnings: ['No Objective data found in this chat.'] };
    let root = null;
    let m = isPlainObject(meta) ? meta : {};
    if (Array.isArray(meta)) {
        root = { description: '', children: meta };
    } else if (isPlainObject(m.taskTree)) {
        root = m.taskTree;
    } else if (typeof m.objective === 'string' || Array.isArray(m.tasks)) {
        root = { description: typeof m.objective === 'string' ? m.objective : '', children: Array.isArray(m.tasks) ? m.tasks : [] };
    } else if (isPlainObject(m.objective)) {
        return importSuperObjective(m.objective, { options });
    } else if (typeof m.description === 'string' || Array.isArray(m.children)) {
        root = m;
        m = {};
    }
    if (!root) return { items: [], settings, warnings: ['No Objective task tree found in this chat.'] };

    if (m.checkFrequency !== undefined) settings.check_every = m.checkFrequency;
    if (m.swipesDecrement !== undefined) settings.swipes_count = bool(m.swipesDecrement, false);
    if (m.showCompletedTasks !== undefined) settings.inject_completed = bool(m.showCompletedTasks) ? (m.completedTasksCount ?? o.inject_completed) : 0;
    if (m.showUpcomingTasks !== undefined) settings.inject_upcoming = bool(m.showUpcomingTasks) ? (m.upcomingTasksCount ?? o.inject_upcoming) : 0;

    const idMap = new Map();
    let seq = 0;
    const conv = (n, depth) => {
        if (typeof n === 'string') n = { description: n };
        if (!isPlainObject(n)) return null;
        const text = str(n.description ?? n.text ?? n.task ?? n.title, o.task_chars).trim();
        const kids = depth < o.max_depth - 1 ? (Array.isArray(n.children) ? n.children : []).map(c => conv(c, depth + 1)).filter(Boolean) : [];
        if (!text && !kids.length) return null;
        const tmp = `imp${++seq}`;
        if (n.id !== undefined && n.id !== null) idMap.set(String(n.id), tmp);
        return { id: tmp, text: text || '…', done: bool(n.completed ?? n.done, false), duration: int(n.duration, 0, o.max_duration, 0), children: kids };
    };
    const tasks = (Array.isArray(root.children) ? root.children : []).map(c => conv(c, 0)).filter(Boolean);
    let title = str(root.description ?? root.text ?? root.title, o.title_chars).trim();
    if (!title) {
        title = tasks[0]?.text ? clip(tasks[0].text, o.title_chars) : 'Objective';
        warnings.push('The objective had no description; its title was taken from the first task.');
    }
    const goal = { title, tasks, hidden: bool(m.hideTasks, false), owner: 'story', priority: o.default_priority_level };
    const cur = m.currentObjectiveId !== undefined && m.currentObjectiveId !== null ? idMap.get(String(m.currentObjectiveId)) : null;
    if (cur) goal.focus_id = cur;
    return { items: [goal], settings, warnings };
}

export const EXPORT_FORMAT = 'undercurrent-goals';

/** Export as a JSON string (chat settings + goals; completion keys are dropped since they only mean something here). */
export function exportGoals(goals) {
    const strip = (t) => ({ text: t.text, done: t.done, duration: t.duration, children: t.children.map(strip) });
    return JSON.stringify({
        format: EXPORT_FORMAT,
        version: 1,
        settings: goals.settings,
        items: goals.items.map(g => ({
            title: g.title, description: g.description, owner: g.owner, status: g.status, priority: g.priority, hidden: g.hidden,
            tasks: g.tasks.map(strip),
        })),
    }, null, 2);
}

/**
 * Import goals from an export (string or object), from ST Objective/SuperObjective metadata, or from a bare list.
 * Everything gets fresh ids; imported completions count as manual.
 * @param {{mode?:'merge'|'replace', turn?:number, userName?:string, options?:object}} [opts]
 * @returns {{ok:boolean, added:object[], errors:string[], warnings:string[]}}
 */
export function importGoals(goals, data, opts = {}) {
    let raw = data;
    if (typeof data === 'string') {
        try { raw = JSON.parse(data); } catch (e) { return { ok: false, added: [], errors: [`Invalid JSON: ${e.message}`], warnings: [] }; }
    }
    let items = null;
    let settings = null;
    let warnings = [];
    if (isPlainObject(raw) && (raw.format === EXPORT_FORMAT || Array.isArray(raw.items))) {
        items = raw.items;
        settings = raw.settings;
    } else if (isPlainObject(raw) && (raw.taskTree || raw.objective !== undefined || raw.tasks || raw.children)) {
        ({ items, settings, warnings } = importSuperObjective(raw, { options: opts.options }));
    } else if (Array.isArray(raw)) {
        items = raw;
    }
    if (!Array.isArray(items)) return { ok: false, added: [], errors: ['Not a goals export or Objective data.'], warnings };
    const o = goalOptions(goals, opts.options);
    // Normalize through a scratch block (keeps temporary ids, so a branch focus survives), then re-id into the target.
    const scratch = normalizeGoals({ items });
    if (opts.mode === 'replace') goals.items = [];
    if (isPlainObject(settings)) goals.settings = normalizeGoalSettings(settings, goals.settings);
    const added = [];
    const turn = Number.isFinite(opts.turn) ? opts.turn : 0;
    for (const g of scratch.items) {
        if (goals.items.length >= o.max_goals) { warnings.push(`Goal limit (${o.max_goals}) reached; the rest were skipped.`); break; }
        const idMap = new Map();
        const reid = (t) => {
            const id = newId(goals, 't');
            idMap.set(t.id, id);
            return { ...t, id, done_key: null, started_turn: null, done_turn: t.done ? turn : null, children: t.children.map(reid) };
        };
        const tasks = g.tasks.map(reid);
        const ng = {
            ...g, id: newId(goals, 'g'), owner: normalizeOwner(g.owner, opts.userName, o), created_turn: turn,
            focus_id: g.focus_id ? (idMap.get(g.focus_id) ?? null) : null,
            done_turn: g.status === 'done' ? turn : null, done_auto: false, paused_turn: g.status === 'paused' ? turn : null, tasks,
        };
        settle(ng, turn);
        goals.items.push(ng);
        added.push(ng);
    }
    return { ok: true, added, errors: [], warnings };
}

// ---------------------------------------------------------------------------------------------------------------------
// Lookup and slash-command helpers

/** Find a goal by 1-based number, id ("g3") or title (exact, then unique prefix/substring; case-insensitive). */
export function findGoal(goals, ref) {
    const items = goals?.items || [];
    if (ref === null || ref === undefined || ref === '') return null;
    const s = String(ref).trim();
    if (/^\d+$/.test(s)) return items[Number(s) - 1] || null;
    const byId = items.find(g => g.id === s);
    if (byId) return byId;
    const low = s.toLowerCase();
    const exact = items.filter(g => g.title.toLowerCase() === low);
    if (exact.length === 1) return exact[0];
    const part = items.filter(g => g.title.toLowerCase().includes(low));
    return part.length === 1 ? part[0] : null;
}

/** "2.1"-style path of a task inside its goal. */
export function taskPath(goal, taskId) {
    let path = null;
    const walk = (list, prefix) => {
        list.forEach((t, i) => {
            if (path) return;
            const p = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
            if (t.id === taskId) { path = p; return; }
            walk(t.children, p);
        });
    };
    walk(goal?.tasks || [], '');
    return path;
}

/** Resolve "2.1" (or a task id) inside a goal. */
export function resolveTaskPath(goal, ref) {
    if (!goal || ref === null || ref === undefined || ref === '') return null;
    const s = String(ref).trim();
    if (!/^\d+(\.\d+)*$/.test(s)) return findIn(goal.tasks, s)?.task || null;
    let list = goal.tasks;
    let t = null;
    for (const part of s.split('.')) {
        t = list[Number(part) - 1];
        if (!t) return null;
        list = t.children;
    }
    return t;
}

/** Plain-text listing (for /uc-goal list). Hidden goals show only their counts unless hiddenOK. */
export function listGoalsText(goals, { turn = 0, hiddenOK = false, withTasks = true, options } = {}) {
    const o = goalOptions(goals, options);
    const items = goals?.items || [];
    if (!items.length) return 'No goals yet. Add one with /uc-goal add <title>.';
    const L = [];
    items.forEach((g, i) => {
        const st = goalStats(g);
        if (g.hidden && !hiddenOK) {
            L.push(`${i + 1}. [hidden · ${g.status}] (${st.done}/${st.total} tasks done)`);
            return;
        }
        const u = urgency(g, turn, o);
        const cur = currentTask(g);
        L.push(`${i + 1}. [${g.status} · ${o.priority_names[g.priority - 1]}${g.owner !== 'story' ? ` · ${g.owner}` : ''}${g.hidden ? ' · hidden' : ''}${g.status === 'active' && cur ? ` · urgency ${u.level}` : ''}] ${g.title} (${st.done}/${st.total} done)`);
        if (withTasks) {
            walkTasks(g.tasks, (t, { depth }) => {
                L.push(`${'   '.repeat(depth + 1)}${taskPath(g, t.id)}. [${t.done ? 'x' : t === cur ? '>' : ' '}] ${t.text}${t.duration ? ` (min ${t.duration} turns)` : ''}`);
            });
        }
    });
    return L.join('\n');
}

/** Split a command string into tokens, honoring "double" and 'single' quotes. */
export function tokenize(text) {
    const out = [];
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let m;
    while ((m = re.exec(String(text ?? '')))) out.push(m[1] ?? m[2] ?? m[3]);
    return out;
}

export const GOAL_ACTIONS = ['add', 'list', 'done', 'undone', 'remove', 'pause', 'resume', 'hide', 'show'];
export const TASK_ACTIONS = ['generate', 'more', 'check'];

/**
 * Parse /uc-goal arguments.
 *   add <title> [| description]      named: owner=<name|story> priority=<name|1|2|3> hidden=on|off desc=<text>
 *   list
 *   done|undone <goal> [task]        task = "2.1" path or task id; omitted = current task (done) / last completed (undone)
 *   remove|pause|resume|hide|show <goal>
 * <goal> = number from /uc-goal list, id (g3) or (quoted) title.
 */
export function parseGoalCommand(named = {}, unnamed = '', { options } = {}) {
    const o = resolveGoalOptions(options);
    const text = String(unnamed ?? '').trim();
    const [first = ''] = text.split(/\s+/);
    const action = first.toLowerCase();
    if (!GOAL_ACTIONS.includes(action)) return { error: `Usage: /uc-goal ${GOAL_ACTIONS.join('|')} …` };
    const rest = text.slice(first.length).trim();
    if (action === 'list') return { action };
    if (action === 'add') {
        const [t, ...d] = rest.split(/\s+\|\s+|\s+::\s+/);
        const title = String(t ?? '').replace(/^["']|["']$/g, '').trim();
        if (!title) return { error: 'Usage: /uc-goal add [owner=Name] [priority=high|normal|low] [hidden=on] <title> [| description]' };
        const n = isPlainObject(named) ? named : {};
        const out = { action, title, description: String(n.desc ?? n.description ?? d.join(' | ')).trim() };
        if (n.owner !== undefined && String(n.owner).trim()) out.owner = String(n.owner).trim();
        if (n.priority !== undefined && String(n.priority).trim()) out.priority = normalizePriority(String(n.priority), o.default_priority_level, o);
        if (n.hidden !== undefined && String(n.hidden).trim()) out.hidden = bool(String(n.hidden).trim().toLowerCase(), false);
        return out;
    }
    const toks = tokenize(rest);
    if (!toks.length) return { error: `Usage: /uc-goal ${action} <goal number>${action === 'done' || action === 'undone' ? ' [task number, e.g. 2.1]' : ''}` };
    if (action === 'done' || action === 'undone') return { action, goalRef: toks[0], taskRef: toks[1] ?? null };
    return { action, goalRef: toks.join(' ') };
}

/** Parse /uc-tasks arguments: [<goal>] generate|more [count] | check. Counts default/cap from options. */
export function parseTasksCommand(unnamed = '', { options } = {}) {
    const o = resolveGoalOptions(options);
    const toks = tokenize(unnamed);
    let goalRef = null;
    let i = 0;
    if (toks[0] && !TASK_ACTIONS.includes(toks[0].toLowerCase())) { goalRef = toks[0]; i = 1; }
    const action = String(toks[i] ?? '').toLowerCase();
    if (!TASK_ACTIONS.includes(action)) return { error: 'Usage: /uc-tasks [goal number] generate|more [count] | check' };
    const out = { action, goalRef };
    if (action !== 'check') {
        const n = Number(toks[i + 1]);
        const def = action === 'more' ? o.taskgen_more_count : o.taskgen_count;
        out.count = Number.isFinite(n) && n > 0 ? Math.min(o.taskgen_max_count, Math.round(n)) : def;
    }
    return out;
}

/**
 * Execute a parsed /uc-goal command on the goals block (in place). Generation and checks are not handled here.
 * @returns {{ok:boolean, message:string, changed:boolean}}
 */
export function executeGoalCommand(goals, cmd, { turn = 0, userName = '', hiddenOK = false, options } = {}) {
    if (!cmd || cmd.error) return { ok: false, message: cmd?.error || 'Unknown command.', changed: false };
    const o = goalOptions(goals, options);
    if (cmd.action === 'list') return { ok: true, message: listGoalsText(goals, { turn, hiddenOK, options }), changed: false };
    if (cmd.action === 'add') {
        const g = addGoal(goals, cmd, { turn, userName, options });
        if (!g) return { ok: false, message: goals.items.length >= o.max_goals ? `At most ${o.max_goals} goals.` : 'A goal needs a title.', changed: false };
        return { ok: true, message: `Added goal ${goals.items.indexOf(g) + 1}: ${g.hidden ? '(hidden)' : g.title}`, changed: true };
    }
    const g = findGoal(goals, cmd.goalRef);
    if (!g) return { ok: false, message: `No goal "${cmd.goalRef}". Use /uc-goal list.`, changed: false };
    const n = goals.items.indexOf(g) + 1;
    switch (cmd.action) {
        case 'remove': removeGoal(goals, g.id); return { ok: true, message: `Removed goal ${n}.`, changed: true };
        case 'pause': return { ok: true, message: pauseGoal(goals, g.id, { turn }) ? `Paused goal ${n}.` : `Goal ${n} is already paused.`, changed: true };
        case 'resume': return { ok: true, message: resumeGoal(goals, g.id, { turn }) ? `Resumed goal ${n}.` : `Goal ${n} is already active.`, changed: true };
        case 'hide': updateGoal(goals, g.id, { hidden: true }, { turn, options }); return { ok: true, message: `Goal ${n} is hidden.`, changed: true };
        case 'show': updateGoal(goals, g.id, { hidden: false }, { turn, options }); return { ok: true, message: `Goal ${n} is visible.`, changed: true };
        case 'done':
        case 'undone': {
            const done = cmd.action === 'done';
            const t = cmd.taskRef ? resolveTaskPath(g, cmd.taskRef) : (done ? currentTask(g) : recentlyCompleted(g, 1)[0]);
            if (!t) {
                if (!cmd.taskRef && done && !g.tasks.length) {
                    updateGoal(goals, g.id, { status: 'done' }, { turn, options });
                    return { ok: true, message: `Goal ${n} marked done.`, changed: true };
                }
                return { ok: false, message: cmd.taskRef ? `Goal ${n} has no task ${cmd.taskRef}.` : `Goal ${n} has no ${done ? 'open' : 'completed'} task.`, changed: false };
            }
            setTaskDone(goals, t.id, done, { turn, options });
            const label = g.hidden && !hiddenOK ? `task ${taskPath(g, t.id)}` : `"${t.text}"`;
            return { ok: true, message: `${done ? 'Done' : 'Reopened'}: ${label} (goal ${n}).`, changed: true };
        }
        default: return { ok: false, message: 'Unknown command.', changed: false };
    }
}
