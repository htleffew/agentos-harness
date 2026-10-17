// Undercurrent ports — scene intimacy tracker. Pure logic.
//
// Reproduces, natively, the scene-tracking mechanics of an erotica render plugin: a descriptive scene phase, what has
// happened so far, clothing state per character, which senses / dialogue / interiority the replies have used lately,
// counters for worn-out intimate-scene phrasing and over-repeated acts, a pacing cycle (linger / advance / shift ...)
// and aftermath continuity (marks, mess, mood, unfinished talk). It produces a few short craft lines for the note from a
// phase-aware specialist pool with cooldowns and a per-turn cap.
//
// What it deliberately is NOT: a gate. The phase never decides whether characters may feel or act, there are no heat
// meters, no stage ladder, no explicitness dial, no "debt" numbers in the prompt. Facts come from the scribe (quoted,
// ledgered ops) and from a code-side scan of the reply; the lines only describe and suggest. Hard limits and evidenced
// dislikes of present characters are always restated while a scene is live. Nothing here describes or decides
// {{user}}'s arousal, pleasure, feelings or climax, and the player's moods are never recorded.

import {
    kb, ki, kn, kt, kta, klist, kjson, makeResolver, isUserName, presentNpcs, charRecord, str, sameThing, phraseHits,
    dialogueSpans, thoughtSpans, beginTurn, weightedPick, capNewest, renderTemplate, isPlainObject, clip, normText, deepClone,
} from './common.js';

const G = 'Scene intimacy';
const P = 'scene_intimacy.';

export const SCENE_INTIMACY_PATHS = ['phase', 'activity', 'wardrobe', 'residue', 'end', 'observe'];
export const SYSTEM_PATHS = ['observe'];

const DEFAULT_PHASES = ['approach', 'foreplay', 'escalation', 'peak', 'afterglow', 'aftermath'];
const DEFAULT_SENSES = {
    touch: ['touch', 'skin', 'grip', 'press', 'stroke', 'brush', 'warm', 'cold', 'rough', 'smooth', 'fingertips', 'palm', 'weight'],
    sight: ['look', 'watch', 'gaze', 'glance', 'light', 'shadow', 'flush', 'color', 'eyes', 'see', 'sight'],
    sound: ['breath', 'gasp', 'whisper', 'sound', 'creak', 'laugh', 'murmur', 'hum', 'groan', 'sigh', 'rustle', 'voice'],
    smell: ['smell', 'scent', 'sweat', 'soap', 'perfume', 'smoke', 'musk'],
    taste: ['taste', 'salt', 'tongue', 'sweet', 'bitter', 'wine', 'mouth'],
};
const DEFAULT_CLICHES = [
    'ministrations', 'a moan escaped', 'heat pooled', 'heat pooling', 'pooling low', 'electricity', 'sparks flew', 'every nerve',
    'jolt of pleasure', 'waves of pleasure', 'wave after wave', 'white-hot', 'saw stars', 'became one', 'mewled', 'wanton',
    '/\\bclaim(?:s|ed)? (?:\\w+ ){0,2}mouth\\b/i', 'bruising kiss', 'kiss-swollen', 'swallowed the sound',
    'coming undone', 'shattered', 'fell apart in', 'the dam broke', 'tight coil', 'coiled tight',
];
const DEFAULT_PACE_TEXT = {
    linger: 'linger: stay inside this moment; let sensation and reaction breathe before anything new happens',
    advance: 'advance: let something change now (a new touch, position, request, or decision by someone other than {{user}})',
    deepen: 'deepen: same action, more meaning: what it stirs in {{char}} beyond the body',
    shift: 'shift: the scene has idled; change angle, tempo, sense or place instead of re-describing it',
    land: 'land: let what is already happening play out on the page; no skipping ahead, no automatic synchronized ending',
    settle: 'settle: the heat is behind them; ordinary life and its small consequences come back',
};
const DEFAULT_POOL = [
    { id: 'legible', phases: [], when: [], weight: 2, text: 'Keep positions, reach and who-touches-whom physically legible: a reader could stage it.' },
    { id: 'voice', phases: [], when: [], weight: 2, text: 'Everyone keeps their ordinary voice here: vocabulary, humor and hang-ups survive arousal.' },
    { id: 'want_vs_do', phases: ['approach', 'foreplay'], when: [], weight: 2, text: 'Wanting and doing can differ: a hesitation, a dare, a joke or a held breath carries as much as contact.' },
    { id: 'specific', phases: [], when: [], weight: 1, text: 'One precise, unrepeatable detail beats three adjectives.' },
    { id: 'wardrobe', phases: [], when: ['wardrobe_live'], weight: 3, text: 'Clothing moves as a sequence: what is loosened, pushed aside or left on matters; nothing vanishes off-page.' },
    { id: 'talk', phases: [], when: ['dialogue_thin'], weight: 3, text: 'Bring speech back: a request, a tease, a laugh, a name said differently.' },
    { id: 'senses', phases: [], when: ['senses_resting'], weight: 3, text: 'Lead this beat with a sense that has been resting: {{uc_senses}}.' },
    { id: 'change', phases: [], when: ['stasis'], weight: 4, text: 'Render only what changes: a new angle, pace, sound or decision; compress whatever stays the same.' },
    { id: 'tempo', phases: ['escalation', 'peak'], when: [], weight: 2, text: 'Let sentence rhythm follow the bodies: shorter as it quickens, longer as it slows.' },
    { id: 'interior', phases: [], when: [], weight: 2, text: 'One private thought of {{char}}\'s that is surprising, petty, tender or funny, in their own words.' },
    { id: 'no_auto', phases: ['escalation', 'peak'], when: [], weight: 2, text: 'Nothing is automatic: no synchronized finish, no fade to black unless a character chooses it.' },
    { id: 'room', phases: ['approach', 'foreplay', 'escalation'], when: [], weight: 1, text: 'The room still exists: a sound outside, the light, something in the way.' },
    { id: 'after_ordinary', phases: ['afterglow', 'aftermath'], when: [], weight: 3, text: 'Afterwards is ordinary life again: water, cleanup, a joke, cold feet, a phone buzzing; not a vow.' },
    { id: 'after_residue', phases: ['afterglow', 'aftermath'], when: ['residue'], weight: 3, text: 'Let what happened leave traces the characters notice: {{uc_residue}}.' },
    { id: 'crowd', phases: [], when: ['multi'], weight: 3, text: 'More than two people: track everyone; who is watching, who is waiting, who wants in.' },
];

