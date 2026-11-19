// V10's canonical update contract and chat-local configuration.
import { ctx, KEY, names, loadBook, saveBook, refreshWorldList, isGenerating } from './st.js';
import { chatState, settings, saveChatState } from './store.js';
import { rollInt, createSet } from './books.js';
import { chatWorld, setChatWorld, loadWorld, listWorld } from './world.js';
import { statNames, sheet } from './dice.js';

export const PRESET = 'Roleplay Instructions V10';
export const MODULES = {
    style: 'Live writing guidance', state: 'Story, scene and character state', knowledge: 'Character knowledge', emotions: 'NPC emotion scales',
    relationships: 'Relationships', plots: 'Arcs, seeds and off-screen agendas', worldEvents: 'Autonomous world events',
    dice: 'Explicit action checks', colors: 'Dialogue colors', roast: 'Roast generation', roastFeedback: 'Roast feedback in future prompts',
};
export const DEFAULT_MODULES = {
    style: true, state: true, knowledge: true, emotions: true, relationships: true, plots: true, worldEvents: true,
    dice: true, colors: true, roast: false, roastFeedback: false,
};
export const STYLE = 'Write direct, concrete fiction. Give the current cast distinct voices and independent motives. Show actions and speech, respect viewpoint knowledge, and leave the player’s speech, thoughts and choices to the player. End on a live beat without a meta question or choice menu. Most people are generally well, rested and capable; transient setbacks usually resolve quickly. Let significant moments breathe and skip uneventful intervals when appropriate.';
export const OPENING = 'Write a rich opening of roughly 350–650 words. Establish the place, who is present and what is already in motion through concrete action and dialogue. Follow the selected point of view, tense and voice. Use normal paragraphs and quoted dialogue, with natural alternation between narration and speech. Default to close third-person past from the viewpoint NPC unless the shared profile specifies otherwise. Describe action in prose and use ordinary dialogue tags when speaker labels are disabled. If using viewpoint NPC thoughts, mark them with asterisks. Leave player thoughts and decisions open. End at a natural opportunity to respond.';
export const AXES = ['tenderness', 'fury', 'dread', 'yearning'];
export const KIND_MODULE = { fact:'state', profile:'state', knowledge:'knowledge', emotion:'emotions', relationship:'relationships', arc:'plots', seed:'plots', agenda:'plots', event:'worldEvents' };
export const RECORD_KINDS = Object.keys(KIND_MODULE);
export const PLOT_KINDS = ['arc','seed','agenda','event'];
const TAG = /<story_update\b([^>]*)>/i;
const VERSION = /(?:^|\s)v\s*=\s*(?:"2"|'2'|2)(?=\s|$)/i;
const END = /<\/story_update\s*>/i;
export const clean = x => typeof x === 'string' ? x.trim() : '';
const normalize = s => clean(s).toLowerCase().replace(/\s+/g,' ');
const safeText = (s, max) => clean(s).slice(0,max);
const idPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const validId = value => typeof value === 'string' && idPattern.test(value);
const mentions = (text, value) => {
    const name = normalize(value).replace(/[^\p{L}\p{N}]+/gu,' ').trim();
    return !!name && ` ${normalize(text).replace(/[^\p{L}\p{N}]+/gu,' ')} `.includes(` ${name} `);
};
const fields = ['where','when','present','environment'];

export function activePreset() {
    const c = ctx();
    try { return c.getPresetManager?.('openai')?.getSelectedPresetName?.() || ''; } catch { return ''; }
}

export function prefs() { return chatState() && (chatState().v10 ||= {}); }
export function enabledV10() {
    const local = chatState()?.v10?.enabled;
    return settings().enabled && (local ?? (activePreset() === PRESET));
}
export function effectiveModules() {
    return { ...DEFAULT_MODULES, ...presetDefaults(), ...(chatState()?.v10?.modules || {}) };
}
export function presetDefaults(name = activePreset()) {
    const presets = settings().v10Presets || {};
    return Object.hasOwn(presets,name) ? presets[name] : {};
}
export function savePresetDefault(name,key,value) {
    const presets = settings().v10Presets ||= {};
    const next = {...presetDefaults(name)};
    if (value === undefined) delete next[key]; else next[key] = value;
    Object.defineProperty(presets,name,{value:next,enumerable:true,writable:true,configurable:true});
}
export const formatSpeaker = modules => modules.colors ? 'For colored spoken dialogue only, put each speaker’s established name in square brackets on its own dialogue line, e.g. [Mira] “Wait.” Keep other prose unmarked.' : '';

