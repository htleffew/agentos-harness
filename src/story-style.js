// Story styles (DESIGN.md 1.12): the per-chat choice, the Setup default, and the one-time suggestion read from the
// character card and the chat's World Info books. The automatic suggestion is word matching in code and makes no model
// call. The only model call in this file is the one she taps for in the picker (B61, askModelStyle).
import { chatState, saveChatState, saveSettings, settings } from './store.js';
import { ctx, isChatOpen, loadBook, LOG } from './st.js';

export const DEFAULT_STORY_STYLE = 'modern';

/** The four starting styles, in the order the pickers list them. Colors live in src/ui/theme/story-styles/*.css. */
export const STORY_STYLES = Object.freeze([
    { id: 'parchment', label: 'Parchment', face: 'a serif page in umber and cream' },
    { id: 'noir', label: 'Noir', face: 'a typewriter on smoke black' },
    { id: 'scifi', label: 'Sci-fi readout', face: 'a console in cyan and green' },
    { id: 'modern', label: 'Modern minimal', face: 'plain sans on graphite' },
]);
export const STYLE_FILES = Object.freeze({ parchment: 'parchment', noir: 'noir', scifi: 'sci-fi', modern: 'modern-minimal' });

export const styleLabel = id => STORY_STYLES.find(style => style.id === id)?.label || '';
export const validStyle = id => STORY_STYLES.some(style => style.id === id);

/** Setting words per style. A word matches whole words, with an optional plural s. */
export const STYLE_WORDS = Object.freeze({
    noir: ['detective', 'noir', '1940s', '1930s', '1920s', 'rain-slick', 'rain slick', 'precinct', 'gumshoe', 'private eye', 'femme fatale',
        'speakeasy', 'trench coat', 'gangster', 'mobster', 'whiskey', 'crime scene', 'homicide', 'informant', 'smoke-filled', 'alley', 'jazz club', 'dame', 'hardboiled'],
    scifi: ['starship', 'spaceship', 'colony', 'android', 'cyborg', 'space station', 'galaxy', 'planet', 'alien', 'hyperspace', 'laser', 'robot',
        'cyberpunk', 'orbit', 'interstellar', 'futuristic', 'nanotech', 'warp drive', 'ai core', 'terraform', 'mech', 'megacorp', 'cryosleep'],
    parchment: ['kingdom', 'sword', 'spell', 'magic', 'wizard', 'dragon', 'knight', 'castle', 'elf', 'dwarf', 'realm', 'quest', 'prophecy',
        'sorcerer', 'mage', 'medieval', 'throne', 'enchanted', 'guild', 'paladin', 'kingdoms', 'bard', 'amulet', 'duke', 'sorceress'],
});

const escape = word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[ -]/g, '[ -]');
const MATCHERS = Object.fromEntries(Object.entries(STYLE_WORDS).map(([id, words]) =>
    [id, words.map(word => new RegExp(`(?<![\\p{L}\\p{N}])${escape(word)}s?(?![\\p{L}\\p{N}])`, 'giu'))]));
const PER_WORD_CAP = 3;
const TEXT_CAP = 80000;

/** Hits per style in `text`; one setting word counts at most 3 times so a repeated word cannot decide alone. */
export function scoreStyles(text) {
    const source = String(text ?? '').slice(0, TEXT_CAP);
    const score = { parchment: 0, noir: 0, scifi: 0, modern: 0 };
    for (const [id, matchers] of Object.entries(MATCHERS)) {
        for (const matcher of matchers) score[id] += Math.min(PER_WORD_CAP, (source.match(matcher) || []).length);
    }
    return score;
}

/** The style with the most hits; Modern minimal when nothing scores or the lead is shared. */
export function suggestStyle(text) {
    const score = scoreStyles(text);
    const ranked = ['noir', 'scifi', 'parchment'].map(id => [id, score[id]]).sort((a, b) => b[1] - a[1]);
    if (!ranked[0][1] || ranked[0][1] === ranked[1][1]) return DEFAULT_STORY_STYLE;
    return ranked[0][0];
}

// ---------- choice ----------

export function defaultStoryStyle(st = settings()) {
    return validStyle(st.storyStyle?.default) ? st.storyStyle.default : DEFAULT_STORY_STYLE;
}