export const SCENE_INTIMACY_PLACEHOLDERS = [
    { name: 'uc_phase', help: 'Descriptive phase label.' },
    { name: 'uc_activities', help: 'What has happened so far in this scene (newest last).' },
    { name: 'uc_wardrobe', help: 'Clothing state per character, as recorded.' },
    { name: 'uc_limits', help: 'Hard limits (and evidenced dislikes) of present characters.' },
    { name: 'uc_senses', help: 'Senses not used for a while.' },
    { name: 'uc_items', help: 'Quoted worn-out phrases or repeated acts.' },
    { name: 'uc_pace', help: 'The pacing hint text.' },
    { name: 'uc_residue', help: 'What carries over (marks, mess, mood, talk).' },
    { name: 'uc_turns', help: 'A number of replies.' },
];

export const SCENE_INTIMACY_KNOBS = [
    kb(`${P}enabled`, G, 'Scene intimacy tracker', true, 'Track intimate scenes (phase, clothing, senses, repetition, aftermath) and add short craft lines while one is live. Also needs the intimacy engine on.'),
    klist(`${P}active_modes`, G, 'Scene modes that count as an intimate scene', ['intimate'], 'Scene modes (scene.mode) during which the tracker is live.'),
    klist(`${P}phases`, G, 'Phase labels', DEFAULT_PHASES, 'Descriptive labels the scribe may record. They describe; they never gate what characters may feel or do.'),
    klist(`${P}carry_phases`, G, 'Phases that mean "after"', ['afterglow', 'aftermath'], 'In these phases the tracker shows aftermath continuity instead of in-scene craft.'),
    ki(`${P}carry_turns`, G, 'Aftermath carry-over (turns)', 6, 0, 60, 'How long marks, mess, mood and unfinished talk keep being remembered after the scene ends.'),
    ki(`${P}phase_stale_turns`, G, 'A recorded phase goes stale after (turns)', 8, 1, 100, 'A phase not updated for this long no longer keeps the tracker live on its own.'),
    kb(`${P}track_player_wardrobe`, G, 'Track {{user}}\'s clothing state', true, 'Clothing is physical continuity, not interiority. Off = only NPC clothing is tracked.'),
    klist(`${P}player_blocked_residue`, G, 'Residue kinds never recorded for {{user}}', ['mood', 'feeling', 'arousal'], 'The player\'s inner state is never tracked; residue of these kinds about {{user}} is rejected.'),
    klist(`${P}wardrobe_states`, G, 'Clothing states', ['on', 'loosened', 'open', 'displaced', 'removed', 'restored'], 'Allowed clothing states for scribe records.'),
    klist(`${P}residue_kinds`, G, 'Residue kinds', ['mark', 'mess', 'ache', 'mood', 'talk', 'other'], 'Allowed aftermath residue kinds.'),
    ki(`${P}max_activities`, G, 'Activities remembered per scene', 12, 1, 60, ''),
    ki(`${P}activities_shown`, G, 'Activities shown in the note', 4, 0, 12, 'The newest ones.'),
    ki(`${P}max_residue`, G, 'Residue items kept', 12, 1, 60, ''),
    ki(`${P}residue_shown`, G, 'Residue items shown', 4, 0, 12, ''),
    kjson(`${P}senses`, G, 'Sense lexicon', DEFAULT_SENSES, 'Map of sense name to words that show it in a reply (code-side scan, no extra call). Edit for other languages.'),
    ki(`${P}sense_window`, G, 'A sense counts as resting after (replies)', 3, 1, 20, ''),
    ki(`${P}senses_shown`, G, 'Resting senses named at most', 2, 0, 6, ''),
    ki(`${P}dialogue_gap`, G, 'Dialogue counts as thin after (replies without speech)', 2, 1, 20, ''),
    ki(`${P}dialogue_min_spans`, G, 'Quoted lines that count as "speech" in a reply', 1, 1, 10, ''),
    klist(`${P}cliches`, G, 'Worn-out intimate-scene phrasing', DEFAULT_CLICHES, 'Phrases (or /regex/flags) counted across the scene\'s replies. Generic prose clichés only; no names or bodies.'),
    kn(`${P}cliche_decay`, G, 'Phrase counter decay per reply', 0.5, 0, 5, 0.1, 'Subtracted from every phrase counter on each reply where it does not appear.'),
    ki(`${P}cliche_threshold`, G, 'Flag a phrase after (uses)', 2, 1, 20, ''),
    ki(`${P}cliches_shown`, G, 'Flagged phrases named at most', 3, 0, 10, ''),
    ki(`${P}act_repeat`, G, 'Flag an act repeated (times)', 3, 2, 20, 'The same recorded activity this many times in a scene gets a "vary or move on" line.'),
    ki(`${P}stasis_turns`, G, 'Stasis after (replies without a new recorded activity)', 2, 1, 20, ''),
    klist(`${P}pace_cycle`, G, 'Pacing cycle', ['linger', 'advance', 'linger', 'deepen'], 'Hints rotate through this list while nothing special applies (no idling, no peak, no aftermath).'),
    ki(`${P}pace_max_repeat`, G, 'Same pacing hint at most (turns in a row)', 2, 1, 10, ''),
    kjson(`${P}pace_text`, G, 'Pacing hint texts', DEFAULT_PACE_TEXT, 'Text for each pacing hint id (linger, advance, deepen, shift, land, settle, or your own ids used in the cycle).'),
    kjson(`${P}pool`, G, 'Specialist pool', DEFAULT_POOL, 'Craft one-liners: {id, phases:[] (empty = any live phase), when:[conditions], weight, text}. Conditions: wardrobe_live, dialogue_thin, senses_resting, stasis, cliche_hot, multi, residue, early.'),
    ki(`${P}max_specialists`, G, 'Specialist lines per turn', 2, 0, 6, ''),
    ki(`${P}specialist_cooldown`, G, 'Specialist cooldown (turns)', 3, 0, 30, 'A line rests this long after it was used.'),
    ki(`${P}wardrobe_live_turns`, G, 'Clothing counts as "in play" for (turns after a change)', 3, 0, 30, ''),
    kb(`${P}include_dislikes`, G, 'Restate evidenced dislikes with the limits', true, ''),
    kta(`${P}status_template`, G, 'Scene line', 'Scene so far ({{uc_phase}}; descriptive, not a gate): {{uc_activities}}', 'Placeholders: {{uc_phase}}, {{uc_activities}}.', SCENE_INTIMACY_PLACEHOLDERS),
    kta(`${P}wardrobe_template`, G, 'Clothing line', 'Clothing as established: {{uc_wardrobe}}. Nothing appears or vanishes off-page.', 'Placeholder: {{uc_wardrobe}}.', SCENE_INTIMACY_PLACEHOLDERS),
    kta(`${P}limits_template`, G, 'Limits line', 'Limits in force (they outrank any want or pacing): {{uc_limits}}', 'Placeholder: {{uc_limits}}.', SCENE_INTIMACY_PLACEHOLDERS),
    kta(`${P}limit_clash_template`, G, 'Limit clash line', '{{uc_items}} touches a hard limit: steer away the way that character would.', 'Placeholder: {{uc_items}}.', SCENE_INTIMACY_PLACEHOLDERS),
    kta(`${P}senses_template`, G, 'Resting senses line', 'Senses unused for {{uc_turns}}+ replies: {{uc_senses}}.', 'Placeholders: {{uc_senses}}, {{uc_turns}}.', SCENE_INTIMACY_PLACEHOLDERS),
    kta(`${P}dialogue_template`, G, 'Thin dialogue line', 'No one has spoken for {{uc_turns}} replies; a voice would land now.', 'Placeholder: {{uc_turns}}.', SCENE_INTIMACY_PLACEHOLDERS),
    kta(`${P}cliche_template`, G, 'Worn-out phrasing line', 'Worn out in this scene: {{uc_items}}. Find the specific detail instead.', 'Placeholder: {{uc_items}}.', SCENE_INTIMACY_PLACEHOLDERS),
    kta(`${P}act_template`, G, 'Repeated act line', 'Done a lot already: {{uc_items}}. Let it change, escalate or end, however fits who they are.', 'Placeholder: {{uc_items}}.', SCENE_INTIMACY_PLACEHOLDERS),
    kta(`${P}pace_template`, G, 'Pacing line', 'Pacing: {{uc_pace}}.', 'Placeholder: {{uc_pace}}.', SCENE_INTIMACY_PLACEHOLDERS),
    kta(`${P}carry_template`, G, 'Aftermath line', 'Carries over from earlier: {{uc_residue}}.', 'Placeholder: {{uc_residue}}.', SCENE_INTIMACY_PLACEHOLDERS),
    kt(`${P}guard_line`, G, 'Guard line', 'None of this decides what {{user}} feels, wants or does.', 'Added once whenever the tracker adds lines. Empty = none.'),
    kt(`${P}nothing_recorded`, G, 'Text when nothing is recorded yet', 'nothing recorded yet', ''),
    ki(`${P}pri_limits`, G, 'Note priority: limits', 88, 0, 100, 'Higher survives the note\'s word cap longer.'),
    ki(`${P}pri_status`, G, 'Note priority: scene line', 62, 0, 100, ''),
    ki(`${P}pri_wardrobe`, G, 'Note priority: clothing', 60, 0, 100, ''),
    ki(`${P}pri_pace`, G, 'Note priority: pacing', 58, 0, 100, ''),
    ki(`${P}pri_repeat`, G, 'Note priority: repetition lines', 56, 0, 100, ''),
    ki(`${P}pri_senses`, G, 'Note priority: senses / dialogue', 48, 0, 100, ''),
    ki(`${P}pri_specialist`, G, 'Note priority: specialist lines', 44, 0, 100, ''),
    ki(`${P}pri_carry`, G, 'Note priority: aftermath', 52, 0, 100, ''),
];

