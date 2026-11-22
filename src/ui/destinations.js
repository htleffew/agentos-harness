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
        { id:'state', subgroup:'Scene', label:'Current scene', help:'Review the active scene and character snapshots.' },
        { id:'opening', subgroup:'Scene', label:'Opening', help:'Choose a greeting or prepare an opening.' },
        { id:'corrections', subgroup:'Scene', label:'Correct story facts', help:'Find, correct or undo a story fact.', aliases:'fix a fact correct source repair wrong facts' },
        { id:'books', subgroup:'Records', label:'Lorebooks', help:'Assign books to the chat or edit their entries.', aliases:'lorebook world info import source' },
        { id:'facts', subgroup:'Records', label:'Chat facts', help:'Find facts recorded for this chat.', aliases:'edit fact provenance source' },
        { id:'plots', subgroup:'Records', label:'Plot records', help:'Review arcs, seeds, agendas and events.' },
        { id:'world', subgroup:'Records', label:'Story record storage', help:'Choose the book that stores this chat’s lasting records.', aliases:'world info lorebook source book' },
        { id:'portrayal', subgroup:'Characters', label:'Portrayal & knowledge', help:'Edit character portrayal and who knows a fact.' },
        { id:'emotion', subgroup:'Characters', label:'Emotions & relationships', help:'Review a character or relationship pair.' },
        { id:'goals', subgroup:'Characters', label:'Character goals', help:'Set a goal and order its steps.' },
        { id:'speakers', subgroup:'Characters', label:'Dialogue colors', help:'Review or change speaker colors.' },
    ] },
    { id:'direction', label:'Direction', accent:'cyan', pages:[
        { id:'instructions', label:'Random instructions', help:'Manage instruction sets, triggers and versions.' },
        { id:'events', label:'Random story events', help:'Manage event sets, eligibility and rolls.' },
        { id:'style', label:'Random writing style', help:'Manage writing categories and wording.' },
        { id:'writing', label:'Writing guidance', help:'Edit ongoing guidance and reply screening.', aliases:'writing review diagnostics prose' },
        { id:'checks', label:'Action checks', help:'Queue or clear a check for the next reply.', aliases:'roll dice' },
    ] },
    { id:'review', label:'Review', accent:'blue', pages:[
        { id:'sent', label:'What was sent', help:'Inspect a reply’s directions, sources and execution.', aliases:'receipt review reply notes swipe alternate version' },
        { id:'context', label:'Context & memory', help:'Review editable facts, filed replies and chapters.', aliases:'summary catch up recall history filing' },
        { id:'log', label:'Request log', help:'Inspect request outcomes or export the log.', withoutChat:true },
    ] },
    { id:'setup', label:'Setup', accent:'sky', pages:[
        { id:'v10', label:'Preset & Extension', help:'Identify the host preset, its prompts and extension settings.', aliases:'preset prompt workbench impersonation v10', withoutChat:true },
        { id:'display', label:'Reply display', help:'Choose which reply cards and commentator voice appear.', aliases:'roast commentator notes card visual' },
        { id:'settings', label:'Connections & defaults', help:'Set storage, connections, and automatic checks.', aliases:'connection profile provider request automation', withoutChat:true },
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
export const normalizeGroup = id => id==='characters' ? 'story' : id;
export const destination = id => pages.find(page=>page.id===id);
export const startingPage = hasChat => hasChat ? 'state' : 'v10';

export function findDestinations(query) {
    const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter(word=>!['a','an','the'].includes(word)) || [];
    if (!words.length) return [];
    return tools.flatMap(page=>{
        const name = page.label.toLowerCase();
        const terms = [name,page.section,page.subgroup,page.help,page.aliases].join(' ').toLowerCase();
        if (!words.every(word=>terms.includes(word))) return [];
        const score = words.filter(word=>name.includes(word)).length;
        return [{page,score}];
    }).sort((a,b)=>b.score-a.score).map(({page})=>page);
}
