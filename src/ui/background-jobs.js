// Setup, Connections, Background jobs: each job in src/routing.js JOBS with its chain of routes, Up and Down to reorder,
// Reset to the recommended chain, and Test per route (B55, memory DESIGN 12.2). Routing stays automatic with no approval
// step (DECISIONS 2026-11-23); this section shows and adjusts. Test makes one request that lists a route's models, so it
// costs nothing. It lives apart from connections-spend.js, which keeps no probes of its own (t_spend_ceiling.js).
import { h } from './dom.js';
import { settings } from '../store.js';
import { ctx, probeCustomUrl } from '../st.js';
import { JOBS, RECOMMENDED_CHAINS, ROUTES, chainFor, resolveRoute, routeHealth, setJobChain } from '../routing.js';
import { costClassOf } from './connections-spend.js';

const hint = text => h('p', { class: 'ri-help' }, text);


const COST_WORDS = { local: 'Local', plan: 'Plan', free: 'Free', paid: 'Paid' };
const TIER_NAMES = { quick: 'Quick', writer: 'Writer', cleanup: 'Cleanup' };
const took = ms => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
const sameChain = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const savedChain = jobId => { const chain = settings().routing?.chains?.[jobId]; return Array.isArray(chain) ? chain : null; };
/** The job whose chain this job follows, or '' when it has its own (a saved chain of its own ends the sharing). */
const followsJob = jobId => (JOBS[jobId]?.chain && !savedChain(jobId) ? JOBS[jobId].chain : '');
const recommendedFor = jobId => RECOMMENDED_CHAINS[jobId] || RECOMMENDED_CHAINS[JOBS[jobId]?.chain] || [{ route: 'main' }];

async function statusProbe(source, timeoutMs) {
    const host = ctx();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const headers = typeof host.getRequestHeaders === 'function' ? host.getRequestHeaders() : { 'Content-Type': 'application/json' };
        const response = await globalThis.fetch('/api/backends/chat-completions/status', { method: 'POST', headers, body: JSON.stringify({ chat_completion_source: source }), signal: controller.signal });
        if (!response.ok) return false;
        const data = await response.json().catch(() => null);
        return !!data && !data.error && !data.bypass;
    } catch { return false; }
    finally { clearTimeout(timer); }
}

/**
 * Test one route with one request that lists the models it offers, so it costs nothing. A route on a local address is
 * probed the way jobs probe it (probeCustomUrl); any other route asks SillyTavern's status endpoint for its provider.
 * The on-phone model and a route no connection carries make no request. Returns { ok, ms, text }.
 */
export async function testRoute(entry, { probeMs = 4000, clock = Date.now } = {}) {
    const target = resolveRoute(entry);
    if (!target) return { ok: false, ms: 0, text: 'Not set up on this device. Save a connection for it in SillyTavern.' };
    if (target.kind === 'phone') return { ok: true, ms: 0, text: 'On the phone. Nothing to ask over the network.' };
    const started = clock();
    let up;
    if (target.kind === 'main') {
        const source = String(ctx().chatCompletionSettings?.chat_completion_source || '');
        if (!source) return { ok: true, ms: 0, text: 'The Main API is your chat connection. Nothing to ask here.' };
        up = await statusProbe(source, probeMs);
    } else if (target.kind === 'profile' && target.api === 'custom') up = await probeCustomUrl(target.url, { timeoutMs: probeMs });
    else up = await statusProbe(target.api || target.source || ROUTES[entry.route]?.source || '', probeMs);
    const ms = clock() - started;
    return up ? { ok: true, ms, text: `Answered in ${took(ms)}. Healthy.` } : { ok: false, ms, text: `No answer in ${took(ms)}. Unhealthy.` };
}

