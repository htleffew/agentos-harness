// SillyTavern's phone layout on every touch screen, however wide (B45; DECISIONS.md, 2026-11-25).
//
// SillyTavern switches to its phone layout below a width breakpoint (`max-width: 1000px` in css/mobile-styles.css and
// a few blocks of style.css), so the unfolded Fold at 1040 CSS px gets the desktop layout: a half-width chat column,
// side strips and drawers squeezed into it. Its drawer scripts carry no width test (isMobile() reads the user agent),
// so the layout is all CSS. This module edits the media lists of SillyTavern's own rules at runtime rather than
// copying them: every phone rule also matches `(pointer: coarse)`, and every desktop-only rule just above the
// breakpoint stops matching on a touch screen. The rules stay SillyTavern's, so the layout follows its updates, and
// the browser re-evaluates the media lists itself when the screen folds, unfolds or rotates. Mouse screens are
// untouched because `(pointer: coarse)` never matches there. The switch on the Look page turns it off (on by default).
import { saveSettings, settings } from '../store.js';
import { h } from './dom.js';

const TOUCH = '(pointer: coarse)';
const NOT_TOUCH = '(not (pointer: coarse))';
const FALLBACK_BREAKPOINT = 1000;
const LOG = '[Roleplay Instructions] touch layout:';

/** Rules this module rewrote, with their original media text, so the switch can put them back. */
const changed = new Map();
let watching = false;
let queued = 0;

/** On unless she turned it off. */
export const touchLayoutOn = () => settings().phoneLayoutOnTouch !== false;

/** True when the phone layout is forced right now: the switch is on and the main pointer is a finger. */
export const touchLayoutActive = () => touchLayoutOn() && !!globalThis.matchMedia?.(TOUCH).matches;

/**
 * The media text a rule should carry on a touch screen, or null when the rule is not tied to the phone breakpoint.
 * A phone medium keeps its width test and gains a copy with the width test swapped for the touch test; a desktop
 * medium just above the breakpoint gains "and not touch". Pure, so node tests can read it.
 * @param {string} mediaText
 * @param {number} breakpoint SillyTavern's phone breakpoint in px (1000 in 1.19)
 */
export function touchMedia(mediaText, breakpoint = FALLBACK_BREAKPOINT) {
    const low = Number(breakpoint), high = low + 1;
    const phone = new RegExp(`\\(\\s*(?:max-width\\s*:\\s*${low}px|width\\s*<=\\s*${low}px|width\\s*<\\s*${high}px)\\s*\\)`, 'i');
    const desktop = new RegExp(`\\(\\s*(?:min-width\\s*:\\s*${high}px|width\\s*>=\\s*${high}px|width\\s*>\\s*${low}px)\\s*\\)`, 'i');
    let hit = false;
    const out = [];
    for (const medium of String(mediaText || '').split(',').map(part => part.trim()).filter(Boolean)) {
        if (phone.test(medium) && !/^not\s/i.test(medium)) {
            hit = true;
            out.push(medium, medium.replace(phone, TOUCH));
        } else if (desktop.test(medium) && !/^not\s/i.test(medium)) {
            hit = true;
            out.push(`${medium} and ${NOT_TOUCH}`);
        } else out.push(medium);
    }
    return hit ? out.join(', ') : null;
}

function rulesOf(sheet) {
    try { return sheet?.cssRules || []; } catch { return []; } // a cross-origin sheet cannot be read
}

/** Every rule with a media list, nested rules and imported sheets included. */
function* mediaRules(rules) {
    for (const rule of rules) {
        if (rule.media && rule.cssRules) yield rule;
        if (rule.cssRules) yield* mediaRules(rule.cssRules);
        if (rule.styleSheet) yield* mediaRules(rulesOf(rule.styleSheet));
    }
}

