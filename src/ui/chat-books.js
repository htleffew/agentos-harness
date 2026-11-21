import { bookEntryEditor } from './book-entry-editor.js';
import { h, button, section, download } from './dom.js';
import { chatBooks, openHostBook, hideBookCard, removeChatBook, showBookInChat } from '../chat-books.js';
import { loadBook, toast, confirmBox } from '../st.js';
import { memoryComponents } from '../components.js';
import { chatWorld } from '../world.js';
import { ensureWorld, reusableAssignments } from '../v10.js';

export function renderChatBooks(app, { assignedEditors = false } = {}) {
    const catalog = chatBooks();
    const books = catalog.filter(book=>app.showHiddenBooks || !book.hidden);
    const world = chatWorld();
    const reusable = new Set(reusableAssignments().map(book => book.name));
    const change = async (book, everywhere) => {
        try {
            if (everywhere && !await confirmBox(`Delete “${book.name}” everywhere? This permanently removes the book and all its entries for every chat that uses it. Export it first if you want a copy.`)) return;
            await removeChatBook(book.name,{everywhere});
            app.render();
        } catch (error) { toast('error',error.message); }
    };
    const inventory = section('World Info books for this chat',
        h('p',{class:'ri-help'},'Remove from this chat keeps the book available elsewhere. Hide from list clears a historical card from this view. Delete book everywhere removes the shared book from World Info.'),
        catalog.some(book=>book.hidden) && button(app.showHiddenBooks ? 'Hide books again' : 'Show hidden books',()=>{
            app.showHiddenBooks=!app.showHiddenBooks;app.render();
        },{kind:'ghost'}),
        books.length ? h('ul',{class:'ri-chat-books ri-book-catalog'},books.map(book=>h('li',{class:'ri-card ri-tight','data-book-name':assignedEditors && reusable.has(book.name) ? null : book.name},
            h('strong',{},book.name),
            h('p',{class:'ri-help'},book.roles.join(' · ')),
            h('div',{class:'ri-row'},
                book.active && button('Remove from this chat',()=>change(book,false),{kind:'ghost'}),
                book.excluded && book.exists && button('Allow host recall again',()=>{showBookInChat(book.name);app.render();},{kind:'ghost'}),
                (!book.active || book.hidden) && button(book.hidden ? 'Show in list' : 'Hide from list',()=>{
                    hideBookCard(book.name,!book.hidden);app.render();
                },{kind:'ghost'}),
                book.exists && button('Delete book everywhere',()=>change(book,true),{kind:'danger'})),
            book.exists ? h('div',{class:'ri-row'},
                button('Open in World Info',async()=>{
                    if (app.root.classList.contains('ri-expanded') && !await app.setExpanded(false)) return;
                    if (!openHostBook(book.name)) toast('info',`Select “${book.name}” in the host World Info editor.`);
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
                    : bookEntryEditor(book.name,{reusable:reusable.has(book.name)})) : h('p',{class:'ri-note'},'Referenced by this chat. The host no longer lists this book.'))))
            : h('p',{class:'ri-help'},'No books are currently associated with this chat. Host-selected books are shown when the host exposes them.'),
        !world && (memoryComponents().world || memoryComponents().chapters) ? button('Create this chat’s Story World',async()=>{
            try {await ensureWorld(); app.render();} catch(error) {toast('error',error.message);}
        },{kind:'primary'}) : null);
    inventory.id = 'ri-chat-book-inventory';
    inventory.tabIndex = -1;
    return inventory;
}
