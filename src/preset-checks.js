// The check list at the end of the stack: code notes, no model call (A11 c.8, ticket B33; DECISIONS.md, 24 November 2026).
//
// checkList(plan) reads the plan stackPlan() returns and lists what it finds: the same text in two cards, near copies,
// P1 compatibility verdicts against an RI card that is also on, pick-one groups with two or more on, the ordered setvar and
// getvar pass, guard rows she took out, and a missing Chat History landmark. Every note is information. Nothing here writes to
// the plan, the stack or a request; the plan is read and never returned, so a note cannot reorder, hide or pair a card.
//
// The module imports only preset-library.js, so it runs in node with no host.
import { FEATURES, plainName } from './preset-library.js';

export const NEAR_COPY = 0.8;        // overlap noted as a near copy (d.6)
export const NEAR_DUPLICATE = 0.95;  // overlap called a near duplicate (d.6)
export const NEAR_MIN_LENGTH = 40;   // blocks at or under this many characters are not compared for near copies
export const SHINGLE_WORDS = 3;

export const NOTE_KINDS = Object.freeze(['same-text', 'near-copy', 'verdict', 'pick-one', 'variable-early', 'variable-unread', 'guard-off', 'landmark']);

// The block editor's lock and pick-one name rules (src/ui/preset-workbench.js), kept here so this file needs no DOM.
const LOCK = /\u{1F512}|\block(?:ed)?\b|\bjailbreak\b|\bguard\b|\bdo not (?:edit|touch|remove|disable)\b|\brequired\b|\bmandatory\b/iu;
const PICK = /\[\s*pick\s*(?:1|one)\s*(?::\s*([^\]]*))?\]/i;
const RULE_CHARS = /[\u{2550}\u{2501}\u{2500}\u{2014}=_~*#]{3,}|^\s*\/\/|^\s*#{1,6}\s|^\s*[\u{2500}-\u{257F}]/u;
const LANDMARKS = { chatHistory: 'Chat History', worldInfoBefore: 'World Info before', worldInfoAfter: 'World Info after', dialogueExamples: 'Dialogue examples',
    charDescription: 'Character description', charPersonality: 'Character personality', scenario: 'Scenario', personaDescription: 'Persona description' };

const sentSource = card => card.sourceName || card.source || '';
const blockName = card => plainName(card.name || card.id || '') || String(card.id || card.key);
const plain = text => String(text ?? '').replace(/<!--[\s\S]*?-->/g, ' ');
const norm = text => plain(text).replace(/\s+/g, ' ').trim();
const percent = value => Math.round(value * 100);
const isRi = card => card.source === 'ri' || card.origin === 'ri';

/** What a note holds about one card: enough for a chip and a link back to the card in the bank or the stack. */
export function cardRef(card) {
    return { key: card.key, name: blockName(card), source: sentSource(card), sourceKey: card.source || '', on: !!card.on, link: cardLink(card.key) };
}
/** The link a note carries for a card; B32 turns it into a tap that scrolls to and opens the card. */
export const cardLink = key => `#bank-card=${encodeURIComponent(String(key))}`;

const label = card => `${blockName(card)} (${sentSource(card)})`;
const idOf = (kind, parts) => `${kind}:${parts.join('|')}`;
const note = (kind, level, cards, text, extra = {}) => ({ id: idOf(kind, [...cards.map(card => card.key)].sort().concat(extra.at ? [extra.at] : [])), kind, level, text, cards: cards.map(cardRef), ...extra });

// ----------------------------------------------------------------------------------------------------------------------
// Same text and near copies

const memo = new Map();            // text -> Uint32Array of distinct shingle hashes, sorted; bounded
const MEMO_LIMIT = 2000;
const wordsOf = text => norm(text).toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];

