// V1: read a reply aloud. Each quoted line is rendered on the desktop in its speaker's cloned voice, one line per call,
// and played as soon as it lands while the rest render. Playback runs on one AudioContext that the tap resumes, which
// is what an Android WebView needs. A reading is cached per reply and swipe in memory, so a replay costs nothing; a
// swipe, an edit, a deletion or a chat change drops the cached lines. Every reading leaves a receipt in the request
// log that names each line's voice, seed and check, how long a line waited for the desktop, and the names to judge by ear.
import { ctx, toast } from '../st.js';
import { addLog, updateLog } from '../log.js';
import { replyLines, seedFor } from './text.js';
import { RATE, prepareLine } from './audio.js';
import { ensureReach, forgetReach, speak, voiceSettings } from './client.js';

const cache = new Map();
const listeners = new Set();
let audio = null;
let current = null;

/** The people who can speak in this chat: the characters, then her persona. main speaks an unattributed quote. */
export function castFor(message, host = ctx()) {
    const members = [];
    const character = c => c && c.name && members.push({ name: c.name, key: `char:${c.avatar || c.name}`, kind: 'character' });
    if (host.groupId) {
        const group = (host.groups || []).find(item => String(item.id) === String(host.groupId));
        for (const avatar of group?.members || []) character((host.characters || []).find(c => c.avatar === avatar));
    } else if (host.characterId !== undefined && host.characterId !== null) character(host.characters?.[host.characterId]);
    if (host.name1) members.push({ name: host.name1, key: `persona:${host.name1}`, kind: 'persona' });
    const main = members.find(member => member.kind === 'character' && member.name === message?.name)
        || members.find(member => member.kind === 'character') || members[0] || null;
    return { cast: members, main };
}

/** The voice a cast member speaks in: their own clip, else the main character's, else the server's built-in voice. */
export function voiceFor(member, main, voices = voiceSettings().voices) {
    const own = member && voices[member.key];
    if (own?.id) return { id: own.id, knobs: own.knobs || {}, borrowed: '' };
    const lead = main && voices[main.key];
    if (lead?.id) return { id: lead.id, knobs: lead.knobs || {}, borrowed: main.name };
    return { id: 'default', knobs: {}, borrowed: 'the built-in voice' };
}

/** The lines of a reply with their voices and seeds, ready to render. */
export function planReading(message, host = ctx()) {
    const { cast, main } = castFor(message, host);
    const lines = replyLines(message?.mes || '', { cast, main });
    return lines.map(line => {
        const voice = voiceFor(line.speaker, main);
        return { ...line, voice: voice.id, knobs: voice.knobs, borrowed: voice.borrowed, seed: seedFor(line.text, voice.id) };
    });
}

const chatId = host => String(host.getCurrentChatId?.() || host.chatId || '');
/** A reading is cached under its chat, reply, swipe and text. */
export const cacheKey = (host, mesId, message) => `${chatId(host)}|${mesId}|${message?.swipe_id ?? 0}|${seedFor(message?.mes || '')}`;

/** Drop the cached lines of one reply, or of every reply. */
export function dropReply(mesId) {
    for (const key of [...cache.keys()]) if (mesId === undefined || key.split('|')[1] === String(mesId)) cache.delete(key);
    if (current && (mesId === undefined || current.mesId === Number(mesId))) stopReading();
}

export const cachedReplies = () => [...cache.keys()];

/** Hear each change of state: { mesId, status: 'rendering'|'playing'|'done'|'stopped'|'failed', reason }. */
export function onVoiceState(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

function tell(state) {
    if (current) Object.assign(current.state, state);
    for (const fn of listeners) { try { fn({ ...state }); } catch { /* a listener must not stop playback */ } }
}

/** What is reading now, for the message button and the tests. */
export function voiceState() {
    return current ? { mesId: current.mesId, ...current.state, lines: current.lines.map(line => ({ ...line, samples: undefined })) } : null;
}

/** The shared audio context, created and resumed inside the tap so a WebView lets it play. */
export function audioContext() {
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) return null;
    if (!audio || audio.state === 'closed') {
        try { audio = new Ctx({ sampleRate: RATE }); } catch { audio = new Ctx(); }
    }
    audio.resume?.().catch(() => {});
    return audio;
}

/** Stop the reading in progress, keeping what was already rendered for a replay. */
export function stopReading() {
    if (!current) return;
    const was = current;
    current = null;
    was.stopped = true;
    was.controller.abort(new Error('Stopped.'));
    for (const source of was.sources) { try { source.stop(); } catch { /* already ended */ } }
    for (const fn of listeners) { try { fn({ mesId: was.mesId, status: 'stopped', reason: '' }); } catch { /* ignore */ } }
}

function schedule(reading, samples, pause) {
    const context = reading.context;
    if (!context) return 0;
    const buffer = context.createBuffer(1, samples.length, RATE);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const start = Math.max(reading.at, context.currentTime + 0.03);
    source.start(start);
    reading.sources.push(source);
    reading.at = start + buffer.duration + pause;
    return start;
}

const lineReceipt = (line, n, of) => {
    const parts = [`Line ${n} of ${of}: ${line.speaker?.name || 'unattributed'} (${line.how})`,
        line.borrowed ? `in ${line.borrowed === 'the built-in voice' ? line.borrowed : `${line.borrowed}'s voice`}, no clip of their own` : `voice ${line.voice}`,
        `seed ${line.info?.seed ?? line.seed}`];
    if (line.info) {
        parts.push(`check ${line.info.check}`);
        if (line.info.renders > 1) parts.push(`rendered ${line.info.renders} times`);
        if (line.info.waited >= 0.5) parts.push(`waited ${line.info.waited.toFixed(1)} s for ${line.info.waitedFor || 'the desktop'}`);
        parts.push(`${line.info.elapsed.toFixed(1)} s to render`);
    } else parts.push('from the cache, no call');
    return `${parts.join(', ')}: "${line.text}"`;
};

