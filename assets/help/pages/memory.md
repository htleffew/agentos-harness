# Memory

Memory holds every setting for how the story is remembered, covering what is sent back to the model with each reply, how much room it gets, when chapters close, how records are kept tidy, and the controls for the open chat. The page header shows a status line such as "ON · DESKTOP · US$0.40", which reads memory on or off, the route that files replies now, and this month's paid spend.

Open it when replies forget things, when the request runs long, or to catch up, rebuild or clear one chat's memory.

## What it does

A section with a switch shows its settings only while the switch is on. Switches that end in "for this chat" save with the chat; the rest apply to every chat.

### Status

One line per route (a route is one place a model call can go, such as your desktop or a paid provider; see [how model calls work](help:model-calls)), each marked ready, down or over the monthly spend ceiling. Under them, how many background jobs wait and this month's paid spend. **Open Review, Context** opens [Review, Context](page:context), which shows what was and will be sent.

### Recall

Recall is the set of records and World Info entries chosen for one reply ([Words this guide uses](help:glossary)). The section switch is **World Info recall for this chat**, On to start; turning it off stops Recall from sending World Info entries and Story World records in this chat.

- **Books Recall manages** lists the World Info books switched to Recall on [Story, World Info](page:books).
- The search model line names the small model that finds related records and whether it has downloaded.
- **Desktop booster** (Off) adds your desktop's own search when it answers.

**More recall settings** holds:

- **World Info recall**, the same switch as the section switch above, shown again as On or Off.
- **Chapter summaries** (On), the same switch as the Chapters section switch below.
- **Exclude summarized messages from prompts** (On) keeps the messages a saved chapter covers in the chat and out of what the model reads. It needs Chapter summaries on.
- **Where the notes are placed** starts at In the chat, above your last message. The other two choices put the notes with the World Info entries before or after the character, which needs that marker in the preset.
- **How many messages up** (1; 0 is the very end of the chat) shows for the first placement.
- **Messages read for names** (4) counts people named in that many recent messages as present when the reply has no scene header, the place, time and people line some replies open with.
- **Protect recent history by** is Message count (the start) or Estimated tokens.
- **Recent messages to protect** (30), or the token budget (8,000) when you count tokens, sizes the stretch of recent chat always sent in full, with a preview of this chat.

### Budgets

**Chat model size** starts at Auto, which reads the context size set in SillyTavern. Small, Mid and Frontier set the caps shown for the recall block, the Tracker World Info book (the book that carries the reply tray's current values to the model) and the chapter view. **More budgets** holds:

- **Room for Recall (tokens)**, 600.
- **Chapter notes budget**, 800 tokens for the story so far.
- **Current state prompt budget**, 350 tokens for scene and character state.
- **Customize current-state guidance**, the Current state guidance prompt.

### Chapters

The switch is **Chapter summaries for this chat**, On to start. Turning it off stops new chapters in this chat.

- **Newest chapters in full** (2) sends the newest chapters whole with every reply; older ones go in the condensed account, one short summary of everything before them.
- A chapter closes at a scene end after at least 6 exchanges, by itself after 20, or when the open chapter takes half of the room the request has. Each of the three is a number you can change.

### Upkeep

The switch is **Tidy automatically**, On to start. Turning it off stops the automatic check for near-duplicate records; identical records are still merged.

- **Capture** files each reply's changes after each reply (the start), or every five replies while the reply tray's state cards are off.
- **Tidy now** asks a model about near-duplicate records once.
- **How it works** shows how often Tidy runs and its thresholds.

**More upkeep settings** holds:

- **Keep the world up to date from each reply** is On (the start), On and leave my own entries alone, or Off.
- **A branch gets its own copy of the world** (On) gives a branch its own World Info book the first time it opens.
- **Earlier replies kept editable** (5) keeps that many earlier replies' changes open before they are filed; File immediately files at once.
- **Customize story memory wording** holds the Plain language for story memory prompt and the wording that introduces the notes.
- **Chapter organization** holds **Move finished records into chapters** (On), **Recent chapters eligible for full recall** (2), which is how many chapters Recall may pull back in full when they come up, and **Combine older chapters when there are more than** (8).

The last four apply only to older chats still on the earlier memory, where Settings for this chat shows a line saying the chat has not moved its memory yet:

- **Write a chapter when the scene ends** (On).
- **Minimum replies for a scene-end chapter** (4).
- **Write a chapter at least every** (20 replies; 0 turns it off).
- **Summarize at estimated tokens** (0, off).

### Settings for this chat

- Turning off **Memory on for this chat** stops filing and Recall in this chat; its records stay.
- **Clear this chat's memory** asks which to clear. Model-made only keeps records you wrote or edited, locked records (records you locked against change) and stat sheets; Everything clears them all. Each has an Undo.
- **Catch up this chat** files the replies not yet in memory, in order, and resumes if the app closes.
- **Rebuild from all chat history** retires every record a model made and catches up from the first message; **Undo rebuild** brings them back.
- **Catch up by itself on free routes** (On) starts catch-up alone when 20 or more exchanges wait and a free route can do it well. Turned off, or with no such route, catch-up shows the route, calls, time and cost with Run now, Wait for the desktop and Not now.
- **Continue in a new chat** starts a fresh chat with the same character and a carry-over World Info book holding the story so far. Type what the new chat should open on, tick **Write an opening message too** or **Leave secrets out of the book**, then tap **Write the synopsis and start**. The old chat stays unchanged.

### Review list

The review list shows each item that waits for you: a clash between the story and your own entry, an edit typed into a generated book, a story event waiting for a book, or a change near a locked record. Each item has its buttons, such as Keep mine, Edit my entry, The story changed, File as my edit, Add to book and Dismiss.

## Model calls and cost

- Filing after each reply, Tidy, chapters that close on their own and catch-up run as background jobs on the routes set in [Setup, Background jobs](page:background-jobs). They are metered: a paid route's cost counts toward the monthly ceiling in [Setup, Spend](page:spend).
- **Tidy now**, **Catch up this chat**, **Rebuild from all chat history** and **Write the synopsis and start** carry an amber dot and a cost chip, and open the Generate sheet before the call. Tidy now and Write the synopsis and start are 1 model call each; catch-up and rebuild show their count once the route is checked.
- Tidy now, catch-up and rebuild are metered like the background jobs. Write the synopsis and start uses the Continue in a new chat routes and is not metered, so it stays outside the ceiling.
- Recall, the budgets and the review list run in code.

## Why it works this way

- Background work runs on the cheapest route that works, free and local first, so memory keeps working within the ceiling.
- Catch-up starts alone only on a free route that can do it well, and otherwise shows the cost before you choose.
- Every button that calls a model opens the Generate sheet first, so a tap never spends by surprise.
- Rebuild and Model-made only keep your own and locked records; Everything clears them too, and every clear has one Undo.
