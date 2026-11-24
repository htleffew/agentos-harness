# Tests

These scripts drive a local SillyTavern with headless Chrome and a mock model, or run in node alone. They are development tools and are not loaded by the extension.

## Host setup

1. Install SillyTavern 1.19.0 and start it on a port of your choice (`node server.js --port 8123`). Give it a user with one character.
2. Start the mock model: `node tests/mock.js`. It is the one mock every suite uses. `RI_MOCK_PORT` sets the port (default 8124), `RI_MOCK_LOG` the request log, `RI_MOCK_MODE` the JSON file that steers its answers, and `RI_MOCK_DIR` the folder that holds `mode.txt` ("leaks") and `delay.txt` (milliseconds). `RI_MOCK_MODEL` sets the model id it lists and logs. Every logged row carries a `kind` read from the prompt's task line: `reply`, `capture`, `chapter`, `condensed`, `options`, `draft`, `check` or `writer`. Restart the mock after you pull changes to `tests/mock.js`.
3. Playwright with Chrome. Set `RI_PLAYWRIGHT` to the path of `playwright-core` (every driver, `h.js` and the two unit drivers `unit/prompts_ui_v8.cjs` and `unit/state_ui.cjs` read it) and `RI_CHROME` to the browser executable. Set `RI_PROFILE` to a Chrome profile folder for the drivers that use a persistent profile.
4. `lib.js` copies the extension into SillyTavern before a suite runs. Set `RI_ST_DIR` to the SillyTavern directory, `RI_EXTENSION_SOURCE` to this checkout and `RI_ST_DATA` to the data root when it is not `RI_ST_DIR/data`. The copy holds `index.js`, `manifest.json`, `style.css`, `src`, `assets`, `presets` and `vendor` (the folder of vendored libraries that MB4 adds).
5. `RI_HOST_URL` points the drivers at the host. The host needs SillyTavern's Summarize extension off or empty, and `t_shell_followups.js` needs the Pathweaver extension enabled.

## Running the suites

- Browser suites: `bash tests/run_browser.sh` runs every suite listed in `tests/browser-suites.txt` in order against one host and prints one line per suite (`PASS name (seconds)` or `FAIL name exit code (seconds) log`). Name suites on the command line to run only those. Before each suite the script restores the host's saved settings (the extension's own settings removed), so one suite's stored state never reaches the next. `RI_SUITE_LOGS` is the folder for the per-suite logs, `RI_SUITE_TIMEOUT` the limit in seconds. The script sets `delay.txt` to 900 for the suites that need a slow answer. Run browser suites one at a time against one mock.
- Node suites: `node --test tests/unit/*.mjs` and `node --test tests/t_routing.js tests/t_reply_tray.js tests/t_scene_header.js tests/t_message_menu.js` and the other node rows below. They need no host.
- A suite counts the requests it made itself. `L.requests()` in `lib.js` leaves out the background memory calls that follow each reply (`capture`, `chapter`, `condensed`); pass a kind, a list of kinds or `'all'` to read others.
- `t_memory_store.js`, `t_memory_import.js` and `t_generated_books.js` write their evidence JSON only when `RI_WRITE_EVIDENCE` is set.
- Suites that read fixtures from `docs/ux-overhaul` (`t_generated_books.js`, `t_memory_store.js`, `t_memory_scenarios.js`, `t_preset_switch.js`, `t_reply_cards.js`) print one SKIP line and pass when `docs/` is missing, because a release ships `tests/` without `docs/`. Browser suites write screenshots into `docs/ux-overhaul` only when `RI_EVIDENCE` is unset, so set `RI_EVIDENCE` on a machine without `docs/`.

## Every suite

