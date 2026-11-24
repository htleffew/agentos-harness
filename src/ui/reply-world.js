// The saved-record cards of the reply tray: Emotions, Relationships, Knowledge and secrets, Plot and the facts
// on record. Each reads the story records as they stood at one reply (rewound on a private copy, so the viewer
// never changes the book) and draws them through the shared templates (card-templates.js).
import { AXES, KIND_MODULE, readRecord } from '../v10.js';
import { WORLD_KINDS } from '../world.js';
import { readReplyWorld } from '../reply-world.js';
import { button, h } from './dom.js';
import { blockMeter, changeChip, chipList, gauge, notRequestedLine, rows, row, sectionHead, timelineRows, unwrap } from './card-templates.js';
import { editableReplySlots, storySlots } from '../memory-journal.js';
import { ctx, KEY, isReply } from '../st.js';
import { cardById, fieldOn, notRequested, sectionOn } from '../cards/catalog.js';

const knowledgeFields = ['knows', 'believes', 'suspects', 'wrong'];
const axeLabels = { tenderness: 'Tenderness', fury: 'Fury', dread: 'Dread', yearning: 'Yearning' };
const words = value => String(value || '').replace(/[-_]+/g, ' ');
const join = (values, format = String) => Array.isArray(values) ? values.map(format).join(', ') : '';
const fold = value => String(value ?? '').toLocaleLowerCase().trim();

// Which saved record kinds each card section reads, and the older World Info row kinds that fill the same place.
const CARD_KINDS = {
    emotions: { kinds: ['emotion'], legacy: [] },
    relationships: { kinds: ['relationship'], legacy: [] },
    knowledge: { kinds: ['knowledge'], legacy: ['character'] },
    plot: { kinds: ['arc', 'seed', 'agenda', 'event'], legacy: ['thread', 'seed', 'activity'] },
    changes: { kinds: ['fact'], legacy: ['place', 'faction', 'secret'] },
};

export const worldCardKinds = Object.freeze(CARD_KINDS);

/** One reply's saved-record reader: the rewound records are read once and kept until `reset`. */
export function replyWorld(index) {
    let snapshot;
    const load = () => snapshot ||= readReplyWorld(index).catch(error => { snapshot = undefined; throw error; });
    return { load, reset: () => { snapshot = undefined; } };
}

/** The records of a card, as the reply saw them. Records of a feature that is off or on Theirs are left out. */
export function recordsFor(loaded, cardId, modules) {
    const def = CARD_KINDS[cardId];
    const { rows: world = [], records } = loaded || {};
    const items = records || world.flatMap(entry => {
        const record = readRecord(entry);
        return record ? [{ ...record, protected: record.protected || entry.locked }] : [];
    });
    return {
        records: items.filter(record => def.kinds.includes(record.kind) && modules[KIND_MODULE[record.kind]]),
        legacy: records ? [] : world.filter(entry => def.legacy.includes(entry.kind) && !readRecord(entry)),
    };
}

/** The axes of the same record in the closest earlier reply that recorded it, for the change since then. */
export function previousAxes(record, index, chat = ctx().chat || []) {
    for (let at = Math.min(index, chat.length) - 1; at >= 0; at--) {
        const earlier = chat[at]?.extra?.[KEY];
        if (!isReply(chat[at]) || earlier?.stateStale) continue;
        const match = (earlier?.v10Changes || []).find(item => item.id === record.id && item.kind === record.kind && item.axes);
        if (match) return match.axes;
    }
    return null;
}

const pairName = record => [record.subject || words(record.id), record.other || record.target].filter(Boolean).join(' → ');

function recordChips(record, extra = []) {
    return [
        record.basis && { text: words(record.basis), tone: 'indigo' },
        record.private && { text: 'Private to character' },
        record.protected && { text: 'Protected', tone: 'mint' },
        record.schedule && { text: 'Scheduled opportunity', tone: 'indigo' },
        ...extra,
    ].filter(Boolean);
}

function personBlock(title, body, chips) {
    return h('section', { class: 'ri-c-person' },
        h('div', { class: 'ri-c-person-head' }, h('strong', {}, title), chipList(chips)), ...[body].flat().filter(Boolean));
}

// ---------- Emotions ----------

