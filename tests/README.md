# Tests

These scripts drive a local SillyTavern with headless Chrome and a mock model, or run in node alone. They are development tools and are not loaded by the extension.

## Host setup

1. Install SillyTavern 1.19.0 and start it on a port of your choice (`node server.js --port 8123`). Give it a user with one character.
2. Start the mock model: `node tests/mock.js`. It is the one mock every suite uses. `RI_MOCK_PORT` sets the port (default 8124), `RI_MOCK_LOG` the request log, `RI_MOCK_MODE` the JSON file that steers its answers, and `RI_MOCK_DIR` the folder that holds `mode.txt` ("leaks") and `delay.txt` (milliseconds). `RI_MOCK_MODEL` sets the model id it lists and logs. Every logged row carries a `kind` read from the prompt's task line: `reply`, `capture`, `chapter`, `condensed`, `options`, `draft`, `check`, `writer` or `behavior` (Draft entries for a behavior book, MB12). Restart the mock after you pull changes to `tests/mock.js`: `run_browser.sh` asks the mock for the hash of the file it loaded (`GET /mock/source`) and stops before any suite when it differs from the file on disk.
3. Playwright with Chrome. Set `RI_PLAYWRIGHT` to the path of `playwright-core` (every driver, `h.js` and the two unit drivers `unit/prompts_ui_v8.cjs` and `unit/state_ui.cjs` read it) and `RI_CHROME` to the browser executable. Set `RI_PROFILE` to a Chrome profile folder for the drivers that use a persistent profile.
4. `lib.js` copies the extension into SillyTavern before a suite runs. Set `RI_ST_DIR` to the SillyTavern directory, `RI_EXTENSION_SOURCE` to this checkout and `RI_ST_DATA` to the data root when it is not `RI_ST_DIR/data`. The copy holds `index.js`, `manifest.json`, `style.css`, `src`, `assets`, `presets` and `vendor` (the folder of vendored libraries that MB4 adds).
5. `RI_HOST_URL` points the drivers at the host. The host needs SillyTavern's Summarize extension off or empty.

## Running the suites

