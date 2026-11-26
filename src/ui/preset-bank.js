// Setup, Presets: the bank and the stack (A11 c.3, c.3a, c.4, c.6 and c.10; ticket B32; DECISIONS.md, 24 November 2026).
//
// The bank lists every block she could send: every Chat Completion preset loaded in SillyTavern, the extension's own cards
// (RI), the companion preset, files she imported and her customized versions. The stack is what the next request sends for
// the selected preset. Only her taps change the stack: the include control, Move with Place here, the step buttons, batch
// actions, Take the new text and the By feature shortcuts. Opening the page, refreshing the bank, switching views, Compare
// and a shortcut's preview read the stack and leave it as it is.
//
// The page lays itself out by its own width (a container query on .ri-bk): under 760 px one view at a time behind a Stack
// and Bank segmented control, Compare as a partial sheet; at 760 px and wider the bank and the stack side by side, Compare
// as columns over the bank.
import { h, button, toggle, select, field } from './dom.js';
import { slot, homeLink } from './homes.js';
import { conflictSection } from './preset-conflicts.js';
import { fitBottom } from './generate-sheet.js';
import { confirmBox, isChatOpen } from '../st.js';
import { activePreset } from '../v10.js';
import { FEATURES, plainName } from '../preset-library.js';
import { MODULE_PROMPTS } from '../module-layout.js';
import { knownSets, editSet, entriesOf, loadSet } from '../books.js';
import { checkList, summary as noteSummary } from '../preset-checks.js';
import * as B from '../preset-bank.js';
import { reportFor } from '../import-report.js';
import { openImportReport } from './import-report.js';
import { riStack, savedWordingOf, riFeatureOfVersion } from '../preset-bank-ri.js';
import { readMarker, loadoutNotes } from '../preset-loadouts.js';

export const NARROW = 760;
const LANE_COLUMNS = 3;
const SEARCH_LIMIT = 80;
const hint = text => h('p', { class: 'ri-help' }, text);
const chip = (text, kind = '') => h('span', { class: `ri-ps-chip${kind ? ' ri-ps-chip-' + kind : ''}` }, text);
const n = value => Number(value || 0).toLocaleString('en-US');
const label = item => plainName(item?.label ? `${item.name}: ${item.label}` : item?.name) || item?.id || '';

// ----------------------------------------------------------------------------------------------------------------------
// Text tools: the word diff of Compare with clean and the shared sentences of Compare

/** Words and the spaces between them, so a diff can be drawn back with the original spacing. */
const words = text => String(text ?? '').split(/(\s+)/).filter(part => part !== '');

/**
 * The word diff of two texts: [{ op: 'same' | 'del' | 'ins', text }]. A longest common subsequence over words; past about
 * two million cells it compares lines instead, so a long block never stalls the page.
 */
export function wordDiff(before, after) {
    let a = words(before), b = words(after);
    if (a.length * b.length > 2_000_000) { a = String(before ?? '').split(/(\n)/); b = String(after ?? '').split(/(\n)/); }
    const rows = a.length + 1, cols = b.length + 1;
    const table = new Uint32Array(rows * cols);
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
        table[i * cols + j] = a[i] === b[j] ? table[(i + 1) * cols + j + 1] + 1 : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
    }
    const out = [];
    const push = (op, text) => { const last = out[out.length - 1]; if (last?.op === op) last.text += text; else out.push({ op, text }); };
    let i = 0, j = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) { push('same', a[i]); i++; j++; }
        else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) push('del', a[i++]);
        else push('ins', b[j++]);
    }
    while (i < a.length) push('del', a[i++]);
    while (j < b.length) push('ins', b[j++]);
    return out;
}

const sentenceKey = text => String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** A text cut into sentences and line breaks, keeping every character. */
export const sentences = text => String(text ?? '').split(/(?<=[.!?])(\s+)|(\n+)/).filter(part => part !== undefined && part !== '');
/** For each text, the sentences another text in the list also holds (12 characters or longer once reduced to words). */
export function sharedSentences(texts) {
    const sets = texts.map(text => new Set(sentences(text).map(sentenceKey).filter(key => key.length >= 12)));
    return texts.map((text, index) => {
        const others = sets.filter((_, other) => other !== index);
        return new Set([...sets[index]].filter(key => others.some(set => set.has(key))));
    });
}

// ----------------------------------------------------------------------------------------------------------------------
// Page state (kept across redraws while the page stays on one stack)

const ui = { key: '', view: 'stack', bankView: 'source', query: '', open: new Set(), openCards: new Set(), editing: '', diffing: '', selected: new Set(),
    compare: [], focus: 0, sheet: 40, moving: null, placing: '', full: false, preview: null, shortcutSteps: 0, status: '', layers: null, layersBusy: false };
let root = null, appRef = null, drawing = false, queued = false, unhook = null, sheetEl = null;

function resetFor(key) {
    if (ui.key === key) return;
    Object.assign(ui, { key, editing: '', placing: '', diffing: '', compare: [], focus: 0, moving: null, preview: null, shortcutSteps: 0, status: '' });
    ui.selected = new Set(); ui.openCards = new Set();
}

/** Everything a draw reads: the bank, the stack (with the RI group reconciled), its plan and cost. */
function read(preset) {
    const bank = B.currentBank() || B.refreshBank('page');
    const stack = riStack(bank, preset);
    if (!stack) return null;
    const plan = B.stackPlan(bank, stack, preset);
    return { bank, stack, plan, preset, cost: B.stackCost(plan), byKey: new Map(plan.map(item => [item.key, item])) };
}

// ----------------------------------------------------------------------------------------------------------------------
// Taps. Each changes the stack through preset-bank.js and redraws in the same task, so the count moves in the same frame.

function act(change, message = '') {
    try { change(); ui.status = message; }
    catch (error) { ui.status = error?.message || String(error); }
    draw();
}
const tapInclude = (data, key, on) => act(() => (on ? B.includeCards : B.excludeCards)(data.bank, data.stack.key, [key], { base: data.preset }));
const stackKeyFor = (data, key) => B.stackKeyOf(data.bank, key, data.preset);

// ----------------------------------------------------------------------------------------------------------------------
// Cards

const SOURCE_INK = { base: 'base', ri: 'ri', companion: 'companion', v: 'mine', import: 'import', preset: 'preset' };
function sourceKind(card) {
    const source = card.source || '';
    if (source === B.SOURCE_RI) return 'ri';
    if (source === B.SOURCE_COMPANION) return 'companion';
    if (source === B.SOURCE_MINE) return 'v';
    if (source === B.SOURCE_BASE) return 'base';
    if (B.isImportSource(source)) return 'import';
    return 'preset';
}
function sourceChip(card) {
    const kind = sourceKind(card);
    const name = kind === 'ri' ? 'RI' : kind === 'v' ? `Yours, from ${plainName(card.sourceName)}` : kind === 'companion' ? 'Companion' : plainName(card.sourceName) || 'Preset';
    return h('span', { class: `ri-bk-src ri-bk-src-${SOURCE_INK[kind]}`, title: kind === 'v' ? `Yours, from ${plainName(card.sourceName)}: ${plainName(card.name)}` : plainName(card.sourceName) }, name);
}
const tokenText = card => card.marker ? 'filled by SillyTavern' : `${card.raw ? 'raw ' : ''}${n(card.tokens)} tokens`;

/**
 * The feature of a card that holds her saved wording of an extension card, also once its record is gone. A loadout carries
 * that wording (B35), but the wording itself is a stored prompt of the Prompts page. On a device whose Prompts page has no
 * saved wording for the feature, the card shows Source removed. Like any card whose source is gone it keeps sending the text
 * it came with, inserted at the end of the request by the working copy; the feature's own guidance, when the feature is on in
 * Setup, Features, is the shipped default, because riGroup reads the stored prompt.
 */
