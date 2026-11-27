// Quick action settings (DESIGN.md 4.3): the fields each kind has, the icon picker and the editor.
// The schema belongs to src/quick-actions.js; this module only edits it.
import { add, button, field, h, insertAtCursor, select, textArea, textInput } from './dom.js';
import { executionPreview } from '../execution.js';
import { knownSets, setInfo } from '../books.js';
import { statNames } from '../dice.js';
import { costWords, NPC_OPTIONS_PROMPT, OPTION_LENGTHS, QUICK_ACTION_KINDS, QUICK_ACTION_VARIABLES, kindOf } from '../quick-actions.js';

const MODEL = ['options', 'swipe', 'continue', 'impersonate'];
const DIRECTIVE = ['swipe', 'continue', 'direction'];
const EVERY = Object.keys(QUICK_ACTION_KINDS);

/** Which kinds carry each field of the 4.3 table, in table order. */
export const FIELD_KINDS = Object.freeze({
    title: EVERY, icon: EVERY, pinned: EVERY, connection: MODEL,
    count: ['options'], length: ['options'], prompt: ['options', 'impersonate'], set: ['options'],
    autoOpen: ['options'], insertMode: ['options', 'impersonate'],
    text: ['swipe', 'continue', 'impersonate', 'direction'],
    visibility: DIRECTIVE, required: DIRECTIVE, rollD20: DIRECTIVE, freshStart: DIRECTIVE,
    stat: ['check'], difficulty: ['check'], who: ['check'], opens: ['review'],
});

export const fieldsFor = kind => Object.keys(FIELD_KINDS).filter(key => FIELD_KINDS[key].includes(kind));
export const NAME_LIMIT = 20;
export const KIND_ORDER = EVERY;

/** Defaults of the 4.3 table for a kind. */
export function kindDefaults(kind) {
    const def = QUICK_ACTION_KINDS[kind];
    const base = { kind, title: def?.name || '', icon: def?.icon || '', text: '', delivery: { visibility: 'private', required: false },
        enabled: true, rollD20: false, freshStart: '' };
    if (kind === 'options') Object.assign(base, { count: 4, length: 'medium', prompt: NPC_OPTIONS_PROMPT, set: '', autoOpen: true, insertMode: 'insert' });
    if (kind === 'impersonate') Object.assign(base, { prompt: '', insertMode: 'insert' });
    if (kind === 'check') Object.assign(base, { stat: '', difficulty: '', who: 'user' });
    if (kind === 'review') Object.assign(base, { opens: 'sent' });
    return base;
}

/** An editable copy of a saved quick action (or the defaults of a new one), with every field of its kind present. */
export function draftOf(action, kind = kindOf(action)) {
    const draft = { ...kindDefaults(kind), ...structuredClone(pick(action || {})) };
    draft.delivery = { visibility: 'private', required: false, ...draft.delivery };
    if (!draft.icon) draft.icon = QUICK_ACTION_KINDS[kind]?.icon || '';
    if (action?.id) draft.id = action.id;
    return draft;
}

const DRAFT_KEYS = ['kind', 'family', 'title', 'icon', 'text', 'category', 'delivery', 'enabled', 'hidden', 'barOnly', 'count', 'length', 'prompt',
    'set', 'autoOpen', 'insertMode', 'rollD20', 'freshStart', 'stat', 'difficulty', 'who', 'opens', 'source', 'twistTypes', 'literalMacros', 'requiresDirection'];
const pick = action => Object.fromEntries(DRAFT_KEYS.filter(key => action[key] !== undefined).map(key => [key, action[key]]));

/** The error that stops a save, or an empty string. `original` is the saved title, which may predate the 20 character limit. */
export function draftError(draft, original = '') {
    const title = String(draft.title || '').trim();
    if (!title) return 'Enter a name.';
    if (title.length > NAME_LIMIT && title !== original) return `Keep the name to ${NAME_LIMIT} characters or fewer.`;
    if (draft.kind === 'options' && !String(draft.prompt || '').trim()) return 'Enter a prompt for these options.';
    return '';
}

/** What to hand to saveQuickAction: only the fields the kind has, with default icons left unset. */
export function draftToAction(draft) {
    const kind = draft.kind;
    const keep = new Set(fieldsFor(kind));
    const out = { kind, title: String(draft.title || '').trim(), enabled: draft.enabled !== false };
    if (draft.id) out.id = draft.id;
    if (draft.family) out.family = draft.family;
    for (const key of ['category', 'source', 'twistTypes', 'literalMacros', 'requiresDirection', 'hidden']) if (draft[key] !== undefined) out[key] = draft[key];
    out.icon = draft.icon && draft.icon !== QUICK_ACTION_KINDS[kind]?.icon ? draft.icon : '';
    for (const key of ['count', 'length', 'prompt', 'set', 'autoOpen', 'insertMode', 'text', 'rollD20', 'freshStart', 'stat', 'difficulty', 'who', 'opens']) {
        if (keep.has(key)) out[key] = draft[key];
    }
    if (keep.has('visibility') || keep.has('required')) out.delivery = { visibility: draft.delivery.visibility, required: !!draft.delivery.required };
    // Older family actions need wording; a plain swipe or continue has none and lives on the bar only.
    if (keep.has('text')) out.barOnly = !String(draft.text || '').trim() && !draft.source;
    else if (draft.barOnly !== undefined) out.barOnly = draft.barOnly;
    return out;
}

