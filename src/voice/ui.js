// V1, the parts she touches: a Read aloud entry in SillyTavern's message menu on every AI reply (beside What was sent),
// and the Voices page under Story, Characters, where each character and her persona get a cloned voice. The page records
// a clip with the phone's microphone or takes an uploaded one, checks it in code (length, level, clipping, noise and
// silence), trims it, sends it to the desktop as that character's reference and plays a short test line so her ear
// decides; Record again redoes it. Delivery folds open for an A/B against her King County settings.
import { h, button, field, section, toggle } from '../ui/dom.js';
import { registerPage } from '../ui/page-registry.js';
import { ctx, isReply, on, toast } from '../st.js';
import { voiceUrlProblem } from '../routing.js';
import { RATE, checkClip, mixDown, resample, wavBytes } from './audio.js';
import { KING_COUNTY, KNOBS, addVoice, forgetReach, probe, removeVoice, saveVoiceSettings, voiceSettings } from './client.js';
import { audioContext, castFor, dropReply, onVoiceState, playSample, readReply } from './player.js';
import { seedFor } from './text.js';

export const PAGE_ID = 'voices';
export const TEST_LINE = 'The rain had stopped by the time we reached the gate, and nobody said a word for a long while.';
export const RECORD_LIMIT_S = 16;
const BUTTON = 'ri-voice-button';
const ICON = { idle: 'fa-volume-high', busy: 'fa-stop', failed: 'fa-volume-xmark' };

/** The server's name for a cast member's voice: kind, name and a short mark of the key, so two Mira cards differ. */
export function serverVoiceName(member) {
    const slug = String(member.name || 'voice').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'voice';
    return `ri-${member.kind === 'persona' ? 'persona' : 'char'}-${slug}-${seedFor(member.key).toString(36).slice(0, 5)}`;
}

// The Read aloud entry. Its own class keeps it out of message-menu.js, which redraws only its own entries.
function entryNode() {
    const node = document.createElement('div');
    node.className = `mes_button fa-solid ${ICON.idle} ${BUTTON}`;
    node.title = 'Read aloud';
    node.setAttribute('role', 'button');
    node.setAttribute('tabindex', '0');
    node.setAttribute('aria-label', 'Read aloud');
    return node;
}

/** Every AI reply gets Read aloud once a desktop voice address is saved. */
export function refreshVoiceButtons(doc = document) {
    const chat = ctx().chat || [];
    const ready = !!voiceSettings().url;
    for (const node of doc.querySelectorAll('#chat .mes[mesid]')) {
        const holder = node.querySelector('.extraMesButtons');
        if (!holder) continue;
        const message = chat[Number(node.getAttribute('mesid'))];
        const want = ready && isReply(message) && !message.is_system;
        const have = holder.querySelector(`:scope > .${BUTTON}`);
        if (want && !have) holder.append(entryNode());
        if (!want && have) have.remove();
    }
}

const elapsed = new Map();
const notes = new Map();
function showState({ mesId, status, reason }) {
    const control = document.querySelector(`#chat .mes[mesid="${mesId}"] .${BUTTON}`);
    clearInterval(elapsed.get(mesId));
    elapsed.delete(mesId);
    if (!control) return;
    const busy = status === 'rendering' || status === 'playing';
    control.classList.remove(ICON.idle, ICON.busy, ICON.failed);
    control.classList.add(busy ? ICON.busy : status === 'failed' ? ICON.failed : ICON.idle);
    const label = busy ? 'Stop reading' : status === 'failed' ? `Read aloud. The last try failed: ${reason}` : 'Read aloud';
    control.setAttribute('aria-label', label);
    control.title = label;
    control.dataset.riVoice = status;
    control.removeAttribute('data-ri-elapsed');
    // Past ten seconds without sound the entry shows how long it has waited (mobile standard, loading lifecycle).
    if (status === 'rendering') {
        const started = Date.now();
        elapsed.set(mesId, setInterval(() => {
            const seconds = Math.round((Date.now() - started) / 1000);
            if (seconds >= 10) { control.dataset.riElapsed = `${seconds} s`; control.title = `Stop reading (${seconds} s)`; }
        }, 1000));
    }
    live(status === 'failed' ? reason : status === 'playing' ? 'Reading aloud.' : status === 'done' ? 'Finished reading.' : '');
}

function live(text) {
    let region = document.getElementById('ri-voice-live');
    if (!region) {
        region = h('div', { id: 'ri-voice-live', class: 'ri-visually-hidden', role: 'status', 'aria-live': 'polite' });
        document.body.append(region);
    }
    if (text) region.textContent = text;
}

