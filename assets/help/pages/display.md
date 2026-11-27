# Reply display

Reply display chooses what appears under each reply in the open chat, from the story sections as they arrive to the reply plan, the World Info used, the Roast and the instructions that were sent. Open it when the space under replies feels crowded, or to see exactly what went with a reply.

## What it does

### Reply Display

These switches show while a chat is open and Roleplay Instructions is on; each saves with the chat.

- **Show arriving story sections** (On) previews the reply cards as their parts arrive. Turning it off shows a single progress line.
- **Show Reply planning** (On) shows any outline the reply wrote in a closed fold. Turning it off hides the outline.
- **World Info under replies** (On) shows a closed card with the selected World Info entries and their books; it changes display only. **Review World Info selections** opens [Review, What was sent](page:sent).
- **Show Roast cards** (On) shows the saved Roast, a reader's comment on the reply, beneath it. Turning it off hides the card.
- **Keep exact story guidance** (Off) saves the extension's guidance word for word so What was sent can show it.

Roast generation and Roast feedback are switched on in [Setup, Features](page:v10), where the commentator voice is edited too.

### Show what was sent under each reply

**Under each reply** applies to every chat and starts at Off.

- Off adds nothing to the chat; what was sent stays in Review, What was sent.
- Show it (display only) adds a closed section under each reply listing the instructions sent. The message text is unchanged, the AI never sees the section, and it disappears if the extension is turned off.
- Show it and save it in the message saves the section in the message text and keeps it out of every prompt. Choosing it also adds a script to SillyTavern, so the section stays out of prompts with the extension off.

With no chat open, the page shows only this choice and the link to the commentator voice.

## Model calls and cost

Nothing on this page calls a model; it changes only what is shown and saved ([how model calls work](help:model-calls)). Whether a Roast or a reply plan is written at all is set in Setup, Features.

## Why it works this way

- Showing and writing are separate. A switch here hides or shows a card; the feature switches live in Setup, Features, so hiding a card leaves the next reply unchanged.
- What was sent is always kept in Review, so the section under each reply is optional.
- Saving the section in the message keeps the record with the chat file, and the script keeps it out of prompts even with the extension off.
