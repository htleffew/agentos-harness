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
        chance: 100, restAfter: 0, after: '', hint: '', locked: false,
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
    return { type: 'event', uid: 0, name, on: true, chance: 10, keep: 0, wait: 5, notBefore: 0, sentAs: 'system', notes: '', categories: defaultCategories(), isNew: true };
}

const MOODS = ['on edge', 'irritable', 'focused', 'plotting', 'carried away', 'confident', 'scared', 'lucky', 'emboldened', 'nervous', 'reckless', 'playful', 'defiant', 'stubborn', 'hopeful', 'suspicious', 'smug'];

export function defaultStyleCategories() {
    return [
        newCategory("{{char}}'s mood", MOODS, { mode: 'keepRandom', keepMin: 4, keepMax: 8,
            after: "this mood drives at least one of {{char}}'s choices and colours {{char}}'s established feelings, which stay as they are",
            hint: 'A temperament for the main character over a stretch of the story, in one to three words, such as on edge, playful, defiant or suspicious. A temperament, never a circumstance.' }),
        newCategory('Prose style', ['short sentences and concrete nouns', 'long, flowing sentences with few adjectives', 'plain words and brisk rhythm', 'close attention to small physical actions', 'spare description and plenty of spoken lines'], { mode: 'keepRandom', keepMin: 4, keepMax: 8,
            hint: 'One instruction about sentence length, word choice or what the prose pays attention to, in 4 to 12 words.' }),
        newCategory('In the manner of this author', [], { on: false, mode: 'keepRandom', keepMin: 6, keepMax: 10,
            hint: 'The name of one published prose author with a recognisable style. The name only.' }),
        newCategory('Writing habits', ['dry understatement', 'one-line paragraphs at tense moments', 'spoken lines that leave the important thing implied by action', 'each paragraph ends on a concrete image', 'humour that comes from what people do'], { on: false, mode: 'keepRandom', keepMin: 6, keepMax: 10,
            hint: 'One concrete writing habit of a skilled novelist, stated as an instruction in 3 to 10 words.' }),
        newCategory('Sense to lead with', ['sound', 'touch and temperature', 'smell', 'light and colour', 'movement'], { on: false, mode: 'keepRandom', keepMin: 2, keepMax: 4,
            hint: 'One of the senses, or one kind of physical detail, in one to four words.' }),
        newCategory('Pacing', ['linger on small actions', 'brisk, moving quickly between moments', 'one continuous moment, told closely', 'cover more time in fewer words'], { on: false, mode: 'keepRandom', keepMin: 2, keepMax: 4,
            hint: 'One instruction about how much time the reply covers and how fast it moves, in 3 to 10 words.' }),
        newCategory('Rule for this reply', ['the reply is all action and description, with nothing spoken aloud', 'the reply is mostly spoken lines', 'the reply stays inside one continuous minute', 'every paragraph is two sentences or fewer', 'the reply uses one sense only'], { on: false, mode: 'new', chance: 50, restAfter: 1,
            hint: 'One formal rule for the prose of a single reply, stated as a plain fact about the reply, in 6 to 14 words.' }),
        newCategory('Point of view and tense', ['third person, past tense', 'third person, present tense', 'first person, past tense', 'first person, present tense'], { on: false, locked: true, mode: 'keepFixed',
            hint: 'A narrative point of view and tense, in three to six words.' }),
    ];
}

/** A new writing style set's single entry, as the panel edits it. */
export function newStyle(name) {
    return { type: 'style', uid: 0, name, on: true, chance: 100, keep: 0, wait: 0, notBefore: 0, sentAs: 'system', notes: '', categories: defaultStyleCategories(), isNew: true };
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
    out.chance = Math.max(0, Math.min(100, Math.round(Number(out.chance ?? 100))));
    out.restAfter = Math.max(0, Math.round(Number(out.restAfter) || 0));
    out.after = String(out.after || '');
    out.hint = String(out.hint || '');
    out.locked = !!out.locked;
    if (out.locked) out.on = false;
    if (!MODES[out.mode]) out.mode = 'new';
    return out;
}

