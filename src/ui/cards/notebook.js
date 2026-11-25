// Notebook (DESIGN 6.2): Narrator notes from Vexa's Notebook (reminders and open questions) and Diaries from Deus
// (private entries in the voice of the two characters closest to the player character), each diary set as a quote.
import { h } from '../dom.js';
import { bulletList, quoteBlock } from '../card-templates.js';
import { headed, itemsOf, pick, read, section, trackerOf } from './shared.js';

export const id = 'notebook';

/** Diary entries as { by, text }, from "Name: entry" lines or objects. */
export function readDiaries(raw) {
    return itemsOf(raw).map(item => {
        if (typeof item === 'object') return { by: pick(item, 'name', 'by', 'who'), text: pick(item, 'text', 'entry', 'diary') };
        const [by, text] = headed(item);
        return { by, text };
    }).filter(item => item.text);
}

export function render(env, { footer }) {
    const saved = trackerOf(env.view.rec, 'notebook') || {};
    const notes = env.on('narrator') ? itemsOf(saved.narrator).map(item => (typeof item === 'string' ? item : pick(item, 'text', 'note'))).filter(Boolean) : [];
    const diaries = env.on('diaries') ? readDiaries(saved.diaries) : [];
    if (!notes.length && !diaries.length) return null;
    const mark = read(saved.narrator ?? saved.diaries, env).mark;
    return { first: notes[0] || (diaries[0] && `${diaries[0].by ? `${diaries[0].by}: ` : ''}${diaries[0].text}`), body: () => [
        section('Narrator notes', bulletList(notes), { iconName: 'fa-feather', count: notes.length, id: 'narrator' }),
        section('Diaries', diaries.map(item => quoteBlock(item.text, { by: item.by, italic: true })), { iconName: 'fa-book-open', count: diaries.length, id: 'diaries' }),
        mark ? h('p', { class: 'ri-c-unrequested' }, mark) : null,
        footer(env)] };
}
