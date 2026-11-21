import { DEFAULT_STORY_AVOID } from './defaults.js';
import { orderedSections } from './module-layout.js';
import { correctedLoreEntry, characterCorrectionFields, isRejectedStoryClaim } from './correction-rules.js';
import { BOOK_TRIGGER_SOURCES, bookTriggerSource, reusableKeywordMatch } from './book-triggers.js';
import { recallPolicy, recallTiming } from './recall.js';
import { memoryOnly, memoryComponents } from './components.js';
import { dialogueAttributions, thoughtAttributions } from './dialogue.js';
import { separateReply } from './reply-format.js';
import { validStoryMinute, validElapsed } from './story-clock.js';
import { promptText, roastVoiceText } from './prompts.js';
// V10's canonical update contract and chat-local configuration.
import { ctx, KEY, names, loadBook, saveBook, refreshWorldList, worldNames, isGenerating, isReply } from './st.js';
import { chatState, settings, saveChatState } from './store.js';
import { rollInt, createSet, cleanSetName, setInfo, setOfEntry } from './books.js';
import { chatWorld, setChatWorld, listWorld, newWorldEntry, writeWorldEntry } from './world.js';
import { loadEffectiveWorld, worldBeforeGeneration } from './worldflow.js';
import { statNames, sheet } from './dice.js';

export const PRESET = 'Roleplay Instructions V10';
export const isCompanionPreset = name => /^Roleplay Instructions V10(?:\.\d+)*$/i.test(String(name || '').trim());
export const pairedPreset = () => enabledV10() && isCompanionPreset(activePreset());
export const MODULES = {
    style: 'Live writing guidance', preflight: 'Scene and character checks', state: 'Story, scene and character state', knowledge: 'Character knowledge', emotions: 'NPC emotion scales',
    relationships: 'Relationships', plots: 'Arcs, seeds and off-screen agendas', worldEvents: 'Autonomous world events',
    dice: 'Explicit action checks', colors: 'Dialogue colors', roast: 'Roast generation', roastFeedback: 'Roast feedback in future prompts',
};
export const DEFAULT_MODULES = {
    style: true, preflight: true, state: true, knowledge: true, emotions: true, relationships: true, plots: true, worldEvents: true,
    dice: true, colors: true, roast: false, roastFeedback: false,
};
export const STYLE = 'Write direct, concrete fiction. Give the current cast distinct voices and independent motives. Show actions and speech, respect viewpoint knowledge, and leave the player’s speech, thoughts and choices to the player. End with an in-world action or development that gives the player room to respond. Most people are generally well, rested and capable; transient setbacks usually resolve quickly. Let significant moments breathe and skip uneventful intervals when appropriate.';
const COMPANION_STYLE = 'Treat good health and rest as normal. Minor setbacks usually resolve quickly. Carry a lasting limitation only when the story establishes one.';
const COMPANION_WRITING_BLOCKS = new Set(['Viewpoint & player agency','Cast, motives & voice','Scene progression & pacing','Prose & dialogue craft','Consequences, combat & payoffs', 'Decisive NPCs', 'Recurring NPC creation', 'Voice continuity', 'Same-reply quality checks', 'Slow-burn scene profile', 'Player-limited viewpoint']);
export const defaultWritingGuidance = () => pairedPreset() ? COMPANION_STYLE : STYLE;
export const PREFLIGHT = 'Apply the enabled checks to the prose itself. Use the established scene and cast to decide which checks matter on this turn.';
export const SCENE_CHECKS = {physical:'Physical realism',social:'Social realism and character fidelity',craft:'Pacing and prose',continuity:'Information and continuity'};
const HOST_SCENE_CHECKS = {physical:'ri-check-physical',social:'ri-check-social',craft:'ri-check-craft',continuity:'ri-check-continuity'};
export const sceneCheckId = key => 'check'+key[0].toUpperCase()+key.slice(1);
export const WRITING_PROFILES = {
    grounded: 'groundedRealism',
    heightened: 'heightenedRealism',
};
export const writingProfileText = key => Object.hasOwn(WRITING_PROFILES,key) ? promptText(WRITING_PROFILES[key]) : '';
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
export function baseWorld(local = chatState()?.v10) {
    const base = local?.base;
    return base && (!ctx().getWorldInfoNames || worldNames().includes(base.name)) ? base : null;
}
export function enabledV10() {
    const local = chatState()?.v10?.enabled;
    return settings().enabled && !memoryOnly() && (local ?? isCompanionPreset(activePreset()));
}
export const HOST_OVERLAPS = {
    style: ['Prose Rules','Realistic Bold NPCs','HQ NPC Creation','NPC Voice','Prose Lint Functions','Output Length','Card Fidelity','🎭 Card Fidelity 🃏','Gemini Pacing Nerf','Realism Mode/Jailbreak','[Gemini] Realism NSFW/Jailbreak'],
    preflight: ['Antithesis - Boot','Antithesis - Mechanics','Antithesis - Router','Antithesis - Helper Functions','Antithesis - Pages','Antithesis - Tail/Output'],
    dice: ['D&D Sim','Dice Rolls'],
    worldEvents: ['World Sim'],
    plots: ['World Sim','Internal States Template','World Turns','ARC Engine',"Chekhov's Gun"],
    state: ['Internal States Template'],
    knowledge: ['Internal States Template'],
    emotions: ['Internal States Template','Aether Sola','Aether Tide'],
    relationships: ['Internal States Template','Aether Matrix','Aether Dam'],
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
        return prompt ? [{id:entry.identifier,name:prompt.name || entry.identifier, enabled:entry.enabled===true, content:prompt.content || '', marker:!!prompt.marker}] : [];
    });
}

