import assert from 'node:assert/strict';
const { newCategory, rollEvent, rerollCategory, eventAllowed } = await import('../../src/events.js');
const category = newCategory('Situation', [['blocked event', 'betrayal'], ['allowed event', 'weather']]);
const event = { type: 'event', categories: [category] };
for (let i = 0; i < 20; i++) {
 const r = rollEvent(event, null, { blockedTags: ['betrayal'] });
 assert.deepEqual(r.parts[0].items, ['allowed event']);
}
const allBlocked = rollEvent(event, null, { blockedTags: ['betrayal', 'weather'] });
assert.equal(allBlocked, null);
const blockedPart = [{ catId: category.id, ids: [category.items[0].id] }];
assert.equal(eventAllowed(event, blockedPart, ['betrayal']), false);
const allowedPart = [{ catId: category.id, ids: [category.items[1].id] }];
assert.equal(eventAllowed(event, allowedPart, ['betrayal']), true);
assert.equal(rerollCategory(event, allowedPart, null, category.id, ['betrayal']), null);
console.log('event tags: fresh, repeated and rerolled selections: passed');
