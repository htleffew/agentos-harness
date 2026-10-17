// Undercurrent — the Scribe: a post-reply clerk that returns patch ops describing what the latest reply established.
// Also builds the in-reply instruction (inreply mode) that asks the main model to append the same ops in a hidden block.
// Pure logic.

import { parsePath, OPS, SCENE_MODES } from './state.js';
import { PHASES } from './intimacy.js';
import { isPlainObject, clip } from './util.js';
import { asArray } from './parse.js';

export const MAX_OPS = 16;

function pathGuide({ intimacy = true } = {}) {
    const lines = [
        `scene.mode — set one of: ${SCENE_MODES.join(', ')}`,
        'scene.place | scene.time | scene.weather — set short text (time = in-story day and clock, e.g. "Tue, past midnight")',
        'scene.present — append / remove one name: who is physically here now (never {{user}})',
        'facts — append "a durable fact the story established" | close "fact that stopped being true" | remove (only to correct a wrong record)',
        'threads.offscreen — append {"who","doing","surfaces_when"} | close "who" when it resolved',
        'threads.arcs — append {"name","status","next"} | close "name"',
        'characters.<Name> — set {"role","age","traits","ikigai","background","relation","goals":[],"mood"} ONLY to introduce a new named character (ikigai = their reason for being)',
        'characters.<Name>.mood|role|relation|last_seen|offscreen — set short text',
        'characters.<Name>.wants|plans|goals|knows|doesnt_know|secrets — append | close short text',
    ];
    if (intimacy) {
        lines.push(
            'characters.<Name>.intimacy.preferences — append {"item","polarity":"positive|negative","quote":"exact words from the text showing it"}',
            'characters.<Name>.intimacy.limits — append {"item","quote"} when they explicitly state or enact a limit; close {"item","quote","explicit_choice":true} only when they explicitly choose to drop it',
            'characters.<Name>.intimacy.history — append {"text","quote"} for an intimate event that happened',
            `characters.<Name>.intimacy.phase — set ${PHASES.join('|')}`,
            'characters.<Name>.intimacy.attraction — set a short note of live, unacted attraction; "" when it is gone',
        );
    }
    return lines.map(l => `- ${l}`).join('\n');
}

export function buildScribeSystem({ intimacy = true } = {}) {
    return `You are the continuity clerk of an interactive story. You read the LATEST REPLY (and the player's message before it) and record, as patch operations, only what that reply established as true in the story. You never invent, predict, judge style or guess motives the text does not show.

Output ONLY JSON: {"ops":[{"op":"set|append|close|remove","path":"<path>","value":<value>,"reason":"<=10 words"}]}

Paths:
${pathGuide({ intimacy })}

Rules:
- Record what the text shows, nothing more. If nothing changed: {"ops":[]}. At most ${MAX_OPS} ops; the most consequential first.
- Knowledge is per character. "knows" = what that character saw, heard or was told on the page. If something important happened that a character did not witness, add it to their doesnt_know.
- {{user}} is the player. Never record {{user}}'s thoughts, feelings or intentions, and never create a character entry for her. Facts about {{user}} only when she said or did them in the open.
- Text marked as {{user}}'s private thought is unknown to everyone: never record it as known by any character or as a fact.
- Use names exactly as written in the story. Close outdated items instead of adding contradictions; update mood when it visibly changed.
- New named characters get a short profile (role, traits, ikigai, goals) drawn from what the text shows; leave unknown fields empty.
- Every "quote" must be copied verbatim from the latest reply or the player's message.${intimacy ? '\n- Intimacy evidence only from what a character did or said on the page. Reluctance, discomfort or refusal is negative evidence. Never infer a limit was relaxed.' : ''}`;
}

/**
 * @param {object} p
 * @param {string} p.cardBlock
 * @param {string} p.stateBlock
 * @param {string} p.transcript earlier messages for context (may be shorter than the director's)
 * @param {string} p.userMessage the player message the reply answered (private thoughts already marked)
 * @param {string} p.reply the latest reply text
 * @param {boolean} [p.intimacy]
 */
export function buildScribeMessages({ cardBlock = '', stateBlock = '', transcript = '', userMessage = '', reply = '', intimacy = true }) {
    const content = [
        cardBlock && `<cast>\n${cardBlock}\n</cast>`,
        stateBlock && `<current_record>\n${stateBlock}\n</current_record>`,
        transcript && `<earlier>\n${transcript}\n</earlier>`,
        `<player_message>\n${userMessage || '(none)'}\n</player_message>`,
        `<latest_reply>\n${reply}\n</latest_reply>`,
        'Return the ops JSON for what <latest_reply> established.',
    ].filter(Boolean).join('\n\n');
    return { systemPrompt: buildScribeSystem({ intimacy }), messages: [{ role: 'user', content }] };
}

/**
 * Validate a parsed scribe/in-reply result against the op shape and the path allow-list.
 * Accepts {ops:[...]}, a bare array, or a single op.
 * @returns {{ops:object[], rejected:{op:any, reason:string}[]}}
 */
export function normalizeOps(parsed, { userName = '', intimacy = true, max = MAX_OPS } = {}) {
    let list;
    if (Array.isArray(parsed)) list = parsed;
    else if (isPlainObject(parsed) && Array.isArray(parsed.ops)) list = parsed.ops;
    else if (isPlainObject(parsed) && parsed.op) list = [parsed];
    else list = [];
    const ops = [];
    const rejected = [];
    for (const raw of asArray(list, 64)) {
        if (!isPlainObject(raw)) { rejected.push({ op: raw, reason: 'not an object' }); continue; }
        const op = String(raw.op ?? '').toLowerCase().trim();
        if (!OPS.includes(op)) { rejected.push({ op: raw, reason: `unknown op ${op}` }); continue; }
        const p = parsePath(raw.path);
        if (!p) { rejected.push({ op: raw, reason: 'path not allowed' }); continue; }
        if (p.kind === 'threads' && p.field === 'used_beats') { rejected.push({ op: raw, reason: 'director-only path' }); continue; }
        if (p.kind === 'intimacy' && !intimacy) { rejected.push({ op: raw, reason: 'intimacy engine off' }); continue; }
        if ((p.kind === 'character' || p.kind === 'intimacy') && isUser(p.name, userName)) { rejected.push({ op: raw, reason: 'player is not tracked' }); continue; }
        if (raw.value === undefined && op !== 'remove' && op !== 'close') { rejected.push({ op: raw, reason: 'missing value' }); continue; }
        const clean = { op, path: raw.path, value: raw.value };
        if (raw.reason) clean.reason = clip(String(raw.reason), 100);
        if (Number.isFinite(raw.until_turn)) clean.until_turn = raw.until_turn;
        ops.push(clean);
        if (ops.length >= max) break;
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
export function buildInreplyInstruction({ intimacy = true } = {}) {
    return `[Continuity record — after your reply, append exactly one hidden line, nothing after it:
<!--uc {"ops":[...]} -->
Each op: {"op":"set|append|close|remove","path":"<path>","value":<value>}. Record only what THIS reply established; [] if nothing changed. At most ${MAX_OPS} ops.
Paths:
${pathGuide({ intimacy })}
Never record {{user}}'s thoughts or create an entry for {{user}}. Quotes verbatim from your reply. The block is invisible to the reader: never refer to it in the story.]`;
}
