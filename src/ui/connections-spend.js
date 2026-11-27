// Setup, Connections: the Spend and Background jobs sections (DESIGN.md 9, B19), carrying out the 23 November rulings
// (DECISIONS.md): paid background calls pause at a monthly ceiling of US$5 with a warning at US$4, free and local routes
// come first, a route that stops answering shows one dismissible note per outage and a "back" note when it returns, and
// routes are checked only when a job needs them. The meter is src/spend.js (MB1) and the route chains are src/routing.js;
// this file reads both, keeps a small ledger of calls per route, and draws the sections and the notes.
import { h, button, howItWorks } from './dom.js';
import { registerPage } from './page-registry.js';
import { settings, saveSettings } from '../store.js';
import { confirmBox } from '../st.js';
import { JOBS, ROUTES, mainCostClass, onChainResult, routeHealth } from '../routing.js';
import { DEFAULT_CEILING, DEFAULT_WARNING, monthOf, onSpend, setSpendLimits, spendState } from '../spend.js';
import { PHONE_MODEL, deletePhoneModel, onPhoneModel, phoneModelStatus, tapDownloadPhoneModel } from '../memory/phone-model.js';
import { hasJevKey, setJevKey } from '../memory/decide.js';
import { jobsSection } from './background-jobs.js';
import { desktopQueue } from '../memory/queue.js';

export const SPEND_PAGE = 'spend';
export const JOBS_PAGE = 'background-jobs';
export const GUIDE_URL = 'https://github.com/htleffew/agentos-harness/blob/roleplay-instructions-v10/docs/desktop-memory-guide.md';
export const PAUSED_TEXT = 'Paused, monthly ceiling reached';

const usd = (value, digits = 2) => `US$${Number(value || 0).toFixed(digits)}`;
const count = value => Number(value || 0).toLocaleString('en-US');

// How each route is named in rows and notes. kind groups the rows of the Spend section.
const NAMES = {
    desktop: { name: 'Desktop', phrase: 'the desktop', kind: 'Local', down: 'unreachable' },
    phone: { name: 'On-phone model', phrase: 'the on-phone model', kind: 'Local', down: 'did not answer' },
    nanogpt: { name: 'NanoGPT plan', phrase: 'NanoGPT', kind: 'Plan' },
    openrouterFree: { name: 'OpenRouter free model', phrase: 'an OpenRouter free model', kind: 'Free tier' },
    googleFree: { name: 'Google AI Studio free tier', phrase: 'the Google AI Studio free tier', kind: 'Free tier' },
    openrouter: { name: 'OpenRouter', phrase: 'OpenRouter', kind: 'Paid' },
    main: { name: 'Main API', phrase: 'the Main API', kind: 'Main connection' },
};
const nameOf = route => NAMES[route]?.name || ROUTES[route]?.label || String(route);
const phraseOf = route => NAMES[route]?.phrase || nameOf(route);
const isLocal = route => ROUTES[route]?.cost === 'local';

/** How a route bills a background job: local, plan, free, paid. The Main API follows the chat model's provider. */
export function costClassOf(route) {
    const cost = ROUTES[route]?.cost || 'paid';
    return cost === 'main' ? mainCostClass() : cost;
}

// ---- The ledger: calls and health per route, and the notes in the bar ----

function view(now = Date.now()) {
    const st = settings();
    const v = st.spendView && typeof st.spendView === 'object' ? st.spendView : (st.spendView = {});
    v.calls ||= {};
    v.health ||= {};
    v.outages ||= {};
    v.notes = Array.isArray(v.notes) ? v.notes : [];
    v.lastRoute ||= '';
    const month = monthOf(now);
    if (v.month !== month) {
        v.month = month;
        v.calls = {};
        // The warning and the ceiling notes belong to their month.
        v.notes = v.notes.filter(note => note.kind !== 'warning' && note.kind !== 'ceiling');
    }
    return v;
}

const listeners = new Set();
const changed = () => { for (const fn of [...listeners]) { try { fn(); } catch { /* a listener must not stop the ledger */ } } };

