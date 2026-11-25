// New faces (DESIGN 6.2, from Deus New Faces and Pura's NPC Profile Sheets): a profile sheet in the reply where a named
// character first appears, full for a major character and one line for a minor one. Each full sheet is folded until
// tapped. Copy puts the sheet on the clipboard; Add to Story World files it as a Character entry in this chat's Story
// World, leaving an entry of the same name as it is.
import { h } from '../dom.js';
import { foldedValue, row, rows } from '../card-templates.js';
import { toast } from '../../st.js';
import { actionButton, copyText, fold, headed, itemsOf, partsOf, pick, read, trackerOf } from './shared.js';

export const id = 'new_faces';

const SHEET = Object.freeze([['role', 'Role'], ['look', 'Look'], ['manner', 'Manner'], ['want', 'Wants'], ['knows', 'Knows']]);

/** One face: { name, major, role, look, manner, want, knows, line }. */
export function readFace(item) {
    if (typeof item === 'object') {
        const weight = pick(item, 'weight', 'importance', 'kind');
        const face = { name: pick(item, 'name'), major: /major|main|full/i.test(weight) || (!/minor/i.test(weight) && SHEET.filter(([key]) => item[key]).length > 1) };
        for (const [key] of SHEET) face[key] = pick(item, key, key === 'want' ? 'wants' : key);
        face.line = pick(item, 'line', 'who', 'text', 'summary') || face.role;
        return face;
    }
    const [head, ...rest] = partsOf(item);
    const named = /^(.+?)\s*\((major|minor|main|background)\)\s*:?\s*(.*)$/i.exec(head);
    const [name, inline] = named ? [named[1].trim(), named[3].trim()] : headed(head);
    const values = [inline, ...rest].filter(Boolean);
    const major = named ? /major|main/i.test(named[2]) : values.length > 2;
    const face = { name, major, line: values[0] || '' };
    SHEET.forEach(([key], index) => { face[key] = major ? values[index] || '' : ''; });
    if (!major) face.role = face.line;
    return face;
}

/** The sheet as plain text, for Copy. */
export function faceText(face) {
    if (!face.major) return `${face.name}: ${face.line}`;
    return [face.name, ...SHEET.filter(([key]) => face[key]).map(([key, label]) => `${label}: ${face[key]}`)].join('\n');
}

/** File a face in this chat's Story World as a Character entry. Returns the word the button shows. */
export async function addToStoryWorld(face) {
    const world = await import('../../world.js');
    const id = world.chatWorld();
    if (!id) {
        toast('warning', 'This chat has no Story World yet. Choose one in Story, World Info, then add the character again.');
        return 'No Story World';
    }
    const data = await world.loadWorld(id);
    if (!data) throw new Error('The Story World could not be read.');
    if (world.listWorld(data, id).some(entry => entry.kind === 'character' && fold(entry.name) === fold(face.name))) {
        toast('info', `${face.name} is already in the Story World.`);
        return 'Already there';
    }
    const entry = world.newWorldEntry(data, 'character');
    entry.name = face.name;
    entry.fields.role = face.major ? face.role : face.line;
    entry.fields.who = face.major ? [face.look, face.manner].filter(Boolean).join('. ') : '';
    entry.fields.wants = face.want || '';
    entry.fields.knows = face.knows || '';
    world.writeWorldEntry(data, entry, id);
    await world.saveWorld(id, data);
    toast('success', `${face.name} was added to the Story World.`);
    return 'Added';
}

function faceActions(face) {
    const copy = actionButton('Copy', 'fa-copy', async () => ((await copyText(faceText(face))) ? 'Copied' : 'Copy failed'), { aria: `Copy the sheet of ${face.name}` });
    const add = actionButton('Add to Story World', 'fa-book-medical', () => addToStoryWorld(face), { aria: `Add ${face.name} to the Story World`, title: 'File this sheet as a Character entry in the Story World' });
    return h('div', { class: 'ri-c-actions' }, copy, add);
}

function faceBlock(face) {
    if (!face.major) {
        return h('section', { class: 'ri-c-person ri-c-face', 'data-face': 'minor' },
            h('div', { class: 'ri-c-person-head' }, h('strong', {}, face.name), h('span', { class: 'ri-c-doing' }, foldedValue(face.line))), faceActions(face));
    }
    return h('details', { class: 'ri-c-fold ri-c-person ri-c-face', 'data-face': 'major' },
        h('summary', { 'aria-label': `${face.name}, profile sheet` }, h('span', { class: 'ri-c-person-head' }, h('strong', {}, face.name), face.role ? h('span', { class: 'ri-c-doing ri-c-clamp' }, face.role) : null)),
        rows(SHEET.filter(([key]) => key !== 'role').map(([key, label]) => row(label, face[key]))), faceActions(face));
}

export function render(env, { footer }) {
    if (!env.on('sheet')) return null;
    const { value, mark } = read(trackerOf(env.view.rec, 'new_faces')?.sheet, env);
    const faces = itemsOf(value).map(readFace).filter(face => face.name);
    if (!faces.length) return null;
    return { first: faces.map(face => face.name).join(', '), body: () => [faces.map(faceBlock), mark ? h('p', { class: 'ri-c-unrequested' }, mark) : null, footer(env)] };
}
