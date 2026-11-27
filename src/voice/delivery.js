// V2: how a character speaks. Three settings per character on the Voices page (Expressiveness, Steadiness, Pace), four
// changes for one reply on the Play sheet (More feeling, Calmer, Faster, Slower), an optional lift for exclaimed and
// shouted lines, and saved presets. Everything here turns those choices into Chatterbox's own knobs in code; no model call.
//
// The mapping. Expressiveness is Chatterbox's exaggeration, 0.3 to 1.0 on the sheet (her King County 0.65 in the middle).
// Steadiness moves temperature and cfg_weight together: steadier is a lower temperature (less variety from take to take)
// and a slightly higher cfg_weight (closer to the clip). Pace never uses the server's speed control, which time-stretched
// the audio and gave the distortion she heard; it moves cfg_weight, which Chatterbox documents as changing pacing (lower
// is slower and more deliberate, chatterbox-tts 0.1.7 README), and the pauses RI sets between lines.
import { KING_COUNTY } from './client.js';

/** A character's settings before she moves anything: her King County delivery. */
export const DELIVERY_DEFAULT = Object.freeze({ expressiveness: KING_COUNTY.exaggeration, steadiness: 0, pace: 0 });

/** The three sliders on a character's card. Steadiness and Pace are steps either side of King County. */
export const SLIDERS = Object.freeze({
    expressiveness: { label: 'Expressiveness', min: 0.3, max: 1, step: 0.05,
        help: 'How much feeling the voice puts into a line. King County is 0.65.',
        words: value => `${value.toFixed(2)}${value === DELIVERY_DEFAULT.expressiveness ? ', King County' : value > DELIVERY_DEFAULT.expressiveness ? ', livelier' : ', flatter'}` },
    steadiness: { label: 'Steadiness', min: -2, max: 2, step: 1,
        help: 'Steadier takes vary less and keep closer to the clip; looser ones wander more.',
        words: value => ['Much looser', 'Looser', 'King County', 'Steadier', 'Much steadier'][value + 2] },
    pace: { label: 'Pace', min: -2, max: 2, step: 1,
        help: 'Moves the voice model\'s pacing and the pauses between lines. The speed control is never used: it distorted the voice.',
        words: value => ['Much slower', 'Slower', 'King County', 'Faster', 'Much faster'][value + 2] },
});

/** One step of each setting in Chatterbox's terms. */
export const STEP = Object.freeze({ temperature: -0.1, steadyCfg: 0.05, paceCfg: 0.08, pause: 0.15 });
/** Where each knob stops, so no mix of sheet, moment and lift leaves the range she can judge. */
export const LIMITS = Object.freeze({ exaggeration: [0.25, 1.2], cfg_weight: [0.25, 0.8], temperature: [0.5, 1.1], pause: [0.55, 1.45] });

/** The four changes for one reply, in two pairs; one of each pair can be on. */
export const MOMENTS = Object.freeze({
    feeling: { label: 'More feeling', pair: 'feeling', change: { expressiveness: 0.15 } },
    calmer: { label: 'Calmer', pair: 'feeling', change: { expressiveness: -0.15, steadiness: 1 } },
    faster: { label: 'Faster', pair: 'pace', change: { pace: 1 } },
    slower: { label: 'Slower', pair: 'pace', change: { pace: -1 } },
});

/** Test lines, one per slider, so her ear judges each one. Pace has two sentences, so its pause is heard too. */
export const TEST_LINES = Object.freeze({
    expressiveness: 'You came back! After all this time, you actually came back.',
    steadiness: 'Listen to me. We leave at first light, we take the north road, and we stop for no one.',
    pace: 'Not yet. Wait for the bell, then walk to the door, and do not look back.',
});

const round = value => Math.round(value * 100) / 100;
const clamp = (value, [low, high]) => Math.min(high, Math.max(low, value));
const fit = (value, spec) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return round(Math.min(spec.max, Math.max(spec.min, Math.round((n - spec.min) / spec.step) * spec.step + spec.min)));
};

/**
 * A saved voice's delivery: { expressiveness, steadiness, pace }. A voice saved by V1 holds raw knobs instead; those are
 * read back into the three settings as closely as their steps allow, so her earlier tuning carries over.
 */
