// The request layout and the prompt cache (memory DESIGN 5). The first half is pure code over Chat Completion messages, so
// the tests and the MB11 harness run it with no host; the second half wires it to SillyTavern.
//
//   Layout (5.1)        The memory instruction joins the stable prefix (the end of the main prompt). The chapter view sits
//                       directly above the open chapter's history (src/chapters.js puts it there). The recall block is the
//                       depth-1 block; Tracker book entries follow it at depth 1; the rule reminder sits at depth 0.
//   Cache (5.2)         prefixReport compares two consecutive requests: the first changed message and the tokens a provider
//                       reprocesses. cachingDepthFor gives the cachingAtDepth value that puts the Claude marker on the
//                       message just above the deepest in-chat block (M1c rule 15).
//   Sizes (5.3)         SIZE_CAPS by the chat model's size; placeTracker keeps the Tracker book inside its cap.
//   Theirs (5.4)        theirsFeatures and captureModules: a feature on Theirs sends none of the extension's text, and
//                       capture still files records for it from the reply.
//   Trim guard (5.5)    trimCheck: the chapter view and the recall block are in the assembled request, or the parts cut.
import { MEMORY } from './fold.js';
import { overriddenEntries } from './flags.js';
import { recallPool, repeatsOfEntries } from './upkeep.js';
import { chaptersOf } from './story-so-far.js';

/** The memory instruction, about 80 tokens, at the end of the main prompt. It never changes, so it never breaks the cache. */
export const MEMORY_INSTRUCTION = 'Memory notes. The story_so_far tags hold the account of earlier chapters. The recall tags hold reference data from the story so far: records, World Info entries and passages. When two records describe the same thing, the newer record holds. A record names who knows it in known_by, and a character acts only on what that character knows.';
/** The rule reminder at depth 0: the two rules a model breaks most (M1c rule 4). */
export const RULE_REMINDER = 'Reminder: write from the point of view the scene sets, and let each character speak and act only on what that character knows.';

// Extension prompt keys. SillyTavern joins the prompts of one depth and role in the sort order of their keys, and World Info
// entries at a depth arrive as keys that start with "customDepthWI", so a key in capitals sorts the recall block first and the
// Tracker book entries after it (5.1).
export const INSTRUCTION_KEY = 'RI_MEMORY_NOTES';
export const REMINDER_KEY = 'RI_REMINDER';
export const RECALL_PROMPT_KEY = 'RI_RECALL';

/** Block caps by chat model size (5.3), in tokens. */
export const SIZE_CAPS = Object.freeze({
    small: Object.freeze({ recall: 1000, tracker: 600, view: 1000, ceiling: 16000 }),
    mid: Object.freeze({ recall: 2000, tracker: 1200, view: 2000, ceiling: 24000 }),
    frontier: Object.freeze({ recall: 4000, tracker: 2000, view: 4000, ceiling: 32000 }),
});

/**
 * The cards the Tracker book publishes (3.3, UI design 6.7), the record kinds whose current value each one carries, and the
 * feature switch each one follows (5.4). While the Tracker book carries a card, recall leaves those values to it.
 */
export const TRACKER_CARDS = Object.freeze({
    scene: Object.freeze({ kinds: ['scene'], feature: 'state', sceneLine: true }),
    characters: Object.freeze({ kinds: [], feature: 'state' }),
    emotions: Object.freeze({ kinds: ['emotion'], feature: 'emotions' }),
    relationships: Object.freeze({ kinds: ['relationship'], feature: 'relationships' }),
    directorsDesk: Object.freeze({ kinds: [], feature: 'plots', desk: true }),
});

export const tokensOf = text => Math.ceil(String(text ?? '').length / 4);
const plain = content => typeof content === 'string' ? content : Array.isArray(content) ? content.map(p => typeof p?.text === 'string' ? p.text : '').join('') : '';

// ---------------------------------------------------------------- the blocks of a request

