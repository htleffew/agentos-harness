import { ctx, KEY, LOG, isReply, isStory, on } from './st.js';
import { BOOK_TRIGGER_SOURCES, scopedTriggerTexts, isRecallManaged, entryIsManaged, takeFiredEntries } from './book-triggers.js';
import { settings } from './store.js';
import { resolveRoute } from './routing.js';
import { MEMORY, fold } from './memory/fold.js';
import { createSearchIndex, hiddenQuotesFor, sourcesFromChat } from './memory/index.js';
import { createEmbedder, modelCache, ollamaBooster } from './memory/embed.js';
import { RECALL_TOKEN_CAP, SEARCH, aliasGroups, holderAllows, renderBlock } from './memory/search.js';
import { RECALL_PROMPT_KEY, dropOverridden, heldOut, hostTheirs, trackerCarries, trackerCardsOf } from './memory/inject.js';
import { memorySize } from './context-budget.js';

export const ACTIVATION_MODES = ['default','always','triggered','window','off'];
export const RECALL_SOURCES = {...BOOK_TRIGGER_SOURCES,chat:'Recent visible conversation'};

export function readActivation(value) {
    if (!value || !ACTIVATION_MODES.includes(value.mode) || value.mode==='default') return null;
    const bounded = (number,max,fallback) => Number.isFinite(Number(number)) ? Math.max(0,Math.min(max,Math.floor(Number(number)))) : fallback;
    return {
        mode:value.mode,
        keys:Array.isArray(value.keys) ? value.keys.filter(key=>typeof key==='string' && key.trim()).map(key=>key.trim().slice(0,100)).slice(0,50) : [],
        source:Object.hasOwn(RECALL_SOURCES,value.source) ? value.source : 'chat',
        chance:bounded(value.chance,100,100), sticky:bounded(value.sticky,100,0), cooldown:bounded(value.cooldown,1000,0),
        window:bounded(value.window,200,6), after:bounded(value.after,Number.MAX_SAFE_INTEGER,0),
    };
}

export function recallTiming(rule) {
    if (!rule || rule.mode==='off') return '';
    const mode = {always:'Always eligible',triggered:'Keyword triggered',window:`First ${rule.window} replies, then keywords`}[rule.mode];
    return `${mode} · ${RECALL_SOURCES[rule.source]} · ${rule.chance}% chance · Sticky ${rule.sticky} · Cooldown ${rule.cooldown} replies`;
}

function matches(text, key) {
    const pattern = /^\/(.+)\/([gimsuy]*)$/.exec(key);
    if (pattern) {
        try { return new RegExp(pattern[1],pattern[2]).test(text); } catch { return false; }
    }
    const normalize = value => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
    const term = normalize(key);
    return !!term && ` ${normalize(text)} `.includes(` ${term} `);
}

function draw(seed) {
    let hash = 2166136261;
    for (const char of seed) hash = Math.imul(hash ^ char.codePointAt(0),16777619);
    return (hash >>> 0) % 100;
}

export function recallPolicy(book, type = 'normal') {
    const original = ctx().chat || [];
    const replace = ['swipe','regenerate','continue'].includes(type) && !original.at(-1)?.is_user;
    const chat = replace ? original.slice(0,-1) : original;
    const replies = chat.slice(1).filter(isReply);
    // Manual summaries and generated turns share the same reply numbering.
    const next = replies.length + 1;
    const lastInput = [...chat].reverse().find(message=>message.is_user && isStory(message));
    const input = chat.slice(-8).filter(message=>isStory(message) && !message.is_system).map(message=>message.mes || '').join('\n');
    const sources = {...scopedTriggerTexts(chat,'normal'),chat:input};
    const anchor = lastInput?.send_date ?? lastInput?.mes ?? next;
    return row => {
        const rule = row.activation;
        if (!rule) return {on:true,fresh:false};
        if (rule.mode==='off') return {on:false,fresh:false};
        const uid = String(row.uid);
        const last = rule.sticky || rule.cooldown ? replies.slice(-rule.sticky-rule.cooldown).findLastIndex(message=>{
            const receipt = message.extra?.[KEY]?.recall;
            return receipt?.book===book && receipt.fresh?.includes(uid);
        }) : -1;
        if (last>=0) {
            const distance=Math.min(replies.length,rule.sticky+rule.cooldown)-last;
            return {on:distance<=rule.sticky,fresh:false};
        }
        const eligible = rule.mode==='always' ||
            rule.mode==='window' && next<=rule.after+rule.window ||
            ['triggered','window'].includes(rule.mode) && !!sources[rule.source] && rule.keys.some(key=>matches(sources[rule.source],key));
        const on = eligible && (rule.chance===100 || draw(`${book}:${uid}:${next}:${anchor}`)<rule.chance);
        return {on,fresh:on};
    };
}