const wordingFeature = item => item ? savedWordingOf(item) || (B.parseKey(item.key).source === B.SOURCE_MINE ? riFeatureOfVersion(B.parseKey(item.key).id) : '') : '';
const wordingGone = feature => `Your wording of ${FEATURES[feature]?.label || feature} came with this stack, but the Prompts page on this device holds no saved wording for it. This card keeps sending the text below at the end of the request until you take it out. While the feature is on in Setup, Features, its guidance is the shipped default as well. Save this text on the Prompts page to make it the feature's wording again.`;

/** The chips a card carries for where it stands: Changed in source, Source removed, In another copy, Yours. */
function statusChips(item, data) {
    const out = [];
    if (item?.status === 'changed') out.push(chip('Changed in source', 'tag'));
    if (item?.status === 'removed') out.push(chip(item.source === B.SOURCE_MINE && !wordingFeature(item) ? 'Version deleted' : 'Source removed', 'conflict'));
    if (item?.elsewhere) out.push(chip(`In another copy: ${plainName(item.elsewhere)}`, 'distinct'));
    if (item?.source === B.SOURCE_MINE && item.cleanStatus === 'changed') out.push(chip('Changed in source', 'tag'));
    if (item?.source === B.SOURCE_MINE && item.cleanStatus === 'removed') out.push(chip('Source removed', 'conflict'));
    if (item?.landmark) out.push(chip('Host row'));
    if (wordingFeature(item)) out.push(chip('Your wording', 'ours'));
    return out;
}

/**
 * One card row. card: a bank card or a plan item. item: the stack card it stands for (or null when it is not in the stack).
 * where: 'bank' or 'stack'. Every row has its source chip, tokens and include control.
 */
function cardRow(data, card, item, where, extra = {}) {
    const stackKey = item?.key || stackKeyFor(data, card.key);
    const on = !!item?.on;
    const key = where === 'stack' ? item.key : card.key;
    const permit = B.canInclude(data.bank, card.key, data.preset);
    const show = item || card;
    const name = label(show);
    const delta = item ? B.includeDelta(item) : card.tokens;
    const include = card.marker && where === 'bank' && !permit.ok ? h('span', { class: 'ri-bk-fill', title: permit.reason }, 'Base row')
        : includeControl(on, next => tapInclude(data, where === 'stack' ? item.key : card.key, next), `Send ${name}`, `${delta >= 0 ? '+' : ''}${n(delta)} tokens`, `inc|${key}`);
    const open = ui.openCards.has(`${where}|${key}`);
    const selected = ui.selected.has(stackKey);
    const row = h('div', { class: `ri-bk-card${on ? ' ri-bk-on' : ''}${item ? ' ri-bk-in' : ''}${open ? ' ri-bk-open' : ''}${selected ? ' ri-bk-sel' : ''}`,
        'data-bank-card': card.key, 'data-stack-key': stackKey, 'data-where': where, id: where === 'stack' ? `ri-bank-card-${cssId(stackKey)}` : null },
        h('div', { class: 'ri-bk-line' },
            h('input', { type: 'checkbox', class: 'ri-check ri-bk-pick', checked: selected, 'aria-label': `Select ${name}`, 'data-focus-key': `sel|${where}|${key}`,
                onchange: event => { if (event.target.checked) ui.selected.add(stackKey); else ui.selected.delete(stackKey); draw(); } }),
            h('button', { type: 'button', class: 'ri-bk-name', 'aria-expanded': String(open), 'data-focus-key': `name|${where}|${key}`,
                onclick: () => { ui.openCards[open ? 'delete' : 'add'](`${where}|${key}`); draw(); } }, name),
            include),
        h('div', { class: 'ri-bk-meta' }, sourceChip(show), h('span', { class: 'ri-bk-tok' }, tokenText(show)),
            ...statusChips(item || (card.source === B.SOURCE_MINE ? { ...card, cleanStatus: versionState(data, card) } : null), data),
            where === 'bank' && item && !on ? chip('Left out') : null, where === 'bank' && on ? chip('In the stack', 'on') : null,
            ...sendingChips(show),
            extra.controls || null),
        open ? cardDetail(data, card, item, where) : null);
    return row;
}
// ----------------------------------------------------------------------------------------------------------------------
// Where a card is sent (B56): the in-chat position and depth, the role and the first reply, shown on the card and set in
// its Placement editor. The extension's own cards are placed by the extension in its group, so they carry none of this.

const placesItself = card => !card || card.marker || card.source === B.SOURCE_RI;
const inChat = card => card?.placement?.position === 1;
const depthOf = card => Number.isInteger(card?.placement?.depth) ? card.placement.depth : 4;
const ROLE_NAMES = { system: 'System', user: 'User', assistant: 'Assistant' };
function sendingChips(card) {
    if (placesItself(card)) return [];
    return [inChat(card) ? chip(`In the chat, depth ${depthOf(card)}`) : null,
        card.role && card.role !== 'system' ? chip(`As ${card.role}`) : null,
        B.gateValue(card.notBefore) > 1 ? chip(`From reply ${card.notBefore}`) : null,
        card.set ? chip('Placed by you', 'ours') : null].filter(Boolean);
}
/** What a placement costs the request: where it lands and what the cache can reuse around it (prompt assembly standard). */
function placementCost(card) {
    const depth = depthOf(card);
    const where = inChat(card)
        ? `Sent in the chat, ${depth === 0 ? 'after the last message' : `${depth} ${depth === 1 ? 'message' : 'messages'} from the end`}, so its place in the stack is a reading order only. That spot moves with every reply: the cache reuses the request up to this block, and the block${depth ? ` and the ${depth === 1 ? 'message' : `${depth} messages`} after it are` : ' is'} read again each time.`
        : 'Sent in stack order with the other blocks at the start of the request, where the cache reuses it from one reply to the next while the stack stays the same.';
    const at = B.gateValue(card.notBefore);
    const gate = at > 1 ? (inChat(card)
        ? ` Held back until reply ${at}; it then joins the part of the request that is read again each reply anyway.`
        : ` Held back until reply ${at}; at that reply the start of the request changes once, so the cache starts over then.`) : '';
    return where + gate;
}
const sourcePlacement = from => `${from?.placement?.position === 1 ? `in the chat at depth ${depthOf(from)}` : 'in stack order'}, as ${from?.role || 'system'}, ${B.gateValue(from?.notBefore) > 1 ? `from reply ${from.notBefore}` : 'from the first reply'}`;

