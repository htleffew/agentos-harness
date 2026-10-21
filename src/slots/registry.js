// Undercurrent 2: the slot registry (BUILD_SPEC §2.2). Pure.
// Every [[uc_*]] trigger is declared once: {id, trigger, zone:'static'|'turn', group, label, hint, requires?, build(ctx)}.
// Static slots sit above the chat history and must be deterministic given settings + card/persona + model family
// (never chat or state). Turn slots live in the one depth-1 block after the history.

import { voiced, fillPlaceholders } from './fill.js';
import { wordCount } from '../core/util.js';

/** Rule voice from settings ('loud' | 'plain'). */
export function voiceOf(ctx) {
    const v = String(ctx.settings?.[ctx.roles?.rule_voice] ?? 'loud');
    return v === 'plain' ? 'plain' : 'loud';
}

function fill(ctx, text) {
    return fillPlaceholders(text, ctx.placeholders).trim();
}

function extraFor(ctx, id) {
    const list = ctx.staticExtra?.[id];
    return Array.isArray(list) ? list.join('\n') : '';
}

function withExtra(ctx, id, text) {
    const add = extraFor(ctx, id);
    if (!add) return text;
    return text ? `${text}\n${add}` : add;
}

function voicedSlot(id) {
    return ctx => withExtra(ctx, id, fill(ctx, voiced(ctx.content?.slots?.[id], voiceOf(ctx))));
}

/**
 * Placeholders a slot needs (content.slot_requires, e.g. {uc_config:['uc.config_lines']}, else the registry default):
 * the slot is '' unless at least one of them is non-empty.
 */
export function requiredPlaceholders(ctx, slot) {
    const fromContent = ctx.content?.slot_requires?.[slot.id];
    const list = Array.isArray(fromContent) ? fromContent : (slot.requires ? [slot.requires] : []);
    return list.map(n => String(n).replace(/^uc\./, ''));
}

/**
 * Keep the highest-priority lines that fit a word budget (stable for equal priority, duplicates dropped).
 * @param {{text:string, priority?:number}[]} lines
 * @param {number} budget words; <= 0 means nothing
 */
export function budgetLines(lines, budget) {
    const max = Number(budget);
    if (!Array.isArray(lines) || !lines.length || !(max > 0)) return [];
    const seen = new Set();
    const ranked = lines
        .map((l, i) => ({ text: String(l?.text ?? '').trim(), priority: Number(l?.priority) || 0, i }))
        .filter(l => l.text && !seen.has(l.text) && seen.add(l.text))
        .sort((a, b) => b.priority - a.priority || a.i - b.i);
    const out = [];
    let used = 0;
    for (const l of ranked) {
        const w = wordCount(l.text);
        if (used + w > max) continue;
        out.push(l.text);
        used += w;
    }
    return out;
}

/** "<cast>" + lines + "</cast>" (a header that is a single opening tag gets its closing tag). */
export function section(header, lines) {
    if (!lines.length) return '';
    const h = String(header ?? '').trim();
    const tag = h.match(/^<([A-Za-z][\w-]*)>$/);
    if (tag) return [h, ...lines, `</${tag[1]}>`].join('\n');
    return h ? [h, ...lines].join('\n') : lines.join('\n');
}

function turnSection(id, headerKey) {
    return ctx => {
        const budget = ctx.settings?.[`budget.${id}`];
        const lines = budgetLines(ctx.lines?.[id] || [], budget === undefined ? 200 : budget);
        return section(ctx.content?.slots?.uc_turn_headers?.[headerKey], lines);
    };
}

