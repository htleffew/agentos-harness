# Model calls, routes and cost

The extension adds work around SillyTavern's own reply. Some of it rides inside the reply request, some needs no model at all, and some needs a model call of its own. Each control says which, with the same words everywhere.

## What it does

### The three kinds of work

- **1 model call, extra request.** A request the extension adds on top of SillyTavern's own. A button that starts one carries a small amber dot in its top right corner, and a screen reader announces "1 model call, extra request" with its name. Examples are Options on the Quick action bar, Generate again in the Options sheet, Write a chapter now in [Setup, Memory](page:memory) and a question to the help assistant.
- **SillyTavern's reply request.** Swipe, Continue and Impersonate run SillyTavern's own reply request; the saved Direction and any words typed in the Generate sheet ride inside it, so they add no call and carry no dot.
- **Runs in code.** The extension does the work itself with no model; the Action check, Review and Direction quick actions, search, the reply tray and the checks of a reply's writing all run this way.

Calls no tap starts, such as keeping the story's records after each reply, writing chapters on their own and the Follow-through check (checking that a reply did what it was told), carry no mark on the bar. Each one shows in the Sent card of the reply tray and in [Setup, Connections, Spend](page:spend).

### Routes

A route is a way to reach a model.

- A tapped extra request uses the connection set for it in [Setup, Connections](page:settings): a fixed connection such as the Main API (your chat connection) or a saved Connection Profile, or Automatic, which follows a route list.
- Work no tap starts tries a list of routes in order, shown and reordered in [Setup, Background jobs](page:background-jobs). A list is drawn from the desktop model over Tailscale (your own computer, reached from the phone through Tailscale), the NanoGPT plan, free tiers, paid routes within the ceiling and the Main API, in that order; short yes or no judgment calls and catch-up can also use the on-phone model.
- A route that does not answer, times out or is rate limited passes the work to the next one and is skipped for 10 minutes. A note says which route took over, once per outage, and another says when the first route is back.

### The monthly ceiling

Every paid model call the extension makes counts toward the ceiling, whether you tapped a button or it ran in the background. Chat replies through your main connection stay outside it.

- Paid calls include background jobs, the jobs in Setup, Connections (on Automatic, or fixed to the Main API or a Connection Profile), buttons such as Write a chapter now, Close the chapter here, Write the synopsis and start and Draft entries, and questions to the help assistant.
- The Main API counts as paid when your chat connection is a paid provider. It reports no price, so its calls show on the meter at US$0.00.
- Each other paid call is counted at its estimated price when it is sent, then at the price the provider reports.
- The meter starts with a US$5 ceiling and a warning at US$4, and resets on the first of each month.
- At the ceiling every paid route is skipped, so free and local routes keep working. A tapped button with no free or local route left sends nothing and says the monthly spend ceiling is reached; you raise it in [Setup, Connections, Spend](page:spend).

Every model call, free, local or paid, also counts in the request stats on [Setup, Spend](page:spend): requests, tokens and cost per day, and per job over the last 7 days. Chat replies through SillyTavern itself are not counted there.

## Model calls and cost

Each page entry names the calls its own buttons make.

## Why it works this way

- Amber means one thing in the whole menu, a tap that can start an extra call, so the dot never stands for anything else.
- Free and local routes come first, and paid calls stop at a ceiling you set, whether you tapped a button or the call ran in the background.
- A switch to another route is always shown, so you know which model wrote a summary or answered a question.
