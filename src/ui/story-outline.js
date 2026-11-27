// The story outline, the parts she sees (B52): one page on Direction, Goal. She reads, edits and clears the outline,
// chooses what the next run does with her edit, and writes it now through the Generate sheet (D1 decision 4).
import { h, button, field, section, select, textArea, toggle, howItWorks } from './dom.js';
import { registerPage } from './page-registry.js';
import { gateModelButtons } from './memory-settings.js';
import { ROUTES } from '../routing.js';
import { ctx, isChatOpen, toast } from '../st.js';
import { MEMORY } from '../memory/fold.js';
import {
    EVERY, TEXT_MAX, clearOutline, currentOutline, editOutline, onOutlineChange, outlineBusy, outlineOn, runOutline,
    setKeepEdits, setOutlineOn, storyReplies,
} from '../story-outline.js';

export const PAGE_ID = 'story-outline';

/** The status line for an outline state and the chat's reply count. Pure, so node tests read it. */
export function statusText(state, count) {
    const next = (state.reply || 0) + EVERY;
    const where = state.route ? ` on ${ROUTES[state.route]?.label || state.route}${state.model ? ` (${state.model})` : ''}` : '';
    const parts = [];
    if (state.text.trim() && state.at) parts.push(`Written at reply ${state.reply}${where}${state.edited ? ', then edited by you' : ''}.`);
    else if (state.text.trim()) parts.push('Written by you.');
    else parts.push('No outline yet.');
    if (state.edited && state.keep && state.text.trim()) parts.push(`The ${EVERY}-reply run keeps your text and makes no call while "Keeps your text" is chosen.`);
    else parts.push(count >= next ? 'The next run comes after the next captured reply.' : `The next run comes at reply ${next}; this chat is at reply ${count}.`);
    if (state.problem) parts.push(state.problem);
    return parts.join(' ');
}

export function renderStoryOutlinePage(body, app) {
    const redraw = () => { if (app?.render) app.render(); else { body.replaceChildren(); renderStoryOutlinePage(body, app); } };
    const on = outlineOn();
    const head = h('p', { class: 'ri-help' }, [`Every ${EVERY} replies, one call on a free route writes a short outline of possible next chapters. With no free route the call waits and spends nothing.`, howItWorks('Free routes are the desktop over Tailscale, a free tier or your NanoGPT plan. The outline comes from this chat’s records, its open threads and their "ends when" lines, and the writer reads it only inside the Director’s desk entry of the Tracker book.')]);
    const onSwitch = field('Story outline', 'Off stops the runs and takes the outline out of the Director\'s desk. The text stays on file.',
        toggle(on, async value => { await setOutlineOn(value); redraw(); }, 'Story outline on'));
    const state = currentOutline();
    if (!state || !isChatOpen()) { body.append(section('Story outline', head, onSwitch, h('p', { class: 'ri-help' }, 'Open a chat to see its outline.'))); return; }
    if (!ctx().chatMetadata?.[MEMORY]?.imported) {
        body.append(section('Story outline', head, onSwitch, h('p', { class: 'ri-help' }, 'Story memory is not on for this chat yet. The outline reads its records, so it starts once the chat\'s memory is on.')));
        return;
    }
    const busy = outlineBusy();
    const status = h('p', { class: 'ri-help', 'data-outline-status': '', 'aria-live': 'polite' }, busy ? 'Writing the outline...' : statusText(state, storyReplies(ctx().chat)));
    const box = textArea(state.text, value => editOutline(value), { 'aria-label': 'Story outline', rows: 6, maxLength: TEXT_MAX, 'data-outline-text': '', disabled: busy });
    const keep = select([{ value: 'keep', label: 'Keeps your text' }, { value: 'rewrite', label: 'Rewrites it from your text' }], state.keep ? 'keep' : 'rewrite',
        value => setKeepEdits(value === 'keep'), { 'aria-label': 'What the next run does with your edit', 'data-outline-keep': '' });
    const write = h('button', { type: 'button', class: 'ri-btn ri-btn-primary', 'data-ri-model-cost': '1 model call · free route', 'data-outline-write': '', disabled: busy || !on,
        onclick: async () => {
            const res = await runOutline({ tap: true });
            if (!res.ok) toast(res.waiting ? 'warning' : 'error', res.reason);
            redraw();
        } }, busy ? 'Writing...' : 'Write the outline now');
    const clear = button('Clear', async () => { await clearOutline(); redraw(); }, { kind: 'ghost', disabled: busy || !state.text.trim() });
    clear.dataset.outlineClear = '';
    body.append(section('Story outline', head, onSwitch,
        field('Possible next chapters', 'One chapter per line. Your edit stays as you wrote it; the writer reads it at the next reply.', box),
        status,
        field('When you have edited it, the next run', '"Write the outline now" always rewrites from your text.', keep),
        h('div', { class: 'ri-row' }, gateModelButtons(write), clear)));
}

let installed = false;
export function installStoryOutlineUi() {
    if (installed || !globalThis.SillyTavern?.getContext) return;
    installed = true;
    registerPage({ id: PAGE_ID, group: 'direction', tab: 'goal', label: 'Story outline',
        help: 'A private outline of possible next chapters, written every 40 replies on a free route, that the writer reads in the Director\'s desk.',
        aliases: 'story outline long range future chapters plan director desk tale fairy next chapters', render: renderStoryOutlinePage });
    let timer = null;
    onOutlineChange(() => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
            const { app } = await import('./panel.js').catch(() => ({}));
            if (app?.tab === PAGE_ID && !app.root?.querySelector('textarea:focus, input:focus')) app.render?.();
        }, 120);
    });
}
try { installStoryOutlineUi(); } catch (error) { console.warn('Roleplay Instructions could not add the Story outline page.', error); }