export const resolveSceneIntimacyOptions = makeResolver(P, SCENE_INTIMACY_KNOBS, (o) => {
    if (!o.phases.length) o.phases = [...DEFAULT_PHASES];
    if (!isPlainObject(o.senses)) o.senses = deepClone(DEFAULT_SENSES);
    if (!isPlainObject(o.pace_text)) o.pace_text = deepClone(DEFAULT_PACE_TEXT);
    if (!Array.isArray(o.pool)) o.pool = deepClone(DEFAULT_POOL);
    o.pool = o.pool.filter(e => isPlainObject(e) && typeof e.text === 'string' && e.text.trim()).map((e, i) => ({
        id: str(e.id, 40) || `line_${i}`,
        phases: Array.isArray(e.phases) ? e.phases.map(String) : [],
        when: Array.isArray(e.when) ? e.when.map(String) : [],
        weight: Number.isFinite(e.weight) && e.weight > 0 ? e.weight : 1,
        text: String(e.text),
    }));
    if (!o.pace_cycle.length) o.pace_cycle = ['linger', 'advance'];
    return o;
});

// Module config used by the op reducer (state.js calls it deep inside applyOps). index.js sets it from the knobs.
let CFG = resolveSceneIntimacyOptions({});
export function setSceneIntimacyConfig(values) {
    CFG = resolveSceneIntimacyOptions(values || {});
    return CFG;
}
export function sceneIntimacyConfig() {
    return CFG;
}

