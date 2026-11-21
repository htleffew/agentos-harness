import { ctx, KEY, isStory, isReply, isGenerating, loadBook, parseJson } from './st.js';
import { settings, chatState, saveChatState } from './store.js';
import { setInfo } from './books.js';
import { chatWorld, loadWorld, saveWorld, listWorld, writeWorldEntry, WORLD_KINDS } from './world.js';
import { baseWorld, readRecord } from './v10.js';
import { chatBooks } from './chat-books.js';
import { request } from './ai.js';
import { promptText } from './prompts.js';
import { characterCorrectionFields, correctionTerms, correctionMessageAnchor, correctedLoreEntry, replaceUnique } from './correction-rules.js';
import { historySourceMatches, historySourceMark } from './history-source.js';
import { SCENE_FIELDS } from './state.js';
import { enqueue, syncWorld, worldIdle, recordManualWorldChange } from './worldflow.js';
import { addLog } from './log.js';

const structuredFields = ['text','voice','whereabouts','payoff','outcome','outward','perspective','counterweight'];
const scope = () => ({id:ctx().getCurrentChatId?.(), root:chatState(), world:chatWorld(), chat:ctx().chat});
const matchesScope = expected => {
    const current = scope();
    return current.id===expected.id && current.root===expected.root && current.world===expected.world && current.chat===expected.chat;
};
const trim = value => typeof value==='string' ? value.trim() : '';

function origins(chat, wid) {
    const map = new Map();
    chat.forEach((message,index)=>{
        const rec = message.extra?.[KEY];
        if (!rec?.update || rec.update.world!==wid) return;
        for (const change of rec.update.changes || []) {
            const values = map.get(change.uid) || [];
            if (!values.includes(index)) values.push(index);
            map.set(change.uid,values);
        }
    });
    return map;
}

async function sourceInventory(target) {
    const chat = target.chat || [];
    const sources = [];
    const add = (id,label,before,source) => {
        if (typeof before==='string' && before.trim()) sources.push({id,label,before,...source});
    };
    const worldData = target.world && await loadWorld(target.world);
    const rows = worldData ? listWorld(worldData,target.world) : [];
    const ledger = origins(chat,target.world);
    const worldName = target.world && setInfo(target.world).book;
    for (const row of rows) {
        const record = readRecord(row);
        const sourceIndex = chat.findIndex(message=>record?.source && String(message.extra?.[KEY]?.time)===String(record.source));
        const history = ledger.get(row.uid) || [];
        const evidenceAt = sourceIndex>=0 ? sourceIndex : (history[0] ?? -1);
        const extra = {kind:'world',book:worldName,uid:row.uid,record:record?.id,subject:record?.subject || row.name,
            evidenceAt,copies:history,quote:record?.quote,span:row.span,active:row.on};
        const fields = record ? structuredFields.map(key=>[key,key[0].toUpperCase()+key.slice(1),record[key]]) :
            WORLD_KINDS[row.kind].fields.map(spec=>[spec.key,spec.label,row.fields[spec.key]]);
        for (const [field,label,value] of fields) add(['world',row.uid,field].join(':'),
            [worldName,row.name,label].join(' / '),value,{...extra,field});
    }
    chat.forEach((message,index)=>{
        if (!isStory(message) || !message.mes) return;
        const identity = historySourceMark(message);
        const label = 'Chat message '+(index+1)+' / '+(message.name || (message.is_user ? 'Player' : 'Character'));
        add('message:'+index,label,message.mes,{kind:'message',index,identity,evidenceAt:index,user:!!message.is_user});
        const record = message.extra?.[KEY];
        if (record?.stateStale) return;
        for (const [field,title] of SCENE_FIELDS) add(['scene',index,field].join(':'),label+' / '+title,
            record?.sceneSnapshotEdits?.[field] ?? record?.scene?.[field],{kind:'scene',index,field,identity,evidenceAt:index});
    });
    const base = baseWorld(target.root?.v10);
    const books = chatBooks().filter(book=>book.name!==worldName && book.name!==base?.name && book.exists &&
        book.roles.some(role=>/^Host |^Knowledge & Reference$|^Behavior & Guidelines$/.test(role)));
    const data = await Promise.all(books.map(async book=>({book:book.name,entries:(await loadBook(book.name).catch(()=>null))?.entries})));
    if (base) data.unshift({book:base.name,entries:base.entries});
    for (const {book,entries} of data) for (const entry of Object.values(entries || {})) {
        const title = entry.comment || entry.key?.[0] || 'Entry '+entry.uid;
        add('lore:'+JSON.stringify([book,String(entry.uid)]),book+' / '+title,correctedLoreEntry(entry,book).content,
            {kind:'lore',book,uid:entry.uid,subject:title,active:!entry.disable});
    }
    for (const {uid,field,after} of characterCorrectionFields()) add('card:'+uid+':'+field,
        'Character card / '+field,after,{kind:'card',uid,field,subject:ctx().name2});
    if (!matchesScope(target)) throw new Error('The open chat or Story World changed. Trace the correction again.');
    return {sources,worldData};
}