/** The Placement editor of a stack card: her values save on the stack card; the source and the bank card stay as they are. */
function placementEditor(data, item) {
    const draft = { position: inChat(item) ? 1 : 0, depth: depthOf(item), role: item.role || 'system', notBefore: B.gateValue(item.notBefore) };
    const depthBox = h('input', { type: 'number', class: 'ri-input ri-input-num', inputMode: 'numeric', min: 0, max: 9999, value: String(draft.depth),
        disabled: draft.position !== 1, 'data-placement': 'depth', oninput: () => { draft.depth = Math.max(0, Math.round(Number(depthBox.value) || 0)); } });
    const where = select([{ value: 0, label: 'In stack order' }, { value: 1, label: 'In the chat' }], draft.position, value => {
        draft.position = Number(value) === 1 ? 1 : 0; depthBox.disabled = draft.position !== 1;
    }, { 'data-placement': 'position' });
    const role = select(B.ROLES.map(value => ({ value, label: ROLE_NAMES[value] })), draft.role, value => { draft.role = value; }, { 'data-placement': 'role' });
    const first = h('input', { type: 'number', class: 'ri-input ri-input-num', inputMode: 'numeric', min: 0, max: 100000, value: String(draft.notBefore),
        'data-placement': 'notBefore', oninput: () => { draft.notBefore = Math.max(0, Math.round(Number(first.value) || 0)); } });
    const save = button('Save placement', () => act(() => {
        B.setCardSending(data.bank, data.stack.key, item.key, { ...draft, depth: draft.position === 1 ? draft.depth : undefined }, { base: data.preset });
        ui.placing = '';
    }, 'Placement saved. The next request sends this card that way.'), { kind: 'primary' });
    const reset = item.set ? button('Use the source placement', () => act(() => {
        B.setCardSending(data.bank, data.stack.key, item.key, null, { base: data.preset });
        ui.placing = '';
    }, 'This card follows its source placement again.'), { kind: 'ghost' }) : null;
    return h('div', { class: 'ri-bk-editor ri-bk-placement', 'data-placement-editor': item.key },
        hint(`Its source sends it ${sourcePlacement(item.from)}. Your placement saves on this stack card only.`),
        field('Where', '', where),
        field('Messages from the end', '0 places it after the last message.', depthBox),
        field('Sent as', '', role),
        field('First reply', '0 sends it from the first reply.', first),
        hint(placementCost(item)),
        h('div', { class: 'ri-row ri-row-tight' }, save, reset, button('Cancel', () => { ui.placing = ''; draw(); }, { kind: 'ghost' })));
}

const cssId = key => String(key).replace(/[^a-zA-Z0-9_-]+/g, '_');
const versionState = (data, card) => {
    const record = B.getVersion(card.id);
    return record ? B.versionStatus(data.bank, record).status : 'removed';
};

function includeControl(on, onChange, name, delta, focusKey) {
    const control = toggle(on, onChange, name);
    control.classList.add('ri-bk-inc');
    control.dataset.focusKey = focusKey;
    control.title = on ? `Take out (${delta})` : `Put in (${delta})`;
    return control;
}

/** The open card: its text, lineage, versions, and its tools. */
function cardDetail(data, card, item, where) {
    const show = item || card;
    const parsed = B.parseKey(show.key);
    const isVersion = parsed.source === B.SOURCE_MINE;
    const feature = parsed.source === B.SOURCE_RI ? parsed.id : savedWordingOf(show);
    const tools = [];
    if (!show.marker && !(where === 'stack' && item?.status === 'removed')) tools.push(button('Edit', () => { ui.editing = ui.editing === show.key ? '' : show.key; draw(); }, { kind: 'ghost' }));
    // A version whose record is gone (deleted, or saved wording a loadout brought) has nothing left to compare, reset or delete.
    if (isVersion && !savedWordingOf(show) && B.getVersion(parsed.id)) {
        tools.push(button('Compare with clean', () => { ui.diffing = ui.diffing === show.key ? '' : show.key; draw(); }, { kind: 'ghost' }));
        tools.push(button('Reset to clean', async () => {
            if (!await confirmBox(`Reset "${label(show)}" to the clean text of its source? Your wording in this version is replaced.`)) return;
            act(() => B.resetVersion(data.bank, parsed.id), 'Version reset to the clean text.');
        }, { kind: 'ghost' }));
        tools.push(button('Delete version', async () => {
            if (!await confirmBox(`Delete the version "${label(show)}"? A stack that holds it keeps sending its last text until you take it out.`)) return;
            act(() => B.deleteVersion(parsed.id), 'Version deleted.');
        }, { kind: 'ghost' }));
    }
    if (where === 'stack' && item?.status === 'changed') {
        tools.push(button('Compare with the new text', () => { ui.diffing = ui.diffing === `new|${item.key}` ? '' : `new|${item.key}`; draw(); }, { kind: 'ghost' }));
        tools.push(button('Take the new text', () => act(() => B.takeNewText(data.bank, data.stack.key, [item.key], { base: data.preset }), 'This card sends the new text from now on.')));
    }
    // Placement is a stack edit, so the editor opens on a card in the stack (B56).
    if (item && !placesItself(item)) tools.push(button('Placement', () => { ui.placing = ui.placing === item.key ? '' : item.key; draw(); }, { kind: 'ghost' }));
    const compared = ui.compare.includes(show.key);
    tools.push(button(compared ? 'Leave Compare' : 'Add to Compare', () => {
        ui.compare = compared ? ui.compare.filter(key => key !== show.key) : [...ui.compare, show.key].slice(-3);
        ui.focus = 0;
        draw();
    }, { kind: 'ghost' }));
    const cleanKey = B.bankCard(data.bank, card.key, data.preset)?.key || card.key;
    const versions = isVersion || parsed.source === B.SOURCE_RI ? [] : B.versionsOf(cleanKey);
    const lineage = show.lineage ? hint(`From the file ${show.lineage.file}, block ${plainName(show.lineage.block)}.`)
        : isVersion ? hint(`Yours, from ${plainName(show.sourceName)}: ${plainName(show.name)}.`) : null;
    const text = show.marker ? hint('SillyTavern fills this row itself.') : h('pre', { class: 'ri-bk-text', tabindex: 0 }, String(show.text ?? ''));
    const diff = ui.diffing === show.key ? diffView(data, show) : ui.diffing === `new|${item?.key}` ? newTextDiff(item) : null;
    const editor = ui.editing === show.key ? (feature && !isVersion || savedWordingOf(show) ? riEditor(feature) : versionEditor(data, card, show)) : null;
    return h('div', { class: 'ri-bk-detail' }, lineage,
        item?.status === 'removed' && wordingFeature(item) ? hint(wordingGone(wordingFeature(item))) : null,
        item?.status === 'removed' && item.source !== B.SOURCE_MINE ? hint('Its source is gone, so this card keeps sending the last text the bank read until you take it out.') : null,
        item?.elsewhere ? hint(`The selected preset has no such row. Presets of one edition share one stack, so this row comes from ${plainName(item.elsewhere)} and is sent while it is on.`) : null,
        item?.status === 'changed' ? hint('Its source changed. This card keeps sending the text it was taken with until you tap Take the new text.') : null,
        !placesItself(show) && (inChat(show) || B.gateValue(show.notBefore) > 1) ? hint(placementCost(show)) : null,
        h('div', { class: 'ri-row ri-row-tight ri-bk-tools' }, tools), editor, item && ui.placing === item.key && !placesItself(item) ? placementEditor(data, item) : null, diff, text,
        versions.length ? h('div', { class: 'ri-bk-versions' }, h('strong', {}, `Your versions (${versions.length})`),
            versions.map(version => cardRow(data, B.bankCard(data.bank, B.versionKey(version.id), data.preset), data.byKey.get(B.versionKey(version.id)) || null, 'bank'))) : null);
}

function diffView(data, show) {
    const record = B.getVersion(B.parseKey(show.key).id);
    const status = record ? B.versionStatus(data.bank, record) : null;
    if (!status?.clean) return hint('The clean block is no longer in its source, so there is nothing to compare with.');
    return diffBlock(status.clean.text, show.text, status.status === 'changed' ? 'The new clean text' : 'Clean', 'Yours');
}
const newTextDiff = item => diffBlock(item.text, item.currentText ?? '', 'Sent now', 'New text in the source');
function diffBlock(before, after, beforeLabel, afterLabel) {
    const parts = wordDiff(before, after);
    const changed = parts.some(part => part.op !== 'same');
    return h('div', { class: 'ri-bk-diff' }, h('p', { class: 'ri-ps-meta' }, h('del', {}, beforeLabel), ' and ', h('ins', {}, afterLabel)),
        changed ? h('pre', { class: 'ri-bk-text' }, parts.map(part => part.op === 'same' ? part.text : h(part.op, {}, part.text))) : hint('Both texts match.'));
}

