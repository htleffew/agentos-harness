# Step 0 results

## Desktop SillyTavern 1.19.0 (headless Chrome, mock model), 2026-11-15

| # | Question | Result | What it means for Version 1 |
| --- | --- | --- | --- |
| 1 | Can the extension add entries to a chat and change which entries are sent? | Yes. `WORLDINFO_ENTRIES_LOADED` lets the extension add a lorebook's entries to the current chat. `WORLDINFO_SCAN_DONE` lets it remove entries, add entries and rewrite their text after chance and timing are rolled. The prompt that was sent matched. | Per-chat on/off, per-reply limits, picked versions and re-sends are all done in these two events. No lorebook file is rewritten during play. |
| 2 | Does a swipe roll chance again? | Yes. Every swipe rolls again. | Version 1 replays the same instructions on swipe and regenerate unless "Pick again" is pressed. |
| 3 | Timers on swipe and delete | A swipe clears timers that the swiped reply started ("chat not advanced"). Deleting a reply keeps timers started by it. Timers count messages, not replies: your message and the reply each count as 1. | The panel shows replies and converts: keep sending for N replies is stored as `sticky = 2N + 1`; wait N replies is stored as `cooldown = 2N + 1`, or `2N - 1` when the instruction also keeps sending (World Info starts that wait on the reply where the keeping ends); do not send before reply R is stored as `delay = 2R - 1`. Checked in Version 1 with six keep and wait combinations. |
| 4 | Macros inside macros in World Info | Work. `{{random::{{getvar::x}}::plain}}` gave both values. | Versions are stored as one `{{random::...}}` list with pronoun variables inside, so the lorebook still works with the extension off. |
| 5 | Create, edit, save a lorebook from the extension | Works through `getContext().saveWorldInfo` and `loadWorldInfo`. Custom data on entries and on the lorebook is kept. | Instruction settings are stored inside the lorebook file under `extensions.ri`. |

Quiet requests (summaries, `/gen`) and impersonate do run a World Info scan and can start timers. Version 1 removes
its instructions from those scans, so they carry nothing and use up nothing.

Also: `generateRaw` works on the current connection. It runs SillyTavern's macros over the prompt, so prompts that
must show a placeholder such as `{{char}}` to the model write it as `[[char]]` and convert the answer back. Its JSON schema option depends on the provider, so Version 1 asks
for JSON in plain text and parses it.

Source check: TauriTavern (main, SillyTavern compat 1.19.0) ships the same `world-info.js` events and the same
`getContext()` functions, and stores lorebooks as raw JSON. The tablet run confirms it in practice.

## TauriTavern on Android (TauriTavern 2.4.0, SillyTavern 1.19.0, nano-gpt), 2026-11-15

9 generations (7 messages, 2 swipes) in a chat that already had 43 messages.

| # | Result |
| --- | --- |
| 1 | Pass. Entries were added to the chat, entry A was removed after the scan, entry D was rewritten, and the prompt that was sent matched every time. |
| 2 | Pass. Swipes rolled again. |
| 3 | **Different from desktop.** The wait timer on entry C was set to `start 40, end 44` on every generation while the chat grew from 44 to 57 messages, and C fired every time. World Info was being handed a fixed window of 40 messages, so its message count never advanced and its timers never took effect. |
| 4 | Pass. Both `nested-ok` and `plain` appeared. |
| 5 | Pass. Create, edit, save and read back all worked; custom data was kept. |

Also: every event and `getContext()` function the extension uses is present. `generateRaw` works, with and without
a JSON schema. A lorebook that is both added by the extension and turned on in World Info is sent once.

What changed because of test 3: from 1.1.0 the Roleplay Instructions extension does its own timing, counted in
replies from the records it keeps on each reply. It no longer depends on World Info's sticky, cooldown or delay
while it is on.