export function hostSceneChecks() {
    if (!pairedPreset() || explicitOwner(activePreset(),'preflight') === 'both') return {};
    const enabled = new Map(activeHostPrompts()?.filter(block=>block.enabled).map(block=>[block.id,block.name]) || []);
    return Object.fromEntries(Object.entries(HOST_SCENE_CHECKS).flatMap(([key,id])=>enabled.has(id) ? [[key,enabled.get(id)]] : []));
}

function explicitOwner(preset, key) {
    const owners = chatState()?.v10?.moduleOwners;
    return owners && Object.hasOwn(owners,preset) ? owners[preset]?.[key] : undefined;
}
// Suggestions for third-party blocks. The rest of a preset can contain unrelated behavior.
const REFERENCE_PAIRS = {
    'sola chatterbox':['roast'], "sola's story review":['preflight'], 'lightning story review':['preflight'],
    'thought engine':['state'], 'carried inventory':['state'], 'status':['state'],
    'psychological states':['emotions'], 'hidden truths':['knowledge'], 'anti-omniscience':['knowledge'],
    'meanwhile':['plots'], 'plotlines':['plots'], 'story threads':['plots'], 'dialogue color':['colors'],
    'character realism':['preflight','style'], 'new faces':['state'], "phi's scratchpad":['roastFeedback'],
    'chi, the best friend':['roast'], 'lou, the detective':['roast'], 'sam, the gamer':['roast'],
    'grace, the screenwriter':['roast'], 'layla, the weeb':['roast'], 'phi, the story master':['roast'], 'sola, the enthusiast':['roast'],
};
export function blockCompanions(block,preset=activePreset()) {
    const pairs = settings().promptPairs;
    const manual = pairs && Object.hasOwn(pairs,preset) ? pairs[preset] : null;
    if (manual && Object.hasOwn(manual,block.id)) return manual[block.id].filter(key=>Object.hasOwn(MODULES,key));
    if (block.id.startsWith('ri-check-') || block.id==='ri-craft-checks') return ['preflight'];
    if (block.id.startsWith('ri-craft-')) return ['style'];
    const normalized=block.name.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'');
    if (Object.hasOwn(REFERENCE_PAIRS,normalized)) return REFERENCE_PAIRS[normalized];
    return Object.keys(HOST_OVERLAPS).filter(key=>HOST_OVERLAPS[key].some(name=>name.toLowerCase()===block.name.trim().toLowerCase()));
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
        ownership[module] = {blocks,choice,usesExtension:choice==='both' || choice==='extension' && !blocked,blocked};
    }
    for (const key of Object.keys(MODULES)) {
        if (!ownership[key] && ['both','preset'].includes(choices?.[key])) {
            const blocks = (hostBlocks || []).filter(row=>blockCompanions(row,preset).includes(key)).map(row=>({name:row.name,enabled:row.enabled,blocks:[row]}));
            ownership[key] = {choice:choices[key],blocks,usesExtension:choices[key]==='both',blocked:blocks.some(row=>row.enabled)};
        }
    }
    return ownership;
}