export function extractUpdate(raw) {
    const text = String(raw || '');
    const start = TAG.exec(text);
    if (!start || !/\bv\s*=/i.test(start[1])) return null;
    const tail = text.slice(start.index + start[0].length);
    const end = END.exec(tail);
    const remainder = end ? tail.slice(end.index + end[0].length) : '';
    const cleanText = (text.slice(0,start.index) + remainder.replace(/<story_update\b[^>]*>[\s\S]*?(?:<\/story_update\s*>|$)/gi,'')).trimEnd();
    let value;
    try { value = end && JSON.parse(tail.slice(0,end.index)); } catch { /* captured below */ }
    if (!VERSION.test(start[1]) || TAG.test(remainder) || !value || Array.isArray(value) || value.v !== 2 || ['changes','repairChanges'].some(key => value[key] !== undefined && !Array.isArray(value[key]))) {
        return { clean: cleanText, invalid:true, found:true };
    }
    const scene = Object.fromEntries(fields.filter(key => typeof value.scene?.[key] === 'string').map(key => [key, safeText(value.scene[key],300)]));
    const profiles = (Array.isArray(value.characters) ? value.characters : []).slice(0,8).flatMap(item => {
        const name = safeText(item?.name,90);
        const evidence = safeText(item?.evidence,300);
        if (!name || normalize(name) === normalize(names().user) || evidence.length < 4 || !normalize(cleanText).includes(normalize(evidence))) return [];
        const now = Object.fromEntries(['mind','heart','body','psyche'].map(key=>[key,safeText(item[key],220)]).filter(([,text])=>text));
        return Object.keys(now).length ? [{name,now,stable:{}}] : [];
    });
    const elapsed = value.scene?.elapsed;
    const minutes = Number.isInteger(value.scene?.minutes) && value.scene.minutes >= 0 ? value.scene.minutes : undefined;
    return {
        clean: cleanText, found:true, scene, profiles, minutes, elapsed: Number.isInteger(elapsed) && elapsed >= 0 && elapsed <= 5256000 ? elapsed : undefined,
        ended: value.scene?.ended === true, legacyOutcome:safeText(value.legacyOutcome,400), roast: safeText(value.roast,1000), changes:(value.changes || []).slice(0,12),
        repairChanges: (value.repairChanges || []).slice(0,4), repair: Number.isSafeInteger(value.repair) ? value.repair : null,
    };
}

export function readRecord(row) {
    if (!row || !Object.hasOwn(KIND_MODULE,row.kind) && row.kind !== 'payoff') return null;
    try { const value = JSON.parse(row.fields.data); return value && validId(value.id) && (row.kind === value.kind || (row.kind === 'payoff' && value.kind === 'seed')) ? value : null; } catch { return null; }
}

export function gate(record, rows, clock, scene) {
    if (record.status === 'retired') return false;
    if (record.due !== undefined && (!Number.isInteger(clock) || clock < record.due)) return false;
    if (record.location && normalize(scene?.where) !== normalize(record.location)) return false;
    for (const key of record.requires || []) {
        const prerequisite = rows.get(key);
        if (!prerequisite || (PLOT_KINDS.includes(prerequisite.kind) && prerequisite.status !== 'done')) return false;
        if (prerequisite.kind === 'knowledge' && prerequisite.basis !== 'observed') return false;
    }
    return true;
}

