import { readActivation } from './recall.js';
import { separateReply } from './reply-format.js';
import { memoryComponents, memoryOnly } from './components.js';
import { promptText } from './prompts.js';
import { stateAt, sceneAt, storyMinuteAt, sceneUpdate, sceneFromReplyHeader, SCENE_FIELDS, changesFromProfiles } from './state.js';
import { advanceStoryClock, validElapsed } from './story-clock.js';
import { historySourceMark, historySourceMatches } from './history-source.js';
import { storyCorrectionPrompt } from './correction-rules.js';
import { estimateTokens } from './context-budget.js';
import { ensureWorld, enabledV10, effectiveModules, extractUpdate, readRecord, recordMap, portrayalSources, updateContract, baseWorld, emotionReplyAge, prefs, replyDiagnostics } from './v10.js';
// The story so far, kept by the extension itself.
//  - Chapters: one AI request writes a summary of a stretch of replies. It is filed in the chat's story world as a
//    "chapter" entry and sent with the story notes. A chapter is cut when a scene ends, after a set number of
//    replies, or by hand.
//  - New chapter: a detailed summary and a new first message, then a brand new chat that carries everything over.
//  - Starter world: one AI request reads the character card, its lorebook and the greeting, and proposes entries.
import { ctx, KEY, LOG, names, parseJson, isReply, isStory, isGenerating, worldNames, loadBook } from './st.js';
import { request } from './ai.js';
import { settings, chatState, saveChatState } from './store.js';
import { addLog } from './log.js';
import { chatWorld, setChatWorld, loadWorld, saveWorld, listWorld, newWorldEntry, writeWorldEntry, renderEntry, HUD_BLOCKS, WORLD_KINDS, DONE, chatTimes, chapterIsMine, readWorldEntry, isWorldEntry } from './world.js';
import { enqueue, worldIdle, syncWorld, attachChange, attachChanges, parseUpdate, applyOps, applyStructuredUpdates, creationFingerprint, stripUpdateBlock, shownChanges, describeChange } from './worldflow.js';
import { createSet, entriesOf, setName, cleanSetName } from './books.js';
import { goals, goalProgress, stepDone } from './goals.js';
import { writerRules } from './pacing.js';
import { hideCovered, restoreChapterHistory } from './hide.js';

