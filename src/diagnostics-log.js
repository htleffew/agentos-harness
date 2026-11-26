// Diagnostics log (B47): why a block or a World Info entry was not sent. A switch in Review, off by default, keeps for each
// reply a short list of what the request left out and the reason. Nothing here calls a model. The reasons come from two places:
//   the stack plan   the cards the stack holds, read where the working copy is applied (preset-workbench.js noteStack): a card
//                    switched off, a card taken out of the stack, an extension card whose feature is off for the chat, and a
//                    card that is on but whose text is not in the request (SillyTavern trimmed it by size)
//   the scan         SillyTavern's own World Info scan results, read where the engine reads them (engine.js onScanDone,
//                    noteScan): its failed chance rolls, the budget overflow, its timed effects (cooldown, delay), and the
//                    entries of the sorted list that are not in the activated list, sorted into group, recursion and no key
// Only the reply's own scan counts: the scan the engine already ties to the generation in progress (the FIXRB guard), and
// only the first final pass of it, so a token-count dry run never stands in for the reply's.
//
// The log is stored with the reply the way MB12 stores fired entries, per swipe: in message.extra.ri_diag and in the matching
// swipe_info slot together, so a swipe keeps its own log, a branch copies it and a delete takes it away. It is capped: at most
// ROW_CAP rows and BYTE_CAP characters of JSON per reply; entries that matched no key are counted, not listed. With the switch
// off nothing is recorded and no request changes: every entry point returns before it reads anything.
import { swipeOf } from './memory/fold.js';
import { h, button, toggle } from './ui/dom.js';

export const DIAG = 'ri_diag';
export const ROW_CAP = 40;       // rows kept per reply
export const BYTE_CAP = 6000;    // characters of JSON kept per reply
const TITLE_CAP = 60;
const SCAN_TAIL = 6;             // messages of chat the key check reads when an entry has no scan depth of its own

export const REASONS = {
    off: 'switched off in the stack',
    out: 'taken out of the stack',
    feature: 'its feature is off for this chat',
    trimmed: 'trimmed by size (on in the stack, not in the request)',
    chance: 'chance missed',
    cooldown: 'on cooldown',
    delay: 'delayed (too early in the chat)',
    gate: 'held back until its first reply',
    group: 'lost its inclusion group',
    budget: 'World Info budget reached',
    recursion: 'recursion stopped before it',
};