function emotionBlock(record, { index, updated, on }) {
    const before = previousAxes(record, index);
    const axes = on('axes') ? AXES.filter(key => Number.isInteger(record.axes?.[key]) && record.axes[key] >= 0 && record.axes[key] <= 10) : [];
    const meters = axes.length ? h('div', { class: 'ri-c-axes' }, axes.map(key => h('div', { class: 'ri-c-axis', 'data-axis': key },
        h('span', { class: 'ri-c-label' }, axeLabels[key]),
        blockMeter(record.axes[key], { label: axeLabels[key] }),
        before && Number.isInteger(before[key]) ? changeChip(record.axes[key] - before[key]) : null))) : null;
    return personBlock(pairName(record), [
        record.text && h('p', { class: 'ri-c-text' }, record.text), meters,
        rows([on('outward') && row('Outward behavior', record.outward), on('counterweight') && row('Coexisting feeling', record.counterweight)]),
    ], [{ text: updated ? 'Recorded this reply' : 'Earlier record', tone: updated ? 'mint' : undefined }, ...recordChips(record)]);
}

// ---------- Relationships ----------

function relationshipBlock(record, { on, tracker }) {
    const pair = pairName(record);
    const tracked = (tracker || []).find(item => fold(item.pair || item.name) === fold(pair)) || {};
    const level = unwrap(tracked.level ?? record.level).value;
    const delta = tracked.change?.delta ?? tracked.delta ?? record.change?.delta;
    const reason = tracked.change?.reason ?? tracked.reason ?? record.change?.reason ?? '';
    return personBlock(pair, [
        on('pair') && record.text && h('p', { class: 'ri-c-text' }, record.text),
        on('level') && Number.isFinite(Number(level)) ? row('Level', gauge(level, { label: 'Level', delta: on('change') ? delta : undefined, reason: on('change') ? reason : '' })) : null,
        on('level') ? null : (on('change') && (delta || reason) ? row('Change', changeChip(delta, reason)) : null),
        on('pair') && rows([row('Perspective', record.perspective)]),
    ], recordChips(record));
}

// ---------- Knowledge and secrets, facts ----------

function knowledgeBlock(record) {
    return personBlock(pairName(record), record.text ? h('p', { class: 'ri-c-text' }, record.text) : null, recordChips(record));
}

function legacyBlock(entry, view) {
    const def = WORLD_KINDS[entry.kind];
    if (!def) return null;
    const state = def.steps?.find(([key]) => key === entry.status)?.[1];
    const selected = def.fields.filter(({ key }) => {
        if (entry.kind === 'character') return knowledgeFields.includes(key) === (view === 'knowledge');
        if (entry.kind === 'secret' && entry.status !== 'out' && entry.show !== 'full') return key === 'holder' || key === 'shadow';
        return true;
    });
    const body = rows(selected.map(({ key, label }) => row(label, entry.fields[key])));
    if (!body && entry.kind !== 'secret') return null;
    return personBlock(entry.name, body || h('p', { class: 'ri-c-text' }, 'A secret is recorded.'),
        [{ text: def.label }, state && { text: state, tone: 'indigo' }, entry.locked && { text: 'Protected', tone: 'mint' }].filter(Boolean));
}

function recordDetails(record) {
    const trip = record.travel;
    return rows([
        row('Voice', record.voice), row('Facet', record.facet), row('Also known as', join(record.aliases)),
        row('Portrayal sources', join(record.baseline?.sources)), row('Whereabouts', record.whereabouts), row('Location requirement', record.location),
        row('Parent arc', words(record.parent)), row('Prerequisites', join(record.requires, words)), row('Due at story minute', record.due),
        row('Travel', trip && `${trip.from} → ${trip.to} · earliest arrival at story minute ${trip.earliest}`),
        row('Schedule', record.schedule && `Weight ${record.weight ?? 1} · ${record.spacing ?? 0} replies between offers`),
        row('Possible payoff', record.payoff), row('Outcome', record.outcome), row('Related record', words(record.link)),
        row('Base World', record.baseEntry && `${record.baseBook || 'Base World'} · entry ${record.baseEntry}`),
        row('Relationship to Base World', words(record.baseRelation)),
    ]);
}

// ---------- Plot ----------

const PLOT_SECTIONS = [['threads', ['event']], ['plotlines', ['arc']], ['details', ['seed']], ['elsewhere', ['agenda']]];

