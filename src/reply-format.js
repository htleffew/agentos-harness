// Separate model-emitted planning from editable prose and the versioned story update.
const planTag = /^\s*(?:⇥\s*)?<\/?(?:page:[\w-]+|reply_plan)(?:\s[^>]*)?\s*>/i;
const stateTag = /^\s*<\/?(?:internal_states|state:[\w-]+)(?:\s[^>]*)?\s*>/i;
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
    for (const line of text.split(/\r?\n/)) {
        if (update || (section !== 'plan' || proseSeen) && /^\s*<story_update\b/i.test(line)) {
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
            blank = false;
            continue;
        }
        if (/^\s*<\/details\s*>/i.test(line) && !proseSeen && plan.length) continue;
        if (stateTag.test(line)) {
            section = /^\s*<\//.test(line) || /<\/(?:state:[\w-]+|internal_states)\s*>\s*$/i.test(line) ? '' : 'state';
            continue;
        }
        if (section === 'state') continue;
        if (!section && identity.test(line) && !proseSeen) { section='plan'; wrapper=undefined; }
        if (section === 'plan') {
            if (/^\s*\[(?:🕰|🗓|📍)/u.test(line) || (blank && line.trim() && !list.test(line) && !/^\s+</.test(line))) {
                section = '';
            } else {
                plan.push(line.replace(/\s*⇥\s*<page:[\w-]+>\s*$/i,''));
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
