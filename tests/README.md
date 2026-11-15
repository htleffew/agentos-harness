# Tests

These scripts drive a local SillyTavern with headless Chrome and a mock model. They are development tools and are
not loaded by the extension.

Setup used for 1.0.0:

1. SillyTavern 1.19.0 cloned to `/tmp/src/st`, started with `node server.js --port 8123`.
2. `node mock.js` (an OpenAI-compatible mock on port 8124; it logs every request to `/tmp/mock-requests.jsonl`).
3. Playwright with Chrome. Paths are set at the top of `h.js` and `lib.js`.
4. `lib.js` copies the extension from `/home/claude/ri/v1` into SillyTavern's `data/default-user/extensions/`.

| Script | Covers |
| --- | --- |
| `t_engine1.js` | Sending, version cycling, the record, check done, overdue, final, stop |
| `t_engine2.js` | Swipe and regenerate repeat, Pick again, all per-reply limits, quiet and impersonate, keep and wait |
| `t_f.js` | Keep and wait timing for six combinations |
| `t_misc.js` | Extension off, automatic new reply, Send again, Undo done, Continue, hold-back while overdue |
| `t_ui2.js` | AI writer, checks, saving, pronouns, What Was Sent, both "under each reply" modes |
| `t_50.js` | 50 replies with a limit of 2: prompt and record match on every reply |
| `t_shots.js` | Screenshots at tablet and phone size |
| `t_import.js` | A lorebook the extension did not write: one note per reply, file left unchanged |
| `t_edit.js` | Deleting messages, branching, editing the newest reply, swiping after a delete |
| `t_events.js` | Story events: every dice rule, swipe repeat, delete rewind, saved text, AI items, example roll |
| `t_style.js` | Writing style: per-category timing, rest, scope line, swipe, delete, overdue instruction, the panel |
| `t_extras.js` | Never together, linger chance, saved settings per chat, Pick again / Lock / Keep on one item, rule checks |
| `t_native.js` | Shows World Info's own timers freezing when it is handed a window of messages (extension off) |

Set `RI_WINDOW=6` to run any script with World Info handed only the last 6 messages. This needs the small test
extension in `tests/ri-window/` copied into SillyTavern's extensions folder.
