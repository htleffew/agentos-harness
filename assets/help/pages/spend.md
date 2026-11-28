# Spend

Spend shows this month's paid spend against your monthly ceiling, the calls and health of each route, any notes about a route that stopped answering, and how many model calls are sent, how large they are and how often, per day and per job. A route is one place a model call can go, such as your desktop over Tailscale, a free tier or a paid provider ([how model calls work](help:model-calls)). Open Spend when the Quick action bar above the message box shows a spend note, when background work seems paused or a button says the ceiling is reached, to change the ceiling, or to see which jobs send the most requests.

## What it does

The top line reads, for example, "US$1.12 of US$5.00 used, US$3.88 left, 3,214 calls", with a meter under it. Past the warning point a line says so. At the ceiling, paid calls pause until the first of next month or until you raise the ceiling, while free and local routes carry on.

### How it works

The meter resets on the first of each month. Every paid model call the extension makes counts, tapped or not. Background calls are the ones no tap starts:

- filing each reply into memory, catch-up and upkeep
- the Follow-through check, which checks that a reply did what it was told
- roll judgments, the call before a reply that decides whether an attempt needs a dice roll
- Options for the Choices card after each reply

Tapped calls count the same way, among them the functions in [Setup, Connections](page:settings), Write a chapter now, Close the chapter here, Write the synopsis and start, Draft entries and help questions. The Main API counts when your chat connection is a paid provider; it reports no price, so its calls show at US$0.00, and at the ceiling a tap fixed to it is refused. At the ceiling a tap with no free or local route left sends nothing and says the ceiling is reached. Chat replies through your main connection stay outside the ceiling.

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

Each job tries the desktop first, then the NanoGPT plan, then free tiers, then paid routes within the ceiling, then the Main API, which counts toward the ceiling when your chat connection is a paid provider. A route that does not answer is skipped for 10 minutes and checked again only when a job needs it.

### Requests by day

Every model call counts here, free, local and paid: background jobs, judgment calls, the desktop warm-up, the buttons you tap and help questions. The replies you write through SillyTavern itself are its own requests and are not counted.

A table lists one row per day, today first, with its requests, tokens in, tokens out and paid cost. Tap a day to show one row per job under it; tap it again to hide them. Token counts come from the provider when it reports them; a count marked ~ is estimated from the length of the text, at about four characters to a token. The last 31 days are kept.

### Requests by job, last 7 days

One row per job for the last 7 days, today included, with its requests, its requests per day on average, and its median request size in tokens in and out together.

**Clear stats** asks first, then removes the counts for every day and job. The spend meter and the rows above stay.

When jobs wait on the ceiling, **Paused jobs** lists them with "Paused, monthly ceiling reached".

### Paid calls this month

A fold, with the count in its name, lists the last 20 paid calls, newest first, with route, model, job, time and cost.

## Model calls and cost

Nothing on this page calls a model; it reads the meter and the request stats. The order of routes per job is set in [Setup, Background jobs](page:background-jobs), and the connection for each tapped job in Setup, Connections.

## Why it works this way

- Paid calls have a US$5 ceiling and a US$4 warning, and free routes come first, so spend stays small without your watching it.
- At the ceiling only paid calls pause; free and local routes carry on, so memory keeps working.
- Every paid call counts, whether you tapped a button or it ran in the background, so one meter shows all of the extension's spend.
- One note per outage, a back note when the route returns, and calls and cost per route show where each call went.
- The request stats show how many calls go out, how large and how often, free and local ones included, per day and per job, so a busy job shows even when it costs nothing. They keep 31 days, so the settings file stays small.
