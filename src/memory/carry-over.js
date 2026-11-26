// Continue in a new chat (memory DESIGN 8.3, MB9). The story's canon and its current state move into a carry-over book bound to
// the fresh chat; the old chat's habits stay behind.
//
//   1. Code collects what the story holds now: the current-state set, open threads, the chapter view, stat sheets and the alias
//      table, all from the records, never from message text.
//   2. One Writer call turns those records into a synopsis and, when you ask, an opening message. The prompt carries no
//      message text and no evidence quote.
//   3. Code drops every sentence of the synopsis, the opening and the book that shares a run of eight words with the parent's
//      last 50 replies, then writes the book "RI Carry-over, <new chat name>" through the shared book writer (book-writer.js):
//      a Constant synopsis; one entry per main character; keyword entries for facts, places, items and open threads, keyed by
//      subject and aliases; secrets with their holders in a fixed last line ("Known to: Hale, Brannic."); stat sheets as
//      disabled entries with their locks; a disabled first entry that names the parent chat and the message the book reflects.
//   4. The book is bound to the new chat (SillyTavern's chat book), "Recall manages this book" is on for it, and the stat
//      sheets start in the new chat's records, locked where they were locked in the parent.
// The parent chat is not changed. Extra model calls: one Writer call, the one the design names, and nothing else.
import { MEMORY, chatMemory, fold as foldChat, proseOf, storedMark } from './fold.js';
import { strictSchema } from './capture.js';
import { moodHits, REGISTER_EXAMPLE, REGISTER_RULE, tokensOf } from './story-so-far.js';
import { createBookWriter, safeBookName } from './book-writer.js';

export const RUN = 8;
export const LAST_REPLIES = 50;
const CAPS = Object.freeze({ people: 12, facts: 100, threads: 20, secrets: 40, chapters: 2, condensed: 1800 });

const clean = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const list = value => (Array.isArray(value) ? value : []).map(clean).filter(Boolean);
const isReply = m => !!m && !m.is_user && typeof m.mes === 'string' && !m.extra?.ri_chapter_view && (!m.is_system || (!m.extra?.type && m.role !== 'tool'));

// ---------------------------------------------------------------- habits: the eight-word run