export function normalizeRecord(input, { modules, rows, snapshot, evidence, clock, scene, manual = false }) {
    if (!input || !Object.hasOwn(KIND_MODULE,input.kind) || (!manual && !modules[KIND_MODULE[input.kind]]) || !validId(input.id)) return null;
    const kind = input.kind;
    const previous = rows.get(input.id);
    const text = safeText(input.text,900);
    const quote = safeText(input.evidence,400);
    if ((!text && (!previous || kind !== 'profile')) || (previous && previous.kind !== kind)) return null;
    if (!manual) {
        if (previous?.protected) return null;
        if (kind !== 'profile' && snapshot && JSON.stringify(snapshot.get(input.id)) !== JSON.stringify(previous)) return null;
        if (quote.length < 4 || !normalize(evidence).includes(normalize(quote))) return null;
    }
    const record = { id:input.id, kind, text:text || previous?.text || '', subject:safeText(input.subject ?? previous?.subject,90), quote };
    if (previous?.subject && !manual && normalize(previous.subject) !== normalize(record.subject)) return null;
    if (['profile','knowledge','emotion','relationship','agenda'].includes(kind) && !record.subject) return null;
    if (kind === 'emotion' && normalize(record.subject) === normalize(names().user)) return null;
    if (kind === 'knowledge') {
        if (!['observed','reported','rumor','belief'].includes(input.basis)) return null;
        record.basis = input.basis;
        record.private = input.private !== false;
        if (!manual && previous?.private) record.private = true;
    }
    if (kind === 'fact') {
        record.aliases = (Array.isArray(input.aliases) ? input.aliases : previous?.aliases || []).filter(alias=>typeof alias === 'string').map(alias=>safeText(alias,90)).filter(Boolean).slice(0,8);
        record.link = validId(input.link) ? input.link : previous?.link;
    }
    if (kind === 'relationship') {
        record.other = safeText(input.other ?? previous?.other,90);
        record.perspective = safeText(input.perspective ?? previous?.perspective,240);
    }
    if (kind === 'profile') {
        record.aliases = [...new Set((Array.isArray(input.aliases) ? input.aliases : previous?.aliases || []).map(alias=>safeText(alias,90)).filter(Boolean))].slice(0,8);
        record.facet = safeText(input.facet ?? previous?.facet,180);
        record.voice = safeText(input.voice ?? previous?.voice,260);
        record.profileFields = { ...previous?.profileFields };
        if (previous?.baseline || (manual && input.baseline)) record.baseline = previous?.baseline || input.baseline;
        const locks = new Set(Array.isArray(input.lockFields) ? input.lockFields : []);
        for (const key of ['text','voice','aliases','facet']) {
            const existing = previous?.[key];
            const meta = previous?.profileFields?.[key];
            const changed = JSON.stringify(record[key]) !== JSON.stringify(existing);
            const stale = snapshot && JSON.stringify(snapshot.get(input.id)?.[key]) !== JSON.stringify(existing);
            if (manual && previous && Array.isArray(input.changedFields) && !input.changedFields.includes(key)) record[key] = existing;
            const edited = !Array.isArray(input.changedFields) || input.changedFields.includes(key);
            const locked = manual && edited ? locks.has(key) : !!meta?.locked;
            if (!manual && (stale || locked || (changed && existing?.length && key !== 'facet' && !input.development))) record[key] = existing;
            if (JSON.stringify(record[key]) !== JSON.stringify(existing) || locked !== !!meta?.locked) {
                record.profileFields[key] = { source:manual ? 'player' : quote, revision:(meta?.revision || 0)+1, updated:Date.now(), locked };
            }
        }
        if (!record.text) return null;
    }
    if (kind === 'emotion') {
        record.axes = { ...previous?.axes };
        for (const key of AXES) if (Number.isInteger(input.axes?.[key]) && input.axes[key] >= 0 && input.axes[key] <= 10) record.axes[key] = input.axes[key];
        record.outward = safeText(input.outward,180);
    }
    if (PLOT_KINDS.includes(kind)) {
        const status = input.status ?? previous?.status ?? 'open';
        if (!['open','done','retired'].includes(status)) return null;
        if (!manual && previous?.status === 'retired') return null;
        if (!manual && status === 'done' && previous && !gate(previous,rows,clock,scene)) return null;
        record.status = status;
        record.requires = previous && !manual ? previous.requires : [...new Set((Array.isArray(input.requires) ? input.requires : []).filter(x => validId(x) && x !== input.id))].slice(0,8);
        record.parent = previous && !manual ? previous.parent : validId(input.parent) && input.parent !== input.id ? input.parent : undefined;
        record.location = safeText(previous && !manual ? previous.location : input.location,120);
        const due = previous && !manual ? previous.due : input.due;
        if (Number.isInteger(due) && due >= 0) record.due = due;
        record.schedule = previous && !manual ? previous.schedule : input.schedule === true;
        record.weight = Math.max(1,Math.min(100,Number(previous && !manual ? previous.weight : input.weight) || 1));
        record.spacing = Math.max(0,Math.min(500,Math.floor(Number(previous && !manual ? previous.spacing : input.spacing) || 0)));
        record.payoff = safeText(previous && !manual ? previous.payoff : input.payoff,300);
        if (kind === 'agenda') record.whereabouts = safeText(input.whereabouts ?? previous?.whereabouts,220);
        record.outcome = status === 'done' ? safeText(input.outcome ?? previous?.outcome,400) || quote : '';
        if (!manual && status === 'done' && !gate(record,rows,clock,scene)) return null;
    }
    if (manual && input.protected !== false) record.protected = true;
    return record;
}

