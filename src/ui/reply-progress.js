import { onReplyProgress, replyProgress } from '../reply-progress.js';
import { ctx, LOG } from '../st.js';
import { settings } from '../store.js';
import { enabledV10, prefs } from '../v10.js';
import { h } from './dom.js';

const stages = [['Context','◇'],['Prose','▱'],['Update','▤'],['Saved','✓']];
const phases = {
    context: [0,'Preparing context'],
    waiting: [1,'Waiting for the reply'],
    writing: [1,'Writing the reply'],
    receiving: [2,'Receiving the story update'],
    filing: [3,'Checking and saving story state'],
    ready: [4,'Story state ready'],
};

let card;
let nodes, caption, sections;
let lastPhase;
let preview;

function refreshPreview(target, progress) {
    const area = target?.querySelector('.mes_text');
    if (!area || progress?.preview === undefined || ['filing','ready'].includes(progress.phase)) {
        preview?.remove();
        preview = null;
        return;
    }
    if (!preview || preview.parentElement !== area.parentElement) {
        preview?.remove();
        preview = h('div',{class:'ri-stream-preview'});
        area.before(preview);
    }
    if (preview.renderedText === progress.preview) return;
    preview.renderedText = progress.preview;
    const c = ctx();
    const message = c.chat?.[progress.id];
    if (c.messageFormatting && message) {
        preview.innerHTML = c.messageFormatting(progress.preview,message.name,message.is_system,false,progress.id);
    } else {
        preview.textContent = progress.preview;
    }
}

export function refreshReplyProgress() {
    const progress = replyProgress();
    const chat = document.getElementById('chat');
    const block = progress && chat?.querySelector(`.mes[mesid="${progress.id}"]:not([is_user="true"]) .mes_block`);
    refreshPreview(block,progress);
    if (!progress || !chat || !enabledV10() || settings().scene?.card === 'off') {
        card?.remove();
        card = null;
        lastPhase = null;
        return;
    }
    if (!card) {
        nodes = stages.map(([label,icon])=>h('li',{},
            h('span',{class:'ri-progress-light','aria-hidden':'true'},icon),
            h('span',{class:'ri-progress-stage-label'},label),
            h('span',{class:'ri-progress-stage-status','aria-hidden':'true'})));
        sections = h('ul',{class:'ri-progress-sections','aria-label':'Story sections received',hidden:true});
        caption = h('span',{class:'ri-progress-caption',role:'status'});
        card = h('div',{class:'ri-root ri-reply-stack ri-v10-progress','data-accent':'sky'},
            h('div',{class:'ri-reply-card'},
                h('div',{class:'ri-progress-heading'},
                    h('span',{class:'ri-reply-symbol','aria-hidden':'true'},'◇'),
                    h('div',{},h('strong',{},'Story state'),caption),
                    h('span',{class:'ri-progress-signal','aria-hidden':'true'},h('i'),h('i'),h('i'))),
                h('ol',{class:'ri-progress-stages','aria-label':'Reply progress'},nodes),sections));
    }
    if (lastPhase !== progress.phase) {
        const [active,label] = phases[progress.phase];
        nodes.forEach((node,index)=>{
            const done = index < active;
            node.dataset.status = done ? 'done' : index === active ? 'active' : 'waiting';
            node.children[0].textContent = done ? '✓' : stages[index][1];
            node.children[2].textContent = done ? 'Complete' : index === active ? 'In progress' : 'Waiting';
            if (index === active) node.setAttribute('aria-current','step');
            else node.removeAttribute('aria-current');
        });
        caption.textContent = label;
        card.style.setProperty('--ri-track-fill',`${Math.min(active,stages.length-1)/(stages.length-1)*100}%`);
        card.dataset.phase = progress.phase;
        lastPhase = progress.phase;
    }
    const arrivals = prefs()?.showStreamSections===false ? [] : progress.sections || [];
    const sectionStamp = arrivals.length ? progress.sectionStamp : '';
    if (sections.dataset.stamp !== sectionStamp) {
        sections.dataset.stamp = sectionStamp;
        const known = new Set(Array.from(sections.children,node=>node.dataset.section));
        for (const section of arrivals) if (!known.has(section.id)) {
            sections.append(h('li',{'data-section':section.id},
                h('span',{class:'ri-progress-section-light','aria-hidden':'true'}),
                h('span',{},h('strong',{},section.title),h('span',{class:'ri-progress-section-detail'},section.detail))));
        }
        const active = new Set(arrivals.map(section=>section.id));
        for (const node of [...sections.children]) if (!active.has(node.dataset.section)) node.remove();
        sections.hidden = !sections.childElementCount;
    }
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
