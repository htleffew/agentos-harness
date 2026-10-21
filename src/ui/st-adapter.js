// The UI's only contact with SillyTavern globals. Everything is optional and guarded so the UI
// also runs in the dev harness (no ST) and degrades quietly if ST changes.
// Events (ST 1.18 public/scripts/events.js): character_message_rendered, message_swiped, message_edited,
// message_updated, more_messages_loaded, chat_id_changed, generation_started, generation_ended,
// generation_stopped.

export function stContext() {
    try {
        return globalThis.SillyTavern?.getContext?.() ?? null;
    } catch {
        return null;
    }
}

/** Subscribe to ST eventSource events by event_types key. Returns an unsubscribe function. */
export function onStEvents(typeKeys, fn) {
    const ctx = stContext();
    const src = ctx?.eventSource;
    const types = ctx?.eventTypes || ctx?.event_types;
    if (!src || !types || typeof src.on !== 'function') return () => {};
    const names = typeKeys.map(k => types[k]).filter(Boolean);
    for (const n of names) src.on(n, fn);
    return () => {
        for (const n of names) {
            try { src.removeListener?.(n, fn); } catch { /* ignore */ }
        }
    };
}

/** True while ST streams a reply into the DOM (never decorate then). */
export function isStreaming() {
    // body[data-generating] is set by ST while a reply is produced (public/style.css:4569 relies on it).
    if (document.body?.dataset?.generating === 'true') return true;
    const sp = stContext()?.streamingProcessor;
    return !!(sp && !sp.isFinished && !sp.isStopped);
}

/** The raw message text for a chat index (from ST's chat array), or null. */
export function rawMessage(mesId) {
    const chat = stContext()?.chat;
    const m = Array.isArray(chat) ? chat[Number(mesId)] : null;
    return m && typeof m.mes === 'string' ? m : null;
}

/** ST confirm popup (falls back to window.confirm). Resolves to boolean. */
export async function confirmPopup(text, okText = 'Reset') {
    const ctx = stContext();
    try {
        if (ctx?.callGenericPopup && ctx?.POPUP_TYPE) {
            const res = await ctx.callGenericPopup(text, ctx.POPUP_TYPE.CONFIRM, '', { okButton: okText, cancelButton: 'Cancel' });
            return res === 1 || res === true;
        }
    } catch (err) {
        console.warn('[Undercurrent UI] popup failed', err);
    }
    try { return window.confirm(text); } catch { return false; }
}

export function toast(kind, message, title = 'Undercurrent') {
    try {
        const t = globalThis.toastr;
        if (t && typeof t[kind] === 'function') t[kind](message, title);
    } catch { /* ignore */ }
}
