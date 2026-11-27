# World Info books

World Info books gathers every World Info book that reaches the open chat. Here you create or export the chat's [Story World](help:glossary) book, choose a Base World, add guideline and reference books, and remove, hide or edit the books SillyTavern attaches to the chat.

## What it does

### Story World

The book that holds this chat's lasting record of the story. The line under the heading names it and the reply its export is current through.

- **Create this chat's Story World** makes one when the chat has none. Once one exists, the button reads **Make a new Story World**; it asks for a name and switches the chat to the new one.
- **Export the Story World** downloads the book.
- **Delete the Story World** removes it everywhere after a confirmation; every chat that uses it loses the book.

When Story World is off for the chat, the line says to turn it on in [Setup, Memory](page:memory). Its records are edited in [Story, Story World](page:world).

### Reusable World Info books

Shown while Roleplay Instructions is on.

- **Base World** is the canon the story starts from, an existing World Info book that the chat keeps a pinned copy of, with its triggers. It starts on None.
- **Refresh pinned copy** reads the chosen book again.
- **Upload and assign Base World** imports a World Info file as the Base World.
- **Pinned facts for opening** lists the Base World's entries with a checkbox each; a ticked entry always goes into the opening request on [Story, Scene, First message](page:opening).

### Guideline and reference books

- **Role for books you add** is Behavior & Guidelines (writing directions) or Knowledge & Reference (facts about people, places or anything else). It starts on Behavior & Guidelines.
- **Assign book** adds the book chosen in the picker beside it, with that role.
- **Upload and assign books** imports one or more World Info files with that role.
- **Create an empty book** opens a **Name** box; **Create and assign** makes the book with that role.

Each added book shows its role and these controls.

- **Pause in this chat** stops its use here; **Enable in this chat** brings it back.
- **Unassign** takes it off the chat; a selection made in SillyTavern's World Info screen stays in effect.
- **Copy to Random Instructions** (guideline books) makes an inactive instruction set from the book and opens it for review.
- **Edit or delete entries** edits the book itself, so a change applies in every chat that uses it.
- **Chat-specific conditions** (on each guideline entry) holds **Use this entry in this chat**, **Required extension feature**, **Character in scene** and **Scene location**, which limit when that entry is used here.

**Review World Info selections** opens [Review, What was sent](page:sent), and **World Info display settings** opens [Setup, Reply display](page:display).

### World Info books for this chat

Every book SillyTavern associates with the chat, with where it is attached (for example the character or the chat).

- **Remove from this chat** takes the book off this chat and keeps it for others.
- **Allow World Info recall again** undoes a removal.
- **Hide from list** clears a card from this list; **Show hidden books** brings hidden cards back.
- **Delete book everywhere** deletes the book from SillyTavern after a confirmation.
- **Open in World Info** opens it in SillyTavern's editor.
- **Export JSON** downloads it.
- **Edit or delete entries** opens its entry list, with **Reload entries**, and **Add entry** on reusable books.

A World Info entry opened from Review opens in its own editor on this page, with **View all World Info books** to come back.

## Model calls and cost

Inside **Edit or delete entries**, **Suggest Primary Keywords with AI** is [1 model call](help:model-calls), marked with the amber dot. It uses the route set for Suggest Primary Keywords in [Setup, Connections](page:settings), which starts on Automatic and tries the routes in [Setup, Background jobs](page:background-jobs) in order; a paid route counts toward the monthly ceiling in [Setup, Connections, Spend](page:spend). Everything else on the page runs in code.

## Why it works this way

- The chat keeps a pinned copy of the Base World, so an edit to the source book changes nothing here until you refresh.
- Guidelines and reference are two roles of the same kind of book, so a book keeps its own triggers whatever it is used for.
- Removing a book from one chat and deleting it everywhere are separate buttons, so a shared book stays safe from a tap meant for one chat.
