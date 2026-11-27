# Spend

Spend shows this month's paid background spend against your monthly ceiling, the calls and health of each route, and any notes about a route that stopped answering. A route is one place a model call can go, such as your desktop over Tailscale, a free tier or a paid provider ([how model calls work](help:model-calls)). Open Spend when the Quick action bar above the message box shows a spend note, when background work seems paused, or to change the ceiling.

## What it does

The top line reads, for example, "US$1.12 of US$5.00 used, US$3.88 left, 3,214 calls", with a meter under it. Past the warning point a line says so. At the ceiling, paid background calls pause until the first of next month or until you raise the ceiling, while free and local routes carry on.

### How it works

The meter resets on the first of each month. Background calls are the ones no tap starts:

- filing each reply into memory, catch-up and upkeep
- the Follow-through check, which checks that a reply did what it was told
- roll judgments, the call before a reply that decides whether an attempt needs a dice roll
- Options for the Choices card after each reply

A paid route's calls for these count toward the ceiling. Calls made through the jobs in [Setup, Connections](page:settings) are metered the same way, while a few buttons send their call unmetered; each page says which of its buttons count. Chat replies through your main connection stay outside the ceiling.

### Notices

Each note waiting for you shows with its own Dismiss. When your desktop or the on-phone model does not answer and a job runs elsewhere, one note shows for that outage and says whether the fallback is paid. When the route answers again, that note clears and one "back" note shows. The Quick action bar shows the same notes, and dismissing in either place clears both.

### Limits

- **Monthly ceiling** starts at US$5.
- **Warning at** starts at US$4 and stays at or below the ceiling; a higher value is set to the ceiling.
- **Restore US$5 and US$4** puts both back.

### Calls this month, by route

One row per route: Desktop, On-phone model, NanoGPT plan, OpenRouter free model, Google AI Studio free tier, OpenRouter and Main API. Each row shows:

- its kind (Local, Plan, Free tier, Paid or Main connection)
- its calls and cost this month
- In use, on the route that answered last
- when it last answered, and when and why it last failed
- Skipped until a time, while it rests after not answering

Each job tries the desktop first, then the NanoGPT plan, then free tiers, then paid routes within the ceiling, then the Main API. A route that does not answer is skipped for 10 minutes and checked again only when a job needs it.

When jobs wait on the ceiling, **Paused jobs** lists them with "Paused, monthly ceiling reached".

### Paid background calls this month

A fold, with the count in its name, lists the last 20 paid calls, newest first, with route, model, job, time and cost.

## Model calls and cost

Nothing on this page calls a model; it reads the meter. The order of routes per job is set in [Setup, Background jobs](page:background-jobs), and the connection for each tapped job in Setup, Connections.

## Why it works this way

- Background work has a US$5 ceiling and a US$4 warning, and free routes come first, so spend stays small without your watching it.
- At the ceiling only paid background calls pause; free and local routes carry on, so memory keeps working.
- One note per outage, a back note when the route returns, and calls and cost per route show where each call went.