const clip = (text, n = TITLE_CAP) => { const t = String(text ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}...` : t; };
const values = list => (list instanceof Map ? [...list.values()] : Array.isArray(list) ? list : list ? [...list] : []);
const keyOf = e => `${e?.world}.${e?.uid}`;
const titleOf = e => clip(e?.comment || (Array.isArray(e?.key) ? e.key[0] : '') || `Entry ${e?.uid}`);
const flat = text => String(text ?? '').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- the stack plan (pure)

/**
 * The blocks the stack plan leaves out: [{ name, why, reason }]. work is workingPlan()'s { plan, source }; modules is the chat's
 * module switches. A card whose feature is off is read from the extension's own cards (their id is the feature key).
 */
export function stackLeftOut(work, modules = {}, reply = Infinity) {
    const rows = [];
    const plan = Array.isArray(work?.plan) ? work.plan : [];
    const present = new Set(plan.filter(item => item.source === 'base').map(item => item.id));
    for (const item of plan) {
        if (item.marker) continue;
        const name = clip(item.label ? `${item.name} (${item.label})` : item.name || item.key);
        if (!item.on) rows.push({ name, reason: 'off' });
        else if (item.source === 'ri' && modules && modules[item.id] === false) rows.push({ name, reason: 'feature' });
        else if (item.notBefore > 1 && Number.isFinite(reply) && reply < item.notBefore) rows.push({ name, reason: 'gate', opensAt: item.notBefore });
    }
    for (const card of work?.source?.cards || []) {
        if (card?.listed && card.shippedOn && !card.marker && !present.has(card.id)) rows.push({ name: clip(card.name || card.id), reason: 'out' });
    }
    return rows.map(({ opensAt, ...row }) => ({ ...row, why: opensAt ? `${REASONS[row.reason]}: opens at reply ${opensAt}` : REASONS[row.reason] }));
}

/**
 * The cards that are on in the plan and whose text is missing from the request SillyTavern assembled. A card with macros in
 * it cannot be compared (the host fills them in), and neither can a short one.
 */
export function stackTrimmed(work, requestText) {
    const hay = flat(requestText);
    const rows = [];
    for (const item of Array.isArray(work?.plan) ? work.plan : []) {
        if (!item.on || item.marker || item.raw || typeof item.text !== 'string') continue;
        const probe = flat(item.text).slice(0, 60);
        if (probe.length < 12 || hay.includes(probe)) continue;
        rows.push({ name: clip(item.label ? `${item.name} (${item.label})` : item.name || item.key), reason: 'trimmed', why: REASONS.trimmed });
    }
    return rows;
}

// ---------------------------------------------------------------- the World Info scan (pure)

/** Whether any key of an entry is in the text, as the entry's own switches read it (a /regex/ key, case, plain text). */
export function keysMatch(entry, text) {
    const hay = String(text ?? '');
    const sensitive = entry?.caseSensitive === true;
    const lower = sensitive ? hay : hay.toLowerCase();
    return [].concat(entry?.key || []).some(raw => {
        const key = String(raw ?? '').trim();
        if (!key) return false;
        const rx = key.match(/^\/(.+)\/([a-z]*)$/s);
        if (rx) { try { return new RegExp(rx[1], rx[2]).test(hay); } catch { return false; } }
        return lower.includes(sensitive ? key : key.toLowerCase());
    });
}

const groupsOf = e => String(e?.group || '').split(/,\s*/).filter(Boolean);

/**
 * One turn's scan reader. pass(args) takes SillyTavern's WORLDINFO_SCAN_DONE arguments after each pass of the scan and keeps what
 * the passes decided; result() gives the rows once the scan's last pass is in.
 *   chance    entries SillyTavern rolled and failed (in new.all, not in new.successful)
 *   budget    entries that passed and were not added once the budget overflowed (in new.successful, not activated)
 */
export function createScanReader({ chatText = () => '' } = {}) {
    const chance = new Set(), budget = new Set();
    let last = null, done = false, final = null;
    return {
        pass(args) {
            if (done) return;
            const activated = args?.activated?.entries;
            const activeKeys = new Set(activated instanceof Map ? [...activated.keys()] : values(activated).map(keyOf));
            const all = values(args?.new?.all), ok = new Set(values(args?.new?.successful));
            for (const e of all) if (!ok.has(e)) chance.add(keyOf(e));
            if (args?.budget?.overflowed) for (const e of ok) if (!activeKeys.has(keyOf(e))) budget.add(keyOf(e));
            last = args;
            if (args?.state?.next) return;
            done = true;
            final = this.rows(args);
        },
        rows(args) {
            const activated = args?.activated?.entries;
            const active = new Map(activated instanceof Map ? [...activated.entries()] : values(activated).map(e => [keyOf(e), e]));
            const sorted = values(args?.sortedEntries);
            const text = chatText();
            const rows = [];
            let noKey = 0, considered = 0;
            const timed = args?.timedEffects;
            const effect = (kind, e) => { try { return !!timed?.isEffectActive?.(kind, e); } catch { return false; } };
            const winners = new Map();    // group -> a title that was sent from it
            for (const e of active.values()) for (const g of groupsOf(e)) if (!winners.has(g)) winners.set(g, titleOf(e));
            for (const e of values(args?.new?.all)) for (const g of groupsOf(e)) if (!winners.has(g) && !chance.has(keyOf(e))) winners.set(g, titleOf(e));
            for (const e of sorted) {
                if (!e || e.disable === true || active.has(keyOf(e))) continue;
                considered += 1;
                const k = keyOf(e);
                const row = reason => rows.push({ book: String(e.world ?? ''), uid: String(e.uid ?? ''), title: titleOf(e), reason, why: REASONS[reason] });
                if (chance.has(k)) { rows.push({ book: String(e.world ?? ''), uid: String(e.uid ?? ''), title: titleOf(e), reason: 'chance', why: `${REASONS.chance} (${Number.isFinite(Number(e.probability)) ? `${e.probability}%` : 'rolled'})` }); continue; }
                if (budget.has(k)) { row('budget'); continue; }
                if (effect('delay', e)) { row('delay'); continue; }
                if (effect('cooldown', e) && !effect('sticky', e)) { row('cooldown'); continue; }
                const recent = text.slice(-4000);
                const matched = e.constant === true || keysMatch(e, recent);
                const g = groupsOf(e).find(name => winners.has(name));
                if (g && matched) { rows.push({ book: String(e.world ?? ''), uid: String(e.uid ?? ''), title: titleOf(e), reason: 'group', why: `${REASONS.group}: ${winners.get(g)} was sent from ${g}` }); continue; }
                if (e.delayUntilRecursion && keysMatch(e, args?.activated?.text)) { row('recursion'); continue; }
                noKey += 1;
            }
            return { rows, noKey, considered };
        },
        result: () => final,
        get last() { return last; },
    };
}

// ---------------------------------------------------------------- the stored log (pure)

/** Fit rows to the caps: the first ROW_CAP rows, titles clipped, then rows dropped from the end until the JSON fits. */
export function capLog(log) {
    const out = { ...log, stack: (log.stack || []).map(r => ({ ...r })), wi: (log.wi || []).map(r => ({ ...r })) };
    out.cut = 0;
    const total = () => out.stack.length + out.wi.length;
    while (total() > ROW_CAP) { (out.wi.length ? out.wi : out.stack).pop(); out.cut += 1; }
    while (JSON.stringify(out).length > BYTE_CAP && total() > 0) { (out.wi.length ? out.wi : out.stack).pop(); out.cut += 1; }
    return out;
}

/** The log for a turn: a stack list, a World Info list and counts, capped. Returns null when there is nothing to say. */
export function buildLog({ stack = [], trimmed = [], scan = null, at = Date.now() } = {}) {
    const rows = [...stack, ...trimmed].map(({ name, reason, why }) => ({ name, reason, why }));
    const wi = (scan?.rows || []).map(({ book, uid, title, reason, why }) => ({ book, uid, title, reason, why }));
    if (!rows.length && !wi.length && !scan?.noKey) return null;
    return capLog({ v: 1, at, stack: rows, wi, noKey: scan?.noKey || 0, considered: scan?.considered || 0 });
}

/** Store a log on a message's showing swipe: in extra and in the matching swipe_info slot. A continued reply adds to the first part's. */
export function storeLog(message, log, { append = false } = {}) {
    if (!message || !log) return null;
    const swipe = swipeOf(message);
    let next = log;
    const before = append ? logOf(message) : null;
    if (before) {
        const seen = new Set(before.wi.map(r => `${r.book}#${r.uid}#${r.reason}`));
        next = capLog({ ...before, stack: before.stack, wi: [...before.wi, ...log.wi.filter(r => !seen.has(`${r.book}#${r.uid}#${r.reason}`))],
            noKey: Math.max(before.noKey || 0, log.noKey || 0), considered: Math.max(before.considered || 0, log.considered || 0) });
    }
    const value = { swipe, ...next };
    if (!message.extra || typeof message.extra !== 'object') message.extra = {};
    message.extra[DIAG] = value;
    const info = Array.isArray(message.swipe_info) ? message.swipe_info[swipe] : null;
    if (info && typeof info === 'object') {
        if (!info.extra || typeof info.extra !== 'object') info.extra = {};
        info.extra[DIAG] = structuredClone(value);
    }
    return value;
}

