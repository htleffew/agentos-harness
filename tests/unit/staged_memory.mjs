import assert from 'node:assert/strict';
import { test } from 'node:test';

const { KEY } = await import('../../src/st.js');
const { settings } = await import('../../src/store.js');
const {
    afterReply, applyOps, invalidateAfterEdit, loadEffectiveWorld, syncWorld,
} = await import('../../src/worldflow.js');
const { filedThrough, storyJournalStatus } = await import('../../src/memory-journal.js');
const { catchUpChatHistory, chapterAfterReply, startNewChapter, writeChapter } = await import('../../src/chapters.js');
const { executionReceipt, setExecutionSetting } = await import('../../src/execution.js');
const { runFactRepair, undoStoryCorrection } = await import('../../src/corrections.js');
const { listWorld, writeWorldEntry } = await import('../../src/world.js');

function fixture() {
    let id = 'staged-chat';
    const world = 'Fixture World';
    const requests = [];
    let writes = 0;
    const books = new Map([[world,{entries:{}}]]);
    let sequence = 0;
    const host = {
        chat: [{name:'Hale',mes:'A new scene begins.',send_date:'opening',extra:{}}],
        chatMetadata: {integrity:id,[KEY]:{world,worldOwner:id}},
        extensionSettings: {[KEY]:{
            enabled:true,
            sets:{[world]:{kind:'world'}},
            world:{editableReplies:5,update:'all',build:0},
            summary:{on:true,onSceneEnd:false,every:20,hide:true,keepShown:30},
        }},
        getCurrentChatId:()=>id,
        getWorldInfoNames:()=>[...books.keys()],
        loadWorldInfo:async name=>structuredClone(books.get(name)),
        saveWorldInfo:async(name,value)=>{books.set(name,structuredClone(value)); writes++;},
        saveMetadataDebounced(){},
        async saveChat(){},
        async generateRaw({prompt,systemPrompt}) {
            requests.push({prompt,systemPrompt});
            return JSON.stringify({title:'The old road',summary:'Hale travelled the old road.',people:['Hale'],places:[]});
        },
    };
    globalThis.SillyTavern = {getContext:()=>host};
    async function accept(prose,ops=[],{runChapter=false, continuation=false}={}) {
        const record = {time:++sequence,items:[],type:'normal'};
        if (continuation) {
            const message = host.chat.at(-1);
            Object.assign(record,message.extra[KEY],{type:'continue'});
            message.mes += '\n'+prose;
            message.extra[KEY] = record;
        } else host.chat.push(
            {name:'Rowan',mes:'Continue the story.',is_user:true,send_date:'user-'+sequence,extra:{}},
            {name:'Hale',mes:prose,send_date:'reply-'+sequence,extra:{[KEY]:record}},
        );
        const n = (host.chat.length-1)/2;
        await afterReply(host.chat.length-1,record,{found:!!ops.length,ops},n,null,{propagate:true});
        if (runChapter) await chapterAfterReply(record.time,n);
        return record;
    }
    const open = (chatId,chat,metadata)=>{id=chatId; host.chat=chat; host.chatMetadata=metadata;};
    return {host,world,requests,accept,open,book:(name=world)=>books.get(name),writes:()=>writes,replaceBook:value=>books.set(world,value)};
}

test('the chapter threshold uses only filed replies and hides only covered history', async()=>{
    const f = fixture();
    setExecutionSetting('chapterSummary',{automatic:true});
    for (let n=1; n<=25; n++) await f.accept(`Accepted story reply [${n}].`,[],{runChapter:true});
    assert.equal(filedThrough(),19);
    assert.equal(f.requests.length,0);
    await f.accept('Accepted story reply [26].',[],{runChapter:true});
    assert.equal(filedThrough(),20);
    assert.equal(f.requests.length,1);
    const sent = f.requests[0].prompt[0].content;
    for (let n=1; n<=20; n++) assert(sent.includes(`Accepted story reply [${n}].`));
    for (let n=21; n<=26; n++) assert(!sent.includes(`Accepted story reply [${n}].`));
    assert.deepEqual(listWorld(f.book(),f.world).find(row=>row.kind==='chapter').span,
        {chat:'staged-chat',from:1,to:20,time:'20'});
    assert.equal(f.host.chat[2].is_system,true);
    assert(f.host.chat.slice(-30).every(message=>!message.is_system));
    assert(f.host.chat.slice(41).every(message=>!message.is_system));
});

