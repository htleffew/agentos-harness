import { memoryComponents } from './components.js';
import { historyWindowStart } from './context-budget.js';
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
export async function hideCovered(upTo, { persist = true, from = 1 } = {}) {
    const o = settings().summary;
    if (!memoryComponents().hide) return [];
    const chat = ctx().chat || [];
    const unit=o.historyUnit==='tokens' ? 'tokens' : 'messages';
    const limit=unit==='tokens' ? Math.max(250,Math.round(Number(o.keepTokens) || 8000)) : Math.max(4,Math.round(Number(o.keepShown) || 30));
    const end = Math.min(upTo,historyWindowStart(chat,{unit,limit})-1);
    const hid = [];
    for (let i = Math.max(1,from); i <= end; i++) {
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

/** Restore the exact hidden messages from a transaction that stopped. */
export function hideAgain(marks) {
    const wanted = new Set(marks || []);
    (ctx().chat || []).forEach((m,index)=>{
        if (!m || m.is_system || !wanted.has(messageMark(m,index))) return;
        m.is_system = true;
        try {globalThis.$?.(`.mes[mesid="${index}"]`)?.attr('is_system','true');}
        catch { /* the screen catches up on reload */ }
    });
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

// ---------- hiding at request assembly (memory DESIGN 6.3) ----------
// For a chat whose memory lives in chat data, no hidden flag is stored on the messages. SillyTavern hands every
// generation's copy of the chat to the extension's generate interceptor (manifest `generate_interceptor`); there the
// messages a valid chapter covers are taken out and the chapter view goes in at their place, so coverage and the text
// that replaces it always reach the model together. A dry run (token counts, the prompt preview) does not run
// interceptors, so it shows the chat as it is. When the host cannot run the interceptor, stored hiding is the fallback:
// syncStoredHiding keeps is_system on exactly the covered messages and marks the ones it hid, so a stale chapter, an
// edit, a delete or a branch shows them again.

export const INTERCEPTOR = 'roleplayInstructionsInterceptor';
const HIDDEN = 'ri_memory_hidden';
let lastAssembly = null;

/** 'assembly' (the generation hook leaves messages out) or 'stored' (the is_system fallback). */
export const hidingMode = () => (settings().summary?.hiding === 'stored' ? 'stored' : 'assembly');

/** What the last generation left out and put in, for Review and the tests. */
export const lastChapterAssembly = () => (lastAssembly ? structuredClone(lastAssembly) : null);

/**
 * Install the generate interceptor. provider({ type, chat }) returns null when chapters do not apply to this chat, or
 * { covered: Set of marks, view: text, chapters: [ids], hide: boolean, apply(prompt, covered, view) }.
 */
export function installAssemblyHiding(provider) {
    globalThis[INTERCEPTOR] = async (prompt, contextSize, abort, type) => {
        try {
            const state = provider({ type, prompt });
            if (!state) return;
            const covered = state.hide && hidingMode() === 'assembly' ? state.covered : new Set();
            const result = state.apply(prompt, covered, state.view);
            lastAssembly = { chatId: String(ctx().getCurrentChatId?.() || ''), type: String(type || 'normal'), at: Date.now(), mode: hidingMode(),
                removed: result.removed, inserted: result.inserted, position: result.at, chapters: state.chapters, viewTokens: Math.ceil(String(state.view || '').length / 4),
                messages: prompt.length };
        } catch (error) { console.warn('[Roleplay Instructions] chapter assembly', error); }
    };
    return INTERCEPTOR;
}

/**
 * Stored hiding, the fallback: hide exactly the covered messages and show again the ones this hid that are no longer
 * covered. markOf: the message's memory mark. Returns the number of messages changed.
 */
export function syncStoredHiding(covered, markOf) {
    const chat = ctx().chat || [];
    let changed = 0;
    chat.forEach((m, i) => {
        if (!m || i === 0) return;
        const want = covered.has(markOf(m));
        const ours = m.extra?.[HIDDEN] === true;
        if (want && !m.is_system) {
            m.is_system = true;
            m.extra = m.extra && typeof m.extra === 'object' ? m.extra : {};
            m.extra[HIDDEN] = true;
        } else if (!want && ours) {
            m.is_system = false;
            delete m.extra[HIDDEN];
        } else return;
        changed++;
        try { globalThis.$?.(`.mes[mesid="${i}"]`)?.attr('is_system', String(!!m.is_system)); } catch { /* the screen catches up on reload */ }
    });
    return changed;
}

/** Show again every message stored hiding hid (when the host runs the interceptor again, or chapters turn off). */
export function clearStoredHiding() {
    return syncStoredHiding(new Set(), () => '');
}

export function setMemoryComponent(key, value) {
    const state = chatState();
    if (state) {
        (state.components ||= {})[key] = value;
        saveChatState();
        if (key !== 'world' && !value) { restoreChapterHistory(); if (clearStoredHiding()) Promise.resolve(ctx().saveChat?.()).catch(() => {}); }
    } else if (key !== 'world') {
        settings().summary[key==='chapters' ? 'on' : 'hide'] = value;
        saveSettings();
    }
}
