// Default texts that the settings start with. This file imports nothing, so any module can use it.

export const DEFAULT_WRITER_RULES = [
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
