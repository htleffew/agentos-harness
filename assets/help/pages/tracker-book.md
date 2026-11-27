# Tracker book

The [Tracker World Info book](help:glossary) holds the current tracker values of the open chat (the scene, the characters, emotions, relationships and the other reply cards you have on) as Constant entries the model reads with every reply. Roleplay Instructions writes one per chat, named "RI Tracker," and the chat name. The page shows what the book holds and how large it is, and opens it in SillyTavern's World Info editor.

## What it does

### Tracker book

- The name and a line such as "Reflects reply 12. Holds 240 tokens of 600 tokens, sent with every request." The reply is the newest one whose shown swipe has tracker values; the limit depends on the size of the chat model.
- The entries, one per card you have on and one per present character for the character cards, each with its size in tokens.
- When the limit was reached, a warning names the cards left out; [Recall](help:glossary), the records chosen for each reply, keeps sending those values.
- **Open in World Info** opens the book in SillyTavern's editor.
- **Rewrite now** writes the book again from the replies on screen.

Before any reply has tracker values, the page says the book is written once one does. When a write was refused, the page gives the reason. To export the book, use Export on SillyTavern's World Info screen.

### How it works

The book is rewritten after each reply is read and after a swipe, an edit or a delete, so an edit made in the World Info editor is replaced at the next rewrite. To correct a value, use [Story, Scene, Correct story facts](page:corrections).

Each write also sets the same values as chat variables, so a preset block or a World Info entry can read them, for example {{getvar::ri_scene_place}} for the scene's place.

## Model calls and cost

Nothing on this page makes a model call; writing the book [runs in code](help:model-calls). The values come from the background call after each reply that records what changed, on the routes in [Setup, Background jobs](page:background-jobs). The book reaches the model as World Info inside SillyTavern's reply request, right after Recall; its size also shows in [Review, Context, Tracker book](page:tracker-book-size).

## Why it works this way

- Tracker values are kept with each reply, so a swipe or a branch shows the values of the swipe on screen, and the book always copies them.
- A Constant book gives the model the live values with every reply through SillyTavern's own World Info, leaving the chat's own World Info slot free.
- The chat variables let presets and your own entries use the same values.
