// Undercurrent 2: the CORE runtime. Wires settings, content, slots, envelope, derived state, providers and the job queue.
// It never imports SillyTavern: every host call goes through the injected `st` facade (src/st.js in the browser, a fake
// in unit tests). Facade members used here:
//   getChat() getChatId() getChatMetadata() saveMetadata() saveChat() getSettingsRoot() saveSettings()
//   substituteParams(text) getCard() getPersona() getProfileKey() getCharacter() getModelId() isGenerating()
//   sendJobRequest({systemPrompt, prompt, responseLength, profileId}, signal) isOwnRequest(messages) dryRunGenerate()
//   toast(kind, message) popup(html) confirm(text)

import { buildSchema, everydayCount } from '../settings/schema.js';
import { createSettingsStore } from '../settings/store.js';
import { resolveRoleKeys } from '../settings/contentSettings.js';
import { applyOverrides as applyContentOverrides, listPromptPaths } from './content.js';
import { blockRegistry } from '../envelope/registry.js';
import { createStateCache } from '../state/cache.js';
import { ensureIds, idOf } from '../state/ids.js';
import { setOverrideIn } from '../state/overrides.js';
import { createSlotBuilder, makeSlotContext } from '../slots/build.js';
import { fillMessages, hasTrigger } from '../slots/assemble.js';
import { SLOTS } from '../slots/registry.js';
import { resolveFamily } from '../slots/models.js';
import { createProviderHost, createFeatureStore, oneshotAnchor } from './providers.js';
import { createJobQueue } from '../jobs/queue.js';
import { stripEnvelope } from '../envelope/parse.js';
import { fillJobText, cardText, stateLines, recentLines } from '../jobs/fill.js';
import { computePlaceholders } from '../slots/fill.js';
import {
    clone, createEmitter, cryptoRandom, debounce, escapeHtml, estimateTokens, getPath, hashText, isPlainObject, stableStringify,
} from './util.js';

const LOG = '[Undercurrent 2]';
const META_KEY = 'undercurrent2';

