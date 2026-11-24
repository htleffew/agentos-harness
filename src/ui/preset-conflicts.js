// B34: the Check conflicts section (A11 c.7). One button, one model call, run only when she taps it. The findings list both
// blocks with their sources and spans, the reason and the problem. The section has no apply action; Keep both marks a pair as
// seen until either text changes. B32 mounts it under the stack's check list and passes onOpenCard for the Show block links;
// until then it sits in Setup, Presets beside the preset blocks.
import { h, button } from './dom.js';
import { slot } from './homes.js';
import { functionExecution, executionAction } from './execution.js';
import { executionReceipt } from '../execution.js';
import { activePreset } from '../v10.js';
import { currentBank, refreshBank, stackFor, stackPlan, onBankChange } from '../preset-bank.js';
import { runConflictCheck, conflictItems, keepBoth, KIND_LABELS, CALL_LABEL } from '../preset-conflicts.js';

const chip = (text, kind = '') => h('span', { class: `ri-ps-chip${kind ? ' ri-ps-chip-' + kind : ''}` }, text);

/** The stack of a preset and its plan; the bank is read again when she taps the button. */
function stackOf(preset, reread) {
    const bank = reread || !currentBank() ? refreshBank('conflicts') : currentBank();
    const stack = stackFor(bank, preset);
    return stack ? { key: stack.key, plan: stackPlan(bank, stack, preset) } : null;
}

/**
 * options: preset (default the active one), onOpenCard(key) for a Show block button on each card, onChange() after a run.
 */
export function conflictSection({ preset = activePreset(), onOpenCard = null, onChange = () => {} } = {}) {
    const root = h('div', { class: 'ri-card ri-tight ri-conflicts', id: 'ri-conflicts' });
    const state = { busy: false, message: '' };
    const status = h('p', { class: 'ri-help ri-conf-status', role: 'status' });
    const results = h('div', { class: 'ri-conf-results' });
    const run = executionAction(button('Check conflicts', tap, { kind: 'primary' }), '1 model call');

    async function tap() {
        if (state.busy || !preset) return;
        state.busy = true; run.disabled = true;
        say('Checking the blocks that are on.');
        try {
            const target = stackOf(preset, true);
            if (!target) throw new Error('There is no stack for this preset yet.');
            const done = await runConflictCheck(target.key, target.plan, { onReceipt: () => {} });
            say('Check finished.');
            onChange(done);
        } catch (error) { say(error?.message || String(error)); }
        finally { state.busy = false; run.disabled = false; draw(); }
    }
    function say(text) { state.message = text; status.textContent = text; }
    function side(card, label) {
        return h('div', { class: 'ri-conf-side', 'data-conflict-side': label },
            h('div', { class: 'ri-ps-row-head' }, h('strong', {}, card.name), chip(card.source || 'Source'), !card.on && chip('Off')),
            h('blockquote', { class: 'ri-conf-span' }, card.span),
            onOpenCard && button('Show block', () => onOpenCard(card.key), { kind: 'ghost' }));
    }
    function draw() {
        let target = null;
        try { target = stackOf(preset, false); } catch { target = null; }
        const found = target ? conflictItems(target.key, target.plan) : null;
        const head = [];
        if (!found) results.replaceChildren(h('p', { class: 'ri-help' }, 'No check has been run on this stack.'));
        else {
            head.push(h('div', { class: 'ri-ps-row-head' }, found.stale && chip(found.staleText, 'conflict'),
                h('span', { class: 'ri-help' }, `${found.receipt.summary} Checked ${new Date(found.at).toLocaleString()}.`)));
            const list = found.items.length ? found.items.map(item => h('div', { class: `ri-card ri-tight ri-conf-item${item.seen ? ' ri-conf-seen' : ''}`, 'data-conflict': item.conflictKind },
                h('div', { class: 'ri-ps-row-head' }, chip(KIND_LABELS[item.conflictKind], item.seen ? '' : 'conflict'), item.seen && chip('Seen')),
                h('div', { class: 'ri-conf-sides' }, side(item.cards[0], 'a'), side(item.cards[1], 'b')),
                h('p', { class: 'ri-conf-reason' }, item.reason),
                h('p', { class: 'ri-conf-problem' }, h('b', {}, 'Could cause: '), item.problem),
                button(item.seen ? 'Kept' : 'Keep both', () => { keepBoth(target.key, target.plan, item.cards[0].key, item.cards[1].key); draw(); },
                    { disabled: item.seen, title: 'Mark this pair as seen until either block changes. Nothing in the stack changes.' })))
                : [h('p', { class: 'ri-help' }, 'No problems found.')];
            head.push(...list);
        }
        if (found) results.replaceChildren(...head);
    }
    root.append(h('strong', {}, 'Check conflicts'),
        h('p', { class: 'ri-help' }, 'One request reads the blocks that are on, in send order, and lists conflicts, duplications and overlaps that could cause a problem in the reply. It applies nothing: every block, its order and every switch stay as you set them.'),
        slot(['conflictCheck'], 'Edit the conflict check prompt'), functionExecution('presetParity', { receipt: executionReceipt('presetParity'), label: CALL_LABEL }),
        h('div', { class: 'ri-row ri-row-tight' }, run), status, results);
    draw();
    // The stack can change under the findings (a tap on a card elsewhere); redraw so Stack changed since the check shows at once.
    const off = onBankChange(() => { if (!root.isConnected) { off(); return; } if (!state.busy) draw(); });
    return root;
}

let styled = false;
/** Load the section's stylesheet once. */
export function loadConflictStyles() {
    if (styled || !globalThis.document) return;
    styled = true;
    document.head.append(h('link', { rel: 'stylesheet', id: 'ri-preset-conflicts-css', href: new URL('./preset-conflicts.css', import.meta.url).href }));
}
loadConflictStyles();
