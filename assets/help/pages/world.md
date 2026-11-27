# Story World

[Story World](help:glossary) is the chat's lasting record of the story, and this page, under the Story tab at Story, Story World, lists it. Each record is one thing the story has established (a person, a fact, a plot thread, a secret or a chapter), with its history and the quotes it came from. You can edit, lock, pin, undo or restore records here, close chapters, and open the records as a World Info book. Records are saved with the chat, so a swipe or a deleted reply takes back what that reply added.

Facts and Plot under Story World open this same page with that filter chosen.

## What it does

A line at the top can report progress when the extension is catching up on an older chat. Under it are the filter buttons, each with its count.

- **All** shows every record in force.
- **People** (the starting filter) shows people, traits, relationships, emotions and reputations.
- **Facts** shows facts, places, items, achievements and scenes.
- **Plot** shows plot threads.
- **Secrets** shows secrets and who knows them.
- **Chapters** shows chapters, story arcs and the condensed account.
- **Retired** shows records no longer in force.
- **Needs you** shows records flagged for a look, with the review list from [Setup, Memory](page:memory).

**Search the records** matches names, wording and other names. Opened from a reply's menu, the page shows only what that reply added, with **Show every reply** to clear that.

### Each record

The record list takes the filter's name and count. **Add record** opens an empty record of a type that filter allows, and **Edit** opens an existing one; your edit is kept as you wrote it. Each record shows its type and status, chips such as Locked, Pinned, Known by and Also called, and these controls.

- **Lock** stops automatic updates from changing the record; **Unlock** lets them again.
- **Pin** makes the record always a candidate for [Recall](help:glossary), the records chosen for each reply; **Unpin** releases it.
- **Restore** brings a retired record back into force.
- **History and sources** lists each version with its reply and quote, and **Undo** on a change that can be taken back.
- A person shows meters for Tenderness, Fury, Dread, Yearning (0 to 10) and Relationship level. Typing a value sets it on the newest reply and locks it.
- **Temperament** sets how far one reply moves each meter. Guarded moves it 0.5 times as far as usual, Slow 0.75 times, Usual 1 time (the start), Quick 1.25 times and Volatile 1.5 times.
- A plot thread shows **Ends when**, the event that closes it, and **Paused**, which holds the thread until you switch it back.

The list shows 60 records at a time, with **Show all** for the rest.

### Facts

Facts, places, items, achievements and scenes. **Add record** offers a Fact with these fields besides the usual ones.

- **Relevance aliases** are other words that bring the fact up.
- **Related plot record ID** is the ID of a plot record this fact belongs with.
- **Base World entry** names an entry of the Base World, the canon book chosen in [Story, World Info](page:books).
- **Relationship to Base World** says how the fact stands to that entry: extends adds to it, updates-present records its current condition in this chat, and contradicts marks your correction of it.

### Plot

Plot threads. **Add record** offers Arc milestone, Seed, Agenda and Event, with these fields among others.

- **Status** is open, done or retired.
- **Parent arc ID** is the ID of the story arc the record belongs to.
- **Required record IDs** lists, separated by commas, the records that must be done before this one can happen.
- **Due story minute** is the point on the story clock, in minutes from the start of the story, before which the record cannot come up.
- **Optional payoff guidance** says how a payoff should land.
- **Allow automatic scheduling** lets the extension bring the record into the scene when it is ready.

### History of automatic changes

A fold with the 20 newest automatic changes, each with its reply, **Undo**, and **Restore** for a record a change retired. **Show every change** lists them all.

### The story so far

The closed chapters in order, then the **Condensed account**, a shorter account of everything before the newest chapters.

- **Close the chapter at reply** picks the reply a chapter ends on.
- **Close the chapter here** writes that chapter.
- **Write a chapter now** writes a chapter of the replies no chapter covers yet. It shows while Chapter summaries is on in [Setup, Memory](page:memory).
- **Start a new chapter in a new chat** writes a detailed summary and a first message for a fresh chat, both editable before the chat is made. Its **How it works** fold says the new chat gets its own Story World with the approved summary and a copy of the records.

Close the chapter here and Write a chapter now open a [Generate sheet](help:glossary) first that states the cost; **Generate** starts the call. Start a new chapter in a new chat shows its cost, 1 model call, under the button and opens its own form for what the new chat should open on.

### Story World book

- **Open as World Info book** writes the records out as a World Info book and opens it in SillyTavern's World Info screen. An edit typed there goes to the review list in Setup, Memory.
- **Leave secrets out** starts ticked and applies to the export.
- **Export as World Info book** saves an ordinary book of your own; the records stay as they are.

### Related settings

Links to [Review, Context](page:context) for what the next reply will carry, [Setup, Memory](page:memory) for budgets and updates, [Story, World Info](page:books) for creating, exporting or deleting the book, and [Direction, Sets and pacing](page:set-rules) for world orders.

## Model calls and cost

- **Close the chapter here** and **Write a chapter now** each start with [1 model call](help:model-calls), marked with the amber dot. A chapter that fails its checks is asked for once more, so a chapter can take 2 calls, and once three or more chapters exist, further calls rewrite the condensed account with it. They use the connection set under Write a chapter summary and Combine older chapters in [Setup, Connections](page:settings), which on Automatic follows the Chapter close and Story so far lists in [Setup, Background jobs](page:background-jobs). These calls are not metered, so they stay outside the monthly ceiling in [Setup, Spend](page:spend); in an older chat still on the earlier memory, Write a chapter now is metered.
- **Start a new chapter in a new chat** is 1 model call on the connection set under Draft a new chapter in Setup, Connections, which on Automatic follows the Continue in a new chat list. It is metered: a paid route's cost counts toward the monthly ceiling.
- Filters, search, edits, locks, pins, undo, meters, temperament and both book buttons run in code.

## Why it works this way

- The records are saved with the chat, so a swipe, a delete or a branch keeps them in step with the story.
- The World Info book view lets you read the records in SillyTavern's own editor, and an export gives you a copy you own.
- Records are written as plain statements of who did what, where and when, so names, places and numbers stay exact.
