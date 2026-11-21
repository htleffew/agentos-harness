import { promptText } from './prompts.js';
// State is derived from the active chat. User corrections live in chat metadata so
// they survive swiping or deleting the reply that happened to be newest when edited.
import { ctx, KEY, isReply } from './st.js';
import { separateReply } from './reply-format.js';
import { weekdayAtOffset } from './story-clock.js';

export const STATE_FIELDS = [['mind', 'Mind'], ['heart', 'Heart'], ['body', 'Body'], ['psyche', 'Psyche']];
export const SCENE_FIELDS = [['present', 'Present'], ['where', 'Where'], ['when', 'When'], ['time', 'Time'], ['date', 'Date'], ['weather', 'Weather'], ['environment', 'Environment']];
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
    if (!Array.isArray(root.correctionHistory) && create) {
        root.correctionHistory = [
            ...Object.entries(root.stateOverrides || {}).map(([key, entry]) => ({ kind: 'state', key, entry: clone(entry), anchor: entry.anchor || '' })),
            ...Object.entries(root.sceneOverrides || {}).map(([key, entry]) => ({ kind: 'scene', key, entry: clone(entry), anchor: entry.anchor || '' })),
        ];
    }
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
export function stateAt(before = Infinity, { overrides = before === Infinity, includeTemporary = true } = {}) {
    const state = clone(metadata()?.stateSeed || {});
    const temporary = new Map();
    let turn = 0, previousScene;
    for (const m of (ctx().chat || []).slice(0, before)) {
        const rec = m?.extra?.[KEY];
        if (!rec || m.is_user) continue;
        if (!rec.stateStale) {
            if (rec.time !== previousScene?.time) turn++;
            const boundary = rec.scene?.where && previousScene?.where && norm(rec.scene.where)!==norm(previousScene.where);
            for (const [key, until] of temporary) if (boundary || previousScene?.ended || turn>=until) {
                if (!state[key]?.protected.body) delete state[key]?.fields.body;
                temporary.delete(key);
            }
            previousScene = {where:rec.scene?.where || previousScene?.where,ended:rec.v10SceneEnded,time:rec.time};
        }
        for (const p of rec.stateStale ? [] : changes(rec)) {
            const key = norm(p.name);
            if (!key) continue;
            const item = state[key] || (state[key] = { name: p.name, fields: {}, protected: {} });
            item.name = p.name;
            for (const [field, value] of Object.entries(p.fields || {})) {
                if (!validField(field) || item.protected[field]) continue;
                if (value === null) delete item.fields[field]; else item.fields[field] = value;
                if (field === 'body') {
                    if (value && p.temporaryBody) temporary.set(key,turn+2);
                    else temporary.delete(key);
                }
            }
        }
        // Compatibility with v6 preview edits already stored on messages.
        for (const edit of rec.stateEdits || []) {
            if (edit.field==='body') temporary.delete(norm(edit.name));
            applyEdit(state, edit);
        }
    }
    if (!includeTemporary) for (const key of temporary.keys()) if (!state[key]?.protected.body) delete state[key]?.fields.body;
    if (overrides) for (const edit of Object.values(metadata()?.stateOverrides || {})) applyEdit(state, edit);
    return state;
}
export function snapshotState(id) {
    const state = stateAt(id + 1);
    for (const edit of ctx().chat?.[id]?.extra?.[KEY]?.snapshotEdits || []) applyEdit(state, edit);
    return state;
}
const calendarDate = /^(?:day\s+\d+\b|month\s+\d+\b|year\s+\d+\b|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b|\d{4}-\d{2}-\d{2}\b|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d+\b)/i;
const daypart = /\b(?:morning|afternoon|evening|night|dawn|dusk|noon|midnight)\b/i;
const weatherPhrase = /^(?:(?:(?:light|heavy|steady|thick|dense|scattered|low|high|grey|gray|dark|white|cold|warm|freezing|partly|mostly)\s+)*(?:clear(?:\s+sk(?:y|ies))?|sunny|rain(?:ing|y|fall| showers)?|drizzle|snow(?:ing|y|fall)?|cloud(?:s|y| cover)?|fog(?:gy)?|mist(?:y)?|wind(?:y|s)?|overcast|storm(?:y|s)?|thunderstorms?|sleet|hail|blizzard)\b|-?\d+\s*°\s*[FC]\b)/i;
const unknownSceneValue = /^(?:[—–?\-]+|\.{2,}|n\/?a|unknown|not yet established|not established|unspecified|not specified|unconfirmed|none|null|tbd)$/i;
const trackerMarkup = /<tracker\b[^>]*>([^<>]+)<\/tracker\s*>/i;
const headerValue = value => text(value).replace(/^[*_`\s\[]+|[*_`\s\]]+$/g,'').trim();
const parsedHeaders = new WeakMap();

