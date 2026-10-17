// Undercurrent — SillyTavern 1.18 UI extension: hidden director, NPC minds, intimacy profiles, memory, events, tic guard.
// This file is wiring only (SillyTavern context, events, UI, generate interceptor). All logic lives in ./src (pure modules).
// Every SillyTavern API used here comes from SillyTavern.getContext() (public/scripts/st-context.js, 1.18.0).
//
// Every behavior-relevant number, switch and prompt is a knob (src/knob-defs.js): global values live in
// extensionSettings.undercurrent.knobs, per-chat overrides in chatMetadata.undercurrent.knob_overrides.

import {
    createState, normalizeState, applyOps, commitEntry, appendToEntry, reconcile, chatKeys, messageKey, findEntry,
    takeCached, rekeyEntry, parseStateJson, emptyCharacter, openItems, setLimits,
} from './src/state.js';
import { parseJsonSafe, extractInreplyBlock } from './src/parse.js';
import { buildDirectorMessages, normalizePlan, planToThreadOps } from './src/director.js';
import { buildScribeMessages, normalizeOps, buildInreplyInstruction } from './src/scribe.js';
import { buildSeedMessages, seedFromParsed, setIntimacyConfig } from './src/intimacy.js';
import { rollEvents, recordEventContent } from './src/events.js';
import { analyzeReply, isStalled, mergeSlopList } from './src/ticguard.js';
import { buildInjectionParts, macroValues, MACRO_NAMES } from './src/inject.js';
import { REGISTRY, resolveLenses, lensBiases, beatFavor } from './src/registry.js';
import { profileForModel, slopListFor, SLOP } from './src/slop.js';
import {
    buildCardBlock, buildTranscript, summarizeState, countUserTurns, lastUserMessage, previousAssistantReplies,
    userMessageBefore, cleanAssistantText, markPrivateThoughts,
} from './src/context.js';
import { hashText, stripReasoning, stripUcBlocks, findKeyCI } from './src/util.js';
import {
    resolve as resolveKnobs, migrateLegacy, setValue, resetKeys, findKnob, getKnob, allKnobs, coerce, applyProfile,
    exportProfile, importProfile, matchesProfile, LEGACY_MAP, registerKnobs, registerGroups,
} from './src/knobs.js';
import { PORTS_KNOBS, PORTS_GROUPS, configurePorts, portObservationOps } from './src/ports/port-state.js';
import { portsTurn, commitPortsRuntime, PORT_MACROS } from './src/ports/turn.js';
import { criticDue, buildCriticMessages, parseCriticResult } from './src/ports/critic.js';
import { scoutDue, buildScoutMessages, parseScoutResult, executeDramaCommand } from './src/ports/drama_cadence.js';
import { psycheTurn } from './src/ports/psyche.js';
import { peekRecord, peekSections, renderPeekHtml, PEEK_CLASS } from './src/peek.js';
import { registerCoreKnobs, moduleConfigs, BUILTIN_PROFILES, findBuiltinProfile } from './src/knob-defs.js';
import { renderPanel, bindPanel } from './src/ui-knobs.js';
import {
    emptyGoals, tickGoals, resetCheckCounter, checkTargets, applyCheckResults, reconcileCompletions, injectionLines,
    directorBrief, stampCurrent, getGoal, findTask, addTasks, clearOpenTasks, importGoals, exportGoals, findGoal,
    parseGoalCommand, parseTasksCommand, executeGoalCommand, setGoalChatSetting, resolveGoalOptions, GOALS_KNOBS, CHAT_KNOBS,
} from './src/goals.js';
import { buildTaskGenMessages, tasksFromOutput, buildCheckMessages, parseCheck } from './src/goal-prompts.js';
import { mountGoalsPanel, openGoalsPopup } from './src/ui-goals.js';
import { evaluateRules, resolveRuleSet, resolveRuleOptions, RULES_KNOBS, turnRng } from './src/rules.js';
import { STARTER_PACKS } from './src/rulepacks.js';
import {
    mountRulesPanel, ensureRulesSettings, importIntoSettings, packJson, renderTest, renderReport, setRuleEnabled, setPackEnabled,
} from './src/ui-rules.js';

const MODULE = 'undercurrent';
const LOG = '[Undercurrent]';
const PROMPT_KEY = 'undercurrent';
const INREPLY_KEY = 'undercurrent_inreply';

// extension_prompt_types / extension_prompt_roles are not exposed by getContext() in 1.18.0; values verified in
// public/script.js:483-497 (IN_CHAT = 1, SYSTEM = 0).
const PROMPT_TYPES = { NONE: -1, IN_PROMPT: 0, IN_CHAT: 1, BEFORE_PROMPT: 2 };
const PROMPT_ROLES = { SYSTEM: 0, USER: 1, ASSISTANT: 2 };
const POSITION_OF = { in_chat: PROMPT_TYPES.IN_CHAT, in_prompt: PROMPT_TYPES.IN_PROMPT, before_prompt: PROMPT_TYPES.BEFORE_PROMPT };
const ROLE_OF = { system: PROMPT_ROLES.SYSTEM, user: PROMPT_ROLES.USER, assistant: PROMPT_ROLES.ASSISTANT };

// Folder this extension is served from, e.g. "third-party/Undercurrent" (works whatever the install folder is called).
const EXT_PATH = (() => {
    try {
        const m = new URL(import.meta.url).pathname.match(/\/scripts\/extensions\/(.+)\/index\.js$/);
        return m ? decodeURIComponent(m[1]) : 'third-party/Undercurrent';
    } catch {
        return 'third-party/Undercurrent';
    }
})();

registerCoreKnobs();
registerKnobs(GOALS_KNOBS, { source: 'goals' });
registerKnobs(RULES_KNOBS, { source: 'rules' });
registerKnobs(PORTS_KNOBS, { source: 'ports' });
registerGroups(PORTS_GROUPS);

const RULE_KEY_PREFIX = 'undercurrent_rule_';
const RULE_KEYS_MAX = RULES_KNOBS.find(k => k.key === 'rules.max_depth')?.max ?? 6; // clear every slot that can exist
const GOAL_PREFIX = 'goals.';

// Runtime (not persisted)
const runtime = {
    planCache: new Map(), // last-user-message hash -> { plan, fresh, event, nudge, turn }
    pendingScribe: null,
    seeding: new Set(),
    failures: 0,
    lastToast: 0,
    macros: {}, // {{uc_*}} macro values computed by the last interceptor run (placement "macros" only)
    goalBusy: { gen: null, check: false },
    goalCheck: null,
    goalsPanel: null,
    goalsPopupPanel: null,
    ruleResult: null, // last evaluateRules() output
    rulesPanel: null,
    portMacros: {}, // {{uc_scene_intimacy}} … values from the last portsTurn()
    lastTicFindings: null, // tic-guard findings of the latest reply (reply shape / drama read them)
    criticFindings: [], // code-side critic findings of the latest reply (the optional hidden critic reads them)
    peekByTurn: new Map(), // player turn -> peekRecord() of the note built for it (screen-only peek; never persisted)
};

// ---------------------------------------------------------------------------------------------------------------------
// Basics, settings and knobs

function ctx() {
    return SillyTavern.getContext();
}

const hasLegacy = s => Object.keys(LEGACY_MAP).some(k => (k.startsWith('events.') ? s.events && typeof s.events === 'object' : Object.hasOwn(s, k)));

/** extensionSettings.undercurrent: { version, knobs, profile, user_profiles }. v1.0 flat keys are migrated on read. */
function settings() {
    const c = ctx();
    if (!c.extensionSettings[MODULE] || typeof c.extensionSettings[MODULE] !== 'object') c.extensionSettings[MODULE] = {};
    const s = c.extensionSettings[MODULE];
    if (hasLegacy(s)) {
        const { migrated } = migrateLegacy(s);
        if (migrated.length) { try { c.saveSettingsDebounced(); } catch { /* ignore */ } }
    }
    if (!s.knobs || typeof s.knobs !== 'object' || Array.isArray(s.knobs)) s.knobs = {};
    if (!s.user_profiles || typeof s.user_profiles !== 'object' || Array.isArray(s.user_profiles)) s.user_profiles = {};
    if (typeof s.profile !== 'string') s.profile = 'Balanced';
    if (!s.version) s.version = 2;
    return s;
}

function chatOverrides() {
    try {
        const o = ctx().chatMetadata?.[MODULE]?.knob_overrides;
        return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
    } catch {
        return {};
    }
}

/** Resolved knob values + engine configs; also pushes the module-level configs (state limits, intimacy rules). */
function conf() {
    const v = resolveKnobs(settings().knobs, chatOverrides());
    // Chat-scope goals knobs live in state.goals.settings (one source of truth); show their effective values.
    try {
        if (chatActive()) {
            const go = goalOpts();
            for (const n of CHAT_KNOBS) if (`${GOAL_PREFIX}${n}` in v) v[`${GOAL_PREFIX}${n}`] = go[n];
        }
    } catch { /* no chat */ }
    const mc = moduleConfigs(v);
    setLimits(mc.limits);
    setIntimacyConfig(mc.intimacy);
    configurePorts(v);
    return { v, mc };
}

const K = () => conf().v;

function dbg(...args) {
    try { if (K()['core.debug']) console.debug(LOG, ...args); } catch { /* ignore */ }
}

function logError(where, err) {
    console.error(`${LOG} ${where}:`, err);
}

