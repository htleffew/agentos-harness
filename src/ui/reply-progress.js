import { onReplyProgress, replyProgress } from '../reply-progress.js';
import { ctx, LOG } from '../st.js';
import { settings } from '../store.js';
import { effectiveModules, enabledV10, prefs } from '../v10.js';
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
let nodes, caption, sections, expected;
let lastPhase;
let turn;
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
    if (!card || turn!==progress.turn) {
        card?.remove();
        lastPhase=null;
        turn=progress.turn;
        const modules=effectiveModules();
        expected=[modules.state && {id:'scene',title:'Scene'},modules.state && {id:'cast',title:'Characters'},
            (modules.state || modules.knowledge || modules.emotions || modules.relationships || modules.plots || modules.worldEvents)
                && {id:'changes',title:'Story changes'},modules.roast && {id:'roast',title:'Roast'}].filter(Boolean);
        nodes = stages.map(([label,icon])=>h('li',{},
            h('span',{class:'ri-progress-light','aria-hidden':'true'},icon),
            h('span',{class:'ri-progress-stage-label'},label),
            h('span',{class:'ri-progress-stage-status','aria-hidden':'true'})));
        sections = h('ul',{class:'ri-progress-sections','aria-label':'Story update sections',hidden:true});
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
    const showSections = prefs()?.showStreamSections!==false;
    const arrivals = progress.sections || [];
    const filed = ['filing','ready'].includes(progress.phase);
    const sectionStamp = JSON.stringify([showSections,filed,progress.sectionStamp]);
    if (sections.dataset.stamp !== sectionStamp) {
        sections.dataset.stamp = sectionStamp;
        const previous = new Map([...sections.children].map(node=>[node.dataset.slot,node]));
        const slots = showSections ? new Map([...expected,...arrivals].map(section=>[section.id,section])) : new Map();
        for (const [id,section] of slots) {
            let node=previous.get(id);
            if (!node) {
                node=h('li',{'data-slot':id},h('span',{class:'ri-progress-section-light','aria-hidden':'true'}),
                    h('span',{},h('strong',{},section.title),h('span',{class:'ri-progress-section-detail'})));
                sections.append(node);
            }
            if (section.detail) node.dataset.section=id;
            else delete node.dataset.section;
            node.querySelector('.ri-progress-section-detail').textContent=section.detail || (filed ? 'No update' : 'Waiting');
        }
        for (const [id,node] of previous) if (!slots.has(id)) node.remove();
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
