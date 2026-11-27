# Connections

Setup, Connections decides which connection each extension job uses and whether a job may run on its own. It also holds the rules given to the AI writer, the word list and the settings backup. Everything here applies to every chat.

Open it when a job goes to the wrong model, when a job should stop running by itself, or before moving the extension to another device.

## What it does

### Connections & automatic requests

**Model call settings** lists one fold per job that makes its own model call:

- Write my next message, Give me choices and Draft from this choice
- Swipe an earlier reply and Continue a historical reply
- Find source facts to repair
- Write a chapter summary, Combine older chapters and Draft a new chapter
- Fill a starter Story World and Draft or read an opening
- Check whether directions happened (the Follow-through check) and Automatically replace a missed reply
- Write instruction versions, Rewrite one instruction version, Write story event items, Write style items and Rewrite event items
- Draft a character goal, Draft a Story World entry and Suggest Primary Keywords
- Compare preset blocks and extension features

Inside each fold:

- **Mode** is Automatic or Fixed. Automatic tries a list of routes in order (a route is one place a call can go, such as your desktop over Tailscale or a paid provider) and shows the list and which route runs first today. Fixed sends to one pick only.
- **Connection** is Main API or one of your saved Connection Profiles. Fixed only.
- **Fall back if this fails** continues down the Automatic list after your pick; turned off, a failed call stops with the reason. Fixed only. Starts off.
- **Automatic requests** appears for the jobs that can start without a tap and says when each fires. Write a chapter summary, Combine older chapters and Check whether directions happened start on; Automatically replace a missed reply starts off. Each automatic start makes at most one call.

The Automatic list of each job is the one shown in [Setup, Background jobs](page:background-jobs):

- Write a chapter summary uses the Chapter close list, and Combine older chapters the Story so far list. These two folds decide where every chapter is written, by hand or on its own.
- Check whether directions happened and Suggest Primary Keywords use the Capture list.
- Find source facts to repair and Compare preset blocks and extension features use the Tidy list.
- Draft a new chapter and the five tapped writing jobs at the top use the Continue in a new chat list.
- Fill a starter Story World, Draft or read an opening and the writing helpers use the Behavior book drafts list.

Jobs that also run in the background start on Automatic. Write my next message, Give me choices, Draft from this choice, Swipe an earlier reply and Continue a historical reply start on Fixed with Main API. Automatically replace a missed reply always uses Main API, because SillyTavern makes that Swipe itself.

**Give the AI more room to answer** (starts off) raises the answer budget for models that spend part of it on reasoning.

**Customize guided-turn instructions** holds the five prompts that tell the model how to treat a Swipe or Continue that carries a direction or works on an earlier reply: the framing for a directed Swipe, Guided continuation framing, Historical replacement framing, Historical continuation framing and Fresh start guidance. Changing them changes the words wrapped around your direction, and each has **Restore default prompt**.

### What the AI writes for you

These apply whenever the AI writes something for the menu: versions, list items, goals, Story World entries and the first message of a new chapter.

- **Rules given to the AI writer** takes one rule per line and adds them to every writing request. **Restore default prompt** puts the shipped rules back.
- **Flag words from your list** (starts on) marks text that uses a listed word with "On your word list" where you review it; you can keep the text anyway. Turning it off flags nothing.
- **Your word list** takes words separated by commas; a star at the end matches any ending, and case is ignored. **Put the starting list back** restores it.

### Settings backup

A line says whether a backup was saved when the extension last updated, and where. **Save a backup file** downloads every extension setting and custom prompt as one file. **Restore from a backup file** asks you to confirm, then replaces every setting and custom prompt with the file's; chats and World Info books stay as they are.

### Settings kept elsewhere

Links to the one home of each setting:

- pronouns, on [Story, Portrayal & knowledge](page:portrayal)
- where sets are kept, pacing, new things per reply and the Follow-through check, on [Direction, Sets and pacing](page:set-rules)
- dice stats, on [Story, Stats](page:stat-sheets)
- the current state prompt budget, on [Setup, Memory](page:memory)

## Model calls and cost

Each job in the list is 1 model call when it runs, on the connection or route list set here ([how model calls work](help:model-calls)). Write my next message, Swipe an earlier reply, Continue a historical reply and Automatically replace a missed reply ride SillyTavern's reply request through Main API, so like every chat reply they stay outside the ceiling. The other calls are metered: when a paid route answers, including a Main API on a paid provider or a fixed paid Connection Profile, the cost counts toward the monthly ceiling in [Setup, Connections, Spend](page:spend). Every button that starts one of these calls is metered the same way, Write a chapter now and Close the chapter here on [Story, Story World](page:world) included. The word list and the backup run in code.

## Why it works this way

- Background work tries your desktop and other free or local routes first, and tapped jobs use Main API until you choose otherwise.
- Fixed keeps a job on one connection, and Fall back starts off, so your pick is never swapped for another route without your say.
- Each setting has one home, so the links under Settings kept elsewhere lead to it.