const OPERATIONS = { options: 'playerChoices', impersonate: 'playerDraft', swipe: 'swipe', continue: 'continue' };

/** The model request setting a kind runs through (Setup, Connections), or an empty string. */
export const connectionOperation = kind => OPERATIONS[kind] || '';

/** The saved connection a kind runs through, as the Connections page names it. Empty for kinds that run in code. */
export function connectionName(kind) {
    const operation = OPERATIONS[kind];
    if (!operation) return '';
    return String(executionPreview(operation, { stage: kind === 'options' ? 'additional' : 'reply' }).connection || '').replace(/^Connection profile:\s*/, '');
}

/** The cost line under Connection (DESIGN.md 4.3). */
export function costLine(kind, connection = connectionName(kind)) {
    const call = QUICK_ACTION_KINDS[kind]?.call;
    if (call === 'extra') return connection ? `1 model call through ${connection}` : '1 model call';
    if (call === 'reply') return connection ? `SillyTavern’s reply request through ${connection}` : 'SillyTavern’s reply request';
    return 'Runs in code';
}

export { costWords };

// A searchable grid of about 60 Font Awesome Free Solid icons (every name is checked against the host stylesheet).
const ICON_NAMES = `wand-magic-sparkles:magic spell,user-plus:npc arrive,user:person,users:crowd group,rotate:swipe again,forward-step:continue next,pen:write,signs-post:direction sign,
dice-d20:roll check,magnifying-glass:review search,bolt:quick fast,compass:direction,book-open:story,star:favorite,heart:love romance,fire:flame,skull:death,ghost:spirit,
mask:disguise,crown:royal,gem:treasure,key:lock secret,shield-halved:defend,hand-fist:fight,dragon:monster,hat-wizard:mage,scroll:letter lore,
feather-pointed:quill write,moon:night,sun:day,cloud-bolt:storm,bell:alert,map:travel,location-dot:place,door-open:enter arrive,skull-crossbones:danger,
eye:look watch,comment:talk say,comment-dots:reply,quote-left:quote speech,masks-theater:drama,music:song,tree:forest,mountain:climb,water:sea,wind:air,clock:time,coins:gold money,
lightbulb:idea,brain:think,circle-question:question mystery,triangle-exclamation:warning,bullhorn:announce,face-smile:happy,
heart-crack:heartbreak,shuffle:random,paper-plane:send,user-secret:spy,fingerprint:clue`
    .replace(/\s+/g, ' ').split(',').map(entry => entry.trim()).filter(Boolean).map(entry => {
        const [name, words = ''] = entry.split(':');
        return { icon: `fa-${name}`, name, words };
    });
export const ICONS = Object.freeze(ICON_NAMES);

/** Icons whose name or keywords hold every word of the query. */
export function iconMatches(query, icons = ICONS) {
    const words = String(query || '').toLowerCase().split(/[\s-]+/).filter(Boolean);
    return icons.filter(item => words.every(word => `${item.name.replace(/-/g, ' ')} ${item.words}`.includes(word)));
}

const iconNode = name => h('i', { class: `fa-solid ${name}`, 'aria-hidden': 'true' });