function tapped(event) {
    const control = event.target.closest?.(`.${BUTTON}`);
    if (!control) return;
    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    const id = Number(control.closest('.mes')?.getAttribute('mesid'));
    if (Number.isInteger(id)) readReply(id).catch(error => toast('error', String(error?.message || error)));
}

// The Voices page.

async function decodeRecording(blob) {
    const context = audioContext();
    if (!context) throw new Error('This browser cannot decode audio.');
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
    return resample(mixDown(channels), decoded.sampleRate, RATE);
}

/** Check a recording, send it to the desktop as this member's voice, save it and play the test line. */
export async function acceptRecording(member, samples, { fetcher, play = true } = {}) {
    const result = checkClip(samples, RATE);
    if (!result.ok) return { ok: false, result };
    const saved = await addVoice(serverVoiceName(member), wavBytes(result.clip, RATE), { fetcher });
    const voices = voiceSettings().voices;
    const before = voices[member.key];
    voices[member.key] = { id: saved.voice_id, name: member.name, kind: member.kind, seconds: result.kept, speech: result.speechSeconds,
        at: new Date().toISOString(), knobs: before?.knobs || {} };
    saveVoiceSettings();
    let sample = null;
    if (play) sample = await playSample({ text: TEST_LINE, voice: saved.voice_id, knobs: voices[member.key].knobs, fetcher }).catch(error => ({ error }));
    return { ok: true, result, voice: voices[member.key], sample };
}

const day = iso => { try { return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } };

