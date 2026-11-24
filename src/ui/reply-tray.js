// The reply tray (DESIGN.md 6.1, 6.4 to 6.6): one container per reply with Strip, Compact and Expanded views,
// the loading Strip while a reply is written and captured, and the tray's settings in Setup, Look.
// Card content comes from the caller (sent.js today, B11's catalog later); this file draws the container.
import { chatState, saveChatState, saveSettings, settings } from '../store.js';
import { isChatOpen } from '../st.js';
import { h } from './dom.js';
import { registerPage } from './page-registry.js';
import { fallbackNote, headerMode, headerSetting, headerState, HEADER_MODES, setHeaderSetting, tryHeaderInReplyAgain } from '../scene-header.js';

export const TRAY_VIEWS = Object.freeze({ strip: 'Strip', compact: 'Compact', expanded: 'Expanded' });
export const TRAY_PLACES = Object.freeze({ latest: 'Latest reply only', every: 'Every reply', none: 'None' });
export const CARD_TEXT = Object.freeze({ compact: 'Compact', comfortable: 'Comfortable' });
export const CARD_TEXT_RANGE = Object.freeze([100, 130]);
export const TRAY_DEFAULTS = Object.freeze({ latest: 'compact', earlier: 'strip', where: 'every', sceneHeader: 'reply', cardText: 'compact', cardTextScale: 100 });
const VIEW_ICONS = { strip: 'fa-minus', compact: 'fa-list', expanded: 'fa-square' };

// ---------- settings ----------

const pick = (value, choices, fallback) => Object.hasOwn(choices, value) ? value : fallback;

/** A clean copy of the saved tray settings; unknown values fall back to the defaults. */
export function normalizeTray(saved) {
    const tray = saved && typeof saved === 'object' ? saved : {};
    const scale = Math.round(Number(tray.cardTextScale) / 5) * 5;
    return {
        latest: pick(tray.latest, TRAY_VIEWS, TRAY_DEFAULTS.latest),
        earlier: pick(tray.earlier, TRAY_VIEWS, TRAY_DEFAULTS.earlier),
        where: pick(tray.where, TRAY_PLACES, TRAY_DEFAULTS.where),
        sceneHeader: pick(tray.sceneHeader, HEADER_MODES, TRAY_DEFAULTS.sceneHeader),
        cardText: pick(tray.cardText, CARD_TEXT, TRAY_DEFAULTS.cardText),
        cardTextScale: Number.isFinite(scale) ? Math.min(CARD_TEXT_RANGE[1], Math.max(CARD_TEXT_RANGE[0], scale)) : TRAY_DEFAULTS.cardTextScale,
    };
}

export function traySettings(st = settings()) {
    st.tray = normalizeTray(st.tray);
    return st.tray;
}

function saveTray(change) {
    const st = settings();
    st.tray = normalizeTray({ ...traySettings(st), ...change });
    saveSettings();
    redraw();
}

/** This chat's own choices (view for the latest and earlier replies, where the tray shows). */
export function chatTray(cs = chatState()) {
    if (!cs) return {};
    const saved = cs.replyTray && typeof cs.replyTray === 'object' ? cs.replyTray : {};
    const out = {};
    for (const key of ['latest', 'earlier']) if (Object.hasOwn(TRAY_VIEWS, saved[key])) out[key] = saved[key];
    if (Object.hasOwn(TRAY_PLACES, saved.where)) out.where = saved.where;
    return out;
}

function saveChatTray(change) {
    const cs = chatState();
    if (!cs) return;
    const next = { ...chatTray(cs), ...change };
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
    cs.replyTray = next;
    saveChatState();
    redraw();
}

/** The view a reply opens in: the chat's choice, else the default (latest Compact, earlier Strip). */
export function trayView(latest, local = chatTray(), global = traySettings()) {
    const key = latest ? 'latest' : 'earlier';
    return local[key] || global[key];
}

/** Whether reply `latest` gets a tray under the chat's choice of where the tray shows. */
export function trayShows(latest, local = chatTray(), global = traySettings()) {
    const where = local.where || global.where;
    return where === 'every' || (where === 'latest' && latest);
}

// ---------- names ----------

