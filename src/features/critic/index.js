// Undercurrent 2 · FEATURES — critic: code-only checks on the reply the player just answered, turned into ONE
// correction line for the next reply. Never a model call.
//
// Checks (most important first; only the first finding becomes the line):
//   scripted_user — the reply narrated {{user}}'s own words, voluntary actions, decisions or feelings: the player's name
//                   as the subject of an action/speech/decision verb in narration (dialogue and *thoughts* ignored;
//                   hypothetical or negated clauses such as "before {{user}} answers" ignored), or "{{user}}'s heart…".
//                   Things done TO {{user}} never match (the name is then an object, not a subject).
//   omniscience   — a character reacted to {{user}}'s *private thoughts*: a 3-word phrase from the thoughts shows up in
//                   the reply although it was neither said aloud nor already in the story.
//   envelope      — the <UC> envelope is missing or cut off (the card's greeting is never checked).
// A violation repeated on consecutive replies gets a firmer prefix.

import { str, escapeRegex, narrationOf, clip, fillTokens, ENVELOPE_TAGS } from '../common/text.js';
import { anchor, cleanOf, userName, charName, isUser } from '../common/chat.js';
import { presentNames, characters } from '../common/state.js';
import { optBool, phrases } from '../common/settings.js';
import { USER_ACTION_VERBS, USER_INTERIOR_VERBS, USER_INTERIOR_NOUNS, SUBORDINATE_BEFORE } from '../common/lexicon.js';
import { findPrivateEcho } from '../ticguard/index.js';

export const DEFAULTS = Object.freeze({
    'critic.enabled': true,
    'critic.check_envelope': true,
});

export const SCHEMA = [
    { key: 'critic.enabled', tab: 'director', section: 'Quality', type: 'toggle', default: true, advanced: true, label: 'Rule critic',
        help: 'Code-only checks on each reply (writing for {{user}}, reacting to private thoughts, a missing envelope); one correction for the next reply.', scope: 'setup' },
    { key: 'critic.check_envelope', tab: 'director', section: 'Quality', type: 'toggle', default: true, advanced: true, label: 'Check the hidden state block',
        help: 'Remind the model when the reply forgot or cut off its hidden <UC> state block.', scope: 'setup' },
];

const FALLBACK = {
    critic_scripted_user: 'The last reply wrote for {{user}} ("{quote}"). Never write what {{user}} says, does, decides or feels; stop where {{user}} can answer.',
    critic_omniscience: '{name} reacted to {{user}}\'s private thought ("{quote}"). Text in asterisks is never heard or known by anyone.',
    critic_envelope_missing: 'The last reply {detail} the hidden <UC> section. End this reply with exactly one complete <UC> … </UC>.',
};

const ACTION = USER_ACTION_VERBS.map(escapeRegex).join('|');
const INTERIOR = USER_INTERIOR_VERBS.map(escapeRegex).join('|');
const NOUNS = USER_INTERIOR_NOUNS.map(escapeRegex).join('|');
const ADVERB = '(?:(?:\\w+ly|then|just|finally|also|still|only)\\s+)?';

function namePattern(ctx) {
    const names = ['{{user}}'];
    const u = userName(ctx);
    if (u && u.length >= 2) names.push(u);
    return names.map(n => escapeRegex(n).replace(/\s+/g, '\\s+')).join('|');
}

/** Scripted-{{user}} finding in a reply's prose, or null. */
export function findScriptedUser(text, ctx) {
    const narration = narrationOf(text);
    if (!narration) return null;
    const np = namePattern(ctx);
    const tests = [
        new RegExp(`(?:^|[^\\w'’])(${np})\\s+${ADVERB}(${ACTION}|${INTERIOR})\\b`, 'gi'),
        new RegExp(`(?:^|[^\\w'’])(${np})['’]s\\s+(?:\\w+\\s+)?(${NOUNS})\\s+(?:\\w+\\s+)?(?:races?|raced|pounds?|pounded|flutters?|fluttered|clenches|clenched|tightens?|tightened|stirs?|stirred|swells?|swelled|burns?|burned|sinks?|sank|catches|caught|hitches|hitched|quickens?|quickened|melts?|melted|aches?|ached|soars?|soared|drops?|dropped)\\b`, 'gi'),
    ];
    for (const re of tests) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(narration))) {
            const before = narration.slice(Math.max(0, m.index - 50), m.index + (m[0].length - m[0].trimStart().length));
            if (SUBORDINATE_BEFORE.test(before)) continue;
            return clip(m[0].replace(/^[^\w{]+/, '').trim(), 60);
        }
    }
    return null;
}

