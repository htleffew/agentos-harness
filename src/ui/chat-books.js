import { bookEntryEditor } from './book-entry-editor.js';
import { h, button, section, download } from './dom.js';
import { chatBooks, openHostBook } from '../chat-books.js';
import { loadBook, toast } from '../st.js';
import { memoryComponents } from '../components.js';
import { chatWorld } from '../world.js';
import { ensureWorld, reusableAssignments } from '../v10.js';

export function renderChatBooks(app) {
    const books = chatBooks();
    const world = chatWorld();
    const reusable = new Set(reusableAssignments().map(book => book.name));
    return section('World Info books for this chat',
        h('p',{class:'ri-help'},'See which physical books this chat uses, what each stores, and which books came from earlier chapters or replies. Edits to a shared book apply in each chat using it. What Was Sent shows the entries selected for a particular reply.'),
        books.length ? h('ul',{class:'ri-chat-books'},books.map(book=>h('li',{class:'ri-card ri-tight','data-book-name':book.name},
            h('strong',{},book.name),
            h('p',{class:'ri-help'},book.roles.join(' · ')),
            book.exists ? h('div',{class:'ri-row'},
                button('Open in World Info',()=>{
                    if (!openHostBook(book.name)) toast('info',`Select “${book.name}” in the host World Info editor.`);
                },{kind:'ghost'}),
                button('Export JSON',async()=>{
                    try {
                        const data = await loadBook(book.name);
                        if (!data || !download(`${book.name}.json`,JSON.stringify(data,null,2))) throw new Error('The export did not start.');
                    } catch(error) {toast('error',error.message);}
                },{kind:'ghost'}),bookEntryEditor(book.name,{reusable:reusable.has(book.name)})) : h('p',{class:'ri-note'},'Referenced by this chat. The host no longer lists this book.'))))
            : h('p',{class:'ri-help'},'No books are currently associated with this chat. Host-selected books are shown when the host exposes them.'),
        !world && (memoryComponents().world || memoryComponents().chapters) ? button('Create this chat’s Story World',async()=>{
            try {await ensureWorld(); app.render();} catch(error) {toast('error',error.message);}
        },{kind:'primary'}) : null);
}
