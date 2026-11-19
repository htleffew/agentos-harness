import { onReplyProgress, replyProgress } from '../reply-progress.js';
import { LOG } from '../st.js';
import { settings } from '../store.js';
import { enabledV10 } from '../v10.js';
import { h } from './dom.js';

const stages = ['Context','Reply','Story state'];
const phases = {
    context: [0,'Preparing context'],
    waiting: [1,'Waiting for the reply'],
    writing: [1,'Writing the reply'],
    receiving: [2,'Receiving the story update'],
    filing: [2,'Checking and saving story state'],
    ready: [3,'Story state ready'],
};

let card;
let nodes, caption;
let lastPhase;

export function refreshReplyProgress() {
    const progress = replyProgress();
    const chat = document.getElementById('chat');
    if (!progress || !chat || !enabledV10() || settings().scene?.card === 'off') {
        card?.remove();
        card = null;
        lastPhase = null;
        return;
    }
    if (!card) {
        nodes = stages.map(label=>h('li',{},h('span',{class:'ri-progress-light','aria-hidden':'true'}),label));
        caption = h('span',{class:'ri-progress-caption',role:'status'});
        card = h('div',{class:'ri-root ri-reply-stack ri-v10-progress','data-accent':'sky'},
            h('div',{class:'ri-reply-card'},
                h('div',{class:'ri-progress-heading'},h('strong',{},'Story state'),caption),
                h('ol',{class:'ri-progress-stages','aria-label':'Reply progress'},nodes)));
    }
    if (lastPhase !== progress.phase) {
        const [active,label] = phases[progress.phase];
        nodes.forEach((node,index)=>{
            node.dataset.status = index < active ? 'done' : index === active ? 'active' : 'waiting';
            if (index === active) node.setAttribute('aria-current','step');
            else node.removeAttribute('aria-current');
        });
        caption.textContent = label;
        card.dataset.phase = progress.phase;
        lastPhase = progress.phase;
    }
    const block = chat.querySelector(`.mes[mesid="${progress.id}"]:not([is_user="true"]) .mes_block`);
    const target = block || chat;
    if (card.parentElement !== target) {
        if (block) block.insertBefore(card,block.querySelector(':scope > .ri-v10-reply'));
        else chat.append(card);
    }
}

export function mountReplyProgress() {
    onReplyProgress(() => {
        try { refreshReplyProgress(); } catch (error) { console.warn(LOG,'reply progress',error); }
    });
}
