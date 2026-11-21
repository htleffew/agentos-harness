import { ctx, KEY, isStory, isReply, isGenerating, loadBook, parseJson } from './st.js';
import { settings, chatState, saveChatState } from './store.js';
import { setInfo } from './books.js';
import { chatWorld, saveWorld, listWorld, writeWorldEntry, WORLD_KINDS } from './world.js';
import { baseWorld, readRecord } from './v10.js';
import { chatBooks } from './chat-books.js';
import { request } from './ai.js';
import { promptText } from './prompts.js';
import { characterCorrectionFields, correctionTerms, correctionMessageAnchor, correctedLoreEntry, replaceUnique } from './correction-rules.js';
import { historySourceMatches, historySourceMark, storyRevision } from './history-source.js';
import { SCENE_FIELDS } from './state.js';
import { enqueue, loadDurableWorld, saveVerifiedWorld, syncWorld, worldIdle, recordManualWorldChange } from './worldflow.js';
import { projectStoryJournal, storySlots } from './memory-journal.js';
import { stripStoredQuickText } from './quick-action-chat.js';
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
        if (!rec?.update || rec.update.undone || rec.stateStale || rec.update.world!==wid) return;
        for (const change of [...(rec.update.changes || []),...(rec.update.pending?.changes || [])]) {
            const values = map.get(change.uid) || [];
            values.push({index,change});
            map.set(change.uid,values);
        }
    });
    return map;
}

function fieldOrigins(history, field, structured) {
    const read = value => parseJson(String(value || ''),{object:true})?.[field];
    return [...new Set(history.filter(({change})=>{
        if (change.type==='create') return structured ? !!read(change.entry?.fields?.data) : !!change.entry?.fields?.[field];
        return change.type==='set' && (structured
            ? change.field==='data' && read(change.before)!==read(change.after)
            : change.field===field);
    }).map(({index})=>index))];
}

