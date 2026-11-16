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
| `t_context.js` | What the AI writer is shown (card, scenario, persona, summary, recent messages); who-does-it choices |
| `t_goals.js` | Character goals: steps in any order, action waits, re-sends that never give up, swipe, delete, the panel |
| `t_anywhere.js` | 5.8: the AI writer's rules for each kind of story event list; the current scene left out; the line in the event order; the stakes list; the works-anywhere mark; the rewrite; the panel |
| `t_dice.js` | 5.7: dice and stats in code; lists that retire their items running out at different times; the used-up notice and bringing items back; where an event comes from; hiding what a chapter covers and showing it again; counting the messages in the finished prompt; the new chapter button in What Was Sent |
| `t_close.js` | 5.6: replies still counted when older messages are hidden; what the AI is sent from the chat; notes on "who does it" and "who it happens to"; versions checked against who does it; the story so far for the AI writer |
| `t_pace.js` | 5.5: story event items that wait for a thread, a secret, a plan or people in the scene; big events and the quiet after them; story phases; a character who has gone quiet; what a writing style item adds while it is the pick; the word list; the rules given to the AI writer; the plainer starting lists; the panel |
| `t_chapter.js` | 5.4: a chapter when a scene ends, after a set number of replies and by hand; finished entries moved into the chapter and back on delete; what the request holds; the Log; what is sent; a scene that ends too soon; delete; older chapters combined; older chapters sent when relevant; a new chapter in a new chat (what is carried, the first message, the old chat unchanged, going back, no story world); a starter world from the card; the panel |
| `t_flow.js` | 5.3: the update block is asked for, lifted out and filed with no extra request; names on file, duplicates, your own entries, locked entries, off, out of character; undo on swipe, swipe back, delete, continue and by hand; threads that build; things ordered into the scene, the cap, the check and what happens when they are carried out; the panel |
| `t_world.js` | 5.2: the story world: entries of every kind, who is present (HUD, scene header, "Present:" line, names), the notes block and its order, secrets, the room in tokens, swipe, placement, the extension off, other chats and worlds, moving a world, the Story World tab and its AI writer |
| `t_shared.js` | 5.1: sets kept inside one shared lorebook: per-chat on and off, limits, the cap, events and style, the lorebook attached in World Info, the extension off, moving a set in and out with its timing and records, edits, export, the Settings section |
| `t_v5.js` | 5.0: the cap on new things per reply across sets and the goal, only once per chat, story event items that retire |
| `t_log.js` | 4.1: {{user}} flags that never block, the narrowed check, failure reasons, the retry with more room, the Log tab, the line about {{user}} said once per reply |
| `t_native.js` | Shows World Info's own timers freezing when it is handed a window of messages (extension off) |

Set `RI_WINDOW=6` to run any script with World Info handed only the last 6 messages. This needs the small test
extension in `tests/ri-window/` copied into SillyTavern's extensions folder.
