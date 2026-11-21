import { promptText } from './prompts.js';
// "Write versions with AI": one background request that returns a list of versions for one instruction.
import { parseJson, ctx, names } from './st.js';
import { request } from './ai.js';
import { settings, pronounForms, FORMS } from './store.js';
import { ACTORS, TARGETS, SENT_AS, choicesOf, instructionActors, instructionTargets, rollInt } from './books.js';
import { swapNames } from './validate.js';
import { writerRules, storySoFar } from './pacing.js';
import { ORIGINS, listRole } from './events.js';
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
    ['summary', 'The story so far (your chapters, or a summary kept by SillyTavern)'],
    ['recent', 'The most recent chat messages'],
];

/** The chat summary, when a summary extension keeps one in this chat. */
export function findSummary() {
    try {
        // The extension's own story so far (chapters in the story world) comes first. Without it, a summary kept by
        // SillyTavern's Summarize or another summary extension is used.
        const own = storySoFar();
        if (own) return own.slice(0, 6000);
        const prompts = ctx().extensionPrompts || {};
        return Object.entries(prompts).filter(([key, v]) => /memory|summar/i.test(key) && !/roleplay/i.test(key) && String(v?.value || '').trim()).map(([, v]) => String(v.value).trim()).join('\n').slice(0, 6000);
    } catch { return ''; }
}

const fill = (text) => { try { return ctx().substituteParams(String(text ?? '')); } catch { return String(text ?? ''); } };

