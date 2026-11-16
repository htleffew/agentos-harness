// Dice. The extension rolls a d20 in code for each side that is switched on, adds the stat modifiers and works out
// the outcome for every stat. The model is told the results and picks the stat that fits an attempt. It never rolls
// and never adds.
import { ctx, names, characterKey } from './st.js';
import { settings, saveSettings } from './store.js';
import { rollInt } from './books.js';

export const DEFAULT_STATS = ['Strength', 'Agility', 'Wits', 'Charm', 'Will', 'Senses'];
export const MOD_MIN = -20;
export const MOD_MAX = 20;

/** The stats in use, in order. */
export function statNames() {
    const list = settings().dice?.stats;
    return (Array.isArray(list) ? list : DEFAULT_STATS).map(s => String(s || '').trim()).filter(Boolean);
}

/** The key a stat sheet is kept under: the character card, or the persona. */
export function sheetKey(who) {
    if (who === 'char') return characterKey() || `char:${names().char}`;
    const c = ctx();
    return `user:${c.user_avatar || names().user}`;
}

/** The stat modifiers of {{char}} or {{user}}: { [stat]: number }. Missing stats count as 0. */
export function sheet(who) {
    const all = settings().dice?.sheets || {};
    return all[sheetKey(who)] || {};
}

export function setStat(who, stat, value) {
    const d = settings().dice;
    if (!d.sheets) d.sheets = {};
    const key = sheetKey(who);
    const s = d.sheets[key] || (d.sheets[key] = {});
    s[stat] = Math.max(MOD_MIN, Math.min(MOD_MAX, Math.round(Number(value) || 0)));
    saveSettings();
}

/** The outcome of a roll: the total (the d20 plus the stat) alone decides. */
export function outcome(natural, total) {
    if (total <= 2) return 'fails badly';
    if (total <= 7) return 'fails';
    if (total <= 11) return 'partly succeeds';
    if (total <= 16) return 'succeeds';
    if (total <= 21) return 'succeeds well';
    return 'succeeds brilliantly';
}

const signed = n => (n > 0 ? `+${n}` : n < 0 ? `${n}` : '+0');

/**
 * Roll for every side that is switched on. Returns null when dice are off or no side is on, else
 * { text, rolls: [{ who, label, natural, stats: [{ name, mod, total, outcome }] }] }.
 */
export function rollDice() {
    const d = settings().dice;
    if (!d?.on) return null;
    const sides = [
        d.user !== false ? { who: 'user', label: '{{user}}' } : null,
        d.char !== false ? { who: 'char', label: '{{char}}' } : null,
        d.others !== false ? { who: 'others', label: 'Any other character' } : null,
    ].filter(Boolean);
    if (!sides.length) return null;
    const stats = statNames();
    const rolls = sides.map((s) => {
        const natural = rollInt(20) + 1;
        if (s.who === 'others' || !stats.length) return { ...s, natural, stats: [], plain: outcome(natural, natural) };
        const sh = sheet(s.who);
        return { ...s, natural, stats: stats.map((name) => { const mod = Math.round(Number(sh[name]) || 0); const total = natural + mod; return { name, mod, total, outcome: outcome(natural, total) }; }) };
    });
    const line = (r) => {
        if (!r.stats.length) return `- ${r.label}: the d20 rolled ${r.natural}, so an attempt ${r.plain}.`;
        return `- ${r.label}: the d20 rolled ${r.natural}. ${r.stats.map(s => `With ${s.name} (${signed(s.mod)}) the total is ${s.total}, so an attempt ${s.outcome}`).join('. ')}.`;
    };
    const who = sides.map(s => s.who === 'user' ? '{{user}} in {{user}}\'s last message' : s.who === 'char' ? '{{char}}' : 'any other character').join(', ');
    const text = [
        `Dice for this reply, already rolled. Use a result only when ${who} attempts something with real stakes and a real chance of failing. For anything else, ignore the dice. When you use one, pick the stat that fits the attempt and write the outcome given here. Roll nothing yourself and change no number.`,
        ...rolls.map(line),
        rolls.some(r => r.who === 'user') ? 'For {{user}}, the result settles only how the attempt turns out. Write what happens because of it, and leave {{user}}\'s own words, choices and feelings to {{user}}.' : '',
    ].filter(Boolean).join('\n');
    return { text, rolls: rolls.map(r => ({ who: r.who, label: r.label, natural: r.natural, stats: r.stats, ...(r.plain ? { plain: r.plain } : {}) })) };
}

/** The question asked with the check, when a check runs anyway. */
export const DICE_QUESTION = 'The reply settled an attempt with one of the dice results it was given, and wrote the outcome that result gives.';
