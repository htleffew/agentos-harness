// The reply tray's cards (DESIGN.md 6.2, 6.3 and 6.5). `buildTrayCards` turns one reply's saved values into
// the card descriptors reply-tray.js draws, in the order and mode of the chat's card setting (src/cards/catalog.js,
// src/ui/tray-settings.js), through the shared templates (card-templates.js). B20 and B22 add their cards with
// `registerCardRenderer`. The header and chip helpers at the bottom serve the Current scene page and the Sent card.
import { executionDetails } from './execution.js';
import { button, h } from './dom.js';
import { STATE_FIELDS, sceneDateLabel, snapshotState } from '../state.js';
import { chatState, saveChatState } from '../store.js';
import { ctx, KEY, isReply } from '../st.js';
import { undoReplyChanges } from '../worldflow.js';
import { cardMode, fieldOn, notRequested, orderedCards, sectionOn } from '../cards/catalog.js';
import {
    avatar, bulletList, carried, chipList, FACULTIES, emblem, foldedValue, notRequestedLine, quoteBlock, row, rows, sectionHead, timelineRows, unwrap,
} from './card-templates.js';
import { renderWorldCard, worldCardKinds } from './reply-world.js';
import { trayCardConfig, switchAnchor } from './tray-settings.js';
import { sceneEditor, stateEditor } from './state.js';
import { JOB_LABELS, restoreRecord, storyChanges, undoChange } from '../memory/upkeep.js';
import { installParityCards } from './cards/index.js';
import { installDiceCards } from './cards/roll.js';

const fold = value => String(value ?? '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const words = value => String(value || '').replace(/[-_]+/g, ' ');
const firstLine = text => String(text || '').split(/\r?\n/).map(line => line.trim()).find(Boolean) || '';
const asList = value => Array.isArray(value) ? value : String(value ?? '').split(/\s*[,;]\s*/).filter(Boolean);
const present = value => value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && !value.length);
const sceneTime = scene => [sceneDateLabel(scene), scene.time ?? scene.when].filter(Boolean).join(', ');

// ---------- where a value came from ----------

/** The number of a reply: the opening is 0, the first reply after it 1. */
export function replyNumber(index, chat = ctx().chat || []) {
    let number = 0;
    for (let at = 1; at <= index && at < chat.length; at++) if (isReply(chat[at])) number++;
    return index > 0 && isReply(chat[index]) ? number : 0;
}

/**
 * The reply a character's value was last set in, when that is earlier than reply `index` (a carried value), else null.
 * An edit saved with this reply's snapshot counts as this reply's own.
 */
export function carriedFrom(index, name, key, chat = ctx().chat || []) {
    const target = fold(name);
    try {
        if ((chat[index]?.extra?.[KEY]?.snapshotEdits || []).some(edit => fold(edit.name) === target && edit.field === key)) return null;
        for (let at = index; at >= 0; at--) {
            const rec = chat[at]?.extra?.[KEY];
            if (!rec || chat[at].is_user || rec.stateStale) continue;
            const changes = Array.isArray(rec.stateChanges) ? rec.stateChanges : [];
            if (changes.some(change => fold(change.name) === target && change.fields?.[key])) return at === index ? null : replyNumber(at, chat);
        }
    } catch (error) { console.warn('[Roleplay Instructions] carried values', error); }
    return null;
}

// ---------- renderers ----------

const RENDERERS = new Map();
/** Add or replace the renderer of a catalog card. It returns { first, body | load, names?, strip?, count?, warnings?, calls? } or null. */
export function registerCardRenderer(id, fn) { RENDERERS.set(id, fn); }

async function openSwitch(key) {
    try {
        const { app } = await import('./panel.js');
        await app.openPage('reply-tray', { anchor: switchAnchor(key) });
    } catch (error) { console.warn('[Roleplay Instructions] opening the card switch', error); }
}

const footer = (env, extra = []) => [...extra, notRequestedLine(notRequested(env.config, env.def.id), openSwitch)];

function readTracker(rec, id) {
    const all = rec?.tracker && typeof rec.tracker === 'object' ? rec.tracker : {};
    return all[id];
}

