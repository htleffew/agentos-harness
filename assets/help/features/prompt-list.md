# Prompts

Every piece of wording the extension sends to a model is a prompt you can edit. Each one is stored once and shows in two places, beside the feature that uses it and in the full list in [Setup, Prompts](page:prompts); an edit in either place changes the one stored prompt.

## What it does

A prompt's editor shows its text, a Default or Customized badge, named variations you can save and switch between, and **Restore default prompt**, which puts the shipped wording back. Some prompts need a placeholder such as a direction or a count, and the editor refuses a version that drops one. The list at the end of this entry is read from the extension, so it holds every prompt by the name its editor shows.

Each page lists its own prompts at its foot with a count of the ones you customized, and a link that opens Setup, Prompts filtered to that page.

## Model calls and cost

Editing a prompt makes no model call. A prompt changes the wording of the call that uses it and adds no call of its own.

## Why it works this way

- Prompts are mirrored, so the wording sits next to the feature it shapes and also in one list where you can find any of them.
- Restore default prompt is always one tap away, so trying new wording carries no risk.
