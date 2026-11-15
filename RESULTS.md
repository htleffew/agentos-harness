# Step 0 results

## Desktop SillyTavern 1.19.0 (headless Chrome, mock model), 2026-11-15

| # | Question | Result | What it means for Version 1 |
| --- | --- | --- | --- |
| 1 | Can the extension add entries to a chat and change which entries are sent? | Yes. `WORLDINFO_ENTRIES_LOADED` lets the extension add a lorebook's entries to the current chat. `WORLDINFO_SCAN_DONE` lets it remove entries, add entries and rewrite their text after chance and timing are rolled. The prompt that was sent matched. | Per-chat on/off, per-reply limits, picked versions and re-sends are all done in these two events. No lorebook file is rewritten during play. |
| 2 | Does a swipe roll chance again? | Yes. Every swipe rolls again. | Version 1 replays the same instructions on swipe and regenerate unless "Pick again" is pressed. |
| 3 | Timers on swipe and delete | A swipe clears timers that the swiped reply started ("chat not advanced"). Deleting a reply keeps timers started by it. Timers count messages, not replies: your message and the reply each count as 1. | The panel shows replies and converts: keep sending for N replies is stored as `sticky = 2N + 1`; wait N replies is stored as `cooldown = 2N + 1`; do not send before reply R is stored as `delay = 2R - 1`. |
| 4 | Macros inside macros in World Info | Work. `{{random::{{getvar::x}}::plain}}` gave both values. | Versions are stored as one `{{random::...}}` list with pronoun variables inside, so the lorebook still works with the extension off. |
| 5 | Create, edit, save a lorebook from the extension | Works through `getContext().saveWorldInfo` and `loadWorldInfo`. Custom data on entries and on the lorebook is kept. | Instruction settings are stored inside the lorebook file under `extensions.ri`. |

Also: `generateRaw` works on the current connection. Its JSON schema option depends on the provider, so Version 1 asks
for JSON in plain text and parses it.

Source check: TauriTavern (main, SillyTavern compat 1.19.0) ships the same `world-info.js` events and the same
`getContext()` functions, and stores lorebooks as raw JSON. The tablet run confirms it in practice.

## TauriTavern on Android

Pending: paste the copied log here as `results/tauritavern-android.txt`.
