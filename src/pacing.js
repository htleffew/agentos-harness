// Pacing and style helpers: story phases, quiet after a big event, the word list, the rules given to the AI writer,
// and what a story event item may ask of the story world.
import { ctx, KEY, names, isReply } from './st.js';
import { settings } from './store.js';
import { DEFAULT_WRITER_RULES, DEFAULT_WORDS } from './defaults.js';
import { isPaused, endsWhenOf } from './memory/thread-state.js';
import { ruleHeld } from './story-rules.js';

export { DEFAULT_WRITER_RULES, DEFAULT_WORDS };

const clean = t => String(t ?? '').replace(/\s+/g, ' ').trim();
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------- the rules every AI-written text is asked to keep ----------

/** The word list as entries: a word, or the start of a word when it ends with a star. */
export function wordList() {
    const o = settings().words;
    if (!o || o.on === false) return [];
    return [...new Set(String(o.list || '').split(/[,\n]/).map(w => clean(w).toLowerCase()).filter(w => w.replace(/\*/g, '').length >= 2))];
}

/** The words of the list that this text uses, as they are written in the text. */
export function wordHits(text) {
    const s = String(text ?? '');
    const found = [];
    for (const w of wordList()) {
        const star = w.endsWith('*');
        const core = esc(w.replace(/\*+$/, ''));
        const m = s.match(new RegExp(`(?<![\\p{L}\\p{N}])${core}${star ? '[\\p{L}]*' : ''}(?![\\p{L}\\p{N}])`, 'iu'));
        if (m && !found.some(f => f.toLowerCase() === m[0].toLowerCase())) found.push(m[0]);
    }
    return found;
}

/** One line for a list of flags, or '' when the text uses none of the words. */
export function wordFlag(text) {
    const hits = wordHits(text);
    return hits.length ? `On your word list: ${hits.map(h => `"${h}"`).join(', ')}.` : '';
}

/** Lines added to every request that asks the AI to write something for the panel. */
export function writerRules() {
    const st = settings();
    const rules = String(st.writer?.rules ?? DEFAULT_WRITER_RULES).split('\n').map(clean).filter(Boolean);
    const out = [];
    if (rules.length) out.push('Rules about content, which come before everything else:', ...rules.map(r => `- ${r}`));
    return out;
}

// ---------- the story so far, for the AI writer ----------

/** The story so far as it was last sent with a reply (or shown in the Story World tab), kept for the AI writer. */
const story = { chat: '', text: '' };
export function rememberStory(text) { story.chat = String(ctx().getCurrentChatId?.() || ''); story.text = String(text || ''); }
export function storySoFar() { return story.chat === String(ctx().getCurrentChatId?.() || '') ? story.text : ''; }

// ---------- story phases ----------

/** The phases in order of the reply they start at. */
export function phases() {
    const o = settings().pace;
    return (Array.isArray(o.phases) ? o.phases : []).map(p => ({
        name: clean(p?.name) || 'Phase', from: Math.max(1, Math.round(Number(p?.from) || 1)),
        chance: Math.max(0, Math.min(400, Math.round(Number(p?.chance ?? 100)))), line: clean(p?.line),
    })).sort((a, b) => a.from - b.from);
}

/** The phase reply number n falls in, or null when phases are off or none has started yet. */
export function phaseFor(n) {
    if (!settings().pace.phasesOn) return null;
    let cur = null;
    for (const p of phases()) if (n >= p.from) cur = p;
    return cur;
}

// ---------- quiet after a big event ----------

/** The assistant replies of the chat, newest first, up to the reply that is about to be written. */
function repliesBack(type) {
    const chat = ctx().chat || [];
    let end = chat.length;
    if (type === 'swipe' || type === 'continue') end -= 1;
    const out = [];
    for (let i = end - 1; i >= 1; i--) { const m = chat[i]; if (isReply(m)) out.push(m); }
    return out;
}

