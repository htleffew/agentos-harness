# What was sent

What the model saw with one request, and why; the chapter view, each recalled record with its scores, what was held out and the reason, the sizes and the cache. Use it to learn why a fact was or was not in front of the model for a reply, or to see what the next request would carry. The page needs an open chat whose story memory is on.

## What it does

**Request** starts on The next request; the other choices are the replies of this chat, newest first, the latest marked so. **What the model saw** on a reply's receipt in [Review, Replies](page:sent) opens this page on that reply.

For the next request, the view is built now from the chapter view, a [Recall](help:glossary) search on the text in your message box, and the [Tracker World Info book](help:glossary). For a past reply it shows the copy saved when that request went out, so a later edit, preset change or chapter rebuild leaves it unchanged. A reply sent from another device shows only how many records it carried and its size.

### Chapter view

Which chapters went in full, which condensed account went with them and when it was rebuilt, and its size against its cap.

### Recall block

Each recalled record with its subject, kind, text, size and three scores (relevance, recency and importance). A line says why it was picked:

- pinned by you;
- its World Info entry fired;
- ranked by its scores;
- found by meaning search;
- a passage of an earlier reply.

A button opens [Story, Story World](page:world) on the reply that filed the record.

### Held out

Candidates that stayed out, each with its reason; Secret holder absent, Repeats your entry, Replaced, Below the cut, or Over the cap.

### Sizes

Tokens for the chapter view, the Recall block and the Tracker book against their caps, the memory notes, depth 0, and the whole request against its ceiling.

### Cache

The first message that changed since the previous request and roughly how many tokens after it were sent again, with whether the change came after the history or above it (a chapter closed, or something above the history changed).

### Tracker book

The Tracker book entries that went out, the reply their values come from, and their size against the cap.

### Behavior entries and roll

The behavior World Info entries that fired with the reply, and an Action check roll as one line with its margin and degree.

### Trim warnings

Whether SillyTavern cut the chapter view or the Recall block from the request to fit.

A past reply can also list background receipts (its memory capture, memory jobs, a chapter that failed), and **The blocks as they went out** shows the exact text of each block.

## Model calls and cost

Nothing on this page calls a model. The record is saved when a request goes out, and the next-request view is built when you open the page; both [run in code](help:model-calls).

## Why it works this way

- A past reply shows the saved copy, so the page answers what the model saw at that time even after memory has changed.
- The full record stays on this device, and the reply carries only the record ids and size, so the chat file stays small and the essentials travel with it.
- Every held-out candidate names its reason, so a missing fact can be traced to a cut, a cap or a newer record.
