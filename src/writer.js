// "Write versions with AI": one background request that returns a list of versions for one instruction.
import { ask, parseJson, ctx, names } from './st.js';
import { settings, pronounForms, FORMS } from './store.js';
import { ACTORS, TARGETS, SENT_AS } from './books.js';
import { swapNames } from './validate.js';
import { stripSentBlock } from './engine.js';

function pronounLine(role, label) {
    const forms = pronounForms(role);
    const tokens = FORMS.map(f => `[[${role}.${f}]]`).join(' ');
    return `[[${role}]] = ${label}'s name. ${tokens} = ${label}'s pronouns (in this chat: ${forms.join(', ')}). For the start of a sentence use a capital, for example [[${role}.They]] or [[${role}.Their]].`;
}

/** What the AI writer can be shown, in the order it is offered. */
export const CONTEXT_PARTS = [
    ['card', 'Character card (description and personality)'],
    ['scenario', 'Scenario'],
    ['persona', 'Your persona'],
    ['summary', 'Chat summary'],
    ['recent', 'The most recent chat messages'],
];

/** The chat summary, when a summary extension keeps one in this chat. */
export function findSummary() {
    try {
        const prompts = ctx().extensionPrompts || {};
        return Object.entries(prompts).filter(([key, v]) => /memory|summar/i.test(key) && String(v?.value || '').trim()).map(([, v]) => String(v.value).trim()).join('\n').slice(0, 6000);
    } catch { return ''; }
}

const fill = (text) => { try { return ctx().substituteParams(String(text ?? '')); } catch { return String(text ?? ''); } };

/** The parts of the story the user ticked, as text for the writer prompt. */
function contextText(c = {}) {
    const out = [];
    try {
        const f = ctx().getCharacterCardFields?.() || {};
        if (c.card && f.description) out.push(`Character description: ${fill(f.description)}`);
        if (c.card && f.personality) out.push(`Character personality: ${fill(f.personality)}`);
        if (c.scenario && f.scenario) out.push(`Scenario: ${fill(f.scenario)}`);
        if (c.persona && f.persona) out.push(`About the other person: ${fill(f.persona)}`);
        if (c.summary) { const sum = findSummary(); if (sum) out.push(`Summary of the story so far: ${sum}`); }
        if (c.recent) {
            const count = Math.max(1, Math.min(50, Math.round(Number(c.recentCount) || 10)));
            const lines = (ctx().chat || []).filter(m => !m.is_system && m.mes).slice(-count).map(m => `${m.name}: ${stripSentBlock(m.mes).replace(/\s+/g, ' ').trim().slice(0, 1500)}`);
            if (lines.length) out.push(`The most recent messages of the chat, oldest first:\n${lines.join('\n')}`);
        }
    } catch { /* leave out what cannot be read */ }
    return out.join('\n\n').slice(0, 24000);
}

const STORY_LEAD = 'What is known about the story. Use it so that what you write fits these people and this moment, and still use the placeholders for names:';

export function buildWriterPrompt({ ins, seed, count, context, existing }) {
    const actor = ACTORS[ins.actor] || ACTORS.char;
    const target = TARGETS[ins.target] || TARGETS.user;
    const lines = [
        `Write ${count} different versions of one instruction for a roleplay.`,
        '',
        `What should happen: ${seed}`,
        `Who does it: ${actor.text}`,
        `Who it happens to: ${target.text}`,
        `Instruction name: ${ins.name}`,
        ins.notes ? `Notes: ${ins.notes}` : '',
        `How it is sent: ${(SENT_AS[ins.sentAs] || SENT_AS.system).label}`,
        '',
        'Rules for every version:',
        '- It is an order for the next reply. Use the word "must". State it as certain: it happens.',
        '- One or two plain sentences with literal wording. Name a concrete action that can be seen or heard in the scene, and leave the manner open.',
        '- When the order starts from a feeling, state the visible action that the feeling forces.',
        '- Positive wording throughout: every clause says what happens.',
        '- Start with who does it.',
        '- [[user]] is only ever the one it happens to. Every action, spoken line, decision, thought and feeling in the version belongs to someone other than [[user]].',
        '- Each version is a different way the same thing can go.',
        '- Use these placeholders exactly as written, with the double square brackets, wherever a name or pronoun is needed, and write real names nowhere:',
        `  ${pronounLine('char', 'the character')}`,
        `  ${pronounLine('user', 'the other person')}`,
    ];
    if (existing.length) lines.push('', 'Versions that already exist (write new ones that differ from these):', ...existing.slice(0, 30).map(v => `- ${brackets(v)}`));
    { const story = contextText(context); if (story) lines.push('', STORY_LEAD, story); }
    lines.push('', 'Return only a JSON list of strings, for example ["first version", "second version"].');
    // The prompt uses [[char]] where a saved version uses {{char}}, so SillyTavern leaves the placeholders alone on the way out.
    return brackets(lines.filter(l => l !== null && l !== undefined).join('\n'));
}