test('chapter coverage remains visible when the host acknowledges a write without persisting it', async()=>{
    const f = fixture();
    settings().summary.keepShown = 4;
    for (let n=1;n<=8;n++) await f.accept(`Accepted story reply [${n}].`);
    f.host.saveWorldInfo=async()=>{};
    await assert.rejects(writeChapter(1,2,'fixture'),/did not confirm/);
    assert.equal(f.requests.length,1);
    assert.equal(executionReceipt('chapterSummary').outcome,'failed');
    assert.equal(listWorld(f.book(),f.world).length,0);
    assert(f.host.chat.every(message=>!message.is_system));
});

test('the editable timeline keeps surviving independent evidence when an earlier source changes', async()=>{
    const f = fixture();
    const key = {k:'person',a:'Rey',b:'Courier',c:'Rey pocketed the heavy brass key'};
    const note = {k:'knows',a:'Rey',b:'The brass key opens the tower'};
    const pier = {k:'place',a:'Pier',b:'A pier reaches the northern water'};
    const first = await f.accept('Rey pocketed the heavy brass key.',[key]);
    const second = await f.accept('Rey looked at the tower. A pier reaches the northern water.',[note,pier]);
    for (let n=3;n<=6;n++) await f.accept('Hale walks onward.');
    assert.equal(f.writes(),0);
    assert.equal(listWorld(await loadEffectiveWorld(f.world),f.world).find(row=>row.name==='Rey').fields.knows,note.b);
    await f.accept('Hale stops to breathe.',[],{continuation:true});
    assert.equal(filedThrough(),0);
    assert.equal(f.writes(),0);
    f.host.chat[2].mes='The heavy brass key stays on the desk.';
    await invalidateAfterEdit(2);
    assert.match(first.memoryUncertain,/evidence/);
    assert.match(second.memoryUncertain,/current Story World/);
    assert.deepEqual(listWorld(await loadEffectiveWorld(f.world),f.world).map(row=>row.name),['Pier']);
    await f.accept('Hale walks back.');
    assert.equal(filedThrough(),1);
    assert.equal(first.update.pending,undefined);
    assert.equal(listWorld(f.book(),f.world).length,0);
    assert.equal(f.requests.length,0);
    assert.equal(f.host.chat[4].mes,'Rey looked at the tower. A pier reaches the northern water.');
});

test('a saved book write is acknowledged without a second write after save interruption', async()=>{
    const f = fixture();
    const first = await f.accept('The old pier crosses the water.',[{k:'place',a:'Pier',b:'The old pier crosses the water'}]);
    for (let n=2;n<=6;n++) await f.accept('Hale walks onward.');
    let failed = false;
    f.host.saveChat=async()=>{
        if (!failed && f.writes() && !first.update.pending) {
            failed = true;
            throw new Error('Interrupted journal acknowledgment');
        }
    };
    await f.accept('Hale turns around.');
    assert.equal(failed,true);
    assert.equal(f.writes(),1);
    assert.equal(first.update.changes.length,0);
    assert(first.update.pending);
    f.host.chat=structuredClone(f.host.chat);
    await syncWorld();
    const reloaded = f.host.chat[2].extra[KEY];
    assert.equal(f.writes(),1);
    assert.equal(reloaded.update.pending,undefined);
    assert.equal(reloaded.update.changes.length,1);
    assert.equal(listWorld(f.book(),f.world).filter(row=>row.name==='Pier').length,1);
});

