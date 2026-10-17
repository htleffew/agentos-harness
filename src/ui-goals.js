// Undercurrent — Goals & Tasks panel. Framework-free and touch-friendly (TauriTavern on Android/iOS): no drag and drop,
// every action is a button; markup is rendered to a string and events are handled by delegation on one container.
//
// The panel never touches SillyTavern or chat state directly. It talks to an `api` object of callbacks:
//   getState()                → {goals, turn, owners?: string[], userName?: string, options?: object, busy?: {gen?: string, check?: boolean}}
//   mutate(fn)                → apply fn(goals) to this chat's goals block and save (may return a promise)
//   generateTasks(goalId, more, {branchTaskId?}) → promise (hidden task-generation pass)
//   checkNow(goalId?)         → promise (hidden completion check; all goals when goalId is omitted)
//   importSO()                → promise (import ST Objective / SuperObjective data from this chat)
//   exportJson?()             → string|promise (optional; shown as Export when present)
//   importJson?()             → promise (optional; shown as Import when present)
//   confirm?(message)         → boolean|promise<boolean> (optional; defaults to yes)
//   notify?(message, kind)    → void (optional)
// Renders inside a `.uc-goals` root so goals.css can scope every rule.

import {
    addGoal, updateGoal, removeGoal, pauseGoal, resumeGoal, addTask, editTask, removeTask, moveTask, branchTask,
    setTaskDone, currentTask, urgency, goalStats, goalOptions, setGoalChatSetting, CHAT_KNOBS, GOALS_KNOBS,
} from './goals.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' };

export function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
}

function attr(name, value) {
    return value === undefined || value === null || value === false ? '' : ` ${name}="${escapeHtml(value === true ? '' : value)}"`;
}

function btn(action, icon, label, extra = {}) {
    const cls = `menu_button uc-g-btn${extra.cls ? ` ${extra.cls}` : ''}${extra.text ? ' uc-g-btn-text' : ''}`;
    return `<button type="button" class="${cls}"${attr('data-action', action)}${attr('data-task-id', extra.taskId)}${attr('title', label)}${attr('aria-label', label)}${attr('disabled', extra.disabled)}><i class="fa-solid ${icon}" aria-hidden="true"></i>${extra.text ? `<span>${escapeHtml(extra.text)}</span>` : ''}</button>`;
}

const KNOB_BY_NAME = new Map(GOALS_KNOBS.map(k => [k.key.replace(/^goals\./, ''), k]));

function renderChatSettings(goals) {
    const s = goals.settings || {};
    const rows = CHAT_KNOBS.map((name) => {
        const k = KNOB_BY_NAME.get(name);
        const id = `uc_goals_set_${name}`;
        if (k.type === 'bool') {
            return `<label class="checkbox_label uc-g-setting" for="${id}" title="${escapeHtml(k.help || '')}"><input id="${id}" type="checkbox" data-setting="${name}"${s[name] ? ' checked' : ''}><span>${escapeHtml(k.label)}</span></label>`;
        }
        return `<label class="uc-g-setting" for="${id}" title="${escapeHtml(k.help || '')}"><span>${escapeHtml(k.label)}</span><input id="${id}" class="text_pole" type="number" inputmode="numeric" data-setting="${name}" min="${k.min}" max="${k.max}" step="${k.step ?? 1}" value="${escapeHtml(s[name])}"></label>`;
    });
    return `<details class="uc-g-settings"><summary>This chat's goal settings</summary><div class="uc-g-settings-body">${rows.join('')}</div></details>`;
}

