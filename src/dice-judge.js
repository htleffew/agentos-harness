// The dice judge (DESIGN 6.9, memory DESIGN 7.7). Before each reply one judgment call reads her message, the last reply
// and the scene, and returns every attempt whose outcome is uncertain: hers or an NPC's, each with the actor, the attempt,
// the stat, a difficulty step and the stance of whoever resists. Code screens the turn first and skips the call on a turn
// with no action by anyone. The call runs through MB8's routes (src/memory/decide.js: the desktop, the phone, Jev, code), so
// it counts toward the background spend ceiling there. Code then rolls (src/dice.js) and sends the verdicts with the reply.
import { ctx, on, isChatOpen, LOG, KEY, names, readComposer } from './st.js';
import { judge, DICE, STEPS, STANCES, screenTurn, actorFromText } from './memory/decide.js';
import {
    diceOn, rollAttempt, verdictText, publishVerdict, storeRolls, diceOf, queuedRoll, clearQueuedRoll, actorOf, setDiceFeatureReader, statNames,
} from './dice.js';
import { ensurePlainSheet, inferChatSheets, inferNpcSheet } from './stat-sheets.js';

/** The words the Sent card and Setup, Connections, Spend use for an extension-added call (DESIGN 1.8). */
export const JUDGE_CALL_WORDS = '1 model call · extra request';
export const JUDGE_LABEL = 'Dice judgment';

const clip = (text, n) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const lastOf = (chat, test) => { for (let i = chat.length - 1; i >= 0; i--) if (test(chat[i])) return chat[i]; return null; };

/** The answer: every uncertain attempt of this turn. An empty list means no roll. */
export function judgeSchema(stats = statNames()) {
    return {
        name: 'dice_attempts', strict: true,
        value: {
            type: 'object', required: ['attempts'], additionalProperties: false,
            properties: { attempts: { type: 'array', items: {
                type: 'object', required: ['actor', 'attempt', 'stat', 'difficulty', 'stance'], additionalProperties: false,
                properties: {
                    actor: { type: 'string' }, attempt: { type: 'string' }, stat: { type: 'string', enum: [...stats] },
                    difficulty: { type: 'string', enum: STEPS.map(([name]) => name) }, stance: { type: 'string', enum: [...STANCES] },
                },
            } } },
        },
    };
}

export const JUDGE_SYSTEM = 'You set up dice for one turn of a roleplay. An attempt is an action whose outcome is uncertain and matters: '
    + 'a fight, a climb, a lie, a search, a chase. Talk, plans, feelings and easy actions are not attempts. '
    + 'List each attempt the player makes in the player message, and each attempt an NPC is making right now in the scene '
    + '(started in the last reply and still unresolved). For each, give the actor ("user" for the player, else the NPC by name), '
    + 'the attempt as a short verb phrase such as "persuade the lord", the stat it rests on, its difficulty step and the stance '
    + 'of whoever resists it: helping, neutral or resisting. With no attempt, give an empty list. Answer with JSON and nothing else.';

/** The judge's request text. input: { message, lastReply, scene, npcNames }. */
export function judgeUser({ message = '', lastReply = '', scene = '', npcNames = [] } = {}) {
    return [
        `Stats: ${statNames().join(', ')}.`,
        scene ? `Scene: ${clip(scene, 300)}` : '',
        npcNames.length ? `NPCs in the scene: ${npcNames.join(', ')}.` : '',
        lastReply ? `Last reply: ${clip(lastReply, 1200)}` : '',
        `Player message: ${clip(message, 1500) || '(none)'}`,
    ].filter(Boolean).join('\n');
}

const statOf = value => statNames().find(s => s.toLowerCase() === String(value || '').toLowerCase()) || '';
const stepOf = value => STEPS.find(([name]) => name.toLowerCase() === String(value || '').toLowerCase())?.[0] || '';

/** One attempt as code keeps it, or null when a part is missing or out of range. */
export function readAttempt(item) {
    const stat = statOf(item?.stat), difficulty = stepOf(item?.difficulty);
    const stance = STANCES.find(s => s === String(item?.stance || '').toLowerCase());
    const attempt = clip(item?.attempt, 160);
    if (!stat || !difficulty || !stance || !attempt) return null;
    return { actor: clip(item?.actor, 80) || 'user', attempt, stat, difficulty, stance };
}

// The single-attempt answers of the phone, Jev's typed questions and code's default become a list of one or none.
const single = (value, input) => value?.attempt ? [{ actor: value.actor || 'user', attempt: clip(input.message, 120) || 'act', stat: statOf(value.stat) || statNames()[0] || 'Wits',
    difficulty: value.difficulty || 'Fair', stance: value.stance || 'neutral' }] : [];

