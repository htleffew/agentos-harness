# What was sent

A receipt for each recent reply in the open chat; what the extension sent with it, why, and what happened. Use it when a reply ignored an instruction, to see which items a story event rolled, or to send an instruction again. It lists up to 30 recent replies, newest first, with the newest open.

## What it does

### Notes at the top

- **World Info display settings** opens [Setup, Look, Reply display](page:display). Confirmed, on a World Info selection, means the extension found the text in the assembled request.
- When instructions wait to be sent again, a warning names them, with **Do not send these again**.
- With the Follow-through check off in [Direction, Sets and pacing](page:set-rules), Done and Overdue do not show.
- A link offers to carry the story into a new chat with a chapter summary and opening.

### One reply's card

The title names the reply and its version, with a summary line such as "2 instructions and writing style sent, 1 done". Inside, in order:

- **What the model saw** opens [Review, Context, What was sent](page:what-was-sent) for this reply.
- How any Swipe, Continue or Quick action ran, and the Directions sent with the reply, each marked Private guidance or Visible OOC, with what the check found.
- The diagnostics log of what was not sent, when that log is on.
- **Story guidance sent**, the exact guidance text when it was kept, with **Edit writing guidance** and **Guidance receipt settings**.
- Action check results, a [Plot offer](help:glossary), World Info selections (each marked Confirmed in prompt or Delivery unconfirmed), and a warning if the reply wrote for you.
- The story phase, or that nothing new started because of the calm after a big event.
- One row per item sent; instructions, [Recall](help:glossary), the goal task, world orders and phases. Each row gives the set, why it was sent (New, Kept sending, Sent again, or a reminder), its settings at the time, the exact text sent, and the part of the reply that shows it happened.
- What the dice picked, by category.
- Questions about the reply asked by the writing style, with the check's answers.
- What this reply changed in the Story World, with **Undo these changes**.
- Story rules that fired.

### Buttons

- **Edit this instruction** opens the instruction in its set.
- **Undo done** marks an instruction not done, so it is sent again.
- **Send again** sends an instruction again with the next reply; **Do not send again** cancels that.
- **Pick again** (newest reply only) picks a different item for one category and writes a new reply.
- **Lock for this chat** keeps one category's pick for the rest of this chat; **Unlock for this chat** lets the dice pick again. The set itself is unchanged.
- **Keep until I turn it off** changes the set, so that category uses this item in every chat.
- **Regenerate** (newest reply) rolls the instructions again and swipes to a new reply.
- **Check this reply again** (newest reply) checks the reply again after you edit it by hand.

## Model calls and cost

Reading the receipts [runs in code](help:model-calls). **Check this reply again** is 1 model call, the Follow-through check. It starts on Automatic, which tries the free and local routes in [Setup, Background jobs](page:background-jobs) first and ends on the Main API, or it uses a Connection Profile you fix in [Setup, Connections](page:settings); the call is metered, so a paid route counts toward the ceiling in [Setup, Spend](page:spend). **Regenerate** and **Pick again** write a new reply with SillyTavern's reply request. The other buttons change a record in code.

## Why it works this way

- Each reply keeps its own record per swipe, so the receipt shows what that version of the reply was sent.
- Lock for this chat changes one chat and Keep until I turn it off changes the set for every chat, so they are separate buttons.
- A missed instruction can be sent again or dropped from the reply it belongs to.
