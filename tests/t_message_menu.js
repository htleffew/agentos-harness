// B4: which messages get the two message menu entries, and that the card under each reply is gone from the source.
// Run with: node --test tests/t_message_menu.js
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

globalThis.document ??= { createElement: () => ({ getContext: () => ({}) }), documentElement: {}, body: {} };
globalThis.MutationObserver ??= class { observe() {} };
globalThis.SillyTavern = { getContext: () => ({ chat: [], chatMetadata: {}, extensionSettings: {} }) };
const { MENU_ENTRIES, entriesFor } = await import('../src/ui/message-menu.js');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const reply = { name: 'Hale', is_user: false, mes: 'The gate creaks.' };

test('every AI reply gets What was sent and Correct a story fact', () => {
    assert.deepEqual(entriesFor(reply).map(entry => entry.id), ['sent', 'correct']);
    assert.deepEqual(MENU_ENTRIES.map(entry => entry.label), ['What was sent', 'Correct a story fact', 'Close the chapter here', 'Memory from this reply']);
    assert.deepEqual(MENU_ENTRIES.map(entry => entry.icon), ['fa-receipt', 'fa-pen-to-square', 'fa-flag-checkered', 'fa-database']);
});

test('MB10: a chat whose memory lives in chat data also gets Close the chapter here and Memory from this reply', () => {
    assert.deepEqual(entriesFor(reply, { chatMemory: true }).map(entry => entry.id), ['sent', 'correct', 'close-chapter', 'memory-reply']);
    const memory = MENU_ENTRIES.find(entry => entry.id === 'memory-reply');
    const app = {};
    memory.prepare(app, 5);
    assert.deepEqual(app.worldFilter, { filter: 'all', query: '', reply: 5 });
    assert.equal(memory.page, 'world');
    assert.equal(typeof MENU_ENTRIES.find(entry => entry.id === 'close-chapter').run, 'function');
});

test('the player\'s messages, system notes and an extension that is off get none', () => {
    assert.deepEqual(entriesFor({ ...reply, is_user: true }), []);
    assert.deepEqual(entriesFor({ ...reply, is_system: true }), []);
    assert.deepEqual(entriesFor(undefined), []);
    assert.deepEqual(entriesFor(reply, { enabled: false }), []);
});

test('each entry names its page and anchors on the selected reply', () => {
    assert.equal(MENU_ENTRIES[0].page, 'sent');
    assert.equal(MENU_ENTRIES[0].anchor(7), '#ri-review-reply-7');
    assert.equal(MENU_ENTRIES[1].page, 'corrections');
    assert.equal(MENU_ENTRIES[1].anchor(7), '#ri-correction-target');
});

test('the old card is gone: no guided.js, no card class or builder left in the source', () => {
    assert.equal(existsSync(join(root, 'src/ui/guided.js')), false);
    const files = ['index.js', 'style.css', ...readdirSync(join(root, 'src/ui'), { recursive: true }).filter(name => /\.(js|css)$/.test(name)).map(name => join('src/ui', name))];
    for (const file of files) {
        const text = readFileSync(join(root, file), 'utf8');
        assert.doesNotMatch(text, /ri-guided(?!-body)|refreshGuidedControl|ui\/guided\.js|\.\/guided\.js/, file);
    }
});

test('the reply tray carries the Sent card for a reply with execution details', () => {
    const sent = readFileSync(join(root, 'src/ui/sent.js'), 'utf8');
    assert.match(sent, /rec\.quickActions \|\| rec\.guided\?\.execution/);
    assert.match(sent, /refreshMessageMenu\(\)/);
});