/** The log of the showing swipe, or null (a log copied from another swipe does not count). */
export function logOf(message) {
    const value = message?.extra?.[DIAG];
    return value && Array.isArray(value.wi) && Array.isArray(value.stack) && value.swipe === swipeOf(message) ? value : null;
}

/** The log as a text file: one line per left-out block or entry, with the reason. */
export function logText(message, label = 'Reply') {
    const log = logOf(message);
    if (!log) return '';
    const lines = [`${label} diagnostics log, ${new Date(log.at || 0).toISOString()}`, '', 'Stack blocks left out of the request'];
    lines.push(...(log.stack.length ? log.stack.map(r => `- ${r.name}: ${r.why}`) : ['- none']));
    lines.push('', 'World Info entries the scan considered and did not send');
    lines.push(...(log.wi.length ? log.wi.map(r => `- ${r.title} (${r.book} #${r.uid}): ${r.why}`) : ['- none listed']));
    lines.push(`- ${log.noKey || 0} more matched no key and are not listed (${log.considered || 0} entries considered in all)`);
    if (log.cut) lines.push('', `${log.cut} rows were left out to keep the log under its size cap.`);
    return lines.join('\n');
}

// ================================================================ the host side

const turn = { stack: null, trimmed: [], reader: null, gen: null, type: 'normal', active: false };
const on = () => { try { return globalThis.SillyTavern.getContext().extensionSettings?.roleplay_instructions?.diagnosticsLog === true; } catch { return false; } };
/** Whether the switch is on (the setting lives with the extension's settings). */
export const diagnosticsOn = on;