export function replyDiagnostics(prose) {
    const lines = prose.split(/(?<=[.!?])\s+/).map(normalize).filter(x => x.length >= 24);
    const repeats = [...new Set(lines.filter((line,i) => lines.indexOf(line) < i))];
    const malformed = prose.split('\n').filter(line => /^\[[^\]\n]{1,64}\][ \t]*[“"]/.test(line) && !/(?:“[^”]+”|"[^"]+")/.test(line)).length;
    return [malformed && `${malformed} speaker line${malformed === 1 ? '' : 's'} with unclosed quotation marks.`, repeats.length && `${repeats.length} repeated sentence${repeats.length === 1 ? '' : 's'}.`].filter(Boolean);
}

export async function ensureWorld() {
    if (chatWorld()) return chatWorld();
    const chatId = ctx().getCurrentChatId?.();
    if (!chatId) throw new Error('Open a chat first.');
    const base = `${names().char} — Story World`;
    let label = base;
    for (let i = 2; Object.hasOwn(settings().sets,label) || ctx().getWorldInfoNames?.().includes(label); i++) label = `${base} ${i}`;
    const id = await createSet(label,'world',{ entries:{} },'');
    if (ctx().getCurrentChatId?.() !== chatId) throw new Error('The chat changed while creating the story book.');
    if (!chatWorld()) setChatWorld(id);
    return chatWorld();
}

export async function pinBase(name) {
    const local = prefs();
    if (!local) throw new Error('Open a chat first.');
    const data = name ? await loadBook(name) : null;
    if (prefs() !== local) throw new Error('The chat changed.');
    if (name && !data?.entries) throw new Error('Could not read the base book.');
    local.base = name ? { name, entries:structuredClone(data.entries), pins:local.base?.name === name ? local.base.pins || [] : [] } : null;
    saveChatState();
}

export async function createGuidelines(name, content) {
    if (!clean(name) || !clean(content)) throw new Error('Enter a book name and guidance.');
    if (ctx().getWorldInfoNames?.().includes(name)) throw new Error('This book already exists.');
    const { blankEntry } = await import('./books.js');
    const entry = blankEntry(0);
    Object.assign(entry,{ comment:'Writing guidelines', content, constant:true, key:[], disable:false, useProbability:false, probability:100 });
    await saveBook(name,{ entries:{0:entry} });
    await refreshWorldList();
}

export async function rowsForWorld() {
    const id = chatWorld();
    const data = id ? await loadWorld(id) : null;
    return data ? listWorld(data,id) : [];
}

export function queueCheck(action, stat, dc, actor = 'user') {
    const local = prefs();
    if (!enabledV10() || !effectiveModules().dice || !local || isGenerating()) throw new Error('Action checks are unavailable right now.');
    if (!clean(action) || !statNames().includes(stat) || !['user','char'].includes(actor) || !Number.isInteger(dc) || dc < 1 || dc > 40) throw new Error('Choose an action, stat and difficulty from 1 to 40.');
    const mod = Math.trunc(Number(sheet(actor)[stat]) || 0);
    local.check = resolveCheck({ action:safeText(action,240), stat, dc, mod, actor, name:names()[actor] });
    saveChatState();
    return local.check;
}

export function resolveCheck(spec) {
    const natural = rollInt(20) + 1;
    const total = natural + spec.mod;
    return { ...spec, natural, total, result: total >= spec.dc ? 'success' : 'failure' };
}

export function checkText(check) {
    return check ? `Resolved action check: ${check.name} attempts ${check.action}. ${check.stat}: d20 ${check.natural} + (${check.mod}) = ${check.total}, difficulty ${check.dc}: ${check.result}. Honor the outcome and preserve player agency.` : '';
}

export function recordMap(rows) {
    return new Map(rows.filter(row => row.on).map(readRecord).filter(Boolean).map(record => [record.id,record]));
}

export function previousV10(type) {
    const chat = ctx().chat || [];
    const end = ['swipe','regenerate'].includes(type) && chat.at(-1) && !chat.at(-1).is_user ? -1 : chat.length;
    return chat.slice(0,end).filter(m => !m.is_user && !m.extra?.[KEY]?.stateStale).map(m => ({ message:m, record:m.extra?.[KEY] })).filter(x => x.record);
}

