# Context & memory

What the open chat sends now and how much room it takes. Use it to see whether memory has filed the latest replies, how many messages are excluded from prompts, how the last request was made up, and what [Recall](help:glossary) would send with the next reply. Memory settings live in [Setup, Memory](page:memory).

## What it does

### Memory status

A line gives the reply memory has filed through, how many editable records have changes, and how many replies need review. When filing failed, the problem shows with **Retry filing**. Links lead to Setup, Memory (settings, catch-up and rebuild) and to [Story, Story World](page:world), The story so far (write a chapter now).

### Counts for the open chat

The section headed **This chat now** shows three numbers:

- **Story messages** counts every story message, including ones excluded from prompts.
- **Currently visible** counts the messages the model can be sent; SillyTavern may still leave out more when it builds a request.
- **Exclude from prompts** counts the messages hidden from the model, which stay readable in the chat.

### Last observed request

A breakdown of the last request this chat sent since you opened or reloaded the app, in rough tokens (about four characters each):

- the whole request;
- the recent conversation it recognized;
- Story World notes;
- chapter summaries;
- recalled World Info and records;
- story events and world orders;
- other extension instructions;
- scene, state and update instructions.

Parts can miss text a preset or another extension changed, so they do not add up to the total. When SillyTavern does not expose the assembled request, the breakdown is unavailable.

### Memory in the last request

Appears when memory sent blocks with the last request. It shows where the memory notes, the chapter view and the Recall block sat; the first message that changed since the request before it, with how much was sent again uncached; and the model size used for the memory caps. If SillyTavern cut a block to fit the context size, a warning names it.

### Next reply preview

What Recall would send with the next reply from this chat's Story World; who is read as present, the place, people named with no entry yet, the size, and the exact text. With no Story World, the section asks you to choose or create one.

## Model calls and cost

Nothing on this page calls a model. The numbers, the breakdown and the preview [run in code](help:model-calls) from the chat and the last request, and so does **Retry filing**.

## Why it works this way

- Chapters, the condensed story and hiding keep requests small, so the page reports sizes and warns only when SillyTavern cut a memory block.
- The breakdown reports the last real request, so its numbers describe what was sent.
- Each memory setting has one home, so this page links to Setup, Memory and holds no switches.
