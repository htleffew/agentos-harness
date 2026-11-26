// Setup, Look, Reply tray: the card list (DESIGN.md 6.2). One switch row per card with a one-line effect, Off,
// Strip only or In the tray, an order, and under it, while the card is on, a switch for each section and field.
// Turning one off hides it and drops it from what capture asks for (src/cards/catalog.js).
import { settings, saveSettings } from '../store.js';
import { h, toggle } from './dom.js';
import {
    cardMode, FAMILIES, fieldDefault, fieldKey, isBuilt, MODES, moveCard, normalizeConfig, orderedCards, sectionKey, sectionOn, setMode, setOn,
} from '../cards/catalog.js';
import { diceDisplayRow } from './stat-sheet.js';

const icon = (name, extra = '') => h('i', { class: `fa-solid ${name} ${extra}`.trim(), 'aria-hidden': 'true' });

/** The saved card setting, cleaned against the catalog. */
export function trayCardConfig(st = settings()) {
    st.trayCards = normalizeConfig(st.trayCards);
    return st.trayCards;
}

async function redrawTrays() {
    try { (await import('./sent.js')).refreshUnderReplies(); } catch (error) { console.warn('[Roleplay Instructions] reply cards', error); }
}

export function saveCardConfig(next) {
    settings().trayCards = normalizeConfig(next);
    saveSettings();
    redrawTrays();
}

/** The element id of the switch for a card, a `scene:where` section key or a `scene.place` field key. */
export const switchAnchor = key => `#ri-card-switch-${String(key).replace(':', '-s-').replace('.', '-f-')}`;
const switchId = key => switchAnchor(key).slice(1);

/** A switch whose accessible name is its label. */
function switchRow(key, label, checked, change, { help = '', disabled = false, level = 'field' } = {}) {
    const control = toggle(checked, change, label);
    if (disabled) { control.disabled = true; control.setAttribute('aria-disabled', 'true'); }
    return h('div', { class: 'ri-cardset-switch', id: switchId(key), 'data-level': level },
        h('span', { class: 'ri-cardset-switch-label' }, label, help ? h('span', { class: 'ri-help' }, help) : null), control);
}

const openFolds = new Set();
function drawn(item) { return isBuilt(item) || item.today; }

function cardRow(card, config, apply) {
    const mode = cardMode(config, card.id);
    const live = drawn(card) || card.sections.some(drawn);
    const order = orderedCards(config);
    const at = order.findIndex(item => item.id === card.id);
    const row = h('section', { class: 'ri-cardset', id: switchId(card.id), 'data-card': card.id, 'data-family': card.family, 'data-mode': mode, 'data-built': live ? 'true' : 'false' });
    const choose = value => apply(setMode(config, card.id, value));
    const modes = h('div', { class: 'ri-cardset-modes', role: 'group', 'aria-label': `${card.label} display` },
        Object.entries(MODES).map(([value, label]) => h('button', { type: 'button', class: 'ri-bar-btn', 'aria-pressed': String(mode === value), disabled: !live,
            onclick: () => choose(value) }, label)));
    const move = (label, direction, disabled) => h('button', { type: 'button', class: 'ri-bar-btn ri-cardset-move', 'aria-label': `Move ${card.label} ${label}`, title: `Move ${label}`,
        disabled, onclick: () => apply(moveCard(config, card.id, direction)) }, icon(direction < 0 ? 'fa-arrow-up' : 'fa-arrow-down'));
    row.append(
        h('div', { class: 'ri-cardset-head' },
            icon(card.icon, 'ri-cardset-icon'),
            h('div', { class: 'ri-cardset-title' }, h('strong', {}, card.label), h('span', { class: 'ri-cardset-family' }, FAMILIES[card.family])),
            h('div', { class: 'ri-cardset-order' }, move('up', -1, at <= 0), move('down', 1, at >= order.length - 1))),
        h('p', { class: 'ri-help ri-cardset-effect' }, live ? card.effect : `${card.effect} Not built yet.`),
        modes);
    if (mode !== 'off' && live) {
        const list = h('div', { class: 'ri-cardset-parts' });
        for (const section of card.sections.filter(drawn)) {
            const single = section.fields.length === 1;
            const on = sectionOn(config, card.id, section.id);
            list.append(switchRow(sectionKey(card.id, section.id), section.label, on, value => apply(setOn(config, sectionKey(card.id, section.id), value)),
                { level: 'section', help: single ? section.fields[0].label !== section.label ? section.fields[0].label : '' : '' }));
            if (on && !single) for (const field of section.fields.filter(drawn)) {
                const value = config.on?.[fieldKey(card.id, field.id)] ?? fieldDefault(section, field);
                list.append(switchRow(fieldKey(card.id, field.id), field.label, value, next => apply(setOn(config, fieldKey(card.id, field.id), next))));
            }
        }
        row.append(h('details', { class: 'ri-cardset-fold', open: openFolds.has(card.id), ontoggle: event => event.currentTarget.open ? openFolds.add(card.id) : openFolds.delete(card.id) }, h('summary', {}, 'Sections and fields'), list));
    }
    return row;
}

/** Draw the card list into `host`. `rerender` redraws the whole Reply tray page after a change. */
export function renderCardSettings(host, rerender = () => {}) {
    const config = trayCardConfig();
    const apply = next => { saveCardConfig(next); rerender(); };
    host.append(
        h('h3', { class: 'ri-tray-subhead' }, 'Cards'),
        h('p', { class: 'ri-help' }, 'Each card is Off, Strip only (its marks on the Strip, no card) or In the tray. A section or field you switch off is left out of what each reply asks for.'),
        // B22: the Dice display row (One line or Hidden), drawn by its own module.
        diceDisplayRow(rerender),
        h('div', { class: 'ri-cardset-list' }, orderedCards(config).map(card => cardRow(card, config, apply))),
        h('button', { type: 'button', class: 'ri-bar-btn', onclick: () => apply({}) }, 'Restore card defaults'));
}