// Scene: where, when, weather, environment, who is present, ambient people, observable facts, known places.
registerCardRenderer('scene', env => {
    const { view, on, id } = env;
    const sc = view.showState ? view.snapshot || {} : {};
    const saved = readTracker(view.rec, 'scene') || {};
    const strip = view.strip;
    if (!strip && !Object.keys(sc).length && !Object.keys(saved).length) return null;
    const pick = (field, legacy) => { const u = unwrap(saved[field]); return present(u.value) ? u : { value: legacy, from: null }; };
    const place = pick('place', sc.where || strip?.place), time = pick('time', sceneTime(sc) || strip?.time), weather = pick('weather', sc.weather || strip?.weather);
    const here = pick('present', sc.present || strip?.present?.join(', '));
    const slot = h('div', { class: 'ri-c-edit' });
    const inherited = view.rec?.weatherInherited ? h('span', { class: 'ri-c-source' }, 'carried from an earlier reply') : null;
    const places = (unwrap(saved.places).value || []).map(item => typeof item === 'string' ? { text: item } : { text: item.name || item.text, note: item.note || item.description });
    const chips = list => chipList(asList(list));
    const body = () => [
        rows([
            on('place') && row('Place', place.value, { from: place.from, current: id }),
            on('time') && row('Story date and time', time.value, { from: time.from, current: id }),
            on('weather') && row('Weather', weather.value, { from: weather.from, current: id }),
            on('environment') && row('Environment', pick('environment', sc.environment).value),
            on('present') && row('Present', present(here.value) ? chips(here.value) : null),
            on('ambient') && row('Ambient people', present(saved.ambient) ? chips(unwrap(saved.ambient).value) : null),
        ]),
        on('weather') && weather.value && inherited && h('p', { class: 'ri-c-unrequested' }, inherited),
        on('facts') && present(saved.facts) ? h('section', { class: 'ri-c-section' }, sectionHead('Observable facts'), bulletList(asList(unwrap(saved.facts).value))) : null,
        on('places') && places.length ? h('section', { class: 'ri-c-section' }, sectionHead('Known places'), timelineRows(places)) : null,
        on('detail') && present(saved.detail) ? row('World detail', unwrap(saved.detail).value) : null,
        Object.keys(sc).length ? [slot, button('Edit this scene snapshot', () => slot.replaceChildren(sceneEditor(sc, view.redraw, { historicalId: id })), { kind: 'ghost' })] : null,
        view.strip && h('p', { class: 'ri-tray-help' }, view.strip.source === 'header' ? 'From the reply\'s scene header.' : 'From the story state saved after the reply.'),
        footer(env),
    ];
    return { first: [place.value, time.value].filter(Boolean).join(' · '), strip, body };
});

// Characters: each present character with the values the card switches ask for.
function peopleOf(view, tracked) {
    const byName = new Map();
    const touch = (name, base) => {
        const key = fold(name);
        if (!key) return null;
        if (!byName.has(key)) byName.set(key, { name, fields: {}, protected: {}, profile: null, tracked: {}, original: null, ...base });
        return byName.get(key);
    };
    for (const person of view.people) touch(person.name, { fields: person.fields || {}, protected: person.protected || {}, original: person });
    for (const profile of view.profiles) {
        const name = profile.subject || profile.name;
        const entry = byName.get(fold(name)) || touch(name);
        if (entry) entry.profile = profile;
    }
    for (const item of Array.isArray(tracked) ? tracked : []) {
        const entry = byName.get(fold(item.name)) || touch(item.name);
        if (entry) entry.tracked = item;
    }
    return [...byName.values()];
}

const SHOWN_PEOPLE = 3;

// ---------- pinned characters (decision 26) ----------

/** The names pinned to the Characters card of the open chat, in the order they were pinned. */
export function pinnedCharacters() {
    try {
        const list = chatState()?.pinnedCharacters;
        return Array.isArray(list) ? list.filter(name => typeof name === 'string' && name.trim()) : [];
    } catch { return []; }
}

/** Pin or unpin a character for this chat. The pin is saved in the chat file, so it survives a reload. */
export function setPinnedCharacter(name, pinned) {
    const state = chatState();
    if (!state || !fold(name)) return false;
    const rest = pinnedCharacters().filter(item => fold(item) !== fold(name));
    state.pinnedCharacters = pinned ? [...rest, String(name).trim()] : rest;
    // A pin is a deliberate tap, so it is written now rather than after the debounce a reload can cut short.
    try { const host = ctx(); if (typeof host.saveMetadata === 'function') host.saveMetadata(); else saveChatState(); } catch { saveChatState(); }
    return true;
}

/**
 * What the chat last recorded for a character who is not in reply `index`: the story state, the Characters card
 * values saved on earlier replies and the portrayal, each with the number of the reply it came from.
 */
