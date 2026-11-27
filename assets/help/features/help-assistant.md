# The help assistant

The help assistant answers questions about how the extension works and where each control lives. It opens from [Setup, Help](page:help) with **Ask the help assistant**, reads this guide, and links you to the page where you make a change. It changes no setting.

## What it does

### One question

You type a question and tap **Ask**. The extension finds the three guide entries that match your words best and sends one request to a model with three parts:

- a fixed set of instructions, the same for every question, telling the assistant to answer from the guide and to say so when the guide does not cover the question;
- the three entries;
- your question, last.

The answer shows in the sheet with:

- **From the guide**, the entries the answer came from; each opens its entry in Setup, Help;
- a **Show** button that opens the page with the matching control in view;
- a line that says "1 model call" and which route answered, and a note when an earlier route did not answer.

When the entries leave the question open, the answer starts with "The guide does not cover this." When no entry matches a single word of the question, that answer comes at once and nothing is sent.

### Your settings and stack

The switch **Let the assistant read this chat's settings and stack** sits in the sheet under the question box. It starts off in every chat and stays as you set it for that chat. While it is on, each question also carries:

- your Roleplay Instructions settings, with API keys, tokens and any saved text from your chats left out and long text cut;
- which features are on for the chat;
- the active preset;
- the stack, which is the list of prompt blocks the preset and the extension send, by name with each one on or off.

Nothing from your chats or World Info entries goes with it.

**Include the latest reply with this question** sends the newest reply's text with one question and clears after that question.

### The route

Questions use the routes in Help settings on [Setup, Help](page:help), tried in order. The list starts with the desktop model over Tailscale, then the NanoGPT plan, the free OpenRouter model and last the Main API, so a question still gets an answer when the others are down. If a list you saved earlier has no Main API, it is added at the end once; if you remove it, it stays removed. You can add other named routes and any saved Connection Profile, and put them in any order.

## Model calls and cost

Each question is 1 model call, and the **Ask** button carries the amber dot; [how model calls work](help:model-calls) explains the dot and the routes. Opening the sheet, finding the entries, the links and the answer for a question no entry matches make no call. A paid route, the Main API on a paid provider included, counts toward the monthly ceiling in [Setup, Connections, Spend](page:spend).

## Why it works this way

- Answers come only from the guide, so the assistant names places that exist, and says so when the guide is silent.
- The fixed instructions come first and stay the same, so repeat questions may cost less on routes that support it.
- The assistant is read only; you make every change, and the Show button takes you to the control.