/** SillyTavern's phone breakpoint, read from its own phone stylesheet so a change there carries over. */
export function phoneBreakpoint(doc = globalThis.document) {
    for (const sheet of doc?.styleSheets || []) {
        if (!/\/css\/mobile-styles\.css(?:[?#]|$)/.test(sheet.href || '')) continue;
        for (const rule of mediaRules(rulesOf(sheet))) {
            const found = rule.media.mediaText.match(/max-width\s*:\s*(\d+)px/i);
            if (found) return Number(found[1]);
        }
    }
    return FALLBACK_BREAKPOINT;
}

/**
 * Rewrite (on) or restore (off) the media lists of every readable sheet. Rules already rewritten are left alone, so
 * running it again after a stylesheet arrives only touches the new rules. Returns how many rules changed.
 */
export function applyTouchLayout(on = touchLayoutOn(), doc = globalThis.document) {
    if (!doc) return 0;
    let count = 0;
    if (on) {
        const breakpoint = phoneBreakpoint(doc);
        for (const sheet of doc.styleSheets) for (const rule of mediaRules(rulesOf(sheet))) {
            if (changed.has(rule)) continue;
            const before = rule.media.mediaText;
            const next = touchMedia(before, breakpoint);
            if (!next) continue;
            rule.media.mediaText = next;
            // A browser that cannot parse a medium turns it into "not all"; put that rule back as it was.
            if (/\bnot all\b/.test(rule.media.mediaText) && !/\bnot all\b/.test(before)) {
                rule.media.mediaText = before;
                console.warn(LOG, 'this browser could not read', next);
                continue;
            }
            changed.set(rule, before);
            count++;
        }
    } else {
        for (const [rule, before] of changed) { rule.media.mediaText = before; count++; }
        changed.clear();
    }
    doc.documentElement.dataset.riTouchLayout = on ? 'on' : 'off';
    // SillyTavern and the extension measure on resize (the fold handle, the bar's pins); a switch flip is not one.
    if (count) globalThis.dispatchEvent?.(new Event('resize'));
    return count;
}

/** Turn the phone layout on touch screens on or off, and keep the choice. */
export function setTouchLayout(on) {
    settings().phoneLayoutOnTouch = !!on;
    saveSettings();
    return applyTouchLayout(!!on);
}

/** Stylesheets added later (another extension, a theme's custom CSS) get the same treatment once they load. */
function watchSheets(doc) {
    if (watching || !doc?.head) return;
    watching = true;
    const later = () => {
        cancelAnimationFrame(queued);
        queued = requestAnimationFrame(() => { if (touchLayoutOn()) applyTouchLayout(true, doc); });
    };
    new MutationObserver(later).observe(doc.head, { childList: true, subtree: true, characterData: true });
    doc.addEventListener('load', event => { if (event.target?.tagName === 'LINK') later(); }, true);
}

export function startTouchLayout(doc = globalThis.document) {
    applyTouchLayout(touchLayoutOn(), doc);
    watchSheets(doc);
}

/** The switch's row on the Look page. */
export function touchLayoutRow(rerender) {
    const on = touchLayoutOn();
    const choice = (value, label) => h('button', { type: 'button', class: 'ri-bar-btn', 'aria-pressed': String(on === value),
        onclick: () => { setTouchLayout(value); rerender?.(); } }, label);
    return h('fieldset', { id: 'ri-touch-layout' }, h('legend', {}, 'Phone layout on touch screens'),
        h('div', { class: 'ri-look-choices', role: 'group', 'aria-label': 'Phone layout on touch screens' }, choice(true, 'On'), choice(false, 'Off')),
        h('p', { class: 'ri-help' }, on
            ? 'On any touch screen, however wide, SillyTavern uses its phone layout, so every drawer and the character panel open full width. Mouse screens keep SillyTavern\'s own layout.'
            : 'Off: SillyTavern picks its layout by width alone, so wider than 1000 px it uses the desktop layout with narrow side panels.'));
}

try { startTouchLayout(); } catch (error) { console.warn(LOG, 'did not start', error); }
