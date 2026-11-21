// A stream can stop in the middle of a JSON value. Expose only complete top-level
// members. Final validation and persistence still use the ordinary update reader.
const BEGIN = /<story_update\b([^>]*)>/i;
const VERSION = /(?:^|\s)v\s*=\s*(?:"2"|'2'|2)(?=\s|$)/i;
const SKIP = /\s*/y;
const KEY = /"((?:\\.|[^"\\])*)"\s*:\s*/y;
const limit = 65536;

function valueEnd(text, start) {
    let depth = 0, quoted = false, escaped = false;
    for (let i=start;i<text.length;i++) {
        const char = text[i];
        if (quoted) {
            if (escaped) escaped = false;
            else if (char==='\\') escaped = true;
            else if (char==='"') quoted = false;
            continue;
        }
        if (char==='"') quoted = true;
        else if (char==='{' || char==='[') depth++;
        else if (char===',' && depth===0 || char==='}' && depth===0) return i;
        else if (char==='}' || char===']') depth--;
    }
    return -1;
}

function fields(text) {
    const opening = /^\s*\{/.exec(text);
    const result = new Map();
    if (!opening) return result;
    let at = opening[0].length;
    while (at<text.length) {
        SKIP.lastIndex = at;
        SKIP.exec(text);
        KEY.lastIndex = SKIP.lastIndex;
        const key = KEY.exec(text);
        if (!key) break;
        const start = KEY.lastIndex;
        const end = valueEnd(text,start);
        if (end < 0) break;
        try { result.set(JSON.parse(`"${key[1]}"`),JSON.parse(text.slice(start,end))); }
        catch { break; }
        at=end+1;
        if (text[end]==='}') break;
    }
    return result;
}

const count = (n,singular,plural) => `${n} ${n===1 ? singular : plural}`;
const label = value => typeof value==='string' ? value.trim().slice(0,90) : '';

const stringFields = (item, keys, max) => Object.fromEntries(keys
    .filter(key => typeof item?.[key] === 'string' && item[key].trim())
    .map(key => [key,item[key].trim().slice(0,max)]));
const normalize = value => String(value || '').trim().toLowerCase().replace(/\s+/g,' ');

export function streamUpdate(text, playerName = '') {
    const begin = BEGIN.exec(text);
    if (!begin || !VERSION.test(begin[1])) return null;
    const update = fields(text.slice(begin.index+begin[0].length,begin.index+begin[0].length+limit));
    if (update.has('v') && update.get('v')!==2) return [];
    const scene = update.get('scene');
    const prose = normalize(text.slice(0,begin.index));
    const supported = item => typeof item?.evidence === 'string' && item.evidence.trim().length >= 4 && prose.includes(normalize(item.evidence));
    const player = normalize(playerName);
    return [
        scene && typeof scene==='object' && !Array.isArray(scene) && {
            id:'scene', title:'Scene', value:stringFields(scene,['where','environment','present'],300), detail:[label(scene.where),label(scene.date),label(scene.time || scene.when),label(scene.weather)].filter(Boolean).join(' · ') || 'Scene details',
        },
        Array.isArray(update.get('characters')) && {
            id:'cast',title:'Characters',value:update.get('characters').slice(0,8).filter(supported).flatMap(item=>{
                const name = label(item.name);
                if (!name || normalize(name)===player) return [];
                const fields = stringFields(item,['mind','heart','body','psyche'],220);
                for (const key of Object.keys(fields)) if (/^(clear|resolved)$/i.test(fields[key])) delete fields[key];
                return Object.keys(fields).length ? [{name,fields}] : [];
            }),detail:count(update.get('characters').length,'snapshot','snapshots'),
        },
        Array.isArray(update.get('changes')) && {
            id:'changes',title:'Story changes',value:update.get('changes').slice(0,12).filter(supported).flatMap(item=>{
                const record = stringFields(item,['kind','id','status','subject','text'],900);
                if (!record.kind || !record.text || !record.id) return [];
                if (record.kind==='emotion') {
                    if (!record.subject || normalize(record.subject)===player) return [];
                    record.axes = Object.fromEntries(Object.entries(item.axes || {}).filter(([,n])=>Number.isInteger(n) && n>=0 && n<=10));
                }
                return [record];
            }),detail:count(update.get('changes').length,'change','changes'),
        },
        Array.isArray(update.get('repairChanges')) && {
            id:'repair',title:'Earlier state',detail:count(update.get('repairChanges').length,'correction','corrections'),
        },
        typeof update.get('roast')==='string' && label(update.get('roast')) && {
            id:'roast',title:'Roast',detail:'Commentary received',
        },
    ].filter(Boolean);
}
