// The card catalog (DESIGN.md 6.2 and 6.3): every card, section and field the reply tray can show, as data.
// It is the single list of fields capture asks for. MB3 reads `captureFields()`; B20 built its rows (renderers in
// src/ui/cards/, one module per card) and gives each of them a capture hint (HINTS below); B22 draws the Roll and Stats cards.
//
// Saved values (the per-reply tracker values of the memory design, 3.3) live in the reply's own record, one
// set per swipe, under `rec.tracker`:
//   - A single-subject card keeps an object keyed by field id: rec.tracker.scene = { place, time, weather, ... }.
//   - A per-subject card keeps a list of objects with a `name` and its field ids:
//     rec.tracker.characters = [{ name, doing, mind, ... }].
//   - A value is a string, a number, a list, or { v, from } when it is carried from reply `from`.
// Fields marked `derived` are filled from the reply itself or from records the extension already keeps, so
// capture never asks for them.
//
// Setting defaults (row 36 of DESIGN.md section 12): a card, section or field the extension draws today keeps its
// setting (`today: true`); everything new starts off.

export const FAMILIES = Object.freeze({ story: 'Story', direction: 'Direction', review: 'Review' });
export const MODES = Object.freeze({ off: 'Off', strip: 'Strip only', tray: 'In the tray' });
export const PRESET_NAMES = Object.freeze({ Vexa: 'Vexa (Tavo Vexa v1.0)', Sola: 'Neon Sola V5', Deus: 'Deus Ex Machina V4', Pura: "Pura's Director 16.0" });

/** One field. `from` lists the preset parts it carries, as "<Preset>|<part name>" (the first cell of the 6.3 tables). */
const f = (id, label, type, o = {}) => ({ id, label, type, owner: 'B11', today: false, derived: false, from: [], ...o });
/** One section. `kinds` names the saved record kinds that fill it today. */
const s = (id, label, fields, o = {}) => ({ id, label, owner: 'B11', today: false, from: [], kinds: [], ...o, fields });
/** One card. `module` is the feature that supplies it (Theirs or off hides the card). */
const c = (id, label, icon, family, effect, sections, o = {}) => ({ id, label, icon, family, effect, owner: 'B11', today: false, module: '', ...o, sections });

const V = part => `Vexa|${part}`, S = part => `Sola|${part}`, D = part => `Deus|${part}`, P = part => `Pura|${part}`;
const SCENE_TRACKERS = [V('Time header'), D('Tracker (Exact Time or Time Window)'), P('Scene Tracker, Time Tracker')];