/** What one message of an assembled request carries: 'view', 'recall', 'instruction', 'reminder', or '' for anything else. */
export function blockOf(message) {
    const text = plain(message?.content);
    if (text.includes('<story_so_far>')) return 'view';
    if (text.includes('<recall>')) return 'recall';
    if (text.includes(MEMORY_INSTRUCTION)) return 'instruction';
    if (text.includes(RULE_REMINDER)) return 'reminder';
    return '';
}

/** The index of each memory block in an assembled request (-1 when absent), and the tokens of each. */
export function layoutOf(messages) {
    const out = { view: -1, recall: -1, instruction: -1, reminder: -1, tokens: { view: 0, recall: 0, instruction: 0 } };
    (messages || []).forEach((m, i) => {
        const kind = blockOf(m);
        if (!kind || out[kind] >= 0) return;
        out[kind] = i;
        const text = plain(m.content);
        if (kind === 'view') out.tokens.view = tokensOf(text.slice(text.indexOf('<story_so_far>'), text.indexOf('</story_so_far>') + 15));
        if (kind === 'recall') out.tokens.recall = tokensOf(text.slice(text.indexOf('<recall>'), text.indexOf('</recall>') + 9));
        if (kind === 'instruction') out.tokens.instruction = tokensOf(MEMORY_INSTRUCTION);
    });
    return out;
}

/**
 * The trim guard (5.5). expect { view, recall }: whether the extension put a chapter view and a recall block into this
 * request. Returns { ok, cut: ['chapter view' | 'recall block'], layout }.
 */
export function trimCheck(messages, expect = {}) {
    const layout = layoutOf(messages);
    const cut = [];
    if (expect.view && layout.view < 0) cut.push('chapter view');
    if (expect.recall && layout.recall < 0) cut.push('recall block');
    return { ok: !cut.length, cut, layout };
}

// ---------------------------------------------------------------- the prompt cache (5.2)

const same = (a, b) => a?.role === b?.role && plain(a?.content) === plain(b?.content);

/** The index of the first message of `next` that differs from `prev`, or next.length when `next` only adds to it. */
export function firstChanged(prev, next) {
    const n = Math.min(prev?.length || 0, next?.length || 0);
    for (let i = 0; i < n; i++) if (!same(prev[i], next[i])) return i;
    return Math.min(n, next?.length || 0);
}

/**
 * Two consecutive requests compared: where the first difference falls, the tokens a provider reprocesses (everything of
 * `next` from that message on), and whether the difference follows the history, as it should between chapter closes: the
 * first changed message is the old recall block or a message after it.
 */
export function prefixReport(prev, next, { count = tokensOf } = {}) {
    const at = firstChanged(prev, next);
    const lost = (next || []).slice(at).reduce((sum, m) => sum + count(plain(m.content)), 0);
    const before = layoutOf(prev);
    const followsHistory = before.recall < 0 ? at >= (prev?.length || 0) - 3 : at >= before.recall;
    return { firstChanged: at, messages: next?.length || 0, lostTokens: lost, followsHistory };
}

/**
 * The cachingAtDepth value for a request (M1c rule 15): the run depth, as SillyTavern's Claude converter counts it, of the
 * message just above the deepest in-chat block. route 'claude' is the direct route, where every system message after the
 * first non-system message becomes a user message and neighbours of one role merge; 'openrouter' skips system messages.
 * A trailing assistant prefill is skipped, as the converter does. isBlock(message, index) names the in-chat blocks; by
 * default the recall block, the reminder and any system message after the last assistant reply.
 * Returns { depth, above } with above the index (in `messages`) of the message the marker lands on, or null.
 */
