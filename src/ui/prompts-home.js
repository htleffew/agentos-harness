// Setup, Prompts (DESIGN.md 3.3 and 3.4): every prompt the extension sends, listed once and grouped by family.
// Each row is the mirrored editor of prompt-mirror.js, so an edit here and an edit beside a feature change
// the one stored prompt. The foot row of every page ("Prompts for this page") opens this page filtered.
import { h, button } from './dom.js';
import { PROMPTS, promptDefinition, promptStatus } from '../prompts.js';
import { customVoices, VOICES } from '../voices.js';
import { registerPage, registeredPages } from './page-registry.js';
import { buildTree, locate, pathName } from './destinations.js';
import { mirroredPrompt, watchPrompts } from './prompt-mirror.js';

export const PROMPTS_PAGE_ID = 'prompts';

// The pages that hold a prompt today, by the page ids of destinations.js, and the stored prompts each uses.
// A prompt listed under two pages shows once, under the first one, and the foot row of both pages counts it.
const PAGE_PROMPTS = {
    state: ['timingUpdate'],
    opening: ['systemOpening', 'readGreeting', 'openingPlayerThoughts', 'sceneOpening'],
    corrections: ['traceCorrection', 'correctionSwipe', 'correctionCanon'],
    portrayal: ['structuredPortrayal', 'structuredKnowledge', 'checkKnowledge'],
    emotion: ['emotionSensitivity', 'checkEmotion', 'structuredEmotions', 'structuredRelationships'],
    speakers: ['speakerGuidance'],
    facts: ['structuredFacts', 'structuredRepair'],
    plots: ['autonomousEvent', 'optionalOpportunity', 'structuredSchedule', 'structuredOutcomes', 'lockedPayoff', 'checkPlot'],
    world: ['memoryFacts', 'storyNotes', 'worldOrder', 'silentCharacter', 'threadOrder', 'seedOrder', 'activityOrder', 'secretOrder',
        'entryWriterRules', 'systemWorldEntry', 'starterWorld', 'systemStarter', 'chapterSummary', 'systemChapter', 'chapterCombine', 'systemCombine',
        'newChapterSummary', 'newChapterFirst', 'systemNewChapter', 'chapterOpeningScene'],
    books: ['bookKeywords', 'systemBookKeywords'],
    context: ['chapterSummary'],
    sets: ['instructionOrder', 'overdueOrder', 'finalOrder', 'instructionAgency', 'versionRules', 'modelVersionRules', 'systemVersions',
        'event', 'eventWriterRules', 'anywhere', 'situationRules', 'complicationRules', 'driverRules', 'toneRules', 'stakeRules', 'rewriteRules', 'systemItems', 'systemRewrite',
        'style', 'styleWriterRules', 'systemStyleItems'],
    goals: ['goalOrder', 'goalOngoing', 'goalWriterRules', 'systemGoal'],
    writing: ['proseReview', 'groundedRealism', 'heightenedRealism', 'sceneSolo', 'sceneEnsemble', 'sceneUnknown', 'sceneContinue',
        'checkPhysical', 'checkSocial', 'checkCraft', 'checkContinuity'],
    v10: ['playerDraft', 'playerChoices', 'playerExpansion', 'planGuidance', 'proseFirst', 'conflictCheck', 'resolvedActionGuidance'],
    display: ['structuredRoast', 'roastFeedback', ...Object.keys(VOICES)],
    settings: ['guided', 'guidedContinue', 'historicalSwipe', 'historicalContinue', 'freshStart', 'checker', 'systemCheck'],
    memory: ['stateContext'],
};

// Families follow the five colors of DESIGN.md 1.2; Reply holds what writes the reply now.
export const FAMILIES = [
    { id: 'story', label: 'Story', pages: ['state', 'opening', 'corrections', 'portrayal', 'emotion', 'speakers', 'facts', 'plots', 'world', 'books', 'context'] },
    { id: 'direction', label: 'Direction', pages: ['sets', 'goals', 'writing'] },
    { id: 'reply', label: 'Reply', pages: ['v10', 'display'] },
    { id: 'setup', label: 'Setup', pages: ['settings'] },
];
// A prompt that sits on a page of one family but belongs to another by what it does.
const FAMILY_OVERRIDE = { guided: 'reply', guidedContinue: 'reply', historicalSwipe: 'reply', historicalContinue: 'reply', freshStart: 'reply',
    stateContext: 'story' };

/** The page ids that use a stored prompt, first page first. */
export function promptPages(id) {
    return Object.entries(PAGE_PROMPTS).filter(([, ids]) => ids.includes(id)).map(([page]) => page);
}

const familyOfPage = page => FAMILIES.find(family => family.pages.includes(page))?.id || 'setup';

/** Every stored prompt: the extension's own and each custom commentator voice. */
export function listedPromptIds() {
    return [...Object.keys(PROMPTS), ...customVoices().map(voice => voice.id)];
}