function iconPicker(draft, onChange) {
    const current = h('button', { type: 'button', class: 'ri-bar-btn ri-qa-icon-current', 'aria-expanded': 'false', 'aria-label': `Icon: ${draft.icon.replace(/^fa-/, '')}. Change icon` },
        iconNode(draft.icon), h('span', {}, draft.icon.replace(/^fa-/, '').replace(/-/g, ' ')));
    const panel = h('div', { class: 'ri-qa-icon-panel', hidden: true });
    const grid = h('div', { class: 'ri-qa-icon-grid', role: 'group', 'aria-label': 'Icons' });
    const empty = h('p', { class: 'ri-help', hidden: true, role: 'status' }, 'No icon matches. Try another word.');
    const search = textInput('', value => draw(value), { type: 'search', placeholder: 'Search icons', 'aria-label': 'Search icons' });
    function draw(query = '') {
        const found = iconMatches(query);
        grid.replaceChildren(...found.map(item => {
            const choice = h('button', { type: 'button', class: 'ri-qa-icon', title: item.name.replace(/-/g, ' '), 'aria-label': item.name.replace(/-/g, ' '),
                'aria-pressed': String(item.icon === draft.icon), 'data-icon': item.icon, onclick: () => {
                    draft.icon = item.icon;
                    current.replaceChildren(iconNode(item.icon), h('span', {}, item.name.replace(/-/g, ' ')));
                    current.setAttribute('aria-label', `Icon: ${item.name.replace(/-/g, ' ')}. Change icon`);
                    panel.hidden = true;
                    current.setAttribute('aria-expanded', 'false');
                    current.focus({ preventScroll: true });
                    onChange?.(item.icon);
                } }, iconNode(item.icon));
            return choice;
        }));
        empty.hidden = found.length > 0;
    }
    current.addEventListener('click', () => {
        panel.hidden = !panel.hidden;
        current.setAttribute('aria-expanded', String(!panel.hidden));
        if (!panel.hidden) { draw(search.value); search.focus({ preventScroll: true }); }
    });
    panel.append(search, grid, empty);
    return h('div', { class: 'ri-qa-icon-picker' }, current, panel);
}

// Setup, Prompts (B9) mirrors every prompt. Until it registers an editor here, the prompt field is a plain text area and a link.
let promptEditorProvider = null;
export const setPromptEditorProvider = provider => { promptEditorProvider = typeof provider === 'function' ? provider : null; };

const check = (label, help, checked, onChange) => {
    const input = h('input', { type: 'checkbox', checked: !!checked, onchange: event => onChange(event.target.checked) });
    return h('label', { class: 'ri-qa-switch' }, input, h('span', {}, label, help && h('span', { class: 'ri-help' }, help)));
};

/**
 * The quick action editor. Every field of DESIGN.md 4.3 for the draft's kind.
 * @param {HTMLElement} host
 * @param {{draft:object, original?:object, pinned:boolean, onPinned:(on:boolean)=>void, openConnections:()=>void, openPrompts:()=>void,
 *   openBar:()=>void}} options
 */