/** The words of a text as the run check reads them: letters and digits, folded to lower case, apostrophes dropped. */
export const wordsOf = text => String(text ?? '').normalize('NFKC').toLowerCase().replace(/['’`]/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Every run of n words in the parent's last 50 replies, as a set of strings. */
export function replyRuns(chat, { last = LAST_REPLIES, n = RUN } = {}) {
    const replies = (chat || []).filter(isReply).slice(-last);
    const runs = new Set();
    for (const message of replies) {
        const words = wordsOf(proseOf(message));
        for (let i = 0; i + n <= words.length; i++) runs.add(words.slice(i, i + n).join(' '));
    }
    return runs;
}

/** The first run of n words of `text` that is in `runs`, with the index of its first word, or null. */
export function firstSharedRun(text, runs, n = RUN) {
    const words = wordsOf(text);
    for (let i = 0; i + n <= words.length; i++) if (runs.has(words.slice(i, i + n).join(' '))) return { at: i, run: words.slice(i, i + n).join(' ') };
    return null;
}
export const sharesRun = (text, runs, n = RUN) => !!firstSharedRun(text, runs, n);

const sentencesOf = text => String(text ?? '').split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);

/**
 * The text without any sentence that shares a run of n words with the parent's replies. A run that spans two sentences drops
 * the sentence that holds its last word, then the rest is checked again. Returns { text, dropped }.
 */
export function dropSharedSentences(text, runs, n = RUN) {
    let kept = sentencesOf(text);
    const dropped = [];
    for (let guard = 0; guard < 500; guard++) {
        const hit = firstSharedRun(kept.join(' '), runs, n);
        if (!hit) break;
        // find the sentence that holds the last word of the run
        let seen = 0, at = kept.length - 1;
        for (let i = 0; i < kept.length; i++) { seen += wordsOf(kept[i]).length; if (seen >= hit.at + n) { at = i; break; } }
        dropped.push(kept[at]);
        kept = kept.filter((_, i) => i !== at);
    }
    return { text: kept.join(' '), dropped };
}

/** A sentence-by-sentence report scrub (no mood outside a stated line) followed by the run check. */
export function scrub(text, runs, { register = true } = {}) {
    const sentences = sentencesOf(text).filter(s => !register || !moodHits(s).length);
    const out = dropSharedSentences(sentences.join(' '), runs);
    const total = sentencesOf(text).length;
    return { text: out.text, dropped: out.dropped, moods: total - sentences.length };
}

// ---------------------------------------------------------------- what the story holds now

const FACT_KINDS = new Set(['fact', 'place', 'item', 'reputation', 'achievement']);
const FEELING = new Set(['emotion', 'relationship']);
const byImportance = (a, b) => (b.importance || 5) - (a.importance || 5);

/**
 * Collect the current-state set from the fold (3.3): the people with their traits and state, facts, places and items, open
 * threads, secrets with holders, stat sheets with their locks, the alias table and the chapter view. No message text.
 */
export function collect({ chat, meta, result = foldChat(chat, meta), names = {}, key = '' } = {}) {
    const current = (result?.current || []).filter(r => r.status !== 'suspect');
    const people = current.filter(r => r.kind === 'person').sort(byImportance).slice(0, CAPS.people);
    const nameSet = person => new Set([person.subject, ...(person.aliases || [])].map(n => clean(n).toLowerCase()));
    const characters = people.map(person => {
        const mine = nameSet(person);
        const about = r => mine.has(clean(r.subject).toLowerCase()) || mine.has(clean(r.other).toLowerCase());
        return {
            id: person.id, name: person.subject, aliases: list(person.aliases), text: clean(person.text),
            traits: current.filter(r => r.kind === 'trait' && about(r)).map(r => clean(r.text)).slice(0, 8),
            state: current.filter(r => r.kind === 'emotion' && about(r)).map(r => clean(r.text)).slice(0, 4),
            standing: current.filter(r => r.kind === 'relationship' && about(r)).map(r => clean(r.text)).slice(0, 6),
            items: current.filter(r => r.kind === 'item' && mine.has(clean(r.holder).toLowerCase())).map(r => clean(r.text)).slice(0, 6),
        };
    });
    const placed = new Set(characters.map(c => c.id));
    const facts = current.filter(r => FACT_KINDS.has(r.kind) && !placed.has(r.id)).sort(byImportance).slice(0, CAPS.facts)
        .map(r => ({ id: r.id, kind: r.kind, subject: clean(r.subject), aliases: list(r.aliases), text: clean(r.text), outcome: clean(r.outcome) }));
    const threads = current.filter(r => r.kind === 'thread' && r.status !== 'done' && r.status !== 'failed').sort(byImportance).slice(0, CAPS.threads)
        .map(r => ({ id: r.id, type: r.threadType || 'Open', subject: clean(r.subject), aliases: list(r.aliases), text: clean(r.text), endsWhen: clean(r.endsWhen), paused: !!r.paused }));
    const secrets = current.filter(r => r.kind === 'secret').sort(byImportance).slice(0, CAPS.secrets)
        .map(r => ({ id: r.id, subject: clean(r.subject), aliases: list(r.aliases), text: clean(r.text), holders: list(r.holders), believes: clean(r.believes) }));
    const sheets = current.filter(r => r.kind === 'stat sheet').map(r => ({ id: r.id, subject: clean(r.subject), text: clean(r.text), locked: !!r.locked, locks: list(r.locks) }));
    const groups = current.map(r => [r.subject, ...(r.aliases || [])].map(clean).filter(Boolean)).filter(g => g.length > 1);
    const chapters = current.filter(r => r.kind === 'chapter');
    const condensed = current.find(r => r.kind === 'condensed');
    const last = [...(chat || [])].reverse().find(isReply);
    const scene = last?.extra?.[key]?.tracker?.scene || null;
    const plain = value => (value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'v') ? value.v : value);
    return {
        characters, facts, threads, secrets, sheets, aliases: groups,
        chapters: chapters.slice(-CAPS.chapters).map(r => ({ title: clean(r.title || r.subject), text: clean(r.text), when: r.when || null })),
        condensed: condensed ? clean(condensed.text).slice(0, CAPS.condensed) : '',
        chapterCount: chapters.length,
        scene: scene ? { place: clean(plain(scene.place)), time: clean(plain(scene.time)), present: list([].concat(plain(scene.present) || [])) } : null,
        names,
    };
}