export const CARDS = Object.freeze([
    c('scene', 'Scene', 'fa-location-dot', 'story', 'Where and when the reply happens, who is present and what can be seen.', [
        s('where', 'Where and when', [
            f('place', 'Place', 'text', { today: true, from: SCENE_TRACKERS }),
            f('time', 'Story date and time', 'text', { today: true, from: SCENE_TRACKERS }),
            f('weather', 'Weather', 'text', { today: true }),
        ], { today: true }),
        s('surroundings', 'Surroundings', [
            f('environment', 'Environment', 'text', { today: true, from: [V('World')] }),
        ], { today: true }),
        s('cast', 'Who is there', [
            f('present', 'Present', 'chips', { today: true, from: [V('On-Screen'), S('Scene Cast (Location, Active Speakers, Ambient NPCs, Observable Facts)')] }),
            f('ambient', 'Ambient people', 'chips', { from: [S('Scene Cast (Location, Active Speakers, Ambient NPCs, Observable Facts)')] }),
        ], { today: true }),
        s('facts', 'Observable facts', [
            f('facts', 'Observable facts', 'list', { from: [S('Scene Cast (Location, Active Speakers, Ambient NPCs, Observable Facts)')] }),
        ]),
        s('places', 'Known places', [
            f('places', 'Known places', 'timeline', { from: [V('Locations')] }),
        ]),
        s('detail', 'World detail', [
            f('detail', 'World detail', 'quote', { owner: 'B20', from: [P('World Detail Tracker')] }),
        ], { owner: 'B20' }),
    ], { today: true, module: 'state' }),

    c('map', 'Map', 'fa-map', 'story', 'The current room as a text grid with who and what stands where.', [
        s('grid', 'Room grid', [f('grid', 'Room grid', 'grid', { owner: 'B20', from: [V('World Map')] })], { owner: 'B20' }),
    ], { owner: 'B20', module: 'state' }),

    c('characters', 'Characters', 'fa-masks-theater', 'story', 'What each present character is doing, thinking and feeling, and who they are.', [
        s('now', 'Right now', [
            f('avatar', 'Avatar', 'avatar'),
            f('doing', 'Doing now', 'text', { from: [V('On-Screen'), D('Status (all characters or present only)')] }),
        ]),
        s('inner', 'Inner life', [
            f('mind', 'Mind', 'text', { today: true, from: [D('Status (all characters or present only)')] }),
            f('heart', 'Heart', 'text', { today: true }),
            f('body', 'Body', 'text', { today: true }),
            f('psyche', 'Psyche', 'text', { today: true }),
            f('thoughts', 'Thoughts', 'quote', { from: [V('Thoughts')] }),
        ], { today: true }),
        s('portrayal', 'Portrayal', [
            f('who', 'Who they are', 'folded', { today: true, from: [V('Profile')] }),
            f('facet', 'Facet', 'text', { today: true, from: [V('Profile')] }),
            f('voice', 'Voice', 'text', { today: true, from: [V('Profile')] }),
            f('outfit', 'Outfit', 'text', { from: [V('Profile')] }),
            f('holding', 'Holding', 'text', { from: [V('Profile')] }),
        ], { today: true }),
        s('faculty', 'Faculty set', [
            f('ego', 'Ego', 'faculty', { from: [S('Heart Engine (Ego, Nerve, Body, Psyche, up to three characters)')] }),
            f('nerve', 'Nerve', 'faculty', { from: [S('Heart Engine (Ego, Nerve, Body, Psyche, up to three characters)')] }),
            f('faculty_body', 'Body (faculty)', 'faculty', { from: [S('Heart Engine (Ego, Nerve, Body, Psyche, up to three characters)')] }),
            f('faculty_psyche', 'Psyche (faculty)', 'faculty', { from: [S('Heart Engine (Ego, Nerve, Body, Psyche, up to three characters)')] }),
        ]),
        s('conditions', 'Conditions', [
            f('conditions', 'Conditions', 'severity', { owner: 'B20', from: [P('Status and Conditions Tracker')] }),
        ], { owner: 'B20' }),
    ], { today: true, module: 'state' }),

    c('emotions', 'Emotions', 'fa-heart', 'story', 'How strongly each character feels, with the change since the last reply.', [
        s('axes', 'Emotional axes', [
            f('axes', 'Axes', 'meter', { today: true }),
            f('outward', 'Outward behavior', 'text', { today: true }),
            f('counterweight', 'Coexisting feeling', 'text', { today: true }),
        ], { today: true, kinds: ['emotion'] }),
        s('turn', 'Turn psychology', [
            f('side', 'Side the moment brings out', 'text', { owner: 'B20', from: [D('Psychological States')] }),
            f('read', 'How they read it', 'text', { owner: 'B20', from: [D('Psychological States')] }),
            f('feeling', 'Feeling it stirred', 'text', { owner: 'B20', from: [D('Psychological States')] }),
            f('acted', 'What it made them do', 'text', { owner: 'B20', from: [D('Psychological States')] }),
            f('ends', 'Where they end the turn', 'text', { owner: 'B20', from: [D('Psychological States')] }),
        ], { owner: 'B20' }),
    ], { today: true, module: 'emotions' }),

    c('relationships', 'Relationships', 'fa-people-arrows', 'story', 'Each pair, how far along they are and what moved it.', [
        s('pairs', 'Pairs', [
            f('pair', 'Pair', 'text', { today: true, from: [V('Pairs')] }),
            f('level', 'Level', 'gauge', { from: [V('Pairs')] }),
            f('change', 'Change and reason', 'change', { from: [V('Pairs')] }),
        ], { today: true, kinds: ['relationship'] }),
        s('route', 'Route', [
            f('route', 'Route', 'text', { owner: 'B20', from: [P('Relationship Tracker')] }),
            f('stands', 'Where they stand', 'text', { owner: 'B20', from: [P('Relationship Tracker')] }),
            f('feels', 'What they feel', 'text', { owner: 'B20', from: [P('Relationship Tracker')] }),
            f('trust_want', 'Trust and want', 'text', { owner: 'B20', from: [P('Relationship Tracker')] }),
            f('delights', 'What delights and repels', 'text', { owner: 'B20', from: [P('Relationship Tracker')] }),
            f('moment', 'The moment they keep', 'text', { owner: 'B20', from: [P('Relationship Tracker')] }),
            f('next', 'What would move them next', 'text', { owner: 'B20', from: [P('Relationship Tracker')] }),
        ], { owner: 'B20' }),
    ], { today: true, module: 'relationships' }),

    c('holding_back', 'Holding back', 'fa-lock', 'story', 'What a character lets themselves show or say to another, and the strain.', [
        s('dam', 'Held back', [f('dam', 'Held back', 'text', { owner: 'B20', from: [V('Dam')] })], { owner: 'B20' }),
    ], { owner: 'B20', module: 'relationships' }),

    c('knowledge', 'Knowledge and secrets', 'fa-eye', 'story', 'Who knows what, secrets with their owners, false beliefs and what each person remembers.', [
        s('knows', 'Who knows what', [f('knows', 'Who knows what', 'chips', { owner: 'B20', derived: true, from: [D('Hidden Truths')] })],
            { owner: 'B20', today: true, kinds: ['knowledge'] }),
        s('secrets', 'Secrets', [f('secrets', 'Secrets', 'list', { owner: 'B20', from: [D('Hidden Truths'), P('Secrets Tracker')] })], { owner: 'B20' }),
        s('beliefs', 'False beliefs', [f('beliefs', 'False beliefs', 'list', { owner: 'B20', from: [D('Hidden Truths'), P('Secrets Tracker')] })], { owner: 'B20' }),
        s('remembers', 'What each person remembers', [f('remembers', 'What each person remembers', 'list', { owner: 'B20', from: [V('Memory')] })], { owner: 'B20' }),
    ], { owner: 'B20', today: true, module: 'knowledge' }),

    c('inventory', 'Inventory', 'fa-box-open', 'story', 'Items per character with what changed and why it counts.', [
        s('items', 'Items', [f('items', 'Items', 'change', { owner: 'B20', from: [V('Inventory'), P('Item Tracker')] })], { owner: 'B20' }),
    ], { owner: 'B20', module: 'state' }),

    c('plot', 'Plot', 'fa-scroll', 'story', 'Open threads, story lines, what happens elsewhere and what is waiting to pay off.', [
        s('threads', 'Open threads', [f('threads', 'Open threads', 'timeline', { today: true, from: [V('Story notes'), D('Story Threads')] })],
            { today: true, kinds: ['event'] }),
        s('plotlines', 'Plotlines', [f('plotlines', 'Plotlines', 'timeline', { owner: 'B20', derived: true, from: [V('Arc'), D('Plotlines')] })],
            { owner: 'B20', today: true, kinds: ['arc'] }),
        s('tracks', 'Tracks', [f('tracks', 'Tracks', 'timeline', { owner: 'B20', derived: true, from: [V('Tracks')] })], { owner: 'B20' }),
        s('elsewhere', 'Elsewhere', [f('elsewhere', 'Elsewhere', 'timeline', { owner: 'B20', derived: true,
            from: [V('Off-Screen agendas'), S('Continuity Codex: Motives'), D('Meanwhile'), P('Parallel Off-Screen Tracker')] })],
        { owner: 'B20', today: true, kinds: ['agenda'] }),
        s('details', 'Planted details', [f('details', 'Planted details', 'timeline', { owner: 'B20', derived: true, from: [V('Chekhov'), S('Continuity Codex: Threads, Seeds')] })],
            { owner: 'B20', today: true, kinds: ['seed'] }),
        s('pending', 'Pending events', [f('pending', 'Pending events', 'timeline', { owner: 'B20', derived: true, from: [P('Pending Events Tracker')] })], { owner: 'B20' }),
    ], { today: true, module: 'plots' }),

    c('new_faces', 'New faces', 'fa-id-card', 'story', 'A profile sheet where a named character first appears.', [
        s('sheet', 'Profile sheet', [f('sheet', 'Profile sheet', 'folded', { owner: 'B20', from: [D('New Faces'), P('NPC Profile Sheets')] })], { owner: 'B20' }),
    ], { owner: 'B20', module: 'state' }),

    c('reputation', 'Reputation', 'fa-bullhorn', 'story', 'How each group or source sees you, which way it is moving and why.', [
        s('standing', 'Standing', [f('standing', 'Standing', 'change', { owner: 'B20', from: [P('Reputation Tracker')] })], { owner: 'B20' }),
    ], { owner: 'B20', module: 'state' }),

    c('achievements', 'Achievements', 'fa-trophy', 'story', 'A title, how rare it is and what earned it.', [
        s('earned', 'Earned', [f('earned', 'Achievement', 'stars', { owner: 'B20', from: [P('Achievements Tracker')] })], { owner: 'B20' }),
    ], { owner: 'B20', module: 'state' }),

    c('changes', 'Story changes', 'fa-list-check', 'story', 'What this reply filed into the story and which threads it closed.', [
        s('filed', 'Filed this reply', [f('filed', 'Filed this reply', 'list', { today: true, derived: true, from: [V('Story notes')] })], { today: true }),
        s('closed', 'Threads closed', [f('closed', 'Threads closed', 'list', { derived: true })]),
        s('facts_on_record', 'Facts on record', [f('facts_on_record', 'Facts on record', 'list', { today: true, derived: true })], { today: true, kinds: ['fact'] }),
    ], { today: true }),

    c('lore', 'World Info', 'fa-book', 'story', 'The World Info entries used for this reply, each linking to its entry.', [
        s('entries', 'Entries used', [f('entries', 'Entries used', 'list', { today: true, derived: true })], { today: true }),
    ], { today: true }),

    c('plan', "Director's desk", 'fa-route', 'direction', 'The reply plan and where the next beat heads.', [
        s('plan', 'Plan', [f('plan', 'Plan', 'folded', { today: true, derived: true })], { today: true }),
        s('course', 'Course', [f('course', 'Course', 'text', { owner: 'B20', from: [S('Continuity Codex: Horizon'), S("Director's Desk: Dare, Course, Branches, Engine, Graded")] })], { owner: 'B20' }),
        s('pressure', 'Pressure', [f('pressure', 'Pressure', 'text', { owner: 'B20',
            from: [S("Director's Desk: Dare, Course, Branches, Engine, Graded"), D('Undercurrents, Momentum Engine, Conflict')] })], { owner: 'B20' }),
        s('branches', 'Branches', [f('branches', 'Branches', 'list', { owner: 'B20',
            from: [S("Director's Desk: Dare, Course, Branches, Engine, Graded"), D('Undercurrents, Momentum Engine, Conflict'), P('Direction Menu')] })], { owner: 'B20' }),
        s('graded', 'Graded', [f('graded', 'Graded', 'text', { owner: 'B20', from: [S("Director's Desk: Dare, Course, Branches, Engine, Graded")] })], { owner: 'B20' }),
    ], { today: true }),

    c('choices', 'Choices', 'fa-list-ol', 'direction', 'Numbered moves for your next message, each with Copy, Insert and Send.', [
        // Filled by the Choices card's own Options call after each reply (DESIGN 6.2), never by capture.
        s('moves', 'Moves', [f('moves', 'Moves', 'list', { owner: 'B20', derived: true, from: [D('Choices List'), P('CYOA Choices, CYOA Choices with Skill Checks')] })], { owner: 'B20' }),
    ], { owner: 'B20' }),

    c('stats', 'Stats', 'fa-chart-simple', 'direction', 'This chat\'s stat sheets with level and growth notes.', [
        s('sheets', 'Stat sheets', [f('sheets', 'Stat sheets', 'grid', { owner: 'B22', from: [P('Persona-Based Stat Generator, Level-Up Companion, Diegetic Stats Mode')] })], { owner: 'B22' }),
    ], { owner: 'B22' }),

    c('roll', 'Roll', 'fa-dice-d20', 'direction', 'One line per roll in this reply.', [
        s('lines', 'Roll lines', [f('lines', 'Roll lines', 'one-line', { owner: 'B22',
            from: [D('Fate Outcomes'), P('CYOA Choices with Skill Checks (the checks)')] })], { owner: 'B22' }),
    ], { owner: 'B22' }),

    c('notebook', 'Notebook', 'fa-book-bookmark', 'review', 'Narrator notes and private diary entries.', [
        s('narrator', 'Narrator notes', [f('narrator', 'Narrator notes', 'list', { owner: 'B20', from: [V('Notebook')] })], { owner: 'B20' }),
        s('diaries', 'Diaries', [f('diaries', 'Diaries', 'quote', { owner: 'B20', from: [D('Diaries')] })], { owner: 'B20' }),
    ], { owner: 'B20' }),

    c('roast', 'Roast', 'fa-fire', 'review', 'A reader commenting on the reply, in one voice or as a panel.', [
        s('voice', 'One voice', [f('voice', 'Roast', 'quote', { today: true, derived: true, from: [V('Vent'), S('Continuity Codex: Sola Comment')] })], { today: true }),
        s('panel', 'Panel', [f('panel', 'Panel', 'quote', { owner: 'B20', from: [D('Companions (Notes)')] })], { owner: 'B20' }),
    ], { today: true, module: 'roast' }),

    c('sent', 'Sent', 'fa-receipt', 'review', 'What went with this reply, which connection answered and what each background call cost.', [
        s('sent', 'Sent', [f('sent', 'Sent', 'list', { today: true, derived: true })], { today: true }),
    ], { today: true }),

    c('notes', 'Notes', 'fa-note-sticky', 'review', 'Reply screening notes and problems found in this reply.', [
        s('notes', 'Notes', [f('notes', 'Notes', 'list', { today: true, derived: true })], { today: true }),
    ], { today: true }),
]);

