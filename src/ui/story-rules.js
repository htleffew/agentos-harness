// Story rules, the parts she sees (B41): one home on Direction, Random sets, beside the sets, with a link row from Story,
// Characters. A rule is built only from pickers, plus one text box for a direction's wording. The Sent card's lines come
// from firedRuleLines below.
import { h, button, field, section, select, textArea, numberInput, toggle } from './dom.js';
import { registerPage } from './page-registry.js';
import { ctx, isChatOpen, toast } from '../st.js';
import { chatState } from '../store.js';
import { knownSets, setName, loadSet, entriesOf } from '../books.js';
import { isEvent, readEvent } from '../events.js';
import {
    CONDITIONS, EFFECTS, REPEATS, NUMBERS, STEP_MIN, STEP_MAX, numberById, normalRule, blankRule, ruleSentence,
    chatRules, setRules, saveRules, subjectsSeen, upcoming, firedLines, rulesOf, onRulesChange,
} from '../story-rules.js';

export const PAGE_ID = 'story-rules';
export const LINK_PAGE_ID = 'story-rules-link';

const opts = map => Object.entries(map).map(([value, label]) => ({ value, label }));
const range = (from, to, label = n => String(n)) => Array.from({ length: to - from + 1 }, (_, i) => ({ value: String(from + i), label: label(from + i) }));

// ---------------------------------------------------------------- the Sent card

/** The lines the Sent card lists for a reply: each rule that fired with it, its condition in words. */
export function firedRuleLines(message) {
    return firedLines(rulesOf(message)?.fired || []);
}

/** The Sent card's section for a reply, or null when no rule fired with it. index: the reply's place in the chat. */
export function firedRulesSection(index) {
    const lines = firedRuleLines(ctx().chat?.[index]);
    if (!lines.length) return null;
    return h('div', { class: 'ri-sentitem', 'data-story-rules-fired': '' },
        h('div', { class: 'ri-sent-top' }, h('span', { class: 'ri-sent-name' }, 'Story rules that fired')),
        h('ul', { class: 'ri-changes' }, lines.map(line => h('li', {}, line))),
        h('p', { class: 'ri-help' }, 'Checked in code from the stored values. A swipe or delete of this reply takes these back.'));
}

// ---------------------------------------------------------------- event items for the item picker

const itemCache = new Map();
/** The items of a story event set as [{ value: "cat|item", label, cat, item, text }], loaded once per page draw. */
async function setItems(id) {
    if (itemCache.has(id)) return itemCache.get(id);
    const out = [];
    try {
        const data = await loadSet(id);
        for (const entry of entriesOf(data, id).filter(isEvent)) {
            for (const cat of readEvent(entry, setName(id)).categories) for (const it of cat.items) {
                const text = String(it.label || it.text).replace(/\s+/g, ' ').trim();
                out.push({ value: `${cat.id}|${it.id}`, label: `${cat.name}: ${text.length > 70 ? `${text.slice(0, 70)}...` : text}`, cat: cat.id, item: it.id, text: text.slice(0, 160) });
            }
        }
    } catch (error) { console.warn('[Roleplay Instructions] story rules items', error); }
    itemCache.set(id, out);
    return out;
}

// ---------------------------------------------------------------- one rule's pickers