- Browser suites: `bash tests/run_browser.sh` runs every suite listed in `tests/browser-suites.txt` in order against one host and prints one line per suite (`PASS name (seconds)` or `FAIL name exit code (seconds) log`). Name suites on the command line to run only those. Before each suite the script restores the host's user folder as it was when the sweep started (`tests/host_reset.cjs`: presets, World Info books, chats and stacks a suite created are deleted) and the saved settings with the extension's own settings removed, so one suite's stored state never reaches the next. Start a sweep from a clean host: SillyTavern's default content plus `presets/Roleplay Instructions V10.json` in `OpenAI Settings`. `RI_SUITE_LOGS` is the folder for the per-suite logs, `RI_SUITE_TIMEOUT` the limit in seconds. The script sets `delay.txt` to 900 for the suites that need a slow answer. Run browser suites one at a time against one mock.
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
| `t_bank_page.js` | browser (`RI_WIDTH`, default 523) | B32 |
| `t_banks.js` | node | B37 |
| `t_behavior_books.js` | node (the section 13 row skips without docs/) | MB12 |
| `t_behavior_books_host.js` | browser (`RI_MB12_TURNS` sets the seeded generations, default 200) | MB12 |
| `t_broken_reply.js` | browser | B53 |
| `t_book_management.js` | browser | legacy |
| `t_capture.js` | node | MB3 |
| `t_carry_over.js` | node | MB9 |
| `t_catchup_host.js` | browser (`RI_WIDTH` and `RI_HEIGHT`, default 390 x 780; sets the mock's `delay.txt` while it runs) | MB9 |
| `t_dialogue_claims.js` | node | MB18 |
| `t_diagnostics_log.js` | browser | B47 |
| `t_chapter.js` | browser | MB6 |
| `t_components.js` | browser | B8 |
| `t_composer_bar.js` | browser | B1 |
| `t_composer_suggestions.js` | browser | B1 |
| `t_context.js` | browser | legacy |
| `t_contextual_writer.js` | browser | legacy |
| `t_delete_direction.js` | browser | legacy |
| `t_decide_bands.js` | node | MB15 |
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
| `t_history_catchup.js` | node | MB9 |
| `t_guided_chat_ownership.js` | browser | legacy |
| `t_guided_quick_acceptance.js` | browser | legacy |
| `t_guided_quick_turns.js` | browser | legacy |
| `t_home_links.js` | browser | B28 |
| `t_import.js` | browser | legacy |
| `t_inline_direction.js` | node | B42 |
| `t_inline_direction_host.js` | browser | B42 |
| `t_scene_markers.js` | node | B50 |
| `t_inject.js` | node (the converter row needs RI_ST_DIR) | MB5 |
| `t_inject_host.js` | browser | MB5 |
| `t_integration.js` | browser | legacy |
| `t_loadouts.js` | node | B12, B57 |
| `t_loadout_gates.js` | browser (`RI_WIDTH`, default 390 x 780, touch): a loadout saved from a stack keeps each card role, position, depth and first reply and sends the stack request at replies 1 to 4; the diagnostics log lists the gated cards with the reply they open at; a pre-B57 loadout sends as saved (request recorder) | B57 |
| `t_log.js` | browser | legacy 4.1.0 |
| `t_memory_import.js` | node | MB2 |
| `t_memory_scenarios.js` | node (skips without docs/) | MB11 |
| `t_memory_ui.js` | browser (`RI_WIDTH` and `RI_HEIGHT`, default 390 x 780) | MB10 |
| `t_memory_followups.js` | browser (`RI_WIDTH` and `RI_HEIGHT`, default 390 x 780) | MB19 |
| `t_memory_store.js` | node (skips without docs/) | MB2 |
| `t_menu_shell.js` | browser | B5 |
| `t_memory_offers.js` | node | FIXOFFERS |
| `t_memory_offers_host.js` | browser | FIXOFFERS |
| `t_meter_steps.js` | node | B40 |
| `t_message_menu.js` | node | B4 |
| `t_message_menu_touch.js` | browser | B4 |
| `t_misc.js` | browser | legacy |
| `t_module_ownership.js` | browser | B39 |
| `t_native.js` | browser | legacy |
| `t_parity_cards.js` | node | B20 |
| `t_pace.js` | browser | legacy 5.5 |
| `t_page_moves.js` | browser | B6 |
| `t_preset_bank.js` | node | B29 |
| `t_preset_bank_ri.js` | node | B31 |
| `t_preset_both.js` | node | B24, B36b |
| `t_preset_checks.js` | node | B33 |
| `t_preset_cleanup.js` | node | B18 |
| `t_preset_conflicts.js` | node | B34 |
| `t_preset_profiles.js` | node | B23 |
| `t_preset_switch.js` | node (skips without docs/) | B12 |
| `t_preset_workspace.js` | browser | B12, B36 |
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
| `t_background_jobs_ui.js` | browser (`RI_WIDTH` and `RI_HEIGHT`, default 390 x 780; set `RI_EVIDENCE` for screenshots) | B55 |
| `t_story_rules.js` | node | B41 |
| `t_import_report.js` | node | B46 |
| `t_import_report_host.js` | browser (390 x 780) | B46 |
| `t_block_gates.js` | browser (`RI_WIDTH`, default 390 x 780, touch): import keeps gate, depth, reply types and role with no report rows; a notBefore 5 block out of replies 1 to 4 (and a swipe of 4) and in from 5; a depth 2 block two chat messages from the end with its role; the card chips; the Placement editor's change reaching the next request; a pre-B56 record and stack sent as before (request recorder) | B56 |
| `t_item_weights.js` | node for the odds; also a browser check at 390 x 780 when `RI_HOST_URL` is set | B51 |
| `t_story_rules_host.js` | browser | B41 |
| `t_story_outline.js` | node (`node --test`), and browser when run with plain `node` and `RI_HOST_URL` set (`RI_WIDTH`, default 390) | B52 |
| `t_story_so_far.js` | node | MB6 |
| `t_tracker_book.js` | node | B21 |
| `t_tracker_book_host.js` | browser | B21 |
| `t_temperament.js` | node | B48 |
| `t_thread_ends.js` | node | B49 |
| `t_tracker_vars.js` | browser | B44 |
| `t_touch_layout.js` | browser | B45 |
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
| `t_integration.js` | A player's pass at 523 × 1021 and 1006 × 909 with touch: NPC options from the bar, Insert, send, the reply tray, menu search, Only RI and All on the Dice lane of Setup, Presets with the supplier read from the stack, folding the bar and a reload. Fails on any page error. |
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
| `t_tracker_book.js` | B21, the Tracker World Info book: entries per enabled card and per present character, Constant at depth 1, size in chat data, swipe, edit, delete and branch rewrites, Theirs and switched-off fields, the disabled first entry and an editor edit replaced, the request guard, no emoji. Runs with `node --test`, no host needed |
| `t_tracker_book_host.js` | B21 at 390 and 1006 with touch (`RI_WIDTH`): capture fills the book, the Story, World Info and Review, Context sections, the host World Info editor and export, the book entries found once in the mock's final request after the recall block, a swipe, an edit, a delete, an editor edit replaced, Theirs, and a branch with its own book. Set `RI_EVIDENCE` for screenshots |
| `t_tracker_vars.js` | B44 at 390 and 1006 (`RI_WIDTH`): the Tracker book's values set as chat variables. Names: `ri_scene_<field>` (place, time, weather, present), `ri_character_<name>_<field>`, `ri_emo_<name>_<field>`, `ri_rel_<pair>_<field>` (for example `ri_rel_aria_and_you_level`), `ri_plan`; name and pair are lower case with `_` between words. A preset block with `{{getvar::ri_scene_place}}` sends the place in the real request; swipe, delete and edit reset the values before the next generation; a field or card that is off clears what it set; no model call (request recorder). Set `RI_EVIDENCE` for tracker-vars-<width>.json |
| `t_story_outline.js` | B52, the long-range story outline. Node rows: the outline job is free-only and every paid step, the phone and a paid Main API drop out of its chain; the run is due every 40 replies and holds back over an edit she keeps or while it waits for a free route; the request carries open threads with their "ends when" lines and leaves paused and closed ones out; the answer makes one line per chapter; the outline sits only in the Director's desk entry, publishes no chat variable and leaves with Theirs. Browser rows (request recorder): Write the outline now opens the Generate sheet and Close makes no call; Generate makes one call on the free Main API with no spend row; the reply request carries the outline once, inside the Director's desk entry, and no background call carries it; her edit reaches the next request; a due run over a kept edit makes no call and with "Rewrites it" reads her text; a failed answer keeps the old outline; a chain of paid routes only waits with no request; Clear takes it out of the book. Set `RI_EVIDENCE` for screenshots and story-outline-<width>.json |
| `t_dialogue_claims.js` | MB18: a spoken claim files as a plain trait or fact with the speaker as source and the line as evidence, about the speaker or anyone else; no "said that" rule in the request; a later contradiction, spoken or narrated, supersedes and Undo restores; lies and secrets use the secret and false-belief records; a feeling stated aloud files no trait; one request per reply. Runs with `node --test`, no host needed |
| `t_memory_offers.js` | FIXOFFERS: in a chat whose memory lives in chat data, capture records offered to story event items (`memoryOffers`): open threads with their ends-when line, paused and done threads left out, secrets kept by someone present, plans (agenda records) of people present, an item that needs a thread filled with its text, a story rule's held item still held, imported entries of today's kinds offered as `worldOffers` reads them, and legacy `worldOffers` unchanged. Runs with `node --test`, no host needed |
| `t_memory_offers_host.js` | FIXOFFERS at 390 and 1006 (`RI_WIDTH`): a memory chat with no Story World book, an open, a paused and a done thread and a kept secret; the item that needs a thread rolls with the open thread text in the request, the secret item waits until the scene lists its holder and then carries the secret, the thread item waits once the thread is done, and each reply makes only the reply and its capture. Set `RI_EVIDENCE` for memory-offers-<width>.json |
| `t_memory_followups.js` | MB19 at 390 with touch: Tidy now, Catch up, Rebuild, Close the chapter here and Write a chapter now open the Generate sheet and Close or Generate behaves as stated (request recorder); "Memory on for this chat" off stops capture and the memory note and keeps the records, on resumes; Clear removes the records and the generated book entries and Undo restores every entry exactly; an Open threads row shows the last quote; no sideways scroll |
| `t_thread_ends.js` | B49: the ends-when line written when a thread opens, asked for by the request and shown beside stored threads, completion with the reply as evidence, pause and resume (a repeated text still files), paused threads left out of the pacing pool (`worldOffers`, `itemFits`), her edit setters, one request per reply. Runs with `node --test`, no host needed |
| `t_temperament.js` | B48: temperament read only on a person's first filing and held between 0.5 and 1.5, steps scaled and clamped for 0.5, 1 and 1.5, per axis and level, no temperament moves at 1, the Emotion record scaled the same, her edit through `setTemperament` sticking through later captures, one request per reply. Runs with `node --test`, no host needed |
| `t_inline_direction_host.js` | B42 at 390 x 780 (send is a tap) and 1006 x 909 (Enter sends), read from the mock log: a `[[OOC: ]]` note is cut from the saved and shown message and rides the request once as a private direction that keeps OOC:, it shows in the Sent card, a swipe sends it again, an edit of the message cannot bring the marker back, a note alone is refused with no request, several notes keep their order, and Off sends the message as typed. Set `RI_EVIDENCE` for screenshots. |
| `t_touch_layout.js` | B45 at 820 x 880, 1040 x 1080 and 1280 x 1200 with touch: the rewritten media lists, every top-bar drawer and the character panel full width with a tap reaching a control in each, one drawer at a time, the composer bar, fold handle, reply tray and menu at the wide sizes, the switch on Look (Off restores the desktop layout at once), resizing and rotating across 1000 px with no reload, and a mouse at 1040 x 1080 matching the switch off. Set `RI_EVIDENCE` for screenshots. |
| `t_wrap_buttons.js` | B42 at 390 x 780 and 1006 x 909 with touch: the three wrap buttons (size, names, icons), the pair at the cursor, a selection wrapped, the cursor after each, no blur on the message box and an input event for SillyTavern, each switch, and press and hold to hide. Set `RI_EVIDENCE` for screenshots. |
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
| `t_parity_cards.js` | B20: the parity cards drawn from a fixture chat of Vexa, Sola, Deus and Pura shaped replies; catalog switches and capture's field list; merged overlaps; the Choices Options call, its moves and its Sent receipt; New faces, stars and severity marks; no emoji or dashes |
| `t_history_catchup.js` | MB9 (memory DESIGN 8.1, 8.2): a 300-exchange chat caught up on a fake queue with a scripted model: call counts per route class (14 to 17 local, 9 mid, 4 or 5 frontier, plus one Cleanup stage), chunks cut at scene boundaries, the exclusion list and state digest in every call after the first, a restart after any part and a save that fails mid-part (no duplicate record), a repeat that files nothing, the five tests of 8.1 for scripted route states (desktop up or down, allowance near 5 percent, a slow route, phone charging or not, the Setup switch off), Cancel and Resume, Rebuild keeping locked and own records and Undo in one tap, the report register |
| `t_carry_over.js` | MB9 (memory DESIGN 8.3): the eight-word run check, the carry-over book (Constant synopsis, one entry per main character, keyword entries, secrets with the fixed holder line, stat sheets with locks, the stamp that names the parent), the parent left byte for byte as it was, one Writer call, no new chat when no route answers |
| `t_catchup_host.js` | MB9 on a real host with the mock: asks first and names the failed test, the Generate sheet before Catch up, the status line, Cancel and Resume, Rebuild and Undo, Continue in a new chat binds a carry-over book that names the parent and shares no eight-word run with it |
| `t_pace.js` | 5.5: story event items that wait for a thread, a secret, a plan or people in the scene; big events and the calm after them; story phases; a character who has gone silent; what a writing style item adds while it is the pick; the word list; the rules given to the AI writer; the plainer starting lists; the panel |
| `t_chapter.js` | 5.4: a chapter when a scene ends, after a set number of replies and by hand; finished entries moved into the chapter and back on delete; what the request holds; the Log; what is sent; a scene that ends too soon; delete; older chapters combined; older chapters sent when relevant; a new chapter in a new chat (what is carried, the first message, the old chat unchanged, going back, no story world); a starter world from the card; the panel |
| `t_shell_followups.js` | B25 at 523 × 1021 and 1006 × 909 with touch: the fold handle takes its own tap open and folded, moving clear of SillyTavern's own controls where they cover it, the menu stays on a cross-linked page across a chat change, and a restored built-in quick action survives a reload straight after it. |
| `t_shared.js` | 5.1: sets kept inside one shared lorebook: per-chat on and off, limits, the cap, events and style, the lorebook attached in World Info, the extension off, moving a set in and out with its timing and records, edits, export, the Settings section |
| `t_v5.js` | 5.0: the cap on new things per reply across sets and the goal, only once per chat, story event items that retire |
| `t_log.js` | 4.1: {{user}} flags that never block, the narrowed check, failure reasons, the retry with more room, the Log tab, the line about {{user}} said once per reply |
| `t_native.js` | Shows World Info's own timers freezing when it is handed a window of messages (extension off) |
| `t_module_ownership.js` | B39, reworked in B36b: the relationships module with a stored Theirs, Ours or Both (no effect since the switch retired), read from the reply and capture requests in the mock log. The preset's block stays in the reply; the reply carries no filing rule or update block (MB3); capture asks the Relationships fields; the module switched off removes the fields and leaves the preset's block. Each reply has its own wording, because two identical replies in the same minute share a capture mark. |
| `t_world_notes.js` | B39: the story notes block in the reply request under the smallest room (100 tokens: the person in the scene in short form, the entries within about 400 characters) and under each placement (depth 4, after the card with the lorebook entries, before the card). It finds the block by its opening text and position, named once at the top; MB5 retires the depth-4 block, and the ticket that follows updates those names. |

Set `RI_WINDOW=6` to run any script with World Info handed only the last 6 messages. This needs the small test
extension in `tests/ri-window/` copied into SillyTavern's extensions folder.
