import { readActivation } from './recall.js';
import { separateReply } from './reply-format.js';
import { memoryComponents, memoryOnly } from './components.js';
import { promptText } from './prompts.js';
import { stateAt, sceneAt, storyMinuteAt, sceneUpdate, sceneFromReplyHeader, SCENE_FIELDS, changesFromProfiles } from './state.js';
import { advanceStoryClock, validElapsed } from './story-clock.js';
import { historySourceMark, historySourceMatches, storyRevision } from './history-source.js';
import { carryStoryJournal, editableReplySlots, filedThrough, projectStoryJournal, reserveStoryUids } from './memory-journal.js';
import { automaticAllowed, executionScope, runOperationChain } from './execution.js';
import { stripStoredQuickText } from './quick-action-chat.js';
import { storyCorrectionPrompt } from './correction-rules.js';
import { estimateTokens } from './context-budget.js';
import { ensureWorld, enabledV10, effectiveModules, extractUpdate, readRecord, recordMap, portrayalSources, updateContract, baseWorld, emotionReplyAge, prefs, replyDiagnostics } from './v10.js';
// The story so far, kept by the extension itself.
//  - Chapters: one AI request writes a summary of a stretch of replies. It is filed in the chat's story world as a
//    "chapter" entry and sent with the story notes. A chapter is cut when a scene ends, after a set number of
//    replies, or by hand.
//  - New chapter: a detailed summary and a new first message, then a brand new chat that carries everything over.
//  - Starter world: one AI request reads the character card, its lorebook and the greeting, and proposes entries.
import { ctx, KEY, LOG, names, on, parseJson, isReply, isStory, isGenerating, worldNames, loadBook } from './st.js';
import { request } from './ai.js';
import { settings, chatState, saveChatState } from './store.js';
import { addLog } from './log.js';
import { chatWorld, setChatWorld, loadWorld, saveWorld, listWorld, newWorldEntry, writeWorldEntry, renderEntry, HUD_BLOCKS, WORLD_KINDS, DONE, chatTimes, chapterIsMine, readWorldEntry, isWorldEntry } from './world.js';
import { enqueue, worldIdle, syncWorld, loadDurableWorld, loadEffectiveWorld, saveVerifiedWorld, attachChange, attachChanges, parseUpdate, applyOps, applyStructuredUpdates, creationFingerprint, stripUpdateBlock, shownChanges, describeChange } from './worldflow.js';
import { createSet, entriesOf, freeUid, setName, cleanSetName } from './books.js';
import { goals, goalProgress, stepDone } from './goals.js';
import { writerRules } from './pacing.js';
import { hideCovered, restoreChapterHistory, installAssemblyHiding, hidingMode, syncStoredHiding, clearStoredHiding } from './hide.js';
import { memoryActive } from './memory/import.js';
import { memoryStore as chatMemoryStore } from './memory/store.js';
import { MEMORY, fold, forgetFold, revisionOf, storedMark } from './memory/fold.js';
import * as SF from './memory/story-so-far.js';
import { desktopQueue } from './memory/queue.js';
import { storyWorld } from './memory/story-world-book.js';
import { remainderForChapter, chapterWithCapture } from './memory/capture.js';

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
        const original = m.is_user ? stripStoredQuickText(String(m.mes)) : String(m.mes);
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
    if (memoryActive()) throw new Error('This chat leaves the messages its chapters cover out of each request as it is sent, so there is no history window to apply.');
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
export async function writeChapter(from, to, why, {automatic=false} = {}) {
    if (busy) throw new Error('A chapter is already being written.');
    const wid = chatWorld();
    const chat = chatId(), scope = executionScope(), root = chatState();
    if (!wid) throw new Error('This chat has no story world to keep chapters in.');
    busy = true;
    let res;
    try {
        await worldIdle();
        const before = await loadWorld(wid);
        if (scope !== executionScope() || wid !== chatWorld()) throw new Error('The chat or Story World changed before the chapter started.');
        if (to > filedThrough()) throw new Error('That range includes editable replies. Wait until they are filed, or change the editing window in Context & Memory.');
        const text = storyText(from, to, 0);
        const anchor = replies().find(r=>r.n===to);
        if (!text) throw new Error('There is nothing to summarise yet.');
        if (automatic) {
            if (!automaticAllowed('chapterSummary')) return '';
            const source = historySourceMark({mes:text});
            const attempt = root.chapterAutoAttempt;
            // Continue offering manual recovery after a failed attempt for the same source.
            if (attempt?.world===wid && attempt.from===from && attempt.to<=to &&
                attempt.source===historySourceMark({mes:attempt.to===to ? text : storyText(from,attempt.to,0)})) return '';
            root.chapterAutoAttempt = {world:wid,from,to,source};
            saveChatState();
        }
        const earlier = chaptersOf(listWorld(before, wid)).slice(-3);
        res = await request({ operation:'chapterSummary',authorization:automatic ? 'automatic' : 'manual',
            target:{chat,from,to,label:`Replies ${from}–${to}`},what:'Write a chapter of the story so far',system:'You keep the story notes of a roleplay. You answer with JSON only.',
            user:chapterPrompt(text,earlier),tokens:700 });
        const answer = String(res.text);
        const obj = parseJson(answer.slice(Math.max(0, answer.indexOf('{'))));
        if (!obj || typeof obj !== 'object' || Array.isArray(obj) || !clean(obj.summary)) {
            const msg = `The AI answered, but no summary could be read from the answer. It began: "${clean(answer).slice(0, 140)}". The Log tab has the whole answer.`;
            res.note(msg, false);
            throw new Error(msg);
        }
        if (executionScope() !== scope) { res.note('The chat changed while the chapter was being written, so it was not filed.', false); throw new Error('The chat changed while the chapter was being written.'); }
        let name = '';
        let moved = 0;
        let hidden = 0;
        await enqueue(async () => {
            const data = await loadDurableWorld(wid);
            const lastRe = replies().find(r => r.n === to);
            if (executionScope()!==scope || chatWorld()!==wid || !memoryComponents().chapters || !lastRe || to > filedThrough() ||
                lastRe.time!==anchor?.time || storyText(from,to,0)!==text) {
                const reason = 'The source history or chapter settings changed while the summary was being written. No chapter was saved.';
                res.note(reason,false);
                throw new Error(reason);
            }
            const w = newWorldEntry(reserveStoryUids(data,wid), 'chapter');
            Object.assign(w, { name: clean(obj.title) || `Replies ${from} to ${to}`, auto: true, at: { chat, n: to }, span: { chat, from, to, ...(lastRe?.time ? { time: String(lastRe.time) } : {}) } });
            Object.assign(w.fields, { summary: clean(obj.summary), when: clean(obj.when), people: asList(obj.people), places: asList(obj.places), settled: clean(obj.settled) });
            // What is finished moves into the chapter: it is written into it in one line each and turned off, so the
            // world holds what is still open. Entries set to "keep it as I wrote it" are left alone.
            const retired = memoryOnly() || settings().summary.retire === false ? [] : listWorld(data, wid).filter(x => x.on && !x.locked && (x.kind === 'secret' ? x.status === 'out' : DONE[x.kind] && x.status === DONE[x.kind]));
            if (retired.length) w.fields.closed = retired.map(finishedLine).join(' ');
            writeWorldEntry(data, w, wid);
            for (const x of retired) { x.on = false; writeWorldEntry(data, x, wid); }
            await saveVerifiedWorld(wid,data);
            if (executionScope()!==scope || chatWorld()!==wid) throw new Error('The chapter was saved to its original Story World. Reopen that chat to review it.');
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
    } catch (error) {
        res?.note(error.message,false);
        throw error;
    } finally { busy = false; }
}

/** After a reply: is a chapter due? Runs by itself in the background. replyNo: the number of the reply just written. */
export function chapterAfterReply(time, replyNo, onDone) {
    // A chat whose memory lives in chat data closes its chapters there (MB6); the Story World chapter path below is for
    // a chat that has not moved over yet.
    if (memoryActive()) return queueChapterWork({ onDone });
    const o = settings().summary;
    const expectedChat = chatId(), expectedWorld = chatWorld();
    if (!memoryComponents().chapters || !automaticAllowed('chapterSummary') || busy) return;
    return worldIdle().then(async () => {
        const wid = chatWorld();
        if (!wid || expectedChat !== chatId() || expectedWorld !== wid || !memoryComponents().chapters || busy) return;
        const rec = (ctx().chat || []).map(m => m?.extra?.[KEY]).find(r => r && String(r.time) === String(time));
        if (!rec) return;
        const data = await loadWorld(wid).catch(() => null);
        if (!data || expectedChat !== chatId() || expectedWorld !== chatWorld()) return;
        const last = coveredUpTo(listWorld(data,wid));
        const through = Math.min(replyNo,filedThrough());
        const since = through-last;
        const min = Math.max(1, Math.round(Number(o.minReplies) || 1));
        const every = Math.max(0, Math.round(Number(o.every) || 0));
        const tokens = Math.max(0, Math.round(Number(o.everyTokens) || 0));
        let why = '';
        let to = through;
        const scene = o.onSceneEnd && !memoryOnly() && replies().find(turn=>turn.n>=last+min && turn.n<=through &&
            ctx().chat[turn.index]?.extra?.[KEY]?.update?.ended);
        if (scene) { why = 'the scene ended'; to = scene.n; }
        else if (every && since >= every) { why = `${every} filed replies are ready`; to = last+every; }
        else if (tokens && since>0 && estimateTokens(storyText(last+1,through,0))>=tokens) why = `the unsummarized story reached about ${tokens} tokens`;
        if (!why) return;
        try { if (await writeChapter(last+1,to,why,{automatic:true})) onDone?.(); }
        catch (e) { console.warn(LOG, 'chapter', e); }
    }).catch(e => console.warn(LOG, 'chapter', e));
}

/** "Write a chapter now": everything since the last chapter. */
export async function writeChapterNow() {
    if (chatState()?.components?.chapters===false) throw new Error('Turn on Chapter summaries for this chat first.');
    if (memoryActive()) return closeChapterHere();
    const wid = chatWorld();
    if (!wid) throw new Error('This chat has no story world to keep chapters in.');
    const data = await loadWorld(wid);
    const to = filedThrough();
    const from = coveredUpTo(listWorld(data, wid)) + 1;
    if (to < from) throw new Error('No uncovered filed replies are ready for a chapter.');
    return writeChapter(from, to, 'you asked for it');
}

/** Partition uncovered history on reply boundaries. A long exchange is sent whole in its own request. */
export function catchUpBatches(chat, covered, every, budget = 28000, splitAfter = 0, playerText = message => message.mes) {
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
            const prose = message.is_user ? playerText(message) : separateReply(message.mes).text
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

function historyPlan(chat,rows,id,rebuild,repair) {
    const replyList = replies();
    const covered = rebuild ? new Set() : chapterCoverage(rows,id,replyList.length);
    const stableThrough = rebuild ? Math.max(0,replyList.length-editableReplySlots()) : filedThrough();
    if (!rebuild) for (const {index,n} of replyList) {
        const rec = chat[index]?.extra?.[KEY];
        if (!rec?.historySource?.length || rec.stateStale || !historySourceMatches(chat,index,rec.historySource)) continue;
        const from = index+1-rec.historySource.length;
        for (const prior of replyList) if (prior.n<=n && prior.n>stableThrough && prior.index>=from) covered.add(prior.n);
    }
    if (repair) for (const row of replyList) if (row.n < repair.from) covered.add(row.n);
    const chapterThrough = repair && memoryComponents().chapters ? Math.min(stableThrough,repair.chapterThrough) : stableThrough;
    const batches = catchUpBatches(chat,covered,Math.max(1,Number(settings().summary.every) || 20),28000,chapterThrough,
        message=>stripStoredQuickText(String(message.mes)));
    return {batches,covered,replyList,stableThrough,chapterThrough};
}

/** Inspect batch counts against the open timeline and current saved chapter coverage. */
export async function historyCatchUpPreview() {
    const chat = ctx().chat, id = executionScope(), wid = chatWorld();
    const data = wid ? await loadDurableWorld(wid) : null;
    if (wid && !data) throw new Error('The Story World could not be read.');
    if (ctx().chat!==chat || executionScope()!==id || chatWorld()!==wid) throw new Error('Open the current chat to preview catch-up.');
    const rows = data ? listWorld(data,wid) : [];
    const summarize = rebuild => {
        const {batches,stableThrough} = historyPlan(chat || [],rows,chatId(),rebuild,null);
        return {count:batches.length,batches:batches.map(({from,to})=>({from,to,pending:to>stableThrough}))};
    };
    return {catchUp:summarize(false),rebuild:summarize(true)};
}

let catchUp = null;
export const historyCatchUpStatus = () => catchUp?.scope === executionScope() ? structuredClone(catchUp) : null;
export function stopHistoryCatchUp() {
    if (catchUp?.scope === executionScope() && catchUp.running && !catchUp.installing) catchUp.stop = true;
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
        if (!keepChapter) rec.historyScene = true;
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

async function attachHistoryBatch(wid, batch, staged, original, safeEnd, {pending=false} = {}) {
    const {rec,chapter,changes} = staged;
    const message = ctx().chat[batch.end];
    rec.historySource = original.slice(batch.start,batch.end+1);
    if (rec.update?.undone) delete rec.update;
    message.extra ||= {};
    message.extra[KEY] = rec;
    const swipe = message.swipe_info?.[message.swipe_id];
    if (swipe) { swipe.extra ||= {}; swipe.extra[KEY] = rec; }
    const dates = safeEnd === undefined || pending ? [] : await hideCovered(safeEnd,{persist:false});
    if (pending) {
        rec.update ||= {world:wid,ops:[],ended:false,changes:[]};
        rec.update.windowVersion = 1;
        const prior = rec.update.pending?.changes || [];
        rec.update.pending = {chat:chatId(),revision:storyRevision(message,batch.end),historySource:rec.historySource,historyScene:rec.historyScene,
            changes:[...prior,...changes.map(change=>({...change,historyDerived:true}))]};
    }
    attachChanges(rec.time,wid,[...(pending ? [] : changes),
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
    const status = catchUp = {chat:id,scope:executionScope(),running:true,stop:false,done:0,total:0,hidden:0,records:0,
        chapters:0,editableBatches:0,receipts:[],text:'Preparing chat history…'};
    const onReceipt = receipt => {
        const index = status.receipts.findIndex(current=>current.id===receipt.id);
        if (index<0) status.receipts.push(receipt);
        else status.receipts[index] = receipt;
    };
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
        const {batches,covered,replyList,stableThrough,chapterThrough} = historyPlan(chat,oldRows,id,rebuild,repair);
        status.total = batches.length;
        let timestamp = Math.max(Date.now(), ...chat.map(message=>Number(message?.extra?.[KEY]?.time) || 0));
        for (const batch of batches) {
            if (status.stop) break;
            validate();
            report(`Reading replies ${batch.from}–${batch.to} · batch ${status.done + 1} of ${status.total}…`);
            const pending = batch.to > stableThrough;
            const before = listWorld(rebuild ? stagingBook : pending ? await loadEffectiveWorld(wid) : await loadWorld(wid),wid);
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
            const response = await request({operation:'historyCatchUp',authorization:'manual',
                target:{chat:id,from:batch.from,to:batch.to,label:`Replies ${batch.from}–${batch.to}`},what:`Catch up story history, replies ${batch.from}–${batch.to}`,
                system:promptText('systemCatchUp'),
                user:form,tokens:track ? 2300 : 700,onReceipt});
            try {
                validate();
                if (status.stop) { response.note('Catch-up stopped before this chapter was saved.',false); break; }
                const {summary, parsed, ops} = catchUpPayload(response.text,batch,track,structured);
                const payload = {summary,parsed,ops};
                const meta = {chat:id,n:batch.to};
                const config = {track,structured,modules,previous,previousClock,base:baseWorld(root.v10),
                    keepChapter:!pending && (!repair || batch.to<=chapterThrough)};
                const existing = chat[batch.end].extra?.[KEY];
                if (rebuild) {
                    const rec = savedHistoryRecord(existing) || {v:1,items:[],type:'history',time:++timestamp};
                    const build = pending ? projectStoryJournal(stagingBook,wid,{chat:[],root:{storyJournalCarry:stagedBatches
                        .filter(item=>item.pending).map(item=>({world:wid,chat:id,revision:storyRevision(chat[item.batch.end],item.batch.end),changes:item.staged.changes}))}}).data : stagingBook;
                    const staged = fileHistoryBatch(build,wid,meta,batch,payload,rec,config);
                    stagedBatches.push({batch,staged,pending});
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
                    const data = pending ? projectStoryJournal(originalBook,wid,{chat,root}).data :
                        reserveStoryUids(structuredClone(originalBook),wid,chat,root);
                    const live = chat[batch.end].extra?.[KEY];
                    if (live?.update?.world && live.update.world!==wid && !live.update.undone) throw new Error('This reply already belongs to a different Story World.');
                    const rec = live ? structuredClone(live) : {v:1,items:[],type:'history',time:++timestamp};
                    if (live?.update?.undone || live?.stateStale) rec.time = ++timestamp;
                    const staged = fileHistoryBatch(data,wid,meta,batch,payload,rec,config);
                    if (!pending) await saveVerifiedWorld(wid,data);
                    if (!current() || chatWorld() !== wid) {
                        if (!pending) await saveWorld(wid,originalBook);
                        throw new Error('The chat or Story World changed while saving. Run catch-up again from its saved chapters.');
                    }
                    for (let number = batch.from; number <= batch.to; number++) covered.add(number);
                    let last = 0;
                    while (covered.has(last + 1)) last++;
                    const rollback = historyCheckpoint(chat,root);
                    let hidden;
                    try {
                        hidden = await attachHistoryBatch(wid,batch,staged,original,staged.chapter ? replyList[Math.min(last,batch.to)-1]?.index : undefined,{pending});
                        await c.saveChat?.();
                    } catch (error) {
                        if (current() && chatWorld() === wid) { rollback(); saveChatState(); }
                        if (!pending) await saveWorld(wid,originalBook);
                        throw error;
                    }
                    status.hidden += hidden;
                    status.records += staged.changes.length;
                    status.chapters += Number(!!staged.chapter);
                    status.editableBatches += Number(pending);
                    status.done++;
                    saveChatState();
                },{propagate:true});
                response.note(pending ? `Kept history updates for replies ${batch.from}–${batch.to} editable.` :
                    `Saved chapter and history updates for replies ${batch.from}–${batch.to}.`,true,summaryNotes(summary.summary));
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
                    delete root.storyJournalCarry;
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
                    for (const {batch,staged,pending} of stagedBatches) {
                        if (!keepAuthored) { delete staged.rec.stateEdits; delete staged.rec.snapshotEdits; }
                        status.hidden += await attachHistoryBatch(wid,batch,staged,original,batch.end,{pending});
                        status.records += staged.changes.length;
                        status.chapters += Number(!!staged.chapter);
                        status.editableBatches += Number(pending);
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
        const saved = `Saved ${status.chapters} chapter${status.chapters===1 ? '' : 's'} and kept ${status.editableBatches} recent batch${status.editableBatches===1 ? '' : 'es'} editable. Hid ${status.hidden} covered messages from the model.`;
        report(status.stop && rebuild ? 'Rebuild stopped. The previous Story World is still in use.' : status.stop ? `Paused after ${status.done} of ${status.total} batches.` :
            status.book ? `Switched to ${status.book}. ${saved}` : status.total ? saved : 'All available history has chapter coverage or editable records.');
        return {...status};
    } catch (error) {
        report(`${error.message} ${rebuild ? 'The previous book remains available.' : `${status.done} batch${status.done===1 ? '' : 'es'} saved in this run.`}`);
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
    if (!wid || !automaticAllowed('chapterCombine')) return;
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
    const res = await request({ operation:'chapterCombine',authorization:'automatic',target:{chat},
        what:'Combine the older chapters into one',system:'You keep the story notes of a roleplay. You answer with JSON only.',user,tokens:900 });
    const answer = String(res.text);
    const obj = parseJson(answer.slice(Math.max(0, answer.indexOf('{'))));
    if (!obj || !clean(obj.summary)) { res.note('No combined summary could be read from the answer, so the chapters were left as they are.', false); return; }
    await enqueue(async () => {
        if (chatId()!==chat || chatWorld()!==wid) throw new Error('The chat changed before the combined chapter could be saved.');
        const d = await loadWorld(wid);
        if (chatId()!==chat || chatWorld()!==wid || JSON.stringify(d)!==JSON.stringify(data)) {
            throw new Error('The Story World changed before the combined chapter could be saved.');
        }
        const now = listWorld(d, wid);
        const roll = now.find(w => w.kind === 'chapter' && w.rollup && w.on) ||
            Object.assign(newWorldEntry(reserveStoryUids(d,wid), 'chapter'), { name: 'Before the latest chapters', rollup: true, auto: true });
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
        const data = await loadEffectiveWorld(wid).catch(() => null);
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
    const res = await request({operation:'newChapter',authorization:'manual',what:'Write a new chapter (summary and first message)',
        system:'You continue a roleplay story into a new chat. You follow the form you are given.',user,tokens:1800});
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
    const stableReplyCount = filedThrough();
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
        const transferRecord = record => {
            if (!record) return record;
            if (record.kind==='emotion') record.emotionAge=emotionReplyAge(record,c.chat || []);
            record.atIndex=0;
            return record;
        };
        const transferField = value => {
            const record = parseJson(String(value || ''),{object:true});
            return record?.id ? JSON.stringify(transferRecord(record)) : value;
        };
        if (source) for (const item of entriesOf(source,wid)) {
            const entry = structuredClone(item);
            if (entry.extensions?.ri) {
                delete entry.extensions.ri.set;
                if (entry.extensions.ri.kind==='chapter') entry.disable = true;
                const record=isWorldEntry(entry) && readRecord(readWorldEntry(entry));
                if (record) entry.extensions.ri.fields.data=JSON.stringify(transferRecord(record));
            }
            data.entries[entry.uid] = entry;
        }
        const label = cleanSetName(wid ? setName(wid) : names().char).slice(0,58);
        const taken = new Set([...worldNames(),...Object.keys(settings().sets)].map(value=>value.toLowerCase()));
        let title = `${label || 'Story World'} (chapter)`;
        for (let number=2;taken.has(title.toLowerCase());number++) title = `${label || 'Story World'} (chapter ${number})`;
        if (source) data.extensions = {riNextUid:freeUid(projectStoryJournal(source,wid,{chat:c.chat || [],root:cs}).data)};
        const roll = newWorldEntry(data,'chapter');
        Object.assign(roll,{name,auto:false,on:true,rollup:true,...(stableReplyCount ? {span:{chat:oldChat,from:1,to:stableReplyCount}} : {})});
        roll.fields.summary = summary;
        roll.activation = readActivation({mode:'window',window:6,chance:100,sticky:0,
            keys:[openingScene.where,...String(openingScene.present || '').split(/,|;/)].filter(value=>value?.trim()),
            ...draft.activation,after:0});
        writeWorldEntry(data,roll,title);
        const id = await createSet(title,'world',data,'');
        const saved = await loadDurableWorld(id);
        if (saved?.entries?.[roll.uid]?.extensions?.ri?.fields?.summary!==summary) {
            throw new Error('The host did not confirm saving the continuation summary. The source chat is still open.');
        }
        if (source) carry.storyJournalCarry = carryStoryJournal(source,wid,c.chat || [],cs).map(item=>{
            const changes = item.changes.map(change=>{
                if (change.type==='set' && change.field==='data') return {...change,before:transferField(change.before),after:transferField(change.after)};
                if (change.type==='create' && change.entry?.fields?.data) {
                    const entry = {...change.entry,fields:{...change.entry.fields,data:transferField(change.entry.fields.data)}};
                    return {...change,entry,createdState:creationFingerprint(entry)};
                }
                return change;
            });
            return {...item,world:id,changes};
        });
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
    const res = await request({operation:'starterWorld',authorization:'manual',what:'Fill a story world from the character card',
        system:'You set up the story notes of a roleplay. You follow the form you are given.',user,tokens:1400});
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
    const scope = executionScope(), wid = chatWorld();
    return enqueue(async () => {
        if (!wid) throw new Error('This chat has no story world.');
        const data = await loadDurableWorld(wid);
        if (executionScope()!==scope || chatWorld()!==wid || !data) throw new Error('The Story World changed before adding the reviewed entries.');
        const changes = applyOps(reserveStoryUids(data,wid), wid, ops, { chat: chatId(), n: 0 }, 'all', 60);
        if (changes.length) await saveVerifiedWorld(wid,data);
        const out = shownChanges(changes).map(describeChange);
        addLog({ what: 'Story world update', ok: true, result: `${out.length} ${out.length === 1 ? 'change was' : 'changes were'} made from the character card.`, details: out, got: '' });
        return out;
    },{propagate:true});
}

// ---------- chapters in chat data (memory DESIGN 6, MB6) ----------
// A chat whose memory lives in chat data keeps its chapters as range records in the chat log (src/memory/store.js).
// After each reply code decides whether the open chapter closes (6.1) and queues a chapter job; the job runs on the
// Writer chain (routing.js, desktop first), quotes its evidence first, is checked by code with one repair retry, and on
// a second failure leaves the chapter open with a receipt that offers Repair (6.2). From the third close on the same job
// rebuilds the condensed account from the stored chapter records, so the chapter, the condensed account and the
// messages they replace reach the request at the same close (6.4, 6.5). Messages leave a request only at assembly, in
// the generate interceptor, while a valid chapter covers them (6.3). A stale chapter (an edit, a swipe or a delete inside
// it) sends its messages raw and is rebuilt when the Writer route is free: MB2 queues its job, and this file runs it.

// The generated Story World book (MB13) rewrites after each chapter close. Tests hand in their own book.
let storyWorldBook = storyWorld;
export const useStoryWorldBook = fn => { storyWorldBook = typeof fn === 'function' ? fn : storyWorld; };

const WRITER_INPUT_TOKENS = 12000;   // a 16K desktop context less the answer and the instructions (DESIGN 10, context size)
const FAILURES_KEPT = 5;

/** Is a chapter job of this chat allowed to run without a tap? On by default (MB6 scope); off when you turned it off. */
function autoChapters() {
    const saved = settings().execution?.functions?.chapterSummary;
    return saved && Object.hasOwn(saved, 'automatic') ? saved.automatic !== false : true;
}

/** The close rules: the defaults of memory DESIGN 6.1 as MB11 measured them, or your own values in Setup. */
function closeRules() {
    const o = settings().summary || {};
    const num = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.round(Number(value)) : fallback);
    return { minExchanges: num(o.minExchanges, SF.CLOSE_DEFAULTS.minExchanges), maxExchanges: num(o.maxExchanges, SF.CLOSE_DEFAULTS.maxExchanges),
        ceilingShare: Number(o.ceilingShare) > 0 && Number(o.ceilingShare) < 1 ? Number(o.ceilingShare) : SF.CLOSE_DEFAULTS.ceilingShare };
}

/** The chat model's size class (5.3): your choice in Setup, Memory, or the context length SillyTavern is set to. */
export function chapterSize() {
    const manual = settings().summary?.size;
    let context = 0;
    try { context = Number(ctx().maxContext) || 0; } catch { /* no host */ }
    const key = SF.SIZE_CLASSES[manual] ? manual : SF.sizeClass(context);
    return { key, ...SF.SIZE_CLASSES[key], context };
}

/** The prose of a message as the chapter call reads it: without stored quick text, HUD blocks or update blocks. */
function chapterText(m) {
    const original = m.is_user ? stripStoredQuickText(String(m.mes ?? '')) : String(m.mes ?? '');
    const extracted = memoryOnly() && !m.is_user ? separateReply(original).text : original;
    return tidy(extracted || original);
}

const metaMemory = () => ctx().chatMetadata?.[MEMORY] || null;

/** The cast and alias table: the two names of the chat and every person record with its other names. */
function castOf(result) {
    const n = names();
    const out = [{ name: n.char, aliases: [] }, { name: n.user, aliases: [] }];
    for (const rec of result.current) {
        if (!['person', 'character', 'profile'].includes(rec.kind)) continue;
        const name = clean(rec.subject || rec.name || rec.view?.name);
        if (name && !out.some(p => p.name === name)) out.push({ name, aliases: [...(rec.aliases || [])] });
    }
    return out.filter(p => p.name);
}

/** Places memory knows: the scene of each reply and every place record. */
function placesOf(result, chat) {
    const out = new Set();
    for (const m of chat) { const where = SF.sceneOf(m, KEY).where; if (where) out.add(where); }
    for (const rec of result.current) if (rec.kind === 'place') out.add(clean(rec.subject || rec.view?.name));
    return [...out].filter(Boolean);
}

/**
 * The chapters of the open chat now: the fold, the chapters with their coverage, and the chapter view.
 * forRequest: the generation type; a swipe or regenerate leaves out a chapter that covers the reply being replaced.
 */
export function chapterState({ forRequest = '' } = {}) {
    const c = ctx();
    const chat = c.chat || [];
    const meta = c.chatMetadata || {};
    const result = fold(chat, meta);
    let chapters = SF.chaptersOf(chat, result);
    if (/^(swipe|regenerate)$/.test(forRequest)) chapters = chapters.map(ch => (ch.last >= chat.length - 1 ? { ...ch, valid: false } : ch));
    const size = chapterSize();
    const condensed = result.byId.get('condensed') || null;
    const view = SF.chapterView(chapters, { condensed: condensed && !['retired', 'replaced', 'merged'].includes(condensed.status) ? condensed : null, cap: size.view });
    return { chat, result, chapters, covered: SF.coverage(chapters), view, size, condensed, failures: [...(metaMemory()?.chapterFailures || [])] };
}

/** The generate interceptor's view of this chat, or null when chapters do not apply. */
function assemblyFor({ type }) {
    if (!memoryActive() || !memoryComponents().chapters) return null;
    const state = chapterState({ forRequest: String(type || '') });
    if (!state.view.text && !state.covered.size) return null;
    return { covered: state.covered, view: state.view.text, chapters: state.view.ids, hide: memoryComponents().hide, apply: SF.leaveOut };
}

/** The revisions a job reads: every story message of its span, keyed by mark. */
function spanSources(chat, from, to) {
    const out = {};
    for (let i = from; i <= to; i++) if (SF.storyMessage(chat[i])) { const rev = revisionOf(chat[i]); if (rev.mark) out[rev.mark] = `${rev.swipe}:${rev.hash}`; }
    return out;
}

function closeJob(chat, from, to, why, payload = {}) {
    return { chatId: chatId(), kind: 'chapter', subject: payload.rebuild ? payload.rebuild : `close:${storedMark(chat[from])}`, order: from,
        sources: spanSources(chat, from, to), payload: { from: storedMark(chat[from]), to: storedMark(chat[to]), why, ...payload } };
}

/**
 * After a reply, a swipe, an edit or a delete: queue what the chapters of this chat need. A close when a rule says so,
 * a chapter for each span a removed chapter left uncovered, and the condensed account when it no longer matches the
 * chapters it stands for. Stale chapters are queued by the memory store (MB2) and run here.
 */
export async function queueChapterWork({ onDone } = {}) {
    try {
        if (!memoryActive() || !memoryComponents().chapters) return null;
        const store = chatMemoryStore();
        if (store.marks()) { try { await ctx().saveChat?.(); } catch { /* saved with the next change */ } }
        const state = chapterState();
        const jobs = [];
        if (autoChapters()) {
            for (const gap of SF.gaps(state.chat, state.chapters)) jobs.push(closeJob(state.chat, gap.from, gap.to, 'a chapter that covered these messages was removed'));
            const d = SF.closeDecision(state.chat, state.chapters, { ceiling: Math.min(state.size.ceiling, state.size.context || Infinity), rules: closeRules(), textOf: chapterText, sceneKey: KEY });
            if (d.close) jobs.push(closeJob(state.chat, d.from, d.to, d.why));
            const valid = state.chapters.filter(ch => ch.valid);
            const older = valid.slice(0, -2);
            if (older.length && !jobs.length && !SF.condensedCurrent(state.condensed, older)) {
                jobs.push({ chatId: chatId(), kind: 'storySoFar', subject: 'condensed', order: 0, sources: { chapters: older.map(ch => `${ch.id}@${ch.record.entries?.at(-1) || ''}`).join(',') }, payload: {} });
            }
        }
        const queue = desktopQueue();
        for (const job of jobs) await queue.enqueue(job);
        renderChapterDivider();
        if (jobs.length) queue.pump().then(() => { renderChapterDivider(); onDone?.(); }).catch(() => {});
        return jobs;
    } catch (error) { console.warn(LOG, 'chapter work', error); return null; }
}

/** The span a job covers now: chat indexes from its first to its last mark, or the stale chapter's present marks. */
function jobSpan(job, chat) {
    const at = mark => chat.findIndex(m => storedMark(m) === mark);
    if (job.payload?.rebuild) {
        const rec = fold(chat, ctx().chatMetadata || {}).byId.get(job.payload.rebuild);
        const present = (rec?.covers || []).map(src => at(src.mark)).filter(i => i >= 0);
        if (!present.length) return null;
        return { from: Math.min(...present), to: Math.max(...present), rebuild: rec.id, record: rec };
    }
    const from = at(job.payload?.from), to = at(job.payload?.to);
    return from > 0 && to >= from ? { from, to } : null;
}

// The settings function each Writer job belongs to, so a connection she fixed for it is the route the queue uses.
const WRITER_OPERATIONS = { chapter:'chapterSummary', storySoFar:'chapterCombine' };
const asked = (label, extra = {}) => ({ label, tokens: 1800, ...extra });

/** One Writer call with its one repair retry (6.2). check returns { problems, mood }. Returns { ok, answer, problems, route, attempts }. */
async function writerCall(jobId, { system, schema, prompt, check, label, signal, background }) {
    const first = await runOperationChain(WRITER_OPERATIONS[jobId], { system, user: prompt(), schema, signal, background, ...asked(label) });
    if (!first.ok) return { ok: false, waiting: first.waiting, reason: first.reason };
    let answer = first.value;
    let verdict = check(answer);
    if (!verdict.problems.length && !verdict.mood.length) return { ok: true, answer, problems: [], route: first.route, model: first.model };
    const error = [...verdict.problems, ...(verdict.mood.length ? [`These words describe feelings or mood outside a stated line: ${verdict.mood.join(', ')}. ${SF.REGISTER_RULE}`] : [])].join(' ');
    const again = await runOperationChain(WRITER_OPERATIONS[jobId], { system, user: prompt({ error, previous: JSON.stringify(answer) }), schema, signal, background, ...asked(`${label}, repair`) });
    if (!again.ok) return { ok: false, waiting: again.waiting, reason: again.reason, answer, problems: verdict.problems };
    answer = again.value;
    verdict = check(answer);
    // A register word left after the repair is noted on the receipt; quotes, names and length decide (6.2).
    return { ok: true, answer, problems: verdict.problems, mood: verdict.mood, route: again.route, model: again.model, repaired: true };
}

/**
 * The condensed account for a set of chapters, built from their stored records alone (6.4). Writes the arc records a
 * long story needs first. Returns the entry inputs to file (arc records and the condensed account), or [] when no call
 * is needed or the call failed (the view then uses the account code makes from the same records).
 */
async function condensedInputsFor(valid, { result, size, signal, background, anchor }) {
    const older = valid.slice(0, -2);
    if (!older.length) return [];
    const fullTokens = valid.slice(-2).reduce((sum, ch) => sum + SF.tokensOf(ch.record.text) + 40, 0);
    const budgetTokens = Math.max(60, size.view - fullTokens - 40);
    const arcs = result.current.filter(rec => rec.kind === 'arc');
    const out = [];
    let plan = SF.condensedInputs(older, { budgetTokens, inputTokens: WRITER_INPUT_TOKENS, arcs });
    for (const group of plan.needArcs) {
        const sourceOf = ch => ch.marks.map(mark => (ctx().chat || []).find(m => storedMark(m) === mark)).filter(Boolean).map(chapterText).join(' ');
        const call = await writerCall('storySoFar', { system: SF.CONDENSED_SYSTEM, schema: SF.ARC_SCHEMA, prompt: o => SF.arcPrompt(group, o), check: a => SF.checkArc(a, group, sourceOf), label: 'Arc record', signal, background });
        if (!call.ok || call.problems.length) return out;
        const record = SF.arcRecord(call.answer, group);
        arcs.push(record);
        out.push({ op: result.byId.has(record.id) ? 'revise' : 'add', target: result.byId.has(record.id) ? [record.id] : [], record, origin: { type: 'chapter', route: call.route, model: call.model }, anchor, evidence: (call.answer.evidence || []).slice(0, 3).map(e => ({ quote: e.quote })), reason: 'Arc record for the condensed account.' });
    }
    if (plan.needArcs.length) plan = SF.condensedInputs(older, { budgetTokens, inputTokens: WRITER_INPUT_TOKENS, arcs });
    const inputs = plan.inputs;
    const call = await writerCall('storySoFar', { system: SF.CONDENSED_SYSTEM, schema: SF.CONDENSED_SCHEMA, prompt: o => SF.condensedPrompt(inputs, o), check: a => SF.checkCondensed(a, inputs), label: 'Story so far', signal, background });
    if (!call.ok || call.problems.length) return out;
    const record = SF.condensedRecord(call.answer, inputs);
    out.push({ op: result.byId.has('condensed') ? 'revise' : 'add', target: result.byId.has('condensed') ? ['condensed'] : [], record, origin: { type: 'chapter', route: call.route, model: call.model }, anchor, reason: `Rebuilt from ${inputs.length} stored records.` });
    return out;
}

/**
 * Write one chapter record for chat[from..to] (6.2), and the condensed account when this close needs one. Returns
 * { ok, value: { inputs, sources } } with the entries to file, { ok, value: { failed } } after a second bad answer, or
 * { ok: false } when no route answered (the job then waits and runs again).
 */
async function writeChapterJob(span, { why = '', manual = false, signal } = {}) {
    const chat = ctx().chat || [];
    const result = fold(chat, ctx().chatMetadata || {});
    const chapters = SF.chaptersOf(chat, result);
    const cast = castOf(result), places = placesOf(result, chat);
    const titles = chapters.filter(ch => ch.last < span.from).slice(-3).map(ch => ch.record.title || ch.record.subject);
    const sources = spanSources(chat, span.from, span.to);
    const base = { chat, from: span.from, to: span.to, cast, textOf: chapterText };
    // Replies still uncaptured inside the chapter ride in this call, so they are filed before their messages leave the
    // request (memory DESIGN 7.2, MB3): their exchanges follow the chapter input and the answer carries them in "capture".
    const remainder = span.rebuild ? null : await remainderForChapter(span.to, { from: span.from }).catch(() => null);
    const withRemainder = remainder ? chapterWithCapture(remainder) : null;
    const call = await writerCall('chapter', { system: withRemainder ? `${SF.CHAPTER_SYSTEM}\n\n${withRemainder.system}` : SF.CHAPTER_SYSTEM,
        schema: withRemainder ? withRemainder.schema(SF.CHAPTER_SCHEMA) : SF.CHAPTER_SCHEMA,
        prompt: o => [SF.chapterPrompt({ ...base, titles, ...o }), withRemainder?.user].filter(Boolean).join('\n\n'),
        check: a => SF.checkChapter(a, { ...base, places }), label: `Chapter close, messages ${span.from} to ${span.to}`, signal, background: !manual });
    if (!call.ok) return { ok: false, waiting: call.waiting, reason: call.reason };
    if (call.problems.length) return { ok: true, value: { failed: { problems: call.problems, answer: call.answer, from: storedMark(chat[span.from]), to: storedMark(chat[span.to]), why } } };
    if (remainder && call.answer?.capture) await remainder.commit(call.answer.capture, { route: call.route, model: call.model });
    const record = SF.chapterRecord(call.answer, { chat, from: span.from, to: span.to, id: span.rebuild });
    const anchor = { mark: record.to };
    const inputs = [{ op: span.rebuild ? 'revise' : 'add', target: span.rebuild ? [span.rebuild] : [], record, origin: { type: 'chapter', route: call.route, model: call.model },
        anchor, evidence: SF.evidenceOf(call.answer), reason: span.rebuild ? 'Rebuilt from its messages after they changed.' : `Closed: ${why || 'by hand'}.` }];
    // The chapters as they will stand once this one is filed, for the condensed account of this close.
    const entry = { id: record.id, record, marks: record.covers.map(src => src.mark), first: span.from, last: span.to, valid: true };
    const after = [...chapters.filter(ch => ch.valid && ch.id !== record.id), entry].sort((a, b) => a.last - b.last);
    after.forEach((ch, i) => { ch.n = i + 1; });
    if (after.length >= 3) inputs.push(...await condensedInputsFor(after, { result, size: chapterSize(), signal, background: !manual, anchor }));
    return { ok: true, route: call.route, value: { inputs, sources, mood: call.mood || [] } };
}

/** True while every message a result read still shows the revision it read. */
function sourcesShow(sources) {
    const chat = ctx().chat || [];
    return Object.entries(sources || {}).every(([mark, rev]) => {
        const m = chat.find(x => storedMark(x) === mark);
        if (!m) return false;
        const now = revisionOf(m);
        return `${now.swipe}:${now.hash}` === rev;
    });
}

/** File a chapter result, or note its failure. Shared by the queue and by a close you asked for. */
async function fileChapterResult(job, value) {
    if (value?.failed) return noteFailure(value.failed, job);
    if (!value?.inputs?.length) return null;
    if (job.chatId && job.chatId !== chatId()) return null;
    if (!sourcesShow(value.sources)) {
        addLog({ what: 'Chapter close', ok: false, result: 'The messages changed while the chapter was being written, so it was not filed. It is written again from the messages as they are now.' });
        return null;
    }
    const saved = await chatMemoryStore().record(value.inputs);
    const meta = metaMemory();
    if (meta?.chapterFailures?.length) {
        const first = value.inputs[0].record;
        meta.chapterFailures = meta.chapterFailures.filter(f => f.from !== first.from);
    }
    forgetFold(ctx().chatMetadata);
    try { storyWorldBook().schedule(); } catch (error) { console.warn(LOG, 'story world book', error); }
    afterChapterChange();
    const rec = value.inputs[0].record;
    addLog({ what: 'Chapter close', ok: true, result: `Chapter "${rec.title}" covers ${rec.count} messages.${value.inputs.some(i => i.record.kind === 'condensed') ? ' The condensed account was rebuilt from the stored chapter records.' : ''}${value.mood?.length ? ` Words to check against the report register: ${value.mood.join(', ')}.` : ''}`, details: value.inputs.map(i => `${i.op} ${i.record.kind} ${i.record.id}`) });
    return saved;
}

/** A second bad answer: the chapter stays open and its messages stay in the request; the receipt offers Repair (6.2). */
async function noteFailure(failed, job) {
    const meta = metaMemory();
    if (!meta) return null;
    const item = { id: `fail-${Date.now().toString(36)}`, at: Date.now(), from: failed.from, to: failed.to, why: failed.why || '', problems: failed.problems.slice(0, 8), answer: JSON.stringify(failed.answer ?? null, null, 2).slice(0, 12000), job: job?.key || '' };
    meta.chapterFailures = [...(meta.chapterFailures || []).filter(f => f.from !== item.from), item].slice(-FAILURES_KEPT);
    try { await ctx().saveChat?.(); } catch { /* saved with the next change */ }
    addLog({ what: 'Chapter close', ok: false, status: 'Repair', result: 'The chapter could not be filed after one repair retry. It stays open and its messages stay in the request. Repair, on the divider in the chat, opens the answer as JSON to fix by hand.', details: item.problems, got: item.answer });
    renderChapterDivider();
    return item;
}

/** The open chapter failures of this chat: what Repair offers. */
export const chapterFailures = () => [...(metaMemory()?.chapterFailures || [])];

/**
 * Repair: file a chapter from an answer you fixed by hand. The same checks as a Writer answer; throws with the problems
 * when it still does not pass. The condensed account follows on the next pass of the queue.
 */
export async function repairChapter(failureId, json) {
    const item = chapterFailures().find(f => f.id === failureId);
    if (!item) throw new Error('That repair is no longer open.');
    const answer = typeof json === 'string' ? parseJson(json, { object: true }) : json;
    if (!answer) throw new Error('The text is not a JSON object.');
    const chat = ctx().chat || [];
    const span = jobSpan({ payload: { from: item.from, to: item.to } }, chat);
    if (!span) throw new Error('The messages of that chapter are no longer in this chat.');
    const result = fold(chat, ctx().chatMetadata || {});
    const verdict = SF.checkChapter(answer, { chat, from: span.from, to: span.to, cast: castOf(result), places: placesOf(result, chat), textOf: chapterText });
    if (verdict.problems.length) throw new Error(verdict.problems.join(' '));
    const record = SF.chapterRecord(answer, { chat, from: span.from, to: span.to });
    const value = { inputs: [{ op: 'add', record, origin: { type: 'you', route: 'repair' }, anchor: { mark: record.to }, evidence: SF.evidenceOf(answer), reason: 'Repaired by you.' }], sources: spanSources(chat, span.from, span.to) };
    const meta = metaMemory();
    meta.chapterFailures = (meta.chapterFailures || []).filter(f => f.id !== failureId);
    await fileChapterResult({ chatId: chatId() }, value);
    queueChapterWork();
    return record;
}

/** "Close the chapter here": the open chapter closes through the reply at chat index `index` (the newest by default). */
export async function closeChapterHere(index = -1) {
    if (!memoryActive()) throw new Error('This chat has not moved its memory into chat data yet.');
    if (busy) throw new Error('A chapter is already being written.');
    const store = chatMemoryStore();
    store.marks();
    const state = chapterState();
    const span = SF.manualSpan(state.chat, state.chapters, index);
    if (!span) throw new Error('No reply is open after the last chapter.');
    busy = true;
    try {
        const res = await writeChapterJob(span, { why: 'you asked for it', manual: true });
        if (!res.ok) throw new Error(res.reason || 'No route in the Writer chain answered.');
        const filed = await fileChapterResult({ chatId: chatId() }, res.value);
        if (res.value.failed) throw new Error(`The chapter stays open: ${res.value.failed.problems.join(' ')}`);
        return filed ? res.value.inputs[0].record.title : '';
    } finally { busy = false; }
}

/** After chapters change: stored hiding follows the coverage when it is the fallback, and the divider moves. */
function afterChapterChange() {
    if (hidingMode() === 'stored' && memoryComponents().hide) {
        const state = chapterState();
        if (syncStoredHiding(state.covered, storedMark)) Promise.resolve(ctx().saveChat?.()).catch(() => {});
    }
    renderChapterDivider();
}

const chapterHandler = {
    async run(job, { signal } = {}) {
        if (job.chatId !== chatId()) return { ok: false, waiting: true, reason: 'Its chat is not open.' };
        if (!memoryActive() || !memoryComponents().chapters) return { ok: true, value: {} };
        const chat = ctx().chat || [];
        const span = jobSpan(job, chat);
        if (!span) return { ok: true, value: {} };
        if (!span.rebuild && !sourcesShow(job.sources)) return { ok: true, value: {} };
        return writeChapterJob(span, { why: job.payload?.why, signal });
    },
    commit: (job, result) => fileChapterResult(job, result.value),
    saved(job, result) {
        const first = result.value?.inputs?.[0]?.record;
        if (!first || first.kind !== 'chapter') return false;
        const state = chapterState();
        return state.chapters.some(ch => ch.valid && ch.marks.join('|') === first.covers.map(src => src.mark).join('|') && ch.record.text === first.text);
    },
};

const storySoFarHandler = {
    async run(job, { signal } = {}) {
        if (job.chatId !== chatId()) return { ok: false, waiting: true, reason: 'Its chat is not open.' };
        if (!memoryActive()) return { ok: true, value: {} };
        const state = chapterState();
        const valid = state.chapters.filter(ch => ch.valid);
        if (SF.condensedCurrent(state.condensed, valid.slice(0, -2))) return { ok: true, value: {} };
        const anchor = { mark: valid.at(-1)?.record.to };
        const inputs = await condensedInputsFor(valid, { result: state.result, size: state.size, signal, background: true, anchor });
        return inputs.length ? { ok: true, value: { inputs, sources: {} } } : { ok: false, reason: 'The condensed account could not be written.' };
    },
    async commit(job, result) {
        if (!result.value?.inputs?.length || job.chatId !== chatId()) return;
        await chatMemoryStore().record(result.value.inputs);
        afterChapterChange();
    },
};

// ---------- the divider in the chat (6.3) ----------

const DIVIDER = 'ri-chapter-divider';
const DIVIDER_STYLE = 'display:flex;align-items:center;gap:var(--ri-gap,4px);margin:6px 0;padding:2px var(--ri-pad,8px);border-top:1px solid var(--ri-story-line);'
    + 'color:var(--ri-story);font:var(--ri-label-base,12px) var(--ri-font);letter-spacing:var(--ri-track-label);cursor:pointer;background:transparent;';
const REPAIR_STYLE = 'margin-left:auto;color:var(--ri-problem);border:1px solid var(--ri-problem-line);background:var(--ri-problem-tint);padding:0 6px;cursor:pointer;font:inherit;';

function popup(content, type, value = '') {
    const c = ctx();
    return c.callGenericPopup?.(content, c.POPUP_TYPE?.[type] ?? (type === 'INPUT' ? 3 : 1), value, { wide: true, rows: 18 });
}

function summaryElement(chapter) {
    const doc = globalThis.document;
    const rec = chapter.record;
    const box = doc.createElement('div');
    const head = doc.createElement('h3');
    head.textContent = `Chapter ${chapter.n} · ${rec.title || rec.subject || ''}`;
    const when = doc.createElement('p');
    when.textContent = [rec.when?.start, rec.when?.end].filter(Boolean).join(' to ');
    const text = doc.createElement('p');
    text.textContent = rec.text || '';
    box.append(head, ...(when.textContent ? [when] : []), text);
    if (!chapter.valid) {
        const note = doc.createElement('p');
        note.textContent = 'Its messages changed, so they go to the model in full until this chapter is written again.';
        box.append(note);
    }
    return box;
}

async function openRepair(item) {
    const text = await popup(`The chapter could not be filed: ${item.problems.join(' ')} Fix the JSON and save to file it.`, 'INPUT', item.answer);
    if (typeof text !== 'string' || !text.trim()) return;
    try { await repairChapter(item.id, text); toastNote('The chapter was filed.'); }
    catch (error) { toastNote(error.message, true); }
}

function toastNote(text, bad = false) {
    try { globalThis.toastr?.[bad ? 'warning' : 'success']?.(text, 'Roleplay Instructions'); } catch { /* no toasts on this host */ }
}

/** Draw the divider where the open chapter begins: "Chapter 6 · The ford at Valen · 24 messages". Tap opens the summary. */
export function renderChapterDivider() {
    const doc = globalThis.document;
    if (!doc?.querySelector) return;
    for (const node of doc.querySelectorAll(`.${DIVIDER}`)) node.remove();
    if (!memoryActive() || !memoryComponents().chapters) return;
    const state = chapterState();
    const newest = state.chapters.at(-1);
    const failure = state.failures.at(-1);
    if (!newest && !failure) return;
    const at = newest ? newest.last + 1 : Math.max(1, state.chat.findIndex(m => storedMark(m) === failure.from));
    const row = doc.createElement('div');
    row.className = DIVIDER;
    row.setAttribute('style', DIVIDER_STYLE);
    if (newest) {
        const label = doc.createElement('span');
        label.setAttribute('role', 'button');
        label.tabIndex = 0;
        label.textContent = `Chapter ${newest.n} · ${newest.record.title || newest.record.subject || ''} · ${newest.marks.length} messages${newest.valid ? '' : ' · being written again'}`;
        const open = () => popup(summaryElement(newest), 'TEXT');
        label.addEventListener('click', open);
        label.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
        row.append(label);
    }
    if (failure) {
        const fix = doc.createElement('button');
        fix.type = 'button';
        fix.setAttribute('style', REPAIR_STYLE);
        fix.textContent = 'Chapter not filed · Repair';
        fix.addEventListener('click', e => { e.stopPropagation(); openRepair(failure); });
        row.append(fix);
    }
    const target = doc.querySelector(`#chat .mes[mesid="${at}"]`);
    if (target) target.before(row);
    else doc.querySelector('#chat')?.append(row);
}

let chaptersStarted = false;
let dividerTimer = null;
const soon = () => { clearTimeout(dividerTimer); dividerTimer = setTimeout(() => renderChapterDivider(), 120); };

/** Wire chapters to the host once: the generate interceptor, the queue's chapter jobs and the divider. */
export function startChapters() {
    if (chaptersStarted) return;
    chaptersStarted = true;
    installAssemblyHiding(assemblyFor);
    const queue = desktopQueue();
    queue.handle('chapter', chapterHandler);
    queue.handle('storySoFar', storySoFarHandler);
    const opened = async () => {
        if (!memoryActive()) { soon(); return; }
        const meta = metaMemory();
        // The first open with assembly hiding shows again what stored hiding hid before; the generation hook leaves
        // covered messages out from now on.
        if (meta && hidingMode() === 'assembly' && meta.hiding !== 'assembly') {
            const shown = restoreChapterHistory({ persist: false }) + clearStoredHiding();
            meta.hiding = 'assembly';
            try { await ctx().saveChat?.(); } catch { /* saved with the next change */ }
            if (shown) console.log(LOG, `chapters: ${shown} messages hidden by stored hiding are shown again; the request leaves covered messages out`);
        } else if (meta && hidingMode() === 'stored') meta.hiding = 'stored';
        afterChapterChange();
        queueChapterWork();
    };
    on('CHAT_CHANGED', () => setTimeout(opened, 50));
    for (const name of ['MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_DELETED']) on(name, () => setTimeout(() => { afterChapterChange(); queueChapterWork(); }, 50));
    for (const name of ['CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'MORE_MESSAGES_LOADED']) on(name, soon);
    if (ctx().getCurrentChatId?.()) setTimeout(opened, 50);
}
