import { setInfo } from './books.js';
import { chatState, settings } from './store.js';
import { ctx, KEY, worldNames } from './st.js';
import { chatWorld } from './world.js';
import { memoryComponents, memoryOnly } from './components.js';
import { enabledV10, reusableAssignments, reusableBookRoles } from './v10.js';

let observed;
const hostSources = {
    globalLore:'Host global selection', chatLore:'Host chat attachment',
    characterLore:'Host character attachment', personaLore:'Host persona attachment',
};

export function observeHostBooks(lore) {
    observed = {
        chat:ctx().getCurrentChatId?.(),
        entries:Object.entries(hostSources).flatMap(([key,role])=>
            [...new Set(Array.isArray(lore[key]) ? lore[key].map(entry=>entry?.world).filter(Boolean) : [])]
                .map(name=>({name,role}))),
    };
}

export function chatBooks() {
    const c = ctx(), local = chatState();
    if (!local) return [];
    const available = new Set(worldNames());
    const books = new Map();
    const add = (name,role) => {
        if (typeof name!=='string' || !name) return;
        if (!books.has(name)) books.set(name,{name,exists:available.has(name),roles:new Set()});
        books.get(name).roles.add(role);
    };
    const components = memoryComponents();
    const world = chatWorld();
    if (world) {
        const info = setInfo(world);
        add(info.book,info.shared ? `Story World · ${info.name}` : 'Story World');
        if (components.chapters) add(info.book,'Chapter summaries');
        if (components.world) add(info.book,memoryOnly() ? 'Chat facts and setting' : 'Chat facts and plot records');
    }
    for (const id of new Set([local.worldFrom,local.branchPendingWorld,...(local.previousStoryWorlds || [])])) {
        if (id && id!==world) add(setInfo(id).book,'Earlier or source Story World');
    }
    if (local.v10?.base) add(local.v10.base.name,components.world && (enabledV10() || memoryOnly()) ? 'Pinned Base World' : 'Pinned Base World · paused');
    const assignments = reusableAssignments(local.v10);
    for (const book of assignments) {
        const active = book.on !== false && (book.role === 'guidelines'
            ? enabledV10() : components.world && (enabledV10() || memoryOnly()));
        add(book.name, reusableBookRoles[book.role] + (active ? '' : ' · paused'));
    }
    for (const name of local.reusableBookHistory || []) {
        if (name !== local.v10?.base?.name && !assignments.some(book => book.name === name)) add(name, 'Previously assigned reusable book');
    }
    const labels = {instructions:'Random Instructions',events:'Random Story Events',style:'Random Writing Style',world:'Story World'};
    for (const id of local.activeSets) {
        if (!Object.hasOwn(settings().sets,id)) continue;
        const {book,kind,group} = setInfo(id);
        if (kind==='world') continue;
        add(book,[labels[kind],group,memoryOnly() || !settings().enabled ? 'paused' : 'enabled for this chat'].filter(Boolean).join(' · '));
    }
    add(c.chatMetadata?.world_info,'Host chat attachment');
    add(c.characters?.[c.characterId]?.data?.extensions?.world,'Host character attachment');
    add(c.powerUserSettings?.persona_description_lorebook,'Host persona attachment');
    if (typeof document!=='undefined') for (const option of document.querySelectorAll('#world_info option:checked')) {
        const name = option.textContent.trim();
        if (available.has(name)) add(name,'Host global selection');
    }
    if (observed?.chat===c.getCurrentChatId?.()) for (const {name,role} of observed.entries) {
        if (available.has(name)) add(name,`${role} · last scan`);
    }
    for (const message of c.chat || []) {
        const rec = message.extra?.[KEY];
        for (const entry of rec?.v10Lore || []) if (available.has(entry.book)) add(entry.book,'Appears in reply receipts');
        const storedWorld = rec?.update?.world;
        if (storedWorld && storedWorld!==world && Object.hasOwn(settings().sets,storedWorld)) {
            add(setInfo(storedWorld).book,'Stores earlier reply changes');
        }
        for (const item of rec?.items || []) {
            const key = String(item.key || '');
            const name = key.slice(0,key.lastIndexOf('.'));
            if (available.has(name) && !books.has(name)) add(name,'Used on an earlier reply');
        }
    }
    return [...books.values()].map(book=>({...book,roles:[...book.roles]}));
}

export function openHostBook(name) {
    const c = ctx();
    if (typeof c.openWorldInfoEditor==='function') { c.openWorldInfoEditor(name); return true; }
    const select = document.querySelector('#world_editor_select');
    const option = Array.from(select?.options || []).find(item=>item.textContent.trim()===name);
    if (!option) return false;
    const drawer = document.querySelector('#WorldInfo');
    if (drawer && !drawer.getClientRects().length) document.querySelector('#WIDrawerIcon')?.click();
    select.value = option.value;
    select.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
}
