// Choices (DESIGN 6.2 and 4.4, from Deus Choices List and Pura's CYOA Choices): numbered moves for the player's next
// message, each with an optional skill tag and Copy, Insert and Send (decision 34). The moves come from one Options call
// after each reply, made only while this card is not Off (decision 41). It is an extension-added call: it runs on the
// background route chain (src/routing.js, the capture chain), so a paid route counts toward the monthly spend ceiling,
// and it shows in the Sent card with the words "1 model call · extra request" (DESIGN 1.8).
//
// Paths considered (AGENTS.md): the reply request cannot carry the moves without asking the story model to write
// outside the story, and capture reads the past rather than proposing a next move, so the card needs its own call.
// The moves are saved on the reply's record (rec.choices) and on its swipe slot, so each swipe keeps its own moves.
import { h } from '../dom.js';
import { chipList, rows, row } from '../card-templates.js';
import { fieldOn } from '../../cards/catalog.js';
import { ctx, isGenerating, isReply, KEY, LOG, on, readComposer, writeComposer } from '../../st.js';
import { actionButton, cardButton, copyText, icon, replyNumberAt } from './shared.js';

export const id = 'choices';
export const CHOICE_COUNT = 4;
export const CALL_WORDS = '1 model call · extra request';
const HISTORY_MESSAGES = 8;
const HISTORY_CHARS = 6000;
const MESSAGE_CHARS = 1500;

// ---------- the request (pure) ----------

/** A short stable hash of a reply's text, so a reply's moves are made once and a changed reply gets new ones. */
export function textHash(text) {
    let value = 5381;
    for (const char of String(text ?? '')) value = ((value * 33) ^ char.codePointAt(0)) >>> 0;
    return value.toString(36);
}

const clip = (text, max) => { const value = String(text ?? '').replace(/\s+\n/g, '\n').trim(); return value.length > max ? `${value.slice(0, max).replace(/\s+\S*$/, '')} ...` : value; };

/** The Options request for the reply at `index`: { system, user }. */
export function choicesRequest({ chat, index, player = 'the player', count = CHOICE_COUNT }) {
    const lines = [];
    let room = HISTORY_CHARS;
    for (let at = index; at >= 0 && lines.length < HISTORY_MESSAGES; at--) {
        const message = chat[at];
        if (!message || (message.is_system && !isReply(message))) continue;
        const line = `${message.is_user ? player : message.name || 'Narrator'}: ${clip(message.mes, MESSAGE_CHARS)}`;
        if (line.length > room) break;
        room -= line.length;
        lines.unshift(line);
    }
    const system = [
        `You suggest ${player}'s next move in a roleplay story. Each move is something ${player} could say or do next, written as ${player}'s own message in first person, in the story's voice and grounded in what just happened.`,
        'Make the moves differ in direction: one presses forward, one turns to another person or place, one asks or probes, and one takes a risk.',
        'A move that tests a skill names that skill, such as Persuasion, Stealth or Athletics.',
        `Return a JSON array of exactly ${count} distinct objects. Give each object a "title" that names the move in two to six words, a "text" that holds the move as ${player}'s next message, and a "skill" that names the skill the move tests, or "" when it tests none.`,
    ].join('\n');
    return { system, user: `The story so far, newest last:\n${lines.join('\n\n')}\n\nWrite the moves for ${player}'s next message.` };
}

/** The moves in an answer: [{ title, text, skill }], at most `count`. Strings count as moves without a title. */
export function parseChoices(raw, count = CHOICE_COUNT) {
    const text = String(raw ?? '');
    const start = text.indexOf('['), stop = text.lastIndexOf(']');
    if (start < 0 || stop <= start) return [];
    let list;
    try { list = JSON.parse(text.slice(start, stop + 1)); } catch { return []; }
    if (!Array.isArray(list)) return [];
    return list.map((item, index) => {
        if (typeof item === 'string') return { title: `Move ${index + 1}`, text: item.trim(), skill: '' };
        if (!item || typeof item !== 'object') return null;
        const body = String(item.text ?? item.move ?? '').trim();
        return body ? { title: String(item.title ?? '').trim() || `Move ${index + 1}`, text: body, skill: String(item.skill ?? '').trim() } : null;
    }).filter(Boolean).slice(0, count);
}