| Script | Runner | Ticket |
| --- | --- | --- |
| `t_50.js` | browser | legacy |
| `t_anywhere.js` | browser | legacy 5.8 |
| `t_bank_import.js` | node | B37 |
| `t_bank_ui.js` | browser | B37 |
| `t_banks.js` | node | B37 |
| `t_book_management.js` | browser | legacy |
| `t_capture.js` | node | MB3 |
| `t_chapter.js` | browser | MB6 |
| `t_components.js` | browser | B8 |
| `t_composer_bar.js` | browser | B1 |
| `t_composer_suggestions.js` | browser | B1 |
| `t_context.js` | browser | legacy |
| `t_contextual_writer.js` | browser | legacy |
| `t_delete_direction.js` | browser | legacy |
| `t_dice.js` | browser | legacy 5.7 |
| `t_edit.js` | browser | legacy |
| `t_engine1.js` | browser | legacy |
| `t_engine2.js` | browser | legacy |
| `t_events.js` | browser | legacy |
| `t_execution_defaults.js` | node | B38 |
| `t_execution_run.js` | node | B38 |
| `t_extension_ui_audit.js` | browser | legacy |
| `t_extension_ux.js` | browser | B1 |
| `t_extension_ux_editors.js` | browser | legacy |
| `t_extension_ux_performance.js` | browser | legacy |
| `t_extras.js` | browser | legacy |
| `t_f.js` | browser | legacy |
| `t_followups_b26.js` | node | B26 |
| `t_generated_books.js` | node (skips without docs/) | MB13 |
| `t_goals.js` | browser | legacy |
| `t_guided_chat_ownership.js` | browser | legacy |
| `t_guided_quick_acceptance.js` | browser | legacy |
| `t_guided_quick_turns.js` | browser | legacy |
| `t_home_links.js` | browser | B28 |
| `t_import.js` | browser | legacy |
| `t_inject.js` | node (the converter row needs RI_ST_DIR) | MB5 |
| `t_inject_host.js` | browser | MB5 |
| `t_integration.js` | browser | legacy |
| `t_loadouts.js` | node | B12 |
| `t_log.js` | browser | legacy 4.1.0 |
| `t_memory_import.js` | node | MB2 |
| `t_memory_scenarios.js` | node (skips without docs/) | MB11 |
| `t_memory_store.js` | node (skips without docs/) | MB2 |
| `t_menu_shell.js` | browser | B5 |
| `t_message_menu.js` | node | B4 |
| `t_message_menu_touch.js` | browser | B4 |
| `t_misc.js` | browser | legacy |
| `t_module_ownership.js` | browser | B39 |
| `t_native.js` | browser | legacy |
| `t_pace.js` | browser | legacy 5.5 |
| `t_page_moves.js` | browser | B6 |
| `t_preset_bank.js` | node | B29 |
| `t_preset_bank_ri.js` | node | B31 |
| `t_preset_both.js` | node | B24 |
| `t_preset_checks.js` | node | B33 |
| `t_preset_cleanup.js` | node | B18 |
| `t_preset_conflicts.js` | node | B34 |
| `t_preset_profiles.js` | node | B23 |
| `t_preset_switch.js` | node (skips without docs/) | B12 |
| `t_preset_workspace.js` | browser | B12 |
| `t_prompts_home.js` | browser | B9 |
| `t_queue.js` | node | MB8 |
| `t_quick_action_setup.js` | browser | B3 |
| `t_quick_queue_failures.js` | browser | legacy |
| `t_reply_cards.js` | node (skips without docs/) | B11 |
| `t_reply_tray.js` | node | B10 |
| `t_results_sheet.js` | browser | B2 |
| `t_reusable_books.js` | browser | legacy |
| `t_ri_cards.js` | browser | B31 |
| `t_routing.js` | node | MB1 |
| `t_scene_header.js` | node | B10 |
| `t_search.js` | node (real-model rows need RI_TRANSFORMERS_NODE) | MB4 |
| `t_search_host.js` | browser | MB4 |
| `t_shared.js` | browser | legacy 5.1 |
| `t_shell_followups.js` | browser | B25 |
| `t_shots.js` | browser | legacy |
| `t_spend_ceiling.js` | node | B19 |
| `t_story_so_far.js` | node | MB6 |
| `t_upkeep.js` | node (fixture tests skip without docs/) | MB7 |
| `t_upkeep_browser.js` | browser | MB7 |
| `t_style.js` | browser | legacy |
| `t_ui2.js` | browser | legacy |
| `t_v10.js` | browser | legacy |
| `t_v5.js` | browser | legacy 5.0 |
| `t_world_notes.js` | browser | B39 |
| `unit\branch_failure.mjs` | node | legacy |
| `unit\companion_preset.mjs` | node | B15 |
| `unit\components_css.mjs` | node | B8 |
| `unit\composer_bar.mjs` | node | legacy |
| `unit\context_v9.mjs` | node | legacy |
| `unit\dialogue.mjs` | node | legacy |
| `unit\event_limits.mjs` | node | legacy |
| `unit\fa_icons.mjs` | node | legacy 5.2 |
| `unit\guided_turns.mjs` | node | legacy |
| `unit\guided_v7.mjs` | node | legacy |
| `unit\history_batches.mjs` | node | legacy |
| `unit\menu_shell.mjs` | node | B5 |
| `unit\no_emoji.mjs` | node | legacy |
| `unit\preset_workbench.mjs` | node | legacy |
| `unit\prompts_v8.mjs` | node | legacy |
| `unit\prose_diagnostics.mjs` | node | legacy |
| `unit\quick_action_chat.mjs` | node | legacy |
| `unit\quick_action_execution.mjs` | node | legacy |
| `unit\quick_action_library.mjs` | node | legacy |
| `unit\quick_action_setup.mjs` | node | legacy |
| `unit\recall.mjs` | node | legacy |
| `unit\records_adapter.mjs` | node | B6 |
| `unit\reply_format.mjs` | node | legacy |
| `unit\results_sheet.mjs` | node | B2 |
| `unit\staged_memory.mjs` | node | legacy |
| `unit\state.mjs` | node | legacy |
| `unit\state_history.mjs` | node | legacy |
| `unit\state_parse.mjs` | node | legacy |
| `unit\story-clock.mjs` | node | legacy |
| `unit\story_recall_budget.mjs` | node | legacy |
| `unit\stream_update.mjs` | node | legacy |
| `unit\tokens_contrast.mjs` | node | legacy |
| `unit\ux_destinations.mjs` | node | legacy |
| `unit\v10_continuity.mjs` | node | legacy |
| `unit\world_rollback.mjs` | node | legacy |
| `unit\prompts_ui_v8.cjs` | browser | legacy |
| `unit\state_ui.cjs` | browser | legacy |