// ---------- lookups ----------

export const cardById = id => CARDS.find(card => card.id === id) || null;
export const fieldKey = (card, field) => `${card}.${field}`;
export const sectionKey = (card, section) => `${card}:${section}`;

/** Every field with its card and section, in catalog order. */
export function allFields() {
    return CARDS.flatMap(card => card.sections.flatMap(section => section.fields.map(field => ({ card, section, field, key: fieldKey(card.id, field.id) }))));
}

/** Whether a card, section or field is built: its owner is B11 or B20, whose renderers ship. B22 flips its own on adding a renderer. */
const built = new Set(['B11', 'B20']);
export function markBuilt(owner) { built.add(owner); }
export const isBuilt = item => built.has(item.owner);

// ---------- the setting ----------

/** The default mode of a card: today's setting for cards drawn today, Off for every new one. */
export const defaultMode = card => (card.today ? 'tray' : 'off');

const bool = value => value === true || value === false ? value : undefined;

/** A clean copy of a saved setting: { mode: {card: mode}, on: {key: bool}, order: [card ids] }. Unknown ids are dropped. */
export function normalizeConfig(saved) {
    const input = saved && typeof saved === 'object' ? saved : {};
    const mode = {}, on = {};
    for (const card of CARDS) if (Object.hasOwn(MODES, input.mode?.[card.id])) mode[card.id] = input.mode[card.id];
    for (const { card, section, field, key } of allFields()) {
        const sk = sectionKey(card.id, section.id);
        if (bool(input.on?.[key]) !== undefined) on[key] = input.on[key];
        if (bool(input.on?.[sk]) !== undefined) on[sk] = input.on[sk];
    }
    const seen = new Set();
    const order = (Array.isArray(input.order) ? input.order : []).filter(id => cardById(id) && !seen.has(id) && seen.add(id));
    return { mode, on, order };
}

