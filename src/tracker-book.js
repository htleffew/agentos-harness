// The Tracker World Info book (UI DESIGN 6.7, memory DESIGN 5.1 and 5.3). One generated book per chat,
// "RI Tracker, <chat name>", holds the tracker values of the latest reply on its shown swipe as Constant entries at depth 1:
// one entry per enabled card, and one per present character for the character cards. The model reads it every turn, and
// the recall block leaves those values to it (chat data names the cards the book carries: ri_memory.trackerBook.cards).
//
// What this module holds:
//   latestTracker(chat)            the tracker values and plan of the newest reply that has them
//   trackerEntries(latest, view)   the World Info entries for those values (pure)
//   buildTrackerBook(...)          entries placed inside the cap, the stamp text and the cards the book carries (pure)
//   createTrackerBook({ host })    write, schedule and read back the size, over any host
//   startTrackerBook()             wires capture, swipes, edits, deletes and the request to SillyTavern
//
// The values come from capture (MB3): message.extra.roleplay_instructions.tracker on the showing swipe. The book is never
// read back as a source. It reaches the request through WORLDINFO_ENTRIES_LOADED, so the chat's own World Info slot stays free.
import { createBookWriter, markerOf, safeBookName, STAMP_ID } from './memory/book-writer.js';
import { hostStoryWorld, TRACKER_PREFIX } from './memory/story-world-book.js';
import { MEMORY } from './memory/fold.js';
import { TRACKER_CARDS, SIZE_CAPS, placeTracker, tokensOf } from './memory/inject.js';
import { replyNumber, onCapture, enabledFields } from './memory/capture.js';
import { cardById, orderedCards, normalizeConfig, fieldOn } from './cards/catalog.js';
import { KEY, LOG, on } from './st.js';

export const trackerBookName = chatName => safeBookName(`${TRACKER_PREFIX}${chatName}`);
/** The tray's plan card is the Director's desk of the memory design. */
const ENTRY_CARD = Object.freeze({ plan: 'directorsDesk' });
const CATALOG_CARD = Object.freeze({ directorsDesk: 'plan' });
const EMOJI = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Variation_Selector}\p{Join_Control}\p{Me}]/gu;

// ---------------------------------------------------------------- values from the chat (pure)

const isReply = message => !!message && !message.is_user && !message.is_system;
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * The newest reply that has tracker values or a plan on its showing swipe, as { index, number, swipe, swipes, tracker, plan }.
 * A reply that capture has not reached yet has none, so the book then reflects the reply before it.
 */
export function latestTracker(chat) {
    const messages = chat || [];
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index];
        if (!isReply(message)) continue;
        const rec = message.extra?.[KEY];
        const tracker = isObject(rec?.tracker) && Object.keys(rec.tracker).length ? rec.tracker : null;
        const plan = typeof rec?.v10Plan === 'string' ? rec.v10Plan.trim() : '';
        if (!tracker && !plan) continue;
        return {
            index, number: replyNumber(messages, index), swipe: Number.isInteger(message.swipe_id) ? message.swipe_id : 0,
            swipes: Math.max(1, message.swipes?.length || message.swipe_info?.length || 1), tracker: tracker || {}, plan,
        };
    }
    return null;
}

// ---------------------------------------------------------------- entries (pure)

const clean = text => String(text ?? '').replace(EMOJI, '').replace(/\s+/g, ' ').trim();

/** One value as plain text: a carried value { v, from } reads as its value, lists join with commas, objects as "name value". */
export function valueText(value) {
    if (value === null || value === undefined) return '';
    if (isObject(value) && Object.hasOwn(value, 'v')) return valueText(value.v);
    if (Array.isArray(value)) return value.map(valueText).filter(Boolean).join(', ');
    if (isObject(value)) return Object.entries(value).map(([key, item]) => { const text = valueText(item); return text ? `${key} ${text}` : ''; }).filter(Boolean).join(', ');
    return clean(value);
}

const labelOf = (cardId, fieldId) => {
    for (const section of cardById(cardId)?.sections || []) for (const field of section.fields) if (field.id === fieldId) return field.label;
    return fieldId.replace(/_/g, ' ').replace(/^./, letter => letter.toUpperCase());
};