// ---------------------------------------------------------------------------------------------------------------------
// State

export function emptySceneIntimacyRt() {
    return { turn: -1, prev: null, cooldowns: {}, pace_last: '', pace_repeat: 0, cycle_i: 0 };
}

export function emptySceneIntimacy() {
    return {
        phase: '', phase_turn: -1, started_turn: -1, ended_turn: -1,
        activities: [], wardrobe: {}, residue: [],
        sense_last: {}, dialogue_last: -1, thought_last: -1, obs_turns: [],
        cliche_counts: {}, rt: emptySceneIntimacyRt(),
    };
}

export function normalizeSceneIntimacy(raw) {
    const s = emptySceneIntimacy();
    if (!isPlainObject(raw)) return s;
    s.phase = str(raw.phase, 40);
    for (const k of ['phase_turn', 'started_turn', 'ended_turn', 'dialogue_last', 'thought_last']) s[k] = Number.isFinite(raw[k]) ? raw[k] : -1;
    s.activities = (Array.isArray(raw.activities) ? raw.activities : []).filter(a => isPlainObject(a) && str(a.text)).map(a => ({
        text: str(a.text, 160), who: (Array.isArray(a.who) ? a.who : []).map(w => str(w, 60)).filter(Boolean).slice(0, 6),
        count: Number.isFinite(a.count) && a.count > 0 ? a.count : 1, since_turn: Number.isFinite(a.since_turn) ? a.since_turn : 0,
        turn: Number.isFinite(a.turn) ? a.turn : 0, until_turn: Number.isFinite(a.until_turn) ? a.until_turn : null,
    })).slice(-60);
    if (isPlainObject(raw.wardrobe)) {
        for (const [who, items] of Object.entries(raw.wardrobe)) {
            const w = str(who, 60);
            if (!w || !Array.isArray(items)) continue;
            s.wardrobe[w] = items.filter(i => isPlainObject(i) && str(i.item)).map(i => ({ item: str(i.item, 60), state: str(i.state, 30), turn: Number.isFinite(i.turn) ? i.turn : 0 })).slice(-12);
        }
    }
    s.residue = (Array.isArray(raw.residue) ? raw.residue : []).filter(r => isPlainObject(r) && str(r.text)).map(r => ({
        who: str(r.who, 60), kind: str(r.kind, 20) || 'other', text: str(r.text, 160),
        turn: Number.isFinite(r.turn) ? r.turn : 0, until_turn: Number.isFinite(r.until_turn) ? r.until_turn : null,
    })).slice(-60);
    s.sense_last = isPlainObject(raw.sense_last) ? Object.fromEntries(Object.entries(raw.sense_last).filter(([, v]) => Number.isFinite(v))) : {};
    s.obs_turns = (Array.isArray(raw.obs_turns) ? raw.obs_turns : []).filter(Number.isFinite).slice(-24);
    s.cliche_counts = isPlainObject(raw.cliche_counts) ? Object.fromEntries(Object.entries(raw.cliche_counts).filter(([, v]) => Number.isFinite(v) && v > 0)) : {};
    const rt = isPlainObject(raw.rt) ? raw.rt : {};
    s.rt = {
        turn: Number.isFinite(rt.turn) ? rt.turn : -1,
        prev: isPlainObject(rt.prev) ? rt.prev : null,
        cooldowns: isPlainObject(rt.cooldowns) ? Object.fromEntries(Object.entries(rt.cooldowns).filter(([, v]) => Number.isFinite(v))) : {},
        pace_last: str(rt.pace_last, 30),
        pace_repeat: Number.isFinite(rt.pace_repeat) ? rt.pace_repeat : 0,
        cycle_i: Number.isFinite(rt.cycle_i) ? rt.cycle_i : 0,
    };
    return s;
}

// ---------------------------------------------------------------------------------------------------------------------
// Op reducer: path "scene_intimacy.<field>"

function valueText(v, max = 160) {
    if (isPlainObject(v)) return str(v.text ?? v.value ?? v.item ?? '', max);
    return str(v, max);
}