/** The parts of the story the user ticked, as text for the writer prompt. */
export function contextText(c = {}) {
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

export const EVENT_LEAD = 'What is known about the story. Use it for the kind of story and the people in it. The items still have to work in any setting of this story, and still use the placeholders for names:';
export const STORY_LEAD = 'What is known about the story. Use it so that what you write fits these people and this moment, and still use the placeholders for names:';

export const versionPromptId = actor => actor === 'model' ? 'modelVersionRules' : 'versionRules';

/** Draw without replacement until every choice has had a turn. */
function drawChoices(choices, count) {
    let remaining = [];
    return Array.from({ length: count }, () => {
        if (!remaining.length) remaining = [...choices];
        return remaining.splice(rollInt(remaining.length), 1)[0];
    });
}

function drawParticipants(actors, targets, count) {
    if (actors.length === 1 && targets.length === 1) return [];
    return drawChoices(actors.flatMap(actor => targets.map(target => ({ actor, target }))), count);
}

export function buildWriterPrompt({ ins, seed, count, context, existing, draws }) {
    const actors = instructionActors(ins);
    const targets = instructionTargets(ins);
    const assignments = draws ?? drawParticipants(actors, targets, count);
    const model = actors[0] === 'model';
    const targetLabel = model ? 'Target or subject' : 'Who it happens to';
    const describe = (label, values, options) => values.length === 1
        ? [`${label}: ${options[values[0]].text}`]
        : [`${label} (use the assigned option below):`, ...values.map(value => `- ${value}: ${options[value].text}`)];
    const lines = [
        `Write ${count} different versions of one instruction for a roleplay.`,
        '',
        `${model ? 'What the model should do' : 'What should happen'}: ${seed}`,
        ...describe('Who does it', actors, ACTORS),
        ...describe(targetLabel, targets, TARGETS),
        ...(assignments.length ? [
            'Follow these numbered assignments. Write exactly one version per number, in the listed order. Keep the selected roles and leave open only what the assigned option leaves open.',
            ...assignments.map(({ actor, target }, i) => `${i + 1}. Actor: ${actor}. Target: ${target}.`),
        ] : []),
        `Instruction name: ${ins.name}`,
        ins.notes ? `Notes: ${ins.notes}` : '',
        `How it is sent: ${(SENT_AS[ins.sentAs] || SENT_AS.system).label}`,
        '',
        'Rules for every version:',
        promptText(versionPromptId(actors[0])),
        actors.includes('unspecified') ? '- If the direction calls for no actor, describe what changes without introducing one.' : '',
        model
            ? '- These are writing instructions. Leave [[user]] in control of their own actions, speech, decisions, thoughts and feelings in the scene.'
            : '- [[user]] is only ever the one it happens to. Every action, spoken line, decision, thought and feeling in the version belongs to someone other than [[user]].',
        model ? '' : '- Each version is a different way the same thing can go.',
        '- Use these placeholders exactly as written, with the double square brackets, wherever a name or pronoun is needed, and write real names nowhere:',
        `  ${pronounLine('char', 'the character')}`,
        `  ${pronounLine('user', 'the other person')}`,
        '- Keep any character-card placeholders from the direction exactly as supplied (for example [[personality]] or [[description]]). The chat fills them in later.',
    ];
    if (existing.length) lines.push('', 'Versions that already exist (write new ones that differ from these):', ...existing.slice(0, 30).map(v => `- ${brackets(v)}`));
    { const story = contextText(context); if (story) lines.push('', STORY_LEAD, story); }
    lines.push('', ...writerRules());
    lines.push('', 'Return only a JSON list of strings, for example ["first version", "second version"].');
    // The prompt uses [[char]] where a saved version uses {{char}}, so SillyTavern leaves the placeholders alone on the way out.
    return brackets(lines.filter(l => l !== null && l !== undefined).join('\n'));
}

const CARD_MACROS = ['description', 'personality', 'scenario', 'charDescription', 'charPersonality', 'charScenario', 'persona', 'mesExamples', 'mesExamplesRaw'];
const cardMacro = new Map(CARD_MACROS.map(name => [name.toLowerCase(), name]));
const brackets = text => String(text ?? '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, name) =>
    /^(?:char|user)(?:\.[a-z]+)?$/i.test(name) || cardMacro.has(name.toLowerCase()) ? `[[${name}]]` : match);

function tidy(text) {
    let s = String(text ?? '').replace(/\s+/g, ' ').trim();
    s = s.replace(/\[\[\s*([a-z]+)\s*\]\]/gi, (match, name) => {
        const macro = cardMacro.get(name.toLowerCase());
        return macro ? `{{${macro}}}` : match;
    });
    // Back from the prompt's [[char]] form, then common slips in placeholder spelling.
    s = s.replace(/\[\[\s*((?:char|user)(?:\s*[._:]\s*[A-Za-z]+)?)\s*\]\]/gi, '{{$1}}').replace(/\[((?:char|user)\.[A-Za-z]+)\](?!\])/gi, '{{$1}}');
    s = s.replace(/\{\{\s*(char|user)\s*\}\}/gi, (m, r) => `{{${r.toLowerCase()}}}`);
    s = s.replace(/\{\{\s*(char|user)\s*[._:\s]\s*([A-Za-z]+)\s*\}\}/gi, (m, r, f) => `{{${r.toLowerCase()}.${f}}}`);
    s = s.replace(/\{(char|user)(\.[A-Za-z]+)?\}(?!\})/gi, (m, r, f) => `{{${r.toLowerCase()}${f || ''}}}`).replace(/\{\{\{+/g, '{{').replace(/\}\}\}+/g, '}}');
    return s;
}

const began = (answer) => { const t = String(answer ?? '').replace(/\s+/g, ' ').trim(); return t.length > 140 ? `${t.slice(0, 140)}...` : t; };