const brackets = text => String(text ?? '').replace(/\{\{((?:char|user)(?:\.[A-Za-z]+)?)\}\}/g, '[[$1]]');

function tidy(text) {
    let s = String(text ?? '').replace(/\s+/g, ' ').trim();
    // Back from the prompt's [[char]] form, then common slips in placeholder spelling.
    s = s.replace(/\[\[\s*((?:char|user)(?:\s*[._:]\s*[A-Za-z]+)?)\s*\]\]/gi, '{{$1}}').replace(/\[((?:char|user)\.[A-Za-z]+)\](?!\])/gi, '{{$1}}');
    s = s.replace(/\{\{\s*(char|user)\s*\}\}/gi, (m, r) => `{{${r.toLowerCase()}}}`);
    s = s.replace(/\{\{\s*(char|user)\s*[._:\s]\s*([A-Za-z]+)\s*\}\}/gi, (m, r, f) => `{{${r.toLowerCase()}.${f}}}`);
    s = s.replace(/\{(char|user)(\.[A-Za-z]+)?\}(?!\})/gi, (m, r, f) => `{{${r.toLowerCase()}${f || ''}}}`).replace(/\{\{\{+/g, '{{').replace(/\}\}\}+/g, '}}');
    return s;
}

/** Ask the model for versions. Returns [{ text, swaps }]. Throws with a plain message when it fails. */
export async function writeVersions({ ins, seed, count, context }) {
    const st = settings();
    const existing = ins.versions.map(v => v.text);
    const prompt = buildWriterPrompt({ ins, seed, count, context, existing });
    let answer;
    try {
        answer = await ask({ system: 'You write short instructions that are sent to a roleplay AI model during a chat. You answer with JSON only.', user: prompt, tokens: Math.min(4000, 200 + count * 120), profileId: st.profileId });
    } catch (e) {
        throw new Error(`The AI connection did not answer: ${e?.cause?.message || e?.message || e}`);
    }
    let list = parseJson(answer);
    if (list && !Array.isArray(list)) list = Object.values(list).find(Array.isArray) || null;
    if (!Array.isArray(list)) {
        // Fall back to one version per line.
        list = String(answer).split('\n').map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/^"|"[,]?$/g, '').trim()).filter(l => l.length > 15);
    }
    const seen = new Set(existing.map(v => v.toLowerCase()));
    const out = [];
    for (const raw of list) {
        if (typeof raw !== 'string') continue;
        const swapped = swapNames(tidy(raw));
        const text = swapped.text;
        if (!text || seen.has(text.toLowerCase())) continue;
        seen.add(text.toLowerCase());
        out.push({ text, swaps: swapped.swaps });
    }
    if (!out.length) throw new Error('The AI answered, but no versions could be read from the answer. Try again, or pick another AI connection in Settings.');
    return out;
}

/**
 * Ask the model for items for one category of a story event set. Returns [{ text, swaps }].
 * category: { name, driver }, theme: what the story is like, existing: item texts already in the list.
 */
