// Undercurrent — SillyTavern 1.18 UI extension: hidden director, NPC minds, intimacy profiles, memory, events, tic guard.
// This file is wiring only (SillyTavern context, events, UI, generate interceptor). All logic lives in ./src (pure modules).
// Every SillyTavern API used here comes from SillyTavern.getContext() (public/scripts/st-context.js, 1.18.0).

import {
    createState, normalizeState, applyOps, commitEntry, appendToEntry, reconcile, chatKeys, messageKey, findEntry,
    takeCached, rekeyEntry, parseStateJson, emptyCharacter, openItems,
} from './src/state.js';
import { parseJsonSafe, extractInreplyBlock } from './src/parse.js';
import { buildDirectorMessages, normalizePlan, planToThreadOps } from './src/director.js';
import { buildScribeMessages, normalizeOps, buildInreplyInstruction } from './src/scribe.js';
import { buildSeedMessages, seedFromParsed } from './src/intimacy.js';
import { rollEvents, recordEventContent } from './src/events.js';
import { analyzeReply, isStalled } from './src/ticguard.js';
import { buildInjection } from './src/inject.js';
import { resolveLenses, lensBiases, beatFavor } from './src/registry.js';
import { profileForModel, slopListFor } from './src/slop.js';
import {
    buildCardBlock, buildTranscript, summarizeState, countUserTurns, lastUserMessage, previousAssistantReplies,
    userMessageBefore, cleanAssistantText, markPrivateThoughts,
} from './src/context.js';
import { hashText, stripReasoning, stripUcBlocks, findKeyCI } from './src/util.js';

const MODULE = 'undercurrent';
const LOG = '[Undercurrent]';
const PROMPT_KEY = 'undercurrent';
const INREPLY_KEY = 'undercurrent_inreply';

// extension_prompt_types / extension_prompt_roles are not exposed by getContext() in 1.18.0; values verified in
// public/script.js:483-497 (IN_CHAT = 1, SYSTEM = 0).
const PROMPT_TYPES = { NONE: -1, IN_PROMPT: 0, IN_CHAT: 1, BEFORE_PROMPT: 2 };
const PROMPT_ROLES = { SYSTEM: 0, USER: 1, ASSISTANT: 2 };

// Folder this extension is served from, e.g. "third-party/Undercurrent" (works whatever the install folder is called).
const EXT_PATH = (() => {
    try {
        const m = new URL(import.meta.url).pathname.match(/\/scripts\/extensions\/(.+)\/index\.js$/);
        return m ? decodeURIComponent(m[1]) : 'third-party/Undercurrent';
    } catch {
        return 'third-party/Undercurrent';
    }
})();

const DEFAULTS = Object.freeze({
    enabled: true,
    paused: false,
    mode: 'separate', // separate | inreply
    cadence: 'every', // every | 2 | 3 | stall
    preReply: true,
    drama: 1,
    events: { pulse: true, twist: true, curiosity: true },
    intimacy: true,
    ticguard: true,
    profileId: '',
    timeoutSec: 45,
    maxTokens: 900,
    stallTurns: 4,
    debug: false,
});

// Runtime (not persisted)
const runtime = {
    planCache: new Map(), // last-user-message hash -> { plan, fresh, event, nudge, turn }
    pendingScribe: null,
    seeding: new Set(),
    failures: 0,
    lastToast: 0,
};

// ---------------------------------------------------------------------------------------------------------------------
// Basics

function ctx() {
    return SillyTavern.getContext();
}

function settings() {
    const c = ctx();
    if (!c.extensionSettings[MODULE] || typeof c.extensionSettings[MODULE] !== 'object') c.extensionSettings[MODULE] = {};
    const s = c.extensionSettings[MODULE];
    for (const [k, v] of Object.entries(DEFAULTS)) {
        if (s[k] === undefined) s[k] = typeof v === 'object' ? { ...v } : v;
    }
    for (const [k, v] of Object.entries(DEFAULTS.events)) if (s.events[k] === undefined) s.events[k] = v;
    return s;
}

function dbg(...args) {
    try { if (settings().debug) console.debug(LOG, ...args); } catch { /* ignore */ }
}

function logError(where, err) {
    console.error(`${LOG} ${where}:`, err);
}

function noteFailure(where, err) {
    runtime.failures++;
    console.warn(`${LOG} ${where} failed (${runtime.failures} in a row):`, err?.message || err);
    const now = Date.now();
    if (runtime.failures >= 3 && now - runtime.lastToast > 5 * 60 * 1000 && typeof toastr !== 'undefined') {
        runtime.lastToast = now;
        toastr.warning(`Hidden passes keep failing (${where}). Check the connection or the hidden-pass profile; the story continues without them.`, 'Undercurrent');
    }
}

function noteSuccess() {
    runtime.failures = 0;
}

function chatActive() {
    const c = ctx();
    try {
        return !!c.getCurrentChatId() && !!c.chatMetadata;
    } catch {
        return false;
    }
}

