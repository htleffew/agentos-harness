import { memoryOnly } from '../components.js';
import { promptGroup } from './prompts.js';
import { h, button } from './dom.js';
import { guideSwipe, guidedSwipeActive } from '../engine.js';
import { ctx, KEY } from '../st.js';
import { settings } from '../store.js';
import { correctionEditor } from './corrections.js';

/** A small, optional control on the newest character reply. */
export function refreshGuidedControl() {
    const chat = ctx().chat || [], id = chat.length - 1, m = chat[id];
    const mes = document.querySelector(`#chat .mes[mesid="${id}"]`);
    const block = mes?.querySelector('.mes_block');
    const replyKey = `${m?.extra?.[KEY]?.time}:${m?.swipe_id ?? 0}`;
    for (const old of document.querySelectorAll('#chat .ri-guided')) if (!block || old.parentElement !== block || !settings().enabled || memoryOnly() || m?.is_user || !m?.extra?.[KEY] || old.dataset.replyKey!==replyKey) old.remove();
    if (!settings().enabled || memoryOnly() || !block || !m || m.is_user || m.is_system || !m.extra?.[KEY] || block.querySelector(':scope > .ri-guided')) return;
    const input = h('textarea', { class: 'ri-input ri-textarea', rows: 3, maxLength: 2000, placeholder: 'For example: Keep the conversation calm and let her decline the invitation.' });
    const choice = h('select', { class: 'ri-input', 'aria-label': 'Previous instructions' },
        h('option', { value: 'omit' }, 'Leave orders out'),
        h('option', { value: 'repeat' }, 'Repeat orders'));
    const keepManual = h('input', { type: 'checkbox' });
    const status = h('div', { class: 'ri-help', role: 'status' });
    const send = button('Generate guided swipe', async () => {
        send.disabled = true; status.textContent = 'Preparing the replacement…';
        try { await guideSwipe(input.value, { repeatOrders: choice.value === 'repeat', keepManualEdits: keepManual.checked }); status.textContent = 'Generating…'; setTimeout(() => { if (fold.isConnected && !guidedSwipeActive()) { send.disabled = false; status.textContent = 'The swipe has finished or stopped. You can try again.'; } }, 11000); }
        catch (e) { status.textContent = e.message; send.disabled = false; }
    });
    const fold = h('details', { class: 'ri-root ri-guided ri-guided-swipe', 'data-accent': 'sky', 'data-reply-key':replyKey },
        h('summary', { class: 'ri-guided-summary' }, 'Guide a swipe'),
        h('div', { class: 'ri-guided-body' }, h('div', { class: 'ri-help' }, 'Describe how the replacement should go. This direction is sent for this swipe only.'), input,
            h('label',{class:'ri-field'},'Orders from the previous reply',choice),promptGroup(['guided'], 'Customize guided-swipe instruction'),
            h('label', { class: 'ri-state-lock' }, keepManual, ' Keep my manual world edits after this reply'), status, send));
    block.append(fold);
    block.append(h('details',{class:'ri-root ri-guided ri-guided-correction','data-accent':'sky','data-reply-key':replyKey},
        h('summary',{class:'ri-guided-summary'},'Correct story facts'),correctionEditor({focus:id})));
}