/** Code's screen: her message as MB8 screens it, and an NPC whose move in the last reply is still under way keeps the call. */
export function screenDiceTurn(input) {
    const screen = screenTurn(input.message, { threads: input.threads || [] });
    if (!screen.skip) return screen;
    const npc = input.lastReply ? screenTurn(input.lastReply) : null;
    if (npc?.attemptWords && (input.npcNames || []).some(name => new RegExp(`\\b${String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(input.lastReply))) {
        return { ...screen, skip: false, reason: '', openNpcMove: true };
    }
    return screen;
}

/** The definition decide.js runs: the same routes and fallbacks as MB8's dice judgment, with a list of attempts. */
export const DICE_TURN = Object.freeze({
    name: 'dice',
    get schema() { return judgeSchema(); },
    system: JUDGE_SYSTEM,
    user: judgeUser,
    screen: screenDiceTurn,
    phone: DICE.phone,
    fromPhone: (answers, input, screen) => ({ attempts: single(DICE.fromPhone(answers, input, screen), input) }),
    codeDefault: (input, screen) => ({ attempts: single(DICE.codeDefault(input, screen), input) }),
    decision: { ...DICE.decision, fromAnswers: (answers, input, screen) => ({ attempts: single(DICE.decision.fromAnswers(answers, input, screen), input) }) },
    normalize(value) {
        if (!Array.isArray(value?.attempts)) return null;
        return { attempts: value.attempts.map(readAttempt).filter(Boolean).slice(0, 4) };
    },
});

/**
 * Judge and roll one turn. input as judgeUser takes; queued is the die button's named roll, which replaces what detection
 * sets for that actor. Returns { rolls, receipt }. deps reach decide.js (tests pass routes of their own).
 */
export async function judgeTurn(input, { queued = null, deps, random, judgeFn = judge } = {}) {
    const started = Date.now();
    const result = await judgeFn(DICE_TURN, input, deps);
    let attempts = (result?.value?.attempts || []).map(a => ({ ...a, actor: actorOf(a.actor) }));
    if (queued) {
        const actor = actorOf(queued.actor);
        // The named roll replaces what detection set for this actor's attempt; a part it leaves open comes from detection.
        const detected = attempts.find(a => a.actor === actor);
        attempts = attempts.filter(a => a.actor !== actor);
        attempts.unshift({ actor, attempt: queued.attempt || detected?.attempt || clip(input.message, 120) || 'act',
            stat: queued.stat || detected?.stat || statNames()[0], difficulty: queued.step || 'Fair', stance: queued.stance || 'neutral', dc: queued.dc, source: 'die button' });
    }
    const route = result?.skipped ? 'code' : result?.route || 'code';
    const rolls = attempts.map(a => {
        if (a.actor !== 'user' && a.actor !== 'char') ensurePlainSheet(a.actor, a.actor, 'play');
        return rollAttempt({ actor: a.actor, attempt: a.attempt, stat: a.stat, step: a.difficulty, stance: a.stance, dc: a.dc,
            source: a.source || 'detected', route: a.source === 'die button' ? 'die button' : route, model: result?.model || '' }, { random });
    });
    const receipt = {
        label: JUDGE_LABEL, words: JUDGE_CALL_WORDS, at: started, ms: result?.ms ?? Date.now() - started,
        skipped: !!result?.skipped, reason: result?.reason || '', route, model: result?.model || '',
        tried: (result?.attempts || []).map(a => ({ route: a.route, outcome: a.outcome, ...(a.ms != null ? { ms: a.ms } : {}), ...(a.reason ? { reason: String(a.reason).slice(0, 120) } : {}) })),
        found: attempts.length, ...(queued ? { queued: true } : {}),
    };
    return { rolls, receipt };
}

// ---------------------------------------------------------------- wiring to SillyTavern

let wired = false;
let turn = null;
// The routes the judgment call uses before a reply: decide.js's own, unless a test hands in fakes.
let judgeDeps;
export const setJudgeDeps = deps => { judgeDeps = deps || undefined; };

/** The NPC names the judge is told about: who the scene says is present, apart from the persona and the character. */
async function sceneInput(type) {
    const chat = ctx().chat || [];
    // SillyTavern adds her new message to the chat after this event, so it is still in the message box; with the box
    // empty, her message is the chat's last one when it ends the chat, and none when a reply ends it.
    let typed = '';
    try { typed = String(readComposer()?.text || '').trim(); } catch { /* no message box on this host */ }
    const message = typed || (chat.at(-1)?.is_user ? String(chat.at(-1).mes || '') : '');
    const lastReply = String(lastOf(chat, m => m && !m.is_user && !m.is_system)?.mes || '');
    let scene = '', npcNames = [];
    try {
        const { readScene } = await import('./world.js');
        const read = readScene(type);
        scene = [read.location, read.present].filter(Boolean).join('; ');
        const skip = new Set([names().user, names().char].map(n => String(n).toLowerCase()));
        npcNames = String(read.present || '').split(/\s*[,;]\s*/).map(n => n.trim()).filter(n => n && !skip.has(n.toLowerCase())).slice(0, 8);
    } catch { /* no scene on this host */ }
    return { message, lastReply, scene, npcNames };
}

/** The rolls a continue keeps: those of the swipe it continues, and no other swipe's. */
function priorDice(message) {
    if (!message || message.is_user) return null;
    const own = diceOf(message);
    return own?.rolls?.length ? own : null;
}

/** A swipe judges the user message the swiped reply answered, with the reply before it as the last reply. */
function swipeInput(input, chat) {
    let u = chat.length - 2;
    while (u >= 0 && !chat[u]?.is_user) u--;
    if (u < 0) return input;
    let lastReply = '';
    for (let i = u - 1; i >= 0; i--) if (chat[i] && !chat[i].is_user && !chat[i].is_system) { lastReply = String(chat[i].mes || ''); break; }
    return { ...input, message: String(chat[u].mes || ''), lastReply };
}

/** Before the reply request is built: judge, roll and put the verdict in. Awaited by SillyTavern. */
export async function beforeReply(type, opts, dryRun) {
    if (dryRun) return;
    const quiet = type === 'quiet' || !!opts?.quiet_prompt || type === 'impersonate';
    if (quiet || !isChatOpen() || !diceOn()) { turn = null; publishVerdict(''); return; }
    const chat = ctx().chat || [];
    const chatId = String(ctx().getCurrentChatId?.() || '');
    try {
        if (type === 'continue') {
            // A continue keeps the continued swipe's roll: no judgment call and no new roll.
            const prior = priorDice(chat.at(-1));
            turn = prior ? { type, chatId, rolls: prior.rolls.map(r => ({ ...r })), receipt: prior.judge ? { ...prior.judge, copied: true } : null } : { type, chatId, rolls: [], receipt: null };
        } else {
            // A new reply and a swipe both judge and roll; a swipe stores its roll on that swipe only.
            let input = await sceneInput(type);
            if (type === 'swipe') input = swipeInput(input, chat);
            const queued = queuedRoll();
            const { rolls, receipt } = await judgeTurn(input, { queued, deps: judgeDeps });
            if (queued) clearQueuedRoll();
            turn = { type, chatId, rolls, receipt };
            for (const roll of rolls) if (roll.actor !== 'user' && roll.actor !== 'char') inferNpcSheet(roll.actor, { storyText: [input.lastReply, input.message].join('\n') }).catch(error => console.warn(LOG, 'NPC stat sheet', error));
        }
        publishVerdict(verdictText(turn.rolls));
    } catch (error) {
        console.warn(LOG, 'dice judgment', error);
        turn = null;
        publishVerdict('');
    }
}

/** The reply arrived: store its rolls with its swipe. */
export function afterReply(id) {
    const message = ctx().chat?.[Number(id)];
    if (!turn || !message || message.is_user) return;
    if (turn.chatId !== String(ctx().getCurrentChatId?.() || '')) return;
    storeRolls(message, turn.rolls, turn.receipt);
}

/** The rolls waiting for the reply now being written (tests and the status slot read it). */
export const pendingTurn = () => turn;

/** Wire the dice to the host once. Called from the extension's entry file. */
export async function startDice() {
    if (wired) return;
    wired = true;
    try {
        const v10 = await import('./v10.js');
        setDiceFeatureReader(() => !v10.enabledV10() || v10.effectiveModules().dice !== false);
    } catch (error) { console.warn(LOG, 'dice feature switch', error); }
    // MB14: stat sheets become Stat sheet records in the memory log.
    try { await (await import('./memory/stat-sheet-store.js')).installSheetStore(); } catch (error) { console.warn(LOG, 'stat sheet records', error); }
    on('GENERATION_AFTER_COMMANDS', beforeReply);
    on('MESSAGE_RECEIVED', afterReply);
    for (const name of ['GENERATION_ENDED', 'GENERATION_STOPPED']) on(name, () => { publishVerdict(''); });
    const sheetsAtStart = () => {
        publishVerdict('');
        turn = null;
        if (isChatOpen() && diceOn()) inferChatSheets().catch(error => console.warn(LOG, 'stat sheets', error));
    };
    on('CHAT_CHANGED', sheetsAtStart);
    on('CHAT_CREATED', sheetsAtStart);
}