function loadState() {
    const c = ctx();
    if (!c.chatMetadata) return createState();
    return normalizeState(c.chatMetadata[MODULE]);
}

function saveState(st) {
    const c = ctx();
    if (!c.chatMetadata) return;
    c.chatMetadata[MODULE] = st;
    c.saveMetadataDebounced();
}

function setPrompt(text) {
    ctx().setExtensionPrompt(PROMPT_KEY, text || '', PROMPT_TYPES.IN_CHAT, 1, false, PROMPT_ROLES.SYSTEM);
}

function setInreply(on) {
    const s = settings();
    const text = on && s.mode === 'inreply' ? buildInreplyInstruction({ intimacy: s.intimacy }) : '';
    ctx().setExtensionPrompt(INREPLY_KEY, text, PROMPT_TYPES.IN_CHAT, 0, false, PROMPT_ROLES.SYSTEM);
}

function clearPrompts() {
    try {
        setPrompt('');
        setInreply(false);
    } catch (e) {
        logError('clearPrompts', e);
    }
}

function readVar(name) {
    try {
        const v = ctx().variables?.local?.get?.(name);
        return v === undefined || v === null ? '' : String(v).trim();
    } catch {
        return '';
    }
}

// Read the Undercurrent preset's live toggles (including unsaved ones) from the prompt order.
// The preset's {{setvar::uc_*}} macros only run while the prompt is assembled, which is after this
// interceptor, so variables alone would lag one turn. Falls back to the variables, then to defaults.
function enabledPresetIds() {
    try {
        const s = ctx().chatCompletionSettings;
        const lists = Array.isArray(s?.prompt_order) ? s.prompt_order : [];
        const entry = lists.find(o => Number(o?.character_id) === 100001) || lists.find(o => Number(o?.character_id) === 100000);
        const order = Array.isArray(entry?.order) ? entry.order : [];
        return order.filter(o => o && o.enabled).map(o => String(o.identifier || ''));
    } catch {
        return [];
    }
}

function lensFromPreset(enabled, prefix) {
    const hit = enabled.find(id => id.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : '';
}

function currentLenses() {
    const enabled = enabledPresetIds();
    return resolveLenses({
        persona: lensFromPreset(enabled, 'uc_narr_') || readVar('uc_persona_id') || 'none',
        tone: lensFromPreset(enabled, 'uc_tone_') || readVar('uc_tone_id') || 'grounded',
        genre: lensFromPreset(enabled, 'uc_genre_') || readVar('uc_genre_id') || 'none',
    });
}

function modelName() {
    const c = ctx();
    try {
        if (c.mainApi === 'openai') return String(c.getChatCompletionModel() || '');
        return String(c.onlineStatus || '');
    } catch {
        return '';
    }
}

function cardInfo() {
    const c = ctx();
    let f = {};
    try { f = c.getCharacterCardFields() || {}; } catch { f = {}; }
    return {
        name: c.name2,
        description: f.description || '',
        personality: f.personality || '',
        scenario: f.scenario || '',
        persona: f.persona || '',
        examples: (f.mesExamples || '').slice(0, 1200),
    };
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, Math.max(0, ms)));
}

