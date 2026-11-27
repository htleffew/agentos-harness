# All sets

Every instruction set, story event set and writing style set you have, in one list grouped by kind. Open it to add a set, to turn a set on or off for the open chat, to open a set in its editor, or to change the wording each kind sends into the chat.

A set is saved in an ordinary World Info book, so a set you export or share is a World Info book file. Each set is off in every chat until you turn it on for that chat.

## What it does

### The list of sets

**Add set** opens a short form:

- **Kind of set** offers Instruction set (the starting choice), Story event set, Writing style set and, when you have a World Info book that is not yet a set, "World Info book you already have, as an instruction set".
- **Name** is the new set's name; **Create** makes the set and opens it in its editor.
- **World Info book to open** replaces Name for an existing book; **Open** adds it, and the book file stays as it is until you edit one of its instructions.
- **Cancel** closes the form.

With no sets at all, **Set up this chat** opens [Setup, Features](page:v10) while a chat is open.

Each set card shows the set's name, a switch that reads On for this chat or Off for this chat, and the World Info book the set is kept in. Its buttons:

- **Open** opens the set in its editor; tapping the name does the same.
- **Export** downloads the set as a World Info book file.
- **Remove from this list** takes the set off the list; its book is kept and can be opened again.
- **Delete this set** deletes the set's entries from its book, for every chat; the book itself is kept.

An instruction set card also shows how many instructions it holds and how many are on, the size of one when it is sent, and how often they go out. **How many instructions can be sent per reply** starts on No limit; the other choices are One per reply, One Send-together group per reply, and At most this many per reply, with a number from 1 to 20 that starts at 2.

A story event or writing style card shows its categories that are on and how often it sends. A story event set whose items retire also shows what is left in the open chat; once its main list is used up, **Bring the used items back** lets those items be picked again in this chat.

### Instruction sets

**Customize in-chat instruction wording** holds the four prompts wrapped around every instruction:

- **Instruction framing** puts "In this reply," in front of the instruction.
- **First reminder framing** is used the first time a missed instruction is sent again.
- **Final reminder framing** is used the last time it is sent again.
- **Player agency in instruction notes** is the line added to each note that leaves your Persona's words, choices and thoughts to you.

**Customize Write with AI prompts** holds **Writing instruction versions**, **Writing model-directed versions** and **Instruction writer: system message**, the prompts that **Write versions with AI** sends. Every prompt fold here is the same prompt [Setup, Prompts](page:prompts) lists, and an edit applies across chats.

### Story event sets

If you use [Plot offers](help:glossary) (optional developments the extension offers apart from these sets), a note says whether they are on for this chat, with **Change plot offers**. **Customize in-chat story event wording** holds **Story event wording**, the sentence that turns the rolled parts into an order. **Customize Write with AI prompts** holds the prompts the item writer uses:

- **Writing story event items**
- **Working in different settings**
- **Situation item guidance**
- **Complication item guidance**
- **Event driver guidance**
- **Event tone guidance**
- **Event stakes guidance**
- **Rewriting events to work anywhere**
- **Story event item writer: system message**
- **Event rewrite: system message**

### Writing style sets

While a writing style set is on for a chat, one style order built from its categories that are on goes with every reply. **Customize in-chat writing style wording** holds **Writing style wording**. **Customize Write with AI prompts** holds **Writing style items** and **Style item writer: system message**.

### Random instructions

Opens when you tap an instruction set's name or **Open**. The top card repeats the on switch and the per-reply limit. **Add instruction** opens a new instruction; each instruction card has an On switch, chips that sum up its timing, and **Edit**, **Move up**, **Move down**, **Copy** and delete.

The instruction editor:

- **Name of this instruction**, seen only by you.
- **When it is allowed** starts on Always allowed; Only when these words appear adds **Words**, Only when this pattern matches adds **Pattern**, and both add **Where to look**.
- **Chance to send each reply (%)** starts at 10.
- **Keep sending for (replies)** starts at 0, which sends it once.
- **Wait before sending again (replies)** starts at 5.
- **Do not send before reply number** starts at 0.
- **Only-one group** starts empty; instructions with the same group name compete, and only one of them goes out per reply.
- **Weight in its Only-one group** starts at 100; a higher number wins more often.
- **Only once per chat** starts Off.
- **Send-together group** starts empty; with the set limited to One Send-together group per reply, instructions sharing this name can go out together.
- **Sent as** starts on System note; the others are Out-of-character note, Line spoken by the character, and Exactly as written.
- **Where it is placed** starts in the chat, counted from the newest message, with **Messages from the newest message** at 1.
- **Actor** and **Target or subject** pick who acts and who is affected in versions the AI writes.
- **Versions** holds the wordings; one is picked at random each time, and every version is used once before any repeats. **Write versions with AI** and **Add a version yourself** add more.
- **Notes for yourself** is never sent.
- **Save instruction** keeps the change.