export function updateContract(modules, opening = false) {
    const kinds = RECORD_KINDS.filter(kind => modules[KIND_MODULE[kind]]);
    const sections = [
        modules.state && 'scene: {"where":"...","when":"...","present":"comma-separated names","environment":"...","minutes":0,"elapsed":0,"ended":false}. Include only established changes. minutes is an exact absolute story minute; elapsed adds minutes to a known clock. Use approximate when if timing is uncertain.',
        kinds.length && `changes: an array of up to 12 objects with kind (${kinds.join(', ')}), id (stable slug, reuse existing IDs), text, subject when describing someone, and evidence (an exact quote from the accepted prose). Record meaningful changes, not repetition.`,
        modules.state && 'characters: optional array of present characters with name and an exact evidence quote, plus changed mind (focus), heart (felt emotion), body (established lasting physical fact or explicit recovery), or psyche (salient internal tension). Omit unsupported dimensions and leave the player’s private state to the player.',
        modules.state && 'For profiles include voice, aliases or current facet when applicable. Set development:true only for lasting character growth that the reply establishes. Preserve card canon and player edits. Keep transient setbacks out of durable facts. A fact may link to the plot record that established it.',
        modules.relationships && 'For a relationship use subject and other for the two people. Consider relevant relationships in dialogue and choices. Use perspective for meaningful asymmetry and record only lasting dynamics or turning points.',
        modules.knowledge && 'For knowledge include basis: observed, reported, rumor or belief; private defaults to true. Do not promote rumor to established fact.',
        modules.emotions && 'For emotion include axes (tenderness, fury, dread, yearning, each 0–10 or omitted) and optional outward behavior. Consider every applicable dimension without forcing each to change or be displayed.',
        (modules.plots || modules.worldEvents) && 'For plot records use status open or done, plus optional parent (arc ID), requires (record IDs), due (absolute story minute), location and payoff. Record an outcome only on completion. Use schedule:true with optional weight and spacing in replies only when a future opportunity should be surfaced. An agenda can include established whereabouts. An offer or deadline alone does not establish completion.',
        modules.roast && 'roast: optional short out-of-story voice critique when it adds value.',
    ].filter(Boolean);
    if (!sections.length) return '';
    return `After the visible prose, ${opening ? 'include' : 'when information changed, append'} one <story_update v="2"> JSON object with v:2 and only applicable fields </story_update>. No code fence.\n${sections.join('\n')}`;
}