export function setDefaultStoryStyle(id) {
    const st = settings();
    st.storyStyle = { ...(st.storyStyle && typeof st.storyStyle === 'object' ? st.storyStyle : {}), default: validStyle(id) ? id : DEFAULT_STORY_STYLE };
    saveSettings();
    changed();
}

/** This chat's own choice, or '' when it has made none. */
export function chatStoryStyle(cs = chatState()) {
    return cs && validStyle(cs.storyStyle) ? cs.storyStyle : '';
}

export function setChatStoryStyle(id) {
    const cs = chatState();
    if (!cs) return false;
    if (validStyle(id)) cs.storyStyle = id; else delete cs.storyStyle;
    // Choosing in any place settles the suggestion.
    if (cs.storyStyleSuggestion?.state === 'pending') cs.storyStyleSuggestion = { ...cs.storyStyleSuggestion, state: 'done' };
    saveChatState();
    changed();
    return true;
}

/** The style the tray draws with: the chat's choice, else the Setup default. */
export function effectiveStoryStyle(cs = chatState(), st = settings()) {
    return chatStoryStyle(cs) || defaultStoryStyle(st);
}

// ---------- the one-time suggestion ----------

const listeners = new Set();
export function onStoryStyleChange(fn) { if (typeof fn === 'function') listeners.add(fn); return () => listeners.delete(fn); }
function changed() { for (const fn of listeners) { try { fn(); } catch (error) { console.warn(LOG, 'story style', error); } } }

const working = new Set();

/** The suggested style while the chip is waiting for her, else ''. */
export function pendingSuggestion(cs = chatState()) {
    const suggestion = cs?.storyStyleSuggestion;
    return suggestion?.state === 'pending' && validStyle(suggestion.style) ? suggestion.style : '';
}

/** Setting text from the character card. */
export function cardText(host = ctx()) {
    const card = host.characters?.[host.characterId];
    const data = card?.data || {};
    return [card?.name, card?.description, card?.personality, card?.scenario, card?.first_mes, data.description, data.personality,
        data.scenario, data.system_prompt, ...(Array.isArray(data.tags) ? data.tags : []), ...(Array.isArray(card?.tags) ? card.tags : [])]
        .filter(value => typeof value === 'string' && value).join('\n');
}

/** Books the extension writes from the story itself say what happened, not the setting, so they are left out. */
const STORY_BOOK_ROLE = /^(Story World|Chapter summaries|Chat facts|Earlier or source|Stores earlier|Appears in reply|Used on an earlier|Previously assigned)/;

/** Text of the chat's active World Info books (names, keys, comments and content). Reads books; asks no model. */
export async function bookText() {
    const { chatBooks } = await import('./chat-books.js');
    const out = [];
    let books = [];
    try { books = chatBooks().filter(item => item.exists && item.active && !item.excluded && !item.roles.every(role => STORY_BOOK_ROLE.test(role))).slice(0, 12); } catch (error) { console.warn(LOG, 'story style could not list books', error); }
    for (const book of books) {
        out.push(book.name);
        try {
            const data = await loadBook(book.name);
            for (const entry of Object.values(data?.entries || {}).slice(0, 400)) {
                if (entry?.disable) continue;
                out.push(String(entry?.comment || ''), [].concat(entry?.key || []).join(' '), String(entry?.content || ''));
            }
        } catch (error) { console.warn(LOG, 'story style could not read a book', book.name, error); }
    }
    return out.join('\n');
}

/**
 * The first time the tray draws in a chat: read the setting words once, save the suggestion in the chat, and tell
 * listeners. Safe to call on every draw. The chip waits only when the suggestion differs from the style in use.
 */
export function ensureSuggestion() {
    if (!isChatOpen()) return;
    const cs = chatState();
    if (!cs || cs.storyStyleSuggestion) return;
    const key = ctx().getCurrentChatId?.();
    if (working.has(key)) return;
    working.add(key);
    (async () => {
        try {
            const text = `${cardText()}\n${await bookText()}`;
            const style = suggestStyle(text);
            const now = chatState();
            if (!now || ctx().getCurrentChatId?.() !== key || now.storyStyleSuggestion) return;
            const differs = style !== effectiveStoryStyle(now);
            now.storyStyleSuggestion = { style, state: differs && !chatStoryStyle(now) ? 'pending' : 'done' };
            saveChatState();
            changed();
        } catch (error) {
            console.warn(LOG, 'story style suggestion', error);
        } finally { working.delete(key); }
    })();
}

