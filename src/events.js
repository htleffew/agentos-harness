// Random Story Events. An event set is one lorebook entry, in a lorebook of its own or inside a shared lorebook. The entry holds categories (Situation,
// Complication, ...), each with a list of items. When the entry fires, dice pick items from the categories that
// are on, and one order is sent: an event must happen, built from those parts.
import { itemFits, fillNeed, NEEDS } from './pacing.js';
import { SENT_AS, blankEntry, entriesOf, keepTags, toStore, keepToSticky, waitToCooldown, replyNumberToDelay, stickyToKeep, cooldownToWait, delayToReplyNumber, pickWeighted, rollInt } from './books.js';

export const MODES = {
    new: { label: 'New pick every time', help: 'Each event gets a fresh pick from this category.' },
    keepRandom: { label: 'Keep for a random number of events', help: 'The pick stays for several events in a row, then changes.' },
    keepFixed: { label: 'Keep until I turn it off', help: 'You choose the item. Every event uses it until you change this.' },
};

let counter = 0;
export const newId = () => `${Date.now().toString(36)}${(counter++).toString(36)}${rollInt(1296).toString(36)}`;

export function newCategory(name, items = [], extra = {}) {
    return { id: newId(), name, on: true, mode: 'new', fixed: '', keepMin: 2, keepMax: 4, count: 1, useAll: true, itemWait: 0, burn: false, neverTags: '', driver: false,
        chance: 100, restAfter: 0, changeChance: 100, after: '', hint: '', locked: false,
        items: items.map(x => Array.isArray(x) ? { id: newId(), text: x[0], on: true, weight: 1, tags: x[1] || '', always: false } : { id: newId(), text: x, on: true, weight: 1, tags: '', always: false }), ...extra };
}

/** The list a new story event set starts with for what an event puts at stake. Every item works in any setting. */
export const STAKES = [
    '{{user}} is in immediate mortal danger',
    'something {{char}} believes about themself is challenged',
    'a secret is close to coming out',
    'someone {{char}} cares about needs help now',
    'an offer arrives that is hard to refuse',
    'a choice has to be made right away',
    '{{char}}\'s plan is suddenly in doubt',
    'someone\'s trust is put to the test',
    'something {{char}} wants comes within reach',
    'a promise is put to the test',
];
export const STAKES_NAME = 'What it puts at stake';

/**
 * What a list of a story event set is for, read from its name: who drives the event, its tone, what it puts at
 * stake, how it gets harder, or (everything else) what happens.
 */
export function listRole(cat) {
    if (cat?.driver) return 'driver';
    const n = String(cat?.name || '').toLowerCase();
    if (/tone|mood|feel|atmosphere/.test(n)) return 'tone';
    if (/stake|effect|consequence|what it (puts|means|does)/.test(n)) return 'stake';
    if (/complicat|twist|obstacle|problem|snag|catch/.test(n)) return 'complication';
    return 'situation';
}

const withOrigins = (cat, list) => { cat.items.forEach((it, i) => { if (list[i]) it.from = list[i]; }); return cat; };

export function defaultCategories() {
    return [
        newCategory('Situation', [], { burn: true }),
        newCategory('Complication', [], { burn: true }),
        newCategory('What it puts at stake', STAKES),
        withOrigins(newCategory('Who drives it', ['{{char}}', 'any character other than {{user}}, one already in the story or a new arrival', 'any female character other than {{user}}, one already in the story or a new arrival', 'any male character other than {{user}}, one already in the story or a new arrival', 'the surroundings: weather, a place, an object, an animal or a crowd'], { driver: true }), ['char', 'other', 'other', 'other', 'world']),
        newCategory('Tone'),
    ];
}

/** A new event set's single entry, as the panel edits it. */
export function newEvent(name) {
    return { type: 'event', uid: 0, name, on: true, chance: 10, keep: 0, wait: 5, notBefore: 0, sentAs: 'system', notes: '', categories: defaultCategories(), isNew: true };
}

const MOODS = ['curious', 'focused', 'plotting', 'carried away', 'confident', 'lucky', 'emboldened', 'eager', 'reckless', 'playful', 'defiant', 'stubborn', 'hopeful', 'suspicious', 'smug', 'tender', 'irritable'];

