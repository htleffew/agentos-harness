# Roleplay Instructions companion preset and extension audit

**November 21, 2026.** Tested the companion JSON and extension on branch `roleplay-instructions-v10`, starting at `984f9f4` (extension 10.0.27). Repairs from this audit ship in extension **10.0.28**. The companion JSON has the same SHA-256 before and after the audit, `11882e01b564bf69a69fec3b32d5df08ab7ad485877f403b615af4c89b68f7dc`.

We imported the JSON through SillyTavern’s own file chooser, operated the Prompt Manager, sent chat turns and inspected the requests at the receiving endpoint. The extension review covered all five navigation groups, all 22 pages, both module-setting scopes, populated editors, reply cards and recovery paths. A first-time reviewer started with an empty host profile and discovered the setup and recall workflows from the interface. A second review exercised event, instruction and style editors in a populated phone-width chat. [Cold review](audit-evidence-10.0.27/cold-review.md) · [Populated Direction review](audit-evidence-10.0.27/direction-review.md)

## What the preset actually sent

The companion contains 25 ordered rows. Nine belong to the host and 16 carry the companion’s writing or checking instructions. Two complementary experiments isolated their effects.

| Host row | Exact observation in the baseline request |
| --- | --- |
| Main | The shipped main instruction arrived with Orla and Neri substituted for the character and user macros. |
| World Info (before) | The dedicated before-entry marker occurred once, ahead of the persona. |
| Persona Description | The authored persona appeared before the character description. |
| Char Description | The authored description appeared once, distinct from personality. |
| Char Personality | The authored personality appeared once. |
| Scenario | The authored scenario appeared after personality. |
| World Info (after) | A different authored entry appeared after scenario. |
| Chat Examples | Both sides of the authored example appeared in example messages. |
| Chat History | The greeting and the user’s new turn appeared with their corresponding roles. |

The marker experiment used a clean profile with the extension absent. For each native row, the reviewer switched that row off, sent a turn, checked its content disappeared, checked all eight remaining rows were still present exactly once and restored the row. A separate all-off run also removed all native markers. The exact synthetic baseline is saved with the audit. [Native provider request](audit-evidence-10.0.27/native-prompt-baseline.json)

With the extension installed, the reviewer opened each of the 16 craft/check editors in the host and compared its text to the bundled JSON. In the default request all ten enabled blocks arrived in full. The six opt-in blocks were absent. After reversing all 16 switches, exactly the six newly enabled blocks arrived. Module ownership tests separately checked that extension chat overrides, restore and host-owned checks behave as described. [Preset](../presets/Roleplay%20Instructions%20V10.json) · [Prompt Manager interaction test](../tests/t_companion_controls.js) · [Module ownership test](../tests/t_module_ownership.js)

- **Enabled at import:** Viewpoint & player agency, Cast, motives & voice, Scene beats & pacing, Prose & dialogue craft, Consequences, combat & payoffs, Decisive NPCs, Recurring NPC creation, Voice continuity, Turn length & dialogue balance, Same-reply quality checks.
- **Available on demand:** Slow-burn scene profile, Player-limited viewpoint, Physical realism, Social realism, Prose and pacing pass, Story route and continuity.

The README’s answer about response length matches this split. The host prompt **Turn length & dialogue balance** supplies creative guidance. The extension can measure word count and dialogue share. The provider’s output-token setting still limits generation. Delivery tests verify the words sent to the model. They cannot establish whether a particular model follows a word target or whether a reader likes its prose or Roast voice.

## Findings and repairs

