# Background jobs

Background jobs lists each job the extension runs without a tap, with the routes it tries in order. A route is one place a model call can go, such as your desktop over Tailscale, the on-phone model, a free tier or a paid provider ([how model calls work](help:model-calls)). You can reorder a job's routes, put them back in the recommended order and test a route. The page also holds the OpenRouter key for judgment calls, the on-phone model and a link to the desktop setup guide.

Open it when a job keeps falling back, when a paid route sits ahead of a free one, or to check that the desktop answers.

## What it does

### How it works

Each job tries free and local routes first, then paid routes within your monthly ceiling. When a route does not answer, the job moves to the next one and a note shows in the Quick action bar above the message box. The ceiling is US$5 unless you changed it in [Setup, Connections, Spend](page:spend).

### Jobs and their routes

Each card names its tier: Quick jobs need a short answer fast, Writer jobs write longer text, and Cleanup jobs tidy records with a stronger model. The recommended routes, tried in order:

- **Judgment call** (Quick), short judgment questions such as whether an attempt needs a dice roll: the desktop, then the on-phone model.
- **Capture** (Quick), filing each reply's changes into memory: the desktop, the NanoGPT plan, an OpenRouter free model, OpenRouter (paid), then the Main API.
- **Stat sheets** (Quick), filling each character's stats, and **Choices** (Quick), the Options that fill the Choices card in the reply tray after each reply: both use Capture's routes.
- **Chapter close** (Writer), writing a chapter: the desktop, the NanoGPT plan, the Google AI Studio free tier, OpenRouter (paid), then the Main API.
- **Story so far** (Writer), the condensed account of older chapters: Chapter close's routes.
- **Tidy** (Cleanup), checking for near-duplicate records: the desktop, the NanoGPT plan, then OpenRouter (paid).
- **Catch-up map** (Writer), filing older replies that are not in memory yet when catch-up starts by itself: the desktop, the NanoGPT plan, then the on-phone model, which it uses only while the phone is charging.
- **Catch-up map, run now** (Writer), the same work when you tap Run now: the desktop, the NanoGPT plan, the Google AI Studio free tier, then OpenRouter (paid).
- **Continue in a new chat** (Writer), the synopsis for a new chat: the desktop when it has answered recently, the NanoGPT plan, OpenRouter (paid), then the Main API.
- **Behavior book drafts** (Writer), drafting World Info book entries and other writing helpers: Continue in a new chat's routes.
- **Story outline** (Writer), a long-range outline of possible next chapters: Chapter close's routes with every paid route dropped.

Each card lists its routes numbered in the order they are tried. Each route shows its kind (Local, Plan, Free or Paid), the model it asks for, and Skipped until a time while it rests.

- **Up** and **Down** move a route one place; your order is saved for that job.
- **Test** asks the route to list its models, which costs nothing, and shows "Answered in ... Healthy" or "No answer in ... Unhealthy". A route with no connection on this device says so.
- **Reset to recommended** appears once you change a job's order and puts the recommended routes back.

A job that uses another job's routes says so and has no Up and Down; change the routes on that job. A note warns when your order puts a paid route ahead of a free one.

### Decision model

The OpenRouter key for judgment calls is a hidden field, labeled with the model it calls, with **Save key** and **Remove key**. Judgment calls use the key on OpenRouter when the desktop and the on-phone model give no answer. It stays on this device, goes only to OpenRouter and is never shown again. With no key, those judgment calls go through your saved OpenRouter connection.

### On-phone model

A row shows whether the on-phone model (Gemma 4 E2B, a 2.0 GB download) is on the phone, downloading (with a percentage) or missing, with Download, Cancel or Delete. It answers judgment calls when the desktop does not. It downloads by itself the first time the phone is on Wi-Fi; Delete frees the space and keeps the download off until you tap Download.

### Desktop

**Desktop setup guide for background memory jobs** opens the guide for setting up your desktop route.

## Model calls and cost

Test makes one request that lists a route's models and calls no model. The jobs listed here are where the extension's background model calls run, each 1 model call per run, and they are metered: a paid route's cost, judgment calls with the key included, counts toward the monthly ceiling in Setup, Connections, Spend. Story outline never uses a paid route. Changing the order runs in code.

## Why it works this way

- The recommended order applies from the start, and this page shows and adjusts it.
- Paid routes run only when no free route answers, within the ceiling.
- A route is checked only when a job needs it, and one that does not answer rests for 10 minutes.
- The on-phone model stays on the phone once downloaded, so judgment calls still answer when the desktop is off.