export function cachingDepthFor(messages, { route = 'claude', isBlock = null } = {}) {
    const list = (messages || []).map((m, i) => ({ role: m.role, i, m }));
    let lead = 0;
    while (lead < list.length && list[lead].role === 'system') lead++;
    const lastReply = list.findLastIndex(x => x.role === 'assistant');
    const block = isBlock || ((m, i) => ['recall', 'reminder'].includes(blockOf(m)) || (m.role === 'system' && i > lastReply));
    const blocks = list.filter(x => x.i >= lead && block(x.m, x.i));
    if (!blocks.length) return null;
    // the message just above the deepest block that is not itself a block
    let above = Math.min(...blocks.map(x => x.i)) - 1;
    while (above >= lead && block(list[above].m, above)) above--;
    if (above < lead) return null;
    if (route === 'openrouter') while (above >= lead && list[above].role === 'system') above--;
    const roleOf = x => route === 'claude' && x.role === 'system' && x.i >= lead ? 'user' : x.role;
    let depth = 0, previous = '', passedPrefill = false;
    for (let k = list.length - 1; k >= lead; k--) {
        const x = list[k];
        if (!passedPrefill && x.role === 'assistant') continue;
        passedPrefill = true;
        if (route === 'openrouter' && x.role === 'system') continue;
        const role = roleOf(x);
        if (role !== previous) {
            if (k <= above) {
                // the marker lands on the last message of a run; the run that holds `above` must end at `above`
                return { depth, above: k };
            }
            depth += 1;
            previous = role;
        }
    }
    return null;
}

// ---------------------------------------------------------------- the Tracker book (5.1, 5.3)

/** The record kinds recall leaves to the Tracker book while it carries these cards, and whether the scene line goes too. */
export function trackerCarries(cards = [], theirs = new Set()) {
    const kinds = new Set();
    let sceneLine = false;
    for (const id of cards || []) {
        const card = TRACKER_CARDS[id];
        if (!card || theirs.has(card.feature)) continue;
        for (const k of card.kinds) kinds.add(k);
        if (card.sceneLine) sceneLine = true;
    }
    return { kinds, sceneLine };
}

/**
 * Place the Tracker book's entries (5.1) and keep them inside the cap of 5.3. entries: { card, content, ... } World Info
 * entries; trayOrder: card ids in the tray's order. Every entry becomes a Constant entry at depth 1. Entries of a feature on
 * Theirs are left out (5.4). Over the cap, the Director's desk goes first, then the story cards in reverse of the tray order.
 * Returns { kept, dropped: [{ card, reason }], tokens }.
 */
export function placeTracker(entries, { cap = SIZE_CAPS.mid.tracker, trayOrder = Object.keys(TRACKER_CARDS), theirs = new Set(), count = tokensOf } = {}) {
    const dropped = [];
    let list = [];
    for (const e of entries || []) {
        const card = TRACKER_CARDS[e.card];
        if (card && theirs.has(card.feature)) { dropped.push({ card: e.card, reason: 'Theirs' }); continue; }
        list.push({ ...e, constant: true, position: 4, depth: 1, role: 0 });
    }
    const rank = e => TRACKER_CARDS[e.card]?.desk ? -1 : trayOrder.indexOf(e.card);
    const total = () => list.reduce((s, e) => s + count(e.content), 0);
    while (list.length && total() > cap) {
        const worst = [...list].sort((a, b) => rank(a) - rank(b))[0];
        const lastStory = [...list].filter(e => !TRACKER_CARDS[e.card]?.desk).sort((a, b) => rank(b) - rank(a))[0];
        const out = list.some(e => TRACKER_CARDS[e.card]?.desk) ? worst : lastStory;
        list = list.filter(e => e !== out);
        dropped.push({ card: out.card, reason: 'over the Tracker book cap' });
    }
    // story order of the tray, the desk last
    list.sort((a, b) => (TRACKER_CARDS[a.card]?.desk ? 1e6 : trayOrder.indexOf(a.card)) - (TRACKER_CARDS[b.card]?.desk ? 1e6 : trayOrder.indexOf(b.card)));
    list.forEach((e, k) => { e.order = 100 - k; });
    return { kept: list, dropped, tokens: total() };
}

/** The cards the chat's Tracker book publishes, from chat data (B21 writes meta.ri_memory.trackerBook.cards). */
export const trackerCardsOf = meta => (Array.isArray(meta?.[MEMORY]?.trackerBook?.cards) ? meta[MEMORY].trackerBook.cards.map(String) : []);