/** The chat text the key check reads: the last messages, lower-cost than the host's own scan buffer. */
function recentChat() {
    try { return (globalThis.SillyTavern.getContext().chat || []).slice(-SCAN_TAIL).map(m => String(m?.mes ?? '')).join('\n'); } catch { return ''; }
}

/** Hook 1 (preset-workbench.js, applyWorkingCopy): the stack plan the request is built from. */
export function noteStack(work, modules, reply = Infinity) {
    if (!on()) { turn.stack = null; return; }
    try { turn.stack = work ? { rows: stackLeftOut(work, modules, reply), work, at: Date.now() } : null; turn.trimmed = []; }
    catch (error) { console.warn('[Roleplay Instructions] diagnostics log', error); }
}

/** Hook 2 (engine.js, onScanDone): the scan results of the generation the engine follows. gen is that generation. */
export function noteScan(args, gen) {
    if (!on() || !gen || gen.skip) return;
    try {
        if (turn.gen !== gen) { turn.gen = gen; turn.reader = createScanReader({ chatText: recentChat }); }
        turn.reader.pass(args);
    } catch (error) { console.warn('[Roleplay Instructions] diagnostics log', error); }
}

function requestText(data) {
    return (data?.chat || []).map(m => (typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content ?? ''))).join('\n');
}

let started = false;
/** Wire the log to the host once; the log is written to the reply in MESSAGE_RECEIVED. */
export async function startDiagnosticsLog() {
    if (started) return;
    started = true;
    const st = await import('./st.js');
    st.on('GENERATION_STARTED', (type, opts, dryRun) => {
        if (dryRun) return;
        const quiet = type === 'quiet' || !!opts?.quiet_prompt;
        turn.active = !quiet;
        turn.type = String(type || 'normal');
        turn.gen = null; turn.reader = null; turn.trimmed = [];
    });
    st.on('CHAT_COMPLETION_PROMPT_READY', data => {
        if (!on() || !turn.active || data?.dryRun || !turn.stack) return;
        try { turn.trimmed = stackTrimmed(turn.stack.work, requestText(data)); } catch (error) { console.warn(st.LOG, 'diagnostics log', error); }
    });
    st.on('MESSAGE_RECEIVED', (id, type) => {
        if (type === 'first_message' || !turn.active) return;
        turn.active = false;
        if (!on()) { turn.stack = null; turn.reader = null; return; }
        const message = st.ctx().chat?.[id];
        const log = buildLog({ stack: turn.stack?.rows || [], trimmed: turn.trimmed, scan: turn.reader?.result() || null });
        turn.stack = null; turn.reader = null; turn.trimmed = [];
        if (!message || message.is_user || !log) return;
        storeLog(message, log, { append: turn.type === 'continue' });
        st.ctx().saveChat?.().catch?.(() => {});
        import('./ui/sent.js').then(m => m.refreshUnderReplies()).catch(() => {});
    });
}

