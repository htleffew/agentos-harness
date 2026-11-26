// Stats (DESIGN 6.2 and 6.9): this chat's stat sheets for the Persona, the character and NPCs, the stats every roll uses.
// Each value can be edited here; an edited value is marked yours, and no later inference changes it.
import { h } from '../dom.js';
import { ctx, isChatOpen } from '../../st.js';
import { diceOn } from '../../dice.js';
import { orderedSheets, sheetEditor, sheetSummary, inferButton, redrawTrays } from '../stat-sheet.js';

export const id = 'stats';

/** The Stats card draws under the latest reply only: the last message that is neither hers nor a system line. */
function isLatestReply(index) {
    const chat = ctx().chat || [];
    for (let i = chat.length - 1; i >= 0; i--) if (chat[i] && !chat[i].is_user && !chat[i].is_system) return i === Number(index);
    return false;
}

export function render(env) {
    if (!env.on('sheets') || !isChatOpen() || !diceOn() || !isLatestReply(env.view?.id)) return null;
    const sheets = orderedSheets();
    return { first: sheets.slice(0, 2).map(([, sheet]) => sheetSummary(sheet)).join(' · '), count: sheets.length,
        body: () => [sheetEditor(redrawTrays), h('div', { class: 'ri-c-actions' }, inferButton(redrawTrays))] };
}
