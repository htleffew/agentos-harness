import { ctx, sub } from './st.js';
import { separateReply } from './reply-format.js';

export const BOOK_TRIGGER_SOURCES = {
    chat: 'Host’s recent chat scan',
    user: 'Latest user message',
    assistant: 'Previous model reply',
};

export const bookTriggerSource = entry => ['user', 'assistant'].includes(entry.extensions?.riTriggerSource)
    ? entry.extensions.riTriggerSource : 'chat';

export function scopedTriggerTexts(chat, type) {
    const excluded = ['swipe', 'regenerate', 'continue'].includes(type) && !chat.at(-1)?.is_user;
    const input = excluded ? chat.slice(0, -1) : chat;
    const last = role => input.findLast(message => !message.is_system && !!message.is_user === (role === 'user') && message.mes);
    const output = separateReply(last('assistant')?.mes || '').text
        .replace(/<(story_update|sent_instructions|think|thinking|analysis)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '');
    return { user: last('user')?.mes || '', assistant: output };
}

export function reusableKeywordMatch(entry, text) {
    if (!text) return false;
    const match = raw => {
        const key = sub(raw).trim();
        if (!key) return false;
        const regex = /^\/(.+)\/([gimsuy]*)$/.exec(key);
        if (regex) {
            try { return new RegExp(regex[1], regex[2]).test(text); } catch { /* treat invalid regex as literal */ }
        }
        const needle = entry.caseSensitive ? key : key.toLowerCase();
        const haystack = entry.caseSensitive ? text : text.toLowerCase();
        if (entry.matchWholeWords === false || /\s/.test(needle)) return haystack.includes(needle);
        const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?:$|[^\\p{L}\\p{N}_])`, 'u').test(haystack);
    };
    if (!entry.key?.some(match)) return false;
    if (!entry.selective || !entry.keysecondary?.length) return true;
    const hits = entry.keysecondary.map(match);
    return [hits.some(Boolean), hits.some(hit => !hit), hits.every(hit => !hit), hits.every(Boolean)][entry.selectiveLogic || 0];
}

// A stable macro key lets the host own probability, sticky/cooldown and prompt budgets.
const registered = new Map();
export function beginBookTriggers() {
    for (const state of registered.values()) state.match = false;
}

export function scopedBookEntry(entry, texts) {
    const source = bookTriggerSource(entry);
    if (source === 'chat' || entry.constant || entry.disable) return entry;
    const c = ctx();
    if (!c.registerMacro) return { ...entry, disable: true };
    const id = Array.from(new TextEncoder().encode(JSON.stringify([entry.world, entry.uid])), n => n.toString(16).padStart(2, '0')).join('');
    const name = `ri_book_trigger_${id}`;
    let state = registered.get(name);
    if (!state) {
        state = { match: false };
        c.registerMacro(name, () => state.match ? '/^/' : '');
        registered.set(name, state);
    }
    state.match = reusableKeywordMatch(entry, texts[source]);
    return { ...entry, comment: entry.comment || entry.key?.[0] || `Entry ${entry.uid}`,
        key: [`{{${name}}}`], keysecondary: [], selective: false, scanDepth: 1 };
}
