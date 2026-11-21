import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.SillyTavern = { getContext: () => ({ extensionSettings:{}, chatMetadata:{}, getCurrentChatId:()=> 'prose fixture' }) };
const { KEY } = await import('../../src/st.js');
const { flaggedNpcNames } = await import('../../src/npc-names.js');
const {
    acceptProseDiagnostics, confirmProseDiagnostics, extractProseNotes, playerEcho, prepareProseDiagnostics, proseDiagnosticsNotes,
} = await import('../../src/prose-diagnostics.js');

let messageId = 0;
const story = (mes, is_user=false) => ({ mes, is_user, send_date:`message ${++messageId}`, name:is_user?'Player':'Nora', extra:{} });
const attach = (chat, diagnostic) => { chat.at(-1).extra[KEY] = { proseDiagnostics:diagnostic }; };
const request = (chat, plan) => [
    ...chat.filter(message=>!message.is_system).map(message=>({ role:message.is_user?'user':'assistant',content:message.mes })),
    { role:'system', content:plan.prompt },
];

test('screens normalized spans and reports whole-word preference hits locally', () => {
    const player = 'I count seven cracked lanterns near the flooded western stairwell.';
    const prose = 'Her jaw tightened. “I count seven *cracked* lanterns—near the flooded western stairwell,” she repeated. The ledger was filed beside her costume.';
    assert.match(playerEcho(prose,player).text,/cracked lanterns near the flooded western stairwell/);
    assert.equal(playerEcho('Nora mends the lanterns over breakfast.',player),null);
    const chat = [story(player,true),story(prose)];
    const diagnostic = acceptProseDiagnostics(chat,1,{metrics:true});
    attach(chat,diagnostic);
    const notes = diagnostic.notes.join('\n');
    assert.match(notes,/Player wording echoed/);
    assert.match(notes,/Physical reaction followed by echoed player wording/);
    assert.match(notes,/Bookkeeping word-family matches · ledger, filed/);
    assert.doesNotMatch(notes,/costume/);
    assert.ok(diagnostic.metrics.words>20 && diagnostic.metrics.dialogue>0);
    const plan = prepareProseDiagnostics(chat,{mode:'normal'});
    assert.equal(plan.nudge.filter(item=>item.kind==='bookkeeping').length,1);
    assert.doesNotMatch(plan.prompt,/ledger|filed|flooded|quotation marks/);
    assert.match(plan.prompt,/Describe the concrete consequence/);
});

test('counts differently worded opening sequences and separates current player text from visible queued notes', () => {
    const userOne = 'I count seven cracked lanterns near the flooded western stairwell.';
    const userTwo = 'I found four rusted hinges below the painted glass cabinet.';
    const chat = [
        story(userOne,true),story('His jaw tightened. “I count seven cracked lanterns near the flooded western stairwell.”'),
        story(userTwo,true),story('Her fingers curled. *I found four rusted hinges below the painted glass cabinet.*'),
    ];
    const plan = prepareProseDiagnostics(chat,{mode:'normal',avoid:''});
    assert.deepEqual(plan.nudge.map(({kind,count,window})=>[kind,count,window]),[['reaction-echo',2,2]]);
    assert.match(plan.prompt,/2 of the last 2 story replies/);
    assert.doesNotMatch(plan.prompt,/lanterns|cabinet|fingers curled/);

    const suffix='\n\n(OOC: Count twelve pale candles beside the iron stair tonight.)';
    chat[2].mes+=suffix;
    chat[2].extra.riQuickActionSend={suffix};
    chat[3].mes='Nora said, “Count twelve pale candles beside the iron stair tonight.”';
    assert.equal(prepareProseDiagnostics(chat,{mode:'normal',avoid:''}),null);
});

