// Undercurrent — the Scribe: a post-reply clerk that returns patch ops describing what the latest reply established.
// Also builds the in-reply instruction (inreply mode) that asks the main model to append the same ops in a hidden block.
// Pure logic. Templates, the op cap and the recordable path groups come from `config` (knobs; see SCRIBE_DEFAULTS).

import { parsePath, OPS, SCENE_MODES } from './state.js';
import { PHASES } from './intimacy.js';
import { isPlainObject, clip, renderTemplate, mergeConfig } from './util.js';
import { asArray } from './parse.js';
import { isScribePortPath, parsePortPath, portPathGroup, PORT_PATH_GROUPS } from './ports/port-state.js';

export const MAX_OPS = 16;

/** Groups of op paths the scribe may record. Each can be switched off (knobs scribe.record_<group>). */
export const PATH_GROUPS = [
    { id: 'scene_mode', label: 'Scene mode' },
    { id: 'place', label: 'Place' },
    { id: 'time', label: 'In-story time' },
    { id: 'weather', label: 'Weather' },
    { id: 'present', label: 'Who is present' },
    { id: 'facts', label: 'Facts' },
    { id: 'offscreen', label: 'Off-screen threads' },
    { id: 'arcs', label: 'Arcs and drivers' },
    { id: 'new_characters', label: 'New character profiles' },
    { id: 'character_mood', label: 'Character mood' },
    { id: 'character_profile', label: 'Character role / relation / traits' },
    { id: 'character_whereabouts', label: 'Character whereabouts (last seen, off-screen)' },
    { id: 'character_wants', label: 'Character wants / plans / goals' },
    { id: 'character_knowledge', label: 'Character knowledge (knows / doesn\'t know)' },
    { id: 'character_secrets', label: 'Character secrets' },
    { id: 'intimacy', label: 'Intimacy (preferences, limits, history)' },
];

/** Recordable groups of the native port engines, plus clothing (scene_intimacy.wardrobe) as its own switch. */
export const PORT_RECORD_GROUPS = [
    ...PORT_PATH_GROUPS.map(g => ({ id: g.id, label: g.id === 'scene_intimacy' ? 'Intimate scene (phase, activities, aftermath)' : g.label })),
    { id: 'clothing', label: 'Clothing (what is worn, loosened, removed)' },
];

const SCALAR_GROUP = { mood: 'character_mood', role: 'character_profile', relation: 'character_profile', age: 'character_profile', traits: 'character_profile', background: 'character_profile', ikigai: 'character_profile', last_seen: 'character_whereabouts', offscreen: 'character_whereabouts' };
const LIST_GROUP = { wants: 'character_wants', plans: 'character_wants', goals: 'character_wants', knows: 'character_knowledge', doesnt_know: 'character_knowledge', secrets: 'character_secrets' };

/** The path group of a parsed path (see state.parsePath), or null. */
export function pathGroup(p) {
    if (!p) return null;
    if (p.kind === 'port') {
        // Clothing has its own switch (scribe.record_clothing); the rest follow the ports' own path groups.
        if (p.engine === 'scene_intimacy' && p.field === 'wardrobe') return 'clothing';
        return portPathGroup(`${p.engine}.${p.field}`);
    }
    if (p.kind === 'facts') return 'facts';
    if (p.kind === 'scene') return p.field === 'mode' ? 'scene_mode' : p.field;
    if (p.kind === 'threads') return p.field === 'offscreen' ? 'offscreen' : p.field === 'used_beats' ? null : 'arcs';
    if (p.kind === 'intimacy') return 'intimacy';
    if (p.kind === 'character') {
        if (p.field === null) return 'new_characters';
        return (p.list ? LIST_GROUP[p.field] : SCALAR_GROUP[p.field]) || 'character_profile';
    }
    return null;
}