// ---------------------------------------------------------------- the recall turn (memory DESIGN 4.2)
//
// One search per reply, in code on the device. It runs when SillyTavern loads the World Info entries for a request, builds
// the recall block and sets it as an in-chat prompt at depth 1, below the history. The host's own scan then runs: the
// entries it fires in a book that Recall manages are taken out of the host's request and added to the block within their
// own token share. A turn that cannot search (no memory in the chat, a quiet request, a failed model) changes nothing.

export const RECALL_KEY = RECALL_PROMPT_KEY;
const BOOSTER_RETRY_MS = 10 * 60 * 1000;

/** The values in force: the measured starting values, with any the settings override. */
export function recallValues() {
    const saved = settings().recall?.values || {};
    // the size follows the chat model (5.3): a size chosen in Setup, Memory, or the context length SillyTavern is set to
    const size = ['small', 'mid', 'frontier'].includes(settings().recall?.size) ? settings().recall.size : memorySize().key;
    return { ...SEARCH, tokenCap: RECALL_TOKEN_CAP[size], ...Object.fromEntries(Object.entries(saved).filter(([, v]) => Number.isFinite(Number(v)))) };
}

/** The desktop booster: the desktop route's address, skipped for ten minutes after it fails to answer. */
function desktopBooster(resolve) {
    let downUntil = 0, base = '', inner = null;
    const find = () => { try { return resolve()?.url || ''; } catch { return ''; } };
    return {
        id: 'nomic-embed-text',
        available() {
            // off unless switched on: on the MB11 story the booster list lowered memory recall from 92.5 to 90, and it uses the desktop
            if (Date.now() < downUntil || settings().recall?.booster !== true) return false;
            const now = find();
            if (now !== base) { base = now; inner = base ? ollamaBooster({ base }) : null; }
            return !!inner;
        },
        async query(text) { const v = await inner?.query(text); if (!v) downUntil = Date.now() + BOOSTER_RETRY_MS; return v || null; },
        async passages(texts) { const rows = await inner?.passages(texts); if (!rows) downUntil = Date.now() + BOOSTER_RETRY_MS; return rows || null; },
    };
}

let runtime = null;
/** The page's one search model and index. Tests pass their own embedder, booster and store. */
export function recallRuntime(parts = null) {
    if (parts) runtime = null;
    if (runtime) return runtime;
    const embedder = parts?.embedder || createEmbedder({ cache: modelCache() });
    const booster = parts && 'booster' in parts ? parts.booster : desktopBooster(() => resolveRoute({ route: 'desktop' }));
    runtime = { embedder, booster, index: createSearchIndex({ embedder, booster, ...(parts?.db ? { db: parts.db } : {}) }) };
    return runtime;
}

const turn = { active: false, type: 'normal', fired: new Map(), result: null, args: null };
let last = null;
/** What the last recall turn did, for Review, Context and for tests. */
export const lastRecall = () => last;

const sceneOf = result => {
    const scene = [...(result?.current || [])].reverse().find(r => r.kind === 'scene');
    if (!scene) return null;
    // a scene record keeps its fields, or one line of the form "Place: ...; Time: ...; Present: ..."
    const field = key => (String(scene.text || '').match(new RegExp(`${key}:\\s*([^;]*)`, 'i')) || [])[1]?.trim() || '';
    const present = scene.present || scene.holders || field('Present').split(',').map(name => name.trim()).filter(Boolean);
    return { place: scene.place || field('Place'), time: scene.story_time || scene.time || field('Time'), present: Array.isArray(present) ? present : [] };
};