export function lastKnownPerson(index, name, chat = ctx().chat || []) {
    const target = fold(name);
    const person = { name, fields: {}, protected: {}, profile: null, tracked: {}, original: null, absent: true, lastReply: null };
    const seen = number => { if (Number.isFinite(number) && number > (person.lastReply ?? -1)) person.lastReply = number; return number; };
    try {
        const state = Object.values(snapshotState(index)).find(item => fold(item.name) === target);
        if (state) { person.fields = { ...state.fields }; person.protected = { ...state.protected }; }
        for (const key of Object.keys(person.fields)) seen(carriedFrom(index, name, key, chat));
        for (let at = Math.min(index, chat.length - 1); at >= 0; at--) {
            const rec = chat[at]?.extra?.[KEY];
            if (!rec || chat[at].is_user) continue;
            const item = (Array.isArray(rec.tracker?.characters) ? rec.tracker.characters : []).find(entry => fold(entry?.name) === target);
            if (item) for (const [key, raw] of Object.entries(item)) {
                if (key === 'name' || person.tracked[key] !== undefined) continue;
                const u = unwrap(raw);
                if (present(u.value)) person.tracked[key] = { v: u.value, from: seen(u.from ?? replyNumber(at, chat)) };
            }
            if (!person.profile) {
                const profile = (Array.isArray(rec.v10Profiles) ? rec.v10Profiles : []).find(entry => fold(entry.subject || entry.name) === target);
                if (profile) { person.profile = profile; seen(replyNumber(at, chat)); person.profileFrom = replyNumber(at, chat); }
            }
        }
    } catch (error) { console.warn('[Roleplay Instructions] last known values', error); }
    return person;
}

/**
 * The people the Characters card draws: every pinned character first, then up to three others who are present.
 * A pinned character missing from the reply keeps the values last recorded for them. `more` holds the present
 * characters beyond the three.
 */
export function cardPeople(people, id, chat = ctx().chat || [], pins = pinnedCharacters()) {
    const keys = new Set(pins.map(fold));
    const pinned = pins.map(name => people.find(person => fold(person.name) === fold(name)) || lastKnownPerson(id, name, chat));
    const others = people.filter(person => !keys.has(fold(person.name)));
    return { shown: [...pinned, ...others.slice(0, SHOWN_PEOPLE)], more: others.slice(SHOWN_PEOPLE), pinned: keys };
}

function avatarSource(name) {
    try {
        const match = (ctx().characters || []).find(character => fold(character.name) === fold(name));
        return match?.avatar && match.avatar !== 'none' ? `/thumbnail?type=avatar&file=${encodeURIComponent(match.avatar)}` : '';
    } catch { return ''; }
}

