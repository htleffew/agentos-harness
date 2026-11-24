// The scripted story of MB11 played into a chat in SillyTavern's own shape, through the real memory store: messages with
// swipes, swipe_info slots and extra, and chat metadata. Swipes, edits, deletes and branches act on the chat the way
// SillyTavern does. Used by tests/t_memory_store.js and the MB2 evidence scripts.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { hashText, proseOf, storedMark } from '../../../src/memory/fold.js';
import { createStore } from '../../../src/memory/store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const MB11 = path.join(here, '..', '..', '..', 'docs', 'ux-overhaul', 'memory', 'evidence', 'MB11');
const HARNESS = path.join(here, '..', '..', '..', 'docs', 'ux-overhaul', 'memory', 'evidence', 'm1g', 'harness', 'mb11');
const { aliasTable, loadLore } = require(path.join(HARNESS, 'ref', 'engine.js'));
export const story = JSON.parse(fs.readFileSync(path.join(MB11, 'fixtures', 'story100.json'), 'utf8'));
const aliases = aliasTable(loadLore());
export const clone = value => JSON.parse(JSON.stringify(value));
const T0 = Date.parse('2026-11-23T17:00:00.000Z');
const KIND = { fact: 'fact', arc: 'thread', seed: 'thread', agenda: 'thread', knowledge: 'secret', profile: 'person', emotion: 'emotion', relationship: 'relationship' };
const THREAD = { arc: 'Plotline', seed: 'Seed', agenda: 'Plan' };
const IMPORTANCE = { fact: 5, arc: 8, seed: 6, agenda: 7, knowledge: 7, profile: 5, emotion: 4, relationship: 6 };