/** Edit on a card: her text saves as a customized version beside the clean card. The preset file is never written. */
function versionEditor(data, card, show) {
    const isVersion = B.parseKey(show.key).source === B.SOURCE_MINE;
    const box = h('textarea', { class: 'ri-input ri-textarea ri-bk-edit', value: String(show.text ?? ''), 'aria-label': `Wording of ${label(show)}`, rows: 8 });
    const name = h('input', { class: 'ri-input', value: isVersion ? show.label || '' : '', maxLength: 60, 'aria-label': 'Version name', placeholder: 'Short name, for example Tighter' });
    const save = button(isVersion ? 'Save' : 'Save as my version', () => act(() => {
        if (isVersion) B.editVersion(B.parseKey(show.key).id, { text: box.value, label: name.value });
        else B.createVersion(data.bank, show.key, { text: box.value, label: name.value, base: data.preset });
        ui.editing = '';
    }, isVersion ? 'Version saved.' : 'Saved as your version. The clean card stays beside it.'), { kind: 'primary' });
    return h('div', { class: 'ri-bk-editor' },
        hint(isVersion ? 'Changes save to this version only.' : 'Saving makes a version marked Yours that names this block. The clean card and the preset file stay as they are.'),
        box, name, h('div', { class: 'ri-row ri-row-tight' }, save, button('Cancel', () => { ui.editing = ''; draw(); }, { kind: 'ghost' })));
}

/** An RI card is edited in the mirrored prompt editor, so the extension keeps one stored prompt per id (decision 16). */
function riEditor(feature) {
    const ids = MODULE_PROMPTS[feature] || [];
    return h('div', { class: 'ri-bk-editor' },
        hint('This edits the stored prompt the Prompts page also shows. Saved wording goes in as its own card, on, and the shipped card turns off, one tap from back on.'),
        ids.length ? slot(ids, '', { bare: true, onChange: () => queueDraw() }) : hint('This feature has no stored prompt to edit here.'),
        // The commentator voice has one home, in Setup, Features; this card edits only the Roast prompt, the same stored prompt that home shows.
        feature === 'roast' ? homeLink(appRef, 'roast-voice', 'The commentator voice is set in Setup, Features, beside this prompt.') : null);
}

// ----------------------------------------------------------------------------------------------------------------------
// The stack

function stackPane(data) {
    const { stack, plan, cost } = data;
    const main = plan.filter(item => item.group === 'main');
    const ri = plan.filter(item => item.group === 'ri');
    const scope = B.stackScope(stack.key);
    const split = Object.entries(cost.bySource).sort((a, b) => b[1] - a[1]).map(([name, tokens]) => `${plainName(name)} ${n(tokens)}`).join(', ');
    const moving = ui.moving;
    const head = h('div', { class: 'ri-bk-head' },
        h('h4', { class: 'ri-ps-heading' }, 'Stack'),
        h('p', { class: 'ri-ps-meta', id: 'ri-bk-total', 'data-total': cost.total, 'data-cards': cost.cards },
            `${n(cost.cards)} cards on, ${n(cost.total)} tokens; Roleplay Instructions ${n(cost.ri)}.${cost.raw ? ' Cards with macros show their raw size.' : ''}`),
        split ? h('p', { class: 'ri-ps-meta ri-bk-split-line' }, split) : null,
        h('div', { class: 'ri-ps-scope' },
            h('span', {}, scope === 'chat' ? 'Pinned to this chat.' : `Saved for ${stack.key.startsWith('preset:') ? plainName(stack.base) : `every preset of this edition (${plainName(stack.base)})`}.`),
            isChatOpen() ? button(scope === 'chat' ? 'Unpin from this chat' : 'Pin to this chat', () => act(() => B.pinStack(data.bank, stack.key, scope !== 'chat', { base: data.preset })), { kind: 'ghost' }) : null,
            B.canUndo(stack.key) ? button('Undo', () => act(() => B.undoStack(data.bank, stack.key), 'Last stack change undone.'), { kind: 'ghost', title: 'Undo the last stack change; ten are kept' }) : null,
            h('button', { type: 'button', class: 'ri-btn ri-btn-ghost ri-bk-wide-only', 'aria-pressed': String(ui.full), onclick: () => { ui.full = !ui.full; draw(); } }, ui.full ? 'Show the bank' : 'Stack at full width')));
    const list = h('div', { class: 'ri-bk-list', role: 'list', 'aria-label': 'Stack, main group' });
    const group = (items, listKeys) => {
        const out = [];
        const rest = listKeys.filter(key => !moving?.keys.includes(key));
        const target = before => moving && moving.group === items.group ? placeTarget(data, moving.keys, rest.indexOf(before) < 0 ? rest.length : rest.indexOf(before)) : null;
        let strip = null;
        for (const item of items) {
            if (moving && moving.group === items.group && !moving.keys.includes(item.key)) out.push(target(item.key));
            if (item.landmark) { strip = null; out.push(h('div', { class: 'ri-bk-landmark', role: 'listitem', 'data-stack-key': item.key }, h('span', {}, plainName(item.name)),
                item.on ? null : chip('Left out', 'conflict'), item.on ? null : includeControl(false, next => tapInclude(data, item.key, next), `Send ${plainName(item.name)}`, 'host row', `inc|${item.key}`))); continue; }
            const row = cardRow(data, item, item, 'stack', { controls: moveControls(data, item, items) });
            row.setAttribute('role', 'listitem');
            if (!item.on && !moving) {
                if (!strip) { strip = h('details', { class: 'ri-bk-left', open: ui.open.has(`left|${item.key}`) }, h('summary', {}, '')); out.push(strip); strip.dataset.first = item.key;
                    const key = `left|${item.key}`, fold = strip; fold.ontoggle = () => { if (fold.open) ui.open.add(key); else ui.open.delete(key); }; }
                strip.append(row);
                strip.firstChild.textContent = `Left out (${strip.childElementCount - 1})`;
                continue;
            }
            strip = null;
            out.push(row);
        }
        if (moving && moving.group === items.group) out.push(target(null));
        return out;
    };
    main.group = 'main'; ri.group = 'ri';
    list.append(...group(main, stack.cards.map(item => item.key)));
    const riList = h('div', { class: 'ri-bk-list', role: 'list', 'aria-label': 'Sent by Roleplay Instructions' }, ...group(ri, stack.ri.map(item => item.key)));
    const carded = new Set(ri.map(item => item.source === B.SOURCE_RI ? item.id : wordingFeature(item)).filter(Boolean));
    const follows = Object.keys(FEATURES).filter(key => !carded.has(key));
    return h('section', { class: 'ri-bk-pane ri-bk-stack', 'aria-label': 'Stack' }, head, batchBar(data), list,
        h('div', { class: 'ri-bk-group' }, h('h4', { class: 'ri-ps-heading' }, 'Sent by Roleplay Instructions'),
            hint('The extension sends these cards at the end of the request, in this order. When you save your own wording on the Prompts page it goes in as its own card, on, and the shipped card turns off, one tap from back on.'),
            riList,
            follows.length ? h('p', { class: 'ri-ps-meta', id: 'ri-bk-follows' }, `Follows Features: ${follows.map(key => FEATURES[key].label).join(', ')}. These features have no card in this stack, so their switch in Setup, Features decides.`) : null),
        checkSection(data),
        moving ? h('div', { class: 'ri-bk-placebar', role: 'status' }, h('span', {}, `Placing ${moving.keys.length === 1 ? label(data.byKey.get(moving.keys[0])) : `${moving.keys.length} cards`}. Tap Place here.`),
            button('Cancel', () => { ui.moving = null; draw(); }, { kind: 'primary' })) : null);
}