function conditionFields(rule, change) {
    const w = rule.when;
    const out = [field('When', '', select(opts(CONDITIONS), w.kind, v => change(r => { r.when = { kind: v }; }), { 'aria-label': 'Condition' }))];
    if (w.kind === 'field' || w.kind === 'step') {
        const numbers = NUMBERS.filter(n => w.kind === 'field' || n.steps);
        const number = numberById(w.number);
        const names = isChatOpen() ? subjectsSeen(ctx().chat, number.card) : [];
        if (w.subject && !names.includes(w.subject)) names.unshift(w.subject);
        out.push(field('Value', 'A card value capture keeps from 0 to 10. Faculties are whole numbers as capture writes them.',
            select(numbers.map(n => ({ value: n.id, label: `${n.card === 'emotions' ? 'Emotion, ' : n.card === 'characters' ? 'Character, ' : ''}${n.label}` })), w.number, v => change(r => { r.when.number = v; r.when.subject = ''; }), { 'aria-label': 'Card value' })));
        out.push(field(number.card === 'relationships' ? 'Pair' : 'Whose', 'Names come from this chat\'s cards.',
            select([{ value: '', label: number.card === 'relationships' ? 'Any pair' : 'Anyone' }, ...names.map(n => ({ value: n, label: n }))], w.subject, v => change(r => { r.when.subject = v; }), { 'aria-label': 'Whose value' })));
        if (w.kind === 'field') {
            out.push(field('Compared', '', select([{ value: 'atLeast', label: 'is at least' }, { value: 'atMost', label: 'is at most' }], w.op, v => change(r => { r.when.op = v; }), { 'aria-label': 'Comparison' })),
                field('Number', '', select(range(0, number.max), w.value, v => change(r => { r.when.value = Number(v); }), { 'aria-label': 'Number' })));
        } else {
            const steps = [...range(1, STEP_MAX, n => `rises by ${n} or more`), ...range(STEP_MIN, -1, n => `falls by ${-n} or more`).reverse()];
            out.push(field('Step', 'Meters move in steps of -5 to +5 in one reply.', select(steps, w.value, v => change(r => { r.when.value = Number(v); }), { 'aria-label': 'Step' })));
        }
    }
    if (w.kind === 'due') {
        out.push(field('Due within', 'Story time, read from the thread\'s due time and the story clock. A thread whose due time names no time code can place is left out.',
            numberInput(w.amount, { min: 1, max: 999, label: 'Amount of story time' }, v => change(r => { r.when.amount = v; }, false)),
            select(opts({ minutes: 'minutes', hours: 'hours', days: 'days' }), w.unit, v => change(r => { r.when.unit = v; }), { 'aria-label': 'Unit of story time' })));
    }
    if (w.kind === 'replies') out.push(field('Reply number', '', numberInput(w.value, { min: 1, max: 9999, label: 'Reply number' }, v => change(r => { r.when.value = v; }, false))));
    return out;
}

function effectFields(rule, change) {
    const t = rule.then;
    const out = [field('Then', 'No rule switches a preset block or a World Info entry.', select(opts(EFFECTS), t.kind, v => change(r => { r.then = { kind: v }; }), { 'aria-label': 'Effect' }))];
    if (t.kind === 'direction') {
        out.push(field('Direction', 'Sent privately with the reply the rule fires on.',
            textArea(t.text, v => change(r => { r.then.text = v; }, false), { 'aria-label': 'Direction wording', maxLength: 600, rows: 2 })));
        return out;
    }
    const sets = knownSets('events');
    if (!sets.length) { out.push(h('p', { class: 'ri-help' }, 'Add a story event set first; its items are listed here.')); return out; }
    out.push(field('Story event set', '', select([{ value: '', label: 'Pick a set' }, ...sets.map(id => ({ value: id, label: setName(id) }))], t.set,
        v => change(r => { r.then = { kind: r.then.kind, set: v }; }), { 'aria-label': 'Story event set' })));
    if (t.set) {
        const holder = h('div', { class: 'ri-control' }, h('p', { class: 'ri-help' }, 'Reading the set...'));
        setItems(t.set).then(items => {
            holder.replaceChildren(items.length ? select([{ value: '', label: 'Pick an item' }, ...items], t.item ? `${t.cat}|${t.item}` : '', v => {
                const it = items.find(x => x.value === v);
                change(r => { Object.assign(r.then, it ? { cat: it.cat, item: it.item, label: it.text } : { cat: '', item: '', label: '' }); });
            }, { 'aria-label': 'Event item' }) : h('p', { class: 'ri-help' }, 'This set has no items yet.'));
        });
        out.push(field('Event item', t.kind === 'add' ? 'The item stays out of rolls until the rule fires; then it joins the pool of the set\'s next roll.' : 'The item stays out of rolls until the rule fires; from then on it is in the pool.', holder));
    }
    return out;
}

function repeatFields(rule, change) {
    const p = rule.repeat;
    return [field('How often', '"Each time it becomes true" waits until the condition has been false once, then fires each time it turns true.',
        select(opts(REPEATS), p.kind, v => change(r => { r.repeat = { kind: v }; }), { 'aria-label': 'How often' })),
    p.kind === 'every' ? field('Replies between', '', numberInput(p.every, { min: 1, max: 999, label: 'Replies between firings' }, v => change(r => { r.repeat.every = v; }, false))) : null];
}

// ---------------------------------------------------------------- the page

const view = { scope: '' };

function listFor(scope) { return (scope ? setRules()[scope] || [] : chatRules()).map(normalRule); }

