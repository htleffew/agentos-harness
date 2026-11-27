// Stat sheets on screen (DESIGN 6.9): the sheet editor the Stats card and Story, Characters, Stats share, and the Dice
// display row of Setup, Look, Reply tray. A value she types is marked "yours", and no later inference changes it.
import { h, field, textInput } from './dom.js';
import { home } from './homes.js';
import { settings, saveSettings } from '../store.js';
import { registerPage } from './page-registry.js';
import { isChatOpen, names } from '../st.js';
import { savedSheets, statNames, statsOf, setStatByHand, releaseStat, inferChatSheets, DEFAULT_STATS, MOD_MIN, MOD_MAX } from '../stat-sheets.js';
import { DISPLAY, diceDisplay, setDiceDisplay, diceOn } from '../dice.js';

const icon = (name, extra = '') => h('i', { class: `fa-solid ${name} ${extra}`.trim(), 'aria-hidden': 'true' });
const signed = n => `${n > 0 ? '+' : ''}${n}`;
const KIND_LABEL = { persona: 'Persona', character: 'Character', npc: 'NPC' };
const SOURCE_LABEL = { card: 'from the card', book: 'from its World Info book', play: 'made during play', you: 'set by you', import: 'saved sheet' };

/** Redraw every tray. A tray keeps its drawing while its reply is unchanged, so its stamp is cleared first, as its own redraw does. */
export async function redrawTrays() {
    for (const tray of globalThis.document?.querySelectorAll?.('#chat .ri-tray') || []) tray.dataset.stamp = '';
    try { (await import('./sent.js')).refreshUnderReplies(); } catch (error) { console.warn('[Roleplay Instructions] reply cards', error); }
}

/** The sheets in the order the card shows them: persona, character, then NPCs by name. */
export function orderedSheets() {
    const all = savedSheets();
    const out = [];
    // Persona and character show the stats a roll adds: a sheet saved per card or persona before per-chat sheets, under this chat's own.
    for (const subject of ['user', 'char']) {
        const sheet = all[subject] || { name: subject === 'user' ? names().user : names().char, kind: subject === 'user' ? 'persona' : 'character', stats: {}, mine: {}, reasons: {}, source: '' };
        out.push([subject, { ...sheet, stats: statsOf(subject) }]);
    }
    for (const [subject, sheet] of Object.entries(all).filter(([key]) => key.startsWith('npc:')).sort((a, b) => String(a[1].name).localeCompare(String(b[1].name)))) out.push([subject, sheet]);
    return out;
}

/** The short summary of a sheet: its two highest stats. */
export function sheetSummary(sheet) {
    const top = Object.entries(sheet?.stats || {}).filter(([, v]) => Number(v)).sort((a, b) => b[1] - a[1]).slice(0, 2);
    return `${sheet?.name || 'Someone'}: ${top.length ? top.map(([s, v]) => `${s} ${signed(v)}`).join(', ') : 'all 0'}`;
}

/** One stat: a number box with the stat's name, the "yours" mark and the reason inference gave. */
function statBox(subject, sheet, stat, onChange) {
    const value = Number(sheet.stats?.[stat]) || 0;
    const mine = !!sheet.mine?.[stat];
    const input = h('input', { type: 'number', class: 'ri-stat-input', min: String(MOD_MIN), max: String(MOD_MAX), step: '1', value: String(value), inputmode: 'numeric',
        'aria-label': `${sheet.name} ${stat}`, 'data-stat': stat, style: STYLE.input,
        onchange: event => { setStatByHand(subject === 'user' || subject === 'char' ? subject : sheet.name, stat, event.currentTarget.value, sheet.name); onChange?.(); } });
    return h('div', { class: 'ri-stat', 'data-mine': mine ? 'true' : 'false', style: STYLE.cell },
        h('label', { class: 'ri-stat-name', style: STYLE.label }, h('span', {}, stat), input),
        mine ? h('button', { type: 'button', class: 'ri-tray-link ri-stat-mine', title: 'Let inference set this value again', style: STYLE.note,
            'aria-label': `${stat} is yours. Let inference set it again`, onclick: () => { releaseStat(subject === 'user' || subject === 'char' ? subject : sheet.name, stat); onChange?.(); } }, 'yours')
            : sheet.reasons?.[stat] ? h('span', { class: 'ri-stat-why', style: STYLE.note }, sheet.reasons[stat]) : null);
}

// Dense layout from the card templates' measures (DESIGN 6.5): 32 px Compact targets, 12 px floor, 4 px gaps.
const STYLE = {
    head: { display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '6px' },
    grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(8.5em, 1fr))', gap: '4px 12px' },
    cell: { display: 'flex', flexDirection: 'column', minWidth: '0' },
    label: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', minHeight: '32px' },
    input: { width: '4.2em', minHeight: '32px', boxSizing: 'border-box', font: 'inherit' },
    note: { fontSize: '12px', opacity: '0.85', overflowWrap: 'anywhere', textAlign: 'left', minHeight: '24px' },
};

