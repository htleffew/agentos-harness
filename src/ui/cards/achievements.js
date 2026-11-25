// Achievements (DESIGN 6.2, from Pura's Achievements Tracker): a title, its rarity as a row of typographic stars, and
// what earned it; at most one per scene. Capture writes "Title | rarity 1 to 5 | what earned it".
import { h } from '../dom.js';
import { foldedValue, starRow } from '../card-templates.js';
import { itemsOf, partsOf, pick, read, trackerOf } from './shared.js';

export const id = 'achievements';

const RARITY_WORDS = Object.freeze({ common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5, mythic: 5 });

/** A rarity from 1 to 5, read from a number, a row of stars or a word; null when none is given. */
export function rarityOf(value) {
    const text = String(value ?? '').trim();
    if (!text) return null;
    const stars = (text.match(/★/g) || []).length;
    if (stars) return Math.min(5, stars);
    const number = /(\d+(?:\.\d+)?)/.exec(text);
    if (number) return Math.max(1, Math.min(5, Math.round(Number(number[1]))));
    const word = Object.keys(RARITY_WORDS).find(key => text.toLowerCase().includes(key));
    return word ? RARITY_WORDS[word] : null;
}

/** One achievement: { title, rarity, why }. */
export function readAchievement(item) {
    if (typeof item === 'object') return { title: pick(item, 'title', 'name'), rarity: rarityOf(pick(item, 'rarity', 'stars', 'tier')), why: pick(item, 'why', 'reason', 'earned', 'text') };
    const [title, second = '', ...rest] = partsOf(item);
    const rarity = rarityOf(second);
    return { title, rarity, why: [rarity === null ? second : '', ...rest].filter(Boolean).join(' · ') };
}

export function render(env, { footer }) {
    if (!env.on('earned')) return null;
    const { value, mark } = read(trackerOf(env.view.rec, 'achievements')?.earned, env);
    const list = itemsOf(value).map(readAchievement).filter(item => item.title);
    if (!list.length) return null;
    return { first: list.map(item => item.title).join(', '), body: () => [
        list.map(item => h('section', { class: 'ri-c-person ri-c-achievement' },
            h('div', { class: 'ri-c-person-head' }, h('strong', {}, item.title), item.rarity !== null ? starRow(item.rarity) : null),
            item.why ? h('p', { class: 'ri-c-text' }, foldedValue(item.why)) : null)),
        mark ? h('p', { class: 'ri-c-unrequested' }, mark) : null,
        footer(env)] };
}