function withTimeout(promise, ms, onTimeout) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            try { onTimeout?.(); } catch { /* ignore */ }
            reject(new Error(`timed out after ${Math.round(ms / 1000)}s`));
        }, Math.max(1, ms));
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function profileAvailable(id) {
    try {
        const svc = ctx().ConnectionManagerRequestService;
        return !!(id && svc && svc.getSupportedProfiles().some(p => p.id === id));
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Hidden passes

/**
 * Run one hidden generation with the extension's own compact prompt (never the RP preset).
 * Uses a Connection Manager profile when configured, otherwise generateRaw on the current connection.
 */
async function runHidden({ systemPrompt, messages, maxTokens, timeoutMs, label }) {
    const c = ctx();
    const s = settings();
    const sub = (t) => { try { return c.substituteParams(String(t ?? '')); } catch { return String(t ?? ''); } };
    const sys = sub(systemPrompt);
    const msgs = messages.map(m => ({ role: m.role, content: sub(m.content) }));
    const tokens = Math.max(200, Number(maxTokens) || s.maxTokens);
    const ac = new AbortController();
    let p;
    if (s.profileId && profileAvailable(s.profileId)) {
        dbg(`${label}: via connection profile`, s.profileId);
        p = c.ConnectionManagerRequestService.sendRequest(
            s.profileId,
            [{ role: 'system', content: sys }, ...msgs],
            tokens,
            { stream: false, signal: ac.signal, extractData: true, includePreset: true },
        ).then(r => (typeof r === 'string' ? r : (r?.content ?? '')));
    } else {
        dbg(`${label}: via generateRaw`);
        p = c.generateRaw({ prompt: msgs, systemPrompt: sys, responseLength: tokens, trimNames: false });
    }
    const text = await withTimeout(p, timeoutMs, () => ac.abort());
    const out = stripReasoning(String(text ?? ''));
    dbg(`${label}: raw output`, out.slice(0, 2000));
    return out;
}

async function ensureSeeded(charName, budgetMs) {
    const s = settings();
    if (!s.intimacy || !charName || runtime.seeding.has(charName) || budgetMs < 2000) return;
    let st = loadState();
    const key = findKeyCI(st.characters, charName) || charName;
    const intim = st.characters[key]?.intimacy;
    if (intim?.seeded || (intim?.seed_attempts ?? 0) >= 2) return;
    const card = cardInfo();
    if (!card.description && !card.personality) return;
    runtime.seeding.add(charName);
    const chatId = ctx().getCurrentChatId();
    let parsed = null;
    try {
        const { systemPrompt, messages } = buildSeedMessages({ ...card, name: charName });
        const text = await runHidden({ systemPrompt, messages, maxTokens: Math.min(s.maxTokens, 700), timeoutMs: budgetMs, label: 'seed' });
        parsed = parseJsonSafe(text);
        if (parsed) noteSuccess();
    } catch (e) {
        noteFailure('intimacy seed', e);
    } finally {
        runtime.seeding.delete(charName);
    }
    if (ctx().getCurrentChatId() !== chatId) return;
    st = loadState();
    const k = findKeyCI(st.characters, charName) || charName;
    if (!st.characters[k]) st.characters[k] = emptyCharacter({ role: 'main character' });
    st.characters[k].intimacy = seedFromParsed(st.characters[k].intimacy, parsed, { turn: countUserTurns(ctx().chat) });
    saveState(st);
    dbg('seeded intimacy profile for', k, st.characters[k].intimacy);
}

async function runDirector({ state, turn, event, stall, nudge, lenses, timeoutMs }) {
    const c = ctx();
    const s = settings();
    const { systemPrompt, messages } = buildDirectorMessages({
        cardBlock: buildCardBlock(cardInfo(), { userName: c.name1, charName: c.name2 }),
        stateBlock: summarizeState(state, { turn }),
        transcript: buildTranscript(c.chat, { userName: c.name1, charName: c.name2, max: 12 }),
        signals: {
            turn,
            stall,
            stallTurns: s.stallTurns,
            event: event?.kind || null,
            nudge,
            usedBeats: openItems(state.threads.used_beats, turn).map(b => b.text),
            ticNotes: state.tics.pending,
            lastPlan: state.director.plan,
        },
        lenses: { ...lenses, beatFavor: beatFavor(lenses) },
    });
    const text = await runHidden({ systemPrompt, messages, maxTokens: s.maxTokens, timeoutMs, label: 'director' });
    const plan = normalizePlan(parseJsonSafe(text), { userName: c.name1 });
    if (!plan) throw new Error('director returned no usable plan');
    return plan;
}

/** Persist a fresh plan (and its off-screen threads/drivers/used beat) into a state copy. */
function storePlan(st, plan, { turn, key, event }) {
    const c = ctx();
    st.director.plan = plan;
    st.director.plan_turn = turn;
    st.director.last_turn = turn;
    st.director.plan_key = key;
    const r = applyOps(st, planToThreadOps(plan), { turn, source: 'director', userName: c.name1 });
    const out = r.state;
    if (event && plan.event) out.events = recordEventContent(out.events, turn, plan.event);
    return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Generate interceptor (runs inside Generate before extension prompts are collected: script.js:4505 vs 4641/5588)

globalThis.undercurrentInterceptor = async function undercurrentInterceptor(chat, contextSize, abort, type) {
    try {
        await intercept(type);
    } catch (e) {
        logError('interceptor', e);
    }
};

async function intercept(type) {
    const s = settings();
    if (!s.enabled || s.paused || !chatActive()) { clearPrompts(); return; }
    if (type === 'quiet') { clearPrompts(); return; }
    const c = ctx();
    const started = Date.now();
    const budget = Math.max(5, Number(s.timeoutSec) || 45) * 1000;
    const remaining = () => budget - (Date.now() - started);

    let st = reconcileNow();
    const turn = countUserTurns(c.chat);
    const lastUser = lastUserMessage(c.chat);
    const userKey = lastUser ? hashText(lastUser.mes) : 'none';
    const recentText = `${lastUser?.mes || ''} ${previousAssistantReplies(c.chat, c.chat.length, 1).join(' ')}`;
    const ticLines = s.ticguard ? st.tics.pending : [];
    const base = { state: st, turn, recentText, charName: c.name2, intimacyEnabled: s.intimacy, ticLines };

    if (type === 'impersonate') {
        // Impersonation writes for the player: world facts only — no beats, no NPC moves, no in-reply block.
        setPrompt(buildInjection({ ...base, mode: 'impersonate' }));
        setInreply(false);
        return;
    }

    if (type === 'continue') {
        const text = st.director.last_injection || buildInjection({ ...base, plan: st.director.plan, beatFresh: false });
        setPrompt(text);
        setInreply(true);
        return;
    }

    const isReroll = type === 'swipe' || type === 'regenerate';
    if (isReroll) {
        const cached = runtime.planCache.get(userKey)
            || (st.director.plan_key === userKey && st.director.plan_turn === turn
                ? { plan: st.director.plan, fresh: true, event: st.events.pending?.turn === turn ? st.events.pending : null, nudge: '' }
                : null);
        if (cached) {
            const text = buildInjection({ ...base, plan: cached.plan, beatFresh: cached.fresh, event: cached.event, nudge: cached.nudge, stall: isStalled(st, turn, s.stallTurns) });
            st.director.last_injection = text;
            saveState(st);
            setPrompt(text);
            setInreply(true);
            dbg('reroll: reused cached plan', { type, turn });
            return;
        }
    }

    // Seed the current character's intimacy profile once per chat.
    if (s.intimacy && c.name2) await ensureSeeded(c.name2, Math.min(remaining() * 0.4, 20000));

    // Let a still-running scribe pass land first (bounded), so the director sees the latest facts.
    if (runtime.pendingScribe) await Promise.race([runtime.pendingScribe.catch(() => null), sleep(Math.min(12000, remaining() * 0.3))]);

    st = loadState();
    const lenses = currentLenses();
    const stall = isStalled(st, turn, s.stallTurns);

    // Events: rolled once per new player turn (not on rerolls).
    let event = null;
    if (!isReroll) {
        const r = rollEvents({
            events: st.events, turn, rng: Math.random, drama: s.drama, biases: lensBiases(lenses),
            sceneMode: st.scene.mode, enabled: s.events, stall,
        });
        st.events = r.events;
        event = r.event;
        dbg('events', r.reason, r.event, r.chances);
    } else {
        event = st.events.pending?.turn === turn ? st.events.pending : null;
    }
    const nudge = st.director.nudge || '';
    saveState(st);

    const preplanned = st.director.plan && st.director.plan_turn === turn && st.director.plan_key === 'ahead';
    const sinceLast = turn - st.director.last_turn;
    const cadenceDue = s.cadence === 'every' || (s.cadence === '2' && sinceLast >= 2) || (s.cadence === '3' && sinceLast >= 3);
    const due = !preplanned && (cadenceDue || stall || !!event || !!nudge || !st.director.plan || isReroll);

    let plan = st.director.plan;
    let fresh = !!preplanned;
    if (due && s.preReply && remaining() > 3000) {
        try {
            plan = await runDirector({ state: st, turn, event, stall, nudge, lenses, timeoutMs: remaining() });
            fresh = true;
            noteSuccess();
        } catch (e) {
            noteFailure('director', e);
            plan = loadState().director.plan; // fall back to the last plan (its beat is not reused)
            fresh = false;
        }
    }

    st = loadState();
    if (fresh && plan && !preplanned) st = storePlan(st, plan, { turn, key: userKey, event });
    if (preplanned) st.director.plan_key = userKey;
    if (nudge) st.director.nudge = '';
    const text = buildInjection({
        ...base, state: st, plan, beatFresh: fresh, event, nudge, stall, ticLines: s.ticguard ? st.tics.pending : [],
    });
    st.director.last_injection = text;
    saveState(st);
    runtime.planCache.set(userKey, { plan, fresh, event, nudge, turn });
    if (runtime.planCache.size > 20) runtime.planCache.delete(runtime.planCache.keys().next().value);
    setPrompt(text);
    setInreply(true);
    dbg('injection', { type, turn, fresh, event: event?.kind, words: text.split(/\s+/).length }, text);
}

// ---------------------------------------------------------------------------------------------------------------------
// Post-reply: in-reply block parsing / scribe pass / tic guard / ledger

function reconcileNow() {
    const c = ctx();
    const s = settings();
    const st = loadState();
    const r = reconcile(st, chatKeys(c.chat), { userName: c.name1, intimacyEnabled: s.intimacy });
    if (r.changed) {
        saveState(r.state);
        dbg('reconciled ledger', { rolledBack: r.rolledBack, invalidated: r.invalidated.map(e => e.id) });
    }
    return r.state;
}

function messageElementExists(idx) {
    try {
        return !!document.querySelector(`#chat .mes[mesid="${idx}"]`);
    } catch {
        return false;
    }
}

/** Remove <!--uc …--> blocks from a message (mes, active swipe, display text) and re-render it if it is on screen. */
function stripMessage(idx, msg) {
    const before = msg.mes;
    msg.mes = stripUcBlocks(msg.mes);
    if (Array.isArray(msg.swipes) && Number.isInteger(msg.swipe_id) && typeof msg.swipes[msg.swipe_id] === 'string') {
        msg.swipes[msg.swipe_id] = stripUcBlocks(msg.swipes[msg.swipe_id]);
    }
    if (msg.extra && typeof msg.extra.display_text === 'string') msg.extra.display_text = stripUcBlocks(msg.extra.display_text);
    if (before !== msg.mes && messageElementExists(idx)) {
        try { ctx().updateMessageBlock(idx, msg); } catch (e) { logError('updateMessageBlock', e); }
    }
    return before !== msg.mes;
}

async function onMessageReceived(messageId, type) {
    try {
        const s = settings();
        if (!s.enabled || s.paused || !chatActive()) return;
        if (['first_message', 'command', 'extension', 'impersonate'].includes(type)) return;
        await processAssistantMessage(Number(messageId), { type });
    } catch (e) {
        logError('MESSAGE_RECEIVED', e);
    }
}

async function processAssistantMessage(idx, { type = 'normal' } = {}) {
    const s = settings();
    const c = ctx();
    const msg = c.chat[idx];
    if (!msg || msg.is_user || msg.is_system || typeof msg.mes !== 'string' || !msg.mes.trim()) return;

    let st = loadState();
    // In-reply block (always stripped, whatever the mode).
    let blockOps = null;
    if (/<!--\s*uc\b/i.test(msg.mes)) {
        const { found, json } = extractInreplyBlock(msg.mes);
        const changed = stripMessage(idx, msg);
        if (found && s.mode === 'inreply') {
            const n = normalizeOps(json, { userName: c.name1, intimacy: s.intimacy });
            blockOps = n.ops;
            if (n.rejected.length) dbg('in-reply ops rejected', n.rejected);
        }
        if (changed) await c.saveChat();
    }
    const key = messageKey(msg, idx);
    if (type === 'continue') st = rekeyEntry(st, idx, key.swipe_id, key.text_hash);
    st = reconcile(st, chatKeys(c.chat), { userName: c.name1, intimacyEnabled: s.intimacy }).state;
    if (findEntry(st, key) && type !== 'continue' && !blockOps) { saveState(st); return; } // already processed

    const turn = countUserTurns(c.chat);
    const userMsg = userMessageBefore(c.chat, idx);
    const reply = cleanAssistantText(msg.mes);
    const sourceText = `${reply}\n${userMsg}`;
    const r = commitEntry(st, key, blockOps || [], {
        turn, userName: c.name1, sourceText, intimacyEnabled: s.intimacy, source: blockOps ? 'inreply' : 'scribe', now: Date.now(),
    });
    st = r.state;
    if (r.rejected.length) dbg('ops rejected', r.rejected);
    if (blockOps) dbg('in-reply ops applied', r.applied);

    if (s.ticguard && type !== 'continue' && type !== 'edit') {
        const a = analyzeReply({
            reply,
            previous: previousAssistantReplies(c.chat, idx, 4),
            userMessage: userMsg,
            slopList: slopListFor(profileForModel(modelName())),
            tics: st.tics,
        });
        st.tics = a.tics;
        dbg('tic guard', a.findings, a.tics.pending);
    }
    st.director.last_injection = '';
    saveState(st);

    const needScribe = s.mode === 'separate' || (s.mode === 'inreply' && !blockOps);
    const chatId = c.getCurrentChatId();
    if (needScribe) {
        // Non-blocking: schedule and return so the event chain is not held up.
        const job = runScribe({ chatId, entryId: r.entry.id, idx, turn, userMsg, reply })
            .then(() => { if (!s.preReply) return runDirectorAhead({ chatId, turn }); })
            .catch(e => logError('scribe', e))
            .finally(() => { if (runtime.pendingScribe === job) runtime.pendingScribe = null; });
        runtime.pendingScribe = job;
    } else if (!s.preReply) {
        runDirectorAhead({ chatId, turn }).catch(e => logError('director (ahead)', e));
    }
}

async function runScribe({ chatId, entryId, idx, turn, userMsg, reply }) {
    const s = settings();
    const c = ctx();
    const st0 = loadState();
    const { systemPrompt, messages } = buildScribeMessages({
        cardBlock: buildCardBlock(cardInfo(), { userName: c.name1, charName: c.name2, descChars: 1200 }),
        stateBlock: summarizeState(st0, { turn }),
        transcript: buildTranscript(c.chat, { userName: c.name1, charName: c.name2, max: 4, uptoIndex: idx - 2, maxChars: 900 }),
        userMessage: markPrivateThoughts(userMsg),
        reply,
        intimacy: s.intimacy,
    });
    let text;
    try {
        text = await runHidden({ systemPrompt, messages, maxTokens: s.maxTokens, timeoutMs: s.timeoutSec * 1000, label: 'scribe' });
    } catch (e) {
        noteFailure('scribe', e);
        return;
    }
    if (ctx().getCurrentChatId() !== chatId) return;
    const parsed = parseJsonSafe(text, { prefer: 'any' });
    if (parsed === null) { noteFailure('scribe', new Error('unparseable output')); return; }
    noteSuccess();
    const { ops, rejected } = normalizeOps(parsed, { userName: c.name1, intimacy: s.intimacy });
    const r = appendToEntry(loadState(), entryId, ops, {
        userName: c.name1, sourceText: `${reply}\n${userMsg}`, intimacyEnabled: s.intimacy, source: 'scribe',
    });
    if (!r.entry) { dbg('scribe result discarded: message changed meanwhile'); return; }
    saveState(r.state);
    dbg('scribe applied', r.applied, 'rejected', [...rejected, ...r.rejected]);
}

/** Pre-reply director off: plan the next turn in the background right after a reply. */
async function runDirectorAhead({ chatId, turn }) {
    const s = settings();
    if (s.preReply || !s.enabled || s.paused) return;
    let st = loadState();
    const next = turn + 1;
    const sinceLast = next - st.director.last_turn;
    const stall = isStalled(st, next, s.stallTurns);
    const due = s.cadence === 'every' || (s.cadence === '2' && sinceLast >= 2) || (s.cadence === '3' && sinceLast >= 3) || stall || !!st.director.nudge || !st.director.plan;
    if (!due) return;
    try {
        const plan = await runDirector({ state: st, turn: next, event: null, stall, nudge: st.director.nudge, lenses: currentLenses(), timeoutMs: s.timeoutSec * 1000 });
        if (ctx().getCurrentChatId() !== chatId) return;
        noteSuccess();
        st = storePlan(loadState(), plan, { turn: next, key: 'ahead', event: null });
        saveState(st);
        dbg('planned ahead for turn', next, plan);
    } catch (e) {
        noteFailure('director (ahead)', e);
    }
}

function onCharacterRendered(messageId) {
    // Safety net: a block that slipped past MESSAGE_RECEIVED (e.g. streaming edge cases) is never left visible.
    try {
        const c = ctx();
        const idx = Number(messageId);
        const msg = c.chat[idx];
        if (msg && !msg.is_user && typeof msg.mes === 'string' && /<!--\s*uc\b/i.test(msg.mes)) {
            if (stripMessage(idx, msg)) c.saveChat();
        }
    } catch (e) {
        logError('CHARACTER_MESSAGE_RENDERED', e);
    }
}

/** Edits, deletions and swipes: invalidate by key, roll back, and re-apply a cached batch when swiping back. */
function onChatMutated(kind, arg) {
    try {
        if (!chatActive()) return;
        const c = ctx();
        const s = settings();
        let st = loadState();
        const r = reconcile(st, chatKeys(c.chat), { userName: c.name1, intimacyEnabled: s.intimacy });
        st = r.state;
        let changed = r.changed;
        if (kind === 'swiped') {
            const idx = Number(arg);
            const msg = c.chat[idx];
            if (msg && !msg.is_user && msg.mes) {
                const key = messageKey(msg, idx);
                if (!findEntry(st, key)) {
                    const t = takeCached(st, key);
                    if (t.cached) {
                        st = commitEntry(t.state, key, t.cached.ops, { turn: t.cached.turn, trusted: true, source: 'replay', userName: c.name1 }).state;
                        changed = true;
                        dbg('swipe-back: re-applied cached batch', key);
                    }
                }
            }
        }
        if (changed || st.director.last_injection) {
            st.director.last_injection = '';
            saveState(st);
        }
        if (r.rolledBack) dbg(`rolled back after ${kind}`, r.invalidated.map(e => e.id));
        if (kind === 'edited' && s.enabled && !s.paused) {
            const idx = Number(arg);
            const msg = c.chat[idx];
            const isLastAssistant = msg && !msg.is_user && !msg.is_system && !c.chat.slice(idx + 1).some(m => !m.is_user && !m.is_system);
            if (isLastAssistant && !findEntry(st, messageKey(msg, idx))) {
                processAssistantMessage(idx, { type: 'edit' }).catch(e => logError('re-scribe after edit', e));
            }
        }
    } catch (e) {
        logError(`chat mutation (${kind})`, e);
    }
}

function onChatChanged() {
    runtime.planCache.clear();
    runtime.pendingScribe = null;
    clearPrompts();
    try {
        if (chatActive()) reconcileNow();
    } catch (e) {
        logError('CHAT_CHANGED', e);
    }
    updateStatus();
}

// ---------------------------------------------------------------------------------------------------------------------
// State Inspector, reset, re-seed

async function openInspector() {
    const c = ctx();
    if (!chatActive()) { toastr.info('Open a chat first.', 'Undercurrent'); return; }
    const st = loadState();
    const { snapshots, swipe_cache, ...view } = st;
    const head = `<div class="uc-inspector-head"><h3>Undercurrent — chat state</h3>
<small>Hidden from the story. Edit and press Save; the JSON is validated before it is stored. Rollback snapshots are kept as they are.</small></div>`;
    const popup = new c.Popup(head, c.POPUP_TYPE.INPUT, JSON.stringify(view, null, 2), {
        okButton: 'Save',
        cancelButton: 'Close',
        rows: 26,
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        leftAlign: true,
        onClosing: (p) => {
            if (p.result !== c.POPUP_RESULT.AFFIRMATIVE) return true;
            const r = parseStateJson(p.value);
            if (!r.ok) {
                toastr.error(r.errors.slice(0, 4).join(' '), 'Undercurrent: not saved');
                return false;
            }
            const current = loadState();
            r.state.snapshots = current.snapshots;
            r.state.swipe_cache = current.swipe_cache;
            r.state.director.last_injection = '';
            saveState(r.state);
            toastr.success('State saved.', 'Undercurrent');
            return true;
        },
    });
    await popup.show();
}

async function resetState({ confirm = true } = {}) {
    const c = ctx();
    if (!chatActive()) return false;
    if (confirm) {
        const ok = await c.callGenericPopup('Clear all Undercurrent state for this chat? Facts, character minds, intimacy profiles, threads and history will be forgotten. The chat itself is not changed.', c.POPUP_TYPE.CONFIRM);
        if (ok !== c.POPUP_RESULT.AFFIRMATIVE) return false;
    }
    runtime.planCache.clear();
    saveState(createState());
    clearPrompts();
    toastr.info('Chat state cleared.', 'Undercurrent');
    return true;
}

async function reseedCharacter() {
    const c = ctx();
    if (!chatActive() || !c.name2) { toastr.info('Open a character chat first.', 'Undercurrent'); return; }
    const st = loadState();
    const key = findKeyCI(st.characters, c.name2) || c.name2;
    if (!st.characters[key]) st.characters[key] = emptyCharacter({ role: 'main character' });
    // Re-seeding refreshes card-derived entries; in-story evidence and story limits are kept.
    const intim = st.characters[key].intimacy;
    intim.preferences = intim.preferences.filter(p => p.status === 'evidenced');
    intim.limits = intim.limits.filter(l => l.source === 'story');
    intim.seeded = false;
    intim.seed_attempts = 0;
    saveState(st);
    toastr.info(`Reading ${c.name2}'s card…`, 'Undercurrent');
    await ensureSeeded(c.name2, settings().timeoutSec * 1000);
    const after = loadState().characters[key]?.intimacy;
    if (after?.seeded) toastr.success(`Profile seeded: ${after.preferences.length} preferences, ${after.limits.length} limits.`, 'Undercurrent');
    else toastr.warning('Could not read the card this time.', 'Undercurrent');
}

// ---------------------------------------------------------------------------------------------------------------------
// Slash commands (SlashCommandParser.addCommandObject + SlashCommand.fromProps)

function registerCommands() {
    const c = ctx();
    const { SlashCommandParser, SlashCommand, SlashCommandArgument, ARGUMENT_TYPE } = c;
    const add = (props) => {
        try { SlashCommandParser.addCommandObject(SlashCommand.fromProps(props)); } catch (e) { logError(`register /${props.name}`, e); }
    };
    add({
        name: 'uc-state',
        callback: async () => { await openInspector(); return ''; },
        helpString: 'Open the Undercurrent State Inspector for this chat (view/edit hidden state).',
    });
    add({
        name: 'uc-reset',
        callback: async () => { await resetState({ confirm: true }); return ''; },
        helpString: 'Clear Undercurrent\'s hidden state for this chat (asks for confirmation).',
    });
    add({
        name: 'uc-direct',
        callback: async (_named, value) => {
            const note = String(value ?? '').trim();
            if (!note) { toastr.info('Usage: /uc-direct <note for the director>', 'Undercurrent'); return ''; }
            if (!chatActive()) return '';
            const st = loadState();
            st.director.nudge = note.slice(0, 600);
            saveState(st);
            toastr.info('The director will take this into account next turn.', 'Undercurrent');
            return '';
        },
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({ description: 'one-shot note merged into the next director pass and injection', typeList: [ARGUMENT_TYPE.STRING], isRequired: true }),
        ],
        helpString: 'One-shot note to the hidden director, e.g. <code>/uc-direct have her sister call during dinner</code>.',
    });
    add({
        name: 'uc-pause',
        callback: async () => { settings().paused = true; ctx().saveSettingsDebounced(); clearPrompts(); updateStatus(); toastr.info('Paused.', 'Undercurrent'); return ''; },
        helpString: 'Pause Undercurrent (no hidden passes or notes) until /uc-resume.',
    });
    add({
        name: 'uc-resume',
        callback: async () => { settings().paused = false; ctx().saveSettingsDebounced(); updateStatus(); toastr.info('Resumed.', 'Undercurrent'); return ''; },
        helpString: 'Resume Undercurrent after /uc-pause.',
    });
}

// ---------------------------------------------------------------------------------------------------------------------
// Settings drawer

function populateProfiles() {
    const row = $('#uc_profile_row');
    const select = $('#uc_profile');
    try {
        const svc = ctx().ConnectionManagerRequestService;
        if (!svc) throw new Error('no service');
        const profiles = svc.getSupportedProfiles();
        const s = settings();
        select.empty().append($('<option>').val('').text('Same as the current connection'));
        for (const p of profiles) select.append($('<option>').val(p.id).text(p.name || p.id));
        if (s.profileId && !profiles.some(p => p.id === s.profileId)) {
            select.append($('<option>').val(s.profileId).text('(missing profile — falls back to current)'));
        }
        select.val(s.profileId || '');
        row.show();
    } catch {
        row.hide();
    }
}

function updateStatus() {
    try {
        const s = settings();
        const profile = profileForModel(modelName());
        const lenses = currentLenses();
        const status = !s.enabled ? 'Off' : s.paused ? 'Paused (/uc-resume)' : 'Active';
        $('#uc_status').text(`${status} · model profile: ${profile} · persona: ${lenses.persona.id} · tone: ${lenses.tone.id} · genre: ${lenses.genre.id}`);
    } catch { /* drawer not rendered */ }
}

function bindSettings() {
    const s = settings();
    const save = () => { ctx().saveSettingsDebounced(); updateStatus(); };
    const bindCheck = (id, get, set) => { $(id).prop('checked', get()).on('input change', function () { set(!!$(this).prop('checked')); save(); }); };
    bindCheck('#uc_enabled', () => s.enabled, v => { s.enabled = v; if (!v) clearPrompts(); });
    bindCheck('#uc_prereply', () => s.preReply, v => { s.preReply = v; });
    bindCheck('#uc_intimacy', () => s.intimacy, v => { s.intimacy = v; });
    bindCheck('#uc_ticguard', () => s.ticguard, v => { s.ticguard = v; });
    bindCheck('#uc_debug', () => s.debug, v => { s.debug = v; });
    for (const k of ['pulse', 'twist', 'curiosity']) bindCheck(`#uc_ev_${k}`, () => s.events[k], v => { s.events[k] = v; });
    $('#uc_mode').val(s.mode).on('change', function () { s.mode = $(this).val() === 'inreply' ? 'inreply' : 'separate'; if (s.mode !== 'inreply') setInreply(false); save(); });
    $('#uc_cadence').val(s.cadence).on('change', function () { s.cadence = String($(this).val()); save(); });
    const showDrama = () => $('#uc_drama_value').text(Number(s.drama).toFixed(1));
    $('#uc_drama').val(s.drama).on('input', function () { s.drama = Math.min(2, Math.max(0, Number($(this).val()) || 0)); showDrama(); save(); });
    showDrama();
    const bindNumber = (id, key, min, max) => {
        $(id).val(s[key]).on('change', function () {
            const v = Math.round(Number($(this).val()));
            s[key] = Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : DEFAULTS[key];
            $(this).val(s[key]);
            save();
        });
    };
    bindNumber('#uc_timeout', 'timeoutSec', 5, 300);
    bindNumber('#uc_maxtokens', 'maxTokens', 200, 8000);
    bindNumber('#uc_stall', 'stallTurns', 2, 20);
    $('#uc_profile').on('change', function () { s.profileId = String($(this).val() || ''); save(); });
    $('#uc_open_inspector').on('click', () => openInspector().catch(e => logError('inspector', e)));
    $('#uc_reseed').on('click', () => reseedCharacter().catch(e => logError('reseed', e)));
    $('#uc_clear').on('click', () => resetState({ confirm: true }).catch(e => logError('reset', e)));
    $('#undercurrent_settings .inline-drawer-toggle').on('click', () => { populateProfiles(); updateStatus(); });
    populateProfiles();
    updateStatus();
}

// ---------------------------------------------------------------------------------------------------------------------
// Init

function registerEvents() {
    const c = ctx();
    const ev = c.eventTypes;
    c.eventSource.on(ev.MESSAGE_RECEIVED, onMessageReceived);
    c.eventSource.on(ev.CHARACTER_MESSAGE_RENDERED, onCharacterRendered);
    c.eventSource.on(ev.MESSAGE_EDITED, (id) => onChatMutated('edited', id));
    c.eventSource.on(ev.MESSAGE_DELETED, (len) => onChatMutated('deleted', len));
    c.eventSource.on(ev.MESSAGE_SWIPED, (id) => onChatMutated('swiped', id));
    if (ev.MESSAGE_SWIPE_DELETED) c.eventSource.on(ev.MESSAGE_SWIPE_DELETED, (data) => onChatMutated('swipe_deleted', data?.messageId));
    c.eventSource.on(ev.CHAT_CHANGED, onChatChanged);
}

async function init() {
    settings();
    try {
        const html = await ctx().renderExtensionTemplateAsync(EXT_PATH, 'settings');
        $('#extensions_settings2').append(html);
        bindSettings();
    } catch (e) {
        logError('settings UI', e);
    }
    registerCommands();
    registerEvents();
    console.log(`${LOG} loaded from ${EXT_PATH}`);
}

jQuery(() => {
    init().catch(e => logError('init', e));
});
