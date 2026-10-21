// Undercurrent 2 · FEATURES — safety filter for any directive line that did not come from shipped content
// (chance-rule pools, LoreBary imports, lines expanded from runtime state, showrunner output).
// A line is unsafe when it would script {{user}} (words, voluntary actions, thoughts, feelings, arousal, choices), ask
// for printed trackers/footers/meters, mandate slow burn or escalation, or try to override instructions. Conditional or
// negated mentions ("if {{user}} says stop…", "never speak for {{user}}") and an NPC's own wish about {{user}} are fine.

import { str, escapeRegex } from './text.js';
import { REFLEXIVE_PRONOUNS } from './lexicon.js';

export const INVISIBLE_RE = /[­᠎​-‏‪-‮⁠-⁯﻿︀-️]|\uDB40[\uDC00-\uDDEF]/g;

export function stripInvisible(text) {
    return str(text).replace(INVISIBLE_RE, '');
}

const VERBS = ('moan gasp shudder feel think say whimper beg want decide enjoy tremble arch orgasm climax nod smile blush flush agree '
    + 'reply answer respond ask whisper groan sigh laugh giggle grin cry sob weep kiss touch grab reach lean walk move stare glance step '
    + 'turn pull push take give hold wrap press melt surrender submit yield crave need love like hate realize realise wonder hope wish '
    + 'imagine remember notice tense relax swallow speak tell call admit confess apologize find become grow undress strip sit stand lie '
    + 'sleep wake eat drink run leave enter follow wait stay go return arrive climb kneel obey comply accept refuse consent').split(' ');

const VERB_FORMS = (() => {
    const forms = new Set();
    for (const v of VERBS) {
        forms.add(v);
        forms.add(/(s|sh|ch|x)$/.test(v) ? `${v}es` : /[^aeiou]y$/.test(v) ? `${v.slice(0, -1)}ies` : `${v}s`);
        forms.add(v.endsWith('e') ? `${v}d` : /[^aeiou]y$/.test(v) ? `${v.slice(0, -1)}ied` : `${v}ed`);
        forms.add(v.endsWith('e') && !v.endsWith('ee') ? `${v.slice(0, -1)}ing` : `${v}ing`);
    }
    for (const x of ['said', 'thought', 'felt', 'came', 'took', 'gave', 'held', 'told', 'spoke', 'knelt', 'found', 'became', 'grew', 'wept', 'went', 'sat', 'stood', 'lay', 'slept', 'woke', 'ate', 'drank', 'ran', 'left']) forms.add(x);
    return forms;
})();
const isVerb = w => VERB_FORMS.has(String(w || '').toLowerCase());

const INTERIOR = 'thoughts?|feelings?|arousal|desires?|pleasure|orgasms?|climax|emotions?|fantas(?:y|ies)|wants|needs|lust|wetness|erection';
const RESPONSE = 'races?|pounds?|flutters?|skips?|hammers?|leaps?|responds?|reacts?|betrays?|arches|trembles?|shudders?|melts?|clenches|throbs?|tightens?|aches?|twitches|pulses?|flushes|tingles?|quivers?|gives\\s+(?:in|way)|yields?';
const WRITE_VERBS = 'write|describe|narrate|depict|show|script|decide|invent|voice|portray|detail|render|choose|dictate|generate';
const SUBORDINATE = /\b(?:if|when|whenever|whatever|what|whether|unless|once|until|after|before|while|in\s+case|wait\s+for|waits\s+for|let|lets)\s+(?:\w+\s+){0,2}$/i;
const DESIRE_FRAME = /\b(?:wants?|wanting|wanted|would\s+(?:like|love)|longs?|hopes?|wish(?:es)?|imagines?|pictures?|fantasi[sz]\w*|thinks?\s+about|dreams?\s+(?:of|about)|asks?|asking|invites?|urges?|begs?|tells?|orders?|dares?)\b(?:\s+\S+){0,5}\s*$/i;
const NEGATED = /\b(?:never|not|don't|do\s+not|doesn't|does\s+not|no|avoid|without|nor)\b(?:\s+\S+){0,4}\s*$/i;

