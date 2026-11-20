// Attribution for ordinary fictional dialogue. A quote without a clear name can use the host's theme.
const quotes = /“[^”\n]+”|"[^"\n]+"/gu;
const proper = "[\\p{Lu}][\\p{L}\\p{M}'’-]*";
const person = `${proper}(?:(?:[ \\t]+(?:of|de|van|von))?[ \\t]+${proper}){0,4}`;
const speech = '(?:said|asked|replied|answered|whispered|murmured|added|called|shouted|uttered|muttered|continued|interrupted|snapped|insisted|explained|announced|offered|warned|told|responded)';
const afterSubject = new RegExp(`^[ \\t]*[,!?—–-]?[ \\t]*(${person})[ \\t]+${speech}\\b`,'u');
const afterInverted = new RegExp(`^[ \\t]*[,!?—–-]?[ \\t]*(${speech})[ \\t]+(${person})(?=[ \\t]*[.!?,;:—–-]|[ \\t]+(?:to|at|with|under|through)\\b|[ \\t]*$)`,'u');
const beforeSpeech = new RegExp(`(?:^|[.!?;]\\s+)[ \\t]*(${person})[ \\t]+${speech}(?:[ \\t]+(?:softly|quietly|loudly|back|aloud))?[,:][ \\t]*$`,'u');
const beforeAction = new RegExp(`(?:^|[.!?;]\\s+)[ \\t]*(${person})[ \\t]+(?:nodded|sighed|smiled|laughed|shrugged|hesitated|leaned (?:closer|in|back)|took a breath|shook (?:his|her|their) head)\\.[ \\t]*$`,'u');
const thoughtVerb = '(?:thought|wondered|remembered|reflected|realized|reminded [\\p{L}]+)';
const thoughtAfter = new RegExp(`^[ \\t]*[,—–-]?[ \\t]*(${person})[ \\t]+${thoughtVerb}(?:[ \\t]+(?:silently|to (?:himself|herself|themself)))?(?=[ \\t]*(?:[.!?;]|$))`,'u');
const thoughtBefore = new RegExp(`(?:^|[.!?;]\\s+)[ \\t]*(${person})[ \\t]+${thoughtVerb}(?:[ \\t]+(?:silently|to (?:himself|herself|themself)))?[,:][ \\t]*$`,'u');
const italic = /(?<![\\*])\*(?!\*|\s)[^*\n]+(?<!\s)\*(?!\*)/gu;
const bracket = new RegExp(`\\[(${person})\\][ \\t]*$`,'u');
const colon = new RegExp(`^[ \\t]*(${person}):[ \\t]*$`,'u');
const validName = name => name && !/^(?:I|He|She|They|We|You|It|Someone|Nobody|The|A|An)\b|['’]s$/iu.test(name) ? name : '';
const compare = name => name.toLowerCase().replace(/\s+/g,' ');

function afterName(text) {
    if (/[,：:][ \t]*$/.test(text)) return '';
    return validName(afterSubject.exec(text)?.[1] || afterInverted.exec(text)?.[2]);
}

/** Identify quotes and precise ranges in the prose. Narration and thoughts stay outside those ranges. */
export function dialogueAttributions(text) {
    const spans = [...text.matchAll(quotes)];
    return spans.map((quote,i)=>{
        const start = quote.index, end = start+quote[0].length;
        const previous = spans[i-1], next = spans[i+1];
        const previousEnd = previous ? previous.index+previous[0].length : 0;
        const lineStart = text.lastIndexOf('\n',start-1)+1;
        const lineEnd = text.indexOf('\n',end);
        const before = text.slice(Math.max(previousEnd,lineStart),start);
        const after = text.slice(end,Math.min(next?.index ?? text.length,lineEnd<0 ? text.length : lineEnd));
        const legacy = bracket.exec(before);
        const labelPrefix = legacy ? before.slice(0,legacy.index) : '';
        const legacyName = !labelPrefix.trim() || /[.!?;]\s*$/.test(labelPrefix) ? validName(legacy?.[1]) : '';
        const leading = validName(colon.exec(before)?.[1] || beforeSpeech.exec(before)?.[1]);
        const trailing = afterName(after);
        const beat = validName(beforeAction.exec(before)?.[1]);
        const sameParagraph = previous && previousEnd>=lineStart;
        const continuing = sameParagraph && /[.!?][ \t]*$/.test(before) && !/[.!?].+\S/.test(before.trimEnd()) ? afterName(before) : '';
        const agrees = !leading || !trailing || compare(leading) === compare(trailing);
        return {
            start, end, name:legacyName || (agrees ? trailing || leading || continuing || beat : ''),
            labelStart:legacyName ? start-legacy[0].length : undefined,
            explicit:!!(leading || trailing),
        };
    });
}

export function thoughtAttributions(text, spans = [...text.matchAll(italic)].map(match=>({
    start:match.index,
    end:match.index+match[0].length,
}))) {
    return spans.map((span,index)=>{
        const lineStart = text.lastIndexOf('\n',span.start-1)+1;
        const lineEnd = text.indexOf('\n',span.end);
        const before = text.slice(Math.max(lineStart,spans[index-1]?.end ?? 0),span.start);
        const after = text.slice(span.end,lineEnd<0 ? text.length : lineEnd);
        const leading = validName(thoughtBefore.exec(before)?.[1]);
        const trailing = validName(thoughtAfter.exec(after)?.[1]);
        const beat = validName(beforeAction.exec(before)?.[1]);
        return {...span,name:leading && trailing && compare(leading)!==compare(trailing) ? '' : leading || trailing || beat};
    });
}

/** Reword old speaker labels a model may copy from the conversation. */
export function proseDialogue(text) {
    if (typeof text !== 'string' || !text.includes('[')) return text;
    let source = text;
    for (const line of dialogueAttributions(text).reverse()) {
        if (line.labelStart === undefined) continue;
        source = source.slice(0,line.labelStart) + (line.explicit ? '' : `${line.name} said, `) + source.slice(line.start);
    }
    return source;
}