export const SLOTS = Object.freeze([
    { id: 'uc_identity', zone: 'static', group: 'main', label: 'Narrator identity', hint: 'Narrator persona identity ({{uc.persona_identity}}), voiced or plain.', build: voicedSlot('uc_identity') },
    { id: 'uc_law', zone: 'static', group: 'main', label: 'The user\'s rules', hint: 'User rules + pronoun line.', build: voicedSlot('uc_law') },
    { id: 'uc_format', zone: 'static', group: 'main', label: 'Format', hint: 'POV, tense, thoughts, dialogue, length.', build: voicedSlot('uc_format') },
    { id: 'uc_world', zone: 'static', group: 'rules', label: 'World', hint: 'Reality, people, drive.', build: voicedSlot('uc_world') },
    // Explicitness "off" keeps this slot: its off-text is what keeps intimate scenes off the page.
    { id: 'uc_intimacy', zone: 'static', group: 'rules', label: 'Intimacy', hint: 'Intimacy rules at the chosen explicitness.', build: voicedSlot('uc_intimacy') },
    { id: 'uc_prose', zone: 'static', group: 'rules', label: 'Prose', hint: 'Anti-slop, anti-echo, ban list.', build: voicedSlot('uc_prose') },
    { id: 'uc_config', zone: 'static', group: 'style', label: 'Story Config', hint: 'Story Config block.', requires: 'config_lines', build: voicedSlot('uc_config') },
    { id: 'uc_style', zone: 'static', group: 'style', label: 'Style', hint: 'Tone, genre lens, author voice, narrator taste, quarantine rule.', build: voicedSlot('uc_style') },
    { id: 'uc_model', zone: 'static', group: 'style', label: 'Model note', hint: 'Model-family note (auto-detected).', requires: 'model_note', build: voicedSlot('uc_model') },

    { id: 'uc_cast', zone: 'turn', group: 'turn', label: 'Cast', hint: 'Present characters\' minds and relevant profile lines.', build: turnSection('uc_cast', 'cast') },
    { id: 'uc_recall', zone: 'turn', group: 'turn', label: 'Recall', hint: 'Memory recall.', build: turnSection('uc_recall', 'recall') },
    { id: 'uc_directive', zone: 'turn', group: 'turn', label: 'This turn', hint: 'Due event, chance rules, corrections, showrunner, one-shot note.', build: turnSection('uc_directive', 'directive') },
    {
        id: 'uc_think', zone: 'turn', group: 'turn', label: 'Reasoning steps', hint: 'native | prompted | off.',
        build(ctx) {
            if (ctx.reasoning === 'off') return '';
            const t = ctx.content?.slots?.uc_think;
            if (!t || typeof t !== 'object') return '';
            const plain = voiceOf(ctx) === 'plain' ? t[`${ctx.reasoning}_plain`] : undefined;
            const text = String(plain ?? t[ctx.reasoning] ?? '');
            return fill(ctx, text);
        },
    },
    { id: 'uc_envelope', zone: 'turn', group: 'turn', label: 'Envelope', hint: 'Hidden <UC> state instructions.', build: ctx => String(ctx.envelopeText ?? '').trim() },
    {
        id: 'uc_final', zone: 'turn', group: 'turn', label: 'Final check', hint: 'The most-violated rules, last thing read.',
        build(ctx) {
            if (ctx.mode === 'impersonate') return String(ctx.impersonationText ?? '').trim();
            return fill(ctx, voiced(ctx.content?.slots?.uc_final, voiceOf(ctx)));
        },
    },
].map(s => ({ ...s, trigger: `[[${s.id}]]` })));

export const STATIC_SLOTS = Object.freeze(SLOTS.filter(s => s.zone === 'static'));
export const TURN_SLOT_DEFS = Object.freeze(SLOTS.filter(s => s.zone === 'turn'));
export const ALL_TRIGGERS = Object.freeze(SLOTS.map(s => s.trigger));

/** Turn slots blanked per generation mode (BUILD_SPEC §2.3, §7). */
export const BLANK_BY_MODE = Object.freeze({
    normal: [],
    impersonate: ['uc_directive', 'uc_envelope', 'uc_think'],
    quiet: ['uc_directive', 'uc_envelope', 'uc_think', 'uc_final'],
    off: TURN_SLOT_DEFS.map(s => s.id),
});
