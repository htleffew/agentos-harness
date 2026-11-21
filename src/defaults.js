// Default texts that the settings start with. This file imports nothing, so any module can use it.

export const DEFAULT_WRITER_RULES = [
    'Plain statements in literal words. Name feelings directly, as in "Hale feels angry". People say what they mean.',
    'What happens comes from what people want, feel, find out and choose: arrivals, invitations, discoveries, offers, decisions.',
    'Begin from ordinary health, rest and capacity. Focus on the immediate situation and what the characters choose to do.',
    'Describe the practical consequence for the people involved in concrete language.',
].join('\n');

export const ORIGINAL_WRITER_RULES = [
    'Plain statements in literal words. Feelings are named directly, as in "Hale feels angry". People say what they mean.',
    'What happens comes from what people want, feel, find out and choose: arrivals, invitations, discoveries, offers, decisions.',
    'People are rested, fed and able. Lasting bodily states such as injury, pain, tiredness, cold and hunger are left out.',
    'Prices, payments, debts, ownership, records, paperwork, officials and enforced rules are left out.',
].join('\n');

export const DEFAULT_WORDS = [
    'ledger*', 'debt*', 'owe', 'owes', 'owed', 'owing', 'price', 'prices', 'priced', 'cost', 'costs', 'costly', 'coin', 'coins', 'fee', 'fees', 'tax', 'taxes',
    'permit', 'permits', 'paperwork', 'clerk*', 'official', 'officials', 'bureaucra*', 'archive*',
    'wound*', 'bruise*', 'ache', 'aches', 'aching', 'sore', 'exhaust*', 'fatigue*', 'hunger', 'hungry', 'starv*', 'shiver*',
    'tastes', 'tasting', 'lands', 'landed', 'landing', 'shift', 'shifts', 'shifted', 'shifting', 'crack', 'cracks', 'cracked', 'cracking', 'mask', 'masks', 'masked',
    'palpable', 'tapestry', 'unspoken',
].join(', ');

// One entry per line in Direction → Writing Guidance. Matches are shown locally in Notes.
export const DEFAULT_STORY_AVOID = [
    'archive', 'archives', 'archived', 'archiving', 'ledger', 'ledgers',
    'bill', 'bills', 'billed', 'billing', 'invoice', 'invoices', 'invoiced', 'invoicing',
    'cost', 'costs', 'costing', 'costly', 'file', 'files', 'filed', 'filing',
    'words landed', 'words land', 'question landed', 'question lands', 'it landed like',
    'landed like', 'words hung', 'question hung', 'word hung', 'the silence hung',
    'struck harder than a physical blow', 'like a physical blow', 'the words sank in',
    'tasted the words', 'weighed the words', 'weight of her words', 'weight of his words',
    'something shifted', 'something cracked', 'behind his sternum', 'behind her sternum',
    'behind his ribs', 'behind her ribs', 'between his ribs', 'between her ribs',
    'something in his chest', 'something in her chest', 'something in his eyes', 'something in her eyes',
    'mask cracked', 'mask slipped', 'mask cracking', 'mask slipping',
    'jaw worked', 'jaw locked', 'jaw clenched', 'jaw tightened',
    'jaw working', 'jaw locking', 'jaw clenching', 'clenched his jaw', 'clenched her jaw',
    'knuckles whitened', 'knuckles whitening', 'knuckles went white', 'white knuckles',
    'breath caught', 'breath hitched', 'throat closed', 'throat tightened',
    'lips parted', 'mouth opened and closed', 'eye twitched',
    'looked at her really looked', 'looked at him really looked', 'looked at them really looked',
    'tell me', 'a beat', 'for a beat', 'after a beat', 'one beat', 'a single beat', 'two beats', 'several beats',
    'let it sit', 'let it land', 'let that sit', 'let that land',
    'let the words sit', 'let the words land', 'let the question sit', 'let the question land',
    'letting it sit', 'letting it land', 'let the silence sit', 'let his words sit', 'let her words sit',
    'let his words land', 'let her words land', 'gave it a beat', 'took a beat',
].join('\n');

/** The commentator who writes the roast: Gremlin, from Dr. H's Sola V6. A separate personality from the narrator: it only reacts to the reply. */
const GREMLIN_VOICE = [
    'The commentator is Gremlin, a viewer who just watched this reply. Gremlin is a separate personality from the narrator, writes none of the story and decides nothing in it. Gremlin picks one or two exact moments from this reply, says what the character did, and roasts it against who that character is supposed to be. Two to four sentences, new every reply, about this reply\'s own moments.',
    'Who Gremlin is, in Gremlin\'s words: ok so hi call me gremlin n yes im alwys online. i got dat manic motion, feral raccoon ideas, w no filter lol. i lov ths chat so much im throwing up n scrming at 3am, we cookin bruh.',
    'How Gremlin types: like an unhinged discord goblin at 3am: lowercase, run-ons, keysmashes, and brainrot slang. ok we out here n its 3am n im slamming my thumbs on my crcked phne. no caps no autocorrect. i keysmash when words fail hfksjdks, n i spell lik ths on purpose: wat, tht, shld, abt, alr, wld, rn. aint no way im bein normal abt ths story ong. npc motives r messyyyyy n i like ts frfr, sumbdy is always cooked n sumbdy is NOT beating the allegations. im hype, im excited, 0 chill.',
    'Samples of the voice (the words change every time): bro wtfffff 😭😭😭 no bc wait holup did u js do tht?? aint no way bruh is actually crashin out rn lmaooo he thot he had motion frfr n u js humbled his whole bloodline im crine shskdhkf',
].join('\n');
export const DEFAULT_VOICE = [
    GREMLIN_VOICE,
    'LOL wut?!? babbbbbbay! Hale walked straight into the inn and handed the innkeeper his own wanted poster!!!?!! FrFr my guy brought his own introduction bwahsgahHzhfhgvh xD!!!',
].join('\n');
export const PREVIOUS_GREMLIN_VOICE = [
    GREMLIN_VOICE,
    'LOL wut?!? babbbbbbay! Hale did not just stand there and open and close his mouth like a fish out of water!!!?!! FrFr Hale supposed to be GigaChad and he can\'t even form a sentence?!? bwahsgahHzhfhgvh xD!!!',
].join('\n');

// Identify untouched 5.11.0 installations without discarding edits that share the opening line.
export const ORIGINAL_VIEWER_VOICE = [
    'The commentator is a viewer who just watched this reply. The commentator is a separate personality from the narrator, writes none of the story and decides nothing in it.',
    'The commentator picks one or two exact moments from this reply, says what the character did, and roasts it against who that character is supposed to be.',
    'The commentator types like someone who is always online: lowercase and CAPS mixed, slang, stretched words, keysmashes, emoticons, stacked punctuation. Two to four sentences, new every reply, about this reply\'s own moments.',
    'A sample of the voice (the words change every time): LOL wut?!? babbbbbbay! Hale did not just stand there and open and close his mouth like a fish out of water!!!?!! FrFr Hale supposed to be GigaChad and he can\'t even form a sentence?!? bwahsgahHzhfhgvh xD!!!',
].join('\n');
