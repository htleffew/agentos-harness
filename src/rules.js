// Undercurrent — Chance Rules: a trigger → action engine (LoreBary-style), pool template expansion and the safety filter.
// Pure logic: no DOM, no SillyTavern globals. index.js evaluates the rules once per player turn inside the interceptor.
//
// A rule:
//   {id, name, enabled, pack, priority 1..5, logic "any"|"all", triggers:[...], cooldown, sticky, max_fires,
//    action:{type:"inject"|"director_hint"|"set_var", pool:[...], pick:"random"|"cycle"|"shuffle", count,
//            role:"system"|"user"|"assistant", placement:"note"|"depth", depth, var:{name,value,op}, sets:[...]}}
// Triggers (any trigger may also carry pct: a 0..100 roll that must pass as well):
//   always · chance{pct} · keyword{words,target,whole} · regex{pattern,flags,target} · every_n{n,offset,min}
//   turn_min{n} · turn_max{n} · scene_mode{modes} · not_scene_mode{modes} · present{names|"char"|"any_npc"}
//   variable{name,op,value,value2,default} · switch{name,state,default} · attraction{who}
//   any_of{triggers} · all_of{triggers} · none_of{triggers}
//
// Hard rules enforced here, not by prompt: rules never fire on 'quiet' or 'impersonate' generations; every line is
// template-expanded from runtime state, and a line with an unresolved token, or one that scripts {{user}} or prints
// trackers/footers/meters, is dropped (never injected broken or unsafe).

import { clip, clamp, isPlainObject, findKeyCI, deepClone, escapeRegex, makeRng } from './util.js';
import { normalizeIntimacy, findLimit, attractionLive } from './intimacy.js';
import { INTIMACY_PHASE_TRIGGER } from './ports/scene_intimacy.js';

export const RULES_STATE_VERSION = 1;
export const ACTION_TYPES = ['inject', 'director_hint', 'set_var'];
export const PICK_MODES = ['random', 'cycle', 'shuffle'];
export const ROLES = ['system', 'user', 'assistant'];
export const PLACEMENTS = ['note', 'depth'];
export const TARGETS = ['user', 'reply', 'both'];
export const VAR_OPS = ['==', '!=', '>', '>=', '<', '<=', 'between', 'contains', 'exists', 'not_exists'];
export const SET_OPS = ['set', 'add', 'sub'];
export const TRIGGER_TYPES = [
    'always', 'chance', 'keyword', 'regex', 'every_n', 'turn_min', 'turn_max', 'scene_mode', 'not_scene_mode', 'present',
    'variable', 'switch', 'attraction', 'intimacy_phase', 'any_of', 'all_of', 'none_of',
];
// Hard safety contract (not a knob): rules never act on background ('quiet') or impersonation generations.
export const NO_FIRE_TYPES = ['quiet', 'impersonate'];
// Structural caps that protect storage size, not behavior.
const MAX_POOL = 200;
const MAX_TRIGGERS = 16;
const MAX_STORED_CHARS = 20000;

// ---------------------------------------------------------------------------------------------------------------------
// Options (every behavioral number lives here; the central settings panel renders RULES_KNOBS)

export const UNRESOLVED_MODES = ['drop', 'blank', 'keep'];

export const DEFAULT_RULE_OPTIONS = Object.freeze({
    enabled: true,
    max_note_lines: 3,          // lines added to the <undercurrent> note ("Sparks") per turn
    max_depth: 2,               // separate depth injections per turn (keys undercurrent_rule_0..n-1)
    max_hints: 2,               // director hints per turn
    chance_multiplier: 1,       // scales every chance/pct roll (0 = rules with chances never fire)
    default_priority: 3,
    default_cooldown: 0,
    default_sticky: 0,
    default_depth: 1,
    default_role: 'system',
    max_line_chars: 240,        // a note line is clipped to this
    max_depth_chars: 4000,      // a depth injection is clipped to this
    unresolved: 'drop',         // drop the line | blank the token | keep the raw token
    ignore_private_thoughts: true, // keyword/regex triggers never see the player's *asterisk* thoughts
    safety_filter: true,
    safety_skip: [],            // built-in safety check names to switch off (see SAFETY_CHECKS)
    safety_patterns: [],        // extra regex sources; a matching line is dropped
    mode_groups: Object.freeze({
        intimate: ['intimate'],
        romance: ['intimate', 'romantic', 'flirt'],
        grief: ['grief'],
        argument: ['argument'],
        action: ['action'],
    }),
    default_packs: null,        // null = each pack's own default_enabled; else the list of pack ids on by default
    lorebary_interval_divisor: 1, // LoreBary message counts / this = player turns (1 = the 1:1 mapping)
});

/** Settings-panel schema. key "rules.<option>" maps onto DEFAULT_RULE_OPTIONS.<option> (mode groups: rules.modes_<group>). */
export const RULES_KNOBS = Object.freeze([
    { key: 'rules.enabled', group: 'Chance rules', label: 'Chance rules on', type: 'bool', default: true, help: 'Master switch for the trigger → action rules.', scope: 'global' },
    { key: 'rules.max_note_lines', group: 'Chance rules', label: 'Spark lines per turn', type: 'int', default: 3, min: 0, max: 10, step: 1, help: 'How many rule lines may join the hidden note each turn (inside the note\'s word cap).', scope: 'global' },
    { key: 'rules.max_depth', group: 'Chance rules', label: 'Depth injections per turn', type: 'int', default: 2, min: 0, max: 6, step: 1, help: 'Separate in-chat injections for long imported blocks.', scope: 'global' },
    { key: 'rules.max_hints', group: 'Chance rules', label: 'Director hints per turn', type: 'int', default: 2, min: 0, max: 6, step: 1, help: 'Hints handed to the hidden director (loop breakers and the like).', scope: 'global' },
    { key: 'rules.chance_multiplier', group: 'Chance rules', label: 'Chance multiplier', type: 'number', default: 1, min: 0, max: 3, step: 0.1, help: '0 silences chance rules, 1 = as written, 2 = twice as likely (capped at 100%).', scope: 'chat' },
    { key: 'rules.default_priority', group: 'Chance rules', label: 'Default priority', type: 'int', default: 3, min: 1, max: 5, step: 1, help: 'Priority for rules that do not set one (5 wins the budget first).', scope: 'global' },
    { key: 'rules.default_cooldown', group: 'Chance rules', label: 'Default cooldown (turns)', type: 'int', default: 0, min: 0, max: 50, step: 1, help: 'Rest turns after firing, for rules that do not set one.', scope: 'global' },
    { key: 'rules.default_sticky', group: 'Chance rules', label: 'Default sticky (turns)', type: 'int', default: 0, min: 0, max: 20, step: 1, help: 'How many extra turns an injection persists, for rules that do not set it.', scope: 'global' },
    { key: 'rules.default_depth', group: 'Chance rules', label: 'Default injection depth', type: 'int', default: 1, min: 0, max: 20, step: 1, help: 'Chat depth for depth-placed rules without their own depth.', scope: 'global' },
    { key: 'rules.default_role', group: 'Chance rules', label: 'Default injection role', type: 'select', default: 'system', options: ROLES.map(v => ({ value: v, label: v })), help: 'Message role for depth-placed rules without their own role.', scope: 'global' },
    { key: 'rules.max_line_chars', group: 'Chance rules', label: 'Max characters per spark line', type: 'int', default: 240, min: 60, max: 1000, step: 10, help: 'Longer lines are clipped.', scope: 'global' },
    { key: 'rules.max_depth_chars', group: 'Chance rules', label: 'Max characters per depth injection', type: 'int', default: 4000, min: 200, max: 20000, step: 100, help: 'Longer imported blocks are clipped.', scope: 'global' },
    { key: 'rules.unresolved', group: 'Chance rules', label: 'Unresolved template tokens', type: 'select', default: 'drop', options: [{ value: 'drop', label: 'Drop the line' }, { value: 'blank', label: 'Remove the token' }, { value: 'keep', label: 'Keep {{token}} as written' }], help: 'drop = skip the whole line (safest); blank = remove the token; keep = leave {{token}} as written.', scope: 'global' },
    { key: 'rules.ignore_private_thoughts', group: 'Chance rules', label: 'Triggers ignore *private thoughts*', type: 'bool', default: true, help: 'Keyword/regex triggers read only what {{user}} says and does, never asterisk thoughts.', scope: 'global' },
    { key: 'rules.safety_filter', group: 'Chance rules · safety', label: 'Safety filter', type: 'bool', default: true, help: 'Drop lines that script {{user}} or print trackers/footers/meters.', scope: 'global' },
    { key: 'rules.safety_skip', group: 'Chance rules · safety', label: 'Disabled safety checks', type: 'list', default: [], advanced: true, help: 'Names of built-in checks to switch off (see the list in the rules README).', scope: 'global' },
    { key: 'rules.safety_patterns', group: 'Chance rules · safety', label: 'Extra blocked patterns', type: 'list', default: [], advanced: true, help: 'One JavaScript regex per line (case-insensitive). Matching lines are dropped.', scope: 'global' },
    { key: 'rules.modes_intimate', group: 'Chance rules · scene modes', label: 'Modes that count as intimate (@intimate)', type: 'list', default: ['intimate'], help: 'Scene modes matched by @intimate in rule triggers.', scope: 'global' },
    { key: 'rules.modes_romance', group: 'Chance rules · scene modes', label: 'Modes that count as romantic (@romance)', type: 'list', default: ['intimate', 'romantic', 'flirt'], help: 'Scene modes matched by @romance (desire impulses run here).', scope: 'global' },
    { key: 'rules.modes_grief', group: 'Chance rules · scene modes', label: 'Modes that count as grief (@grief)', type: 'list', default: ['grief'], help: 'Scene modes matched by @grief (ambient and curiosity rules stay quiet).', scope: 'global' },
    { key: 'rules.modes_argument', group: 'Chance rules · scene modes', label: 'Modes that count as argument (@argument)', type: 'list', default: ['argument'], help: 'Scene modes matched by @argument.', scope: 'global' },
    { key: 'rules.modes_action', group: 'Chance rules · scene modes', label: 'Modes that count as action (@action)', type: 'list', default: ['action'], help: 'Scene modes matched by @action.', scope: 'global' },
    { key: 'rules.lorebary_interval_divisor', group: 'Chance rules', label: 'LoreBary messages per turn', type: 'number', default: 1, min: 0.5, max: 10, step: 0.5, help: 'Imported LoreBary message counts (intervals, "after N messages") are divided by this to get player turns. 1 = one message per turn (default); 2 = count both your message and the reply. Applies to new imports.', scope: 'global' },
    { key: 'rules.default_packs', group: 'Chance rules', label: 'Packs on by default', type: 'list', default: [], help: 'Pack ids enabled until toggled; empty = each pack\'s own default.', scope: 'global' },
]);