const clean = t => String(t ?? '').replace(/\s+/g, ' ').trim();
const chatId = () => String(ctx().getCurrentChatId?.() || '');
const tidy = t => stripUpdateBlock(String(t ?? '')).replace(HUD_BLOCKS, ' ').replace(/<sent_instructions>[\s\S]*?<\/sent_instructions>/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/** The replies of this chat, in order: [{ n, index, time }]. The greeting is not a reply. */
function replies() {
    const out = [];
    const chat = ctx().chat || [];
    for (let i = 1; i < chat.length; i++) { const m = chat[i]; if (!isReply(m)) continue; out.push({ n: out.length + 1, index: i, time: m.extra?.[KEY]?.time || 0 }); }
    return out;
}

/** Read messages oldest first. Pass zero for the full source of a saved chapter. */
function storyText(from, to, limit = 24000) {
    const chat = ctx().chat || [];
    const list = replies();
    const start = from <= 1 ? 0 : (list.find(r => r.n === from - 1)?.index ?? -1) + 1;
    const end = list.find(r => r.n === to)?.index ?? chat.length - 1;
    const lines = [];
    for (let i = Math.max(0, start); i <= end && i < chat.length; i++) {
        const m = chat[i];
        if (!isStory(m) || !m.mes) continue;
        const original = String(m.mes);
        const extracted = memoryOnly() && !m.is_user ? separateReply(original).text : original;
        const text = tidy(extracted || original);
        if (text) lines.push(`${m.name}: ${limit && text.length > 2500 ? `${text.slice(0, 2500)} [...]` : text}`);
    }
    let text = lines.join('\n\n');
    // When it is too long, the middle is left out so the start and the end of the stretch are both read.
    if (limit && text.length > limit) text = `${text.slice(0, limit * 0.45)}\n\n[... part of this stretch is left out here ...]\n\n${text.slice(-limit * 0.5)}`;
    return text;
}

const chaptersOf = (list) => list.filter(w => w.kind === 'chapter' && w.on).sort((a, b) => (a.span?.to || 0) - (b.span?.to || 0) || a.uid - b.uid);
/** The last reply of this chat that a chapter covers. */
export function coveredUpTo(list) {
    const id = chatId();
    const times = chatTimes();
    return Math.max(0, ...list.filter(w => w.kind === 'chapter' && chapterIsMine(w, id, times)).map(w => w.span.to));
}

function savedChapterRanges(data,wid) {
    const id=chatId(), times=chatTimes(), turns=replies();
    return chaptersOf(listWorld(data,wid)).flatMap(chapter=>{
        if (!chapter.span || chapter.activation?.mode==='off' || !chapterIsMine(chapter,id,times)) return [];
        const last=chapter.span.time ? turns.find(turn=>String(turn.time)===String(chapter.span.time)) : turns[chapter.span.to-1];
        const from=(turns[chapter.span.from-2]?.index ?? 0)+1;
        return last?.time && from<=last.index ? [{chapter,from,last}] : [];
    });
}

async function hideChapterRanges(ranges,wid) {
    let hidden=0;
    for (const {chapter,from,last} of ranges) {
        const dates=await hideCovered(last.index,{from,persist:false});
        if (!dates.length) continue;
        attachChanges(last.time,wid,[{uid:chapter.uid,name:chapter.name,kind:'chapter',type:'hide',dates}],{persist:false});
        hidden+=dates.length;
    }
    return hidden;
}

export async function applyHistoryWindow() {
    const id=chatId(), wid=chatWorld();
    if (!wid || !memoryComponents().hide) throw new Error('Assign a Story World and turn on hiding before applying the history window.');
    return enqueue(async()=>{
        const data=await loadWorld(wid);
        if (chatId()!==id || chatWorld()!==wid || !memoryComponents().hide || chapterBusy() || isGenerating()) {
            throw new Error('Wait until this chat is idle before applying the history window.');
        }
        const host=ctx();
        if (chatState()?.historyNeedsReview) throw new Error('Review the edited story before applying the history window.');
        const ranges=savedChapterRanges(data,wid);
        if (!ranges.length) throw new Error('There are no active saved chapters for the current chat yet.');
        const restore=historyCheckpoint(host.chat,host.chatMetadata[KEY]);
        try {
            restoreChapterHistory({persist:false});
            await hideChapterRanges(ranges,wid);
            await host.saveChat?.();
            saveChatState();
        } catch (error) { restore(); throw error; }
    },{propagate:true});
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

const summaryNotes = (text) => replyDiagnostics(text, {avoid:prefs()?.avoidPhrases});

function chapterPrompt(text, earlier, { close = true } = {}) {
    const lines = [
        'Write the summary of one part of a roleplay story, for the story\'s own notes.',
        '',
    ];
    if (earlier.length) lines.push('Earlier parts, for context only:', ...earlier.map(w => `- ${renderEntry(w, { full: false })}`), '');
    lines.push('The part to summarise, oldest message first:', '"""', text, '"""', '',
        'Return these keys:',
        '- "title": a short plain title for this part, 3 to 6 words.',
        '- "when": when it took place in the story, in a few words. An empty string when the text does not say.',
        `- "summary": ${promptText('chapterSummary')} ${promptText('memoryFacts')}`,
        '- "people": a list of the names of the people who took part.',
        '- "places": a list of the names of the places.',
        '- "settled": one sentence on what was settled or came out in this part. An empty string when nothing was.');
    if (close) lines.push('', 'Return only a JSON object with the keys "title", "when", "summary", "people", "places", "settled".');
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
        const text = storyText(from, to, 0);
        const anchor = replies().find(r=>r.n===to);
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
        let hidden = 0;
        await enqueue(async () => {
            const data = await loadWorld(wid);
            const lastRe = replies().find(r => r.n === to);
            if (chatId()!==chat || chatWorld()!==wid || !memoryComponents().chapters || !lastRe ||
                lastRe.time!==anchor?.time || storyText(from,to,0)!==text) {
                const reason = 'The source history or chapter settings changed while the summary was being written. No chapter was saved.';
                res.note(reason,false);
                throw new Error(reason);
            }
            const w = newWorldEntry(data, 'chapter');
            Object.assign(w, { name: clean(obj.title) || `Replies ${from} to ${to}`, auto: true, at: { chat, n: to }, span: { chat, from, to, ...(lastRe?.time ? { time: String(lastRe.time) } : {}) } });
            Object.assign(w.fields, { summary: clean(obj.summary), when: clean(obj.when), people: asList(obj.people), places: asList(obj.places), settled: clean(obj.settled) });
            // What is finished moves into the chapter: it is written into it in one line each and turned off, so the
            // world holds what is still open. Entries set to "keep it as I wrote it" are left alone.
            const retired = memoryOnly() || settings().summary.retire === false ? [] : listWorld(data, wid).filter(x => x.on && !x.locked && (x.kind === 'secret' ? x.status === 'out' : DONE[x.kind] && x.status === DONE[x.kind]));
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
                attachChange(last.time, wid, { uid: w.uid, name: w.name, kind: 'chapter', type: 'create', createdState: creationFingerprint(w) });
                for (const x of retired) attachChange(last.time, wid, { uid: x.uid, name: x.name, kind: x.kind, type: 'off', into: w.name });
                // The messages the chapters cover are hidden from the AI, except the newest ones. They stay in the chat.
                hidden = await hideChapterRanges(savedChapterRanges(data,wid),wid);
                if (hidden) { await ctx().saveChat?.(); saveChatState(); }
            }
        }, {propagate:true});
        res.note(`Chapter "${name}" covers replies ${from} to ${to} (${why}). It is in the story world and is sent with the story notes.${moved ? ` ${moved} finished ${moved === 1 ? 'entry was' : 'entries were'} written into it and turned off.` : ''}${hidden ? ` ${hidden} older ${hidden === 1 ? 'message was' : 'messages were'} hidden from the AI.` : ''}`, true, summaryNotes(obj.summary));
        await rollUpIfNeeded().catch(e => console.warn(LOG, 'roll-up', e));
        return name;
    } finally { busy = false; }
}

/** After a reply: is a chapter due? Runs by itself in the background. replyNo: the number of the reply just written. */
export function chapterAfterReply(time, replyNo, onDone) {
    const o = settings().summary;
    if (!memoryComponents().chapters || busy) return;
    worldIdle().then(async () => {
        const wid = chatWorld();
        if (!wid || !memoryComponents().chapters || busy) return;
        const rec = (ctx().chat || []).map(m => m?.extra?.[KEY]).find(r => r && String(r.time) === String(time));
        if (!rec) return;
        const data = await loadWorld(wid).catch(() => null);
        if (!data) return;
        const since = replyNo - coveredUpTo(listWorld(data, wid));
        const min = Math.max(1, Math.round(Number(o.minReplies) || 1));
        const every = Math.max(0, Math.round(Number(o.every) || 0));
        const tokens = Math.max(0, Math.round(Number(o.everyTokens) || 0));
        let why = '';
        if (!memoryOnly() && o.onSceneEnd && rec.update?.ended && since >= min) why = 'the scene ended';
        else if (every && since >= every) why = `${every} replies went by`;
        else if (tokens && since>0 && estimateTokens(storyText(replyNo-since+1,replyNo,0))>=tokens) why = `the unsummarized story reached about ${tokens} tokens`;
        if (!why) return;
        try { await writeChapter(replyNo - since + 1, replyNo, why); onDone?.(); }
        catch (e) { console.warn(LOG, 'chapter', e); }
    }).catch(e => console.warn(LOG, 'chapter', e));
}

