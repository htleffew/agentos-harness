import assert from 'node:assert/strict';
import test from 'node:test';
import { destination, findDestinations, groups, startingPage, normalizeGroup } from '../../src/ui/destinations.js';

test('each panel page has one stable destination and a first-open route',()=>{
    const ids=groups.flatMap(group=>group.pages.map(page=>page.id));
    assert.equal(ids.length,22);
    assert.equal(new Set(ids).size,ids.length);
    assert(groups.every(group=>group.pages.every(page=>destination(page.id).section===group.label)));
    assert.equal(startingPage(true),'state');
    assert.equal(startingPage(false),'v10');
    assert.equal(destination('unknown'),undefined);
    assert.deepEqual(groups.map(group=>group.id),['story','direction','review','setup']);
    assert.equal(normalizeGroup('characters'),'story');
    assert.equal(destination('portrayal').subgroup,'Characters');
});

test('plain language and old terms find the actual task in the right surface',()=>{
    const match=(query,id)=>findDestinations(query).find(page=>page.id===id);
    assert.equal(match('fix a fact','corrections').label,'Correct story facts');
    assert.equal(match('swipe','alternate').family,'swipe');
    assert.equal(match('connection','model-settings').anchor,'#ri-model-request-settings');
    assert.equal(match('roast','display').section,'Setup');
    assert.equal(match('lorebook','books').section,'Story');
    assert.equal(match('characters','goals').subgroup,'Characters');
    assert.deepEqual(findDestinations('an unnamed figment'),[]);
});
