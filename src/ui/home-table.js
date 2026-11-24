// The control homes of DESIGN.md 3.4 as data: the page that holds each control and the pages that link to it.
// homes.js builds the links from it; tests read it without a browser.
export const HOMES = {
    'world-budget':      { page:'memory',  label:'Room for story notes',                links:['world'] },
    'state-budget':      { page:'memory',  label:'Current state prompt budget',         links:['settings'] },
    'scene-card':        { page:'display', label:'Story state under replies',           links:[] },
    'write-chapter':     { page:'world',   label:'Write a chapter now',                 links:['context'] },
    'new-chapter':       { page:'world',   label:'Start a new chapter in a new chat',   links:['sent'] },
    'world-create':      { page:'books',   label:'Create a Story World',                links:['world'] },
    'world-export':      { page:'books',   label:'Export the Story World',              links:['world'] },
    'world-delete':      { page:'books',   label:'Delete the Story World',              links:['world'] },
    'world-entries':     { page:'world',   label:'Story World entries',                 links:['books'] },
    'live-guidance':     { page:'writing', label:'Live writing guidance',               links:[] },
    'scene-checks':      { page:'writing', label:'Scene and character checks',          links:[] },
    'npc-avoid':         { page:'writing', label:'New NPC names to avoid',              links:['portrayal'] },
    'roast-voice':       { page:'v10',     label:'Roast commentator voice',             links:['display'] },
    'roast-switches':    { page:'v10',     label:'Roast on or off',                     links:['display'] },
    'module-switches':   { page:'v10',     label:'Extension features',                  links:[] },
    'dice-stats':        { page:'checks',  label:'Stats',                               links:['settings'] },
    'pronouns':          { page:'portrayal', label:'Pronouns',                          links:['settings'] },
    'set-storage':       { page:'set-rules', label:'Where your sets are kept',          links:['settings'] },
    'pacing':            { page:'set-rules', label:'Pacing',                            links:['settings'] },
    'per-reply':         { page:'set-rules', label:'New things in one reply',           links:['settings'] },
    'follow-through':    { page:'set-rules', label:'Follow-through checks',             links:['settings'] },
    'world-orders':      { page:'set-rules', label:'World orders',                      links:['world'] },
    'event-tags':        { page:'set-rules', label:'Tags to skip',                      links:['state'] },
    'world-update':      { page:'memory',  label:'Keeping the world up to date',        links:['world'] },
    'catch-up':          { page:'memory',  label:'Catch up or rebuild this chat',       links:['context'] },
    'next-preview':      { page:'context', label:'Next reply preview',                  links:['world'] },
    // The wording editors for what a set sends into the chat; the set editors show a link row to each.
    'instruction-wording': { page:'sets',  label:'In-chat instruction wording',         links:[] },
    'event-wording':     { page:'sets',    label:'In-chat story event wording',         links:[] },
    'style-wording':     { page:'sets',    label:'In-chat writing style wording',       links:[] },
    // The three player prompts; the quick action editor shows a link row beside its preview.
    'impersonation-prompts': { page:'v10', label:'Impersonation prompts',               links:[] },
    // Ours or Theirs for each feature; the module list of Setup, Features shows a link row for every feature it lists.
    'feature-owner':     { page:'presets', label:'Who supplies each feature',           links:[] },
};
