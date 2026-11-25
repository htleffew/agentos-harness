// The parity cards (B20, DESIGN 6.2 and 6.3): every card, tracker and section of Vexa, Neon Sola, Deus Ex Machina and
// Pura's Director that the core cards (reply-cards.js) leave out, one module per card, drawn through the shared templates
// so each takes the chat's story style. New cards (Map, Holding back, Inventory, New faces, Reputation, Achievements,
// Choices, Notebook) register their own renderer; cards the core already draws (Knowledge and secrets, Plot, Director's
// desk, Roast, Emotions, Relationships, Characters) keep the core renderer and gain their parity sections after it.
// Scene's world detail is drawn by the core Scene renderer from the same saved value. The Sent card gains the receipt
// of the Choices card's Options call. B22's Roll and Stats cards register from their own modules.
import { ROUTES } from '../../routing.js';
import * as achievements from './achievements.js';
import * as characters from './characters.js';
import * as choices from './choices.js';
import * as directorsDesk from './directors-desk.js';
import * as emotions from './emotions.js';
import * as holdingBack from './holding-back.js';
import * as inventory from './inventory.js';
import * as knowledge from './knowledge.js';
import * as map from './map.js';
import * as newFaces from './new-faces.js';
import * as notebook from './notebook.js';
import * as plot from './plot.js';
import * as relationships from './relationships.js';
import * as reputation from './reputation.js';
import * as roast from './roast.js';
import { footerOf } from './shared.js';

/** Cards this ticket adds, each with its own renderer. */
export const NEW_CARDS = Object.freeze([map, holdingBack, inventory, newFaces, reputation, achievements, choices, notebook]);
/** Cards the core draws, each gaining its parity sections. */
export const EXTENDED_CARDS = Object.freeze([knowledge, plot, directorsDesk, roast, emotions, relationships, characters]);

const LOG = '[Roleplay Instructions]';
const flat = value => [value].flat(8).filter(Boolean);
const isFooter = node => /\bri-c-unrequested\b/.test(node?.className || '') && /^Not requested/.test(node?.textContent || '');

function guard(label, fn) {
    try { return fn(); } catch (error) { console.warn(LOG, `${label} card`, error); return null; }
}

/** Put parity sections into a panel the core card filled, ahead of its "Not requested" line. */
function placeInPanel(panel, nodes) {
    const list = flat(nodes);
    if (!list.length) return;
    // The core card's "nothing saved" note gives way once a parity section has something to show.
    for (const note of [...(panel.querySelectorAll?.('.ri-tray-help') || [])]) if (/^No saved records/.test(note.textContent)) note.remove();
    const footer = [...(panel.querySelectorAll?.('.ri-c-unrequested') || [])].find(isFooter);
    for (const node of list) if (footer) panel.insertBefore(node, footer); else panel.append(node);
}

/** The core renderer of a card followed by the module's parity sections. */
export function extendRenderer(coreRender, mod, tools) {
    return env => {
        const part = coreRender ? guard(mod.id, () => coreRender(env)) : null;
        const more = guard(mod.id, () => mod.extend(env, tools));
        if (!more) return part;
        if (!part) return { first: more.first, body: () => [...flat(more.nodes(null)), tools.footer(env)] };
        const first = part.first || more.first;
        if (typeof part.load === 'function') return { ...part, first, load: async panel => { await part.load(panel); placeInPanel(panel, more.nodes(panel)); } };
        const body = part.body;
        return { ...part, first, body: () => {
            const nodes = flat(typeof body === 'function' ? body() : body);
            const extra = flat(more.nodes(null));
            const at = nodes.findIndex(isFooter);
            return at < 0 ? [...nodes, ...extra] : [...nodes.slice(0, at), ...extra, ...nodes.slice(at)];
        } };
    };
}

/** The core Sent card with the Choices call's receipt; a reply whose only receipt is that call still gets the card. */
export function sentWithChoices(coreRender) {
    const routeLabel = route => ROUTES[route]?.label || route;
    return env => {
        const part = coreRender ? guard('sent', () => coreRender(env)) : null;
        const receipt = env.on('sent') ? choices.sentReceipt(env.view.rec, routeLabel) : null;
        if (!receipt) return part;
        const calls = [...(part?.calls || []), receipt.call];
        if (!part) return { first: `Choices, ${choices.CALL_WORDS}`, calls, body: () => receipt.nodes() };
        return { ...part, calls, body: () => [...flat(typeof part.body === 'function' ? part.body() : part.body), ...receipt.nodes()] };
    };
}

let styled = false;
function loadStyles(doc = globalThis.document) {
    if (styled || !doc?.head?.append) return;
    styled = true;
    if (doc.getElementById?.('ri-parity-cards')) return;
    const link = doc.createElement('link');
    link.id = 'ri-parity-cards';
    link.rel = 'stylesheet';
    link.href = new URL('./cards.css', import.meta.url).href;
    doc.head.append(link);
}

/**
 * Register the parity cards with the tray. `register` and `core` come from reply-cards.js (registerCardRenderer and
 * the renderer it holds for a card id); `config` reads the chat's card setting for the Choices call.
 */
export function installParityCards({ register, core, openSwitch, config }) {
    const tools = { openSwitch, footer: env => footerOf(env, openSwitch) };
    for (const mod of NEW_CARDS) register(mod.id, env => guard(mod.id, () => mod.render(env, tools)));
    for (const mod of EXTENDED_CARDS) register(mod.id, extendRenderer(core(mod.id), mod, tools));
    register('sent', sentWithChoices(core('sent')));
    loadStyles();
    choices.startChoices({ config });
}
