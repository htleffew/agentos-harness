# Background jobs

Background jobs are the model calls the extension starts around a reply with no tap, plus a few tapped jobs that use the same route chains. [Setup, Background jobs](page:background-jobs) lists each one with the routes it tries in order.

## What it does

Each job belongs to a tier that sets how hard the cloud routes think: Quick (no reasoning), Writer (low) and Cleanup (high). The desktop always answers with reasoning off.

- **Judgment call**: short yes or no items, tried on the desktop and then the on-phone model.
- **Capture**: keeps the story's records after each reply. Stat sheets and Choices use the routes of Capture.
- **Chapter close**: writes a chapter when one closes. Story so far and Story outline use its routes; Story outline drops every paid step, so it never spends.
- **Tidy**: merges records that describe one thing and cleans up entries, on the Cleanup tier.
- **Catch-up map**: reads an older chat in the background so memory can catch up; **Catch-up map, run now** is the same work when you start it.
- **Continue in a new chat**: writes the carry-over for a new chat. Behavior book drafts use its routes.

A job that shares another job's routes says so on its card, and its order is changed on the job it follows.

## Model calls and cost

Each run of a job is one model call on the first route that answers ([how model calls work](help:model-calls)). Paid steps count toward the monthly ceiling in [Setup, Spend](page:spend) and are skipped once it is reached; the job then waits for a free or local route. Test on a route asks it for its list of models, which costs nothing.

## Why it works this way

- Jobs pick their route by themselves with no approval step; the jobs page shows the order and lets you change it.
- The desktop comes first because it is free and keeps your story on your own machines; the NanoGPT plan and free tiers come next, and paid routes last.
- A route that fails is rested for 10 minutes, so a desktop that is off costs at most one short probe.