test('filing keeps a concurrent authored value and staged changes remain recoverable', async()=>{
    const f = fixture();
    const original = {entries:{}};
    applyOps(original,f.world,[{k:'person',a:'Rey',b:'Courier',c:'A painter'},{k:'wants',a:'Rey',b:'Buy a map'}],
        {chat:'staged-chat',n:0});
    f.replaceBook(original);
    const first = await f.accept('Rey asks to find the blue paint.',[{k:'wants',a:'Rey',b:'Find the blue paint'}]);
    for (let n=2;n<=6;n++) await f.accept('Hale walks onward.');
    const authored = structuredClone(original);
    const row = listWorld(authored,f.world)[0];
    row.fields.wants = 'Keep the charcoal';
    writeWorldEntry(authored,row,f.world);
    f.replaceBook(authored);
    await f.accept('Hale turns around.');
    assert.equal(listWorld(f.book(),f.world)[0].fields.wants,'Keep the charcoal');
    assert(first.update.pending);
    assert.match(storyJournalStatus().error,/conflicts/);
    assert.equal(f.requests.length,0);
    f.replaceBook(original);
    await syncWorld();
    assert.equal(listWorld(f.book(),f.world)[0].fields.wants,'Find the blue paint');
    assert.equal(first.update.pending,undefined);
});

test('the shared fact audit keeps style guidance out of canon and supports undo', async()=>{
    const f = fixture();
    settings().world.editableReplies = -1;
    await f.accept('The gate is open.',[{k:'place',a:'Gate',b:'The gate is open.'}]);
    const found = await runFactRepair({focus:2,truth:'The gate is closed; let the captain sound relieved.',direction:true});
    assert.equal(found.correction.truth,'The gate is closed');
    assert.equal(listWorld(f.book(),f.world)[0].fields.what,'The gate is closed.');
    assert.equal(f.host.chat[2].mes,'The gate is open.');
    assert.equal(f.requests.length,0);
    await undoStoryCorrection(found.correction.id);
    assert.equal(listWorld(f.book(),f.world)[0].fields.what,'The gate is open.');
    const unresolved = await runFactRepair({focus:2});
    assert.equal(unresolved.correction,null);
    assert.equal(unresolved.unresolved.length,1);
});

test('an authoritative player fact can repair an editable record without an AI request', async()=>{
    const f = fixture();
    const record = await f.accept('The gate is open.',[{k:'place',a:'Gate',b:'The gate is open.'}]);
    f.host.chat[1].mes='The gate is closed.';
    const result = await runFactRepair({focus:2});
    assert.equal(result.correction.truth,'The gate is closed');
    assert.equal(result.repaired.length,1);
    assert.equal(record.update.pending.changes.length,2);
    assert.equal(f.writes(),0);
    assert.equal(f.requests.length,0);
    assert.equal(listWorld(await loadEffectiveWorld(f.world),f.world)[0].fields.what,'The gate is closed.');
    await undoStoryCorrection(result.correction.id);
    assert.equal(listWorld(await loadEffectiveWorld(f.world),f.world)[0].fields.what,'The gate is open.');
});

test('historical replacement reconciles dependent filed facts while keeping later prose', async()=>{
    const f = fixture();
    settings().world.editableReplies = -1;
    const old = await f.accept('Rey pocketed the heavy brass key.',[
        {k:'person',a:'Rey',b:'Courier',c:'Rey pocketed the heavy brass key'},
    ]);
    const laterProse = 'Rey touched the iron tower door.';
    const later = await f.accept(laterProse,[
        {k:'knows',a:'Rey',b:'The brass key opens the tower'},
        {k:'place',a:'Gate',b:'The gate is open.'},
    ]);
    settings().world.editableReplies = 5;
    const replacement = {time:5,items:[],type:'swipe'};
    const first = f.host.chat[2];
    first.mes='The heavy brass key stays on the desk.';
    first.extra[KEY]=replacement;
    await afterReply(2,replacement,{found:false,ops:[]},1,null,{historical:true,prior:old,propagate:true});
    assert.equal(f.host.chat[4].mes,laterProse);
    assert.match(later.memoryUncertain,/earlier reply/);
    assert.deepEqual(listWorld(f.book(),f.world).map(row=>row.name),['Gate']);
    const repair = await runFactRepair({focus:2,truth:'The gate is closed.'});
    assert.equal(repair.repaired.length,1);
    assert.equal(listWorld(f.book(),f.world)[0].fields.what,'The gate is closed.');
    assert.equal(f.requests.length,0);
});