/** Hear every change to the ledger or the notes. Returns a function that stops listening. */
export function onSpendView(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

const outage = (v, route) => v.outages[route] ||= { down: false, since: 0, shown: false, n: 0 };
const healthOf = (v, route) => v.health[route] ||= { ok: 0, fail: 0, reason: '' };

// An attempt that never reached an answer: the route is down. Attempts the route answered, even badly (invalid, refused),
// and attempts skipped for a reason that says nothing about the route, leave its state alone.
const NO_ANSWER = new Set(['down', 'timeout', 'rate-limit', 'failed', 'late', 'error']);
const noAnswer = attempt => NO_ANSWER.has(attempt.outcome) || (attempt.outcome === 'skipped' && /^down\b/.test(String(attempt.reason || '')));

const addNote = (v, note, now) => {
    v.notes = [{ at: now, ...note }, ...v.notes.filter(item => item.id !== note.id)].slice(0, 12);
};

function fallbackText(local, target) {
    const paid = costClassOf(target) === 'paid';
    const ceiling = spendState().ceiling;
    return `${NAMES[local]?.name || nameOf(local)} ${NAMES[local]?.down || 'did not answer'}; background jobs on ${phraseOf(target)}`
        + (paid ? ` (paid, within your ${usd(ceiling)} monthly ceiling)` : '');
}

/**
 * Take in one finished background job, as routing.js and memory/decide.js report it: the calls per route, each route's
 * last answer and last failure, and the outage notes. A fallback note shows once per outage of a local route; when that
 * route answers again its note clears and one "back" note shows. Nothing here sends a request.
 */
export function recordChainResult(result, now = Date.now()) {
    if (!result || result.background === false) return;
    const v = view(now);
    const attempts = Array.isArray(result.attempts) ? result.attempts : [];
    const failed = [];
    for (const attempt of attempts) {
        if (!attempt.route) continue;
        if (noAnswer(attempt)) {
            const health = healthOf(v, attempt.route);
            health.fail = now;
            health.reason = String(attempt.reason || attempt.outcome).slice(0, 160);
            if (isLocal(attempt.route)) {
                const state = outage(v, attempt.route);
                if (!state.down) Object.assign(state, { down: true, since: now, shown: false, n: (state.n || 0) + 1 });
                failed.push(attempt.route);
            }
        } else if (attempt.outcome === 'completed') {
            healthOf(v, attempt.route).ok = now;
            if (isLocal(attempt.route)) comeBack(v, attempt.route, now);
        }
    }
    if (result.ok && result.route) {
        v.calls[result.route] = (v.calls[result.route] || 0) + 1;
        v.lastRoute = result.route;
        for (const local of new Set(failed)) {
            if (local === result.route) continue;
            const state = outage(v, local);
            if (state.shown) continue;
            state.shown = true;
            // The back note of an earlier outage gives way to the new fallback note for the same route.
            v.notes = v.notes.filter(note => !(note.route === local && note.kind === 'back'));
            addNote(v, { id: `fallback:${local}:${state.n}`, kind: 'fallback', route: local, target: result.route, paid: costClassOf(result.route) === 'paid', text: fallbackText(local, result.route) }, now);
        }
    }
    saveSettings();
    changed();
}

function comeBack(v, route, now) {
    const state = outage(v, route);
    if (!state.down) return;
    const showed = state.shown;
    Object.assign(state, { down: false, shown: false });
    v.notes = v.notes.filter(note => !(note.route === route && note.kind === 'fallback'));
    if (!showed) return;
    addNote(v, { id: `back:${route}:${state.n}`, kind: 'back', route, text: `${NAMES[route]?.name || nameOf(route)} back; background jobs on ${phraseOf(route)} again` }, now);
}

/** The notes waiting for her, newest first. Each stays until she dismisses it. */
export function activeNotes(now = Date.now()) {
    return view(now).notes.map(note => ({ ...note }));
}

export function dismissNote(id, now = Date.now()) {
    const v = view(now);
    const before = v.notes.length;
    v.notes = v.notes.filter(note => note.id !== id);
    if (v.notes.length === before) return false;
    saveSettings();
    changed();
    return true;
}

// The warning and the ceiling reach her once each month, in the bar and on the Spend section.
function spendEvent(event, now = Date.now()) {
    const v = view(now);
    const state = event.state;
    const month = state.month;
    if (event.type === 'warning' && v.warnedMonth !== month) {
        v.warnedMonth = month;
        addNote(v, { id: `warning:${month}`, kind: 'warning', text: `${usd(state.total)} of ${usd(state.ceiling)} used this month; paid background calls pause at the ceiling` }, now);
    } else if (event.type === 'ceiling' && v.ceilingMonth !== month) {
        v.ceilingMonth = month;
        addNote(v, { id: `ceiling:${month}`, kind: 'ceiling', text: `${usd(state.ceiling)} monthly ceiling reached; paid background calls are paused, free and local routes carry on` }, now);
    } else return;
    saveSettings();
    changed();
}

/** Test hook: forget the ledger. */
export function resetSpendView() {
    delete settings().spendView;
}

// ---- What the Spend section shows ----

const lastWithin = (a, b) => Math.max(Number(a) || 0, Number(b) || 0);

/** One line per route: calls and cost this month, and the route's health. Paid routes read the meter in spend.js. */
export function spendRows(now = Date.now()) {
    const v = view(now);
    const state = spendState(now);
    const probes = routeHealth(now);
    const ids = [...Object.keys(NAMES), ...Object.keys(state.routes).filter(id => !NAMES[id])];
    return ids.map(id => {
        const meter = state.routes[id];
        const probe = Object.entries(probes).filter(([key]) => key === id || key.startsWith(`${id}:`)).map(([, value]) => value);
        const health = v.health[id] || { ok: 0, fail: 0, reason: '' };
        const down = probe.find(item => item.down);
        const lastOk = lastWithin(health.ok, Math.max(0, ...probe.map(item => item.lastOk || 0)));
        return {
            id, name: nameOf(id), kind: NAMES[id]?.kind || 'Paid',
            calls: meter ? meter.calls : (v.calls[id] || 0), usd: meter ? meter.usd : 0,
            lastAnswered: lastOk, lastFailure: health.fail, failureReason: health.reason,
            downUntil: down?.downUntil || 0, inUse: v.lastRoute === id,
        };
    });
}

/** The line at the top of the Spend section, for example "US$1.12 of US$5.00 used, US$3.88 left, 3,214 calls". */
export function summaryLine(now = Date.now()) {
    const state = spendState(now);
    const calls = spendRows(now).reduce((sum, row) => sum + row.calls, 0);
    const left = Math.max(0, state.ceiling - state.total);
    return `${usd(state.total)} of ${usd(state.ceiling)} used, ${usd(left)} left, ${count(calls)} ${calls === 1 ? 'call' : 'calls'}`;
}

/** Queued jobs that wait on the ceiling, each with the words the job shows. */
export function pausedJobs(jobs = desktopQueue().jobs()) {
    return jobs.filter(job => /^Paused, monthly ceiling reached/.test(String(job.why || '')))
        .map(job => ({ key: job.key, label: JOBS[job.kind]?.label || job.kind, text: PAUSED_TEXT }));
}

const ago = (time, now = Date.now()) => {
    const seconds = Math.max(0, Math.round((now - time) / 1000));
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
    return `${Math.round(seconds / 86400)} d ago`;
};

// ---- The notes in the bar's status slot ----

const LABELS = { fallback: note => `${NAMES[note.route]?.name || note.route} down`, back: note => `${NAMES[note.route]?.name || note.route} back`, warning: () => 'Spend note', ceiling: () => 'Spend paused' };
const TONES = { fallback: 'problem', back: 'ready', warning: 'problem', ceiling: 'problem' };

export async function openSpend() {
    const { app } = await import('./panel.js');
    if (await app.openPage(SPEND_PAGE, { focusPage: true })) await app.setExpanded(true);
}

let barNotice = null;
async function syncBar() {
    if (typeof globalThis.document?.querySelector !== 'function') return;
    try {
        barNotice ||= (await import('./composer-bar.js')).setBarNotice;
        const notes = activeNotes();
        const note = notes[0];
        barNotice(note ? { id: note.id, label: LABELS[note.kind]?.(note) || 'Spend note', text: note.text, tone: TONES[note.kind] || 'problem', count: notes.length,
            actions: [{ label: 'Open Spend', run: () => openSpend() }], onDismiss: () => dismissNote(note.id) } : null);
    } catch (error) { console.warn('Roleplay Instructions could not show the spend note in the bar.', error); }
}

// ---- The sections ----

const hint = text => h('p', { class: 'ri-help' }, text);

function limitsForm(rerender, status) {
    const state = spendState();
    const input = (label, value, key) => {
        const control = h('input', { type: 'number', class: 'ri-input ri-input-num ri-spend-input', inputMode: 'decimal', min: '0', step: '0.5', value: String(value), 'aria-label': label });
        control.addEventListener('change', () => {
            const next = Number(control.value);
            if (!Number.isFinite(next) || next < 0) { status.textContent = `${label} needs a number of dollars, 0 or more.`; control.value = String(spendState()[key]); return; }
            const patch = { [key]: next };
            const now = spendState();
            // The warning stays at or under the ceiling.
            if (key === 'ceiling' && now.warning > next) patch.warning = next;
            if (key === 'warning' && next > now.ceiling) patch.warning = now.ceiling;
            const after = setSpendLimits(patch);
            status.textContent = key === 'warning' && next > now.ceiling ? `The warning stays at the ceiling, ${usd(after.ceiling)}.` : `${label} is ${usd(after[key])}.`;
            rerender();
        });
        return h('label', { class: 'ri-spend-limit' }, h('span', { class: 'ri-spend-limit-name' }, label), h('span', { class: 'ri-num' }, h('span', { class: 'ri-unit' }, 'US$'), control));
    };
    return h('div', { class: 'ri-spend-limits' }, input('Monthly ceiling', state.ceiling, 'ceiling'), input('Warning at', state.warning, 'warning'),
        button('Restore US$5 and US$4', () => { setSpendLimits({ ceiling: DEFAULT_CEILING, warning: DEFAULT_WARNING }); status.textContent = 'Limits restored.'; rerender(); }, { kind: 'ghost' }));
}

function rowView(row, now) {
    const facts = [];
    if (row.inUse) facts.push(h('span', { class: 'ri-spend-chip ri-spend-inuse' }, 'In use'));
    facts.push(h('span', { class: 'ri-spend-fact' }, row.lastAnswered ? `Last answered ${ago(row.lastAnswered, now)}` : 'No answer yet this session'));
    if (row.lastFailure) facts.push(h('span', { class: 'ri-spend-fact' }, `Last failure ${ago(row.lastFailure, now)}${row.failureReason ? `: ${row.failureReason}` : ''}`));
    if (row.downUntil > now) facts.push(h('span', { class: 'ri-spend-chip ri-spend-down' }, `Skipped until ${new Date(row.downUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`));
    const cost = row.kind === 'Paid' || row.usd ? usd(row.usd, row.usd && row.usd < 0.01 ? 4 : 2) : 'free';
    return h('li', { class: 'ri-spend-row', 'data-route': row.id },
        h('div', { class: 'ri-spend-row-head' }, h('span', { class: 'ri-spend-route' }, row.name), h('span', { class: 'ri-spend-kind' }, row.kind),
            h('span', { class: 'ri-spend-calls' }, `${count(row.calls)} ${row.calls === 1 ? 'call' : 'calls'}, ${cost}`)),
        h('div', { class: 'ri-spend-row-facts' }, facts));
}

/** One notice with its own Dismiss. The bar shows the same note, and dismissing in either place clears both. */
function noticeRow(note) {
    const label = LABELS[note.kind]?.(note) || 'Spend note';
    return h('div', { class: 'ri-spend-notice', role: 'note', 'data-kind': note.kind, 'data-note': note.id },
        h('span', { class: 'ri-spend-notice-text' }, h('strong', {}, `${label}: `), note.text),
        h('button', { type: 'button', class: 'ri-btn ri-btn-ghost ri-spend-dismiss', 'aria-label': `Dismiss ${label}`, onclick: () => dismissNote(note.id) }, 'Dismiss'));
}

/** Setup, Connections, Spend. */
export function renderSpendPage(body) {
    const host = h('div', { class: 'ri-spend', id: 'ri-spend' });
    const status = h('p', { class: 'ri-help', role: 'status', id: 'ri-spend-status' });
    const draw = () => {
        const now = Date.now();
        const state = spendState(now);
        const used = state.ceiling > 0 ? Math.min(1, state.total / state.ceiling) : 1;
        const bar = h('div', { class: 'ri-spend-meter', role: 'meter', 'aria-label': 'Paid background spend this month', 'aria-valuemin': '0', 'aria-valuemax': String(state.ceiling), 'aria-valuenow': String(state.total), 'data-state': state.atCeiling ? 'ceiling' : state.overWarning ? 'warning' : 'ok' },
            h('div', { class: 'ri-spend-meter-fill', style: { width: `${Math.round(used * 100)}%` } }));
        const notes = activeNotes(now);
        // The standing line stays until a note says the same thing, so a dismissed note never hides the state.
        const stated = notes.some(note => note.kind === (state.atCeiling ? 'ceiling' : 'warning'));
        const paused = pausedJobs();
        const paidCalls = state.calls.slice(-20).reverse();
        const rows = spendRows(now);
        host.replaceChildren(...[
            h('p', { class: 'ri-spend-summary', id: 'ri-spend-summary' }, summaryLine(now)), bar,
            hint(['This month’s paid background spend resets on the first. Taps and chat replies through your main connection stay outside the ceiling.', howItWorks('Background work means calls the extension makes that no tap starts: capture, filing, catch-up, upkeep, follow-through checks, roll judgments and Options.')]),
            state.overWarning && !stated ? h('p', { class: 'ri-spend-warning', role: 'note' }, state.atCeiling ? `${usd(state.ceiling)} ceiling reached. Paid background calls pause until the first of next month or until you raise it; free and local routes carry on.`
                : `${usd(state.warning)} warning point passed. Paid background calls pause at ${usd(state.ceiling)}.`) : null,
            notes.length ? h('div', { class: 'ri-spend-notices', role: 'group', 'aria-label': 'Notices' }, notes.map(noticeRow)) : null,
            h('h4', { class: 'ri-spend-head' }, 'Limits'), limitsForm(draw, status), status,
            h('h4', { class: 'ri-spend-head' }, 'This month, by route'),
            h('ul', { class: 'ri-spend-rows', 'aria-label': 'Calls, cost and health per route' }, rows.map(row => rowView(row, now))),
            hint('Each background job tries the desktop first, then the NanoGPT plan, then free tiers, then paid routes within the ceiling, then the Main API. A route that does not answer is skipped for 10 minutes and checked again only when a job needs it.'),
            paused.length ? h('div', { class: 'ri-spend-paused' }, h('h4', { class: 'ri-spend-head' }, 'Paused jobs'),
                h('ul', { class: 'ri-spend-rows' }, paused.map(job => h('li', { class: 'ri-spend-row' }, h('span', { class: 'ri-spend-route' }, job.label), ' ',
                    h('span', { class: 'ri-spend-fact' }, job.text), ' ',
                    h('a', { href: '#ri-spend-summary', class: 'ri-spend-link', onclick: event => { event.preventDefault(); host.querySelector('#ri-spend-summary')?.scrollIntoView({ block: 'start' }); } }, 'Spend'))))) : null,
            h('details', { class: 'ri-spend-calls-list' }, h('summary', {}, `Paid background calls this month (${state.calls.length})`),
                paidCalls.length ? h('ul', { class: 'ri-spend-rows' }, paidCalls.map(call => h('li', { class: 'ri-spend-row' },
                    h('span', { class: 'ri-spend-route' }, nameOf(call.route)), ' ', h('span', { class: 'ri-spend-fact' }, `${call.model || 'model not named'}, ${call.job || 'job'}, ${new Date(call.time).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`), ' ',
                    h('span', { class: 'ri-spend-calls' }, usd(call.usd, call.usd && call.usd < 0.01 ? 4 : 2))))) : hint('No paid background call yet this month.'))].filter(Boolean));
    };
    draw();
    body.append(host);
    const stop = onSpendView(() => {
        if (!host.isConnected) { stop(); return; }
        // A redraw would pull the number field out from under a thumb.
        if (host.contains(document.activeElement) && document.activeElement?.matches?.('input')) return;
        draw();
    });
}

function phoneRow(host) {
    const row = h('div', { class: 'ri-spend-phone', id: 'ri-phone-model' });
    let busy = null;
    const words = info => {
        if (info.status === 'downloading') return `Downloading, ${Math.round((info.progress || 0) * 100)} percent of ${PHONE_MODEL.size}`;
        if (info.status === 'loaded') return 'On the phone and loaded';
        if (info.status === 'ready') return 'On the phone';
        if (info.status === 'error') return `Did not download: ${info.error}`;
        return `Not on the phone. ${PHONE_MODEL.size} download`;
    };
    // phoneModelStatus reports its own reading as a change, so a redraw waits for a status or a tenth of progress that differs.
    let shown = '', drawing = false;
    const stamp = info => `${info.status}|${Math.round((info.progress || 0) * 10)}|${info.error || ''}`;
    const draw = async () => {
        if (drawing) return;
        drawing = true;
        const info = await phoneModelStatus().finally(() => { drawing = false; });
        shown = stamp(info);
        const act = info.action === 'Download' ? () => {
            busy = new AbortController();
            tapDownloadPhoneModel({ signal: busy.signal }).catch(() => {}).finally(() => { busy = null; draw(); });
            draw();
        } : info.action === 'Cancel' ? () => busy?.abort()
            : async () => { if (await confirmBox(`Delete the on-phone model? It frees ${PHONE_MODEL.size}, and Download stays off until you tap it.`)) { await deletePhoneModel(); draw(); } };
        row.replaceChildren(h('div', { class: 'ri-spend-route' }, info.label), h('div', { class: 'ri-spend-fact', role: 'status' }, words(info)),
            button(info.action, act, { kind: info.action === 'Delete' ? 'ghost' : '' }));
    };
    draw();
    const stop = onPhoneModel(state => { if (!host.isConnected) { stop(); return; } if (stamp(state) !== shown) draw(); });
    return row;
}

function keyForm() {
    const status = h('p', { class: 'ri-help', role: 'status', id: 'ri-jev-status' }, hasJevKey() ? 'A key is saved.' : 'No key is saved.');
    // The field never holds a saved key: it starts empty and clears after Save, so the value is not on the screen.
    const input = h('input', { type: 'password', class: 'ri-input ri-spend-key', id: 'ri-jev-key', autocomplete: 'off', autocapitalize: 'off', spellcheck: false,
        'aria-label': 'OpenRouter key for jev-1.13', placeholder: hasJevKey() ? 'Saved. Enter a new key to replace it' : 'Paste your OpenRouter key' });
    const save = button('Save key', () => {
        const value = input.value.trim();
        if (!value) { status.textContent = 'Paste a key first.'; return; }
        setJevKey(value);
        input.value = '';
        input.placeholder = 'Saved. Enter a new key to replace it';
        status.textContent = 'Key saved. Judgment calls use jev-1.13 when the desktop and the phone give no answer.';
    });
    const remove = button('Remove key', () => {
        setJevKey('');
        input.value = '';
        input.placeholder = 'Paste your OpenRouter key';
        status.textContent = 'Key removed. Judgment calls use jev-router through your saved OpenRouter connection.';
    }, { kind: 'ghost' });
    return h('div', { class: 'ri-spend-key-form' }, h('label', { class: 'ri-label', for: 'ri-jev-key' }, 'OpenRouter key for jev-1.13'), input,
        h('div', { class: 'ri-row' }, save, remove), status,
        hint(['Used for judgment calls on OpenRouter after the desktop and the on-phone model gave no answer. It stays on this device, goes only to OpenRouter and is never shown again.', howItWorks('The key calls jev-1.13 and is kept in this extension’s settings. Without a key, judgment calls use jev-router through your saved OpenRouter connection. Calls count toward the ceiling.')]));
}

/** Setup, Connections, Background jobs. */
export function renderBackgroundJobsPage(body) {
    const host = h('div', { class: 'ri-spend', id: 'ri-background-jobs' });
    host.append(jobsSection(), h('h4', { class: 'ri-spend-head' }, 'Decision model'), keyForm(),
        h('h4', { class: 'ri-spend-head' }, 'On-phone model'), phoneRow(host),
        hint('The on-phone model answers short judgment items when the desktop does not. It downloads by itself on Wi-Fi; Delete turns that off until you tap Download.'),
        h('h4', { class: 'ri-spend-head' }, 'Desktop'),
        h('a', { class: 'ri-spend-link', href: GUIDE_URL, target: '_blank', rel: 'noopener noreferrer' }, 'Desktop setup guide for background memory jobs'));
    body.append(host);
}

let mounted = false;
/** Register the two sections and start hearing the routes and the meter. Called once when the extension loads. */
export function mountConnectionsSpend() {
    if (mounted || !globalThis.SillyTavern?.getContext) return;
    mounted = true;
    registerPage({ id: SPEND_PAGE, group: 'setup', tab: 'connections', subgroup: 'Connections', label: 'Spend', withoutChat: true, order: 1,
        help: 'This month\'s paid background spend per route against your monthly ceiling, and the health of each route.',
        aliases: 'spend ceiling budget cost money paid routes health fallback warning paused', render: renderSpendPage });
    registerPage({ id: JOBS_PAGE, group: 'setup', tab: 'connections', subgroup: 'Connections', label: 'Background jobs', withoutChat: true, order: 2,
        help: 'Each background job and the routes it tries in order, with Test per route, the OpenRouter key for jev-1.13, the on-phone model and the desktop guide.',
        aliases: 'jobs routes chain reorder reset recommended test probe jev key openrouter on-phone model gemma download delete desktop ollama tailscale guide', render: renderBackgroundJobsPage });
    onChainResult(result => recordChainResult(result));
    onSpend(event => spendEvent(event));
    onSpendView(() => { syncBar(); });
    syncBar();
}
try { mountConnectionsSpend(); } catch (error) { console.warn('Roleplay Instructions could not add Setup, Connections, Spend.', error); }
