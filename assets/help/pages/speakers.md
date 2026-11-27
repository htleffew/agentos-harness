# Dialogue colors

Dialogue colors gives each speaking character a color for their quoted dialogue and their italic thoughts in the chat. A character is added here once the story names them as the speaker of a line, with a color from the extension's palette.

## What it does

### Dialogue colors

One card per character. With none yet, the page reads "Characters appear here as dialogue or thoughts identify them."

- The color picker beside the name sets that character's color for this chat and recolors the chat at once.
- A sample quote, "I'm ready when you are.", shows the color as it will appear.
- A status line gives the saved color, the displayed color when the two differ, and "Contrast background applied" when the text needed a panel behind it.
- **Use automatic color** picks the next palette color no other character in this chat uses.

Colors show while Dialogue colors is on in [Setup, Features](page:v10). The speech tags that identify a quote (such as "Mira said") are hidden in the chat while the extension supplies this [Feature](help:glossary).

The saved color is checked against the chat's background. When it reaches a contrast of 7 to 1, it shows as saved. Below that, it is lightened or darkened step by step until it does. When the background is an image, or no step reaches 7 to 1, the text gets a small panel behind it. Changing SillyTavern's theme recolors the chat again.

### Customize speaker attribution prompt

One prompt, **Dialogue and thought attribution**. It asks each reply to use ordinary quoted dialogue and a speech tag when the speaker would otherwise be unclear, so the extension can tell who said what. Edits apply in every chat and show in [Setup, Prompts](page:prompts) at once.

## Model calls and cost

Nothing on this page makes a model call. Finding the speaker of each quote, choosing colors and checking contrast [run in code](help:model-calls). The Dialogue and thought attribution prompt rides SillyTavern's reply request while Dialogue colors is on.

## Why it works this way

- The speaker is found from the story text itself, so the reply needs no extra markup and the colors cost nothing.
- A contrast of 7 to 1 keeps colored text readable on any theme while your saved color stays as you chose it.
- Colors are saved per chat, so the same name can carry a different color in another story.