export async function findCorrectionSources({ truth, wording = '', focus = -1 } = {}) {
    const target = scope();
    if (!target.root || !settings().enabled) throw new Error('Open a chat with the extension enabled.');
    if (!trim(truth)) throw new Error('Describe the correction first.');
    await worldIdle();
    const {sources} = await sourceInventory(target);
    const wanted = correctionTerms(truth+' '+wording);
    const exact = trim(wording).toLowerCase();
    const number = focus>=0 ? target.chat.slice(1,focus+1).filter(isReply).length : -1;
    const ranked = sources.map(source=>{
        const words = new Set(correctionTerms(source.label+' '+source.before));
        let score = wanted.reduce((total,word)=>total+Number(words.has(word)),0);
        if (exact && source.before.toLowerCase().includes(exact)) score+=50;
        if (focus>=0 && source.evidenceAt===focus) score+=15;
        if (focus>=0 && source.copies?.includes(focus)) score+=12;
        if (number>=0 && source.span?.chat===target.id && source.span.from<=number && source.span.to>=number) score+=3;
        return {...source,score};
    }).filter(source=>source.score>0).sort((a,b)=>b.score-a.score || Number(a.active===false)-Number(b.active===false));
    return {target,truth:trim(truth).slice(0,1000),wording:trim(wording),focus,sources:ranked};
}

function excerpt(source, terms, max = 900) {
    if (source.before.length<=max) return source.before;
    const lower = source.before.toLowerCase();
    const points = terms.map(term=>lower.indexOf(term)).filter(i=>i>=0);
    const start = points.length ? Math.max(0,Math.min(...points)-160) : 0;
    return source.before.slice(start,start+max);
}

export async function suggestCorrectionEdits(review) {
    if (!matchesScope(review.target) || isGenerating()) throw new Error('Wait for the reply and trace the current chat again.');
    const probes = [];
    const terms = [review.wording.toLowerCase(),...correctionTerms(review.truth)].filter(Boolean);
    let total = 0;
    for (const source of review.sources) {
        const probe = {id:source.id,source:source.label,text:excerpt(source,terms),evidence:source.quote};
        total += JSON.stringify(probe).length;
        if (total>30000) break;
        probes.push(probe);
    }
    if (!probes.length) return [];
    const result = await request({what:'Trace a story correction',system:promptText('traceCorrection'),
        user:JSON.stringify({correction:review.truth,wrongWording:review.wording,sourceExcerpts:probes}),
        tokens:2000,profileId:settings().profileId});
    if (!matchesScope(review.target)) throw new Error('The chat changed while tracing this correction.');
    const value = parseJson(result.text,{object:true});
    if (!Array.isArray(value?.edits)) {
        result.note('The model did not return a readable edit list.',false);
        throw new Error('The source edit list could not be read. You can review the matches directly or trace again.');
    }
    const edits = [];
    for (const draft of value.edits.slice(0,50)) {
        const probe = probes.find(item=>item.id===draft?.id);
        const source = review.sources.find(item=>item.id===draft?.id);
        if (!probe || typeof draft.quote!=='string' || !draft.quote.trim() || !probe.text.includes(draft.quote) ||
            typeof draft.replacement!=='string' || draft.replacement.length>5000 || edits.some(edit=>edit.id===source.id)) continue;
        if (draft.quote!==draft.replacement && replaceUnique(source.before,draft.quote,draft.replacement)!==null) {
            edits.push({id:source.id,quote:draft.quote,replacement:draft.replacement});
        }
    }
    result.note('Prepared '+edits.length+' exact source edits for review.');
    return edits;
}

function writeMessage(message, value) {
    message.mes = value;
    if (message.extra) delete message.extra.display_text;
    if (message.swipes?.[message.swipe_id]!==undefined) message.swipes[message.swipe_id] = value;
    const info = message.swipe_info?.[message.swipe_id];
    if (info?.extra) delete info.extra.display_text;
}