/** Every sheet of this chat, editable. onChange redraws whatever holds it. */
export function sheetEditor(onChange) {
    if (!isChatOpen()) return h('p', { class: 'ri-help' }, 'Open a chat to see its stat sheets.');
    const stats = statNames();
    return h('div', { class: 'ri-stat-sheets' }, orderedSheets().map(([subject, sheet]) => h('section', { class: 'ri-stat-sheet', 'data-subject': subject },
        h('h4', { class: 'ri-c-head', style: STYLE.head }, icon(subject === 'user' ? 'fa-user' : subject === 'char' ? 'fa-masks-theater' : 'fa-user-group'),
            h('span', {}, sheet.name || subject), h('span', { class: 'ri-c-note' }, [KIND_LABEL[sheet.kind] || 'NPC', SOURCE_LABEL[sheet.source] || '', sheet.book ? `"${sheet.book}"` : ''].filter(Boolean).join(', '))),
        h('div', { class: 'ri-stat-grid', style: STYLE.grid }, stats.map(stat => statBox(subject, sheet, stat, onChange))))));
}

/** "Infer again" with its cost chip: it keeps every value marked yours. */
export function inferButton(onDone) {
    const node = h('button', { type: 'button', class: 'ri-bar-btn ri-cost-chip', 'aria-label': 'Infer the persona and character sheets again, 1 model call, extra request',
        onclick: async () => {
            node.disabled = true;
            try { await inferChatSheets({ force: true }); } catch (error) { console.warn('[Roleplay Instructions] stat sheets', error); }
            node.disabled = false;
            onDone?.();
        } }, icon('fa-microchip'), h('span', {}, 'Infer again'), h('span', { class: 'ri-c-note' }, '1 model call'));
    return node;
}

/** One line needs the Roll card in the tray: choosing it switches the card and its lines on when they are off. */
async function showRollCard() {
    const { trayCardConfig, saveCardConfig } = await import('./tray-settings.js');
    const { cardMode, sectionOn, setMode, setOn, sectionKey } = await import('../cards/catalog.js');
    let config = trayCardConfig();
    if (cardMode(config, 'roll') === 'off') config = setMode(config, 'roll', 'tray');
    if (!sectionOn(config, 'roll', 'lines')) config = setOn(config, sectionKey('roll', 'lines'), true);
    saveCardConfig(config);
}

/** The Dice display row of Setup, Look, Reply tray: One line or Hidden. */
export function diceDisplayRow(rerender = () => {}) {
    const current = diceDisplay();
    return h('fieldset', { class: 'ri-tray-setting', id: 'ri-dice-display' }, h('legend', {}, 'Dice display'),
        h('div', { class: 'ri-look-choices', role: 'group', 'aria-label': 'Dice display' }, Object.entries(DISPLAY).map(([value, label]) => h('button', {
            type: 'button', class: 'ri-bar-btn', 'aria-pressed': String(current === value),
            onclick: async () => { setDiceDisplay(value); if (value === 'line') await showRollCard().catch(error => console.warn('[Roleplay Instructions] Roll card', error)); redrawTrays(); rerender(); } }, label))),
        h('p', { class: 'ri-help' }, current === 'hidden'
            ? 'Hidden: nothing shows in the tray. The verdict still decides each attempt, and the roll stays in the Sent card.'
            : 'One line: each roll shows as one line inside the Roll card, ending with the die and the stat modifier.'));
}

/** The stats every sheet uses, in order. Its one home is Story, Characters, Stats. */
function statList(onChange) {
    const st = settings();
    return home('dice-stats', field('Stats in use', `Separate them with commas. Each sheet gives every stat a modifier from ${MOD_MIN} to +${MOD_MAX}.`,
        textInput(statNames().join(', '), value => {
            const list = String(value).split(',').map(item => item.trim()).filter(Boolean);
            st.dice ||= {};
            st.dice.stats = list.length ? list : [...DEFAULT_STATS];
            saveSettings();
        }, { placeholder: DEFAULT_STATS.join(', '), 'aria-label': 'Stats in use', onchange: () => onChange?.() })));
}

registerPage({ id: 'stat-sheets', group: 'story', tab: 'characters', label: 'Stats', aliases: 'dice stat sheet modifiers npc persona',
    help: 'This chat\'s stat sheets for your persona, the character and NPCs. A value you set stays yours.',
    render(body, app) {
        const redraw = () => { app?.render?.(); redrawTrays(); };
        body.append(h('div', { class: 'ri-stat-page' },
            h('p', { class: 'ri-help' }, diceOn() ? `Every roll adds the actor's modifier for its stat, from ${MOD_MIN} to +${MOD_MAX}. 0 is ordinary.` : 'Dice are off. The sheets are kept for when you turn them on.'),
            sheetEditor(redraw), isChatOpen() ? inferButton(redraw) : null, statList(redraw)));
    } });
