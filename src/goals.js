// Character Goals. One goal for {{char}} per chat, with repeatable actions and one-time steps.
// The goal and its lists are kept in the chat. What has been sent and what is done is read from the records on the
// replies, so it follows swipes, deletes and branches like everything else.
import { ctx, KEY } from './st.js';
import { chatState, saveChatState, settings, saveSettings } from './store.js';
import { rollInt } from './books.js';
import { newId } from './events.js';

export const GOAL_WORLD = 'Roleplay Instructions character goal';
export const isGoal = e => e?.world === GOAL_WORLD;

const clean = t => String(t ?? '').replace(/\s+/g, ' ').trim().replace(/[.]+$/, '');
const num = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

export function blankGoal() {
    return { on: false, goal: '', goalDoneManual: false, actions: [], steps: [], goalLine: true, chance: 35, waitMin: 6, waitMax: 10, autoDone: true, whenDone: 'stop' };
}

/** This chat's goal. Returns null when no chat is open. */
export function goals() {
    const cs = chatState();
    if (!cs) return null;
    if (!cs.goals || typeof cs.goals !== 'object') cs.goals = blankGoal();
    const g = cs.goals;
    const d = blankGoal();
    for (const k of Object.keys(d)) if (g[k] === undefined) g[k] = d[k];
    for (const list of ['actions', 'steps']) {
        if (!Array.isArray(g[list])) g[list] = [];
        g[list] = g[list].filter(t => t && String(t.text || '').trim()).map(t => ({ ...t, id: String(t.id || newId()), text: String(t.text), on: t.on !== false }));
    }
    g.chance = num(g.chance, 0, 100, 35);
    g.waitMin = num(g.waitMin, 0, 200, 6);
    g.waitMax = Math.max(g.waitMin, num(g.waitMax, 0, 200, 10));
    return g;
}

export function saveGoals() { saveChatState(); }

/** The World Info entry that carries the goal order. It is made on the fly for each scan and is in no lorebook. */
export function goalEntry() {
    return {
        uid: 0, world: GOAL_WORLD, comment: 'Character goal', content: 'character goal', key: [], keysecondary: [],
        constant: true, vectorized: false, selective: true, selectiveLogic: 0, addMemo: true, order: 100, position: 4, depth: 1, role: 0,
        disable: false, ignoreBudget: true, excludeRecursion: true, preventRecursion: true, delayUntilRecursion: 0,
        probability: 100, useProbability: false, group: '', groupOverride: false, groupWeight: 100,
        scanDepth: null, caseSensitive: null, matchWholeWords: null, useGroupScoring: null, automationId: '',
        sticky: null, cooldown: null, delay: null, triggers: [], outletName: '', displayIndex: 0,
        characterFilter: { isExclude: false, names: [], tags: [] }, extensions: { ri: { type: 'goal' } },
    };
}

/**
 * What the chat's records say about the goal, up to the reply that is about to be written.
 * done: step id -> { quote, id of the reply }. lastSent: task id -> { reply number, wait }.
 * pending: the one-time step sent with the newest reply that has not happened yet, or null.
 */
export function goalProgress(type = 'normal') {
    const chat = ctx().chat || [];
    let end = chat.length;
    if (type === 'swipe' || type === 'continue') end -= 1;
    let replies = 0;
    const done = new Map();
    const lastSent = new Map();
    let pending = null;
    for (let i = 0; i < end; i++) {
        const m = chat[i];
        if (!m || m.is_user || m.is_system) continue;
        if (i === 0) continue;
        replies++;
        pending = null;
        for (const it of m.extra?.[KEY]?.items || []) {
            const task = it.goalTask;
            if (!task) continue;
            lastSent.set(task.id, { reply: replies, wait: Number(task.wait) || 0 });
            if (task.type !== 'step') continue;
            if (it.status === 'done') done.set(task.id, { quote: it.quote || '', mesId: i });
            else if (!it.noCheck) pending = { id: task.id, misses: it.misses || 0 };
        }
    }
    return { next: replies + 1, done, lastSent, pending };
}

export const stepDone = (step, p) => !!step.doneManual || p.done.has(step.id);

export function goalDone(g, p) {
    return !!g.goalDoneManual || (g.autoDone && g.steps.length > 0 && g.steps.every(s => stepDone(s, p)));
}