export async function applyStoryCorrection(review, edits, truth = review.truth) {
    if (isGenerating()) throw new Error('Wait for the current reply to finish.');
    const corrected = trim(truth).slice(0,1000);
    if (!corrected || !matchesScope(review.target)) throw new Error('Trace the correction in the current chat before saving it.');
    await syncWorld();
    return enqueue(async () => {
        const target = review.target, {root,chat,world} = target;
        if (!matchesScope(target) || root.branchPendingWorld) throw new Error('The Story World changed. Trace the correction again.');
        const {sources,worldData} = await sourceInventory(target);
        const changes = [];
        for (const edit of edits) {
            const expected = review.sources.find(source=>source.id===edit.id);
            const source = sources.find(item=>item.id===edit.id);
            if (!expected || !source || expected.before!==source.before || expected.identity!==source.identity ||
                changes.some(change=>change.id===source.id)) throw new Error('A proposed source changed. Trace the correction again.');
            const after = typeof edit.quote==='string' && trim(edit.quote) && typeof edit.replacement==='string' && edit.replacement.length<=5000
                ? replaceUnique(source.before,edit.quote,edit.replacement) : null;
            if (after===null || after===source.before || (source.kind==='message' && !after.trim())) {
                throw new Error('Review the text for '+source.label+'. Each quotation must occur once and the edit must change it.');
            }
            changes.push({...source,after,quote:edit.quote,replacement:edit.replacement});
        }
        const own = changes.filter(source=>source.kind==='world');
        const data = own.length ? structuredClone(worldData) : null;
        const touched = new Map();
        for (const change of own) {
            const row = listWorld(data,world).find(item=>item.uid===change.uid);
            const record = readRecord(row);
            if (record) {
                record[change.field] = change.after;
                record.protected = true;
                row.fields.data = JSON.stringify(record);
            } else row.fields[change.field] = change.after;
            row.locked = true;
            writeWorldEntry(data,row,world);
            touched.set(row.uid,change.evidenceAt);
        }
        const chronology = changes.map(source=>source.evidenceAt).filter(index=>index>=0);
        const anchor = chronology.length ? correctionMessageAnchor(chat[Math.min(...chronology)]) || 'seed' :
            review.focus>=0 ? correctionMessageAnchor(chat[review.focus]) || 'seed' : 'seed';
        const oldMarks = chat.map(historySourceMark);
        const covered = chat.flatMap((message,index)=>{
            const rec = message.extra?.[KEY];
            return rec?.historySource?.length && historySourceMatches(chat,index,rec.historySource) ?
                [{rec,start:index+1-rec.historySource.length,end:index}] : [];
        });
        if (data) await saveWorld(world,data);
        if (!matchesScope(target) || chat.length!==oldMarks.length || !historySourceMatches(chat,chat.length-1,oldMarks)) {
            if (data) await saveWorld(world,worldData);
            throw new Error('The chat changed before the correction could be filed.');
        }
        const affected = new Set([...changes.filter(source=>source.index!==undefined).map(source=>source.index),
            ...covered.map(source=>source.end)]);
        const backups = [...affected].map(index=>{
            const message = chat[index];
            const swipe = message.swipe_info?.[message.swipe_id];
            return {message,text:message.mes,extra:structuredClone(message.extra),swipe,swipeExtra:structuredClone(swipe?.extra)};
        });
        const priorCorrections = root.storyCorrections?.slice();
        const priorManual = root.manualWorldChanges?.slice();
        for (const change of changes) {
            if (change.kind==='message') writeMessage(chat[change.index],change.after);
            if (change.kind==='scene') {
                const message = chat[change.index], rec = message.extra[KEY];
                (rec.scene ||= {})[change.field] = change.after;
                (rec.sceneSnapshotEdits ||= {})[change.field] = change.after;
                const info = message.swipe_info?.[message.swipe_id];
                if (info) { info.extra ||= {}; info.extra[KEY] = rec; }
            }
        }
        const messageIndices = new Set(changes.filter(source=>source.kind==='message').map(source=>source.index));
        for (const {rec,start,end} of covered) {
            if ([...messageIndices].some(index=>index>=start && index<=end)) rec.historySource = chat.slice(start,end+1).map(historySourceMark);
        }
        const correction = {id:String(Date.now()),truth:corrected,anchor,replyNo:chat.slice(1).filter(isReply).length,
            terms:correctionTerms([corrected,review.wording,...changes.map(source=>source.subject)].join(' ')),
            sources:changes.map(({id,kind,label,book,uid,index,field,quote,replacement,evidenceAt})=>
                ({id,kind,label,book,uid,index,field,quote,replacement,evidenceAt}))};
        (root.storyCorrections ||= []).push(correction);
        for (const [uid,index] of touched) recordManualWorldChange(world,uid,worldData.entries[uid],data.entries[uid],
            correctionMessageAnchor(chat[index]) || anchor,{persist:false});
        const host = ctx();
        try { await host.saveChat?.(); }
        catch (error) {
            if (!matchesScope(target)) throw error;
            for (const {message,text,extra,swipe,swipeExtra} of backups) {
                writeMessage(message,text);
                message.extra = extra;
                if (swipe) swipe.extra = swipeExtra;
            }
            root.storyCorrections = priorCorrections;
            root.manualWorldChanges = priorManual;
            if (data) await saveWorld(world,worldData);
            throw error;
        }
        if (matchesScope(target)) saveChatState();
        for (const index of messageIndices) {
            if (!matchesScope(target)) break;
            try { host.updateMessageBlock?.(index,chat[index]); } catch { /* redrawn by host */ }
        }
        addLog({what:'Story correction',ok:true,result:'Saved the correction and applied '+changes.length+' reviewed source edits.',
            details:changes.map(source=>source.label)});
        return correction;
    },{propagate:true});
}