function knobNumber(v, def, min, max, integer) {
    const n = Number(v);
    if (v === null || v === undefined || v === '' || !Number.isFinite(n)) return def;
    const c = clamp(n, min, max);
    return integer ? Math.round(c) : c;
}

function knobList(v, def) {
    if (v === null || v === undefined) return def;
    const arr = Array.isArray(v) ? v : String(v).split(/[\n,]/);
    return arr.map(x => String(x).trim()).filter(Boolean).slice(0, 100);
}

/**
 * Merge knob values over the defaults with validation/clamping. Accepts flat panel keys ("rules.max_note_lines") or
 * plain option names ("max_note_lines"), or an object already shaped like DEFAULT_RULE_OPTIONS. Never throws.
 */
export function resolveRuleOptions(knobValues = {}) {
    const flat = isPlainObject(knobValues) ? knobValues : {};
    const src = isPlainObject(flat.rules) ? { ...flat.rules, ...flat } : flat; // {rules: {x: v}} also accepted
    const get = (name) => {
        if (Object.prototype.hasOwnProperty.call(src, `rules.${name}`)) return src[`rules.${name}`];
        if (Object.prototype.hasOwnProperty.call(src, name)) return src[name];
        return undefined;
    };
    const d = DEFAULT_RULE_OPTIONS;
    const o = {};
    o.enabled = get('enabled') === undefined ? d.enabled : get('enabled') !== false && get('enabled') !== 'false';
    for (const k of RULES_KNOBS) {
        const name = k.key.slice('rules.'.length);
        if (k.type !== 'number' && k.type !== 'int') continue;
        o[name] = knobNumber(get(name), d[name], k.min, k.max, k.type === 'int');
    }
    o.default_role = ROLES.includes(get('default_role')) ? get('default_role') : d.default_role;
    o.unresolved = UNRESOLVED_MODES.includes(get('unresolved')) ? get('unresolved') : d.unresolved;
    o.ignore_private_thoughts = get('ignore_private_thoughts') === undefined ? d.ignore_private_thoughts : !!get('ignore_private_thoughts') && get('ignore_private_thoughts') !== 'false';
    o.safety_filter = get('safety_filter') === undefined ? d.safety_filter : !!get('safety_filter') && get('safety_filter') !== 'false';
    o.safety_skip = knobList(get('safety_skip'), [...d.safety_skip]);
    o.safety_patterns = knobList(get('safety_patterns'), [...d.safety_patterns]).filter(p => { try { new RegExp(p, 'i'); return true; } catch { return false; } });
    const groups = {};
    const nested = isPlainObject(get('mode_groups')) ? get('mode_groups') : {};
    for (const [g, def] of Object.entries(d.mode_groups)) {
        groups[g] = knobList(get(`modes_${g}`) ?? nested[g], [...def]).map(m => m.toLowerCase());
    }
    for (const [g, v] of Object.entries(nested)) if (!groups[g]) groups[g] = knobList(v, []).map(m => m.toLowerCase());
    o.mode_groups = groups;
    const dp = get('default_packs');
    o.default_packs = dp === null || dp === undefined ? null : knobList(dp, null);
    if (Array.isArray(o.default_packs) && !o.default_packs.length) o.default_packs = null;
    return o;
}

function optionsOf(p) {
    return p && p.__resolved ? p : Object.assign(resolveRuleOptions(p || {}), { __resolved: true });
}

// ---------------------------------------------------------------------------------------------------------------------
// Text hygiene

/** Zero-width, bidi, soft-hyphen, variation-selector and Unicode tag characters (used as invisible watermarks). */
export const INVISIBLE_RE = /[­᠎​-‏‪-‮⁠-⁯﻿︀-️]|\uDB40[\uDC00-\uDDEF]/g;

export function stripInvisible(text) {
    return String(text ?? '').replace(INVISIBLE_RE, '');
}