/**
 * The collected records with every sentence that shares a run of eight words with the parent's replies taken out, so the
 * Writer is never shown wording the old chat used (a record that copied a reply sentence word for word loses that sentence).
 */
export function cleanData(data, runs) {
    const t = value => dropSharedSentences(value, runs).text;
    const all = values => values.map(t).filter(Boolean);
    return {
        ...data,
        characters: data.characters.map(c => ({ ...c, text: t(c.text), traits: all(c.traits), state: all(c.state), standing: all(c.standing), items: all(c.items) })),
        facts: data.facts.map(f => ({ ...f, text: t(f.text), outcome: t(f.outcome) })).filter(f => f.text),
        threads: data.threads.map(x => ({ ...x, text: t(x.text), endsWhen: t(x.endsWhen) })).filter(x => x.text),
        secrets: data.secrets.map(s => ({ ...s, text: t(s.text), believes: t(s.believes) })).filter(s => s.text),
        chapters: data.chapters.map(c => ({ ...c, text: t(c.text) })),
        condensed: t(data.condensed),
    };
}

// ---------------------------------------------------------------- the Writer call

export const SYNOPSIS_SCHEMA = Object.freeze({
    name: 'carry_over',
    value: strictSchema({ type: 'object', required: ['synopsis', 'opening'], properties: { synopsis: { type: 'string' }, opening: { type: 'string' } } }),
    read: { type: 'object', required: ['synopsis'], properties: { synopsis: { type: 'string' }, opening: { type: 'string' } } },
});

export const SYNOPSIS_SYSTEM = 'You carry a roleplay story into a new chat. You read the stored records of the story so far and answer with one JSON object only.';

const lines = (title, rows) => (rows.length ? `${title}\n${rows.join('\n')}` : '');

/** The request of the one Writer call. The prompt holds records and chapter accounts, never message text. */
export function synopsisRequest(data, { opening = false, wish = '' } = {}) {
    const people = data.characters.map(c => `- ${c.name}${c.aliases.length ? ` (also: ${c.aliases.join(', ')})` : ''}: ${c.text}${c.traits.length ? ` Traits: ${c.traits.join('; ')}.` : ''}${c.standing.length ? ` Standing: ${c.standing.join('; ')}.` : ''}${c.state.length ? ` State: ${c.state.join('; ')}.` : ''}`);
    const user = [
        `The main character is ${data.names.char || 'the character'}. The other person is ${data.names.user || 'the player'}. A new chat continues this story.`,
        data.scene && (data.scene.place || data.scene.time) ? `Scene at the end of the old chat: ${[data.scene.place && `place ${data.scene.place}`, data.scene.time && `time ${data.scene.time}`, data.scene.present.length && `present ${data.scene.present.join(', ')}`].filter(Boolean).join('; ')}.` : '',
        data.condensed ? `The condensed account of the earlier chapters:\n${data.condensed}` : '',
        lines('The newest chapters:', data.chapters.map(c => `- "${c.title}": ${c.text}`)),
        lines('People:', people),
        lines('Facts, places and items:', data.facts.slice(0, 40).map(f => `- ${f.subject}: ${f.text}`)),
        lines('Open threads:', data.threads.map(t => `- ${t.subject} (${t.type}): ${t.text}${t.endsWhen ? ` Ends when ${t.endsWhen}.` : ''}`)),
        wish ? `What the player wants from the new chat: ${clean(wish)}` : '',
        [
            'Return one JSON object with two keys.',
            `- "synopsis": 200 to 350 words, the story so far in plain data voice for a reader who has not seen the old chat. ${REGISTER_RULE} For example: "${REGISTER_EXAMPLE}" Do not quote any message, do not give example dialogue, and do not copy the wording of the records; restate them. Name no secret in it.`,
            opening ? `- "opening": the first message of the new chat, written as ${data.names.char || 'the character'}, 120 to 250 words, starting from the scene above. Use plain direct prose and your own wording. Do not reuse phrases, openers, gestures or sentence rhythms from the old chat's replies; none of them are shown to you. It must not write ${data.names.user || 'the player'}'s actions or words.` : '- "opening": an empty string.',
        ].join('\n'),
    ];
    return { system: SYNOPSIS_SYSTEM, user: user.filter(Boolean).join('\n\n'), schema: SYNOPSIS_SCHEMA.value, read: SYNOPSIS_SCHEMA.read };
}