| Area | Reproduction and impact | Change and evidence |
| --- | --- | --- |
| First-run setup | On a fresh host using AI Horde, Setup reported no active Chat Completion preset. A new user had no route from that message to the installed companion. | Added the host paths **API Connections → Chat Completion** and **AI Response Configuration**, including JSON import. Cold reviewer switched back to the initial connection and verified the directions. |
| World Info editing | From a saved receipt, **World Info selections → View entry settings** opened a Place with three visible `null` strings. | Optional fields now use the DOM helper that omits missing controls. The same persisted entry contained zero such strings after reload. [Before](audit-evidence-10.0.27/05-mobile-entry-null.png) · [After](audit-evidence-10.0.27/07-mobile-entry-fixed.png) |
| Mobile navigation and choice load | One authored place produced a Story World overview 6,796 CSS pixels tall. Finding a category or recall setting required substantial scrolling. | Added **Jump to section**. All 12 destinations received focus and brought the heading into view at 390 × 844. The selector reset after every choice. It stays at the top of the page, so reusing it from a distant section still takes a scroll back. [Mobile selector](audit-evidence-10.0.27/12-mobile-jump-selector.png) · [Focus and viewport measurements](audit-evidence-10.0.27/jump-measurements.json) |
| Book identity and actions | Eldoria repeated “Host character attachment” after an actual host scan. “Open a lorebook” under Random Instructions sounded like a general book browser. Story World directed standalone-book deletion only to the native editor. | Deduplicated the attachment origin, labeled the chooser **Use a lorebook as an instruction set**, and pointed the Story World picker to the extension’s own book inventory. Cold reviewer verified the source appeared once and canceled a changed selection without modifying either book. |
| Field names and help | The first landing-page inventory found 35 unnamed visible inputs/selects among 88. Settings accounted for 21 and Character Goals for 9. In Add a place, a placeholder was read as “None.” | Connected primary fields to visible labels and help descriptions and named the standalone goal editors. Same 22-page sample measured 0 unnamed after repair. Cold reviewer verified all six fields in the opened Place editor. [Before inventory](audit-evidence-10.0.27/control-before.json) · [After inventory](audit-evidence-10.0.27/control-inventory.json) · [Place accessibility tree](audit-evidence-10.0.27/08-mobile-place-labels-fixed.txt) |
| Contrast and touch | Muted captions measured 4.19:1 against the panel and 4.07:1 on a card. Across 22 mobile pages axe reported 138 instances, including shared navigation repeated across pages. The geometry check counted 32 visible buttons, selects or summaries below 24 CSS pixels tall. | Lightened the label token and gave mobile panel summaries a minimum height of 32 CSS pixels. The repeat checks found zero automated violations and zero short targets in their respective samples. Axe still flagged contrast cases for manual review. [axe before](audit-evidence-10.0.27/axe-before.json) · [axe after](audit-evidence-10.0.27/axe.json) |
| Actor and target menus | Two closed pickers with the same selection had the same accessible name. The “other” option excluded both main participants in its writer prompt but only named one exclusion in its label. | Each picker exposes its role and current selection. Both the option and its guidance identify the exclusions. Verified using keyboard Enter and the Chromium accessibility tree. |
| Event and style editors | Weight, tags and item text had missing or indistinguishable names in populated lists. Raising a minimum from 4 to 12 left an 8 on screen for the maximum even though the draft stored 12. | Row fields identify their item. Raising the minimum updates the maximum immediately. Entering a lower maximum reconciles on leaving the field. Reviewer set 18, entered 6 for the maximum, saw 18/18 and confirmed both values after save. |
| Legacy character cards and tracking | A reply with two populated legacy profiles produced just Hale’s card. Mira had thoughts and feelings but no stable biography or new-format fields. Toggling tracking could also leave legacy cards visible. | Read the established legacy equivalents for Mind, Heart and Psyche, respect explicit new-format clears and the relevant tracking switches. Replaying the same fixture rendered **Scene → Hale → Mira → Roast**. Historic refusal text remains separate from enduring character boundaries. [Card regression](../tests/t_cards.js) · [State compatibility check](../tests/unit/state.mjs) |
| Branch isolation | A branch from a chat with no Story World failed to create its own book when the suggested name was still reserved in extension settings. The log showed a real name collision. | Allocate a name against both the host list and the saved set registry. Verified a new empty book, an earlier branch with a populated parent, protected corrections, batch deletion, historical edits and source-book isolation. [Branch regression](../tests/t_history_v6.js) |
| README accuracy | Keyword suggestions used a different visible label from the instructions. Branch descriptions needed the conditions for an intentionally detached book and optional shared legacy world. | Updated the README and added the Story World section shortcut and the two different lorebook entry points. Checked repository-relative README file links. [README](../README.md) |

## Interaction coverage and user research

| Group | Pages visited through navigation | Deeper tasks checked |
| --- | --- | --- |
| Story | Opening, Current State, Corrections, Reusable Lorebooks, Chat Facts, Plot Records, Story World | Generate or select an opening, create and edit records, protect and clear state, inspect sources, apply corrections, retry failed guided generation, manage book entries and jump between sections. |
| Characters | Portrayal & Knowledge, Emotions & Relationships, Character Goals, Dialogue Colors | Set character and relationship state, edit a goal, observe step completion and rollback, inspect profile snapshots and color behavior. |
| Direction | Random Instructions, Random Story Events, Random Writing Style, Writing Guidance, Action Checks | Create, edit, preview, save and delete sets/items. Exercise nine actor choices and eight targets, five singleton combinations, two multi-choice pools, three trigger modes, framing, category timing, fixed style picks, pronouns and queued rolls. |
| Review | What Was Sent, Context & Memory, Log | Trace an authored place to its exact outgoing text and book, open its editor, return to the receipt, exercise hidden-history counts, summary scheduling, catch-up/rebuild, request failures, retries and logs. [Mobile receipt](audit-evidence-10.0.27/04-mobile-receipt.png) |
| Setup | Preset & Extension, Reply Display, Settings | Change workflows; exercise memory switches and all 12 extension modules at both chat and preset scope; restore inherited settings; test reply visibility, controls and prompt overrides. |