function moveControls(data, item, items) {
    const index = items.indexOf(item);
    const step = delta => act(() => B.stepCard(data.bank, data.stack.key, item.key, delta, { base: data.preset }));
    return h('div', { class: 'ri-bk-move' },
        button('Move', () => { ui.moving = { keys: [item.key], group: items.group }; draw(); }, { kind: 'ghost', title: `Move ${label(item)}` }),
        h('button', { type: 'button', class: 'ri-btn ri-btn-ghost ri-bk-step', 'aria-label': `Move ${label(item)} up`, disabled: index <= 0, 'data-focus-key': `up|${item.key}`, onclick: () => step(-1) }, 'Up'),
        h('button', { type: 'button', class: 'ri-btn ri-btn-ghost ri-bk-step', 'aria-label': `Move ${label(item)} down`, disabled: index >= items.length - 1, 'data-focus-key': `down|${item.key}`, onclick: () => step(1) }, 'Down'));
}

function placeTarget(data, keys, to) {
    return h('button', { type: 'button', class: 'ri-bk-place', 'data-place': to, 'data-focus-key': `place|${to}`,
        onclick: () => act(() => { B.moveCards(data.bank, data.stack.key, keys, to, { base: data.preset }); ui.moving = null; ui.selected = new Set(); }, 'Moved.') }, 'Place here');
}

/** Select several cards for include, exclude, move or Compare together. */
function batchBar(data) {
    const keys = [...ui.selected].filter(key => data.byKey.has(key) || B.bankCard(data.bank, key, data.preset));
    if (!keys.length) return null;
    const inStack = keys.filter(key => data.byKey.has(key));
    const groups = new Set(inStack.map(key => data.byKey.get(key).group));
    return h('div', { class: 'ri-bk-batch', role: 'group', 'aria-label': 'Selected cards' }, h('span', {}, `${keys.length} selected`),
        button('Put in', () => act(() => B.includeCards(data.bank, data.stack.key, keys, { base: data.preset }), `${keys.length} put in.`)),
        button('Take out', () => act(() => B.excludeCards(data.bank, data.stack.key, inStack, { base: data.preset }), `${inStack.length} taken out.`), { disabled: !inStack.length }),
        button('Move', () => { ui.moving = { keys: inStack, group: [...groups][0] }; draw(); }, { disabled: !inStack.length || groups.size !== 1 }),
        button('Compare', () => { ui.compare = keys.slice(0, 3); ui.focus = 0; draw(); }, { disabled: keys.length < 2 || keys.length > 3 }),
        button('Clear', () => { ui.selected = new Set(); draw(); }, { kind: 'ghost' }));
}

/**
 * For a selected loadout, the blocks SillyTavern's prompt manager has on that the loadout leaves out (B35). The loadout's
 * preset object is read from the bank's own copy of the preset list, so the note follows a change made there.
 */
function loadoutExtra(data) {
    const sid = data.bank.sids?.[data.preset];
    const preset = sid ? data.bank.sources.get(B.presetSource(sid))?.data : null;
    const marker = preset ? readMarker(preset) : null;
    return marker ? loadoutNotes(marker, preset) : [];
}

/**
 * The Check conflicts section, kept across redraws of the page for one preset: it redraws its own findings on a run and on
 * every bank change, and a section built afresh on each page redraw would drop the status line of a run in progress.
 */
let conflictBox = null;
function conflicts(preset, onOpenCard) {
    if (conflictBox?.preset !== preset) conflictBox = { preset, el: conflictSection({ preset, onOpenCard }) };
    return conflictBox.el;
}

/** The check list at the foot of the stack: code notes, then the conflict call (B33, B34). Neither changes the stack. */
function checkSection(data) {
    const list = checkList(data.plan, { extra: loadoutExtra(data) });
    const focusCard = key => { ui.view = 'stack'; ui.openCards.add(`stack|${key}`); draw(); globalThis.document?.getElementById(`ri-bank-card-${cssId(key)}`)?.scrollIntoView({ block: 'center' }); };
    return h('section', { class: 'ri-bk-checks', id: 'ri-bk-checks' }, h('h4', { class: 'ri-ps-heading' }, `Check list: ${noteSummary(list)}`),
        list.notes.length ? list.notes.map(note => h('div', { class: `ri-bk-note ri-bk-note-${note.level}`, 'data-note': note.kind }, h('p', {}, note.text),
            h('div', { class: 'ri-row ri-row-tight' }, note.cards.map(card => button(plainName(card.name), () => focusCard(card.key), { kind: 'ghost', title: `Show ${plainName(card.name)} in the stack` })))))
            : hint('No notes on this stack.'),
        conflicts(data.preset, focusCard));
}

// ----------------------------------------------------------------------------------------------------------------------
// The bank

function sourceGroups(data) {
    const { bank, preset } = data;
    const sid = bank.sids?.[preset];
    const baseKey = sid ? B.presetSource(sid) : null;
    const groups = [];
    const add = (id, title, source, extra = {}) => source && groups.push({ id, title, source, ...extra });
    if (baseKey) add('base', `Base: ${plainName(preset)}`, bank.sources.get(baseKey), { pinned: true });
    add('ri', 'Roleplay Instructions', bank.sources.get(B.SOURCE_RI), { pinned: true });
    const companion = bank.sources.get(B.SOURCE_COMPANION);
    if (companion) add('companion', `${baseKey ? 'Companion' : 'Base and companion'}: ${plainName(companion.name)}`, companion, { pinned: true });
    for (const source of bank.sources.values()) if (source.kind === 'import') add(`imp|${source.key}`, `Imported: ${plainName(source.name)}`, source, { imported: true });
    const families = new Map();
    for (const source of bank.sources.values()) {
        if (source.kind !== 'preset' || source.key === baseKey) continue;
        const edition = source.recognized?.edition;
        const family = edition?.familyLabel || 'Other presets';
        if (!families.has(family)) families.set(family, []);
        families.get(family).push(source);
    }
    const sorted = [...families.entries()].sort((a, b) => (a[0] === 'Other presets') - (b[0] === 'Other presets') || a[0].localeCompare(b[0]));
    return { pinned: groups, families: sorted };
}

/** Her versions whose clean card is gone from the bank still show, so she can compare, delete or keep sending them. */
const orphanVersions = data => B.listVersions().filter(version => !data.bank.cards.get(B.cleanKeyOf(version)) && version.source !== B.SOURCE_RI);

function bankPane(data) {
    const search = h('input', { type: 'search', class: 'ri-input ri-bk-search', value: ui.query, placeholder: 'Search block, preset or feature', 'aria-label': 'Search the bank',
        'data-focus-key': 'search', oninput: event => { ui.query = event.target.value; const fresh = bankList(data); listBox.replaceWith(fresh); listBox = fresh; } });
    const viewToggle = h('div', { class: 'ri-ps-segmented ri-bk-seg', role: 'group', 'aria-label': 'Bank view' },
        ['source', 'feature'].map(view => h('button', { type: 'button', class: 'ri-ps-seg', 'aria-pressed': String(ui.bankView === view), 'data-focus-key': `bankview|${view}`,
            onclick: () => { if (ui.bankView !== view) { ui.bankView = view; ui.preview = null; draw(); } } }, view === 'source' ? 'By source' : 'By feature')));
    let listBox = bankList(data);
    return h('section', { class: 'ri-bk-pane ri-bk-bank', 'aria-label': 'Bank' },
        h('div', { class: 'ri-bk-head' }, h('h4', { class: 'ri-ps-heading' }, 'Bank'),
            h('p', { class: 'ri-ps-meta', id: 'ri-bk-bank-count' }, `${n(data.bank.sources.size)} sources, ${n(data.bank.cards.size)} blocks. Every Chat Completion preset loaded in SillyTavern is here; the list updates when a preset is imported, saved or deleted.`)),
        h('div', { class: 'ri-bk-tools-row' }, search, viewToggle), listBox);
}