test('deleting across the filing boundary reopens the surviving recent patch', async()=>{
    const f = fixture();
    const first = await f.accept('A stone pier extends into the lake.',[{k:'place',a:'Pier',b:'A stone pier extends into the lake'}]);
    for (let n=2;n<=7;n++) await f.accept('Hale walks onward.');
    assert.equal(first.update.pending,undefined);
    assert.deepEqual(listWorld(f.book(),f.world).map(row=>row.name),['Pier']);
    f.host.chat.splice(3);
    await syncWorld(null,{deleted:true});
    assert(first.update.pending);
    assert.equal(listWorld(f.book(),f.world).length,0);
    assert.deepEqual(listWorld(await loadEffectiveWorld(f.world),f.world).map(row=>row.name),['Pier']);
});

test('branch and chapter transfer use only surviving pending patches in their own books', async()=>{
    const f = fixture();
    await f.accept('The stone pier reaches the water.',[{k:'place',a:'Pier',b:'The stone pier reaches the water'}]);
    await f.accept('A brass bell hangs above the quay.',[{k:'place',a:'Quay',b:'A brass bell hangs above the quay'}]);
    const parent = {chat:f.host.chat,metadata:f.host.chatMetadata};
    const branchMeta = structuredClone(parent.metadata);
    Object.assign(branchMeta,{main_chat:'staged-chat',integrity:'branch-chat'});
    f.open('branch-chat',structuredClone(parent.chat.slice(0,3)),branchMeta);
    await syncWorld();
    const branch = branchMeta[KEY].world;
    assert.notEqual(branch,f.world);
    assert.equal(listWorld(f.book(branch),branch).length,0);
    assert.deepEqual(listWorld(await loadEffectiveWorld(branch),branch).map(row=>row.name),['Pier']);
    f.open('staged-chat',parent.chat,parent.metadata);
    const modelOnly = {summary:'Hale reached town.',first:'Hale steps across the pier.',scene:{where:'Pier'}};
    f.host.executeSlashCommandsWithOptions = async () => f.open('next-chapter',[{name:'Hale',mes:'Opening',extra:{}}],
        {integrity:'next-chapter'});
    await startNewChapter(modelOnly,()=>({keys:new Set(),ids:new Map()}));
    const chapterWorld = f.host.chatMetadata[KEY].world;
    assert.notEqual(chapterWorld,f.world);
    assert.notEqual(chapterWorld,branch);
    assert.deepEqual(listWorld(f.book(chapterWorld),chapterWorld).map(row=>row.kind),['chapter']);
    assert.deepEqual(listWorld(await loadEffectiveWorld(chapterWorld),chapterWorld).filter(row=>row.kind!=='chapter').map(row=>row.name),
        ['Pier','Quay']);
    assert.equal(listWorld(f.book(),f.world).length,0);
    assert.equal(f.requests.length,0);
});

test('catch-up stages the newest window and summarizes only filed coverage',async()=>{
    const f = fixture();
    await f.accept('A stone pier crosses the bay.');
    for (let n=2;n<=6;n++) await f.accept('Hale walks onward.');
    await f.accept('A bell sits beside the open gate.');
    f.host.generateRaw=async ({prompt})=>{
        const text = prompt[0].content;
        f.requests.push({prompt});
        const first = text.includes('A stone pier crosses the bay.');
        return JSON.stringify({title:'The harbour',summary:'Hale crossed the harbour.',
            world:first ? [{line:'place: Pier | A stone pier crosses the bay',evidence:'A stone pier crosses the bay.'}] :
                [{line:'place: Gate | A bell sits beside the open gate',evidence:'A bell sits beside the open gate.'}]});
    };
    await catchUpChatHistory();
    assert.equal(f.requests.length,2);
    assert.deepEqual(listWorld(f.book(),f.world).map(row=>row.name).sort(),['Pier','The harbour']);
    assert.deepEqual(listWorld(await loadEffectiveWorld(f.world),f.world).map(row=>row.name).sort(),['Gate','Pier','The harbour']);
    assert.equal(f.host.chat.at(-1).extra[KEY].update.pending.changes.length,1);
    await catchUpChatHistory();
    assert.equal(f.requests.length,2);
});
