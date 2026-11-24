// B10: the scene header's format, parser, miss rules, the 3-of-10 fallback and the request it rides in.
// Run with: node --test tests/t_scene_header.js
// The fake host records event handlers and extension prompts the way SillyTavern 1.19 keeps them
// (script.js setExtensionPrompt with a filter), so the "request" below is what prompt assembly would include.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
    FIELD_SEPARATOR, HEADER_LIMIT, HEADER_WINDOW, PROMPT_KEY, SCENE_HEADER_EXAMPLE, SCENE_SYMBOLS, fallbackNote, headerMode,
    headerRequested, headerState, mountSceneHeader, noteHeaderResult, parseSceneHeader, readSceneHeader, retryHeaderInReply,
    sceneHeaderInstruction, setHeaderSetting, tryHeaderInReplyAgain,
} from '../src/scene-header.js';

const EMOJI = /\p{Emoji_Presentation}|\u{FE0F}/u;
const { place: P, time: T, weather: W, present: C } = SCENE_SYMBOLS;
const VALID = `**${P} The Gilded Hound, taproom** · ${T} Day 3, Thursday, 21:40 · ${W} rain, cold · ${C} Hale, Marten`;
const PROSE = 'Hale set the lantern on the bar and waited for the room to quiet.';

let host, handlers, prompts;
function emit(name, ...args) { for (const fn of handlers[name] || []) fn(...args); }
/**
 * What the next reply request would carry. SillyTavern 1.19's in-chat path (getExtensionPrompt) drops prompts with
 * an empty value and runs the filter through Array.filter as an async function, which keeps every prompt, so only
 * the value decides.
 */
function requestCarries() {
    return prompts[PROMPT_KEY]?.value || '';
}
beforeEach(() => {
    handlers = {};
    prompts = {};
    host = {
        chat: [], chatMetadata: {}, extensionSettings: {}, getCurrentChatId: () => 'chat-a',
        saveSettingsDebounced() {}, saveMetadataDebounced() {},
        eventTypes: Object.fromEntries(['GENERATION_STARTED', 'MESSAGE_RECEIVED', 'GENERATION_STOPPED', 'CHAT_CHANGED'].map(name => [name, name])),
        eventSource: { on(type, fn) { (handlers[type] ||= []).push(fn); } },
        setExtensionPrompt(key, value, position, depth, scan, role, filter) { prompts[key] = { value, position, depth, role, filter }; },
    };
    globalThis.SillyTavern = { getContext: () => host };
});

test('the instruction asks for the exact 6.8 format with no emoji', () => {
    const text = sceneHeaderInstruction();
    assert.equal(SCENE_HEADER_EXAMPLE, VALID);
    assert.ok(text.includes(SCENE_HEADER_EXAMPLE), 'carries the worked example');
    for (const symbol of ['\u{25C6}', '\u{25F7}', '\u{2248}', '\u{25CE}']) assert.ok(text.includes(symbol), `uses ${symbol}`);
    assert.ok(text.includes(`**${P} place**`), 'place first and in bold');
    assert.ok(text.includes(FIELD_SEPARATOR.trim()), 'middle dots between fields');
    assert.equal(EMOJI.test(text), false);
    assert.match(text, /single line/);
});

test('the parser reads place, date and time, weather and who is present from a valid first line', () => {
    assert.deepEqual(parseSceneHeader(`${VALID}\n\n${PROSE}`), {
        place: 'The Gilded Hound, taproom', time: 'Day 3, Thursday, 21:40', weather: 'rain, cold', present: ['Hale', 'Marten'],
    });
    assert.deepEqual(parseSceneHeader(`\n  \n**${P} Stables** · ${T} 06:40\n\n${PROSE}`),
        { place: 'Stables', time: '06:40', weather: '', present: [] }, 'leading blank lines skipped; optional fields may be absent');
    assert.equal(parseSceneHeader(PROSE), null);
});

test('each miss rule', () => {
    const miss = text => readSceneHeader(text).reason;
    assert.equal(miss(`${VALID}\n\n${PROSE}`), null);
    assert.equal(miss(`${PROSE}\n${VALID}`), 'no-bold-place', 'the header is not the first non-empty line');
    assert.equal(miss(`${P} The Gilded Hound · ${T} 21:40\n\n${PROSE}`), 'no-bold-place', 'place not in bold');
    assert.equal(miss(`**${P} ** · ${T} 21:40\n\n${PROSE}`), 'no-place');
    assert.equal(miss(`**${P} The Gilded Hound** · ${W} rain\n\n${PROSE}`), 'no-time');
    assert.equal(miss(`**${P} The Gilded Hound**\n${T} 21:40 · ${W} rain\n\n${PROSE}`), 'multi-line', 'fields continue on the next line');
    assert.equal(miss(`**${P} The Gilded\nHound** · ${T} 21:40\n\n${PROSE}`), 'multi-line', 'bold place broken over two lines');
    assert.equal(miss(`**${P} The Gilded Hound** · ${T} 21:40 · ${W} rain \u{1F319}\n\n${PROSE}`), 'emoji', 'emoji presentation character');
    assert.equal(miss(`**${P} The Gilded Hound** · ${T} 21:40 · ${C} Hale \u{2764}\u{FE0F}\n\n${PROSE}`), 'emoji', 'emoji variation selector');
});