/**
 * Read a reply aloud, or stop it when it is the one reading. Returns the reading's end state. host and fetcher are test
 * hooks; a tap passes nothing.
 */
export async function readReply(mesId, { host = ctx(), fetcher } = {}) {
    const id = Number(mesId);
    if (current?.mesId === id) { stopReading(); return { status: 'stopped' }; }
    stopReading();
    const message = host.chat?.[id];
    const lines = planReading(message, host);
    if (!lines.length) {
        toast('info', 'This reply has no spoken dialogue in double quotes, so there is nothing to read. Narration and thoughts are not read.');
        return { status: 'empty' };
    }
    const key = cacheKey(host, id, message);
    const cached = cache.get(key);
    const context = audioContext();
    const reading = current = { mesId: id, controller: new AbortController(), sources: [], context, at: context ? context.currentTime + 0.05 : 0,
        lines: lines.map(line => ({ ...line })), state: { mesId: id, status: 'rendering', reason: '', started: Date.now() } };
    tell({ mesId: id, status: 'rendering', reason: '' });
    const log = addLog({ what: 'Read aloud', details: [`Reply ${id}: ${lines.length} spoken line${lines.length === 1 ? '' : 's'} on the desktop voice${cached ? ', replayed from the cache' : ''}.`] });
    const finish = (status, reason = '', detail = '') => {
        if (current === reading) { tell({ mesId: id, status, reason }); if (status !== 'playing') current = null; }
        const heard = [...new Set(reading.lines.flatMap(line => String(line.info?.names || '').split(',').map(name => name.trim()).filter(Boolean)))];
        const details = reading.lines.filter(line => line.info || line.cached).map((line, index) => lineReceipt(line, index + 1, reading.lines.length));
        if (heard.length) details.push(`Names to judge by ear: ${heard.join(', ')}.`);
        if (reason) details.push(detail ? `${reason} (${detail})` : reason);
        updateLog(log, { ok: status === 'done', status: status === 'done' ? '' : status === 'stopped' ? 'Stopped' : 'Failed', details,
            result: status === 'done' ? 'Read aloud.' : reason || 'Stopped.' });
        return { status, reason, lines: reading.lines };
    };
    if (cached) {
        cached.lines.forEach((line, index) => {
            reading.lines[index] = { ...line, info: null, cached: true };
            schedule(reading, line.samples, line.pause);
        });
        tell({ mesId: id, status: 'playing', reason: '' });
        await waitForEnd(reading);
        return finish(reading.stopped ? 'stopped' : 'done');
    }
    const reach = await ensureReach({ fetcher });
    if (!reach.ok) {
        const reason = reach.reason || 'The desktop voice is unavailable.';
        toast('warning', reason);
        return finish('failed', reason, reach.detail || '');
    }
    const settings = voiceSettings();
    const names = [...new Set(castFor(message, host).cast.map(member => member.name))];
    for (const [index, line] of reading.lines.entries()) {
        if (reading.controller.signal.aborted) return finish('stopped');
        try {
            const { samples, info } = await speak({ text: line.text, voice: line.voice, seed: line.seed, knobs: line.knobs,
                verify: settings.verify !== false, names, signal: reading.controller.signal, fetcher });
            line.samples = prepareLine(samples);
            line.info = info;
            schedule(reading, line.samples, line.pause);
            if (index === 0) tell({ mesId: id, status: 'playing', reason: '' });
        } catch (error) {
            if (reading.controller.signal.aborted) return finish('stopped');
            forgetReach();
            const reason = `Line ${index + 1} of ${reading.lines.length} did not render: ${String(error?.message || error)}`;
            toast('warning', reason);
            return finish('failed', reason);
        }
    }
    cache.set(key, { lines: reading.lines.map(line => ({ ...line, info: null })) });
    await waitForEnd(reading);
    return finish(reading.stopped ? 'stopped' : 'done');
}

/** Wait until the scheduled audio has played, or the reading was stopped. */
function waitForEnd(reading) {
    const context = reading.context;
    if (!context) return Promise.resolve();
    return new Promise(resolve => {
        const check = () => {
            if (current !== reading || context.currentTime >= reading.at - 0.01) resolve();
            else setTimeout(check, Math.min(500, Math.max(50, (reading.at - context.currentTime) * 1000)));
        };
        check();
    });
}

/** Render one test line in a voice, played at once: the sheet's Play test line and the A/B. */
export async function playSample({ text, voice, knobs = {}, eq = true, fetcher } = {}) {
    stopReading();
    const context = audioContext();
    const reach = await ensureReach({ fetcher });
    if (!reach.ok) throw new Error(reach.reason);
    const { samples, info } = await speak({ text, voice, seed: seedFor(text, voice), knobs, eq, verify: false, fetcher });
    const prepared = prepareLine(samples);
    if (context) {
        const reading = current = { mesId: -1, controller: new AbortController(), sources: [], context, at: context.currentTime + 0.05, lines: [], state: { mesId: -1, status: 'playing' } };
        schedule(reading, prepared, 0);
        await waitForEnd(reading);
        if (current === reading) current = null;
    }
    return { seconds: prepared.length / RATE, info };
}