const fold = value => String(value ?? '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The names in a scene's "present" value, a list or a comma-separated string. */
export function presentNames(present) {
    const list = Array.isArray(present) ? present : String(present ?? '').split(/\s*[,;]\s*|\s+and\s+/i);
    return list.map(name => String(name).trim()).filter(Boolean);
}

/** Two names match when equal or when one is the other's leading words ("Hale" and "Hale of Verath"). */
export function namesMatch(a, b) {
    const x = fold(a), y = fold(b);
    return !!x && !!y && (x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `));
}

/** Whether a character is in the scene by full name or any saved short name. An empty list counts everyone. */
export function inScene(present, name, aliases = []) {
    const list = presentNames(present);
    if (!list.length) return true;
    const known = [name, ...(Array.isArray(aliases) ? aliases : [])].filter(Boolean);
    return list.some(item => known.some(candidate => namesMatch(item, candidate)));
}

// ---------- which cards show ----------

/**
 * Cards whose feature is set to Theirs, or switched off, are left out entirely (6.6).
 * A card names its feature as `module`; cards the extension alone draws (Sent, Notes, World Info) have none.
 */
export function visibleCards(cards, modules = {}) {
    return cards.filter(card => card && (!card.module || modules[card.module] !== false));
}

/** The Strip's marks, built only from cards that survived `visibleCards`. */
export function stripMarks(cards) {
    const byId = new Map(cards.map(card => [card.id, card]));
    const scene = byId.get('scene');
    const people = byId.get('characters');
    const changes = byId.get('changes');
    return {
        scene: scene?.strip || null,
        people: people?.names || [],
        changes: changes?.count || 0,
        warnings: cards.flatMap(card => card.warnings || []),
        calls: cards.flatMap(card => card.calls || []),
    };
}

// ---------- loading (6.4) ----------

export const LOADING_TEXT = Object.freeze({
    waiting: 'Waiting for the reply',
    writing: 'Writing the reply',
    capturing: 'Capturing',
    resolved: 'Reply captured',
    failed: 'The reply did not arrive',
    stopped: 'Stopped; partial content kept',
});

const LOADING_CARDS = [
    ['scene', 'Scene', 'state'],
    ['characters', 'Characters', 'state'],
    ['changes', 'Story changes', null],
    ['plan', "Director's desk", null],
    ['roast', 'Roast', 'roast'],
    ['lore', 'World Info', null],
];

/** The cards the reply request can fill, from the features on Ours (sections the contract makes optional). */
export function loadingExpected({ modules = {}, display = {}, prefs = {} } = {}) {
    const on = id => ({
        scene: modules.state, characters: modules.state,
        changes: modules.state || modules.worldEvents,
        plan: display.expectsPlan && prefs.showPlanning !== false,
        roast: modules.roast && prefs.showRoast !== false,
        lore: display.entries > 0 && prefs.showLore !== false,
    })[id];
    return LOADING_CARDS.filter(([id]) => on(id)).map(([id, label]) => ({ id, label }));
}

/** Which of those cards have their values: sections parsed from the stream, a plan, selected World Info. */
export function loadingArrived(progress = {}) {
    const ids = new Set();
    for (const section of progress.sections || []) {
        if (section.id === 'cast' && section.value?.length) ids.add('characters');
        else if (section.id === 'scene' && section.value && Object.keys(section.value).length) ids.add('scene');
        else if (section.id === 'changes' && section.value?.length) ids.add('changes');
        else if (section.id === 'roast' && section.value) ids.add('roast');
    }
    if (progress.hasPlan) ids.add('plan');
    if (progress.display?.entries > 0) ids.add('lore');
    return ids;
}

/** The phase words while the reply is in flight. Before any text arrives, streaming says Writing and a held reply says Waiting. */
export function loadingPhase(phase, streaming) {
    if (phase === 'writing') return 'writing';
    if (['receiving', 'filing', 'ready'].includes(phase)) return 'capturing';
    return streaming ? 'writing' : 'waiting';
}

/**
 * How a loading Strip ends, on every exit path: a reply that was filed or arrived is resolved,
 * Stop and a chat change are stopped, and anything else (an error, an empty reply) failed.
 */
export function loadingExit({ lastPhase, stopped = false, chatChanged = false, replyArrived = false } = {}) {
    if (stopped || chatChanged) return 'stopped';
    if (['filing', 'ready'].includes(lastPhase) || replyArrived) return 'resolved';
    return 'failed';
}

/**
 * The Strip while loading: one phase line and a chip per card whose values arrived. No chip appears ahead
 * of time; at the end, a card that never arrived shows dim as "not in this reply" (resolved or stopped only).
 */
export function loadingModel({ progress = {}, streaming = false, modules = {}, prefs = {}, end = null, chips = true } = {}) {
    const expected = loadingExpected({ modules, display: progress.display || {}, prefs });
    const arrived = loadingArrived(progress);
    const shown = chips ? expected.filter(card => arrived.has(card.id)).map(card => ({ ...card, state: 'arrived' })) : [];
    if (end && end !== 'failed' && chips) {
        for (const card of expected) if (!arrived.has(card.id)) shown.push({ ...card, state: 'missing' });
    }
    const phase = end || loadingPhase(progress.phase, streaming);
    return { phase, text: LOADING_TEXT[phase], end, chips: shown };
}

// ---------- drawing ----------

const icon = (name, extra = '') => h('i', { class: `fa-solid ${name} ${extra}`.trim(), 'aria-hidden': 'true' });
let stylesheet = false;

function loadTrayStyles(doc = globalThis.document) {
    if (stylesheet || !doc?.head) return;
    stylesheet = true;
    if (doc.getElementById('ri-reply-tray')) return;
    const link = doc.createElement('link');
    link.id = 'ri-reply-tray';
    link.rel = 'stylesheet';
    link.href = new URL('../../src/ui/reply-tray.css', import.meta.url).href;
    doc.head.append(link);
}

function applyCardText(node, tray = traySettings()) {
    node.dataset.cardText = tray.cardText;
    node.style.setProperty('--ri-card-text-scale', String(tray.cardTextScale / 100));
}

function sceneLine(scene) {
    if (!scene) return null;
    const parts = [scene.place, scene.time, scene.weather].filter(Boolean);
    if (!parts.length) return null;
    return h('span', { class: 'ri-tray-scene', title: scene.source === 'header' ? 'From the reply\'s scene header' : 'From capture' },
        icon('fa-location-dot', 'ri-tray-mark'), h('span', { class: 'ri-tray-scene-text' }, parts.join(' · ')));
}

function peopleMarks(names) {
    if (!names.length) return null;
    return h('span', { class: 'ri-tray-people', 'aria-label': `Present: ${names.join(', ')}` },
        names.slice(0, 4).map(name => h('span', { class: 'ri-tray-person', title: name, 'aria-hidden': 'true' }, Array.from(name.trim())[0] || '?')),
        names.length > 4 ? h('span', { class: 'ri-tray-more', 'aria-hidden': 'true' }, `+${names.length - 4}`) : null);
}

function viewSwitch(current, choose) {
    return h('span', { class: 'ri-tray-views', role: 'group', 'aria-label': 'Tray view' },
        Object.entries(TRAY_VIEWS).map(([value, label]) => h('button', { type: 'button', class: 'ri-tray-view',
            'aria-pressed': String(value === current), 'aria-label': label, title: label,
            onclick: event => { event.stopPropagation(); choose(value); } }, icon(VIEW_ICONS[value]))));
}

function stripRow(marks, { view, choose, open }) {
    const summary = [
        sceneLine(marks.scene),
        peopleMarks(marks.people),
        marks.changes ? h('span', { class: 'ri-tray-count' }, `${marks.changes} ${marks.changes === 1 ? 'change' : 'changes'}`) : null,
        marks.calls.length ? h('span', { class: 'ri-tray-call', title: marks.calls.join('; '), 'aria-label': marks.calls.join('; ') }) : null,
        marks.warnings.length ? h('span', { class: 'ri-tray-warn', title: marks.warnings.join(' '), 'aria-label': marks.warnings.join(' ') },
            icon('fa-triangle-exclamation')) : null,
    ].filter(Boolean);
    return h('div', { class: 'ri-tray-strip' },
        h('button', { type: 'button', class: 'ri-tray-summary', 'aria-label': view === 'strip' ? 'Open the reply tray' : 'Reply tray',
            onclick: open }, summary.length ? summary : h('span', { class: 'ri-tray-empty' }, 'Reply tray')),
        viewSwitch(view, choose));
}

function headerNote() {
    const text = fallbackNote(headerState());
    if (!text) return null;
    return h('div', { class: 'ri-tray-note', role: 'status' }, h('span', {}, text),
        h('button', { type: 'button', class: 'ri-tray-link', onclick: () => tryHeaderInReplyAgain() }, 'Try in the reply again'));
}

function compactLines(cards, select) {
    const lines = cards.filter(card => card.first);
    if (!lines.length) return null;
    return h('ul', { class: 'ri-tray-lines' }, lines.map(card => h('li', { 'data-family': card.family || 'story' },
        h('button', { type: 'button', class: 'ri-tray-line', onclick: () => select(card.id) },
            icon(card.icon || 'fa-circle', 'ri-tray-line-icon'),
            h('span', { class: 'ri-tray-line-label' }, card.label),
            h('span', { class: 'ri-tray-line-value' }, card.first)))));
}

function expandedPanel(cards, selectedId, select) {
    const selected = cards.find(card => card.id === selectedId) || cards.find(card => card.first) || cards[0];
    if (!selected) return null;
    const panel = h('div', { class: 'ri-root ri-tray-panel', role: 'tabpanel', 'data-family': selected.family || 'story', 'aria-label': selected.label });
    const chips = h('div', { class: 'ri-tray-chips', role: 'tablist', 'aria-label': 'Cards' }, cards.map(card => h('button', {
        type: 'button', role: 'tab', class: 'ri-tray-chip', 'data-family': card.family || 'story', 'aria-selected': String(card === selected),
        'data-empty': card.first ? undefined : 'true', onclick: () => select(card.id) }, icon(card.icon || 'fa-circle'), h('span', {}, card.label))));
    const fill = async () => {
        try {
            if (typeof selected.load === 'function') await selected.load(panel);
            else panel.replaceChildren(...[selected.body?.()].flat(3).filter(Boolean));
            if (!panel.childNodes.length) panel.append(h('p', { class: 'ri-tray-help' }, 'Not in this reply.'));
        } catch (error) {
            panel.replaceChildren(h('p', { class: 'ri-tray-help', role: 'status' }, error.message),
                h('button', { type: 'button', class: 'ri-tray-link', onclick: fill }, 'Read again'));
        }
    };
    fill();
    return [chips, panel];
}

/**
 * Draw one reply's tray. `cards` are descriptors { id, label, icon, family, module, first, body?, load?,
 * strip?, names?, count?, warnings?, calls? }; `modules` decides Theirs and off features.
 */
export function replyTray({ id, latest, cards, modules, previous }) {
    loadTrayStyles();
    const shown = visibleCards(cards, modules);
    const marks = stripMarks(shown);
    const root = h('div', { class: 'ri-tray', 'data-reply': String(id), 'data-latest': latest ? 'true' : undefined,
        role: 'group', 'aria-label': 'Reply tray' });
    applyCardText(root);
    const position = latest ? 'latest' : 'earlier';
    const state = {
        view: previous?.dataset.view && previous.dataset.position === position ? previous.dataset.view : trayView(latest),
        selected: previous?.dataset.selected || '',
    };
    const draw = () => {
        root.dataset.view = state.view;
        root.dataset.position = position;
        root.dataset.selected = state.selected;
        const choose = view => { state.view = view; saveChatTray({ [position]: view }); draw(); };
        const select = card => { state.selected = card; state.view = 'expanded'; draw(); };
        const open = () => { if (state.view === 'strip') { state.view = 'compact'; draw(); } };
        root.replaceChildren(...[
            stripRow(marks, { view: state.view, choose, open }),
            latest && headerMode() === 'tray' ? headerNote() : null,
            state.view === 'compact' ? compactLines(shown, select) : null,
            state.view === 'expanded' ? expandedPanel(shown, state.selected, select) : null,
        ].flat().filter(Boolean));
    };
    draw();
    return shown.length || marks.scene ? root : null;
}

/** The loading Strip, drawn once per turn and updated in place so nothing jumps. */
export function loadingStrip() {
    loadTrayStyles();
    const node = h('div', { class: 'ri-tray ri-tray-loading', role: 'status', 'aria-live': 'polite' },
        h('div', { class: 'ri-tray-strip' },
            h('span', { class: 'ri-tray-summary' },
                h('span', { class: 'ri-tray-signal', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
                h('span', { class: 'ri-tray-phase' }),
                h('span', { class: 'ri-tray-arrivals' })),
            h('span', { class: 'ri-tray-end' })));
    applyCardText(node);
    return node;
}

/** Bring a loading Strip in line with `model`; only changed chips are touched. */
export function paintLoadingStrip(node, model, { readAgain } = {}) {
    node.dataset.phase = model.phase;
    node.dataset.end = model.end || '';
    const phase = node.querySelector('.ri-tray-phase');
    if (phase.textContent !== model.text) phase.textContent = model.text;
    const rail = node.querySelector('.ri-tray-arrivals');
    const want = model.chips.map(chip => `${chip.id}:${chip.state}`).join('|');
    if (rail.dataset.chips !== want) {
        rail.dataset.chips = want;
        const old = new Map([...rail.children].map(child => [child.dataset.card, child]));
        rail.replaceChildren(...model.chips.map(chip => {
            const keep = old.get(chip.id);
            if (keep && keep.dataset.state === chip.state) return keep;
            return h('span', { class: 'ri-tray-arrival', 'data-card': chip.id, 'data-state': chip.state },
                chip.state === 'missing' ? `${chip.label}: not in this reply` : chip.label);
        }));
    }
    const end = node.querySelector('.ri-tray-end');
    if (model.end === 'failed' && readAgain && !end.firstChild) {
        end.append(h('button', { type: 'button', class: 'ri-tray-link', onclick: readAgain }, 'Read again'));
    } else if (model.end !== 'failed') end.replaceChildren();
}

// ---------- Setup, Look, Reply tray ----------

let redrawHook = () => {};
/** sent.js passes its redraw, so a settings change redraws every tray at once. */
export function onTrayChange(fn) { if (typeof fn === 'function') redrawHook = fn; }
function redraw() { try { redrawHook(); } catch (error) { console.warn('[Roleplay Instructions] reply tray', error); } }

function choiceRow(legend, choices, current, choose, help) {
    return h('fieldset', { class: 'ri-tray-setting' }, h('legend', {}, legend),
        h('div', { class: 'ri-look-choices' }, Object.entries(choices).map(([value, label]) => h('button', {
            type: 'button', class: 'ri-bar-btn', 'aria-pressed': String(current === value), onclick: () => choose(value) }, label))),
        help ? h('p', { class: 'ri-help' }, help) : null);
}

export function renderTraySettings(body) {
    loadTrayStyles();
    const tray = traySettings();
    const local = chatTray();
    const host = h('div', { class: 'ri-look ri-tray-settings', id: 'ri-reply-tray-settings' });
    const rerender = () => { const fresh = h('div'); renderTraySettings(fresh); host.replaceWith(fresh.firstChild); };
    const set = change => { saveTray(change); rerender(); };
    const range = h('input', { type: 'range', min: CARD_TEXT_RANGE[0], max: CARD_TEXT_RANGE[1], step: 5, value: tray.cardTextScale,
        'aria-label': 'Card text scale', oninput: event => { output.textContent = `${event.target.value}%`; saveTray({ cardTextScale: Number(event.target.value) }); } });
    const output = h('output', {}, `${tray.cardTextScale}%`);
    host.append(
        choiceRow('Scene header', HEADER_MODES, headerSetting(), value => { setHeaderSetting(value); rerender(); },
            'In the reply, the model writes place, time, weather and who is present as the reply\'s first line. After 3 misses in the last 10 replies the chat moves it into the tray.'),
        choiceRow('Latest reply opens in', TRAY_VIEWS, tray.latest, value => set({ latest: value })),
        choiceRow('Earlier replies open in', TRAY_VIEWS, tray.earlier, value => set({ earlier: value })),
        choiceRow('Tray shows under', TRAY_PLACES, tray.where, value => set({ where: value })),
        h('fieldset', { class: 'ri-tray-setting' }, h('legend', {}, 'Card text'),
            h('div', { class: 'ri-look-choices' }, Object.entries(CARD_TEXT).map(([value, label]) => h('button', {
                type: 'button', class: 'ri-bar-btn', 'aria-pressed': String(tray.cardText === value), onclick: () => set({ cardText: value }) }, label))),
            h('label', {}, 'Scale', range, output),
            h('p', { class: 'ri-help' }, 'Labels 12 px and values 13 px in Compact, 13 and 14 px in Comfortable; the scale multiplies both.')));
    if (isChatOpen()) {
        const chatChoice = (legend, key, choices) => {
            const options = { '': 'Default', ...choices };
            return choiceRow(legend, options, local[key] || '', value => { saveChatTray({ [key]: value || undefined }); rerender(); });
        };
        host.append(h('h3', { class: 'ri-tray-subhead' }, 'This chat'),
            chatChoice('Latest reply', 'latest', TRAY_VIEWS),
            chatChoice('Earlier replies', 'earlier', TRAY_VIEWS),
            chatChoice('Tray shows under', 'where', TRAY_PLACES));
    }
    host.append(h('button', { type: 'button', class: 'ri-bar-btn', onclick: () => { settings().tray = { ...TRAY_DEFAULTS }; saveSettings(); redraw(); rerender(); } },
        'Restore tray defaults'));
    body.append(host);
}

export function mountReplyTray() {
    loadTrayStyles();
    registerPage({ id: 'reply-tray', group: 'setup', subgroup: 'Look', label: 'Reply tray',
        help: 'Choose the tray view, where it shows, card text and where the scene header lives.',
        aliases: 'strip compact expanded scene header card text tray cards under reply', withoutChat: true, render: body => renderTraySettings(body) });
}
