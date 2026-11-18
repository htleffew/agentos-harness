// State is derived from the active chat. User corrections live in chat metadata so
// they survive swiping or deleting the reply that happened to be newest when edited.
import { ctx, KEY } from './st.js';

export const STATE_FIELDS = [['mind', 'Mind'], ['heart', 'Heart'], ['body', 'Body'], ['psyche', 'Psyche']];
export const SCENE_FIELDS = [['present', 'Present'], ['where', 'Where'], ['when', 'When'], ['environment', 'Environment']];
const norm = s => String(s || '').trim().toLocaleLowerCase();
const clone = v => JSON.parse(JSON.stringify(v));
const validField = field => STATE_FIELDS.some(([k]) => k === field);
const text = value => String(value ?? '').trim().slice(0, 600);
function metadata(create = false) {
    const meta = ctx().chatMetadata;
    if (!meta) return null;
    if (!meta[KEY] && create) meta[KEY] = {};
    const root = meta[KEY];
    if (!root) return null;
    if (!root.stateOverrides && create) root.stateOverrides = {};
    if (!root.sceneOverrides && create) root.sceneOverrides = {};
    return root;
}
function save() {
    const c = ctx();
    try { (c.saveMetadataDebounced || c.saveMetadata)?.(); } catch (e) { console.warn('[Roleplay Instructions] saving state metadata', e); }
    try { Promise.resolve(c.saveChat?.()).catch(e => console.warn('[Roleplay Instructions] saving state', e)); } catch (e) { console.warn('[Roleplay Instructions] saving state', e); }
}
function changes(rec) {
    if (Array.isArray(rec.stateChanges)) return rec.stateChanges;
    // Read old cards without rewriting them. Only fields with a clear correspondence
    // are migrated; in particular old post-hoc "will not" is not made a boundary.
    return (rec.profiles || []).map(p => ({ name: p.name, fields: {
        ...(p.now?.thinks ? { mind: p.now.thinks } : {}),
        ...(p.now?.feels ? { heart: p.now.feels } : {}),
        ...(p.now?.private ? { psyche: p.now.private } : {}),
    } }));
}
function applyEdit(state, edit) {
    const key = norm(edit.name);
    if (!key || !validField(edit.field)) return;
    const item = state[key] || (state[key] = { name: edit.name, fields: {}, protected: {} });
    if (edit.value) item.fields[edit.field] = edit.value; else delete item.fields[edit.field];
    if (edit.protected) item.protected[edit.field] = true; else delete item.protected[edit.field];
}
export function stateAt(before = Infinity, { overrides = before === Infinity } = {}) {
    const state = clone(metadata()?.stateSeed || {});
    for (const m of (ctx().chat || []).slice(0, before)) {
        const rec = m?.extra?.[KEY];
        if (!rec || m.is_user) continue;
        for (const p of changes(rec)) {
            const key = norm(p.name);
            if (!key) continue;
            const item = state[key] || (state[key] = { name: p.name, fields: {}, protected: {} });
            item.name = p.name;
            for (const [field, value] of Object.entries(p.fields || {})) {
                if (!validField(field) || item.protected[field]) continue;
                if (value === null) delete item.fields[field]; else item.fields[field] = value;
            }
        }
        // Compatibility with v6 preview edits already stored on messages.
        for (const edit of rec.stateEdits || []) applyEdit(state, edit);
    }
    if (overrides) for (const edit of Object.values(metadata()?.stateOverrides || {})) applyEdit(state, edit);
    return state;
}
export function snapshotState(id) {
    const state = stateAt(id + 1);
    for (const edit of ctx().chat?.[id]?.extra?.[KEY]?.snapshotEdits || []) applyEdit(state, edit);
    return state;
}
export function sceneAt(before = Infinity, { overrides = before === Infinity } = {}) {
    const chat = ctx().chat || [];
    let scene = { ...(metadata()?.sceneSeed || {}) };
    for (let i = Math.min(before, chat.length) - 1; i >= 0; i--) {
        if (!chat[i]?.is_user && chat[i]?.extra?.[KEY]?.scene) { scene = { ...chat[i].extra[KEY].scene }; break; }
    }
    if (overrides) for (const [key, entry] of Object.entries(metadata()?.sceneOverrides || {})) {
        if (SCENE_FIELDS.some(([field]) => field === key)) scene[key] = entry.value;
    }
    return scene;
}
export function currentState(type = 'normal') {
    const chat = ctx().chat || [];
    return stateAt(type === 'swipe' && chat.length && !chat[chat.length - 1]?.is_user ? chat.length - 1 : Infinity, { overrides: true });
}
export function statePrompt(type = 'normal', limit = 1400, { includeCharacters = true } = {}) {
    const chat = ctx().chat || [];
    const end = type === 'swipe' && chat.length && !chat[chat.length - 1]?.is_user ? chat.length - 1 : Infinity;
    const state = stateAt(end, { overrides: true });
    const scene = sceneAt(end, { overrides: true });
    const present = String(scene.present || '').toLocaleLowerCase();
    const selected = (includeCharacters ? Object.values(state) : []).filter(p => !present || present.includes(p.name.toLocaleLowerCase()));
    const rows = [];
    let used = 0;
    const add = line => { if (used + line.length + 1 > limit) return; rows.push(line); used += line.length + 1; };
    const sceneLine = SCENE_FIELDS.filter(([k]) => scene[k]).map(([k, label]) => `${label}: ${scene[k]}`).join(' | ');
    if (sceneLine) add(`Scene: ${sceneLine}`);
    // Preserve complete fields rather than dropping an entire character when a long
    // field does not fit; physical conditions and goals take precedence.
    const ordered = ['body', 'mind', 'heart', 'psyche'];
    for (const key of ordered) for (const p of selected) {
        if (!p.fields[key]) continue;
        const label = STATE_FIELDS.find(([k]) => k === key)[1];
        add(`${p.name} — ${label}: ${p.fields[key]}`);
    }
    return rows.length ? `[Current story state. Maintain continuity, but allow change when events justify it. Respect established character boundaries and physical conditions when interpreting events; adapt an incompatible event rather than force a violation. Private states are for the narrator; other characters know only what they have observed or been told.\n${rows.join('\n')}]` : '';
}
export function changesFromProfiles(profiles) {
    return (profiles || []).map(p => ({ name: p.name, fields: Object.fromEntries(STATE_FIELDS.filter(([k]) => Object.hasOwn(p.now || {}, k)).map(([k]) => [k, p.now[k]])) })).filter(p => Object.keys(p.fields).length);
}
export function editState(id, name, field, value, locked = true) {
    if (!validField(field) || !name) return false;
    const root = metadata(true);
    const edit = { name, field, value: text(value), protected: !!locked };
    if (root) {
        // Both locked and unlocked corrections survive history edits. An unlocked
        // correction becomes the baseline; subsequent model changes may replace it.
        const key = `${norm(name)}\u0000${field}`;
        if (locked) root.stateOverrides[key] = edit;
        else {
            delete root.stateOverrides[key];
            const rec = ctx().chat?.[id]?.extra?.[KEY];
            if (rec) { rec.stateEdits ||= []; rec.stateEdits = rec.stateEdits.filter(e => norm(e.name) !== norm(name) || e.field !== field); rec.stateEdits.push(edit); }
            else { root.stateSeed ||= {}; applyEdit(root.stateSeed, edit); }
        }
    } else {
        const rec = ctx().chat?.[id]?.extra?.[KEY];
        if (!rec) return false;
        rec.stateEdits ||= [];
        rec.stateEdits = rec.stateEdits.filter(e => norm(e.name) !== norm(name) || e.field !== field);
        rec.stateEdits.push(edit);
    }
    const m = ctx().chat?.[id], info = m?.swipe_info?.[m.swipe_id];
    if (info && m?.extra?.[KEY]) { info.extra ||= {}; info.extra[KEY] = clone(m.extra[KEY]); }
    save(); return true;
}
export function editScene(field, value, locked = true) {
    if (!SCENE_FIELDS.some(([k]) => k === field)) return false;
    const root = metadata(true);
    if (!root) return false;
    if (locked) root.sceneOverrides[field] = { value: text(value), protected: true };
    else {
        delete root.sceneOverrides[field];
        const chat = ctx().chat || [];
        const m = [...chat].reverse().find(x => !x?.is_user && x?.extra?.[KEY]);
        if (m) { const rec = m.extra[KEY]; rec.scene ||= {}; rec.scene[field] = text(value); const info = m.swipe_info?.[m.swipe_id]; if (info) { info.extra ||= {}; info.extra[KEY] = clone(rec); } }
        else { root.sceneSeed ||= {}; root.sceneSeed[field] = text(value); }
    }
    save(); return true;
}
export function sceneProtected(field) { return !!metadata()?.sceneOverrides?.[field]; }
export function snapshotScene(id) {
    const scene = sceneAt(id + 1, { overrides: false });
    const edits = ctx().chat?.[id]?.extra?.[KEY]?.sceneSnapshotEdits || {};
    return { ...scene, ...edits };
}
export function editSceneSnapshot(id, field, value) {
    if (!SCENE_FIELDS.some(([k]) => k === field)) return false;
    const m = ctx().chat?.[id], rec = m?.extra?.[KEY];
    if (!rec) return false;
    rec.sceneSnapshotEdits ||= {};
    rec.sceneSnapshotEdits[field] = text(value);
    const info = m.swipe_info?.[m.swipe_id];
    if (info) { info.extra ||= {}; info.extra[KEY] = clone(rec); }
    save(); return true;
}
export function editSnapshot(id, name, field, value) {
    if (!validField(field)) return false;
    const m = ctx().chat?.[id], rec = m?.extra?.[KEY];
    if (!rec) return false;
    rec.snapshotEdits ||= [];
    rec.snapshotEdits = rec.snapshotEdits.filter(e => norm(e.name) !== norm(name) || e.field !== field);
    rec.snapshotEdits.push({ name, field, value: text(value), protected: false });
    const info = m.swipe_info?.[m.swipe_id];
    if (info) { info.extra ||= {}; info.extra[KEY] = clone(rec); }
    save(); return true;
}

/** Explicit event tags to avoid in this chat; no inference from prose boundaries. */
export function blockedEventTags() { return metadata()?.blockedEventTags || []; }
export function setBlockedEventTags(value) {
    const root = metadata(true);
    if (!root) return false;
    root.blockedEventTags = [...new Set(String(value || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean))];
    save(); return true;
}
