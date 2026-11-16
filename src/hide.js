// Hiding older messages from the AI once a chapter covers them, and showing them again when that chapter is undone.
// The messages stay in the chat; SillyTavern leaves hidden messages out of what it sends.
import { ctx } from './st.js';
import { settings } from './store.js';

/** A message's own mark, kept when other messages are deleted: its send date, or failing that its place. */
export const messageMark = (m, i) => String(m?.send_date || `#${i}`);

/**
 * Hide from the AI the messages up to chat index `upTo` (a covered reply), keeping the newest messages and the
 * opening message. Returns the marks of the messages this hid, so they can be shown again.
 */
export async function hideCovered(upTo) {
    const o = settings().summary;
    if (o.hide === false) return [];
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
    if (hid.length) await ctx().saveChat?.();
    return hid;
}

/** Show again the messages a chapter hid. marks: what hideCovered returned. */
export function showAgain(marks) {
    const want = new Set(marks || []);
    const chat = ctx().chat || [];
    let n = 0;
    chat.forEach((m, i) => {
        if (!m || !m.is_system || !want.has(messageMark(m, i))) return;
        m.is_system = false;
        try { globalThis.$?.(`.mes[mesid="${i}"]`)?.attr('is_system', 'false'); } catch { /* the screen catches up on reload */ }
        n++;
    });
    if (n) Promise.resolve(ctx().saveChat?.()).catch(() => {});
    return n;
}