export function prepareTurn(rows, scene, type, modules, check, { schedule = false } = {}) {
    const history = previousV10(type);
    const latest = history.at(-1);
    const clock = [...history].reverse().find(x => Number.isInteger(x.record.v10Minutes))?.record.v10Minutes;
    const records = recordMap(rows);
    const recent = (ctx().chat || []).slice(0, ['swipe','regenerate'].includes(type) ? -1 : undefined).slice(-5).map(m => m.mes).join('\n');
    const context = normalize(`${scene?.where || ''} ${scene?.present || ''} ${recent}`);
    const cast = normalize(scene?.present);
    const matches = subject => mentions(context,subject);
    const relevant = [];
    const recalled = [];
    let offer;
    for (const row of records.values()) {
        if (!modules[KIND_MODULE[row.kind]]) continue;
        const eligible = gate(row,records,clock,scene);
        if (PLOT_KINDS.includes(row.kind)) {
            if (row.status === 'retired') continue;
            if (row.kind === 'agenda' && !matches(row.subject) && !(row.due !== undefined && eligible)) continue;
            if (row.kind === 'event' && row.status !== 'done') continue;
            if (row.status === 'done' && ![row.subject,...(row.aliases || []),row.location,...row.text.split(/[^\p{L}\p{N}]+/u).filter(x=>x.length>=5)].some(matches)) continue;
            const text = `${row.id} [${row.kind}, ${row.status}${row.parent ? `, arc ${row.parent}` : ''}${eligible ? '' : ', prerequisites pending'}]: ${row.text}${row.whereabouts ? ` Whereabouts: ${row.whereabouts}` : ''}${row.outcome ? ` Outcome: ${row.outcome}` : ''}`;
            relevant.push({record:row,text});
        } else if (row.kind === 'knowledge' && row.private && !mentions(cast,row.subject)) {
            continue;
        } else if (!row.subject || [row.subject,row.other,...(row.aliases || [])].some(matches)) {
            let suffix = '';
            if (row.kind === 'profile') suffix = `${row.voice ? ` Voice: ${row.voice}` : ''}${row.facet ? ` Current facet: ${row.facet}` : ''}`;
            if (row.kind === 'relationship') suffix = [row.other,row.perspective].filter(Boolean).join(' · ');
            if (row.kind === 'emotion') {
                const tuning = chatState()?.v10?.emotion || {};
                const passes = Math.max(0, Math.floor(((ctx().chat || []).length - (row.atIndex || 0) - 1)/2));
                const persistence = Number(tuning.persistence ?? 3);
                const recovery = Number(tuning.recovery ?? 1);
                const baseline = Number(tuning.baseline ?? 3);
                const axes = Object.fromEntries(Object.entries(row.axes || {}).map(([k,v]) => [k, v + Math.sign(baseline-v)*Math.min(Math.abs(baseline-v),Math.max(0,passes-persistence)*recovery)]));
                suffix = ` ${JSON.stringify(axes)}${row.outward ? `; outward: ${row.outward}` : ''}`;
            }
            relevant.push({record:row,text:`${row.id} [${row.kind}${row.subject ? ` / ${row.subject}` : ''}${row.basis ? ` / ${row.basis}` : ''}${row.protected ? ' / protected' : ''}]: ${row.text} ${suffix}`.trim()});
        }
    }
    let cost = 0;
    relevant.sort((a,b) => Number(PLOT_KINDS.includes(a.record.kind)) - Number(PLOT_KINDS.includes(b.record.kind)));
    for (const item of relevant) if (cost + item.text.length <= 6800) {
        recalled.push(item);
        cost += item.text.length + 1;
    }
    if (schedule && modules.plots && modules.worldEvents) {
        const candidates = [...records.values()].filter(row => PLOT_KINDS.includes(row.kind) && row.status === 'open' && row.schedule && gate(row,records,clock,scene) &&
            !history.slice(-(row.spacing || 1)).some(item => item.record.v10Offer === row.id));
        const total = candidates.reduce((sum,row) => sum + row.weight,0);
        let draw = total ? rollInt(total) : 0;
        offer = candidates.find(row => (draw -= row.weight) < 0);
    }
    const repair = latest?.record.v10Invalid && !latest.record.v10RepairAttempt
        ? { id:latest.record.time, text:safeText(latest.message.mes,1600) } : null;
    const feedback = modules.roastFeedback ? history.filter(x => x.record.roast).slice(-2).map(x => safeText(x.record.roast,300)) : [];
    const prefs = chatState()?.v10 || {};
    const style = prefs.style ?? STYLE;
    const baseline = modules.state ? rows.filter(row => row.on && row.kind === 'character' && matches(row.name)).map(row => `${row.name}: ${[row.fields.who,row.fields.voice].filter(Boolean).join(' · ')}`) : [];
    const card = ctx().characters?.[ctx().characterId];
    if (modules.state && card && (card.personality || card.data?.personality || card.description)) baseline.unshift(`${names().char}: ${safeText(card.personality || card.data?.personality || card.description,400)}`);
    const text = [
        modules.style && style, formatSpeaker(modules), modules.emotions && `Consider established emotional dimensions and outward bearing. Sensitivity: ${prefs.emotion?.sensitivity || 'flexible'}. Credible sudden or mixed reactions are welcome.`,
        baseline.length && `Established portrayal takes precedence over general style:\n${baseline.slice(0,8).join('\n')}`,
        recalled.length && `Established records (respect private knowledge and protected portrayal):\n${recalled.map(x=>x.text).join('\n')}`,
        modules.state && Number.isInteger(clock) && `Current exact story minute: ${clock}.`,
        checkText(check), feedback.length && `Out-of-story voice feedback, not canon:\n${feedback.join('\n')}`,
        repair && `If supported, recover a missing state change from accepted reply ${repair.id}, using exact evidence and placing it in repairChanges alongside "repair":${repair.id}. Keep new changes in changes. Respect newer facts. Prior prose: ${JSON.stringify(repair.text)}`,
        updateContract(modules),
    ].filter(Boolean).join('\n');
    return { text, offer, repair, records, clock, check, modules, recalled };
}

export function loreReceipt(entries, notes, rows, book, recalled = []) {
    const seen = new Set();
    const receipt = [];
    const add = item => {
        const key = `${item.book}:${item.uid}`;
        if (!seen.has(key)) { seen.add(key); receipt.push(item); }
    };
    const local = prefs();
    for (const entry of entries) {
        if (!entry?.world || entry.world.startsWith('Roleplay Instructions ')) continue;
        add({ book:entry.world, uid:entry.uid, title:entry.comment || entry.key?.[0] || `Entry ${entry.uid}`, role:entry.world === local?.base?.name ? 'Base World' : entry.world === local?.guidelines ? 'Guidelines' : 'World Info', selected:true, text:entry.content });
    }
    for (const uid of notes?.ids || []) {
        const row = rows.find(item => item.uid === uid);
        if (row) add({ book, uid, title:row.kind === 'secret' && row.status !== 'out' ? 'Concealed entry' : row.name, selected:true, role:'Story World', text:notes.text });
    }
    for (const {record,text} of recalled) add({book,uid:record.id,title:record.kind === 'knowledge' && record.private ? 'Character knowledge' : record.id,role:PLOT_KINDS.includes(record.kind) ? 'Plot Records' : 'Chat Facts',selected:true,text});
    return receipt.slice(0,120);
}

