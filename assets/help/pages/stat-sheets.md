# Stats

Stats holds this chat's stat sheets, one for your [Persona](help:glossary), one for the character and one for each NPC who has acted. Every [Action check](help:glossary), the die roll for an uncertain attempt, adds the actor's modifier for the stat it uses, from -20 to +20 with 0 as ordinary. The page also sets which stats the sheets use. While Dice is off in [Setup, Features](page:v10), the sheets are kept for when you turn it on.

## What it does

### The sheets

Each sheet shows the name, whether it is the persona, the character or an NPC, and where it came from (the card, a World Info book, made during play, set by you, or a saved sheet). Each stat has a number box from -20 to +20.

- Typing a value saves it and marks the stat **yours**; inference leaves it alone from then on.
- Tapping **yours** lets inference set that stat again.
- A stat set by inference shows the short reason given for it.

The persona and character sheets are inferred once, at the start of a chat with dice on, from your persona and the character card, within -3 to +5. An NPC described in a World Info book gets a sheet inferred from that entry, saved in the same book as an added, disabled entry titled with "Stats" and the NPC's name. An NPC who first acts during play starts with every stat at 0, and inference fills it in later.

### Infer again

**Infer again** reads your persona and the character card again and replaces their inferred values. Stats marked yours stay as they are.

### Stats in use

**Stats in use** lists the stats every sheet uses, separated by commas, and is shared by every chat. It starts as Strength, Agility, Wits, Charm, Will, Senses; clearing it brings that list back.

## Model calls and cost

- **Infer again** is [1 model call](help:model-calls), marked with the amber dot.
- The first inference at the start of a chat with dice on is 1 model call that runs by itself.
- Both use the stat sheet route order in [Setup, Background jobs](page:background-jobs); a paid route counts toward the monthly ceiling in [Setup, Spend](page:spend).
- Typing values, releasing them and editing the list of stats run in code.

## Why it works this way

- The roll itself is decided in code from the die and the modifier, so the sheet is where a character's skill shows in the outcome.
- A value you set stays yours; inference fills only the stats you have not set.
- Inference keeps to -3 to +5, ordinary to good at something, and the wider range is there for values you set by hand.