/**
 * The goal order for the reply that is about to be written, or null when nothing is to be sent.
 * Returns { version, misses, task, checkText, noCheck }.
 */
export function buildGoalOrder(g, p, opts = {}) {
    const goal = clean(g?.goal);
    if (!g?.on || !goal || goalDone(g, p)) return null;
    const checking = settings().check.mode !== 'off';
    let task = null;
    let misses = 0;

    // A one-time step that was sent and has not happened yet is sent again until it happens.
    const waiting = checking && p.pending ? g.steps.find(s => s.id === p.pending.id && s.on && !stepDone(s, p)) : null;
    if (waiting) {
        task = { type: 'step', id: waiting.id, text: clean(waiting.text) };
        misses = Math.min(2, p.pending.misses + 1);
    } else if (!opts.noNewTask && rollInt(100) < g.chance) {
        const steps = g.steps.filter(s => s.on && !stepDone(s, p)).map(s => ({ type: 'step', id: s.id, text: clean(s.text) }));
        const actions = g.actions.filter(a => a.on).filter(a => { const l = p.lastSent.get(a.id); return !l || p.next - l.reply > l.wait; })
            .map(a => ({ type: 'action', id: a.id, text: clean(a.text), wait: g.waitMin + rollInt(g.waitMax - g.waitMin + 1) }));
        const pool = [...steps, ...actions];
        if (pool.length) task = pool[rollInt(pool.length)];
    }
    if (!task && !g.goalLine) return null;

    const goalText = `{{char}}'s goal: ${goal}`;
    if (!task) return { version: `{{char}} keeps working toward this goal in what {{char.they}} says and does. ${goalText}.`, misses: 0, task: null, checkText: null, noCheck: true };
    const order = `{{char}} must ${task.text}. How it happens is up to you; it must happen.`;
    return {
        version: g.goalLine ? `${order} This serves ${goalText}.` : order,
        misses, task, checkText: `{{char}} must ${task.text}.`,
        noCheck: !(task.type === 'step' && checking),
    };
}

/** Mark a one-time step done by hand, or undo that (also undoes a "done" found by the check). */
export function setStepDone(stepId, isDone) {
    const g = goals();
    const step = g?.steps.find(s => s.id === stepId);
    if (!step) return;
    step.doneManual = !!isDone;
    if (!isDone) {
        for (const m of ctx().chat || []) {
            for (const it of m.extra?.[KEY]?.items || []) if (it.goalTask?.id === stepId && it.status === 'done') { it.status = 'sent'; it.quote = ''; it.noCheck = true; }
        }
        try { ctx().saveChat?.(); } catch { /* saved with the next change */ }
    }
    saveGoals();
}

// ---------- the list of saved goals (kept in the extension's settings, shared by all chats) ----------

export function library() {
    const st = settings();
    if (!Array.isArray(st.goalLibrary)) st.goalLibrary = [];
    return st.goalLibrary;
}

export function saveToLibrary(name) {
    const g = goals();
    if (!g) return;
    const lib = library();
    const copy = { name, goal: g.goal, actions: g.actions.map(a => ({ text: a.text })), steps: g.steps.map(s => ({ text: s.text })) };
    const i = lib.findIndex(x => x.name === name);
    if (i >= 0) lib[i] = copy; else lib.push(copy);
    saveSettings();
}

/** Start a saved goal in this chat. Its steps start as not done. */
export function loadFromLibrary(name) {
    const g = goals();
    const saved = library().find(x => x.name === name);
    if (!g || !saved) return false;
    g.goal = saved.goal;
    g.goalDoneManual = false;
    g.actions = (saved.actions || []).map(a => ({ id: newId(), text: a.text, on: true }));
    g.steps = (saved.steps || []).map(s => ({ id: newId(), text: s.text, on: true }));
    g.loaded = name;
    saveGoals();
    return true;
}

/** When the goal is done and "start the next goal from my list" is chosen: load the one after the current one. */
export function advanceIfDone() {
    const g = goals();
    if (!g || !g.on || g.whenDone !== 'next') return false;
    if (!goalDone(g, goalProgress('normal'))) return false;
    const lib = library();
    const i = lib.findIndex(x => x.name === g.loaded);
    const next = lib[i + 1];
    return next ? loadFromLibrary(next.name) : false;
}