export function cardMode(config, id) {
    const card = cardById(id);
    return card ? (config?.mode?.[id] ?? defaultMode(card)) : 'off';
}

export function sectionOn(config, cardId, sectionId) {
    const section = cardById(cardId)?.sections.find(item => item.id === sectionId);
    return section ? (config?.on?.[sectionKey(cardId, sectionId)] ?? section.today) : false;
}

/**
 * The default of a field's own switch. A field the extension draws today keeps its setting; a field new to an
 * existing section starts off; a field in a new section follows its section (the section starts off, so the field
 * is off until the section is switched on).
 */
export const fieldDefault = (section, field) => (section.today ? field.today : true);

/** A field is on when its card is not Off, its section is on and its own switch is on. A section's only field follows the section. */
export function fieldOn(config, cardId, fieldId) {
    const card = cardById(cardId);
    const section = card?.sections.find(item => item.fields.some(field => field.id === fieldId));
    const field = section?.fields.find(item => item.id === fieldId);
    if (!field || cardMode(config, cardId) === 'off' || !sectionOn(config, cardId, section.id)) return false;
    if (section.fields.length === 1) return true;
    return config?.on?.[fieldKey(cardId, fieldId)] ?? fieldDefault(section, field);
}

/** The cards in the saved order, with any card the order does not name after them in catalog order. */
export function orderedCards(config) {
    const saved = (config?.order || []).map(cardById).filter(Boolean);
    return [...saved, ...CARDS.filter(card => !saved.includes(card))];
}

