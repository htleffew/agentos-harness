// The monthly meter for paid model calls (memory DESIGN 9.4 and 10). Every paid call, background or tapped (B59),
// reserves its estimated cost before it is sent and settles at the provider's reported cost, or the catalog price when
// none comes back.
// A call that timed out keeps its reservation as spent, because the provider may still bill it. At the warning point
// one notice shows per month; at the ceiling every paid entry in a chain is skipped until the first of next month.
import { settings, saveSettings } from './store.js';
import { toast } from './st.js';

export const DEFAULT_CEILING = 5;
export const DEFAULT_WARNING = 4;

/** B59: the line a paid call refused at the ceiling shows, with where to raise it. */
export const CEILING_LINE = 'The monthly spend ceiling is reached. Raise it in Setup, Connections, Spend.';

const listeners = new Set();
const reservations = new Map();
let reservationSerial = 0;

/** The calendar month a time falls in, as YYYY-MM in local time. The meter resets on the first of each month. */
export const monthOf = (now = Date.now()) => {
    const d = new Date(now);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const money = value => Math.round(Number(value || 0) * 1e6) / 1e6;
const usd = value => `US$${Number(value || 0).toFixed(2)}`;

function meter(now = Date.now()) {
    const st = settings();
    const spend = st.spend && typeof st.spend === 'object' ? st.spend : (st.spend = {});
    if (!Number.isFinite(Number(spend.ceiling)) || Number(spend.ceiling) < 0) spend.ceiling = DEFAULT_CEILING;
    if (!Number.isFinite(Number(spend.warning)) || Number(spend.warning) < 0) spend.warning = DEFAULT_WARNING;
    const month = monthOf(now);
    if (spend.month !== month) {
        spend.month = month;
        spend.total = 0;
        spend.routes = {};
        spend.calls = [];
        spend.warned = false;
    }
    spend.total = money(spend.total);
    spend.routes ||= {};
    spend.calls ||= [];
    return spend;
}

const reserved = () => [...reservations.values()].reduce((sum, item) => sum + item.usd, 0);

/** This month's meter: total, ceiling, warning point, per-route lines and the state the chains act on. */
export function spendState(now = Date.now()) {
    const spend = meter(now);
    const held = money(reserved());
    return {
        month: spend.month, total: spend.total, reserved: held, ceiling: Number(spend.ceiling), warning: Number(spend.warning),
        routes: structuredClone(spend.routes), calls: structuredClone(spend.calls), warned: !!spend.warned,
        overWarning: spend.total >= Number(spend.warning), atCeiling: spend.total + held >= Number(spend.ceiling),
    };
}

/** Change the ceiling or the warning point. B19's Spend section calls this. */
export function setSpendLimits({ ceiling, warning } = {}, now = Date.now()) {
    const spend = meter(now);
    if (ceiling !== undefined && Number.isFinite(Number(ceiling)) && Number(ceiling) >= 0) spend.ceiling = Number(ceiling);
    if (warning !== undefined && Number.isFinite(Number(warning)) && Number(warning) >= 0) spend.warning = Number(warning);
    saveSettings();
    return spendState(now);
}

/** Whether a paid call of this estimated cost may start now. */
export function canSpend(estimate = 0, now = Date.now()) {
    const spend = meter(now);
    return spend.total + reserved() + Math.max(0, Number(estimate) || 0) <= Number(spend.ceiling) && spend.total < Number(spend.ceiling);
}

/** Hold an estimated cost against the ceiling before a paid call is sent. Returns null when the ceiling forbids it. */
export function reserveSpend({ route = '', estimate = 0 } = {}, now = Date.now()) {
    if (!canSpend(estimate, now)) return null;
    const id = `r${++reservationSerial}`;
    reservations.set(id, { route: String(route), usd: money(Math.max(0, Number(estimate) || 0)) });
    return id;
}

/** Let go of a reservation for a call that never reached the provider. */
export function releaseSpend(id) {
    reservations.delete(id);
}

/**
 * Record one paid call. cost: the provider's figure when it reported one, else the catalog price for the tokens.
 * basis: 'usage', 'catalog', 'reserved' (a timed-out call) or 'unpriced'. Releases the reservation if one is given.
 */
export function recordSpend({ route = '', model = '', cost = 0, basis = 'usage', reservation = '', job = '', tokens = null } = {}, now = Date.now()) {
    if (reservation) reservations.delete(reservation);
    const spend = meter(now);
    const amount = money(Math.max(0, Number(cost) || 0));
    spend.total = money(spend.total + amount);
    const line = spend.routes[route] ||= { usd: 0, calls: 0 };
    line.usd = money(line.usd + amount);
    line.calls += 1;
    spend.calls.push({ time: now, route: String(route), model: String(model), job: String(job), usd: amount, basis, ...(tokens ? { tokens } : {}) });
    if (spend.calls.length > 200) spend.calls.splice(0, spend.calls.length - 200);
    let warning = false;
    if (!spend.warned && spend.total >= Number(spend.warning)) {
        spend.warned = true;
        warning = true;
    }
    saveSettings();
    const state = spendState(now);
    if (warning) {
        toast('warning', `Paid spend this month is ${usd(state.total)} of the ${usd(state.ceiling)} ceiling. Paid calls pause at the ceiling.`);
        for (const fn of listeners) { try { fn({ type: 'warning', state }); } catch { /* a listener must not stop the meter */ } }
    }
    if (state.atCeiling) for (const fn of listeners) { try { fn({ type: 'ceiling', state }); } catch { /* as above */ } }
    return state;
}

/** Hear the warning and the ceiling as they are reached. Returns a function that stops listening. */
export function onSpend(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** Cost of a call from catalog prices in US dollars per million tokens. */
export function catalogCost(price, inputTokens = 0, outputTokens = 0) {
    if (!price) return null;
    const input = Number(price.in ?? price.input ?? 0), output = Number(price.out ?? price.output ?? 0);
    if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
    return money((input * Math.max(0, inputTokens) + output * Math.max(0, outputTokens)) / 1e6);
}

/** Test hook: forget reservations held in memory. */
export function resetSpendReservations() {
    reservations.clear();
}