export function deliveryOf(saved) {
    const out = { ...DELIVERY_DEFAULT };
    const stored = saved?.delivery;
    if (stored && typeof stored === 'object') {
        for (const name of Object.keys(SLIDERS)) {
            const value = fit(stored[name], SLIDERS[name]);
            if (value !== null) out[name] = value;
        }
        return out;
    }
    const knobs = saved?.knobs || {};
    if (Number.isFinite(knobs.exaggeration)) out.expressiveness = fit(knobs.exaggeration, SLIDERS.expressiveness);
    if (Number.isFinite(knobs.temperature)) out.steadiness = fit((knobs.temperature - KING_COUNTY.temperature) / STEP.temperature, SLIDERS.steadiness);
    if (Number.isFinite(knobs.cfg_weight)) out.pace = fit((knobs.cfg_weight - KING_COUNTY.cfg_weight - out.steadiness * STEP.steadyCfg) / STEP.paceCfg, SLIDERS.pace);
    return out;
}

/** True when a delivery is her King County one. */
export const isDefault = delivery => Object.keys(DELIVERY_DEFAULT).every(name => delivery[name] === DELIVERY_DEFAULT[name]);

/** The moment's change as one sum: { expressiveness, steadiness, pace }. moment is { feeling?: 'feeling'|'calmer', pace?: 'faster'|'slower' }. */
export function momentChange(moment = {}) {
    const sum = { expressiveness: 0, steadiness: 0, pace: 0 };
    for (const id of Object.values(moment || {})) {
        const change = MOMENTS[id]?.change || {};
        for (const [name, value] of Object.entries(change)) sum[name] += value;
    }
    return sum;
}

/**
 * Chatterbox's knobs for a delivery, with a moment and a line's lift on top: { exaggeration, cfg_weight, temperature }.
 * No speed value exists here or anywhere in RI.
 */
export function knobsFor(delivery = DELIVERY_DEFAULT, moment = {}, lift = 0) {
    const change = momentChange(moment);
    const steady = (delivery.steadiness || 0) + change.steadiness;
    const pace = (delivery.pace || 0) + change.pace;
    return {
        exaggeration: round(clamp((delivery.expressiveness ?? DELIVERY_DEFAULT.expressiveness) + change.expressiveness + lift, LIMITS.exaggeration)),
        cfg_weight: round(clamp(KING_COUNTY.cfg_weight + steady * STEP.steadyCfg + pace * STEP.paceCfg, LIMITS.cfg_weight)),
        temperature: round(clamp(KING_COUNTY.temperature + steady * STEP.temperature, LIMITS.temperature)),
    };
}

/** How the pauses after a line stretch or shrink with pace: 1 at King County, shorter when faster. */
export function pauseFactor(delivery = DELIVERY_DEFAULT, moment = {}) {
    return round(clamp(1 - ((delivery.pace || 0) + momentChange(moment).pace) * STEP.pause, LIMITS.pause));
}

const SHOUT = /\b(?:shout(?:s|ed|ing)?|yell(?:s|ed|ing)?|scream(?:s|ed|ing)?|roar(?:s|ed|ing)?|bellow(?:s|ed|ing)?|shriek(?:s|ed|ing)?|howl(?:s|ed|ing)?|bark(?:s|ed|ing)?|snap(?:s|ped|ping)?|exclaim(?:s|ed|ing)?|thunder(?:s|ed|ing)?|cried|cries|cry(?:ing)? out)\b/i;
/** Lift sizes: an exclamation, a second one or "?!", a word in capitals, and a shout verb in the narration around the quote. */
export const LIFT = Object.freeze({ exclaim: 0.1, more: 0.05, capitals: 0.05, shout: 0.1, most: 0.2 });

/**
 * How much a line's own punctuation and words lift its expressiveness, decided in code: { lift, why: [] }. said is the
 * line as written, around the narration beside its quote. Off unless she turns it on.
 */