// ---------------------------------------------------------------- what upkeep holds out of the request (MB7)

/**
 * The three things upkeep (MB7) keeps out of the recall block: your World Info entries a "The story changed" record replaces
 * (also left out of the host's own request), records that only repeat one of your entries (M1c rule 5), and records outside
 * the recall pool (retired, replaced, merged, suspect, or a thread that closed before the last chapter close).
 * chat and result: the chat and its fold; entries: the World Info entries loaded for this request.
 * Returns { overridden: Set of "book:uid", repeats: Set of record ids, outside: Set of record ids }.
 */
export function heldOut({ chat = [], result, entries = [] }) {
    const overridden = new Set(overriddenEntries(result).map(e => `${e.book}:${e.uid}`));
    // her entries only: the blocks the extension builds for each request (story notes, flow lines) are not hers
    const yours = entries.filter(e => e && !e.disable && String(e.content ?? '').trim() && !overridden.has(`${e.world}:${e.uid}`)
        && !String(e.world || '').startsWith('Roleplay Instructions ') && !['notes', 'flow'].includes(e.extensions?.ri?.type));
    const repeats = new Set(repeatsOfEntries(result.current, yours));
    const chapters = chaptersOf(chat, result).filter(c => c.valid).map(c => ({ toIndex: c.last }));
    const pool = new Set(recallPool(result, { chapters }).map(p => p.id));
    // range records and the scene reach the request by their own paths (the chapter view, the scene line)
    const outside = new Set(result.current.filter(r => !pool.has(r.id) && !['chapter', 'condensed', 'arc', 'scene'].includes(r.kind)).map(r => r.id));
    return { overridden, repeats, outside };
}

/** Take the entries a "The story changed" record replaces out of the host's loaded entries, in place. Returns how many. */
export function dropOverridden(arrays, overridden) {
    let n = 0;
    for (const list of arrays || []) {
        if (!Array.isArray(list)) continue;
        for (let i = list.length - 1; i >= 0; i--) if (overridden.has(`${list[i]?.world}:${list[i]?.uid}`)) { list.splice(i, 1); n++; }
    }
    return n;
}

// ---------------------------------------------------------------- Theirs (5.4)

/** The features the selected preset supplies: ownership is SillyTavern's moduleOwnership() view, choice 'preset' is Theirs. */
export function theirsFeatures(ownership = {}) {
    return new Set(Object.entries(ownership || {}).filter(([, o]) => o && o.choice === 'preset' && !o.usesExtension).map(([key]) => key));
}

/**
 * The modules capture reads its fields from. A feature on Theirs sends none of the extension's text, and capture still
 * files its changes from the reply (5.4), so a Theirs feature that is on in the chat's own settings stays on for capture.
 */
export function captureModules(modules = {}, theirs = new Set(), base = {}) {
    const out = { ...modules };
    for (const key of theirs) if (base[key] !== false) out[key] = true;
    return out;
}

// ---------------------------------------------------------------- the host

let wired = false;
const turn = { at: 0, type: '', active: false };
let previous = null;
let hostParts = null;
async function host() {
    if (hostParts) return hostParts;
    const [st, store, importer, hide, recall, budget, v10] = await Promise.all([
        import('../st.js'), import('../store.js'), import('./import.js'), import('../hide.js'), import('../recall.js'), import('../context-budget.js'), import('../v10.js'),
    ]);
    hostParts = { st, store, importer, hide, recall, budget, v10 };
    return hostParts;
}

/** The features on Theirs for the selected preset, read live. */
export async function hostTheirs() {
    const H = await host();
    try { return theirsFeatures(H.v10.moduleOwnership()); } catch { return new Set(); }
}

/** The modules capture uses, for the selected preset now (called by capture.js). */
export async function hostCaptureModules(modules = {}) {
    const H = await host();
    try {
        const base = { ...H.v10.DEFAULT_MODULES, ...H.v10.presetDefaults(), ...(H.store.chatState()?.v10?.modules || {}) };
        return captureModules(modules, theirsFeatures(H.v10.moduleOwnership()), base);
    } catch { return modules; }
}

