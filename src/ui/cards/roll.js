// Roll (DESIGN 6.2 and 6.9): one line per roll in this reply, who, the attempt, stat, difficulty, total and degree, with the
// die and the stat modifier at the end of the same line. The card holds these lines and nothing more; no expanded roll view
// exists. With Dice display set to Hidden the card draws nothing, and the rolls stay in the Sent card. This module also
// registers the Stats card and adds the dice judgment's receipt to the Sent card.
import { h } from '../dom.js';
import { rollLine } from '../card-templates.js';
import { ctx } from '../../st.js';
import { diceDisplay, diceOf, lineParts, lineText, rollsOf } from '../../dice.js';
import { JUDGE_CALL_WORDS, JUDGE_LABEL } from '../../dice-judge.js';
import { ROUTES } from '../../routing.js';
import { markBuilt } from '../../cards/catalog.js';
import { icon } from './shared.js';
import * as stats from './stats.js';

export const id = 'roll';

const messageOf = env => ctx().chat?.[Number(env.view?.id)] || null;

export function render(env) {
    if (diceDisplay() === 'hidden' || !env.on('lines')) return null;
    const rolls = rollsOf(messageOf(env));
    if (!rolls.length) return null;
    const lead = rolls[0];
    return { first: `${lineParts(lead).attempt}: ${String(lead.degree).toLowerCase()}`, count: rolls.length,
        // SillyTavern draws the swipe arrow over the last reply's right edge; the lines keep clear of it, so the die and
        // the modifier at the end of each line stay readable.
        body: () => [h('div', { class: 'ri-roll-lines', style: { paddingRight: '28px' } }, rolls.map(roll => rollLine(lineParts(roll))))] };
}

const routeLabel = route => route === 'code' ? 'Code' : route === 'die button' ? 'Die button' : ROUTES[route]?.label || route;
const TRIED = { answered: 'answered', skipped: 'skipped', late: 'too late', failed: 'failed', invalid: 'unusable answer' };

/** The Sent card's dice section: the judgment call with the extension-added call words, then every roll as one line. */
export function sentSection(message) {
    const saved = diceOf(message);
    const rolls = rollsOf(message);
    const judge = saved?.judge;
    if (!judge && !rolls.length) return null;
    const called = judge && !judge.skipped;
    const nodes = () => [h('section', { class: 'ri-c-section ri-c-sent-dice' },
        h('h4', { class: 'ri-c-head' }, icon('fa-dice-d20'), h('span', {}, 'Dice')),
        called ? h('p', { class: 'ri-c-cost', 'data-call': 'extra' }, icon('fa-microchip'), h('span', {}, `${JUDGE_LABEL}, ${JUDGE_CALL_WORDS}`)) : null,
        judge ? h('p', { class: 'ri-c-note' }, judge.skipped
            ? `No judgment call: ${judge.reason || 'no action by anyone'}.`
            : [`Answered by ${routeLabel(judge.route)}${judge.model ? ` (${judge.model})` : ''}`, judge.copied ? 'kept from the version it continues' : '',
                (judge.tried || []).filter(t => t.route !== judge.route).map(t => `${routeLabel(t.route)} ${TRIED[t.outcome] || t.outcome}`).join(', ')].filter(Boolean).join('; ') + '.') : null,
        rolls.length ? h('ul', { class: 'ri-c-list' }, rolls.map(roll => h('li', {}, lineText(roll)))) : h('p', { class: 'ri-c-note' }, 'No attempt needed a roll.'))];
    return { call: called ? JUDGE_LABEL : '', nodes };
}

/** The Sent card with the dice section after whatever it already holds. */
export function sentWithDice(coreRender) {
    return env => {
        const part = coreRender ? coreRender(env) : null;
        const section = env.on('sent') ? sentSection(messageOf(env)) : null;
        if (!section) return part;
        const calls = [...(part?.calls || []), ...(section.call ? [section.call] : [])];
        if (!part) return { first: section.call ? `${JUDGE_LABEL}, ${JUDGE_CALL_WORDS}` : 'Dice', calls, body: () => section.nodes() };
        return { ...part, calls, body: () => [...[typeof part.body === 'function' ? part.body() : part.body].flat(8).filter(Boolean), ...section.nodes()] };
    };
}

/** Register Roll, Stats and the Sent card's dice section with the tray (reply-cards.js calls this after the parity cards). */
export function installDiceCards({ register, core }) {
    const guard = (label, fn) => env => { try { return fn(env); } catch (error) { console.warn('[Roleplay Instructions]', `${label} card`, error); return null; } };
    register(id, guard('Roll', render));
    register(stats.id, guard('Stats', stats.render));
    register('sent', sentWithDice(core('sent')));
    markBuilt('B22');
}