/** Read the Writer's answer: scrub both texts for mood and for eight-word runs. Returns { synopsis, opening, dropped }. */
export function readSynopsis(value, runs) {
    const synopsis = scrub(value?.synopsis, runs);
    const opening = clean(value?.opening) ? scrub(value.opening, runs, { register: false }) : { text: '', dropped: [] };
    return { synopsis: synopsis.text, opening: wordsOf(opening.text).length >= 40 ? opening.text : '', dropped: [...synopsis.dropped, ...opening.dropped], moods: synopsis.moods };
}

// ---------------------------------------------------------------- the book

const KIND_WORDS = { fact: 'Fact', place: 'Place', item: 'Item', reputation: 'Reputation', achievement: 'Achievement' };
export const bookNameFor = childName => safeBookName(`RI Carry-over, ${childName}`);

/**
 * The entries of the carry-over book, in the order they are shown. Every text goes through the run check; an entry with no
 * text left is not written. leaveSecretsOut leaves the secrets and the entries of stat sheets out of the book.
 */
export function bookEntries(data, synopsis, runs, { leaveSecretsOut = false } = {}) {
    const entries = [];
    const dropped = [];
    const text = (value, register = true) => { const out = scrub(value, runs, { register }); dropped.push(...out.dropped); return out.text; };
    const keys = (...names) => [...new Set(names.flat().map(clean).filter(Boolean))];
    if (clean(synopsis)) entries.push({ id: 'synopsis', comment: 'Story so far', content: clean(synopsis), constant: true, key: [], order: 10, position: 1 });
    data.characters.forEach((c, i) => {
        const body = [text(c.text), c.traits.length ? text(`Traits: ${c.traits.join('; ')}.`) : '', c.standing.length ? text(`Standing: ${c.standing.join('; ')}.`, false) : '',
            c.state.length ? text(`Current state: ${c.state.join('; ')}.`, false) : '', c.items.length ? text(`Carries: ${c.items.join('; ')}.`) : ''].filter(Boolean).join('\n');
        if (body) entries.push({ id: `person:${c.id}`, comment: `Character: ${c.name}`, content: body, key: keys(c.name, c.aliases), order: 20 + i, record: c.id });
    });
    data.facts.forEach((f, i) => {
        const body = text([f.text, f.outcome && `Outcome: ${f.outcome}`].filter(Boolean).join(' '));
        if (body) entries.push({ id: `record:${f.id}`, comment: `${KIND_WORDS[f.kind] || 'Fact'}: ${f.subject || f.id}`, content: body, key: keys(f.subject, f.aliases), order: 200 + i, record: f.id });
    });
    data.threads.forEach((t, i) => {
        const body = text(`${t.text}${t.endsWhen ? ` Ends when ${t.endsWhen}.` : ''}${t.paused ? ' Set aside for now.' : ''}`);
        if (body) entries.push({ id: `thread:${t.id}`, comment: `Thread: ${t.subject || t.id}`, content: body, key: keys(t.subject, t.aliases), order: 400 + i, record: t.id });
    });
    if (!leaveSecretsOut) {
        data.secrets.forEach((s, i) => {
            const body = text(`${s.text}${s.believes ? ` The holder believes: ${s.believes}.` : ''}`);
            // the fixed last line the holder rule reads (search.js loreHolderOk)
            if (body) entries.push({ id: `secret:${s.id}`, comment: `Secret: ${s.subject || s.id}`, content: `${body}\nKnown to: ${s.holders.length ? s.holders.join(', ') : 'everyone'}.`, key: keys(s.subject, s.aliases), order: 600 + i, record: s.id });
        });
        data.sheets.forEach((s, i) => {
            const locked = s.locks.length ? `Locked: ${s.locks.join(', ')}.` : s.locked ? 'Locked: all.' : '';
            entries.push({ id: `sheet:${s.id}`, comment: `Stats: ${s.subject}`, content: [s.text, locked].filter(Boolean).join('\n'), key: [], disable: true, order: 800 + i, record: s.id });
        });
    }
    return { entries, dropped };
}