const slug = text => String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');

/** The lines "Label: value" of one object of field values, with only the fields that are on and have a value. */
function linesOf(cardId, values, enabled, { skip = new Set() } = {}) {
    const lines = [];
    for (const [fieldId, raw] of Object.entries(values || {})) {
        if (fieldId === 'name' || !enabled.has(`${cardId}.${fieldId}`)) continue;
        const text = valueText(raw);
        if (text && !skip.has(text.toLowerCase())) lines.push(`${labelOf(cardId, fieldId)}: ${text}`);
    }
    return lines;
}

/** The names a scene lists as present, lower-cased; empty when the scene does not say. */
export function presentNames(tracker) {
    const raw = tracker?.scene?.present;
    const value = isObject(raw) && Object.hasOwn(raw, 'v') ? raw.v : raw;
    const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/,|;|\band\b/) : [];
    return list.map(item => clean(valueText(item)).toLowerCase()).filter(Boolean);
}

/**
 * The entries for one reply's values. enabled: Set of "card.field" for the fields that are on. theirs: features on Theirs,
 * which put nothing in. Returns [{ id, card, comment, key, content, record }] before placement; `card` is the card id the
 * placement rules use and `record` carries it into the entry's marker.
 */
export function trackerEntries(latest, { enabled = new Set(), theirs = new Set(), config = null } = {}) {
    if (!latest) return [];
    const entries = [];
    const add = (card, id, comment, key, lines, head = '') => {
        const body = lines.filter(Boolean);
        if (!body.length) return;
        entries.push({ id, card, record: card, comment, key: key.filter(Boolean), content: [head || comment, ...body].join('\n') });
    };
    const feature = card => TRACKER_CARDS[card]?.feature || cardById(CATALOG_CARD[card] || card)?.module || '';
    const present = presentNames(latest.tracker);
    const used = new Set();
    const unique = base => { let id = base, n = 2; while (used.has(id)) id = `${base}-${n++}`; used.add(id); return id; };
    for (const [catalogId, values] of Object.entries(latest.tracker || {})) {
        const card = ENTRY_CARD[catalogId] || catalogId;
        if (!cardById(catalogId) || theirs.has(feature(card))) continue;
        const label = cardById(catalogId).label;
        if (Array.isArray(values)) {
            let items = values.filter(item => isObject(item) && clean(valueText(item.name)));
            const names = item => clean(valueText(item.name)).toLowerCase();
            // the character cards list the characters who are present; a scene that names nobody we hold lists them all
            if (present.length && ['characters', 'emotions', 'relationships'].includes(catalogId)) {
                const here = items.filter(item => present.some(name => names(item) === name || (catalogId === 'relationships' && names(item).includes(name))));
                if (here.length) items = here;
            }
            for (const item of items) {
                const name = clean(valueText(item.name));
                add(card, unique(`${catalogId}:${slug(name)}`), `${label}: ${name}`, [name], linesOf(catalogId, item, enabled, { skip: new Set([name.toLowerCase()]) }));
            }
        } else if (isObject(values)) {
            add(card, unique(catalogId), label, [], linesOf(catalogId, values, enabled));
        }
    }
    const planOn = latest.plan && !theirs.has(feature('directorsDesk')) && (!config || fieldOn(config, 'plan', 'plan'));
    if (planOn) add('directorsDesk', unique('directorsDesk'), "Director's desk", [], [clean(latest.plan)]);
    for (const entry of entries) { entry.comment = clean(entry.comment); entry.content = entry.content.split('\n').map(clean).filter(Boolean).join('\n'); }
    return entries;
}

/** The text of the first, disabled entry. */
export function stampText(latest, { dropped = [] } = {}) {
    const where = latest
        ? `Reflects reply ${latest.number}, version ${latest.swipe + 1} of ${latest.swipes}.`
        : 'Reflects no reply yet. No reply of this chat has tracker values.';
    const left = dropped.length ? ` Left out to stay inside the Tracker book's size limit: ${[...new Set(dropped.map(item => item.card))].join(', ')}.` : '';
    return `${where} This book holds the current tracker values only, as Constant entries the model reads every turn. It is rewritten after each reply is captured, and after a swipe, an edit or a delete, so a change made in the World Info editor is replaced at the next rewrite. Correct a value with Correct a story fact (Story, Scene).${left}`;
}

