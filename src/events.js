// Random Story Events. An event set is a lorebook with one entry. The entry holds categories (Situation,
// Complication, ...), each with a list of items. When the entry fires, dice pick items from the categories that
// are on, and one order is sent: an event must happen, built from those parts.
import { SENT_AS, blankEntry, toStore, keepToSticky, waitToCooldown, replyNumberToDelay, stickyToKeep, cooldownToWait, delayToReplyNumber, pickWeighted, rollInt } from './books.js';

export const MODES = {
    new: { label: 'New pick every time', help: 'Each event gets a fresh pick from this category.' },
    keepRandom: { label: 'Keep for a random number of events', help: 'The pick stays for several events in a row, then changes.' },
    keepFixed: { label: 'Keep until I turn it off', help: 'You choose the item. Every event uses it until you change this.' },
};

let counter = 0;
export const newId = () => `${Date.now().toString(36)}${(counter++).toString(36)}${rollInt(1296).toString(36)}`;

export function newCategory(name, items = [], extra = {}) {
    return { id: newId(), name, on: true, mode: 'new', fixed: '', keepMin: 2, keepMax: 4, count: 1, useAll: true, itemWait: 0, neverTags: '', driver: false,
        items: items.map(text => ({ id: newId(), text, on: true, weight: 1, tags: '', always: false })), ...extra };
}

export function defaultCategories() {
    return [
        newCategory('Situation'),
        newCategory('Complication'),
        newCategory('Who drives it', ['{{char}}', 'a named character who is present, other than {{user}}', 'someone new who arrives', 'the surroundings: weather, a place, an object, an animal or a crowd'], { driver: true }),
        newCategory('Tone'),
    ];
}

/** A new event set's single entry, as the panel edits it. */
export function newEvent(name) {
    return { uid: 0, name, on: true, chance: 10, keep: 0, wait: 5, notBefore: 0, sentAs: 'system', notes: '', categories: defaultCategories(), isNew: true };
}

const tagList = s => String(s || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean);

function normalCategory(c) {
    const base = newCategory(String(c?.name || 'Category'));
    const out = { ...base, ...c, id: String(c?.id || base.id) };
    out.items = (Array.isArray(c?.items) ? c.items : []).map(it => ({ id: String(it?.id || newId()), text: String(it?.text ?? ''), on: it?.on !== false, weight: Math.max(1, Math.round(Number(it?.weight) || 1)), tags: String(it?.tags || ''), always: !!it?.always })).filter(it => it.text.trim());
    out.count = Math.max(1, Math.min(5, Math.round(Number(out.count) || 1)));
    out.keepMin = Math.max(1, Math.round(Number(out.keepMin) || 1));
    out.keepMax = Math.max(out.keepMin, Math.round(Number(out.keepMax) || out.keepMin));
    out.itemWait = Math.max(0, Math.round(Number(out.itemWait) || 0));
    if (!MODES[out.mode]) out.mode = 'new';
    return out;
}

export function isEvent(entry) {
    return entry?.extensions?.ri?.type === 'event';
}

/** The event entry of a lorebook, or null. */
export function findEventEntry(data) {
    return Object.values(data?.entries || {}).find(isEvent) || null;
}

export function readEvent(entry, name) {
    const ri = entry.extensions.ri;
    return {
        uid: entry.uid, name, on: !entry.disable,
        chance: entry.useProbability === false ? 100 : Math.max(0, Math.min(100, Number(entry.probability ?? 100))),
        keep: stickyToKeep(entry.sticky), wait: cooldownToWait(entry.cooldown, entry.sticky), notBefore: delayToReplyNumber(entry.delay),
        sentAs: ri.sentAs === 'ooc' ? 'ooc' : 'system', notes: String(ri.notes || ''),
        categories: (Array.isArray(ri.categories) ? ri.categories : []).map(normalCategory),
    };
}

/** Items of a category that the dice may use. */
function usable(cat) {
    const never = new Set(tagList(cat.neverTags));
    return cat.items.filter(it => it.on && it.text.trim() && !tagList(it.tags).some(t => never.has(t)));
}

/** The entry text saved in the lorebook, so the set also works (with plain random picks) when the extension is off. */
export function buildEventContent(ev) {
    const w = SENT_AS[ev.sentAs] || SENT_AS.system;
    const clean = t => toStore(t).replace(/\s*\n+\s*/g, ' ').replace(/::/g, ':').trim();
    const parts = [];
    for (const cat of ev.categories) {
        if (!cat.on) continue;
        const pool = usable(cat);
        if (!pool.length) continue;
        const fixed = cat.mode === 'keepFixed' ? pool.find(it => it.id === cat.fixed) : null;
        const body = fixed ? clean(fixed.text) : (pool.length === 1 ? clean(pool[0].text) : `{{random::${pool.map(it => clean(it.text)).join('::')}}}`);
        parts.push(`${cat.name}: ${body}`);
    }
    if (!parts.length) return '';
    return `${w.pre}${eventSentence(parts)}${w.post}`;
}

