# Tracker book

How many tokens the [Tracker World Info book](help:glossary) adds to each request of the open chat, and which cards take the most room.

## What it does

### Tracker book

A line gives the book's size against its cap, for example "The Tracker book holds 420 tokens of 600". The book goes out with every request at depth 1, after the Recall block. Each entry is listed by card or character with its size.

- When cards were left out to stay inside the cap, a warning names them; the Recall block keeps sending those values.
- When the book could not be written, the reason shows in place of the size.
- With no Tracker book yet, there is nothing to list; the book is written once a reply has tracker values.

The page has no settings. The book's contents, **Open in World Info** and **Rewrite now** are on [Story, World Info, Tracker book](page:tracker-book).

## Model calls and cost

Nothing on this page calls a model; the size is read from what the chat already records about the book ([how model calls work](help:model-calls)).

## Why it works this way

- The Tracker book feeds the model the current tracker values, and Recall leaves those values to it.
- The book is sent with every request, so its size sits under Review, Context beside the other parts of the request.