export function sceneUpdate(fields = {}) {
    const established = {...fields};
    for (const key of ['time','when','date','weather','where']) {
        if (Object.hasOwn(established,key) && (!headerValue(established[key]) || unknownSceneValue.test(headerValue(established[key])))) delete established[key];
    }
    return normalizeScene(established);
}

/** Recover separate header fields from labelled or combined legacy scene values. */
export function normalizeScene(fields = {}) {
    const out = {...fields};
    for (const key of ['time','when']) {
        const combined = String(out[key] ?? '');
        const chunks = combined.split(/\s*(?:[,;|·]+|\s+[-–—]\s+)\s*/u).filter(Boolean);
        const dates = chunks.filter(part=>calendarDate.test(part) && !daypart.test(part));
        const weather = chunks.filter(part=>weatherPhrase.test(part));
        if (!dates.length && !weather.length) continue;
        if (!out.date && dates.length) out.date = dates.join(', ');
        if (!out.weather && weather.length) out.weather = weather.join(', ');
        const time = chunks.filter(part=>!dates.includes(part) && !weather.includes(part)).join(', ');
        if (time) out[key] = time;
        else delete out[key];
        if (time && key === 'when' && !out.time && /\b\d{1,2}:\d{2}\b/.test(time)) out.time = time;
    }
    return out;
}

export function sceneFromReplyHeader(prose) {
    const source = String(prose || '');
    const lines = separateReply(source).text.trimStart().split(/\r?\n/,8);
    const header = {};
    const symbols = { '🕰':'time','🕒':'time','🕐':'time','⏰':'time','🗓':'date','📅':'date','📍':'where','🌙':'weather','☀':'weather','🌦':'weather','🌧':'weather','⛅':'weather' };
    const map = { time:'time',date:'date',calendar:'date',location:'where',loc:'where',where:'where',weather:'weather' };
    for (const line of lines) {
        if (/^\s*<(?:mobile_header|scene_header)\b/i.test(line)) {
            for (const [,key,value] of line.matchAll(/\b(time|date|location|where|weather)\s*=\s*["']([^"']+)["']/gi)) header[map[key.toLowerCase()]] = text(value);
            break;
        }
        if (/^\s*</.test(line)) continue;
        const bracket = /^\s*\[([^\]]+)\]\s*$/.exec(line);
        const parts = (bracket?.[1] ?? line).split('|');
        for (const part of parts) {
            const label = /^\s*(time|date|calendar|location|where|weather)\s*:\s*(.+)$/i.exec(part.replace(/\*\*|__/g,''));
            const icon = /^(\p{Extended_Pictographic})\uFE0F?\s*(.+)$/u.exec(headerValue(part));
            if (label) header[map[label[1].toLowerCase()]] = headerValue(label[2]);
            else if (parts.length>1 && symbols[icon?.[1]]) header[symbols[icon[1]]] = headerValue(icon[2]);
        }
        if (Object.keys(header).length && bracket) break;
    }
    const legacy = {};
    const world = /<state:world\b[^>]*>([\s\S]*?)<\/state:world\s*>/i.exec(source)?.[1];
    if (world) for (const [,key,value] of world.matchAll(/<(time|date|loc|weather)>([^<>]+)<\/\1>/gi)) {
        legacy[map[key.toLowerCase()]] = headerValue(value);
    }
    const tracker = trackerMarkup.exec(source)?.[1];
    if (tracker) {
        const parts=tracker.split('|');
        if (parts.length===4) for (const [i,key] of ['time','date','where','weather'].entries()) {
            legacy[key] ??= headerValue(parts[i]).replace(/^(?:\p{Extended_Pictographic}[\uFE0F\u200D]*\s*)+/u,'');
        }
    }
    const hud = /<sola_hud\b[^>]*>([\s\S]*)<\/sola_hud\s*>/i.exec(source)?.[1];
    const chronology = /<date\b[^>]*>([^<>]+)<\/date\s*>/i.exec(hud || source)?.[1];
    if (chronology) for (const [,key,value] of chronology.matchAll(/^\s*(calendar|time)\s*:\s*([^\r\n]+)$/gim)) {
        legacy[map[key.toLowerCase()]] ??= headerValue(value);
    }
    return {...sceneUpdate(legacy),...sceneUpdate(header)};
}