export function isEvent(entry) {
    return entry?.extensions?.ri?.type === 'event';
}

export function isStyle(entry) {
    return entry?.extensions?.ri?.type === 'style';
}

/** The story event entry (or the writing style entry) of a lorebook, or null. */
export function findEventEntry(data, type = 'event') {
    return Object.values(data?.entries || {}).find(e => e?.extensions?.ri?.type === type) || null;
}

export function readEvent(entry, name) {
    const ri = entry.extensions.ri;
    return {
        type: ri.type === 'style' ? 'style' : 'event',
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
        parts.push(`${cat.name}: ${body}${cat.after ? ` (${clean(cat.after)})` : ''}`);
    }
    if (!parts.length) return '';
    return `${w.pre}${ev.type === 'style' ? styleSentence(parts) : eventSentence(parts)}${w.post}`;
}

function eventSentence(parts) {
    return `an event must happen in the story, built from these parts: ${parts.join('; ')}. Fit it to the people, place and facts already established.`;
}

function styleSentence(parts) {
    return `write the story prose in this style: ${parts.join('; ')}. This style applies to the story prose only: tagged or formatted blocks keep their exact format and position, and "first line" means the first line of prose. Every event, fact and choice stays as it would otherwise be, and a required instruction wins over any style choice.`;
}

/** Write the panel's view of an event set back into its lorebook entry. */
export function writeEvent(data, ev) {
    if (!data.entries) data.entries = {};
    let entry = data.entries[ev.uid];
    if (!entry) { entry = blankEntry(ev.uid); data.entries[ev.uid] = entry; }
    const style = ev.type === 'style';
    entry.comment = `${style ? 'Writing style' : 'Story event'}: ${ev.name}`;
    entry.disable = !ev.on;
    entry.constant = true;
    entry.useProbability = true;
    // A writing style is sent with every reply; its categories do their own timing.
    entry.probability = style ? 100 : Math.max(0, Math.min(100, Math.round(Number(ev.chance) || 0)));
    entry.sticky = style ? null : keepToSticky(ev.keep) || null;
    entry.cooldown = style ? null : waitToCooldown(ev.wait, ev.keep) || null;
    entry.delay = style ? null : replyNumberToDelay(ev.notBefore) || null;
    entry.position = 4; entry.depth = 1;
    entry.role = (SENT_AS[ev.sentAs] || SENT_AS.system).role;
    entry.excludeRecursion = true; entry.preventRecursion = true;
    const ri = { v: 1, type: style ? 'style' : 'event', sentAs: ev.sentAs, notes: ev.notes, categories: ev.categories.map(normalCategory) };
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
        const keepingOn = cat.mode === 'keepRandom' && Number(old.left) > 0 && (old.picks || []).length && old.picks.every(id => byId.has(id));
        const idle = (rest) => { state.cats[cat.id] = { picks: [], left: 0, used, recent: cat.itemWait ? recent : [], rest }; };
        if (cat.mode !== 'keepFixed' && !keepingOn) {
            // A fresh pick is due. The category may be resting after its last pick, or may sit this one out by chance.
            if (Number(old.rest) > 0) { idle(Number(old.rest) - 1); continue; }
            if (cat.chance < 100 && rollInt(100) >= cat.chance) { idle(0); continue; }
        }

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
        const lastOfItsRun = cat.mode === 'new' || (cat.mode === 'keepRandom' && left === 0);
        state.cats[cat.id] = { picks, left, used, recent: cat.itemWait ? [...recent, picks].slice(-cat.itemWait) : [], rest: lastOfItsRun ? cat.restAfter : 0 };
        parts.push({ name: cat.name, items: picks.map(id => byId.get(id).text), after: cat.after });
    }
    const lines = parts.map(p => `${p.name}: ${p.items.join(' and ')}${p.after ? ` (${p.after})` : ''}`);
    if (ri?.type === 'style') return { text: parts.length ? styleSentence(lines) : null, parts, state };
    if (!parts.length) return null;
    return { text: eventSentence(lines), parts, state };
}