/** She dismissed the chip without choosing; the Setup default stays. */
export function dismissSuggestion() {
    const cs = chatState();
    if (!cs?.storyStyleSuggestion) return;
    cs.storyStyleSuggestion = { ...cs.storyStyleSuggestion, state: 'done' };
    saveChatState();
    changed();
}

// ---------- the suggestion she asks a model for (B61) ----------

export const MODEL_CARD_CAP = 2500;
export const MODEL_BOOK_CAP = 3500;
const MODEL_JOB = 'styleSuggest';

export const STYLE_SYSTEM = [
    'You choose how the story cards of a roleplay look. Read the setting text and pick the one style that fits it best.',
    'The styles, each as id: face.',
    ...STORY_STYLES.map(style => `${style.id}: ${style.face}`),
    `Answer with exactly one id from this list and nothing else: ${STORY_STYLES.map(style => style.id).join(', ')}.`,
].join('\n');

/** The request for the tapped suggestion: the card text and the World Info book text, each capped. */
export function buildStyleRequest({ card = '', books = '' } = {}) {
    const clip = (text, cap) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);
    return { system: STYLE_SYSTEM, user: `Character card:\n${clip(card, MODEL_CARD_CAP) || '(none)'}\n\nWorld Info books:\n${clip(books, MODEL_BOOK_CAP) || '(none)'}\n\nThe style id:` };
}

/** The id a reply names, or '' when the reply is anything but one of the four ids (quotes, backticks and an end mark allowed). */
export function readStyleAnswer(text) {
    const word = String(text ?? '').trim().replace(/^[\s"'`*]+|[\s"'`*.!]+$/g, '').toLowerCase();
    return STORY_STYLES.find(style => style.id === word)?.id || '';
}

let asked = { key: '', state: 'idle', style: '', note: '' };
const chatKey = () => ctx().getCurrentChatId?.() || '';

/** What the picker shows for the model suggestion in this chat: state is idle, asking, done, unusable, ceiling or failed. */
export function modelSuggestion() {
    return asked.key === chatKey() ? { ...asked } : { key: chatKey(), state: 'idle', style: '', note: '' };
}

export function clearModelSuggestion() {
    asked = { key: '', state: 'idle', style: '', note: '' };
    changed();
}

/**
 * She tapped Suggest with a model. One request goes through the route chain (routing.runChain, free and local routes
 * first; a paid step counts toward the monthly ceiling). The answer is kept as a suggestion; nothing is applied.
 * run and chain: test hooks for runChain and the chain it runs on.
 */
export async function askModelStyle({ run, chain } = {}) {
    if (!isChatOpen() || asked.state === 'asking' && asked.key === chatKey()) return modelSuggestion();
    const key = chatKey();
    asked = { key, state: 'asking', style: '', note: 'Asking a model...' };
    changed();
    let outcome;
    try {
        const request = buildStyleRequest({ card: cardText(), books: await bookText() });
        const routing = await import('./routing.js');
        const send = run || ((steps, options) => routing.runChain(steps, options));
        const result = await send(chain || routing.chainFor('capture'), { job: MODEL_JOB, label: 'Story style suggestion (you asked)',
            ...request, tokens: 20, background: false });
        const style = result.ok ? readStyleAnswer(result.text) : '';
        if (style) outcome = { state: 'done', style, note: '' };
        else if (result.ok) outcome = { state: 'unusable', style: '', note: 'The model gave no usable answer. The style stays as it is.' };
        else if (result.waiting) outcome = { state: 'ceiling', style: '', note: result.reason };
        else outcome = { state: 'failed', style: '', note: `${result.reason || 'No route answered.'} The style stays as it is.` };
    } catch (error) {
        console.warn(LOG, 'story style model suggestion', error);
        outcome = { state: 'failed', style: '', note: 'The request could not be sent. The style stays as it is.' };
    }
    if (chatKey() === key) asked = { key, ...outcome };
    changed();
    return modelSuggestion();
}