export function stripSceneTracker(prose,{streaming = false} = {}) {
    const stripped=prose.replace(trackerMarkup,(tag,body)=>body.split('|').length===4 ? '' : tag);
    if (streaming) return stripped.replace(/<tracker\b[^>]*>[^<>]*$/i,'').trimStart();
    return stripped===prose ? prose : stripped.trimStart();
}

function historicalHeader(message) {
    const saved=parsedHeaders.get(message);
    if (saved && saved.input===message.mes) return {...saved.scene};
    const scene=sceneFromReplyHeader(message.mes);
    parsedHeaders.set(message,{input:message.mes,scene});
    return {...scene};
}

export function sceneAt(before = Infinity, { overrides = before === Infinity } = {}) {
    const chat = ctx().chat || [];
    const root = metadata();
    const scene = {};
    let savedSnapshot = false;
    const collect = (values, inherited = false) => {
        const dateKnown = Object.hasOwn(scene,'date') || scene.lastKnownDate;
        for (const [key,value] of Object.entries(values)) {
            if (['date','lastKnownDate','daysAfterKnownDate'].includes(key)) {
                if (!dateKnown) scene[key]=value;
            } else if ((!inherited || key==='weather' || key==='where') && !Object.hasOwn(scene,key)) scene[key]=value;
        }
    };
    for (let i = Math.min(before, chat.length) - 1; i >= 0; i--) {
        const message = chat[i], record = message?.extra?.[KEY];
        if (!isReply(message) || record?.stateStale) continue;
        const saved = sceneUpdate(record?.scene);
        const inline = historicalHeader(message);
        if (saved.lastKnownDate && !saved.date) delete inline.date;
        collect({...inline,...saved},savedSnapshot);
        savedSnapshot ||= !!record?.scene;
        if (savedSnapshot && (scene.date || scene.lastKnownDate) && scene.weather && scene.where) break;
    }
    collect(sceneUpdate(root?.sceneSeed),savedSnapshot);
    if (overrides) for (const [key, entry] of Object.entries(root?.sceneOverrides || {})) {
        if (SCENE_FIELDS.some(([field]) => field === key)) scene[key] = entry.value;
    }
    return normalizeScene(scene);
}
export function storyMinuteAt(before = Infinity) {
    const chat = ctx().chat || [];
    for (let i = Math.min(before,chat.length)-1; i >= 0; i--) {
        const record = chat[i]?.extra?.[KEY];
        if (!chat[i]?.is_user && !record?.stateStale && Number.isSafeInteger(record?.v10Minutes)) return record.v10Minutes;
    }
    return metadata()?.v10ClockSeed;
}