/** The disabled first entry: it names the parent chat and the message the book reflects. */
export const stampFor = ({ parentName, reply, mark }) => ({
    title: 'About this book',
    text: `Carried over from the chat "${parentName}" at reply ${reply}${mark ? ` (message ${mark})` : ''}. Continue in a new chat wrote this book from the records of that chat. The chat it names is unchanged. This chat's own records start empty and grow from its replies; edit any entry in World Info and your text stays as you wrote it.`,
});

// ---------------------------------------------------------------- the runner

/**
 * The runner over a host. deps: chat(), meta(), chatId(), chatName(), names(), key, runChain(chain, options), chainFor(job),
 * newChat() (opens a fresh chat of the same character and resolves once it shows), childStore() (the memory store of the
 * chat that is open now), loadBook(name), saveBook(name, data), bindBook(name), markRecall(name), setOpening(text), save(),
 * now(), chatInfo() { id, name, avatar, group } of the chat that is open now.
 */
export function createCarryOver(deps) {
    const d = deps;
    const parentView = () => foldChat(d.chat(), d.meta());

    /** What would be sent and what the book would hold, with no model call. For the sheet and the tests. */
    function prepare({ opening = false, wish = '', leaveSecretsOut = false } = {}) {
        const result = parentView();
        const runs = replyRuns(d.chat());
        const data = cleanData(collect({ chat: d.chat(), meta: d.meta(), result, names: d.names(), key: d.key }), runs);
        const request = synopsisRequest(data, { opening, wish });
        return { data, runs, request, leaveSecretsOut, tokens: tokensOf(request.user) };
    }

    async function start({ opening = false, wish = '', leaveSecretsOut = false, signal } = {}) {
        const parent = { id: d.chatId(), name: d.chatName(), reply: 0, mark: '' };
        const chat = d.chat();
        const lastReply = [...chat].reverse().find(isReply);
        parent.mark = lastReply ? storedMark(lastReply) : '';
        parent.reply = chat.filter((m, i) => i > 0 && isReply(m)).length;
        const plan = prepare({ opening, wish, leaveSecretsOut });
        const res = await d.runChain(d.chainFor('carryOver'), {
            job: 'carryOver', system: plan.request.system, user: plan.request.user, schema: { name: SYNOPSIS_SCHEMA.name, value: plan.request.schema, read: plan.request.read },
            tokens: 1800, signal, background: false, label: 'Continue in a new chat, synopsis',
        });
        if (!res.ok) throw new Error(res.waiting ? 'Continue in a new chat waits: the monthly ceiling is reached and no free route answers.' : `No route answered the Writer call. ${res.reason || ''}`.trim());
        const read = readSynopsis(res.value, plan.runs);
        if (wordsOf(read.synopsis).length < 40) throw new Error('The synopsis came back too short after the checks. Nothing was started; try again.');
        const bookData = bookEntries(plan.data, read.synopsis, plan.runs, { leaveSecretsOut });

        // The new chat opens; the parent is left as it is.
        await d.newChat();
        const info = d.chatInfo();
        const name = bookNameFor(info.name);
        const writer = createBookWriter({ loadBook: d.loadBook, saveBook: d.saveBook, now: d.now });
        const written = await writer.write({ name, kind: 'carry-over', chat: info, stamp: stampFor({ parentName: parent.name, reply: parent.reply, mark: parent.mark }), entries: bookData.entries, onEdit: 'once' });
        if (written.refused) throw new Error(written.reason);
        d.bindBook(name);
        d.markRecall(name);
        // The new chat's own records start empty, but the stat sheets start from the book's values, locked where they were locked.
        const store = d.childStore();
        const inputs = [];
        for (const sheet of plan.data.sheets) {
            if (leaveSecretsOut) break;
            inputs.push({ op: 'add', record: { id: sheet.id, kind: 'stat sheet', subject: sheet.subject, text: sheet.text, ...(sheet.locks.length ? { locks: sheet.locks } : {}), status: 'current', importance: 8 }, origin: { type: 'carry-over' }, anchor: null, reason: `Carried over from "${parent.name}".` });
        }
        if (inputs.length) await store.record(inputs);
        const locked = plan.data.sheets.filter(s => s.locked && !leaveSecretsOut).map(s => s.id);
        if (locked.length) await store.record([{ op: 'lock', target: locked, origin: { type: 'carry-over' }, anchor: null, reason: 'Locked in the old chat.' }]);
        if (read.opening) d.setOpening(read.opening);
        chatMemory(d.meta()).carry = { parent: { id: parent.id, name: parent.name, mark: parent.mark, reply: parent.reply }, book: name, at: d.now() };
        await d.save();
        return { book: name, entries: bookData.entries.length, opening: !!read.opening, dropped: read.dropped.length + bookData.dropped.length, parent, route: res.route };
    }

    return { prepare, start };
}