export function createRuntime({ st, content: baseContent, contentSettings = null, features = {}, timers = globalThis, now = () => Date.now(), rng = cryptoRandom }) {
    const emitter = createEmitter();
    const { schema, duplicates } = buildSchema({
        content: baseContent, contentSettings, featureSchema: features.featureSchema, featureDefaults: features.featureDefaults,
    });
    const roles = resolveRoleKeys(schema, baseContent);
    const host = createProviderHost({ providers: features.providers || [], log: (...a) => debug(...a) });
    const helpers = isPlainObject(features.helpers) ? features.helpers : {};
    const slotBuilder = createSlotBuilder();

    let genType = null; // type of the generation in flight (from GENERATION_STARTED, non-dry)
    let generatingFlag = false;
    let pendingPreview = null;
    let openHandler = null;
    let uiModule = null;
    let lastBuild = { ms: 0, at: 0 };
    let chatSaveTimer = null;
    let disposed = false;

    const settings = createSettingsStore({
        schema,
        getRoot: () => st.getSettingsRoot(),
        getProfileKey: () => st.getProfileKey(),
        getProfileLabel: () => st.getCharacter()?.name || '',
        save: () => st.saveSettings(),
        timers,
        onChange: info => {
            if (info?.type === 'prompt' || info?.type === 'reset') refreshContent();
            emitter.emit('settings', info);
        },
    });

    function eff() { return settings.effective(); }
    function debug(...args) {
        try { if (eff()['dev.debug']) console.debug(LOG, ...args); } catch { /* ignore */ }
    }
    if (duplicates.length) console.warn(LOG, 'duplicate setting keys ignored:', duplicates.join(', '));

    // ---- content (+ prompt overrides) ---------------------------------------------------------------------------
    let contentMemo = { key: null, value: baseContent, version: 0 };
    let registry = blockRegistry(baseContent);
    let registryKey = registry.map(b => `${b.id}:${b.tag}`).join('|');
    const stateCache = createStateCache({ registry });

    function refreshContent() {
        const overrides = settings.getPromptOverrides();
        const key = stableStringify(overrides);
        if (key === contentMemo.key) return contentMemo.value;
        const value = applyContentOverrides(baseContent, overrides);
        contentMemo = { key, value, version: contentMemo.version + 1 };
        const reg = blockRegistry(value);
        const rk = reg.map(b => `${b.id}:${b.tag}`).join('|');
        registry = reg;
        if (rk !== registryKey) {
            registryKey = rk;
            stateCache.setRegistry(reg);
        }
        return value;
    }
    function content() { return refreshContent(); }

    // ---- chat & metadata ----------------------------------------------------------------------------------------
    function chat() {
        const c = st.getChat();
        return Array.isArray(c) ? c : [];
    }
    function metaRead() {
        const m = st.getChatMetadata();
        return isPlainObject(m?.[META_KEY]) ? m[META_KEY] : {};
    }
    function metaWrite() {
        const m = st.getChatMetadata();
        if (!isPlainObject(m)) return null;
        if (!isPlainObject(m[META_KEY])) m[META_KEY] = {};
        return m[META_KEY];
    }
    function userNames() {
        const p = st.getPersona() || {};
        return [p.name].filter(Boolean);
    }
    function isActive() { return settings.isActive(); }

    // ---- derived state ------------------------------------------------------------------------------------------
    function computeState(length) {
        const meta = metaRead();
        refreshContent();
        return stateCache.compute({ chat: chat(), seed: meta.seed || null, overrides: meta.overrides || null, userNames: userNames(), length });
    }
    function getState() { return computeState(); }

    function genIsGenerating() {
        let g = false;
        try { g = !!st.isGenerating(); } catch { g = false; }
        return g || generatingFlag;
    }

    function scheduleChatSave() {
        if (chatSaveTimer) return;
        if (disposed) return;
        chatSaveTimer = timers.setTimeout(() => {
            chatSaveTimer = null;
            if (disposed) return;
            if (genIsGenerating()) { scheduleChatSave(); return; }
            try { st.saveChat(); } catch (e) { console.warn(LOG, 'chat save failed', e); }
        }, 1500);
    }
    function stampIds() {
        const writes = ensureIds(chat(), typeof st.uuid === 'function' ? () => st.uuid() : undefined);
        if (writes) scheduleChatSave();
        return writes;
    }

    const recompute = debounce(() => {
        try {
            stampIds();
            const state = computeState();
            emitter.emit('state', state);
            if (isActive()) host.onState(p => providerCtx(p, { chat: chat(), state, readOnly: false }));
        } catch (e) {
            console.warn(LOG, 'state recompute failed', e);
        }
    }, 50, timers);

    // ---- provider context ---------------------------------------------------------------------------------------
    function card() {
        const c = st.getCard() || {};
        return { name: c.name || '', description: c.description || '', personality: c.personality || '', scenario: c.scenario || '' };
    }
    function persona() {
        const p = st.getPersona() || {};
        return { name: p.name || '', description: p.description || '' };
    }
    function model() {
        const id = String(st.getModelId() || '');
        return { id, family: resolveFamily(eff()[roles.model_family], id, content().models) };
    }
    function lastText(list, wantUser) {
        for (let i = list.length - 1; i >= 0; i--) {
            const m = list[i];
            if (!m || m.is_system) continue;
            if (!!m.is_user === wantUser) return String(m.mes ?? '');
        }
        return '';
    }

    /**
     * ctx per docs/INTERFACES.md. `readOnly` stores (dry runs, impersonation, quiet) never write.
     */
    function providerCtx(p, { chat: list = chat(), state = null, readOnly = false, dryRun = false, mode = 'normal', job = null } = {}) {
        const chatId = st.getChatId();
        const meta = readOnly ? (metaRead()) : (metaWrite() || {});
        const store = createFeatureStore({
            meta, id: p.id, chatId, getChatId: () => st.getChatId(), save: () => st.saveMetadata(), readOnly,
        });
        return {
            settings: eff(),
            state: state || computeState(),
            chat: list,
            card: card(),
            persona: persona(),
            model: model(),
            content: content(),
            turnIndex: list.filter(m => m && m.is_user && !m.is_system).length,
            // During a swipe, ctx.chat excludes the reply being regenerated; the full chat and its index are here.
            fullChat: chat(),
            regenerating: regeneratingInfo(list),
            lastUserText: lastText(list, true),
            lastReplyText: lastText(list, false),
            rng,
            store,
            now: now(),
            dryRun,
            mode,
            job,
            ignoreSymbol: ignoreSymbol(),
            vectors: vectorsFor(chatId),
            stripEnvelope: text => cleanForJob(text),
            fillJobText: (text, tokens = {}) => fillJob(text, tokens, list, state),
        };
    }

    function regeneratingInfo(list) {
        const full = chat();
        if (list === full || list.length !== full.length - 1) return null;
        const i = full.length - 1;
        return { index: i, ucId: idOf(full[i]) };
    }
    function ignoreSymbol() {
        try { return st.ignoreSymbol?.() || Symbol.for('ignore'); } catch { return Symbol.for('ignore'); }
    }
    function vectorsFor(chatId) {
        try { return st.vectors ? st.vectors(`uc2_${hashText(String(chatId ?? ''))}`) : null; } catch { return null; }
    }

    /** Message text for job context: envelope and reasoning removed. */
    function cleanForJob(text) {
        return stripEnvelope(String(text ?? '').replace(/<\s*(think|thinking)\s*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ''), registry);
    }
    function placeholdersNow() {
        return computePlaceholders({ content: content(), settings: eff(), roles, family: model().family, extra: staticExtra() });
    }
    /** Job text fill: local tokens → {{uc.*}} → ST macros. Core supplies {card} {persona} {state} {recent}. */
    function fillJob(text, tokens = {}, list = chat(), state = null) {
        const core = {
            card: () => cardText(card()),
            persona: () => persona().description,
            state: () => stateLines(state || computeState()),
            recent: () => recentLines(list, 8, cleanForJob),
        };
        return fillJobText(text, { tokens: { ...core, ...tokens }, placeholders: placeholdersNow(), substitute });
    }

    // ---- slot build ---------------------------------------------------------------------------------------------
    let staticExtraMemo = { sig: null, value: {} };
    function staticExtra() {
        const m = model();
        const sig = `${settings.version}|${contentMemo.version}|${m.family}|${hashText(persona().description)}|${card().name}`;
        if (staticExtraMemo.sig === sig) return staticExtraMemo.value;
        // Static providers see no chat and no state: their text must be stable across turns.
        const value = isActive() ? host.staticText(p => ({ ...providerCtx(p, { chat: [], state: emptyStateView(), readOnly: true }), chat: [], state: null })) : {};
        staticExtraMemo = { sig, value };
        return value;
    }
    function emptyStateView() { return { turn: 0, scene: {}, characters: {}, facts: [], threads: { offscreen: [], planted: [], timers: [], resolved: [] }, tracker: {}, stats: {} }; }

    /**
     * Build all slot values for a generation.
     * @param {{mode?:string, list?:object[], state?:object, dryRun?:boolean, impersonationText?:string}} o
     */
    function buildSlots({ mode = 'normal', list = chat(), state = null, dryRun = false, impersonationText = '' } = {}) {
        const s = eff();
        const st8 = state || computeState();
        const readOnly = dryRun || mode !== 'normal';
        const lines = mode === 'off' ? {} : host.turnLines(p => providerCtx(p, { chat: list, state: st8, readOnly, dryRun, mode }));
        const ctx = makeSlotContext({
            content: content(), settings: s, roles, persona: persona(), card: card(), model: model(), staticExtra: staticExtra(),
            lines, mode, impersonationText, registry, contentKey: contentMemo.version,
        });
        return slotBuilder.build(ctx);
    }

    function substitute(text) {
        if (!text) return '';
        try { return String(st.substituteParams(text) ?? ''); } catch { return text; }
    }

    /** The turn's chat as the model will see it (a swipe regenerates the last reply, so it is not part of the turn). */
    function chatForTurn(type) {
        const list = chat();
        if (type === 'swipe' && list.length && !list[list.length - 1]?.is_user) return list.slice(0, -1);
        return list;
    }

    // ---- CHAT_COMPLETION_PROMPT_READY ---------------------------------------------------------------------------
    /** Optional semantic recall: let memory refresh its vector hits before the turn block is built (bounded wait). */
    /**
     * Awaited before the turn slots are built (normal, non-dry generations only): every provider's prefetch(ctx), e.g.
     * memory's semantic recall refreshing its vector hits. Bounded so a slow embedding source never stalls the send.
     */
    async function prefetchProviders(type) {
        const list = chatForTurn(type);
        const jobs = host.providers.filter(p => typeof p.prefetch === 'function').map(p => {
            const ctx = providerCtx(p, { chat: list, readOnly: false });
            return Promise.resolve().then(() => p.prefetch(ctx)).catch(() => false);
        });
        if (!jobs.length) return;
        await Promise.race([Promise.all(jobs), new Promise(r => timers.setTimeout(r, 2500))]);
    }

    async function onPromptReady(data) {
        const messages = data?.chat;
        if (!Array.isArray(messages)) return;
        try {
            if (st.isOwnRequest(messages)) return;
        } catch { /* ignore */ }
        if (!data.dryRun && isActive() && messages.some(hasTrigger) && (genType || 'normal') !== 'quiet' && genType !== 'impersonate') {
            try { await prefetchProviders(genType || 'normal'); } catch { /* recall falls back to keywords */ }
        }
        fillPrompt(data, messages);
    }

    function fillPrompt(data, messages) {
        try {
            if (st.isOwnRequest(messages)) return; // our background jobs carry their own prompt
        } catch { /* ignore */ }
        try {
            if (messages.some(hasTrigger)) {
                const t0 = now();
                const type = data.dryRun ? 'normal' : (genType || 'normal');
                const mode = !isActive() ? 'off' : type === 'impersonate' ? 'impersonate' : type === 'quiet' ? 'quiet' : 'normal';
                const list = chatForTurn(type);
                const state = computeState(list.length);
                let impersonationText = '';
                if (mode === 'impersonate') {
                    const imp = substitute(String(content().impersonation ?? '')).trim();
                    const present = imp && messages.some(m => typeof m?.content === 'string' && m.content.includes(imp));
                    impersonationText = present ? '' : imp;
                }
                const built = buildSlots({ mode, list, state, dryRun: !!data.dryRun, impersonationText });
                const values = {};
                for (const [trigger, v] of Object.entries(built.byTrigger)) values[trigger] = v ? substitute(v) : '';
                const r = fillMessages(messages, values);
                lastBuild = { ms: now() - t0, at: now(), mode, type, touched: r.touched, removed: r.removed, dryRun: !!data.dryRun };
                debug('prompt filled', lastBuild);
            }
        } catch (e) {
            console.error(LOG, 'prompt assembly failed', e);
        }
        if (data.dryRun && pendingPreview) {
            const p = pendingPreview;
            pendingPreview = null;
            timers.clearTimeout(p.timer);
            p.resolve({ messages: clone(messages).map(m => ({ role: m.role, content: m.content })), approximate: false, note: 'Dry run (system messages are not squashed in dry runs).' });
        }
    }

    // ---- generate interceptor (filters only; never calls a model) ----------------------------------------------
    function intercept(coreChat, type) {
        if (!isActive() || !Array.isArray(coreChat)) return;
        try {
            const list = chatForTurn(type);
            host.intercept(p => ({ ...providerCtx(p, { chat: list, readOnly: true, mode: type || 'normal' }), genType: type || 'normal' }), coreChat);
        } catch (e) {
            console.warn(LOG, 'interceptor failed', e);
        }
    }

    // ---- jobs ---------------------------------------------------------------------------------------------------
    const notified = new Set();
    const queue = createJobQueue({
        send: (request, signal) => st.sendJobRequest({ ...request, profileId: eff()['jobs.profile'] || '' }, signal),
        isGenerating: genIsGenerating,
        getChatId: () => st.getChatId(),
        timeoutMs: () => (Number(eff()['jobs.timeout']) || 60) * 1000,
        notifyFailure: (kind, error) => {
            if (notified.has(kind)) return;
            notified.add(kind);
            st.toast('warning', `Background job "${kind}" failed: ${String(error?.message || error).slice(0, 160)}. It will retry after later replies; further failures stay quiet.`);
        },
        onChange: s => emitter.emit('jobs', s),
        log: (...a) => debug(...a),
        timers,
    });

    /** Fill a built request: local tokens → {{uc.*}} → macros (every job prompt passes here before sending). */
    function fillRequest(r) {
        if (!r) return null;
        const tokens = isPlainObject(r.tokens) ? r.tokens : {};
        const f = t => fillJob(t, tokens);
        const prompt = Array.isArray(r.prompt)
            ? r.prompt.map(m => ({ role: m?.role || 'user', content: f(m?.content) }))
            : f(r.prompt);
        return { systemPrompt: f(r.systemPrompt), prompt, responseLength: Number(r.responseLength) || 400 };
    }

    function writableStore(providerId, chatId) {
        const meta = metaWrite();
        return createFeatureStore({ meta: meta || {}, id: providerId, chatId, getChatId: () => st.getChatId(), save: () => st.saveMetadata() });
    }

    /**
     * Queue job from a provider spec. Two shapes:
     *  - self-contained {kind, provider?, dedupeKey?, buildRequest(), parse(text), apply(result, store)} (FEATURES onReply)
     *  - {kind, ...} resolved through provider.jobs[kind] = {build(ctx), parse(text, spec), apply(result, store, spec)}
     */
    function makeJob(provider, spec) {
        const chatId = st.getChatId();
        const ownerId = typeof spec.provider === 'string' ? spec.provider : (provider?.id || spec.provider?.id || '');
        const done = () => recompute();
        if (typeof spec.buildRequest === 'function') {
            return {
                kind: spec.kind,
                chatId,
                dedupeKey: spec.dedupeKey || spec.kind,
                buildRequest: () => fillRequest(spec.buildRequest()),
                validate: text => (typeof spec.parse === 'function' ? spec.parse(text) : text),
                apply: result => {
                    if (typeof spec.apply === 'function') spec.apply(result, writableStore(ownerId, chatId));
                    done();
                },
            };
        }
        const def = provider?.jobs?.[spec.kind] || host.jobDef(spec.kind)?.def;
        const owner = provider?.jobs?.[spec.kind] ? provider : host.jobDef(spec.kind)?.provider;
        if (!def || !owner) return null;
        return {
            kind: spec.kind,
            chatId,
            dedupeKey: spec.dedupeKey || spec.kind,
            buildRequest: () => fillRequest(def.build({ ...providerCtx(owner, { readOnly: false, job: spec }), spec })),
            validate: text => (typeof def.parse === 'function' ? def.parse(text, spec) : text),
            apply: result => {
                if (typeof def.apply === 'function') def.apply(result, writableStore(owner.id, chatId), spec);
                done();
            },
        };
    }

    function enqueueSpecs(items) {
        let n = 0;
        for (const { provider, spec } of items) {
            const job = makeJob(provider, spec);
            if (job && queue.enqueue(job)) n++;
        }
        return n;
    }

    /**
     * Manual run (UI button). The spec's `meta` comes from, in order: the caller; the owning provider's onReply with
     * ctx.manualJob = kind (a self-contained spec carries its own meta); the job definition's meta(ctx); else none.
     */
    function runJob(kind, meta) {
        const found = host.jobDef(kind);
        if (!found) return { ok: false, reason: `no job "${kind}"` };
        let job = null;
        if (meta === undefined && typeof found.provider.onReply === 'function') {
            try {
                const ctx = { ...providerCtx(found.provider, { readOnly: false }), manualJob: kind };
                const specs = found.provider.onReply(ctx) || [];
                const spec = specs.find(x => x && x.kind === kind);
                if (spec) job = makeJob(found.provider, { ...spec, manual: true });
            } catch { /* fall through to the job definition */ }
        }
        if (!job) {
            let m = meta;
            if (m === undefined && typeof found.def.meta === 'function') {
                try { m = found.def.meta(providerCtx(found.provider, { readOnly: true })); } catch { m = undefined; }
            }
            job = makeJob(found.provider, { kind, manual: true, ...(m !== undefined ? { meta: m } : {}) });
        }
        return { ok: !!(job && queue.enqueue(job)), id: job?.id };
    }

    // ---- events -------------------------------------------------------------------------------------------------
    function onGenerationStarted(type, _params, dryRun) {
        if (dryRun) return;
        genType = type || 'normal';
        generatingFlag = true;
        if (genType !== 'quiet') queue.cancelAll('user generation');
    }
    function onGenerationEnded() {
        generatingFlag = false;
        genType = null;
        queue.kick();
    }
    function onMessageSent() {
        stampIds();
        recompute();
    }
    function onMessageReceived(_id, type) {
        stampIds();
        recompute.cancel();
        const state = computeState();
        emitter.emit('state', state);
        if (!isActive()) return;
        if (type === 'first_message' || type === 'command' || type === 'impersonate') return;
        const list = chat();
        host.onState(p => providerCtx(p, { chat: list, state }));
        const items = host.onReply(p => providerCtx(p, { chat: list, state }));
        if (items.length) enqueueSpecs(items);
    }
    function onChatMutated() {
        stampIds();
        recompute();
    }
    function onChatChanged() {
        queue.cancelAll('chat changed');
        settings.invalidate();
        stateCache.reset();
        staticExtraMemo = { sig: null, value: {} };
        stampIds();
        recompute();
        emitter.emit('chat', { chatId: st.getChatId() });
        emitter.emit('settings', { type: 'chat' });
    }

    // ---- commands -----------------------------------------------------------------------------------------------
    function openUi() {
        try {
            if (typeof openHandler === 'function') return openHandler();
            if (typeof uiModule?.open === 'function') return uiModule.open();
        } catch (e) {
            console.warn(LOG, 'UI open failed', e);
        }
        st.toast('info', 'The Undercurrent 2 panel is not installed yet.');
        return undefined;
    }
    function direct(note) {
        const text = String(note ?? '').trim();
        const set = helper('setOneShot');
        if (set) {
            try {
                if (text) set(helperCtx('oneshot'), text);
                else (helper('clearOneShot') || (c => set(c, '')))(helperCtx('oneshot'));
            } catch (e) { console.warn(LOG, 'one-shot note failed', e); }
            st.toast(text ? 'success' : 'info', text ? 'Noted for the next reply.' : 'One-shot note cleared.');
            return '';
        }
        const meta = metaWrite();
        if (!meta) return '';
        const store = createFeatureStore({ meta, id: 'oneshot', chatId: st.getChatId(), getChatId: () => st.getChatId(), save: () => st.saveMetadata() });
        if (!text) {
            store.set('note', undefined);
            st.toast('info', 'One-shot note cleared.');
            return '';
        }
        store.set('note', { text, anchor: oneshotAnchor(chat()), at: now() });
        st.toast('success', 'Noted for the next reply.');
        return '';
    }
    function stateHtml() {
        const s = getState();
        const json = JSON.stringify(s, null, 2);
        const body = json.length > 30000 ? `${json.slice(0, 30000)}\n…` : json;
        return `<div class="uc2-state-popup"><h3>Undercurrent 2: story state</h3><pre style="text-align:left;white-space:pre-wrap;max-height:70vh;overflow:auto">${escapeHtml(body)}</pre></div>`;
    }
    function showState() {
        try { st.popup(stateHtml()); } catch (e) { console.warn(LOG, e); }
        return '';
    }
    function setActive(on) {
        settings.setActive(!!on);
        if (!on) queue.cancelAll('suite paused');
        st.toast('info', on ? 'Undercurrent 2 is on.' : 'Undercurrent 2 is paused: static prompt text stays, the turn block is empty.');
        emitter.emit('settings', { type: 'active', on: !!on });
        return '';
    }
    async function resetChat({ confirm = true } = {}) {
        if (confirm) {
            let ok = false;
            try { ok = await st.confirm('Clear Undercurrent 2 data for this chat (seed, overrides, memory, notes, feature data)? The chat itself is not changed.'); } catch { ok = false; }
            if (!ok) return '';
        }
        const m = st.getChatMetadata();
        if (isPlainObject(m)) m[META_KEY] = {};
        st.saveMetadata();
        stateCache.reset();
        recompute();
        st.toast('success', 'Undercurrent 2 chat data cleared.');
        return '';
    }

    // ---- UI-facing operations -----------------------------------------------------------------------------------
    function setOverride(entity, field, value) {
        const meta = metaWrite();
        if (!meta) return false;
        meta.overrides = setOverrideIn(isPlainObject(meta.overrides) ? meta.overrides : {}, entity, field, value);
        st.saveMetadata();
        const state = computeState();
        emitter.emit('state', state);
        return true;
    }

    function estimate() {
        const built = buildSlots({ dryRun: true });
        const c = card();
        const p = persona();
        const staticText = Object.values(built.static).join('\n') + c.description + c.personality + c.scenario + p.description;
        const turnText = Object.values(built.turn).join('\n');
        const historyText = chat().filter(m => m && !m.is_system).map(m => stripEnvelope(String(m.mes ?? ''), registry)).join('\n');
        const s = estimateTokens(staticText);
        const t = estimateTokens(turnText);
        const h = estimateTokens(historyText);
        return { static: s, turn: t, history: h, total: s + t + h, approximate: true };
    }

    function approxPayload(note) {
        const built = buildSlots({ dryRun: true });
        const list = chat().filter(m => m && !m.is_system);
        const msgs = [];
        const staticText = SLOTS.filter(x => x.zone === 'static').map(x => built.byId[x.id]).filter(Boolean).join('\n\n');
        if (staticText) msgs.push({ role: 'system', content: substitute(staticText) });
        for (const m of list.slice(-30)) msgs.push({ role: m.is_user ? 'user' : 'assistant', content: String(m.mes ?? '') });
        const turnText = SLOTS.filter(x => x.zone === 'turn').map(x => built.byId[x.id]).filter(Boolean).join('\n\n');
        if (turnText) msgs.splice(Math.max(msgs.length - 1, staticText ? 1 : 0), 0, { role: 'system', content: substitute(turnText) });
        return { messages: msgs, approximate: true, note: note || 'Approximation from Undercurrent 2 slots and the last 30 messages (card, lore and other extensions not included).' };
    }

    function previewPayload() {
        if (genIsGenerating()) return Promise.resolve(approxPayload('Generation in progress; showing an approximation.'));
        return new Promise(resolve => {
            const timer = timers.setTimeout(() => {
                if (pendingPreview?.resolve === resolve) pendingPreview = null;
                resolve(approxPayload('The dry run did not complete; showing an approximation.'));
            }, 6000);
            pendingPreview = { resolve, timer };
            Promise.resolve()
                .then(() => st.dryRunGenerate())
                .then(ran => {
                    if (pendingPreview?.resolve === resolve && ran === false) {
                        pendingPreview = null;
                        timers.clearTimeout(timer);
                        resolve(approxPayload('No dry run is available here (no character selected or not Chat Completion); showing an approximation.'));
                    }
                })
                .catch(() => {
                    if (pendingPreview?.resolve === resolve) {
                        pendingPreview = null;
                        timers.clearTimeout(timer);
                        resolve(approxPayload('The dry run failed; showing an approximation.'));
                    }
                });
        });
    }

    function apiCtx(p) {
        return {
            ...providerCtx(p, { readOnly: false }),
            getSettings: () => eff(),
            setSetting: (k, v) => settings.set(k, v),
        };
    }
    function callFeatureApi(name, fallback, ...args) {
        const r = host.callApi(name, apiCtx, ...args);
        return r.handled && r.value !== undefined ? r.value : fallback;
    }
    /** ctx for a FEATURES helper that works on one provider's store. */
    function helperCtx(id, readOnly = false) {
        const p = host.byId(id) || { id };
        return providerCtx(p, { readOnly });
    }
    function helper(name) {
        const fn = helpers?.[name];
        return typeof fn === 'function' ? fn : null;
    }
    /** Apply a {key, value} setting write returned by a FEATURES helper. */
    function applyWrite(w) {
        if (w && typeof w.key === 'string' && w.key) settings.set(w.key, w.value);
    }
    function listRulePacks() {
        const fn = helper('listRulePacks');
        if (fn) { try { return fn(eff()) || []; } catch { return []; } }
        return callFeatureApi('listRulePacks', []);
    }
    function setRulePackEnabled(id, on) {
        const fn = helper('setRulePackEnabled');
        if (fn) { try { applyWrite(fn(eff(), id, on)); return true; } catch { return false; } }
        return callFeatureApi('setRulePackEnabled', false, id, on);
    }
    function removeRulePack(id) {
        const fn = helper('removeRulePack');
        if (fn) { try { applyWrite(fn(eff(), id)); return true; } catch { return false; } }
        return false;
    }
    function importLoreBary(text, opts = {}) {
        const fn = helper('importLoreBary');
        if (fn) {
            try {
                const r = fn(eff(), text, { userName: persona().name, ...opts }) || {};
                if (r.ok) applyWrite(r);
                return { ok: !!r.ok, added: Number(r.added) || 0, warnings: Array.isArray(r.warnings) ? r.warnings : [], format: r.format, pack: r.pack };
            } catch (e) {
                return { ok: false, added: 0, warnings: [String(e?.message || e)] };
            }
        }
        return callFeatureApi('importLoreBary', { ok: false, added: 0, warnings: ['Chance rules are not available.'] }, text);
    }
    function memoryStats() {
        const fallback = { working: chat().length, archived: 0, summarized: 0, tokensSaved: 0 };
        const p = host.byId('memory');
        if (p && typeof p.stats === 'function') { try { return { ...fallback, ...(p.stats(helperCtx('memory', true)) || {}) }; } catch { return fallback; } }
        const fn = helper('memoryStats');
        if (fn) { try { return { ...fallback, ...(fn(helperCtx('memory', true)) || {}) }; } catch { return fallback; } }
        return callFeatureApi('memoryStats', fallback);
    }

    function getPromptText(path) {
        const def = getPath(baseContent, path);
        const cur = getPath(content(), path);
        return { value: typeof cur === 'string' ? cur : '', default: typeof def === 'string' ? def : '', overridden: typeof cur === 'string' && cur !== def };
    }

    return {
        // wiring
        onPromptReady, intercept, onGenerationStarted, onGenerationEnded, onMessageSent, onMessageReceived, onChatMutated, onChatChanged,
        commands: { openUi, direct, showState, setActive, resetChat },
        openUi,
        setOpenHandler(fn) { openHandler = typeof fn === 'function' ? fn : null; },
        setUiModule(mod) { uiModule = mod || null; },
        // api surface
        getSchema: () => settings.schema,
        getContent: () => content(),
        getDefaultContent: () => baseContent,
        getSettings: () => eff(),
        setSetting: (k, v) => settings.set(k, v),
        resetSetting: k => settings.set(k, undefined),
        resetTab: tab => settings.resetTab(tab),
        getGlobalMode: tab => settings.getGlobalMode(tab),
        setGlobalMode: (tab, on) => settings.setGlobalMode(tab, on),
        getScopeLabel: tab => settings.getScopeLabel(tab),
        getState,
        setOverride,
        clearOverride: (entity, field) => setOverride(entity, field, undefined),
        getOverrides: () => clone(metaRead().overrides || {}),
        estimateTokens: estimate,
        previewPayload,
        memoryStats,
        runJob: (kind, meta) => runJob(kind, meta),
        jobStatus: () => queue.status(),
        listRulePacks,
        setRulePackEnabled,
        removeRulePack,
        importLoreBary,
        on: (ev, fn) => emitter.on(ev, fn),
        off: (ev, fn) => emitter.off(ev, fn),
        getCharacter: () => st.getCharacter() || null,
        substitute: text => substitute(String(text ?? '')),
        fillJobText: (text, tokens) => fillJob(text, tokens),
        isActive,
        setActive: on => setActive(on),
        listPromptPaths: () => listPromptPaths(baseContent),
        getPromptText,
        setPromptText: (path, text) => settings.setPromptText(path, text, getPath(baseContent, path)),
        resetPromptText: path => settings.resetPromptText(path),
        uiState: () => settings.ui(),
        saveUiState: () => settings.touchUi(),
        listConnectionProfiles: () => { try { return st.listConnectionProfiles() || []; } catch { return []; } },
        // diagnostics
        diagnostics: () => ({ lastBuild, cache: stateCache.stats(), everyday: everydayCount(settings.schema), roles, duplicates, providers: host.providers.map(p => p.id) }),
        buildSlots,
        roles,
        queue,
        settings,
        flush: () => { settings.flush(); recompute.flush(); },
        /** Stop timers and background work (extension reload, tests). */
        dispose() {
            recompute.cancel();
            if (chatSaveTimer) { timers.clearTimeout(chatSaveTimer); chatSaveTimer = null; }
            if (pendingPreview) { timers.clearTimeout(pendingPreview.timer); pendingPreview = null; }
            queue.cancelAll('disposed');
            disposed = true;
        },
    };
}
