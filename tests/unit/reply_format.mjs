import assert from 'node:assert/strict';
import { separateReply } from '../../src/reply-format.js';

const state = '<story_update v="2">{"v":2}</story_update>';
const prose = 'The column moved north.\n\nAnders checked the road.';
const vexa = `<page:boot>
1. IDENTITY: Planner
2. GROUNDING: Column
⇥ <page:mechanics>

<page:mechanics>
1. NOTEBOOK: The march
</page:mechanics>

<page:aux>
- Keep the column moving
</page:aux>

${prose}

<!-- GFX_START -->
<state:world>
<time>3:45 AM</time>
</state:world>
<!-- GFX_END -->
${state}`;
assert.equal(separateReply(vexa).text,`${prose}\n\n${state}`);
assert.match(separateReply(vexa).plan,/IDENTITY: Planner/);
assert.match(separateReply(vexa).plan,/The march/);
assert.doesNotMatch(separateReply(vexa).plan,/<page:|3:45/);
assert.deepEqual(separateReply(`1. IDENTITY: Planner\n2. TIMELINE: Dawn\n\n${prose}`),{
    text:prose, plan:'1. IDENTITY: Planner\n2. TIMELINE: Dawn',
});
assert.deepEqual(separateReply(`<reply_plan>• Keep the column moving.</reply_plan>\n\n${prose}`),{
    text:prose, plan:'• Keep the column moving.',
});
assert.equal(separateReply(`<details>\n<summary>Plan</summary>\n<reply_plan>Keep the column moving.</reply_plan>\n</details>\n${prose}`).text,prose);
assert.equal(separateReply(`${prose}\n<state:world>\n<time>dawn</time>\n${state}`).text,`${prose}\n${state}`);
assert.equal(separateReply('A sign read:\n\n1. IDENTITY: Clerk\n2. ROOM: 4').text,'A sign read:\n\n1. IDENTITY: Clerk\n2. ROOM: 4');
assert.equal(separateReply(`<reply_plan>\n- Pending\n\n${prose}`).text,prose);
console.log('Reply format separates prelude, prose and versioned state with partial or complete wrappers.');
