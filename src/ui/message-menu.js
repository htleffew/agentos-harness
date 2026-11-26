// B4 (DESIGN.md section 5): the two entries this extension adds to SillyTavern's own message menu, the row of
// small buttons that already holds Exclude, Branch, Checkpoint and Copy. They replace the card that used to sit
// under every reply. "What was sent" opens Review, Replies on that reply; "Correct a story fact" opens Story,
// Scene with that reply selected. B16 confirmed on the phone that the menu opens by touch and takes extension entries.
import { memoryOnly } from '../components.js';
import { ctx, isReply } from '../st.js';
import { settings } from '../store.js';

export const MENU_ENTRIES = Object.freeze([
    Object.freeze({ id: 'sent', label: 'What was sent', icon: 'fa-receipt', page: 'sent', anchor: id => `#ri-review-reply-${id}` }),
    Object.freeze({ id: 'correct', label: 'Correct a story fact', icon: 'fa-pen-to-square', page: 'corrections', anchor: () => '#ri-correction-target', needsFacts: true }),
    // memory DESIGN 12.2: two entries for a chat whose memory lives in chat data
    Object.freeze({ id: 'close-chapter', label: 'Close the chapter here', icon: 'fa-flag-checkered', needsChatMemory: true, run: closeChapterAt }),
    Object.freeze({ id: 'memory-reply', label: 'Memory from this reply', icon: 'fa-database', page: 'world', anchor: () => '#ri-world-records', needsChatMemory: true,
        prepare: (app, id) => { app.worldFilter = { filter: 'all', query: '', reply: id }; } }),
]);

/** Close the chapter at this reply: one Writer call, as Write a chapter now makes. */
async function closeChapterAt(id) {
    const { closeChapterHere } = await import('../chapters.js');
    const { toast } = await import('../st.js');
    try {
        toast('info', 'Writing the chapter...');
        const title = await closeChapterHere(id);
        toast('success', title ? `Saved "${title}".` : 'The chapter was written.');
    } catch (error) { toast('error', error.message); }
}

/**
 * The entries a message gets: every AI reply while the extension is on; corrections wait for a story world chat; the
 * chapter and memory entries need a chat whose memory lives in chat data.
 */
export function entriesFor(message, { enabled = true, memory = false, chatMemory = false } = {}) {
    if (!enabled || !isReply(message) || message.is_system) return [];
    return MENU_ENTRIES.filter(entry => !(entry.needsFacts && memory) && !(entry.needsChatMemory && !chatMemory));
}

function entryNode(entry) {
    const node = document.createElement('div');
    node.className = `mes_button ri-mes-button fa-solid ${entry.icon}`;
    node.dataset.riEntry = entry.id;
    node.title = entry.label;
    node.setAttribute('role', 'button');
    node.setAttribute('tabindex', '0');
    node.setAttribute('aria-label', entry.label);
    return node;
}

async function open(control) {
    const entry = MENU_ENTRIES.find(item => item.id === control.dataset.riEntry);
    const id = Number(control.closest('.mes')?.getAttribute('mesid'));
    if (!entry || !Number.isInteger(id)) return;
    if (entry.run) return entry.run(id);
    const { app } = await import('./panel.js');
    entry.prepare?.(app, id);
    await app.openReplyTask(entry.page, id, control, entry.anchor(id));
}

let listening = false;
function listen(doc = document) {
    if (listening) return;
    listening = true;
    doc.addEventListener('click', event => {
        const control = event.target.closest?.('.ri-mes-button');
        if (!control) return;
        event.preventDefault();
        event.stopPropagation();
        open(control).catch(error => console.warn('[Roleplay Instructions] message menu', error));
    }, true);
    doc.addEventListener('keydown', event => {
        const control = event.target.closest?.('.ri-mes-button');
        if (!control || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        open(control).catch(error => console.warn('[Roleplay Instructions] message menu', error));
    }, true);
}

/** Bring every rendered message's menu in line with `entriesFor`; a menu that is already right is left alone. */
export function refreshMessageMenu() {
    listen();
    const chat = ctx().chat || [];
    const state = { enabled: settings().enabled, memory: memoryOnly(), chatMemory: !!ctx().chatMetadata?.ri_memory?.imported };
    for (const node of document.querySelectorAll('#chat .mes[mesid]')) {
        const holder = node.querySelector('.extraMesButtons');
        if (!holder) continue;
        const want = entriesFor(chat[Number(node.getAttribute('mesid'))], state);
        const have = [...holder.querySelectorAll(':scope > .ri-mes-button')];
        if (have.map(item => item.dataset.riEntry).join() === want.map(entry => entry.id).join()) continue;
        for (const item of have) item.remove();
        holder.append(...want.map(entryNode));
    }
}