function fnv(words, from, count) {
    let h = 0x811c9dc5;
    for (let i = from; i < from + count; i++) {
        const word = words[i];
        for (let c = 0; c < word.length; c++) { h ^= word.charCodeAt(c); h = Math.imul(h, 0x01000193); }
        h ^= 0x20; h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}
/** Distinct word-shingle hashes of a text (three words each; a text under three words is one shingle). */
export function shingles(text) {
    const key = String(text ?? '');
    const hit = memo.get(key);
    if (hit) return hit;
    const words = wordsOf(key);
    const set = new Set();
    if (words.length <= SHINGLE_WORDS) { if (words.length) set.add(fnv(words, 0, words.length)); }
    else for (let i = 0; i + SHINGLE_WORDS <= words.length; i++) set.add(fnv(words, i, SHINGLE_WORDS));
    const out = Uint32Array.from(set).sort();
    if (memo.size >= MEMO_LIMIT) memo.delete(memo.keys().next().value);
    memo.set(key, out);
    return out;
}
/** Jaccard overlap of the shingle sets of two texts, 0 to 1. */
export function overlap(a, b) {
    const x = shingles(a), y = shingles(b);
    if (!x.length || !y.length) return 0;
    let i = 0, j = 0, shared = 0;
    while (i < x.length && j < y.length) { if (x[i] === y[j]) { shared++; i++; j++; } else if (x[i] < y[j]) i++; else j++; }
    return shared / (x.length + y.length - shared);
}

function sameAndNear(cards) {
    const notes = [];
    const texts = cards.map(card => norm(card.text));
    const byText = new Map();
    cards.forEach((card, i) => { if (texts[i]) { const list = byText.get(texts[i]) || []; list.push(i); byText.set(texts[i], list); } });
    for (const list of byText.values()) {
        if (list.length < 2) continue;
        const group = list.map(i => cards[i]);
        const names = group.map(label);
        notes.push(note('same-text', 'info', group, `Same text in ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}; ${group.length === 2 ? 'both are' : 'all are'} sent.`));
    }
    // Near copies: an inverted index of shingles counts what each pair shares, so only pairs with something in common are scored.
    const pool = [];
    cards.forEach((card, i) => { if (texts[i].length > NEAR_MIN_LENGTH) pool.push(i); });
    const sets = pool.map(i => shingles(cards[i].text));
    const postings = new Map();
    const counts = new Int32Array(pool.length);
    const touched = [];
    for (let p = 0; p < pool.length; p++) {
        const set = sets[p];
        for (let s = 0; s < set.length; s++) {
            const list = postings.get(set[s]);
            if (!list) continue;
            for (let k = 0; k < list.length; k++) { const q = list[k]; if (counts[q]++ === 0) touched.push(q); }
        }
        // Each card is noted against the earlier card it matches best, so a family of copies gives one note per copy.
        let best = -1, bestScore = 0;
        for (let t = 0; t < touched.length; t++) {
            const q = touched[t];
            const shared = counts[q]; counts[q] = 0;
            if (texts[pool[q]] === texts[pool[p]]) continue;   // the same text belongs to its own note
            const score = shared / (set.length + sets[q].length - shared);
            if (score >= NEAR_COPY && score > bestScore) { best = q; bestScore = score; }
        }
        if (best >= 0) {
            const first = cards[pool[best]], second = cards[pool[p]];
            const duplicate = bestScore >= NEAR_DUPLICATE;
            const shown = Math.min(100, percent(bestScore));
            notes.push(note('near-copy', 'info', [first, second],
                `${blockName(second)} (${sentSource(second)}) is ${duplicate ? 'a near duplicate' : `a ${shown} percent copy`} of ${blockName(first)} (${sentSource(first)})${duplicate ? `, ${shown} percent alike` : ''}.`,
                { overlap: Math.round(bestScore * 1000) / 1000, nearDuplicate: duplicate }));
        }
        touched.length = 0;
        for (let s = 0; s < set.length; s++) {
            const list = postings.get(set[s]);
            if (list) list.push(p); else postings.set(set[s], [p]);
        }
    }
    return notes;
}

// ----------------------------------------------------------------------------------------------------------------------
// P1 verdicts, pick-one groups, guard rows, landmarks

function verdictNotes(cards, plan, rules) {
    const notes = [];
    const ri = new Map();
    for (const card of plan) if (card.on && isRi(card)) { const feature = card.source === 'ri' ? card.id : card.versionOf; if (feature) { const list = ri.get(feature) || []; list.push(card); ri.set(feature, list); } }
    for (const card of cards) {
        if (isRi(card) || card.marker) continue;
        for (const [feature, verdict] of Object.entries(card.verdicts || {})) {
            if (verdict !== 'duplicative' && verdict !== 'contradictory') continue;
            const partners = ri.get(feature);
            if (!partners?.length) continue;
            const name = FEATURES[feature]?.label || feature;
            const rule = (typeof rules === 'function' ? rules(card, feature) : rules?.[`${card.key}|${feature}`]) ||
                (verdict === 'duplicative' ? `adds guidance beside the extension's ${name.toLowerCase()}` : `asks for something the extension's ${name.toLowerCase()} also handles, in another way`);
            notes.push(note('verdict', 'info', [card, ...partners], `${label(card)} ${verdict === 'duplicative' ? 'duplicates' : 'conflicts with'} ${partners.map(label).join(' and ')}: ${rule}.`,
                { feature, verdict, rule, at: feature }));
        }
    }
    return notes;
}

const isHeading = card => card.marker ? /^ri-head-/.test(card.id || '') : !String(card.text || '').trim() || (String(card.text).trim().length <= 80 && RULE_CHARS.test(card.name || ''));
function pickNotes(plan) {
    // Groups follow the block editor: a name like "[PICK 1: POV]" groups across the stack; arrows alone group under the nearest heading above.
    const groups = new Map();
    let heading = '';
    for (const card of plan) {
        if (isHeading(card)) { heading = plainName(card.name).replace(/[\u{2500}-\u{257F}=_~*#]+/gu, ' ').replace(/\s+/g, ' ').trim(); continue; }
        const match = PICK.exec(card.name || '');
        if (!match) continue;
        const named = plainName(match[1] || '').replace(/[^\p{L}\p{N} ]+/gu, '').trim();
        const key = named || heading || 'Pick one';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(card);
    }
    const notes = [];
    for (const [name, list] of groups) {
        const on = list.filter(card => card.on);
        if (list.length > 1 && on.length > 1)
            notes.push(note('pick-one', 'warn', on, `Pick one: ${name} has ${on.length} on (${on.map(label).join(', ')}).`, { group: name, at: name, of: list.length }));
    }
    return notes;
}

function guardNotes(plan) {
    return plan.filter(card => !card.on && !card.marker && !isRi(card) && LOCK.test(card.name || ''))
        .map(card => note('guard-off', 'warn', [card], `${label(card)} guards the preset and is off in this stack.`));
}

function landmarkNotes(plan) {
    const notes = [];
    const landmarks = plan.filter(card => card.landmark);
    const history = landmarks.find(card => card.id === 'chatHistory');
    if (!history) notes.push({ id: 'landmark:chatHistory:missing', kind: 'landmark', level: 'warn', text: 'Chat History is not in this stack, so no earlier messages are sent.', cards: [], landmark: 'chatHistory', state: 'missing' });
    for (const card of landmarks) {
        if (card.on) continue;
        const name = LANDMARKS[card.id] || blockName(card);
        notes.push(note('landmark', card.id === 'chatHistory' ? 'warn' : 'info', [card], `${name} is off in this stack${card.id === 'chatHistory' ? ', so no earlier messages are sent' : ''}.`, { landmark: card.id, state: 'off', at: 'off' }));
    }
    return notes;
}

// ----------------------------------------------------------------------------------------------------------------------
// The ordered variable pass

/** The index just past the macro that opens at text[at] (braces nest); the text length when it never closes. */
function macroEnd(text, at) {
    let depth = 0;
    for (let i = at; i < text.length - 1; i++) {
        if (text[i] === '{' && text[i + 1] === '{') { depth++; i++; }
        else if (text[i] === '}' && text[i + 1] === '}') { depth--; i++; if (depth === 0) return i + 1; }
    }
    return text.length;
}
const SET_MACRO = /^\{\{\s*(setvar|setglobalvar|addvar|addglobalvar|incvar|incglobalvar|decvar|decglobalvar)\s*::\s*([^:{}]+?)\s*(?:::|\}\})/i;
const GET_MACRO = /^\{\{\s*(getvar|getglobalvar)\s*::\s*([^:{}]+?)\s*\}\}/i;
const READS_TOO = /^(?:add|inc|dec)/i;

/**
 * Variable events of one text in the order SillyTavern runs them: a macro nested in another runs first, so a setvar counts at the
 * end of its macro and a getvar at its start. Returns [{ type: 'set' | 'get', scope, name, at }]. addvar, incvar and decvar set
 * (and also read the value they change, which makes them a read of a variable that must already be set only when it is).
 */
export function variableEvents(text) {
    const source = String(text ?? '');
    const events = [];
    for (let at = source.indexOf('{{'); at >= 0; at = source.indexOf('{{', at + 2)) {
        const head = source.slice(at, at + 160);
        const set = SET_MACRO.exec(head);
        if (set) { const word = set[1].toLowerCase(); events.push({ type: 'set', scope: /global/.test(word) ? 'global' : 'local', name: set[2], at: macroEnd(source, at), counts: READS_TOO.test(word) }); continue; }
        const get = GET_MACRO.exec(head);
        if (get) events.push({ type: 'get', scope: /global/i.test(get[1]) ? 'global' : 'local', name: get[2], at });
    }
    return events.sort((a, b) => a.at - b.at);
}

function variableNotes(cards) {
    const sets = new Map(), reads = new Map(), seen = new Set();
    const early = new Map();
    cards.forEach((card, index) => {
        for (const event of variableEvents(card.text)) {
            const id = `${event.scope}:${event.name}`;
            if (event.type === 'set') {
                if (!sets.has(id)) sets.set(id, []);
                const list = sets.get(id);
                if (!list.some(entry => entry.card === card)) list.push({ card, index });
                seen.add(id);
            } else {
                if (!reads.has(id)) reads.set(id, []);
                const list = reads.get(id);
                if (!list.some(entry => entry.card === card)) list.push({ card, index });
                if (!seen.has(id)) { if (!early.has(id)) early.set(id, []); const have = early.get(id); if (!have.some(entry => entry.card === card)) have.push({ card, index }); }
            }
        }
    });
    const notes = [];
    for (const [id, readers] of early) {
        const name = id.replace(/^[a-z]+:/, ''), scope = id.startsWith('global:') ? 'global ' : '';
        const setters = (sets.get(id) || []).map(entry => entry.card);
        const text = setters.length
            ? `${readers.map(entry => label(entry.card)).join(', ')} reads the ${scope}variable ${name} before ${setters.map(label).join(', ')} sets it.`
            : `${readers.map(entry => label(entry.card)).join(', ')} reads the ${scope}variable ${name}, and no card in this stack sets it.`;
        notes.push(note('variable-early', 'warn', [...readers.map(entry => entry.card), ...setters], text, { variable: name, scope: scope ? 'global' : 'local', neverSet: !setters.length, readers: readers.map(entry => entry.card.key), setters: setters.map(card => card.key), at: id }));
    }
    for (const [id, setters] of sets) {
        if (reads.has(id)) continue;
        const name = id.replace(/^[a-z]+:/, ''), scope = id.startsWith('global:') ? 'global ' : '';
        const cardsOf = setters.map(entry => entry.card);
        notes.push(note('variable-unread', 'info', cardsOf, `${cardsOf.map(label).join(', ')} sets the ${scope}variable ${name}, and no card in this stack reads it.`, { variable: name, scope: scope ? 'global' : 'local', setters: cardsOf.map(card => card.key), at: id }));
    }
    return notes;
}

// ----------------------------------------------------------------------------------------------------------------------
// The check list

/**
 * Notes for a plan (the array stackPlan() returns). Options: rules, a function (card, feature) or an object keyed
 * "<card key>|<feature>" giving the P1 one-line rule for a verdict. Only cards that are on count for text, variables,
 * verdicts and pick-one; cards that are off count for guard rows and landmarks. The plan is never changed or returned.
 */
export function checkList(plan, { rules = null, extra = [] } = {}) {
    const started = performance.now();
    const all = Array.isArray(plan) ? plan : [];
    const sent = all.filter(card => card.on && !card.marker);
    // extra holds notes another module read from the host (a loadout's blocks left out, B35); they are listed after the plan's own.
    const notes = [...sameAndNear(sent), ...verdictNotes(sent, all, rules), ...pickNotes(all), ...variableNotes(sent), ...guardNotes(all), ...landmarkNotes(all),
        ...(Array.isArray(extra) ? extra.map(item => ({ ...item })) : [])];
    const seenIds = new Map();
    for (const item of notes) { const n = (seenIds.get(item.id) || 0) + 1; seenIds.set(item.id, n); if (n > 1) item.id = `${item.id}#${n}`; }
    const counts = Object.fromEntries(NOTE_KINDS.map(kind => [kind, 0]));
    for (const item of notes) counts[item.kind] = (counts[item.kind] || 0) + 1;
    return { notes, counts, total: notes.length, warnings: notes.filter(item => item.level === 'warn').length, cards: all.length, ms: Math.round((performance.now() - started) * 100) / 100 };
}

/** One line for the end of the stack, such as "4 notes" or "No notes". */
export const summary = list => list.total ? `${list.total} note${list.total === 1 ? '' : 's'}` : 'No notes';
/** The notes that name a card, for the card's own row. */
export const notesFor = (list, key) => list.notes.filter(item => item.cards.some(card => card.key === key));
