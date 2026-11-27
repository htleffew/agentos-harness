# Library

Every Quick action you have, grouped by kind. A Quick action holds its name, icon, prompt or Direction once, so using it in play takes one tap ([Words this guide uses](help:glossary)). Use the Library to add, edit, copy, delete, import or export Quick actions, or to pin one to the Quick action bar.

## What it does

### The list

- The kind picker and **Add** start a new Quick action of that kind.
- **Import** opens the import view.
- **Export** downloads the whole library as a JSON file.
- **Undo** (shown with what it undoes) restores the library as it was before your last change.
- **Search quick actions** filters the list as you type.

Each kind is a fold with its count, its cost, and its actions. Each action has **Pin** or **Unpin**, **Edit**, **Duplicate** and **Delete**. A deleted action moves to a **Deleted** fold, where **Restore** brings it back.

The kinds, in the order the page lists them:

- **Options** writes a number of Options for what could happen next, such as a new NPC who could enter. It makes its own model call.
- **Swipe** writes a new version of the last reply, with an optional Direction.
- **Continue** extends the last reply, with an optional Direction.
- **Impersonate** writes your Persona's next message into the message box.
- **Direction** queues a Direction for the next reply.
- **Action check** rolls a d20 for an attempt, with a stat and a difficulty, and sends the result.
- **Review** opens [Review, What was sent](page:sent), or [Review, Context & memory](page:context) when its Opens setting says Context, for the reply it is used on; with no reply, it opens that page.

### The editor

Every kind:

- **Name**, up to 20 characters.
- **Icon**.
- **Show on the bar**; turning it off keeps the action in More (the More menu at the end of the Quick action bar) and the Library.
- **Order the bar** opens [Quick actions, Bar](page:quick-bar).

Options, Swipe, Continue and Impersonate also show **Connection**, the route the action uses, with **Open Setup, Connections**.

Options:

- **Count** starts at 4, from 1 to 12.
- **Length** starts on Medium; Short is the other choice.
- **Random Instruction Set** starts on None; a set picked here is rolled into the request.
- **Open results automatically** starts On; off keeps the sheet closed and shows the count on the bar.
- **Prompt**, with **Restore default prompt**.
- **Insert mode** starts on Insert at cursor; Replace the message box is the other choice.

Impersonate has **Prompt** (empty uses the default), **Insert mode** and **Direction text**.

Swipe, Continue and Direction:

- **Direction text**, with **Insert a variable** to add {{user}}, {{char}} and the like.
- **Private or Visible**.
- **Required or Optional**; a Required Direction gets a Follow-through check, which reads the reply and looks for evidence that it happened.
- **Roll a d20 with it**, rolled in code and kept with the action.
- **Fresh start**: Off, This action, or Next five replies. Starts Off. Either of the last two asks the model for new phrasing that stops echoing earlier prose.

Action check has **Stat**, **Difficulty** and **Who rolls** (Me or The character). Review has **Opens** (What was sent or Context).

### Import

**Choose a JSON file** or **Paste JSON instead** reads a Roleplay Instructions library, a World Info book or a Quick Reply export. You review what the file holds before **Import reviewed file** adds anything.

## Model calls and cost

Editing the library [runs in code](help:model-calls). When used, Options is 1 model call with the amber dot, on the connection chosen for Give me choices in [Setup, Connections](page:settings) (the Main API until you choose a Connection Profile or Automatic). It is metered: when a paid route answers, including a Main API on a paid provider, the cost counts toward the monthly ceiling in [Setup, Spend](page:spend). The Choices card in the reply tray is separate; it fills itself after each reply on the Capture list in [Setup, Background jobs](page:background-jobs). Swipe, Continue and Impersonate ride SillyTavern's reply request. Action check, Review and Direction run in code.

## Why it works this way

- Each kind shows its cost before you tap, so you know whether an action spends.
- Delete moves an action to the Deleted fold, so a stray tap loses nothing.
- Import shows what a file holds first, so nothing lands in your library unseen.