export function defaultStyleCategories() {
    return [
        newCategory("{{char}}'s mood", MOODS, { mode: 'keepRandom', keepMin: 4, keepMax: 8,
            after: "this mood drives at least one of {{char}}'s choices and colours {{char}}'s established feelings, which stay as they are",
            hint: 'A temperament for the main character over a stretch of the story, in one to three words, such as curious, playful, defiant or suspicious. A temperament, never a circumstance.' }),
        newCategory('Prose style', ['short sentences and concrete nouns', 'long, flowing sentences with few adjectives', 'plain words and brisk rhythm', 'close attention to small physical actions', 'spare description and plenty of spoken lines'], { mode: 'keepRandom', keepMin: 4, keepMax: 8,
            hint: 'One instruction about sentence length, word choice or what the prose pays attention to, in 4 to 12 words.' }),
        newCategory('In the manner of this author', [], { on: false, mode: 'keepRandom', keepMin: 6, keepMax: 10,
            hint: 'The name of one published prose author with a recognisable style. The name only.' }),
        newCategory('Writing habits', ['dry humour in plain words', 'one-line paragraphs at tense moments', 'people say plainly what they mean', 'each paragraph ends on a concrete image', 'humour that comes from what people do'], { on: false, mode: 'keepRandom', keepMin: 6, keepMax: 10,
            hint: 'One concrete writing habit of a skilled novelist, stated as an instruction in 3 to 10 words.' }),
        newCategory('Sense to lead with', ['sound', 'touch', 'smell', 'light and colour', 'movement'], { on: false, mode: 'keepRandom', keepMin: 2, keepMax: 4,
            hint: 'One of the senses, or one kind of physical detail, in one to four words.' }),
        newCategory('Pacing', ['linger on small actions', 'brisk, moving quickly between moments', 'one continuous moment, told closely', 'cover more time in fewer words'], { on: false, mode: 'keepRandom', keepMin: 2, keepMax: 4,
            hint: 'One instruction about how much time the reply covers and how fast it moves, in 3 to 10 words.' }),
        newCategory('Rule for this reply', [['the reply is all action and description, with nothing spoken aloud', 'rule:no-dialogue'], ['the reply is mostly spoken lines', 'rule:mostly-dialogue'], 'the reply stays inside one continuous minute', ['every paragraph is two sentences or fewer', 'rule:max-sentences-2'], 'the reply uses one sense only'], { on: false, mode: 'new', chance: 50, restAfter: 1,
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

/**
 * How much of each list that retires its items is left in a chat. burned: the ids that have happened.
 * Returns [{ name, left, total, main }] and whether the set is used up (its main list has none left).
 */
export function burnStatus(ri, burned) {
    const cats = (Array.isArray(ri?.categories) ? ri.categories : []).map(normalCategory).filter(c => c.on && usable(c).length);
    const main = cats.find(c => c.burn && !c.driver);
    const lists = cats.filter(c => c.burn).map((c) => { const pool = usable(c); return { name: c.name, total: pool.length, left: pool.filter(it => !burned?.has(it.id)).length, main: c === main }; });
    return { lists, usedUp: !!main && lists.find(l => l.main).left === 0 };
}

/** Where a story event comes from. A "Who drives it" item has one, and so can any other item. */
export const ORIGINS = {
    '': { label: 'Anyone or anything' },
    char: { label: '{{char}}', write: 'starts with something [[char]] does, decides or says' },
    other: { label: 'Another character', write: 'starts with something a character other than [[char]] and [[user]] does, decides or says (someone already in the story or a new arrival)' },
    world: { label: 'The surroundings', write: 'starts in the surroundings: weather, a place, an object, an animal, a crowd, or news arriving' },
};

/** The origin of an item: its own mark, or for a "Who drives it" item without one, read from its words. */
export function originOf(it, cat) {
    if (it?.from && ORIGINS[it.from]) return it.from;
    if (!cat?.driver) return '';
    const t = String(it?.text || '').toLowerCase();
    if (/surroundings|weather|crowd|animal|place|object/.test(t)) return 'world';
    if (/^\s*\{\{char\}\}\s*$/.test(t)) return 'char';
    if (/character|someone|stranger|arrival|npc/.test(t)) return 'other';
    return '';
}

/** One item of a list. need and min: what a story event item asks of the scene. The three "while this pick is in use" lines belong to writing style items. */
export function normalItem(it) {
    const out = { id: String(it?.id || newId()), text: String(it?.text ?? ''), on: it?.on !== false, weight: Math.max(1, Math.round(Number(it?.weight) || 1)), tags: String(it?.tags || ''), always: !!it?.always };
    if (it?.need && NEEDS[it.need]) out.need = it.need;
    if (it?.from && ORIGINS[it.from]) out.from = it.from;
    const min = Math.max(0, Math.min(20, Math.round(Number(it?.min) || 0)));
    if (min) out.min = min;
    for (const k of ['dEvent', 'dCheck', 'dNext']) { const v = String(it?.[k] || '').replace(/\s+/g, ' ').trim(); if (v) out[k] = v; }
    return out;
}

function normalCategory(c) {
    const base = newCategory(String(c?.name || 'Category'));
    const out = { ...base, ...c, id: String(c?.id || base.id) };
    out.items = (Array.isArray(c?.items) ? c.items : []).map(normalItem).filter(it => it.text.trim());
    out.count = Math.max(1, Math.min(5, Math.round(Number(out.count) || 1)));
    out.burn = !!out.burn;
    out.keepMin = Math.max(1, Math.round(Number(out.keepMin) || 1));
    out.keepMax = Math.max(out.keepMin, Math.round(Number(out.keepMax) || out.keepMin));
    out.itemWait = Math.max(0, Math.round(Number(out.itemWait) || 0));
    out.chance = Math.max(0, Math.min(100, Math.round(Number(out.chance ?? 100))));
    out.restAfter = Math.max(0, Math.round(Number(out.restAfter) || 0));
    out.changeChance = Math.max(0, Math.min(100, Math.round(Number(out.changeChance ?? 100))));
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

/** The story event entry (or the writing style entry) of a set, or null. id: the set, when it shares its lorebook. */
export function findEventEntry(data, type = 'event', id = '') {
    return (id ? entriesOf(data, id) : Object.values(data?.entries || {})).find(e => e?.extensions?.ri?.type === type) || null;
}

export function readEvent(entry, name) {
    const ri = entry.extensions.ri;
    return {
        type: ri.type === 'style' ? 'style' : 'event',
        uid: entry.uid, name, on: !entry.disable,
        chance: entry.useProbability === false ? 100 : Math.max(0, Math.min(100, Number(entry.probability ?? 100))),
        keep: stickyToKeep(entry.sticky), wait: cooldownToWait(entry.cooldown, entry.sticky), notBefore: delayToReplyNumber(entry.delay),
        sentAs: ri.sentAs === 'ooc' ? 'ooc' : 'system', notes: String(ri.notes || ''),
        big: !!ri.big,
        neverTogether: String(ri.neverTogether || ''), presets: ri.presets && typeof ri.presets === 'object' ? structuredClone(ri.presets) : {},
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
    return `an event must happen in the story, built from these parts: ${parts.join('; ')}. Fit it to the people, place and facts already established. If a part names something that is not in this scene, keep what that part does to the people and change how it happens.`;
}

function styleSentence(parts) {
    return `write the story prose in this style: ${parts.join('; ')}. This style applies to the story prose only: tagged or formatted blocks keep their exact format and position, and "first line" means the first line of prose. Every event, fact and choice stays as it would otherwise be, and a required instruction wins over any style choice.`;
}

/** Write the panel's view of an event set back into its lorebook entry. */
export function writeEvent(data, ev, id = '') {
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
    const ri = { v: 1, type: style ? 'style' : 'event', sentAs: ev.sentAs, notes: ev.notes, ...(ev.big && !style ? { big: true } : {}), neverTogether: String(ev.neverTogether || ''), presets: ev.presets || {}, categories: ev.categories.map(normalCategory) };
    keepTags(ri, entry.extensions?.ri, id);
    entry.extensions = { ...(entry.extensions || {}), ri };
    entry.content = buildEventContent(ev);
    return entry;
}

// ---------- saved category settings ----------

const SETTING_KEYS = ['on', 'mode', 'fixed', 'keepMin', 'keepMax', 'count', 'useAll', 'itemWait', 'burn', 'neverTags', 'chance', 'restAfter', 'changeChance'];

/** The settings (not the items) of every category, to save under a name. */
export function snapshotSettings(categories) {
    const cats = {};
    for (const c of categories) { cats[c.id] = {}; for (const k of SETTING_KEYS) cats[c.id][k] = c[k]; }
    return { cats };
}

/** Put saved settings onto the categories. Locked categories stay locked. */
export function loadSettings(categories, preset) {
    for (const c of categories) {
        const saved = preset?.cats?.[c.id];
        if (!saved || c.locked) continue;
        for (const k of SETTING_KEYS) if (saved[k] !== undefined) c[k] = saved[k];
    }
    return categories;
}

/** The entry's event data with one of its saved settings applied (used when a chat has chosen one). */
export function withPreset(ri, name) {
    const preset = name ? ri?.presets?.[name] : null;
    if (!preset) return ri;
    return { ...ri, categories: loadSettings((ri.categories || []).map(c => ({ ...c })), preset) };
}

// ---------- dice ----------

/** "past+future, calm+frantic" -> [['past', 'future'], ['calm', 'frantic']] */
export function pairList(text) {
    return String(text || '').split(',').map(p => p.split('+').map(t => t.trim().toLowerCase()).filter(Boolean)).filter(p => p.length === 2);
}

const clash = (tags, chosen, pairs) => pairs.some(([a, b]) => (tags.includes(a) && chosen.has(b)) || (tags.includes(b) && chosen.has(a)));

function sentenceFor(type, parts) {
    const lines = parts.map(p => `${p.name}: ${p.items.join(' and ')}${p.after ? ` (${p.after})` : ''}`);
    return type === 'style' ? styleSentence(lines) : eventSentence(lines);
}

/**
 * Roll the dice for one event, or for one reply's writing style.
 * ri: the entry's saved data. prev: the category state stored with the last roll of this set (or null).
 * opts.locks: { categoryId: [itemIds] } picks locked for this chat.
 * Returns { text, parts, state }. For a story event with nothing to pick it returns null. For a writing style
 * with no category in use this time, text is null and state is still returned.
 */
export function rollEvent(ri, prev, opts = {}) {
    const parts = [];
    const state = { cats: {} };
    const pairs = pairList(ri?.neverTogether);
    const cats = (Array.isArray(ri?.categories) ? ri.categories : []).map(normalCategory).filter(c => c.on && usable(c).length);
    const chosen = new Set(); // tags of everything picked so far in this roll
    const burned = opts.burned instanceof Set ? opts.burned : new Set(); // items that already happened in this chat
    let spent = false;        // the main list that retires its items has none left, or a list waits for the scene
    const mainBurn = cats.find(c => c.burn && !c.driver) || null;   // the first list that retires items: when it is used up, the set is
    const usedUp = [];        // other lists that retire items and have none left: they are left out of the event
    const scene = opts.scene || null;   // what the scene and the story world offer right now (null: conditions are not looked at)
    const filled = [];        // world entries that items of this roll were filled with
    const note = (byId, ids) => { for (const id of ids) for (const t of tagList(byId.get(id).tags)) chosen.add(t); };

    // First, the categories that keep the pick they already have.
    const info = new Map();
    for (const cat of cats) {
        const pool = usable(cat);
        const byId = new Map(pool.map(it => [it.id, it]));
        const old = prev?.cats?.[cat.id] || {};
        const valid = ids => Array.isArray(ids) && ids.length > 0 && ids.every(id => byId.has(id));
        const lock = opts.locks?.[cat.id];
        let kept = null; let left = 0; let linger = false; let pinned = false;
        if (valid(lock)) { kept = [...lock]; pinned = true; }
        else if (cat.mode === 'keepFixed') { const c = byId.get(cat.fixed) || byId.get((old.picks || [])[0]); if (c) { kept = [c.id]; pinned = true; } }
        else if (cat.mode === 'keepRandom' && Number(old.left) > 0 && valid(old.picks)) { kept = [...old.picks]; left = Number(old.left) - 1; }
        else if (cat.mode === 'keepRandom' && cat.changeChance < 100 && valid(old.picks) && rollInt(100) >= cat.changeChance) { kept = [...old.picks]; linger = true; }
        info.set(cat.id, { pool, byId, old, kept, left, linger, pinned });
        if (kept) note(byId, kept);
    }

    // Where the event comes from: the "Who drives it" list is rolled first, and the other lists only offer items that
    // fit the driver it picked. A driver is only offered when every list has something that fits it.
    let origin = '';
    const markedCats = cats.filter(c => !c.driver && usable(c).some(it => it.from));
    const fitsOrigin = (it, c, o) => c.driver || !o || !it.from || it.from === o;
    const canServe = (o) => !o || markedCats.every((c) => {
        const inf = info.get(c.id);
        if (inf.kept) return true;
        return inf.pool.some(it => fitsOrigin(it, c, o) && itemFits(it, scene) && !(c.burn && burned.has(it.id)));
    });
    for (const cat of cats.filter(c => c.driver)) { const k = info.get(cat.id).kept; if (k && !origin) origin = originOf(info.get(cat.id).byId.get(k[0]), cat); }
    const partsBy = new Map();

    // Then the categories that are due a fresh pick, the driver first.
    for (const cat of [...cats.filter(c => c.driver), ...cats.filter(c => !c.driver)]) {
        const { pool, byId, old, kept, linger, pinned } = info.get(cat.id);
        let { left } = info.get(cat.id);
        let used = (Array.isArray(old.used) ? old.used : []).filter(id => byId.has(id));
        let recent = cat.itemWait ? (Array.isArray(old.recent) ? old.recent : []).slice(-cat.itemWait) : [];
        const idle = (rest) => { state.cats[cat.id] = { picks: [], left: 0, used, recent, rest }; };
        let picks = kept;
        if (!picks) {
            if (cat.mode !== 'keepFixed') {
                // The category may be resting after its last pick, or may sit this one out by chance.
                if (Number(old.rest) > 0) { idle(Number(old.rest) - 1); continue; }
                if (cat.chance < 100 && rollInt(100) >= cat.chance) { idle(0); continue; }
            }
            const fitting = pool.filter(it => itemFits(it, scene) && (cat.driver ? canServe(originOf(it, cat)) : fitsOrigin(it, cat, origin)));
            // Every item of this list asks for something the scene does not have right now: the event waits.
            if (!fitting.length) { spent = true; idle(0); continue; }
            const allowed = fitting.filter(it => !clash(tagList(it.tags), chosen, pairs) && !(cat.burn && burned.has(it.id)));
            if (cat.burn && !allowed.length && fitting.some(it => burned.has(it.id))) {
                if (cat === mainBurn) spent = true; else usedUp.push(cat.name);
                idle(0); continue;
            }
            picks = allowed.filter(it => it.always).slice(0, cat.count).map(it => it.id);
            const need = cat.count - picks.length;
            if (need > 0) {
                const rest = allowed.filter(it => !picks.includes(it.id));
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
            if (!picks.length) { idle(0); continue; } // "never together" left nothing that fits
            note(byId, picks);
            if (cat.driver && !origin) origin = originOf(byId.get(picks[0]), cat);
            if (cat.useAll) used = [...new Set([...used, ...picks])];
            if (cat.itemWait) recent = [...recent, picks].slice(-cat.itemWait);
            if (cat.mode === 'keepRandom') left = cat.keepMin + rollInt(cat.keepMax - cat.keepMin + 1) - 1;
        }
        const lastOfItsRun = !pinned && !linger && (cat.mode === 'new' || (cat.mode === 'keepRandom' && left === 0));
        state.cats[cat.id] = { picks, left, used, recent, rest: linger ? (Number(old.rest) || 0) : lastOfItsRun ? cat.restAfter : 0 };
        const rules = picks.flatMap(id => tagList(byId.get(id).tags)).filter(t => t.startsWith('rule:'));
        const texts = picks.map((id) => { const f = fillNeed(byId.get(id), scene, list => list[rollInt(list.length)]); if (f.used) filled.push(f.used); return f.text; });
        // A writing style item can carry three more lines for as long as it is the pick.
        const dir = picks.map(id => byId.get(id)).filter(it => it.dEvent || it.dCheck || it.dNext).map(it => ({ pick: it.text, ...(it.dEvent ? { event: it.dEvent } : {}), ...(it.dCheck ? { check: it.dCheck } : {}), ...(it.dNext ? { next: it.dNext } : {}) }));
        partsBy.set(cat.id, { name: cat.name, items: texts, after: cat.after, catId: cat.id, ids: picks, ...(rules.length ? { rules } : {}), ...(dir.length ? { dir } : {}) });
    }
    for (const cat of cats) if (partsBy.has(cat.id)) parts.push(partsBy.get(cat.id));
    if (origin) state.origin = origin;
    if (filled.length) state.filled = filled;
    if (ri?.type === 'style') return { text: parts.length ? sentenceFor('style', parts) : null, parts, state };
    if (!parts.length || spent) return null; // the main list is used up, so this event has nothing new left to offer
    if (usedUp.length) state.usedUp = usedUp;
    return { text: sentenceFor('event', parts), parts, state };
}

/** Pick again for one category only, leaving the rest of the roll as it was. Returns null when there is no other item. */
export function rerollCategory(ri, parts, state, catId) {
    const raw = (ri?.categories || []).find(c => c.id === catId);
    const part = (parts || []).find(p => p.catId === catId);
    if (!raw || !part) return null;
    const cat = normalCategory(raw);
    const options = usable(cat).filter(it => !(part.ids || []).includes(it.id));
    if (!options.length) return null;
    const picked = pickWeighted(options, it => it.weight, Math.min(Math.max(1, (part.ids || []).length), options.length));
    const rules = picked.flatMap(it => tagList(it.tags)).filter(t => t.startsWith('rule:'));
    const newParts = parts.map(p => p.catId === catId ? { name: p.name, items: picked.map(it => it.text), after: p.after, catId, ids: picked.map(it => it.id), ...(rules.length ? { rules } : {}) } : p);
    const newState = structuredClone(state || { cats: {} });
    if (!newState.cats) newState.cats = {};
    newState.cats[catId] = { ...(newState.cats[catId] || { left: 0, used: [], recent: [], rest: 0 }), picks: picked.map(it => it.id) };
    return { text: sentenceFor(ri?.type === 'style' ? 'style' : 'event', newParts), parts: newParts, state: newState };
}

// ---------- rules that can be checked without AI ----------

const RULES = {
    'rule:no-dialogue': { label: 'nothing spoken aloud', test: t => !/["\u201C\u201D\u00AB\u00BB]/.test(t) },
    'rule:mostly-dialogue': { label: 'mostly spoken lines', test: (t) => { const spoken = (t.match(/["\u201C][^"\u201C\u201D]*["\u201D]/g) || []).join('').length; return spoken >= t.length * 0.5; } },
};

/** Check the picked items' "rule:" tags against the reply. Returns [{ label, ok }]. Unknown tags are skipped. */
export function checkRules(reply, tags) {
    const text = String(reply ?? '');
    const out = [];
    for (const tag of tags || []) {
        if (RULES[tag]) { out.push({ label: RULES[tag].label, ok: RULES[tag].test(text) }); continue; }
        let m = tag.match(/^rule:max-sentences-(\d+)$/);
        if (m) {
            const max = Number(m[1]);
            const ok = text.split(/\n\s*\n|\n/).filter(p => p.trim()).every(p => (p.match(/[^.!?\u2026]+[.!?\u2026]+["\u201D')\]]*|[^.!?\u2026]+$/g) || []).filter(x => x.trim()).length <= max);
            out.push({ label: `every paragraph is ${max} ${max === 1 ? 'sentence' : 'sentences'} or fewer`, ok });
            continue;
        }
        m = tag.match(/^rule:max-words-(\d+)$/);
        if (m) { const max = Number(m[1]); out.push({ label: `${max} words or fewer`, ok: text.split(/\s+/).filter(Boolean).length <= max }); }
    }
    return out;
}
