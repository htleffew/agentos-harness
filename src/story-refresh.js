import { ctx, KEY, isReply, isGenerating, toast } from './st.js';
import { chatState, settings } from './store.js';
import { memoryComponents, memoryOnly } from './components.js';
import { enabledV10 } from './v10.js';
import { chapterBusy, refreshEditedStory } from './chapters.js';
import { historySourceMark } from './history-source.js';
import { chatWorld } from './world.js';
import { invalidateAfterEdit, syncWorld } from './worldflow.js';
import { addLog } from './log.js';

let observed;
let timer;
let pending;
let deletionTimer;
let deletion;

const active = () => settings().enabled && !chatState()?.worldDetached && (!memoryOnly() && memoryComponents().world &&
    (enabledV10() || chatWorld() && settings().world.update!=='off') || memoryComponents().chapters);
const identity = message => message.send_date || message.extra?.[KEY]?.time || message;
const chatKey = () => ctx().getCurrentChatId?.();

export function rememberStoryTimeline() {
    const chat = ctx().chat || [];
    let replies = 0;
    observed = {id:chatKey(),messages:chat.map((message,index)=>{
        if (index && isReply(message)) replies++;
        const record = message.extra?.[KEY];
        const chapter = (record?.update?.changes || []).some(change=>change.kind==='chapter' && change.type==='create');
        return {key:identity(message),mark:historySourceMark(message),reply:replies,chapter};
    })};
}

const replyNumber = (chat,end) => Math.max(1,chat.slice(1,end+1).filter(isReply).length);
function queueRepair(from, chapterThrough, redraw) {
    const id = chatKey();
    if (!active() || memoryOnly() && !chapterThrough || !id || !(ctx().chat || []).slice(1).some(isReply)) { redraw?.(); return; }
    if (pending?.id===id) {
        pending.from = Math.min(pending.from,from);
        pending.chapterThrough = Math.max(pending.chapterThrough,chapterThrough);
    } else pending = {id,from,chapterThrough,redraw};
    clearTimeout(timer);
    timer = setTimeout(runRepair,350);
}

async function runRepair() {
    if (!pending || pending.id!==chatKey() || !active()) { pending=null; return; }
    if (chapterBusy() || isGenerating()) { timer=setTimeout(runRepair,500); return; }
    const work = pending;
    pending = null;
    try {
        await refreshEditedStory(work.from,work.chapterThrough);
        if (work.id===chatKey()) work.redraw?.();
    } catch (error) {
        addLog({what:'Automatic story refresh',ok:false,result:error.message || String(error)});
        if (work.id===chatKey() && !pending && /chat changed during catch-up/i.test(error.message)) {
            queueRepair(work.from,work.chapterThrough,work.redraw);
        } else if (work.id===chatKey() && !pending) {
            toast('warning','The automatic story refresh stopped. '+error.message);
        }
    }
}

export function refreshAfterReplyEdit(index, redraw) {
    const chat = ctx().chat || [];
    if (!active() || !chat[index] || chat[index].is_user) return;
    const before = observed?.id===chatKey() ? observed.messages : [];
    const previous = before[index];
    if (previous?.mark===historySourceMark(chat[index])) return;
    const chapterThrough = Math.max(0,...before.filter(message=>message.chapter).map(message=>message.reply),
        ...chat.flatMap((message,index)=>(message.extra?.[KEY]?.update?.changes || []).some(change=>change.kind==='chapter' && change.type==='create')
            ? [replyNumber(chat,index)] : []));
    rememberStoryTimeline();
    invalidateAfterEdit(index,firstReply=>{
        const from = firstReply || replyNumber(chat,index);
        queueRepair(from,chapterThrough,redraw);
        redraw?.();
    });
}

export function refreshAfterDeletion(redraw) {
    const id = chatKey();
    if (deletion?.id!==id) deletion = {id,before:observed?.id===id ? observed.messages : [],redraw};
    clearTimeout(deletionTimer);
    deletionTimer = setTimeout(flushStoryDeletion,250);
}

export async function flushStoryDeletion() {
    const work = deletion;
    deletion = null;
    clearTimeout(deletionTimer);
    if (!work || work.id!==chatKey()) return;
    const {before,redraw} = work;
    const chat = ctx().chat || [];
    const first = chat.findIndex((message,index)=>before[index] && before[index].key!==identity(message));
    const deleted = before.length > chat.length;
    const through = Math.max(0,...before.filter(message=>message.chapter).map(message=>message.reply));
    rememberStoryTimeline();
    if (!active() || !deleted) return syncWorld(redraw);
    if (first>=0) {
        let affected;
        await invalidateAfterEdit(first,firstReply=>{affected=firstReply;});
        return syncWorld(()=>{
            queueRepair(affected || replyNumber(chat,first),through,redraw);
            redraw?.();
        });
    }
    return syncWorld(()=>{
        const tail = chat.findLastIndex((message,index)=>index>0 && isReply(message));
        const current = chat[tail]?.extra?.[KEY];
        if (tail>=0 && (!current?.update || current.stateStale)) {
            const prior = chat.slice(0,tail).findLastIndex(message=>message.extra?.[KEY]?.update && !message.extra[KEY].stateStale);
            queueRepair(replyNumber(chat,prior)+Number(prior>0),Math.min(through,replyNumber(chat,tail)),redraw);
        }
        redraw?.();
    });
}

export function refreshAfterChatOpen(redraw) {
    const host = ctx(), root = chatState();
    const owner = String(host.chatMetadata?.integrity || host.getCurrentChatId?.() || '');
    const branch = !!host.chatMetadata?.main_chat && root?.worldOwner!==owner;
    const inheritedChapter = branch && Object.values(root?.worldLog?.items || {}).some(row=>
        row.changes?.some(change=>change.kind==='chapter' && change.type==='create'));
    const id = chatKey();
    syncWorld(()=>{
        if (id!==chatKey()) return;
        rememberStoryTimeline();
        if (!active() || chatState()?.branchPendingWorld || !branch && !chatState()?.historyNeedsReview) { redraw?.(); return; }
        const chat = ctx().chat || [];
        const tail = chat.findLastIndex((message,index)=>index>0 && isReply(message));
        const current = chat[tail]?.extra?.[KEY];
        if (tail>=0 && (!current?.update || current.stateStale)) {
            const prior = chat.slice(0,tail).findLastIndex(message=>message.extra?.[KEY]?.update && !message.extra[KEY].stateStale);
            const covered = inheritedChapter || chat.some(message=>message.extra?.[KEY]?.stateStale &&
                message.extra[KEY].update?.changes?.some(change=>change.kind==='chapter'));
            queueRepair(replyNumber(chat,prior)+Number(prior>0),covered ? replyNumber(chat,tail) : 0,redraw);
        }
        redraw?.();
    });
}