## What each older suite covers

The rows below describe the suites by behavior. Navigation in the older browser suites goes through `L.openPanel(page, id)` and `L.goTab(page, top, nested)` (the shell routes), `L.openMenuEntry` and `L.openReplyAction` (the message menu and the reply sheet), `L.openQuickActions` (the bar's More menu), `L.addSet` (the one Add set form) and `L.createSavedAction`.

| Script | Covers |
| --- | --- |
| `t_integration.js` | A player's pass at 523 × 1021 and 1006 × 909 with touch: NPC options from the bar, Insert, send, the reply tray, menu search, a switch on Setup, Presets, folding the bar and a reload. Fails on any page error. |
| `t_message_menu.js`, `t_message_menu_touch.js` | B4: which messages get the two message menu entries (node test), then a 200-message chat at 523 × 1021 and 1006 × 909 with touch: no card under any reply, both entries opened through SillyTavern's menu with the reply selected, and the Sent card with execution details and directions. Set `RI_EVIDENCE` for screenshots. |
| `t_extension_ux.js` | Touch at 390 × 475: older reply actions, exact historical receipts and corrections, and per-chat draft recovery. Set `RI_UX_PRESET` to activate the companion and `RI_UX_CAPTURE` to save observations. |
| `t_extension_ux_editors.js` | Touch at 320 × 475, no-chat defaults, failed and cancelled openings, goal reordering, structured fact search, speaker colors, and count-confirmed log clearing. Includes grayscale, reduced motion and keyboard disclosure. Set `RI_UX_CAPTURE` to save observations. |
| `t_extension_ux_performance.js` | Seven warmed samples and actual request count for the local sheet, page navigation, task finder and 160-action library filter. |
| `t_quick_queue_failures.js` | Disconnected local authoring and touch-safe draft preservation for disabled and lost sources, malformed macros and missing host hooks. Set `RI_QUEUE_CAPTURE` to save the trace. |
| `t_guided_quick_turns.js` | Request captures for native and direct player drafting, swipe, continuation, historical versions and retained Text Completion history. Set `RI_GUIDED_PRESET` to select a preset installed on the isolated host and `RI_GUIDED_CAPTURE` to save the request bodies and receipts. |
| `t_guided_quick_acceptance.js` | Historical scope and explicit lore sources, the six player templates, damaged choice recovery, CYOA editing and expansion, and the four Fresh start paths after switching presets. Install Default and the companion preset in the isolated host first. `RI_GUIDED_PRESET` selects the destination preset and `RI_GUIDED_CAPTURE` saves the requests and observed state. |
| `t_guided_chat_ownership.js` | Delayed drafts and native cancellation across chat switches, exact native Undo, stale historical edit protection, and five-reply countdown isolation and Stop. It uses the same `RI_GUIDED_PRESET` and `RI_GUIDED_CAPTURE` settings. |
| `t_extension_ui_audit.js` | Every page of every nested tab, sideways overflow and reachable disclosures at each width, the power switch and Escape. Use `RI_PANEL_WIDTHS=320,390 RI_PANEL_HEIGHT=475` for the reduced phone areas and `RI_PANEL_TEXT_SCALE=2` for the enlarged-text pass. |
| `unit/prompts_v8.mjs` and `unit/prompts_ui_v8.cjs` | Prompt validation, protected placeholders, save, restore, persistence and feature-local editor behavior |
| `t_preset_bank_ri.js` | B31: one RI card per feature with the shipped default, her saved wording as a version equal to the stored prompt text, the stack reading (clean, wording, both, neither), the order of the RI group and the one-time read of the old module order, the owners, and the companion as a source and as a base. Runs with `node --test`, no host needed |
| `t_ri_cards.js` | B31 on a host: the order of the RI cards in the stack is the order of the guidance in the request the mock logged, the old module order is read once with every card still on, and the request carries the clean wording, her saved wording, both (clean first) or neither as the stack says |
| `t_inject_host.js` | MB5 at 523 x 1021 and 1006 x 909 with touch: the request layout in the payload the mock logged (memory notes in the prefix, the chapter view above the history, the recall block at depth 1, the reminder at depth 0, no story notes), two consecutive requests compared, Story state and Dice on Theirs, a Tracker book card, the three upkeep exclusions, and a 4,095-token context with the red mark and Review, Context. Set `RI_EVIDENCE` for screenshots. |
| `t_reply_cards.js` | The card catalog against the DESIGN.md 6.2 and 6.3 tables, defaults, switches and the capture field list, the shared templates, carried values and the card builder. Runs with `node --test`, no host needed |
| `unit/context_v9.mjs` | Text estimates, partial matching, non-text handling and chat isolation |
| `t_engine1.js` | Sending, version cycling, the record, check done, overdue, final, stop |
| `t_engine2.js` | Swipe and regenerate repeat, Pick again, all per-reply limits, background and impersonate generations, keep and wait |
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
| `t_pace.js` | 5.5: story event items that wait for a thread, a secret, a plan or people in the scene; big events and the calm after them; story phases; a character who has gone silent; what a writing style item adds while it is the pick; the word list; the rules given to the AI writer; the plainer starting lists; the panel |
| `t_chapter.js` | 5.4: a chapter when a scene ends, after a set number of replies and by hand; finished entries moved into the chapter and back on delete; what the request holds; the Log; what is sent; a scene that ends too soon; delete; older chapters combined; older chapters sent when relevant; a new chapter in a new chat (what is carried, the first message, the old chat unchanged, going back, no story world); a starter world from the card; the panel |
| `t_shell_followups.js` | B25 at 523 × 1021 and 1006 × 909 with touch, with Pathweaver enabled on the host: the fold handle and Pathweaver's handle each take their own tap in all four open and folded combinations, the menu stays on a cross-linked page across a chat change, and a restored built-in quick action survives a reload straight after it. |
| `t_shared.js` | 5.1: sets kept inside one shared lorebook: per-chat on and off, limits, the cap, events and style, the lorebook attached in World Info, the extension off, moving a set in and out with its timing and records, edits, export, the Settings section |
| `t_v5.js` | 5.0: the cap on new things per reply across sets and the goal, only once per chat, story event items that retire |
| `t_log.js` | 4.1: {{user}} flags that never block, the narrowed check, failure reasons, the retry with more room, the Log tab, the line about {{user}} said once per reply |
| `t_native.js` | Shows World Info's own timers freezing when it is handed a window of messages (extension off) |
| `t_module_ownership.js` | B39: the relationships module on Theirs, Ours and Both, read from the reply and capture requests in the mock log. The preset's block follows the switch in the reply; the reply carries no filing rule or update block (MB3); capture asks the Relationships fields on Ours and Both and none on Theirs; the module switched off removes both. Each reply has its own wording, because two identical replies in the same minute share a capture mark. |
| `t_world_notes.js` | B39: the story notes block in the reply request under the smallest room (100 tokens: the person in the scene in short form, the entries within about 400 characters) and under each placement (depth 4, after the card with the lorebook entries, before the card). It finds the block by its opening text and position, named once at the top; MB5 retires the depth-4 block, and the ticket that follows updates those names. |

Set `RI_WINDOW=6` to run any script with World Info handed only the last 6 messages. This needs the small test
extension in `tests/ri-window/` copied into SillyTavern's extensions folder.