/** 'missing' | 'truncated' | '' for a raw reply. */
export function envelopeProblem(raw) {
    const s = str(raw);
    const open = s.lastIndexOf('<UC');
    if (open !== -1) {
        const tail = s.slice(open);
        if (!/<\/UC\s*>/i.test(tail)) return 'truncated';
        const body = tail.replace(/<\/UC\s*>[\s\S]*$/i, '');
        for (const tag of ENVELOPE_TAGS) {
            const opens = (body.match(new RegExp(`<${tag}\\b`, 'gi')) || []).length;
            const closes = (body.match(new RegExp(`</${tag}\\s*>`, 'gi')) || []).length;
            if (opens > closes) return 'truncated';
        }
        return '';
    }
    if (new RegExp(`<(?:${ENVELOPE_TAGS.join('|')})\\b`, 'i').test(s)) return '';
    return 'missing';
}

/** Who reacted: the nearest known character name before the leaked words, else the card character. */
function reactorName(ctx, prose, leak) {
    const words = leak.split(' ');
    const lower = prose.toLowerCase();
    let at = lower.indexOf(words[0]);
    for (let i = 1; at === -1 && i < words.length; i++) at = lower.indexOf(words[i]);
    const before = at === -1 ? prose : prose.slice(Math.max(0, at - 300), at);
    let best = null;
    for (const n of [...presentNames(ctx), ...Object.keys(characters(ctx))]) {
        if (isUser(ctx, n)) continue;
        const i = before.toLowerCase().lastIndexOf(n.toLowerCase());
        if (i !== -1 && (!best || i > best.i)) best = { n, i };
    }
    return best ? best.n : (charName(ctx) || '{{char}}');
}

/** Findings for one AI message (raw), given the user message it answered and earlier prose. */
export function checkReply({ ctx, raw, userMessage = '', earlier = [], isGreeting = false, checkEnvelope = true }) {
    const prose = cleanOf({ uid: 'critic', mes: str(raw), isUser: false });
    const out = [];
    const scripted = findScriptedUser(prose, ctx);
    if (scripted) out.push({ rule: 'scripted_user', detail: scripted });
    const leak = findPrivateEcho(prose, userMessage, earlier)[0];
    if (leak) out.push({ rule: 'omniscience', detail: leak, name: reactorName(ctx, prose, leak) });
    if (checkEnvelope && !isGreeting) {
        const p = envelopeProblem(raw);
        if (p) out.push({ rule: 'envelope', detail: p === 'missing' ? 'forgot' : 'cut off' });
    }
    return out;
}

const KEY = { scripted_user: 'critic_scripted_user', omniscience: 'critic_omniscience', envelope: 'critic_envelope_missing' };

/** The single correction for this turn: {rule, detail, text, firm} or null. */
export function criticTurn(ctx) {
    const a = anchor(ctx);
    if (!a.reply) return null;
    const checkEnvelope = optBool(ctx, 'critic.check_envelope', true);
    const firstAi = a.list.find(m => !m.isUser);
    const isGreeting = m => m === firstAi && !a.list.slice(0, a.list.indexOf(m)).some(x => x.isUser);
    const earlierProse = a.previous.slice(-4).map(cleanOf);
    const findings = checkReply({ ctx, raw: a.reply.mes, userMessage: a.replyUser?.mes || '', earlier: earlierProse, isGreeting: isGreeting(a.reply), checkEnvelope });
    if (!findings.length) return null;
    const f = findings[0];
    // Firmer wording when the reply before this one broke the same rule.
    const prev = a.previous[a.previous.length - 1];
    let firm = false;
    if (prev) {
        const idx = a.list.indexOf(prev);
        const prevUser = [...a.list.slice(0, idx)].reverse().find(m => m.isUser);
        firm = checkReply({ ctx, raw: prev.mes, userMessage: prevUser?.mes || '', earlier: a.previous.slice(-5, -1).map(cleanOf), isGreeting: isGreeting(prev), checkEnvelope })
            .some(x => x.rule === f.rule);
    }
    const list = phrases(ctx, KEY[f.rule]);
    const tpl = list.length ? list[0] : FALLBACK[KEY[f.rule]];
    let text = fillTokens(tpl, { quote: f.detail, detail: f.detail, name: f.name || charName(ctx) || '{{char}}' }).text;
    if (firm) text = `${(phrases(ctx, 'critic_firm_prefix')[0] || 'Again:')} ${text}`;
    return { ...f, text, firm };
}

export default {
    id: 'critic',
    settingsKeys: Object.keys(DEFAULTS),
    turnLines(ctx) {
        if (!optBool(ctx, 'critic.enabled', true)) return [];
        const c = criticTurn(ctx);
        return c ? [{ slot: 'uc_directive', text: c.text, priority: c.rule === 'envelope' ? 84 : 92, source: `critic:${c.rule}` }] : [];
    },
};