const META = [
    ['slow-burn mandate', /slow[\s-]*burn|\b(?:no|never|don't|do\s+not)\s+(?:kiss\w*|sex|intimacy|touch\w*)\b[^.]{0,40}\b(?:until|before)\b/i],
    ['tracker/meter', /\b(?:meters?|trackers?|status\s*bars?|stat\s*blocks?|footers?|affection\s+points|lust\s+points|(?:arousal|lust|affection|corruption|desire|love|trust)\s+(?:level|score|points)|\d{1,3}\s*\/\s*100)\b/i],
    ['tracker bar', /[█▓▒░▰▱■□]{3,}/],
    ['numeric stat line', /\b[A-Za-z]{3,}\s*:\s*\d{1,3}\s*(?:%|\/\s*\d{1,3})/],
    ['print instruction', /\b(?:print|append|output|display|render|include|add)\b[^.]{0,60}\b(?:end\s+of|each|every)\b[^.]{0,40}\b(?:reply|replies|response|message|turn)\b/i],
    ['stage ladder', /\bstage\s+ladder|\b(?:stage|tier|level)\s+\d\b/i],
    ['escalation mandate', /\b(?:always|must|should)\s+(?:\w+\s+){0,2}escalat\w*|\bescalate\s+(?:to|toward)/i],
    ['instruction override', /\boverride\s+(?:sequence|all|previous|prior|any)|ignore\s+(?:all\s+)?(?:previous|prior|other)\s+instructions|disregard\s+(?:all|any|other)/i],
];

const SHARED_CLIMAX = /\b(?:both|together)\s+(?:climax|come|cum|orgasm)\w*|\b(?:climax|come|cum|orgasm)\w*\s+together\b/i;
const ruleCache = new Map();
function userRules(userName) {
    const key = str(userName);
    if (ruleCache.has(key)) return ruleCache.get(key);
    const parts = ['\\{\\{\\s*user\\s*\\}\\}', 'the\\s+player(?:\'s)?\\s+character', 'the\\s+player'];
    const n = key.trim();
    if (n.length >= 2 && !/[{}]/.test(n)) parts.push(`\\b${escapeRegex(n)}\\b`);
    const U = `(?:${parts.join('|')})`;
    // [reason, regex, check(match)?]: verbs are captured as a word and looked up in a Set (fast, no giant alternation).
    const rules = [
        ['{{user}} interior', new RegExp(`${U}(?:'s|’s)\\s+(?:\\w+\\s+)?(?:${INTERIOR})\\b`, 'gi')],
        ['{{user}} body scripted', new RegExp(`${U}(?:'s|’s)\\s+\\w+(?:\\s+\\w+)?\\s+(?:${RESPONSE})\\b`, 'gi')],
        ['{{user}} acting/speaking', new RegExp(`${U}\\s+(?:(?:\\w+ly|then|also|just|finally)\\s+)?(?:is\\s+|starts\\s+to\\s+|begins\\s+to\\s+)?([a-z]+)\\b`, 'gi'), m => isVerb(m[1])],
        ['directive to write {{user}}', new RegExp(`\\b(?:${WRITE_VERBS})\\b\\s+(?:how|what|whether|that|the\\s+way)\\s+${U}\\s+([a-z]+)\\b`, 'gi'), m => isVerb(m[1]) || /^(is|looks?)$/i.test(m[1])],
        ['{{user}} state scripted', new RegExp(`${U}\\s+(?:is|feels|gets|becomes|grows|seems)\\s+(?:so\\s+|very\\s+|already\\s+)?(?:aroused|wet|hard|turned\\s+on|eager|willing|ready|desperate|breathless|in\\s+love|attracted|jealous|afraid|excited)\\b`, 'gi')],
        ['{{user}} compulsion', new RegExp(`${U}\\s+(?:will|would|should|must|can't\\s+help|cannot\\s+help|is\\s+unable\\s+to\\s+resist|finds\\s+(?:${REFLEXIVE_PRONOUNS}))\\b`, 'gi')],
        ['directive to write {{user}}', new RegExp(`\\b(?:${WRITE_VERBS})\\b\\s+(?:\\w+\\s+){0,2}${U}(?:'s|’s)?\\s+(?:\\w+\\s+)?(?:words|dialogue|lines|repl(?:y|ies)|actions?|reactions?|responses?|choices?|decisions?|feelings?|thoughts?)\\b`, 'gi')],
        ['make {{user}} act', new RegExp(`\\b(?:make|makes|have|has|force|forces)\\s+${U}\\s+(?:to\\s+)?([a-z]+)\\b`, 'gi'), m => isVerb(m[1])],
        ['speak/act for {{user}}', new RegExp(`\\b(?:speak|speaks|talk|write|act|answer|respond|think|choose|decide)\\s+(?:for|as|on\\s+behalf\\s+of)\\s+${U}`, 'gi')],
    ];
    rules.alias = new RegExp(U, 'i');
    ruleCache.set(key, rules);
    if (ruleCache.size > 20) ruleCache.delete(ruleCache.keys().next().value);
    return rules;
}

/** Why a line is unsafe to inject, or '' when it is fine. */
export function unsafeReason(text, { userName = '' } = {}) {
    const s = stripInvisible(text).replace(/[‘’]/g, '\'');
    if (!s.trim()) return '';
    for (const [reason, re] of META) {
        const m = s.match(re);
        if (!m) continue;
        if (reason === 'print instruction' && NEGATED.test(s.slice(Math.max(0, m.index - 40), m.index))) continue;
        return reason;
    }
    if (SHARED_CLIMAX.test(s)) return 'shared climax';
    const rules = userRules(userName);
    if (!rules.alias.test(s)) return '';
    for (const [reason, re, check] of rules) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(s))) {
            if (check && !check(m)) continue;
            const before = s.slice(Math.max(0, m.index - 60), m.index);
            if (SUBORDINATE.test(before) || NEGATED.test(before)) continue;
            if (!reason.startsWith('directive') && !reason.startsWith('speak/act') && DESIRE_FRAME.test(before)) continue;
            return reason;
        }
    }
    return '';
}

export function isSafeLine(text, opts) {
    return unsafeReason(text, opts) === '';
}