function bankList(data) {
    const query = ui.query.trim().toLowerCase();
    if (query) return searchResults(data, query);
    return ui.bankView === 'feature' ? featureView(data) : sourceView(data);
}

function searchResults(data, query) {
    const hits = [];
    const matches = card => `${card.name} ${card.sourceName} ${(card.tags || []).map(tag => FEATURES[tag]?.label || tag).join(' ')}`.toLowerCase().includes(query);
    for (const card of data.bank.cards.values()) if (!card.marker && matches(card)) hits.push(card);
    for (const version of B.listVersions()) { const card = B.bankCard(data.bank, B.versionKey(version.id), data.preset); if (card && matches({ ...card, name: `${card.name} ${card.label}` })) hits.push(card); }
    return h('div', { class: 'ri-bk-results', role: 'list' }, h('p', { class: 'ri-ps-meta' }, `${n(hits.length)} ${hits.length === 1 ? 'block matches' : 'blocks match'}${hits.length > SEARCH_LIMIT ? `; the first ${SEARCH_LIMIT} are shown` : ''}.`),
        hits.slice(0, SEARCH_LIMIT).map(card => cardRow(data, card, data.byKey.get(stackKeyFor(data, card.key)) || null, 'bank')));
}

function sourceView(data) {
    const { pinned, families } = sourceGroups(data);
    const box = h('div', { class: 'ri-bk-sources' });
    for (const group of pinned) box.append(sourceFold(data, group, group.id === 'base' || group.id === 'ri' || group.id === 'companion' ? !ui.open.has(`shut|${group.id}`) : ui.open.has(group.id)));
    const orphans = orphanVersions(data);
    if (orphans.length) box.append(h('details', { class: 'ri-bk-fold', open: true }, h('summary', {}, `Yours, source removed (${orphans.length})`),
        orphans.map(version => cardRow(data, B.bankCard(data.bank, B.versionKey(version.id), data.preset), data.byKey.get(B.versionKey(version.id)) || null, 'bank'))));
    for (const [family, sources] of families) {
        const id = `fam|${family}`;
        const fold = h('details', { class: 'ri-bk-fold ri-bk-family', open: ui.open.has(id), 'data-family': family },
            h('summary', {}, h('span', {}, plainName(family)), chip(`${sources.length} presets`)));
        const fill = () => { if (fold.open && fold.childElementCount === 1) fold.append(...sources.map(source => sourceFold(data, { id: `src|${source.key}`, title: plainName(source.name), source }, ui.open.has(`src|${source.key}`)))); };
        fold.ontoggle = () => { if (fold.open) ui.open.add(id); else ui.open.delete(id); fill(); };
        fill();
        box.append(fold);
    }
    return box;
}

/** One source, folded unless it is the base, RI or the companion. Its cards are drawn when it opens. */
function sourceFold(data, group, open) {
    const { source } = group;
    const cards = source.cards.filter(card => !card.marker || card.listed);
    const shipped = cards.filter(card => card.shippedOn && !card.marker);
    const tokens = shipped.reduce((sum, card) => sum + card.tokens, 0);
    const edition = source.recognized?.edition;
    const fold = h('details', { class: 'ri-bk-fold', open, 'data-source': source.key },
        h('summary', {}, h('span', { class: 'ri-bk-fold-title' }, group.title), edition?.distinct ? chip('Distinct', 'distinct') : null,
            chip(`${cards.length} blocks`), source.kind === 'ri' ? null : chip(`${n(tokens)} tokens shipped on`)));
    const fill = () => {
        if (!fold.open || fold.childElementCount > 1) return;
        const tools = [];
        if (group.id !== 'base' && source.kind !== 'ri' && shipped.length) tools.push(button(`Put in its ${shipped.length} shipped-on blocks`,
            () => act(() => B.includeCards(data.bank, data.stack.key, B.shippedOn(data.bank, source.key), { base: data.preset }), `${shipped.length} blocks from ${plainName(source.name)} put in.`), { kind: 'ghost' }));
        if (group.imported) tools.push(button('Remove this file from the bank', async () => {
            if (!await confirmBox(`Remove ${plainName(source.name)} from the bank? Cards from it that are in a stack keep sending their last text, marked Source removed.`)) return;
            act(() => B.removeImport(source.key.slice(4)), 'File removed from the bank.');
        }, { kind: 'ghost' }));
        if (group.imported && source.file && reportFor(source.file)) tools.push(button('Import report', () => openImportReport(reportFor(source.file)), { kind: 'ghost' }));
        if (source.file) tools.push(hint(`Read from ${source.file}. Its blocks wait here until you put them in.`));
        fold.append(tools.length ? h('div', { class: 'ri-row ri-row-tight' }, tools) : '',
            ...cards.map(card => cardRow(data, card, data.byKey.get(stackKeyFor(data, card.key)) || null, 'bank')),
            source.kind === 'ri' ? eventLayers() : '');
    };
    fold.ontoggle = () => {
        const id = group.id;
        if (['base', 'ri', 'companion'].includes(id)) { if (fold.open) ui.open.delete(`shut|${id}`); else ui.open.add(`shut|${id}`); }
        else if (fold.open) ui.open.add(id); else ui.open.delete(id);
        fill();
    };
    fill();
    return fold;
}

// Hidden subtext and ambient pulse: gated items of the story event sets (B37). Switched on here, they roll every reply on
// their own gates, whether or not their event set rolls.
const LAYERS = [{ bank: 'subtext', name: 'Hidden subtext' }, { bank: 'ambient', name: 'Ambient pulse' }];
/** The layer a gated category belongs to: its option bank, or its default name when she wrote its items herself. */
const layerOf = cat => !cat?.gate ? '' : LAYERS.find(layer => layer.bank === cat.bank)?.bank || (!cat.bank && LAYERS.find(layer => layer.name === cat.name)?.bank) || '';
async function readLayers() {
    const sets = knownSets('events');
    const state = { sets: sets.length, subtext: false, ambient: false };
    for (const id of sets) {
        const data = await loadSet(id).catch(() => null);
        for (const entry of entriesOf(data, id)) {
            const ri = entry?.extensions?.ri;
            if (ri?.type !== 'event' || !ri.gatesAlone) continue;
            for (const cat of ri.categories || []) if (cat.gate && cat.on && layerOf(cat)) state[layerOf(cat)] = true;
        }
    }
    return state;
}
/** Switch one gated layer on or off in every story event set; the set itself is not rolled and its other lists stay as they are. */
export async function setEventLayer(bank, on) {
    let touched = 0;
    for (const id of knownSets('events')) {
        await editSet(id, data => {
            for (const entry of entriesOf(data, id)) {
                const ri = entry?.extensions?.ri;
                if (ri?.type !== 'event' || !Array.isArray(ri.categories)) continue;
                for (const cat of ri.categories) if (layerOf(cat) === bank) { cat.on = !!on; touched++; }
                ri.gatesAlone = ri.categories.some(cat => cat.gate && cat.on);
            }
        });
    }
    return touched;
}
function eventLayers() {
    if (!ui.layers && !ui.layersBusy) { ui.layersBusy = true; readLayers().then(state => { ui.layers = state; }).catch(() => { ui.layers = { sets: 0 }; }).finally(() => { ui.layersBusy = false; queueDraw(); }); }
    const state = ui.layers;
    return h('div', { class: 'ri-bk-layers', id: 'ri-bk-layers' }, h('strong', {}, 'Story event layers'),
        hint('Hidden subtext and ambient pulse roll every reply on their own earliest reply and die, without waiting for their story event set to roll. At most two are active at once.'),
        !state ? hint('Reading the story event sets.') : !state.sets ? hint('There is no story event set yet. Make one in Direction, Random story events, then switch these on here.')
            : LAYERS.map(layer => h('div', { class: 'ri-switch-row', 'data-layer': layer.bank }, toggle(!!state[layer.bank], async on => {
                ui.layersBusy = true;
                try { await setEventLayer(layer.bank, on); ui.layers = { ...ui.layers, [layer.bank]: on }; ui.status = `${layer.name} ${on ? 'on' : 'off'} in every story event set.`; }
                catch (error) { ui.status = error?.message || String(error); }
                finally { ui.layersBusy = false; draw(); }
            }, layer.name), h('span', {}, layer.name))));
}

