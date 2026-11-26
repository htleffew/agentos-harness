// B48: temperament on every person record. A speed per meter axis and per relationship level, 0.5 (guarded) to 1.5
// (volatile), 1 when none is filed. Capture infers it once, in the call it already makes, the first time it files the
// person; applySteps multiplies each step by it. Her edit goes through setTemperament and later captures leave it alone.

export const SPEED_MIN = 0.5;
export const SPEED_MAX = 1.5;
export const SPEED_DEFAULT = 1;
export const SPEED_KEYS = Object.freeze(['tenderness', 'fury', 'dread', 'yearning', 'level']);

const fold = value => String(value ?? '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const clampSpeed = n => Math.round(Math.max(SPEED_MIN, Math.min(SPEED_MAX, n)) * 100) / 100;

/** A temperament as filed: only the keys given, each a finite number held between 0.5 and 1.5. Null when none is usable. */
export function readTemperament(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const out = {};
    for (const key of SPEED_KEYS) {
        const v = raw[key];
        if (v === null || v === undefined || v === '') continue;
        const n = Number(v);
        if (Number.isFinite(n)) out[key] = clampSpeed(n);
    }
    return Object.keys(out).length ? out : null;
}

/** The speed for one axis ('tenderness', 'fury', 'dread', 'yearning') or the relationship 'level'; 1 when not filed. */
export function speedFor(temperament, key) {
    const n = Number(temperament?.[key]);
    return Number.isFinite(n) ? clampSpeed(n) : SPEED_DEFAULT;
}

/** A step times a speed, rounded away from zero at the half and kept whole. The caller clamps the meter. */
export function scaleStep(step, speed) {
    const n = Number(step) * Number(speed);
    if (!Number.isFinite(n)) return 0;
    return Math.sign(n) * Math.round(Math.abs(n)) || 0;
}

const isPerson = r => r && r.kind === 'person';
const namesOf = r => [r.subject, ...(r.aliases || [])].map(fold).filter(Boolean);

/** True when no person record (in force or not) carries this subject yet: the person is about to be filed for the first time. */
export function isFirstFiling(op, records = []) {
    if (!op || op.op !== 'add' || (op.kind || 'fact') !== 'person') return false;
    const who = fold(op.subject);
    return !!who && !records.some(r => isPerson(r) && namesOf(r).includes(who));
}

/** The temperament of each person by folded name (and alias): from the records, plus the ones this call files first. */
export function temperamentMap(records = [], ops = []) {
    const map = new Map();
    for (const r of records) if (isPerson(r) && r.status !== 'suspect') { const t = readTemperament(r.temperament); if (t) for (const n of namesOf(r)) map.set(n, t); }
    for (const op of ops || []) {
        const t = isFirstFiling(op, records) ? readTemperament(op.temperament) : null;
        if (t) map.set(fold(op.subject), t);
    }
    return map;
}

/** The speed of the person called `name` for `key`, from a temperamentMap. */
export const speedOf = (map, name, key) => speedFor(map?.get(fold(name)), key);

/**
 * Her edit: set some speeds on a person record (other speeds stay). Files a revise by you; a later capture never rewrites
 * it, because capture reads temperament only on a person's first filing. Resolves the store's result.
 */
export async function setTemperament(personId, speeds, { store } = {}) {
    const s = store || (await import('./store.js')).memoryStore();
    const record = s.view().byId.get(String(personId));
    if (!record || record.kind !== 'person') return { committed: false, reason: 'No person record with that id.' };
    const next = { ...(readTemperament(record.temperament) || {}), ...(readTemperament(speeds) || {}) };
    const { versions, entries, locked, view, ...rest } = record;
    return s.record([{ op: 'revise', target: [record.id], record: { ...rest, temperament: next }, origin: { type: 'you' }, reason: 'Temperament set by you.' }]);
}
