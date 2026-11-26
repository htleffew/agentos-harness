// B17: the four story styles (contrast, files, fonts), the suggestion from card and World Info words, and the per-chat choice.
// Run with: node --test tests/t_story_styles.js
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, test } from 'node:test';

globalThis.document ??= { createElement: () => ({ getContext: () => ({}) }), documentElement: {}, body: {} };
globalThis.MutationObserver ??= class { observe() {} };
const style = await import('../src/story-style.js');
const { ratio } = await import('./unit/tokens_contrast.mjs');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'src/ui/theme/story-styles');
const read = file => readFileSync(join(dir, file), 'utf8');
const token = (css, name) => css.match(new RegExp(`${name}:\\s*([^;]+);`))[1].trim();

let host, saved, requests;
beforeEach(() => {
    saved = 0; requests = 0;
    host = { name1: 'Heather', name2: 'Hale', extensionSettings: {}, chat: [], chatMetadata: {}, characters: [{ name: 'Hale' }], characterId: 0,
        getCurrentChatId: () => 'chat-a', saveSettingsDebounced() { saved++; }, saveMetadataDebounced() { saved++; },
        getWorldInfoNames: () => [], loadWorldInfo: async () => ({ entries: {} }),
        generateQuietPrompt() { requests++; throw new Error('a model call'); }, generateRaw() { requests++; throw new Error('a model call'); } };
    globalThis.document.querySelectorAll = () => [];
    globalThis.SillyTavern = { getContext: () => host };
    globalThis.fetch = () => { requests++; throw new Error('a network call'); };
});

const TABLE = {
    parchment: { file: 'parchment.css', surface: '#1B150E', ink: '#EADCC2', muted: '#B8A688', accent: '#D9A95B', ratios: [13.4, 7.6, 8.4] },
    noir: { file: 'noir.css', surface: '#0F0F10', ink: '#E2E2E2', muted: '#A3A3A3', accent: '#C9B98A', ratios: [14.8, 7.6, 9.8] },
    scifi: { file: 'sci-fi.css', surface: '#03100F', ink: '#7FF2E1', muted: '#4FB3A8', accent: '#9CF27F', ratios: [14.5, 7.7, 14.2] },
    modern: { file: 'modern-minimal.css', surface: '#141518', ink: '#F1F2F4', muted: '#A8ACB5', accent: '#8FB4FF', ratios: [16.3, 8.0, 8.8] },
};

test('each style carries the colors and the ratios of the 1.12 table, and none uses amber or red', () => {
    assert.deepEqual(Object.keys(TABLE), style.STORY_STYLES.map(item => item.id));
    for (const [id, row] of Object.entries(TABLE)) {
        const css = read(row.file);
        for (const key of ['surface', 'ink', 'muted', 'accent']) assert.equal(token(css, `--ri-style-${key}`).toUpperCase(), row[key], `${id} ${key}`);
        const got = ['ink', 'muted', 'accent'].map(key => Number(ratio(row[key], row.surface).toFixed(1)));
        assert.deepEqual(got, row.ratios, `${id} ratios`);
        for (const key of ['ink', 'muted', 'accent']) assert.ok(ratio(row[key], row.surface) >= 4.5, `${id} ${key} passes 4.5`);
        assert.ok(ratio(token(css, '--ri-style-rule'), row.surface) >= 3, `${id} rule passes 3`);
        assert.notEqual(row.accent, '#F2A93B', 'not amber');
        assert.notEqual(row.accent, '#FF6464', 'not red');
        assert.match(css, new RegExp(`data-ri-story-style="${id}"`));
    }
});

