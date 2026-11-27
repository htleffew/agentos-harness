# Correct story facts

Correct story facts records a fact the story got wrong and, if you choose, repairs the places the wrong version came from, such as an earlier reply, a chapter summary, a record in [Story World](help:glossary) (the chat's lasting record of the story), a World Info entry or the character card. Saved corrections go out with later replies as canon.

Opened from a reply's menu, the page targets that reply and version, names them at the top and offers **Read the selected reply**. When that reply has changed since, the page says so and asks you to open it again from the version you mean.

## What it does

### Correct story facts

- **Correct story fact** is the true statement, up to 1,000 characters, for example "The bridge was built of stone."
- **Find and update sources with AI** starts off. Turned on, a model traces the correction to its sources and edits them. It turns itself off once you tick a source edit by hand.
- **Regenerate the latest reply** shows when the latest reply can be swiped, and starts ticked.
- A cost line states what saving will do, from "No model calls" up to "Up to 2 model calls".
- **Apply correction** saves the correction. It reads **Find and apply source edits** with AI tracing on, and **Repair facts and swipe** with Regenerate ticked.
- **Repair facts only** searches the sources, repairs the ones it can and saves the correction, with no swipe, then lists the sources it checked.
- **Undo source repair** shows after a save and takes the source edits back.
- **Regenerate** shows when the swipe failed, and tries it again.

### How it ran · Runs in code

A fold with the route, the number of calls and the outcome of the last run. Its title changes to Additional model call while AI tracing is on.

### Find and edit source records

- **Wrong wording, optional** is the exact phrase to look for, up to 400 characters.
- **Find source matches** searches the sources by that wording or by the corrected fact.
- **Trace and draft with AI** searches the same way and has a model propose edits.
- **Connection settings** opens the route for corrections in [Setup, Connections](page:settings).

Each match is a card with its excerpt and where it sits.

- **Jump to source message** scrolls the chat to the message it came from.
- **Read the full source** shows the whole text.
- **Review proposed edit** (or **Edit this source** when no edit was proposed) holds **Exact wording to replace**, **Replacement text** and **Remove the quoted wording**.
- **Use my correction text** copies your fact into the replacement.
- **Apply this edit** includes the edit in the save. It starts ticked for a proposed edit, and unticked on your own messages and on the swipe you are correcting.
- **Show more source matches** adds eight more cards.

The quoted wording has to occur exactly once in its source, so an edit cannot land in the wrong place.

### Customize correction prompts

- **Tracing story corrections** guides the search for where a mistake came from.
- **Regenerating after a story correction** is the direction for the new swipe.
- **Using accepted story corrections** goes out with later replies so corrections stand as canon.

Edits apply in every chat and show in [Setup, Prompts](page:prompts) at once.

### Saved corrections

Under the form, each saved correction shows its fact, the reply and version it was made on, the sources it changed, a button that opens that reply in [Review, What was sent](page:sent), and **Undo source repair**.

## Model calls and cost

- Saving with nothing extra ticked, **Find source matches** and **Repair facts only** [run in code](help:model-calls).
- **Find and update sources with AI** and **Trace and draft with AI** are 1 model call each, marked with the amber dot. They use the route set for corrections in [Setup, Connections](page:settings), which starts on Automatic and tries the routes in [Setup, Background jobs](page:background-jobs) in order; a paid route counts toward the monthly ceiling in [Setup, Spend](page:spend).
- **Regenerate the latest reply** is 1 model call, a swipe through SillyTavern's reply request on the Main API with the correction as its Direction.
- Saved corrections ride later replies inside SillyTavern's reply request.

## Why it works this way

- A wrong fact usually sits in more than one place, so the page finds every copy and a summary cannot repeat the mistake later.
- The search and the replacement work on exact quotations, and a model is used only when you turn on tracing.
- Your own messages and the swipe you are correcting start unticked, so nothing you wrote changes without your tick.