/** Turn a model answer into a list of strings, and say how it was read. */
function readList(answer, minLength) {
    let list = parseJson(answer);
    if (list && !Array.isArray(list)) list = Object.values(list).find(Array.isArray) || null;
    if (Array.isArray(list)) return { list, json: true, how: 'Read as a JSON list.' };
    // Fall back to one per line.
    list = String(answer).split('\n').map(l => l.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').replace(/^"|"[,]?$/g, '').trim()).filter(l => l.length > minLength);
    return { list, how: 'The answer was not a JSON list, so it was read one line at a time.' };
}

function readDrawnList(res, minLength, count, kind) {
    const read = readList(res.text, minLength);
    if (count && (!read.json || read.list.length !== count)) {
        const why = `The AI must return exactly ${count} ${kind} in order to match the selected choices. Try again or request fewer.`;
        res.note(why, false, [read.how]);
        throw new Error(why);
    }
    return read;
}

/** Why nothing usable came out of an answer that was not empty. */
function whyNone(kind, answer, read, dropped) {
    if (read.list.length && dropped.same === read.list.length) return `The AI wrote ${read.list.length} ${kind}, and every one matches ${kind === 'versions' ? 'a version this instruction already has' : 'an item already in the list'}. Change what you asked for, or delete some of the existing ones.`;
    if (read.list.length && dropped.notText === read.list.length) return `The AI answered with a list, but the things in it were not plain text, so no ${kind} could be read. The answer began: "${began(answer)}". The Log tab has the whole answer.`;
    return `The AI answered, but no ${kind} could be read from the answer. It began: "${began(answer)}". The Log tab has the whole answer.`;
}

/** Ask the model for versions. Returns [{ text, swaps }]. Throws with a plain message when it fails. */
export async function writeVersions({ ins, seed, count, context, operation = 'writerVersions' }) {
    const existing = ins.versions.map(v => v.text);
    const draws = drawParticipants(instructionActors(ins), instructionTargets(ins), count);
    const prompt = buildWriterPrompt({ ins, seed, count, context, existing, draws });
    const res = await request({ operation,authorization:'manual',what:`Write ${count} ${count === 1 ? 'version' : 'versions'} for "${ins.name || 'an instruction'}"`,
        user:prompt,tokens:Math.min(4000,300+count*150) });
    const answer = res.text;
    const read = readDrawnList(res, 15, draws.length, 'versions');
    const seen = new Set(existing.map(v => v.toLowerCase()));
    const dropped = { same: 0, notText: 0 };
    const out = [];
    for (const [index, raw] of read.list.entries()) {
        if (typeof raw !== 'string') { dropped.notText++; continue; }
        const swapped = swapNames(tidy(raw));
        const text = swapped.text;
        if (!text) continue;
        if (seen.has(text.toLowerCase())) { dropped.same++; continue; }
        seen.add(text.toLowerCase());
        out.push({ text, swaps: swapped.swaps, ...draws[index] });
    }
    if (!out.length) {
        const why = whyNone('versions', answer, read, dropped);
        res.note(why, false, [read.how]);
        throw new Error(why);
    }
    res.note(`${out.length} ${out.length === 1 ? 'version' : 'versions'} read${dropped.same ? `, ${dropped.same} left out because they match versions you already have` : ''}.`, true, [read.how]);
    return out;
}

/** What makes an item of a story event list work in any setting, with examples for that kind of list. */
const ROLE_PROMPTS = { situation: 'situationRules', complication: 'complicationRules', driver: 'driverRules', tone: 'toneRules', stake: 'stakeRules' };
export function itemContextPromptIds(category) {
    return ['anywhere', ROLE_PROMPTS[listRole(category)] || ROLE_PROMPTS.situation];
}

function anywhereRules(category) {
    return itemContextPromptIds(category).map(id => promptText(id));
}

/** The answer form for items with a "works anywhere" mark. */
const ANYWHERE_FORM = 'Return only a JSON list of objects, one per item, each with "text" (the item) and "anywhere" (true when the item makes sense in every one of those settings, false when it needs a particular place, object or group). For example [{"text": "first item", "anywhere": true}].';

/** One item of an answer: a plain string, or { text, anywhere }. */
function itemOf(raw) {
    if (typeof raw === 'string') return { text: raw, anywhere: null };
    if (raw && typeof raw === 'object' && typeof raw.text === 'string') return { text: raw.text, anywhere: raw.anywhere === false ? false : raw.anywhere === true ? true : null };
    return null;
}

/**
 * Ask the model for items for one category of a story event set. Returns [{ text, swaps }].
 * category: { name, driver }, theme: what the story is like, existing: item texts already in the list.
 */
export async function writeItems({ category, theme, count, context, existing, others, style = false, origin = '', origins = origin }) {
    const pool = style ? [''] : choicesOf(origins, ORIGINS, '');
    const draws = pool.length > 1 ? drawChoices(pool, count) : [];
    const from = ORIGINS[pool[0]].write;
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
        promptText('styleWriterRules'),
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
        promptText('eventWriterRules'),
        ...(draws.length ? [
            'Use exactly one item for each numbered origin below, in order.',
            ...pool.map(key => key ? `- ${key}: an event that ${ORIGINS[key].write}.` : '- any: leave the origin open.'),
            `Origins by item number: ${draws.map((key, i) => `${i + 1}: ${key || 'any'}`).join(', ')}.`,
        ] : from ? [`- Every item is an event that ${from}.`] : []),
        ...anywhereRules(category),
        '- [[user]] is only ever someone things happen to. Every action, spoken line, decision, thought and feeling belongs to someone other than [[user]].',
        '- Where a name is needed use [[char]] for the main character and [[user]] for the other person, with the double square brackets, and write real names nowhere.',
        '- Each item is clearly different from the others.',
    ];
    if (existing.length) lines.push('', 'Items that already exist (write new ones that differ from these):', ...existing.slice(0, 60).map(v => `- ${v}`));
    // For story event lists the current scene is left out unless asked for: it pulls items toward one place.
    const seen0 = style || st.writer.eventScene ? context : { ...context, recent: false, summary: false };
    { const story = contextText(seen0); if (story) lines.push('', style || st.writer.eventScene ? STORY_LEAD : EVENT_LEAD, story); }
    lines.push('', ...writerRules());
    lines.push('', style ? 'Return only a JSON list of strings, for example ["first item", "second item"].' : ANYWHERE_FORM);
    const res = await request({ operation:style ? 'writerStyle' : 'writerItems',authorization:'manual',what:`Write ${count} items for the list "${category.name}"`,
        user:brackets(lines.filter(l=>l!==null && l!==undefined).join('\n')),tokens:Math.min(4000,300+count*80) });
    const answer = res.text;
    const read = readDrawnList(res, 3, draws.length, 'items');
    const seen = new Set(existing.map(v => v.toLowerCase()));
    const dropped = { same: 0, notText: 0 };
    const out = [];
    for (const [index, raw] of read.list.entries()) {
        const one = itemOf(raw);
        if (!one) { dropped.notText++; continue; }
        const swapped = swapNames(tidy(one.text).replace(/[.]+$/, ''));
        if (!swapped.text) continue;
        if (seen.has(swapped.text.toLowerCase())) { dropped.same++; continue; }
        seen.add(swapped.text.toLowerCase());
        out.push({ text: swapped.text, swaps: swapped.swaps, anywhere: one.anywhere, from: draws[index] ?? pool[0] });
    }
    if (!out.length) {
        const why = whyNone('items', answer, read, dropped);
        res.note(why, false, [read.how]);
        throw new Error(why);
    }
    res.note(`${out.length} ${out.length === 1 ? 'item' : 'items'} read${dropped.same ? `, ${dropped.same} left out because they are already in the list` : ''}.`, true, [read.how]);
    return out;
}