/**
 * Everything one write needs for a chat: the placed entries, what was left out, the size and the cards the book carries.
 * view: { enabled, theirs, config, cap }.
 */
export function buildTrackerBook(chat, view = {}) {
    const latest = latestTracker(chat);
    const config = view.config || null;
    const raw = trackerEntries(latest, { enabled: view.enabled || new Set(), theirs: view.theirs || new Set(), config });
    const trayOrder = [...new Set([...orderedCards(config).map(card => ENTRY_CARD[card.id] || card.id), ...Object.keys(TRACKER_CARDS)])];
    const placed = placeTracker(raw, { cap: view.cap ?? SIZE_CAPS.mid.tracker, trayOrder, theirs: view.theirs || new Set() });
    const cards = [...new Set(placed.kept.map(entry => entry.card).filter(card => TRACKER_CARDS[card]))];
    return {
        latest, entries: placed.kept, dropped: placed.dropped, tokens: placed.tokens, cap: view.cap ?? SIZE_CAPS.mid.tracker, cards,
        stamp: { title: 'About this book', text: stampText(latest, { dropped: placed.dropped }) },
    };
}

/** The card ids the entries of a book belong to, from entry markers. */
export const cardOfEntry = entry => String(markerOf(entry)?.record || '');

// ---------------------------------------------------------------- the book of one chat

/**
 * host: { chat(), chatInfo(), books: { load, save }, now(), meta(), saveMeta(), view() } over the open chat. view() gives
 * { enabled, theirs, config, cap }.
 */
export function createTrackerBook({ host, writer = createBookWriter({ loadBook: host.books.load, saveBook: host.books.save, now: host.now }) }) {
    const name = () => trackerBookName(host.chatInfo().name);
    let last = null;

    async function spec() {
        const info = host.chatInfo();
        const built = buildTrackerBook(host.chat(), await host.view());
        const known = host.meta()?.[MEMORY]?.trackerBook;
        // a chat with no tracker values and no book of its own gets none
        if (!built.latest && !(known && known.name === trackerBookName(info.name))) { last = { built, skipped: true }; return null; }
        last = { built };
        return {
            name: trackerBookName(info.name), kind: 'tracker', chat: { id: info.id, name: info.name, avatar: info.avatar || '', group: info.group || '' },
            stamp: built.stamp, entries: built.entries.map(({ card, ...entry }) => entry), onEdit: 'replace',
        };
    }

    /** The chat data the recall block and Review read: which cards the book carries and how large it is. */
    async function remember(out) {
        const meta = host.meta();
        if (!meta || !last?.built || last.skipped) return;
        const built = last.built;
        const next = out?.refused
            ? { name: name(), cards: [], tokens: 0, cap: built.cap, refused: out.reason }
            : { name: name(), cards: built.cards, tokens: built.tokens, cap: built.cap, reply: built.latest?.number ?? 0,
                entries: built.entries.map(entry => ({ id: entry.id, card: entry.card, comment: entry.comment, tokens: tokensOf(entry.content) })),
                dropped: built.dropped.map(item => ({ card: item.card, reason: item.reason })) };
        const holder = (meta[MEMORY] ||= {});
        if (JSON.stringify(holder.trackerBook) === JSON.stringify(next)) return;
        holder.trackerBook = next;
        await host.saveMeta?.();
    }

    /** Write the book now. Resolves the writer's result. */
    async function write() {
        const listed = new Set(host.books.names?.() || []);
        const out = await writer.schedule(name(), spec);
        // SillyTavern's book list learns of a new book only when it is asked to read the list again
        if (out?.saved && !listed.has(name())) await host.refresh?.();
        await remember(out);
        return out;
    }

    /** Ask for a write and return at once; a reply's capture never waits on a book. */
    function schedule() {
        write().catch(error => console.warn(LOG, 'tracker book', error));
    }

    /** The saved book as SillyTavern holds it, or null. */
    const read = () => host.books.load(name());

    return { name, spec, write, schedule, read, built: () => last?.built || null, receipts: () => writer.receipts(), settled: () => writer.settled(name()) };
}