export class Play {
    constructor(chat = [], meta = {}, id = 'main') {
        this.chat = chat; this.meta = meta; this.id = id; this.saves = 0; this.clock = T0; this.minutes = chat.length;
        this.store = createStore({ chat: () => this.chat, meta: () => this.meta, chatId: () => this.current ?? this.id, save: async () => { this.saves += 1; }, now: () => ++this.clock });
    }
    add(isUser, text, extra = {}) {
        const send_date = new Date(T0 + (this.minutes++) * 60000).toISOString();
        const m = { name: isUser ? 'Heather' : 'Hale', is_user: isUser, mes: text, send_date, extra: { ...extra } };
        if (!isUser) Object.assign(m, { swipe_id: 0, swipes: [text], swipe_info: [{ send_date, extra: clone(m.extra) }] });
        this.chat.push(m);
        this.store.marks();
        return this.chat.length - 1;
    }
    replyIndexOfTurn(n) { return this.chat.findIndex(m => !m.is_user && m.extra?.turn === n); }
    async play(n) {
        const t = story.turns[n - 1];
        this.add(true, t.player);
        const i = this.add(false, t.prose, { turn: t.n });
        if (!/^\s*(\(OOC|\(\(|\[OOC)/i.test(t.player)) await this.capture(i, t.update, t.replaces);
        if (n % 10 === 0) await this.closeChapter(n - 9, n);
        return i;
    }
    async playTo(n, from = 1) { for (let k = from; k <= n; k++) await this.play(k); return this; }
    /** The scripted capture: what a model reading the reply would file, as MB11's reference engine files it. */
    inputs(update, replaces, at) {
        const f = this.store.view();
        const out = [];
        for (const c of update.changes || []) {
            const record = { id: c.id, kind: KIND[c.kind] || 'fact', ...(THREAD[c.kind] ? { threadType: THREAD[c.kind] } : {}), subject: c.subject, attribute: c.kind, text: c.text,
                ...(c.kind === 'knowledge' ? { holders: c.subject === 'Hale' ? ['Hale', 'Heather'] : [c.subject] } : {}), aliases: aliases.get(String(c.subject).toLowerCase()) || [],
                status: c.status || (THREAD[c.kind] ? 'open' : 'current'), ...(c.outcome ? { outcome: c.outcome } : {}), importance: IMPORTANCE[c.kind] || 5 };
            const evidence = [{ mark: storedMark(this.chat[at]), swipe: this.chat[at].swipe_id, quote: c.evidence || '' }];
            const exists = f.byId.has(c.id);
            if (exists && c.status === 'done') out.push({ op: 'complete', target: [c.id], record: { ...record, status: 'done' }, evidence, reason: 'The thread closed in this reply.' });
            else if (exists) out.push({ op: 'revise', target: [c.id], record, evidence, reason: 'A newer state of the same record.' });
            else if (replaces && f.byId.has(replaces)) out.push({ op: 'supersede', target: [replaces], record, evidence, reason: `The newer state replaces ${replaces}.` });
            else out.push({ op: 'add', record, evidence });
        }
        if (update.scene && Object.keys(update.scene).length) {
            const s = update.scene;
            out.push({ op: f.byId.has('scene') ? 'revise' : 'add', ...(f.byId.has('scene') ? { target: ['scene'] } : {}), record: { id: 'scene', kind: 'scene', subject: 'scene', text: `Place: ${s.where || ''}; Time: ${s.time || ''}; Present: ${s.present || ''}` } });
        }
        return out.map(input => ({ ...input, origin: { type: 'capture', route: 'scripted', model: 'story' } }));
    }
    async capture(i, update, replaces = null) {
        const job = this.store.begin(i);
        return this.store.commit(job, this.inputs(update, replaces, i));
    }
    async closeChapter(fromTurn, toTurn) {
        const a = this.replyIndexOfTurn(fromTurn) - 1, b = this.replyIndexOfTurn(toTurn);
        if (a < 0 || b < 0) return null;
        const span = this.chat.slice(a, b + 1);
        const covers = span.map(m => ({ mark: storedMark(m), swipe: m.swipe_id ?? 0, hash: hashText(proseOf(m)) }));
        const order = this.store.view().records.filter(r => r.kind === 'chapter').length + 1;
        const summary = story.turns.slice(fromTurn - 1, toTurn).map(t => t.beat).filter(Boolean).join(' ').slice(0, 1500);
        return this.store.record([{ op: 'add', record: { id: `chapter-${order}`, kind: 'chapter', subject: `chapter ${order}`, text: summary, order, covers, importance: 7 }, origin: { type: 'chapter', route: 'scripted writer' }, anchor: { mark: storedMark(this.chat[b]) }, reason: `Replies ${fromTurn} to ${toTurn}.` }]);
    }
    // SillyTavern: the shown swipe's extra is cloned into its slot, a new swipe starts from a clone of it, and selecting
    // a swipe brings that slot's extra back.
    swipe(i, text) {
        const m = this.chat[i];
        m.swipe_info[m.swipe_id].extra = clone(m.extra);
        m.swipes.push(text);
        m.swipe_info.push({ send_date: new Date(T0 + (this.minutes++) * 60000).toISOString(), extra: clone(m.extra) });
        m.swipe_id = m.swipes.length - 1;
        m.mes = text;
        m.extra = clone(m.extra);
        return m.swipe_id;
    }
    select(i, k) {
        const m = this.chat[i];
        m.swipe_info[m.swipe_id].extra = clone(m.extra);
        m.swipe_id = k; m.mes = m.swipes[k]; m.extra = clone(m.swipe_info[k].extra);
    }
    edit(i, text) { const m = this.chat[i]; m.mes = text; if (m.swipes) m.swipes[m.swipe_id] = text; }
    del(i) { this.chat.splice(i, 1); }
    branch(i, id = `${this.id}-branch`) { return new Play(clone(this.chat.slice(0, i + 1)), clone(this.meta), id); }
    reload() { this.chat = clone(this.chat); this.meta = clone(this.meta); return this; }
    fold(options) { return this.store.view(options); }
}

export const fresh = async n => { const p = new Play(); p.add(false, story.greeting, { turn: 0 }); return p.playTo(n); };
