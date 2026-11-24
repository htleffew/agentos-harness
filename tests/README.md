# Tests

These scripts drive a local SillyTavern with headless Chrome and a mock model. They are development tools and are
not loaded by the extension.

Setup used for 1.0.0:

1. SillyTavern 1.19.0 cloned to `/tmp/src/st`, started with `node server.js --port 8123`.
2. `node mock.js` (an OpenAI-compatible mock on port 8124; it logs every request to `/tmp/mock-requests.jsonl`).
3. Playwright with Chrome. Paths are set at the top of `h.js` and `lib.js`.
4. `lib.js` copies the extension into SillyTavern. Set `RI_ST_DIR` to the SillyTavern directory, `RI_EXTENSION_SOURCE` to this checkout, and `RI_CHROME` to the browser executable to override the legacy paths.
5. Run `node tests/t_guided_v7.js`, `node tests/t_v6.js` and `node tests/t_history_v6.js` for the v6 host integrations; run `node tests/unit/state.mjs`, `node tests/unit/state_history.mjs`, `node tests/unit/state_parse.mjs`, `node tests/unit/event_limits.mjs`, `node tests/unit/state_ui.cjs`, `node tests/unit/branch_failure.mjs`, `node tests/unit/world_rollback.mjs`, and `node tests/unit/guided_v7.mjs` for focused tests.

Use `RI_PANEL_WIDTHS=523` to focus the broad panel audit on the mobile layout. Its default also visits all pages at 1006 px. Use `RI_HOST_URL` to point Playwright at an isolated SillyTavern instance. Set `RI_ST_DATA` to that instance’s data root when it differs from `RI_ST_DIR/data`. To run isolated host and recorder pairs, give the test and recorder processes the same `RI_MOCK_PORT`, `RI_MOCK_LOG`, and `RI_MOCK_MODE` and use distinct values for each pair. Run browser suites that use the same mock one at a time. The correction and navigation audits click the extension from the host's Extensions drawer. They cover the visible routes and controls for their fixtures. For a release, also run the populated workflow tests and have a reviewer try the extension without setup instructions. Keep physical TauriTavern devices and live model connections separate from results obtained with Chromium emulation and the mock.

Run `t_execution_routes.js` on a separate host fixture with SillyTavern’s bundled Connection Manager enabled alongside Roleplay Instructions. Start two copies of `tests/mock.js`. Set `RI_MOCK_MODEL=mock-model` for the main recorder and `RI_MOCK_MODEL=mock-alternate` for the alternate. Give the test the main recorder variables and set `RI_ALT_MOCK_PORT`, `RI_ALT_MOCK_MODE`, and `RI_ALT_MOCK_LOG` to the alternate recorder’s values. `RI_EXECUTION_CAPTURE` optionally saves the inspected receipt and request excerpts. Retain a separate single-extension fixture for feature verification.

