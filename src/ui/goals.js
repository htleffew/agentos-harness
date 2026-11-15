// Character Goals tab: one goal for {{char}} in this chat, repeatable actions, one-time steps.
import { h, button, toggle, select, numberInput, textInput, textArea, field, section, versionText, chip } from './dom.js';
import { goals, saveGoals, goalProgress, stepDone, goalDone, setStepDone, library, saveToLibrary, loadFromLibrary, blankGoal } from '../goals.js';
import { settings } from '../store.js';
import { validateVersion, swapNames } from '../validate.js';
import { writeGoal } from '../writer.js';
import { contextField } from './context.js';
import { newId } from '../events.js';
import { toast, confirmBox, inputBox, isChatOpen, names } from '../st.js';

const onOff = (value, onChange) => select([{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], value ? 'on' : 'off', v => onChange(v === 'on'));

/** Checks on a task: {{user}} must not act, and tasks stay short and loose. */
function taskFlags(text) {
    const { blocks, checks } = validateVersion(`{{char}} must ${text}`);
    const warns = [];
    const words = String(text).replace(/\{\{[^}]*\}\}/g, 'x').trim().split(/\s+/).filter(Boolean).length;
    if (words > 8) warns.push(`${words} words. Shorten it to 8 or fewer: a verb, who it is done to, and at most a loose manner.`);
    const detail = String(text).match(/\b(while|during|tonight|today|tomorrow|morning|evening|night|at the|in the|on the|wearing|dress|shirt|restaurant|kitchen|bedroom|park|car)\b/i);
    if (detail) warns.push(`"${detail[0]}" ties this to a place, time or object. Loose tasks fit any scene: "compliment {{user}}" works better than a compliment about one thing in one place.`);
    return (blocks.length || checks.length || warns.length) ? h('div', { class: 'ri-flags' }, blocks.map(b => h('div', { class: 'ri-flag ri-flag-block' }, `Must fix: ${b}`)), checks.map(c => h('div', { class: 'ri-flag ri-flag-check' }, `Check: ${c}`)), warns.map(w => h('div', { class: 'ri-flag ri-flag-warn' }, w))) : null;
}

function taskList(g, key, ui, redraw, rowExtras) {
    const list = h('div', { class: 'ri-versions' });
    g[key].forEach((t, i) => {
        if (ui.editing === t.id) {
            let value = t.text;
            const box = textInput(value, v => { value = v; });
            list.appendChild(h('div', { class: 'ri-version ri-version-editing' }, box, h('div', { class: 'ri-row ri-row-tight' },
                button('Done', () => { if (value.trim()) { t.text = swapNames(value.trim()).text; saveGoals(); } ui.editing = ''; redraw(); }, { kind: 'primary' }),
                button('Cancel', () => { ui.editing = ''; redraw(); }, { kind: 'ghost' }))));
            return;
        }
        const tick = h('input', { type: 'checkbox', class: 'ri-check', checked: t.on, title: 'Tick to let it be sent', onchange: () => { t.on = tick.checked; saveGoals(); } });
        const extras = rowExtras(t);
        list.appendChild(h('div', { class: 'ri-version' },
            h('label', { class: 'ri-vpick' }, tick, h('span', { class: 'ri-vbody' }, versionText(t.text), ' ', extras.chip)),
            extras.note, taskFlags(t.text),
            h('div', { class: 'ri-row ri-row-tight' }, extras.buttons,
                button('Edit', () => { ui.editing = t.id; redraw(); }, { kind: 'ghost' }),
                button('Delete', () => { g[key].splice(i, 1); saveGoals(); redraw(); }, { kind: 'danger' }))));
    });
    if (!g[key].length) list.appendChild(h('div', { class: 'ri-empty' }, key === 'steps' ? 'No one-time steps yet. Type one below, for example: tell {{user}} a secret' : 'No repeatable actions yet. Type one below, for example: compliment {{user}}'));
    const addBox = textInput(ui[`add_${key}`] || '', v => { ui[`add_${key}`] = v; }, { placeholder: key === 'steps' ? 'Type a one-time step, for example: tell {{user}} a secret' : 'Type a repeatable action, for example: compliment {{user}}' });
    const add = () => {
        const text = swapNames(String(ui[`add_${key}`] || '').trim().replace(/[.]+$/, '')).text;
        if (!text) { toast('info', 'Type it first.'); return; }
        g[key].push({ id: newId(), text, on: true });
        ui[`add_${key}`] = ''; saveGoals(); redraw();
    };
    addBox.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); add(); } });
    return [list, h('div', { class: 'ri-control' }, addBox), h('div', { class: 'ri-row' }, button(key === 'steps' ? 'Add this step' : 'Add this action', add))];
}

