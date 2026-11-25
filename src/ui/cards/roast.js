// Roast panel (DESIGN 6.2, from Deus Companions): up to three commentators, each in their own voice, beside the one
// roast voice the reply carries (reply-cards.js). Capture writes one line per commentator: "Name: their comment".
import { quoteBlock } from '../card-templates.js';
import { headed, itemsOf, pick, section, trackerOf } from './shared.js';

export const id = 'roast';
export const PANEL_SIZE = 3;

/** The panel as { by, text }, at most three. */
export function readPanel(raw) {
    return itemsOf(raw).map(item => {
        if (typeof item === 'object') return { by: pick(item, 'name', 'by', 'who'), text: pick(item, 'text', 'comment', 'line') };
        const [by, text] = headed(item);
        return { by, text };
    }).filter(item => item.text).slice(0, PANEL_SIZE);
}

export function extend(env) {
    if (!env.on('panel')) return null;
    const panel = readPanel(trackerOf(env.view.rec, 'roast')?.panel);
    if (!panel.length) return null;
    return { first: `${panel[0].by ? `${panel[0].by}: ` : ''}${panel[0].text}`, nodes: () => [
        section('Panel', panel.map(item => quoteBlock(item.text, { by: item.by })), { iconName: 'fa-users', count: panel.length, id: 'panel' })] };
}
