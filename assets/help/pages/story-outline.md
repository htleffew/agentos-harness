# Story outline

A private outline of possible next chapters for the open chat. Every 40 replies a model call writes it from the chat's records, its open threads and the line saying how each thread ends, and the writer reads it inside the Director's desk entry of the [Tracker World Info book](help:glossary). Use it to read the outline, change it, or have it written now.

## What it does

### Story outline

- **Story outline** is the switch, On to start with. Turning it off stops the runs and takes the outline out of the Director's desk; the text stays on file.
- **Possible next chapters** holds the outline, one chapter per line, up to 1,400 characters. Your edit stays as you wrote it, and the writer reads it at the next reply. A status line below says when and on which route it was written, whether you edited it, and when the next run comes.
- **When you have edited it, the next run** starts on Keeps your text, where the 40-reply run makes no call and leaves your edit alone. Rewrites it from your text makes the run write a new outline starting from your edit.
- **Write the outline now** writes it at once, always starting from the text in the box.
- **Clear** empties the outline.

Everything below the switch needs an open chat whose story memory is on, since the outline reads the memory's records.

### How it works

The call uses free routes only; the desktop over Tailscale, a free tier, or your NanoGPT plan. When none of them answers, the run waits and spends nothing, and the status line says so.

## Model calls and cost

Each run is 1 model call ([how model calls work](help:model-calls)), marked with the amber dot on **Write the outline now**. The free routes it may use, and their order, are in [Setup, Background jobs](page:background-jobs) under Story outline; paid routes are left out, so it never spends and never counts toward the ceiling in [Setup, Connections, Spend](page:spend). The automatic run comes every 40 replies, after a reply is read into memory.

## Why it works this way

- An outline every 40 replies, on free routes only, gives the writer a direction for the story at no cost.
- Keeping the outline inside the Tracker book's Director's desk entry places it where the model already reads story state, with no extra block in the request.
- Your edit wins by default, so an outline you shaped stays as you left it.