/**
 * Run the search for one request. `lore` is the host's loaded entries { globalLore, characterLore, chatLore, personaLore };
 * `host` { chat, meta, pov, persona, type, setPrompt } is what the host knows. Returns the block and the result, or null
 * when the chat has no memory to search.
 */
export async function runRecallTurn({ lore = {}, host, parts = null, values = recallValues(), managed = isRecallManaged } = {}) {
    const rt = recallRuntime(parts);
    const { index, embedder } = rt;
    const { chat, meta } = host;
    // a swipe, regenerate or continue replaces the newest reply: what that reply filed does not count for its own rewrite
    const replacing = ['swipe', 'regenerate', 'continue'].includes(host.type) && chat.length > 0 && !chat.at(-1)?.is_user;
    const result = fold(chat, meta, replacing ? { before: chat.length - 1 } : {});
    // tracker values the Tracker book carries stay out of the block (5.1); a feature on Theirs sends no scene line (5.4)
    const theirs = host.theirs instanceof Set ? host.theirs : new Set();
    const tracker = trackerCarries(host.trackerCards ?? trackerCardsOf(meta), theirs);
    // upkeep's exclusions (MB7): entries "The story changed" replaced leave the request, records that only repeat her entries
    // and records outside the recall pool leave the block
    const held = heldOut({ chat, result, entries: [lore.globalLore, lore.characterLore, lore.chatLore, lore.personaLore].filter(Array.isArray).flat().filter(e => e && e.world) });
    dropOverridden([lore.globalLore, lore.characterLore, lore.chatLore, lore.personaLore], held.overridden);
    const entries = [lore.globalLore, lore.characterLore, lore.chatLore, lore.personaLore].filter(Array.isArray).flat().filter(e => e && e.world);
    const staticTexts = entries.filter(e => e.constant && !e.disable && String(e.content ?? '').trim()).map(e => String(e.content));
    const books = new Map();
    for (const e of entries) {
        if (!managed(e.world) || !entryIsManaged(e)) continue;
        if (!books.has(e.world)) books.set(e.world, { name: e.world, entries: [] });
        books.get(e.world).entries.push({ uid: e.uid, comment: e.comment, key: e.key, content: e.content });
    }
    rt.books = [...books.values()];
    const sources = sourcesFromChat({ chat, result, books: rt.books });
    if (tracker.kinds.size) sources.records = sources.records.filter(r => !tracker.kinds.has(r.kind));
    const pinnedIds = new Set([...sources.records.filter(r => r.pinned).map(r => r.id), ...(meta?.[MEMORY]?.pins || [])]);
    sources.records = sources.records.filter(r => pinnedIds.has(r.id) || (!held.repeats.has(r.id) && !held.outside.has(r.id)));
    rt.held = { overridden: [...held.overridden], repeats: [...held.repeats], outside: [...held.outside] };
    // the model loads on first use; a turn waits for a load already under way, but never for a download that has not begun
    if (!embedder.isReady() && embedder.status().state === 'loading') await Promise.race([embedder.load(), new Promise(r => setTimeout(r, 1500))]);
    await index.sync(sources, { embed: 'background' });
    const scene = sceneOf(result);
    const pov = host.pov || '';
    const groups = aliasGroups(sources.records);
    const povAliases = groups.find(g => g.some(n => n.toLowerCase() === pov.toLowerCase()))?.filter(n => n.toLowerCase() !== pov.toLowerCase()) || [];
    const pinned = new Set([...sources.records.filter(r => r.pinned).map(r => r.id), ...(meta?.[MEMORY]?.pins || [])]);
    const message = host.message ?? scopedTriggerTexts(chat, host.type || 'normal').user;
    const search = await index.search({
        message, scene, turn: replacing ? sources.turn : sources.turn + 1, pov, povAliases, pinned, staticTexts,
        hiddenQuotes: hiddenQuotesFor({ chat, meta, result, pov, povAliases, allows: holderAllows }),
        options: { itemCap: values.itemCap, loreShare: values.loreShare, tokenCap: values.tokenCap, candidates: values.candidates, decay: values.decay },
    });
    const sceneLine = settings().recall?.sceneLine !== false && !tracker.sceneLine && !theirs.has('state');
    const block = renderBlock(search.items, { scene, sceneLine });
    return { search, block, scene, sources, sceneLine };
}

