// The device database (memory DESIGN 2.1): only what can be rebuilt from chat data. Each item is keyed by a hash of
// the text it was made from, so a branch reuses its parent's items and clearing the database costs a rebuild and
// nothing else. Today it holds the word index of each record; MB4 adds vectors under the same rule. The fold is cached in
// memory under a key of every message's text hash and the log's length (fold.js). The job queue keeps its own tables
// (queue.js).
import { canonical, hashText } from './fold.js';

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

// ---------------------------------------------------------------- word index

const STOP = new Set('the a an and or of to in on at is are was were be been do did has have had his her its their they he she it we you i my me our that this with for from by as so not no but if into out up over than then there'.split(' '));
/** The words a record is found by: its subject, aliases and text, lower case, short words and stop words left out. */
export function wordsOf(record) {
    const text = [record?.subject, ...(record?.aliases || []), record?.text, record?.view?.name].filter(Boolean).join(' ');
    return [...new Set((String(text).toLowerCase().match(/[\p{L}\p{N}']+/gu) || []).filter(word => word.length > 2 && !STOP.has(word)))];
}

/** The content hash an index item is keyed by: the record's own searchable text. */
export const indexKey = record => `words:${hashText(canonical({ id: record?.id, words: wordsOf(record) }))}`;

/**
 * Make sure every current record has its word index item. Returns { built, reused }: items already present (from this
 * chat or a branch with the same records) are reused.
 */
export async function ensureIndexes(records, db = deviceDb()) {
    let built = 0, reused = 0;
    for (const record of records || []) {
        const key = indexKey(record);
        if (await db.get(key)) { reused += 1; continue; }
        await db.put(key, { id: record.id, words: wordsOf(record) });
        built += 1;
    }
    return { built, reused };
}

/** The ids of the current records whose index holds every word of the query, from the device database. */
export async function findRecords(records, query, db = deviceDb()) {
    const want = wordsOf({ text: query });
    const out = [];
    for (const record of records || []) {
        const item = await db.get(indexKey(record));
        const words = new Set(item?.words || []);
        if (want.length && want.every(word => words.has(word))) out.push(record.id);
    }
    return out;
}