// The By feature view: one lane per tag; cards from the base, RI, the companion, imported files, her versions and every
// source with a card in the stack. Lanes change nothing; the shortcuts apply only when she taps Apply.
function laneCards(data, tag) {
    const used = new Set(data.plan.map(item => item.source === B.SOURCE_BASE ? 'base' : B.parseKey(item.key).source));
    const sid = data.bank.sids?.[data.preset];
    const baseKey = sid ? B.presetSource(sid) : null;
    const out = [];
    for (const source of data.bank.sources.values()) {
        const relevant = source.key === baseKey || source.kind === 'ri' || source.kind === 'companion' || source.kind === 'import' || used.has(source.key);
        if (!relevant) continue;
        for (const card of source.cards) if (!card.marker && (card.tags || []).includes(tag)) out.push(card);
    }
    for (const version of B.listVersions()) {
        const card = B.bankCard(data.bank, B.versionKey(version.id), data.preset);
        if (card && (card.tags || []).includes(tag) || version.source === B.SOURCE_RI && version.sourceId === tag) out.push(card);
    }
    return out.filter(Boolean);
}
const isRiCard = card => card.source === B.SOURCE_RI || card.origin === B.SOURCE_RI;

/** What a shortcut would do to one lane: { include, exclude } as stack keys. Reading it changes nothing. */
export function shortcutPlan(data, cards, mode) {
    const include = [], exclude = [];
    for (const card of cards) {
        const key = stackKeyFor(data, card.key);
        const item = data.byKey.get(key);
        const ri = isRiCard(card);
        const want = mode === 'all' ? true : mode === 'ri' ? ri : !ri;
        if (want && !item?.on && (item || ri || B.parseKey(key).source === B.SOURCE_BASE)) include.push(card.key);
        if (!want && item?.on) exclude.push(key);
    }
    return { include, exclude };
}

function featureView(data) {
    const tags = [...Object.keys(FEATURES)];
    for (const card of data.bank.cards.values()) for (const tag of card.tags || []) if (!tags.includes(tag)) tags.push(tag);
    const box = h('div', { class: 'ri-bk-lanes' });
    for (const tag of tags) {
        const cards = laneCards(data, tag);
        if (!cards.length) continue;
        const bySource = new Map();
        for (const card of cards) { const name = card.source === B.SOURCE_MINE ? `Yours` : card.source === B.SOURCE_RI ? 'RI' : plainName(card.sourceName); if (!bySource.has(name)) bySource.set(name, []); bySource.get(name).push(card); }
        const preview = ui.preview?.tag === tag ? ui.preview : null;
        const shortcut = mode => button({ ri: 'Only RI', preset: 'Only preset', all: 'All' }[mode], () => { ui.preview = { tag, mode, ...shortcutPlan(data, cards, mode) }; draw(); },
            { kind: 'ghost', title: 'Shows what would change; nothing changes until you tap Apply' });
        box.append(h('section', { class: 'ri-bk-lane', 'data-lane': tag, id: `ri-bk-lane-${cssId(tag)}` },
            h('div', { class: 'ri-bk-lane-head' }, h('strong', {}, FEATURES[tag]?.label || tag), chip(`${cards.length} cards`),
                h('span', { class: 'ri-bk-shortcuts' }, shortcut('ri'), shortcut('preset'), shortcut('all'))),
            preview ? h('div', { class: 'ri-bk-preview', role: 'status' },
                h('span', {}, `${{ ri: 'Only RI', preset: 'Only preset', all: 'All' }[preview.mode]} would put in ${preview.include.length} and take out ${preview.exclude.length}.`),
                button('Apply', () => act(() => {
                    let steps = 0;
                    if (preview.exclude.length) { B.excludeCards(data.bank, data.stack.key, preview.exclude, { base: data.preset }); steps++; }
                    if (preview.include.length) { B.includeCards(data.bank, data.stack.key, preview.include, { base: data.preset }); steps++; }
                    ui.shortcutSteps = steps; ui.preview = null;
                }, 'Shortcut applied. Undo puts the lane back.'), { kind: 'primary', disabled: !preview.include.length && !preview.exclude.length }),
                button('Cancel', () => { ui.preview = null; draw(); }, { kind: 'ghost' })) : null,
            h('div', { class: 'ri-bk-lane-cols', style: { '--ri-bk-cols': Math.min(LANE_COLUMNS, bySource.size) } },
                [...bySource.entries()].map(([name, list]) => h('div', { class: 'ri-bk-col' }, h('p', { class: 'ri-bk-col-head' }, name),
                    list.map(card => laneCell(data, card)))))));
    }
    if (ui.shortcutSteps) box.prepend(h('div', { class: 'ri-bk-preview' }, h('span', {}, 'A shortcut changed the stack.'),
        button('Undo shortcut', () => act(() => { for (let i = 0; i < ui.shortcutSteps; i++) B.undoStack(data.bank, data.stack.key); ui.shortcutSteps = 0; }, 'Shortcut undone.'), { kind: 'primary' })));
    return box.childElementCount ? box : hint('No card carries a feature tag yet.');
}

/** A By feature cell: name and tokens with the include control, as in A11 c.10. */
function laneCell(data, card) {
    const key = stackKeyFor(data, card.key);
    const item = data.byKey.get(key) || null;
    const name = label(card);
    return h('div', { class: `ri-bk-cell${item?.on ? ' ri-bk-on' : ''}`, 'data-bank-card': card.key, 'data-stack-key': key },
        h('button', { type: 'button', class: 'ri-bk-name', onclick: () => { ui.bankView = 'source'; ui.query = plainName(card.name); draw(); }, title: 'Find this card in the bank' }, name),
        h('span', { class: 'ri-bk-tok' }, tokenText(card)),
        includeControl(!!item?.on, next => tapInclude(data, card.key, next), `Send ${name}`, `${item?.on ? '-' : '+'}${n(card.tokens)} tokens`, `cell|${card.key}`));
}

// ----------------------------------------------------------------------------------------------------------------------
// Compare: two or three cards from any view, columns at 760 px and wider, a partial sheet with a height slider below that