function plotSection(records, audit) {
    return timelineRows(records.map(record => {
        const checked = audit.get(record.id);
        const notes = [record.text !== undefined && record.subject ? record.subject : '', checked?.recalled && 'Recalled for this reply',
            checked && (checked.eligible ? 'Eligible' : 'Prerequisites pending'), checked?.offered && 'Offered for this reply',
            record.schedule && 'Scheduled opportunity', record.protected && 'Protected'].filter(Boolean);
        const detail = recordDetails(record);
        return { text: record.text || words(record.id), status: record.status, note: notes.join(' · ') || undefined,
            node: detail ? h('details', { class: 'ri-c-fold' }, h('summary', {}, h('span', { class: 'ri-c-clamp' }, record.text || words(record.id))), detail) : undefined };
    }));
}

// ---------- the card ----------

function sourceChip(reply, index) {
    const recent = reply.update?.pending || storySlots().slice(-editableReplySlots()).some(slot => slot.index === index) &&
        editableReplySlots() && !reply.update?.changes?.length;
    return chipList([{ text: recent ? 'Recent · editable' : 'Filed' }]);
}

/**
 * Fill `panel` with one saved-record card. `env` carries { load, modules, reply, index, config, tracker, openSwitch }.
 * Sections follow the switches of the catalog: an off section is named under "Not requested" and nothing else.
 */
export async function renderWorldCard(cardId, panel, env) {
    const { load, modules, reply, index, config, openSwitch } = env;
    const on = fieldId => fieldOn(config, cardId, fieldId);
    const card = cardById(cardId);
    panel.replaceChildren(h('p', { class: 'ri-tray-help', role: 'status' }, 'Reading saved story state…'));
    try {
        const loaded = await load();
        const { records, legacy } = recordsFor(loaded, cardId, modules);
        const audit = new Map((reply.v10Plot || []).map(item => [item.id, { ...item, offered: item.id === reply.v10Offer }]));
        const updated = new Set((reply.v10Changes || []).map(item => item.id));
        const parts = [];
        if (cardId === 'emotions' && sectionOn(config, cardId, 'axes')) {
            parts.push(...records.map(record => emotionBlock(record, { index, updated: updated.has(record.id), on })));
        } else if (cardId === 'relationships' && sectionOn(config, cardId, 'pairs')) {
            parts.push(...records.map(record => relationshipBlock(record, { on, tracker: env.tracker?.relationships })));
        } else if (cardId === 'knowledge' && sectionOn(config, cardId, 'knows')) {
            parts.push(...records.map(knowledgeBlock), ...legacy.map(entry => legacyBlock(entry, 'knowledge')));
        } else if (cardId === 'plot') {
            for (const [sectionId, kinds] of PLOT_SECTIONS) {
                if (!sectionOn(config, cardId, sectionId)) continue;
                const section = card.sections.find(item => item.id === sectionId);
                const inSection = records.filter(record => kinds.includes(record.kind));
                const legacyRows = sectionId === 'threads' ? legacy.filter(entry => entry.kind === 'thread') : sectionId === 'details' ? legacy.filter(entry => entry.kind === 'seed')
                    : sectionId === 'elsewhere' ? legacy.filter(entry => entry.kind === 'activity') : [];
                const lines = plotSection(inSection, audit);
                const old = legacyRows.map(entry => legacyBlock(entry, 'plot')).filter(Boolean);
                if (lines || old.length) parts.push(h('section', { class: 'ri-c-section' }, sectionHead(section.label, { count: inSection.length + old.length }), lines, ...old));
            }
        } else if (cardId === 'changes') {
            const facts = [...records, ...legacy.map(entry => ({ id: entry.name, text: entry.name }))];
            if (sectionOn(config, cardId, 'facts_on_record') && facts.length) parts.push(h('section', { class: 'ri-c-section' }, sectionHead('Facts on record', { count: facts.length }),
                timelineRows(records.map(record => ({ text: record.text || words(record.id), note: record.subject || undefined }))),
                ...legacy.map(entry => legacyBlock(entry, 'facts')).filter(Boolean)));
        }
        panel.replaceChildren(...[
            sourceChip(reply, index),
            reply.memoryUncertain && h('p', { class: 'ri-note ri-note-warn', role: 'status' }, reply.memoryUncertain),
            ...(parts.filter(Boolean).length ? parts : [h('p', { class: 'ri-tray-help' }, 'No saved records in this section for this reply.')]),
            loaded.partial ? h('p', { class: 'ri-tray-help' }, 'Showing the records that could be verified for this reply.') : null,
            notRequestedLine(notRequested(config, cardId), openSwitch)].filter(Boolean));
    } catch (error) {
        panel.replaceChildren(h('p', { class: 'ri-tray-help', role: 'status' }, error.message),
            button('Retry', () => renderWorldCard(cardId, panel, env), { kind: 'ghost' }));
    }
}