export function renderActionEditor(host, { draft, original, pinned, onPinned, openConnections, openPrompts, openBar }) {
    const kind = draft.kind;
    const has = key => FIELD_KINDS[key].includes(kind);
    const sections = [];
    const section = (title, ...children) => sections.push(h('section', { class: 'ri-qa-section' }, h('h4', { class: 'ri-qa-section-title' }, title), children));

    const count = h('span', { class: 'ri-help', 'aria-live': 'polite' }, `${draft.title.length} of ${NAME_LIMIT}`);
    const title = textInput(draft.title, value => { draft.title = value; count.textContent = `${value.length} of ${NAME_LIMIT}`; }, { maxLength: NAME_LIMIT, autocomplete: 'off' });
    // A saved name that predates the limit stays editable down to the limit; the limit applies to new typing.
    if (original && original.title.length > NAME_LIMIT) title.removeAttribute('maxlength');
    section('Name and look', field('Name', `${NAME_LIMIT} characters, so it fits the press and hold popover and More.`, title, count),
        field('Icon', '', iconPicker(draft)),
        check('Show on the bar', 'Off keeps it in More and the Library.', pinned, onPinned),
        openBar && button('Order the bar', openBar, { kind: 'ghost' }));

    if (has('connection')) {
        const line = h('p', { class: 'ri-qa-cost', 'data-call': QUICK_ACTION_KINDS[kind].call }, kind === 'options' && h('span', { class: 'ri-qa-dot', 'aria-hidden': 'true' }),
            h('span', { class: 'ri-qa-cost-text' }, costLine(kind)));
        const refresh = () => { line.querySelector('.ri-qa-cost-text').textContent = costLine(kind); };
        host.addEventListener('focusin', refresh);
        section('Connection', line, openConnections && button('Open Setup, Connections', openConnections, { kind: 'ghost' }));
    }

    if (kind === 'options') {
        const sets = knownSets('instructions').map(id => ({ value: id, label: setInfo(id).name }));
        if (draft.set && !sets.some(item => item.value === draft.set)) sets.push({ value: draft.set, label: `${draft.set} (not found)` });
        section('Options', field('Count', '1 to 12.', h('input', { class: 'ri-input ri-input-num', type: 'number', min: 1, max: 12, inputMode: 'numeric', value: String(draft.count),
            oninput: event => { draft.count = Math.min(12, Math.max(1, Math.round(Number(event.target.value)) || 1)); } })),
        field('Length', '', select(Object.entries(OPTION_LENGTHS).map(([value, item]) => ({ value, label: `${item.label}, ${item.instruction.replace('Write each option in ', '').replace(/\.$/, '')}` })),
            draft.length || 'medium', value => { draft.length = value; }, { 'aria-label': 'Length' })),
        field('Random Instruction Set', 'One set, rolled into this request.', select([{ value: '', label: 'None' }, ...sets], draft.set || '', value => { draft.set = value; }, { 'aria-label': 'Random Instruction Set' })),
        check('Open results automatically', 'Off keeps the sheet closed after Generate and shows the count in the status slot.', draft.autoOpen !== false, on => { draft.autoOpen = on; }));
    }

    if (has('prompt')) {
        const area = textArea(draft.prompt || '', value => { draft.prompt = value; }, { rows: 5, placeholder: kind === 'impersonate' ? 'Leave empty to use the default prompt.' : '' });
        const mirrored = promptEditorProvider?.({ draft, kind });
        const controls = [mirrored || area];
        if (kind === 'options') controls.push(button('Restore default prompt', () => { draft.prompt = NPC_OPTIONS_PROMPT; area.value = NPC_OPTIONS_PROMPT; }, { kind: 'ghost' }));
        section('Prompt', field('Prompt', 'Sent with the length line and the count. Variables in double braces fill in when it runs.', ...controls),
            !mirrored && openPrompts && button('Open Setup, Prompts', openPrompts, { kind: 'ghost' }));
    }

    if (has('insertMode')) {
        section('Where the text goes', field('Insert mode', '', select([{ value: 'insert', label: 'Insert at cursor' }, { value: 'replace', label: 'Replace the message box' }],
            draft.insertMode || 'insert', value => { draft.insertMode = value; }, { 'aria-label': 'Insert mode' })));
    }

    if (has('text')) {
        const area = textArea(draft.text, value => { draft.text = value; }, { rows: 4, placeholder: kind === 'swipe' || kind === 'continue' ? 'Leave empty for a plain run.' : '' });
        let variable = 'user';
        const note = draft.source ? 'This action follows a source book entry while this box is empty.' : '';
        section('Direction text', field('Direction text', note || 'Macros such as {{user}} and {{char}} fill in when it runs.', area),
            h('div', { class: 'ri-qa-row' }, field('Insert a variable', '', select(Object.entries(QUICK_ACTION_VARIABLES).map(([value, label]) => ({ value, label: `${label} · {{${value}}}` })),
                variable, value => { variable = value; }, { 'aria-label': 'Variable to insert' })),
            button('Insert variable', () => insertAtCursor(area, `{{${variable}}}`))));
    }

    if (has('visibility')) {
        const fresh = field('Fresh start', 'Asks the model to work from established facts and the current direction with new phrasing, so the reply stops echoing earlier prose.',
            select([{ value: '', label: 'Off' }, { value: 'one', label: 'This action' }, { value: 'five', label: 'Next five replies' }], draft.freshStart || '', value => { draft.freshStart = value; }, { 'aria-label': 'Fresh start' }));
        section('How it is sent',
            field('Private or Visible', '', select([{ value: 'private', label: 'Private' }, { value: 'visible', label: 'Visible' }], draft.delivery.visibility, value => { draft.delivery.visibility = value; }, { 'aria-label': 'Private or Visible' })),
            field('Required or Optional', 'Required directions get a follow-through check when that feature is on.', select([{ value: 'optional', label: 'Optional' }, { value: 'required', label: 'Required' }],
                draft.delivery.required ? 'required' : 'optional', value => { draft.delivery.required = value === 'required'; }, { 'aria-label': 'Required or Optional' })),
            check('Roll a d20 with it', 'The roll is made in code and kept with the action.', draft.rollD20, on => { draft.rollD20 = on; }),
            fresh);
    }

    if (has('stat')) {
        const stats = statNames();
        if (draft.stat && !stats.includes(draft.stat)) stats.push(draft.stat);
        section('Action check',
            field('Stat', 'Chosen from Story, Characters, Stats.', select([{ value: '', label: 'No stat' }, ...stats.map(name => ({ value: name, label: name }))], draft.stat || '', value => { draft.stat = value; }, { 'aria-label': 'Stat' })),
            field('Difficulty', 'Leave empty for the usual outcome words.', h('input', { class: 'ri-input ri-input-num', type: 'number', inputMode: 'numeric', 'aria-label': 'Difficulty', value: String(draft.difficulty ?? ''),
                oninput: event => { draft.difficulty = event.target.value === '' ? '' : Math.round(Number(event.target.value)); } })),
            field('Who rolls', '', select([{ value: 'user', label: 'Me' }, { value: 'char', label: 'The character' }], draft.who || 'user', value => { draft.who = value; }, { 'aria-label': 'Who rolls' })));
    }

    if (has('opens')) {
        section('Opens', field('Opens', '', select([{ value: 'sent', label: 'What was sent' }, { value: 'context', label: 'Context' }], draft.opens || 'sent', value => { draft.opens = value; }, { 'aria-label': 'Opens' })));
    }
    add(host, sections);
}