test('accepts cited same-request findings and sends only surviving evidence once', () => {
    const earlier = [
        'The harbor watch patrols the southern pier in rain.',
        'The bakery workers carry the sacks through freezing streets.',
        'The soldiers set their lanterns by the carriage gate.',
    ];
    const chat = earlier.map(text=>story(text));
    const state = {};
    const initial = prepareProseDiagnostics(chat,{mode:'normal',audit:true,state,avoid:''});
    assert.match(initial.prompt, /R1 through R3/);
    assert.doesNotMatch(initial.prompt, /bakery workers/);
    confirmProseDiagnostics(initial, request(chat,initial));
    const review = [
        {pattern:'recap',examples:earlier.map((evidence,index)=>({reply:`R${index+1}`,evidence}))},
        {pattern:'voice',examples:[{reply:'R1',evidence:'This fabricated sentence claimed the southern pier was burning.'}]},
    ];
    const result = extractProseNotes(`Nora pinched the candle flame.\n<writing_notes>${JSON.stringify({findings:review})}</writing_notes>`);
    assert.equal(result.text,'Nora pinched the candle flame.');
    chat.push(story(result.text));
    const accepted = acceptProseDiagnostics(chat,3,{plan:initial,findings:result.findings,state});
    attach(chat,accepted);
    assert.deepEqual(accepted.audits.map(audit=>[audit.kind,audit.evidence.length]),[['recap',3]]);
    assert.equal(accepted.auditConfirmed,true);
    assert.match(proseDiagnosticsNotes(chat,3).details[0].heading,/3 of 3/);

    const oldDate = chat[0].send_date;
    chat[0].swipe_id=1;
    chat[0].swipe_info=[{send_date:oldDate},{send_date:'alternate date'}];
    chat[0].send_date='alternate date';
    chat[0].mes='The watch grants the fishermen leave for the evening.';
    chat[1].mes='The bakery workers board their wagon at sunrise.';
    const notes = proseDiagnosticsNotes(chat,3).details[0];
    assert.match(notes.heading,/1 of 3/);
    assert.equal(notes.items.filter(text=>text.includes('revision changed')).length,2);

    const next = prepareProseDiagnostics(chat,{mode:'normal',state,avoid:''});
    assert.deepEqual(next.nudge.map(({kind,count,window})=>[kind,count,window]),[['recap',1,4]]);
    assert.match(next.prompt,/1 of the last 4 story replies restated/);
    assert.doesNotMatch(next.prompt,/freezing streets|carriage gate|southern pier/);
    assert.equal(prepareProseDiagnostics(chat,{mode:'swipe',state}),null);
    assert.equal(prepareProseDiagnostics(chat,{mode:'impersonate',state}),null);
    assert.equal(prepareProseDiagnostics(chat,{mode:'normal',fresh:true,state}),null);
    assert.equal(state.proseDiagnostics,undefined);
    assert.deepEqual(prepareProseDiagnostics(chat,{mode:'normal',state,avoid:''}).nudge,next.nudge);

    confirmProseDiagnostics(next,request(chat,next));
    chat.push(story('The shop closes when the last visitor leaves.'));
    attach(chat,acceptProseDiagnostics(chat,4,{plan:next,state}));
    assert.match(proseDiagnosticsNotes(chat,4).details[0].heading,/Included in the reply request/);
    assert.equal(prepareProseDiagnostics(chat,{mode:'normal',state,avoid:''}),null);
    chat.pop();
    assert.equal(prepareProseDiagnostics(chat,{mode:'normal',state,avoid:''}),null);
});

test('discards absent or malformed evidence and keeps metadata out of prose', () => {
    const chat = [story('Nora raises a lantern in the storm.'),story('A guard waves to Nora from the watchtower.')];
    const plan = prepareProseDiagnostics(chat,{mode:'normal',audit:true});
    confirmProseDiagnostics(plan,[{role:'assistant',content:chat[1].mes},{role:'system',content:plan.prompt}]);
    chat.push(story('The wooden bridge falls into the river.'));
    const findings = [
        {pattern:'recap',examples:[{reply:'R1',evidence:'Nora raises a lantern in the storm.'}]},
        {pattern:'unknown',examples:[{reply:'R2',evidence:'A guard waves to Nora from the watchtower.'}]},
    ];
    assert.deepEqual(acceptProseDiagnostics(chat,2,{plan,findings}).audits,[]);
    assert.deepEqual(extractProseNotes('Prose.\n<writing_notes>{bad'),{text:'Prose.',findings:[],found:true});
    assert.equal(extractProseNotes('Prose.\n<writ',{streaming:true}).text,'Prose.');
    assert.equal(extractProseNotes('Prose.\n<writ').text,'Prose.\n<writ');
});

test('new names use narrative and prior evidence without flagging canon', () => {
    assert.deepEqual(flaggedNpcNames('Marcus took a seat next to Nora.'),['Marcus']);
    assert.deepEqual(flaggedNpcNames('Marcus took a seat next to Nora.',{},{prior:'Earlier, Marcus gave Nora the nickel.'}),[]);
    assert.deepEqual(flaggedNpcNames('The new bottle came from Blackwood.'),[]);
    assert.deepEqual(flaggedNpcNames('Voss stood by the window.',{},{established:['Voss']}),[]);
    assert.deepEqual(flaggedNpcNames('Captain Voss stood by the window.',{},{established:['Voss']}),[]);
});
