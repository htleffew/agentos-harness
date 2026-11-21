import assert from 'node:assert/strict';
import { catchUpBatches } from '../../src/chapters.js';
import { historySourceMark, historySourceMatches } from '../../src/history-source.js';

const chat = [{name:'Mira',mes:'The opening.'}];
for (let turn = 1; turn <= 50; turn++) {
    chat.push(
        {name:'Player',is_user:true,send_date:`input-${turn}`,mes:`INPUT-${turn}; ${'I wait. '.repeat(50)}`},
        {name:'Mira',send_date:`reply-${turn}`,mes:`REPLY-${turn}; ${'The harbor is calm. '.repeat(100)}`},
    );
}
chat.push({name:'Player',is_user:true,mes:'UNANSWERED-INPUT'});
const batches = catchUpBatches(chat,new Set(),20,12000);
const joined = batches.map(batch=>batch.text).join('\n');
assert.equal(batches[0].from,1);
assert.equal(batches.at(-1).to,50);
assert.ok(batches.every(batch=>batch.text.length<=12000 && batch.to-batch.from<20));
for (let turn = 1; turn <= 50; turn++) {
    assert.equal((joined.match(new RegExp(`INPUT-${turn};`,'g')) || []).length,1);
    assert.equal((joined.match(new RegExp(`REPLY-${turn};`,'g')) || []).length,1);
}
assert.doesNotMatch(joined,/UNANSWERED-INPUT/);
const remaining = catchUpBatches(chat,new Set([2,3,5]),20,12000);
assert.deepEqual(remaining.slice(0,2).map(batch=>[batch.from,batch.to]),[[1,1],[4,4]]);
const marks = chat.slice(1,5).map(historySourceMark);
chat[1].is_system = true;
assert.ok(historySourceMatches(chat,4,marks));
chat[1].mes = 'A change to this user message.';
assert.ok(!historySourceMatches(chat,4,marks));