export function sceneDateLabel({date,lastKnownDate,daysAfterKnownDate:days}) {
    if (date || !lastKnownDate) return date;
    if (!days) return lastKnownDate;
    return weekdayAtOffset(lastKnownDate,days) || `${days===1 ? 'Day after' : `${days} calendar days after`} ${lastKnownDate}`;
}
export function currentState(type = 'normal') {
    const chat = ctx().chat || [];
    return stateAt(type === 'swipe' && chat.length && !chat[chat.length - 1]?.is_user ? chat.length - 1 : Infinity, { overrides: true });
}
export function statePrompt(type = 'normal', limit = 1400, { includeCharacters = true, excludeTargetOverrides = false } = {}) {
    const chat = ctx().chat || [];
    const end = ['swipe','regenerate'].includes(type) && chat.length && !chat[chat.length - 1]?.is_user ? chat.length - 1 : Infinity;
    const state = stateAt(end, { overrides: !excludeTargetOverrides });
    const scene = sceneAt(end, { overrides: !excludeTargetOverrides });
    if (excludeTargetOverrides) {
        const anchors = new Set(['seed']);
        for (const m of chat.slice(0, end)) {
            if (m?.extra?.[KEY]?.time) anchors.add(`record:${m.extra[KEY].time}`);
            if (m?.send_date) anchors.add(`message:${m.send_date}`);
        }
        const active = { state: {}, scene: {} };
        const history = metadata()?.correctionHistory;
        if (Array.isArray(history)) for (const event of history) {
            if (!anchors.has(event.anchor) || !active[event.kind]) continue;
            if (event.entry) active[event.kind][event.key] = event.entry; else delete active[event.kind][event.key];
        }
        else for (const [kind, bucket] of [['state', metadata()?.stateOverrides], ['scene', metadata()?.sceneOverrides]]) for (const [key, value] of Object.entries(bucket || {})) if (anchors.has(value.anchor)) active[kind][key] = value;
        for (const edit of Object.values(active.state)) applyEdit(state, edit);
        for (const [key, value] of Object.entries(active.scene)) if (SCENE_FIELDS.some(([k]) => k === key)) scene[key] = value.value;
    }
    const present = String(scene.present || '').toLocaleLowerCase();
    const selected = (includeCharacters ? Object.values(state) : []).filter(p => !present || present.includes(p.name.toLocaleLowerCase()));
    const rows = [];
    let used = 0;
    const add = line => { if (used + line.length + 1 > limit) return; rows.push(line); used += line.length + 1; };
    const temporal = [['time','Time'],['date','Date'],['when','When']];
    const sceneLine = SCENE_FIELDS.filter(([k]) => !temporal.some(([key])=>key===k) && scene[k]).map(([k, label]) => `${label}: ${scene[k]}`).join(' | ');
    for (const [key,label] of temporal) if (scene[key] && (key!=='when' || !scene.time)) add(`${label}: ${String(scene[key]).slice(0,100)}`);
    if (!scene.date && scene.lastKnownDate) {
        const days=scene.daysAfterKnownDate;
        const date=String(scene.lastKnownDate).slice(0,100);
        const weekday = days && weekdayAtOffset(scene.lastKnownDate,days);
        add(weekday ? `Date: ${weekday}. Last full date: ${date}. ${days} calendar ${days===1 ? 'day' : 'days'} later. Supply the full date if established.` :
            days ? `Date: ${sceneDateLabel(scene).slice(0,150)}. Supply the in-world date if established.` :
            `Last established date: ${date}. Supply the new date if the calendar establishes it.`);
    }
    if (sceneLine) add(`Scene: ${sceneLine}`);
    // Preserve complete fields rather than dropping an entire character when a long
    // field does not fit; physical conditions and goals take precedence.
    const ordered = ['body', 'mind', 'heart', 'psyche'];
    for (const key of ordered) for (const p of selected) {
        if (!p.fields[key]) continue;
        const label = STATE_FIELDS.find(([k]) => k === key)[1];
        add(`${p.name} — ${label}: ${p.fields[key]}`);
    }
    return rows.length ? `[Current story state. ${promptText('stateContext')}\n${rows.join('\n')}]` : '';
}
export function changesFromProfiles(profiles) {
    return (profiles || []).map(p => ({ name: p.name, ...(p.temporaryBody ? {temporaryBody:true} : {}), fields: Object.fromEntries(STATE_FIELDS.filter(([k]) => Object.hasOwn(p.now || {}, k)).map(([k]) => [k, p.now[k]])) })).filter(p => Object.keys(p.fields).length);
}
/** Identify the newest story message at the moment a user makes a correction. */
export function correctionAnchor() {
    const chat = ctx().chat || [];
    for (let i = chat.length - 1; i >= 0; i--) {
        const m = chat[i];
        if (!m || m.is_system) continue;
        const rec = m.extra?.[KEY];
        if (rec?.time) return `record:${rec.time}`;
        if (m.send_date) return `message:${m.send_date}`;
    }
    return '';
}
/** Remove corrections from a parent chat's future when a branch first opens. */
export function trimBranchOverrides(root, chat = ctx().chat || []) {
    const anchors = new Set();
    for (const m of chat) {
        if (m?.extra?.[KEY]?.time) anchors.add(`record:${m.extra[KEY].time}`);
        if (m?.send_date) anchors.add(`message:${m.send_date}`);
    }
    let removed = 0;
    if (Array.isArray(root?.correctionHistory)) {
        const kept = root.correctionHistory.filter(event => event.anchor === 'seed' || (event.anchor && anchors.has(event.anchor)));
        removed = root.correctionHistory.length - kept.length;
        root.stateOverrides = {}; root.sceneOverrides = {};
        for (const event of kept) {
            const bucket = event.kind === 'state' ? root.stateOverrides : event.kind === 'scene' ? root.sceneOverrides : null;
            if (!bucket) continue;
            if (event.entry) bucket[event.key] = clone(event.entry); else delete bucket[event.key];
        }
        root.correctionHistory = kept;
    } else for (const bucket of [root?.stateOverrides, root?.sceneOverrides]) {
        for (const [key, item] of Object.entries(bucket || {})) {
            if (item.anchor !== 'seed' && (!item.anchor || !anchors.has(item.anchor))) { delete bucket[key]; removed++; }
        }
    }
    if (Array.isArray(root?.storyCorrections)) {
        const kept = root.storyCorrections.filter(item=>item.anchor==='seed' || anchors.has(item.anchor));
        removed += root.storyCorrections.length-kept.length;
        root.storyCorrections = kept;
    }
    return removed;
}