export const SCRIBE_TEMPLATE = `You are the continuity clerk of an interactive story. You read the LATEST REPLY (and the player's message before it) and record, as patch operations, only what that reply established as true in the story. You never invent, predict, judge style or guess motives the text does not show.

Output ONLY JSON: {"ops":[{"op":"set|append|close|remove","path":"<path>","value":<value>,"reason":"<=10 words"}]}

Paths:
{{uc_paths}}

Rules:
- Record what the text shows, nothing more. If nothing changed: {"ops":[]}. At most {{uc_max_ops}} ops; the most consequential first.
- Knowledge is per character. "knows" = what that character saw, heard or was told on the page. If something important happened that a character did not witness, add it to their doesnt_know.
- {{user}} is the player. Never record {{user}}'s thoughts, feelings or intentions, and never create a character entry for {{user}}. Facts about {{user}} only when {{user}} said or did them in the open.
- Text marked as {{user}}'s private thought is unknown to everyone: never record it as known by any character or as a fact.
- Use names exactly as written in the story. Close outdated items instead of adding contradictions; update mood when it visibly changed.
- New named characters get a short profile (role, traits, ikigai, goals) drawn from what the text shows; leave unknown fields empty.
- Every "quote" must be copied verbatim from the latest reply or the player's message.{{uc_intimacy_rule}}{{uc_pronoun_rule}}{{uc_extra_instructions}}`;

export const INREPLY_TEMPLATE = `[Continuity record — after your reply, append exactly one hidden line, nothing after it:
<!--uc {"ops":[...]} -->
Each op: {"op":"set|append|close|remove","path":"<path>","value":<value>}. Record only what THIS reply established; [] if nothing changed. At most {{uc_max_ops}} ops.
Paths:
{{uc_paths}}
Never record {{user}}'s thoughts or create an entry for {{user}}. Quotes verbatim from your reply. The block is invisible to the reader: never refer to it in the story.]`;

export const SCRIBE_PLACEHOLDERS = [
    { name: 'uc_paths', help: 'The list of recordable paths (follows the "record …" switches and the intimacy engine).' },
    { name: 'uc_max_ops', help: 'Max ops per reply (knob scribe.max_ops).' },
    { name: 'uc_intimacy_rule', help: 'The intimacy evidence rule (only when the intimacy engine is on).' },
    { name: 'uc_pronoun_rule', help: 'The {{user}} pronoun rule from the preset toggle, as "\\n- …", or empty.' },
    { name: 'uc_extra_instructions', help: 'Your extra scribe instructions (knob scribe.extra_instructions), as "\\n- …", or empty.' },
];

export const INREPLY_PLACEHOLDERS = SCRIBE_PLACEHOLDERS.filter(p => p.name === 'uc_paths' || p.name === 'uc_max_ops');

const INTIMACY_RULE = '\n- Intimacy evidence only from what a character did or said on the page. Reluctance, discomfort or refusal is negative evidence. Never infer a limit was relaxed.';

export const SCRIBE_DEFAULTS = Object.freeze({
    systemTemplate: SCRIBE_TEMPLATE,
    inreplyTemplate: INREPLY_TEMPLATE,
    extraInstructions: '',
    maxOps: MAX_OPS,
    includePronoun: true,
    includeCast: true,
    includeRecord: true,
    includeEarlier: true,
    finalInstruction: 'Return the ops JSON for what <latest_reply> established.',
    record: Object.freeze(Object.fromEntries([...PATH_GROUPS, ...PORT_RECORD_GROUPS].map(g => [g.id, true]))),
    extraPathLines: Object.freeze([]), // port engines' path lines (index.js / knob-defs fill these)
    phaseTracking: true,
    attractionTracking: true,
});

export function scribeConfig(config) {
    return mergeConfig(SCRIBE_DEFAULTS, config);
}