function eventSentence(parts) {
    return `an event must happen in the story, built from these parts: ${parts.join('; ')}. Fit it to the people, place and facts already established.`;
}

/** Write the panel's view of an event set back into its lorebook entry. */
export function writeEvent(data, ev) {
    if (!data.entries) data.entries = {};
    let entry = data.entries[ev.uid];
    if (!entry) { entry = blankEntry(ev.uid); data.entries[ev.uid] = entry; }
    entry.comment = `Story event: ${ev.name}`;
    entry.disable = !ev.on;
    entry.constant = true;
    entry.useProbability = true;
    entry.probability = Math.max(0, Math.min(100, Math.round(Number(ev.chance) || 0)));
    entry.sticky = keepToSticky(ev.keep) || null;
    entry.cooldown = waitToCooldown(ev.wait, ev.keep) || null;
    entry.delay = replyNumberToDelay(ev.notBefore) || null;
    entry.position = 4; entry.depth = 1;
    entry.role = (SENT_AS[ev.sentAs] || SENT_AS.system).role;
    entry.excludeRecursion = true; entry.preventRecursion = true;
    const ri = { v: 1, type: 'event', sentAs: ev.sentAs, notes: ev.notes, categories: ev.categories.map(normalCategory) };
    entry.extensions = { ...(entry.extensions || {}), ri };
    entry.content = buildEventContent(ev);
    return entry;
}

/**
 * Roll the dice for one event.
 * ri: the entry's saved event data. prev: the category state stored with the last event of this set (or null).
 * Returns { text, parts: [{ name, items: [text] }], state } or null when no category has anything to pick.
 */
export function rollEvent(ri, prev) {
    const parts = [];
    const state = { cats: {} };
    for (const raw of Array.isArray(ri?.categories) ? ri.categories : []) {
        const cat = normalCategory(raw);
        if (!cat.on) continue;
        const pool = usable(cat);
        if (!pool.length) continue;
        const byId = new Map(pool.map(it => [it.id, it]));
        const old = prev?.cats?.[cat.id] || {};
        let used = (Array.isArray(old.used) ? old.used : []).filter(id => byId.has(id));
        const recent = (Array.isArray(old.recent) ? old.recent : []).slice(-cat.itemWait || undefined).slice(0, cat.itemWait ? undefined : 0);
        let picks = null;
        let left = 0;

        if (cat.mode === 'keepFixed') {
            const chosen = byId.get(cat.fixed) || byId.get((old.picks || [])[0]);
            if (chosen) picks = [chosen.id];
        } else if (cat.mode === 'keepRandom' && Number(old.left) > 0 && (old.picks || []).length && old.picks.every(id => byId.has(id))) {
            picks = [...old.picks];
            left = Number(old.left) - 1;
        }

        if (!picks) {
            const always = pool.filter(it => it.always).slice(0, cat.count);
            picks = always.map(it => it.id);
            const need = cat.count - picks.length;
            if (need > 0) {
                const rest = pool.filter(it => !picks.includes(it.id));
                const resting = new Set(recent.flat());
                let options = rest.filter(it => !(cat.useAll && used.includes(it.id)) && !resting.has(it.id));
                if (options.length < need) {
                    // Every item has had its turn: start the round again, still leaving out the ones that just appeared.
                    if (cat.useAll) used = [];
                    options = rest.filter(it => !resting.has(it.id));
                    if (options.length < need) options = rest;
                }
                picks.push(...pickWeighted(options, it => it.weight, need).map(it => it.id));
            }
            if (cat.useAll) used = [...new Set([...used, ...picks])];
            if (cat.mode === 'keepRandom') left = cat.keepMin + rollInt(cat.keepMax - cat.keepMin + 1) - 1;
        }
        if (!picks.length) continue;
        state.cats[cat.id] = { picks, left, used, recent: cat.itemWait ? [...recent, picks].slice(-cat.itemWait) : [] };
        parts.push({ name: cat.name, items: picks.map(id => byId.get(id).text) });
    }
    if (!parts.length) return null;
    return { text: eventSentence(parts.map(p => `${p.name}: ${p.items.join(' and ')}`)), parts, state };
}
