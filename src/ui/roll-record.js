// The roll record of one rolled event or writing style (B37): the seed, the bank version, each category's pool and
// pick count at roll time and the values drawn, with "Roll again with this seed" to reproduce it. Shown in What was
// sent and in the editor's roll preview. Replaying makes no request.
import { h, button } from './dom.js';
import { replayRoll, sameDraw } from '../events.js';
import { loadBook } from '../st.js';

const poolText = c => `${c.pool?.length ? `${c.pool.length} ticked` : 'whole bank'}, pick ${c.count}${c.count > 1 && c.send && c.send !== 'together' ? `, ${c.send === 'beat' ? 'one per beat' : 'one per paragraph'}` : ''}`;

/** The record as rows. ri: the set's data to replay against, or a function that loads it. */
export function rollRecordView(roll, ri, { polished = null } = {}) {
    if (!roll) return null;
    const kv = (k, v) => h('div', { class: 'ri-kv' }, h('span', { class: 'ri-k' }, k), h('span', { class: 'ri-v' }, v));
    const out = h('p', { class: 'ri-help', role: 'status', 'data-ri-replay': '' });
    const names = new Map((roll.cats || []).map(c => [c.id, c]));
    const box = h('div', { class: 'ri-roll-record', 'data-ri-roll-record': '' },
        h('div', { class: 'ri-label' }, 'Roll record'),
        h('div', { class: 'ri-grid' },
        kv('Seed', String(roll.seed)),
        kv('Bank version', `shipped ${roll.bank?.v ?? 0}${Object.keys(roll.bank?.revs || {}).length ? `, revisions ${Object.entries(roll.bank.revs).map(([k, v]) => `${k} ${v}`).join(', ')}` : ''}`),
        ...(roll.cats || []).map(c => kv(c.name, poolText(c))),
        ...(roll.drawn || []).map(d => kv(`Drawn for ${names.get(d.catId)?.name || 'a category'}`, d.texts.join(' | '))),
        polished ? [
            kv('Rolled parts', polished.raw),
            polished.ok ? h('div', { class: 'ri-kv' }, h('span', { class: 'ri-k' }, h('span', { class: 'ri-call-dot', 'aria-label': 'Extension model call' }), 'Smoothed text'), h('span', { class: 'ri-v' }, polished.text))
                : kv('Smoothed text', `Not used: ${polished.reason || 'no answer'}. The rolled parts were sent.`),
        ] : null),
        h('div', { class: 'ri-row ri-row-tight' }, button('Roll again with this seed', async () => {
            try {
                const data = typeof ri === 'function' ? await ri() : ri;
                if (!data) { out.textContent = 'The set this roll came from could not be read.'; return; }
                const again = replayRoll(data, roll);
                if (!again) { out.textContent = 'With this seed the set rolls nothing now.'; return; }
                out.textContent = `${sameDraw(roll, again.roll) ? 'Same values as the saved roll' : 'Different values: the bank or the set changed since'}: ${again.roll.drawn.map(d => d.texts.join(' | ')).join('; ')}`;
            } catch (e) { out.textContent = `Could not roll again: ${e.message}`; }
        }, { kind: 'ghost', title: 'Roll with the saved seed, pools and counts. Nothing is sent or saved.' })),
        out);
    return box;
}

/** A loader for the set data of one sent item, read from its lorebook entry. */
export const itemSetData = it => async () => {
    const book = await loadBook(it.world);
    return book?.entries?.[it.uid]?.extensions?.ri || null;
};