| Script | Covers |
| --- | --- |
| `t_integration.js` | A player's pass at 523 × 1021 and 1006 × 909 with touch: NPC options from the bar, Insert, send, the reply tray, menu search, a switch on Setup, Presets, folding the bar and a reload. Fails on any page error. |
| `t_extension_ux.js` | Touch at 390 × 475: older reply actions, exact historical receipts and corrections, and per-chat draft recovery. Set `RI_UX_PRESET` to activate the companion and `RI_UX_CAPTURE` to save observations. |
| `t_extension_ux_editors.js` | Touch at 320 × 475, no-chat defaults, failed and cancelled openings, goal reordering, structured fact search, speaker colors, and count-confirmed log clearing. Includes grayscale, reduced motion and keyboard disclosure. Set `RI_UX_CAPTURE` to save observations. |
| `t_fantasy_calendar.js` | Touch scene editing, invalid-day feedback, month and year rollover, legacy tracker parsing, header reflow and outgoing calendar context at 320 × 475. Set `RI_CALENDAR_PRESET` for the companion and `RI_CALENDAR_CAPTURE` to save observations. |
| `t_extension_ux_performance.js` | Seven warmed samples and actual request count for the local sheet, page navigation, task finder and 160-action library filter. |
| `t_quick_actions.js` | Emulated phone taps, queue editing and binding, candidate recovery after reload, retries and rolls, Fresh start expiry, and native continuation Undo. Also run with `RI_COMPANION_FIXTURE=1` to import and activate the companion. Set `RI_EVIDENCE` to record the results. |
| `t_quick_queue_events.js` | Both queued destinations in a real Text Completion prompt, offline-safe snapshot delivery, retry with a new composer draft, required event evidence, swipe rollback, fact repair and memory entry. Set `RI_QUEUE_PRESET` to use an installed companion preset and `RI_QUEUE_CAPTURE` to save the requests and state. |
| `t_quick_queue_failures.js` | Disconnected local authoring and touch-safe draft preservation for disabled and lost sources, malformed macros and missing host hooks. Set `RI_QUEUE_CAPTURE` to save the trace. |
| `t_guided_quick_turns.js` | Request captures for native and direct player drafting, swipe, continuation, historical versions and retained Text Completion history. Set `RI_GUIDED_PRESET` to select a preset installed on the isolated host and `RI_GUIDED_CAPTURE` to save the request bodies and receipts. |
| `t_guided_quick_group.js` | Phone-width solo and group swipes with one plausible respondent, multiple NPCs, a plausible arrival and an explicitly directed speaker. Each swipe includes the current scene and five earlier replies in one native request. A delayed native group continuation also checks the originating composer text and selection after switching chats. |
| `t_guided_quick_acceptance.js` | Historical scope and explicit lore sources, the six player templates, damaged choice recovery, CYOA editing and expansion, and the four Fresh start paths after switching presets. Install Default and the companion preset in the isolated host first. `RI_GUIDED_PRESET` selects the destination preset and `RI_GUIDED_CAPTURE` saves the requests and observed state. |
| `t_guided_chat_ownership.js` | Delayed drafts and native cancellation across chat switches, exact native Undo, stale historical edit protection, and five-reply countdown isolation and Stop. It uses the same `RI_GUIDED_PRESET` and `RI_GUIDED_CAPTURE` settings. |
| `t_quick_action_catalog.js` | Emulated phone library edit, variation, restore, reorder, recover, import and export, 23-entry translated Keel fixture, and local source selection. |
| `t_quick_action_catalog_acceptance.js` | Standalone actions in all four menus, scoped draws, a 160-button fixture, and single-item and layout recovery. |
| `t_historical_memory.js` | Older targeted replacement, visible downstream uncertainty and filed fact repair on a touch-emulated host. |
| `t_staged_memory.js` | A real host and recorder verify the six-slot memory window and the first 20-reply summary at accepted reply 26. |
| `t_editable_memory_reload.js` | Ordinary replies, swipes, continuation, CYOA and editing through the seven-reply filing boundary and reload. |
| `t_dependent_recent_memory.js` | Touch edit of an earlier fact, dependent card uncertainty, actual next-request recall and survival of an independent manual lock. |
| `t_fact_repair_guided.js` | Local and combined repair, failed swipe and explicit retry, selected swipe effects, Undo and legacy books. |
| `t_chapter_executions.js` | Count, scene and token thresholds, independent chapter combining, and recoverable batch receipts. |
| `t_prompt_variations.js` | Writer and native preset variations through reload, neighbor preservation, original and utility restore sources, and custom voice transfer at a reduced phone viewport. Editor changes make zero requests. A subsequent ordinary reply uses the imported voice. Set `RI_VARIATION_CAPTURE` to save the observations. |
| `t_execution_routes.js` | Native stream interruption and explicit retry, empty response, two impersonation presets, actual named profile routing across reload and chat switch, Main API route changes, and manual and automatic check behavior when an alternate profile is unavailable. |
| `t_prose_diagnostics.js` | Same-reply evidence, historical swipe and edit, and one-use prompt guidance. |
| `t_companion_controls.js` | Import the companion JSON in the host file chooser, inspect all 16 writing and check blocks, toggle each and compare the assembled provider requests |
| `t_extension_ui_audit.js` | Every page of every nested tab, sideways overflow and reachable disclosures at each width, the power switch and Escape. Use `RI_PANEL_WIDTHS=320,390 RI_PANEL_HEIGHT=475` for the reduced phone areas and `RI_PANEL_TEXT_SCALE=2` for the enlarged-text pass. |
| `t_correction_ui.js` | Phone-width source search and manual edits, optional one-click AI source repairs, default guided generation, existing swipes, failed generation and retry |
| `unit/prompts_v8.mjs` and `unit/prompts_ui_v8.cjs` | Prompt validation, protected placeholders, save, restore, persistence and feature-local editor behavior |
| `t_reply_cards.js` | Independent reply cards, snapshot editing, visibility settings and responsive layout |
| `t_context_v9.js` | Real-host request breakdown, context controls, persistence and no extra requests |
| `t_gap_closure.js` | Phone-width book navigation, optional keyword suggestions, role-scoped managed recall, sticky and cooldown timing, token-triggered chapters, and restoring protected history without another model request |
| `t_memory_v9.js` | Chapter timing, hiding covered history, preserving recent messages and including the summary |
| `unit/context_v9.mjs` | Text estimates, partial matching, non-text handling and chat isolation |
| `t_prompts_v8.js` | Custom instructions in real chat, guided swipes and AI writer requests; persistence and independent restore |
| `t_guided_v7.js` | Guided replacement prompt, rollback, one-turn direction, saved swipes and optional order repeat |
| `t_history_v6.js` | Deep branches, fresh branch books, bulk deletion, edited replies and reviewed rebuild |
| `t_v6.js` | Real host: parse a response, send protected state, swipe, reload and save a lasting fact to Story World |
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
| `t_scene.js` | 5.10: the scene lines asked for with and without a story world; kept on the reply and taken out of its text; the scene card and when it is hidden; people present but unnamed still get their entry; event conditions counting from the lines; out of character; off |
| `t_branch.js` | 5.9: a branch gets its own copy of the story world (own lorebook and shared lorebook); what the branch files and undoes stays in the copy; no second copy; the setting off; a new chapter is not copied |
| `t_anywhere.js` | 5.8: the AI writer's rules for each kind of story event list; the current scene left out; the line in the event order; the stakes list; the works-anywhere mark; the rewrite; the panel |
| `t_dice.js` | 5.7: dice and stats in code; lists that retire their items running out at different times; the used-up notice and bringing items back; where an event comes from; hiding what a chapter covers and showing it again; counting the messages in the finished prompt; the new chapter button in What Was Sent |
| `t_close.js` | 5.6: replies still counted when older messages are hidden; what the AI is sent from the chat; notes on "who does it" and "who it happens to"; versions checked against who does it; the story so far for the AI writer |
| `t_pace.js` | 5.5: story event items that wait for a thread, a secret, a plan or people in the scene; big events and the calm after them; story phases; a character who has gone silent; what a writing style item adds while it is the pick; the word list; the rules given to the AI writer; the plainer starting lists; the panel |
| `t_chapter.js` | 5.4: a chapter when a scene ends, after a set number of replies and by hand; finished entries moved into the chapter and back on delete; what the request holds; the Log; what is sent; a scene that ends too soon; delete; older chapters combined; older chapters sent when relevant; a new chapter in a new chat (what is carried, the first message, the old chat unchanged, going back, no story world); a starter world from the card; the panel |
| `t_flow.js` | 5.3: the update block is asked for, lifted out and filed with no extra request; names on file, duplicates, your own entries, locked entries, off, out of character; undo on swipe, swipe back, delete, continue and by hand; threads that build; things ordered into the scene, the cap, the check and what happens when they are carried out; the panel |
| `t_world.js` | 5.2: the story world: entries of every kind, who is present (HUD, scene header, "Present:" line, names), the notes block and its order, secrets, the room in tokens, swipe, placement, the extension off, other chats and worlds, moving a world, the Story World tab and its AI writer |
| `t_shared.js` | 5.1: sets kept inside one shared lorebook: per-chat on and off, limits, the cap, events and style, the lorebook attached in World Info, the extension off, moving a set in and out with its timing and records, edits, export, the Settings section |
| `t_v5.js` | 5.0: the cap on new things per reply across sets and the goal, only once per chat, story event items that retire |
| `t_log.js` | 4.1: {{user}} flags that never block, the narrowed check, failure reasons, the retry with more room, the Log tab, the line about {{user}} said once per reply |
| `t_native.js` | Shows World Info's own timers freezing when it is handed a window of messages (extension off) |

Set `RI_WINDOW=6` to run any script with World Info handed only the last 6 messages. This needs the small test
extension in `tests/ri-window/` copied into SillyTavern's extensions folder.