export async function addConfiguredBooks(lore, arrays) {
    const local = chatState()?.v10;
    if (!local || !Array.isArray(lore.chatLore)) return;
    if (local.base) {
        for (const list of arrays) for (let i=list.length-1;i>=0;i--) if (list[i].world === local.base.name) list.splice(i,1);
        const opening = !(ctx().chat || []).some(message=>message.is_user && message !== ctx().chat.at(-1));
        lore.chatLore.push(...Object.values(local.base.entries || {}).map(entry => ({
            ...structuredClone(entry), world:local.base.name,
            ...(opening && local.base.pins?.includes(String(entry.uid)) && !entry.disable ? {constant:true} : {}),
        })));
    }
    if (local.guidelines && local.guidelines !== local.base?.name) {
        const byId = new Map();
        for (const list of arrays) for (let i=list.length-1;i>=0;i--) if (list[i].world === local.guidelines) {
            const [entry] = list.splice(i,1);
            byId.set(entry.uid,entry);
        }
        if (local.guidelinesOn !== false) {
            const data = byId.size ? {entries:Object.fromEntries(byId)} : await loadBook(local.guidelines).catch(() => null);
            if (Array.isArray(lore.chatLore)) lore.chatLore.push(...Object.values(data?.entries || {}).map(entry => ({ ...entry, world:local.guidelines })));
        }
    }
}