function pathGuide({ intimacy = true } = {}, cfg = SCRIBE_DEFAULTS) {
    const on = id => cfg.record?.[id] !== false;
    const lines = [];
    if (on('scene_mode')) lines.push(`scene.mode — set one of: ${SCENE_MODES.join(', ')}`);
    const scal = ['place', 'time', 'weather'].filter(on);
    if (scal.length) lines.push(`${scal.map(f => `scene.${f}`).join(' | ')} — set short text${on('time') ? ' (time = in-story day and clock, e.g. "Tue, past midnight")' : ''}`);
    if (on('present')) lines.push('scene.present — append / remove one name: who is physically here now (never {{user}})');
    if (on('facts')) lines.push('facts — append "a durable fact the story established" | close "fact that stopped being true" | remove (only to correct a wrong record)');
    if (on('offscreen')) lines.push('threads.offscreen — append {"who","doing","surfaces_when"} | close "who" when it resolved');
    if (on('arcs')) lines.push('threads.arcs — append {"name","status","next"} | close "name"');
    if (on('new_characters')) lines.push('characters.<Name> — set {"role","age","traits","ikigai","background","relation","goals":[],"mood"} ONLY to introduce a new named character (ikigai = their reason for being)');
    const scalars = ['mood', 'role', 'relation', 'last_seen', 'offscreen'].filter(f => on(SCALAR_GROUP[f]));
    if (scalars.length) lines.push(`characters.<Name>.${scalars.join('|')} — set short text`);
    const lists = ['wants', 'plans', 'goals', 'knows', 'doesnt_know', 'secrets'].filter(f => on(LIST_GROUP[f]));
    if (lists.length) lines.push(`characters.<Name>.${lists.join('|')} — append | close short text`);
    if (intimacy && on('intimacy')) {
        lines.push(
            'characters.<Name>.intimacy.preferences — append {"item","polarity":"positive|negative","quote":"exact words from the text showing it"}',
            'characters.<Name>.intimacy.limits — append {"item","quote"} when they explicitly state or enact a limit; close {"item","quote","explicit_choice":true} only when they explicitly choose to drop it',
            'characters.<Name>.intimacy.history — append {"text","quote"} for an intimate event that happened',
        );
        if (cfg.phaseTracking !== false) lines.push(`characters.<Name>.intimacy.phase — set ${PHASES.join('|')}`);
        if (cfg.attractionTracking !== false) lines.push('characters.<Name>.intimacy.attraction — set a short note of live, unacted attraction; "" when it is gone');
    }
    return [...lines.map(l => `- ${l}`), ...(Array.isArray(cfg.extraPathLines) ? cfg.extraPathLines : [])].join('\n');
}

export function buildScribeSystem({ intimacy = true, pronoun = '' } = {}, config) {
    const cfg = scribeConfig(config);
    const extra = String(cfg.extraInstructions ?? '').trim();
    const tpl = String(cfg.systemTemplate || '').trim() ? cfg.systemTemplate : SCRIBE_TEMPLATE;
    return renderTemplate(tpl, {
        uc_paths: pathGuide({ intimacy }, cfg),
        uc_max_ops: cfg.maxOps,
        uc_intimacy_rule: intimacy && cfg.record?.intimacy !== false ? INTIMACY_RULE : '',
        uc_pronoun_rule: cfg.includePronoun && pronoun ? `\n- ${pronoun}` : '',
        uc_extra_instructions: extra ? `\n- ${extra.replace(/\n+/g, '\n- ')}` : '',
    });
}

/**
 * @param {object} p
 * @param {string} p.cardBlock
 * @param {string} p.stateBlock
 * @param {string} p.transcript earlier messages for context (may be shorter than the director's)
 * @param {string} p.userMessage the player message the reply answered (private thoughts already marked)
 * @param {string} p.reply the latest reply text
 * @param {boolean} [p.intimacy]
 * @param {string} [p.pronoun]
 * @param {object} [p.config] see SCRIBE_DEFAULTS
 */
export function buildScribeMessages({ cardBlock = '', stateBlock = '', transcript = '', userMessage = '', reply = '', intimacy = true, pronoun = '', config }) {
    const cfg = scribeConfig(config);
    const content = [
        cfg.includeCast && cardBlock && `<cast>\n${cardBlock}\n</cast>`,
        cfg.includeRecord && stateBlock && `<current_record>\n${stateBlock}\n</current_record>`,
        cfg.includeEarlier && transcript && `<earlier>\n${transcript}\n</earlier>`,
        `<player_message>\n${userMessage || '(none)'}\n</player_message>`,
        `<latest_reply>\n${reply}\n</latest_reply>`,
        cfg.finalInstruction,
    ].filter(Boolean).join('\n\n');
    return { systemPrompt: buildScribeSystem({ intimacy, pronoun }, cfg), messages: [{ role: 'user', content }] };
}

