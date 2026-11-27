# Reply tray cards

The reply tray sits above the message box and shows cards about the newest reply. You choose which cards appear and how in [Setup, Reply tray](page:reply-tray), and which commentator voice the Roast uses in [Setup, Features](page:v10).

## What it does

Each card is Off, Strip only (a one-line chip in the strip) or In the tray. Cards the extension drew before the tray existed start In the tray; the newer ones start Off. A card whose feature is Theirs, because the selected preset supplies it, or whose feature is off, stays hidden. Each card also has sections and fields you can turn off one by one.

### Story cards

- **Scene**: where and when the reply happens, who is present and what can be seen.
- **Map**: the current room as a text grid with who and what stands where.
- **Characters**: what each present character is doing, thinking and feeling, and who they are.
- **Emotions**: how strongly each character feels, with the change since the last reply.
- **Relationships**: each pair, how far along they are and what moved it.
- **Holding back**: what a character lets themselves show or say to another, and the strain.
- **Knowledge and secrets**: who knows what, secrets with their owners, false beliefs and what each person remembers.
- **Inventory**: items per character with what changed.
- **Plot**: open threads, story lines, what happens elsewhere and what is waiting to pay off.
- **New faces**: a profile sheet where a named character first appears.
- **Reputation**: how each group sees you and which way it is moving.
- **Achievements**: a title, how hard it was to earn and what earned it.
- **Story changes**: what this reply filed into the story and which threads it closed.
- **World Info**: the World Info entries used for this reply, each linking to its entry.

### Direction cards

- **Director's desk**: the reply plan and where the next beat heads.
- **Choices**: numbered moves for your next message, each with Copy, Insert and Send.
- **Stats**: this chat's stat sheets with level and growth notes.
- **Roll**: one line per roll in this reply.

### Review cards

- **Notebook**: narrator notes and private diary entries.
- **Roast**: a reader commenting on the reply, in one voice or as a panel.
- **Sent**: what went with this reply, which connection answered and what each background call cost.
- **Notes**: Reply screening notes and problems found in this reply.

## Model calls and cost

Drawing the cards makes no model call ([how model calls work](help:model-calls)). The values in the story cards come from capture, the background call after each reply that keeps the story's records, so a card adds no call of its own. Choices and the Roast are written by the model inside the reply or by capture, depending on the feature's setting.

## Why it works this way

- The cards sit in one tray above the message box, so the chat keeps its full width and the cards stay in one place.
- A feature the selected preset already draws can be left to the preset, so the same card never shows twice.
- Story cards take the chat's story style, while the tray's own controls keep the menu's look.