/**
 * Rewrite items of a story event list so that each works in any setting, keeping what it does to the people.
 * One request. Returns [{ id, was, text, changed }] in the order given. Items the AI left as they were come back
 * unchanged.
 */
export async function rewriteAnywhere({ category, items, others = [] }) {
    const lines = [
        `Rewrite the items of one list of story ingredients so that each one works in any setting of the story. A roleplay AI is later given one item from each list and must make an event happen from them, wherever the scene is.`,
        '',
        `This list: ${category.name}`,
        others.length ? `The other lists: ${others.join(', ')}` : '',
        '',
        'Rules:',
        promptText('rewriteRules'),
        '- Keep [[char]] and [[user]] where the item has them, with the double square brackets, and write real names nowhere.',
        ...anywhereRules(category),
        '',
        ...writerRules(),
        '',
        'The items, numbered:',
        ...items.map((it, i) => `${i + 1}. ${brackets(it.text)}`),
        '',
        `Return only a JSON list of ${items.length} strings, the rewritten items in the same order as the numbered list.`,
    ];
    const res = await request({ operation:'writerRewrite',authorization:'manual',what:`Rewrite ${items.length} items of "${category.name}" to work in any setting`,
        user:lines.filter(l=>l!==null).join('\n'),tokens:Math.min(2400,120+items.length*40) });
    const read = readList(res.text, 3);
    // Rewrites are matched to items by their place in the list, so only a real JSON list is used.
    if (read.how !== 'Read as a JSON list.') {
        const why = `The AI did not answer with a JSON list, so its rewrites could not be matched to the items. Nothing was changed. It began: "${began(res.text)}". The Log tab has the whole answer.`;
        res.note(why, false);
        throw new Error(why);
    }
    const out = [];
    items.forEach((it, i) => {
        const raw = read.list[i];
        const txt = typeof raw === 'string' ? swapNames(tidy(raw).replace(/[.]+$/, '')).text : '';
        const text = txt || it.text;
        out.push({ id: it.id, was: it.text, text, changed: !!txt && txt.toLowerCase() !== String(it.text).toLowerCase() });
    });
    if (read.list.length !== items.length) res.note(`The AI sent back ${read.list.length} items for ${items.length}. Items with no answer were left as they were.`, read.list.length > 0, [read.how]);
    else res.note(`${out.filter(x => x.changed).length} of ${items.length} items were rewritten.`, true, [read.how]);
    if (!read.list.length) throw new Error(`The AI answered, but no items could be read from the answer. The Log tab has the whole answer.`);
    return out;
}

