// Estimates from text the host exposes. Never stores prompt or chat text.
import { ctx, isStory, isHidden, isReply, sub } from './st.js';

export const estimateTokens = text => Math.ceil(String(text || '').length / 4);
const plain = content => typeof content === 'string' ? content : Array.isArray(content) ? content.map(p => typeof p?.text === 'string' ? p.text : '').join('') : '';
const clean = text => String(text || '').replace(/\s*<sent_instructions>[\s\S]*?<\/sent_instructions>/g, '').replace(/\s*<story_update\b[^>]*>[\s\S]*?<\/story_update>/gi, '').trim();
const chatId = () => String(ctx().getCurrentChatId?.() || '');
let last = null;

/** Preview the recent protected window. This is not the future assembled prompt. */
export function historyPreview(limit) {
    const chat = ctx().chat || [];
    const eligible = chat.map((m, i) => ({m, i})).filter(({m}) => isStory(m));
    const recent = eligible.filter(({i}) => i >= Math.max(1, chat.length - limit));
    return { count: recent.length, tokens: estimateTokens(recent.map(({m}) => clean(m.mes)).join('\n')), hidden: eligible.filter(({m}) => isHidden(m)).length,
        open: eligible.filter(({m}) => !isHidden(m)).length, total: eligible.length };
}

/** Approximate recent text represented by N model replies, including intervening user messages. */
export function chapterPreview(limit) {
    const chat = ctx().chat || [];
    if (!limit) return { replies: 0, messages: 0, tokens: 0 };
    let replies = 0, start = chat.length;
    for (let i = chat.length - 1; i >= 1; i--) {
        if (!isStory(chat[i])) continue;
        start = i;
        if (isReply(chat[i]) && ++replies >= limit) {
            // Include the user message immediately preceding the earliest reply.
            if (i > 1 && chat[i - 1]?.is_user && isStory(chat[i - 1])) start = i - 1;
            break;
        }
    }
    const selected = chat.slice(start).filter(isStory);
    return { replies, messages: selected.length, tokens: estimateTokens(selected.map(m => clean(m.mes)).join('\n')) };
}

/** Capture only counts and estimates, after the extension has cleaned the request. */
export function captureContext(messages, { items = [], ask = '' } = {}) {
    const texts = messages.map(m => plain(m?.content));
    const used = texts.map(() => []);
    // Match each full passage once and reserve its span. An unmatched passage is unknown, not zero.
    function claim(text) {
        const needle = String(text || '').trim();
        if (!needle) return 0;
        for (let i = 0; i < texts.length; i++) {
            let from = 0, at;
            while ((at = texts[i].indexOf(needle, from)) >= 0) {
                const end = at + needle.length;
                if (!used[i].some(([a,b]) => at < b && end > a)) { used[i].push([at,end]); return needle.length; }
                from = at + 1;
            }
        }
        return -1;
    }
    const result = { chatId: chatId(), at: Date.now(), total: estimateTokens(texts.join('\n')), unsupportedContent: messages.some(m => Array.isArray(m?.content) && m.content.some(p => p?.type && !['text','input_text'].includes(p.type))),
        history: { count: 0, chars: 0, unmatched: 0 }, notes: { chars: 0, unmatched: 0 }, chapters: { chars: 0, unmatched: 0 }, events: { chars: 0, unmatched: 0 }, other: { chars: 0, unmatched: 0 }, updates: { chars: 0, unmatched: 0 } };
    // Claim extension passages first: they can be merged into a user/assistant role by a preset.
    for (const item of items) {
        const value = sub(item.text || '');
        const hit = claim(value);
        const group = item.notes ? result.notes : item.event || item.worldOrder ? result.events : result.other;
        if (hit < 0) { group.unmatched++; continue; }
        if (item.notes) {
            const chapter = value.match(/(?:^|\n)The story so far:\n[\s\S]*?(?=\n(?:Open threads|Going on elsewhere|In this scene|Where|Secrets|Planted earlier|Also relevant):|\]$)/)?.[0] || '';
            result.chapters.chars += chapter.length;
            group.chars += Math.max(0, hit - chapter.length);
        } else group.chars += hit;
    }
    if (ask) { const hit = claim(sub(ask)); if (hit < 0) result.updates.unmatched++; else result.updates.chars += hit; }
    // Recognize full unhidden story messages. Injected role messages are not treated as chat history.
    for (const m of (ctx().chat || []).filter(m => isStory(m) && !isHidden(m)).reverse()) {
        const text = sub(clean(m.mes)); if (!text) continue;
        const hit = claim(text);
        if (hit < 0) result.history.unmatched++; else { result.history.count++; result.history.chars += hit; }
    }
    for (const key of ['history','notes','chapters','events','other','updates']) result[key].tokens = Math.ceil(result[key].chars / 4);
    last = result;
    return result;
}
export function lastContext() { return last?.chatId === chatId() ? last : null; }