/** The prompts a page uses, for the foot row filter. */
export function promptsForPage(page) {
    return PAGE_PROMPTS[page] || [];
}

function entryOf(id) {
    const pages = promptPages(id);
    // A custom voice belongs with the built-in voices.
    const page = pages[0] || (id.startsWith('voice-') ? 'display' : '');
    return { id, page, pages: pages.length ? pages : page ? [page] : [], family: FAMILY_OVERRIDE[id] || (page ? familyOfPage(page) : 'setup'),
        label: promptDefinition(id)?.label || id };
}

const state = { query: '' };

const tree = () => buildTree(registeredPages());

const customizedTotal = () => listedPromptIds().filter(id => promptStatus(id).customized).length;

export function renderPromptsHome(body, app) {
    const filter = app.promptsFilter;
    const current = tree();
    const filterIds = filter && locate(current, filter.page)
        ? new Set([...promptsForPage(filter.page), ...(filter.prompts || []).map(item => item.id).filter(Boolean)]) : null;
    const entries = listedPromptIds().map(entryOf);
    const root = h('div', { class: 'ri-prompts-home', 'data-ri-shell': '' });
    const summary = h('p', { class: 'ri-help', role: 'status' });
    const results = h('div', { class: 'ri-prompts-results' });
    const search = h('input', { type: 'search', class: 'ri-input', 'aria-label': 'Find a prompt', placeholder: 'Find a prompt', autocomplete: 'off', value: state.query });

    function pageLabel(page) {
        return locate(current, page) ? pathName(current, page) : page;
    }

    function draw() {
        const query = state.query.trim().toLowerCase();
        const words = query.split(/\s+/).filter(Boolean);
        const shown = entries.filter(entry => (!filterIds || filterIds.has(entry.id))
            && words.every(word => `${entry.label} ${pageLabel(entry.page)}`.toLowerCase().includes(word)));
        const custom = shown.filter(entry => promptStatus(entry.id).customized).length;
        summary.textContent = `${shown.length} ${shown.length === 1 ? 'prompt' : 'prompts'}, ${custom} customized.`;
        const open = !!filterIds || words.length > 0;
        const sections = FAMILIES.map(family => {
            const mine = shown.filter(entry => entry.family === family.id);
            if (!mine.length) return null;
            const pages = [...new Set(mine.map(entry => entry.page))];
            const customized = mine.filter(entry => promptStatus(entry.id).customized).length;
            const badge = h('span', { class: 'ri-prompt-badge ri-chip' }, customized ? `${customized} customized` : 'All default');
            const group = h('details', { class: 'ri-prompts-family', 'data-family': family.id, open },
                h('summary', {}, h('span', { class: 'ri-prompts-family-name' }, family.label),
                    h('span', { class: 'ri-prompt-meta' }, h('span', { class: 'ri-chip' }, `${mine.length} prompts`), badge)),
                pages.map(page => h('section', { class: 'ri-prompts-page' },
                    h('div', { class: 'ri-prompts-pagehead' }, h('h3', {}, pageLabel(page)),
                        locate(current, page) && button('Open page', () => app.openPage(page, { focusPage: true }), { kind: 'ghost', title: `Open ${pageLabel(page)}` })),
                    mine.filter(entry => entry.page === page).map(entry => mirroredPrompt(entry.id, { lazy: true })))));
            watchPrompts(group, () => {
                const n = mine.filter(entry => promptStatus(entry.id).customized).length;
                badge.textContent = n ? `${n} customized` : 'All default';
            });
            return group;
        }).filter(Boolean);
        results.replaceChildren(...(sections.length ? sections : [h('p', { class: 'ri-help' }, 'No prompt matches.')]));
    }

    search.addEventListener('input', () => { state.query = search.value; draw(); });
    if (filterIds) {
        root.append(h('div', { class: 'ri-prompts-filter' },
            h('strong', {}, `Prompts for ${pageLabel(filter.page)}`),
            button('Show every prompt', () => { app.promptsFilter = null; app.render(); }, { kind: 'ghost' }),
            button('Open page', () => app.openPage(filter.page, { focusPage: true }), { kind: 'ghost' })));
    }
    root.append(h('p', { class: 'ri-help' }, 'Every prompt is stored once. The editor beside each feature and the one here are two views of the same prompt.'),
        h('label', { class: 'ri-field' }, 'Find a prompt', search), summary, results);
    draw();
    body.append(root);
}

export function registerPromptsPage() {
    registerPage({ id: PROMPTS_PAGE_ID, group: 'setup', label: 'Prompts', tab: 'prompts', withoutChat: true,
        help: 'Every prompt the extension sends, in one list. Each is stored once and also editable beside its feature.',
        aliases: 'prompt manager instructions wording variations restore default customized',
        status: () => { const n = customizedTotal(); return n ? `${n} customized` : 'All default'; },
        render: renderPromptsHome });
}
try { registerPromptsPage(); } catch (error) { console.warn('Roleplay Instructions could not add Setup, Prompts.', error); }
