# Changelog

## 3.0.0 (2026-11-15)

Version 3: Random Writing Style.

- New tab with writing style sets. One style order is sent with every reply while a set is on for the chat.
- Eight starting categories: {{char}}'s mood, Prose style, In the manner of this author, Writing habits, Sense to
  lead with, Pacing, Rule for this reply, Point of view and tense (locked).
- Each category has its own timing in replies: keep one item, keep for a random number of replies, or new every
  time; plus a chance to sit out and a rest after each pick.
- "Words added after the pick" per category, used by mood to say how the mood applies.
- The style order carries a scope line (story prose only; formatted blocks keep their format) and "a required
  instruction wins over any style choice".
- Style is recorded in What Was Sent, is not checked by AI, keeps going while an instruction is overdue, and
  stays outside per-reply limits.
- Write items with AI for style categories, with a description of each starting category for the AI.

## 2.0.0 (2026-11-15)

Version 2: Random Story Events.

- New tab with story event sets: categories of short items, saved as a lorebook.
- Dice pick from every category that is on. Per category: new pick every time, keep for a random number of events,
  or keep one chosen item; items per pick; use every item before repeating; wait before an item returns; never
  use tagged items; always-include items; weights.
- Write items with AI for one category from a few words about the story.
- "Roll an example event" shows the exact text the AI would receive.
- Events use everything from Version 1: timing in replies, per-chat on and off, the check with re-sends, What Was
  Sent (now with what the dice picked), swipes repeat, deletes and branches rewind the rotation.
- The lorebook entry holds a `{{random}}` list per category, so a set still gives plain random events with the
  extension off.

## 1.1.0 (2026-11-15)

- Timing ("keep sending", "wait", "do not send before reply") is now done by the extension from the records on the
  replies. Found on a TauriTavern tablet: World Info was handed a fixed window of 40 messages, so its own sticky
  and cooldown counters never advanced. Timing now works in chats of any length and with any summarizer or
  context limit, and follows swipes, deletes and branches exactly.
- A reply that carried no instruction is recorded too, so swiping it sends nothing again.
- Tests run with and without a message window.

## 1.0.1 (2026-11-15)

- Deleting messages or opening a branch now brings the waiting list and the timers in line with the chat as it
  stands: re-sends that belonged to deleted replies are dropped, timers started by deleted replies are cleared,
  and the state of the newest remaining reply is restored.
- Editing the newest reply checks it again. New button: "Check this reply again".
- Swiping a reply after deleting later messages repeats that reply's own instructions.
- New button on the waiting note: "Do not send these again".

## 1.0.0 (2026-11-15)

First release. Version 1: Random Instructions.

- Instruction sets saved as ordinary lorebooks; open any existing lorebook as a set.
- Instruction editor: name, when it can be sent, chance, keep sending, wait, start reply, Only-one group,
  Send-together group, sent as, placement, who does it, who it happens to, versions, notes.
- Write versions with AI from one sentence, with review, name swapping and checks.
- Checks on every version: {{user}} acting (blocks saving), optional wording, figurative or vague wording, real
  names, matches for your regex scripts.
- Names and pronouns as placeholders, set per chat and remembered per character and persona.
- How many instructions can be sent per reply: no limit, one per reply, one Send-together group per reply, at
  most N per reply.
- Versions cycle without repeats. Swipes, regenerate and continue repeat the same instructions.
- Check that it happened, with the words from the reply that show it. Missed instructions are sent again with
  Overdue and then Final wording.
- What Was Sent tab, and an optional section under each reply (display only, or saved in the message).
- Blue and green colour scheme in the Neon Sola card style, with an accent colour setting.