function comparePane(data) {
    const cards = ui.compare.map(key => {
        const item = data.byKey.get(key) || data.byKey.get(stackKeyFor(data, key));
        return { key, card: item || B.bankCard(data.bank, key, data.preset), item };
    }).filter(entry => entry.card);
    if (cards.length < 2) return cards.length ? h('div', { class: 'ri-bk-compare-hint' }, hint('Add one or two more cards to Compare.'),
        button('Clear Compare', () => { ui.compare = []; draw(); }, { kind: 'ghost' })) : null;
    const texts = cards.map(entry => String(entry.item?.text ?? entry.card.text ?? ''));
    const shared = sharedSentences(texts);
    const focus = Math.min(ui.focus, cards.length - 1);
    const height = h('input', { type: 'range', min: 20, max: 90, step: 5, value: ui.sheet, class: 'ri-bk-height', 'aria-label': 'Compare height',
        oninput: event => { ui.sheet = Number(event.target.value); sheet.style.setProperty('--ri-bk-sheet', `${ui.sheet}vh`); } });
    const sheet = h('section', { class: 'ri-bk-compare', role: 'dialog', 'aria-modal': 'false', 'aria-label': 'Compare', style: { '--ri-bk-sheet': `${ui.sheet}vh`, '--ri-bk-cols': cards.length } },
        h('header', { class: 'ri-bk-compare-head' }, h('strong', {}, `Compare (${cards.length})`), h('label', { class: 'ri-bk-narrow-only ri-bk-height-label' }, 'Height', height),
            h('div', { class: 'ri-bk-dots ri-bk-narrow-only', role: 'tablist', 'aria-label': 'Focus pane' },
                cards.map((entry, index) => h('button', { type: 'button', role: 'tab', class: 'ri-bk-dot', 'aria-selected': String(index === focus), 'aria-label': `Focus ${label(entry.card)}`,
                    onclick: () => { ui.focus = index; draw(); } }))),
            button('Close', () => { ui.compare = []; draw(); }, { kind: 'primary' })),
        h('div', { class: 'ri-bk-compare-cols' }, cards.map((entry, index) => {
            const key = entry.item?.key || stackKeyFor(data, entry.key);
            const on = !!data.byKey.get(key)?.on;
            return h('article', { class: `ri-bk-compare-col${index === focus ? ' ri-bk-focus' : ''}`, 'data-compare': entry.key },
                h('div', { class: 'ri-bk-line' }, h('strong', { class: 'ri-bk-name' }, label(entry.card)),
                    includeControl(on, next => tapInclude(data, entry.item?.key || entry.key, next), `Send ${label(entry.card)}`, `${n(entry.card.tokens)} tokens`, `cmp|${entry.key}`)),
                h('div', { class: 'ri-bk-meta' }, sourceChip(entry.card), h('span', { class: 'ri-bk-tok' }, tokenText(entry.card))),
                h('div', { class: 'ri-bk-text ri-bk-compare-text', tabindex: 0 }, sentences(texts[index]).map(part => shared[index].has(sentenceKey(part)) ? h('u', { class: 'ri-bk-shared' }, part) : part)));
        })),
        hint('Underlined sentences appear in another card in this Compare.'));
    return sheet;
}

// ----------------------------------------------------------------------------------------------------------------------
// Drawing

function body(data) {
    const panes = h('div', { class: 'ri-bk-split', 'data-full': String(ui.full) });
    const compare = ui.compare.length ? comparePane(data) : null;
    const bank = bankPane(data);
    // Wide, Compare opens in place over the bank; narrow, it is a sheet over the chat whichever view is showing. The sheet
    // is drawn beside the page section, outside it, because the section is a size container and a container is the
    // containing block of its fixed descendants. placeSheet then puts it on the visible bottom of the screen.
    const wide = (root?.clientWidth || 0) >= NARROW;
    if (compare && wide) bank.append(compare);
    panes.append(bank, stackPane(data));
    const sheet = compare && !wide ? compare : null;
    const seg = h('div', { class: 'ri-ps-segmented ri-bk-views ri-bk-narrow-only', role: 'group', 'aria-label': 'Stack or bank' },
        h('button', { type: 'button', class: 'ri-ps-seg', 'aria-pressed': String(ui.view === 'stack'), id: 'ri-bk-view-stack', 'data-focus-key': 'view|stack',
            onclick: () => { ui.view = 'stack'; draw(); } }, `Stack (${n(data.cost.cards)} · ${n(data.cost.total)})`),
        h('button', { type: 'button', class: 'ri-ps-seg', 'aria-pressed': String(ui.view === 'bank'), id: 'ri-bk-view-bank', 'data-focus-key': 'view|bank',
            onclick: () => { ui.view = 'bank'; draw(); } }, 'Bank'));
    return { nodes: [seg, ui.status ? h('p', { class: 'ri-help', role: 'status', id: 'ri-bk-status' }, ui.status) : null, panes].filter(Boolean), sheet };
}

/** Redraw in place. Focus and the scroll of each pane are kept. */
export function draw() {
    // The menu search draws every page into a detached body to index it, so the section in the page may be an earlier one.
    if (!root?.isConnected) root = globalThis.document?.getElementById('ri-bank-page') || root;
    if (!root?.isConnected || drawing) return;
    drawing = true;
    try {
        const doc = globalThis.document;
        const focused = doc?.activeElement && root.contains(doc.activeElement) ? doc.activeElement.dataset?.focusKey : '';
        const preset = activePreset();
        const data = preset ? read(preset) : null;
        if (!data) { root.replaceChildren(hint('The block stack for this preset is not available yet.')); return; }
        resetFor(data.stack.key);
        root.dataset.view = ui.view;
        root.dataset.moving = String(!!ui.moving);
        root.dataset.compare = String(ui.compare.length >= 2);
        const drawn = body(data);
        root.replaceChildren(...drawn.nodes);
        sheetEl?.remove();
        sheetEl = drawn.sheet;
        if (sheetEl) { root.after(sheetEl); placeSheet(); }
        if (focused) root.querySelector(`[data-focus-key="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
    } finally { drawing = false; }
}
/**
 * Put the narrow Compare sheet on the visible bottom of the screen. The host can make the page root the containing block of
 * fixed layers (SillyTavern gives html a transform), so the offset is measured, as the other sheets do (fitBottom).
 */
function placeSheet() {
    if (!sheetEl?.isConnected) return;
    const viewport = globalThis.visualViewport;
    fitBottom(sheetEl, viewport ? viewport.offsetTop + viewport.height : globalThis.innerHeight);
}
let sheetWatch = false;
function watchViewport() {
    if (sheetWatch || !globalThis.visualViewport) return;
    sheetWatch = true;
    globalThis.visualViewport.addEventListener('resize', placeSheet);
    globalThis.visualViewport.addEventListener('scroll', placeSheet);
}

function queueDraw() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; draw(); });
}

/**
 * The bank and stack section of Setup, Presets. Opening it rereads the preset list (the refresh that works on every host);
 * while it is open a preset imported, saved or deleted in SillyTavern redraws it through the bank's change listener.
 */
export function bankAndStack(app) {
    appRef = app;
    loadBankStyles();
    watchViewport();
    const section = h('section', { class: 'ri-bk', id: 'ri-bank-page', 'data-view': ui.view });
    root = section;
    ui.layers = null;
    conflictBox = null;
    try { B.refreshOnOpen(); } catch (error) { console.warn('Roleplay Instructions could not read the preset list.', error); }
    unhook?.();
    unhook = B.onBankChange(() => { if (!drawing) queueDraw(); });
    // Drawn once the section is in the page. A section that never joins the page (the menu search index) is left empty.
    let tries = 0;
    const first = () => { if (section.isConnected) { root = section; draw(); } else if (tries++ < 20) requestAnimationFrame(first); };
    queueMicrotask(first);
    return section;
}

/** For tests and the panel: the page state that is not stored anywhere else. */
export const bankPageState = () => ({ view: ui.view, bankView: ui.bankView, compare: [...ui.compare], moving: ui.moving ? { ...ui.moving } : null, selected: [...ui.selected], app: !!appRef });
export function setBankPageView(patch = {}) { Object.assign(ui, patch); draw(); }

let styled = false;
function loadBankStyles() {
    if (styled || !globalThis.document) return;
    styled = true;
    document.head.append(h('link', { rel: 'stylesheet', id: 'ri-preset-bank-css', href: new URL('./preset-bank.css', import.meta.url).href }));
}