const PALETTE = ['#7DA8FF','#95FFCA','#FF85E8','#40E8FF','#D7AAFF','#99FF75','#A8B4FF','#FF66F5','#68FFEC','#F58CFF','#C49BFF','#35F6E7','#F5A0EB','#55D8FF','#BB99FF','#7AFF98','#8FEAFF','#DE8CFF','#40FFD8','#80C4FF','#60FFBA'];
export const SPEECH = /^(?:\[([^\]\n<>"“]{1,64})\]|([^:\n“"<>]{1,64}):)[ \t]*(?=["“])/gm;

export function registerSpeakers(prose, records) {
    const local = prefs();
    if (!local) return;
    const speakers = local.speakers ||= {};
    for (const match of prose.matchAll(SPEECH)) {
        const display = clean(match[1] || match[2]);
        const normalized = normalize(display);
        if (!display || normalized === normalize(names().user)) continue;
        const known = [...(records?.values() || [])].find(row => row.kind === 'profile' && [row.subject,...(row.aliases || [])].some(alias => normalize(alias) === normalized));
        const key = known ? `profile:${known.id}` : `speaker:${normalized}`;
        const aliases = [...new Set([normalized,...(known?.aliases || []).map(normalize),normalize(known?.subject || display)])];
        const prior = speakers[key] || Object.values(speakers).find(value => value.aliases.some(alias=>aliases.includes(alias)));
        if (prior) {
            prior.aliases = [...new Set([...prior.aliases,...aliases])];
            continue;
        }
        const used = new Set(Object.values(speakers).map(value=>value.color));
        const speaker = speakers[key] ||= { name:known?.subject || display, aliases:[], color:PALETTE.find(color=>!used.has(color)) || PALETTE[Object.keys(speakers).length % PALETTE.length] };
        speaker.aliases = [...new Set([...speaker.aliases,normalized, ...(known?.aliases || []).map(normalize),normalize(speaker.name)])];
    }
    saveChatState();
}

export function setSpeakerColor(key, value) {
    const speaker = prefs()?.speakers?.[key];
    if (!speaker || !/^#[a-f0-9]{6}$/i.test(value)) throw new Error('Choose a six-digit RGB color.');
    speaker.color = value.toUpperCase();
    saveChatState();
}

function luminance(rgb) {
    return rgb.map(v => v/255).reduce((sum,v,i) => sum + [0.2126,0.7152,0.0722][i]*(v <= 0.04045 ? v/12.92 : ((v+0.055)/1.055)**2.4),0);
}
function ratio(a,b) { return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05); }
export function displayColor(saved, elements) {
    if (!/^#[a-f0-9]{6}$/i.test(saved)) return null;
    let background = null;
    const blends = [];
    for (let el=elements; el; el=el.parentElement) {
        const style = getComputedStyle(el);
        if (style.backgroundImage !== 'none') return null;
        const components = style.backgroundColor.match(/[\d.]+/g)?.map(Number);
        if (components?.length === 4 && components[3] > 0 && components[3] < 1) blends.push(components);
        if (components?.length === 3 || components?.[3] === 1) {
            const composite = blends.reverse().reduce((rgb,layer) => rgb.map((value,i)=>value*(1-layer[3])+layer[i]*layer[3]),components.slice(0,3));
            background = luminance(composite);
            break;
        }
    }
    if (background === null && elements) return null;
    if (background === null) background = luminance([16,14,28]);
    const rgb = [1,3,5].map(i => parseInt(saved.slice(i,i+2),16));
    if (ratio(luminance(rgb),background) >= 7) return saved;
    const target = ratio(1,background) >= ratio(0,background) ? 255 : 0;
    for (let step=1;step<=20;step++) {
        const values = rgb.map(v=>Math.round(v+(target-v)*step/20));
        if (ratio(luminance(values),background) >= 7) return '#'+values.map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();
    }
    return null;
}

export function greetings() {
    const card = ctx().characters?.[ctx().characterId];
    const alternatives = card?.data?.alternate_greetings || card?.alternate_greetings || [];
    return [card?.first_mes || card?.data?.first_mes, ...alternatives].filter(value=>typeof value === 'string' && value.trim());
}

export async function draftOpening({ text = '', direction = '' } = {}) {
    const local = prefs();
    if (!enabledV10() || !local || isGenerating()) throw new Error('Enable V10 and wait for generation to finish.');
    const { request } = await import('./ai.js');
    const card = ctx().characters?.[ctx().characterId] || {};
    const modules = effectiveModules();
    const c = ctx();
    const cardSource = ['description','personality','scenario','mes_example'].map(key=>card[key] || card.data?.[key]).filter(Boolean);
    const persona = c.powerUserSettings?.persona_description || c.power_user?.persona_description;
    const clue = [text,direction,names().char,names().user,card.scenario || card.data?.scenario].filter(Boolean).join(' ');
    const selectEntries = (entries,pins=[]) => Object.values(entries || {}).filter(row=>{
        if (row.disable) return false;
        if (row.constant || pins.includes(String(row.uid))) return true;
        if (!row.key?.some(key=>mentions(clue,key))) return false;
        const secondary = (row.keysecondary || []).map(key=>mentions(clue,key));
        if (!row.selective || !secondary.length) return true;
        return [secondary.some(Boolean),secondary.some(value=>!value),secondary.every(value=>!value),secondary.every(Boolean)][row.selectiveLogic || 0];
    }).map(row=>row.content).join('\n').slice(0,6000);
    const base = selectEntries(local.base?.entries,local.base?.pins);
    const guidance = local.guidelines && local.guidelinesOn !== false ? selectEntries((await loadBook(local.guidelines))?.entries) : '';
    const source = [base && `Pre-opening canon:\n${base}`,...cardSource,persona && `Player persona:\n${persona}`,guidance && `Selected writing guidance:\n${guidance}`].filter(Boolean).join('\n').slice(0,15000);
    const writing = modules.style ? local.style ?? STYLE : '';
    const format = [local.opening ?? OPENING,writing,formatSpeaker(modules)].filter(Boolean).join('\n');
    const user = [
        text ? 'Extract scene state from the chosen greeting. Return only the update block. Preserve what the greeting establishes and do not invent facts.' : format,
        `Character: ${names().char}. Player: ${names().user}.`, source && `Source material:\n${source}`,
        text && `Chosen greeting:\n${text}`, direction && `Opening direction:\n${safeText(direction,2000)}`,
        updateContract(modules,true),
    ].filter(Boolean).join('\n\n');
    const result = await request({ what:'Draft v10 opening', system:'Create or analyze the opening of this roleplay. Follow the requested output format.', user, tokens:text?1200:2200, profileId:settings().profileId });
    if (prefs() !== local) throw new Error('The chat changed.');
    const parsed = extractUpdate(result.text);
    const prose = text || parsed?.clean || result.text.trim();
    result.note(prose ? 'Opening draft is ready for review.' : 'The result did not contain an opening.',!!prose);
    if (!prose) throw new Error('No opening was returned. Try a new draft.');
    return { prose, parsed, original:prose };
}