/** The reader on a reply's Sent card: a fold with the log, or null while the switch is off or the reply has none. */
export function diagnosticsRow(message, id) {
    if (!on()) return null;
    const log = logOf(message);
    if (!log) return null;
    const list = rows => h('ul', { class: 'ri-changes' }, rows);
    return h('details', { class: 'ri-sentitem', 'data-ri-diagnostics': String(id ?? '') }, h('summary', {}, 'Diagnostics log: what was not sent'),
        h('p', { class: 'ri-help' }, 'Stack blocks left out of this request'),
        log.stack.length ? list(log.stack.map(r => h('li', { 'data-ri-diag-reason': r.reason }, `${r.name}: ${r.why}`))) : h('p', { class: 'ri-muted' }, 'None.'),
        h('p', { class: 'ri-help' }, 'World Info entries the scan considered and did not send'),
        log.wi.length ? list(log.wi.map(r => h('li', { 'data-ri-diag-reason': r.reason }, `${r.title} (${r.book}): ${r.why}`))) : h('p', { class: 'ri-muted' }, 'None listed.'),
        h('p', { class: 'ri-help' }, `${log.noKey || 0} more matched no key and are not listed.${log.cut ? ` ${log.cut} rows were left out to keep the log small.` : ''}`),
        button('Save as a text file', () => saveText(`diagnostics-log-reply-${id}.txt`, logText(message, `Reply ${id}`)), { kind: 'ghost' }));
}

/** A small stamp for the tray's redraw check: it changes when a reply's log does. */
export const diagnosticsStamp = message => (on() ? (logOf(message)?.at ?? 0) : -1);

function saveText(filename, text) {
    try {
        const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
        const a = Object.assign(document.createElement('a'), { href: url, download: filename });
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 2000);
    } catch (error) { console.warn('[Roleplay Instructions] diagnostics log', error); }
}

/** Every reply's log of this chat as one text file. */
export function chatLogText(chat) {
    return (chat || []).map((m, i) => (logOf(m) ? logText(m, `Reply ${i}`) : '')).filter(Boolean).join('\n\n');
}

// Review, Context: the switch.
async function registerRow() {
    const [{ registerPage }, store] = await Promise.all([import('./ui/page-registry.js'), import('./store.js')]);
    registerPage({ id: 'diagnostics-log', group: 'review', tab: 'context', subgroup: 'Diagnostics', label: 'Diagnostics log', order: 99,
        help: 'Off by default. When on, each reply keeps a short list of the stack blocks and World Info entries that were not sent, with the reason.',
        aliases: 'diagnostics log why not sent left out world info entry stack block chance cooldown group budget trimmed',
        render: body => {
            const chat = () => globalThis.SillyTavern.getContext().chat || [];
            body.append(h('div', { class: 'ri-field', id: 'ri-diagnostics-log' },
                h('div', { class: 'ri-row' }, h('div', { class: 'ri-label' }, 'Keep a log of what was not sent'),
                    toggle(on(), value => { store.settings().diagnosticsLog = value; store.saveSettings(); }, 'Keep a diagnostics log')),
                h('p', { class: 'ri-help' }, 'Records, for each new reply, the stack blocks left out of its request and the World Info entries the scan considered and did not send, each with its reason. The reasons come from SillyTavern\'s own scan and your stack; no model is called. Read a reply\'s log on its Sent card. Each reply keeps at most 40 rows.'),
                h('div', { class: 'ri-row' }, button('Save this chat\'s logs as a text file', () => {
                    const text = chatLogText(chat());
                    if (!text) { try { globalThis.toastr?.info('No reply of this chat has a log yet.'); } catch { /* none */ } return; }
                    saveText('diagnostics-log.txt', text);
                }, { kind: 'ghost' }))));
        } });
}

if (globalThis.SillyTavern?.getContext) {
    startDiagnosticsLog().catch(error => console.warn('[Roleplay Instructions] diagnostics log', error));
    registerRow().catch(error => console.warn('[Roleplay Instructions] diagnostics log', error));
}