// ---------------------------------------------------------------- the request

/**
 * Add the Tracker book's entries to the lists SillyTavern's scan built. The book is the extension's own, so it is read
 * from the saved book and does not need the chat's World Info slot. An entry whose feature is on Theirs now is left out,
 * and an entry already in the lists (the book attached by hand) is not added twice. Returns how many were added.
 */
export function addTrackerEntries(lore, { book, name, theirs = new Set() }) {
    if (!lore || !book?.entries) return 0;
    const lists = [lore.globalLore, lore.characterLore, lore.chatLore, lore.personaLore].filter(Array.isArray);
    const have = new Set(lists.flat().filter(entry => entry?.world === name).map(entry => entry.uid));
    if (!Array.isArray(lore.chatLore)) lore.chatLore = [];
    let added = 0;
    for (const entry of Object.values(book.entries)) {
        const marker = markerOf(entry);
        if (!marker || marker.id === STAMP_ID || entry.disable || !String(entry.content ?? '').trim() || have.has(entry.uid)) continue;
        const card = cardOfEntry(entry);
        const feature = TRACKER_CARDS[card]?.feature || cardById(CATALOG_CARD[card] || card)?.module || '';
        if (feature && theirs.has(feature)) continue;
        lore.chatLore.push({ ...structuredClone(entry), world: name });
        added += 1;
    }
    return added;
}

// ---------------------------------------------------------------- wired to SillyTavern

let shared = null;
/** The host of one open chat: the Story World host plus the chat data and the settings the book reads. */
export function hostTrackerBook(getContext = () => globalThis.SillyTavern.getContext()) {
    const base = hostStoryWorld(getContext);
    return {
        ...base,
        meta: () => getContext().chatMetadata,
        refresh: async () => (await import('./st.js')).refreshWorldList(),
        saveMeta: async () => { const c = getContext(); await (c.saveMetadata?.() ?? c.saveChat?.()); },
        async view() {
            const [{ settings }, v10, inject, budget] = await Promise.all([import('./store.js'), import('./v10.js'), import('./memory/inject.js'), import('./context-budget.js')]);
            const config = normalizeConfig(settings().trayCards);
            const theirs = await inject.hostTheirs();
            const fields = enabledFields(settings(), v10.effectiveModules());
            const enabled = new Set(fields.map(item => `${item.card}.${item.field}`));
            return { config, theirs, enabled, cap: inject.SIZE_CAPS[budget.memorySize().key]?.tracker ?? inject.SIZE_CAPS.mid.tracker };
        },
    };
}

/** The Tracker book of the open chat. */
export const trackerBook = () => shared ||= createTrackerBook({ host: hostTrackerBook() });

let started = false;
/** Wire the book to SillyTavern once: a rewrite after each capture and after a swipe, edit, delete or chat change, and the request. */
export function startTrackerBook() {
    if (started) return;
    started = true;
    let timer = 0;
    const queue = () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
            try {
                const [{ settings }, c] = [await import('./store.js'), globalThis.SillyTavern.getContext()];
                if (settings().enabled === false || !c.chatMetadata?.[MEMORY]?.imported) return;
                trackerBook().schedule();
            } catch (error) { console.warn(LOG, 'tracker book', error); }
        }, 400);
    };
    onCapture(event => { if (event.phase === 'done') queue(); });
    for (const event of ['MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'CHAT_CHANGED']) on(event, queue);
    on('WORLDINFO_ENTRIES_LOADED', async lore => {
        try {
            const c = globalThis.SillyTavern.getContext();
            const known = c.chatMetadata?.[MEMORY]?.trackerBook;
            const host = trackerBook();
            // a branch copies the chat data with the name of the book it came from; only this chat's own book is read
            if (!lore || !known?.name || known.name !== host.name() || !known.cards?.length) return;
            const { settings } = await import('./store.js');
            if (settings().enabled === false) return;
            const book = await host.read();
            const { hostTheirs } = await import('./memory/inject.js');
            addTrackerEntries(lore, { book, name: known.name, theirs: await hostTheirs() });
        } catch (error) { console.warn(LOG, 'tracker book entries', error); }
    });
}
