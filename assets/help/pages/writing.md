# Writing guidance

How replies in the open chat are written and what the extension screens them for. Use it to pick a portrayal profile, edit the standing writing guidance, choose which continuity checks go with a reply, or list phrases and NPC names the replies should avoid. Every change here applies to the open chat only; the prompt folds apply across chats and are the same prompts [Setup, Prompts](page:prompts) lists.

## What it does

### Writing profile

**Portrayal intensity** starts on Follow live writing guidance. Grounded realism and Heightened drama add a shared profile to this chat, and its text shows below the picker; character material from the card still comes first. **Customize portrayal profiles** holds **Grounded portrayal** and **Heightened portrayal**.

### Live writing guidance

A fold with the standing guidance for how replies are written, marked Default or Customized, up to 12,000 characters:

- **Save guidance** keeps your edit for this chat.
- **Discard draft** drops an unsaved edit.
- **Restore default** puts the installed text back for this chat, and **Undo restore** reverses that.
- **Compare with installed default** shows your text beside the installed one.
- **Named variations** saves the draft under a name, loads a saved one into the draft, and applies, renames, copies, exports or removes it.
- **Import variation** reads a variation file.
- **Undo removal** brings back a variation you removed.

### Continuity guidance

A fold with the same buttons, for the continuity guidance that goes with a normal reply.

### Continuity guidance for this chat

One tick for each scene check, all ticked to start with; Physical realism, Social realism and character fidelity, Pacing and prose, and Information and continuity. A check your preset already sends shows ticked and locked, marked Theirs with the preset block's name, and the extension leaves its own copy out. **Open feature settings** opens [Setup, Features](page:v10), where the Continuity guidance feature is switched for the chat.

**Customize individual scene checks** holds:

- **Physical realism check**
- **Social realism and character fidelity check**
- **Pacing and prose check**
- **Information and continuity check**
- **Solo scene**, **Ensemble scene** and **Uncertain cast**, one of which goes out depending on who is in the scene
- **Continuing a reply**, used for a Continue

### Reply screening

- **Stock phrases to avoid** and **New NPC names to avoid** are lists, one entry per line, with **Save list**, **Discard draft**, **Restore default** and **Add missing defaults to draft**. Matches appear in the reply's Notes.
- **Show turn length and dialogue share** starts Off. On adds the word count and the rough share of the reply in quotation marks to the reply's Notes tab.
- **Review recent writing with the reply** starts Off. On adds a short review of recurring writing patterns once at least two earlier story replies exist; the Notes show which revisions support each finding. **Customize the writing review prompt** holds **Same-reply writing review**.
- **◇ How it ran · multiple stages** shows how the two stages run; screening when the reply is accepted, and the review with the reply request.

## Model calls and cost

Nothing here adds a model call. The portrayal profile, the live writing guidance, the continuity guidance and the writing review ride SillyTavern's reply request on the Main API. Reply screening and the turn length line [run in code](help:model-calls) after the reply arrives.

## Why it works this way

- Guidance lives per chat, so one story can run grounded while another runs heightened, with the shared prompts kept once in Setup, Prompts.
- Your preset and the extension can both supply checks; one your preset already sends is marked Theirs, so the reply gets one copy.
- Screening runs in code, so it costs nothing and adds no wait.
