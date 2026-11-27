# Current scene

Current scene shows the [Story state](help:glossary) of the open chat as of the latest reply, which means where things stand right now. That is the scene (who is present, where, when, the time, the date, the weather and the surroundings) and one card per character with their mind, heart, body and psyche. You can correct any of it by hand, and the next reply starts from your values.

## What it does

### Customize the scene timing prompt

A fold with one prompt, **Recording story time and weather**, which asks for place, time, date and weather in separate fields as soon as the story supports them. Edits apply in every chat and show in [Setup, Prompts](page:prompts) at once.

### Current story state

Two notes can appear under the heading.

- After a branch, a note says the branch has its own copy of the story's records. **Dismiss branch note** hides it.
- After an earlier reply was edited, a warning says that reply's state and the later automatic changes were taken back. It links to rebuilding from the whole chat in [Setup, Memory](page:memory). Chapter summaries that overlap the edit stay out of replies until you tap **I have reviewed the story**.

### Scene

A fold listing the scene fields that hold a value, from Present, Where, When, Time, Date, Weather and Environment. A field you protected is marked "protected".

- **Edit scene** opens a box per field.
- **Protect from automatic changes** sits under each box and starts as the field's current state. Typing in a field ticks it, except for When, Time and Date, which keep moving with the story clock until you tick the box yourself.
- **Save scene** saves the changes. A date the story's calendar cannot read is refused with a message.
- **Cancel** closes the editor.

Tags to skip, which keeps tagged random events out, lives in [Direction, Sets and pacing](page:set-rules).

### Character cards

One fold per character, showing Mind, Heart, Body and Psyche where they hold a value, and a "Who they are" fold for the character's portrayal. With no characters yet, the page reads "No character state has been recorded yet."

- **Edit state** opens the four fields, each with **Protect from automatic changes**; typing ticks it. **Save state** saves values and protection.
- **Save a lasting fact to Story World** writes one lasting fact into that character's Story World entry. Pick the field (it starts on Enduring boundaries), type the fact and tap **Save to Story World**. A field that already holds a value asks for confirmation before it is replaced. The save needs exactly one Story World character with that name.

## Model calls and cost

Nothing on this page makes a model call; every edit [runs in code](help:model-calls). The values themselves arrive from the background call the extension makes after each reply to record what changed, on the routes in [Setup, Background jobs](page:background-jobs). The Recording story time and weather prompt goes out with the opening request on [Story, Scene, First message](page:opening).

## Why it works this way

- The state is kept with each reply, so a swipe or a deleted reply takes back what that reply set.
- A value you type is protected, so the next automatic update leaves your correction alone. The clock fields stay free so story time keeps moving.
- Lasting facts go to Story World, where they are found again for later replies; the scene card holds the present moment.
