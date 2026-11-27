// B5: the menu tree, placement of registered pages, and menu search. Run with: node --test tests/unit/menu_shell.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTree, locate, pathName, placeRegistered, tabs, pages } from '../../src/ui/destinations.js';
import { pageEntries, parseQuery, searchMenu, SILLYTAVERN_TERMS } from '../../src/ui/menu-search.js';

const render = () => {};

test('five top tabs with the nested tabs of DESIGN.md 3.1, in order',()=>{
    assert.deepEqual(tabs.map(top=>top.label),['Story','Direction','Quick actions','Review','Setup']);
    assert.deepEqual(tabs.map(top=>top.nested.map(item=>item.label)),[
        ['Scene','Characters','Story World','World Info'],
        ['Random sets','Goal','Writing'],
        ['Bar','Library'],
        ['Replies','Context','Request log'],
        ['Features','Presets','Memory','Connections','Look','Prompts'],
    ]);
    // MB10: Facts and Plot are filters of Story World (UI design 3.5), so 19 pages; B13 retired Action checks, so 18
    assert.equal(tabs.flatMap(top=>top.nested).length,18);
    assert.deepEqual(tabs.map(top=>top.family),['story','direction','reply','review','setup']);
    assert.equal(tabs.find(top=>top.id==='quick').short,'Quick');
    for (const top of tabs) for (const item of top.nested) assert.match(item.icon,/^fa-/);
});

test('every nested tab has a page, so any page is a top tab and a nested tab away',()=>{
    const tree=buildTree([]);
    for (const top of tree) for (const item of top.nested) assert(item.pages.length>0,`${top.label}, ${item.label} has no page`);
    assert.equal(tree.flatMap(top=>top.nested.flatMap(item=>item.pages)).length,pages.length);
    // Today's pages sit where 3.4 puts them.
    const at=id=>{ const found=locate(tree,id); return `${found.top.label}, ${found.nested.label}`; };
    assert.equal(at('state'),'Story, Scene');
    assert.equal(at('corrections'),'Story, Scene');
    assert.equal(at('goals'),'Direction, Goal');
    assert.equal(at('speakers'),'Story, Characters');
    assert.equal(at('events'),'Direction, Random sets');
    assert.equal(at('sent'),'Review, Replies');
    assert.equal(at('settings'),'Setup, Connections');
    assert.equal(at('display'),'Setup, Look');
    assert.equal(at('bridge-bar'),'Quick actions, Bar');
});

test('registered pages land in the nested tab of the 3.1 tree and replace its bridge',()=>{
    const look={id:'look',group:'setup',label:'Look',render};
    const bar={id:'quick-bar',group:'quick-actions',label:'Bar',render};
    const library={id:'qa-library',group:'quick',label:'Library',render};
    const presets={id:'presets-page',group:'setup',label:'Presets',render};
    const spend={id:'connections-spend',group:'setup',tab:'connections',label:'Spend',render};
    const prompts={id:'prompts-home',group:'setup',subgroup:'Prompts',label:'Every prompt',render};
    const stray={id:'b1-fixture',group:'review',label:'Fixture page',render};
    const tree=buildTree([look,bar,library,presets,spend,prompts,stray]);
    const at=id=>{ const found=locate(tree,id); return [found.top.id,found.nested.id,found.nested.pages.indexOf(found.page)]; };
    assert.deepEqual(at('look'),['setup','look',0]);
    assert.deepEqual(at('display'),['setup','look',1]);
    assert.deepEqual(at('quick-bar'),['quick','bar',0]);
    assert.deepEqual(at('qa-library'),['quick','library',0]);
    assert.deepEqual(at('presets-page'),['setup','presets',0]);
    assert.deepEqual(at('connections-spend'),['setup','connections',1]);
    assert.deepEqual(at('settings'),['setup','connections',0]);
    assert.deepEqual(at('prompts-home'),['setup','prompts',0]);
    for (const id of ['bridge-bar','bridge-library','bridge-presets','bridge-prompts']) assert.equal(locate(tree,id),null,id);
    assert(locate(tree,'bridge-memory'));
    // A page that names no nested tab of its top tab gets its own tab at the end, so it is never lost.
    const fixture=locate(tree,'b1-fixture');
    assert.equal(fixture.top.id,'review');
    assert.equal(fixture.nested.label,'Fixture page');
    assert.equal(fixture.top.nested.at(-1),fixture.nested);
    assert.equal(placeRegistered({id:'x',group:'nowhere',label:'X'}).top,'setup');
});

test('pages are named as the navigation shows them',()=>{
    const tree=buildTree([]);
    assert.equal(pathName(tree,'sent'),'Review, Replies');
    assert.equal(pathName(tree,'instructions'),'Direction, Random sets');
    assert.equal(pathName(tree,'events'),'Direction, Random sets');
    assert.equal(pathName(tree,'sets'),'Direction, Random sets');
    // The set editors are pages of their own that stay out of the sections row.
    assert.deepEqual(['instructions','events','style'].map(id=>locate(tree,id).page.sub),[true,true,true]);
    assert.equal(locate(tree,'sets').page.sub,undefined);
});

test('SillyTavern words find their page and setting',()=>{
    const tree=buildTree([{id:'look',group:'setup',label:'Look',render}]);
    const harvested=[
        {kind:'setting',page:'portrayal',label:'Pronouns for {{user}}',match:'Pronouns for {{user}}',terms:'pronouns for {{user}}'},
        {kind:'setting',page:'memory',label:'Current state prompt budget',match:'Current state prompt budget',terms:'current state prompt budget approximate token budget'},
        {kind:'section',page:'world',label:'How story notes are sent',match:'How story notes are sent',terms:'how story notes are sent'},
    ];
    const entries=[...pageEntries(tree),...harvested];
    const first=query=>searchMenu(entries,query)[0];
    assert.equal(first('Author’s Note').page,'writing');
    assert.equal(first("author's note").synonym,'Author’s Note');
    assert.equal(first('impersonate').page,'bridge-bar');
    assert.equal(first('summarize').page,'world');
    assert.equal(first('World Info').page,'books');
    assert.equal(first('lorebook').page,'books');
    const pronouns=first('pronouns');
    assert.equal(pronouns.page,'portrayal');
    assert.equal(pronouns.match,'Pronouns for {{user}}');
    assert.equal(pronouns.kind,'setting');
    const budget=searchMenu(entries,'budget');
    assert.equal(budget[0].match,'Current state prompt budget');
    assert.equal(budget[0].page,'memory');
    assert.equal(first('theme').page,'look');
    // Plain words: every word must start a word in the entry.
    assert.equal(first('story notes').page,'world');
    assert.equal(first('request log').page,'log');
    assert.deepEqual(searchMenu(entries,'he'),[]);
    assert.deepEqual(searchMenu(entries,''),[]);
});

test('queries split into SillyTavern terms and plain words',()=>{
    const {terms,words}=parseQuery('Where is the Author’s Note budget for impersonate?');
    assert.deepEqual(terms.map(term=>term.label).sort(),['Author’s Note','Budget','Impersonate']);
    assert.deepEqual(words,['where','is']);
    for (const term of SILLYTAVERN_TERMS) for (const target of term.targets)
        assert(pages.some(page=>page.id===target.page) || ['look','memory','prompts','stat-sheets'].includes(target.page),`${term.label} points at ${target.page}`);
});