function renderTask(goal, task, ctx) {
    const { cur, ui, depth } = ctx;
    const editing = ui.editing === task.id;
    const isCur = cur && cur.id === task.id;
    const hasKids = task.children.length > 0;
    const cls = ['uc-g-task', task.done ? 'is-done' : '', isCur ? 'is-current' : '', goal.focus_id === task.id ? 'is-focus' : '', hasKids ? 'has-children' : ''].filter(Boolean).join(' ');
    const label = editing
        ? `<input class="text_pole uc-g-task-input" type="text" data-task-field="text" data-task-id="${escapeHtml(task.id)}" value="${escapeHtml(task.text)}" aria-label="Task text">`
        : `<span class="uc-g-task-text" data-action="edit-task" data-task-id="${escapeHtml(task.id)}" role="button" tabindex="0" title="Tap to edit">${escapeHtml(task.text)}</span>`;
    const meta = [];
    if (isCur) meta.push('<span class="uc-g-chip uc-g-chip-current">now</span>');
    if (goal.focus_id === task.id) meta.push('<span class="uc-g-chip">branch</span>');
    if (task.duration) meta.push(`<span class="uc-g-chip" title="Minimum turns before it can auto-complete">≥${escapeHtml(task.duration)} turns</span>`);
    if (task.done && task.evidence) meta.push(`<span class="uc-g-chip uc-g-chip-evidence" title="${escapeHtml(task.evidence)}">evidence</span>`);
    const tools = editing ? `<div class="uc-g-task-tools">
        <label class="uc-g-duration" title="Minimum turns before this task can auto-complete">min turns <input class="text_pole" type="number" inputmode="numeric" min="0" data-task-field="duration" data-task-id="${escapeHtml(task.id)}" value="${escapeHtml(task.duration)}"></label>
        ${btn('task-up', 'fa-arrow-up', 'Move up', { taskId: task.id })}
        ${btn('task-down', 'fa-arrow-down', 'Move down', { taskId: task.id })}
        ${btn('task-outdent', 'fa-outdent', 'Outdent', { taskId: task.id, disabled: depth === 0 })}
        ${btn('task-indent', 'fa-indent', 'Indent (make a sub-step of the task above)', { taskId: task.id })}
        ${btn('add-subtask', 'fa-plus', 'Add a sub-step', { taskId: task.id })}
        ${btn('branch-task', 'fa-code-branch', goal.focus_id === task.id ? 'Leave branch' : 'Branch: work this step first and generate sub-steps', { taskId: task.id, disabled: task.done })}
        ${btn('delete-task', 'fa-trash-can', 'Delete task and its sub-steps', { taskId: task.id, cls: 'uc-g-danger' })}
        ${btn('edit-done', 'fa-check', 'Done editing', { taskId: task.id })}
    </div>` : '';
    const kids = hasKids ? `<ul class="uc-g-tasks">${task.children.map(c => renderTask(goal, c, { ...ctx, depth: depth + 1 })).join('')}</ul>` : '';
    return `<li class="${cls}" data-task-id="${escapeHtml(task.id)}">
    <div class="uc-g-task-row">
        <input type="checkbox" class="uc-g-check" data-action="toggle-task" data-task-id="${escapeHtml(task.id)}"${task.done ? ' checked' : ''} aria-label="Done">
        ${label}${meta.join('')}
        ${editing ? '' : btn('edit-task', 'fa-pen', 'Edit, move or delete', { taskId: task.id, cls: 'uc-g-btn-quiet' })}
    </div>${tools}${kids}</li>`;
}