/**
 * After something big happened, nothing new starts for a set number of replies. Returns null, or
 * { left, name }: how many replies (this one included) stay quiet, and what happened.
 */
export function quietNow(type) {
    const quiet = Math.max(0, Math.round(Number(settings().pace.quiet) || 0));
    if (!quiet) return null;
    const checkOff = settings().check.mode === 'off';
    const back = repliesBack(type);
    for (let d = 1; d <= quiet && d <= back.length; d++) {
        const big = (back[d - 1].extra?.[KEY]?.items || []).find(it => it.big && (it.status === 'done' || ((checkOff || it.noCheck) && it.status === 'sent')));
        if (big) return { left: quiet - d + 1, name: big.name };
    }
    return null;
}

/** The record on the reply before the one that is about to be written, or null. */
export function previousRecord(type) {
    const m = repliesBack(type)[0];
    return m?.extra?.[KEY] || null;
}

// ---------- who is in the scene, as a number ----------

/** How many different people other than {{user}} the text of a "present" list names. */
export function countPresent(presentText) {
    const user = clean(names().user).toLowerCase();
    const seen = new Set();
    for (const part of String(presentText || '').split(/,|;|\n|\band\b/i)) {
        const n = clean(part).replace(/^[-*\s]+/, '').replace(/\s*\([^)]*\)\s*$/, '').toLowerCase();
        if (n.length >= 2 && n !== user && n !== 'none' && n !== 'nobody' && n !== 'no one') seen.add(n);
    }
    return seen.size;
}

// ---------- what a story event item may ask of the story world ----------

export const NEEDS = {
    '': { label: 'Any time' },
    thread: { label: 'There is an open thread', mark: '[thread]', help: 'The open thread that has gone longest without moving is used. Write [thread] where it belongs in the item. Left out, it is added at the end.' },
    secret: { label: 'Someone in the scene keeps a secret', mark: '[secret]', help: 'A kept secret of someone in the scene is used, and the AI is told what it is. Write [secret] where it belongs in the item. Left out, it is added at the end.' },
    plan: { label: 'Someone in the scene has a plan', mark: '[plan]', help: 'The plan of someone in the scene is used. Write [plan] where it belongs in the item. Left out, it is added at the end.' },
};

const short = (t, max = 220) => { const s = clean(t).replace(/[.]+$/, ''); return s.length > max ? `${s.slice(0, max).replace(/\s+\S*$/, '')}...` : s; };

/**
 * What the story world offers the dice right now. list: the world's entries (or []). present: names of the
 * character entries read as present. meta: { chat, n }. Returns { threads, secrets, plans }, each a list of ready texts.
 */
export function worldOffers(list, present, meta) {
    const here = present.map(n => clean(n).toLowerCase()).filter(Boolean);
    const isHere = t => { const s = clean(t).toLowerCase(); return !!s && here.some(n => s.includes(n) || n.includes(s)); };
    const on = list.filter(w => w.on && !isPaused(w));
    const age = w => (!w.at || w.at.chat !== meta.chat ? Infinity : meta.n - w.at.n);
    const threads = on.filter(w => w.kind === 'thread' && w.status !== 'done').sort((a, b) => age(b) - age(a) || a.uid - b.uid)
        .map(w => ({ uid: w.uid, name: w.name, text: `the open matter "${w.name}"${clean(w.fields.open) ? ` (${short(w.fields.open)})` : ''}` }));
    const secrets = on.filter(w => w.kind === 'secret' && w.status === 'kept' && clean(w.fields.secret) && isHere(w.fields.holder))
        .map(w => ({ uid: w.uid, name: w.name, text: `${clean(w.fields.holder)}'s secret (${short(w.fields.secret)})` }));
    const plans = on.filter(w => w.kind === 'character' && clean(w.fields.plans) && isHere(w.name))
        .map(w => ({ uid: w.uid, name: w.name, text: `${w.name}'s plan (${short(w.fields.plans)})` }));
    return { threads, secrets, plans };
}