test('the faces are the bundled ones and nothing loads from a network address', () => {
    assert.match(token(read('parchment.css'), '--ri-style-face'), /RI EB Garamond/);
    assert.match(token(read('noir.css'), '--ri-style-face'), /RI Courier Prime/);
    assert.equal(token(read('sci-fi.css'), '--ri-style-face'), 'var(--ri-font)');
    assert.equal(token(read('modern-minimal.css'), '--ri-style-face'), 'system-ui, sans-serif');
    const faces = read('faces.css');
    assert.doesNotMatch(faces, /https?:|\/\//, 'no address in the face sheet');
    const files = [...faces.matchAll(/url\('([^']+)'\)/g)].map(match => match[1]);
    assert.equal(files.length, 4, 'two faces, two weights each');
    let bytes = 0;
    for (const file of files) {
        const path = join(dir, file);
        assert.ok(existsSync(path), `${file} ships`);
        bytes += statSync(path).size;
    }
    for (const licence of ['OFL-eb-garamond.txt', 'OFL-courier-prime.txt']) {
        assert.match(readFileSync(join(root, 'assets/fonts/story', licence), 'utf8'), /SIL Open Font License/);
    }
    assert.ok(bytes < 100 * 1024, `the four files weigh ${bytes} bytes`);
    for (const name of ['themes.js', 'story-style.js']) {
        const code = readFileSync(join(root, name === 'themes.js' ? 'src/ui/themes.js' : 'src/story-style.js'), 'utf8');
        assert.doesNotMatch(code, /fonts\.googleapis|fonts\.gstatic|https?:\/\/[a-z]/, `${name} names no remote address`);
    }
});

const CARDS = {
    noir: 'Detective Hale works the night shift at the precinct in 1940s Port Alder. Rain-slick streets, a speakeasy under the laundry, a femme fatale with a trench coat and a whiskey habit.',
    scifi: 'Commander Hale of the starship Meridian. The colony on the third planet went dark; an android crew and a rogue AI core hold the orbit.',
    parchment: 'Sir Hale is a knight of the kingdom of Verath. A prophecy, a cursed sword and a wizard who casts spells from the throne room of a ruined castle.',
    modern: 'Hale is a barista who likes bad puns. She lives with two cats and takes the bus to a small shop on Elm Street.',
};

test('a noir, a sci-fi, a fantasy and a plain card each get their style; a tie falls to Modern minimal', () => {
    for (const [expected, text] of Object.entries(CARDS)) assert.equal(style.suggestStyle(text), expected, expected);
    assert.equal(style.suggestStyle('spell and starship'), 'modern', 'a shared lead is not a lead');
    assert.equal(style.suggestStyle(''), 'modern');
    assert.equal(style.suggestStyle('sword sword sword sword sword sword sword sword'), 'parchment', 'one word repeated still counts, capped');
    assert.equal(style.scoreStyles('sword sword sword sword sword').parchment, 3, 'one word counts three at most');
    assert.equal(style.suggestStyle('A planetary survey'), 'modern', 'whole words only');
});

test('the suggestion reads the card and the active books with no model call, then shows once as pending', async () => {
    host.characters = [{ name: 'Hale', description: CARDS.noir }];
    style.ensureSuggestion();
    await new Promise(resolve => setTimeout(resolve, 30));
    const cs = host.chatMetadata.roleplay_instructions;
    assert.deepEqual(cs.storyStyleSuggestion, { style: 'noir', state: 'pending' });
    assert.equal(style.pendingSuggestion(), 'noir');
    assert.equal(requests, 0, 'no model call and no network call');
    const before = saved;
    style.ensureSuggestion();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(saved, before, 'a second draw does nothing');
});

test('a plain card leaves no chip and a chat that already chose has none either', async () => {
    host.characters = [{ name: 'Hale', description: CARDS.modern }];
    style.ensureSuggestion();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepEqual(host.chatMetadata.roleplay_instructions.storyStyleSuggestion, { style: 'modern', state: 'done' });
    assert.equal(style.pendingSuggestion(), '');
});

test('the chat choice is saved with the chat, the Setup default covers chats with none, and choosing settles the chip', async () => {
    assert.equal(style.effectiveStoryStyle(), 'modern');
    style.setDefaultStoryStyle('parchment');
    assert.equal(host.extensionSettings.roleplay_instructions.storyStyle.default, 'parchment');
    assert.equal(style.effectiveStoryStyle(), 'parchment', 'a chat with no choice follows the default');
    host.characters = [{ name: 'Hale', description: CARDS.noir }];
    style.ensureSuggestion();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(style.pendingSuggestion(), 'noir');
    style.setChatStoryStyle('noir');
    assert.equal(host.chatMetadata.roleplay_instructions.storyStyle, 'noir', 'saved in the chat file');
    assert.equal(style.effectiveStoryStyle(), 'noir');
    assert.equal(style.pendingSuggestion(), '');
    style.setChatStoryStyle('not a style');
    assert.equal(style.effectiveStoryStyle(), 'parchment', 'clearing returns to the default');
    style.setDefaultStoryStyle('bogus');
    assert.equal(style.defaultStoryStyle(), 'modern', 'an unknown default falls back');
});

test('words in an active World Info book count with a plain card', async () => {
    host.characters = [{ name: 'Hale', description: CARDS.modern, data: { extensions: { world: 'Verath' } } }];
    host.getWorldInfoNames = () => ['Verath'];
    host.loadWorldInfo = async () => ({ entries: { 0: { comment: 'The Throne', key: ['throne', 'kingdom'], content: 'A knight guards the castle and a wizard casts a spell.' } } });
    style.ensureSuggestion();
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.deepEqual(host.chatMetadata.roleplay_instructions.storyStyleSuggestion, { style: 'parchment', state: 'pending' });
    assert.equal(requests, 0);
});

test('dismissing the chip keeps the default', async () => {
    host.characters = [{ name: 'Hale', description: CARDS.scifi }];
    style.ensureSuggestion();
    await new Promise(resolve => setTimeout(resolve, 30));
    style.dismissSuggestion();
    assert.equal(style.pendingSuggestion(), '');
    assert.equal(style.effectiveStoryStyle(), 'modern');
});