function renderGoal(goal, index, view, ui) {
    const o = view.options;
    const st = goalStats(goal);
    const masked = goal.hidden && !ui.revealed.has(goal.id);
    const statusBtn = goal.status === 'paused'
        ? btn('resume-goal', 'fa-play', 'Resume goal', { text: 'Resume' })
        : goal.status === 'active' ? btn('pause-goal', 'fa-pause', 'Pause goal', { text: 'Pause' }) : btn('resume-goal', 'fa-rotate-left', 'Reopen goal', { text: 'Reopen' });
    if (masked) {
        return `<section class="uc-g-goal is-hidden" data-goal-id="${escapeHtml(goal.id)}" data-status="${goal.status}">
    <div class="uc-g-goal-head"><span class="uc-g-num">${index + 1}</span><span class="uc-g-masked">Hidden goal · ${goal.status} · ${st.done}/${st.total} done</span></div>
    <div class="uc-g-actions">${btn('reveal-goal', 'fa-eye', 'Reveal (spoilers)', { text: 'Reveal' })}${statusBtn}${btn('delete-goal', 'fa-trash-can', 'Delete goal', { cls: 'uc-g-danger' })}</div>
</section>`;
    }
    const cur = currentTask(goal);
    const u = urgency(goal, view.turn, o);
    const owners = ['story', ...new Set([...(view.owners || []), ...(goal.owner !== 'story' ? [goal.owner] : [])])];
    const ownerOpts = owners.map(n => `<option value="${escapeHtml(n)}"${n === goal.owner ? ' selected' : ''}>${escapeHtml(n === 'story' ? 'The story' : n)}</option>`).join('');
    const prioOpts = [1, 2, 3].map(p => `<option value="${p}"${p === goal.priority ? ' selected' : ''}>${escapeHtml(o.priority_names[p - 1])}</option>`).join('');
    const busyGen = view.busy?.gen === goal.id;
    const urg = goal.status === 'active' && cur ? `<span class="uc-g-chip uc-g-urg-${u.level}" title="${escapeHtml(u.phrase)}">urgency ${u.level} · ${u.turns} turns on task</span>` : `<span class="uc-g-chip">${escapeHtml(goal.status)}</span>`;
    const tasks = goal.tasks.length
        ? `<ul class="uc-g-tasks uc-g-tasks-root">${goal.tasks.map(t => renderTask(goal, t, { cur, ui, depth: 0 })).join('')}</ul>`
        : '<p class="uc-g-empty">No tasks yet. Generate them from the card and the chat, or add your own.</p>';
    return `<section class="uc-g-goal" data-goal-id="${escapeHtml(goal.id)}" data-status="${goal.status}">
    <div class="uc-g-goal-head">
        <span class="uc-g-num">${index + 1}</span>
        <input class="text_pole uc-g-title" type="text" data-goal-field="title" value="${escapeHtml(goal.title)}" aria-label="Goal title">
    </div>
    <div class="uc-g-fields">
        <label class="uc-g-field">Pursued by <select class="text_pole" data-goal-field="owner">${ownerOpts}</select></label>
        <label class="uc-g-field">Priority <select class="text_pole" data-goal-field="priority">${prioOpts}</select></label>
        <label class="checkbox_label uc-g-field" title="Hidden goals are masked here (no spoilers) but still steer the story when the global setting allows."><input type="checkbox" data-goal-field="hidden"${goal.hidden ? ' checked' : ''}><span>Hidden</span></label>
        ${urg}<span class="uc-g-chip">${st.done}/${st.total} done</span>
    </div>
    <textarea class="text_pole uc-g-desc" rows="2" data-goal-field="description" placeholder="Details for the planner (optional)" aria-label="Goal details">${escapeHtml(goal.description)}</textarea>
    ${tasks}
    <div class="uc-g-addrow">
        <input class="text_pole" type="text" data-role="new-task" placeholder="Add a task: what the world or a character does" aria-label="New task">
        ${btn('add-task', 'fa-plus', 'Add task')}
    </div>
    <div class="uc-g-actions">
        ${btn('generate', busyGen ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles', 'Generate tasks from the card and the chat', { text: goal.tasks.length ? 'Regenerate' : 'Generate tasks', disabled: busyGen })}
        ${btn('generate-more', 'fa-list-ol', 'Generate more tasks (no duplicates)', { text: 'More', disabled: busyGen || !goal.tasks.length })}
        ${btn('check-goal', view.busy?.check ? 'fa-spinner fa-spin' : 'fa-clipboard-check', 'Check whether the current task happened', { text: 'Check', disabled: !!view.busy?.check || !cur })}
        ${goal.focus_id ? btn('clear-branch', 'fa-code-merge', 'Leave branch', { text: 'Leave branch' }) : ''}
        ${goal.hidden ? btn('conceal-goal', 'fa-eye-slash', 'Mask again', { text: 'Mask' }) : ''}
        ${statusBtn}
        ${btn('delete-goal', 'fa-trash-can', 'Delete goal', { cls: 'uc-g-danger' })}
    </div>
</section>`;
}

/**
 * Render the whole panel as an HTML string.
 * @param {object} view api.getState() result (options = resolved global options; chat settings are layered here)
 * @param {{revealed?:Set<string>, editing?:string|null}} [ui] panel-local state (never persisted)
 */