/**
 * Ask the model for a goal for the character, with repeatable actions and one-time steps.
 * Returns { goal, actions: [text], steps: [text] }.
 */
export async function writeGoal({ about, context }) {
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
        promptText('goalWriterRules'),
        '- [[char]] is the one who does it. [[user]] is only ever the one it is done to.',
        '- Use [[char]] and [[user]] with the double square brackets wherever a name is needed, and write real names nowhere. For pronouns of the character use [[char.they]], [[char.them]], [[char.their]].',
    ];
    { const story = contextText(context); if (story) lines.push('', STORY_LEAD, story); }
    lines.push('', ...writerRules());
    lines.push('', 'Return only a JSON object with the keys "goal", "actions" and "steps".');
    const res = await request({ operation:'writerGoal',authorization:'manual',what:'Write a goal',user:brackets(lines.join('\n')),tokens:1100 });
    const answer = res.text;
    const obj = parseJson(String(answer).slice(Math.max(0, String(answer).indexOf('{'))));
    const fix = t => swapNames(tidy(String(t ?? '')).replace(/[.]+$/, '')).text;
    const list = v => (Array.isArray(v) ? v : []).filter(x => typeof x === 'string').map(fix).filter(Boolean);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj) || !obj.goal) {
        const why = `The AI answered, but no goal could be read from the answer. It began: "${began(answer)}". The Log tab has the whole answer.`;
        res.note(why, false);
        throw new Error(why);
    }
    const goal = { goal: fix(obj.goal), actions: list(obj.actions), steps: list(obj.steps) };
    res.note(`A goal with ${goal.actions.length} repeatable actions and ${goal.steps.length} one-time steps was read.`, true);
    return goal;
}

/** Rewrite one version, keeping its meaning. Returns the new text. */
export async function rewriteVersion({ ins, text }) {
    const actors = instructionActors(ins);
    const targets = instructionTargets(ins);
    const direction = actors[0] === 'model' ? 'Rewrite this direction without changing what it asks for' : 'Reword this version and keep the same participants and action';
    const fixed = { ...ins, actors: actors.length === 1 ? actors : ['unspecified'], targets: targets.length === 1 ? targets : ['unspecified'] };
    const res = await writeVersions({ ins:fixed,seed:`${direction}: ${text}`,count:1,context:settings().writer.context,operation:'writerVersionRewrite' });
    return res[0];
}

export function nameHint() {
    const n = names();
    return `In this chat {{char}} is ${n.char} and {{user}} is ${n.user}.`;
}