/** Whether the Choices card asks for moves under this card setting: the card is not Off and its Moves are on. */
export const choicesOn = config => fieldOn(config, 'choices', 'moves');

// ---------- the call ----------

const running = new Map();
const runKey = (chatId, index, hash) => `${chatId}:${index}:${hash}`;

function chatId() { try { return String(ctx().getCurrentChatId?.() || ''); } catch { return ''; } }

async function redrawTrays() {
    if (!globalThis.document?.querySelector?.('#chat')) return;
    try {
        for (const tray of document.querySelectorAll('.ri-tray')) tray.dataset.stamp = '';
        (await import('../sent.js')).refreshUnderReplies();
    } catch (error) { console.warn(LOG, 'choices redraw', error); }
}

/** Save the moves on the reply's record and on its showing swipe's slot. */
function save(message, result) {
    const rec = message?.extra?.[KEY];
    if (!rec) return false;
    rec.choices = result;
    const slot = message.swipe_info?.[Number.isInteger(message.swipe_id) ? message.swipe_id : 0]?.extra?.[KEY];
    if (slot && slot !== rec) slot.choices = structuredClone(result);
    return true;
}

/**
 * Run one Options call for the reply at `index` and save its moves. `force` runs even when the reply already has moves
 * (Try again). `run` stands in for the route chain in tests.
 */
export async function runChoices(index, { force = false, run } = {}) {
    const host = ctx();
    const chat = host.chat || [];
    const message = chat[index];
    if (!isReply(message) || !message.extra?.[KEY]) return null;
    const hash = textHash(message.mes);
    if (!force && message.extra[KEY].choices?.hash === hash && message.extra[KEY].choices.outcome !== 'failed') return message.extra[KEY].choices;
    const owner = chatId();
    const key = runKey(owner, index, hash);
    if (running.has(key)) return running.get(key);
    const work = (async () => {
        const reply = replyNumberAt(index, chat);
        const { system, user } = choicesRequest({ chat, index, player: host.name1 || 'the player' });
        let res;
        if (run) res = await run({ system, user });
        else {
            const { chainFor, runChain } = await import('../../routing.js');
            res = await runChain(chainFor('choices'), { job: 'choices', label: `Choices, reply ${reply}`, system, user, tokens: 700, background: true });
        }
        const items = res?.ok ? parseChoices(res.text ?? res.value) : [];
        const result = { hash, reply, items, route: res?.route || '', model: res?.model || '', attempts: res?.attempts?.length || 0, at: Date.now(),
            outcome: items.length ? 'completed' : res?.waiting ? 'waiting' : 'failed',
            reason: items.length ? '' : res?.ok ? 'The answer held no usable moves.' : res?.reason || 'No route answered.' };
        // The chat or the reply may have changed while the call ran; the moves belong only to the reply they read.
        if (chatId() !== owner || ctx().chat?.[index] !== message || textHash(message.mes) !== hash) return null;
        if (save(message, result)) await ctx().saveChat?.();
        return result;
    })();
    running.set(key, work);
    redrawTrays();
    try { return await work; } finally { running.delete(key); redrawTrays(); }
}

const isRunning = index => [...running.keys()].some(key => key.startsWith(`${chatId()}:${index}:`));

let started = false;
let readConfig = null;
/**
 * Listen for new replies; while the Choices card is not Off, each new reply gets one Options call. Called when the cards
 * register and again on each draw, so a host that was not ready at load still gets the listener.
 */
export function startChoices({ config } = {}) {
    if (config) readConfig = config;
    if (started || !readConfig || !globalThis.SillyTavern?.getContext) return;
    const configNow = readConfig;
    started = on('MESSAGE_RECEIVED', () => {
        let tries = 0;
        const attempt = async () => {
            try {
                const { settings } = await import('../../store.js');
                if (settings().enabled === false || !choicesOn(configNow())) return;
                if (isGenerating() && tries++ < 40) { setTimeout(attempt, 500); return; }
                const chat = ctx().chat || [];
                const index = chat.findLastIndex(isReply);
                if (index < 1) return;
                if (!chat[index].extra?.[KEY] && tries++ < 40) { setTimeout(attempt, 500); return; }
                await runChoices(index);
            } catch (error) { console.warn(LOG, 'choices', error); }
        };
        setTimeout(attempt, 800);
    });
}

