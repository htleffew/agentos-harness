import { recallPolicy } from './recall.js';
import { memoryOnly, memoryComponents } from './components.js';
import { dialogueAttributions, thoughtAttributions } from './dialogue.js';
import { separateReply } from './reply-format.js';
// V10's canonical update contract and chat-local configuration.
import { ctx, KEY, names, loadBook, saveBook, refreshWorldList, worldNames, isGenerating } from './st.js';
import { chatState, settings, saveChatState } from './store.js';
import { rollInt, createSet, cleanSetName, setInfo } from './books.js';
import { chatWorld, setChatWorld, loadWorld, listWorld, newWorldEntry, writeWorldEntry } from './world.js';
import { statNames, sheet } from './dice.js';

export const PRESET = 'Roleplay Instructions V10';
export const pairedPreset = () => enabledV10() && activePreset() === PRESET;
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
const COMPANION_STYLE = 'Treat good health and rest as normal. Minor setbacks usually resolve quickly. Carry a lasting limitation only when the story establishes one.';
const COMPANION_WRITING_BLOCKS = new Set(['Viewpoint & player agency','Cast, motives & voice','Scene beats & pacing','Prose & dialogue craft','Consequences, combat & payoffs', 'Decisive NPCs', 'Recurring NPC creation', 'Voice continuity', 'Same-reply quality checks', 'Slow-burn scene profile', 'Player-limited viewpoint']);
export const defaultWritingGuidance = () => pairedPreset() ? COMPANION_STYLE : STYLE;
export const OPENING = 'Write a rich opening of roughly 350–650 words. Establish the place, who is present and what is already in motion through concrete action and dialogue. Follow the selected point of view, tense and voice. Use normal paragraphs and quoted dialogue, with natural alternation between narration and speech. Default to close third-person past from the viewpoint NPC unless the shared profile specifies otherwise. Describe action in prose and identify speakers through ordinary narration or a speech verb. If using viewpoint NPC thoughts, mark them with asterisks. Leave player thoughts and decisions open. End at a natural opportunity to respond.';
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
const fields = ['where','when','present','time','date','weather','environment'];

export function activePreset() {
    const c = ctx();
    if (c.mainApi && c.mainApi !== 'openai') return '';
    try { return c.getPresetManager?.('openai')?.getSelectedPresetName?.() || ''; } catch { return ''; }
}

export function prefs() { return chatState() && (chatState().v10 ||= {}); }
export function enabledV10() {
    const local = chatState()?.v10?.enabled;
    return settings().enabled && !memoryOnly() && (local ?? (activePreset() === PRESET));
}
const HOST_OVERLAPS = {
    style: ['Prose Rules'],
    dice: ['D&D Sim','Dice Rolls'],
    worldEvents: ['World Sim'],
    plots: ['World Sim','Internal States Template'],
    state: ['Internal States Template'],
    knowledge: ['Internal States Template'],
    emotions: ['Internal States Template'],
    relationships: ['Internal States Template'],
    colors: ['Colored Dialogue + Tone Tags (Regex Required)','Colored Dialogue (LEGACY - No Regex Required)'],
};

export function activeHostPrompts() {
    const c = ctx();
    if (c.mainApi && c.mainApi !== 'openai') return null;
    const host = c.chatCompletionSettings;
    const order = host?.prompt_order?.find?.(row=>String(row?.character_id)==='100001')?.order;
    if (!Array.isArray(order) || !Array.isArray(host?.prompts)) return null;
    const prompts = new Map(host.prompts.map(prompt=>[prompt.identifier,prompt]));
    return order.flatMap(entry=>{
        const prompt = prompts.get(entry.identifier);
        return prompt ? [{name:prompt.name || entry.identifier, enabled:entry.enabled===true, content:prompt.content || '', marker:!!prompt.marker}] : [];
    });
}

export function moduleOwnership(preset = activePreset()) {
    if (!preset) return {};
    const c = ctx();
    if (c.mainApi && c.mainApi !== 'openai') return {};
    const host = c.chatCompletionSettings;
    const prompts = Array.isArray(host?.prompts) ? host.prompts : null;
    // SillyTavern's global Chat Completion prompt manager uses this order.
    const order = host?.prompt_order?.find?.(row=>String(row?.character_id)==='100001')?.order;
    const flags = Array.isArray(order) ? new Map(order.filter(row=>row?.identifier).map(row=>[row.identifier,row.enabled===true])) : null;
    const listed = new Map();
    const hostBlocks = activeHostPrompts();
    for (const row of prompts || []) if (typeof row?.name === 'string') {
        const label = row.name.trim().toLowerCase();
        const identifiers = listed.get(label) || [];
        identifiers.push(row.identifier);
        listed.set(label,identifiers);
    }
    const owners = chatState()?.v10?.moduleOwners;
    const choices = owners && Object.hasOwn(owners,preset) ? owners[preset] : {};
    const ownership = {};
    for (const [module,names] of Object.entries(HOST_OVERLAPS)) {
        const blocks = names.filter(name=>listed.has(name.toLowerCase()) || (!prompts && /vexa/i.test(preset))).map(name=>({
            name, blocks:hostBlocks?.filter(block=>block.name.trim().toLowerCase()===name.toLowerCase()) || [],
            enabled:flags && listed.has(name.toLowerCase()) ? listed.get(name.toLowerCase()).some(id=>flags.get(id)===true) : null,
        }));
        if (!blocks.length) continue;
        const blocked = blocks.some(block=>block.enabled!==false);
        const choice = choices?.[module] ?? (blocked ? 'preset' : 'extension');
        ownership[module] = {blocks,choice,usesExtension:choice==='extension' && !blocked,blocked};
    }
    return ownership;
}