### Random story events

Opens when you tap a story event set's name or **Open**. **When an event happens**:

- **Chance of an event each reply (%)** starts at 10.
- **Wait after an event (replies)** starts at 5.
- **Keep sending the event for (replies)** starts at 0.
- **No events before reply number** starts at 0.
- **Events from this set are big** starts Off; on, nothing new starts for a while after one of its events.
- **Sent as** starts on System note.

Each category card, for a new category:

- **Name of this category** is shown to the model in front of the picked item.
- **Use this category** starts On.
- **Option bank** starts on Its own list; a bank draws from a shared list in the World Info book named "RI Option banks" (RI is Roleplay Instructions).
- **Pool** starts with nothing ticked, which uses every value that is on; a bank value can carry a weight from -10 to +10.
- **How it changes** starts on New pick every time; the others are Keep for a random number of events and Keep until I turn it off.
- **Pick count** starts at 1, up to 5.
- **How the picks share the reply** appears for a count of 2 or more and starts on All together; the others are One per beat and One per paragraph.
- **Retire an item once it has happened** starts Off.
- **Use every item before repeating** starts On.
- **Wait before an item can return (picks)** starts at 0.
- **Never use items tagged** starts empty.

Each item of a category's own list can wait for something with **Use this item only when** and **Characters in the scene, at least** (0).

Below the categories:

- **Add category** asks for a name; a second button adds the stakes list when the set has none.
- **Import options from a preset or plugin file** reads value lists from a file on this device into the option banks.
- **Most categories in one roll** starts at 6.
- **Smooth the rolled parts into prose** starts Off.
- **Show adult option banks** starts Off and applies to every set.
- **Pairs of tags that are never picked together** starts empty, written as tag+tag.
- **Save the current settings under a name** keeps a named setup of the categories, and **Settings used in this chat** picks one for the open chat only.
- **Roll an example event** shows exactly what the model would receive; nothing is sent or saved.
- **Save story event set** keeps your edits.

### Random writing style

Opens when you tap a writing style set's name or **Open**. The editor matches the story event editor, with these differences:

- **When it is sent** holds only **Sent as**, since a style set sends with every reply while it is on.
- Each category adds one line to the style order and keeps its pick for as long as you set.
- **Chance to be used when a new pick is due (%)** starts at 100.
- **Rest after each pick ends (replies)** starts at 0.
- **Words added after the pick** is sent in brackets after the picked item.

A style item can carry three optional lines that apply while it is the pick:

- **Added to every story event**
- **Question asked about the reply**
- **Note sent with the reply after it**

## Model calls and cost

Rolling a set [runs in code](help:model-calls), and what a set sends rides SillyTavern's reply request. Each of these buttons is 1 model call, marked with the amber dot:

- **Write versions with AI**
- **Write items with AI**
- **Make these work anywhere**
- **Rewrite with AI** on one saved version

They start on Automatic, which tries the free and local routes first and ends on the Main API; the route order is in [Setup, Background jobs](page:background-jobs), and you can fix one button to a saved Connection Profile in [Setup, Connections](page:settings). Paid routes on Automatic count toward the monthly ceiling in [Setup, Spend](page:spend) and are skipped once it is reached. **Smooth the rolled parts into prose** adds 1 model call to every roll that fires; after 8 seconds or a failure, the parts go out as rolled.

## Why it works this way

- One list holds every kind of set, so Add set covers them all and each set is found in one place.
- Sets live in ordinary World Info books, so a set still works with the extension off while its book is on in World Info, and it exports like any book.
- A roll draws fresh values from each pool in code and costs nothing; the smoothing step is off until you want it.
- The option banks credit each item to its source, and the adult bank starts off.
