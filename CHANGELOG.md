# Changelog

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