/** A new setting with the card moved one place up (-1) or down (1). */
export function moveCard(config, id, direction) {
    const order = orderedCards(config).map(card => card.id);
    const at = order.indexOf(id), to = at + (direction < 0 ? -1 : 1);
    if (at < 0 || to < 0 || to >= order.length) return normalizeConfig({ ...config, order });
    [order[at], order[to]] = [order[to], order[at]];
    return normalizeConfig({ ...config, order });
}

/** A new setting with one card, section or field switched. `key` is a fieldKey or sectionKey. */
export const setOn = (config, key, value) => normalizeConfig({ ...config, on: { ...config?.on, [key]: !!value } });

/**
 * A new setting with one card's mode changed. A card switched on from Off whose built sections are all off gets them
 * switched on, so a card new with the parity work shows its content once it is on; each section can then be switched
 * off on its own. A card with a section already on keeps its sections as they are.
 */
export function setMode(config, id, mode) {
    let next = normalizeConfig({ ...config, mode: { ...config?.mode, [id]: mode } });
    const card = cardById(id);
    if (!card || mode === 'off' || cardMode(config, id) !== 'off') return next;
    const sections = card.sections.filter(isBuilt);
    if (sections.length && !sections.some(section => sectionOn(next, id, section.id))) {
        for (const section of sections) next = setOn(next, sectionKey(id, section.id), true);
    }
    return next;
}

