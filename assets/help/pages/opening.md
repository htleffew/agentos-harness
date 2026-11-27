# First message

First message sets up the opening of a new chat. You pick a greeting from the character card, or have one written from a direction, check the text, and use it as the first reply. The extension then files what the opening establishes (the scene, who is present and the first story facts) in [Story World](help:glossary), the chat's lasting record of the story.

The setup form shows only at the very start of a chat, while the chat holds at most the greeting. After that the page reads "Opening setup is available at the start of a chat."; the guidance and prompts below stay available.

## What it does

### Opening setup

- **Choose a greeting** picks the text to start from, which is Start a blank opening, First message, or an Alternate greeting of the card. It starts on First message, or on Start a blank opening when the card has no greeting.
- **Opening direction** is optional text for a new opening, such as where the scene starts or who is there. Generate opening reads it.
- **Allow the generated opening to write my character's internal thoughts** starts off for each chat. Turned on, the opening may write your [Persona](help:glossary)'s thoughts in single asterisks; your dialogue and choices stay yours either way.
- **Generate opening** writes a new opening from the direction, the character card, your persona, your writing guidance and the pinned facts of the Base World (the canon book chosen in [Story, World Info](page:books)). The draft lands in the text box.
- **Read state from selected greeting** keeps the greeting word for word and works out only the scene and story facts it establishes.
- **Cancel opening request** shows while either button is working; your text stays.
- **How it ran** is a fold with the route, the number of calls and the outcome of the last run.
- **Review or edit opening** is the text that becomes the first reply. You can change anything in it.
- **Use this opening** saves the text as the first reply and files its facts. While the box holds a greeting that has not been read yet, the button reads **Read state and use this opening** and works out the facts first.

When you edit a draft before using it, the facts are checked against your final text. A character detail whose quoted evidence is no longer in the text is dropped, and the scene values of the draft are dropped too; the extension then reads your final text the way it reads every reply, so what the text says is what gets filed. Switching chat or preset while you work stops the save with "The chat or preset changed."

### Opening message guidance

A fold with the instruction that shapes a generated opening, saved for this chat. It starts as a request for an opening of roughly 350 to 650 words that shows the place, who is present and what is already happening. A badge reads Default or Customized.

- **Save guidance** keeps your text for this chat, up to 12,000 characters.
- **Discard draft** shows once you type and puts the saved text back.
- **Restore default** returns this chat to the installed text.
- **Undo restore** brings back the text you had before the restore.
- **Compare with installed default** shows your draft beside the installed text.
- **Named variations** saves the draft under a name and loads, applies, renames, duplicates, exports or removes saved ones.
- **Import variation** reads a variation file.
- **Undo removal** recovers the last variation you removed.

### Customize opening and greeting prompts

- **Opening: system message** opens both kinds of opening request.
- **Reading the chosen greeting** asks for the scene and facts a greeting establishes.
- **Writing authorized opening thoughts** goes out when the thoughts switch is on.
- **Opening scene checks** asks the opening to place the people, name who is present and start with something already under way.

Edits apply in every chat and show in [Setup, Prompts](page:prompts) at once.

## Model calls and cost

**Generate opening** and **Read state from selected greeting** are each [1 model call](help:model-calls), marked with the amber dot. **Use this opening** adds 1 more only when it has to read an unread greeting first. These use the route set for the opening in [Setup, Connections](page:settings). It starts on Automatic, which tries your routes in the order shown in [Setup, Background jobs](page:background-jobs) and ends on the Main API; a paid route there counts toward the monthly ceiling in [Setup, Connections, Spend](page:spend). After you use the opening, the extension reads it the way it reads every reply, which is the usual background call after a reply.

## Why it works this way

- The opening is filed like any reply, so the scene and the people present are known before the first exchange.
- Reading a greeting leaves its wording exactly as the card wrote it.
- Your persona's thoughts are written only with the switch on, since what your persona thinks belongs to you.
- The guidance is saved per chat, so one character's opening style leaves the others alone.