export function renderGoals(body, app) {
    if (!isChatOpen()) return;
    const g = goals();
    const ui = app.goalUi || (app.goalUi = { editing: '', ai: null });
    const redraw = () => app.render();
    const p = goalProgress('normal');
    const isDone = goalDone(g, p);
    const n = names();

    body.appendChild(h('div', { class: 'ri-intro' }, `A goal gives ${n.char} something to work toward in this chat. The goal goes with every reply. Now and then one small task is added as an order: a repeatable action, or a one-time step. One-time steps can happen in any order and are ticked off when the reply shows them. Goals are only ever for the character; you write your own.`));
    body.appendChild(h('div', { class: 'ri-card ri-setcard' }, h('div', { class: 'ri-card-top' },
        h('div', { class: 'ri-h2' }, 'Goal for this chat'),
        h('label', { class: 'ri-switch-row' }, h('span', {}, g.on ? 'On' : 'Off'), toggle(g.on, v => { g.on = v; saveGoals(); redraw(); }, 'Turn the goal on or off for this chat'))),
    g.on && !g.goal.trim() ? h('div', { class: 'ri-help' }, 'Type a goal below, or press "Write a goal with AI". Nothing is sent until there is a goal.') : null));

    // ----- The goal -----
    body.appendChild(section('The goal',
        field('What the character is working toward', 'One plain sentence. Keep it loose, for example: {{char}} wants {{user}} to trust {{char.them}}.',
            textArea(g.goal, v => { g.goal = v; saveGoals(); }, { rows: 2, placeholder: 'Example: {{char}} wants {{user}} to trust {{char.them}}.' })),
        h('div', { class: 'ri-chips' }, isDone ? chip('Done: nothing more is sent for this goal', 'ri-chip-done') : g.goal.trim() ? chip(g.on ? 'In progress' : 'Turned off', g.on ? 'ri-chip-group' : '') : chip('No goal yet', 'ri-chip-warn')),
        h('div', { class: 'ri-row' },
            button('Write a goal with AI', () => { ui.ai = { about: '', busy: false, error: '', result: null }; redraw(); }, { kind: 'primary' }),
            button(g.goalDoneManual ? 'Start this goal again' : 'Mark the goal done', () => { g.goalDoneManual = !g.goalDoneManual; saveGoals(); redraw(); }, { title: 'A goal that is done sends nothing more' }),
            button('Save this goal to my list', async () => {
                if (!g.goal.trim()) { toast('info', 'Type a goal first.'); return; }
                const name = await inputBox('Name for this goal in your list:', g.loaded || '');
                if (!name) return;
                saveToLibrary(name); g.loaded = name; saveGoals(); toast('success', 'Saved to your list.'); redraw();
            }, { kind: 'ghost', title: 'Keep the goal, its actions and its steps to use in another chat' })),
        ui.ai ? aiBox(g, ui, redraw) : null,
        library().length ? field('Start a goal from my list', 'Replaces the goal, actions and steps of this chat. Steps start as not done.',
            select([{ value: '', label: 'Choose a saved goal' }, ...library().map(x => ({ value: x.name, label: x.name }))], '', async (v) => {
                if (!v) return;
                if (g.goal.trim() && !await confirmBox(`Replace this chat's goal with "${v}"?`)) { redraw(); return; }
                loadFromLibrary(v); g.on = true; saveGoals(); redraw();
            })) : null));

    // ----- One-time steps -----
    body.appendChild(section('One-time steps (each happens once, in any order)',
        h('div', { class: 'ri-help' }, settings().check.mode === 'off' ? 'Checking is off in Settings, so steps are not ticked off on their own. Press "Mark done" yourself.' : 'When a step is sent, it is sent again with every reply until the reply shows it happened. Then it is ticked off, with the words that show it.'),
        taskList(g, 'steps', ui, redraw, (t) => {
            const d = p.done.get(t.id);
            const done = stepDone(t, p);
            const waiting = p.pending?.id === t.id && !done;
            return {
                chip: done ? chip('Done', 'ri-chip-done') : waiting ? chip('Sent: waiting for it to happen', 'ri-chip-warn') : chip('Not done yet'),
                note: d?.quote ? h('div', { class: 'ri-help' }, `Shown by reply ${d.mesId}: "${d.quote}"`) : null,
                buttons: button(done ? 'Undo done' : 'Mark done', () => { setStepDone(t.id, !done); redraw(); }, { kind: 'ghost' }),
            };
        })));

    // ----- Repeatable actions -----
    body.appendChild(section('Repeatable actions (sent again and again)',
        h('div', { class: 'ri-help' }, 'Sent for one reply, then left alone for a while. They are not checked.'),
        taskList(g, 'actions', ui, redraw, (t) => {
            const l = p.lastSent.get(t.id);
            const ready = !l || p.next - l.reply > l.wait;
            return { chip: !l ? chip('Not sent yet') : ready ? chip('Ready to be sent again') : chip(`Waiting ${l.wait - (p.next - l.reply) + 1} more ${l.wait - (p.next - l.reply) + 1 === 1 ? 'reply' : 'replies'}`, 'ri-chip-wait'), note: null, buttons: null };
        })));

    // ----- How often -----
    body.appendChild(section('How often',
        h('div', { class: 'ri-grid2' },
            field('Send the goal with every reply', 'On: the goal line goes with every reply, so the character keeps it in view. Off: the goal is only sent together with a task.', onOff(g.goalLine, v => { g.goalLine = v; saveGoals(); })),
            field('Chance to add a task each reply (%)', 'At most one task is sent at a time. 35 adds a task to about 1 reply in 3.', numberInput(g.chance, { min: 0, max: 100, unit: '%' }, v => { g.chance = v; saveGoals(); })),
            field('A repeatable action waits at least (replies)', 'After it is sent, it is left alone for a number of replies between these two.', numberInput(g.waitMin, { min: 0, max: 200, unit: 'replies' }, v => { g.waitMin = v; if (g.waitMax < v) g.waitMax = v; saveGoals(); })),
            field('A repeatable action waits at most (replies)', '', numberInput(g.waitMax, { min: 0, max: 200, unit: 'replies' }, v => { g.waitMax = Math.max(v, g.waitMin); saveGoals(); })),
            field('The goal is done when every one-time step is done', 'Off: the goal stays in progress until you press "Mark the goal done".', onOff(g.autoDone, v => { g.autoDone = v; saveGoals(); redraw(); })),
            field('When the goal is done', 'The next goal is the one after this one in your list.', select([{ value: 'stop', label: 'Stop sending' }, { value: 'next', label: 'Start the next goal from my list' }], g.whenDone, v => { g.whenDone = v; saveGoals(); })))));

    body.appendChild(h('div', { class: 'ri-row' }, button('Clear this chat\'s goal', async () => {
        if (!await confirmBox('Remove the goal, actions and steps from this chat? Goals saved to your list are kept.')) return;
        Object.assign(g, blankGoal()); saveGoals(); redraw();
    }, { kind: 'danger' })));
}

