// Undercurrent 2: fill [[uc_*]] triggers inside the outgoing chat-completion messages (BUILD_SPEC §2.3). Pure.
//
// Only messages whose string content (or text parts) contain "[[uc_" are touched. For each trigger: a non-empty value
// replaces every occurrence; an empty value deletes the trigger AND its line. A leak guard then removes any leftover
// [[uc_…]] with its line, and 3+ consecutive newlines collapse to one blank line. A message of ours that ends up empty
// is removed (an empty system message can be rejected by some providers); no other message is reordered or removed.

import { replaceAllLiteral } from '../core/util.js';

export const TRIGGER_PREFIX = '[[uc_';
const LEAK_RE = /\[\[uc_[A-Za-z0-9_]*\]\]/;
const LEAK_LINE_RE = /^.*\[\[uc_[A-Za-z0-9_]*\]\].*(?:\r?\n|$)/gm;

export function hasTrigger(message) {
    const c = message?.content;
    if (typeof c === 'string') return c.includes(TRIGGER_PREFIX);
    if (Array.isArray(c)) return c.some(p => p && typeof p.text === 'string' && p.text.includes(TRIGGER_PREFIX));
    return false;
}

/** Delete every line containing `trigger`. */
function deleteTriggerLines(text, trigger) {
    return text
        .split('\n')
        .filter(line => !line.includes(trigger))
        .join('\n');
}

/**
 * Fill one text.
 * @param {string} text
 * @param {Record<string,string>} values trigger → final value (macros already substituted)
 */
export function fillText(text, values) {
    let out = String(text ?? '');
    if (!out.includes(TRIGGER_PREFIX)) return out;
    for (const [trigger, value] of Object.entries(values || {})) {
        if (!out.includes(trigger)) continue;
        const v = String(value ?? '');
        out = v.trim() ? replaceAllLiteral(out, trigger, v) : deleteTriggerLines(out, trigger);
    }
    // Leak guard: anything [[uc_…]] still here goes with its line (values never re-introduce triggers: we strip them too).
    if (LEAK_RE.test(out)) out = out.replace(LEAK_LINE_RE, '');
    out = out.replace(/(?:[ \t]*\r?\n){3,}/g, '\n\n');
    return out.replace(/^\s*\n/, '').replace(/\n\s*$/, '');
}

/**
 * Fill every message that carries our triggers, in place.
 * @param {object[]} messages chat-completion messages [{role, content}]
 * @param {Record<string,string>} values trigger → value
 * @returns {{touched:number, removed:number}}
 */
export function fillMessages(messages, values) {
    if (!Array.isArray(messages)) return { touched: 0, removed: 0 };
    // A value must never smuggle in another trigger (e.g. a prompt override containing "[[uc_x]]").
    const safe = {};
    for (const [t, v] of Object.entries(values || {})) safe[t] = String(v ?? '').replace(new RegExp(LEAK_RE.source, 'g'), '');
    let touched = 0;
    const emptied = [];
    for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        if (!hasTrigger(m)) continue;
        touched++;
        if (typeof m.content === 'string') {
            m.content = fillText(m.content, safe);
            if (!m.content.trim()) emptied.push(i);
        } else if (Array.isArray(m.content)) {
            for (const part of m.content) {
                if (part && typeof part.text === 'string' && part.text.includes(TRIGGER_PREFIX)) part.text = fillText(part.text, safe);
            }
            const textLeft = m.content.some(p => p && (typeof p.text !== 'string' || p.text.trim()));
            if (!textLeft) emptied.push(i);
        }
    }
    for (let k = emptied.length - 1; k >= 0; k--) messages.splice(emptied[k], 1);
    return { touched, removed: emptied.length };
}
