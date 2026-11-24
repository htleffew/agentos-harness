import assert from 'node:assert/strict';
import test from 'node:test';
import { destination, findDestinations, groups, startingPage, normalizeGroup, tabs, pages } from '../../src/ui/destinations.js';

test('each panel page has one stable destination and a first-open route',()=>{
    const ids=pages.map(page=>page.id);
    assert.equal(new Set(ids).size,ids.length);
    const content=pages.filter(page=>!page.bridge);
    assert.equal(content.length,22);
    assert(groups.every(group=>group.pages.every(page=>destination(page.id).section===group.label)));
    assert.equal(startingPage(true),'state');
    assert.equal(startingPage(false),'v10');
    assert.equal(destination('unknown'),undefined);
    assert.deepEqual(groups.map(group=>group.id),tabs.map(top=>top.id));
    assert.equal(normalizeGroup('characters'),'story');
    assert.equal(destination('portrayal').subgroup,'Characters');
});

test('plain language and old terms find the actual task in the right surface',()=>{
    const match=(query,id)=>findDestinations(query).find(page=>page.id===id);
    assert.equal(match('fix a fact','corrections').label,'Correct story facts');
    assert.equal(match('connection','settings').subgroup,'Connections');
    assert.equal(match('roast','display').section,'Setup');
    assert.equal(match('lorebook','books').section,'Story');
    assert.equal(match('characters','emotion').subgroup,'Characters');
    assert.deepEqual(findDestinations('an unnamed figment'),[]);
});