function personSection(person, env) {
    const { on, id, view } = env;
    const pinned = env.pinned || new Set();
    const read = key => {
        const u = unwrap(person.tracked[key]);
        if (present(u.value)) return u;
        const earlier = person.absent ? person.profileFrom ?? person.lastReply : null;
        if (STATE_FIELDS.some(([field]) => field === key) && person.fields[key]) return { value: person.fields[key], from: carriedFrom(id, person.name, key) ?? (person.absent ? person.lastReply : null) };
        if (key === 'facet' || key === 'voice') return { value: person.profile?.[key], from: earlier };
        if (key === 'who') return { value: person.profile?.text, from: earlier };
        return { value: undefined, from: null };
    };
    const line = (key, label, { quote = false } = {}) => {
        if (!on(key)) return null;
        const { value, from } = read(key);
        if (!present(value)) return null;
        const mark = person.protected[key] ? `${label} · protected` : label;
        return quote ? h('div', { class: 'ri-c-row ri-c-row-wide', 'data-carried': from !== null && from !== id ? 'true' : undefined },
            h('span', { class: 'ri-c-label' }, mark), quoteBlock(value, { italic: true }), carried(from, id)) : row(mark, value, { from, current: id });
    };
    const faculty = sectionOn(env.config, 'characters', 'faculty')
        ? FACULTIES.filter(item => on(item.field)).map(item => emblem(item, person.tracked[item.field])).filter(Boolean) : [];
    // What a character is doing now says nothing about a reply they are not in.
    const doing = on('doing') && !person.absent ? read('doing').value : '';
    const slot = h('div', { class: 'ri-c-edit' });
    const editable = view.people.find(item => fold(item.name) === fold(person.name));
    const isPinned = pinned.has(fold(person.name));
    const pin = h('button', { type: 'button', class: 'ri-btn ri-btn-ghost ri-c-pin', 'aria-pressed': String(isPinned),
        'aria-label': `${isPinned ? 'Unpin' : 'Pin'} ${person.name} ${isPinned ? 'from' : 'to'} the Characters card`,
        title: isPinned ? 'Stop keeping this character on the card' : 'Keep this character on the card even when they are not in the reply',
        onclick: event => {
            event.stopPropagation();
            if (!setPinnedCharacter(person.name, !isPinned)) return;
            // Every reply's card follows the pin, so each tray redraws, not only this one.
            try { for (const tray of document.querySelectorAll('.ri-tray')) tray.dataset.stamp = ''; } catch { /* the redraw below covers this reply */ }
            view.redraw?.();
        } }, isPinned ? 'Unpin' : 'Pin');
    const hasValues = person.absent && [...STATE_FIELDS.map(([key]) => key), 'thoughts', 'facet', 'voice', 'outfit', 'holding', 'who', 'doing'].some(key => on(key) && present(read(key).value));
    return h('section', { class: 'ri-c-person', 'data-person': person.name, 'data-pinned': isPinned ? 'true' : undefined, 'data-absent': person.absent ? 'true' : undefined },
        h('div', { class: 'ri-c-person-head' },
            on('avatar') ? avatar(person.name, avatarSource(person.name)) : null,
            h('strong', {}, person.name), doing ? h('span', { class: 'ri-c-doing' }, doing) : null,
            person.absent ? h('span', { class: 'ri-c-source ri-c-absent' }, person.lastReply === null ? 'not in this reply' : `not in this reply, last seen in reply ${person.lastReply}`) : null,
            pin),
        person.absent && !hasValues ? h('p', { class: 'ri-c-unrequested' }, 'No values recorded for this character yet.') : null,
        rows(STATE_FIELDS.map(([key, label]) => line(key, label))),
        rows([line('thoughts', 'Thoughts', { quote: true })]),
        rows([line('facet', 'Facet'), line('voice', 'Voice'), line('outfit', 'Outfit'), line('holding', 'Holding'), line('who', 'Who they are')]),
        faculty.length ? h('div', { class: 'ri-c-faculty' }, faculty) : null,
        editable ? [slot, button('Edit this snapshot', () => slot.replaceChildren(stateEditor(id, editable, view.redraw, { historical: true })), { kind: 'ghost' })] : null);
}

registerCardRenderer('characters', env => {
    const { view, id } = env;
    const people = peopleOf(view, readTracker(view.rec, 'characters'));
    const pins = pinnedCharacters();
    if (!people.length && !view.presentNames.length && !pins.length) return null;
    const { shown, more, pinned } = cardPeople(people, id, ctx().chat || [], pins);
    const here = { ...env, pinned };
    const lead = shown[0];
    const leadField = lead && STATE_FIELDS.map(([key]) => lead.fields?.[key]).find(Boolean);
    const total = shown.length + more.length;
    const first = [lead ? `${lead.name}${leadField ? `: ${leadField}` : ''}` : '', total > 1 ? `+${total - 1}` : ''].filter(Boolean).join(' ');
    const body = () => [shown.map(person => personSection(person, here)),
        more.length ? h('details', { class: 'ri-c-fold ri-c-more' }, h('summary', {}, `${more.length} more ${more.length === 1 ? 'character' : 'characters'}`),
            more.map(person => personSection(person, here))) : null, footer(env)];
    return { first, names: view.presentNames, body };
});

// The saved-record cards: Emotions, Relationships, Knowledge and secrets, Plot.
for (const cardId of ['emotions', 'relationships', 'knowledge', 'plot']) {
    registerCardRenderer(cardId, env => {
        const { view } = env;
        if (!view.saved) return null;
        const mine = (view.rec.v10Changes || []).filter(record => worldCardKinds[cardId].kinds.includes(record.kind)).length;
        return { first: mine ? `${mine} recorded this reply` : '',
            load: panel => renderWorldCard(cardId, panel, { load: view.saved.load, modules: view.modules, reply: view.rec, index: env.id,
                config: env.config, tracker: view.rec.tracker, openSwitch }) };
    });
}

