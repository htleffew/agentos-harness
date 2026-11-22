// Keep panel navigation and Find a tool on the same destination list.
export const taskLabels = {
    alternate:'Generate an alternate reply',
    generateAlternate:'Generate alternate reply',
    continue:'Continue this reply',
    corrections:'Correct story facts',
    review:'Review this reply',
    browse:'Browse directions',
    manage:'Manage quick actions',
};

export const groups = [
    { id:'story', label:'Story', accent:'green', pages:[
        { id:'opening', label:'Opening', help:'Choose a greeting or prepare an opening.' },
        { id:'state', label:'Current State', help:'Review the active scene and character snapshots.' },
        { id:'corrections', label:'Corrections', help:'Find, correct or undo a story fact.', aliases:'fix a fact correct source repair wrong facts' },
        { id:'books', label:'Reusable Lorebooks', help:'Assign books to the chat or edit their entries.', aliases:'lorebook world info import source' },
        { id:'facts', label:'Chat Facts', help:'Find facts recorded for this chat.', aliases:'edit fact provenance source' },
        { id:'plots', label:'Plot Records', help:'Review arcs, seeds, agendas and events.' },
        { id:'world', label:'Story World', help:'Choose the book that stores this chat’s lasting records.', aliases:'world info lorebook source book' },
    ] },
    { id:'characters', label:'Characters', accent:'sky', pages:[
        { id:'portrayal', label:'Portrayal & Knowledge', help:'Edit character portrayal and who knows a fact.' },
        { id:'emotion', label:'Emotions & Relationships', help:'Review a character or relationship pair.' },
        { id:'goals', label:'Character Goals', help:'Set a goal and order its steps.' },
        { id:'speakers', label:'Dialogue Colors', help:'Review or change speaker colors.' },
    ] },
    { id:'direction', label:'Direction', accent:'cyan', pages:[
        { id:'instructions', label:'Random Instructions', help:'Manage instruction sets, triggers and versions.' },
        { id:'events', label:'Random Story Events', help:'Manage event sets, eligibility and rolls.' },
        { id:'style', label:'Random Writing Style', help:'Manage writing categories and wording.' },
        { id:'writing', label:'Writing Guidance', help:'Edit ongoing guidance and reply screening.', aliases:'writing review diagnostics prose' },
        { id:'checks', label:'Action Checks', help:'Queue or clear a check for the next reply.', aliases:'roll dice' },
    ] },
    { id:'review', label:'Review', accent:'blue', pages:[
        { id:'sent', label:'What Was Sent', help:'Inspect a reply’s directions, sources and execution.', aliases:'receipt review reply notes swipe alternate version' },
        { id:'context', label:'Context & Memory', help:'Review editable facts, filed replies and chapters.', aliases:'summary catch up recall history filing' },
        { id:'log', label:'Log', help:'Inspect request outcomes or export the log.', withoutChat:true },
    ] },
    { id:'setup', label:'Setup', accent:'sky', pages:[
        { id:'v10', label:'Preset & Extension', help:'Identify the host preset, its prompts and extension settings.', aliases:'preset prompt workbench impersonation v10', withoutChat:true },
        { id:'display', label:'Reply Display', help:'Choose which reply cards and commentator voice appear.', aliases:'roast commentator notes card visual' },
        { id:'settings', label:'Settings', help:'Set storage, connections, and automatic checks.', aliases:'connection profile provider request automation', withoutChat:true },
    ] },
];

const pages = groups.flatMap(group => group.pages.map(page=>({...page,group:group.id,section:group.label})));
const tools = [...pages,
    {id:'composer-actions',label:'Composer quick actions',section:'Setup',page:'v10',anchor:'#ri-composer-settings',
        help:'Assign shortcuts, choose menu actions and manage the library.',aliases:'toolbar buttons quick actions pins',withoutChat:true},
    {id:'alternate',label:taskLabels.alternate,section:'Chat',family:'swipe',help:'Guide a new version of a reply.',aliases:'swipe regenerate version'},
    {id:'steer',label:'Steer the next reply',section:'Chat',family:'steer',help:'Queue guidance for your next player message.',aliases:'nudge directions queue'},
    {id:'draft',label:'Draft my reply',section:'Chat',family:'draft',help:'Prepare editable wording or ask for choices.',aliases:'draft impersonation cyoa'},
    {id:'model-settings',label:'Model request settings',section:'Setup',page:'settings',anchor:'#ri-model-request-settings',
        help:'Choose a connection for each operation and review automatic requests.',aliases:'connection profile provider request',withoutChat:true},
];
export const destination = id => pages.find(page=>page.id===id);
export const startingPage = hasChat => hasChat ? 'state' : 'v10';

export function findDestinations(query) {
    const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter(word=>!['a','an','the'].includes(word)) || [];
    if (!words.length) return [];
    return tools.flatMap(page=>{
        const name = page.label.toLowerCase();
        const terms = [name,page.section,page.help,page.aliases].join(' ').toLowerCase();
        if (!words.every(word=>terms.includes(word))) return [];
        const score = words.filter(word=>name.includes(word)).length;
        return [{page,score}];
    }).sort((a,b)=>b.score-a.score).map(({page})=>page);
}