export async function writeItems({ category, theme, count, context, existing, others, style = false }) {
    const st = settings();
    const lines = style ? [
        `Write ${count} items for one list of writing style choices. A roleplay AI is later told to write its reply using one item from the list.`,
        '',
        `This list: ${category.name}`,
        category.hint ? `What an item in this list is: ${category.hint}` : '',
        others.length ? `The other lists: ${others.join(', ')}` : '',
        `What the writer wants: ${theme}`,
        '',
        'Rules for every item:',
        '- It changes how the prose is written and leaves the events of the story alone.',
        '- Plain, literal wording that says what to do. One short phrase or sentence.',
        '- Where a name is needed use [[char]] for the main character and [[user]] for the other person, with the double square brackets, and write real names nowhere' + (/author/i.test(category.name) ? ' (author names are the exception in this list).' : '.'),
        '- Each item is clearly different from the others.',
    ] : [
        `Write ${count} items for one list of story ingredients. A roleplay AI is later given one item from each list and must make an event happen from them.`,
        '',
        `This list: ${category.name}`,
        others.length ? `The other lists: ${others.join(', ')}` : '',
        `Kind of story: ${theme}`,
        '',
        'Rules for every item:',
        '- A short phrase of 2 to 12 words. Plain, literal wording. Concrete enough to act on.',
        '- It fits the name of this list and leaves the other lists free.',
        '- General enough to fit many scenes: leave out specific names, places and times of day.',
        '- [[user]] is only ever someone things happen to. Every action, spoken line, decision, thought and feeling belongs to someone other than [[user]].',
        '- Where a name is needed use [[char]] for the main character and [[user]] for the other person, with the double square brackets, and write real names nowhere.',
        '- Each item is clearly different from the others.',
    ];
    if (existing.length) lines.push('', 'Items that already exist (write new ones that differ from these):', ...existing.slice(0, 60).map(v => `- ${v}`));
    { const story = contextText(context); if (story) lines.push('', STORY_LEAD, story); }
    lines.push('', 'Return only a JSON list of strings, for example ["first item", "second item"].');
    let answer;
    try {
        answer = await ask({ system: 'You write short story ingredients for a roleplay. You answer with JSON only.', user: brackets(lines.filter(l => l !== null && l !== undefined).join('\n')), tokens: Math.min(4000, 200 + count * 60), profileId: st.profileId });
    } catch (e) {
        throw new Error(`The AI connection did not answer: ${e?.cause?.message || e?.message || e}`);
    }
    let list = parseJson(answer);
    if (list && !Array.isArray(list)) list = Object.values(list).find(Array.isArray) || null;
    if (!Array.isArray(list)) list = String(answer).split('\n').map(l => l.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').replace(/^"|"[,]?$/g, '').trim()).filter(l => l.length > 3);
    const seen = new Set(existing.map(v => v.toLowerCase()));
    const out = [];
    for (const raw of list) {
        if (typeof raw !== 'string') continue;
        const swapped = swapNames(tidy(raw).replace(/[.]+$/, ''));
        if (!swapped.text || seen.has(swapped.text.toLowerCase())) continue;
        seen.add(swapped.text.toLowerCase());
        out.push({ text: swapped.text, swaps: swapped.swaps });
    }
    if (!out.length) throw new Error('The AI answered, but no items could be read from the answer. Try again, or pick another AI connection in Settings.');
    return out;
}

/**
 * Ask the model for a goal for the character, with repeatable actions and one-time steps.
 * Returns { goal, actions: [text], steps: [text] }.
 */
export async function writeGoal({ about, context }) {
    const st = settings();
    const lines = [
        'Write one goal for the main character of a roleplay, with small tasks that serve it.',
        '',
        about ? `What the goal is about: ${about}` : 'Choose a goal that fits the character and the story.',
        '',
        'Return three things:',
        '- "goal": one plain sentence saying what [[char]] is working toward, for example "[[char]] wants [[user]] to trust [[char.them]]".',
        '- "actions": 5 small things [[char]] does again and again along the way.',
        '- "steps": 5 things that each happen once and move the goal forward. They can happen in any order.',
        '',
        'Rules for every action and step:',
        '- A verb, who it is done to, and at most a loose manner. 8 words at most. For example "compliment [[user]]" or "tell [[user]] a secret".',
        '- It completes the sentence "[[char]] must ...", so it starts with a verb in its plain form.',
        '- Loose and general, so it fits any scene: leave out places, times, clothing, objects and names.',
        '- [[char]] is the one who does it. [[user]] is only ever the one it is done to.',
        '- Use [[char]] and [[user]] with the double square brackets wherever a name is needed, and write real names nowhere. For pronouns of the character use [[char.they]], [[char.them]], [[char.their]].',
    ];
    { const story = contextText(context); if (story) lines.push('', STORY_LEAD, story); }
    lines.push('', 'Return only a JSON object with the keys "goal", "actions" and "steps".');
    let answer;
    try {
        answer = await ask({ system: 'You plan goals for a character in a roleplay. You answer with JSON only.', user: brackets(lines.join('\n')), tokens: 900, profileId: st.profileId });
    } catch (e) {
        throw new Error(`The AI connection did not answer: ${e?.cause?.message || e?.message || e}`);
    }
    const obj = parseJson(String(answer).slice(String(answer).indexOf('{')));
    const fix = t => swapNames(tidy(String(t ?? '')).replace(/[.]+$/, '')).text;
    const list = v => (Array.isArray(v) ? v : []).filter(x => typeof x === 'string').map(fix).filter(Boolean);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj) || !obj.goal) throw new Error('The AI answered, but no goal could be read from the answer. Try again, or pick another AI connection in Settings.');
    return { goal: fix(obj.goal), actions: list(obj.actions), steps: list(obj.steps) };
}

/** Rewrite one version, keeping its meaning. Returns the new text. */
export async function rewriteVersion({ ins, text }) {
    const res = await writeVersions({ ins: { ...ins, versions: ins.versions }, seed: `The same thing as this version, worded and staged in a new way: ${text}`, count: 1, context: settings().writer.context });
    return res[0];
}

export function nameHint() {
    const n = names();
    return `In this chat {{char}} is ${n.char} and {{user}} is ${n.user}.`;
}
