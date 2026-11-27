# Notes inside your message

Lets you give the model a private Direction from inside your own message, and sets which wrap buttons show on the Quick action bar. These settings apply to every chat.

## What it does

### Notes inside your message

Write `[[OOC: plain words]]` anywhere in a message. The note is cut from the message before it is saved and goes out once, for that reply only, as a private Direction. It keeps its OOC prefix, and several notes go in the order you wrote them. The note shows in the queue and in the reply's receipt like any queued Direction.

**Notes in [[OOC: ]]** starts On. Turning it off leaves the brackets in your message like any other text.

A message that holds only a note is held back, with a short note on the bar asking you to add a few words for the story. The bar's note goes away as soon as you change the message box.

### Wrap buttons on the bar

Three buttons at the right end of the bar wrap the selected text, or put the pair at the cursor with the cursor between the marks. You can also press and hold a button to hide it. Each has a switch here, all On to start with:

- `[[OOC: ]]` wraps the selection as a private note. It shows only while Notes in [[OOC: ]] is On.
- `* *` wraps the selection in asterisks, for an action.
- `" "` wraps the selection in quotation marks, for speech.

## Model calls and cost

Nothing on this page calls a model. The marker and the wrap buttons [run in code](help:model-calls), and a note rides SillyTavern's reply request for the reply it belongs to.

## Why it works this way

- Presets already read an `OOC:` prefix, so the note keeps it while it travels privately with that one reply.
- The three wrap buttons sit at the right end of the bar so the pinned Quick actions keep their room at phone width.
- A message with only a note would leave the story with no turn of yours, so it is held back.