function routeRow(jobId, chain, index, ui, redraw, followed) {
    const entry = chain[index];
    const label = ROUTES[entry.route]?.label || (entry.profileId ? 'Saved connection profile' : entry.route);
    const cost = costClassOf(entry.route);
    const key = `${jobId}:${index}`;
    const result = ui.results.get(key);
    const move = delta => {
        const next = chain.map(item => ({ ...item }));
        [next[index], next[index + delta]] = [next[index + delta], next[index]];
        setJobChain(jobId, next);
        ui.focus = `${jobId}:${index + delta}:${delta < 0 ? 'up' : 'down'}`;
        ui.results.clear();
        redraw();
    };
    const mover = (name, delta, off) => h('button', { type: 'button', class: 'ri-btn ri-btn-ghost ri-job-move', 'data-move': name, 'aria-label': `Move ${label} ${name} in ${JOBS[jobId].label}`, disabled: off, onclick: () => move(delta) }, name === 'up' ? 'Up' : 'Down');
    const test = h('button', { type: 'button', class: 'ri-btn ri-btn-ghost ri-job-test', 'aria-label': `Test ${label} for ${JOBS[jobId].label}`, disabled: ui.busy.has(key), onclick: async () => {
        if (ui.busy.has(key)) return;
        ui.busy.add(key);
        redraw();
        const outcome = await testRoute(entry).catch(error => ({ ok: false, ms: 0, text: `Test failed: ${String(error?.message || error).slice(0, 120)}` }));
        ui.busy.delete(key);
        ui.results.set(key, outcome);
        ui.focus = `${jobId}:${index}:test`;
        redraw();
    } }, ui.busy.has(key) ? 'Testing' : 'Test');
    const health = routeHealth()[entry.profileId ? `${entry.route}:${entry.profileId}` : entry.route];
    return h('li', { class: 'ri-job-route', 'data-route': entry.route, 'data-index': String(index) },
        h('div', { class: 'ri-job-route-head' }, h('span', { class: 'ri-job-n' }, `${index + 1}.`), h('span', { class: 'ri-spend-route' }, label),
            h('span', { class: 'ri-spend-kind', 'data-cost': cost }, COST_WORDS[cost] || cost)),
        entry.model ? h('div', { class: 'ri-spend-fact ri-job-model' }, entry.model) : null,
        health?.down ? h('div', { class: 'ri-spend-chip ri-spend-down' }, `Skipped until ${new Date(health.downUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`) : null,
        h('div', { class: 'ri-job-actions' }, ...(followed ? [] : [mover('up', -1, index === 0), mover('down', 1, index === chain.length - 1)]), test),
        result ? h('div', { class: `ri-job-result${result.ok ? '' : ' ri-spend-down'}`, role: 'status', 'data-ok': String(result.ok) }, result.text) : null);
}

function jobCard(jobId, ui, redraw) {
    const job = JOBS[jobId];
    const chain = chainFor(jobId);
    const followed = followsJob(jobId);
    const own = !followed && !!savedChain(jobId);
    const paidAhead = own && chain.some((item, i) => costClassOf(item.route) === 'paid' && chain.slice(i + 1).some(later => ['free', 'local', 'plan'].includes(costClassOf(later.route))));
    const reset = h('button', { type: 'button', class: 'ri-btn ri-btn-ghost ri-job-reset', 'aria-label': `Reset ${job.label} to the recommended routes`, onclick: () => {
        setJobChain(jobId, null);
        ui.results.clear();
        ui.focus = `${jobId}:0:reset`;
        redraw();
    } }, 'Reset to recommended');
    return h('li', { class: 'ri-job', 'data-job': jobId },
        h('div', { class: 'ri-job-head' }, h('span', { class: 'ri-spend-route' }, job.label), h('span', { class: 'ri-spend-kind' }, `${TIER_NAMES[job.tier] || job.tier} tier`)),
        followed ? h('p', { class: 'ri-help ri-job-follows' }, `Follows ${JOBS[followed]?.label || followed}: it uses the same routes. Change them there.`)
            : h('p', { class: 'ri-help' }, own && !sameChain(chain, recommendedFor(jobId)) ? 'Your order. Reset restores the recommended routes.' : 'Recommended order.'),
        h('ol', { class: 'ri-job-chain', 'aria-label': `Routes for ${job.label}, tried in order` }, chain.map((_, index) => routeRow(jobId, chain, index, ui, redraw, followed))),
        paidAhead ? h('p', { class: 'ri-help ri-job-warn' }, 'A paid route comes before a free one. Paid calls count toward your monthly ceiling.') : null,
        own ? reset : null);
}

/** The jobs list. It reads JOBS each time it draws, so a job added in src/routing.js appears with no change here. */
export function jobsSection() {
    const ui = { results: new Map(), busy: new Set(), focus: '' };
    const list = h('ul', { class: 'ri-job-list', id: 'ri-job-list' });
    const redraw = () => {
        list.replaceChildren(...Object.keys(JOBS).map(id => jobCard(id, ui, redraw)));
        if (!ui.focus) return;
        const [job, index, what] = ui.focus.split(':');
        ui.focus = '';
        const card = list.querySelector(`[data-job="${job}"]`);
        const row = card?.querySelector(`[data-index="${index}"]`);
        const pick = what === 'reset' ? card?.querySelector('.ri-job-reset') || row?.querySelector('.ri-job-test')
            : what === 'test' ? row?.querySelector('.ri-job-test')
                : [...(row?.querySelectorAll('.ri-job-move') || [])].find(b => b.dataset.move === what && !b.disabled) || row?.querySelector('.ri-job-test');
        pick?.focus?.();
    };
    redraw();
    return h('div', { class: 'ri-jobs' }, h('h4', { class: 'ri-spend-head' }, 'Jobs and their routes'),
        hint('Routing is automatic. Each job tries its routes in this order and moves on when one does not answer; a fallback shows in the bar. Free and local routes come first, and paid routes count toward your monthly ceiling, US$5 unless you changed it. Test asks one route one question, which lists its models and costs nothing.'),
        list);
}

