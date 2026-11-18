// Current character state is replayed from the active messages and swipes. This makes
// deletion, branching and swiping follow the chat rather than a separate global cache.
import { ctx, KEY } from './st.js';

export const STATE_FIELDS = [
    ['mind', 'Mind'], ['heart', 'Heart'], ['body', 'Body'], ['psyche', 'Psyche'],
];
const norm = s => String(s || '').trim().toLocaleLowerCase();
const clone = v => JSON.parse(JSON.stringify(v));

export function stateAt(before = Infinity) {
    const chat = ctx().chat || [];
    const state = {};
    for (const m of chat.slice(0, before)) {
        const rec = m?.extra?.[KEY];
        if (!rec || m.is_user) continue;
        for (const p of rec.stateChanges || []) {
            const key = norm(p.name);
            if (!key) continue;
            const item = state[key] || (state[key] = { name: p.name, fields: {}, protected: {} });
            item.name = p.name;
            for (const [field, value] of Object.entries(p.fields || {})) {
                if (!STATE_FIELDS.some(([k]) => k === field) || item.protected[field]) continue;
                if (value === null) delete item.fields[field]; else item.fields[field] = value;
            }
        }
        for (const edit of rec.stateEdits || []) {
            const key = norm(edit.name);
            if (!key || !STATE_FIELDS.some(([k]) => k === edit.field)) continue;
            const item = state[key] || (state[key] = { name: edit.name, fields: {}, protected: {} });
            if (edit.value) item.fields[edit.field] = edit.value; else delete item.fields[edit.field];
            if (edit.protected) item.protected[edit.field] = true; else delete item.protected[edit.field];
        }
    }
    return state;
}

export function currentState(type = 'normal') {
    const chat = ctx().chat || [];
    const exclude = type === 'swipe' && chat.length && !chat[chat.length - 1]?.is_user;
    return stateAt(exclude ? chat.length - 1 : Infinity);
}

export function statePrompt(type = 'normal', limit = 1400) {
    const chat = ctx().chat || [];
    const end = type === 'swipe' && chat.length && !chat[chat.length - 1]?.is_user ? chat.length - 1 : chat.length;
    const state = stateAt(end);
    let present = '', environment = '';
    for (let i = end - 1; i >= 0; i--) {
        if (chat[i]?.extra?.[KEY]?.scene?.present) { present = chat[i].extra[KEY].scene.present; environment = chat[i].extra[KEY].scene.environment || ''; break; }
    }
    const selected = Object.values(state).filter(p => !present || present.toLocaleLowerCase().includes(p.name.toLocaleLowerCase()));
    const rows = [];
    let used = 0;
    for (const p of selected) {
        const fields = STATE_FIELDS.filter(([k]) => p.fields[k]).map(([k, label]) => `${label}: ${p.fields[k]}`);
        if (!fields.length) continue;
        const line = `${p.name}: ${fields.join(' | ')}`;
        if (used + line.length > limit) continue;
        rows.push(line); used += line.length;
    }
    if (environment) rows.unshift(`Scene conditions: ${environment}`);
    return rows.length ? `[Current character state. Maintain continuity, but allow change when events justify it. Private states are for the narrator; other characters know only what they have observed or been told.\n${rows.join('\n')}]` : '';
}

export function changesFromProfiles(profiles) {
    return (profiles || []).map(p => ({ name: p.name, fields: Object.fromEntries(STATE_FIELDS.filter(([k]) => Object.hasOwn(p.now || {}, k)).map(([k]) => [k, p.now[k]])) })).filter(p => Object.keys(p.fields).length);
}

export function editState(id, name, field, value, locked = true) {
    const m = ctx().chat?.[id];
    const rec = m?.extra?.[KEY];
    if (!rec || !STATE_FIELDS.some(([k]) => k === field)) return false;
    rec.stateEdits ||= [];
    rec.stateEdits = rec.stateEdits.filter(e => norm(e.name) !== norm(name) || e.field !== field);
    rec.stateEdits.push({ name, field, value: String(value || '').trim().slice(0, 600), protected: !!locked });
    const info = m.swipe_info?.[m.swipe_id];
    if (info) { info.extra ||= {}; info.extra[KEY] = clone(rec); }
    Promise.resolve(ctx().saveChat?.()).catch(e => console.warn('[Roleplay Instructions] saving state', e));
    return true;
}
