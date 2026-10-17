// Undercurrent — "Behind the scenes" peek: an optional, closed <details> shown under an assistant message in the DOM only.
// Pure logic: builds the sections from the turn's note record (runtime) and the chat state, and renders escaped HTML.
// The peek is never written into chat[].mes / swipes, never saved to the chat file and never sent to the model:
// index.js inserts it as a sibling of .mes_text and rebuilds it on render / update / chat load.

import { openItems } from './state.js';
import { clip, isPlainObject, findKeyCI } from './util.js';

export const PEEK_CLASS = 'uc-peek';
export const PEEK_SUMMARY = 'Behind the scenes';

const DIRECTION = ['notebook', 'beat', 'pacing', 'event', 'author', 'stall', 'moves', 'offscreen', 'avoid'];
const ENGINES = ['scene_intimacy', 'desire', 'psyche', 'reply_shape', 'critic', 'drama', 'sparks'];

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
}

/**
 * A compact record of what one turn's note carried (kept in memory by index.js, keyed by player turn).
 * @param {{lines:object[], notebook:boolean}} parts buildInjectionParts() output
 * @param {{turn:number, rules?:string[], event?:object|null}} extra
 */
export function peekRecord(parts, { turn = 0, rules = [], event = null } = {}) {
    const by = {};
    for (const l of Array.isArray(parts?.lines) ? parts.lines : []) {
        if (!l?.text) continue;
        (by[l.section] ||= []).push(String(l.text));
    }
    return { turn, sections: by, notebook: !!parts?.notebook, rules: (rules || []).slice(0, 12).map(String), event: event?.kind ? [event.kind, ...(event.also || [])] : [] };
}

function opSummary(op) {
    const v = op?.value;
    let val = '';
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') val = String(v);
    else if (isPlainObject(v)) val = v.text ?? v.item ?? v.doing ?? v.name ?? v.value ?? '';
    return `${op.op} ${op.path}${val !== '' ? `: ${clip(String(val), 80)}` : ''}`;
}

/**
 * Sections of the peek for one assistant message.
 * @param {object} p
 * @param {object|null} p.record peekRecord() for this message's turn, when this session saw the turn
 * @param {object} p.state chat state
 * @param {number} p.turn the player turn this message answered
 * @param {object|null} [p.entry] the ledger entry of this message (ops recorded from it)
 * @param {boolean} [p.latest] true for the latest assistant message (current minds/goals are shown)
 * @returns {{title:string, lines:string[]}[]}
 */
export function peekSections({ record = null, state = {}, turn = 0, entry = null, latest = false } = {}) {
    const out = [];
    const sec = record?.sections || {};
    const pick = ids => ids.flatMap(id => sec[id] || []);
    let direction = pick(DIRECTION);
    if (!direction.length) {
        const beat = (state.threads?.used_beats || []).find(b => b.since_turn === turn);
        if (beat?.text) direction.push(`Beat: ${beat.text}`);
    }
    const events = (state.events?.history || []).filter(h => h.turn === turn).map(h => `Event (${h.kind})${h.content ? `: ${h.content}` : ''}`);
    if (direction.length) out.push({ title: 'Direction', lines: direction });
    const minds = sec.minds?.length ? sec.minds : (latest ? presentMinds(state, turn) : []);
    if (minds.length) out.push({ title: 'Characters', lines: minds });
    const goals = sec.goals?.length ? sec.goals : (latest ? goalLines(state) : []);
    if (goals.length) out.push({ title: 'Goals', lines: goals });
    const rules = [...(record?.rules || []).map(r => `Rule fired: ${r}`), ...(direction.some(l => /^Event/.test(l)) ? [] : events)];
    if (rules.length) out.push({ title: 'Rules and events', lines: rules });
    const engines = pick(ENGINES);
    if (engines.length) out.push({ title: 'Engines', lines: engines });
    const tics = sec.tics || [];
    if (tics.length) out.push({ title: 'Prose corrections', lines: tics });
    const ops = (entry?.ops || []).slice(0, 10).map(opSummary);
    if (ops.length) out.push({ title: 'Recorded from this reply', lines: ops });
    return out;
}

function presentMinds(state, turn) {
    const lines = [];
    for (const name of state.scene?.present || []) {
        const key = findKeyCI(state.characters, name);
        const c = key ? state.characters[key] : null;
        if (!c) continue;
        const bits = [];
        if (c.mood) bits.push(c.mood);
        const want = openItems(c.wants, turn).slice(-1)[0]?.text;
        if (want) bits.push(`wants ${want}`);
        if (bits.length) lines.push(`${key}: ${bits.join('; ')}`);
    }
    return lines;
}

/** Goal progress lines; hidden goals are masked. */
export function goalLines(state) {
    const items = Array.isArray(state.goals?.items) ? state.goals.items : [];
    const lines = [];
    for (const g of items.filter(x => x && x.status === 'active')) {
        if (g.hidden) { lines.push('A hidden goal (details hidden)'); continue; }
        const all = [];
        const walk = ts => { for (const t of ts || []) { if (t.children?.length) walk(t.children); else all.push(t); } };
        walk(g.tasks);
        const done = all.filter(t => t.done).length;
        const cur = all.find(t => !t.done);
        lines.push(`${clip(g.title, 80)}: ${done}/${all.length} done${cur ? ` · now: ${clip(cur.text, 100)}` : ''}`);
    }
    return lines;
}

/** The closed <details> element as an HTML string ('' when there is nothing to show). */
export function renderPeekHtml(sections) {
    const list = (Array.isArray(sections) ? sections : []).filter(s => s?.lines?.length);
    if (!list.length) return '';
    return `<details class="${PEEK_CLASS}"><summary>${esc(PEEK_SUMMARY)}</summary><div class="uc-peek-body">${list.map(s => `<div class="uc-peek-sec"><b>${esc(s.title)}</b><ul>${s.lines.map(l => `<li>${esc(clip(l, 600))}</li>`).join('')}</ul></div>`).join('')}</div></details>`;
}
