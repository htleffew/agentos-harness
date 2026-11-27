# Diagnostics log

A record, kept with each reply, of what its request left out and why. Turn it on when a preset block or a World Info entry you expected did not reach the model, then read the reason on the reply's receipt. While it is off, nothing is recorded and no request changes.

## What it does

**Keep a log of what was not sent** starts Off and applies to every chat. While it is on, each new reply keeps two short lists:

- Preset blocks left out of its request. A block can be switched off, taken out of the list of blocks the preset sends, belong to a feature that is off for this chat, be held back until its first reply, or be on and still missing because SillyTavern trimmed it by size.
- World Info entries SillyTavern's scan considered and did not send. The reasons are a chance roll that missed, a cooldown, a delay (too early in the chat), a lost inclusion group, the World Info budget running out, or recursion stopping before the entry. Entries that matched no key are counted and left unlisted.

Each reply keeps at most 40 rows, and a longer log says how many rows were left out. The log belongs to the version of the reply it came with; a Swipe keeps its own log, a branch copies it, a delete removes it, and a Continue adds to it.

Read a reply's log on its receipt in [Review, Replies](page:sent), in the fold Diagnostics log, what was not sent; that fold has **Save as a text file**. **Save this chat's logs as a text file** on this page saves every reply's log in the open chat as one file.

## Model calls and cost

Nothing here calls a model. The reasons come from SillyTavern's own World Info scan and from your preset's blocks, read in code ([how model calls work](help:model-calls)).

## Why it works this way

- The log stays off until you need it, so everyday play carries no extra lists.
- Only the reply's own scan counts, so a dry run SillyTavern makes to count tokens never stands in for the real request.
- Keeping the log with its reply keeps it true to the version of the reply on screen.