/**
 * Validate a parsed scribe/in-reply result against the op shape and the path allow-list.
 * Accepts {ops:[...]}, a bare array, or a single op.
 * @param {any} parsed
 * @param {{userName?:string, intimacy?:boolean, max?:number, config?:object}} [opts]
 * @returns {{ops:object[], rejected:{op:any, reason:string}[]}}
 */
export function normalizeOps(parsed, { userName = '', intimacy = true, max, config } = {}) {
    const cfg = scribeConfig(config);
    const cap = Number.isFinite(max) ? max : cfg.maxOps;
    let list;
    if (Array.isArray(parsed)) list = parsed;
    else if (isPlainObject(parsed) && Array.isArray(parsed.ops)) list = parsed.ops;
    else if (isPlainObject(parsed) && parsed.op) list = [parsed];
    else list = [];
    const ops = [];
    const rejected = [];
    for (const raw of asArray(list, Math.max(64, cap * 4))) {
        if (!isPlainObject(raw)) { rejected.push({ op: raw, reason: 'not an object' }); continue; }
        const op = String(raw.op ?? '').toLowerCase().trim();
        if (!OPS.includes(op)) { rejected.push({ op: raw, reason: `unknown op ${op}` }); continue; }
        const p = parsePath(raw.path) || (isScribePortPath(raw.path) ? parsePortPath(raw.path) : null);
        if (!p) { rejected.push({ op: raw, reason: 'path not allowed' }); continue; }
        if (p.kind === 'port' && (p.engine === 'scene_intimacy' || p.engine === 'desire') && !intimacy) { rejected.push({ op: raw, reason: 'intimacy engine off' }); continue; }
        if (p.kind === 'threads' && p.field === 'used_beats') { rejected.push({ op: raw, reason: 'director-only path' }); continue; }
        if (p.kind === 'intimacy' && !intimacy) { rejected.push({ op: raw, reason: 'intimacy engine off' }); continue; }
        const group = pathGroup(p);
        if (group && cfg.record?.[group] === false) { rejected.push({ op: raw, reason: `recording ${group} is switched off` }); continue; }
        if (p.kind === 'intimacy' && p.field === 'phase' && cfg.phaseTracking === false) { rejected.push({ op: raw, reason: 'phase tracking is off' }); continue; }
        if (p.kind === 'intimacy' && p.field === 'attraction' && cfg.attractionTracking === false) { rejected.push({ op: raw, reason: 'attraction tracking is off' }); continue; }
        if ((p.kind === 'character' || p.kind === 'intimacy') && isUser(p.name, userName)) { rejected.push({ op: raw, reason: 'player is not tracked' }); continue; }
        if (raw.value === undefined && op !== 'remove' && op !== 'close') { rejected.push({ op: raw, reason: 'missing value' }); continue; }
        const clean = { op, path: raw.path, value: raw.value };
        if (raw.reason) clean.reason = clip(String(raw.reason), 100);
        if (Number.isFinite(raw.until_turn)) clean.until_turn = raw.until_turn;
        ops.push(clean);
        if (ops.length >= cap) break;
    }
    return { ops, rejected };
}

function isUser(name, userName) {
    const n = String(name ?? '').trim().toLowerCase();
    return n === '{{user}}' || (userName && n === String(userName).trim().toLowerCase());
}

/**
 * Depth-0 instruction for inreply mode: the main model appends exactly one hidden block after its reply.
 */
export function buildInreplyInstruction({ intimacy = true } = {}, config) {
    const cfg = scribeConfig(config);
    const tpl = String(cfg.inreplyTemplate || '').trim() ? cfg.inreplyTemplate : INREPLY_TEMPLATE;
    return renderTemplate(tpl, { uc_paths: pathGuide({ intimacy }, cfg), uc_max_ops: cfg.maxOps });
}