function whoList(v) {
    const raw = isPlainObject(v) ? (v.who ?? v.by ?? []) : [];
    return (Array.isArray(raw) ? raw : [raw]).map(w => str(w, 60)).filter(Boolean).slice(0, 6);
}

/**
 * Apply one scene_intimacy op to the slice (mutated in place). Never throws.
 * @param {object} slice normalized slice
 * @param {{op:string, field:string, value:any, until_turn?:number}} op
 * @param {{turn:number, userName?:string, source?:string, trusted?:boolean, options?:object}} ctx
 * @returns {string} 'ok' or the rejection reason
 */
export function applySceneIntimacyOp(slice, op, ctx = {}) {
    const o = ctx.options || CFG;
    const turn = Number.isFinite(ctx.turn) ? ctx.turn : 0;
    const v = op.value;
    switch (op.field) {
        case 'phase': {
            if (op.op === 'close' || op.op === 'remove') { slice.phase = ''; slice.phase_turn = turn; return 'ok'; }
            if (op.op !== 'set') return 'phase is set';
            const p = valueText(v, 40).toLowerCase();
            if (!p || p === 'none') { slice.phase = ''; slice.phase_turn = turn; return 'ok'; }
            if (!o.phases.map(x => x.toLowerCase()).includes(p)) return `phase must be one of ${o.phases.join('|')}`;
            const wasLive = slice.phase && !o.carry_phases.includes(slice.phase);
            const carry = o.carry_phases.includes(p);
            if (!carry && !wasLive && (slice.started_turn < 0 || slice.ended_turn >= slice.started_turn)) {
                // A new scene: forget the last one's in-scene counters (aftermath residue stays until it expires).
                slice.started_turn = turn;
                slice.activities = [];
                slice.cliche_counts = {};
                slice.ended_turn = -1;
            }
            if (carry && slice.ended_turn < 0) slice.ended_turn = turn;
            slice.phase = p;
            slice.phase_turn = turn;
            return 'ok';
        }
        case 'activity': {
            const text = valueText(v, 160);
            if (op.op === 'append') {
                if (!text) return 'activity needs text';
                const who = whoList(v);
                if (slice.started_turn < 0 || slice.ended_turn >= slice.started_turn) {
                    slice.started_turn = turn;
                    slice.ended_turn = -1;
                    slice.activities = [];
                    slice.cliche_counts = {};
                }
                const hit = slice.activities.find(a => a.until_turn === null && sameThing(a.text, text, 0.75));
                if (hit) {
                    hit.count += 1;
                    hit.turn = turn;
                    for (const w of who) if (!hit.who.includes(w)) hit.who.push(w);
                } else {
                    slice.activities.push({ text, who, count: 1, since_turn: turn, turn, until_turn: null });
                }
                slice.activities = capNewest(slice.activities, o.max_activities);
                return 'ok';
            }
            if (op.op === 'close' || op.op === 'remove') {
                const idx = slice.activities.findIndex(a => sameThing(a.text, text, 0.6));
                if (idx === -1) return 'no matching activity';
                if (op.op === 'remove') slice.activities.splice(idx, 1);
                else slice.activities[idx].until_turn = turn;
                return 'ok';
            }
            return 'activities are appended / closed';
        }
        case 'wardrobe': {
            const who = str(isPlainObject(v) ? v.who : '', 60);
            if (!who) return 'wardrobe needs who';
            if (isUserName(who, ctx.userName) && !o.track_player_wardrobe) return 'player clothing tracking is off';
            if (op.op === 'close' || op.op === 'remove') {
                const key = Object.keys(slice.wardrobe).find(k => k.toLowerCase() === who.toLowerCase());
                if (!key) return 'no clothing recorded for that character';
                if (isPlainObject(v) && v.item) slice.wardrobe[key] = slice.wardrobe[key].filter(i => !sameThing(i.item, v.item, 0.8));
                else delete slice.wardrobe[key];
                return 'ok';
            }
            if (op.op !== 'append' && op.op !== 'set') return 'wardrobe takes append/set/close';
            const item = str(v.item, 60);
            const state = str(v.state, 30).toLowerCase();
            if (!item) return 'wardrobe needs item';
            if (!o.wardrobe_states.map(x => x.toLowerCase()).includes(state)) return `state must be one of ${o.wardrobe_states.join('|')}`;
            const key = Object.keys(slice.wardrobe).find(k => k.toLowerCase() === who.toLowerCase()) || who;
            const list = slice.wardrobe[key] || [];
            const hit = list.find(i => sameThing(i.item, item, 0.8));
            if (hit) { hit.state = state; hit.turn = turn; } else list.push({ item, state, turn });
            slice.wardrobe[key] = list.slice(-12);
            return 'ok';
        }
        case 'residue': {
            if (op.op === 'append') {
                const text = valueText(v, 160);
                const who = str(isPlainObject(v) ? v.who : '', 60);
                const kind = (str(isPlainObject(v) ? v.kind : '', 20) || 'other').toLowerCase();
                if (!text) return 'residue needs text';
                if (!o.residue_kinds.map(x => x.toLowerCase()).includes(kind)) return `kind must be one of ${o.residue_kinds.join('|')}`;
                if (who && isUserName(who, ctx.userName) && o.player_blocked_residue.map(x => x.toLowerCase()).includes(kind)) return 'the player\'s inner state is never recorded';
                if (!slice.residue.some(r => r.until_turn === null && sameThing(r.text, text, 0.8))) {
                    slice.residue.push({ who, kind, text, turn, until_turn: Number.isFinite(op.until_turn) ? op.until_turn : null });
                }
                slice.residue = capNewest(slice.residue, o.max_residue);
                return 'ok';
            }
            if (op.op === 'close' || op.op === 'remove') {
                const text = valueText(v, 160);
                const idx = slice.residue.findIndex(r => (r.until_turn === null || op.op === 'remove') && sameThing(r.text, text, 0.6));
                if (idx === -1) return 'no matching residue';
                if (op.op === 'remove') slice.residue.splice(idx, 1);
                else slice.residue[idx].until_turn = turn;
                return 'ok';
            }
            return 'residue is appended / closed';
        }
        case 'end': {
            if (slice.started_turn < 0 && !slice.phase) return 'no scene to end';
            slice.ended_turn = turn;
            if (!o.carry_phases.includes(slice.phase)) { slice.phase = o.carry_phases[o.carry_phases.length - 1] || 'aftermath'; slice.phase_turn = turn; }
            return 'ok';
        }
        case 'observe': {
            if (!(ctx.trusted || ctx.source === 'ports' || ctx.source === 'replay')) return 'observe is system-only';
            if (!isPlainObject(v)) return 'observation must be an object';
            for (const s of Array.isArray(v.senses) ? v.senses : []) slice.sense_last[str(s, 30)] = turn;
            if (v.dialogue) slice.dialogue_last = turn;
            if (v.thought) slice.thought_last = turn;
            if (!slice.obs_turns.includes(turn)) slice.obs_turns = capNewest([...slice.obs_turns, turn], 24);
            const seen = isPlainObject(v.cliches) ? v.cliches : {};
            const counts = { ...slice.cliche_counts };
            for (const k of Object.keys(counts)) if (!seen[k]) counts[k] = Math.max(0, counts[k] - o.cliche_decay);
            for (const [k, n] of Object.entries(seen)) if (Number.isFinite(n) && n > 0) counts[str(k, 80)] = (counts[k] || 0) + n;
            slice.cliche_counts = Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 40));
            return 'ok';
        }
        default:
            return 'unknown scene_intimacy field';
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Code-side observation of a finished reply (no LLM)

