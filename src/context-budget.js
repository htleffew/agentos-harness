// Estimates from text the host exposes. Never stores prompt or chat text.
import { ctx, isStory, isHidden, isReply, sub } from './st.js';
import { settings } from './store.js';

export const estimateTokens = text => Math.ceil(String(text || '').length / 4);
const plain = content => typeof content === 'string' ? content : Array.isArray(content) ? content.map(p => typeof p?.text === 'string' ? p.text : '').join('') : '';
const clean = text => String(text || '').replace(/\s*<sent_instructions>[\s\S]*?<\/sent_instructions>/g, '').replace(/\s*<story_update\b[^>]*>[\s\S]*?<\/story_update>/gi, '').trim();
const chatId = () => String(ctx().getCurrentChatId?.() || '');
let last = null;

/** Index of the oldest protected recent story message. The opening is kept separately. */
export function historyWindowStart(chat,{limit,unit='messages'}) {
    let start=chat.length, count=0, chars=0;
    for (let i=chat.length-1;i>=1;i--) {
        if (!isStory(chat[i])) continue;
        const next=chars+(count ? 1 : 0)+clean(chat[i].mes).length;
        if (unit==='tokens' ? count>=2 && Math.ceil(next/4)>limit : count>=limit) break;
        start=i;
        count++;
        chars=next;
    }
    return start;
}

/** Preview the recent protected window. This is not the future assembled prompt. */
export function historyPreview(limit,unit='messages') {
    const chat = ctx().chat || [];
    const eligible = chat.map((m, i) => ({m, i})).filter(({m}) => isStory(m));
    const start=historyWindowStart(chat,{limit,unit});
    const recent = eligible.filter(({i}) => i>=start);
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
export function captureContext(messages, { items = [], ask = '', lore = [] } = {}) {
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
        history: { count: 0, chars: 0, unmatched: 0 }, notes: { chars: 0, unmatched: 0 }, chapters: { chars: 0, unmatched: 0 },
        lore: { chars: 0, unmatched: 0 }, events: { chars: 0, unmatched: 0 }, other: { chars: 0, unmatched: 0 }, updates: { chars: 0, unmatched: 0 } };
    // Claim extension passages first: they can be merged into a user/assistant role by a preset.
    for (const item of items) {
        const value = sub(item.text || '');
        const hit = claim(value);
        const group = item.notes ? result.notes : item.event || item.worldOrder ? result.events : result.other;
        if (hit < 0) { group.unmatched++; continue; }
        if (item.notes) {
            const chapter = value.match(/(?:^|\n)The story so far:\n[\s\S]*?(?=\n(?:Open threads|Going on elsewhere|In this scene|Where|Secrets|Planted earlier|Also relevant|Relevant facts):|\]$)/)?.[0] || '';
            result.chapters.chars += chapter.length;
            group.chars += Math.max(0, hit - chapter.length);
        } else group.chars += hit;
    }
    const guidance=ask ? sub(ask).trim() : '';
    const guidanceHit=guidance ? claim(guidance) : 0;
    if (guidanceHit<0) result.updates.unmatched++;
    else result.updates.chars+=guidanceHit;
    const counted=new Set();
    for (const entry of lore) {
        if (entry.managedSet || entry.delivery==='Recall block' || entry.delivery==='Story notes block') continue;
        const text=sub(entry.text || '').trim();
        if (!text || counted.has(text)) continue;
        counted.add(text);
        if (entry.recallUid!=null && guidanceHit>0 && guidance.includes(text)) {
            result.lore.chars+=text.length;
            result.updates.chars=Math.max(0,result.updates.chars-text.length);
            continue;
        }
        const hit=claim(text);
        if (hit<0) result.lore.unmatched++;
        else result.lore.chars+=hit;
    }
    // Recognize full unhidden story messages. Injected role messages are not treated as chat history.
    for (const m of (ctx().chat || []).filter(m => isStory(m) && !isHidden(m)).reverse()) {
        const text = sub(clean(m.mes)); if (!text) continue;
        const hit = claim(text);
        if (hit < 0) result.history.unmatched++; else { result.history.count++; result.history.chars += hit; }
    }
    for (const key of ['history','notes','chapters','lore','events','other','updates']) result[key].tokens = Math.ceil(result[key].chars / 4);
    last = result;
    return result;
}
export function lastContext() { return last?.chatId === chatId() ? last : null; }

// ---------- the memory blocks of the last request (memory DESIGN 5) ----------

let layout = null;
/** Keep what src/memory/inject.js found in the last assembled request: the memory blocks, what was cut, the cache comparison. */
export function noteLayout(result) { layout = result ? { ...result } : null; }
/** The last request's memory layout in this chat, or null. Review, Context shows it. */
export function lastLayout() { return layout?.chatId === chatId() ? layout : null; }

/** The chat model's size class for memory (5.3): a size chosen in Setup, Memory, or the context length SillyTavern is set to. */
export function memorySize() {
    const manual = ['small', 'mid', 'frontier'].find(size => size === settings().summary?.size);
    let context = 0;
    // on Chat Completion the context size is the Chat Completion setting; the text completion one does not apply
    try { const c = ctx(); context = Number(c.mainApi === 'openai' ? c.chatCompletionSettings?.openai_max_context : c.maxContext) || Number(c.maxContext) || 0; } catch { /* no host */ }
    return { key: manual || (!context || context < 32000 ? 'small' : context < 200000 ? 'mid' : 'frontier'), context, manual: !!manual };
}
