import { onReplyProgress, replyProgress } from '../reply-progress.js';
import { ctx, LOG } from '../st.js';
import { settings } from '../store.js';
import { effectiveModules, enabledV10, KIND_MODULE, prefs } from '../v10.js';
import { replyChip, storyStateChips, loreChips, replyCardHeader, replyGlance, roastCard } from './reply-cards.js';
import { h } from './dom.js';

const phases = {
    context:'Preparing context',
    waiting:'Waiting for the reply',
    writing:'Writing the reply',
    receiving:'Receiving the story update',
    filing:'Checking and saving story state',
    ready:'Story state ready',
};

let card, caption, turn, preview, initialModules, sectionStamp, follow;

// Keep painted cards in place when another section arrives. Only new content lights up.
function reconcile(parent, children) {
    let cursor = parent.firstElementChild;
    for (const fresh of children) {
        if (cursor?.className === fresh.className && /^ri-(reply-glance|glance-cast|glance-context)$/.test(fresh.className)) {
            reconcile(cursor,[...fresh.children]);
        } else if (!cursor?.isEqualNode(fresh)) {
            parent.insertBefore(fresh,cursor);
            if (cursor?.className===fresh.className) cursor.remove();
            cursor = fresh;
        }
        cursor = cursor.nextElementSibling;
    }
    while (cursor) {
        const next=cursor.nextElementSibling;
        cursor.remove();
        cursor=next;
    }
}

function updateCards(progress) {
    const options=prefs() || {};
    const display=progress.display || {};
    const modules=display.modules || initialModules;
    const show=options.showStreamSections!==false;
    const stamp=JSON.stringify([show,options.showRoast,options.showLore,options.showPlanning,progress.hasPlan,progress.display,progress.sectionStamp]);
    if (stamp===sectionStamp) return;
    sectionStamp=stamp;
    const sections=new Map((progress.sections || []).map(section=>[section.id,section]));
    const people=modules.state ? sections.get('cast')?.value || [] : [];
    const scene=modules.state ? sections.get('scene')?.value || {} : {};
    const records=(sections.get('changes')?.value || []).filter(record=>modules[KIND_MODULE[record.kind]]);
    const chips=show ? storyStateChips(people.length,records.length) : [];
    const repair=sections.get('repair');
    if (show && repair) chips.push({text:repair.detail,tone:'indigo'});
    const heading=card.querySelector('.ri-v10-console .ri-reply-heading');
    let rail=heading.querySelector('.ri-reply-chip-rail');
    if (chips.length) {
        if (!rail) heading.append(rail=h('span',{class:'ri-reply-chip-rail'}));
        reconcile(rail,chips.map(({text,tone})=>replyChip(text,tone)));
    } else rail?.remove();
    const glance=show && replyGlance({
        scene,people:people.filter(person=>!scene.present || scene.present.toLowerCase().includes(person.name.toLowerCase())),
        profiles:[],records,changed:[],hasSavedTabs:true,
        pending:{cast:modules.state && !sections.has('cast'),scene:modules.state && !sections.has('scene'),
            changes:(modules.state || modules.worldEvents) && !sections.has('changes')},
    });
    for (const node of glance?.querySelectorAll?.('.ri-glance-card') || []) {
        node.dataset.arrival=node.querySelector('.ri-card-skeleton') ? 'pending' : 'received';
    }
    const before=card.firstElementChild;
    if (glance && before?.classList.contains('ri-reply-glance')) reconcile(before,[...glance.children]);
    else if (glance) card.prepend(glance);
    else if (before?.classList.contains('ri-reply-glance')) before.remove();
    const plan=card.querySelector('.ri-v10-plan');
    if (show && (progress.hasPlan || display.expectsPlan) && options.showPlanning!==false) {
        const node=plan || h('div',{class:'ri-reply-card ri-v10-plan'},
            replyCardHeader({icon:'≋',title:'Reply planning',status:h('span',{class:'ri-arrival-mark'})}));
        node.querySelector('.ri-arrival-mark').textContent=progress.hasPlan ? 'Received' : 'Requested';
        if (!plan) card.querySelector('.ri-v10-console').after(node);
    } else plan?.remove();
    const roast=card.querySelector('.ri-reply-roast');
    if (show && modules.roast && options.showRoast!==false) {
        const received=sections.has('roast');
        const node=roast || roastCard('',{},h('span',{class:'ri-arrival-mark'}));
        node.dataset.arrival=received ? 'received' : 'pending';
        node.querySelector('.ri-arrival-mark').textContent=received ? 'Received' : 'Waiting';
        if (!roast) card.insertBefore(node,card.querySelector('.ri-v10-lore'));
    } else roast?.remove();
    const lore=card.querySelector('.ri-v10-lore');
    if (show && display.entries && options.showLore!==false) {
        if (!lore) card.append(h('div',{class:'ri-reply-card ri-v10-lore'},replyCardHeader({icon:'▤',title:'World Info',
            chips:loreChips(display.entries,display.confirmed),status:h('span',{class:'ri-arrival-mark'},'Selected')})));
    } else lore?.remove();
}

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

