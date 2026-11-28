// B61: the Suggest with a model button's request and answer. The automatic suggestion stays word matching with no call.
// Run with: node --test tests/t_story_style_model.js
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

globalThis.document ??= { createElement: () => ({ getContext: () => ({}) }), documentElement: {}, body: {} };
globalThis.MutationObserver ??= class { observe() {} };
const style = await import('../src/story-style.js');
const { CEILING_LINE } = await import('../src/spend.js');

let host, saved, calls;
beforeEach(() => {
    saved = 0; calls = [];
    host = { name1: 'Heather', name2: 'Hale', extensionSettings: {}, chat: [{ mes: 'hi' }], chatMetadata: {}, characterId: 0,
        characters: [{ name: 'Hale', description: 'A detective at the precinct in 1940s Port Alder.' }],
        getCurrentChatId: () => 'chat-a', saveSettingsDebounced() { saved++; }, saveMetadataDebounced() { saved++; },
        getWorldInfoNames: () => [], loadWorldInfo: async () => ({ entries: {} }),
        generateQuietPrompt() { calls.push('quiet'); throw new Error('a model call'); }, generateRaw() { calls.push('raw'); throw new Error('a model call'); } };
    globalThis.document.querySelectorAll = () => [];
    globalThis.SillyTavern = { getContext: () => host };
    globalThis.fetch = () => { calls.push('fetch'); throw new Error('a network call'); };
    style.clearModelSuggestion();
});

const fake = answer => ({ run: async (chain, options) => { calls.push({ chain, options }); return typeof answer === 'function' ? answer(options) : answer; }, chain: [{ route: 'main' }] });

test('the request carries the four ids with their faces and the capped source text', () => {
    const request = style.buildStyleRequest({ card: 'c'.repeat(9000), books: 'b'.repeat(9000) });
    for (const item of style.STORY_STYLES) {
        assert.ok(request.system.includes(`${item.id}: ${item.face}`), `${item.id} with its face`);
    }
    assert.match(request.system, /exactly one id/);
    assert.ok(request.user.includes('c'.repeat(style.MODEL_CARD_CAP)) && !request.user.includes('c'.repeat(style.MODEL_CARD_CAP + 1)), 'card text capped');
    assert.ok(request.user.includes('b'.repeat(style.MODEL_BOOK_CAP)) && !request.user.includes('b'.repeat(style.MODEL_BOOK_CAP + 1)), 'book text capped');
    assert.doesNotMatch(request.system + request.user, /[–—]/, 'no em or en dash');
    assert.match(style.buildStyleRequest({}).user, /\(none\)/);
});

test('a reply that is not one of the four ids is rejected', () => {
    for (const ok of ['noir', ' Noir. ', '"scifi"', '`parchment`', 'MODERN\n']) assert.ok(style.readStyleAnswer(ok), ok);
    for (const bad of ['', 'cyberpunk', 'noir or scifi', 'I would pick noir', 'sci-fi', 'Reply 1. She leans in.', null, undefined]) assert.equal(style.readStyleAnswer(bad), '', String(bad));
});

test('a tap sends one request through the chain as a tapped, non-background call and applies nothing', async () => {
    const before = style.effectiveStoryStyle();
    const got = await style.askModelStyle(fake({ ok: true, text: 'noir', route: 'main', attempts: [] }));
    assert.equal(calls.length, 1);
    const { options } = calls[0];
    assert.equal(options.background, false, 'a tapped call, so the ceiling reads its own line');
    assert.equal(options.job, 'styleSuggest');
    assert.match(options.user, /1940s Port Alder/, 'the card text is in the request');
    assert.deepEqual([got.state, got.style], ['done', 'noir']);
    assert.equal(style.effectiveStoryStyle(), before, 'the chat style did not change');
    assert.equal(style.chatStoryStyle(), '');
});

test('an unknown id leaves the choice unchanged and the note says so', async () => {
    const got = await style.askModelStyle(fake({ ok: true, text: 'steampunk', route: 'main', attempts: [] }));
    assert.equal(got.state, 'unusable');
    assert.match(got.note, /The model gave no usable answer/);
    assert.equal(style.chatStoryStyle(), '');
});

test('at the ceiling the note is the ceiling line and the word-matching suggestion stays', async () => {
    style.ensureSuggestion();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(style.pendingSuggestion(), 'noir', 'word matching suggested noir');
    const got = await style.askModelStyle(fake({ ok: false, waiting: true, reason: CEILING_LINE, attempts: [] }));
    assert.equal(got.state, 'ceiling');
    assert.equal(got.note, CEILING_LINE);
    assert.equal(style.pendingSuggestion(), 'noir', 'the suggestion is untouched');
});

test('no request is made by ensureSuggestion, by choosing, or by dismissing', async () => {
    style.ensureSuggestion();
    await new Promise(resolve => setTimeout(resolve, 20));
    style.setChatStoryStyle('scifi');
    style.dismissSuggestion();
    assert.deepEqual(calls, []);
    assert.equal(style.modelSuggestion().state, 'idle');
});

test('a second tap while one is asking sends nothing more, and another chat does not see the answer', async () => {
    let release;
    const slow = { chain: [{ route: 'main' }], run: () => new Promise(resolve => { calls.push('run'); release = () => resolve({ ok: true, text: 'noir', attempts: [] }); }) };
    const first = style.askModelStyle(slow);
    await new Promise(resolve => setTimeout(resolve, 10));
    await style.askModelStyle(slow);
    assert.equal(calls.length, 1);
    assert.equal(style.modelSuggestion().state, 'asking');
    host.getCurrentChatId = () => 'chat-b';
    assert.equal(style.modelSuggestion().state, 'idle');
    release();
    await first;
    assert.equal(style.modelSuggestion().state, 'idle', 'the answer belongs to chat-a');
});

test('a route that never answers says so and keeps the style', async () => {
    const got = await style.askModelStyle(fake({ ok: false, waiting: false, reason: 'No route in the chain answered.', attempts: [] }));
    assert.equal(got.state, 'failed');
    assert.match(got.note, /No route in the chain answered\./);
});
