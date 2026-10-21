// Undercurrent 2 · FEATURES — one-shot note: `/uc-direct <note>` applies to the next turn only.
//
// setOneShot(ctx, note) stores {text, setAt: <anchor uc_id when set>, usedBy: null}. The first real (non-dry-run)
// generation after that claims the note for its turn anchor (usedBy) and every generation with that same anchor
// (swipes / regenerations of that reply) gets it too; once a newer player message exists the note is dropped.
// Dry runs (token counting, payload preview: ctx.dryRun) show the note without claiming it.

import { str, clip, isPlainObject } from '../common/text.js';
import { anchor } from '../common/chat.js';
import { sget, sset } from '../common/settings.js';

export const DEFAULTS = Object.freeze({});
export const SCHEMA = [];
const MAX_CHARS = 600;

function anchorKey(ctx) {
    const a = anchor(ctx);
    return a.user ? (a.userKey || `pos:${a.user.pos}`) : '';
}

/** Store a note for the next turn (empty text clears). Returns the stored note or null. */
export function setOneShot(ctx, note) {
    const text = clip(str(note).replace(/\[\[uc_[a-z0-9_]+\]\]/gi, '').trim(), MAX_CHARS);
    if (!text) { sset(ctx, 'note', null); return null; }
    const v = { text, setAt: anchorKey(ctx), usedBy: null };
    sset(ctx, 'note', v);
    return v;
}

export function clearOneShot(ctx) {
    sset(ctx, 'note', null);
}

/** The pending or active note ({text, setAt, usedBy}) or null. */
export function getOneShot(ctx) {
    const v = sget(ctx, 'note', null);
    return isPlainObject(v) && str(v.text) ? v : null;
}

/** The note text for this generation (claims it on the first real generation), or ''. */
export function oneShotFor(ctx) {
    const v = getOneShot(ctx);
    if (!v) return '';
    const key = anchorKey(ctx);
    if (v.usedBy !== null && v.usedBy !== undefined) {
        if (v.usedBy === key) return v.text;
        sset(ctx, 'note', null);
        return '';
    }
    if (!ctx?.dryRun) sset(ctx, 'note', { ...v, usedBy: key });
    return v.text;
}

export default {
    id: 'oneshot',
    settingsKeys: [],
    turnLines(ctx) {
        const text = oneShotFor(ctx);
        return text ? [{ slot: 'uc_directive', text, priority: 96, source: 'oneshot' }] : [];
    },
};
