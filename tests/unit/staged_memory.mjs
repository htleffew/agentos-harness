import assert from 'node:assert/strict';
import { test } from 'node:test';

const { KEY } = await import('../../src/st.js');
const { settings } = await import('../../src/store.js');
const {
    afterReply, loadEffectiveWorld,
} = await import('../../src/worldflow.js');
const { filedThrough } = await import('../../src/memory-journal.js');
const { chapterAfterReply, writeChapter } = await import('../../src/chapters.js');
const { executionReceipt, setExecutionSetting } = await import('../../src/execution.js');
const { runFactRepair, undoStoryCorrection } = await import('../../src/corrections.js');
const { listWorld } = await import('../../src/world.js');

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

test('a failed auto-summary remains one attempt when later replies extend the token threshold',async()=>{
    const f = fixture();
    settings().world.editableReplies = -1;
    Object.assign(settings().summary,{every:0,everyTokens:12});
    setExecutionSetting('chapterSummary',{automatic:true});
    const respond = f.host.generateRaw;
    f.host.generateRaw = async input=>{
        if (!f.requests.length) { f.requests.push(input); return ''; }
        return respond(input);
    };
    await f.accept('Hale and Rowan spend a quiet afternoon walking across the bridge.',[],{runChapter:true});
    assert.equal(executionReceipt('chapterSummary').outcome,'failed');
    await f.accept('They wait for the lantern to come on.',[],{runChapter:true});
    assert.equal(f.requests.length,1);
    await writeChapter(1,2,'explicit retry');
    assert.equal(f.requests.length,2);
    assert.equal(executionReceipt('chapterSummary').authorization,'manual');
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


