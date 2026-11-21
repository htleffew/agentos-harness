import { memoryOnly } from '../components.js';
import { h, button } from './dom.js';
import { executionDetails } from './execution.js';
import { ctx, isReply, KEY } from '../st.js';
import { settings } from '../store.js';
import { correctionEditor } from './corrections.js';
import { openQuickActions } from './quick-actions.js';
import { app } from './panel.js';
import { taskLabels } from './destinations.js';

export function deliveredDirections(receipt) {
    if (!receipt?.directions?.length) return null;
    const names = {evidenced:'Evidence found in this reply',missed:'Checked and unfulfilled',unverified:'Evidence pending'};
    return h('details',{},h('summary',{},'Directions sent with this reply'),
        receipt.directions.map(cue=>h('div',{class:'ri-quick-card'},
            h('strong',{},cue.title || (cue.required ? 'Required direction':'Nudge')),
            h('p',{},cue.text),
            h('p',{class:'ri-help'},[cue.visibility==='visible'?'Visible OOC':'Private guidance',
                cue.required && names[cue.verification || 'unverified']].filter(Boolean).join(' · ')),
            cue.evidence && h('blockquote',{},cue.evidence))));
}

/** Reply shortcuts and the existing manual source editor share the selected reply. */
export function refreshGuidedControl() {
    const chat = ctx().chat || [];
    const enabled=settings().enabled;
    const canGuide=!memoryOnly();
    const nodes = document.querySelectorAll('#chat .mes[mesid]');
    for (const node of nodes) {
        const id = Number(node.getAttribute('mesid'));
        const reply = chat[id];
        const block = node.querySelector('.mes_block');
        if (!block) continue;
        const record = reply?.extra?.[KEY];
        const delivery = record?.quickActions;
        const execution = record?.guided?.execution || delivery;
        const latest=id===chat.length-1;
        const selected=JSON.stringify([reply?.swipe_id,reply?.send_date]);
        const revision = JSON.stringify([reply?.swipe_id,reply?.send_date,latest,canGuide,!!record,execution?.outcome,delivery?.directions?.map(cue=>[cue.verification,cue.evidence])]);
        const old = block.querySelector(':scope > .ri-guided');
        if (!enabled || !isReply(reply) || reply?.is_system || !canGuide && !record) { old?.remove(); continue; }
        if (old?.dataset.replyKey === revision) continue;
        if (canGuide && old?.dataset.selectedVersion===selected && old.querySelector('[data-ri-dirty]')) continue;
        old?.remove();
        const direct = (family,label) => button(label,event=>openQuickActions(family,id,event.currentTarget));
        block.append(h('div',{class:'ri-root ri-guided ri-guided-actions','data-accent':'sky','data-reply-key':revision,'data-selected-version':selected},
            h('div',{class:'ri-quick-row'},canGuide && direct('swipe',taskLabels.alternate),canGuide && direct('continue',taskLabels.continue),
                record && button(taskLabels.review,event=>app.openReplyTask('sent',id,event.currentTarget,`#ri-review-reply-${id}`),{kind:'ghost'}),
                canGuide && !latest && button(taskLabels.corrections,event=>app.openReplyTask('corrections',id,event.currentTarget),{kind:'ghost'})),
            execution && executionDetails(execution),
            deliveredDirections(delivery),
            canGuide && latest && h('details',{class:'ri-guided-correction'},h('summary',{class:'ri-guided-summary'},taskLabels.corrections),
                correctionEditor({focus:id}))));
    }
}