**Discoverability and consistency.** The cold reviewer configured a connection, selected the preset, created a book, added Copper Bridge and sent an ordinary chat turn without implementation instructions. The exact authored bridge fact appeared in the outbound request, the reply receipt and the editor reopened from that receipt. A separate mobile browser recovered the saved receipt. This checks the full path from a visible control to a saved fact and back.

**Feedback and user control.** Removing a required template placeholder produced the expected validation message. A valid edit showed Customized and Saved. Navigating away from unsaved writing guidance offered a discard choice and preserved the draft on cancellation. Restore recovered the original. Branch, swipe and deletion checks inspected saved state and outgoing prompts. An independent reviewer checked chooser cancellation against the hashes of both files.

**Progressive disclosure and accessibility.** At both 390 and 1280 CSS pixels the main traversal opened and closed disclosures, visited every page and checked horizontal overflow. It reached 154 disclosures per width in the first fixture and 153 in the repeated fixture; availability depends on saved data. Tested dialog cancellation, Shift+Tab containment, Escape, full-screen and inline transitions, and receipt links that move focus to the editor. The populated-editor pass found additional issues beyond the landing-page scan. These are assessments of specific tasks using principles including recognition, progressive disclosure, familiar controls and recovery. They are not a usability or WCAG certification.

## Runtime, scope and reproduction

Used Chromium with SillyTavern 1.19.0 (host commit `7e8663c`), isolated local data roots, disposable stories and local OpenAI-compatible fixtures. The fixtures captured provider-bound JSON and supplied both valid and deliberately malformed replies. No paid connection was needed. Most main-panel navigation used 390 × 850 and 1280 × 850. Independent cold sessions included 1360 × 900, 390 × 844 and 390 × 820. The scoped axe-core 4.11.0 scan used the expanded extension at phone width and WCAG A/AA tags through 2.2. Browser accessibility-tree inspection and geometry measurements supplemented it.

Run the following against a **disposable host profile** with the host and mock configured as in the test guide. The browser suites change settings and create test chats and books. Each suite sharing a mock must finish before the next starts. [Test setup](../tests/README.md)

```sh
node --test tests/unit/*
node tests/t_companion_controls.js
node tests/t_extension_ui_audit.js
node tests/t_cards.js
node tests/t_history_v6.js
```

**Boundaries.** The observed outcomes establish navigation, prompt assembly, storage and rendering for the tested states. Real-model instruction following, prose length or quality across providers, physical-phone accessibility, additional themes, other host versions and every possible combination of user content and settings remain unverified. The 16 writing switches were inverted together and checked individually in the payload. The nine native rows were additionally isolated one at a time. Disclosures and option sets that depend on data were exercised with the fixtures documented above.

## Run history and regression ledger

1. Recorded the starting revision and began an append-only scratch ledger while suites ran. Opened the preset, captured two opposite configurations, then repeated the import through the actual host file chooser. The native-marker reviewer isolated host behavior in a separate profile.
2. Ran page traversal, populated workflows and a first-use review in parallel on separate profiles. First-use mock setup timed out in three older suites (prompt overrides, legacy reply cards and writer UI). Repeated those scenarios with an initialized connection; all completed. A separate fresh-profile run exercised setup from the welcome dialog.
3. Investigated failing assertions and checked the browser trace and provider requests. Found the branch name collision and the missing legacy character card. Other failures included a missing personal-worldbook fixture, a first-turn assumption in a goal test, obsolete card selectors and an old error-message string. The import test now creates a representative native book. The goal flow passed on replay. Updated the legacy expectations to the current UI and retained checks on actual message content, timers and book persistence. A manual rebuild test now distinguishes its one explicit request from the independent historical repair triggered by editing. No failing first attempt counts as a passing verification.
4. Reopened the populated editors after each fix. Repeated mobile labeling and contrast checks, saved the visual evidence, and reran the affected host flows and unit suite. The ledger below refers to completed final runs for each named scenario. Earlier observations remain in the findings and fixture notes above.

Executed all 51 top-level browser scripts in this checkout. The native timing trace and screenshot script are observational. The final unit run reported 20 passed, zero failed and zero skipped.

