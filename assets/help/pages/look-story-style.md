# Story style

Story style sets how the story cards in the reply tray look, from their surface and ink to their accent and type face. The menus and the tray's own controls keep the terminal look, and the scene header line (the place, time and people line a reply opens with) keeps SillyTavern's chat font. Open it to change the default style or the style of the open chat.

## What it does

Each style shows as a sample card with its name, the line "The door was already open." in its face, and a short description. There are four:

- Parchment, a serif page in umber and cream
- Noir, a typewriter on smoke black
- Sci-fi readout, a console in cyan and green
- Modern minimal, plain sans on graphite

### Default for every chat

The style for any chat that has not chosen its own. It starts at Modern minimal, and a tap saves the new default.

### Settings for this chat

Shown while a chat is open, under the heading This chat. A tap gives the open chat its own style, saved with the chat, and a line says whether the chat has its own style or follows the default. **Use the default for this chat** clears the chat's own choice.

The first time the tray draws in a chat, the extension reads the character card and the chat's active World Info books for setting words, such as "detective" and "1940s" for Noir, "starship" and "android" for Sci-fi readout, and "kingdom" and "spell" for Parchment. It offers the style with the most hits, or Modern minimal when nothing scores or two styles tie. The offer shows once as a chip in the tray's Strip; choosing a style here or there settles it.

## Model calls and cost

Nothing on this page calls a model. The style offer for a new chat also runs in code, by counting setting words ([how model calls work](help:model-calls)).

## Why it works this way

- The menus keep one look, and story cards take a style per chat, so a detective story can read like a case file and a fantasy like a ledger page.
- Every style keeps a dark surface and none uses amber or red as an accent, so a warning inside a card still reads as a warning.
- The faces ship inside the extension, so nothing downloads while you play.
