# Portrayal & knowledge

Portrayal & knowledge, at Story, Characters, Portrayal & knowledge, holds the pronouns the extension uses for the character and your [Persona](help:glossary), and the chat's portrayal and knowledge records. A portrayal record says how a character is played (voice, other names, the face they show right now); a knowledge record says what a character has seen, heard or been told.

## What it does

### Pronouns

- **Pronouns for** the character and **Pronouns for** you each offer she / her, he / him, they / them, it / its and Other (type your own). Both start on they / them, or on what you chose for that character or persona before.
- Other (type your own) shows five boxes, one for each form of "they", "them", "their", "theirs" and "themself".

A choice is saved for this chat and remembered for that character and persona in new chats. Instruction versions written with a pronoun placeholder, such as {{char.they}} in "{{char}} keeps working toward this goal in what {{char.they}} says", get these words, so one instruction set works with any character.

### Portrayal & Knowledge

The records of this chat. **Search portrayal & knowledge** matches names, wording, status and the word Protected. **Add record** opens an empty record, and **Edit** opens an existing one.

- **Record type** is Portrayal or Knowledge; each shows while its [Feature](help:glossary) is on in [Setup, Features](page:v10).
- **Record ID** is an optional short name for the record.
- **Subject** is the character's name and is required.
- **Record** is the text.
- **Protect this record from automatic changes** keeps the record as you wrote it. It starts ticked for a new record.

A Portrayal record adds these fields.

- **Voice**, **Current facet or mask** and **Aliases**, each with its own protect box. Typing in a field ticks its box.
- **Restore source** puts back the wording from the character card or the Base World (the canon book chosen in [Story, World Info](page:books)) and clears the protection.

A Knowledge record adds these fields.

- **Source type** is observed, reported, rumor or belief, and starts on observed.
- **Limit to relevant character** starts ticked, so the knowledge goes out only while that character is in the scene. Unticking it lets the knowledge go out whoever is present.

**Save record** keeps your edit. **Cancel** closes the editor.

### Customize portrayal and knowledge prompts

- **Recording portrayal and growth** says when a portrayal records voice, other names, a facet or lasting change.
- **Recording character knowledge** asks for the passage that shows who learned what, and keeps rumors as rumors.
- **Character knowledge check** asks each reply to check what every speaker could have witnessed, learned, inferred or mistaken.

Edits apply in every chat and show in [Setup, Prompts](page:prompts) at once.

### Related settings

New NPC names to avoid, a list of names new characters should not get, lives in [Direction, Writing guidance](page:writing).

## Model calls and cost

No control on this page makes a model call; pronouns and record edits [run in code](help:model-calls).

- The records that fit the scene go out in [Recall](help:glossary) inside SillyTavern's reply request.
- The Character knowledge check rides the same request while [Continuity guidance](help:glossary) and Character knowledge are both on in [Setup, Features](page:v10).
- Recording portrayal and growth and Recording character knowledge are sent with Draft or read an opening on [Story, First message](page:opening), which is 1 model call on the connection set for it in [Setup, Connections](page:settings).

## Why it works this way

- Pronouns fill each placeholder when the instruction is sent, so an instruction written once reads correctly for any character.
- A protected record or field stays as you wrote it.
- Knowledge carries its source, so a character can act on a rumor while the story keeps it a rumor, and private knowledge goes out only while the character who holds it is present.
