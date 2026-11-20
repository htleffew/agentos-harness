// Separate model-emitted planning from editable prose and the versioned story update.
const planTag = /^\s*(?:⇥\s*)?<\/?(?:page:[\w-]+|reply_plan)(?:\s[^>]*)?\s*>/i;
const stateTag = /^\s*<\/?(?:internal_states|state:[\w-]+)(?:\s[^>]*)?\s*>/i;
const thoughtWrapper = /^\s*<(\/)?(?:think|thinking|analysis)\s*>\s*$/i;
const streamTagNames = ['story_update','reply_plan','page:','state:','internal_states','think','thinking','analysis'];
export function trimPartialReplyTag(value) {
    const match = /<\/?([\w:-]*)(?:\s[^<>]*)?$/.exec(value);
    if (!match) return value;
    const tag = match[1].toLowerCase();
    const nameOnly = match[0].length === tag.length + (match[0].startsWith('</') ? 2 : 1);
    return streamTagNames.some(name=>name===tag || nameOnly && name.startsWith(tag) || name.endsWith(':') && tag.startsWith(name))
        ? value.slice(0,match.index).trimEnd() : value;
}

const identity = /^\s*(?:1[.)]\s+)?IDENTITY\s*:/i;
const list = /^\s*(?:[-*•][ \t]+|\w{1,3}[.)]\s|[A-Z][A-Z -]{2,}:\s*$|➤|<\/?fn:)/;
export const hasReplyScaffolding = text => /(^|\n)[\t ]*(?:⇥\s*)?(?:<\/?(?:page:[\w-]+|reply_plan|internal_states|state:[\w-]+)\b|<!--\s*GFX_START\b|(?:1[.)]\s+)?IDENTITY\s*:)/i.test(text);

export function separateReply(raw) {
    const text = String(raw ?? '');
    if (!hasReplyScaffolding(text)) return { text, plan:'' };
    const prose = [];
    const plan = [];
    let section = '';
    let blank = false;
    let update = false;
    let proseSeen = false;
    let wrapper;
    let bounded = false;
    let thinkEnd = false;
    let sawList = false;
    let bare = false;
    const lines = text.split(/\r?\n/);
    for (const [index,line] of lines.entries()) {
        const thought = thoughtWrapper.exec(line);
        if (thought && (!proseSeen || section==='plan')) {
            if (thought[1]) { section=''; thinkEnd=false; }
            else {
                section='plan';
                thinkEnd=lines.slice(index+1).some(next=>thoughtWrapper.exec(next)?.[1]);
            }
            continue;
        }
        if (update || !thinkEnd && !(section==='plan' && bounded) && /^\s*<story_update\b/i.test(line)) {
            section = '';
            prose.push(line);
            update = !/<\/story_update\s*>/i.test(line);
            continue;
        }
        if (/^\s*<!--\s*GFX_START\s*-->/i.test(line)) { section='graphic'; continue; }
        if (/^\s*<!--\s*GFX_END\s*-->/i.test(line)) { section=''; continue; }
        if (section === 'graphic') continue;
        if (/^\s*<details(?:\s[^>]*)?(?:>|$)/i.test(line) && !proseSeen && !section) { wrapper=line; continue; }
        if (wrapper && /^\s*<summary\b.*<\/summary>/i.test(line)) { wrapper += '\n'+line; continue; }
        if (/^\s*<\/details\s*>/i.test(line) && section === 'plan') { section=''; wrapper=undefined; continue; }
        const page = planTag.exec(line);
        if (page) {
            wrapper = undefined;
            const value = line.slice(page[0].length).trim();
            const closing = page[0].includes('</');
            const name = /page:([\w-]+)/i.exec(page[0])?.[1];
            if (name && !closing && !page[0].includes('⇥')) plan.push(`\n${name.replaceAll('-',' ')}`);
            if (value && !closing) plan.push(value.replace(/<\/(?:page:[\w-]+|reply_plan)\s*>\s*$/i,''));
            section = closing || /<\/(?:page:[\w-]+|reply_plan)\s*>/i.test(value) ? '' : 'plan';
            const tag = /<([\w:-]+)/i.exec(page[0])?.[1]?.toLowerCase();
            bounded = section==='plan' && !!tag && lines.slice(index+1).some(next=>next.toLowerCase().includes(`</${tag}>`));
            sawList = list.test(value);
            bare = false;
            blank = false;
            continue;
        }
        if (/^\s*<\/details\s*>/i.test(line) && !proseSeen && plan.length) continue;
        if (stateTag.test(line)) {
            section = /^\s*<\//.test(line) || /<\/(?:state:[\w-]+|internal_states)\s*>\s*$/i.test(line) ? '' : 'state';
            continue;
        }
        if (section === 'state') continue;
        if (!section && identity.test(line) && !proseSeen) { section='plan'; wrapper=undefined; sawList=true; bounded=false; bare=true; }
        if (section === 'plan') {
            const numbered = list.test(line);
            const unmarked = line.trim() && !numbered && !/^\s*</.test(line);
            const possibleProse = !bare && sawList && /^\S/.test(line) && /[.!?…”"’']\s*$/.test(line);
            if (!thinkEnd && !bounded && (/^\s*\[(?:🕰|🗓|📍)/u.test(line) || unmarked && (blank || possibleProse))) {
                section = '';
            } else {
                plan.push(line.replace(/\s*⇥\s*<page:[\w-]+>\s*$/i,''));
                sawList ||= numbered;
                blank = !line.trim();
                continue;
            }
        }
        if (wrapper) { prose.push(wrapper); wrapper=undefined; }
        if (line.trim()) proseSeen = true;
        prose.push(line);
    }
    return { text:prose.join('\n').trim(), plan:plan.join('\n').trim().slice(0,12000) };
}