export function setModuleOwner(preset, key, value) {
    if (!Object.hasOwn(HOST_OVERLAPS,key) || !['preset','extension'].includes(value) || !preset) return;
    const local = prefs();
    if (!local) return;
    const owners = local.moduleOwners ||= {};
    const selection = Object.hasOwn(owners,preset) ? owners[preset] : {};
    Object.defineProperty(owners,preset,{value:{...selection,[key]:value},enumerable:true,writable:true,configurable:true});
    saveChatState();
}

export function effectiveModules() {
    const preset = activePreset();
    const modules = { ...DEFAULT_MODULES, ...presetDefaults(preset), ...(chatState()?.v10?.modules || {}) };
    for (const [key, owner] of Object.entries(moduleOwnership(preset))) if (!owner.usesExtension) modules[key] = false;
    return modules;
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
export const formatSpeaker = modules => modules.colors ? 'Use ordinary quoted dialogue and natural speech attribution when a speaker would otherwise be unclear, such as “Wait,” Mira said. Use prose paragraphs for narration and speaker changes. If a character’s thoughts appear, italicize them with single asterisks and identify the thinker naturally where needed. Keep speaker labels and color markup out of the prose.' : '';

export function extractUpdate(raw, { sourceProse, allowPlayerThoughts = false } = {}) {
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
    const issues = [];
    const inputScene = value.scene && typeof value.scene === 'object' && !Array.isArray(value.scene) ? value.scene : {};
    if (value.scene !== undefined && value.scene !== inputScene) issues.push('Scene must be an object.');
    const scene = {};
    for (const key of fields) if (Object.hasOwn(inputScene,key)) {
        if (typeof inputScene[key] === 'string') scene[key] = safeText(inputScene[key],300);
        else issues.push(`Invalid scene field: ${key}.`);
    }
    const elapsed = inputScene.elapsed;
    const minutes = Number.isSafeInteger(inputScene.minutes) && inputScene.minutes >= 0 ? inputScene.minutes : undefined;
    for (const [key,valid] of [['minutes',minutes!==undefined],['elapsed',Number.isInteger(elapsed) && elapsed>=0 && elapsed<=5256000],
        ['ended',typeof inputScene.ended==='boolean']]) if (Object.hasOwn(inputScene,key) && !valid) issues.push(`Invalid scene field: ${key}.`);
    if (value.characters !== undefined && !Array.isArray(value.characters)) issues.push('Characters must be an array.');
    const profiles = (Array.isArray(value.characters) ? value.characters : []).slice(0,8).flatMap(item => {
        const name = safeText(item?.name,90);
        const evidence = safeText(item?.evidence,300);
        if (name && !allowPlayerThoughts && normalize(name) === normalize(names().user)) return [];
        if (!name || evidence.length < 4 || !normalize(sourceProse ?? cleanText).includes(normalize(evidence))) {
            issues.push('A character snapshot lacked a name or evidence in the accepted prose.');
            return [];
        }
        const now = {};
        for (const key of ['mind','heart','body','psyche']) if (Object.hasOwn(item,key)) {
            if (item[key] === null || /^(clear|resolved)$/i.test(clean(item[key]))) now[key] = null;
            else if (typeof item[key] === 'string' && clean(item[key])) now[key] = safeText(item[key],220);
            else issues.push(`Invalid character field: ${key}.`);
        }
        return Object.keys(now).length ? [{name,now,stable:{},temporaryBody:item.bodyLasting!==true,evidence}] : [];
    });
    if (Object.hasOwn(value,'roast') && typeof value.roast!=='string') issues.push('Roast must be text.');
    if (Object.hasOwn(value,'repair') && !Number.isSafeInteger(value.repair)) issues.push('Repair must reference an accepted reply.');
    return {
        clean: cleanText, found:true, scene, profiles, issues, minutes, elapsed: Number.isInteger(elapsed) && elapsed >= 0 && elapsed <= 5256000 ? elapsed : undefined,
        ended: inputScene.ended === true, legacyOutcome:safeText(value.legacyOutcome,400), roast: safeText(value.roast,1000), changes:(value.changes || []).slice(0,12),
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
    if (record.travel && (!Number.isInteger(clock) || clock<record.travel.earliest)) return false;
    if (record.location && normalize(scene?.where) !== normalize(record.location)) return false;
    for (const key of record.requires || []) {
        const prerequisite = rows.get(key);
        if (!prerequisite || (PLOT_KINDS.includes(prerequisite.kind) && prerequisite.status !== 'done' && !(prerequisite.status==='retired' && prerequisite.realized))) return false;
        if (prerequisite.kind === 'knowledge' && prerequisite.basis !== 'observed') return false;
    }
    return true;
}

const commonWords = new Set('with from into that this then they there their were have will would about after before could what when where while present heard saw said observed reported rumor belief completed finishes finish arrived started went gone'.split(' '));
const evidenceTerms = value => normalize(value).match(/[\p{L}\p{N}]+/gu)?.filter(word=>word.length>=4 && !commonWords.has(word)).map(word=>word.replace(/(?:ing|ed|s)$/u,'')) || [];
export function supportsClaim(claim, quote, subject, prose) {
    const who = evidenceTerms(subject);
    const wanted = evidenceTerms(claim).filter(term=>!who.includes(term));
    const supplied = new Set(evidenceTerms(quote));
    const source = normalize(prose), target = normalize(quote);
    const where = source.indexOf(target);
    const nearby = where<0 ? '' : source.slice(Math.max(0,where-110),where+target.length+110);
    const subjectKnown = !subject || mentions(nearby,subject) || evidenceTerms(nearby).some(term=>who.includes(term));
    return subjectKnown && wanted.some(term=>supplied.has(term));
}

export function portrayalSources(rows) {
    const sources = [];
    const context = ctx();
    const card = context.characters?.[context.characterId];
    const name = names().char;
    const text = safeText([card?.personality || card?.data?.personality, card?.description || card?.data?.description].filter(Boolean).join(' · '),650);
    const voice = safeText(card?.mes_example || card?.data?.mes_example,260);
    if (name && (text || voice)) sources.push({name,text,voice,source:'Character card'});
    const base = prefs()?.base;
    const known = [name,...rows.filter(row=>row.on && row.kind==='character').map(row=>row.name),
        ...rows.filter(row=>row.on).map(readRecord).filter(row=>row?.kind==='profile').map(row=>row.subject)];
    for (const entry of Object.values(base?.entries || {})) {
        if (entry.disable || !(entry.extensions?.ri?.kind==='character' || base.pins?.includes(String(entry.uid)))) continue;
        const aliases = Array.isArray(entry.key) ? entry.key.filter(key=>typeof key==='string' && key.trim()) : [];
        const subject = known.find(candidate=>candidate && aliases.some(alias=>normalize(alias)===normalize(candidate)));
        if (subject && entry.content) sources.push({name:subject,text:safeText(entry.content,400),aliases,source:`Base World · ${entry.comment || subject}`});
    }
    for (const row of rows) if (row.on && row.kind==='character' && (row.fields.who || row.fields.role || row.fields.voice)) {
        sources.push({name:row.name,text:row.fields.who || row.fields.role,voice:row.fields.voice,aliases:row.aliases,source:'Story World portrayal'});
    }
    const merged = new Map();
    for (const source of sources) {
        const key = normalize(source.name);
        const prior = merged.get(key) || {name:source.name,sources:[],aliases:[]};
        merged.set(key,{...prior,text:safeText([prior.text,source.text].filter(Boolean).join(' · '),900),voice:prior.voice || source.voice,
            aliases:[...new Set([...prior.aliases,...(source.aliases || [])])].slice(0,8),sources:[...prior.sources,source.source]});
    }
    return merged;
}

export function baselineFor(sources, subject, aliases = []) {
    const labels = [subject,...(Array.isArray(aliases) ? aliases : [])].map(normalize).filter(Boolean);
    return [...(sources?.values() || [])].find(source=>[source.name,...source.aliases].some(name=>labels.includes(normalize(name))));
}

export function effectivePortrayal(record, source) {
    if (!source) return record;
    const next = {...record,baseline:source};
    for (const key of ['text','voice','aliases']) {
        if (!record.protected && !record.profileFields?.[key]?.locked && source[key]?.length) next[key] = source[key];
    }
    return next;
}

export function normalizeRecord(input, { modules, rows, snapshot, evidence, clock, scene, sceneId, baseline, base, manual = false }) {
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
        if (!manual && !supportsClaim(text,quote,record.subject,evidence)) return null;
        record.basis = input.basis;
        record.private = input.private !== false;
        if (!manual && previous?.private) record.private = true;
    }
    if (kind === 'fact') {
        record.aliases = (Array.isArray(input.aliases) ? input.aliases : previous?.aliases || []).filter(alias=>typeof alias === 'string').map(alias=>safeText(alias,90)).filter(Boolean).slice(0,8);
        record.link = validId(input.link) ? input.link : previous?.link;
        const uid = input.baseEntry === '' ? undefined : input.baseEntry ?? previous?.baseEntry;
        if (uid !== undefined && /^\d+$/.test(String(uid))) record.baseEntry = String(uid);
        if (record.baseEntry && !Object.values(base?.entries || {}).some(entry=>String(entry.uid)===record.baseEntry)) return null;
        if (record.baseEntry) record.baseBook = base.name;
        if (record.baseEntry) record.baseRelation = ['extends','updates-present','contradicts'].includes(input.baseRelation) ? input.baseRelation : previous?.baseRelation || 'extends';
        if (!manual && record.baseRelation === 'contradicts') return null;
    }
    if (kind === 'relationship') {
        record.other = safeText(input.other ?? previous?.other,90);
        record.perspective = safeText(input.perspective ?? previous?.perspective,240);
    }
    if (kind === 'profile') {
        record.aliases = [...new Set((Array.isArray(input.aliases) ? input.aliases : previous?.aliases || []).map(alias=>safeText(alias,90)).filter(Boolean))].slice(0,8);
        record.facet = safeText(input.facet ?? previous?.facet,180);
        if (record.facet) record.facetScene = Object.hasOwn(input,'facet') ? sceneId ?? previous?.facetScene : previous?.facetScene;
        record.voice = safeText(input.voice ?? previous?.voice,260);
        record.profileFields = { ...previous?.profileFields };
        if (baseline || previous?.baseline || (manual && input.baseline)) record.baseline = baseline || previous?.baseline || input.baseline;
        const locks = new Set(Array.isArray(input.lockFields) ? input.lockFields : []);
        for (const key of ['text','voice','aliases','facet']) {
            const existing = previous?.[key];
            const authored = baseline?.[key];
            const meta = previous?.profileFields?.[key];
            const changed = JSON.stringify(record[key]) !== JSON.stringify(existing);
            const stale = snapshot && JSON.stringify(snapshot.get(input.id)?.[key]) !== JSON.stringify(existing);
            if (manual && previous && Array.isArray(input.changedFields) && !input.changedFields.includes(key)) record[key] = existing;
            const edited = !Array.isArray(input.changedFields) || input.changedFields.includes(key);
            const locked = manual && edited ? locks.has(key) : !!meta?.locked;
            if (!manual && authored?.length && changed && !locked && !stale) record[key] = existing?.length ? existing : authored;
            if (!manual && (stale || locked || (changed && existing?.length && key !== 'facet' && !input.development))) {
                record[key] = existing;
                if (key === 'facet') record.facetScene = previous?.facetScene;
            }
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
        if (!manual && (previous?.status==='retired' || status==='retired')) return null;
        if (!manual && status === 'done' && previous && !gate(previous,rows,clock,scene)) return null;
        record.status = status;
        record.requires = previous && !manual ? previous.requires : [...new Set((Array.isArray(input.requires) ? input.requires : []).filter(x => validId(x) && x !== input.id))].slice(0,8);
        record.parent = previous && !manual ? previous.parent : validId(input.parent) && input.parent !== input.id ? input.parent : undefined;
        if (record.parent && rows.get(record.parent)?.kind !== 'arc') return null;
        record.location = safeText(previous && !manual ? previous.location : input.location,120);
        const due = previous && !manual ? previous.due : input.due;
        if (Number.isInteger(due) && due >= 0) record.due = due;
        record.schedule = previous && !manual ? previous.schedule : input.schedule === true;
        record.weight = Math.max(1,Math.min(100,Number(previous && !manual ? previous.weight : input.weight) || 1));
        record.spacing = Math.max(0,Math.min(500,Math.floor(Number(previous && !manual ? previous.spacing : input.spacing) || 0)));
        record.payoff = safeText(previous && !manual ? previous.payoff : input.payoff,300);
        if (kind === 'agenda') {
            record.whereabouts = safeText(input.whereabouts ?? previous?.whereabouts,220);
            const trip = !manual && previous?.travel ? previous.travel : input.travel;
            if (trip && (manual || !previous?.travel)) {
                const from = safeText(trip.from,120), to = safeText(trip.to,120);
                if (!from || !to || normalize(from)===normalize(to) || !Number.isSafeInteger(trip.departed) || trip.departed<0 ||
                    !Number.isSafeInteger(trip.minutes) || trip.minutes<1 || !Number.isSafeInteger(trip.departed+trip.minutes)) return null;
                record.travel = {from,to,departed:trip.departed,minutes:trip.minutes,earliest:trip.departed+trip.minutes};
            } else if (trip) record.travel = trip;
            if (!manual && status==='done' && !supportsClaim(record.whereabouts || text,quote,record.subject,evidence)) return null;
            if (!manual && record.travel && status==='done' && (!mentions(quote,record.travel.to) ||
                /\b(?:never arrived|not arrived|not yet (?:at|in)|planned to (?:travel|go)|still en route)\b/i.test(quote))) return null;
        }
        record.realized = status==='done' || (status==='retired' && (previous?.status==='done' || previous?.realized===true));
        record.outcome = record.realized ? safeText(input.outcome ?? previous?.outcome,400) || quote : '';
        if (!manual && status === 'done') {
            if (!gate(record,rows,clock,scene)) return null;
            if (kind !== 'agenda' && !supportsClaim(safeText(input.outcome,400) || text,quote,record.subject,evidence)) return null;
        }
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
    const root = chatState();
    const data = {entries:{}};
    if (root?.carried) {
        const chapter = newWorldEntry(data,'chapter');
        Object.assign(chapter,{name:'The story before this chat',rollup:true,span:{chat:root.chapterOf || '',from:1,to:0},
            activation:{mode:'window',window:6,keys:[root.sceneSeed?.where].filter(Boolean)}});
        chapter.fields.summary = root.carried;
        writeWorldEntry(data,chapter,label);
    }
    const id = await createSet(label,'world',data,'');
    if (ctx().getCurrentChatId?.() !== chatId) throw new Error('The chat changed while creating the story book.');
    if (!chatWorld()) {
        if (root?.carried) delete root.carried;
        setChatWorld(id);
    }
    return chatWorld();
}

function managedBookName() {
    const world = chatWorld();
    return world ? setInfo(world).book : '';
}

export function reusableBookNames() {
    const managed = managedBookName();
    return worldNames().filter(name=>name!==managed);
}

export async function uploadBaseBook(file) {
    const local = prefs();
    if (!local || !(enabledV10() || memoryOnly() && memoryComponents().world)) throw new Error('Enable World Info before importing a Base World book.');
    let data;
    try { data = JSON.parse(await file.text()); }
    catch { throw new Error('Choose a valid World Info JSON export.'); }
    if (prefs() !== local) throw new Error('The chat changed.');
    if (!data?.entries || typeof data.entries !== 'object' || Array.isArray(data.entries)) {
        throw new Error('Choose a SillyTavern or TauriTavern World Info JSON export with an entries object.');
    }
    const entries = Object.values(data.entries);
    if (entries.some(entry=>!entry || !Number.isSafeInteger(entry.uid) || typeof entry.content !== 'string' || !Array.isArray(entry.key))
        || new Set(entries.map(entry=>entry.uid)).size !== entries.length) {
        throw new Error('Invalid World Info entries. Import other formats through the host World Info menu first.');
    }
    const base = cleanSetName(file.name.replace(/\.json$/i,'')).replace(/^\.+|\.+$/g,'').trim() || 'Base World';
    const taken = new Set(worldNames().map(name=>name.toLocaleLowerCase()));
    let name = base;
    for (let i=2; taken.has(name.toLocaleLowerCase()); i++) name = `${base} (${i})`;
    await saveBook(name,data);
    await refreshWorldList();
    if (!worldNames().includes(name)) throw new Error('The host did not confirm that the lorebook was saved.');
    if (prefs() !== local) throw new Error(`Imported "${name}". Select it in the intended chat to pin it.`);
    await pinBase(name);
    return name;
}

function rememberReusableBook(name) {
    const root = chatState();
    if (root && name) root.reusableBookHistory = [...new Set([...(root.reusableBookHistory || []),name])];
}

export function selectGuidelines(name) {
    const local = prefs();
    if (!local) return;
    rememberReusableBook(local.guidelines);
    local.guidelines = name;
    rememberReusableBook(name);
    saveChatState();
}

export async function pinBase(name) {
    const local = prefs();
    if (!local) throw new Error('Open a chat first.');
    if (name && name === managedBookName()) throw new Error('Choose a book separate from this chat’s managed Story World.');
    const data = name ? await loadBook(name) : null;
    if (prefs() !== local) throw new Error('The chat changed.');
    if (name && !data?.entries) throw new Error('Could not read the base book.');
    rememberReusableBook(local.base?.name);
    rememberReusableBook(name);
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
        modules.state && 'scene: {"where":"...","when":"...","time":"...","date":"...","weather":"...","present":"comma-separated names","environment":"...","minutes":0,"elapsed":0,"ended":false}. Use time, date, location (where), and weather only when the story establishes them. Use when for approximate timing. Use an empty environment string when a condition resolves. minutes is an exact absolute story minute; elapsed adds minutes to a known clock. Use approximate when if timing is uncertain.',
        kinds.length && `changes: an array of up to 12 objects with kind (${kinds.join(', ')}), id (stable slug, reuse existing IDs), text, subject when describing someone, and evidence (an exact quote from the accepted prose). Record meaningful changes, not repetition.`,
        modules.state && 'characters: optional array of present characters with name and an exact evidence quote, plus changed mind (focus), heart (felt emotion), body (current physical condition, or null on recovery), or psyche (salient internal tension). Set bodyLasting:true only for an established durable condition. Omit unsupported dimensions and leave the player’s private state to the player.',
        modules.state && 'For profiles include voice, aliases or current facet when applicable. Set development:true only for lasting character growth that the reply establishes. Preserve card canon and player edits. Keep transient setbacks out of durable facts. A fact may link to the plot record that established it and reference a known baseEntry and baseRelation (extends or updates-present).',
        modules.relationships && 'For a relationship use subject and other for the two people. Consider relevant relationships in dialogue and choices. Use perspective for meaningful asymmetry and record only lasting dynamics or turning points.',
        modules.knowledge && 'For knowledge include basis: observed, reported, rumor or belief; private defaults to true. Quote the passage that establishes who learned the information and what they learned. Preserve rumors as rumors.',
        modules.emotions && 'For emotion include axes (tenderness, fury, dread, yearning, each 0–10 or omitted) and optional outward behavior. Consider every applicable dimension without forcing each to change or be displayed.',
        (modules.plots || modules.worldEvents) && 'For plot and event records use status open or done. Record an outcome only on completion. An offer or deadline alone does not establish completion.',
        modules.plots && 'For arcs, seeds and agendas, optional fields are parent (arc ID), requires (record IDs), due (absolute story minute), location and payoff. An agenda can include established whereabouts and a travel object with from, to, departed (exact story minute), and minutes (minimum duration), when timing and travel are established.',
        modules.plots && modules.worldEvents && 'Use schedule:true with optional weight and spacing in replies only when a future opportunity should be surfaced.',
        modules.roast && 'roast: optional short out-of-story voice critique when it adds value.',
    ].filter(Boolean);
    if (!sections.length) return '';
    return `After the visible prose, ${opening ? 'include' : 'when information changed, append'} one <story_update v="2"> JSON object with v:2 and only applicable fields </story_update>. No code fence.\n${sections.join('\n')}`;
}

export function prepareTurn(rows, scene, type, modules, check, { schedule = false, recallFacts = true } = {}) {
    const history = previousV10(type);
    const latest = history.at(-1);
    const sceneId = latest?.record.v10SceneEnded ? null : latest?.record.v10SceneId ?? latest?.record.time;
    const clock = [...history].reverse().find(x => Number.isInteger(x.record.v10Minutes))?.record.v10Minutes ?? chatState()?.v10ClockSeed;
    const records = recordMap(rows);
    const policy = recallPolicy(chatWorld(),type);
    const exposure = new Map(rows.map(entry=>[readRecord(entry)?.id,{entry,...policy(entry)}]).filter(([id])=>id));
    const baselines = modules.state ? portrayalSources(rows) : new Map();
    const recent = (ctx().chat || []).slice(0, ['swipe','regenerate'].includes(type) ? -1 : undefined).slice(-5).map(m => m.mes).join('\n');
    const context = normalize(`${scene?.where || ''} ${scene?.present || ''} ${recent}`);
    const cast = normalize(scene?.present);
    const matches = subject => mentions(context,subject);
    const relevant = [];
    const recalled = [];
    const plotAudit = [];
    const local = prefs() || {};
    let offer;
    for (const saved of records.values()) {
        const row = saved.kind === 'profile' ? effectivePortrayal(saved,baselineFor(baselines,saved.subject,saved.aliases)) : saved;
        const decision = exposure.get(row.id);
        if (!modules[KIND_MODULE[row.kind]] || (!recallFacts && row.kind==='fact') || decision?.on===false) continue;
        const eligible = gate(row,records,clock,scene);
        if (PLOT_KINDS.includes(row.kind)) {
            if (row.status === 'retired' && !row.realized) continue;
            if (row.kind === 'agenda' && !matches(row.subject) && !(row.due !== undefined && eligible)) continue;
            if (row.kind === 'event' && row.status !== 'done' && !row.realized) continue;
            if ((row.status === 'done' || row.realized) && ![row.subject,...(row.aliases || []),row.location,...row.text.split(/[^\p{L}\p{N}]+/u).filter(x=>x.length>=5)].some(matches)) continue;
            if (row.status==='open') plotAudit.push({id:row.id,eligible,recalled:false});
            const text = `${row.id} [${row.kind}, ${row.status}${row.parent ? `, arc ${row.parent}` : ''}${eligible ? '' : ', prerequisites pending'}]: ${row.text}${row.whereabouts ? ` Whereabouts: ${row.whereabouts}` : ''}${row.travel ? ` Travel from ${row.travel.from} to ${row.travel.to}. Earliest arrival: story minute ${row.travel.earliest}.` : ''}${row.outcome ? ` Outcome: ${row.outcome}` : ''}`;
            relevant.push({record:row,text});
        } else if (row.kind === 'knowledge' && row.private && !mentions(cast,row.subject)) {
            continue;
        } else if (decision?.entry.activation || !row.subject || [row.subject,row.other,...(row.aliases || [])].some(matches)) {
            let suffix = '';
            if (row.kind === 'profile') suffix = `${row.voice ? ` Voice: ${row.voice}` : ''}${row.facet && row.facetScene!=null && row.facetScene===sceneId ? ` Current facet: ${row.facet}` : ''}`;
            if (row.kind==='fact' && row.baseEntry) {
                const canonical = !row.baseBook || row.baseBook===local.base?.name
                    ? Object.values(local.base?.entries || {}).find(entry=>String(entry.uid)===row.baseEntry) : undefined;
                if (canonical) suffix = ` ${row.baseRelation==='updates-present' ? 'Current condition building on' : row.baseRelation==='contradicts' ? 'Player correction in this chat conflicts with' : 'Builds on'} Base World entry ${canonical.uid} (${canonical.comment || canonical.key?.[0] || 'untitled'}).`;
            }
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
        const status = plotAudit.find(row=>row.id===item.record.id);
        if (status) status.recalled = true;
        cost += item.text.length + 1;
    }
    if (schedule && modules.plots && modules.worldEvents) {
        const candidates = [...records.values()].filter(row => PLOT_KINDS.includes(row.kind) && row.status === 'open' && row.schedule && exposure.get(row.id)?.on!==false && gate(row,records,clock,scene) &&
            (!row.spacing || !history.slice(-row.spacing).some(item => item.record.v10Offer === row.id)));
        const total = candidates.reduce((sum,row) => sum + row.weight,0);
        let draw = total ? rollInt(total) : 0;
        offer = candidates.find(row => (draw -= row.weight) < 0);
    }
    const repair = type==='normal' && latest?.record.v10Invalid && !latest.record.v10RepairAttempt
        ? { id:latest.record.time, text:safeText(latest.message.mes,1600) } : null;
    const feedback = modules.roastFeedback ? history.filter(x => x.record.roast).slice(-2).map(x => safeText(x.record.roast,300)) : [];
    const style = local.style ?? defaultWritingGuidance();
    const baseline = [...baselines.values()].filter(source=>
        (normalize(source.name)===normalize(names().char) || [source.name,...source.aliases].some(matches)) &&
        !recalled.some(item=>item.record.kind==='profile' && baselineFor(baselines,item.record.subject,item.record.aliases)===source))
        .slice(0,8).map(source=>`${source.name}: ${[source.text,source.voice && `Voice: ${source.voice}`].filter(Boolean).join(' · ')}`);
    const paired = pairedPreset();
    const format = paired
        ? (local.generatePlan
            ? 'If useful, put a brief outline of intended beats, character focus, and continuity checks in one <reply_plan> block before the story prose. Use up to five short bullets, then close it with </reply_plan>. Use the story update for established state.'
            : 'Begin with the story prose. Keep planning outside the visible reply. Follow the story update format below when applicable.')
        : '';
    const text = [
        format, modules.style && style, formatSpeaker(modules),
        paired && modules.knowledge && 'Respect what each character could know from their own observations and conversations.',
        paired && modules.plots && 'Let off-screen activity matter when it reaches the scene.', modules.emotions && `Consider established emotional dimensions and outward bearing. Sensitivity: ${local.emotion?.sensitivity || 'flexible'}. Credible sudden or mixed reactions are welcome.`,
        baseline.length && `Established portrayal takes precedence over general style:\n${baseline.slice(0,8).join('\n')}`,
        plotAudit.some(row=>!row.eligible && row.recalled) && 'Pending prerequisites constrain reveals and payoffs, including when introducing a required or optional event.',
        recalled.length && `Established records (respect private knowledge and protected portrayal):\n${recalled.map(x=>x.text).join('\n')}`,
        modules.state && Number.isInteger(clock) && `Current exact story minute: ${clock}.`,
        checkText(check), feedback.length && `Out-of-story voice feedback, not canon:\n${feedback.join('\n')}`,
        repair && `If supported, recover a missing state change from accepted reply ${repair.id}, using exact evidence and placing it in repairChanges alongside "repair":${repair.id}. Keep new changes in changes. Respect newer facts. Prior prose: ${JSON.stringify(repair.text)}`,
        updateContract(modules),
    ].filter(Boolean).join('\n');
    return { text, offer, repair, records, clock, check, modules, recalled, recallFresh:recalled.flatMap(item=>{const hit=exposure.get(item.record.id);return hit?.fresh ? [String(hit.entry.uid)] : [];}), baselines, base:local?.base, plotAudit };
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

export function guidelineEligible(entry, local, scene, modules) {
    const scopes = local.guidelineScopes;
    const scope = scopes && Object.hasOwn(scopes,local.guidelines) ? scopes[local.guidelines][entry.uid] : undefined;
    return scope?.enabled !== false && (!scope?.module || modules[scope.module]) &&
        (!scope?.character || mentions(scene?.present,scope.character)) &&
        (!scope?.location || mentions(scene?.where,scope.location));
}

export async function addConfiguredBooks(lore, arrays, scene, modules, { base = true, guidelines = true } = {}) {
    const local = chatState()?.v10;
    if (!local || !Array.isArray(lore.chatLore)) return;
    if (base && local.base) {
        for (const list of arrays) for (let i=list.length-1;i>=0;i--) if (list[i].world === local.base.name) list.splice(i,1);
        const opening = !(ctx().chat || []).some(message=>message.is_user && message !== ctx().chat.at(-1));
        lore.chatLore.push(...Object.values(local.base.entries || {}).map(entry => ({
            ...structuredClone(entry), world:local.base.name,
            ...(opening && local.base.pins?.includes(String(entry.uid)) && !entry.disable ? {constant:true} : {}),
        })));
    }
    if (guidelines && local.guidelines && local.guidelines !== local.base?.name) {
        const byId = new Map();
        for (const list of arrays) for (let i=list.length-1;i>=0;i--) if (list[i].world === local.guidelines) {
            const [entry] = list.splice(i,1);
            byId.set(entry.uid,entry);
        }
        if (local.guidelinesOn !== false) {
            const data = byId.size ? {entries:Object.fromEntries(byId)} : await loadBook(local.guidelines).catch(() => null);
            if (Array.isArray(lore.chatLore)) lore.chatLore.push(...Object.values(data?.entries || {})
                .filter(entry=>guidelineEligible(entry,local,scene,modules))
                .map(entry=>({ ...entry, world:local.guidelines })));
        }
    }
}

const PALETTE = ['#7DA8FF','#95FFCA','#FF85E8','#40E8FF','#D7AAFF','#99FF75','#A8B4FF','#FF66F5','#68FFEC','#F58CFF','#C49BFF','#35F6E7','#F5A0EB','#55D8FF','#BB99FF','#7AFF98','#8FEAFF','#DE8CFF','#40FFD8','#80C4FF','#60FFBA'];
export function registerSpeakers(prose, records) {
    const local = prefs();
    const spoken = [...new Set([...dialogueAttributions(prose),...thoughtAttributions(prose)].map(match=>match.name).filter(Boolean))];
    if (!local || !spoken.length) return;
    const speakers = local.speakers ||= {};
    const profiles = [...(records?.values() || [])].filter(row=>row.kind==='profile');
    const used = new Set(Object.values(speakers).map(value=>value.color));
    const player = normalize(names().user);
    let changed = false;
    for (const display of spoken) {
        const normalized = normalize(display);
        if (normalized === player) continue;
        const known = profiles.find(row=>[row.subject,...(row.aliases || [])].some(alias=>normalize(alias)===normalized));
        const key = known ? `profile:${known.id}` : `speaker:${normalized}`;
        const aliases = [...new Set([normalized,...(known?.aliases || []).map(normalize),normalize(known?.subject || display)])];
        const prior = speakers[key] || Object.values(speakers).find(value=>value.aliases.some(alias=>aliases.includes(alias)));
        if (prior) {
            if (aliases.some(alias=>!prior.aliases.includes(alias))) {
                prior.aliases = [...new Set([...prior.aliases,...aliases])];
                changed = true;
            }
            continue;
        }
        const color = PALETTE.find(value=>!used.has(value)) || PALETTE[Object.keys(speakers).length % PALETTE.length];
        speakers[key] = {name:known?.subject || display,aliases,color};
        used.add(color);
        changed = true;
    }
    if (changed) saveChatState();
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
    if (!enabledV10() || !local || isGenerating()) throw new Error('Choose the Structured story workflow and wait for the current reply to finish.');
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
    const guidelineData = local.guidelines && local.guidelinesOn !== false ? await loadBook(local.guidelines) : null;
    const guidance = selectEntries(Object.values(guidelineData?.entries || {}).filter(entry=>
        guidelineEligible(entry,local,{present:`${names().char}, ${names().user}`},modules)));
    const source = [base && `Pre-opening canon:\n${base}`,...cardSource,persona && `Player persona:\n${persona}`,guidance && `Selected writing guidance:\n${guidance}`].filter(Boolean).join('\n').slice(0,15000);
    const writing = modules.style ? local.style ?? defaultWritingGuidance() : '';
    const companionWriting = pairedPreset() && !text ? (activeHostPrompts() || [])
        .filter(block=>block.enabled && COMPANION_WRITING_BLOCKS.has(block.name)).map(block=>block.content).join('\n') : '';
    const openingPermission = local.openingPlayerThoughts === true
        ? 'For this opening only, the player authorizes writing their viewpoint thoughts in single asterisks. Leave their dialogue and consequential actions open.'
        : 'The player supplies their own thoughts, dialogue, and choices.';
    const format = [companionWriting,local.opening ?? OPENING,writing,formatSpeaker(modules),openingPermission].filter(Boolean).join('\n');
    const user = [
        text ? 'Extract scene state from the chosen greeting. Return only the update block. Preserve what the greeting establishes and do not invent facts.' : format,
        `Character: ${names().char}. Player: ${names().user}.`, source && `Source material:\n${source}`,
        text && `Chosen greeting:\n${text}`, direction && `Opening direction:\n${safeText(direction,2000)}`,
        updateContract(modules,true),
    ].filter(Boolean).join('\n\n');
    const result = await request({ what:text ? 'Read greeting for story state' : 'Draft story opening', system:'Create or analyze the opening of this roleplay. Follow the requested output format.', user, tokens:text?1200:2200, profileId:settings().profileId });
    if (prefs() !== local) throw new Error('The chat changed.');
    const output = pairedPreset() ? separateReply(result.text).text : result.text;
    const parsed = extractUpdate(output,{sourceProse:text || undefined,allowPlayerThoughts:local.openingPlayerThoughts===true});
    const prose = text || parsed?.clean || output.trim();
    result.note(prose ? 'Opening draft is ready for review.' : 'The result did not contain an opening.',!!prose);
    if (!prose) throw new Error('No opening was returned. Try a new draft.');
    return { prose, parsed, original:prose };
}
