// B34: the block bank conflict call (A11 c.7). One model call, run only when she taps Check conflicts. It reads the blocks
// that will be sent, in send order with her customized text, and lists contradictions, duplications and overlaps that could
// cause a problem in the reply. It reports and applies nothing: no function here includes, excludes, moves or edits a card,
// and the validator keeps only the listed fields. B33's code notes ride along as context and are not repeated as findings.
//
// Finding: { a, b, kind, reason, problem, a_span, b_span }. a and b are card keys of two different cards that are on.
// A finding is dropped, and counted in the receipt, when a key is unknown or the two keys are equal, the kind is unknown,
// the reason or problem line is empty, or a span does not occur in its card's text.
import { settings, saveSettings } from './store.js';
import { parseJson } from './st.js';
import { checkList, cardRef } from './preset-checks.js';
import { stripPresetComments } from './v10.js';

export const KINDS = Object.freeze(['contradiction', 'duplication', 'overlap']);
export const KIND_LABELS = Object.freeze({ contradiction: 'Contradiction', duplication: 'Duplication', overlap: 'Overlap' });
export const SPAN_WORDS = 15;
export const MAX_FINDINGS = 40;
export const INPUT_BUDGET = 120000;      // characters across all blocks; each block gets an equal share between 100 and 4000
export const ANSWER_TOKENS = 3500;
export const STALE_TEXT = 'Stack changed since the check';
export const CALL_LABEL = 'Check block conflicts';

const own = (object, key) => object && Object.hasOwn(object, key) ? object[key] : undefined;
const put = (object, key, value) => Object.defineProperty(object, key, { value, enumerable: true, writable: true, configurable: true });
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const words = text => String(text ?? '').trim().split(/\s+/).filter(Boolean);

/** A short stable hash of a string (FNV-1a, 32 bits, hex). The stack and pair checks compare these, never the text. */
export function textHash(text) {
    let h = 0x811c9dc5;
    const s = String(text ?? '');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, '0');
}