function publish(H, key, value, position, depth) {
    try { H.st.ctx().setExtensionPrompt?.(key, value, position, depth, false, 0); } catch { /* the host has no extension prompts */ }
}

let notice = false;
async function showTrim(H, cut) {
    try {
        const { setBarNotice } = await import('../ui/composer-bar.js');
        if (cut.length) {
            notice = true;
            setBarNotice({ id: 'memory-trim', label: 'Memory cut', tone: 'problem', count: 1,
                text: `SillyTavern cut the ${cut.join(' and the ')} from the last request to fit its context size. The reply was written without it. Review, Context names what was cut.`,
                actions: [{ label: 'Open Context', run: async () => { const { app } = await import('../ui/panel.js'); if (await app.openPage('context', { focusPage: true })) await app.setExpanded(true); } }],
                onDismiss: () => { notice = false; setBarNotice(null, 'memory'); } }, 'memory');
        } else if (notice) { notice = false; setBarNotice(null, 'memory'); }
    } catch { /* no bar in this host */ }
}

/** Check the assembled request: the trim guard and the comparison with the previous request of this chat. */
export async function onPromptReady(data) {
    if (!turn.active || data?.dryRun || !Array.isArray(data?.chat)) return null;
    // one check per generation: a background call that assembles its own messages while the reply is under way is not the reply
    turn.active = false;
    const H = await host();
    const chatId = String(H.st.ctx().getCurrentChatId?.() || '');
    const assembly = H.hide.lastChapterAssembly?.();
    const recall = H.recall.lastRecall?.();
    const expect = {
        view: !!(assembly && assembly.inserted && assembly.at >= turn.at && assembly.chatId === chatId),
        recall: !!(recall && recall.kind === 'turn' && recall.chars > 0 && recall.at >= turn.at),
    };
    const messages = data.chat.map(m => ({ role: m.role, content: plain(m.content) }));
    const guard = trimCheck(messages, expect);
    const cache = previous && previous.chatId === chatId ? prefixReport(previous.messages, messages) : null;
    previous = { chatId, messages };
    const result = { chatId, at: Date.now(), type: turn.type, expect, cut: guard.cut, layout: guard.layout, cache, size: H.budget.memorySize?.() || null };
    H.budget.noteLayout?.(result);
    await showTrim(H, guard.cut);
    return result;
}

/** Wire the layout to the host once. Called from the extension's entry file. */
export async function startInject() {
    if (wired) return;
    wired = true;
    const H = await host();
    const { on } = H.st;
    on('GENERATION_STARTED', (type, opts, dryRun) => {
        if (dryRun) return;
        const quiet = type === 'quiet' || !!opts?.quiet_prompt;
        const memory = H.store.settings().enabled !== false && H.importer.memoryActive() && H.st.ctx().chatMetadata?.ri_memory?.off !== true;
        Object.assign(turn, { at: Date.now(), type: String(type || 'normal'), active: !quiet && memory });
        // the instruction stays in place for every request of a chat with memory, so the prefix never changes between turns
        publish(H, INSTRUCTION_KEY, memory ? MEMORY_INSTRUCTION : '', 0, 0);
        publish(H, REMINDER_KEY, memory && !quiet ? RULE_REMINDER : '', 1, 0);
    });
    on('CHAT_COMPLETION_PROMPT_READY', data => onPromptReady(data).catch(error => console.warn(H.st.LOG, 'request layout', error)));
    for (const name of ['GENERATION_ENDED', 'GENERATION_STOPPED']) on(name, () => { turn.active = false; });
    on('CHAT_CHANGED', () => {
        turn.active = false; previous = null;
        const memory = H.store.settings().enabled !== false && H.importer.memoryActive() && H.st.ctx().chatMetadata?.ri_memory?.off !== true;
        publish(H, INSTRUCTION_KEY, memory ? MEMORY_INSTRUCTION : '', 0, 0);
        publish(H, REMINDER_KEY, '', 1, 0);
    });
}
