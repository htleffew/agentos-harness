// The device database (memory DESIGN 2.1): only what can be rebuilt from chat data. Each item is keyed by a hash of
// the text it was made from, so a branch reuses its parent's items and clearing the database costs a rebuild and
// nothing else. It holds the search vectors of MB4; the word index is MiniSearch, built in memory from the fold (src/memory/index.js). The fold is cached in
// memory under a key of every message's text hash and the log's length (fold.js). The job queue keeps its own tables
// (queue.js).

const NAME = 'roleplay_instructions_memory_items';
const TABLE = 'items';

/** A store held in memory, for tests and for hosts with no IndexedDB. */
export function memoryItems() {
    const items = new Map();
    return {
        async get(key) { return items.has(key) ? structuredClone(items.get(key)) : null; },
        async put(key, value) { items.set(key, structuredClone(value)); },
        async keys(prefix = '') { return [...items.keys()].filter(key => key.startsWith(prefix)); },
        async remove(key) { items.delete(key); },
        async clear() { items.clear(); },
        async count() { return items.size; },
    };
}

/** The store in IndexedDB, falling back to memory where IndexedDB is missing or refuses to open. */
export function deviceItems({ name = NAME, idb = globalThis.indexedDB } = {}) {
    if (!idb) return memoryItems();
    let opened = null;
    const db = () => opened ||= new Promise((resolve, reject) => {
        const request = idb.open(name, 1);
        request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(TABLE)) request.result.createObjectStore(TABLE); };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    const step = async (mode, act) => {
        const base = await db();
        return new Promise((resolve, reject) => {
            const tx = base.transaction(TABLE, mode);
            const request = act(tx.objectStore(TABLE));
            tx.oncomplete = () => resolve(request?.result);
            tx.onerror = () => reject(tx.error);
        });
    };
    return {
        get: key => step('readonly', table => table.get(key)).then(value => value ?? null),
        put: (key, value) => step('readwrite', table => table.put(structuredClone(value), key)),
        keys: prefix => step('readonly', table => table.getAllKeys()).then(list => (list || []).map(String).filter(key => key.startsWith(prefix || ''))),
        remove: key => step('readwrite', table => table.delete(key)),
        clear: () => step('readwrite', table => table.clear()),
        count: () => step('readonly', table => table.count()),
    };
}

let shared = null;
export const deviceDb = () => shared ||= deviceItems();