function noteFailure(where, err) {
    runtime.failures++;
    console.warn(`${LOG} ${where} failed (${runtime.failures} in a row):`, err?.message || err);
    const v = K();
    const now = Date.now();
    if (v['core.toast_on_failure'] && runtime.failures >= v['core.failure_toast_after']
        && now - runtime.lastToast > v['core.failure_toast_cooldown_min'] * 60 * 1000 && typeof toastr !== 'undefined') {
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

function isPaused(v = K()) {
    return !!(v['core.paused'] || v['core.chat_paused']);
}

function loadState() {
    const c = ctx();
    if (!c.chatMetadata) return createState();
    const st = normalizeState(c.chatMetadata[MODULE]);
    // A brand-new goals block picks up the user's global chat-scope goal defaults, not the built-in ones.
    if (!c.chatMetadata[MODULE]?.goals) st.goals = emptyGoals(globalGoalValues(true));
    return st;
}

// ---------------------------------------------------------------------------------------------------------------------
// Goals & Rules helpers

/** Global goals knob values (from extensionSettings.undercurrent.knobs). short=true strips the "goals." prefix. */
function globalGoalValues(short = false) {
    const knobs = settings().knobs;
    return Object.fromEntries(Object.entries(knobs).filter(([k]) => k.startsWith(GOAL_PREFIX)).map(([k, val]) => [short ? k.slice(GOAL_PREFIX.length) : k, val]));
}

/** Effective goal options: global < this chat's goals.settings < goals.* knob overrides (all in short form). */
function goalOpts(st) {
    const c = ctx();
    const meta = c.chatMetadata?.[MODULE];
    const goalsSettings = st ? st.goals?.settings : (meta?.goals?.settings || null);
    const ov = Object.fromEntries(Object.entries(st ? st.knob_overrides || {} : chatOverrides()).filter(([k]) => k.startsWith(GOAL_PREFIX)).map(([k, val]) => [k.slice(GOAL_PREFIX.length), val]));
    return resolveGoalOptions({ ...globalGoalValues(true), ...(goalsSettings && typeof goalsSettings === 'object' ? goalsSettings : {}), ...ov });
}

function goalOwners(st) {
    const c = ctx();
    const names = [c.name2, ...Object.keys(st.characters)];
    try {
        const g = c.groupId ? c.groups?.find(x => x.id === c.groupId) : null;
        for (const av of g?.members || []) names.push(c.characters.find(ch => ch.avatar === av)?.name);
    } catch { /* not a group */ }
    return [...new Set(names.filter(n => n && n.toLowerCase() !== String(c.name1 || '').toLowerCase()))];
}

function refreshGoalsPanel() {
    for (const p of [runtime.goalsPanel, runtime.goalsPopupPanel]) { try { p?.refresh(); } catch { /* not mounted */ } }
}

function rulesSettings() {
    const s = settings();
    s.rules = ensureRulesSettings(s.rules);
    return s.rules;
}

function ruleOptions(st) {
    return resolveRuleOptions(resolveKnobs(settings().knobs, st ? st.knob_overrides : chatOverrides()));
}

function ruleSet(options) {
    const { packs, rules } = resolveRuleSet(rulesSettings(), STARTER_PACKS, options);
    return { rules, packs: Object.fromEntries(packs.map(p => [p.id, p])) };
}

function knownNames(st) {
    const c = ctx();
    return [c.name1, c.name2, ...Object.keys(st?.characters || {})].filter(Boolean);
}

function clearRulePrompts() {
    const c = ctx();
    for (let i = 0; i < RULE_KEYS_MAX; i++) c.setExtensionPrompt(`${RULE_KEY_PREFIX}${i}`, '', PROMPT_TYPES.IN_CHAT, 1, false, PROMPT_ROLES.SYSTEM);
}

function applyRulePrompts(result) {
    clearRulePrompts();
    for (const d of result?.depthInjections || []) {
        ctx().setExtensionPrompt(d.key, d.text, PROMPT_TYPES.IN_CHAT, d.depth, false, ROLE_OF[d.role] ?? PROMPT_ROLES.SYSTEM);
    }
}

/** Evaluate the Chance rules for this generation. Saves rules_state and variables into `st` when commit; returns the result. */
function runRules(st, { type, turn, lastUser, commit = true }) {
    const c = ctx();
    const options = ruleOptions(st);
    if (!options.enabled) return null;
    const { rules, packs } = ruleSet(options);
    const replyBefore = lastUser ? previousAssistantReplies(c.chat, lastUser.index, 1)[0] || '' : '';
    const isReroll = type === 'swipe' || type === 'regenerate';
    const last = c.chat[c.chat.length - 1];
    const salt = isReroll ? (Array.isArray(last?.swipes) ? last.swipes.length : 1) : 0; // swipes re-roll, replays don't
    const result = evaluateRules({
        rules, packs, state: st, ruleState: st.rules_state, turn, type,
        userText: lastUser?.mes || '', replyText: replyBefore,
        vars: { ...(c.chatMetadata?.variables || {}) },
        charName: c.name2, userName: c.name1,
        rng: turnRng(c.getCurrentChatId(), turn, salt),
        intimacyEnabled: K()['intimacy.enabled'], options,
    });
    if (commit && !result.skipped) {
        st.rules_state = result.ruleState;
        for (const v of result.varSets || []) {
            try { c.variables.local.set(v.name, v.value); } catch (e) { logError('rules var', e); }
        }
    }
    dbg('rules', result.fired, result.trace);
    return result;
}

/** Spark priority from the rule's own priority (1..5): pri.sparks ± 5 per step. */
function ruleSparkPri(rulePriority = 3) {
    return (Number(K()['inject.pri_sparks']) || 40) + (Number(rulePriority) - 3) * 5;
}

/** True when this WebView probably cannot save a Blob download (TauriTavern mobile, iOS/Android webviews). */
function blobDownloadUnavailable() {
    try {
        if (typeof URL?.createObjectURL !== 'function' || !('download' in HTMLAnchorElement.prototype)) return true;
        // TauriTavern (any platform) and mobile WebViews often drop <a download>: use the copyable popup there.
        const tauri = !!(globalThis.__TAURI__ || globalThis.__TAURI_INTERNALS__ || globalThis.isTauri);
        const mobile = (() => { try { return !!ctx().isMobile?.(); } catch { return false; } })() || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
        return mobile || tauri;
    } catch {
        return true;
    }
}

/** Save text as a file; falls back to a copyable popup automatically where downloads do not work. */
async function saveTextFile(name, text) {
    const c = ctx();
    const popup = () => c.callGenericPopup(`<b>${name.replace(/</g, '&lt;')}</b><br><small>Downloads are not available here: copy this text and save it yourself.</small>`, c.POPUP_TYPE.INPUT, text, { rows: 18, wide: true, large: true, okButton: 'Close', cancelButton: false });
    if (blobDownloadUnavailable()) { await popup(); return 'popup'; }
    try {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const a = Object.assign(document.createElement('a'), { href: url, download: name });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        return 'download';
    } catch {
        await popup();
        return 'popup';
    }
}

function saveState(st) {
    const c = ctx();
    if (!c.chatMetadata) return;
    // Knob overrides are written directly by the settings UI / commands; never let an older state copy clobber them.
    const live = c.chatMetadata[MODULE]?.knob_overrides;
    if (live && typeof live === 'object') st.knob_overrides = live;
    c.chatMetadata[MODULE] = st;
    c.saveMetadataDebounced();
}

/** Place the note: one extension prompt (placement "note") or the {{uc_*}} macros (placement "macros"). */
function placeNote(parts, v = K()) {
    const c = ctx();
    const text = parts?.text || '';
    if (v['inject.placement'] === 'macros') {
        runtime.macros = macroValues(parts || { text: '', lines: [] }, { bullet: v['inject.bullet'] });
        c.setExtensionPrompt(PROMPT_KEY, '', PROMPT_TYPES.IN_CHAT, 1, false, PROMPT_ROLES.SYSTEM);
        return;
    }
    runtime.macros = {};
    c.setExtensionPrompt(PROMPT_KEY, text, POSITION_OF[v['inject.position']] ?? PROMPT_TYPES.IN_CHAT, v['inject.depth'],
        !!v['inject.scan'], ROLE_OF[v['inject.role']] ?? PROMPT_ROLES.SYSTEM);
}

/** Set the note from plain text (continue / cached reuse). */
function setPrompt(text, v = K()) {
    placeNote({ text: text || '', notebook: false, lines: text ? [{ section: 'notebook', text: stripWrapper(text, v) }] : [] }, v);
}

function stripWrapper(text, v) {
    const tag = String(v['inject.wrapper_tag'] || '');
    return tag ? String(text).replace(new RegExp(`^<${tag}>\\n?|\\n?</${tag}>$`, 'g'), '') : String(text);
}

function setInreply(on) {
    const { v, mc } = conf();
    const text = on && v['core.mode'] === 'inreply' ? buildInreplyInstruction({ intimacy: v['intimacy.enabled'] }, mc.scribe) : '';
    ctx().setExtensionPrompt(INREPLY_KEY, text, PROMPT_TYPES.IN_CHAT, v['scribe.inreply_depth'], false, ROLE_OF[v['scribe.inreply_role']] ?? PROMPT_ROLES.SYSTEM);
}

function clearPrompts() {
    try {
        runtime.macros = {};
        ctx().setExtensionPrompt(PROMPT_KEY, '', PROMPT_TYPES.IN_CHAT, 1, false, PROMPT_ROLES.SYSTEM);
        setInreply(false);
        clearRulePrompts();
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
    const lenses = resolveLenses({
        persona: lensFromPreset(enabled, 'uc_narr_') || readVar('uc_persona_id') || 'none',
        tone: lensFromPreset(enabled, 'uc_tone_') || readVar('uc_tone_id') || 'grounded',
        genre: lensFromPreset(enabled, 'uc_genre_') || readVar('uc_genre_id') || 'none',
    });
    lenses.pronoun = pronounLine(lensFromPreset(enabled, 'uc_pron_') || readVar('uc_pron_id') || 'auto');
    return lenses;
}

// {{user}} pronoun rule from the preset's pronoun toggle (Auto = from the persona description, else they/them).
function pronounLine(id) {
    const list = Array.isArray(REGISTRY.pronouns) ? REGISTRY.pronouns : [];
    const hit = list.find(p => p.id === id) || list.find(p => p.id === 'auto');
    return hit ? String(hit.director || '') : '';
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

/** The slop list for the tic guard: the chosen model profile (or the active model's), plus your own bans. */
function slopList(v) {
    const choice = v['ticguard.slop_profile'];
    const profile = choice === 'auto' ? profileForModel(modelName()) : choice;
    const base = profile === 'none' ? [] : (SLOP[profile] || profile === 'common' ? slopListFor(profile) : slopListFor('common'));
    return mergeSlopList(base, v['ticguard.custom_bans'], v['ticguard.custom_slop']);
}

function cardInfo(v = K()) {
    const c = ctx();
    let f = {};
    try { f = c.getCharacterCardFields() || {}; } catch { f = {}; }
    return {
        name: c.name2,
        description: f.description || '',
        personality: f.personality || '',
        scenario: f.scenario || '',
        persona: f.persona || '',
        examples: (f.mesExamples || '').slice(0, v['context.examples_chars']),
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

function connectionProfiles() {
    try {
        const svc = ctx().ConnectionManagerRequestService;
        return svc ? svc.getSupportedProfiles().map(p => ({ id: p.id, name: p.name || p.id })) : [];
    } catch {
        return [];
    }
}

function profileAvailable(id) {
    return !!id && connectionProfiles().some(p => p.id === id);
}

/**
 * Extra note sections from further engines ({ <section id>: [string | {text, pri}] }). Goals and Chance-rule sparks
 * are added in intercept(); this hook is for anything else (a section id listed in inject.order is placed there).
 */
function extraSections(/* st, turn */) {
    return {};
}

// ---------------------------------------------------------------------------------------------------------------------
// Hidden passes

/**
 * Run one hidden generation with the extension's own compact prompt (never the RP preset).
 * Uses a Connection Manager profile when configured, otherwise generateRaw on the current connection.
 */
async function runHidden({ systemPrompt, messages, maxTokens, timeoutMs, label }) {
    const c = ctx();
    const v = K();
    const sub = (t) => { try { return c.substituteParams(String(t ?? '')); } catch { return String(t ?? ''); } };
    const sys = sub(systemPrompt);
    const msgs = messages.map(m => ({ role: m.role, content: sub(m.content) }));
    const tokens = Math.max(v['hidden.min_tokens'], Number(maxTokens) || v['hidden.max_tokens']);
    const ac = new AbortController();
    let p;
    const profileId = v['hidden.profile_id'];
    if (profileId && profileAvailable(profileId)) {
        dbg(`${label}: via connection profile`, profileId);
        p = c.ConnectionManagerRequestService.sendRequest(
            profileId,
            [{ role: 'system', content: sys }, ...msgs],
            tokens,
            { stream: false, signal: ac.signal, extractData: true, includePreset: !!v['hidden.include_preset'] },
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
    const { v, mc } = conf();
    if (!v['intimacy.enabled'] || !v['intimacy.seed'] || !charName || runtime.seeding.has(charName) || budgetMs < v['hidden.seed_min_budget_sec'] * 1000) return;
    let st = loadState();
    const key = findKeyCI(st.characters, charName) || charName;
    const intim = st.characters[key]?.intimacy;
    if (intim?.seeded || (intim?.seed_attempts ?? 0) >= v['intimacy.seed_max_attempts']) return;
    const card = cardInfo(v);
    if (!card.description && !card.personality) return;
    runtime.seeding.add(charName);
    const chatId = ctx().getCurrentChatId();
    let parsed = null;
    try {
        const { systemPrompt, messages } = buildSeedMessages({ ...card, name: charName }, mc.intimacy);
        const text = await runHidden({ systemPrompt, messages, maxTokens: Math.min(v['hidden.max_tokens'], v['hidden.seed_max_tokens']), timeoutMs: budgetMs, label: 'seed' });
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

async function runDirector({ state, turn, event, stall, nudge, lenses, timeoutMs, ruleHints = [], portLines = [] }) {
    const c = ctx();
    const { v, mc } = conf();
    const go = goalOpts(state);
    const goalsBlock = go.enabled ? directorBrief(state.goals, { turn, options: go }) : '';
    const { systemPrompt, messages } = buildDirectorMessages({
        goalsBlock,
        cardBlock: buildCardBlock(cardInfo(v), { userName: c.name1, charName: c.name2, ...mc.directorCard }),
        stateBlock: summarizeState(state, { turn, ...mc.summary }),
        transcript: buildTranscript(c.chat, { userName: c.name1, charName: c.name2, ...mc.directorTranscript }),
        signals: {
            turn,
            stall,
            stallTurns: v['ticguard.stall_turns'],
            event: event?.kind || null,
            also: event?.also || [],
            nudge,
            usedBeats: openItems(state.threads.used_beats, turn).map(b => b.text),
            ticNotes: state.tics.pending,
            lastPlan: state.director.plan,
            ruleHints,
            sceneMode: state.scene?.mode || '',
            extra: portLines, // native port engines' director lines (desire impulse, feelings, drama due, beat menu, vetoes…)
        },
        lenses: { ...lenses, beatFavor: beatFavor(lenses) },
        config: mc.director,
    });
    const text = await runHidden({ systemPrompt, messages, maxTokens: v['hidden.director_max_tokens'] || v['hidden.max_tokens'], timeoutMs, label: 'director' });
    const plan = normalizePlan(parseJsonSafe(text), { userName: c.name1, config: mc.director });
    if (!plan) throw new Error('director returned no usable plan');
    return plan;
}

/** Persist a fresh plan (and its off-screen threads/drivers/used beat) into a state copy. */
function storePlan(st, plan, { turn, key, event }) {
    const c = ctx();
    const { mc } = conf();
    st.director.plan = plan;
    st.director.plan_turn = turn;
    st.director.last_turn = turn;
    st.director.plan_key = key;
    const r = applyOps(st, planToThreadOps(plan), { turn, source: 'director', userName: c.name1 });
    const out = r.state;
    if (event && plan.event) out.events = recordEventContent(out.events, turn, plan.event, mc.events);
    return out;
}

/** Build the note for the current settings (and the macro values). */
function noteParts(args) {
    const { mc } = conf();
    return buildInjectionParts({ ...args, config: mc.inject, eventsConfig: mc.events });
}

function cadenceDue(v, sinceLast) {
    const cad = v['core.cadence'];
    return cad === 'every' || (cad === '2' && sinceLast >= 2) || (cad === '3' && sinceLast >= 3);
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
    let v = K();
    if (!v['core.enabled'] || isPaused(v) || !chatActive()) { clearPrompts(); return; }
    if (type === 'quiet') { clearPrompts(); return; }
    const c = ctx();
    const started = Date.now();
    const budget = Math.max(5, Number(v['hidden.timeout_sec']) || 45) * 1000;
    const remaining = () => budget - (Date.now() - started);

    let st = reconcileNow();
    const turn = countUserTurns(c.chat);
    const lastUser = lastUserMessage(c.chat);
    const userKey = lastUser ? hashText(lastUser.mes) : 'none';
    const recentText = `${lastUser?.mes || ''} ${previousAssistantReplies(c.chat, c.chat.length, 1).join(' ')}`;
    const ticLines = v['ticguard.enabled'] ? st.tics.pending : [];
    // Goals: lines for the note (and {{uc_goals}}); the word cap widens only when goal lines are present.
    const go = goalOpts(st);
    const goalLines = go.enabled ? injectionLines({ goals: st.goals, turn, options: go }) : [];
    const goalWords = goalLines.length ? go.note_extra_words : 0;
    const base = {
        state: st, turn, recentText, charName: c.name2, intimacyEnabled: v['intimacy.enabled'], ticLines,
        extra: { ...extraSections(st, turn), goals: goalLines }, maxWords: v['inject.max_words'] + goalWords,
    };

    if (type === 'impersonate') {
        // Impersonation writes for the player: world facts only — no beats, no NPC moves, no goals, no rules, no in-reply block.
        clearRulePrompts();
        if (v['inject.impersonate'] === 'none') clearPrompts();
        else placeNote(noteParts({ ...base, mode: 'impersonate' }), v);
        setInreply(false);
        return;
    }

    if (type === 'continue') {
        const how = v['inject.on_continue'];
        if (how === 'none') { clearPrompts(); return; }
        if (how === 'reuse' && st.director.last_injection && (v['inject.placement'] !== 'macros' || Object.keys(runtime.macros).length)) {
            if (v['inject.placement'] !== 'macros') setPrompt(st.director.last_injection, v);
        } else {
            placeNote(noteParts({ ...base, plan: st.director.plan, beatFresh: false }), v);
        }
        setInreply(true);
        return;
    }

    // Chance rules: once per generation (rerolls of the same turn start from rules_state.prev, so nothing double-counts).
    const ruleResult = runRules(st, { type, turn, lastUser });
    runtime.ruleResult = ruleResult;
    applyRulePrompts(ruleResult);
    saveState(st);
    const sparks = (ruleResult?.noteLines || []).map(text => ({ text, pri: ruleSparkPri() }));
    const ruleHints = ruleResult?.directorHints || [];
    base.extra = { ...base.extra, sparks };

    // Native port engines: once per generation (exactly-once per turn; rerolls restart from each engine's rt.prev).
    const card = cardInfo(v);
    const ports = portsTurn({
        state: st, turn, type, userMessage: lastUser?.mes || '', userName: c.name1, charName: c.name2,
        knobs: v, intimacyEnabled: v['intimacy.enabled'],
        cardTexts: c.name2 ? { [c.name2]: [card.description, card.personality].filter(Boolean).join('\n') } : {},
        stall: isStalled(st, turn, v['ticguard.stall_turns']), samey: !!runtime.lastTicFindings?.samey,
        rngFor: (name) => turnRng(c.getCurrentChatId(), turn, 200 + ['scene_intimacy', 'desire', 'reply_shape', 'drama'].indexOf(name)),
    });
    commitPortsRuntime(st, ports.rt);
    saveState(st);
    runtime.portMacros = ports.macros;
    base.extra = { ...base.extra, ...ports.extra };
    base.maxWords += ports.noteExtraWords;
    const portLines = ports.director;

    const isReroll = type === 'swipe' || type === 'regenerate';
    if (isReroll && v['core.reroll_reuse_plan']) {
        const cached = runtime.planCache.get(userKey)
            || (st.director.plan_key === userKey && st.director.plan_turn === turn
                ? { plan: st.director.plan, fresh: true, event: st.events.pending?.turn === turn ? st.events.pending : null, nudge: '' }
                : null);
        if (cached) {
            const parts = noteParts({ ...base, plan: cached.plan, beatFresh: cached.fresh, event: cached.event, nudge: cached.nudge, stall: isStalled(st, turn, v['ticguard.stall_turns']) });
            st.director.last_injection = parts.text;
            saveState(st);
            rememberPeek(parts, turn, { rules: ruleResult, event: cached.event });
            placeNote(parts, v);
            setInreply(true);
            dbg('reroll: reused cached plan', { type, turn });
            return;
        }
    }

    // Seed the current character's intimacy profile once per chat.
    if (v['intimacy.enabled'] && v['intimacy.seed'] && c.name2) {
        await ensureSeeded(c.name2, Math.min(remaining() * v['hidden.seed_budget_share'], v['hidden.seed_budget_max_sec'] * 1000));
    }

    // Let a still-running scribe pass land first (bounded), so the director sees the latest facts.
    if (runtime.pendingScribe && v['hidden.wait_for_scribe_sec'] > 0) {
        await Promise.race([runtime.pendingScribe.catch(() => null), sleep(Math.min(v['hidden.wait_for_scribe_sec'] * 1000, remaining() * v['hidden.wait_for_scribe_share']))]);
    }

    v = K();
    const { mc } = conf();
    st = loadState();
    const lenses = currentLenses();
    const stall = isStalled(st, turn, v['ticguard.stall_turns']);

    // Events: rolled once per new player turn (not on rerolls).
    let event = null;
    if (!isReroll) {
        const r = rollEvents({
            events: st.events, turn, rng: Math.random, drama: v['events.drama'], biases: lensBiases(lenses),
            sceneMode: st.scene.mode, stall, config: mc.events,
            enabled: { pulse: v['events.enable_pulse'], twist: v['events.enable_twist'], curiosity: v['events.enable_curiosity'] },
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
    const due = !preplanned && (cadenceDue(v, sinceLast) || stall || !!event || !!nudge || !st.director.plan || isReroll || ruleHints.length > 0);

    let plan = st.director.plan;
    let fresh = !!preplanned;
    if (due && v['core.pre_reply'] && remaining() > v['hidden.director_min_budget_sec'] * 1000) {
        try {
            plan = await runDirector({ state: st, turn, event, stall, nudge, lenses, timeoutMs: remaining(), ruleHints, portLines });
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
    // No fresh plan this turn: rule hints still reach the writer as low-priority sparks.
    if (!fresh && ruleHints.length) base.extra = { ...base.extra, sparks: [...sparks, ...ruleHints.map(text => ({ text, pri: ruleSparkPri() - 5 }))] };
    const parts = noteParts({
        ...base, state: st, plan, beatFresh: fresh, event, nudge, stall, ticLines: v['ticguard.enabled'] ? st.tics.pending : [],
    });
    st.director.last_injection = parts.text;
    saveState(st);
    rememberPeek(parts, turn, { rules: ruleResult, event });
    runtime.planCache.set(userKey, { plan, fresh, event, nudge, turn });
    while (runtime.planCache.size > v['core.plan_cache_size']) runtime.planCache.delete(runtime.planCache.keys().next().value);
    placeNote(parts, v);
    setInreply(true);
    dbg('injection', { type, turn, fresh, event: event?.kind, notebook: parts.notebook, placement: v['inject.placement'], words: parts.text.split(/\s+/).length }, parts.text);
}

// ---------------------------------------------------------------------------------------------------------------------
// Post-reply: in-reply block parsing / scribe pass / tic guard / ledger

function reconcileNow() {
    const c = ctx();
    const v = K();
    const st = loadState();
    const r = reconcile(st, chatKeys(c.chat), { userName: c.name1, intimacyEnabled: v['intimacy.enabled'] });
    const g = reconcileCompletions(r.state.goals, chatKeys(c.chat), { turn: countUserTurns(c.chat), options: goalOpts(r.state) });
    if (r.changed || g.changed) {
        saveState(r.state);
        dbg('reconciled ledger', { rolledBack: r.rolledBack, invalidated: r.invalidated.map(e => e.id) });
    }
    if (g.undone?.length) dbg('goal completions undone', g.undone);
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
        const v = K();
        if (!v['core.enabled'] || isPaused(v) || !chatActive()) return;
        if (['first_message', 'command', 'extension', 'impersonate'].includes(type)) return;
        await processAssistantMessage(Number(messageId), { type });
        goalsAfterReply(Number(messageId), type);
    } catch (e) {
        logError('MESSAGE_RECEIVED', e);
    }
}

async function processAssistantMessage(idx, { type = 'normal' } = {}) {
    const { v, mc } = conf();
    const c = ctx();
    const msg = c.chat[idx];
    if (!msg || msg.is_user || msg.is_system || typeof msg.mes !== 'string' || !msg.mes.trim()) return;
    const intimacy = v['intimacy.enabled'];

    let st = loadState();
    // In-reply block (always stripped, whatever the mode).
    let blockOps = null;
    if (/<!--\s*uc\b/i.test(msg.mes)) {
        const { found, json } = extractInreplyBlock(msg.mes);
        const changed = stripMessage(idx, msg);
        if (found && v['core.mode'] === 'inreply') {
            const n = normalizeOps(json, { userName: c.name1, intimacy, config: mc.scribe });
            blockOps = n.ops;
            if (n.rejected.length) dbg('in-reply ops rejected', n.rejected);
        }
        if (changed) await c.saveChat();
    }
    const key = messageKey(msg, idx);
    if (type === 'continue') st = rekeyEntry(st, idx, key.swipe_id, key.text_hash);
    st = reconcile(st, chatKeys(c.chat), { userName: c.name1, intimacyEnabled: intimacy }).state;
    if (findEntry(st, key) && type !== 'continue' && !blockOps) { saveState(st); return; } // already processed

    const turn = countUserTurns(c.chat);
    const userMsg = userMessageBefore(c.chat, idx);
    const reply = cleanAssistantText(msg.mes);
    const sourceText = `${reply}\n${userMsg}`;
    const r = commitEntry(st, key, blockOps || [], {
        turn, userName: c.name1, sourceText, intimacyEnabled: intimacy, source: blockOps ? 'inreply' : 'scribe', now: Date.now(),
    });
    st = r.state;
    if (r.rejected.length) dbg('ops rejected', r.rejected);
    if (blockOps) dbg('in-reply ops applied', r.applied);

    if (v['ticguard.enabled'] && type !== 'continue' && type !== 'edit') {
        const a = analyzeReply({
            reply,
            previous: previousAssistantReplies(c.chat, idx, v['ticguard.window']),
            userMessage: userMsg,
            slopList: slopList(v),
            tics: st.tics,
            config: mc.ticguard,
        });
        st.tics = a.tics;
        runtime.lastTicFindings = a.findings;
        dbg('tic guard', a.findings, a.tics.pending);
    }
    if (type !== 'continue' && type !== 'edit') {
        // Native port engines: code-side observations of this reply, ledgered with it (rolled back with it).
        const obs = portObservationOps({
            state: st, reply, previous: previousAssistantReplies(c.chat, idx, 1)[0] || '', userMessage: userMsg,
            userName: c.name1, ticFindings: runtime.lastTicFindings, stall: isStalled(st, turn, v['ticguard.stall_turns']),
            ticguardOn: v['ticguard.enabled'], turn, knobs: v, intimacyEnabled: intimacy,
        });
        if (obs.ops.length) st = appendToEntry(st, r.entry.id, obs.ops, { userName: c.name1, sourceText, trusted: true, source: 'ports' }).state;
        runtime.criticFindings = obs.findings;
    }
    st.director.last_injection = '';
    saveState(st);

    const mode = v['core.mode'];
    const needScribe = mode === 'separate' || (mode === 'inreply' && !blockOps);
    const chatId = c.getCurrentChatId();
    if (needScribe) {
        // Non-blocking: schedule and return so the event chain is not held up.
        const job = runScribe({ chatId, entryId: r.entry.id, idx, turn, userMsg, reply })
            .then(() => runPortPasses({ chatId, entryId: r.entry.id, turn, userMsg, reply }))
            .then(() => { if (!K()['core.pre_reply']) return runDirectorAhead({ chatId, turn }); })
            .catch(e => logError('scribe', e))
            .finally(() => { if (runtime.pendingScribe === job) runtime.pendingScribe = null; });
        runtime.pendingScribe = job;
    } else {
        runPortPasses({ chatId, entryId: r.entry.id, turn, userMsg, reply })
            .then(() => { if (!K()['core.pre_reply']) return runDirectorAhead({ chatId, turn }); })
            .catch(e => logError('port passes', e));
    }
}

/** Optional hidden passes of the port engines (critic: off by default; scout: when the beat menu runs low). Non-blocking. */
async function runPortPasses({ chatId, entryId, turn, userMsg, reply }) {
    const { v, mc } = conf();
    if (v['ports.enabled'] === false) return;
    const c = ctx();
    let st = loadState();
    if (criticDue({ state: st, turn, findings: runtime.criticFindings || [], options: v })) {
        const m = buildCriticMessages({ reply, userMessage: userMsg, findings: runtime.criticFindings || [], options: v });
        try {
            const text = await runHidden({ systemPrompt: m.systemPrompt, messages: m.messages, maxTokens: m.responseLength, timeoutMs: v['hidden.timeout_sec'] * 1000, label: 'critic' });
            if (ctx().getCurrentChatId() !== chatId) return;
            const lines = parseCriticResult(text, { userName: c.name1, options: v });
            const r = appendToEntry(loadState(), entryId, [{ op: 'set', path: 'critic.corrections', value: { lines } }], { trusted: true, source: 'ports', userName: c.name1 });
            if (r.entry) saveState(r.state);
            noteSuccess();
        } catch (e) { noteFailure('critic', e); }
    }
    st = loadState();
    if (scoutDue({ state: st, turn, options: v })) {
        const m = buildScoutMessages({
            state: st, options: v,
            cardBlock: buildCardBlock(cardInfo(v), { userName: c.name1, charName: c.name2, ...mc.directorCard }),
            stateBlock: summarizeState(st, { turn, ...mc.summary }),
            transcript: buildTranscript(c.chat, { userName: c.name1, charName: c.name2, ...mc.directorTranscript }),
        });
        try {
            const text = await runHidden({ systemPrompt: m.systemPrompt, messages: m.messages, maxTokens: m.responseLength, timeoutMs: v['hidden.timeout_sec'] * 1000, label: 'scout' });
            if (ctx().getCurrentChatId() !== chatId) return;
            const ops = parseScoutResult(text, { userName: c.name1, options: v });
            const r = appendToEntry(loadState(), entryId, ops, { trusted: true, source: 'ports', userName: c.name1 });
            if (r.entry) saveState(r.state);
            noteSuccess();
        } catch (e) { noteFailure('scout', e); }
    }
}

async function runScribe({ chatId, entryId, idx, turn, userMsg, reply }) {
    const { v, mc } = conf();
    const c = ctx();
    const st0 = loadState();
    const intimacy = v['intimacy.enabled'];
    const { systemPrompt, messages } = buildScribeMessages({
        cardBlock: buildCardBlock(cardInfo(v), { userName: c.name1, charName: c.name2, ...mc.scribeCard }),
        stateBlock: summarizeState(st0, { turn, ...mc.summary }),
        transcript: buildTranscript(c.chat, { userName: c.name1, charName: c.name2, uptoIndex: idx - 2, ...mc.scribeTranscript }),
        userMessage: markPrivateThoughts(userMsg),
        reply,
        intimacy,
        pronoun: currentLenses().pronoun,
        config: mc.scribe,
    });
    let text;
    try {
        text = await runHidden({ systemPrompt, messages, maxTokens: v['hidden.scribe_max_tokens'] || v['hidden.max_tokens'], timeoutMs: v['hidden.timeout_sec'] * 1000, label: 'scribe' });
    } catch (e) {
        noteFailure('scribe', e);
        return;
    }
    if (ctx().getCurrentChatId() !== chatId) return;
    const parsed = parseJsonSafe(text, { prefer: 'any' });
    if (parsed === null) { noteFailure('scribe', new Error('unparseable output')); return; }
    noteSuccess();
    const { ops, rejected } = normalizeOps(parsed, { userName: c.name1, intimacy, config: mc.scribe });
    const r = appendToEntry(loadState(), entryId, ops, {
        userName: c.name1, sourceText: `${reply}\n${userMsg}`, intimacyEnabled: intimacy, source: 'scribe',
    });
    if (!r.entry) { dbg('scribe result discarded: message changed meanwhile'); return; }
    saveState(r.state);
    renderPeek(idx);
    dbg('scribe applied', r.applied, 'rejected', [...rejected, ...r.rejected]);
}

/** Pre-reply director off: plan the next turn in the background right after a reply. */
async function runDirectorAhead({ chatId, turn }) {
    const v = K();
    if (v['core.pre_reply'] || !v['core.enabled'] || isPaused(v)) return;
    let st = loadState();
    const next = turn + 1;
    const sinceLast = next - st.director.last_turn;
    const stall = isStalled(st, next, v['ticguard.stall_turns']);
    const due = cadenceDue(v, sinceLast) || stall || !!st.director.nudge || !st.director.plan;
    if (!due) return;
    try {
        const plan = await runDirector({ state: st, turn: next, event: null, stall, nudge: st.director.nudge, lenses: currentLenses(), timeoutMs: v['hidden.timeout_sec'] * 1000 });
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
        const v = K();
        let st = loadState();
        const r = reconcile(st, chatKeys(c.chat), { userName: c.name1, intimacyEnabled: v['intimacy.enabled'] });
        st = r.state;
        let changed = r.changed;
        const g = reconcileCompletions(st.goals, chatKeys(c.chat), { turn: countUserTurns(c.chat), options: goalOpts(st) });
        if (g.changed) changed = true;
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
        if (kind === 'edited' && v['core.enabled'] && !isPaused(v)) {
            const idx = Number(arg);
            const msg = c.chat[idx];
            const isLastAssistant = msg && !msg.is_user && !msg.is_system && !c.chat.slice(idx + 1).some(m => !m.is_user && !m.is_system);
            if (isLastAssistant && !findEntry(st, messageKey(msg, idx))) {
                processAssistantMessage(idx, { type: 'edit' }).catch(e => logError('re-scribe after edit', e));
            }
        }
        refreshGoalsPanel();
        if (kind === 'swiped' || kind === 'edited') renderPeek(Number(arg));
    } catch (e) {
        logError(`chat mutation (${kind})`, e);
    }
}

function onChatChanged() {
    runtime.planCache.clear();
    runtime.pendingScribe = null;
    runtime.ruleResult = null;
    runtime.peekByTurn.clear();
    clearPrompts();
    try {
        if (chatActive()) reconcileNow();
    } catch (e) {
        logError('CHAT_CHANGED', e);
    }
    refreshGoalsPanel();
    try { runtime.rulesPanel?.refresh?.(); } catch { /* not mounted */ }
    refreshEssentials();
}

// ---------------------------------------------------------------------------------------------------------------------
// Goals: counting, completion checks, task generation

function goalsAfterReply(idx, type) {
    try {
        const st = loadState();
        const go = goalOpts(st);
        if (!go.enabled) return;
        const { due } = tickGoals(st.goals, { turn: countUserTurns(ctx().chat), type, options: go });
        saveState(st);
        refreshGoalsPanel();
        if (due) runGoalCheck({}).catch(e => logError('goal check', e)); // non-blocking, like the scribe
    } catch (e) {
        logError('goals tick', e);
    }
}

async function runGoalCheck({ goalId = null, manual = false } = {}) {
    if (runtime.goalCheck) return runtime.goalCheck;
    const job = (async () => {
        const c = ctx();
        const v = K();
        const chatId = c.getCurrentChatId();
        let st = loadState();
        const go = goalOpts(st);
        const turn = countUserTurns(c.chat);
        stampCurrent(st.goals, turn);
        const items = checkTargets(st.goals, turn, { goalId });
        if (!items.length) { if (manual) toastr.info('No task is ready to check (none open, or a minimum duration is still running).', 'Undercurrent'); return; }
        const n = go.check_transcript_messages;
        const transcript = buildTranscript(c.chat, { userName: c.name1, charName: c.name2, max: n });
        const sources = c.chat.map((m, i) => ({ m, i })).filter(x => x.m && !x.m.is_system && x.m.mes).slice(-n)
            .map(x => ({ index: x.i, text: x.m.is_user ? String(x.m.mes) : cleanAssistantText(x.m.mes) }));
        const { systemPrompt, messages } = buildCheckMessages({ items, transcript, options: go });
        runtime.goalBusy.check = true;
        refreshGoalsPanel();
        let text;
        try {
            text = await runHidden({ systemPrompt, messages, maxTokens: go.check_max_tokens, timeoutMs: v['hidden.timeout_sec'] * 1000, label: 'goal-check' });
            noteSuccess();
        } catch (e) { noteFailure('goal check', e); return; }
        if (ctx().getCurrentChatId() !== chatId) return;
        st = loadState(); // re-read: the scribe may have saved meanwhile
        const r = parseCheck(text, { items, transcript, turn, sources, options: go });
        const done = applyCheckResults(st.goals, r.accepted, { turn, keys: chatKeys(c.chat), options: go });
        resetCheckCounter(st.goals);
        if (done.length) st.director.last_injection = '';
        saveState(st);
        dbg('goal check', { accepted: r.accepted, rejected: r.rejected });
        // Silent by default (no visible trackers); display.toasts = all announces completions.
        if (K()['display.toasts'] === 'all' || manual) {
            for (const t of done) {
                const g = st.goals.items.find(x => findTask({ items: [x] }, t.id));
                toastr.success(g?.hidden ? 'A hidden goal moved forward.' : `Done: ${t.text}`, 'Undercurrent · Goals');
            }
        }
        renderAllPeeks();
        if (manual && !done.length) toastr.info('Nothing has clearly happened yet.', 'Undercurrent · Goals');
    })().finally(() => { runtime.goalCheck = null; runtime.goalBusy.check = false; refreshGoalsPanel(); });
    runtime.goalCheck = job;
    return job;
}

async function runTaskGen(goalId, more = false, { branchTaskId = null, count } = {}) {
    const c = ctx();
    const { v, mc } = conf();
    const chatId = c.getCurrentChatId();
    let st = loadState();
    const go = goalOpts(st);
    const goal = getGoal(st.goals, goalId);
    if (!goal) return;
    const turn = countUserTurns(c.chat);
    const branch = branchTaskId ? findTask(st.goals, branchTaskId)?.task || null : null;
    const { systemPrompt, messages } = buildTaskGenMessages({
        goal, branch, more, count, options: go,
        cardBlock: buildCardBlock(cardInfo(v), { userName: c.name1, charName: c.name2, ...mc.directorCard }), // card + persona, runtime only
        stateBlock: summarizeState(st, { turn, ...mc.summary }),
        transcript: buildTranscript(c.chat, { userName: c.name1, charName: c.name2, max: go.taskgen_transcript_messages }),
    });
    runtime.goalBusy.gen = goalId;
    refreshGoalsPanel();
    let text;
    try {
        text = await runHidden({ systemPrompt, messages, maxTokens: go.taskgen_max_tokens, timeoutMs: v['hidden.timeout_sec'] * 1000, label: 'goal-tasks' });
        noteSuccess();
    } catch (e) {
        noteFailure('task generation', e);
        toastr.warning('Task generation failed; try again.', 'Undercurrent');
        return;
    } finally {
        runtime.goalBusy.gen = null;
        refreshGoalsPanel();
    }
    if (ctx().getCurrentChatId() !== chatId) return;
    st = loadState();
    const { kept, dropped } = tasksFromOutput(text, { userName: c.name1, options: go });
    if (!getGoal(st.goals, goalId)) return;
    if (!more && !branch) clearOpenTasks(st.goals, goalId, { turn }); // "Regenerate" keeps completed work
    const r = addTasks(st.goals, goalId, kept, { turn, parentId: branch?.id, options: go });
    st.director.last_injection = '';
    saveState(st);
    refreshGoalsPanel();
    dbg('task generation', { added: r.added.map(t => t.text), skipped: r.skipped, dropped });
    const nLong = dropped.filter(d => /^too detailed/.test(d.reason)).length;
    const nUser = dropped.length - nLong;
    toastr.info(`${r.added.length} task(s) added${nUser ? `, ${nUser} dropped for scripting the player` : ''}${nLong ? `, ${nLong} dropped as too detailed` : ''}.`, 'Undercurrent · Goals');
}

const goalsApi = {
    getState: () => {
        const st = loadState();
        return { goals: st.goals, turn: countUserTurns(ctx().chat || []), owners: goalOwners(st), userName: ctx().name1, options: goalOpts(st), busy: runtime.goalBusy, canExport: true, canImport: true };
    },
    mutate: (fn) => { if (!chatActive()) return; const st = loadState(); fn(st.goals); st.director.last_injection = ''; saveState(st); },
    generateTasks: (goalId, more, o = {}) => runTaskGen(goalId, more, o),
    checkNow: goalId => runGoalCheck({ goalId: goalId || null, manual: true }),
    importSO: async () => {
        const c = ctx();
        const st = loadState();
        const r = importGoals(st.goals, c.chatMetadata?.objective, { turn: countUserTurns(c.chat), userName: c.name1, options: goalOpts(st) });
        if (!r.ok || !r.added.length) { toastr.info(r.errors?.[0] || r.warnings?.[0] || 'No Objective tasks found in this chat.', 'Undercurrent'); return; }
        saveState(st);
        toastr.success(`Imported ${r.added.length} goal(s) from Objective.`, 'Undercurrent');
    },
    exportJson: async () => { await saveTextFile(`undercurrent-goals-${String(ctx().getCurrentChatId() || 'chat').replace(/[^\w.-]+/g, '-')}.json`, exportGoals(loadState().goals)); },
    importJson: async () => {
        const c = ctx();
        const text = await c.callGenericPopup('Paste goals JSON (an Undercurrent export or Objective data).', c.POPUP_TYPE.INPUT, '', { rows: 12, wide: true });
        if (!text) return;
        const st = loadState();
        const r = importGoals(st.goals, String(text), { turn: countUserTurns(c.chat), userName: c.name1, options: goalOpts(st) });
        if (!r.ok) { toastr.error(r.errors.join(' '), 'Undercurrent'); return; }
        saveState(st);
    },
    confirm: async (msg) => { const c = ctx(); return (await c.callGenericPopup(msg, c.POPUP_TYPE.CONFIRM)) === c.POPUP_RESULT.AFFIRMATIVE; },
    notify: (msg, kind = 'info') => (toastr[kind] || toastr.info)(msg, 'Undercurrent'),
    onPanelMounted: (p) => { runtime.goalsPopupPanel = p; },
};

// ---------------------------------------------------------------------------------------------------------------------
// Chance rules panel API

function rulesApi() {
    const c = () => ctx();
    return {
        getState: () => ({ settings: rulesSettings(), options: ruleOptions(chatActive() ? loadState() : null), starterPacks: STARTER_PACKS }),
        mutate: (fn) => { fn(rulesSettings()); c().saveSettingsDebounced(); },
        importFile: (text, fileName) => {
            const st = chatActive() ? loadState() : createState();
            const report = importIntoSettings(rulesSettings(), text, {
                knownNames: knownNames(st), userName: c().name1, fileName, options: ruleOptions(st), starterPacks: STARTER_PACKS,
            });
            c().saveSettingsDebounced();
            // Imported packs are on by default (their own default_enabled); always show the report.
            const cc = c();
            Promise.resolve(cc.callGenericPopup(`<div class="uc-rules">${renderReport(report)}</div>`, cc.POPUP_TYPE.TEXT, '', { wide: true, allowVerticalScrolling: true, leftAlign: true }))
                .catch(e => logError('import report', e));
            return report;
        },
        exportPack: (id) => {
            const text = packJson(rulesSettings(), id, { options: ruleOptions(chatActive() ? loadState() : null) });
            if (text) return saveTextFile(`${id}.json`, text);
            return undefined;
        },
        testRoll: () => {
            if (!chatActive()) return { skipped: true, trace: [{ id: '*', reason: 'open a chat first' }] };
            const st = loadState();
            const c0 = c();
            return runRules(st, { type: 'normal', turn: countUserTurns(c0.chat), lastUser: lastUserMessage(c0.chat), commit: false });
        },
        notify: (msg, kind = 'info') => toastr[kind]?.(msg, 'Undercurrent'),
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// "Behind the scenes" peek (display.peek = collapsed): a closed <details> under each assistant reply, DOM only.
// Never written into chat[].mes or swipes, never saved, never sent to the model (prompts are built from chat[].mes).

function rememberPeek(parts, turn, { rules = null, event = null } = {}) {
    try {
        const fired = (rules?.fired || []).map(f => f.name || f.rule || f.id).filter(Boolean);
        runtime.peekByTurn.set(turn, peekRecord(parts, { turn, rules: fired, event }));
        while (runtime.peekByTurn.size > 200) runtime.peekByTurn.delete(runtime.peekByTurn.keys().next().value);
    } catch (e) {
        logError('peek record', e);
    }
}

function peekOn() {
    try { return K()['display.peek'] === 'collapsed' && chatActive(); } catch { return false; }
}

function removeAllPeeks() {
    try { for (const el of document.querySelectorAll(`#chat .${PEEK_CLASS}`)) el.remove(); } catch { /* no DOM */ }
}

/** Build (or remove) the peek under one assistant message. */
function renderPeek(idx) {
    try {
        const mesEl = document.querySelector(`#chat .mes[mesid="${Number(idx)}"]`);
        if (!mesEl) return;
        for (const el of mesEl.querySelectorAll(`.${PEEK_CLASS}`)) el.remove();
        if (!peekOn()) return;
        const c = ctx();
        const msg = c.chat[Number(idx)];
        if (!msg || msg.is_user || msg.is_system) return;
        const st = loadState();
        const turn = countUserTurns(c.chat.slice(0, Number(idx)));
        const latest = !c.chat.slice(Number(idx) + 1).some(m => m && !m.is_user && !m.is_system);
        const entry = findEntry(st, messageKey(msg, Number(idx)));
        const html = renderPeekHtml(peekSections({ record: runtime.peekByTurn.get(turn) || null, state: st, turn, entry, latest }));
        if (!html) return;
        const textEl = mesEl.querySelector('.mes_text');
        if (textEl) textEl.insertAdjacentHTML('afterend', html); // a sibling of the message text, never inside it
    } catch (e) {
        logError('peek', e);
    }
}

function renderAllPeeks() {
    if (!peekOn()) { removeAllPeeks(); return; }
    try {
        const c = ctx();
        c.chat.forEach((m, i) => { if (m && !m.is_user && !m.is_system) renderPeek(i); });
    } catch (e) {
        logError('peeks', e);
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Knob API (settings UI + slash commands)

/** Set a knob globally or for the current chat. Returns {ok, value, reason, clamped, chat}. */
function setKnob(key, raw, { chat = false } = {}) {
    const knob = getKnob(key);
    if (!knob) return { ok: false, reason: `unknown setting "${key}"` };
    const goalChat = key.startsWith(GOAL_PREFIX) && CHAT_KNOBS.includes(key.slice(GOAL_PREFIX.length));
    // Chat-scope goals knobs: per chat when a chat is open (stored in state.goals.settings), else the global default.
    const toChat = chat || (knob.scope === 'chat' && (!goalChat || chatActive()));
    if (toChat && goalChat) {
        if (!chatActive()) return { ok: false, reason: 'open a chat first' };
        const cv = coerce(knob, raw);
        if (!cv.ok) return { ok: false, reason: cv.reason };
        const st = loadState();
        const stored = setGoalChatSetting(st.goals, key, cv.value);
        saveState(st);
        afterKnobChange(key);
        refreshGoalsPanel();
        return { ok: true, value: stored, clamped: !!cv.clamped, chat: true };
    }
    if (toChat) {
        if (!chatActive()) return { ok: false, reason: 'open a chat first (this is a per-chat setting)' };
        const c = ctx();
        const st = normalizeState(c.chatMetadata[MODULE]);
        const r = setValue(st.knob_overrides, key, raw, { isOverride: true });
        if (!r.ok) return r;
        st.knob_overrides = r.store;
        c.chatMetadata[MODULE] = st;
        c.saveMetadataDebounced();
        afterKnobChange(key);
        return { ...r, chat: true };
    }
    const s = settings();
    const r = setValue(s.knobs, key, raw);
    if (!r.ok) return r;
    s.knobs = r.store;
    ctx().saveSettingsDebounced();
    afterKnobChange(key);
    return { ...r, chat: false };
}

function resetKnob(key) {
    const s = settings();
    s.knobs = resetKeys(s.knobs, [key]);
    ctx().saveSettingsDebounced();
    if (chatActive() && Object.hasOwn(chatOverrides(), key)) setChatOverride(key, false);
    resetGoalChatKnobs([key]);
    afterKnobChange(key);
}

/** Chat-scope goals knobs among `keys` go back to the global value in this chat's goals.settings. */
function resetGoalChatKnobs(keys) {
    if (!chatActive()) return;
    const names = keys.filter(k => k.startsWith(GOAL_PREFIX) && CHAT_KNOBS.includes(k.slice(GOAL_PREFIX.length)));
    if (!names.length) return;
    const st = loadState();
    const global = resolveGoalOptions(globalGoalValues(true));
    for (const k of names) setGoalChatSetting(st.goals, k, global[k.slice(GOAL_PREFIX.length)]);
    saveState(st);
    refreshGoalsPanel();
}

/** Start (copy the effective value into the chat) or stop overriding a knob for this chat. */
function setChatOverride(key, on) {
    if (!chatActive()) return;
    const c = ctx();
    const st = normalizeState(c.chatMetadata[MODULE]);
    if (on) {
        const v = K();
        st.knob_overrides = { ...st.knob_overrides, [key]: v[key] };
    } else {
        st.knob_overrides = resetKeys(st.knob_overrides, [key]);
    }
    c.chatMetadata[MODULE] = st;
    c.saveMetadataDebounced();
    afterKnobChange(key);
}

function afterKnobChange(key) {
    try {
        const v = K();
        if (key === 'core.enabled' && !v['core.enabled']) clearPrompts();
        if ((key === 'core.paused' || key === 'core.chat_paused') && isPaused(v)) clearPrompts();
        if (key === 'core.mode' && v['core.mode'] !== 'inreply') setInreply(false);
        if (key === 'inject.placement') clearPrompts();
        if (key === 'display.peek' || key === 'profile' || key === 'reset-all' || String(key).startsWith('group:')) renderAllPeeks();
    } catch (e) {
        logError('afterKnobChange', e);
    }
    refreshEssentials();
}

function profileValues(name) {
    const b = findBuiltinProfile(name);
    if (b) return b.values;
    const u = settings().user_profiles[name];
    return u && typeof u === 'object' ? (u.values || {}) : null;
}

function loadProfile(name) {
    const values = profileValues(name);
    if (!values) return `No profile named "${name}".`;
    const s = settings();
    s.knobs = applyProfile(s.knobs, values);
    s.profile = findBuiltinProfile(name)?.name || name;
    ctx().saveSettingsDebounced();
    afterKnobChange('profile');
    return `Profile "${s.profile}" loaded.`;
}

function saveProfile(name) {
    const clean = String(name).trim().slice(0, 80);
    if (!clean) return 'Type a name first.';
    if (findBuiltinProfile(clean)) return `"${clean}" is a built-in profile; pick another name.`;
    const s = settings();
    s.user_profiles = { ...s.user_profiles, [clean]: exportProfile(clean, profileRelevant(s.knobs)) };
    s.profile = clean;
    ctx().saveSettingsDebounced();
    refreshEssentials();
    return `Saved the current settings as "${clean}".`;
}

function deleteProfile(name) {
    if (findBuiltinProfile(name)) return 'Built-in profiles cannot be deleted.';
    const s = settings();
    if (!s.user_profiles[name]) return `No saved profile named "${name}".`;
    const next = { ...s.user_profiles };
    delete next[name];
    s.user_profiles = next;
    if (s.profile === name) s.profile = 'Balanced';
    ctx().saveSettingsDebounced();
    refreshEssentials();
    return `Deleted "${name}".`;
}

/** Global values minus keepOnProfile knobs (what a profile carries). */
function profileRelevant(store) {
    return Object.fromEntries(Object.entries(store || {}).filter(([k]) => !getKnob(k)?.keepOnProfile));
}

function profileModified() {
    const s = settings();
    const values = profileValues(s.profile);
    return values ? !matchesProfile(s.knobs, values) : true;
}

function importProfileText(text) {
    const r = importProfile(text);
    if (!r.ok) return `Import failed: ${r.errors.join(' ')}`;
    const s = settings();
    let name = r.name;
    if (findBuiltinProfile(name)) name = `${name} (imported)`;
    s.user_profiles = { ...s.user_profiles, [name]: { format: 'undercurrent-settings', version: 1, name, values: r.values } };
    ctx().saveSettingsDebounced();
    const msg = loadProfile(name);
    const notes = [r.errors.length ? `${r.errors.length} invalid value(s) skipped` : '', r.unknown.length ? `${r.unknown.length} setting(s) for engines not loaded were kept` : ''].filter(Boolean);
    return `${msg}${notes.length ? ` (${notes.join('; ')})` : ''}`;
}

function resetAllKnobs() {
    const s = settings();
    s.knobs = Object.fromEntries(Object.entries(s.knobs).filter(([k]) => getKnob(k)?.keepOnProfile));
    s.profile = 'Balanced';
    ctx().saveSettingsDebounced();
    if (chatActive()) {
        const c = ctx();
        const st = normalizeState(c.chatMetadata[MODULE]);
        st.knob_overrides = {};
        c.chatMetadata[MODULE] = st;
        c.saveMetadataDebounced();
    }
    afterKnobChange('reset-all');
}

function resetGroup(group) {
    const keys = allKnobs().filter(k => k.group === group).map(k => k.key);
    const s = settings();
    s.knobs = resetKeys(s.knobs, keys);
    ctx().saveSettingsDebounced();
    if (chatActive()) {
        const c = ctx();
        const st = normalizeState(c.chatMetadata[MODULE]);
        st.knob_overrides = resetKeys(st.knob_overrides, keys);
        c.chatMetadata[MODULE] = st;
        c.saveMetadataDebounced();
    }
    resetGoalChatKnobs(keys);
    afterKnobChange(`group:${group}`);
}

function panelContext() {
    const s = settings();
    return {
        values: K(),
        overrides: chatOverrides(),
        chatAvailable: chatActive(),
        connectionProfiles: connectionProfiles(),
        profiles: { builtin: BUILTIN_PROFILES.map(p => ({ name: p.name, description: p.description })), user: Object.keys(s.user_profiles) },
        currentProfile: s.profile,
        profileModified: profileModified(),
    };
}

const knobApi = {
    context: panelContext,
    set: (key, raw, opts) => setKnob(key, raw, opts),
    reset: resetKnob,
    setChatOverride,
    resetGroup,
    resetAll: resetAllKnobs,
    loadProfile,
    saveProfile,
    deleteProfile,
    exportProfile: () => {
        const s = settings();
        const p = exportProfile(s.profile || 'Undercurrent settings', profileRelevant(s.knobs));
        const slug = (p.name || 'settings').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'settings';
        return { filename: `undercurrent-${slug}.json`, text: JSON.stringify(p, null, 2) };
    },
    download: (filename, text) => saveTextFile(filename, text),
    importProfile: importProfileText,
};

async function openKnobsPopup() {
    const c = ctx();
    const html = renderPanel({ ...panelContext(), open: new Set() });
    const popup = new c.Popup(html, c.POPUP_TYPE.TEXT, null, {
        okButton: 'Close',
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        leftAlign: true,
        onOpen: (p) => {
            try { bindPanel(p.content.querySelector('.uc-knobs-panel'), knobApi); } catch (e) { logError('knobs panel', e); }
        },
    });
    await popup.show();
    refreshEssentials();
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
            // The inspector is the one place where knob overrides may be edited as JSON.
            c.chatMetadata[MODULE] = { ...(c.chatMetadata[MODULE] || {}), knob_overrides: r.state.knob_overrides };
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
        const ok = await c.callGenericPopup('Clear all Undercurrent state for this chat? Facts, character minds, intimacy profiles, threads and history will be forgotten. The chat itself and this chat\'s setting overrides are not changed.', c.POPUP_TYPE.CONFIRM);
        if (ok !== c.POPUP_RESULT.AFFIRMATIVE) return false;
    }
    runtime.planCache.clear();
    saveState(createState()); // saveState keeps the live knob_overrides
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
    await ensureSeeded(c.name2, K()['hidden.timeout_sec'] * 1000);
    const after = loadState().characters[key]?.intimacy;
    if (after?.seeded) toastr.success(`Profile seeded: ${after.preferences.length} preferences, ${after.limits.length} limits.`, 'Undercurrent');
    else toastr.warning('Could not read the card this time.', 'Undercurrent');
}

// ---------------------------------------------------------------------------------------------------------------------
// Macros ({{uc_note}}, {{uc_beat}}, …): filled by the interceptor in placement "macros", empty otherwise.

const MACRO_HELP = {
    uc_note: 'Undercurrent: the whole note (placement "macros" only).',
    uc_beat: 'Undercurrent: this turn\'s direction (the notebook, or beat / event / NPC moves / avoid lines).',
    uc_minds: 'Undercurrent: what each character present wants, plans and does not know.',
    uc_intimacy: 'Undercurrent: intimacy lines (limits, likes, phase) when relevant.',
    uc_facts: 'Undercurrent: the most relevant established facts.',
    uc_scene: 'Undercurrent: clock, place, weather and who is here.',
    uc_tics: 'Undercurrent: tic-guard corrections.',
    uc_goals: 'Undercurrent: goal lines (Goals engine).',
    uc_sparks: 'Undercurrent: spark lines (Sparks engine).',
};

// Each macro wraps its own non-empty content in the note tag, so a preset block made only of macros sends nothing
// at all when every piece is empty (no stray empty wrapper).
function wrapMacro(value) {
    const v = String(value ?? '').trim();
    if (!v) return '';
    const tag = String(K()['inject.wrapper_tag'] ?? 'undercurrent').replace(/[^A-Za-z0-9_-]/g, '');
    if (!tag) return v; // knob set to empty = no wrapper
    return v.startsWith(`<${tag}>`) ? v : `<${tag}>\n${v}\n</${tag}>`;
}

function macroValue(name) {
    try {
        if (K()['inject.placement'] !== 'macros') return '';
        return wrapMacro(runtime.macros?.[name]);
    } catch {
        return '';
    }
}

const PORT_MACRO_HELP = {
    uc_scene_intimacy: 'Undercurrent: intimate-scene continuity (phase, clothing, limits, pacing, craft lines).',
    uc_desire: 'Undercurrent: this turn\'s desire impulse, if any.',
    uc_psyche: 'Undercurrent: feelings, lasting memories, defenses and insights of the characters present.',
    uc_reply_shape: 'Undercurrent: length hint, repeat vetoes, spark.',
    uc_critic: 'Undercurrent: corrections for this reply.',
    uc_drama: 'Undercurrent: drama due, beat menu, open questions, ask topics.',
};

function registerMacros() {
    const c = ctx();
    // Port macros follow the same rule as the others: filled only in placement "macros" (in note placement their lines
    // are already inside the note, so a preset block using them would duplicate them).
    const portNames = Object.keys(PORT_MACROS);
    for (const name of [...MACRO_NAMES, ...portNames]) {
        const handler = portNames.includes(name)
            ? () => { try { return K()['inject.placement'] === 'macros' ? wrapMacro(runtime.portMacros?.[name]) : ''; } catch { return ''; } }
            : () => macroValue(name);
        if (portNames.includes(name)) MACRO_HELP[name] = PORT_MACRO_HELP[name];
        try {
            if (c.macros?.register) c.macros.register(name, { category: 'Undercurrent', description: MACRO_HELP[name] || 'Undercurrent', handler });
            // Legacy macro engine (power_user.experimental_macro_engine off): register there too.
            if (!c.powerUserSettings?.experimental_macro_engine && typeof c.registerMacro === 'function') c.registerMacro(name, handler, MACRO_HELP[name] || '');
        } catch (e) {
            logError(`register macro {{${name}}}`, e);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Slash commands (SlashCommandParser.addCommandObject + SlashCommand.fromProps)

function fmt(v) {
    return typeof v === 'string' ? v : JSON.stringify(v);
}

function registerCommands() {
    const c = ctx();
    const { SlashCommandParser, SlashCommand, SlashCommandArgument, SlashCommandNamedArgument, ARGUMENT_TYPE } = c;
    const add = (props) => {
        try { SlashCommandParser.addCommandObject(SlashCommand.fromProps(props)); } catch (e) { logError(`register /${props.name}`, e); }
    };
    const named = (props) => { try { return SlashCommandNamedArgument?.fromProps ? SlashCommandNamedArgument.fromProps(props) : props; } catch { return props; } };
    const isTrue = x => ['true', '1', 'yes', 'on'].includes(String(x ?? '').trim().toLowerCase());

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
        helpString: 'One-shot note to the hidden director, e.g. <code>/uc-direct a sibling calls during dinner</code>.',
    });
    add({
        name: 'uc-pause',
        callback: async (args) => {
            const chat = isTrue(args?.chat);
            const r = setKnob(chat ? 'core.chat_paused' : 'core.paused', true, { chat });
            if (!r.ok) { toastr.warning(r.reason, 'Undercurrent'); return ''; }
            clearPrompts();
            toastr.info(chat ? 'Paused in this chat.' : 'Paused.', 'Undercurrent');
            return '';
        },
        namedArgumentList: [named({ name: 'chat', description: 'true = pause only this chat', typeList: [ARGUMENT_TYPE.BOOLEAN], defaultValue: 'false' })],
        helpString: 'Pause Undercurrent (no hidden passes or notes) until /uc-resume. <code>chat=true</code> pauses only this chat.',
    });
    add({
        name: 'uc-resume',
        callback: async () => {
            setKnob('core.paused', false);
            if (chatActive() && chatOverrides()['core.chat_paused']) setKnob('core.chat_paused', false, { chat: true });
            toastr.info('Resumed.', 'Undercurrent');
            return '';
        },
        helpString: 'Resume Undercurrent after /uc-pause (globally and in this chat).',
    });
    add({
        name: 'uc-set',
        callback: async (args, value) => {
            const text = String(value ?? '').trim();
            const m = text.match(/^(\S+)(?:\s+([\s\S]*))?$/);
            if (!m) { toastr.info('Usage: /uc-set <key> <value> [chat=true]  ·  /uc-set reset=true <key>', 'Undercurrent'); return ''; }
            const found = findKnob(m[1]);
            if (!found.knob) {
                toastr.warning(found.matches.length ? `"${m[1]}" is ambiguous: ${found.matches.slice(0, 6).join(', ')}` : `Unknown setting "${m[1]}". Open /uc-knobs to browse.`, 'Undercurrent');
                return '';
            }
            const key = found.knob.key;
            const chat = isTrue(args?.chat);
            if (isTrue(args?.reset)) {
                if (chat) setChatOverride(key, false); else resetKnob(key);
                toastr.info(`${key} reset${chat ? ' for this chat' : ''}.`, 'Undercurrent');
                return fmt(K()[key]);
            }
            if (m[2] === undefined) { toastr.info(`Usage: /uc-set ${key} <value>`, 'Undercurrent'); return ''; }
            const r = setKnob(key, m[2], { chat });
            if (!r.ok) { toastr.warning(`${key}: ${r.reason}`, 'Undercurrent'); return ''; }
            toastr.info(`${key} = ${fmt(r.value)}${r.clamped ? ' (clamped)' : ''}${r.chat ? ' (this chat)' : ''}`, 'Undercurrent');
            return fmt(r.value);
        },
        namedArgumentList: [
            named({ name: 'chat', description: 'true = set only for this chat', typeList: [ARGUMENT_TYPE.BOOLEAN], defaultValue: 'false' }),
            named({ name: 'reset', description: 'true = reset the setting to its default (or drop this chat\'s override with chat=true)', typeList: [ARGUMENT_TYPE.BOOLEAN], defaultValue: 'false' }),
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({ description: 'setting key (or a unique end of it) followed by the value', typeList: [ARGUMENT_TYPE.STRING], isRequired: true }),
        ],
        helpString: 'Change an Undercurrent setting, e.g. <code>/uc-set inject.max_words 250</code>, <code>/uc-set events.drama 1.5 chat=true</code>, <code>/uc-set reset=true drama</code>. Lists: comma-separated or JSON. Returns the new value.',
    });
    add({
        name: 'uc-get',
        callback: async (_args, value) => {
            const q = String(value ?? '').trim();
            const found = findKnob(q);
            if (!found.knob) { toastr.warning(found.matches.length ? `Matches: ${found.matches.slice(0, 8).join(', ')}` : `Unknown setting "${q}".`, 'Undercurrent'); return ''; }
            const key = found.knob.key;
            const val = K()[key];
            const where = Object.hasOwn(chatOverrides(), key) ? 'this chat' : Object.hasOwn(settings().knobs, key) ? 'global' : 'default';
            toastr.info(`${key} = ${fmt(val).slice(0, 300)} (${where})`, 'Undercurrent');
            return fmt(val);
        },
        unnamedArgumentList: [SlashCommandArgument.fromProps({ description: 'setting key (or a unique end of it)', typeList: [ARGUMENT_TYPE.STRING], isRequired: true })],
        helpString: 'Show (and return) the effective value of an Undercurrent setting, e.g. <code>/uc-get inject.depth</code>.',
    });
    add({
        name: 'uc-profile',
        callback: async (_args, value) => {
            const name = String(value ?? '').trim();
            const all = [...BUILTIN_PROFILES.map(p => p.name), ...Object.keys(settings().user_profiles)];
            if (!name) { toastr.info(`Profiles: ${all.join(', ')}`, 'Undercurrent'); return all.join(', '); }
            const hit = all.find(n => n.toLowerCase() === name.toLowerCase());
            const msg = hit ? loadProfile(hit) : `No profile "${name}". Profiles: ${all.join(', ')}`;
            toastr.info(msg, 'Undercurrent');
            return hit || '';
        },
        unnamedArgumentList: [SlashCommandArgument.fromProps({ description: 'profile name (empty = list)', typeList: [ARGUMENT_TYPE.STRING], isRequired: false })],
        helpString: 'Load a settings profile, e.g. <code>/uc-profile Low latency</code>. Without a name, lists the profiles.',
    });
    add({
        name: 'uc-goal',
        callback: async (args, value) => {
            if (!chatActive()) return '';
            const st = loadState();
            const go = goalOpts(st);
            const cmd = parseGoalCommand(args || {}, String(value ?? ''), { options: go });
            const r = executeGoalCommand(st.goals, cmd, { turn: countUserTurns(ctx().chat), userName: ctx().name1, hiddenOK: false, options: go });
            if (r.changed) { st.director.last_injection = ''; saveState(st); refreshGoalsPanel(); }
            if (cmd.action !== 'list') (r.ok ? toastr.info : toastr.warning)(r.message, 'Undercurrent · Goals');
            return r.message;
        },
        namedArgumentList: [
            named({ name: 'owner', description: '"story" or a character name (never the player)', typeList: [ARGUMENT_TYPE.STRING] }),
            named({ name: 'priority', description: 'high | normal | low (or 1 | 2 | 3)', typeList: [ARGUMENT_TYPE.STRING] }),
            named({ name: 'hidden', description: 'on | off: mask the goal in lists and the panel', typeList: [ARGUMENT_TYPE.STRING] }),
            named({ name: 'desc', description: 'details for the planner', typeList: [ARGUMENT_TYPE.STRING] }),
        ],
        unnamedArgumentList: [SlashCommandArgument.fromProps({ description: 'add <title> [| details] · list · done|undone <goal> [task] · remove|pause|resume|hide|show <goal>', typeList: [ARGUMENT_TYPE.STRING], isRequired: true })],
        helpString: 'Story goals. <code>/uc-goal add owner=&lt;character&gt; priority=high &lt;goal title&gt; | &lt;details&gt;</code>, <code>/uc-goal list</code>, <code>/uc-goal done 1 2.1</code>. A goal is a number from the list, an id like g3, or a quoted title. A task is a path like 2.1; leave it out to use the current task.',
    });
    add({
        name: 'uc-tasks',
        callback: async (_args, value) => {
            if (!chatActive()) return '';
            const st = loadState();
            const go = goalOpts(st);
            const cmd = parseTasksCommand(String(value ?? ''), { options: go });
            if (cmd.error) { toastr.info(cmd.error, 'Undercurrent'); return cmd.error; }
            let goal = cmd.goalRef ? findGoal(st.goals, cmd.goalRef) : null;
            if (cmd.goalRef && !goal) { const m = `No goal "${cmd.goalRef}".`; toastr.warning(m, 'Undercurrent'); return m; }
            if (cmd.action === 'check') { await runGoalCheck({ goalId: goal?.id || null, manual: true }); return ''; }
            if (!goal) {
                const active = st.goals.items.filter(g => g.status === 'active');
                if (active.length !== 1) { const m = 'Which goal? Usage: /uc-tasks <goal number> generate|more [count]'; toastr.info(m, 'Undercurrent'); return m; }
                goal = active[0];
            }
            await runTaskGen(goal.id, cmd.action === 'more', { count: cmd.count });
            return '';
        },
        unnamedArgumentList: [SlashCommandArgument.fromProps({ description: '[goal] generate|more [count] | check', typeList: [ARGUMENT_TYPE.STRING], isRequired: true })],
        helpString: 'Generate tasks for a goal from the card, persona and chat (<code>/uc-tasks 1 generate</code>, <code>/uc-tasks 1 more 3</code>), or check now whether current tasks have happened (<code>/uc-tasks check</code>).',
    });
    add({
        name: 'uc-rules',
        callback: async (_args, value) => {
            const [sub = 'list', id = ''] = String(value ?? '').trim().split(/\s+/);
            const st = chatActive() ? loadState() : null;
            const { rules } = ruleSet(ruleOptions(st));
            if (sub === 'list' || !sub) return rules.map(r => `${r.enabled ? '●' : '○'} ${r.id} [${r.pack}] ${r.name}`).join('\n');
            const rule = rules.find(r => r.id === id);
            if (!rule || !['on', 'off'].includes(sub)) { toastr.info('Usage: /uc-rules list | on <id> | off <id>', 'Undercurrent'); return ''; }
            setRuleEnabled(rulesSettings(), rule, sub === 'on');
            ctx().saveSettingsDebounced();
            runtime.rulesPanel?.refresh?.();
            toastr.info(`Rule ${id} ${sub}.`, 'Undercurrent');
            return '';
        },
        unnamedArgumentList: [SlashCommandArgument.fromProps({ description: 'list | on <rule id> | off <rule id>', typeList: [ARGUMENT_TYPE.STRING] })],
        helpString: 'Chance rules: <code>/uc-rules list</code> (returns the list), <code>/uc-rules off di_acts</code>.',
    });
    add({
        name: 'uc-pack',
        callback: async (_args, value) => {
            const [sub = '', id = ''] = String(value ?? '').trim().split(/\s+/);
            const { packs } = resolveRuleSet(rulesSettings(), STARTER_PACKS);
            if (!['on', 'off'].includes(sub) || !packs.some(p => p.id === id)) {
                toastr.info(`Usage: /uc-pack on|off <pack>. Packs: ${packs.map(p => p.id).join(', ')}`, 'Undercurrent');
                return '';
            }
            setPackEnabled(rulesSettings(), id, sub === 'on');
            ctx().saveSettingsDebounced();
            runtime.rulesPanel?.refresh?.();
            toastr.info(`Pack ${id} ${sub}.`, 'Undercurrent');
            return '';
        },
        unnamedArgumentList: [SlashCommandArgument.fromProps({ description: 'on|off <pack id>', typeList: [ARGUMENT_TYPE.STRING], isRequired: true })],
        helpString: 'Turn a Chance-rules pack on or off, e.g. <code>/uc-pack on ambient_world</code>.',
    });
    add({
        name: 'uc-roll',
        callback: async (_args, value) => {
            if (String(value || 'test').trim() !== 'test' || !chatActive()) { toastr.info('Usage: /uc-roll test (in a chat)', 'Undercurrent'); return ''; }
            const st = loadState();
            const cc = ctx();
            const r = runRules(st, { type: 'normal', turn: countUserTurns(cc.chat), lastUser: lastUserMessage(cc.chat), commit: false });
            await cc.callGenericPopup(`<div class="uc-rules">${renderTest(r)}</div>`, cc.POPUP_TYPE.TEXT, '', { wide: true, allowVerticalScrolling: true });
            return (r?.fired || []).map(f => `${f.rule}: ${f.text}`).join('\n');
        },
        unnamedArgumentList: [SlashCommandArgument.fromProps({ description: 'test', typeList: [ARGUMENT_TYPE.STRING] })],
        helpString: 'Show what the Chance rules would fire this turn, without saving anything.',
    });
    // ---- Native port engines: drama cadence, beats, questions, ask topics, psyche, intimate scene
    const portState = () => {
        if (!chatActive()) { toastr.info('Open a chat first.', 'Undercurrent'); return null; }
        return loadState();
    };
    const applyAuthorOps = (st, res) => {
        const r = applyOps(st, res.ops || [], { turn: countUserTurns(ctx().chat), source: 'user', trusted: true, userName: ctx().name1 });
        saveState(r.state);
        return r;
    };
    add({
        name: 'uc-drama',
        callback: async (_args, value) => {
            const st = portState();
            if (!st) return '';
            const res = executeDramaCommand(st, 'drama', { text: String(value ?? '').trim() }, { turn: countUserTurns(ctx().chat), options: K() });
            if (res.knob) setKnob(res.knob.key, res.knob.value, { chat: true });
            if (res.rt) { const s2 = loadState(); s2.ports.drama.rt = res.rt; saveState(s2); }
            if (res.ops?.length) applyAuthorOps(loadState(), res);
            if (res.message) toastr.info(res.message, 'Undercurrent · Drama');
            return res.message || '';
        },
        unnamedArgumentList: [SlashCommandArgument.fromProps({ description: 'off | low | normal | high | fire | hold <turns> (empty = status)', typeList: [ARGUMENT_TYPE.STRING] })],
        helpString: 'Drama cadence for this chat: <code>/uc-drama high</code>, <code>/uc-drama fire</code> (next turn), <code>/uc-drama hold 3</code>, or <code>/uc-drama</code> for the status.',
    });
    const dramaListCommand = (name, command, usage, help) => add({
        name,
        callback: async (_args, value) => {
            const st = portState();
            if (!st) return '';
            // "in=N by=M" may come as named args (before the text) or inside the text.
            const named = { ...(_args || {}) };
            const text = String(value ?? '').replace(/\b(in|by)=(\d+)\b/gi, (_, k, n) => { named[k.toLowerCase()] = n; return ''; }).replace(/\s+/g, ' ').trim();
            const res = executeDramaCommand(st, command, { ...named, text }, { turn: countUserTurns(ctx().chat), options: K() });
            if (res.ops?.length) applyAuthorOps(st, res);
            if (res.rt) { const s2 = loadState(); s2.ports.drama.rt = res.rt; saveState(s2); }
            if (res.message) toastr.info(res.message, 'Undercurrent · Drama');
            return res.message || '';
        },
        namedArgumentList: command === 'ask' ? [] : [
            named({ name: 'in', description: 'earliest turn offset', typeList: [ARGUMENT_TYPE.NUMBER] }),
            named({ name: 'by', description: 'latest turn offset', typeList: [ARGUMENT_TYPE.NUMBER] }),
        ],
        unnamedArgumentList: [SlashCommandArgument.fromProps({ description: usage, typeList: [ARGUMENT_TYPE.STRING] })],
        helpString: help,
    });
    dramaListCommand('uc-beat', 'beat', 'add <text> [in=N] [by=M] · done <text> · drop <text> · list', 'Plot-beat menu: <code>/uc-beat add the landlord comes back in=2 by=6</code>, <code>/uc-beat list</code>. Beats are offered to the director inside their window.');
    dramaListCommand('uc-question', 'question', '<text> [in=N] [by=M]', 'Plant an open question with a payoff window: <code>/uc-question who sent the letter? in=3 by=10</code>.');
    dramaListCommand('uc-ask', 'ask', '<character> <topic>', 'Queue a topic a character wants to ask about (never asked by the player): <code>/uc-ask {{char}} the scar on the hand</code>.');
    add({
        name: 'uc-psyche',
        callback: async () => {
            const st = portState();
            if (!st) return '';
            const c = ctx();
            const card = cardInfo();
            const r = psycheTurn({ state: st, turn: countUserTurns(c.chat), userName: c.name1, charName: c.name2, options: K(), cardTexts: c.name2 ? { [c.name2]: [card.description, card.personality].filter(Boolean).join('\n') } : {} });
            const text = (r.lines || []).map(l => `- ${l.text}`).join('\n') || '(no feelings or memories recorded yet)';
            await c.callGenericPopup(`<div class="uc-inspector-head"><h3>Feelings and memories</h3><small>Hidden from the story.</small></div><pre class="uc-pre">${text.replace(/</g, '&lt;')}</pre>`, c.POPUP_TYPE.TEXT, '', { wide: true, allowVerticalScrolling: true, leftAlign: true });
            return text;
        },
        helpString: 'Show the characters\' current feelings, lasting memories, defenses and insights (hidden state, nothing is printed into the chat).',
    });
    add({
        name: 'uc-scene',
        callback: async () => {
            const st = portState();
            if (!st) return '';
            const c = ctx();
            const { rt, ...scene } = st.ports.scene_intimacy || {};
            const text = JSON.stringify(scene, null, 2);
            await c.callGenericPopup(`<div class="uc-inspector-head"><h3>Intimate scene</h3><small>Hidden continuity (phase, activities, clothing, aftermath).</small></div><pre class="uc-pre">${text.replace(/</g, '&lt;')}</pre>`, c.POPUP_TYPE.TEXT, '', { wide: true, allowVerticalScrolling: true, leftAlign: true });
            return text;
        },
        helpString: 'Show the intimate-scene tracker for this chat (hidden state).',
    });
    add({
        name: 'uc-peek',
        callback: async (_args, value) => {
            const v = String(value ?? '').trim().toLowerCase();
            if (!['on', 'off', ''].includes(v)) { toastr.info('Usage: /uc-peek on|off', 'Undercurrent'); return ''; }
            if (!v) return K()['display.peek'];
            const r = setKnob('display.peek', v === 'on' ? 'collapsed' : 'off', { chat: chatActive() });
            if (!r.ok) { toastr.warning(r.reason, 'Undercurrent'); return ''; }
            renderAllPeeks();
            toastr.info(v === 'on' ? 'Behind-the-scenes panels on (this chat, screen only).' : 'Behind-the-scenes panels off.', 'Undercurrent');
            return r.value;
        },
        unnamedArgumentList: [SlashCommandArgument.fromProps({ description: 'on | off (empty = show the current setting)', typeList: [ARGUMENT_TYPE.STRING] })],
        helpString: 'Show or hide a closed "Behind the scenes" panel under each reply in this chat (screen only; never in the chat text, file or prompt).',
    });
    add({
        name: 'uc-knobs',
        callback: async () => { await openKnobsPopup(); return ''; },
        helpString: 'Open Undercurrent\'s "All settings" panel.',
    });
}

// ---------------------------------------------------------------------------------------------------------------------
// Settings drawer (Essentials)

function updateStatus() {
    try {
        const v = K();
        const profile = profileForModel(modelName());
        const lenses = currentLenses();
        const status = !v['core.enabled'] ? 'Off' : v['core.paused'] ? 'Paused (/uc-resume)' : v['core.chat_paused'] ? 'Paused in this chat' : 'Active';
        const el = document.getElementById('uc_status');
        if (el) el.textContent = `${status} · model profile: ${profile} · persona: ${lenses.persona.id} · tone: ${lenses.tone.id} · genre: ${lenses.genre.id} · note: ${v['note.style']}${v['inject.placement'] === 'macros' ? ' (macros)' : ''}`;
    } catch { /* drawer not rendered */ }
}

/** Sync the Essentials controls (data-uc-knob) and the profile select with the current values. */
function refreshEssentials() {
    try {
        const root = document.getElementById('undercurrent_settings');
        if (!root) return;
        const v = K();
        for (const el of root.querySelectorAll('[data-uc-knob]')) {
            const key = el.getAttribute('data-uc-knob');
            if (el.type === 'checkbox') el.checked = !!v[key];
            else if (el.type === 'range') {
                if (key === 'events.drama') el.max = String(v['events.drama_max']);
                el.value = String(v[key]);
                const out = root.querySelector(`[data-uc-out="${key}"]`);
                if (out) out.textContent = Number(v[key]).toFixed(1);
            } else el.value = String(v[key]);
            el.closest('.uc-ess')?.classList.toggle('uc-chat', Object.hasOwn(chatOverrides(), key));
        }
        const sel = root.querySelector('#uc_profile_select');
        if (sel) {
            const s = settings();
            const names = [...BUILTIN_PROFILES.map(p => p.name), ...Object.keys(s.user_profiles)];
            const mod = profileModified();
            sel.innerHTML = names.map(n => `<option value="${n.replace(/"/g, '&quot;')}">${n.replace(/</g, '&lt;')}${n === s.profile && mod ? ' (modified)' : ''}</option>`).join('');
            sel.value = names.includes(s.profile) ? s.profile : 'Balanced';
        }
    } catch (e) {
        logError('refreshEssentials', e);
    }
    updateStatus();
}

function bindSettings() {
    const root = document.getElementById('undercurrent_settings');
    if (!root) return;
    const onChange = (e) => {
        const el = e.target;
        const key = el.getAttribute?.('data-uc-knob');
        if (key) {
            if (el.type === 'range' && e.type === 'input') {
                const out = root.querySelector(`[data-uc-out="${key}"]`);
                if (out) out.textContent = Number(el.value).toFixed(1);
            }
            if (e.type === 'change' || el.type === 'range') {
                const r = setKnob(key, el.type === 'checkbox' ? el.checked : el.value, { chat: Object.hasOwn(chatOverrides(), key) });
                if (!r.ok) toastr.warning(r.reason, 'Undercurrent');
            }
            return;
        }
        if (el.id === 'uc_profile_select' && e.type === 'change') {
            toastr.info(loadProfile(el.value), 'Undercurrent');
        }
    };
    root.addEventListener('change', onChange);
    root.addEventListener('input', onChange);
    root.addEventListener('click', (e) => {
        const btn = e.target.closest?.('[data-uc-action]');
        if (!btn) return;
        const act = btn.getAttribute('data-uc-action');
        if (act === 'knobs') openKnobsPopup().catch(err => logError('knobs popup', err));
        if (act === 'inspector') openInspector().catch(err => logError('inspector', err));
        if (act === 'reseed') reseedCharacter().catch(err => logError('reseed', err));
        if (act === 'clear') resetState({ confirm: true }).catch(err => logError('reset', err));
    });
    root.querySelector('.inline-drawer-toggle')?.addEventListener('click', () => refreshEssentials());
    refreshEssentials();
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
    // Peek (screen only): rebuild on render, update and chat load.
    c.eventSource.on(ev.CHARACTER_MESSAGE_RENDERED, (id) => renderPeek(id));
    if (ev.MESSAGE_UPDATED) c.eventSource.on(ev.MESSAGE_UPDATED, (id) => renderPeek(id));
    if (ev.CHAT_LOADED) c.eventSource.on(ev.CHAT_LOADED, () => renderAllPeeks());
    if (ev.MORE_MESSAGES_LOADED) c.eventSource.on(ev.MORE_MESSAGES_LOADED, () => renderAllPeeks());
}

async function init() {
    settings();
    conf();
    try {
        const html = await ctx().renderExtensionTemplateAsync(EXT_PATH, 'settings');
        $('#extensions_settings2').append(html);
        bindSettings();
    } catch (e) {
        logError('settings UI', e);
    }
    try {
        const gh = await ctx().renderExtensionTemplateAsync(EXT_PATH, 'goals');
        $('#uc_goals_mount').append(gh);
        const panel = document.getElementById('uc_goals_panel');
        if (panel) runtime.goalsPanel = mountGoalsPanel(panel, goalsApi);
        $('#uc_goals_open').on('click', () => openGoalsPopup(goalsApi).catch(e => logError('goals popup', e)));
        $('#uc_goals_check').on('click', () => runGoalCheck({ manual: true }).catch(e => logError('goal check', e)));
    } catch (e) {
        logError('goals UI', e);
    }
    try {
        const rh = await ctx().renderExtensionTemplateAsync(EXT_PATH, 'rules');
        const mount = document.getElementById('uc_rules_mount');
        if (mount) $(mount).append(rh); else $('#extensions_settings2').append(rh);
        const root = document.querySelector('#undercurrent_rules .inline-drawer-content');
        if (root) runtime.rulesPanel = mountRulesPanel(root, rulesApi());
    } catch (e) {
        logError('rules UI', e);
    }
    registerCommands();
    registerMacros();
    registerEvents();
    console.log(`${LOG} loaded from ${EXT_PATH}`);
}

jQuery(() => {
    init().catch(e => logError('init', e));
});

// Exposed for other engines and power users (e.g. registering more knobs at runtime): read-only helpers.
globalThis.undercurrentKnobs = Object.freeze({
    get: key => K()[key],
    set: (key, value, opts) => setKnob(key, value, opts),
    values: () => K(),
    coerce: (key, value) => { const k = getKnob(key); return k ? coerce(k, value) : { ok: false, reason: 'unknown setting' }; },
    open: () => openKnobsPopup(),
});
