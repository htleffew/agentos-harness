import { ctx, KEY } from './st.js';
import { chatState, settings } from './store.js';
import { memoryComponents, memoryOnly } from './components.js';
import { enabledV10 } from './v10.js';
import { historySourceMark } from './history-source.js';
import { chatWorld } from './world.js';
import { invalidateAfterEdit, syncWorld } from './worldflow.js';

let observed;
let deletionTimer;
let deletion;

const active = () => settings().enabled && !chatState()?.worldDetached && (!memoryOnly() && memoryComponents().world &&
    (enabledV10() || chatWorld() && settings().world.update!=='off') || memoryComponents().chapters);
const identity = message => message.send_date || message.extra?.[KEY]?.time || message;
const chatKey = () => ctx().getCurrentChatId?.();

export function rememberStoryTimeline() {
    observed = {
        id:chatKey(),
        messages:(ctx().chat || []).map(message=>({key:identity(message),mark:historySourceMark(message)})),
    };
}

export function refreshAfterReplyEdit(index, redraw) {
    const message = ctx().chat?.[index];
    if (!active() || !message || message.is_user) return;
    const previous = observed?.id===chatKey() ? observed.messages[index] : undefined;
    if (previous?.mark===historySourceMark(message)) return;
    rememberStoryTimeline();
    return invalidateAfterEdit(index,redraw);
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
    rememberStoryTimeline();
    if (active() && deleted && first>=0) await invalidateAfterEdit(first);
    if (work.id===chatKey()) return syncWorld(redraw,{deleted});
}

export function refreshAfterChatOpen(redraw) {
    const id = chatKey();
    return syncWorld(()=>{
        if (id!==chatKey()) return;
        rememberStoryTimeline();
        redraw?.();
    });
}