// ---------------------------------------------------------------- wired to SillyTavern

/** The runner over SillyTavern. Resolves the host parts lazily so this file loads without a host. */
export async function hostCarryOver() {
    const [st, store, routing, memStore] = await Promise.all([import('../st.js'), import('../store.js'), import('../routing.js'), import('./store.js')]);
    const { markCarryOverBook } = await import('../book-triggers.js');
    const c = () => st.ctx();
    return createCarryOver({
        chat: () => c().chat || [], meta: () => c().chatMetadata || {}, chatId: () => String(c().getCurrentChatId?.() || ''), chatName: () => String(c().getCurrentChatId?.() || ''),
        names: () => st.names(), key: st.KEY, runChain: (chain, options) => routing.runChain(chain, options), chainFor: job => routing.chainFor(job),
        newChat: async () => {
            const was = String(c().getCurrentChatId?.() || '');
            await c().executeSlashCommandsWithOptions('/newchat');
            for (let i = 0; i < 100 && (String(c().getCurrentChatId?.() || '') === was || !c().getCurrentChatId?.()); i++) await new Promise(resolve => setTimeout(resolve, 100));
            if (!c().getCurrentChatId?.() || String(c().getCurrentChatId?.() || '') === was) throw new Error('The new chat did not open. The old chat is unchanged.');
            // its memory moves into chat data on open; the stat sheets are filed once it has
            for (let i = 0; i < 80 && !c().chatMetadata?.[MEMORY]?.imported; i++) await new Promise(resolve => setTimeout(resolve, 100));
        },
        chatInfo: () => { const id = String(c().getCurrentChatId?.() || ''); return { id, name: id, avatar: String(c().characters?.[c().characterId]?.avatar || ''), group: String(c().groupId || '') }; },
        childStore: () => memStore.memoryStore(), loadBook: name => st.loadBook(name), saveBook: (name, data) => st.saveBook(name, data),
        bindBook: name => { c().chatMetadata.world_info = name; },
        markRecall: name => markCarryOverBook(name),
        setOpening: text => {
            const chat = c().chat || [];
            const head = chat[0] && !chat[0].is_user ? chat[0] : null;
            if (head) { head.mes = text; head.swipes = [text]; head.swipe_id = 0; head.swipe_info = []; if (head.extra && typeof head.extra === 'object') delete head.extra.display_text; }
            else chat.unshift({ name: st.names().char, is_user: false, is_system: false, send_date: new Date().toISOString(), mes: text, extra: {} });
        },
        save: async () => { try { await c().saveMetadata?.(); } catch { /* saved with the chat */ } await c().saveChat?.(); try { await c().reloadCurrentChat?.(); } catch { /* redrawn on the next open */ } },
        now: () => Date.now(),
    });
}
