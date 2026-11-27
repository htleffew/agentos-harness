import { bookEntryEditor } from './book-entry-editor.js';
import { h, button, section, download } from './dom.js';
import { chatBooks, openHostBook, hideBookCard, removeChatBook, showBookInChat } from '../chat-books.js';
import { loadBook, toast, confirmBox, inputBox, names } from '../st.js';
import { memoryComponents } from '../components.js';
import { chatWorld, filingStatus } from '../records.js';
import { setChatWorld } from '../world.js';
import { createSet, exportSet, setName, setInfo } from '../books.js';
import { ensureWorld, reusableAssignments } from '../v10.js';
import { deleteButton } from './sets.js';
import { home, homeLink } from './homes.js';

/**
 * The one Story World section: create, export and delete the book that holds this chat's records. The
 * Story World page and the book list below link here. The entries are edited on Story, Story World.
 */
export function storyWorldSection(app) {
    const id = chatWorld();
    const components = memoryComponents();
    const create = home('world-create', h('div', { class: 'ri-row', id: 'ri-world-create' },
        button(id ? 'Make a new Story World' : 'Create this chat’s Story World', async () => {
            try {
                if (!id) { await ensureWorld(); app.render(); return; }
                const name = await inputBox('Name for the new Story World:', `${names().char}'s story`);
                if (!name) return;
                const made = await createSet(name, 'world');
                setChatWorld(made);
                toast('success', `"${setName(made)}" was made and is now the Story World of this chat.`);
                app.render();
            } catch (error) { toast('error', error.message); }
        }, { kind: id ? '' : 'primary' })));
    const exporter = id && home('world-export', h('div', { class: 'ri-row', id: 'ri-world-export' },
        button('Export the Story World', async () => {
            const data = structuredClone(await exportSet(id));
            if (data?.extensions) delete data.extensions.riPendingWrites;
            if (!data || !download(`${setName(id)}.json`, JSON.stringify(data, null, 4))) toast('info', 'Export did not start here. You can also export the book from the World Info screen.');
        }, { kind: 'ghost', title: `Download the book, filed through reply ${filingStatus().filed}` })));
    const remover = id && (setInfo(id).shared ? deleteButton(app, id, 'Delete the Story World')
        : button('Delete the Story World', async () => {
            if (!await confirmBox(`Delete “${setName(id)}” everywhere? Every chat that uses it loses the book; export it first for a copy.`)) return;
            try { await removeChatBook(id, { everywhere:true }); app.render(); } catch (error) { toast('error', error.message); }
        }, { kind: 'danger' }));
    const deleting = remover && home('world-delete', h('div', { class: 'ri-row', id: 'ri-world-delete' }, remover));
    return section('Story World',
        h('p', { class: 'ri-help' }, id ? `This chat’s Story World is “${setName(id)}”. Export holds filed facts through reply ${filingStatus().filed}; SillyTavern’s chat export keeps recent edits with their replies.`
            : components.world || components.chapters ? 'This chat has no Story World yet.' : 'Story World is off for this chat. Turn it on in Setup, Memory.'),
        create, exporter || null, deleting || null,
        id && homeLink(app, 'world-entries', 'Entries are edited in Story, Story World.'));
}

export function renderChatBooks(app, { assignedEditors = false } = {}) {
    const catalog = chatBooks();
    const books = catalog.filter(book=>app.showHiddenBooks || !book.hidden);
    const reusable = new Set(reusableAssignments().map(book => book.name));
    const world = chatWorld(), info = world ? setInfo(world) : null;
    const storyBook = book => !!info && !info.shared && book.name === info.book;
    const change = async (book, everywhere) => {
        try {
            if (everywhere && !await confirmBox(`Delete “${book.name}” everywhere? Every chat that uses it loses the book; export it first for a copy.`)) return;
            await removeChatBook(book.name,{everywhere});
            app.render();
        } catch (error) { toast('error',error.message); }
    };
    const inventory = section('World Info books for this chat',
        h('p',{class:'ri-help'},'Remove from this chat keeps the book for other chats. Hide from list clears a historical card; Delete book everywhere removes it from World Info.'),
        catalog.some(book=>book.hidden) && button(app.showHiddenBooks ? 'Hide books again' : 'Show hidden books',()=>{
            app.showHiddenBooks=!app.showHiddenBooks;app.render();
        },{kind:'ghost'}),
        books.length ? h('ul',{class:'ri-chat-books ri-book-catalog'},books.map(book=>h('li',{class:'ri-card ri-tight','data-book-name':assignedEditors && reusable.has(book.name) ? null : book.name},
            h('strong',{},book.name),
            h('p',{class:'ri-help'},book.roles.map(role => role.replace(/^Host /, 'SillyTavern ')).join(' · ')),
            h('div',{class:'ri-row'},
                book.active && button('Remove from this chat',()=>change(book,false),{kind:'ghost'}),
                book.excluded && book.exists && button('Allow World Info recall again',()=>{showBookInChat(book.name);app.render();},{kind:'ghost'}),
                (!book.active || book.hidden) && button(book.hidden ? 'Show in list' : 'Hide from list',()=>{
                    hideBookCard(book.name,!book.hidden);app.render();
                },{kind:'ghost'}),
                book.exists && !storyBook(book) && button('Delete book everywhere',()=>change(book,true),{kind:'danger'})),
            storyBook(book) ? h('p',{class:'ri-help'},'This is the Story World. Export and delete it in the Story World section above, and edit its entries in Story, Story World.')
            : book.exists ? h('div',{class:'ri-row'},
                button('Open in World Info',async()=>{
                    if (app.root.classList.contains('ri-expanded') && !await app.setExpanded(false)) return;
                    if (!openHostBook(book.name)) toast('info',`Select “${book.name}” in the World Info editor.`);
                },{kind:'ghost'}),
                button('Export JSON',async()=>{
                    try {
                        const data = await loadBook(book.name);
                        if (!data || !download(`${book.name}.json`,JSON.stringify(data,null,2))) throw new Error('The export did not start.');
                    } catch(error) {toast('error',error.message);}
                },{kind:'ghost'}),
                assignedEditors && reusable.has(book.name)
                    ? button('Manage entries above', () => {
                        const card = [...app.root.querySelectorAll('.ri-assigned-book')].find(row => row.dataset.bookName === book.name);
                        const editor = card?.querySelector('.ri-book-entry-editor');
                        if (editor) { editor.open = true; editor.scrollIntoView({block:'start'}); editor.querySelector('summary')?.focus({preventScroll:true}); }
                    }, {kind:'ghost'})
                    : bookEntryEditor(book.name,{reusable:reusable.has(book.name)})) : h('p',{class:'ri-note'},'Referenced by this chat. SillyTavern no longer lists this book.'))))
            : h('p',{class:'ri-help'},'No books are currently associated with this chat. Books selected in SillyTavern are shown when SillyTavern exposes them.'),
        null);
    inventory.id = 'ri-chat-book-inventory';
    inventory.tabIndex = -1;
    return inventory;
}