/** Lower case, one space between words, straight quotes and dashes, so a quote survives the model's typography. */
export function normalize(text) {
    return String(text ?? '').toLowerCase()
        .replace(/[‘’‚‛′]/g, "'").replace(/[“”„‟″]/g, '"')
        .replace(/[‐-―−]/g, '-').replace(/…/g, '...').replace(/\s+/g, ' ').trim();
}
const trimSpan = span => normalize(span).replace(/^(?:\.{3}|["'`\s])+|(?:\.{3}|["'`\s])+$/g, '').trim();

// ----------------------------------------------------------------------------------------------------------------------
// What the model reads

/** The text of a card as SillyTavern sends it: comment macros removed. The call, the spans and the stack stamp all use it. */
export const sentText = card => stripPresetComments(card?.text);

/** The cards the call reads: on, with text, in send order. */
export function callCards(plan) {
    return (Array.isArray(plan) ? plan : []).filter(card => card && card.on && !card.marker && sentText(card));
}

/**
 * The call's input: each block in send order with its key, source, name, role and text (whole text up to a per-block
 * budget, three excerpts beyond it), and the code notes as context.
 */
export function conflictInput(plan, { notes = null } = {}) {
    const cards = callCards(plan);
    const limit = Math.min(4000, Math.max(100, Math.floor(INPUT_BUDGET / Math.max(1, cards.length))));
    const blocks = cards.map((card, i) => {
        const text = sentText(card);
        const head = { n: i + 1, key: card.key, source: card.sourceName || card.source || '', name: card.name || card.id || '', role: card.role || 'system' };
        if (text.length <= limit) return { ...head, text };
        const part = Math.floor(limit / 3), middle = Math.floor((text.length - part) / 2);
        return { ...head, excerpts: [text.slice(0, part), text.slice(middle, middle + part), text.slice(-part)] };
    });
    const list = notes || checkList(plan).notes;
    const context = list.slice(0, 40).map(item => ({ kind: item.kind, text: item.text, keys: item.cards.map(c => c.key) }));
    return { cards, blocks, notes: context, user: JSON.stringify({ blocks, notes: context }) };
}

// ----------------------------------------------------------------------------------------------------------------------
// Validation

/**
 * Keep the findings that pass; count the rest by reason. parsed is the model's JSON; cards is the list the call read;
 * notes are the code notes, whose same-text and near-copy pairs are not repeated as duplication findings.
 */
export function validateFindings(parsed, cards, { notes = [] } = {}) {
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.findings) ? parsed.findings : null;
    const dropped = { keys: 0, kind: 0, reason: 0, problem: 0, span: 0, duplicate: 0, noted: 0, limit: 0 };
    if (!list) return { ok: false, findings: [], received: 0, dropped, droppedTotal: 0 };
    const byKey = new Map(cards.map(card => [card.key, card]));
    const covered = new Set();
    for (const item of notes) {
        if (item.kind !== 'same-text' && item.kind !== 'near-copy') continue;
        const keys = (item.cards || []).map(c => c.key);
        for (const x of keys) for (const y of keys) if (x !== y) covered.add(JSON.stringify([x, y].sort()));
    }
    const seen = new Set(), findings = [];
    const line = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    for (const item of list) {
        const a = byKey.get(item?.a), b = byKey.get(item?.b);
        if (!a || !b || a.key === b.key) { dropped.keys++; continue; }
        if (!KINDS.includes(item.kind)) { dropped.kind++; continue; }
        const reason = line(item.reason), problem = line(item.problem);
        if (!reason) { dropped.reason++; continue; }
        if (!problem) { dropped.problem++; continue; }
        const spanA = spanOf(item.a_span, sentText(a)), spanB = spanOf(item.b_span, sentText(b));
        if (!spanA || !spanB) { dropped.span++; continue; }
        const pair = JSON.stringify([a.key, b.key].sort());
        if (item.kind === 'duplication' && covered.has(pair)) { dropped.noted++; continue; }
        const id = `${pair}|${item.kind}|${normalize(spanA)}|${normalize(spanB)}`;
        if (seen.has(id)) { dropped.duplicate++; continue; }
        seen.add(id);
        if (findings.length >= MAX_FINDINGS) { dropped.limit++; continue; }
        findings.push({ a: a.key, b: b.key, kind: item.kind, reason, problem, a_span: spanA, b_span: spanB });
    }
    const droppedTotal = Object.values(dropped).reduce((sum, n) => sum + n, 0);
    return { ok: true, findings, received: list.length, dropped, droppedTotal };
}

/** The span as quoted by the model, cut to 15 words, when it occurs in the card text; otherwise ''. */
function spanOf(value, text) {
    if (typeof value !== 'string') return '';
    const quote = words(value.replace(/^["'“‘`\s]+|["'”’`\s]+$/g, '')).slice(0, SPAN_WORDS).join(' ');
    const needle = trimSpan(quote);
    return needle && normalize(text).includes(needle) ? quote : '';
}

const DROP_LABELS = { keys: ['unknown or equal key', 'unknown or equal keys'], kind: ['unknown kind', 'unknown kinds'], reason: ['empty reason', 'empty reasons'],
    problem: ['empty problem line', 'empty problem lines'], span: ['span not in its block', 'spans not in their blocks'],
    duplicate: ['repeated finding', 'repeated findings'], noted: ['already a code note', 'already code notes'], limit: ['over the limit of 40', 'over the limit of 40'] };
/** "2 dropped: 1 unknown or equal key, 1 span not in its block", or '' when nothing was dropped. */
export function droppedText(dropped) {
    const parts = Object.entries(dropped).filter(([, n]) => n).map(([key, n]) => `${n} ${DROP_LABELS[key][n === 1 ? 0 : 1]}`);
    const total = Object.values(dropped).reduce((sum, n) => sum + n, 0);
    return parts.length ? `${total} dropped: ${parts.join(', ')}` : '';
}

// ----------------------------------------------------------------------------------------------------------------------
// The call

async function defaultAsk({ user, onReceipt, signal }) {
    const { request } = await import('./ai.js');
    return request({ operation: 'presetParity', authorization: 'manual', what: CALL_LABEL, promptSystemId: 'conflictCheck', user, tokens: ANSWER_TOKENS, onReceipt, signal });
}
const textOf = answer => typeof answer === 'string' ? answer : String(answer?.text ?? '');

function repairPrompt(user, previous, reason) {
    return `${user}\n\nYour previous answer could not be used.\nProblem: ${reason}\nPrevious answer:\n${String(previous).slice(0, 6000)}\n\nReturn the corrected JSON array only, with a and b copied from the keys above and each span copied exactly from its block.`;
}

/**
 * Run the call on a plan (the array stackPlan() returns). ask({ user, repair, onReceipt, signal }) gives the model's
 * answer as { text, note? }; the default goes through the routing chain of the presetParity operation. One repair retry
 * follows an unreadable answer, or one whose every item was dropped. Resolves { findings, receipt, text }; changes nothing.
 */
export async function checkConflicts(plan, { ask = defaultAsk, notes = null, onReceipt, signal } = {}) {
    const code = notes || checkList(plan).notes;
    const input = conflictInput(plan, { notes: code });
    const receipt = { cards: input.cards.length, notes: input.notes.length, calls: 0, repaired: false, received: 0, kept: 0, dropped: {}, droppedTotal: 0, summary: '' };
    if (input.cards.length < 2) {
        receipt.summary = 'Fewer than two blocks are on, so there was nothing to compare and no model call was made.';
        return { findings: [], receipt, text: '' };
    }
    let verdict = null, last = '', problem = '';
    for (const repair of [false, true]) {
        const user = repair ? repairPrompt(input.user, last, problem) : input.user;
        const answer = await ask({ user, repair, onReceipt, signal });
        receipt.calls++;
        last = textOf(answer);
        const parsed = parseJson(last);
        verdict = validateFindings(parsed, input.cards, { notes: code });
        const unreadable = !verdict.ok;
        const allDropped = verdict.ok && verdict.received > 0 && !verdict.findings.length && verdict.droppedTotal === verdict.received;
        if (!unreadable && !allDropped) { receipt.repaired = repair; await answer?.note?.(summaryOf(verdict, receipt, repair), true); break; }
        problem = unreadable ? 'The answer was not a JSON array of {a, b, kind, reason, problem, a_span, b_span}.' : `Every item was dropped (${droppedText(verdict.dropped)}).`;
        await answer?.note?.(`${problem} ${repair ? 'No retry is left.' : 'Asking once more.'}`, false);
        if (repair) {
            if (unreadable) throw new Error('The model returned an unreadable list of conflicts. Your stack is unchanged.');
            receipt.repaired = true;
        }
    }
    receipt.received = verdict.received; receipt.kept = verdict.findings.length; receipt.dropped = verdict.dropped; receipt.droppedTotal = verdict.droppedTotal;
    receipt.summary = summaryOf(verdict, receipt, receipt.repaired);
    return { findings: verdict.findings, receipt, text: last };
}

function summaryOf(verdict, receipt, repaired) {
    const found = verdict.findings.length ? `${verdict.findings.length} ${verdict.findings.length === 1 ? 'finding' : 'findings'}` : 'No problems found';
    const dropped = droppedText(verdict.dropped);
    return `${found}${dropped ? `; ${dropped}` : ''}. ${receipt.calls} model ${receipt.calls === 1 ? 'call' : 'calls'}${repaired ? ' (one repair retry)' : ''}.`;
}

// ----------------------------------------------------------------------------------------------------------------------
// The stack stamp, stored results and Keep both

/** Changes when a block is included, excluded, moved or edited: the blocks that are on, in order, with a hash of each sent text. */
export function stackStamp(plan) {
    return textHash(callCards(plan).map(card => `${card.key}:${textHash(sentText(card))}`).join('\n'));
}
const pairId = (a, b) => [a, b].sort().join('||');

function store() {
    const st = settings();
    if (!st.bankConflicts || typeof st.bankConflicts !== 'object' || Array.isArray(st.bankConflicts)) st.bankConflicts = {};
    return st.bankConflicts;
}
/** The stored result for a stack key: { at, stamp, findings, receipt, kept } or null. */
export const storedConflicts = key => { const record = own(store(), key); return record ? copy(record) : null; };

/**
 * Tap handler: run the call for a stack and store its findings next to the stack key. Never edits the stack, owners or
 * switches; the stored pairs she kept stay as they are.
 */
export async function runConflictCheck(key, plan, options = {}) {
    const result = await checkConflicts(plan, options);
    const by = new Map(plan.map(card => [card.key, card]));
    const findings = result.findings.map(f => {
        const a = by.get(f.a), b = by.get(f.b);
        return { ...f, aRef: cardRef(a), bRef: cardRef(b), aHash: textHash(sentText(a)), bHash: textHash(sentText(b)) };
    });
    const all = store();
    const kept = own(own(all, key), 'kept') || {};
    put(all, key, { at: Date.now(), stamp: stackStamp(plan), findings, receipt: result.receipt, kept });
    saveSettings();
    return { ...result, findings };
}

/** Keep both: mark a pair as seen at the texts it has now, until either card's text changes. */
export function keepBoth(key, plan, a, b) {
    const record = own(store(), key);
    if (!record) return false;
    const by = new Map(plan.map(card => [card.key, card]));
    const finding = record.findings.find(f => pairId(f.a, f.b) === pairId(a, b));
    const hashOf = (k, stored) => by.get(k) ? textHash(sentText(by.get(k))) : stored;
    if (!finding) return false;
    put(record.kept ||= {}, pairId(a, b), { [finding.a]: hashOf(finding.a, finding.aHash), [finding.b]: hashOf(finding.b, finding.bHash) });
    saveSettings();
    return true;
}

/**
 * The stored findings as check list items (the shape B33's notes have, plus reason, problem and spans on each card), with
 * stale set when the stack is not the one that was checked and seen set on a pair she kept whose texts are unchanged.
 */
export function conflictItems(key, plan) {
    const record = storedConflicts(key);
    if (!record) return null;
    const by = new Map((plan || []).map(card => [card.key, card]));
    const stale = !!plan && record.stamp !== stackStamp(plan);
    const items = record.findings.map((f, i) => {
        const kept = own(record.kept, pairId(f.a, f.b));
        const hashNow = (k, stored) => by.has(k) ? textHash(sentText(by.get(k))) : stored;
        const seen = !!kept && own(kept, f.a) === hashNow(f.a, f.aHash) && own(kept, f.b) === hashNow(f.b, f.bHash);
        const ref = (stored, k, span) => ({ ...(by.has(k) ? cardRef(by.get(k)) : stored), span });
        const a = ref(f.aRef, f.a, f.a_span), b = ref(f.bRef, f.b, f.b_span);
        return { id: `conflict:${pairId(f.a, f.b)}|${f.kind}|${i}`, kind: 'conflict', conflictKind: f.kind, level: 'warn', seen, reason: f.reason, problem: f.problem,
            cards: [a, b], text: `${KIND_LABELS[f.kind]} between ${a.name} (${a.source}) and ${b.name} (${b.source}). ${f.reason}` };
    });
    return { at: record.at, stale, staleText: stale ? STALE_TEXT : '', items, open: items.filter(item => !item.seen), receipt: record.receipt };
}
