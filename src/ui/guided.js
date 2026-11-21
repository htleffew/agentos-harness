import { memoryOnly } from '../components.js';
import { h, button } from './dom.js';
import { executionDetails } from './execution.js';
import { ctx, isReply, KEY } from '../st.js';
import { settings } from '../store.js';
import { correctionEditor } from './corrections.js';
import { openQuickActions } from './quick-actions.js';

/** Reply shortcuts and the existing manual source editor share the selected reply. */
export function refreshGuidedControl() {
    const chat = ctx().chat || [];
    const enabled = settings().enabled && !memoryOnly();
    const nodes = document.querySelectorAll('#chat .mes[mesid]');
    for (const node of nodes) {
        const id = Number(node.getAttribute('mesid'));
        const reply = chat[id];
        const block = node.querySelector('.mes_block');
        if (!block) continue;
        const record = reply?.extra?.[KEY];
        const delivery = record?.quickActions;
        const execution = record?.guided?.execution || delivery;
        const revision = JSON.stringify([reply?.swipe_id,reply?.send_date,execution?.outcome]);
        const old = block.querySelector(':scope > .ri-guided');
        if (!enabled || !isReply(reply) || reply?.is_system) { old?.remove(); continue; }
        if (old?.dataset.replyKey === revision) continue;
        old?.remove();
        const direct = (family,label) => button(label,event=>openQuickActions(family,id,event.currentTarget));
        block.append(h('div',{class:'ri-root ri-guided ri-guided-actions','data-accent':'sky','data-reply-key':revision},
            h('div',{class:'ri-quick-row'},direct('swipe','Guide a swipe'),direct('continue','Continue this reply')),
            execution && executionDetails(execution),
            delivery?.directions?.length > 0 && h('details',{},h('summary',{},'Directions sent with this reply'),
                delivery.directions.map(cue=>h('p',{},cue.text))),
            id === chat.length - 1 && h('details',{class:'ri-guided-correction'},h('summary',{class:'ri-guided-summary'},'Correct story facts'),
                correctionEditor({focus:id}))));
    }
}