export function renderGoalsPanel(view, ui = {}) {
    const goals = view?.goals || { items: [], settings: {} };
    const v = { ...view, goals, options: goalOptions(goals, view?.options) };
    const u = { revealed: ui.revealed || new Set(), editing: ui.editing || null };
    const top = `<div class="uc-g-toolbar">
    <div class="uc-g-addrow uc-g-newgoal">
        <input class="text_pole" type="text" data-role="new-goal" placeholder="New goal for the story or a character" aria-label="New goal">
        ${btn('add-goal', 'fa-plus', 'Add goal', { text: 'Add' })}
    </div>
    <div class="uc-g-actions">
        ${btn('check-all', v.busy?.check ? 'fa-spinner fa-spin' : 'fa-clipboard-check', 'Check every active goal now', { text: 'Check now', disabled: !!v.busy?.check })}
        ${btn('import-so', 'fa-file-import', 'Import from Objective / Super Objective in this chat', { text: 'Import Objective' })}
        ${view?.canExport ? btn('export-json', 'fa-download', 'Export goals as JSON', { text: 'Export' }) : ''}
        ${view?.canImport ? btn('import-json', 'fa-upload', 'Import goals from JSON', { text: 'Import' }) : ''}
    </div>
</div>`;
    const list = goals.items.length
        ? goals.items.map((g, i) => renderGoal(g, i, v, u)).join('')
        : '<p class="uc-g-empty">No goals yet. A goal is something the story or a character works toward; the tasks are what the world does to get there. Your own choices are never scripted.</p>';
    return `<div class="uc-goals-inner">${top}${renderChatSettings(goals)}<div class="uc-g-list">${list}</div></div>`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Actions (pure dispatcher: testable without a DOM)

async function confirmWith(api, message) {
    if (typeof api.confirm !== 'function') return true;
    try { return !!(await api.confirm(message)); } catch { return false; }
}

/**
 * Perform one panel action through the api.
 * @param {object} api
 * @param {{action:string, goalId?:string, taskId?:string, value?:any, checked?:boolean, field?:string, setting?:string}} a
 * @param {{revealed:Set<string>, editing:string|null}} ui mutable panel state
 * @returns {Promise<boolean>} whether the panel should re-render
 */
export async function dispatchGoalAction(api, a, ui) {
    const view = api.getState() || {};
    const turn = view.turn ?? 0;
    const userName = view.userName || '';
    const options = view.options;
    const mutate = fn => Promise.resolve(api.mutate(fn));
    switch (a.action) {
        case 'add-goal': {
            const title = String(a.value ?? '').trim();
            if (!title) { api.notify?.('Type the goal in the box first, then press Add.', 'warning'); return false; }
            let created = null;
            let limit = 0;
            let ran = false;
            await mutate((g) => {
                ran = true;
                limit = goalOptions(g, options).max_goals;
                created = addGoal(g, { title }, { turn, userName, options });
            });
            if (!ran) api.notify?.('Open a chat first: goals belong to a chat.', 'warning');
            else if (!created) api.notify?.(`This chat already has ${limit} goals, the most allowed. Delete or finish one, or raise "Goals per chat" in All settings.`, 'warning');
            return true;
        }
        case 'goal-field': {
            const patch = { [a.field]: a.field === 'hidden' ? !!a.checked : a.value };
            if (a.field === 'hidden' && a.checked) ui.revealed.delete(a.goalId);
            await mutate(g => updateGoal(g, a.goalId, patch, { turn, userName, options }));
            return a.field !== 'title' && a.field !== 'description';
        }
        case 'setting': {
            await mutate((g) => { setGoalChatSetting(g, a.setting, a.checked ?? a.value); });
            return true;
        }
        case 'delete-goal':
            if (!(await confirmWith(api, 'Delete this goal and all its tasks?'))) return false;
            await mutate(g => removeGoal(g, a.goalId));
            return true;
        case 'pause-goal': await mutate(g => pauseGoal(g, a.goalId, { turn })); return true;
        case 'resume-goal': await mutate(g => resumeGoal(g, a.goalId, { turn })); return true;
        case 'reveal-goal': ui.revealed.add(a.goalId); return true;
        case 'conceal-goal': ui.revealed.delete(a.goalId); return true;
        case 'add-task': {
            const text = String(a.value ?? '').trim();
            if (!text) { api.notify?.('Type the task in the box first, then press Add.', 'warning'); return false; }
            let created = null;
            let ran = false;
            await mutate((g) => { ran = true; created = addTask(g, a.goalId, text, { turn, options }); });
            if (ran && !created) api.notify?.('That task was not added: it repeats an existing task, or the goal is at its task limit.', 'warning');
            return true;
        }
        case 'add-subtask': {
            let created = null;
            await mutate((g) => { created = addTask(g, a.goalId, a.value || '…', { parentId: a.taskId, turn, options }); });
            ui.editing = created?.id || null;
            return true;
        }
        case 'toggle-task': await mutate(g => setTaskDone(g, a.taskId, !!a.checked, { turn, options })); return true;
        case 'edit-task': ui.editing = a.taskId; return true;
        case 'edit-done': ui.editing = null; return true;
        case 'task-field':
            await mutate(g => editTask(g, a.taskId, { [a.field]: a.value }, { options }));
            return a.field === 'duration';
        case 'task-up': await mutate(g => moveTask(g, a.taskId, 'up', { turn, options })); return true;
        case 'task-down': await mutate(g => moveTask(g, a.taskId, 'down', { turn, options })); return true;
        case 'task-indent': await mutate(g => moveTask(g, a.taskId, 'indent', { turn, options })); return true;
        case 'task-outdent': await mutate(g => moveTask(g, a.taskId, 'outdent', { turn, options })); return true;
        case 'delete-task':
            if (!(await confirmWith(api, 'Delete this task and its sub-steps?'))) return false;
            await mutate(g => removeTask(g, a.taskId, { turn }));
            if (ui.editing === a.taskId) ui.editing = null;
            return true;
        case 'branch-task': {
            const goal = (view.goals?.items || []).find(g => g.id === a.goalId);
            if (goal && goal.focus_id === a.taskId) {
                await mutate(g => branchTask(g, null, [], { goalId: a.goalId, turn }));
                return true;
            }
            await mutate(g => branchTask(g, a.taskId, [], { turn, options }));
            const task = findTaskIn(goal, a.taskId);
            if (task && !task.children.length && typeof api.generateTasks === 'function') {
                await api.generateTasks(a.goalId, false, { branchTaskId: a.taskId });
            }
            return true;
        }
        case 'clear-branch': await mutate(g => branchTask(g, null, [], { goalId: a.goalId, turn })); return true;
        case 'generate': {
            const goal = (view.goals?.items || []).find(g => g.id === a.goalId);
            if (goal?.tasks?.length && !(await confirmWith(api, 'Replace the open tasks with a new list? Completed tasks are kept.'))) return false;
            await api.generateTasks(a.goalId, false, {});
            return true;
        }
        case 'generate-more': await api.generateTasks(a.goalId, true, {}); return true;
        case 'check-goal': await api.checkNow(a.goalId); return true;
        case 'check-all': await api.checkNow(); return true;
        case 'import-so': await api.importSO(); return true;
        case 'export-json': if (typeof api.exportJson === 'function') await api.exportJson(); return false;
        case 'import-json': if (typeof api.importJson === 'function') await api.importJson(); return true;
        default: return false;
    }
}

function findTaskIn(goal, id) {
    let hit = null;
    const walk = (list) => { for (const t of list || []) { if (t.id === id) { hit = t; return; } walk(t.children); if (hit) return; } };
    walk(goal?.tasks);
    return hit;
}

// ---------------------------------------------------------------------------------------------------------------------
// DOM wiring (small on purpose)

function closestData(el, attrName) {
    const hit = el && typeof el.closest === 'function' ? el.closest(`[${attrName}]`) : null;
    return hit ? hit.getAttribute(attrName) : null;
}

/** Translate a DOM event into an action descriptor (or null). Exported for tests with fake elements. */
export function actionFromEvent(ev) {
    const t = ev?.target;
    if (!t) return null;
    const goalId = closestData(t, 'data-goal-id');
    const taskId = t.getAttribute?.('data-task-id') || closestData(t, 'data-task-id');
    if (ev.type === 'change' || ev.type === 'input') {
        const setting = t.getAttribute?.('data-setting');
        if (setting) return { action: 'setting', setting, value: t.value, checked: t.type === 'checkbox' ? !!t.checked : undefined };
        const gf = t.getAttribute?.('data-goal-field');
        if (gf) return { action: 'goal-field', goalId, field: gf, value: t.value, checked: !!t.checked };
        const tf = t.getAttribute?.('data-task-field');
        if (tf) return { action: 'task-field', goalId, taskId, field: tf, value: t.value };
        if (t.getAttribute?.('data-action') === 'toggle-task') return { action: 'toggle-task', goalId, taskId, checked: !!t.checked };
        return null;
    }
    if (ev.type === 'keydown') {
        if (ev.key !== 'Enter') return null;
        const role = t.getAttribute?.('data-role');
        if (role === 'new-goal') return { action: 'add-goal', value: t.value };
        if (role === 'new-task') return { action: 'add-task', goalId, value: t.value };
        if (t.getAttribute?.('data-task-field') === 'text') return { action: 'edit-done', goalId, taskId };
        if (t.getAttribute?.('data-action') === 'edit-task') return { action: 'edit-task', goalId, taskId };
        return null;
    }
    if (ev.type === 'click') {
        const el = typeof t.closest === 'function' ? t.closest('[data-action]') : null;
        if (!el) return null;
        const action = el.getAttribute('data-action');
        if (action === 'toggle-task') return null; // handled on change
        const out = { action, goalId, taskId: el.getAttribute('data-task-id') || taskId };
        if (action === 'add-goal' || action === 'add-task') {
            const scope = action === 'add-goal' ? el.closest('.uc-g-toolbar') : el.closest('[data-goal-id]');
            const input = scope?.querySelector(action === 'add-goal' ? '[data-role="new-goal"]' : '[data-role="new-task"]');
            out.value = input?.value ?? '';
        }
        return out;
    }
    return null;
}

/** Panel actions that wait on a hidden model call, a popup or an import; only these are serialized. */
export const SLOW_ACTIONS = new Set(['generate', 'generate-more', 'branch-task', 'check-goal', 'check-all', 'import-so', 'import-json', 'export-json', 'delete-goal', 'delete-task']);

/**
 * Mount the panel into a container element. Returns {refresh, destroy}.
 * @param {HTMLElement} container
 * @param {object} api see the top of this file
 */
export function mountGoalsPanel(container, api) {
    const ui = { revealed: new Set(), editing: null };
    // Only slow actions (hidden model calls, imports) are serialized. Quick edits such as adding a goal never wait on
    // them, and a slow action pressed while another runs says so instead of silently doing nothing.
    let busy = false;
    if (container.classList && !container.classList.contains('uc-goals')) container.classList.add('uc-goals');
    const refresh = () => {
        try {
            container.innerHTML = renderGoalsPanel(api.getState() || {}, ui);
        } catch (e) {
            container.innerHTML = `<p class="uc-g-empty">Goals panel error: ${escapeHtml(e?.message || e)}</p>`;
        }
    };
    const handler = async (ev) => {
        const a = actionFromEvent(ev);
        if (!a) return;
        if (ev.type === 'keydown' || ev.type === 'click') ev.preventDefault?.();
        const slow = SLOW_ACTIONS.has(a.action);
        if (slow && busy) { api.notify?.('Still working on the last request; try again when it finishes.', 'info'); return; }
        if (slow) busy = true;
        try {
            if (await dispatchGoalAction(api, a, ui)) refresh();
        } catch (e) {
            api.notify?.(e?.message || String(e), 'error');
            refresh();
        } finally {
            if (slow) busy = false;
        }
    };
    const types = ['click', 'change', 'keydown'];
    for (const t of types) container.addEventListener(t, handler);
    refresh();
    return {
        refresh,
        ui,
        destroy() { for (const t of types) container.removeEventListener(t, handler); },
    };
}

/**
 * Open the panel in a SillyTavern popup (mobile-friendly: large, scrollable). Resolves when the popup closes.
 * @param {object} api
 * @param {{Popup?:Function, POPUP_TYPE?:object, document?:Document}} [deps] defaults to SillyTavern.getContext()
 */
export async function openGoalsPopup(api, deps = {}) {
    const doc = deps.document || globalThis.document;
    const ctx = deps.Popup ? deps : (globalThis.SillyTavern?.getContext?.() || {});
    if (!doc || !ctx.Popup) throw new Error('Popup API unavailable');
    const el = doc.createElement('div');
    el.className = 'uc-goals uc-goals-popup';
    const panel = mountGoalsPanel(el, api);
    const popup = new ctx.Popup(el, ctx.POPUP_TYPE.TEXT, '', { wide: true, large: true, allowVerticalScrolling: true, okButton: 'Close' });
    api.onPanelMounted?.(panel);
    try {
        await popup.show();
    } finally {
        panel.destroy();
        api.onPanelMounted?.(null);
    }
}