function publish(text) {
    try { ctx().setExtensionPrompt?.(RECALL_KEY, text, 1, 1, false, 0); } catch { /* the host has no extension prompts */ }
}

const summary = (kind, search, block, extra = {}) => ({
    at: Date.now(), kind, mode: search?.mode || '', query: search?.query || '', time: search?.time || null, tokens: search?.tokens ?? 0,
    items: (search?.items || []).map(i => ({ key: i.key, type: i.type, tokens: i.tokens ?? 0, fired: !!i.fired, rel: i.rel ?? null })),
    dropped: search?.dropped || [], flags: search?.flags || [], chars: block?.length || 0, ...extra,
});

async function onEntriesLoaded(lore) {
    if (!turn.active || turn.result) return;
    const c = ctx();
    try {
        const theirs = await hostTheirs().catch(() => new Set());
        const done = await runRecallTurn({ lore, host: { chat: c.chat || [], meta: c.chatMetadata || {}, pov: c.name2 || '', type: turn.type, theirs } });
        turn.result = done;
        publish(done.block);
        last = summary('turn', done.search, done.block);
    } catch (error) {
        console.warn(LOG, 'recall search', error);
        publish('');
        last = { at: Date.now(), kind: 'failed', error: String(error?.message || error) };
    }
}

function onScanDone(args) {
    if (!turn.active || !turn.result) return;
    const fresh = takeFiredEntries(args?.activated?.entries, { isManaged: isRecallManaged, taken: turn.fired });
    if (!fresh.length) return;
    const again = turn.result.search.again({ fired: [...turn.fired.values()] });
    turn.result.search = { ...turn.result.search, ...again };
    const block = renderBlock(again.items, { scene: turn.result.scene, sceneLine: turn.result.sceneLine });
    turn.result.block = block;
    publish(block);
    last = summary('turn', turn.result.search, block, { fired: [...turn.fired.keys()] });
}

/** Wire the turn to the host's events. Called once from the extension's entry file. */
export function startRecall() {
    if (turn.started) return;
    turn.started = true;
    on('GENERATION_STARTED', (type, opts, dryRun) => {
        if (dryRun) return;
        const quiet = type === 'quiet' || !!opts?.quiet_prompt;
        Object.assign(turn, { active: !quiet && !!ctx().chatMetadata?.[MEMORY]?.imported && settings().enabled !== false, type: String(type || 'normal'), fired: new Map(), result: null });
        if (!turn.active) publish('');
    });
    on('WORLDINFO_ENTRIES_LOADED', onEntriesLoaded);
    on('WORLDINFO_SCAN_DONE', onScanDone);
    on('GENERATION_ENDED', () => { turn.active = false; });
    on('GENERATION_STOPPED', () => { turn.active = false; });
    on('CHAT_CHANGED', () => { turn.active = false; turn.result = null; publish(''); setTimeout(() => warmRecall().catch(() => {}), 0); });
    for (const name of ['MESSAGE_RECEIVED', 'MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_DELETED']) on(name, () => { clearTimeout(turn.timer); turn.timer = setTimeout(() => warmRecall().catch(() => {}), 400); });
}

/** Load the model and bring the index in line with the open chat, in the background, so the next request finds both ready. */
export async function warmRecall() {
    const c = ctx();
    if (!c.chatMetadata?.[MEMORY]?.imported) return null;
    const rt = recallRuntime();
    await rt.embedder.load();
    const result = fold(c.chat || [], c.chatMetadata || {});
    // entries of managed books arrive with the next request; the last turn's entries stay indexed meanwhile
    const sources = sourcesFromChat({ chat: c.chat || [], result, books: rt.books || [] });
    const index = await rt.index.sync(sources, { embed: 'background' });
    // the desktop's own vectors for the booster list fill in behind, when the desktop answers
    if (rt.booster?.available?.()) index.fillBoosterInBackground();
    return index;
}