/** "Write a chapter now": everything since the last chapter. */
export async function writeChapterNow() {
    if (chatState()?.components?.chapters===false) throw new Error('Turn on Chapter summaries for this chat first.');
    const wid = chatWorld();
    if (!wid) throw new Error('This chat has no story world to keep chapters in.');
    const data = await loadWorld(wid);
    const list = replies();
    const to = list.length;
    const from = coveredUpTo(listWorld(data, wid)) + 1;
    if (to < from) throw new Error('Every reply of this chat is already in a chapter.');
    return writeChapter(from, to, 'you asked for it');
}

/** Partition uncovered history on reply boundaries. A long exchange is sent whole in its own request. */
export function catchUpBatches(chat, covered, every, budget = 28000, splitAfter = 0) {
    const batches = [];
    let start = 0, number = 0, batch = null;
    for (let end = 1; end < chat.length; end++) {
        if (!isReply(chat[end])) continue;
        number++;
        const messages = chat.slice(start, end + 1);
        const from = start;
        start = end + 1;
        if (covered.has(number)) { batch = null; continue; }
        const text = messages.filter(message=>isStory(message) && message.mes).map(message=>{
            const prose = message.is_user ? message.mes : separateReply(message.mes).text
                .replace(/<(roast|profile|think|thinking|analysis)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
            return `${message.name || (message.is_user ? 'Player' : 'Character')}: ${tidy(prose)}`;
        }).join('\n\n');
        if (!batch || batch.to===splitAfter || number - batch.from >= every || batch.text.length + text.length + 2 > budget) {
            batch = { from:number, to:number, start:from, end, text };
            batches.push(batch);
        } else {
            batch.to = number;
            batch.end = end;
            batch.text += `\n\n${text}`;
        }
    }
    return batches;
}

function chapterCoverage(rows, id, total) {
    const times = chatTimes();
    const root = chatState();
    const invalidFrom = root?.historyNeedsReview ? Number(root.historyInvalidFrom) || 0 : 0;
    const regenerated = new Set((ctx().chat || []).map(message=>message?.extra?.[KEY])
        .filter(record=>record?.historySource?.length && !record.stateStale).map(record=>String(record.time)));
    const covered = new Set();
    for (const row of chaptersOf(rows)) {
        if (!row.span || !chapterIsMine(row,id,times)) continue;
        if (invalidFrom && row.span.to >= invalidFrom && !regenerated.has(row.span.time)) continue;
        for (let number = Math.max(1,row.span.from); number <= Math.min(total,row.span.to); number++) covered.add(number);
    }
    return covered;
}

let catchUp = null;
export const historyCatchUpStatus = () => catchUp?.chat === chatId() ? { ...catchUp } : null;
export function stopHistoryCatchUp() {
    if (catchUp?.chat === chatId() && catchUp.running && !catchUp.installing) catchUp.stop = true;
}

function catchUpPayload(answer, batch, track, structured) {
    const text = answer.trim();
    const summary = parseJson(text,{object:true});
    if (!summary || typeof summary.summary !== 'string' || !summary.summary.trim()) throw new Error('The model returned no usable chapter summary.');
    if (!track) return { summary, parsed:null, ops:[] };
    if (!Array.isArray(summary.world)) throw new Error('The model omitted the Story World entry list.');
    const hasQuote = value => typeof value === 'string' && clean(value).length >= 4 && clean(batch.text).includes(clean(value));
    const ops = summary.world.slice(0,35).flatMap(item=>{
        if (typeof item?.line !== 'string' || /[\r\n<>]/.test(item.line) || !hasQuote(item.evidence)) return [];
        return parseUpdate(`<story_update>\n${item.line}\n</story_update>`).ops;
    });
    if (structured && (!Array.isArray(summary.changes) || !Array.isArray(summary.characters))) throw new Error('The model omitted the structured record or character snapshot list.');
    const scene = hasQuote(summary.sceneEvidence) ? summary.scene : undefined;
    const parsed = extractUpdate(`<story_update v="2">${JSON.stringify({v:2,scene,characters:summary.characters,changes:summary.changes})}</story_update>`,
        {sourceProse:batch.text});
    if (!parsed?.found || parsed.invalid) throw new Error('The structured update could not be read.');
    return { summary, parsed:{...parsed,clean:batch.text}, ops };
}

function savedHistoryRecord(existing) {
    if (!existing) return null;
    const record = structuredClone(existing);
    for (const key of ['update','scene','stateChanges','profiles','v10Profiles','v10Changes','v10Plot','v10Minutes',
        'v10SceneId','v10SceneEnded','v10Invalid','v10Issues','v10RepairAttempt','stateStale','stateOutdated',
        'weatherInherited','historySource','recall']) delete record[key];
    return record;
}

function keepAuthoredEntries(rows, data, world) {
    for (const row of rows) {
        const authored = !row.auto || row.locked || readRecord(row)?.source === 'user';
        if (!authored || row.kind === 'chapter') continue;
        const kept = {...structuredClone(row),uid:newWorldEntry(data,row.kind).uid};
        writeWorldEntry(data,kept,world);
    }
}

function fileHistoryBatch(data, wid, meta, batch, payload, rec, config) {
    const {summary, parsed, ops} = payload;
    const {track,structured,modules,previous,previousClock,base,keepChapter = true} = config;
    const prior = listWorld(data,wid);
    const changes = track ? applyOps(data,wid,ops,meta,'history',35) : [];
    if (parsed && modules.state && (!rec.scene || rec.stateStale)) {
        const scene = sceneUpdate(parsed.scene);
        const timeline = advanceStoryClock(previous,scene,{clock:previousClock,minutes:parsed.minutes,elapsed:parsed.elapsed});
        rec.scene = timeline.scene;
        rec.stateChanges = changesFromProfiles(parsed.profiles);
        rec.stateStale = false;
        rec.stateOutdated = false;
        if (rec.scene.weather && scene.weather===undefined) rec.weatherInherited = true;
        rec.v10Minutes = timeline.minutes;
        if (timeline.issues.length) (rec.v10Issues ||= []).push(...timeline.issues);
        if (structured) rec.v10SceneId = rec.time;
    }
    if (structured) {
        rec.v10 = true;
        changes.push(...applyStructuredUpdates(data,wid,meta,batch.end,rec,parsed,{
            modules,records:recordMap(prior),baselines:portrayalSources(prior),base,
        },{historical:true}));
    }
    if (!keepChapter) return {rec,changes,chapter:null};
    const chapter = newWorldEntry(data,'chapter');
    Object.assign(chapter,{name:clean(summary.title) || `Replies ${batch.from} to ${batch.to}`,auto:true,at:meta,
        span:{chat:meta.chat,from:batch.from,to:batch.to,time:String(rec.time)}});
    Object.assign(chapter.fields,{summary:clean(summary.summary),when:clean(summary.when),people:asList(summary.people),places:asList(summary.places),settled:clean(summary.settled)});
    writeWorldEntry(data,chapter,wid);
    return {rec,changes,chapter};
}

async function attachHistoryBatch(wid, batch, staged, original, safeEnd) {
    const {rec,chapter,changes} = staged;
    const message = ctx().chat[batch.end];
    rec.historySource = original.slice(batch.start,batch.end+1);
    if (rec.update?.undone) delete rec.update;
    message.extra ||= {};
    message.extra[KEY] = rec;
    const swipe = message.swipe_info?.[message.swipe_id];
    if (swipe) { swipe.extra ||= {}; swipe.extra[KEY] = rec; }
    const dates = safeEnd === undefined ? [] : await hideCovered(safeEnd,{persist:false});
    attachChanges(rec.time,wid,[...changes,
        ...(chapter ? [{uid:chapter.uid,name:chapter.name,kind:'chapter',type:'create',createdState:creationFingerprint(chapter),entry:structuredClone(chapter)}] : []),
        ...(dates.length && chapter ? [{uid:chapter.uid,name:chapter.name,kind:'chapter',type:'hide',dates}] : [])],{persist:false});
    return dates.length;
}

function historyCheckpoint(chat, root) {
    const metadata = structuredClone(root);
    const holders = chat.flatMap(message=>[message,...(message.swipe_info || [])]).filter(Boolean)
        .map(holder=>[holder, holder.extra?.[KEY] ? structuredClone(holder.extra[KEY]) : undefined]);
    const hidden = chat.map(message=>message.is_system);
    return () => {
        for (const key of Object.keys(root)) delete root[key];
        Object.assign(root,metadata);
        for (const [holder,record] of holders) {
            if (record) { holder.extra ||= {}; holder.extra[KEY] = record; }
            else if (holder.extra) delete holder.extra[KEY];
        }
        chat.forEach((message,index)=>{
            if (message.is_system === hidden[index]) return;
            message.is_system = hidden[index];
            try { globalThis.$?.(`.mes[mesid="${index}"]`)?.attr('is_system', String(!!hidden[index])); } catch { /* refreshed by host */ }
        });
    };
}

/** Read unsummarized history and checkpoint each chapter and its records in the same book write. */
export async function catchUpChatHistory(onProgress = () => {}, { rebuild = false, keepAuthored = true, repair = null } = {}) {
    if (busy || isGenerating()) throw new Error('Wait for the current generation or chapter to finish.');
    if (!repair && !memoryComponents().chapters) throw new Error('Enable Chapter summaries for this chat first.');
    const c = ctx(), id = chatId(), root = chatState();
    if (!id || !root) throw new Error('Open the chat you want to catch up.');
    if (!replies().length) throw new Error('This chat has no model replies to catch up.');
    const chat = c.chat;
    const original = chat.map(historySourceMark);
    const current = () => chatId() === id && chatState() === root && ctx().chat === chat &&
        chat.length === original.length && historySourceMatches(chat,chat.length-1,original);
    const validate = () => { if (!current()) throw new Error('The chat changed during catch-up. Run catch-up again from its saved chapters.'); };
    busy = true;
    const status = catchUp = {chat:id,running:true,stop:false,done:0,total:0,hidden:0,records:0,text:'Preparing chat history…'};
    const report = text => { status.text = text; onProgress(); };
    try {
        report(status.text);
        await syncWorld();
        validate();
        if (root.branchPendingWorld) throw new Error('This branch needs its own Story World before catch-up.');
        const originalWorld = chatWorld();
        let wid = rebuild ? originalWorld : await ensureWorld();
        validate();
        const track = !memoryOnly() && memoryComponents().world && (enabledV10() || settings().world.update !== 'off');
        const structured = track && enabledV10();
        const modules = structured ? { ...effectiveModules(),roast:false } : { state:track };
        const old = wid ? await loadWorld(wid) : null;
        if (wid && !old) throw new Error('The Story World could not be read.');
        const oldRows = wid ? listWorld(old,wid) : [];
        const stagingBook = rebuild ? {entries:{}} : null;
        const stagedBatches = [];
        const openingScene = rebuild ? sceneAt(1,{overrides:false}) : null;
        const openingClock = rebuild ? storyMinuteAt(1) : undefined;
        let stagedScene = openingScene;
        let stagedClock = openingClock;
        if (rebuild) {
            const base = `${cleanSetName(names().char).slice(0,45)} — Story World (rebuilt)`;
            wid = base;
            const used = new Set([...worldNames(),...Object.keys(settings().sets)]);
            for (let number = 2; used.has(wid); number++) wid = `${base} ${number}`;
            if (keepAuthored) keepAuthoredEntries(oldRows,stagingBook,wid);
        }
        const replyList = replies();
        const covered = rebuild ? new Set() : chapterCoverage(oldRows,id,replyList.length);
        if (repair) for (const row of replyList) if (row.n < repair.from) covered.add(row.n);
        const chapterThrough = repair && memoryComponents().chapters ? repair.chapterThrough : 0;
        const batches = catchUpBatches(chat,covered,Math.max(1,Number(settings().summary.every) || 20),28000,chapterThrough);
        status.total = batches.length;
        let timestamp = Math.max(Date.now(), ...chat.map(message=>Number(message?.extra?.[KEY]?.time) || 0));
        for (const batch of batches) {
            if (status.stop) break;
            validate();
            report(`Reading replies ${batch.from}–${batch.to} · batch ${status.done + 1} of ${status.total}…`);
            const before = listWorld(rebuild ? stagingBook : await loadWorld(wid),wid);
            const catalog = before.filter(row=>row.on && row.kind!=='chapter').slice(-45).map(row=>row.name).join(', ');
            const previous = rebuild ? stagedScene : sceneAt(batch.start,{overrides:false});
            const previousClock = rebuild ? stagedClock : storyMinuteAt(batch.start);
            const form = [
                chapterPrompt(batch.text,chaptersOf(before).filter(row=>row.span?.chat!==id || row.span.to<batch.from).slice(-3),{close:false}),
                track && promptText('catchUpHistory'),
                (!rebuild || keepAuthored) && storyCorrectionPrompt('','',batch.text),
                track && catalog && `Reuse existing entry names or record IDs where appropriate: ${catalog}.`,
                track && [
                    'Add "world", an array of up to 35 objects with "line" and an exact short "evidence" quote from this batch. Use [] if none are established.',
                    'person: Name | role | established description',
                    'place: Name | established description',
                    'group: Name | description',
                    'thread: Title | open issue',
                    'moved: Title | development',
                    'settled: Title | resolution',
                    'secret: Title | holder | fact',
                    'out: Title | who learned it',
                    'planted: Title | detail',
                    'paid: Title | payoff',
                    'elsewhere: Title | person | activity',
                ].join('\n'),
                track && 'If the final scene is established, add "scene" with known where, time, date, weather, present (comma-separated), and environment strings, and "sceneEvidence" with an exact supporting quote from this batch. Omit uncertain details.',
                structured && modules.state && `Scene before this batch: ${JSON.stringify(previous)}. ${Number.isSafeInteger(previousClock) ? `Relative story minute before this batch: ${previousClock}. ` : ''}Report elapsed only when the whole interval from that scene to the end of this batch is established.`,
                structured && `Also include "changes" and "characters" arrays using the applicable fields from this guide. Use [] for either empty list. Retain the chapter keys above.\n${updateContract(modules,false,{fieldsOnly:true})}`,
                'Return one JSON object containing the requested keys. Keep all fields in this object, without XML or Markdown fences.',
            ].filter(Boolean).join('\n\n');
            validate();
            const response = await request({what:`Catch up story history, replies ${batch.from}–${batch.to}`,
                system:promptText('systemCatchUp'),
                user:form,tokens:track ? 2300 : 700,profileId:settings().profileId});
            try {
                validate();
                if (status.stop) { response.note('Catch-up stopped before this chapter was saved.',false); break; }
                const {summary, parsed, ops} = catchUpPayload(response.text,batch,track,structured);
                const payload = {summary,parsed,ops};
                const meta = {chat:id,n:batch.to};
                const config = {track,structured,modules,previous,previousClock,base:baseWorld(root.v10),keepChapter:!repair || batch.to<=chapterThrough};
                const existing = chat[batch.end].extra?.[KEY];
                if (rebuild) {
                    const rec = savedHistoryRecord(existing) || {v:1,items:[],type:'history',time:++timestamp};
                    const staged = fileHistoryBatch(stagingBook,wid,meta,batch,payload,rec,config);
                    stagedBatches.push({batch,staged});
                    stagedScene = rec.scene || stagedScene;
                    stagedClock = rec.v10Minutes ?? stagedClock;
                    status.done++;
                    response.note(`Prepared replies ${batch.from}–${batch.to} for the replacement Story World.`,true,summaryNotes(summary.summary));
                    continue;
                }
                await enqueue(async () => {
                    if (chatWorld() !== wid) throw new Error('The Story World changed during catch-up.');
                    const originalBook = await loadWorld(wid);
                    validate();
                    if (!originalBook) throw new Error('The Story World could not be found.');
                    const data = structuredClone(originalBook);
                    const live = chat[batch.end].extra?.[KEY];
                    if (live?.update?.world && live.update.world!==wid && !live.update.undone) throw new Error('This reply already belongs to a different Story World.');
                    const rec = live ? structuredClone(live) : {v:1,items:[],type:'history',time:++timestamp};
                    if (live?.update?.undone || live?.stateStale) rec.time = ++timestamp;
                    const staged = fileHistoryBatch(data,wid,meta,batch,payload,rec,config);
                    await saveWorld(wid,data);
                    if (!current() || chatWorld() !== wid) {
                        await saveWorld(wid,originalBook);
                        throw new Error('The chat or Story World changed while saving. Run catch-up again from its saved chapters.');
                    }
                    for (let number = batch.from; number <= batch.to; number++) covered.add(number);
                    let last = 0;
                    while (covered.has(last + 1)) last++;
                    const rollback = historyCheckpoint(chat,root);
                    let hidden;
                    try {
                        hidden = await attachHistoryBatch(wid,batch,staged,original,staged.chapter ? replyList[Math.min(last,batch.to)-1]?.index : undefined);
                        await c.saveChat?.();
                    } catch (error) {
                        if (current() && chatWorld() === wid) { rollback(); saveChatState(); }
                        await saveWorld(wid,originalBook);
                        throw error;
                    }
                    status.hidden += hidden;
                    status.records += staged.changes.length;
                    status.done++;
                    saveChatState();
                },{propagate:true});
                response.note(`Saved chapter and history updates for replies ${batch.from}–${batch.to}.`,true,summaryNotes(summary.summary));
            } catch (error) {
                response.note(error.message,false);
                throw error;
            }
        }
        if (rebuild && !status.stop) {
            status.installing = true;
            report('Saving the rebuilt Story World…');
            await enqueue(async () => {
                validate();
                if (chatWorld() !== originalWorld) throw new Error('The Story World changed during rebuild.');
                if (keepAuthored && originalWorld && JSON.stringify(await loadWorld(originalWorld)) !== JSON.stringify(old)) {
                    throw new Error('The previous Story World was edited during rebuild. Run rebuild again to include those edits.');
                }
                validate();
                if (worldNames().includes(wid) || Object.hasOwn(settings().sets,wid)) throw new Error('A book with the replacement name appeared. Start the rebuild again.');
                wid = await createSet(wid,'world',stagingBook,'');
                validate();
                if (chatWorld() !== originalWorld) throw new Error('The Story World changed while saving the replacement.');
                const rollback = historyCheckpoint(chat,root);
                try {
                    restoreChapterHistory({persist:false});
                    setChatWorld(wid);
                    delete root.historyNeedsReview;
                    delete root.historyInvalidFrom;
                    delete root.worldLog;
                    delete root.sceneSeed;
                    delete root.stateSeed;
                    delete root.v10ClockSeed;
                    if (Object.keys(openingScene).length) root.sceneSeed = openingScene;
                    if (Number.isSafeInteger(openingClock)) root.v10ClockSeed = openingClock;
                    for (const message of chat) {
                        for (const holder of [message,...(message.swipe_info || [])]) {
                            if (holder.extra?.[KEY]) holder.extra[KEY] = savedHistoryRecord(holder.extra[KEY]);
                        }
                    }
                    if (!keepAuthored) {
                        delete root.stateOverrides;
                        delete root.sceneOverrides;
                        delete root.correctionHistory;
                        delete root.storyCorrections;
                        for (const message of chat) for (const holder of [message,...(message.swipe_info || [])]) {
                            if (holder.extra?.[KEY]) {
                                delete holder.extra[KEY].stateEdits;
                                delete holder.extra[KEY].snapshotEdits;
                            }
                        }
                    }
                    for (const {batch,staged} of stagedBatches) {
                        if (!keepAuthored) { delete staged.rec.stateEdits; delete staged.rec.snapshotEdits; }
                        status.hidden += await attachHistoryBatch(wid,batch,staged,original,batch.end);
                        status.records += staged.changes.length;
                    }
                    await c.saveChat?.();
                    status.book = wid;
                    saveChatState();
                } catch (error) {
                    if (current() && chatWorld() === wid) { rollback(); saveChatState(); }
                    throw error;
                }
            },{propagate:true});
        }
        report(status.stop && rebuild ? 'Rebuild stopped. The previous Story World is still in use.' : status.stop ? `Paused after ${status.done} of ${status.total} batches.` :
            repair ? `Refreshed ${status.done} affected history batches and filed ${status.records} Story World changes.` :
            status.book ? `Rebuilt ${status.done} chapters in ${status.book}. Hid ${status.hidden} covered messages from the model.` : status.total ? `Saved ${status.done} chapters and filed ${status.records} Story World changes. Hid ${status.hidden} covered messages from the model.` :
                'Every model reply in this chat already has chapter coverage.');
        return {...status};
    } catch (error) {
        report(`${error.message} ${rebuild ? 'The previous book remains available.' : `${status.done} chapters saved in this run.`}`);
        throw error;
    } finally {
        status.running = false;
        busy = false;
        onProgress();
    }
}

/** Re-read changed accepted prose without creating chapters for a previously unsummarized stretch. */
export async function refreshEditedStory(from, chapterThrough = 0) {
    const root = chatState();
    const result = await catchUpChatHistory(undefined,{repair:{from,chapterThrough}});
    if (chatState()===root && root.historyNeedsReview && result.done===result.total && !result.stop) {
        await enqueue(async () => {
            const wid = chatWorld(), current = ctx().chat;
            const data = wid && await loadWorld(wid);
            if (chatState()!==root || current!==ctx().chat || chatWorld()!==wid) return;
            const regenerated = new Set(current.map(message=>message.extra?.[KEY])
                .filter(record=>record?.historySource?.length && !record.stateStale).map(record=>String(record.time)));
            const outstanding = data && listWorld(data,wid).some(row=>row.kind==='chapter' && row.on && row.span &&
                chapterIsMine(row,chatId()) && row.span.to>=root.historyInvalidFrom && !regenerated.has(row.span.time));
            if (!outstanding) { delete root.historyNeedsReview; delete root.historyInvalidFrom; saveChatState(); }
        });
    }
    addLog({what:'Automatic story refresh',ok:true,result:'Refreshed '+result.done+' affected history batches and filed '+result.records+' world changes.'});
    return result;
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
    const times = chatTimes();
    const mine = all.filter(w => !w.rollup && chapterIsMine(w, chat, times));
    if (mine.length <= max) return;
    const old = mine.slice(0, mine.length - keep);
    const prior = all.find(w => w.rollup && chapterIsMine(w, chat, times)) || all.find(w => w.rollup) || null;
    const parts = [...(prior ? [prior] : []), ...old];
    const user = [
        'Combine these summaries of the earlier parts of a roleplay story into one account of the story so far.',
        '', ...parts.map(w => `- ${renderEntry(w)}`), '',
        'Return these keys:',
        `- "summary": ${promptText('chapterCombine')} ${promptText('memoryFacts')}`,
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
        const roll = now.find(w => w.kind === 'chapter' && w.rollup && w.on) || Object.assign(newWorldEntry(d, 'chapter'), { name: 'Before the latest chapters', rollup: true, auto: true });
        Object.assign(roll.fields, { summary: clean(obj.summary), people: asList(obj.people), places: asList(obj.places) });
        roll.span = { chat, from: 1, to: old[old.length - 1].span.to, ...(old[old.length - 1].span.time ? { time: old[old.length - 1].span.time } : {}) };
        if (roll.activation?.mode==='window') {
            const keys = [obj.people,obj.places].flatMap(value=>Array.isArray(value) ? value : []);
            roll.activation = {...roll.activation,after:replies().length,keys:[...new Set([...roll.activation.keys,...keys])]};
        }
        delete roll.isNew;
        writeWorldEntry(d, roll, wid);
        // The chapters that went into it: automatic ones are removed, ones you saved yourself are switched off.
        for (const w of old) { const cur = now.find(x => x.uid === w.uid); if (!cur) continue; if (cur.auto) delete d.entries[cur.uid]; else { cur.on = false; writeWorldEntry(d, cur, wid); } }
        await saveWorld(wid, d);
    });
    res.note(`${old.length} older chapters were combined into "Before the latest chapters". The newest ${keep} stay as they are.`, true, summaryNotes(obj.summary));
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
    const currentScene = sceneAt();
    const user = [
        `A roleplay story is moving into a new chat. The main character is ${n.char}. The other person is ${n.user}. Write two things.`,
        '',
        `SUMMARY: ${promptText('newChapterSummary')} ${promptText('memoryFacts')}`,
        '',
        `FIRST MESSAGE: ${promptText('newChapterFirst', { user: n.user })}`,
        clean(wish) ? `\nWhat the user wants for the new chapter: ${clean(wish)}` : '',
        '', 'For the first message only:', ...writerRules(),
        '', currentScene && Object.keys(currentScene).length ? `Established scene at the end of this chat: ${JSON.stringify(currentScene)}` : '',
        ...parts,
        'Answer in exactly this form, with these two headings in capitals and nothing before the first one:',
        'SUMMARY:', '(the summary)', '', 'FIRST MESSAGE:', '(the first message)',
        `After the first message append one <chapter_scene> JSON object with time, date, where, weather, and present strings </chapter_scene>. ${promptText('chapterOpeningScene')}`,
    ].join('\n');
    const res = await request({ what: 'Write a new chapter (summary and first message)', system: 'You continue a roleplay story into a new chat. You follow the form you are given.', user, tokens: 1800, profileId: settings().profileId });
    const answer = String(res.text);
    const m = answer.match(/SUMMARY\s*:\s*([\s\S]*?)\n\s*FIRST MESSAGE\s*:\s*([\s\S]*)$/i);
    if (!m || !clean(m[1]) || !clean(m[2])) {
        const msg = `The AI answered, but the two parts could not be told apart. The answer began: "${clean(answer).slice(0, 140)}". The Log tab has the whole answer.`;
        res.note(msg, false);
        throw new Error(msg);
    }
    res.note('A summary and a first message were read. Nothing changes until you start the new chat.', true, summaryNotes(m[1]));
    const block = /<chapter_scene>\s*([\s\S]*?)\s*<\/chapter_scene>\s*$/i.exec(m[2]);
    const parsed = block ? parseJson(block[1]) : null;
    const elapsed = validElapsed(parsed?.elapsed) ? parsed.elapsed : undefined;
    const first = (block ? m[2].slice(0,block.index) : m[2]).trim();
    const { scene } = advanceStoryClock(currentScene,{...sceneFromReplyHeader(first),...sceneUpdate(chapterSceneFields(parsed))},{elapsed});
    return {summary:m[1].trim(),first,scene,
        elapsed,previewTime:scene.time,previewDate:scene.date};
}