function memberCard(member, main, redraw) {
    const voices = voiceSettings().voices;
    const saved = voices[member.key];
    const message = h('div', { class: 'ri-help ri-voice-result', role: 'status', 'aria-live': 'polite' });
    // The last message on a card outlives the redraw that follows a saved or removed voice.
    const say = (text, problems = [], alert = false) => {
        notes.set(member.key, { text, problems, alert });
        message.setAttribute('role', alert ? 'alert' : 'status');
        message.replaceChildren(h('p', {}, text), problems.length ? h('ul', {}, problems.map(p => h('li', {}, p))) : '');
    };
    if (notes.has(member.key)) { const note = notes.get(member.key); say(note.text, note.problems, note.alert); }
    const fallback = member.key === main?.key || !voices[main?.key]?.id ? 'the built-in voice' : `${main.name}'s voice`;
    const status = saved?.id ? `Voice from a ${saved.seconds} s clip, saved ${day(saved.at)}.` : `No voice yet. Their lines are read in ${fallback}.`;
    const handle = async (samples, label) => {
        say(`Checking the ${label}...`);
        try {
            const out = await acceptRecording(member, samples);
            if (!out.ok) { say('Not used. Fix this and record again:', out.result.problems, true); return; }
            const cut = out.result.cutTo ? ` Kept the first ${out.result.cutTo} s.` : '';
            say(`Saved: a ${out.result.kept} s clip, the speech ${out.result.snrDb} dB above the background.${cut} ${out.sample?.error ? `The test line did not play: ${out.sample.error.message}` : 'The test line played; record again if it does not sound right.'}`);
            redraw();
        } catch (error) { say(String(error?.message || error), [], true); }
    };
    // Recording: the phone's microphone with its processing off, stopped by a second tap or after 16 s.
    let recorder = null, timer = null;
    const record = button('Record', async () => {
        if (recorder) { recorder.stop(); return; }
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
        } catch (error) { say(`The microphone did not open: ${error?.message || error}. Upload a clip instead.`, [], true); return; }
        const chunks = [];
        recorder = new MediaRecorder(stream);
        recorder.ondataavailable = event => event.data?.size && chunks.push(event.data);
        recorder.onstop = async () => {
            clearInterval(timer);
            for (const track of stream.getTracks()) track.stop();
            recorder = null;
            record.textContent = 'Record again';
            record.setAttribute('aria-pressed', 'false');
            try { await handle(await decodeRecording(new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' })), 'recording'); }
            catch (error) { say(`The recording could not be read: ${error?.message || error}`, [], true); }
        };
        const started = Date.now();
        recorder.start();
        record.setAttribute('aria-pressed', 'true');
        record.textContent = 'Stop recording, 0 s';
        say('Recording. Read in the character\'s own register for 10 to 15 seconds, then tap Stop.');
        timer = setInterval(() => {
            const seconds = Math.floor((Date.now() - started) / 1000);
            record.textContent = `Stop recording, ${seconds} s`;
            if (seconds >= RECORD_LIMIT_S && recorder?.state === 'recording') recorder.stop();
        }, 250);
    });
    record.classList.add('ri-voice-record');
    if (saved?.id) record.textContent = 'Record again';
    const file = h('input', { type: 'file', accept: 'audio/*', class: 'ri-voice-file', 'aria-label': `Upload a clip for ${member.name}`,
        onchange: async () => {
            const chosen = file.files?.[0];
            file.value = '';
            if (!chosen) return;
            try { await handle(await decodeRecording(chosen), 'clip'); }
            catch (error) { say(`That file could not be read as audio: ${error?.message || error}`, [], true); }
        } });
    const upload = h('label', { class: 'ri-btn ri-voice-upload' }, 'Upload a clip', file);
    const row = h('div', { class: 'ri-voice-actions' }, record, upload);
    let delivery = null;
    if (saved?.id) {
        row.append(button('Play test line', async () => {
            say('Rendering the test line on the desktop...');
            try { const out = await playSample({ text: TEST_LINE, voice: saved.id, knobs: saved.knobs }); say(`Played ${out.seconds.toFixed(1)} s, seed ${out.info.seed}.`); }
            catch (error) { say(String(error?.message || error)); }
        }), button('Remove', async () => {
            try { await removeVoice(saved.id); } catch (error) { toast('warning', `The desktop kept the clip: ${error?.message || error}`); }
            delete voiceSettings().voices[member.key];
            saveVoiceSettings();
            redraw();
        }, { kind: 'danger' }));
        delivery = deliveryFold(member, saved, say);
    }
    return h('div', { class: 'ri-card ri-voice-card', 'data-ri-voice-member': member.key },
        h('div', { class: 'ri-section-title' }, member.name, ' ', h('span', { class: 'ri-chip' }, member.kind === 'persona' ? 'Your persona' : 'Character')),
        h('p', { class: 'ri-help ri-voice-status' }, status), row, message, delivery);
}

/** Delivery: three sliders over her King County settings and an A/B of the test line. No speed control exists. */
function deliveryFold(member, saved, say) {
    const knobs = { ...saved.knobs };
    const save = () => { voiceSettings().voices[member.key].knobs = { ...knobs }; saveVoiceSettings(); };
    const rows = Object.entries(KNOBS).map(([name, spec]) => {
        const value = h('span', { class: 'ri-voice-value' }, String(knobs[name] ?? KING_COUNTY[name]));
        const range = h('input', { type: 'range', class: 'ri-voice-range', min: spec.min, max: spec.max, step: spec.step, value: knobs[name] ?? KING_COUNTY[name],
            'aria-label': spec.label, oninput: () => { knobs[name] = Number(range.value); value.textContent = range.value; save(); } });
        return field(spec.label, `King County: ${KING_COUNTY[name]}`, range, value);
    });
    const play = async (label, use) => {
        say(`Rendering ${label} on the desktop...`);
        try { const out = await playSample({ text: TEST_LINE, voice: saved.id, knobs: use }); say(`${label}: played ${out.seconds.toFixed(1)} s, seed ${out.info.seed}.`); }
        catch (error) { say(String(error?.message || error)); }
    };
    return h('details', { class: 'ri-fold ri-voice-delivery' },
        h('summary', { class: 'ri-fold-head' }, 'Delivery and A/B'),
        h('div', { class: 'ri-fold-body' },
            h('p', { class: 'ri-help' }, 'A plays the test line with your King County settings; B plays it with these sliders. Both use 24 vocoder steps and the tone-match EQ, and the same seed, so only the sliders differ. Speed is not offered: it distorted the voice.'),
            rows,
            h('div', { class: 'ri-voice-actions' },
                button('A: King County', () => play('A, King County settings', {})),
                button('B: these settings', () => play('B, these settings', { ...knobs })),
                button('Back to King County', () => { for (const name of Object.keys(KNOBS)) delete knobs[name]; save(); say('Back to the King County settings.'); }))));
}

export function renderVoicesPage(body) {
    const draw = () => {
        const config = voiceSettings();
        const host = ctx();
        const urlProblem = h('p', { class: 'ri-help ri-voice-url-problem', role: 'alert' }, config.url ? voiceUrlProblem(config.url) : '');
        const url = h('input', { type: 'url', class: 'ri-input', value: config.url || '', placeholder: 'http://100.x.y.z:8125', autocomplete: 'off', inputMode: 'url',
            onchange: () => {
                const value = url.value.trim();
                const problem = value ? voiceUrlProblem(value) : '';
                urlProblem.textContent = problem;
                if (problem) return;
                saveVoiceSettings({ url: value });
                forgetReach();
                refreshVoiceButtons();
            } });
        const key = h('input', { type: 'password', class: 'ri-input', value: config.key || '', autocomplete: 'off',
            onchange: () => { saveVoiceSettings({ key: key.value.trim() }); forgetReach(); } });
        const status = h('p', { class: 'ri-help ri-voice-probe', role: 'status', 'aria-live': 'polite' });
        const test = button('Test the connection', async () => {
            status.textContent = 'Checking the desktop voice...';
            const out = await probe().catch(error => ({ ok: false, reason: String(error?.message || error) }));
            if (!out.ok) { status.textContent = out.reason; return; }
            const d = out.status?.defaults || {};
            status.textContent = `Connected ${out.mode === 'proxy' ? 'through SillyTavern\'s proxy' : 'directly'}. Defaults: expressiveness ${d.exaggeration}, closeness ${d.cfg_weight}, variety ${d.temperature}, ${d.steps} vocoder steps${out.status?.eq ? ', tone-match EQ' : ''}. Line check ${out.status?.check ? 'available' : 'not installed on the desktop'}.`;
        });
        const desktop = section('Desktop voice',
            h('p', { class: 'ri-help' }, 'Replies are read by Chatterbox on your desktop, over Tailscale only. Enter the desktop\'s 100.x address and the voice server\'s port, and the key from the .key file beside the server.'),
            field('Address', '', url), urlProblem, field('Key', '', key),
            field('Check each line by transcription', 'The desktop transcribes each line and renders it again with a new seed when the words differ. Names are listed in the receipt for your ear.',
                toggle(config.verify !== false, value => saveVoiceSettings({ verify: !!value }), 'Check each line by transcription')),
            h('div', { class: 'ri-voice-actions' }, test), status);
        const chatOpen = host.characterId !== undefined && host.characterId !== null || host.groupId;
        const { cast, main } = castFor({ name: host.name2 }, host);
        const members = chatOpen ? cast : cast.filter(member => member.kind === 'persona');
        const cards = section('Voices in this chat',
            h('p', { class: 'ri-help' }, 'One clip per character and per persona: 10 to 15 seconds of clean speech in the voice the character holds. Read aloud is in each reply\'s message menu; it reads the words in double quotes in each speaker\'s voice. Narration and thoughts are not read.'),
            config.url ? null : h('p', { class: 'ri-help' }, 'Save the desktop voice address first; recordings are checked here and kept on the desktop.'),
            members.length ? members.map(member => memberCard(member, main, () => { body.replaceChildren(); draw(); })) : h('p', { class: 'ri-help' }, 'Open a chat to give its characters a voice.'));
        body.append(h('div', { class: 'ri-voice-page', id: 'ri-voice-page' }, desktop, cards));
    };
    draw();
}

let mounted = false;
/** Register the page, the message menu entry and the cache drops. Called once when the extension loads. */
export function mountVoice() {
    if (mounted || !globalThis.SillyTavern?.getContext) return;
    mounted = true;
    if (!document.getElementById('ri-voice-css')) document.head.append(h('link', { rel: 'stylesheet', id: 'ri-voice-css', href: new URL('./voice.css', import.meta.url).href }));
    registerPage({ id: PAGE_ID, group: 'story', tab: 'characters', label: 'Voices', withoutChat: true,
        help: 'A cloned voice for each character and your persona, read on your desktop over Tailscale.',
        aliases: 'voice voices read aloud speech speak tts clone cloned record microphone clip chatterbox audio listen desktop tailscale', render: renderVoicesPage });
    document.addEventListener('click', tapped, true);
    document.addEventListener('keydown', tapped, true);
    onVoiceState(showState);
    for (const name of ['CHARACTER_MESSAGE_RENDERED', 'MORE_MESSAGES_LOADED', 'CHAT_CHANGED']) on(name, () => setTimeout(() => refreshVoiceButtons(), 60));
    for (const name of ['MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_UPDATED']) on(name, id => dropReply(Number.isInteger(Number(id)) ? Number(id) : undefined));
    for (const name of ['MESSAGE_DELETED', 'CHAT_CHANGED']) on(name, () => dropReply());
    setTimeout(() => refreshVoiceButtons(), 300);
}
try { mountVoice(); } catch (error) { console.warn('Roleplay Instructions could not add Voices.', error); }