// The host follows the bottom of a streaming message. On a narrow screen the
// newly filed cards can fill the entire viewport and push the prose out of view.
function followMobileReply(chat) {
    follow?.abort();
    if (chat.clientWidth>540 || ctx().powerUserSettings?.auto_scroll_chat_to_bottom===false) return null;
    if (chat.scrollHeight-chat.clientHeight-chat.scrollTop>16) return null;
    const control=new AbortController();
    const cancel=()=>control.abort();
    const options={signal:control.signal,passive:true};
    for (const event of ['pointerdown','touchmove','wheel']) chat.addEventListener(event,cancel,options);
    document.addEventListener('keydown',event=>{
        if (['PageUp','PageDown','Home','End','ArrowUp','ArrowDown'].includes(event.key)) cancel();
    },options);
    return control;
}

function keepReplyInView(chat, block, turn) {
    if (!block || chat.clientWidth>540 || ctx().powerUserSettings?.auto_scroll_chat_to_bottom===false) return;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
        if (replyProgress()?.turn!==turn || !block.isConnected) return;
        const pinned=chat.scrollHeight-chat.clientHeight-chat.scrollTop<=3;
        if (!pinned && (!follow || follow.signal.aborted)) return;
        const saved=block.querySelector(':scope > .ri-v10-reply');
        if (!saved || saved.querySelector('details[open]')) return;
        const top=chat.getBoundingClientRect().top;
        const start=saved.getBoundingClientRect().top;
        const prose=block.querySelector('.mes_text');
        const readingSpace=Math.min(prose?.offsetHeight || 0,chat.clientHeight / 3)+16;
        if (start < top+readingSpace || start > top+chat.clientHeight-80) {
            chat.scrollTop+=start-top-readingSpace;
        }
    }));
}

export function refreshReplyProgress() {
    const progress = replyProgress();
    const chat = document.getElementById('chat');
    const block = progress && chat?.querySelector(`.mes[mesid="${progress.id}"]:not([is_user="true"]) .mes_block`);
    refreshPreview(block,progress);
    if (!progress || !chat || !enabledV10() || settings().scene?.card === 'off') {
        card?.remove();
        card = null;
        follow?.abort();
        return;
    }
    if (!card || turn!==progress.turn) {
        card?.remove();
        turn=progress.turn;
        follow=followMobileReply(chat);
        initialModules=effectiveModules();
        sectionStamp=null;
        caption=h('span',{class:'ri-progress-caption',role:'status'});
        const signal=h('span',{class:'ri-progress-signal','aria-hidden':'true'},h('i'),h('i'),h('i'));
        const consoleCard=h('div',{class:'ri-reply-card ri-v10-console'},replyCardHeader({icon:'◇',title:'Story state',subtitle:caption,status:signal}));
        card=h('div',{class:'ri-root ri-reply-stack ri-v10-progress','data-accent':'sky'},consoleCard);
    }
    if (card.dataset.phase!==progress.phase) {
        card.dataset.phase=progress.phase;
        caption.textContent=phases[progress.phase];
        if (progress.phase==='ready') keepReplyInView(chat,block,turn);
    }
    updateCards(progress);
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