// Story changes: records filed in this reply, threads closed, and facts on record.
registerCardRenderer('changes', env => {
    const { view, id, on } = env;
    const records = view.records;
    const filed = on('filed') ? records : [];
    const closed = on('closed') ? records.filter(record => record.kind === 'event' && record.status === 'done') : [];
    const facts = view.saved && on('facts_on_record');
    // MB7: what capture and upkeep changed because of this reply, from the memory change log, each with Undo and Restore.
    const memory = on('filed') ? memoryChangeRows(id) : [];
    if (!records.length && !facts && !memory.length) return null;
    const list = items => rows(items.map(record => row(record.subject || words(record.id), [foldedValue(record.text || ''), chipList([{ text: record.kind, tone: record.kind === 'fact' ? 'mint' : 'indigo' }])])));
    const undo = view.rec.update?.changes?.length && !view.rec.update.undone
        ? button('Undo these changes', () => undoReplyChanges(id), { kind: 'ghost', title: 'Take back what this reply added to or changed in the story world.' }) : null;
    const load = async panel => {
        panel.replaceChildren(...[filed.length ? h('section', { class: 'ri-c-section' }, sectionHead('Filed this reply', { count: filed.length }), list(filed)) : null,
            closed.length ? h('section', { class: 'ri-c-section' }, sectionHead('Threads closed', { count: closed.length }), list(closed)) : null, undo,
            memory.length ? memoryChangesSection(memory, () => panel.isConnected && load(panel)) : null].filter(Boolean));
        if (facts) {
            const more = h('div', { class: 'ri-c-section' });
            panel.append(more);
            await renderWorldCard('changes', more, { load: view.saved.load, modules: view.modules, reply: view.rec, index: id, config: env.config, openSwitch });
        }
        panel.append(...footer(env).filter(Boolean));
    };
    return { first: records[0]?.text || records[0]?.subject || records[0]?.id || memory[0]?.label || 'Facts on record', count: records.length + memory.filter(row => row.counts).length, load };
});

function memoryChangeRows(index) {
    try { const c = ctx(); return storyChanges(c.chat || [], c.chatMetadata || {}, index); } catch { return []; }
}

/** The memory rows of the Story changes card: each change with its job, Undo while it counts, and Restore for a record it took out. */
function memoryChangesSection(changes, redraw) {
    const act = fn => async () => { try { await fn(); } catch (error) { console.warn('[Roleplay Instructions] story changes', error); } redraw(); };
    return h('section', { class: 'ri-c-section ri-story-changes' }, sectionHead('Memory changes', { count: changes.length }), rows(changes.map(change => row(change.label,
        [foldedValue(change.text || change.reason || ''), chipList([{ text: JOB_LABELS[change.job] || change.job, tone: 'indigo' }, ...(change.counts ? [] : [{ text: change.note || 'undone', tone: 'rose' }])]),
            change.undo ? button('Undo', act(() => undoChange(change)), { kind: 'ghost', title: 'Take back this change. Undo is saved with the chat.' }) : null,
            ...change.restore.map(recordId => button(`Restore ${recordId}`, act(() => restoreRecord(recordId)), { kind: 'ghost', title: 'Bring back the record this change took out of force.' }))].filter(Boolean)))));
}

// Director's desk: the reply plan, folded.
registerCardRenderer('plan', env => {
    const text = env.view.planning;
    if (!text || !env.on('plan')) return null;
    return { first: firstLine(text), body: () => [
        h('details', { class: 'ri-c-fold ri-c-plan' }, h('summary', {}, h('span', { class: 'ri-c-clamp' }, firstLine(text))), quoteBlock(text)), footer(env)] };
});

function emphasis(line) {
    const pieces = [];
    let end = 0;
    for (const match of line.matchAll(/\*\*([^*]+)\*\*|\*([^*]+)\*/g)) {
        pieces.push(line.slice(end, match.index), match[1] ? h('strong', {}, match[1]) : h('em', {}, match[2]));
        end = match.index + match[0].length;
    }
    pieces.push(line.slice(end));
    return pieces;
}

// Roast: the one voice the reply carries.
registerCardRenderer('roast', env => {
    const text = env.view.roast;
    if (!text || !env.on('voice')) return null;
    return { first: firstLine(text).replace(/\*+/g, ''), body: () => [quoteBlock(text, { format: emphasis }),
        executionDetails({ label: 'Reader reaction', stage: 'reply', connection: 'Original reply connection', attempts: 0, outcome: 'completed', result: 'Generated in the character reply.' }),
        footer(env)] };
});

// World Info, Sent and Notes come from the reply's own receipts; the caller builds their bodies.
for (const id of ['lore', 'sent', 'notes']) {
    registerCardRenderer(id, env => {
        const extra = env.view.extras?.[id];
        if (!extra || !env.on(CARD_FIELD[id])) return null;
        return { first: extra.first, body: extra.body, warnings: extra.warnings, calls: extra.calls };
    });
}
const CARD_FIELD = { lore: 'entries', sent: 'sent', notes: 'notes' };