/** The player's message without *asterisk* private thoughts (rules never react to what no character could know). */
function publicText(text) {
    return String(text ?? '').replace(/(^|[^*])\*(?!\*)([^*\n]+?)\*(?!\*)/g, '$1').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------------------------------------------------
// Safety filter (ported from tests/validate_lorebooks.py and extended for directive phrasing).

const USER_VERBS = ('moan gasp shudder feel think say whimper beg want decide enjoy tremble arch squirt ejaculate cum come came ' +
    'orgasm climax nod smile blush flush agree reply answer respond ask whisper groan sigh laugh giggle grin cry sob weep kiss ' +
    'touch grab reach lean walk move stare glance step turn pull push take give hold wrap press melt surrender submit yield ' +
    'relent crave need love like hate realize realise wonder hope wish imagine remember notice lick suck ride spread clench buck ' +
    'writhe squirm pant scream plead consent accept refuse comply obey kneel shiver quiver tense relax swallow speak tell call admit ' +
    'confess apologize apologise find get become grow keen whine mewl purr tremor quake undress strip dress sit stand lie sleep wake ' +
    'eat drink run leave enter follow wait stay go return arrive climb crawl straddle mount bend open close offer slap hit bite scratch').split(/\s+/);

const VERB_FORMS = (() => {
    const forms = new Set();
    for (const v of USER_VERBS) {
        forms.add(v);
        forms.add(v.endsWith('s') || v.endsWith('sh') || v.endsWith('ch') || v.endsWith('x') ? `${v}es` : v.endsWith('y') && !/[aeiou]y$/.test(v) ? `${v.slice(0, -1)}ies` : `${v}s`);
        forms.add(v.endsWith('e') ? `${v}d` : v.endsWith('y') && !/[aeiou]y$/.test(v) ? `${v.slice(0, -1)}ied` : `${v}ed`);
        forms.add(v.endsWith('e') && !v.endsWith('ee') ? `${v.slice(0, -1)}ing` : `${v}ing`);
    }
    for (const irregular of ['said', 'thought', 'felt', 'came', 'took', 'gave', 'held', 'told', 'spoke', 'knelt', 'found', 'got', 'became', 'grew', 'wept', 'swallowed']) forms.add(irregular);
    return [...forms].sort((a, b) => b.length - a.length);
})();

const INTERIOR = 'thoughts?|feelings?|arousal|desires?|pleasure|orgasms?|climax|emotions?|fantas(?:y|ies)|inner\\s+\\w+|wants|needs|lust|wetness|erection|cum';
const RESPONSE = 'responds?|reacts?|betrays?|arches|trembles?|shudders?|melts?|clenches|throbs?|tightens?|drips?|aches?|twitches|pulses?|leaks?|flushes|tingles?|quivers?|spasms?|gives\\s+(?:in|way)|yields?';
const WRITE_VERBS = 'write|describe|narrate|depict|show|script|decide|invent|voice|portray|detail|convey|render|choose|dictate|generate|state';
const SUBORDINATE = /\b(?:if|when|whenever|whatever|what|whether|unless|once|until|after|before|while|in\s+case|wait\s+for|waits\s+for|let|lets)\s+(?:\w+\s+){0,2}$/i;
// An NPC's desire, request or fantasy about {{user}} ("wants to watch {{user}} …") is that NPC's content, not a script.
const DESIRE_FRAME = /\b(?:wants?|wanting|wanted|would\s+(?:like|love)|'d\s+(?:like|love)|longs?|longing|hopes?|wish(?:es)?|imagines?|imagining|pictures?|picturing|fantasi[sz]\w*|thinks?\s+about|thinking\s+about|dreams?\s+(?:of|about)|asks?|asking|invites?|urges?|begs?|tells?|telling|orders?|dares?|how\s+(?:good|stunning|beautiful|lovely|pretty|hot|sexy|gorgeous|handsome))\b(?:\s+\S+){0,5}\s*$/i;
const NEGATED = /\b(?:never|not|don't|do\s+not|doesn't|does\s+not|no|avoid|without|nor)\b(?:\s+\S+){0,4}\s*$/i;

function userAlias(userName) {
    const parts = ['\\{\\{\\s*user\\s*\\}\\}', 'the\\s+player(?:\'s)?\\s+character', 'the\\s+player'];
    const n = String(userName ?? '').trim();
    if (n && n.length >= 2 && !/[{}]/.test(n)) parts.push(`\\b${escapeRegex(n)}\\b`);
    return `(?:${parts.join('|')})`;
}

const META_RULES = [
    ['slow-burn mandate', /slow[\s-]*burn|\b(?:no|never|don't|do\s+not)\s+(?:kiss\w*|sex|intimacy|touch\w*)\b[^.]{0,40}\b(?:until|before)\b/i],
    ['meter/tracker/footer', /\b(?:meters?|trackers?|status\s*bars?|stat\s*blocks?|status\s*blocks?|footers?|headers?\s+block|affection\s+points|lust\s+points|(?:arousal|lust|affection|corruption|desire|love|trust)\s+(?:level|score|points)|\d{1,3}\s*\/\s*100)\b/i],
    ['tracker bar', /[█▓▒░▰▱■□]{3,}/],
    ['status readout', /^\s*[*_]*\s*[A-Z][\w &'/-]{2,40}:\s*[*_]*\s*\[[^\]\n]{1,30}\]\s*$|\b(?:status|system|state)\s+(?:report|log|readout|dashboard|panel|window)\b/im],
    ['numeric stat line', /\b[A-Za-z]{3,}\s*:\s*\d{1,3}\s*(?:%|\/\s*\d{1,3})/],
    ['print at end of reply', /\b(?:print|append|output|display|show|render|include|add|end|begin|start|close|finish|conclude)\b[^.]{0,60}\b(?:each|every|end\s+of|the\s+(?:visible\s+)?(?:reply|response|message))\b[^.]{0,40}\b(?:reply|replies|response|responses|message|messages|turn|stamp|footer|header|block)\b/i],
    ['stamp/footer instruction', /\b(?:print|append|output|display|show|render|include|add|end|begin|start|close|finish)\b[^.]{0,80}\b(?:stamp|footer|header|tracker|hud|info\s*box|gauge|progress\s*bar|status\s*(?:block|window|panel))\b/i],
    ['stage ladder', /\bstage\s+ladder|\b(?:stage|phase|tier|level)\s+\d\b/i],
    ['escalation mandate', /\b(?:always|must|should)\s+(?:\w+\s+){0,2}escalat\w*|\bescalate\s+(?:to|toward)/i],
    ['global kink push', /\b(?:always|every\s+(?:scene|reply|response|turn))\b[^.]{0,40}\bkinks?\b/i],
    ['instruction override', /\boverride\s+(?:sequence|all|previous|prior|any)|begin\s+override|ignore\s+(?:all\s+)?(?:previous|prior|other)\s+instructions|disregard\s+(?:all|any|other)/i],
];

const NEGATABLE_META = new Set(['print at end of reply', 'stamp/footer instruction']);
const userRuleCache = new Map();

function userRules(userName) {
    const key = String(userName ?? '');
    if (userRuleCache.has(key)) return userRuleCache.get(key);
    const U = userAlias(userName);
    const verbs = VERB_FORMS.join('|');
    const rules = [
        ['{{user}} interior or response', new RegExp(`${U}(?:'s|’s)\\s+(?:\\w+\\s+)?(?:${INTERIOR})\\b`, 'gi')],
        ['{{user}} body scripted', new RegExp(`${U}(?:'s|’s)\\s+\\w+(?:\\s+\\w+)?\\s+(?:${RESPONSE})\\b`, 'gi')],
        ['{{user}} acting/feeling/speaking', new RegExp(`${U}\\s+(?:(?:\\w+ly|then|also|just|finally|slowly|suddenly|softly)\\s+)?(?:is\\s+|starts\\s+to\\s+|begins\\s+to\\s+)?(?:${verbs})\\b`, 'gi')],
        ['{{user}} acting/feeling/speaking', new RegExp(`${U}\\s+(?:\\w+ly\\s+)?look(?:s|ed|ing)?\\s+(?:at|up|down|away|over|around|back|into|toward|towards)\\b`, 'gi')],
        ['directive to write {{user}}', new RegExp(`\\b(?:${WRITE_VERBS})\\b\\s+(?:how|what|whether|that|the\\s+way)\\s+${U}\\s+(?:${verbs}|is|looks?)\\b`, 'gi')],
        ['{{user}} state scripted', new RegExp(`${U}\\s+(?:is|feels|gets|becomes|grows|seems|looks)\\s+(?:so\\s+|very\\s+|already\\s+|clearly\\s+)?(?:aroused|wet|hard|turned\\s+on|eager|willing|ready|desperate|needy|breathless|flushed|consenting|a\\s+consenting|in\\s+love|attracted|jealous|afraid|excited)\\b`, 'gi')],
        ['{{user}} modal/compulsion', new RegExp(`${U}\\s+(?:will|would|should|must|can't\\s+help|cannot\\s+help|is\\s+unable\\s+to\\s+resist|finds\\s+(?:herself|himself|themself|themselves))\\b`, 'gi')],
        ['directive to write {{user}}', new RegExp(`\\b(?:${WRITE_VERBS})\\b\\s+(?:\\w+\\s+){0,2}${U}(?:'s|’s)?\\s+(?:\\w+\\s+)?(?:words|dialogue|lines|repl(?:y|ies)|actions?|reactions?|responses?|choices?|decisions?|moves?|answers?|feelings?|thoughts?|perspective|pov|turn)\\b`, 'gi')],
        ['make {{user}} act', new RegExp(`\\b(?:make|makes|have|has|force|forces|get|gets)\\s+${U}\\s+(?:to\\s+)?(?:${verbs})\\b`, 'gi')],
        ['speak/act for {{user}}', new RegExp(`\\b(?:speak|speaks|talk|write|act|answer|respond|think|choose|decide)\\s+(?:for|as|on\\s+behalf\\s+of)\\s+${U}`, 'gi')],
        ['shared climax', /\b(?:both|together)\s+(?:climax|come|cum|orgasm)\w*|\b(?:climax|come|cum|orgasm)\w*\s+together\b/gi],
    ];
    userRuleCache.set(key, rules);
    if (userRuleCache.size > 20) userRuleCache.delete(userRuleCache.keys().next().value);
    return rules;
}

/**
 * Why a line is unsafe to inject, or '' when it is fine.
 * Unsafe = scripts {{user}}'s words, actions, thoughts, feelings, arousal or climax; or asks for printed trackers,
 * footers, stamps, meters or stage ladders; or mandates slow burn / escalation; or tries to override instructions.
 * Conditional or negated mentions ("if {{user}} says stop…", "never speak for {{user}}") are allowed.
 * @param {string} text
 * @param {{userName?:string}} [opts]
 */
export function unsafeReason(text, opts = {}) {
    const o = opts.options ? optionsOf(opts.options) : null;
    if (o && !o.safety_filter) return '';
    const skip = new Set(o ? o.safety_skip : []);
    const s = stripInvisible(text).replace(/[‘’]/g, '\'');
    if (!s.trim()) return '';
    for (const src of o ? o.safety_patterns : []) {
        const re = cachedRegex(src, 'i');
        if (re && re.test(s)) return `custom pattern /${clip(src, 40)}/`;
    }
    for (const [reason, re] of META_RULES) {
        if (skip.has(reason)) continue;
        const m = s.match(re);
        if (!m) continue;
        // "Do not print a stamp" is a rule against footers, not a request for one.
        if (NEGATABLE_META.has(reason) && NEGATED.test(s.slice(Math.max(0, m.index - 40), m.index))) continue;
        return reason;
    }
    for (const [reason, re] of userRules(opts.userName)) {
        if (skip.has(reason)) continue;
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(s))) {
            const before = s.slice(Math.max(0, m.index - 60), m.index);
            if (reason !== 'shared climax' && (SUBORDINATE.test(before) || NEGATED.test(before))) continue;
            if (!reason.startsWith('directive') && !reason.startsWith('speak/act') && DESIRE_FRAME.test(before)) continue;
            return reason;
        }
    }
    return '';
}

export function isSafeLine(text, opts = {}) {
    return unsafeReason(text, opts) === '';
}

/** Names of the built-in safety checks (for the safety_skip knob). */
export const SAFETY_CHECKS = Object.freeze([...new Set([...META_RULES.map(([n]) => n), ...userRules('').map(([n]) => n)])]);
RULES_KNOBS.find(k => k.key === 'rules.safety_skip').options = SAFETY_CHECKS.map(v => ({ value: v, label: v }));

// ---------------------------------------------------------------------------------------------------------------------
// Template expansion

const PASSTHROUGH = /^(?:char|user|trim|newline|noop|\/\/[\s\S]*|getvar::[^{}]+|getglobalvar::[^{}]+|random::[\s\S]+|pick::[\s\S]+)$/i;
const OWN_TOKENS = ['random_present', 'random_npc', 'subject', 'pref', 'limit', 'want', 'mood', 'place', 'time', 'weather', 'pick', 'roll', 'var'];
const TOKEN_RE = /\{\{\s*([^{}]*?)\s*\}\}/g;
const SUBJECT_ANY = new Set(['', 'any', 'subject']);

function parseToken(raw) {
    const m = String(raw).match(/^([a-z_]+)(?::([\s\S]*))?$/i);
    if (!m) return { name: String(raw).toLowerCase(), arg: null };
    return { name: m[1].toLowerCase(), arg: m[2] === undefined ? null : m[2].trim() };
}

/** Names of tokens a line uses that the engine cannot resolve (unknown or unsupported). */
export function unknownTokens(text) {
    const out = [];
    for (const m of String(text ?? '').matchAll(TOKEN_RE)) {
        const raw = m[1];
        if (PASSTHROUGH.test(raw)) continue;
        const { name } = parseToken(raw);
        if (!OWN_TOKENS.includes(name)) out.push(raw);
    }
    return out;
}

function lowerEq(a, b) {
    return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
}

/** Build the expansion context from Undercurrent's chat state. */
export function templateContext({ state = {}, scene, present, charName = '', userName = '', vars = {}, turn, rng = Math.random, intimacyEnabled = true, unresolved = 'drop' } = {}) {
    const sc = scene || state.scene || {};
    const recorded = (present || sc.present || []).filter(Boolean);
    const here = (recorded.length ? recorded : (charName ? [charName] : [])).filter(n => !lowerEq(n, userName) && !/^\{\{\s*user\s*\}\}$/i.test(n));
    return {
        characters: isPlainObject(state.characters) ? state.characters : {},
        scene: { place: sc.place || '', time: sc.time || '', weather: sc.weather || '', mode: sc.mode || '' },
        present: [...new Set(here)],
        charName,
        userName,
        vars: isPlainObject(vars) ? vars : {},
        turn: Number.isFinite(turn) ? turn : (state.turn ?? 0),
        rng,
        intimacyEnabled,
        unresolved,
    };
}

function charRecord(ctx, name) {
    const key = findKeyCI(ctx.characters, name);
    return key ? { key, c: ctx.characters[key] } : null;
}

/** 'likes' preferences that no hard limit (or evidenced dislike) covers. */
export function likablePrefs(intimacy) {
    const i = normalizeIntimacy(intimacy);
    return i.preferences.filter(p => p.stance === 'likes' && !findLimit(i, p.item)).map(p => p.item);
}

function limitsOf(intimacy) {
    return normalizeIntimacy(intimacy).limits.map(l => l.item);
}

/** Open wants (same rule as state.openItems; inlined so state.js can import this module without a cycle). */
function wantsOf(c, turn) {
    return (Array.isArray(c?.wants) ? c.wants : [])
        .filter(w => w && (w.until_turn === null || w.until_turn === undefined || w.until_turn > turn))
        .map(w => (typeof w === 'string' ? w : w.text)).filter(Boolean);
}

function fieldValues(ctx, field, name) {
    const rec = charRecord(ctx, name);
    if (!rec) return [];
    switch (field) {
        case 'pref': return ctx.intimacyEnabled ? likablePrefs(rec.c.intimacy) : [];
        case 'limit': return ctx.intimacyEnabled ? limitsOf(rec.c.intimacy) : [];
        case 'want': return wantsOf(rec.c, ctx.turn);
        case 'mood': return rec.c.mood ? [rec.c.mood] : [];
        default: return [];
    }
}

function pickOne(list, rng) {
    if (!list.length) return null;
    return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
}

function resolveName(ctx, arg) {
    const a = String(arg ?? '').trim();
    if (!a) return null;
    if (lowerEq(a, 'char') || /^\{\{\s*char\s*\}\}$/i.test(a)) return ctx.charName || null;
    return a;
}

function rollDice(spec, rng) {
    const m = String(spec ?? '').replace(/\s+/g, '').match(/^(\d{0,2})d(\d{1,4})([+-]\d{1,4})?$/i);
    if (m) {
        const n = clamp(Number(m[1] || 1), 1, 20);
        const sides = clamp(Number(m[2]), 2, 1000);
        let total = Number(m[3] || 0);
        for (let i = 0; i < n; i++) total += 1 + Math.floor(rng() * sides);
        return String(total);
    }
    const k = String(spec ?? '').match(/^(\d{1,4})$/);
    return k ? String(1 + Math.floor(rng() * Number(k[1]))) : null;
}

/**
 * Expand one pool line. {{char}}/{{user}} (and SillyTavern's own getvar/random/pick:: macros) are left for
 * SillyTavern to substitute. A line with any token that cannot be resolved is rejected.
 *
 * Subject binding: {{random_present}}, {{random_npc}}, {{subject}} and the un-named or ':any' forms of
 * {{pref}}, {{want}}, {{mood}}, {{limit}} all refer to ONE character per line, chosen among those who can satisfy every
 * such token in the line (so "{{random_present}} … {{pref:any}}" names the person whose preference it is).
 * @returns {{ok:boolean, text:string, reason:string, subject:string|null}}
 */
export function expandTemplate(text, ctx) {
    const src = stripInvisible(text);
    const rng = ctx?.rng || Math.random;
    const toks = [...src.matchAll(TOKEN_RE)].map(m => ({ raw: m[0], inner: m[1], ...parseToken(m[1]) }));
    const fail = reason => ({ ok: false, text: '', reason, subject: null });
    const mode = UNRESOLVED_MODES.includes(ctx?.unresolved) ? ctx.unresolved : 'drop';
    const unknown = toks.filter(t => !PASSTHROUGH.test(t.inner) && !OWN_TOKENS.includes(t.name));
    if (unknown.length && mode === 'drop') return fail(`unsupported token ${unknown[0].raw}`);

    // Subject requirements.
    const bound = toks.filter(t => ['random_present', 'random_npc', 'subject'].includes(t.name)
        || (['pref', 'want', 'mood', 'limit'].includes(t.name) && SUBJECT_ANY.has(String(t.arg ?? '').toLowerCase())));
    let subject = null;
    if (bound.length) {
        const npcOnly = bound.some(t => t.name === 'random_npc');
        const people = ctx.present.filter(n => !npcOnly || !lowerEq(n, ctx.charName));
        const needs = new Set(bound.filter(t => ['pref', 'want', 'mood', 'limit'].includes(t.name)).map(t => t.name));
        const candidates = needs.size ? people.filter(n => [...needs].every(f => fieldValues(ctx, f, n).length)) : people;
        subject = pickOne(candidates, rng);
        if (!subject && mode === 'drop') {
            if (!people.length) return fail(npcOnly ? 'no other character present' : 'nobody present');
            return fail(`no present character has a usable ${[...needs].join('/')}`);
        }
        const rec = subject ? charRecord(ctx, subject) : null;
        if (rec) subject = rec.key;
    }

    let out = '';
    let last = 0;
    const subjectPicks = {};
    for (const m of src.matchAll(TOKEN_RE)) {
        out += src.slice(last, m.index);
        last = m.index + m[0].length;
        const t = { inner: m[1], ...parseToken(m[1]) };
        if (PASSTHROUGH.test(t.inner)) { out += m[0]; continue; }
        if (!OWN_TOKENS.includes(t.name)) { out += mode === 'keep' ? m[0] : ''; continue; }
        let v = null;
        switch (t.name) {
            case 'random_present':
            case 'random_npc':
            case 'subject':
                v = subject;
                break;
            case 'pref':
            case 'want':
            case 'mood':
            case 'limit': {
                const anyForm = SUBJECT_ANY.has(String(t.arg ?? '').toLowerCase());
                const who = anyForm ? subject : resolveName(ctx, t.arg);
                const vals = who ? fieldValues(ctx, t.name, who) : [];
                if (anyForm && t.name === 'mood') v = vals[0] ?? null;
                else if (anyForm && subjectPicks[t.name] && vals.length > 1) v = pickOne(vals.filter(x => x !== subjectPicks[t.name]), rng);
                else v = pickOne(vals, rng);
                if (anyForm && v) subjectPicks[t.name] = v;
                break;
            }
            case 'place':
            case 'time':
            case 'weather':
                v = ctx.scene?.[t.name] || null;
                break;
            case 'pick': {
                const opts = String(t.arg ?? '').split('|').map(x => x.trim()).filter(Boolean);
                v = pickOne(opts, rng);
                break;
            }
            case 'roll':
                v = rollDice(t.arg, rng);
                break;
            case 'var': {
                const [name, ...rest] = String(t.arg ?? '').split('|');
                const key = name.trim();
                const val = key ? ctx.vars?.[key] : undefined;
                if (val !== undefined && val !== null && String(val).trim() !== '') v = String(val);
                else if (rest.length) v = rest.join('|').trim() || null;
                break;
            }
            default:
                v = null;
        }
        if (v === null || v === undefined || String(v).trim() === '') {
            if (mode === 'drop') return fail(`unresolved ${m[0]}`);
            out += mode === 'keep' ? m[0] : '';
            continue;
        }
        out += String(v).replace(/\{\{|\}\}/g, '');
    }
    out += src.slice(last);
    const textOut = out.replace(/[ \t]+/g, ' ').replace(/ ([,.;:!?])/g, '$1').trim();
    if (!textOut) return fail('empty after expansion');
    return { ok: true, text: textOut, reason: 'ok', subject };
}

// ---------------------------------------------------------------------------------------------------------------------
// Schema

function str(v, max = 200) {
    if (v === null || v === undefined) return '';
    return clip(stripInvisible(typeof v === 'string' ? v : String(v)), max);
}

function slug(s) {
    return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
}

function normPct(v) {
    const n = Number(v);
    return Number.isFinite(n) ? clamp(n, 0, 100) : null;
}

function normTrigger(raw, depth = 0) {
    if (!isPlainObject(raw) || !TRIGGER_TYPES.includes(raw.type)) return null;
    const t = { type: raw.type };
    const pct = normPct(raw.pct);
    if (pct !== null && pct < 100 && raw.type !== 'chance') t.pct = pct;
    const names = v => (Array.isArray(v) ? v : (typeof v === 'string' && v ? [v] : [])).map(x => str(x, 80)).filter(Boolean);
    switch (raw.type) {
        case 'always': break;
        case 'chance': t.pct = pct ?? 0; break;
        case 'keyword':
            t.words = names(raw.words).slice(0, 60);
            t.target = TARGETS.includes(raw.target) ? raw.target : 'user';
            t.whole = raw.whole !== false;
            break;
        case 'regex':
            t.pattern = String(raw.pattern ?? '').slice(0, 600);
            t.flags = String(raw.flags ?? 'i').replace(/[^imsu]/g, '').replace(/(.)(?=.*\1)/g, '');
            t.target = TARGETS.includes(raw.target) ? raw.target : 'user';
            break;
        case 'intimacy_phase': Object.assign(t, INTIMACY_PHASE_TRIGGER.normalize(raw)); break;
        case 'every_n':
            t.n = Math.max(1, Math.round(Number(raw.n) || 1));
            t.offset = Math.max(0, Math.round(Number(raw.offset) || 0));
            if (Number.isFinite(Number(raw.min)) && Number(raw.min) > 0) t.min = Math.round(Number(raw.min));
            break;
        case 'turn_min':
        case 'turn_max':
            t.n = Math.max(0, Math.round(Number(raw.n) || 0));
            break;
        case 'scene_mode':
        case 'not_scene_mode':
            t.modes = names(raw.modes).map(m => m.toLowerCase()); // "@group" entries expand via options.mode_groups
            break;
        case 'present':
            t.names = raw.names === 'char' || raw.names === 'any_npc' ? raw.names : names(raw.names);
            break;
        case 'variable':
            t.name = str(raw.name, 80);
            t.op = VAR_OPS.includes(raw.op) ? raw.op : '==';
            t.value = raw.value === undefined || raw.value === null ? '' : (typeof raw.value === 'number' ? raw.value : str(raw.value, 200));
            if (raw.value2 !== undefined && raw.value2 !== null && raw.value2 !== '') t.value2 = typeof raw.value2 === 'number' ? raw.value2 : str(raw.value2, 200);
            if (raw.default !== undefined && raw.default !== null) t.default = typeof raw.default === 'number' || typeof raw.default === 'boolean' ? raw.default : str(raw.default, 200);
            break;
        case 'switch':
            t.name = str(raw.name, 80);
            t.state = raw.state !== false;
            if (typeof raw.default === 'boolean') t.default = raw.default;
            break;
        case 'attraction':
            t.who = ['any', 'char', 'any_npc'].includes(raw.who) ? raw.who : 'any';
            break;
        case 'any_of':
        case 'all_of':
        case 'none_of':
            if (depth >= 3) return null;
            t.triggers = (Array.isArray(raw.triggers) ? raw.triggers : []).map(x => normTrigger(x, depth + 1)).filter(Boolean).slice(0, MAX_TRIGGERS);
            break;
        default: return null;
    }
    return t;
}

function normSet(raw) {
    if (!isPlainObject(raw)) return null;
    const kind = raw.kind === 'switch' ? 'switch' : 'var';
    const name = str(raw.name, 80);
    if (!name) return null;
    if (kind === 'switch') return { kind, name, value: raw.value !== false && raw.value !== 'false' };
    const op = SET_OPS.includes(raw.op) ? raw.op : 'set';
    const value = typeof raw.value === 'number' || typeof raw.value === 'boolean' ? raw.value : str(raw.value, 300);
    return { kind, name, value, op };
}

function normAction(raw, o = DEFAULT_RULE_OPTIONS) {
    const a = isPlainObject(raw) ? raw : {};
    const type = ACTION_TYPES.includes(a.type) ? a.type : 'inject';
    const action = { type };
    action.pool = (Array.isArray(a.pool) ? a.pool : (typeof a.pool === 'string' ? [a.pool] : []))
        .filter(x => typeof x === 'string')
        .map(x => stripInvisible(x).trim())
        .filter(Boolean)
        .slice(0, MAX_POOL)
        .map(x => x.slice(0, MAX_STORED_CHARS));
    action.pick = PICK_MODES.includes(a.pick) ? a.pick : 'random';
    if (Number.isFinite(Number(a.count)) && Number(a.count) > 1) action.count = Math.min(5, Math.round(Number(a.count)));
    if (type === 'inject') {
        action.role = ROLES.includes(a.role) ? a.role : o.default_role;
        action.placement = PLACEMENTS.includes(a.placement) ? a.placement : 'note';
        if (action.placement === 'depth') action.depth = clamp(Math.round(Number(a.depth ?? o.default_depth)), 0, 20);
    }
    const sets = [];
    if (isPlainObject(a.var)) {
        const s = normSet({ kind: 'var', ...a.var });
        if (s) sets.push(s);
    }
    for (const s of Array.isArray(a.sets) ? a.sets : []) {
        const n = normSet(s);
        if (n) sets.push(n);
    }
    if (sets.length) action.sets = sets.slice(0, 12);
    return action;
}

/** Coerce anything into a rule, or null when it has no id/name to stand on. Never throws. */
export function normalizeRule(raw, { pack = '', options } = {}) {
    if (!isPlainObject(raw)) return null;
    const o = options ? optionsOf(options) : DEFAULT_RULE_OPTIONS;
    const name = str(raw.name, 120) || str(raw.id, 120);
    const id = slug(raw.id) || slug(name);
    if (!id) return null;
    const count = (v, def) => Math.max(0, Math.round(Number(v ?? def) || 0));
    return {
        id,
        name: name || id,
        enabled: raw.enabled !== false,
        pack: slug(raw.pack) || slug(pack) || 'custom',
        priority: clamp(Math.round(Number(raw.priority ?? o.default_priority)), 1, 5),
        logic: raw.logic === 'all' ? 'all' : 'any',
        triggers: (Array.isArray(raw.triggers) ? raw.triggers : []).map(t => normTrigger(t)).filter(Boolean).slice(0, MAX_TRIGGERS),
        cooldown: count(raw.cooldown, o.default_cooldown),
        sticky: count(raw.sticky, o.default_sticky),
        max_fires: count(raw.max_fires, 0),
        action: normAction(raw.action, o),
        ...(str(raw.note, 300) ? { note: str(raw.note, 300) } : {}),
    };
}

function validateTrigger(t, path, errors) {
    if (!isPlainObject(t)) { errors.push(`${path} must be an object.`); return; }
    if (!TRIGGER_TYPES.includes(t.type)) { errors.push(`${path}.type must be one of: ${TRIGGER_TYPES.join(', ')}.`); return; }
    if (t.pct !== undefined && !(Number(t.pct) >= 0 && Number(t.pct) <= 100)) errors.push(`${path}.pct must be 0..100.`);
    switch (t.type) {
        case 'chance': if (!(Number(t.pct) >= 0 && Number(t.pct) <= 100)) errors.push(`${path}.pct must be 0..100.`); break;
        case 'keyword': if (!Array.isArray(t.words) || !t.words.length) errors.push(`${path}.words needs at least one word.`); break;
        case 'regex':
            try { new RegExp(String(t.pattern ?? ''), String(t.flags ?? 'i').replace(/[^imsu]/g, '')); } catch (e) { errors.push(`${path}.pattern is not a valid regex: ${e.message}`); }
            if (!t.pattern) errors.push(`${path}.pattern is empty.`);
            break;
        case 'every_n': if (!(Number(t.n) >= 1)) errors.push(`${path}.n must be >= 1.`); break;
        case 'intimacy_phase': INTIMACY_PHASE_TRIGGER.validate(t, path, errors); break;
        case 'turn_min': case 'turn_max': if (!(Number(t.n) >= 0)) errors.push(`${path}.n must be >= 0.`); break;
        case 'scene_mode': case 'not_scene_mode': if (!Array.isArray(t.modes) || !t.modes.length) errors.push(`${path}.modes needs at least one mode.`); break;
        case 'present': if (!(t.names === 'char' || t.names === 'any_npc' || (Array.isArray(t.names) && t.names.length))) errors.push(`${path}.names must be "char", "any_npc" or a list of names.`); break;
        case 'variable': if (!t.name) errors.push(`${path}.name is required.`); if (t.op !== undefined && !VAR_OPS.includes(t.op)) errors.push(`${path}.op must be one of ${VAR_OPS.join(' ')}.`); break;
        case 'switch': if (!t.name) errors.push(`${path}.name is required.`); break;
        case 'any_of': case 'all_of': case 'none_of':
            if (!Array.isArray(t.triggers) || !t.triggers.length) errors.push(`${path}.triggers needs at least one trigger.`);
            else t.triggers.forEach((x, i) => validateTrigger(x, `${path}.triggers[${i}]`, errors));
            break;
        default: break;
    }
}

/** Strict check for a hand-edited rule (UI JSON editor). Returns a list of human-readable errors. */
export function validateRule(raw, opts = {}) {
    const errors = [];
    if (!isPlainObject(raw)) return ['A rule must be a JSON object.'];
    if (!slug(raw.id) && !str(raw.name)) errors.push('"id" or "name" is required.');
    if (raw.priority !== undefined && !(Number(raw.priority) >= 1 && Number(raw.priority) <= 5)) errors.push('"priority" must be 1..5.');
    if (raw.logic !== undefined && !['any', 'all'].includes(raw.logic)) errors.push('"logic" must be "any" or "all".');
    if (!Array.isArray(raw.triggers) || !raw.triggers.length) errors.push('"triggers" needs at least one trigger.');
    else raw.triggers.forEach((t, i) => validateTrigger(t, `triggers[${i}]`, errors));
    for (const k of ['cooldown', 'sticky', 'max_fires']) if (raw[k] !== undefined && !(Number(raw[k]) >= 0)) errors.push(`"${k}" must be a number >= 0.`);
    const a = raw.action;
    if (!isPlainObject(a)) errors.push('"action" must be an object.');
    else {
        if (a.type !== undefined && !ACTION_TYPES.includes(a.type)) errors.push(`action.type must be one of: ${ACTION_TYPES.join(', ')}.`);
        const type = a.type || 'inject';
        if (type !== 'set_var' && (!Array.isArray(a.pool) || !a.pool.some(x => typeof x === 'string' && x.trim()))) errors.push('action.pool needs at least one line.');
        if (type === 'set_var' && !isPlainObject(a.var) && !(Array.isArray(a.sets) && a.sets.length)) errors.push('set_var needs action.var {name, value}.');
        if (a.pick !== undefined && !PICK_MODES.includes(a.pick)) errors.push(`action.pick must be one of: ${PICK_MODES.join(', ')}.`);
        if (a.role !== undefined && !ROLES.includes(a.role)) errors.push(`action.role must be one of: ${ROLES.join(', ')}.`);
        if (a.placement !== undefined && !PLACEMENTS.includes(a.placement)) errors.push('action.placement must be "note" or "depth".');
        for (const [i, line] of (Array.isArray(a.pool) ? a.pool : []).entries()) {
            if (typeof line !== 'string') { errors.push(`action.pool[${i}] must be a string.`); continue; }
            const bad = unsafeReason(line, opts);
            if (bad) errors.push(`action.pool[${i}] is unsafe (${bad}).`);
            const unk = unknownTokens(line);
            if (unk.length) errors.push(`action.pool[${i}] uses unsupported token {{${unk[0]}}}.`);
        }
    }
    return errors;
}

/** Parse + validate rule JSON text from the editor. */
export function parseRuleJson(text, opts = {}) {
    let raw;
    try { raw = JSON.parse(String(text ?? '')); } catch (e) { return { ok: false, rule: null, errors: [`Invalid JSON: ${e.message}`] }; }
    const errors = validateRule(raw, opts);
    if (errors.length) return { ok: false, rule: null, errors };
    return { ok: true, rule: normalizeRule(raw, opts), errors: [] };
}

/** One-line human summary of a rule's triggers (UI). */
export function describeTriggers(rule) {
    const d = (t) => {
        const p = t.pct !== undefined && t.type !== 'chance' ? ` @${t.pct}%` : '';
        switch (t.type) {
            case 'always': return `always${p}`;
            case 'chance': return `${t.pct}%`;
            case 'keyword': return `words[${(t.words || []).slice(0, 3).join(', ')}${(t.words || []).length > 3 ? '…' : ''}] in ${t.target}${p}`;
            case 'regex': return `/${clip(t.pattern, 30)}/ in ${t.target}${p}`;
            case 'every_n': return `every ${t.n}${t.offset ? `+${t.offset}` : ''}${t.min ? ` from ${t.min}` : ''}${p}`;
            case 'turn_min': return `turn ≥ ${t.n}${p}`;
            case 'turn_max': return `turn ≤ ${t.n}${p}`;
            case 'scene_mode': return `scene ${t.modes.join('/')}${p}`;
            case 'intimacy_phase': return `intimacy phase ${(t.phases || []).join('/')}${p}`;
            case 'not_scene_mode': return `not ${t.modes.join('/')}${p}`;
            case 'present': return `present ${Array.isArray(t.names) ? t.names.join('/') : t.names}${p}`;
            case 'variable': return `${t.name} ${t.op} ${t.value}${t.value2 !== undefined ? `..${t.value2}` : ''}${p}`;
            case 'switch': return `${t.name} ${t.state ? 'on' : 'off'}${p}`;
            case 'attraction': return `attraction (${t.who})${p}`;
            case 'any_of': return `(${(t.triggers || []).map(d).join(' or ')})${p}`;
            case 'all_of': return `(${(t.triggers || []).map(d).join(' and ')})${p}`;
            case 'none_of': return `not (${(t.triggers || []).map(d).join(' or ')})${p}`;
            default: return t.type;
        }
    };
    const parts = (rule?.triggers || []).map(d);
    return parts.join(rule?.logic === 'all' ? ' and ' : ' or ') || '(no triggers)';
}

// ---------------------------------------------------------------------------------------------------------------------
// Rule state (per chat: chatMetadata.undercurrent.rules_state)

export function emptyRuleState() {
    return { v: RULES_STATE_VERSION, turn: -1, last: {}, fires: {}, cycles: {}, bags: {}, sticky: {}, switches: {}, prev: null };
}

function numMap(v) {
    return isPlainObject(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => Number.isFinite(x))) : {};
}

/** Repair anything into a valid rules_state. Never throws. */
export function normalizeRuleState(raw, { keepPrev = true } = {}) {
    const st = emptyRuleState();
    if (!isPlainObject(raw)) return st;
    st.turn = Number.isFinite(raw.turn) ? raw.turn : -1;
    st.last = numMap(raw.last);
    st.fires = numMap(raw.fires);
    st.cycles = numMap(raw.cycles);
    st.bags = isPlainObject(raw.bags) ? Object.fromEntries(Object.entries(raw.bags).filter(([, b]) => Array.isArray(b) && b.every(Number.isInteger)).map(([k, b]) => [k, b.slice(0, MAX_POOL)])) : {};
    st.sticky = isPlainObject(raw.sticky)
        ? Object.fromEntries(Object.entries(raw.sticky).filter(([, s]) => isPlainObject(s) && typeof s.text === 'string' && Number.isFinite(s.until)))
        : {};
    st.switches = isPlainObject(raw.switches) ? Object.fromEntries(Object.entries(raw.switches).filter(([, v]) => typeof v === 'boolean')) : {};
    st.prev = keepPrev && isPlainObject(raw.prev) ? normalizeRuleState(raw.prev, { keepPrev: false }) : null;
    return st;
}

// ---------------------------------------------------------------------------------------------------------------------
// Rule set assembly (starter packs + user packs + edits from extension settings)

/**
 * Merge built-in packs with the user's settings.
 * settings shape (extensionSettings.undercurrent.rules):
 *   {enabled, packs:{[packId]:{enabled}}, user_packs:[{pack, rules}], edits:{[ruleId]: rule|null}, budget}
 * @param {object} rulesSettings
 * @param {{pack:object, rules:object[]}[]} starterPacks
 * @returns {{packs:object[], rules:object[]}} packs: {id,name,description,builtin,enabled,max_per_turn,count}
 */
export function resolveRuleSet(rulesSettings = {}, starterPacks = [], options) {
    const s = isPlainObject(rulesSettings) ? rulesSettings : {};
    const o = optionsOf(options || {});
    const packToggles = isPlainObject(s.packs) ? s.packs : {};
    const edits = isPlainObject(s.edits) ? s.edits : {};
    const packs = [];
    const rules = [];
    const seen = new Set();
    const addPack = (p, list, builtin) => {
        const id = slug(p?.id) || slug(p?.name);
        if (!id || packs.some(x => x.id === id)) return;
        const toggle = packToggles[id];
        packs.push({
            id,
            name: str(p.name, 80) || id,
            description: str(p.description, 300),
            builtin,
            enabled: isPlainObject(toggle) && typeof toggle.enabled === 'boolean' ? toggle.enabled
                : Array.isArray(o.default_packs) ? o.default_packs.includes(id) : p.default_enabled !== false,
            max_per_turn: Number.isFinite(Number(p.max_per_turn)) && Number(p.max_per_turn) > 0 ? Math.round(Number(p.max_per_turn)) : 0,
            count: 0,
        });
        for (const r of Array.isArray(list) ? list : []) {
            const n = normalizeRule(r, { pack: id, options: o });
            if (!n || seen.has(n.id)) continue;
            n.pack = id;
            seen.add(n.id);
            rules.push(n);
        }
    };
    for (const sp of starterPacks || []) addPack(sp.pack, sp.rules, true);
    for (const up of Array.isArray(s.user_packs) ? s.user_packs : []) addPack(up.pack, up.rules, false);
    const out = [];
    for (const r of rules) {
        if (Object.prototype.hasOwnProperty.call(edits, r.id)) {
            const e = edits[r.id];
            if (e === null) continue;
            const n = normalizeRule({ ...e, id: r.id }, { pack: r.pack, options: o });
            if (n) { n.pack = r.pack; out.push(n); }
            continue;
        }
        out.push(r);
    }
    for (const p of packs) p.count = out.filter(r => r.pack === p.id).length;
    return { packs, rules: out };
}

// ---------------------------------------------------------------------------------------------------------------------
// Trigger evaluation

function textFor(target, userText, replyText) {
    if (target === 'reply') return replyText;
    if (target === 'both') return `${userText}\n${replyText}`;
    return userText;
}

const regexCache = new Map();
function cachedRegex(pattern, flags) {
    const key = `${flags}\u0000${pattern}`;
    if (regexCache.has(key)) return regexCache.get(key);
    let re = null;
    try { re = new RegExp(pattern, flags); } catch { re = null; }
    regexCache.set(key, re);
    if (regexCache.size > 500) regexCache.delete(regexCache.keys().next().value);
    return re;
}

function keywordHit(words, text, whole) {
    const t = String(text ?? '');
    if (!t) return false;
    for (const w of words || []) {
        const word = String(w).trim();
        if (!word) continue;
        const body = escapeRegex(word).replace(/\\\*/g, '\\w*').replace(/\s+/g, '\\s+');
        const re = cachedRegex(whole ? `(?:^|[^\\p{L}\\p{N}_])${body}(?=$|[^\\p{L}\\p{N}_])` : body, 'iu');
        if (re && re.test(t)) return true;
    }
    return false;
}

function compareVar(actual, op, value, value2) {
    if (op === 'exists') return actual !== undefined && actual !== null && String(actual) !== '';
    if (op === 'not_exists') return actual === undefined || actual === null || String(actual) === '';
    const a = actual === undefined || actual === null ? '' : actual;
    const na = Number(a);
    const nv = Number(value);
    const numeric = String(a).trim() !== '' && String(value).trim() !== '' && Number.isFinite(na) && Number.isFinite(nv);
    switch (op) {
        case '==': return numeric ? na === nv : String(a).toLowerCase() === String(value).toLowerCase();
        case '!=': return numeric ? na !== nv : String(a).toLowerCase() !== String(value).toLowerCase();
        case '>': return numeric && na > nv;
        case '>=': return numeric && na >= nv;
        case '<': return numeric && na < nv;
        case '<=': return numeric && na <= nv;
        case 'between': {
            const hi = Number(value2);
            return Number.isFinite(na) && Number.isFinite(nv) && Number.isFinite(hi) && na >= Math.min(nv, hi) && na <= Math.max(nv, hi);
        }
        case 'contains': return String(a).toLowerCase().includes(String(value).toLowerCase());
        default: return false;
    }
}

/** Expand "@group" entries (e.g. "@intimate") through options.mode_groups. */
export function expandModes(modes, groups = DEFAULT_RULE_OPTIONS.mode_groups) {
    const out = new Set();
    for (const m of modes || []) {
        const k = String(m).toLowerCase();
        if (k.startsWith('@')) for (const x of groups?.[k.slice(1)] || []) out.add(String(x).toLowerCase());
        else out.add(k);
    }
    return out;
}

function roll(env, pct) {
    const eff = clamp(Number(pct) * env.chanceMult, 0, 100);
    return env.rng() * 100 < eff;
}

function testTrigger(t, env) {
    let ok;
    switch (t.type) {
        case 'always': ok = true; break;
        case 'chance': return roll(env, t.pct);
        case 'keyword': ok = keywordHit(t.words, textFor(t.target, env.userText, env.replyText), t.whole !== false); break;
        case 'regex': {
            const re = cachedRegex(t.pattern, (t.flags || 'i').replace(/[^imsu]/g, ''));
            ok = !!re && re.test(textFor(t.target, env.userText, env.replyText));
            break;
        }
        case 'intimacy_phase': ok = INTIMACY_PHASE_TRIGGER.test(t, env); break;
        case 'every_n': ok = env.turn > 0 && env.turn >= (t.min || 0) && (env.turn - (t.offset || 0)) % t.n === 0 && env.turn >= (t.offset || 0); break;
        case 'turn_min': ok = env.turn >= t.n; break;
        case 'turn_max': ok = env.turn <= t.n; break;
        case 'scene_mode': ok = expandModes(t.modes, env.modeGroups).has(String(env.scene.mode || '').toLowerCase()); break;
        case 'not_scene_mode': ok = !expandModes(t.modes, env.modeGroups).has(String(env.scene.mode || '').toLowerCase()); break;
        case 'present': {
            const p = env.present;
            if (t.names === 'char') ok = !!env.charName && p.some(n => lowerEq(n, env.charName));
            else if (t.names === 'any_npc') ok = p.some(n => !lowerEq(n, env.charName));
            else ok = (t.names || []).some(name => p.some(n => lowerEq(n, name === '{{char}}' ? env.charName : name)));
            break;
        }
        case 'variable': {
            const v = Object.prototype.hasOwnProperty.call(env.vars, t.name) ? env.vars[t.name] : t.default;
            ok = compareVar(v, t.op || '==', t.value, t.value2);
            break;
        }
        case 'switch': {
            const cur = Object.prototype.hasOwnProperty.call(env.switches, t.name) ? env.switches[t.name] : (t.default ?? false);
            ok = !!cur === (t.state !== false);
            break;
        }
        case 'attraction': {
            const who = env.present.filter(n => t.who === 'char' ? lowerEq(n, env.charName) : t.who === 'any_npc' ? !lowerEq(n, env.charName) : true);
            ok = env.intimacyEnabled !== false && who.some(n => {
                const key = findKeyCI(env.characters, n);
                return key && attractionLive(env.characters[key].intimacy, env.turn);
            });
            break;
        }
        case 'any_of': ok = (t.triggers || []).some(x => testTrigger(x, env)); break;
        case 'all_of': ok = (t.triggers || []).length > 0 && t.triggers.every(x => testTrigger(x, env)); break;
        case 'none_of': ok = !(t.triggers || []).some(x => testTrigger(x, env)); break;
        default: ok = false;
    }
    if (ok && t.pct !== undefined && t.type !== 'chance') ok = roll(env, t.pct);
    return ok;
}

/** Chance triggers are evaluated last under "all" so a failed condition never consumes a roll. */
function rulePasses(rule, env) {
    const ts = rule.triggers || [];
    if (!ts.length) return false;
    if (rule.logic === 'all') {
        const ordered = [...ts.filter(t => t.type !== 'chance' && t.pct === undefined), ...ts.filter(t => t.type === 'chance' || t.pct !== undefined)];
        return ordered.every(t => testTrigger(t, env));
    }
    return ts.some(t => testTrigger(t, env));
}

// ---------------------------------------------------------------------------------------------------------------------
// Evaluation

function applySet(vars, switches, s) {
    if (s.kind === 'switch') { switches[s.name] = !!s.value; return; }
    if (s.op === 'add' || s.op === 'sub') {
        const cur = Number(vars[s.name]);
        const d = Number(s.value);
        vars[s.name] = (Number.isFinite(cur) ? cur : 0) + (Number.isFinite(d) ? (s.op === 'sub' ? -d : d) : 0);
        return;
    }
    vars[s.name] = s.value;
}

function shuffled(n, rng) {
    const a = Array.from({ length: n }, (_, i) => i);
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/**
 * Pick and expand pool lines for one firing. Returns null when no line survives expansion + the safety filter.
 * Mutates rs.cycles / rs.bags only when a line was produced.
 */
function produceText(rule, rs, tctx, opts) {
    const pool = rule.action.pool || [];
    if (!pool.length) return null;
    const o = opts.options;
    const rng = tctx.rng;
    const want = rule.action.count || 1;
    const maxChars = rule.action.type === 'inject' && rule.action.placement === 'depth' ? o.max_depth_chars : o.max_line_chars;
    let order;
    let bag = null;
    const mode = rule.action.pick;
    if (mode === 'cycle') {
        const start = Number.isFinite(rs.cycles[rule.id]) ? rs.cycles[rule.id] % pool.length : 0;
        order = Array.from({ length: pool.length }, (_, i) => (start + i) % pool.length);
    } else if (mode === 'shuffle') {
        // A bag: each line once (in random order) before any repeats.
        bag = (rs.bags[rule.id] || []).filter(i => i < pool.length);
        if (!bag.length) bag = shuffled(pool.length, rng);
        const rest = [...Array(pool.length).keys()].filter(i => !bag.includes(i));
        order = [...bag, ...rest];
    } else {
        order = shuffled(pool.length, rng);
    }
    const texts = [];
    const used = [];
    const dropped = [];
    for (const idx of order) {
        if (texts.length >= want) break;
        const r = expandTemplate(pool[idx], tctx);
        if (!r.ok) { dropped.push({ idx, reason: r.reason }); continue; }
        const bad = unsafeReason(r.text, opts);
        if (bad) { dropped.push({ idx, reason: `unsafe: ${bad}` }); continue; }
        texts.push(clip(r.text, maxChars));
        used.push(idx);
    }
    if (!texts.length) return { text: null, dropped };
    if (mode === 'cycle') rs.cycles[rule.id] = (used[used.length - 1] + 1) % pool.length;
    if (mode === 'shuffle') {
        const left = bag.filter(i => !used.includes(i));
        if (left.length) rs.bags[rule.id] = left;
        else delete rs.bags[rule.id];
    }
    return { text: texts.join(' '), dropped };
}

/**
 * Evaluate every enabled rule for this turn.
 *
 * @param {object} p
 * @param {object[]} p.rules resolved rules (resolveRuleSet().rules)
 * @param {object} [p.packs] {[packId]: {enabled, max_per_turn}} — rules of a disabled pack never fire
 * @param {object} [p.state] Undercurrent chat state (characters, scene) — read only
 * @param {object} [p.ruleState] rules_state from the chat (else state.rules_state)
 * @param {number} p.turn player turn number (countUserTurns)
 * @param {string} [p.type] generation type; 'quiet' and 'impersonate' never fire anything
 * @param {string} [p.userText] last player message (private *thoughts* are ignored)
 * @param {string} [p.replyText] previous assistant reply
 * @param {object} [p.vars] chat variables (read); set_var results come back in varSets
 * @param {object} [p.switches] switch overrides (else ruleState.switches)
 * @param {object} [p.scene] defaults to state.scene
 * @param {string[]} [p.present] defaults to state.scene.present, else [charName]
 * @param {string} [p.charName]
 * @param {string} [p.userName]
 * @param {() => number} [p.rng]
 * @param {{max_note_lines?:number, max_depth?:number, max_hints?:number}} [p.budget]
 * @param {boolean} [p.intimacyEnabled]
 * @returns {{fired:object[], noteLines:string[], depthInjections:object[], directorHints:string[], varSets:object[],
 *   switchSets:object[], ruleState:object, trace:object[], skipped:boolean}}
 */
export function evaluateRules(p = {}) {
    const rawRS = p.ruleState ?? p.state?.rules_state;
    const empty = (reason) => ({
        fired: [], noteLines: [], depthInjections: [], directorHints: [], varSets: [], switchSets: [],
        ruleState: normalizeRuleState(rawRS), trace: [{ id: '*', reason }], skipped: true,
    });
    if (NO_FIRE_TYPES.includes(p.type)) return empty(`no rules on ${p.type} generations`);
    const o = optionsOf(p.options || {});
    if (!o.enabled) return empty('chance rules are off');
    const turn = Number.isFinite(p.turn) ? p.turn : 0;
    const rng = typeof p.rng === 'function' ? p.rng : Math.random;
    const budget = {
        max_note_lines: o.max_note_lines, max_depth: o.max_depth, max_hints: o.max_hints,
        ...(isPlainObject(p.budget) ? p.budget : {}),
    };
    const opts = { userName: p.userName || '', options: o };
    const state = isPlainObject(p.state) ? p.state : {};

    // Reroll safety: re-evaluating the same turn starts again from the state before that turn.
    const loaded = normalizeRuleState(rawRS);
    const base = loaded.turn === turn && loaded.prev ? loaded.prev : loaded.turn === turn ? emptyRuleState() : loaded;
    const rs = normalizeRuleState(deepClone({ ...base, prev: null }), { keepPrev: false });
    rs.prev = normalizeRuleState(deepClone({ ...base, prev: null }), { keepPrev: false });
    rs.turn = turn;

    const tctx = templateContext({
        state, scene: p.scene, present: p.present, charName: p.charName || '', userName: p.userName || '',
        vars: { ...(isPlainObject(p.vars) ? p.vars : {}) }, turn, rng, intimacyEnabled: p.intimacyEnabled !== false,
        unresolved: o.unresolved,
    });
    const switches = { ...rs.switches, ...(isPlainObject(p.switches) ? p.switches : {}) };
    const env = {
        turn, rng, userText: o.ignore_private_thoughts ? publicText(p.userText) : String(p.userText ?? ''), replyText: String(p.replyText ?? ''),
        scene: tctx.scene, present: tctx.present, charName: tctx.charName, vars: tctx.vars, switches, characters: tctx.characters,
        intimacyEnabled: p.intimacyEnabled !== false, chanceMult: o.chance_multiplier, modeGroups: o.mode_groups,
        state: p.state,
    };
    const packs = isPlainObject(p.packs) ? p.packs : {};
    const trace = [];
    const varSets = [];
    const switchSets = [];
    const setEffect = (s, ruleId) => {
        applySet(env.vars, env.switches, s);
        if (s.kind === 'switch') { rs.switches[s.name] = !!s.value; switchSets.push({ name: s.name, value: !!s.value, rule: ruleId }); }
        else varSets.push({ name: s.name, value: env.vars[s.name], op: s.op, rule: ruleId });
    };

    // Sticky carry-over: still-active injections from earlier turns.
    const carried = [];
    for (const [id, s] of Object.entries(rs.sticky)) {
        if (s.until < turn || s.from >= turn) { delete rs.sticky[id]; continue; }
        carried.push({ id, s });
    }

    const rules = (Array.isArray(p.rules) ? p.rules : []).filter(r => isPlainObject(r) && r.id);
    const ordered = rules.map((r, i) => ({ r, i })).sort((a, b) => (b.r.priority ?? o.default_priority) - (a.r.priority ?? o.default_priority) || a.i - b.i);
    const candidates = [];
    for (const { r, i } of ordered) {
        const pack = packs[r.pack];
        if (r.enabled === false) { trace.push({ id: r.id, reason: 'disabled' }); continue; }
        if (pack && pack.enabled === false) { trace.push({ id: r.id, reason: 'pack off' }); continue; }
        if (carried.some(c => c.id === r.id)) { trace.push({ id: r.id, reason: 'sticky (still active)' }); continue; }
        if (r.max_fires > 0 && (rs.fires[r.id] || 0) >= r.max_fires) { trace.push({ id: r.id, reason: 'max fires reached' }); continue; }
        const last = rs.last[r.id];
        if (r.cooldown > 0 && Number.isFinite(last) && turn - last <= r.cooldown) { trace.push({ id: r.id, reason: `cooldown (${r.cooldown - (turn - last) + 1} left)` }); continue; }
        if (!rulePasses(r, env)) { trace.push({ id: r.id, reason: 'triggers not met' }); continue; }
        // Control rules (pure set_var) take effect immediately so later rules in this turn see them.
        if (r.action?.type === 'set_var') {
            for (const s of r.action.sets || []) setEffect(s, r.id);
            rs.last[r.id] = turn;
            rs.fires[r.id] = (rs.fires[r.id] || 0) + 1;
            trace.push({ id: r.id, reason: 'fired (set_var)' });
            continue;
        }
        candidates.push({ r, i });
    }

    // Budget admission, highest priority first; sticky carry-overs compete with their own priority (ties: sticky first).
    const pool = [
        ...carried.map(c => ({ sticky: true, id: c.id, s: c.s, pri: c.s.priority ?? o.default_priority, i: -1 })),
        ...candidates.map(c => ({ sticky: false, id: c.r.id, r: c.r, pri: c.r.priority ?? o.default_priority, i: c.i })),
    ].sort((a, b) => b.pri - a.pri || (a.sticky === b.sticky ? a.i - b.i : a.sticky ? -1 : 1));
    const used = { note: 0, depth: 0, hint: 0 };
    const perPack = {};
    const fired = [];
    const noteLines = [];
    const depthItems = [];
    const directorHints = [];
    const slotOf = (kind, placement) => (kind === 'director_hint' ? 'hint' : placement === 'depth' ? 'depth' : 'note');
    const cap = { note: budget.max_note_lines, depth: budget.max_depth, hint: budget.max_hints };
    const emit = (kind, placement, text, depth, role, id, sticky) => {
        if (kind === 'director_hint') directorHints.push(text);
        else if (placement === 'depth') depthItems.push({ text, depth, role, id });
        else noteLines.push(text);
        fired.push({ rule: id, text, kind, placement: kind === 'director_hint' ? 'director' : placement, sticky });
    };
    for (const c of pool) {
        if (c.sticky) {
            const slot = slotOf(c.s.kind, c.s.placement);
            if (used[slot] >= cap[slot]) { trace.push({ id: c.id, reason: 'sticky: over budget this turn' }); continue; }
            used[slot]++;
            emit(c.s.kind, c.s.placement, c.s.text, c.s.depth, c.s.role, c.id, true);
            trace.push({ id: c.id, reason: 'sticky (still active)' });
            continue;
        }
        const r = c.r;
        const slot = slotOf(r.action.type, r.action.placement);
        const packCap = packs[r.pack]?.max_per_turn || 0;
        if (used[slot] >= cap[slot]) { trace.push({ id: r.id, reason: `over budget (${slot})` }); continue; }
        if (packCap && (perPack[r.pack] || 0) >= packCap) { trace.push({ id: r.id, reason: `pack limit (${packCap}/turn)` }); continue; }
        const out = produceText(r, rs, tctx, opts);
        if (!out || !out.text) {
            trace.push({ id: r.id, reason: `no usable line (${out?.dropped?.[0]?.reason || 'empty pool'})` });
            continue;
        }
        used[slot]++;
        perPack[r.pack] = (perPack[r.pack] || 0) + 1;
        rs.last[r.id] = turn;
        rs.fires[r.id] = (rs.fires[r.id] || 0) + 1;
        for (const s of r.action.sets || []) setEffect(s, r.id);
        const placement = r.action.placement || 'note';
        const depth = r.action.depth ?? o.default_depth;
        const role = r.action.role || o.default_role;
        emit(r.action.type, placement, out.text, depth, role, r.id, false);
        if (r.sticky > 0) {
            rs.sticky[r.id] = { text: out.text, kind: r.action.type, placement, depth, role, priority: r.priority ?? o.default_priority, from: turn, until: turn + r.sticky };
        }
        trace.push({ id: r.id, reason: 'fired' });
    }
    const depthInjections = depthItems.slice(0, budget.max_depth).map((d, n) => ({ key: `undercurrent_rule_${n}`, text: d.text, depth: d.depth, role: d.role, rule: d.id }));
    return { fired, noteLines, depthInjections, directorHints, varSets, switchSets, ruleState: rs, trace, skipped: false };
}

/** Deterministic rng for a chat turn (same chat + turn + salt → same rolls). */
export function turnRng(chatId, turn, salt = 0) {
    let h = 0x811c9dc5;
    const s = `${chatId}|${turn}|${salt}`;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return makeRng(h);
}
