// The story so far, kept by the extension itself.
//  - Chapters: one AI request writes a summary of a stretch of replies. It is filed in the chat's story world as a
//    "chapter" entry and sent with the story notes. A chapter is cut when a scene ends, after a set number of
//    replies, or by hand.
//  - New chapter: a detailed summary and a new first message, then a brand new chat that carries everything over.
//  - Starter world: one AI request reads the character card, its lorebook and the greeting, and proposes entries.
import { ctx, KEY, LOG, names, parseJson } from './st.js';
import { request } from './ai.js';
import { settings, chatState, saveChatState } from './store.js';
import { addLog } from './log.js';
import { chatWorld, loadWorld, saveWorld, listWorld, newWorldEntry, writeWorldEntry, renderEntry, HUD_BLOCKS, WORLD_KINDS, DONE } from './world.js';
import { enqueue, worldIdle, attachChange, parseUpdate, applyOps, stripUpdateBlock, shownChanges, describeChange } from './worldflow.js';
import { goals, goalProgress, stepDone } from './goals.js';
import { writerRules } from './pacing.js';

const clean = t => String(t ?? '').replace(/\s+/g, ' ').trim();
const chatId = () => String(ctx().getCurrentChatId?.() || '');
const tidy = t => stripUpdateBlock(String(t ?? '')).replace(HUD_BLOCKS, ' ').replace(/<sent_instructions>[\s\S]*?<\/sent_instructions>/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/** The replies of this chat, in order: [{ n, index, time }]. The greeting is not a reply. */
function replies() {
    const out = [];
    const chat = ctx().chat || [];
    for (let i = 1; i < chat.length; i++) { const m = chat[i]; if (!m || m.is_user || m.is_system) continue; out.push({ n: out.length + 1, index: i, time: m.extra?.[KEY]?.time || 0 }); }
    return out;
}

/** The messages from reply `from` to reply `to` as text, oldest first, each cut to a sensible length. */
function storyText(from, to, limit = 24000) {
    const chat = ctx().chat || [];
    const list = replies();
    const start = from <= 1 ? 0 : (list.find(r => r.n === from - 1)?.index ?? -1) + 1;
    const end = list.find(r => r.n === to)?.index ?? chat.length - 1;
    const lines = [];
    for (let i = Math.max(0, start); i <= end && i < chat.length; i++) {
        const m = chat[i];
        if (!m || m.is_system || !m.mes) continue;
        const text = tidy(m.mes);
        if (text) lines.push(`${m.name}: ${text.length > 2500 ? `${text.slice(0, 2500)} [...]` : text}`);
    }
    let text = lines.join('\n\n');
    // When it is too long, the middle is left out so the start and the end of the stretch are both read.
    if (text.length > limit) text = `${text.slice(0, limit * 0.45)}\n\n[... part of this stretch is left out here ...]\n\n${text.slice(-limit * 0.5)}`;
    return text;
}

const chaptersOf = (list) => list.filter(w => w.kind === 'chapter' && w.on).sort((a, b) => (a.span?.to || 0) - (b.span?.to || 0) || a.uid - b.uid);
/** The last reply of this chat that a chapter covers. */
export function coveredUpTo(list) {
    const id = chatId();
    return Math.max(0, ...list.filter(w => w.kind === 'chapter' && w.span?.chat === id).map(w => w.span.to));
}

/** Is SillyTavern's own Summarize adding a summary to the prompt in this chat? */
export function otherSummaryOn() {
    try {
        const prompts = ctx().extensionPrompts || {};
        return Object.entries(prompts).some(([key, v]) => /memory|summar/i.test(key) && !/roleplay/i.test(key) && String(v?.value || '').trim());
    } catch { return false; }
}

// ---------- chapters ----------

let busy = false;
export const chapterBusy = () => busy;

function chapterPrompt(text, earlier) {
    const lines = [
        'Write the summary of one part of a roleplay story, for the story\'s own notes.',
        '',
    ];
    if (earlier.length) lines.push('Earlier parts, for context only:', ...earlier.map(w => `- ${renderEntry(w, { full: false })}`), '');
    lines.push('The part to summarise, oldest message first:', '"""', text, '"""', '',
        'Return these keys:',
        '- "title": a short plain title for this part, 3 to 6 words.',
        '- "when": when it took place in the story, in a few words. An empty string when the text does not say.',
        '- "summary": what happened, in the past tense, 80 to 160 words. Who did what, what was said that matters, what changed, and what each person wants at the end. Plain statements of fact in literal words.',
        '- "people": a list of the names of the people who took part.',
        '- "places": a list of the names of the places.',
        '- "settled": one sentence on what was settled or came out in this part. An empty string when nothing was.',
        '',
        'Return only a JSON object with the keys "title", "when", "summary", "people", "places", "settled".');
    return lines.join('\n');
}

/** One finished entry as a line inside a chapter. */
function finishedLine(x) {
    const f = x.fields;
    const end = t => (/[.!?]$/.test(clean(t)) ? clean(t) : `${clean(t)}.`);
    if (x.kind === 'thread') return end(`The thread "${x.name}" was settled${clean(f.latest) ? `: ${clean(f.latest)}` : ''}`);
    if (x.kind === 'secret') return end(`A secret came out${clean(f.holder) ? ` about ${clean(f.holder)}` : ''}: ${clean(f.secret) || x.name}`);
    if (x.kind === 'seed') return end(`The planted detail "${x.name}" paid off`);
    return end(`"${x.name}" finished${clean(f.step) ? `: ${clean(f.step)}` : ''}`);
}

const asList = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string').map(clean).filter(Boolean).join(', ') : clean(v));

/**
 * Write one chapter for replies from..to and file it. why: shown in the Log. Returns the entry's name, or throws.
 * The AI request runs outside the world queue, so the next reply is never kept waiting for it.
 */
export async function writeChapter(from, to, why) {
    if (busy) throw new Error('A chapter is already being written.');
    const wid = chatWorld();
    const chat = chatId();
    if (!wid) throw new Error('This chat has no story world to keep chapters in.');
    busy = true;
    try {
        await worldIdle();
        const before = await loadWorld(wid);
        const text = storyText(from, to);
        if (!text) throw new Error('There is nothing to summarise yet.');
        const earlier = chaptersOf(listWorld(before, wid)).slice(-3);
        const res = await request({ what: 'Write a chapter of the story so far', system: 'You keep the story notes of a roleplay. You answer with JSON only.', user: chapterPrompt(text, earlier), tokens: 700, profileId: settings().profileId });
        const answer = String(res.text);
        const obj = parseJson(answer.slice(Math.max(0, answer.indexOf('{'))));
        if (!obj || typeof obj !== 'object' || Array.isArray(obj) || !clean(obj.summary)) {
            const msg = `The AI answered, but no summary could be read from the answer. It began: "${clean(answer).slice(0, 140)}". The Log tab has the whole answer.`;
            res.note(msg, false);
            throw new Error(msg);
        }
        if (chatId() !== chat) { res.note('The chat changed while the chapter was being written, so it was not filed.', false); throw new Error('The chat changed while the chapter was being written.'); }
        let name = '';
        let moved = 0;
        await enqueue(async () => {
            const data = await loadWorld(wid);
            const w = newWorldEntry(data, 'chapter');
            Object.assign(w, { name: clean(obj.title) || `Replies ${from} to ${to}`, auto: true, at: { chat, n: to }, span: { chat, from, to } });
            Object.assign(w.fields, { summary: clean(obj.summary), when: clean(obj.when), people: asList(obj.people), places: asList(obj.places), settled: clean(obj.settled) });
            // What is finished moves into the chapter: it is written into it in one line each and turned off, so the
            // world holds what is still open. Entries set to "keep it as I wrote it" are left alone.
            const retired = settings().summary.retire === false ? [] : listWorld(data, wid).filter(x => x.on && !x.locked && (x.kind === 'secret' ? x.status === 'out' : DONE[x.kind] && x.status === DONE[x.kind]));
            if (retired.length) w.fields.closed = retired.map(finishedLine).join(' ');
            writeWorldEntry(data, w, wid);
            for (const x of retired) { x.on = false; writeWorldEntry(data, x, wid); }
            await saveWorld(wid, data);
            name = w.name;
            moved = retired.length;
            // The chapter belongs to the last reply it covers: delete or swipe away that reply and the chapter goes too,
            // and what was moved into it is turned back on.
            const last = replies().find(r => r.n === to);
            if (last?.time) {
                attachChange(last.time, wid, { uid: w.uid, name: w.name, kind: 'chapter', type: 'create' });
                for (const x of retired) attachChange(last.time, wid, { uid: x.uid, name: x.name, kind: x.kind, type: 'off', into: w.name });
            }
        });
        res.note(`Chapter "${name}" covers replies ${from} to ${to} (${why}). It is in the story world and is sent with the story notes.${moved ? ` ${moved} finished ${moved === 1 ? 'entry was' : 'entries were'} written into it and turned off.` : ''}`, true);
        await rollUpIfNeeded().catch(e => console.warn(LOG, 'roll-up', e));
        return name;
    } finally { busy = false; }
}

/** After a reply: is a chapter due? Runs by itself in the background. replyNo: the number of the reply just written. */
export function chapterAfterReply(time, replyNo, onDone) {
    const o = settings().summary;
    if (!o.on || busy) return;
    worldIdle().then(async () => {
        const wid = chatWorld();
        if (!wid || busy) return;
        const rec = (ctx().chat || []).map(m => m?.extra?.[KEY]).find(r => r && String(r.time) === String(time));
        if (!rec) return;
        const data = await loadWorld(wid).catch(() => null);
        if (!data) return;
        const since = replyNo - coveredUpTo(listWorld(data, wid));
        const min = Math.max(1, Math.round(Number(o.minReplies) || 1));
        const every = Math.max(0, Math.round(Number(o.every) || 0));
        let why = '';
        if (o.onSceneEnd && rec.update?.ended && since >= min) why = 'the scene ended';
        else if (every && since >= every) why = `${every} replies went by`;
        if (!why) return;
        try { await writeChapter(replyNo - since + 1, replyNo, why); onDone?.(); }
        catch (e) { console.warn(LOG, 'chapter', e); }
    }).catch(e => console.warn(LOG, 'chapter', e));
}

/** "Write a chapter now": everything since the last chapter. */
export async function writeChapterNow() {
    const wid = chatWorld();
    if (!wid) throw new Error('This chat has no story world to keep chapters in.');
    const data = await loadWorld(wid);
    const list = replies();
    const to = list.length;
    const from = coveredUpTo(listWorld(data, wid)) + 1;
    if (to < from) throw new Error('Every reply of this chat is already in a chapter.');
    return writeChapter(from, to, 'you asked for it');
}

/** When a chat has more chapters than the setting allows, the older ones are combined into one. One AI request. */
async function rollUpIfNeeded() {
    const o = settings().summary;
    const max = Math.max(2, Math.round(Number(o.roll) || 8));
    const keep = Math.max(1, Math.round(Number(o.keep) || 2));
    const wid = chatWorld();
    const chat = chatId();
    if (!wid) return;
    const data = await loadWorld(wid);
    const all = chaptersOf(listWorld(data, wid));
    const mine = all.filter(w => !w.rollup && w.span?.chat === chat);
    if (mine.length <= max) return;
    const old = mine.slice(0, mine.length - keep);
    const prior = all.find(w => w.rollup) || null;
    const parts = [...(prior ? [prior] : []), ...old];
    const user = [
        'Combine these summaries of the earlier parts of a roleplay story into one account of the story so far.',
        '', ...parts.map(w => `- ${renderEntry(w)}`), '',
        'Return these keys:',
        '- "summary": the story so far in the past tense, in order, 200 to 350 words. Who the people are, what happened, what was settled, and what each person wants now. Plain statements of fact in literal words.',
        '- "people": a list of the names of the people in it.',
        '- "places": a list of the names of the places.',
        '', 'Return only a JSON object with the keys "summary", "people", "places".',
    ].join('\n');
    const res = await request({ what: 'Combine the older chapters into one', system: 'You keep the story notes of a roleplay. You answer with JSON only.', user, tokens: 900, profileId: settings().profileId });
    const answer = String(res.text);
    const obj = parseJson(answer.slice(Math.max(0, answer.indexOf('{'))));
    if (!obj || !clean(obj.summary)) { res.note('No combined summary could be read from the answer, so the chapters were left as they are.', false); return; }
    await enqueue(async () => {
        const d = await loadWorld(wid);
        const now = listWorld(d, wid);
        const roll = now.find(w => w.kind === 'chapter' && w.rollup) || Object.assign(newWorldEntry(d, 'chapter'), { name: 'Before the latest chapters', rollup: true, auto: true });
        Object.assign(roll.fields, { summary: clean(obj.summary), people: asList(obj.people), places: asList(obj.places) });
        roll.span = { chat, from: 1, to: old[old.length - 1].span.to };
        delete roll.isNew;
        writeWorldEntry(d, roll, wid);
        // The chapters that went into it: automatic ones are removed, ones you saved yourself are switched off.
        for (const w of old) { const cur = now.find(x => x.uid === w.uid); if (!cur) continue; if (cur.auto) delete d.entries[cur.uid]; else { cur.on = false; writeWorldEntry(d, cur, wid); } }
        await saveWorld(wid, d);
    });
    res.note(`${old.length} older chapters were combined into "Before the latest chapters". The newest ${keep} stay as they are.`, true);
}

// ---------- New chapter: carry the story into a brand new chat ----------

/** One AI request: a detailed summary of the story so far and a first message for the new chat. wish: optional, from the user. */
export async function draftNewChapter(wish = '') {
    const wid = chatWorld();
    const n = names();
    const parts = [];
    if (wid) {
        const data = await loadWorld(wid).catch(() => null);
        const list = data ? listWorld(data, wid).filter(w => w.on) : [];
        const ch = chaptersOf(list);
        if (ch.length) parts.push('Chapters written so far, oldest first:', ...ch.map(w => `- ${renderEntry(w)}`), '');
        const facts = list.filter(w => w.kind !== 'chapter' && !(w.kind === 'secret' && w.status === 'kept' && w.show !== 'full'));
        if (facts.length) parts.push('What the story notes hold:', ...facts.slice(0, 60).map(w => `- [${WORLD_KINDS[w.kind].label}] ${renderEntry(w)}`), '');
        const from = coveredUpTo(list) + 1;
        const to = replies().length;
        if (to >= from) parts.push('The story since the last chapter, oldest message first:', '"""', storyText(from, to, 20000), '"""', '');
    } else {
        parts.push('The story, oldest message first:', '"""', storyText(1, replies().length, 26000), '"""', '');
    }
    const user = [
        `A roleplay story is moving into a new chat. The main character is ${n.char}. The other person is ${n.user}. Write two things.`,
        '',
        'SUMMARY: a very detailed account of the story so far, 300 to 500 words, in the past tense and in order. Who the people are, what happened, what was said that matters, what each person wants and knows at the end, what is still open, and where everyone is at the end. Plain statements of fact in literal words.',
        '',
        `FIRST MESSAGE: the opening message of the new chat, 150 to 300 words, written as the story has been written (the same person, tense and voice as the most recent replies). It picks up from where the story stands at the end of the summary. People other than ${n.user} act and speak in it, and it ends on something for ${n.user} to respond to. ${n.user}'s words, choices and thoughts are left for ${n.user} to write.`,
        clean(wish) ? `\nWhat the user wants for the new chapter: ${clean(wish)}` : '',
        '', 'For the first message only:', ...writerRules(),
        '', ...parts,
        'Answer in exactly this form, with these two headings in capitals and nothing before the first one:',
        'SUMMARY:', '(the summary)', '', 'FIRST MESSAGE:', '(the first message)',
    ].join('\n');
    const res = await request({ what: 'Write a new chapter (summary and first message)', system: 'You continue a roleplay story into a new chat. You follow the form you are given.', user, tokens: 1800, profileId: settings().profileId });
    const answer = String(res.text);
    const m = answer.match(/SUMMARY\s*:\s*([\s\S]*?)\n\s*FIRST MESSAGE\s*:\s*([\s\S]*)$/i);
    if (!m || !clean(m[1]) || !clean(m[2])) {
        const msg = `The AI answered, but the two parts could not be told apart. The answer began: "${clean(answer).slice(0, 140)}". The Log tab has the whole answer.`;
        res.note(msg, false);
        throw new Error(msg);
    }
    res.note('A summary and a first message were read. Nothing changes until you start the new chat.', true);
    return { summary: m[1].trim(), first: m[2].trim() };
}

/** What has already happened for good in this chat ("only once" instructions, retired story event items), to carry over. */
function burnedHere(burnedSoFar) {
    const b = burnedSoFar();
    return { keys: [...b.keys], ids: Object.fromEntries([...b.ids].map(([k, set]) => [k, [...set]])) };
}

/**
 * Start a brand new chat for the same character that carries the story over. The chat you are in is left as it is.
 * draft: { summary, first }. burnedSoFar: from the engine. Returns the name of the summary entry.
 */
export async function startNewChapter(draft, burnedSoFar) {
    const c = ctx();
    const cs = chatState();
    if (!cs) throw new Error('No chat is open.');
    const summary = String(draft.summary || '').trim();
    const first = String(draft.first || '').trim();
    if (!summary || !first) throw new Error('The summary and the first message both need some text.');
    await worldIdle();
    const wid = chatWorld();
    const oldChat = chatId();
    // 1. What travels with the story.
    const g = goals();
    const p = goalProgress('normal');
    const carry = {
        activeSets: [...cs.activeSets], world: wid, presets: structuredClone(cs.presets), locks: structuredClone(cs.locks),
        used: structuredClone(cs.used), picks: structuredClone(cs.picks), pronouns: cs.pronouns ? structuredClone(cs.pronouns) : undefined,
        goals: g ? { ...structuredClone(g), steps: g.steps.map(s => ({ ...s, doneManual: stepDone(s, p) || !!s.doneManual })) } : undefined,
        burned: burnedHere(burnedSoFar),
        chapterOf: oldChat,
    };
    // 2. The summary becomes the account of everything before the new chat.
    let name = '';
    if (wid) {
        await enqueue(async () => {
            const d = await loadWorld(wid);
            const now = listWorld(d, wid);
            const roll = now.find(w => w.kind === 'chapter' && w.rollup) || Object.assign(newWorldEntry(d, 'chapter'), { rollup: true });
            Object.assign(roll, { name: 'The story before this chat', auto: false, on: true });
            Object.assign(roll.fields, { summary, when: '', settled: '' });
            roll.span = { chat: oldChat, from: 1, to: replies().length };
            delete roll.isNew;
            writeWorldEntry(d, roll, wid);
            await saveWorld(wid, d);
            name = roll.name;
        });
    }
    // 3. The new chat.
    await c.executeSlashCommandsWithOptions('/newchat');
    for (let i = 0; i < 100 && (chatId() === oldChat || !chatId()); i++) await new Promise(r => setTimeout(r, 100));
    if (chatId() === oldChat) throw new Error('The new chat did not open. The chat you are in is unchanged.');
    const ncs = chatState();
    for (const [k, v] of Object.entries(carry)) if (v !== undefined) ncs[k] = v;
    // With no story world, the summary travels in the new chat itself and is sent with every reply.
    if (!wid) ncs.carried = summary;
    saveChatState();
    try { await c.saveMetadata?.(); } catch { /* saved with the next change */ }
    // 4. The first message replaces the card's greeting.
    const chat = c.chat || [];
    const head = chat[0] && !chat[0].is_user ? chat[0] : null;
    if (head) {
        head.mes = first;
        head.swipes = [first]; head.swipe_id = 0; head.swipe_info = [];
        if (head.extra && typeof head.extra === 'object') delete head.extra.display_text;
    } else {
        chat.unshift({ name: names().char, is_user: false, is_system: false, send_date: new Date().toISOString(), mes: first, extra: {} });
    }
    try { await c.saveChat?.(); } catch { /* saved with the next change */ }
    try { await c.reloadCurrentChat?.(); } catch { /* the chat is redrawn the next time it is opened */ }
    addLog({ what: 'New chapter', ok: true, result: `A new chat was started. It carries ${carry.activeSets.length} ${carry.activeSets.length === 1 ? 'set' : 'sets'} that were on${wid ? ', the story world' : ''}${g?.on ? ', the goal' : ''}, the pronouns, what has already happened for good, the summary and the first message. The chat you were in is unchanged.`, details: [], got: '' });
    return name;
}

// ---------- starter world ----------

/** The card's own lorebook entries, as short lines. */
async function cardLore() {
    const c = ctx();
    const out = [];
    try {
        const ch = c.characters?.[c.characterId];
        const book = ch?.data?.character_book?.entries;
        const add = (title, content) => { const t = clean(content); if (t) out.push(`- ${clean(title) || 'Entry'}: ${t.length > 400 ? `${t.slice(0, 400)}...` : t}`); };
        if (Array.isArray(book)) for (const e of book.slice(0, 40)) add(e.comment || e.name || (e.keys || []).join(', '), e.content);
        const linked = ch?.data?.extensions?.world;
        if (!out.length && linked) { const d = await c.loadWorldInfo(linked).catch(() => null); for (const e of Object.values(d?.entries || {}).slice(0, 40)) if (!e.extensions?.ri) add(e.comment || (e.key || []).join(', '), e.content); }
    } catch { /* no lorebook on the card */ }
    return out.join('\n').slice(0, 8000);
}

/** One AI request that proposes entries for a new world. Returns { ops, lines } for review. Nothing is saved. */
export async function draftStarterWorld() {
    const c = ctx();
    const n = names();
    const f = c.getCharacterCardFields?.() || {};
    const fill = t => { try { return c.substituteParams(String(t ?? '')); } catch { return String(t ?? ''); } };
    const greeting = tidy((c.chat || [])[0]?.mes || '');
    const lore = await cardLore();
    const material = [
        f.description ? `Character description: ${fill(f.description)}` : '',
        f.personality ? `Character personality: ${fill(f.personality)}` : '',
        f.scenario ? `Scenario: ${fill(f.scenario)}` : '',
        f.persona ? `About ${n.user}: ${fill(f.persona)}` : '',
        lore ? `The character's own lorebook:\n${lore}` : '',
        greeting ? `The opening message of this chat:\n${greeting}` : '',
    ].filter(Boolean).join('\n\n').slice(0, 26000);
    if (!material) throw new Error('The character card and the chat have nothing to read yet.');
    const user = [
        `Set up the story notes for a roleplay. The main character is ${n.char}. The other person is ${n.user}.`,
        'Read the material and write one line for each thing it establishes, in exactly this form, one item per line:',
        'person: Name | their role in the story | who they are (personality and background, in two or three plain facts)',
        'wants: Name | what they want',
        'knows: Name | something they know that matters',
        'place: Name | what it is',
        'group: Name | what it is',
        'thread: Short title | a matter that is open at the start of the story',
        'secret: Short title | whose secret | the secret',
        'planted: Short title | a small detail that can matter later',
        'elsewhere: Short title | who | what they are doing away from the scene',
        '',
        `Rules: write only what the material says. Plain statements of fact in literal words. Use the names the material uses. Include ${n.char}. Leave out ${n.user}. 25 lines at most.`,
        '', 'The material:', '"""', material, '"""', '',
        'Answer with the lines inside one <story_update> block and nothing else.',
    ].join('\n');
    const res = await request({ what: 'Fill a story world from the character card', system: 'You set up the story notes of a roleplay. You follow the form you are given.', user, tokens: 1400, profileId: settings().profileId });
    const answer = String(res.text);
    const parsed = parseUpdate(/<story_update/i.test(answer) ? answer : `<story_update>\n${answer}\n</story_update>`);
    if (!parsed.ops.length) {
        const msg = `The AI answered, but no lines in the asked form could be read. The answer began: "${clean(answer).slice(0, 140)}". The Log tab has the whole answer.`;
        res.note(msg, false);
        throw new Error(msg);
    }
    res.note(`${parsed.ops.length} lines were read. Nothing is saved until you add them.`, true);
    return { ops: parsed.ops, lines: parsed.ops.map(o => `${o.k}: ${[o.a, o.b, o.c].filter(Boolean).join(' | ')}`) };
}

/** Add reviewed starter lines to this chat's world. Returns what was added, in plain words. */
export function addStarterWorld(ops) {
    let out = [];
    return enqueue(async () => {
        const wid = chatWorld();
        if (!wid) throw new Error('This chat has no story world.');
        const data = await loadWorld(wid);
        const changes = applyOps(data, wid, ops, { chat: chatId(), n: 0 }, 'all', 60);
        if (changes.length) await saveWorld(wid, data);
        out = shownChanges(changes).map(describeChange);
        addLog({ what: 'Story world update', ok: true, result: `${out.length} ${out.length === 1 ? 'change was' : 'changes were'} made from the character card.`, details: out, got: '' });
    }).then(() => out);
}
