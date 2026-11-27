// "What to show the AI": the same choice for every place where the AI writes something.
import { h, field, numberInput } from './dom.js';
import { settings, saveSettings } from '../store.js';
import { CONTEXT_PARTS, findSummary } from '../writer.js';
import { isChatOpen } from '../st.js';

export function contextField() {
    const c = settings().writer.context;
    const hasSummary = !!findSummary();
    const rows = CONTEXT_PARTS.map(([key, label]) => {
        const missing = key === 'summary' && !hasSummary;
        const tick = h('input', { type: 'checkbox', class: 'ri-check', checked: !!c[key] && !missing, disabled: missing, onchange: () => { c[key] = tick.checked; saveSettings(); } });
        return h('label', { class: 'ri-vpick' }, tick, h('span', {}, missing ? `${label} (no summary was found in this chat)` : label,
            key === 'recent' ? h('span', { class: 'ri-num', style: { marginLeft: '10px' } }, numberInput(c.recentCount, { min: 1, max: 50, unit: 'messages' }, (n) => { c.recentCount = n; saveSettings(); })) : null));
    });
    return field('What to show the AI', isChatOpen() ? 'Tick what the AI may read so its writing fits where the story is right now. Each one uses more tokens, and your choice is remembered.' : 'Open a chat first: these come from the chat that is open.',
        h('div', { style: { width: '100%' } }, rows));
}