// ---------- the card ----------

function insertText(text) {
    const current = readComposer();
    if (!current) return false;
    const start = current.start ?? current.text.length, end = current.end ?? start;
    return writeComposer({ text: current.text.slice(0, start) + text + current.text.slice(end), start: start + text.length, end: start + text.length });
}

export function costLine(extra = '') {
    return h('p', { class: 'ri-c-cost', 'data-call': 'extra' }, icon('fa-microchip'), h('span', {}, [CALL_WORDS, extra].filter(Boolean).join(' · ')));
}

function choiceItem(item, index) {
    const label = `move ${index + 1}, ${item.title}`;
    return h('li', { class: 'ri-c-choice', 'aria-label': item.title },
        h('div', { class: 'ri-c-choice-head' }, h('span', { class: 'ri-c-choice-n', 'aria-hidden': 'true' }, `${index + 1}`), h('strong', {}, item.title),
            item.skill ? chipList([{ text: item.skill, tone: 'indigo', title: 'Skill this move tests' }]) : null),
        h('p', { class: 'ri-c-text' }, item.text),
        h('div', { class: 'ri-c-actions' },
            actionButton('Copy', 'fa-copy', async () => ((await copyText(item.text)) ? 'Copied' : 'Copy failed'), { aria: `Copy ${label}` }),
            actionButton('Insert', 'fa-arrow-turn-down', () => (insertText(item.text) ? 'Inserted' : 'No message box'), { aria: `Insert ${label}` }),
            actionButton('Send', 'fa-paper-plane', async () => ((await (await import('../results-sheet.js')).sendOption(item.text)) ? '' : 'Wait for the reply'), { aria: `Send ${label}` })));
}

export function render(env, { footer }) {
    startChoices();
    if (!env.on('moves')) return null;
    const saved = env.view.rec?.choices;
    const busy = isRunning(env.id);
    if (!saved && !busy) return null;
    const items = Array.isArray(saved?.items) ? saved.items : [];
    if (busy && !items.length) return { first: 'Writing choices', body: () => [h('p', { class: 'ri-tray-help', role: 'status' }, 'Writing choices for your next message.'), costLine(), footer(env)] };
    if (!items.length) {
        const again = cardButton('Try again', 'fa-microchip', () => runChoices(env.id, { force: true }), { aria: `Try again, ${CALL_WORDS.replace(' · ', ', ')}`, extraClass: 'ri-cost-chip' });
        return { first: saved.outcome === 'waiting' ? 'Choices wait for a free or local route' : 'Choices failed',
            body: () => [h('p', { class: 'ri-tray-help', role: 'status' }, saved.reason || 'No moves came back.'), again, costLine(), footer(env)] };
    }
    return { first: items.map((item, index) => `${index + 1}. ${item.title}`).join(' '), body: () => [
        h('ol', { class: 'ri-c-choices' }, items.map(choiceItem)), costLine(), footer(env)] };
}

/** What the Sent card adds for this reply's Options call: its mark and its receipt, in the extension-added call words. */
export function sentReceipt(rec, routeLabel = route => route) {
    const saved = rec?.choices;
    if (!saved?.outcome) return null;
    return { call: 'Choices', nodes: () => [h('section', { class: 'ri-c-section ri-c-sent-choices' },
        h('h4', { class: 'ri-c-head' }, icon('fa-list-ol'), h('span', {}, 'Choices')),
        costLine(),
        rows([row('Route', [routeLabel(saved.route), saved.model].filter(Boolean).join(', ')), row('Attempts', saved.attempts ? String(saved.attempts) : ''),
            row('Outcome', { completed: `${saved.items?.length || 0} moves`, waiting: 'Waiting for a free or local route', failed: 'Failed' }[saved.outcome] || saved.outcome),
            row('Trigger', 'After each reply while the Choices card is on'), row('Result', saved.reason)]))] };
}
