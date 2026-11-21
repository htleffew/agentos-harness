import { memoryComponents } from './components.js';
// Hiding older messages from the AI once a chapter covers them, and showing them again when that chapter is undone.
// The messages stay in the chat; SillyTavern leaves hidden messages out of what it sends.
import { ctx, KEY } from './st.js';
import { settings, chatState, saveChatState, saveSettings } from './store.js';

/** A message's own mark, kept when other messages are deleted: its send date, or failing that its place. */
export const messageMark = (m, i) => String(m?.send_date || `#${i}`);

/**
 * Hide from the AI the messages up to chat index `upTo` (a covered reply), keeping the newest messages and the
 * opening message. Returns the marks of the messages this hid, so they can be shown again.
 */
export async function hideCovered(upTo, { persist = true } = {}) {
    const o = settings().summary;
    if (!memoryComponents().hide) return [];
    const chat = ctx().chat || [];
    const keep = Math.max(4, Math.round(Number(o.keepShown) || 30));
    const end = Math.min(upTo, chat.length - 1 - keep);
    const hid = [];
    for (let i = 1; i <= end; i++) {
        const m = chat[i];
        if (!m || m.is_system) continue;   // already hidden, or a notice of SillyTavern's own
        m.is_system = true;
        try { globalThis.$?.(`.mes[mesid="${i}"]`)?.attr('is_system', 'true'); } catch { /* the screen catches up on reload */ }
        hid.push(messageMark(m, i));
    }
    if (hid.length && persist) await ctx().saveChat?.();
    return hid;
}

/** Show again the messages a chapter hid. marks: what hideCovered returned. */
export function showAgain(marks, { persist = true } = {}) {
    const want = new Set(marks || []);
    const chat = ctx().chat || [];
    let n = 0;
    chat.forEach((m, i) => {
        if (!m || !m.is_system || !want.has(messageMark(m, i))) return;
        m.is_system = false;
        try { globalThis.$?.(`.mes[mesid="${i}"]`)?.attr('is_system', 'false'); } catch { /* the screen catches up on reload */ }
        n++;
    });
    if (n && persist) Promise.resolve(ctx().saveChat?.()).catch(() => {});
    return n;
}


/** Restore only messages previously hidden by this extension. */
export function restoreChapterHistory({ persist = true } = {}) {
    const updates = (ctx().chat || []).flatMap(message=>[
        message.extra?.[KEY]?.update,
        ...(message.swipe_info || []).map(swipe=>swipe.extra?.[KEY]?.update),
    ]).filter(Boolean);
    const logs = Object.values(chatState()?.worldLog?.items || {});
    const marks = new Set();
    for (const receipt of [...updates,...logs]) {
        for (const change of receipt.changes || []) if (change.type==='hide') {
            for (const mark of change.dates || []) marks.add(mark);
        }
        if (receipt.changes?.some(change=>change.type==='hide')) receipt.changes = receipt.changes.filter(change=>change.type!=='hide');
    }
    if (!marks.size) return 0;
    const restored = showAgain(marks,{persist});
    if (persist) {
        if (!restored) Promise.resolve(ctx().saveChat?.()).catch(()=>{});
        saveChatState();
    }
    return restored;
}

export function setMemoryComponent(key, value) {
    const state = chatState();
    if (state) {
        (state.components ||= {})[key] = value;
        saveChatState();
        if (key !== 'world' && !value) restoreChapterHistory();
    } else if (key !== 'world') {
        settings().summary[key==='chapters' ? 'on' : 'hide'] = value;
        saveSettings();
    }
}
