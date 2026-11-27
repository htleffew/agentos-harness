// The reply tray while a reply is written and captured (DESIGN.md 6.4): the Strip alone, with the phase and a
// chip per card as its values arrive. Every exit path ends the Strip resolved, failed or stopped.
import { onReplyProgress, replyProgress } from '../reply-progress.js';
import { ctx, isReply, LOG, on } from '../st.js';
import { settings } from '../store.js';
import { effectiveModules, enabledV10, prefs } from '../v10.js';
import { mountSceneHeader } from '../scene-header.js';
import { h } from './dom.js';
import { chatTray, loadingExit, loadingModel, loadingStrip, mountReplyTray, onTrayChange, paintLoadingStrip, trayShows } from './reply-tray.js';

let strip, turn, preview, initialModules, follow, last, ending;
const exits = { stopped: false, chatChanged: false };

/** Whether the host streams reply text to extensions for the current API. */
function hostStreams() {
    const c = ctx();
    if (c.mainApi === 'openai') return !!c.chatCompletionSettings?.stream_openai;
    return !!(c.textCompletionSettings?.streaming ?? c.powerUserSettings?.streaming);
}

function modelFor(progress, end = null) {
    const options = prefs() || {};
    return loadingModel({
        progress, end, streaming: hostStreams(), modules: progress.display?.modules || initialModules || {},
        prefs: options, chips: options.showStreamSections !== false,
    });
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

// The host follows the bottom of a streaming message. On a narrow screen a filed Compact tray
// can push the prose out of view, so the reply is kept in view until the reader scrolls.
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

function keepReplyInView(chat, block) {
    if (!block || chat.clientWidth>540 || ctx().powerUserSettings?.auto_scroll_chat_to_bottom===false) return;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
        if (!block.isConnected) return;
        const pinned=chat.scrollHeight-chat.clientHeight-chat.scrollTop<=3;
        if (!pinned && (!follow || follow.signal.aborted)) return;
        const saved=block.querySelector(':scope > .ri-tray:not(.ri-tray-loading)');
        if (!saved || saved.dataset.view==='expanded') return;
        const top=chat.getBoundingClientRect().top;
        const start=saved.getBoundingClientRect().top;
        const prose=block.querySelector('.mes_text');
        const readingSpace=Math.min(prose?.offsetHeight || 0,chat.clientHeight / 3)+16;
        if (start < top+readingSpace || start > top+chat.clientHeight-80) chat.scrollTop+=start-top-readingSpace;
    }));
}

const blockFor = (chat, id) => chat?.querySelector(`.mes[mesid="${id}"]:not([is_user="true"]) .mes_block`);

function place(chat, block) {
    const target = block || chat;
    if (strip.parentElement === target) return;
    if (block) block.insertBefore(strip,block.querySelector(':scope > .ri-tray'));
    else chat.append(strip);
}

async function readAgain() {
    const { refreshUnderReplies } = await import('./sent.js');
    refreshUnderReplies();
    const chat = document.getElementById('chat');
    if (last && isReply(ctx().chat?.[last.id]) && blockFor(chat,last.id)?.querySelector(':scope > .ri-tray:not(.ri-tray-loading)')) {
        strip?.remove();
        strip = null;
    }
}

/** End the Strip on its exit path. A resolved Strip gives way to the reply's own tray; the others stay labeled. */
function finish() {
    ending = null;
    if (!strip || !last) return;
    const c = ctx();
    const left = exits.chatChanged;
    const end = loadingExit({ lastPhase:last.phase, stopped:exits.stopped, chatChanged:left,
        replyArrived:isReply(c.chat?.[last.id]) && !!String(c.chat[last.id].mes || '').trim() });
    exits.stopped = exits.chatChanged = false;
    paintLoadingStrip(strip,modelFor(last,end),{readAgain});
    if (left) {
        // The Strip belonged to the chat that was left; it ends stopped and leaves with it.
        strip.remove();
        strip = null;
        return;
    }
    const chat = document.getElementById('chat');
    const block = blockFor(chat,last.id);
    if (block) place(chat,block);
    if (end==='resolved') {
        if (last.phase==='ready') keepReplyInView(chat,block);
        import('./sent.js').then(({refreshUnderReplies})=>{
            refreshUnderReplies();
            if (block?.querySelector(':scope > .ri-tray:not(.ri-tray-loading)') || !block) { strip?.remove(); strip = null; }
        }).catch(error=>console.warn(LOG,'reply tray',error));
    }
}

const showsLoading = () => enabledV10() && trayShows(true,chatTray());

export function refreshReplyProgress() {
    const progress = replyProgress();
    const chat = document.getElementById('chat');
    const block = progress && blockFor(chat,progress.id);
    refreshPreview(block,progress);
    if (!progress) {
        // Cleared: wait a moment for the Stop or chat change that caused it, then end the Strip on its path.
        if (strip && last && !ending && !strip.dataset.end) ending = setTimeout(finish,60);
        follow?.abort();
        return;
    }
    if (!chat || !showsLoading()) {
        strip?.remove();
        strip = null;
        return;
    }
    if (!strip || turn!==progress.turn) {
        if (ending) { clearTimeout(ending); finish(); }
        if (strip && !strip.dataset.end) paintLoadingStrip(strip,modelFor(last || progress,'stopped'));
        // An ended Strip under its reply keeps its label; one that never reached a reply goes.
        if (strip && !strip.closest('.mes_block')) strip.remove();
        turn=progress.turn;
        follow=followMobileReply(chat);
        initialModules=effectiveModules();
        exits.stopped = exits.chatChanged = false;
        strip=loadingStrip();
    }
    last=progress;
    paintLoadingStrip(strip,modelFor(progress));
    place(chat,block);
}

export function mountReplyProgress() {
    mountReplyTray();
    const redraw = () => import('./sent.js').then(({refreshUnderReplies})=>refreshUnderReplies()).catch(error=>console.warn(LOG,'reply tray',error));
    onTrayChange(redraw);
    mountSceneHeader({
        // The header belongs to the scene feature: asked for only while that feature is on Ours.
        active: () => enabledV10() && effectiveModules().state !== false,
        changed: redraw,
    });
    on('GENERATION_STOPPED',()=>{ exits.stopped = true; });
    on('CHAT_CHANGED',()=>{ exits.chatChanged = true; });
    onReplyProgress(() => {
        try { refreshReplyProgress(); } catch (error) { console.warn(LOG,'reply progress',error); }
    });
}