/**
 * The fields capture asks for: built, not derived, in a card that is not Off and not hidden by its feature,
 * in a section that is on, with the field's own switch on. `modules` maps a feature to false when it is off
 * or on Theirs (see `visibleCards` in reply-tray.js).
 */
export function captureFields(config, modules = {}) {
    return allFields().filter(({ card, section, field }) => isBuilt(field) && !field.derived
        && !(card.module && modules[card.module] === false) && fieldOn(config, card.id, field.id))
        .map(({ card, section, field, key }) => ({ key, card: card.id, section: section.id, field: field.id, label: field.label, type: field.type,
            ...(HINTS[key] ? { hint: HINTS[key] } : {}) }));
}

/**
 * What capture writes in a parity field, so the card can draw it: one short instruction per field, in the shape the
 * card reads (src/ui/cards/). A list or timeline field holds one item per entry; "a | b" separates the parts of one item.
 */
export const HINTS = Object.freeze({
    'scene.detail': 'one concrete detail of the world this reply shows, in one sentence',
    'map.grid': 'the current room as a text grid of at most 12 lines and 32 columns, one letter per person or object, then one legend line per letter, "H: Hale"',
    'characters.conditions': 'each condition with its severity, mild, moderate or severe, separated by semicolons: "sprained ankle (moderate); fever (mild)"',
    'emotions.side': 'the side of the character this moment brings out',
    'emotions.read': 'how the character reads the moment',
    'emotions.feeling': 'the feeling the moment stirred',
    'emotions.acted': 'what the feeling made the character do',
    'emotions.ends': 'where the character stands at the end of the turn',
    'relationships.route': 'the route the character is on with the other person',
    'relationships.stands': 'where they stand with each other now',
    'relationships.feels': 'what the character feels toward the other',
    'relationships.trust_want': 'how far the character trusts the other and what they want from them',
    'relationships.delights': 'what about the other delights and what repels the character',
    'relationships.moment': 'the shared moment the character keeps',
    'relationships.next': 'what would move the relationship next',
    'holding_back.dam': 'one line per pair: "Name to Name | what they show or say | what they hold back | strain low, rising or high"',
    'knowledge.secrets': 'one item per secret: "the secret | owner: Name | also known by: Name, Name"',
    'knowledge.beliefs': 'one item per false belief: "Name believes: the belief | truth: what is true"',
    'knowledge.remembers': 'one item per character: "Name: what they remember from this scene"',
    'inventory.items': 'one line per item that matters: "Holder: item (gained, lost, used, broken or given) | where it came from or why it counts"',
    'new_faces.sheet': 'one line per named character who first appears in this reply: "Name (major) | role | look | manner | want | what they know" for a major character, "Name (minor) | who they are" for a minor one; empty when nobody new appears',
    'reputation.standing': 'one line per group or source: "Group | how they see the player character | rising, falling or steady | why"',
    'achievements.earned': 'at most one per scene, only when the reply earns it: "Title | rarity 1 to 5 | what earned it"',
    'plan.course': 'where the next beat heads, in one sentence',
    'plan.pressure': 'the live conflict or dare pressing on the scene, in one sentence',
    'plan.branches': 'up to three possible routes for the next beat, one per item',
    'plan.graded': 'how the last beat landed, in one line',
    'notebook.narrator': 'reminders and open questions for the narrator, one per item',
    'notebook.diaries': 'for the two characters closest to the player character, one line each: "Name: a short private diary entry in their own voice"',
    'roast.panel': 'up to three commentators, one line each: "Name: their comment on this reply"',
});

/** The built sections and fields of a card that are switched off, so a card can say "Not requested" (6.2). */
export function notRequested(config, cardId) {
    const card = cardById(cardId);
    if (!card) return [];
    return card.sections.filter(section => isBuilt(section) && section.fields.some(field => isBuilt(field) && !field.derived)).flatMap(section => {
        if (!sectionOn(config, cardId, section.id)) return [{ key: sectionKey(cardId, section.id), label: section.label }];
        return section.fields.filter(field => isBuilt(field) && !field.derived && !fieldOn(config, cardId, field.id))
            .map(field => ({ key: fieldKey(cardId, field.id), label: field.label }));
    });
}