| Browser script | What it exercised | Final result |
| --- | --- | --- |
| [t_50.js](../tests/t_50.js) | 50-turn scheduling and receipt stress run | Passed |
| [t_anywhere.js](../tests/t_anywhere.js) | 5.8: the AI writer's rules for each kind of story event list; the current scene left out; the line in the event order; the stakes list; the works-anywhere mark; the rewrite; the panel | Passed |
| [t_book_management.js](../tests/t_book_management.js) | Imported probability, editable timing, removal and shared book deletion | Passed |
| [t_branch.js](../tests/t_branch.js) | 5.9: a branch gets its own copy of the story world (own lorebook and shared lorebook); what the branch files and undoes stays in the copy; no second copy; the setting off; a new chapter is not copied | Passed |
| [t_cards.js](../tests/t_cards.js) | 5.11: character profile cards and the roast, asked for in the update block and drawn by the extension under any preset. | Passed |
| [t_chapter.js](../tests/t_chapter.js) | 5.4: a chapter when a scene ends, after a set number of replies and by hand; finished entries moved into the chapter and back on delete; what the request holds; the Log; what is sent; a scene that ends too soon; delete; older chapters combined; older chapters sent when relevant; a new chapter in a new chat (what is carried, the first message, the old chat unchanged, going back, no story world); a starter world from the card; the panel | Passed |
| [t_chat_books.js](../tests/t_chat_books.js) | chat books: catalog, native editing, isolated chapter book, carryover policy and date/weather fields | Passed |
| [t_close.js](../tests/t_close.js) | 5.6: replies still counted when older messages are hidden; what the AI is sent from the chat; notes on "who does it" and "who it happens to"; versions checked against who does it; the story so far for the AI writer | Passed |
| [t_companion_controls.js](../tests/t_companion_controls.js) | JSON file import, all 16 craft editors and captured default/inverted requests | Passed |
| [t_context.js](../tests/t_context.js) | What the AI writer is shown (card, scenario, persona, summary, recent messages); who-does-it choices | Passed |
| [t_context_v9.js](../tests/t_context_v9.js) | Real-host request breakdown, context controls, persistence and no extra requests | Passed |
| [t_contextual_writer.js](../tests/t_contextual_writer.js) | Customizable writer prompts and same-turn model guidance | Passed |
| [t_correction_ui.js](../tests/t_correction_ui.js) | Phone-width source search and manual edits, optional one-click AI source repairs, default guided generation, existing swipes, failed generation and retry | Passed |
| [t_delete_direction.js](../tests/t_delete_direction.js) | Confirmed deletion and isolation of shared records | Passed |
| [t_dice.js](../tests/t_dice.js) | 5.7: dice and stats in code; lists that retire their items running out at different times; the used-up notice and bringing items back; where an event comes from; hiding what a chapter covers and showing it again; counting the messages in the finished prompt; the new chapter button in What Was Sent | Passed |
| [t_edit.js](../tests/t_edit.js) | Deleting messages, branching, editing the newest reply, swiping after a delete | Passed |
| [t_engine1.js](../tests/t_engine1.js) | Sending, version cycling, the record, check done, overdue, final, stop | Passed |
| [t_engine2.js](../tests/t_engine2.js) | Swipe and regenerate repeat, Pick again, all per-reply limits, quiet and impersonate, keep and wait | Passed |
| [t_events.js](../tests/t_events.js) | Story events: every dice rule, swipe repeat, delete rewind, saved text, AI items, example roll | Passed |
| [t_extension_ui_audit.js](../tests/t_extension_ui_audit.js) | All 22 navigation pages, reachable disclosures on phone and desktop, both extension module settings scopes, mode and memory selections, keyboard focus and unsaved record navigation | Passed |
| [t_extras.js](../tests/t_extras.js) | Never together, linger chance, saved settings per chat, Pick again / Lock / Keep on one item, rule checks | Passed |
| [t_f.js](../tests/t_f.js) | Keep and wait timing for six combinations | Passed |
| [t_flow.js](../tests/t_flow.js) | 5.3: the update block is asked for, lifted out and filed with no extra request; names on file, duplicates, your own entries, locked entries, off, out of character; undo on swipe, swipe back, delete, continue and by hand; threads that build; things ordered into the scene, the cap, the check and what happens when they are carried out; the panel | Passed |
| [t_gap_closure.js](../tests/t_gap_closure.js) | Phone-width book navigation, optional keyword suggestions, role-scoped managed recall, sticky and cooldown timing, token-triggered chapters, and restoring protected history without another model request | Passed |
| [t_goals.js](../tests/t_goals.js) | Character goals: steps in any order, action waits, re-sends that never give up, swipe, delete, the panel | Passed |
| [t_guided_v7.js](../tests/t_guided_v7.js) | Guided replacement prompt, rollback, one-turn direction, saved swipes and optional order repeat | Passed |
| [t_history_catchup.js](../tests/t_history_catchup.js) | initial catch-up, saved coverage, provenance rollback, failed rebuild safety, replacement book and authored data option | Passed |
| [t_history_v6.js](../tests/t_history_v6.js) | Deep branches, fresh branch books, bulk deletion, edited replies and reviewed rebuild | Passed |
| [t_import.js](../tests/t_import.js) | A lorebook the extension did not write: one note per reply, file left unchanged | Passed |
| [t_log.js](../tests/t_log.js) | 4.1: {{user}} flags that never block, the narrowed check, failure reasons, the retry with more room, the Log tab, the line about {{user}} said once per reply | Passed |
| [t_memory_components.js](../tests/t_memory_components.js) | memory profile: host-owned writing and state, separate lore and chapters, chapter request, auto-hide and restoration | Passed |
| [t_memory_v9.js](../tests/t_memory_v9.js) | Chapter timing, hiding covered history, preserving recent messages and including the summary | Passed |
| [t_misc.js](../tests/t_misc.js) | Extension off, automatic new reply, Send again, Undo done, Continue, hold-back while overdue | Passed |
| [t_module_ownership.js](../tests/t_module_ownership.js) | Verify which source reached an actual assembled SillyTavern request. | Passed |
| [t_native.js](../tests/t_native.js) | Native host timing trace with the extension off | Observed |
| [t_pace.js](../tests/t_pace.js) | 5.5: story event items that wait for a thread, a secret, a plan or people in the scene; big events and the quiet after them; story phases; a character who has gone quiet; what a writing style item adds while it is the pick; the word list; the rules given to the AI writer; the plainer starting lists; the panel | Passed |
| [t_prompts_v8.js](../tests/t_prompts_v8.js) | Custom instructions in real chat, guided swipes and AI writer requests; persistence and independent restore | Passed |
| [t_reply_cards.js](../tests/t_reply_cards.js) | Independent reply cards, snapshot editing, visibility settings and responsive layout | Passed |
| [t_reply_cards_v103.js](../tests/t_reply_cards_v103.js) | reply previews, direct tab jumps, formatted collapsed Roast, editable commentator voice, and chapter continuity | Passed |
| [t_reply_story_world.js](../tests/t_reply_story_world.js) | Stored continuity and reply tabs, emotion scales, independent Roast and manual edits | Passed |
| [t_reusable_books.js](../tests/t_reusable_books.js) | multiple guideline/reference imports, editable triggers and role-specific prompt delivery | Passed |
| [t_scene.js](../tests/t_scene.js) | 5.10: the scene lines asked for with and without a story world; kept on the reply and taken out of its text; the scene card and when it is hidden; people present but unnamed still get their entry; event conditions counting from the lines; out of character; off | Passed |
| [t_shared.js](../tests/t_shared.js) | 5.1: sets kept inside one shared lorebook: per-chat on and off, limits, the cap, events and style, the lorebook attached in World Info, the extension off, moving a set in and out with its timing and records, edits, export, the Settings section | Passed |
| [t_shots.js](../tests/t_shots.js) | Screenshots at tablet and phone size | Observed |
| [t_story_corrections.js](../tests/t_story_corrections.js) | Source repair, transcript edits, chapter and lore precedence, automatic refresh | Passed |
| [t_style.js](../tests/t_style.js) | Writing style: per-category timing, rest, scope line, swipe, delete, overdue instruction, the panel | Passed |
| [t_ui2.js](../tests/t_ui2.js) | AI writer, checks, saving, pronouns, What Was Sent, both "under each reply" modes | Passed |
| [t_v10.js](../tests/t_v10.js) | v10 host: companion preset, native updates, pinned lore, guidelines, dice, repairs, plot gates, clock, speaker colors, streaming progress, cancellation, console, opening, saved-swipe navigation and branch rollback | Passed |
| [t_v5.js](../tests/t_v5.js) | 5.0: the cap on new things per reply across sets and the goal, only once per chat, story event items that retire | Passed |
| [t_v6.js](../tests/t_v6.js) | Real host: parse a response, send protected state, swipe, reload and save a lasting fact to Story World | Passed |
| [t_world.js](../tests/t_world.js) | 5.2: the story world: entries of every kind, who is present (HUD, scene header, "Present:" line, names), the notes block and its order, secrets, the room in tokens, swipe, placement, the extension off, other chats and worlds, moving a world, the Story World tab and its AI writer | Passed |
