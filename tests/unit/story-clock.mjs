import assert from 'node:assert/strict';
import { advanceStoryClock } from '../../src/story-clock.js';
import { gate } from '../../src/v10.js';

const base = {date:'2024-02-28',time:'11:58 PM',where:'Dock',weather:'Rain'};
const rollover = advanceStoryClock(base,{}, {clock:100,elapsed:4});
assert.deepEqual(rollover,{scene:{...base,date:'2024-02-29',time:'12:02 AM'},minutes:104,issues:[]});
assert.deepEqual(advanceStoryClock(base,{date:base.date,time:base.time}, {clock:100,minutes:100,elapsed:4}).scene,rollover.scene);
assert.deepEqual(advanceStoryClock(rollover.scene,{}, {clock:104,elapsed:2880}).scene,
    {...base,date:'2024-03-02',time:'12:02 AM'});
const awaited = {due:103,status:'open'};
assert.equal(gate(awaited,new Map(),100,base),false);
assert.equal(gate(awaited,new Map(),rollover.minutes,rollover.scene),true);
assert.equal(awaited.status,'open');

const ordinal = {date:'Day 4',time:'23:59'};
assert.deepEqual(advanceStoryClock(ordinal,{}, {clock:30,minutes:31}).scene,{date:'Day 5',time:'00:00'});
assert.equal(advanceStoryClock(ordinal,{date:'Day 6',time:'08:00'}, {clock:30}).minutes,1951);
assert.equal(advanceStoryClock({date:'Day 5',time:'09:00'},{time:'09:03'}, {clock:80}).minutes,83);
assert.deepEqual(advanceStoryClock({time:'09:00',weather:'Clear'},{time:'09:03'},{clock:80}),
    {scene:{time:'09:03',weather:'Clear'},minutes:83,issues:[]});
assert.equal(advanceStoryClock(ordinal,{time:'00:15'}, {clock:30}).scene.time,'23:59');
assert.equal(advanceStoryClock(ordinal,{time:'00:15',date:'Day 3'}, {clock:30,minutes:15}).minutes,30);

const fictional = {date:'Wednesday, Month 7, Day 14',time:'11:58 PM'};
const unknown = advanceStoryClock(fictional,{}, {clock:10,elapsed:4});
assert.deepEqual(unknown.scene,{date:'',time:'12:02 AM',lastKnownDate:fictional.date,daysAfterKnownDate:1});
assert.equal(advanceStoryClock(unknown.scene,{}, {elapsed:2880}).scene.daysAfterKnownDate,3);
assert.deepEqual(advanceStoryClock(unknown.scene,{date:'Thursday, Month 7, Day 15'}, {clock:unknown.minutes}).scene,
    {date:'Thursday, Month 7, Day 15',time:'12:02 AM'});
const approximate = {date:'Day 4',when:'Near dawn'};
assert.deepEqual(advanceStoryClock(approximate,{}, {elapsed:2}).scene,approximate);
assert.deepEqual(advanceStoryClock(approximate,{}, {elapsed:1440}).scene,{date:'Day 5'});
assert.deepEqual(advanceStoryClock({where:'Dock'}, {time:'04:00'}),{scene:{where:'Dock',time:'04:00'},minutes:0,issues:[]});
assert.deepEqual(advanceStoryClock({date:'Wednesday, Day 14',time:'11:58 p.m.'},{},{elapsed:4}).scene,
    {date:'Thursday, Day 15',time:'12:02 AM'});
assert.deepEqual(advanceStoryClock({date:'Wednesday, February 28, 2024',time:'23:58'},{},{elapsed:4}).scene,
    {date:'Thursday, February 29, 2024',time:'00:02'});