function aiBox(g, ui, redraw) {
    const ai = ui.ai;
    const box = h('div', { class: 'ri-sheet-box' }, h('div', { class: 'ri-h2' }, 'Write a goal with AI'));
    if (!ai.result) {
        box.append(
            field('What the goal is about (you can leave this empty)', 'A few words. Left empty, the AI chooses a goal from what you let it read below.', textInput(ai.about, v => { ai.about = v; }, { placeholder: 'Example: winning back trust after a lie' })),
            contextField());
        if (ai.error) box.appendChild(h('div', { class: 'ri-note ri-note-warn' }, ai.error));
        box.appendChild(h('div', { class: 'ri-row' },
            button(ai.busy ? 'Writing...' : 'Write the goal', async () => {
                if (ai.busy) return;
                ai.busy = true; ai.error = ''; redraw();
                try { ai.result = await writeGoal({ about: ai.about.trim(), context: settings().writer.context }); }
                catch (e) { ai.error = e.message; }
                ai.busy = false; redraw();
            }, { kind: 'primary', disabled: ai.busy }),
            button('Cancel', () => { ui.ai = null; redraw(); }, { kind: 'ghost', disabled: ai.busy })));
        return box;
    }
    const r = ai.result;
    const show = (label, list) => [h('div', { class: 'ri-label' }, label), h('div', { class: 'ri-versions' }, list.map(t => h('div', { class: 'ri-version' }, h('span', { class: 'ri-vbody' }, versionText(t)), taskFlags(t))))];
    box.append(
        h('div', { class: 'ri-help' }, 'This is everything the AI wrote. Nothing changes until you press a button. You can edit it afterwards.'),
        h('div', { class: 'ri-label' }, 'Goal'), h('div', { class: 'ri-preview' }, versionText(r.goal)),
        ...show('One-time steps', r.steps), ...show('Repeatable actions', r.actions),
        h('div', { class: 'ri-row' },
            button('Use this goal', async () => {
                if (g.goal.trim() && !await confirmBox('Replace the goal, actions and steps of this chat with these?')) return;
                g.goal = r.goal; g.goalDoneManual = false; g.loaded = '';
                g.steps = r.steps.map(text => ({ id: newId(), text, on: true }));
                g.actions = r.actions.map(text => ({ id: newId(), text, on: true }));
                g.on = true; ui.ai = null; saveGoals(); redraw();
            }, { kind: 'primary' }),
            button('Add the steps and actions to my goal', () => {
                g.steps.push(...r.steps.map(text => ({ id: newId(), text, on: true })));
                g.actions.push(...r.actions.map(text => ({ id: newId(), text, on: true })));
                ui.ai = null; saveGoals(); redraw();
            }, { kind: 'ghost', title: 'Keep your own goal sentence and add what the AI wrote to your lists' }),
            button('Write another', () => { ai.result = null; redraw(); }, { kind: 'ghost' }),
            button('Cancel', () => { ui.ai = null; redraw(); }, { kind: 'ghost' })));
    return box;
}