export function liftFor(said, around = '') {
    const text = String(said || '');
    const why = [];
    let lift = 0;
    const marks = (text.match(/!/g) || []).length;
    if (marks) { lift += LIFT.exclaim; why.push('an exclamation'); }
    if (marks > 1 || /\?!|!\?/.test(text)) lift += LIFT.more;
    if (/\b\p{Lu}{3,}\b/u.test(text) && /\p{Ll}/u.test(text)) { lift += LIFT.capitals; why.push('a word in capitals'); }
    const verb = SHOUT.exec(String(around || ''));
    if (verb) { lift += LIFT.shout; why.push(`"${verb[0].toLowerCase()}" beside it`); }
    return { lift: round(Math.min(LIFT.most, lift)), why };
}

/**
 * A reading's lines with their delivery applied: knobs, pause and a note for the receipt. Each line carries
 * delivery (the speaker's own settings) from planReading; moment is this reply's change; lift turns the line lift on.
 */
export function applyDelivery(lines, { moment = {}, lift = false } = {}) {
    return lines.map(line => {
        const base = line.delivery || DELIVERY_DEFAULT;
        const nudge = lift ? liftFor(line.text, line.around) : { lift: 0, why: [] };
        const factor = pauseFactor(base, moment);
        return { ...line, knobs: knobsFor(base, moment, nudge.lift), pause: round((line.pause || 0) * factor), lift: nudge.lift, liftWhy: nudge.why };
    });
}

/** Words for the moment, for the sheet and the receipt: "More feeling and Faster", or ''. */
export const momentWords = (moment = {}) => Object.values(moment || {}).map(id => MOMENTS[id]?.label).filter(Boolean).join(' and ');

/** Turn one moment change on or off for a reply; one of each pair can be on. Returns the new moment. */
export function toggleMoment(moment = {}, id) {
    const spec = MOMENTS[id];
    if (!spec) return { ...moment };
    const next = { ...moment };
    if (next[spec.pair] === id) delete next[spec.pair];
    else next[spec.pair] = id;
    return next;
}

// This reply's change lives in memory only, under the chat, reply and swipe, so it never reaches a character's sheet and
// no other reply hears it.
const moments = new Map();
export const momentFor = key => ({ ...(moments.get(key) || {}) });
export function setMoment(key, moment) {
    if (moment && Object.keys(moment).length) moments.set(key, { ...moment });
    else moments.delete(key);
}
/** Forget the moment changes of one reply (its key starts with chat|mesId|), or of every reply. */
export function dropMoments(prefix) {
    for (const key of [...moments.keys()]) if (prefix === undefined || key.startsWith(prefix)) moments.delete(key);
}

// Presets: named deliveries she saves and reuses ("Hale, angry"). Kept beside the voices in the extension's settings.

/** The saved presets, sorted by name: [{ name, expressiveness, steadiness, pace }]. */
export function listPresets(config) {
    const list = Array.isArray(config?.presets) ? config.presets : [];
    return list.filter(item => item && String(item.name || '').trim()).map(item => ({ name: String(item.name).trim(), ...deliveryOf({ delivery: item }) }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/** Save a delivery under a name, replacing a preset with the same name. Returns the problem, or ''. */
export function savePreset(config, name, delivery) {
    const clean = String(name || '').replace(/\s+/g, ' ').trim();
    if (!clean) return 'Name the preset first, for example "Hale, angry".';
    if (clean.length > 60) return 'Keep the preset name under 60 characters.';
    const kept = (Array.isArray(config.presets) ? config.presets : []).filter(item => String(item?.name || '').trim().toLowerCase() !== clean.toLowerCase());
    config.presets = [...kept, { name: clean, ...deliveryOf({ delivery }) }];
    return '';
}

export function removePreset(config, name) {
    config.presets = (Array.isArray(config.presets) ? config.presets : []).filter(item => String(item?.name || '').trim() !== name);
}

/** A delivery in words for a card or a preset: "expressiveness 0.80, steadier, King County pace". */
export function deliveryWords(delivery) {
    const steady = delivery.steadiness ? SLIDERS.steadiness.words(delivery.steadiness).toLowerCase() : 'King County steadiness';
    const pace = delivery.pace ? SLIDERS.pace.words(delivery.pace).toLowerCase() : 'King County pace';
    return `expressiveness ${delivery.expressiveness.toFixed(2)}, ${steady}, ${pace}`;
}