const MEMORY_THREADS = ['arc', 'agenda', 'event', 'payoff'];
const dataOf = w => { try { return JSON.parse(w?.fields?.data || 'null') || {}; } catch { return {}; } };

/**
 * worldOffers for a chat whose memory lives in chat data. list: the Story World views of the records in force, the same
 * rows recall reads (src/memory/import.js viewOfRecord). Imported entries keep today's kinds and are read as worldOffers
 * reads them; capture's records are read from their data: threads as arc, agenda, event and payoff (seed), secrets as
 * private knowledge with holders, plans as agenda records of someone present.
 */
export function memoryOffers(list, present, meta) {
    const legacy = worldOffers(list, present, meta);
    const here = present.map(n => clean(n).toLowerCase()).filter(Boolean);
    const isHere = t => { const s = clean(t).toLowerCase(); return !!s && here.some(n => s.includes(n) || n.includes(s)); };
    const rows = list.filter(w => w.on && !isPaused(w) && (MEMORY_THREADS.includes(w.kind) || w.kind === 'knowledge')).map(w => ({ w, d: dataOf(w) }))
        .filter(({ d }) => clean(d.text) && d.status !== 'done');
    const label = ({ w, d }) => clean(d.subject) || w.name;
    const threads = rows.filter(({ w }) => MEMORY_THREADS.includes(w.kind)).sort((a, b) => a.w.uid - b.w.uid).map(r => {
        const ends = endsWhenOf(r.w);
        return { uid: r.w.uid, name: label(r), text: `the open matter (${short(r.d.text)}${ends ? `; it ends when ${ends.replace(/^when\s+/i, '')}` : ''})` };
    });
    const secrets = rows.filter(({ w, d }) => w.kind === 'knowledge' && d.private !== false).map(r => ({ r, holder: [].concat(r.d.holders || r.d.subject || []).map(clean).find(isHere) }))
        .filter(x => x.holder).map(({ r, holder }) => ({ uid: r.w.uid, name: label(r), text: `${holder}'s secret (${short(r.d.text)})` }));
    const plans = rows.filter(({ w, d }) => w.kind === 'agenda' && isHere(d.subject)).map(r => ({ uid: r.w.uid, name: label(r), text: `${clean(r.d.subject)}'s plan (${short(r.d.text)})` }));
    return { threads: [...legacy.threads, ...threads], secrets: [...legacy.secrets, ...secrets], plans: [...legacy.plans, ...plans] };
}

/** Can this item be used now? scene: { count, threads, secrets, plans }. */
export function itemFits(it, scene) {
    // A story rule holds this item out of rolls until it fires (B41, src/story-rules.js).
    if (ruleHeld(it)) return false;
    // Weight -10 means never rolled (B51).
    if (Number(it.bias) <= -10) return false;
    if (!scene) return true;
    if (Number(it.min) > 0 && (scene.count || 0) < Number(it.min)) return false;
    if (it.need === 'thread') return (scene.threads || []).length > 0;
    if (it.need === 'secret') return (scene.secrets || []).length > 0;
    if (it.need === 'plan') return (scene.plans || []).length > 0;
    return true;
}

/** The item's text with what it asked for written in. pick: (list) => one of the list. */
export function fillNeed(it, scene, pick) {
    const text = String(it.text ?? '');
    const need = NEEDS[it.need] && it.need ? it.need : '';
    if (!scene || !need) return { text, used: null };
    const pool = need === 'thread' ? (scene.threads || []).slice(0, 1) : need === 'secret' ? (scene.secrets || []) : (scene.plans || []);
    if (!pool.length) return { text, used: null };
    const got = pool.length === 1 ? pool[0] : pick(pool);
    const mark = NEEDS[need].mark;
    const filled = text.includes(mark) ? text.split(mark).join(got.text) : `${text.replace(/[.]+$/, '')}, about ${got.text}`;
    return { text: filled, used: { kind: need, uid: got.uid, name: got.name } };
}