function chapterSceneFields(scene) {
    return Object.fromEntries(SCENE_FIELDS.flatMap(([key])=>
        typeof scene?.[key]==='string' ? [[key,scene[key].trim().slice(0,300)]] : []));
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
    if (chatState()!==cs) throw new Error('The chat changed before the continuation could start.');
    const oldReplyCount = replies().length;
    const attachedHostBook = c.chatMetadata?.world_info;
    // 1. What travels with the story.
    const g = goals();
    const p = goalProgress('normal');
    const v10 = cs.v10 ? structuredClone(cs.v10) : undefined;
    if (v10) delete v10.check;
    const reviewedScene = chapterSceneFields(draft.scene);
    const elapsed = draft.scene?.time===draft.previewTime && draft.scene?.date===draft.previewDate ? draft.elapsed : undefined;
    if (!reviewedScene.date && draft.scene?.lastKnownDate) delete reviewedScene.date;
    const { scene:openingScene,minutes:v10ClockSeed } = advanceStoryClock(sceneAt(),sceneUpdate(reviewedScene),
        {clock:storyMinuteAt(),elapsed});
    const carry = {
        storyCorrections:(cs.storyCorrections || []).map(item=>({...structuredClone(item),anchor:'seed',replyNo:0})),
        v10, v10ClockSeed, components:cs.components ? structuredClone(cs.components) : undefined,
        activeSets: [...cs.activeSets], presets: structuredClone(cs.presets), locks: structuredClone(cs.locks),
        used: structuredClone(cs.used), picks: structuredClone(cs.picks), pronouns: cs.pronouns ? structuredClone(cs.pronouns) : undefined,
        goals: g ? { ...structuredClone(g), steps: g.steps.map(s => ({ ...s, doneManual: stepDone(s, p) || !!s.doneManual })) } : undefined,
        burned: burnedHere(burnedSoFar),
        stateSeed: structuredClone(stateAt(Infinity, { overrides: false, includeTemporary: false })),
        sceneSeed: openingScene,
        stateOverrides: Object.fromEntries(Object.entries(cs.stateOverrides || {}).map(([k, v]) => [k, { ...structuredClone(v), anchor: 'seed' }])),
        sceneOverrides: Object.fromEntries(Object.entries(cs.sceneOverrides || {})
            .filter(([key,value])=>!Object.hasOwn(reviewedScene,key) || reviewedScene[key]===value.value)
            .map(([k, v]) => [k, { ...structuredClone(v), anchor: 'seed' }])),
        blockedEventTags: structuredClone(cs.blockedEventTags || []),
        excludedHostBooks: structuredClone(cs.excludedHostBooks || []),
        hiddenBookCards: structuredClone(cs.hiddenBookCards || []),
        chapterOf: oldChat, reusableBookHistory:cs.reusableBookHistory ? [...cs.reusableBookHistory] : undefined,
        previousStoryWorlds: [...new Set([wid,...(cs.previousStoryWorlds || [])].filter(Boolean))],
    };
    // Save the continuation in its own physical book before switching chats.
    const name = 'The story before this chat';
    const nextWorld = await enqueue(async () => {
        const source = wid ? await loadWorld(wid) : null;
        if (wid && !source) throw new Error('The current Story World could not be read.');
        if (chatState()!==cs) throw new Error('The chat changed before the continuation could start.');
        const data = { entries:{} };
        if (source) for (const item of entriesOf(source,wid)) {
            const entry = structuredClone(item);
            if (entry.extensions?.ri) {
                delete entry.extensions.ri.set;
                if (entry.extensions.ri.kind==='chapter') entry.disable = true;
                const record=isWorldEntry(entry) && readRecord(readWorldEntry(entry));
                if (record) {
                    if (record.kind==='emotion') record.emotionAge=emotionReplyAge(record,c.chat || []);
                    record.atIndex=0;
                    entry.extensions.ri.fields.data=JSON.stringify(record);
                }
            }
            data.entries[entry.uid] = entry;
        }
        const label = cleanSetName(wid ? setName(wid) : names().char).slice(0,58);
        const taken = new Set([...worldNames(),...Object.keys(settings().sets)].map(value=>value.toLowerCase()));
        let title = `${label || 'Story World'} (chapter)`;
        for (let number=2;taken.has(title.toLowerCase());number++) title = `${label || 'Story World'} (chapter ${number})`;
        const roll = newWorldEntry(data,'chapter');
        Object.assign(roll,{name,auto:false,on:true,rollup:true,span:{chat:oldChat,from:1,to:oldReplyCount}});
        roll.fields.summary = summary;
        roll.activation = readActivation({mode:'window',window:6,chance:100,sticky:0,
            keys:[openingScene.where,...String(openingScene.present || '').split(/,|;/)].filter(value=>value?.trim()),
            ...draft.activation,after:0});
        writeWorldEntry(data,roll,title);
        const id = await createSet(title,'world',data,'');
        const saved = await loadBook(id);
        if (saved?.entries?.[roll.uid]?.extensions?.ri?.fields?.summary!==summary) {
            throw new Error('The host did not confirm saving the continuation summary. The source chat is still open.');
        }
        return id;
    },{propagate:true});
    if (chatState()!==cs) throw new Error('The continuation book was saved. Reopen the source chat to start the new chat.');
    // 3. The new chat.
    await c.executeSlashCommandsWithOptions('/newchat');
    for (let i = 0; i < 100 && (chatId() === oldChat || !chatId()); i++) await new Promise(r => setTimeout(r, 100));
    if (!chatId() || chatId() === oldChat) throw new Error(`The new chat did not open. The prepared World Info book was saved as “${nextWorld}”.`);
    const ncs = chatState();
    for (const [k, v] of Object.entries(carry)) if (v !== undefined) ncs[k] = v;
    // Corrections inherited from the prior chapter are the baseline for every branch of this new chat.
    ncs.correctionHistory = [...Object.entries(ncs.stateOverrides || {}).map(([key, entry]) => ({ kind: 'state', key, entry: structuredClone(entry), anchor: 'seed' })), ...Object.entries(ncs.sceneOverrides || {}).map(([key, entry]) => ({ kind: 'scene', key, entry: structuredClone(entry), anchor: 'seed' }))];
    setChatWorld(nextWorld);
    if (typeof attachedHostBook==='string' && attachedHostBook) ctx().chatMetadata.world_info = attachedHostBook;
    delete ncs.worldFrom;
    delete ncs.carried;
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
    const opening = chat[0];
    if (opening) {
        opening.extra ||= {};
        opening.extra[KEY] = { v:1,time:Date.now(),items:[],type:'chapter-opening',scene:carry.sceneSeed,v10Minutes:v10ClockSeed };
    }
    try { await c.saveChat?.(); } catch { /* saved with the next change */ }
    try { await c.reloadCurrentChat?.(); } catch { /* the chat is redrawn the next time it is opened */ }
    addLog({ what: 'New chapter', ok: true, result: `A new chat was started. It carries ${carry.activeSets.length} ${carry.activeSets.length === 1 ? 'set' : 'sets'} that were on, a separate Story World book${g?.on ? ', the goal' : ''}, the pronouns, what has already happened for good, the summary and the first message. The chat you were in is unchanged.`, details: [], got: '' });
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
        `Rules: ${promptText('starterWorld', { char: n.char, user: n.user })} ${promptText('memoryFacts')}`,
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