/** Senses, speech, interiority and worn-out phrasing found in a reply. */
export function observeSceneReply(reply, options) {
    const o = resolveSceneIntimacyOptions(options || {});
    const text = String(reply ?? '');
    const low = ` ${normText(text)} `;
    const senses = [];
    for (const [sense, words] of Object.entries(o.senses || {})) {
        if (!Array.isArray(words)) continue;
        const used = words.some((w) => {
            const n = normText(w);
            return !!n && (low.includes(` ${n} `) || low.includes(` ${n}s `) || low.includes(` ${n}ed `) || low.includes(` ${n}ing `));
        });
        if (used) senses.push(sense);
    }
    const cliches = {};
    for (const h of phraseHits(text, o.cliches)) cliches[h.id] = h.count;
    return {
        senses,
        dialogue: dialogueSpans(text).length >= o.dialogue_min_spans,
        thought: thoughtSpans(text).length > 0,
        cliches,
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// Derived status

/** Is a scene live (in-scene craft) or in aftermath carry, and which phase applies. */
export function sceneStatus(slice, state, { turn = 0, options } = {}) {
    const o = resolveSceneIntimacyOptions(options || {});
    const s = normalizeSceneIntimacy(slice);
    const mode = String(state?.scene?.mode || '');
    const byMode = o.active_modes.includes(mode);
    const phaseFresh = !!s.phase && turn - s.phase_turn <= o.phase_stale_turns;
    const carryPhase = !!s.phase && o.carry_phases.includes(s.phase);
    const live = !!o.enabled && (byMode || (phaseFresh && !carryPhase));
    const ended = s.ended_turn >= 0 && turn - s.ended_turn <= o.carry_turns;
    const carry = !!o.enabled && !live && (ended || (carryPhase && turn - s.phase_turn <= o.carry_turns));
    const phase = live ? s.phase : (carry ? (s.phase || o.carry_phases[o.carry_phases.length - 1] || 'aftermath') : '');
    return { live, carry, phase, byMode };
}

/** Replies observed since the last recorded new activity (lazy, so op order within a batch never matters). */
export function stasisCount(slice) {
    const s = normalizeSceneIntimacy(slice);
    const lastAct = s.activities.reduce((m, a) => Math.max(m, a.turn), s.started_turn);
    return s.obs_turns.filter(t => t > lastAct).length;
}

function limitsFor(state, names, o) {
    const out = [];
    for (const n of names) {
        const r = charRecord(state, n);
        const i = r?.c?.intimacy;
        if (!i) continue;
        const items = (i.limits || []).map(l => l.item);
        if (o.include_dislikes) for (const p of i.preferences || []) if (p.stance === 'dislikes' && !items.some(x => sameThing(x, p.item))) items.push(p.item);
        if (items.length) out.push({ name: r.key, items });
    }
    return out;
}

function restingSenses(s, turn, o) {
    if (!s.obs_turns.length) return [];
    const recentObs = s.obs_turns.filter(t => t <= turn).slice(-o.sense_window);
    if (recentObs.length < o.sense_window) return [];
    const since = recentObs[0];
    return Object.keys(o.senses || {}).filter(k => !(Number.isFinite(s.sense_last[k]) && s.sense_last[k] >= since));
}

function dialogueThinFor(s, turn, o) {
    const obs = s.obs_turns.filter(t => t <= turn);
    const after = obs.filter(t => t > s.dialogue_last);
    return after.length >= o.dialogue_gap ? after.length : 0;
}

function wardrobeText(s, o, userName) {
    const parts = [];
    for (const [who, items] of Object.entries(s.wardrobe)) {
        if (isUserName(who, userName) && !o.track_player_wardrobe) continue;
        const changed = items.filter(i => i.state !== 'on');
        const shown = (changed.length ? changed : items).map(i => `${i.item} ${i.state}`);
        if (shown.length) parts.push(`${who}: ${shown.join(', ')}`);
    }
    return parts.join('; ');
}

function residueText(s, turn, o) {
    return s.residue.filter(r => r.until_turn === null || r.until_turn > turn).slice(-o.residue_shown)
        .map(r => (r.who ? `${r.who}: ${r.text}` : r.text)).join('; ');
}

function chooseHint(rt, { phase, stasis, o, carry }) {
    if (carry || o.carry_phases.includes(phase)) return 'settle';
    if (phase === 'peak') return 'land';
    if (stasis >= o.stasis_turns) return rt.pace_last === 'shift' ? 'advance' : 'shift';
    const cycle = o.pace_cycle;
    let i = rt.cycle_i % cycle.length;
    let hint = cycle[i];
    if (hint === rt.pace_last && rt.pace_repeat + 1 >= o.pace_max_repeat) {
        for (let k = 1; k <= cycle.length; k++) {
            const h = cycle[(i + k) % cycle.length];
            if (h !== rt.pace_last) { i = (i + k) % cycle.length; hint = h; break; }
        }
    }
    rt.cycle_i = (i + 1) % cycle.length;
    return hint;
}

/**
 * Interceptor-time pass: the note lines for this turn, plus the new runtime slice.
 * @param {object} p
 * @param {object} p.state chat state (reads state.ports.scene_intimacy, characters, scene)
 * @param {number} p.turn
 * @param {() => number} [p.rng]
 * @param {object} [p.options] knob values or resolved options
 * @param {string} [p.userName]
 * @param {string} [p.charName]
 * @param {boolean} [p.intimacyEnabled]
 * @param {string} [p.type] generation type ('quiet' / 'impersonate' produce nothing)
 * @returns {{lines:{text:string,pri:number,section:string}[], director:string[], rt:object, status:object, pace:string, picked:string[]}}
 */
export function sceneIntimacyTurn({ state, turn = 0, rng = Math.random, options, userName = '', charName = '', intimacyEnabled = true, type = 'normal' } = {}) {
    const o = resolveSceneIntimacyOptions(options || {});
    const slice = normalizeSceneIntimacy(state?.ports?.scene_intimacy);
    const status = sceneStatus(slice, state, { turn, options: o });
    const none = { lines: [], director: [], rt: slice.rt, status, pace: '', picked: [] };
    if (!o.enabled || intimacyEnabled === false || type === 'quiet' || type === 'impersonate') return none;
    if (!status.live && !status.carry) return none;
    const rt = beginTurn(slice.rt, turn, emptySceneIntimacyRt);
    const lines = [];
    const add = (text, pri) => { if (text && text.trim()) lines.push({ text: text.trim(), pri, section: 'scene_intimacy' }); };
    const T = (tpl, vars) => renderTemplate(tpl, vars);
    const present = presentNpcs(state, { charName, userName });
    const limits = limitsFor(state, present, o);
    if (limits.length) add(T(o.limits_template, { uc_limits: limits.map(l => `${l.name}: ${l.items.join(', ')}`).join('; ') }), o.pri_limits);

    if (status.live) {
        const open = slice.activities.filter(a => a.until_turn === null);
        const acts = open.slice(-o.activities_shown).map(a => a.text).join(' → ') || o.nothing_recorded;
        add(T(o.status_template, { uc_phase: status.phase || 'unlabeled', uc_activities: acts }), o.pri_status);
        const clash = [];
        for (const a of open) for (const l of limits) if (l.items.some(it => sameThing(a.text, it, 0.6))) clash.push(`"${clip(a.text, 60)}" (${l.name})`);
        if (clash.length) add(T(o.limit_clash_template, { uc_items: clash.slice(0, 2).join(', ') }), o.pri_limits);
        const wt = wardrobeText(slice, o, userName);
        if (wt) add(T(o.wardrobe_template, { uc_wardrobe: wt }), o.pri_wardrobe);
        const stasis = stasisCount(slice);
        const hint = chooseHint(rt, { phase: status.phase, stasis, o, carry: false });
        rt.pace_repeat = hint === rt.pace_last ? rt.pace_repeat + 1 : 0;
        rt.pace_last = hint;
        const paceText = String(o.pace_text?.[hint] ?? hint);
        add(T(o.pace_template, { uc_pace: paceText }), o.pri_pace);
        const hot = Object.entries(slice.cliche_counts).filter(([, n]) => n >= o.cliche_threshold).slice(0, o.cliches_shown);
        if (hot.length) add(T(o.cliche_template, { uc_items: hot.map(([k]) => `"${k.replace(/^\/(.+)\/[a-z]*$/, '$1')}"`).join(', ') }), o.pri_repeat);
        const repeated = open.filter(a => a.count >= o.act_repeat).slice(-2);
        if (repeated.length) add(T(o.act_template, { uc_items: repeated.map(a => `"${clip(a.text, 60)}"`).join(', ') }), o.pri_repeat);
        const resting = restingSenses(slice, turn, o).slice(0, o.senses_shown);
        if (resting.length) add(T(o.senses_template, { uc_senses: resting.join(', '), uc_turns: o.sense_window }), o.pri_senses);
        const thin = dialogueThinFor(slice, turn, o);
        if (thin) add(T(o.dialogue_template, { uc_turns: thin }), o.pri_senses);

        // Specialist pool: phase-aware, conditions, cooldowns, per-turn cap.
        const lastWardrobeTurn = Object.values(slice.wardrobe).flat().reduce((m, i) => Math.max(m, i.turn), -Infinity);
        const cond = {
            always: true,
            early: ['approach', 'foreplay'].includes(status.phase),
            wardrobe_live: turn - lastWardrobeTurn <= o.wardrobe_live_turns,
            dialogue_thin: thin > 0,
            senses_resting: resting.length > 0,
            stasis: stasis >= o.stasis_turns,
            cliche_hot: hot.length > 0,
            multi: present.length >= 2,
            residue: slice.residue.some(r => r.until_turn === null),
        };
        const vars = { uc_senses: resting.join(' or ') || 'a different sense', uc_residue: residueText(slice, turn, o) || 'what just happened' };
        const picked = [];
        const eligible = o.pool.filter(e => (!e.phases.length || e.phases.includes(status.phase))
            && e.when.every(c => cond[c] === true)
            && !(Number.isFinite(rt.cooldowns[e.id]) && turn - rt.cooldowns[e.id] <= o.specialist_cooldown));
        let bag = eligible.map(e => ({ ...e, w: e.weight }));
        while (picked.length < o.max_specialists && bag.length) {
            const hit = weightedPick(bag, rng);
            if (!hit) break;
            bag = bag.filter(e => e.id !== hit.id);
            picked.push(hit.id);
            rt.cooldowns[hit.id] = turn;
            add(T(hit.text, vars), o.pri_specialist);
        }
        if (lines.length && o.guard_line) add(o.guard_line, o.pri_limits - 1);
        return { lines, director: lines.slice(0, 2).map(l => l.text), rt, status, pace: hint, picked };
    }

    // Aftermath carry-over.
    const residue = residueText(slice, turn, o);
    if (residue) add(T(o.carry_template, { uc_residue: residue }), o.pri_carry);
    const hint = 'settle';
    rt.pace_repeat = hint === rt.pace_last ? rt.pace_repeat + 1 : 0;
    rt.pace_last = hint;
    if (lines.length && o.guard_line) add(o.guard_line, o.pri_carry - 1);
    return { lines, director: lines.map(l => l.text).slice(0, 2), rt, status, pace: hint, picked: [] };
}

// ---------------------------------------------------------------------------------------------------------------------
// Rules-engine integration

/** Chat variables for rule packs (merge into evaluateRules({vars})): works with the existing `variable` trigger. */
export function sceneIntimacyVars(state, { turn = 0, options } = {}) {
    const st = sceneStatus(state?.ports?.scene_intimacy, state, { turn, options });
    return {
        uc_intimacy_phase: st.live || st.carry ? (st.phase || 'unlabeled') : 'none',
        uc_intimacy_live: st.live ? 'yes' : 'no',
        uc_intimacy_after: st.carry ? 'yes' : 'no',
    };
}

/**
 * Trigger extension for rules.js: {type:"intimacy_phase", phases:[...], live?:true|false}.
 * phases: list of phase labels; "live" / "after" / "none" are also accepted. Matches when the current phase is listed.
 */
export const INTIMACY_PHASE_TRIGGER = Object.freeze({
    type: 'intimacy_phase',
    normalize(raw) {
        const list = Array.isArray(raw?.phases) ? raw.phases : (typeof raw?.phases === 'string' && raw.phases ? [raw.phases] : []);
        return { type: 'intimacy_phase', phases: list.map(x => String(x).trim().toLowerCase()).filter(Boolean).slice(0, 20) };
    },
    validate(t, path, errors) {
        if (!Array.isArray(t?.phases) || !t.phases.length) errors.push(`${path}.phases needs at least one phase (or "live", "after", "none").`);
    },
    /** env: the rules env; needs env.state (chat state) or env.vars.uc_intimacy_phase / uc_intimacy_live / uc_intimacy_after. */
    test(t, env = {}) {
        const vars = env.state ? sceneIntimacyVars(env.state, { turn: env.turn ?? 0, options: env.sceneIntimacyOptions }) : (env.vars || {});
        const phase = String(vars.uc_intimacy_phase || 'none').toLowerCase();
        const list = t.phases || [];
        if (list.includes(phase)) return true;
        if (list.includes('live') && vars.uc_intimacy_live === 'yes') return true;
        if (list.includes('after') && vars.uc_intimacy_after === 'yes') return true;
        return false;
    },
});

/** Scribe path guide lines (appended to {{uc_paths}} when the tracker and the intimacy engine are on). */
export function sceneIntimacyPathGuide(options) {
    const o = resolveSceneIntimacyOptions(options || {});
    return [
        `scene_intimacy.phase — set ${o.phases.join('|')} (descriptive only; "none" when no intimate scene)`,
        'scene_intimacy.activity — append {"text":"what is happening, a few words","who":["Name",…]} | close "text" when it stopped',
        `scene_intimacy.wardrobe — append {"who":"Name","item":"garment","state":"${o.wardrobe_states.join('|')}"} | close {"who":"Name"} when they are dressed again`,
        `scene_intimacy.residue — append {"who":"Name","kind":"${o.residue_kinds.join('|')}","text":"what carries over"} | close "text"; never the player's feelings`,
        'scene_intimacy.end — set true when the intimate scene is over',
    ];
}
