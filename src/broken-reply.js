// B53: a note on the composer bar when a reply lands broken. Code checks each reply: empty, only an error line, or the
// same text as the previous reply. The note offers Regenerate, which runs SillyTavern's own regenerate. Nothing
// regenerates by itself, and a normal reply makes no request and shows nothing.
import { ctx, isReply, on } from './st.js';

const SLOT = 'broken-reply';
const NOTE = {
    empty: { label: 'Empty reply', text: 'The reply came back empty. Regenerate asks for it again.' },
    error: { label: 'Error reply', text: 'The reply is only an error line. Regenerate asks for it again.' },
    repeat: { label: 'Repeated reply', text: 'The reply is the same text as the one before it. Regenerate asks for it again.' },
};
const ERROR_LINE = /^[\s\[(<*]*(api\s+)?(error|exception|request\s+(failed|error)|generation\s+(failed|error)|unauthorized|rate\s*limit(ed)?|too many requests|service unavailable|bad gateway|internal server error|failed to (fetch|generate))\b/i;

const squash = text => String(text ?? '').replace(/\s+/g, ' ').trim();

/** 'empty', 'error', 'repeat' or '' for the reply at this chat index. A pure read of the chat. */
export function brokenKind(chat, index) {
    const message = chat?.[index];
    if (!isReply(message) || message.is_system) return '';
    const text = squash(message.mes);
    if (!text) return 'empty';
    if (text.length <= 300 && !/\n\s*\n/.test(String(message.mes).trim()) && ERROR_LINE.test(text)) return 'error';
    for (let i = index - 1; i >= 0; i--) {
        const earlier = chat[i];
        if (!earlier || earlier.is_user || earlier.is_system) continue;
        return squash(earlier.mes) === text ? 'repeat' : '';
    }
    return '';
}

async function setNote(notice) {
    try { (await import('./ui/composer-bar.js')).setBarNotice(notice, SLOT); } catch { /* no bar in this host */ }
}
const clear = () => setNote(null);

/** SillyTavern's own regenerate: the same path as its Regenerate menu item. */
export function regenerateReply() {
    const item = document.querySelector('#option_regenerate');
    if (item) { item.click(); return true; }
    const host = ctx();
    if (typeof host.generate === 'function') { host.generate('regenerate'); return true; }
    return false;
}

/** Called for every reply that lands. type is the host's second MESSAGE_RECEIVED argument. */
export function checkBrokenReply(id, type) {
    try {
        if (type === 'first_message') return;
        const kind = brokenKind(ctx().chat, Number(id));
        if (!kind) { clear(); return; }
        setNote({ id: `broken-${kind}`, tone: 'problem', count: 1, ...NOTE[kind],
            actions: [{ label: 'Regenerate', run: () => { clear(); regenerateReply(); } }],
            onDismiss: clear });
    } catch (error) { console.warn('[Roleplay Instructions]', 'broken reply check', error); }
}

/** Wire the note once: it goes away when a new generation starts or the chat changes. */
export function installBrokenReply() {
    on('GENERATION_STARTED', (type, options, dry) => { if (!dry) clear(); });
    on('CHAT_CHANGED', clear);
}