export function renderStoryRulesPage(body, app) {
    const redraw = () => { if (app?.render) app.render(); else { body.replaceChildren(); renderStoryRulesPage(body, app); } };
    itemCache.clear();
    const sets = knownSets('events');
    if (view.scope && !sets.includes(view.scope)) view.scope = '';
    const scope = view.scope;
    if (!scope && !isChatOpen()) { body.append(section('Story rules', h('p', { class: 'ri-help' }, 'Open a chat to see its story rules.'))); return; }
    const list = listFor(scope);
    const save = next => saveRules(scope, next);
    const active = new Set(chatState()?.activeSets || []);
    const cards = list.map((rule, index) => {
        // change(edit, draw): edit a copy of the rule and save; pickers redraw, typed values keep the cursor
        const change = (edit, draw = true) => {
            const next = listFor(scope);
            const r = structuredClone(next[index]);
            edit(r);
            next[index] = normalRule(r);
            save(next);
            if (draw) redraw();
            else sentence.textContent = ruleSentence(next[index]);
        };
        const sentence = h('p', { class: 'ri-rule-sentence', 'data-rule-sentence': '' }, ruleSentence(rule));
        return h('div', { class: 'ri-card', 'data-story-rule': rule.id },
            h('div', { class: 'ri-row' }, toggle(rule.on, v => change(r => { r.on = v; }, false), 'Rule on'), sentence),
            conditionFields(rule, change), effectFields(rule, change),repeatFields(rule, change),
            h('div', { class: 'ri-row ri-row-tight' }, button('Remove rule', () => { const next = listFor(scope); next.splice(index, 1); save(next); redraw(); }, { kind: 'ghost' })));
    });
    const next = isChatOpen() ? upcoming() : null;
    const ready = next?.fired?.length ? h('div', { class: 'ri-note', 'data-story-rules-next': '' }, h('strong', {}, 'With the next reply'),
        h('ul', { class: 'ri-changes' }, firedLines(next.fired).map(line => h('li', {}, line)))) : null;
    body.append(section('Story rules',
        h('p', { class: 'ri-help' }, 'Each rule is one sentence: when a card value, a Pending thread or the reply count meets a condition, the next reply carries a private direction or an event item. Code checks the rules after each capture and before each reply; no rule asks the model anything. A rule that fired is stored with its reply, so a swipe or delete takes it back.'),
        field('Kept with', 'Rules kept with a story event set work in every chat where that set is on.',
            select([{ value: '', label: 'This chat' }, ...sets.map(id => ({ value: id, label: `Set: ${setName(id)}${active.has(id) ? '' : ' (off in this chat)'}` }))], scope,
                v => { view.scope = v; redraw(); }, { 'aria-label': 'Rules kept with' })),
        ready,
        cards.length ? cards : h('p', { class: 'ri-help' }, scope ? 'This set has no story rules.' : 'This chat has no story rules.'),
        h('div', { class: 'ri-row' }, button('Add rule', () => { save([...listFor(scope), blankRule()]); redraw(); }, { kind: 'primary' }))));
}

/** The link row on Story, Characters. */
export function renderStoryRulesLink(body, app) {
    body.append(h('div', { class: 'ri-note ri-home-link', 'data-home-link': PAGE_ID },
        h('span', {}, 'Story rules that act on emotions, relationships and faculties are set in Direction, Random sets.'),
        button('Open Direction, Random sets', async () => {
            try {
                const panel = app || (await import('./panel.js')).app;
                await panel.openPage(PAGE_ID, { focusPage: true });
            } catch (error) { toast('error', error.message); }
        }, { kind: 'ghost' })));
}

let installed = false;
export function installStoryRulesUi() {
    if (installed || !globalThis.SillyTavern?.getContext) return;
    installed = true;
    registerPage({ id: PAGE_ID, group: 'direction', tab: 'random-sets', label: 'Story rules', order: 2,
        help: 'Rules that send a private direction or let an event item roll when a card value, a Pending thread or the reply count meets a condition.',
        aliases: 'story rules tracker values meter step emotion relationship level pending thread due reply count condition trigger', render: renderStoryRulesPage });
    registerPage({ id: LINK_PAGE_ID, group: 'story', tab: 'characters', label: 'Story rules', order: 99,
        help: 'Where the story rules on character values are set.', aliases: 'story rules', render: renderStoryRulesLink });
    let timer = null;
    onRulesChange(() => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
            const { app } = await import('./panel.js').catch(() => ({}));
            if (app?.tab === PAGE_ID && !app.root?.querySelector('textarea:focus, input:focus')) app.render?.();
        }, 120);
    });
}
try { installStoryRulesUi(); } catch (error) { console.warn('Roleplay Instructions could not add the Story rules page.', error); }