export function setModuleOwner(preset, key, value) {
    if (!Object.hasOwn(MODULES,key) || !['preset','extension','both',undefined].includes(value) || !preset) return;
    const local = prefs();
    if (!local) return;
    const owners = local.moduleOwners ||= {};
    const selection = Object.hasOwn(owners,preset) ? owners[preset] : {};
    const next={...selection};
    if (value===undefined) delete next[key]; else next[key]=value;
    Object.defineProperty(owners,preset,{value:next,enumerable:true,writable:true,configurable:true});
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
export const formatSpeaker = modules => modules.colors ? promptText('speakerGuidance') : '';

export function extractUpdate(raw, { sourceProse, allowPlayerThoughts = false } = {}) {
    const text = String(raw || '');
    const start = TAG.exec(text);
    if (!start || !/\bv\s*=/i.test(start[1])) return null;
    const tail = text.slice(start.index + start[0].length);
    const end = END.exec(tail);
    const remainder = end ? tail.slice(end.index + end[0].length) : '';
    const cleanText = (text.slice(0,start.index) + remainder.replace(/<story_update\b[^>]*>[\s\S]*?(?:<\/story_update\s*>|$)/gi,'')).trimEnd();
    let value;
    try { value = end && JSON.parse(tail.slice(0,end.index).trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i,'$1')); } catch { /* captured below */ }
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
    const minutes = validStoryMinute(inputScene.minutes) ? inputScene.minutes : undefined;
    for (const [key,valid] of [['minutes',minutes!==undefined],['elapsed',validElapsed(elapsed)],
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
        clean: cleanText, found:true, scene, profiles, issues, minutes, elapsed:validElapsed(elapsed) ? elapsed : undefined,
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
    const correctedCard = new Map(characterCorrectionFields().map(({field,after})=>[field,after]));
    const text = safeText(['personality','description'].map(field=>correctedCard.get(field) ?? card?.[field] ?? card?.data?.[field]).filter(Boolean).join(' · '),650);
    const voice = safeText(card?.mes_example || card?.data?.mes_example,260);
    if (name && (text || voice)) sources.push({name,text,voice,source:'Character card'});
    const base = baseWorld();
    const known = [name,...rows.filter(row=>row.on && row.kind==='character').map(row=>row.name),
        ...rows.filter(row=>row.on).map(readRecord).filter(row=>row?.kind==='profile').map(row=>row.subject)];
    for (const original of Object.values(base?.entries || {})) {
        const entry = correctedLoreEntry(original,base.name);
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
    if (!manual && ['fact','profile'].includes(kind) && isRejectedStoryClaim(text)) return null;
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
        record.target = safeText(input.target ?? previous?.target,90);
        if (!manual && previous?.target && normalize(record.target)!==normalize(previous.target)) return null;
        record.axes = { ...previous?.axes };
        for (const key of AXES) if (Number.isInteger(input.axes?.[key]) && input.axes[key] >= 0 && input.axes[key] <= 10) record.axes[key] = input.axes[key];
        record.outward = safeText(input.outward ?? previous?.outward,180);
        record.counterweight = safeText(input.counterweight ?? previous?.counterweight,180);
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

const normalizeAvoid = value => normalize(value).replace(/[^\p{L}\p{N}]+/gu,' ').trim();

export function avoidPhrases(value = DEFAULT_STORY_AVOID) {
    const byWording = new Map();
    for (const line of clean(value).split(/\r?\n/)) {
        const phrase = line.trim();
        const key = normalizeAvoid(phrase);
        if (key && !byWording.has(key)) byWording.set(key, phrase);
    }
    return [...byWording.values()];
}

const DIRECT_PROSE = 'Describe what characters say, do, and notice. Show a remark’s effect through a consequential choice, action, or answer. Respond to the player’s meaning in the character’s own words. Preserve an absence or refusal when it changes the scene.';

const proseWords = value => value.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu) || [];
const firstWords = value => proseWords(normalize(value)).slice(0,7).join(' ');
const questionEnding = value => /\?[”"'’*]*\s*$/.test(value);

export function replyDiagnostics(prose, {recent = [], avoid = DEFAULT_STORY_AVOID, metrics = false} = {}) {
    const lines = prose.split(/(?<=[.!?])\s+/).map(normalize).filter(x => x.length >= 24);
    const repeats = [...new Set(lines.filter((line,i) => lines.indexOf(line) < i))];
    const malformed = prose.split('\n').filter(line => /^\[[^\]\n]{1,64}\][ \t]*[“"]/.test(line) && !/(?:“[^”]+”|"[^"]+")/.test(line)).length;
    const wording = ` ${normalizeAvoid(prose)} `;
    const marked = avoidPhrases(avoid).filter(phrase=>wording.includes(` ${normalizeAvoid(phrase)} `));
    const opening = firstWords(prose);
    const repeatedOpening = proseWords(opening).length===7 && recent.some(text=>firstWords(text)===opening);
    const repeatedQuestions = questionEnding(prose) && recent.filter(questionEnding).length>=2;
    const words = metrics ? proseWords(prose).length : 0;
    const quoted = words ? [...prose.matchAll(/“([^”]+)”|"([^"\n]+)"/gu)].reduce((sum,quote)=>sum+proseWords(quote[1] || quote[2]).length,0) : 0;
    return [
        malformed && `${malformed} speaker line${malformed === 1 ? '' : 's'} with unclosed quotation marks.`,
        repeats.length && `${repeats.length} repeated sentence${repeats.length === 1 ? '' : 's'}.`,
        marked.length && `Phrases on this chat’s avoid list: ${marked.join(', ')}.`,
        repeatedOpening && 'The opening repeats the first seven words of a recent reply.',
        repeatedQuestions && 'This and at least two recent replies end in a question.',
        words && `${words} words · about ${Math.round(quoted/words*100)}% in quotation marks.`,
    ].filter(Boolean);
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

export async function uploadReusableBook(file, role = 'base') {
    const local = prefs();
    if (!local || !(enabledV10() || memoryOnly() && memoryComponents().world && role !== 'guidelines')) {
        throw new Error('Enable the corresponding World Info workflow before importing a book.');
    }
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
    for (const entry of entries) {
        const chance = entry.probability;
        if (typeof chance==='number' && chance>=0 && chance<100 && entry.useProbability===undefined) entry.useProbability = true;
    }
    const base = cleanSetName(file.name.replace(/\.json$/i,'')).replace(/^\.+|\.+$/g,'').trim() || 'World Info';
    const taken = new Set(worldNames().map(name=>name.toLocaleLowerCase()));
    let name = base;
    for (let i=2; taken.has(name.toLocaleLowerCase()); i++) name = `${base} (${i})`;
    await saveBook(name,data);
    await refreshWorldList();
    if (!worldNames().includes(name)) throw new Error('The host did not confirm that the lorebook was saved.');
    if (prefs() !== local) throw new Error(`Imported "${name}". Assign it in the intended chat.`);
    if (role === 'base') await pinBase(name);
    else assignReusableBook(name, role);
    return name;
}

function rememberReusableBook(name) {
    const root = chatState();
    if (root && name) root.reusableBookHistory = [...new Set([...(root.reusableBookHistory || []),name])];
}

export const uploadBaseBook = file => uploadReusableBook(file, 'base');

export const reusableBookRoles = { guidelines: 'Behavior & Guidelines', reference: 'Knowledge & Reference' };

export function reusableAssignments(local = chatState()?.v10) {
    const legacy = local?.guidelines ? [{ name: local.guidelines, role: 'guidelines', on: local.guidelinesOn !== false }] : [];
    return (local?.reusableBooks || legacy).filter(book => book.name !== local?.base?.name);
}

export function assignReusableBook(name, role, on = true) {
    const local = prefs();
    if (!local) return;
    if (!name || name === managedBookName() || name === local.base?.name) throw new Error('Choose a separate World Info book.');
    if (!Object.hasOwn(reusableBookRoles, role)) throw new Error('Choose a book role.');
    const assigned = reusableAssignments(local);
    const book = { name, role, on };
    local.reusableBooks = assigned.some(existing => existing.name === name)
        ? assigned.map(existing => existing.name === name ? book : existing) : [...assigned, book];
    const root = chatState();
    if (root.excludedHostBooks) root.excludedHostBooks = root.excludedHostBooks.filter(book=>book!==name);
    rememberReusableBook(name);
    saveChatState();
}

export function unassignReusableBook(name) {
    const local = prefs();
    if (!local) return;
    local.reusableBooks = reusableAssignments(local).filter(book => book.name !== name);
    saveChatState();
}

export function selectGuidelines(name) {
    if (name) assignReusableBook(name, 'guidelines');
}

export async function pinBase(name) {
    const local = prefs();
    if (!local) throw new Error('Open a chat first.');
    if (reusableAssignments(local).some(book => book.name === name)) throw new Error('Unassign this reusable book before selecting it as Base World.');
    if (name && name === managedBookName()) throw new Error('Choose a book separate from this chat’s managed Story World.');
    const data = name ? await loadBook(name) : null;
    if (prefs() !== local) throw new Error('The chat changed.');
    if (name && !data?.entries) throw new Error('Could not read the base book.');
    rememberReusableBook(local.base?.name);
    rememberReusableBook(name);
    local.base = name ? { name, entries:structuredClone(data.entries), pins:local.base?.name === name ? local.base.pins || [] : [] } : null;
    const root = chatState();
    if (name && root.excludedHostBooks) root.excludedHostBooks = root.excludedHostBooks.filter(book=>book!==name);
    saveChatState();
}

export async function createReusableBook(name, content = '') {
    name = cleanSetName(name).replace(/^\.+|\.+$/g, '').trim();
    if (!name) throw new Error('Enter a book name.');
    if (worldNames().some(existing => existing.toLowerCase() === name.toLowerCase())) throw new Error('This book already exists.');
    const entries = {};
    if (clean(content)) {
        const { blankEntry } = await import('./books.js');
        entries[0] = { ...blankEntry(0), comment:'Writing guidelines', content, constant:true, useProbability:false, probability:100 };
    }
    await saveBook(name,{ entries });
    await refreshWorldList();
    if (!worldNames().includes(name)) throw new Error('The host did not confirm that the lorebook was saved.');
    return name;
}

export const createGuidelines = createReusableBook;

export async function rowsForWorld(type = 'normal') {
    const id = chatWorld();
    const data = id ? await loadEffectiveWorld(id,{before:worldBeforeGeneration(type)}) : null;
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
    return check ? `Resolved action check: ${check.name} attempts ${check.action}. ${check.stat}: d20 ${check.natural} + (${check.mod}) = ${check.total}, difficulty ${check.dc}: ${check.result}.` : '';
}

export function recordMap(rows) {
    return new Map(rows.filter(row => row.on).map(readRecord).filter(Boolean).map(record => [record.id,record]));
}

export function previousV10(type) {
    const chat = ctx().chat || [];
    const end = ['swipe','regenerate'].includes(type) && chat.at(-1) && !chat.at(-1).is_user ? -1 : chat.length;
    return chat.slice(0,end).filter(m => !m.is_user && !m.extra?.[KEY]?.stateStale).map(m => ({ message:m, record:m.extra?.[KEY] })).filter(x => x.record);
}

export function emotionReplyAge(record, chat, type = 'normal') {
    const replace = ['swipe','regenerate','continue'].includes(type) && isReply(chat.at(-1));
    const start = Math.max(1,(record.atIndex ?? 0)+1);
    const prior = Number.isSafeInteger(record.emotionAge) ? Math.max(0,record.emotionAge) : 0;
    return prior + chat.slice(start,replace ? -1 : undefined).filter(isReply).length;
}

export function updateContract(modules, opening = false, { fieldsOnly = false } = {}) {
    const kinds = RECORD_KINDS.filter(kind => modules[KIND_MODULE[kind]]);
    const sections = orderedSections([
        ['state', modules.state && `scene: {"where":"...","when":"...","time":"...","date":"...","weather":"...","present":"comma-separated names","environment":"...","elapsed":0,"minutes":0,"ended":false}. ${promptText('timingUpdate')}`],
        ['state', kinds.length && `changes: an array of up to 12 objects with kind (${kinds.join(', ')}), id (stable slug, reuse existing IDs), text, subject when describing someone, and evidence (an exact quote from the accepted prose). ${promptText('structuredFacts')} ${promptText('memoryFacts')}`],
        ['state', modules.state && 'characters: optional array of present characters with name and an exact evidence quote, plus changed mind (focus), heart (felt emotion), body (current physical condition, or null on recovery), or psyche (salient internal tension). Use bodyLasting:true for a durable condition.'],
        ['state', modules.state && `${promptText('structuredPortrayal')} Use development:true for lasting growth. A fact may link to a plot record and reference a known baseEntry and baseRelation (extends or updates-present).`],
        ['relationships', modules.relationships && `For a relationship use subject and other, with optional perspective. ${promptText('structuredRelationships')}`],
        ['knowledge', modules.knowledge && `For knowledge include basis: observed, reported, rumor or belief; private defaults to true. ${promptText('structuredKnowledge')}`],
        ['emotions', modules.emotions && `For emotion include axes (tenderness, fury, dread, yearning, each 0–10 or omitted), optional outward behavior, target and counterweight. ${promptText('structuredEmotions')}`],
        ['plots', (modules.plots || modules.worldEvents) && `For plot and event records use status open or done. ${promptText('structuredOutcomes')}`],
        ['plots', modules.plots && 'For arcs, seeds and agendas, optional fields are parent (arc ID), requires (record IDs), due (absolute story minute), location and payoff. An agenda can include established whereabouts and a travel object with from, to, departed (exact story minute), and minutes (minimum duration), when timing and travel are established.'],
        ['worldEvents', modules.plots && modules.worldEvents && `Use schedule:true with optional weight and spacing in replies. ${promptText('structuredSchedule')}`],
        ['roast', modules.roast && !opening && `roast: ${promptText('structuredRoast')} Include this string even when no story facts changed.\nCommentator voice (for roast only): ${roastVoiceText()}`],
    ], prefs()?.moduleOrder);
    if (fieldsOnly || !sections.length) return sections.join('\n');
    return `After the visible prose, ${opening || modules.roast ? 'include' : 'when information changed, append'} one <story_update v="2"> JSON object with v:2 and only applicable fields </story_update>. No code fence.\n${sections.join('\n')}`;
}

export function sceneCheckPrompt(scene, {modules, type, preflight = PREFLIGHT, opening = false, checks = prefs()?.sceneChecks} = {}) {
    if (!modules?.preflight) return '';
    const hostChecks = hostSceneChecks();
    const actors = [...new Set(clean(scene?.present).split(/[,;\n]|\s+and\s+/i).map(clean)
        .filter(name=>name && normalize(name)!==normalize(names().user) && !/^(?:none|unknown|alone|nobody)$/i.test(name)))].slice(0,10);
    const route = actors.length>1 ? 'sceneEnsemble' : actors.length===1 ? 'sceneSolo' : 'sceneUnknown';
    return [
        'Scene and character checks:',
        (!hostChecks.continuity || opening) && promptText(opening ? 'sceneOpening' : route),
        actors.length && `Known cast: ${actors.join(', ')}.`,
        type==='continue' && promptText('sceneContinue'),
        ...Object.keys(SCENE_CHECKS).filter(key=>!hostChecks[key] && checks?.[key]!==false).map(key=>promptText(sceneCheckId(key))),
        modules.knowledge && promptText('checkKnowledge'),
        modules.plots && promptText('checkPlot'),
        modules.emotions && promptText('checkEmotion'),
        clean(preflight).slice(0,1800),
    ].filter(Boolean).join(' ');
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
    const base = baseWorld(local);
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
                const canonical = !row.baseBook || row.baseBook===base?.name
                    ? Object.values(base?.entries || {}).find(entry=>String(entry.uid)===row.baseEntry) : undefined;
                if (canonical) suffix = ` ${row.baseRelation==='updates-present' ? 'Current condition building on' : row.baseRelation==='contradicts' ? 'Player correction in this chat conflicts with' : 'Builds on'} Base World entry ${canonical.uid} (${canonical.comment || canonical.key?.[0] || 'untitled'}).`;
            }
            if (row.kind === 'relationship') suffix = [row.other,row.perspective].filter(Boolean).join(' · ');
            if (row.kind === 'emotion') {
                if (row.target && !matches(row.target)) continue;
                const tuning = chatState()?.v10?.emotion || {};
                const passes = emotionReplyAge(row,ctx().chat || [],type);
                const persistence = Number(tuning.persistence ?? 3);
                const recovery = Number(tuning.recovery ?? 1);
                const baseline = Number(tuning.baseline ?? 3);
                const axes = Object.fromEntries(Object.entries(row.axes || {}).map(([k,v]) => [k, v + Math.sign(baseline-v)*Math.min(Math.abs(baseline-v),Math.max(0,passes-persistence)*recovery)]));
                suffix = ` ${JSON.stringify(axes)}${row.target ? `; toward: ${row.target}` : ''}${row.counterweight ? `; coexisting feeling: ${row.counterweight}` : ''}${row.outward ? `; outward: ${row.outward}` : ''}`;
            }
            relevant.push({record:row,text:`${row.id} [${row.kind}${row.subject ? ` / ${row.subject}` : ''}${row.basis ? ` / ${row.basis}` : ''}${row.protected ? ' / protected' : ''}]: ${row.text} ${suffix}`.trim()});
        }
    }
    let recallLength = 0;
    relevant.sort((a,b) => Number(PLOT_KINDS.includes(a.record.kind)) - Number(PLOT_KINDS.includes(b.record.kind)));
    for (const item of relevant) if (recallLength + item.text.length <= 6800) {
        recalled.push(item);
        const status = plotAudit.find(row=>row.id===item.record.id);
        if (status) status.recalled = true;
        recallLength += item.text.length + 1;
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
    const format = !paired ? '' : local.generatePlan
        ? `${promptText('planGuidance')} Place the outline inside one <reply_plan>…</reply_plan> block before the prose.`
        : promptText('proseFirst');
    const opportunitySlot = Symbol();
    const guidance = orderedSections([
        ['style', modules.style && style], ['style', modules.style && writingProfileText(local.writingProfile)],
        ['style', modules.style && DIRECT_PROSE],
        ['preflight', sceneCheckPrompt(scene,{modules,type,preflight:local.preflight})],
        ['colors', formatSpeaker(modules)],
        ['emotions', modules.emotions && promptText('emotionSensitivity',{sensitivity:local.emotion?.sensitivity || 'flexible'})],
        ['state', baseline.length && `Established portrayal takes precedence over general style:\n${baseline.join('\n')}`],
        ['plots', plotAudit.some(row=>!row.eligible && row.recalled) && promptText('lockedPayoff')],
        ['state', recalled.length && `Established records (respect private knowledge and protected portrayal):\n${recalled.map(x=>x.text).join('\n')}`],
        ['state', modules.state && Number.isInteger(clock) && `Current exact story minute: ${clock}.`],
        ['worldEvents', local.moduleOrder?.length && opportunitySlot],
        ['dice', check && `${checkText(check)} ${promptText('resolvedActionGuidance')}`],
        ['roastFeedback', feedback.length && `Out-of-story voice feedback, not canon:\n${promptText('roastFeedback')}\n${feedback.join('\n')}`],
    ],local.moduleOrder);
    const slot=guidance.indexOf(opportunitySlot);
    const beforeOffer=slot<0 ? null : [format,...guidance.slice(0,slot)].filter(Boolean).join('\n');
    if (slot>=0) guidance.splice(slot,1);
    const text = [format,...guidance,
        repair && `If applicable, recover a missing state change from accepted reply ${repair.id}. Put it in repairChanges alongside "repair":${repair.id}. ${promptText('structuredRepair')} Prior prose: ${JSON.stringify(repair.text)}`,
        updateContract(modules),
    ].filter(Boolean).join('\n');
    return { text, offerOffset:beforeOffer?.length, offer, repair, records, clock, check, modules, expectsPlan:paired && local.generatePlan===true, recalled, recallFresh:recalled.flatMap(item=>{const hit=exposure.get(item.record.id);return hit?.fresh ? [String(hit.entry.uid)] : [];}), baselines, base, plotAudit };
}

export function loreReceipt(entries, notes, rows, book, recalled = []) {
    const seen = new Set();
    const receipt = [];
    const add = item => {
        const key = `${item.book}:${item.uid}`;
        if (!seen.has(key)) { seen.add(key); receipt.push(item); }
    };
    const local = prefs();
    const info = book && setInfo(book);
    const source = info?.shared ? {sourceBook:info.book,sourceGroup:info.group} : {};
    const roles = new Map(reusableAssignments(local).map(book => [book.name,
        book.role === 'guidelines' ? 'Guidelines' : reusableBookRoles[book.role]]));
    for (const entry of entries) {
        if (!entry?.world || entry.world.startsWith('Roleplay Instructions ')) continue;
        const set = setOfEntry(entry);
        const managed = set && { instructions:'Random Instructions',events:'Random Story Events',style:'Random Writing Style' }[setInfo(set).kind];
        const timing = managed ? null : [
            entry.constant ? 'Always eligible' : `${entry.vectorized ? 'Vector or keyword' : 'Keyword'} · ${BOOK_TRIGGER_SOURCES[bookTriggerSource(entry)]}`,
            !entry.useProbability ? '100% chance' : entry.probability != null && Number.isFinite(Number(entry.probability)) ? `${entry.probability}% chance` : '',
            entry.sticky > 0 && `sticky ${entry.sticky}`,
            entry.cooldown > 0 && `cooldown ${entry.cooldown}`,
        ].filter(Boolean).join(' · ');
        const role = managed || (entry.world === local?.base?.name ? 'Base World' : roles.get(entry.world) || 'World Info');
        add({ book:entry.world, uid:entry.uid, title:entry.comment || entry.key?.[0] || `Entry ${entry.uid}`, role,
            ...(managed ? {managedSet:set} : {}), ...(timing ? { timing } : {}), selected:true, text:entry.content });
    }
    for (const uid of notes?.ids || []) {
        const row = rows.find(item => item.uid === uid);
        if (row) add({ book, uid, ...source, recallUid:String(uid),title:row.kind === 'secret' && row.status !== 'out' ? 'Concealed entry' : row.name,
            timing:recallTiming(row.activation),selected:true, role:'Story World', delivery:'Story notes block', text:notes.text });
    }
    const recordEntries=new Map(rows.map(row=>[readRecord(row)?.id,row]));
    for (const {record,text} of recalled) {
        const row=recordEntries.get(record.id);
        add({book,uid:record.id,...source,recallUid:row ? String(row.uid) : undefined,timing:recallTiming(row?.activation),
            title:record.kind === 'knowledge' && record.private ? 'Character knowledge' : record.id,role:PLOT_KINDS.includes(record.kind) ? 'Plot Records' : 'Chat Facts',selected:true,text});
    }
    return receipt.slice(0,120);
}

export function guidelineEligible(entry, local, scene, modules, book = local.guidelines) {
    const scopes = local.guidelineScopes;
    const scope = scopes && Object.hasOwn(scopes,book) ? scopes[book][entry.uid] : undefined;
    return scope?.enabled !== false && (!scope?.module || modules[scope.module]) &&
        (!scope?.character || mentions(scene?.present,scope.character)) &&
        (!scope?.location || mentions(scene?.where,scope.location));
}

export async function addConfiguredBooks(lore, arrays, scene, modules, { base = true, guidelines = true, reference = true } = {}) {
    const local = chatState()?.v10;
    if (!local || !Array.isArray(lore.chatLore)) return;
    const pinned = base && baseWorld(local);
    if (pinned) {
        for (const list of arrays) for (let i=list.length-1;i>=0;i--) if (list[i].world === pinned.name) list.splice(i,1);
        const opening = !(ctx().chat || []).some(message=>message.is_user && message !== ctx().chat.at(-1));
        lore.chatLore.push(...Object.values(pinned.entries || {}).map(entry => ({
            ...structuredClone(entry), world:pinned.name,
            ...(opening && pinned.pins?.includes(String(entry.uid)) && !entry.disable ? {constant:true} : {}),
        })));
    }
    const managed = entry => entry.extensions?.ri?.type || entry.extensions?.ri?.set || setOfEntry(entry);
    for (const book of reusableAssignments(local)) {
        for (const list of arrays) for (let i = list.length - 1; i >= 0; i--) {
            const entry = list[i];
            if (entry.world === book.name && !managed(entry)) list.splice(i, 1);
        }
        if (book.on === false || !(book.role === 'guidelines' ? guidelines : reference)) continue;
        const data = await loadBook(book.name).catch(() => null);
        for (const entry of Object.values(data?.entries || {})) {
            const candidate = { ...entry, world: book.name };
            if (managed(candidate)) continue;
            if (book.role === 'guidelines' && !guidelineEligible(candidate, local, scene, modules, book.name)) continue;
            lore.chatLore.push(candidate);
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
    const correctedCard = new Map(characterCorrectionFields().map(({field,after})=>[field,after]));
    const cardSource = ['description','personality','scenario','mes_example']
        .map(key=>correctedCard.get(key) ?? (card[key] || card.data?.[key])).filter(Boolean);
    const persona = c.powerUserSettings?.persona_description || c.power_user?.persona_description;
    const clue = [text,direction,names().char,names().user,card.scenario || card.data?.scenario].filter(Boolean).join(' ');
    const selectEntries = (entries,pins=[],book) => Object.values(entries || {}).filter(row=>{
        if (row.disable) return false;
        if (row.constant || pins.includes(String(row.uid))) return true;
        if (!row.key?.some(key=>mentions(clue,key))) return false;
        const secondary = (row.keysecondary || []).map(key=>mentions(clue,key));
        if (!row.selective || !secondary.length) return true;
        return [secondary.some(Boolean),secondary.some(value=>!value),secondary.every(value=>!value),secondary.every(Boolean)][row.selectiveLogic || 0];
    }).map(row=>correctedLoreEntry(row,book).content).join('\n').slice(0,6000);
    const pinned = baseWorld(local);
    const base = selectEntries(pinned?.entries,pinned?.pins,pinned?.name);
    const selected = { guidelines: [], reference: [] };
    const openingScene = { present: `${names().char}, ${names().user}` };
    for (const book of reusableAssignments(local)) {
        if (book.on === false) continue;
        const data = await loadBook(book.name).catch(() => null);
        const entries = Object.values(data?.entries || {}).filter(entry=>
            !entry.disable && !entry.extensions?.ri?.type && !entry.extensions?.ri?.set &&
            (book.role !== 'guidelines' || guidelineEligible(entry,local,openingScene,modules,book.name)) &&
            (entry.constant || bookTriggerSource(entry) === 'chat' && reusableKeywordMatch(entry,clue)) &&
            (entry.useProbability === false || rollInt(100) < Number(entry.probability ?? 100)));
        selected[book.role].push(...entries.map(entry=>correctedLoreEntry(entry,book.name).content));
    }
    const guidance = selected.guidelines.join('\n').slice(0,4500);
    const reference = selected.reference.join('\n').slice(0,3500);
    const source = [base && `Pre-opening canon:\n${base}`, ...cardSource, persona && `Player persona:\n${persona}`,
        reference && `Reference lore:\n${reference}`, guidance && `Selected writing guidance:\n${guidance}`].filter(Boolean).join('\n').slice(0,15000);
    const writing = modules.style ? local.style ?? defaultWritingGuidance() : '';
    const companionChecks = new Set(Object.values(HOST_SCENE_CHECKS));
    const companionWriting = pairedPreset() && !text ? (activeHostPrompts() || [])
        .filter(block=>block.enabled && (block.id === 'ri-craft-scene' || COMPANION_WRITING_BLOCKS.has(block.name) || companionChecks.has(block.id))).map(block=>block.content).join('\n') : '';
    const openingPermission = local.openingPlayerThoughts === true
        ? promptText('openingPlayerThoughts')
        : 'The player supplies their own thoughts, dialogue, and choices.';
    const format = [modules.style && DIRECT_PROSE,companionWriting,local.opening ?? OPENING,writing,modules.style && writingProfileText(local.writingProfile),sceneCheckPrompt({present:names().char},{modules,preflight:local.preflight,opening:true}),formatSpeaker(modules),openingPermission].filter(Boolean).join('\n');
    const user = [
        text ? `${promptText('readGreeting')} Return only the update block.` : format,
        `Character: ${names().char}. Player: ${names().user}.`, source && `Source material:\n${source}`,
        text && `Chosen greeting:\n${text}`, direction && `Opening direction:\n${safeText(direction,2000)}`,
        updateContract(modules,true),
    ].filter(Boolean).join('\n\n');
    const result = await request({ operation:'storyOpening',authorization:'manual',what:text ? 'Read greeting for story state' : 'Draft story opening',
        system:promptText('systemOpening'),user,tokens:text ? 1200 : 2200 });
    if (prefs() !== local) throw new Error('The chat changed.');
    const output = pairedPreset() ? separateReply(result.text).text : result.text;
    const parsed = extractUpdate(output,{sourceProse:text || undefined,allowPlayerThoughts:local.openingPlayerThoughts===true});
    const prose = text || parsed?.clean || output.trim();
    result.note(prose ? 'Opening draft is ready for review.' : 'The result did not contain an opening.',!!prose);
    if (!prose) throw new Error('No opening was returned. Try a new draft.');
    return { prose, parsed, original:prose };
}
