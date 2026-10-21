// Undercurrent 2: fill background-job prompt text (content.jobs.*, directive phrases). Pure.
// Order (coordinator decision): single-brace local tokens ({card} {persona} {state} {recent} {previous} {messages}
// {range} {value} {phrase} {quote} {name} {n}) → {{uc.*}} placeholders → SillyTavern macros (substituteParams).
// A known local token without a value becomes '' (never sent unfilled); unknown braces are left alone.

import { fillPlaceholders } from '../slots/fill.js';

export const LOCAL_TOKENS = Object.freeze(['card', 'persona', 'state', 'recent', 'previous', 'messages', 'range', 'value', 'phrase', 'quote', 'name', 'n']);
const TOKEN_RE = new RegExp(`\\{(${LOCAL_TOKENS.join('|')})\\}`, 'g');

/** Replace local tokens in one pass (inserted values are not re-scanned). */
export function fillLocalTokens(text, tokens = {}) {
    return String(text ?? '').replace(TOKEN_RE, (_, name) => {
        const v = typeof tokens[name] === 'function' ? tokens[name]() : tokens[name];
        return v === undefined || v === null ? '' : String(v);
    });
}

/**
 * @param {string} text
 * @param {{tokens?:object, placeholders?:object, substitute?:(t:string)=>string}} o
 */
export function fillJobText(text, { tokens = {}, placeholders = {}, substitute = t => t } = {}) {
    const local = fillLocalTokens(text, tokens);
    const uc = fillPlaceholders(local, placeholders);
    try { return String(substitute(uc) ?? uc); } catch { return uc; }
}

/** {card}: the character card as plain text. */
export function cardText(card = {}) {
    return [
        card.name ? `Name: ${card.name}` : '',
        card.description ? String(card.description).trim() : '',
        card.personality ? `Personality: ${String(card.personality).trim()}` : '',
        card.scenario ? `Scenario: ${String(card.scenario).trim()}` : '',
    ].filter(Boolean).join('\n');
}

/** {state}: compact derived state as plain lines. */
export function stateLines(state) {
    if (!state) return '';
    const L = [];
    const sc = state.scene || {};
    const sceneBits = Object.entries(sc).filter(([k, v]) => k !== 'present' && v).map(([k, v]) => `${k}: ${v}`);
    if (sceneBits.length) L.push(`Scene: ${sceneBits.join(' | ')}`);
    if (Array.isArray(sc.present) && sc.present.length) L.push(`Present: ${sc.present.join(', ')}`);
    for (const [name, ch] of Object.entries(state.characters || {})) {
        const mind = Object.entries(ch.mind || {}).filter(([, v]) => v).map(([k, v]) => `${k.replace('_', ' ')}: ${v}`);
        const off = ch.offscreen ? `offscreen: ${ch.offscreen}` : '';
        const bits = [...mind, off].filter(Boolean);
        if (bits.length) L.push(`${name}: ${bits.join(' | ')}`);
    }
    const th = state.threads || {};
    for (const p of th.planted || []) L.push(`Planted: ${p.text}`);
    for (const t of th.timers || []) L.push(`Timer: ${t.text}${Number.isFinite(t.remaining) ? ` (${t.remaining} turns left)` : ''}`);
    for (const f of (state.facts || []).slice(-15)) L.push(`Fact: ${f.text}`);
    const tr = Object.entries(state.tracker || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
    if (tr.length) L.push(`Tracker: ${tr.join(' | ')}`);
    return L.join('\n');
}

/** {recent}: the last n messages as "Name: text", with envelopes and reasoning stripped by `clean`. */
export function recentLines(chat, n = 8, clean = t => t) {
    const list = (Array.isArray(chat) ? chat : []).filter(m => m && !m.is_system && String(m.mes ?? '').trim());
    return list.slice(-Math.max(1, n)).map(m => `${m.name || (m.is_user ? '{{user}}' : '{{char}}')}: ${clean(String(m.mes ?? '')).trim()}`).join('\n\n');
}
