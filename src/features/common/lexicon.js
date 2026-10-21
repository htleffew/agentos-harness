// Undercurrent 2 · FEATURES — detection word lists (pure data).
//
// Everything here is used to DETECT things in text (stopwords, scene cues, verbs that would script the player). Nothing
// here is ever sent to a model as an instruction. The no-hardcoding test exempts this file (and the slop data) from the
// gendered-pronoun scan for that reason: pronouns appear only as words to ignore or to recognise.

const words = s => s.trim().split(/\s+/);

/** Function words ignored by n-gram, echo and keyword logic. */
export const STOPWORDS = new Set(words(`a an the and or but if then so of to in on at by for with from into onto as is are was were be
been being i me my mine you your yours he him his she her hers it its we us our they them their this that these those there here not no do
does did done have has had will would can could should shall may might must just very too also than up down out over under again once only
own same s t don didn doesn isn wasn weren won wouldn couldn shouldn what which who whom whose when where why how all any both each few more
most other some such about against between through during before after above below off further am o re ve ll d m`));

/** Extra stopwords for memory recall: roleplay filler that matches everything and identifies nothing. */
export const RECALL_STOPWORDS = new Set(words(`said says say asked asks ask looked looks look looking smiled smiles smile smiling nodded
nods nod nodding sighed sighs sigh laughed laughs laugh grinned grins grin turned turns turn turning eyes eye face hand hands head voice
room moment moments little bit thing things something nothing anything everything one ones like just still even back away around again
really maybe perhaps yeah yes okay well now then time way know knew think thought want wanted get got make made take took come came
going went let lets felt feel feels feeling seemed seems seem around toward towards across while though although because`));

/** Cue words that suggest an intimate (physical, sexual) scene. Matched as whole words or word starts (trailing *). */
export const INTIMATE_CUES = words(`kiss* undress* naked nude bare* bed sheets moan* thrust* arous* caress* stroke* grind* straddl* climax*
orgasm* lick* nipple* breast* thigh* hips cock pussy erect* wet* lust* foreplay unbutton* unzip* lingerie bra panties strip* panting
pant* gasp* skin-to-skin sex sexual make-out making-out fuck*`);

/** Cue words that suggest attraction or flirting (not necessarily intimate). */
export const ATTRACTION_CUES = words(`flirt* blush* crush date dating attract* desir* chemistry tease* teasing wink* longing yearn* lips
handsome beautiful gorgeous pretty cute charming seduc* tempt* intimate closer lean* gaze* butterflies heartbeat pulse* romantic romance
kiss* touch* hand-holding cheek* dinner`);

/** Cue words that suggest grief, mourning or acute loss. */
export const GRIEF_CUES = words(`grief griev* mourn* funeral wake burial buried grave casket coffin died death dead dying passed
condolence* sob* weep* wept tears bereave* loss lost eulogy memorial hospice`);

/** Cue words that suggest an argument or open conflict between people. */
export const ARGUMENT_CUES = words(`argu* shout* yell* scream* furious angry anger fight* accus* blame* betray* liar lying slam*
snap* snarl* glare* hiss* storm* outburst insult* resent* hostile`);

/** Cue words that suggest physical action or danger. */
export const ACTION_CUES = words(`run* sprint* chase* gun* shot* shoot* blade knife sword punch* kick* dodge* explod* blast* crash*
attack* ambush* fled flee* escape* bleed* wound* fire flames alarm siren`);

/** Words in a character's mood that mean they are under strain (minds: defense under stress). */
export const STRAIN_MOODS = words(`afraid scared terrified anxious panicked panicking ashamed humiliated hurt furious angry betrayed
cornered desperate overwhelmed grieving devastated jealous guilty exposed defensive rattled shaken`);

/** Personality cues → how a person defends under strain (chosen only from the character's own recorded text). */
export const DEFENSES = [
    { id: 'deflection', behavior: 'dodges: changes the subject or gets suddenly busy', cues: words('evasive guarded secretive private aloof reserved mysterious cagey') },
    { id: 'humor', behavior: 'jokes it away at the worst moment', cues: words('witty sarcastic playful teasing funny irreverent snarky flippant') },
    { id: 'aggression', behavior: 'goes on the attack: sharper words, blame, striking first', cues: words('hot-tempered aggressive combative volatile fierce confrontational hostile brash') },
    { id: 'withdrawal', behavior: 'pulls back: shorter answers, more distance, an exit if one exists', cues: words('shy introverted quiet withdrawn loner avoidant solitary stoic timid') },
    { id: 'rationalization', behavior: 'explains it away with a tidy story that skips the feeling', cues: words('analytical logical intellectual calculating rational pragmatic controlled cerebral detached') },
    { id: 'caretaking', behavior: 'fixes someone else\'s problem instead of feeling this one', cues: words('caring nurturing protective selfless helpful dutiful devoted kind') },
    { id: 'control', behavior: 'grabs control of something small: tidying, rules, a plan', cues: words('perfectionist controlling organized meticulous disciplined strict orderly rigid') },
];

/** Verbs that, with the player's name as the subject in narration, mean the reply scripted the player. */
export const USER_ACTION_VERBS = words(`says said asks asked replies replied whispers whispered answers answered murmurs murmured shouts
shouted yells yelled nods nodded smiles smiled laughs laughed sighs sighed shrugs shrugged grins grinned blushes blushed giggles giggled
winces winced swallows swallowed hesitates hesitated leans leaned reaches reached kisses kissed steps stepped walks walked turns turned
takes took grabs grabbed pulls pulled pushes pushed sits sat stands stood moans moaned gasps gasped shudders shuddered trembles trembled
melts melted surrenders surrendered climaxes agrees agreed refuses refused accepts accepted obeys obeyed follows followed`);

/** Decision / interior verbs: the player deciding, thinking or feeling (narrated). */
export const USER_INTERIOR_VERBS = words(`decides decided thinks thought feels felt wonders wondered wants wanted realizes realized
realises realised hopes hoped wishes wished craves craved knows knew remembers remembered notices noticed considers considered chooses
chose loves loved hates hated fears feared needs needed enjoys enjoyed`);

/** "<player>'s …" nouns that narrate the player's inner life or involuntary body responses. */
export const USER_INTERIOR_NOUNS = words(`heart mind thoughts pulse stomach chest cheeks breath resolve desire arousal feelings emotions
fear excitement nerves pleasure core body`);

/** Words right before a match that make it hypothetical or negated, not narrated ("before X says", "if X nods"). */
export const SUBORDINATE_BEFORE = /\b(?:the\s+way|how|if|when|whenever|whether|unless|until|before|after|once|while|wait(?:s|ing)?\s+for|let|lets|in\s+case|as\s+though|as\s+if|never|not|don't|doesn't|won't|didn't|without)\s+(?:\w+\s+){0,2}$/i;

/** Pronoun words that can stand for a person (critic: "finds herself" style constructions in rule lines). */
export const REFLEXIVE_PRONOUNS = 'herself|himself|themself|themselves';