// B20: the parity cards and sections (src/ui/cards/), registered after the core cards they extend.
installParityCards({ register: registerCardRenderer, core: id => RENDERERS.get(id), openSwitch, config: () => trayCardConfig() });
// B22: Roll, Stats and the dice section of the Sent card (src/ui/cards/roll.js), after the Sent card the parity cards wrap.
installDiceCards({ register: registerCardRenderer, core: id => RENDERERS.get(id) });

// ---------- the builder ----------

/**
 * One reply's card descriptors, in the order of the card setting, skipping cards that are Off. A card in Strip
 * mode keeps its marks on the Strip and draws no card (`stripOnly`).
 * `view` carries the reply's data: { id, rec, modules, snapshot, showState, people, profiles, records, planning, roast,
 * strip, presentNames, saved, redraw, extras }.
 */
export function buildTrayCards(view, config = trayCardConfig()) {
    const cards = [];
    // While capture of this reply is pending (memory DESIGN 7.2), story cards name the reply their state describes, so a fast
    // next message never shows earlier state as this reply's own.
    const asOf = view.capture?.pending ? view.capture.label : '';
    for (const def of orderedCards(config)) {
        const mode = cardMode(config, def.id);
        const render = RENDERERS.get(def.id);
        if (mode === 'off' || !render) continue;
        const env = { id: view.id, view, def, config, mode, on: field => fieldOn(config, def.id, field), section: key => sectionOn(config, def.id, key) };
        let part;
        try { part = render(env); } catch (error) { console.warn(`[Roleplay Instructions] ${def.label} card`, error); continue; }
        if (!part) continue;
        if (asOf && def.family === 'story' && !CARD_FIELD[def.id] && def.id !== 'changes') {
            const body = part.body;
            part = { ...part, asOf, first: [asOf, part.first].filter(Boolean).join(' · '),
                ...(typeof body === 'function' ? { body: () => [h('p', { class: 'ri-c-source ri-c-as-of' }, asOf), ...[].concat(body())] } : {}) };
        }
        cards.push({ id: def.id, label: def.label, icon: def.icon, family: def.family, module: def.module || undefined, stripOnly: mode === 'strip' || undefined, ...part });
    }
    return cards;
}

// ---------- card headers and chips shared with the Current scene page and the Sent card ----------

export function replyChip(text, tone = 'slate') {
    return h('span', { class: 'ri-reply-chip', 'data-tone': tone }, text);
}

export function revealReplyBody(card, panel) {
    requestAnimationFrame(() => {
        const chat = card.closest('#chat');
        if (!chat || !card.open || !panel) return;
        const composer = document.querySelector('#send_form')?.getBoundingClientRect();
        const bottom = Math.min(innerHeight, chat.getBoundingClientRect().bottom, composer?.height ? composer.top : Infinity);
        const pos = panel.getBoundingClientRect();
        if (pos.top + Math.min(72, pos.height) > bottom) card.firstElementChild.scrollIntoView({ block: 'center' });
    });
}

export function replyCardHeader({ icon, eyebrow, title, subtitle = '', badges = [], chips = [], status }) {
    return h(status ? 'div' : 'summary', { class: 'ri-reply-head', onclick: status ? undefined : event => {
        const head = event.currentTarget;
        const card = head.parentElement;
        if (card?.tagName === 'DETAILS' && !card.open) revealReplyBody(card, head.nextElementSibling);
    } },
        h('span', { class: 'ri-reply-symbol', 'aria-hidden': 'true' }, icon),
        h('span', { class: 'ri-reply-heading' },
            eyebrow ? h('span', { class: 'ri-reply-eyebrow' }, eyebrow) : null,
            h('span', { class: 'ri-reply-title' }, title),
            subtitle ? h('span', { class: 'ri-reply-subtitle' }, subtitle) : null,
            chips.length ? h('span', { class: 'ri-reply-chip-rail' }, chips.map(({ text, tone }) => replyChip(text, tone))) : null),
        badges.length ? h('span', { class: 'ri-reply-badges', 'aria-hidden': 'true' }, badges.map(label => h('span', { class: 'ri-reply-badge' }, label))) : null,
        status || h('span', { class: 'ri-reply-chevron', 'aria-hidden': 'true' }, '⌄'));
}


