# Prompts

Prompts lists every prompt the extension sends, in one place, grouped by family and by the page that uses it. Each row is the same editor that sits beside its feature, so an edit here and an edit there change the one stored prompt. The full list is also in the [prompt list](help:prompt-list). Open Prompts to find a prompt by name, to see which prompts you have changed, or to restore one.

## What it does

The menu shows a count beside the page name, such as "3 customized" or "All default".

### Find a prompt

**Find a prompt** filters the list by words in a prompt's name or its page. A line under it reads, for example, "12 prompts, 3 customized".

### Families

The list is grouped in four folds, one per family, in this order: Story, then Direction, then Reply, then Setup. Each fold shows how many prompts it holds and how many are customized. Inside, each page that uses a prompt has a heading with **Open page**. A prompt used on two pages shows once, under the first, and your own Roast voices appear with the built-in voices under Reply. The folds open by themselves while you search or arrive from a page's own link.

### The editor

Each prompt opens to its editor:

- the text box, with a note naming any placeholder such as {direction} that must stay, since the extension fills it in
- **Variation**, your saved wordings, with Update, Save as, Rename and Delete
- **Restore default prompt**, which puts the shipped wording back, and **Undo restore**
- Import and Export, which read and write one wording as a file
- **Compare with default**, which shows the shipped wording beside yours
- **Discard draft**, which drops unsaved typing

A chip on each row reads Default or Customized. When the shipped wording has changed since you saved your own, a note says so and your wording stays in use. When the prompt changed in another view while you were typing, a note asks you to discard your draft first.

### Arriving from a page

Each page lists its own prompts at its foot. That link opens Prompts filtered to the page, with **Show every prompt** to clear the filter and **Open page** to go back.

## Model calls and cost

Nothing on this page calls a model ([how model calls work](help:model-calls)). The prompts are sent later by the features that use them, and each feature's page says how.

## Why it works this way

- Every prompt is stored once, so the editor beside a feature and the one here always show the same text.
- Every prompt is reachable from one page, so you can find a wording without knowing which page uses it.
- Saving your own wording for a feature also puts it in the stack on [Setup, Presets](page:presets) as its own card, with the shipped card turned off one tap from back on.
- Live chat details and required response formats are added separately, so an edit changes only the wording.