async function sourceInventory(target) {
    const chat = target.chat || [];
    const sources = [];
    const add = (id,label,before,source) => {
        if (typeof before==='string' && before.trim()) sources.push({id,label,before,...source});
    };
    const worldData = target.world && await loadDurableWorld(target.world);
    const effective = worldData && projectStoryJournal(worldData,target.world,{chat,root:target.root}).data;
    const rows = effective ? listWorld(effective,target.world) : [];
    const filed = worldData ? new Map(listWorld(worldData,target.world).map(row=>[row.uid,row])) : new Map();
    const originsByEntry = origins(chat,target.world);
    const slots = storySlots(chat);
    const worldName = target.world && setInfo(target.world).book;
    for (const row of rows) {
        const record = readRecord(row);
        const sourceIndex = chat.findIndex(message=>record?.source && String(message.extra?.[KEY]?.time)===String(record.source));
        const extra = {kind:'world',book:worldName,uid:row.uid,record:record?.id,subject:record?.subject || row.name,
            span:row.span,active:row.on};
        const fields = record ? structuredFields.map(key=>[key,key[0].toUpperCase()+key.slice(1),record[key]]) :
            WORLD_KINDS[row.kind].fields.map(spec=>[spec.key,spec.label,row.fields[spec.key]]);
        for (const [field,label,value] of fields) {
            const copies = fieldOrigins(originsByEntry.get(row.uid) || [],field,!!record);
            const legacyIndex = row.auto && row.at?.chat===target.id ? slots[row.at.n-1]?.index : undefined;
            const evidenceAt = sourceIndex>=0 && field==='text' ? sourceIndex : (copies.at(-1) ?? legacyIndex ?? -1);
            const physical = filed.get(row.uid);
            const prior = record ? readRecord(physical)?.[field] : physical?.fields[field];
            add(['world',row.uid,field].join(':'),[worldName,row.name,label].join(' / '),value,
                {...extra,field,evidenceAt,copies,pending:value!==prior,quote:field==='text' ? record?.quote : ''});
        }
    }
    chat.forEach((message,index)=>{
        if (!isStory(message) || !message.mes) return;
        const identity = historySourceMark(message);
        const label = 'Chat message '+(index+1)+' / '+(message.name || (message.is_user ? 'Player' : 'Character'));
        add('message:'+index,label,message.mes,{kind:'message',index,identity,evidenceAt:index,user:!!message.is_user,
            storyEvidence:message.is_user ? stripStoredQuickText(message.mes) : undefined});
        const record = message.extra?.[KEY];
        if (record?.stateStale) return;
        for (const [field,title] of SCENE_FIELDS) add(['scene',index,field].join(':'),label+' / '+title,
            record?.sceneSnapshotEdits?.[field] ?? record?.scene?.[field],{kind:'scene',index,field,identity,evidenceAt:index});
    });
    const base = baseWorld(target.root?.v10);
    const books = chatBooks().filter(book=>book.name!==worldName && book.name!==base?.name && book.exists && book.active &&
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
    return {sources,worldData,effective};
}

export function beginStoryCorrection({ truth, wording = '', focus = -1, audit = false } = {}) {
    const target = scope();
    if (!target.root || !settings().enabled) throw new Error('Open a chat with the extension enabled.');
    if (!audit && !trim(truth)) throw new Error('Describe the correction first.');
    return {target,truth:trim(truth).slice(0,1000),wording:trim(wording),focus,sources:[],candidates:[]};
}

export async function findCorrectionSources(options) {
    const review = beginStoryCorrection(options);
    const {target,truth,wording,focus} = review;
    await worldIdle();
    const {sources} = await sourceInventory(target);
    const wanted = correctionTerms(truth || target.chat[focus]?.mes || '');
    const exact = wording.toLowerCase();
    const focusIndex = focus>=0 ? focus : target.chat.findLastIndex(isReply);
    const ranked = sources.map(source=>{
        const terms = new Set(correctionTerms(source.before));
        const matches = wanted.filter(term=>terms.has(term));
        const exactMatch = exact && source.before.toLowerCase().includes(exact);
        const focusMatch = source.evidenceAt===focusIndex || source.copies?.includes(focusIndex);
        const labelMatch = correctionTerms(source.subject || source.label).some(term=>wanted.includes(term));
        return {...source,exactMatch,matches,focusMatch,labelMatch};
    }).sort((a,b)=>Number(!!b.exactMatch)-Number(!!a.exactMatch) || b.matches.length-a.matches.length ||
        Number(!!b.focusMatch)-Number(!!a.focusMatch) || Number(a.active===false)-Number(b.active===false));
    review.sources = ranked.filter(source=>exact ? source.exactMatch :
        source.matches.length>=2 || wanted.length===1 && source.matches.length===1);
    review.candidates = ranked.filter(source=>source.exactMatch || source.matches.length ||
        source.kind==='message' && source.focusMatch || source.labelMatch && source.focusMatch);
    return review;
}

export function correctionExcerpt(source, terms, max = 900) {
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
    for (const source of review.candidates) {
        const material = source.storyEvidence===undefined ? source : {...source,before:source.storyEvidence};
        const probe = {id:source.id,source:source.label,text:correctionExcerpt(material,terms),evidence:source.quote};
        total += JSON.stringify(probe).length;
        if (total>30000) break;
        probes.push(probe);
    }
    if (!probes.length) return [];
    const result = await request({operation:'factRepair',authorization:'manual',what:'Trace a story correction',system:promptText('traceCorrection'),
        user:JSON.stringify({correction:review.truth,wrongWording:review.wording,sourceExcerpts:probes}),
        tokens:2000,profileId:settings().profileId,retryEmpty:false});
    if (!matchesScope(review.target)) throw new Error('The chat changed while tracing this correction.');
    const value = parseJson(result.text,{object:true});
    if (!Array.isArray(value?.edits)) {
        result.note('The model did not return a readable edit list.',false);
        throw new Error('The source edit list could not be read. You can review the matches directly or trace again.');
    }
    const edits = [];
    for (const draft of value.edits.slice(0,50)) {
        const probe = probes.find(item=>item.id===draft?.id);
        const source = review.candidates.find(item=>item.id===draft?.id);
        if (!probe || typeof draft.quote!=='string' || !draft.quote.trim() || !probe.text.includes(draft.quote) ||
            typeof draft.replacement!=='string' || draft.replacement.length>5000 || edits.some(edit=>edit.id===source.id)) continue;
        if (draft.quote!==draft.replacement && replaceUnique(source.before,draft.quote,draft.replacement)!==null) {
            edits.push({id:source.id,quote:draft.quote,replacement:draft.replacement});
        }
    }
    result.note('Prepared '+edits.length+' exact source edits for review.');
    return edits;
}

const opposites = new Map([['open','closed'],['closed','open'],['locked','unlocked'],['unlocked','locked'],
    ['alive','dead'],['dead','alive'],['on','off'],['off','on'],['present','absent'],['absent','present']]);

function factClauses(value) {
    return [...String(value || '').matchAll(/\b([\p{L}][\p{L}\d\s'-]{0,68}?)\s+(?:is|are|was|were)\s+(open|closed|locked|unlocked|alive|dead|on|off|present|absent)\b(?=\s*(?:[.!?;,]|$))/giu)]
        .map(match=>({quote:match[0],subject:match[1].trim().toLowerCase().replace(/^(?:a|an|the)\s+/i,''),state:match[2].toLowerCase()}));
}

function factualDirection(value) {
    return String(value || '').split(/\s*;\s*|(?<=[.!?])\s+|\n+/)
        .map(line=>line.trim().replace(/^(?:actually,?\s+|the fact is that\s+)/i,''))
        .filter(line=>/^[\p{L}][\p{L}\d\s'’-]*?\s+(?:is|are|was|were|has|have|had|holds?|contains?|keeps?|stands?|lies?|wears?|built|took|stayed|left|knows?|died|survived|occurred|happened)\s+/iu.test(line))
        .filter(line=>!/^(?:let|make|have|write|show|say|explain|imagine|focus|mention|describe|add|remove|give|keep)\b/i.test(line))
        .join(' ').slice(0,1000);
}

/** The guided switch and the correction screen use this same evidence audit. */
export async function runFactRepair({focus=-1,truth='',wording='',useModel=false,direction=false} = {}) {
    const targetIndex = focus>=0 ? focus : (ctx().chat || []).findLastIndex(isReply);
    const correctionText = direction ? factualDirection(truth) : trim(truth);
    const review = await findCorrectionSources({truth:correctionText,wording,focus:targetIndex,audit:true});
    const focused = review.candidates.find(source=>source.kind==='message' && source.index===targetIndex);
    const checked = review.candidates.map(source=>source.label);
    const protectedSources = review.candidates.filter(source=>source.user ||
        source.kind==='message' && source.index===targetIndex).map(source=>source.label);
    const edits = [];
    let supported = correctionText;
    if (!supported && focused) {
        const conflicts = factClauses(focused.before).flatMap(claim=>{
            const known = review.candidates.filter(source=>source.active!==false &&
                (['card','lore'].includes(source.kind) || source.kind==='world' && source.evidenceAt<targetIndex ||
                    source.kind==='message' && source.user && source.index<targetIndex))
                .flatMap(source=>factClauses(source.storyEvidence ?? source.before))
                .filter(fact=>fact.subject===claim.subject);
            return known.length && known.every(fact=>fact.state===opposites.get(claim.state)) ? [known[0].quote] : [];
        });
        supported = [...new Set(conflicts)].join('. ');
    }
    if (!supported) return {correction:null,checked,repaired:[],protected:protectedSources,
        unresolved:['The available evidence did not establish a unique correction.']};
    review.truth = supported;
    if (useModel) {
        const proposals = await suggestCorrectionEdits(review);
        edits.push(...proposals.filter(proposal=>{
            const source = review.candidates.find(item=>item.id===proposal.id);
            return source?.active!==false && source?.kind!=='message';
        }));
    } else {
        const facts = factClauses(supported);
        for (const source of review.candidates) {
            if (!['world','scene','lore','card'].includes(source.kind) || source.active===false) continue;
            const contrary = factClauses(source.before).filter(claim=>facts.some(fact=>
                claim.subject===fact.subject && claim.state===opposites.get(fact.state)));
            if (contrary.length!==1) continue;
            const claim = contrary[0];
            const replacement = claim.quote.replace(/\p{L}+$/u,opposites.get(claim.state));
            if (replaceUnique(source.before,claim.quote,replacement)!==null) edits.push({id:source.id,quote:claim.quote,replacement});
        }
    }
    const correction = await applyStoryCorrection(review,edits);
    return {correction,checked,repaired:correction.sources.map(source=>source.label),protected:protectedSources,unresolved:[]};
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
        if (isGenerating()) throw new Error('Wait for the current reply to finish.');
        const {sources,worldData,effective} = edits.length ? await sourceInventory(target) : {sources:[]};
        const changes = [];
        for (const edit of edits) {
            const expected = [...review.sources,...review.candidates].find(source=>source.id===edit.id);
            const source = sources.find(item=>item.id===edit.id);
            if (!expected || !source || expected.before!==source.before || expected.identity!==source.identity || expected.pending!==source.pending ||
                changes.some(change=>change.id===source.id)) throw new Error('A proposed source changed. Trace the correction again.');
            const after = typeof edit.quote==='string' && trim(edit.quote) && typeof edit.replacement==='string' && edit.replacement.length<=5000
                ? replaceUnique(source.before,edit.quote,edit.replacement) : null;
            if (after===null || after===source.before || (source.kind==='message' && !after.trim())) {
                throw new Error('Review the text for '+source.label+'. Each quotation must occur once and the edit must change it.');
            }
            changes.push({...source,after,quote:edit.quote,replacement:edit.replacement});
        }
        const own = changes.filter(source=>source.kind==='world' && !source.pending);
        const pendingEdits = changes.filter(source=>source.kind==='world' && source.pending);
        const data = own.length ? structuredClone(worldData) : null;
        const touched = new Map();
        const correctionId = globalThis.crypto?.randomUUID?.() || String(Date.now());
        const pendingUpdates = new Map();
        for (const change of pendingEdits) {
            const index = change.copies?.findLast(position=>chat[position]?.extra?.[KEY]?.update?.pending);
            const carry = root.storyJournalCarry?.findLast(item=>item.world===world && item.changes.some(patch=>patch.uid===change.uid));
            const pending = chat[index]?.extra?.[KEY]?.update?.pending || carry;
            if (!pending) throw new Error('The pending source changed. Trace the correction again.');
            const patch = pendingUpdates.get(pending) || {index,pending,rows:[]};
            const row = listWorld(effective,world).find(item=>item.uid===change.uid);
            const existing = readRecord(row);
            const field = existing ? 'data' : change.field;
            const before = row.fields[field];
            if (existing) {
                existing[change.field] = change.after;
                existing.protected = true;
                row.fields.data = JSON.stringify(existing);
            } else row.fields[field] = change.after;
            patch.rows.push({uid:row.uid,name:row.name,kind:row.kind,type:'set',field,before,after:row.fields[field],
                correctionId,beforeLocked:row.locked});
            row.locked = true;
            writeWorldEntry(effective,row,world);
            pendingUpdates.set(pending,patch);
        }
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
        if (data) {
            const latest = await loadDurableWorld(world);
            if (!matchesScope(target) || JSON.stringify(latest)!==JSON.stringify(worldData)) {
                throw new Error('The Story World changed before saving. Trace the correction again.');
            }
            await saveVerifiedWorld(world,data);
        }
        if (!matchesScope(target) || chat.length!==oldMarks.length || !historySourceMatches(chat,chat.length-1,oldMarks)) {
            if (data && JSON.stringify(await loadDurableWorld(world))===JSON.stringify(data)) await saveWorld(world,worldData);
            throw new Error('The chat changed before the correction could be filed.');
        }
        const affected = new Set([...changes.filter(source=>source.index!==undefined).map(source=>source.index),
            ...covered.map(source=>source.end),...[...pendingUpdates.values()].map(patch=>patch.index).filter(index=>index!==undefined)]);
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
        const priorCarry = root.storyJournalCarry && structuredClone(root.storyJournalCarry);
        for (const {pending,rows} of pendingUpdates.values()) pending.changes.push(...rows);
        const messageIndices = new Set(changes.filter(source=>source.kind==='message').map(source=>source.index));
        for (const {rec,start,end} of covered) {
            if ([...messageIndices].some(index=>index>=start && index<=end)) rec.historySource = chat.slice(start,end+1).map(historySourceMark);
        }
        const correction = {id:correctionId,truth:corrected,anchor,replyNo:chat.slice(1).filter(isReply).length,
            terms:correctionTerms([corrected,review.wording,...changes.map(source=>source.subject)].join(' ')),
            sources:changes.map(({id,kind,label,book,uid,index,field,quote,replacement,evidenceAt,pending})=>
                ({id,kind,label,book,uid,index,field,quote,replacement,evidenceAt,pending})),
            undo:{
                world:world || '',
                entries:[...touched.keys()].map(uid=>({uid,before:worldData.entries[uid],after:data.entries[uid]})),
                carried:[...pendingUpdates.values()].filter(patch=>patch.index===undefined).flatMap(patch=>patch.rows),
                messages:changes.filter(source=>source.index!==undefined).map(({kind,index,field,before,after,identity})=>
                    ({kind,index,field,before,after,identity,revision:historySourceMark(chat[index]),
                        slot:storyRevision(chat[index],index),
                        priorSceneEdit:kind==='scene' ? backups.find(row=>row.message===chat[index])?.extra?.[KEY]?.sceneSnapshotEdits?.[field] : undefined})),
            }};
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
            root.storyJournalCarry = priorCarry;
            if (data && JSON.stringify(await loadDurableWorld(world))===JSON.stringify(data)) await saveWorld(world,worldData);
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

function undoSourceRevision(edit,chat) {
    const index = edit.slot ? chat.findIndex((message,position)=>storyRevision(message,position).turn===edit.slot.turn) : edit.index;
    const message = chat[index];
    if (!message) return null;
    const selected = Number(message.swipe_id) || 0;
    const swipe = edit.slot?.swipe ?? selected;
    const active = selected===swipe;
    const holder = active ? message : message.swipe_info?.[swipe];
    const text = active ? message.mes : message.swipes?.[swipe];
    if (!holder || typeof text!=='string' || historySourceMark(active ? message : {...message,mes:text,send_date:holder.send_date})!==edit.revision) return null;
    const rec = holder.extra?.[KEY];
    if ((edit.kind==='scene' ? rec?.scene?.[edit.field] : text)!==edit.after) return null;
    const write = value => {
        if (active) writeMessage(message,value);
        else {
            message.swipes[swipe] = value;
            if (holder.extra) delete holder.extra.display_text;
        }
    };
    return {edit,index,active,rec,write};
}

export function undoStoryCorrection(id) {
    const target = scope();
    return enqueue(async()=>{
        const {root,chat,world} = target;
        const correction = root?.storyCorrections?.find(item=>item.id===id);
        if (!correction?.undo || !matchesScope(target) || isGenerating()) throw new Error('Open the correction in its idle source chat.');
        if (correction.undo.world !== (world || '')) throw new Error('The Story World changed. Reopen the original world to undo the edit.');
        const redo = [];
        const bookEdits = correction.undo.entries || [];
        const updates = new Set();
        const patches = chat.flatMap(message=>{
            return [message,...(message.swipe_info || [])].flatMap(holder=>{
                const rec = holder?.extra?.[KEY];
                return [rec?.update?.pending,rec?.update].flatMap((update,index)=>{
                    if (!update?.changes?.some(change=>change.correctionId===id) || updates.has(update)) return [];
                    updates.add(update);
                    return [{update,filed:holder===message && index===1,rec}];
                });
            });
        });
        const carried = (root.storyJournalCarry || []).filter(update=>update.world===world && update.changes.some(change=>change.correctionId===id));
        patches.push(...carried.map(update=>({update,filed:false})));
        const promotedCarry = carried.length ? [] : (correction.undo.carried || []);
        const original = (bookEdits.length || patches.some(item=>item.filed) || promotedCarry.length) && await loadDurableWorld(world);
        if (!matchesScope(target)) throw new Error('The chat changed while preparing the undo.');
        const data = original && structuredClone(original);
        for (const {uid,before,after} of bookEdits) {
            if (!data || JSON.stringify(data.entries[uid])!==JSON.stringify(after)) {
                throw new Error('A corrected entry changed again. Review it before undoing the correction.');
            }
            data.entries[uid] = before;
        }
        const filedPatches = patches.filter(item=>item.filed).map(({update})=>update.changes.filter(change=>change.correctionId===id));
        if (promotedCarry.length) filedPatches.push(promotedCarry);
        for (const changes of filedPatches) {
            for (const change of [...changes].reverse()) {
                const row = data && listWorld(data,world).find(item=>item.uid===change.uid);
                if (!row || row.kind!==change.kind || row.name!==change.name || row.fields[change.field]!==change.after || !row.locked) {
                    throw new Error('A corrected entry changed again. Review it before undoing the correction.');
                }
                row.fields[change.field] = change.before;
                row.locked = change.beforeLocked;
                writeWorldEntry(data,row,world);
            }
        }
        const messageEdits = correction.undo.messages || [];
        const revisions = messageEdits.map(edit=>undoSourceRevision(edit,chat));
        if (revisions.some(value=>!value)) throw new Error('A corrected message or card changed again. Review it before undoing the correction.');
        if (data) {
            const latest = await loadDurableWorld(world);
            if (!matchesScope(target) || JSON.stringify(latest)!==JSON.stringify(original)) {
                throw new Error('The Story World changed while preparing the undo.');
            }
            await saveVerifiedWorld(world,data);
        }
        if (!matchesScope(target)) throw new Error('The chat changed while undoing the correction.');
        const prior = root.storyCorrections, manual = root.manualWorldChanges;
        const covered = chat.flatMap((message,index)=>{
            const rec = message.extra?.[KEY];
            return rec?.historySource?.length && historySourceMatches(chat,index,rec.historySource)
                ? [{rec,end:index,start:index+1-rec.historySource.length}] : [];
        });
        for (const {edit,rec,write} of revisions) {
            if (edit.kind==='message') {
                redo.push(()=>write(edit.after));
                write(edit.before);
            } else {
                redo.push(()=>{rec.scene[edit.field]=edit.after; rec.sceneSnapshotEdits[edit.field]=edit.after;});
                rec.scene[edit.field] = edit.before;
                if (edit.priorSceneEdit === undefined) delete rec.sceneSnapshotEdits[edit.field];
                else rec.sceneSnapshotEdits[edit.field] = edit.priorSceneEdit;
            }
        }
        for (const {rec,start,end} of covered) {
            if (!revisions.some(({edit,index,active})=>active && edit.kind==='message' && index>=start && index<=end)) continue;
            const previous = rec.historySource;
            redo.push(()=>{rec.historySource=previous;});
            rec.historySource = chat.slice(start,end+1).map(historySourceMark);
        }
        for (const {update,rec,filed} of patches) {
            const previous = update.changes;
            const item = root.worldLog?.items?.[String(rec?.time)];
            redo.push(()=>{update.changes=previous; if (filed && item) item.changes=previous;});
            update.changes = previous.filter(change=>change.correctionId!==id);
            if (filed && item) item.changes = update.changes;
        }
        root.storyCorrections = prior.filter(item=>item.id!==id);
        if (manual) root.manualWorldChanges = manual.filter(change=>change.world!==world ||
            !bookEdits.some(edit=>edit.uid===change.uid && JSON.stringify(edit.after)===JSON.stringify(change.after)));
        const host = ctx();
        try { await host.saveChat?.(); }
        catch (error) {
            if (matchesScope(target)) {
                for (const restore of redo.reverse()) restore();
                root.storyCorrections = prior;
                root.manualWorldChanges = manual;
                if (original && JSON.stringify(await loadDurableWorld(world))===JSON.stringify(data)) await saveWorld(world,original);
            }
            throw error;
        }
        if (matchesScope(target)) {
            saveChatState();
            for (const {edit,index,active} of revisions) if (active && edit.kind==='message') host.updateMessageBlock?.(index,chat[index]);
        }
        return true;
    },{propagate:true});
}
