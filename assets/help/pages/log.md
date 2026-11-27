# Request log

Every request the extension made on its own, newest first, with what was sent, what came back and how it ended. Use it when a Write with AI button failed, a check gave an odd answer, or you want to see which route a background task used. The last 120 entries stay on this device; the log does not travel with a chat.

## What it does

- **Copy the log** copies the whole log as text; where the clipboard is unavailable it asks for a download instead.
- **Save the log as a file** downloads it as a text file.
- **Clear the log** asks you to confirm with the count of entries; **Confirm clear** empties it and **Keep the log** cancels. If the log changed while you decided, nothing is cleared.
- **Search request log** filters by what the request was or its result.
- **Request outcome** starts on All outcomes; Completed, Failed and Other narrow the list.

The three buttons are greyed out while the log is empty, and a line says how many logged requests are showing.

Each entry is a fold headed by what the request was, its outcome, the time and the result. Inside are the details (the attempt number when several routes were tried, the connection used, the room given for the answer, and the size of what was sent and what came back), then **What was sent** and **What came back** in full. When the entry belongs to a reply still in the chat, **Review this reply** opens its receipt in [Review, Replies](page:sent).

## Model calls and cost

Nothing on this page calls a model; it lists calls made elsewhere ([how model calls work](help:model-calls)). Each route a background task tries leaves an entry here, so a paid attempt shows here as well as in [Setup, Spend](page:spend).

## Why it works this way

- Each attempt on each route leaves an entry, so a fallback to another route is visible.
- The log keeps the full text sent and received, so a failed request can be read without running it again.
- Clearing asks for a confirmation that names the count, since a cleared log cannot be brought back.