/** Protected corrections survive deleting their originating reply. Anchor them
 * to the surviving chat so a later branch can carry them accurately. */
export function reanchorRemovedCorrections() {
    const root = metadata(true);
    if (!root) return;
    const chat = ctx().chat || [], anchors = new Set(['seed']);
    for (const m of chat) {
        if (m?.extra?.[KEY]?.time) anchors.add(`record:${m.extra[KEY].time}`);
        if (m?.send_date) anchors.add(`message:${m.send_date}`);
    }
    const anchor = correctionAnchor() || 'seed';
    let changed = false;
    for (const [kind, bucket] of [['state', root.stateOverrides], ['scene', root.sceneOverrides]]) for (const [key, entry] of Object.entries(bucket || {})) {
        if (entry.anchor && anchors.has(entry.anchor)) continue;
        entry.anchor = anchor;
        root.correctionHistory.push({ kind, key, entry: clone(entry), anchor });
        changed = true;
    }
    for (const correction of root.storyCorrections || []) if (!anchors.has(correction.anchor)) {
        correction.anchor = anchor;
        changed = true;
    }
    if (changed) { try { (ctx().saveMetadataDebounced || ctx().saveMetadata)?.(); } catch {} }
}

export function editState(id, name, field, value, locked = true) {
    if (!validField(field) || !name) return false;
    const root = metadata(true);
    const edit = { name, field, value: text(value), protected: !!locked, anchor: correctionAnchor() };
    if (root) {
        // Both locked and unlocked corrections survive history edits. An unlocked
        // correction becomes the baseline; subsequent model changes may replace it.
        const key = `${norm(name)}\u0000${field}`;
        root.correctionHistory.push({ kind: 'state', key, entry: locked ? clone(edit) : null, anchor: edit.anchor || 'seed' });
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
    const anchor = correctionAnchor();
    const entry = { value: text(value), protected: true, anchor };
    root.correctionHistory.push({ kind: 'scene', key: field, entry: locked ? clone(entry) : null, anchor: anchor || 'seed' });
    if (locked) root.sceneOverrides[field] = entry;
    else {
        delete root.sceneOverrides[field];
        const chat = ctx().chat || [];
        const m = [...chat].reverse().find(x => !x?.is_user && x?.extra?.[KEY]);
        if (m) { const rec = m.extra[KEY]; rec.scene ||= sceneAt(Infinity,{overrides:false}); rec.scene[field] = text(value); const info = m.swipe_info?.[m.swipe_id]; if (info) { info.extra ||= {}; info.extra[KEY] = clone(rec); } }
        else { root.sceneSeed ||= {}; root.sceneSeed[field] = text(value); }
    }
    save(); return true;
}
export function sceneProtected(field) { return !!metadata()?.sceneOverrides?.[field]; }
export function snapshotScene(id) {
    const scene = sceneAt(id + 1, { overrides: false });
    const message = ctx().chat?.[id];
    const edits = message?.extra?.[KEY]?.sceneSnapshotEdits || {};
    return normalizeScene({ ...scene, ...edits });
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