test('2 misses in the last 10 keep the header in the reply; 3 move it to the tray', () => {
    const state = { results: [] };
    for (let id = 1; id <= 8; id++) noteHeaderResult(state, { id, reason: null });
    noteHeaderResult(state, { id: 9, reason: 'no-time' });
    noteHeaderResult(state, { id: 10, reason: 'emoji' });
    assert.equal(state.results.length, HEADER_WINDOW);
    assert.equal(state.fallback, undefined, '2 of 10');
    noteHeaderResult(state, { id: 11, reason: 'multi-line' });
    assert.equal(state.results.length, HEADER_WINDOW, 'the window keeps the last 10');
    assert.deepEqual(state.fallback && { misses: state.fallback.misses, of: state.fallback.of }, { misses: HEADER_LIMIT, of: 10 }, '3 of 10');
    assert.equal(fallbackNote(state), 'Scene header moved to the tray: 3 of the last 10 replies missed it');
});

test('a miss that leaves the window no longer counts, and a swipe replaces its reply\'s result', () => {
    const state = { results: [] };
    noteHeaderResult(state, { id: 1, reason: 'no-time' });
    noteHeaderResult(state, { id: 2, reason: 'no-time' });
    for (let id = 3; id <= 12; id++) noteHeaderResult(state, { id, reason: null });
    noteHeaderResult(state, { id: 13, reason: 'emoji' });
    assert.equal(state.fallback, undefined, 'the two early misses slid out');
    noteHeaderResult(state, { id: 13, swipe: 1, reason: null });
    assert.equal(state.results.filter(row => row.miss).length, 0, 'the swipe replaced the miss');
});

test('Try in the reply again restores the line and clears the count', () => {
    const state = { results: [{ id: 1, miss: 'emoji' }, { id: 2, miss: 'emoji' }, { id: 3, miss: 'emoji' }], fallback: { misses: 3, of: 3 } };
    assert.equal(headerMode(state, { tray: {} }), 'tray');
    retryHeaderInReply(state);
    assert.deepEqual(state.results, []);
    assert.equal(headerMode(state, { tray: {} }), 'reply');
    assert.equal(headerMode({ results: [] }, { tray: { sceneHeader: 'tray' } }), 'tray', 'the In the tray setting');
});

test('request recorder: the header rides in the request until 3 of 10 miss, then leaves; Try again brings it back', () => {
    let active = true;
    const changes = [];
    mountSceneHeader({ active: () => active, changed: change => changes.push(change) });
    assert.equal(prompts[PROMPT_KEY].position, 1, 'in-chat');
    assert.equal(prompts[PROMPT_KEY].depth, 1);
    const send = (type, reply) => {
        emit('GENERATION_STARTED', type, {}, false);
        const carried = requestCarries();
        const id = type === 'swipe' ? host.chat.length - 1 : host.chat.length;
        host.chat[id] = { is_user: false, mes: reply, swipe_id: 0 };
        emit('MESSAGE_RECEIVED', id);
        return carried;
    };
    const good = `${VALID}\n\n${PROSE}`;
    assert.equal(send('normal', good), sceneHeaderInstruction());
    for (let i = 0; i < 6; i++) send('normal', good);
    assert.ok(send('normal', PROSE));
    assert.ok(send('normal', `**${P} Gate** · ${W} rain\n\n${PROSE}`));
    assert.equal(headerMode(), 'reply', '2 misses');
    assert.ok(send('normal', `${P} Gate · ${T} dusk\n\n${PROSE}`), 'the third miss was still asked for');
    assert.equal(headerMode(), 'tray', '3 of the last 10 missed');
    assert.equal(changes.at(-1).tripped, true);
    assert.equal(send('normal', PROSE), '', 'tray mode: the request no longer carries the instruction');
    assert.equal(headerState().results.length, 10, 'an unasked reply is not counted');
    tryHeaderInReplyAgain();
    assert.equal(headerMode(), 'reply');
    assert.deepEqual(headerState().results, []);
    assert.equal(send('normal', good), sceneHeaderInstruction(), 'Try in the reply again restores the line');
    assert.equal(send('continue', good), '', 'Continue extends a reply that has its header');
    emit('GENERATION_STARTED', 'impersonate', {}, false);
    assert.equal(requestCarries(), '', 'Impersonate writes her message');
    emit('GENERATION_STARTED', 'normal', { quiet_prompt: 'x' }, false);
    assert.equal(requestCarries(), '', 'quiet background generations');
    active = false;
    emit('GENERATION_STARTED', 'normal', {}, false);
    assert.equal(requestCarries(), '', 'scene feature off or on Theirs');
    active = true;
    setHeaderSetting('tray');
    emit('GENERATION_STARTED', 'swipe', {}, false);
    assert.equal(headerRequested(), false, 'In the tray setting');
    setHeaderSetting('reply');
    assert.equal(headerRequested('swipe'), true);
});
