# Changelog

## Unreleased

- Fixed four faults found in the integration pass. The on-phone model downloads only on a phone, so desktop browsers no longer start a 2 GB download at load. Quick actions now opens on Bar and Library in place of their stand-ins. A chat change redraws the open page, so the previous chat's draft no longer stays on screen. The companion preset now sets a 32K context, since SillyTavern's default 4095 left no room for the prompt beside the 4096-token reply limit and sent an empty request.
- Reorganized the companion preset for phone reading. Rows sit under four empty heading rows (Host sections, Writing craft, Profiles, Scene checks, then Chat), names are the feature word plus a short title within 20 characters (`Craft: Viewpoint`, `Check: Physical`), and each block starts with a comment that gives its default, alternatives, dependencies and pairing; SillyTavern removes it before sending. A README row, off by default, explains the preset. The file now sets temperature 1, top P 1, no penalties and a 4096-token reply limit, and leaves context size to the model. [B15 evidence](docs/ux-overhaul/tickets/B15.md)
- Added Setup, Presets, Cleanup. It backs up every Chat Completion preset into one file (kept in SillyTavern's user files and downloaded), lists the 14 exact copies beside their bases and each group of Evening Truth presets that differ only in context size, and changes nothing until you tap "Retire 14 copies, merge 5 ET groups". Each retired preset's context size stays as a model profile on the preset that remains, and the same screen restores the backup in one step.
- Added the background job queue and judgment routes. Jobs are saved on the device, merge when repeated, resume after the app pauses and are rebuilt from the chat when the saved queue is gone. The desktop keeps one chat model and the embedding model loaded during play and runs jobs for other models as one group in an idle window. Judgment calls before the reply go to the desktop within 1 s, then the on-phone Gemma 4 E2B, then jev-router through the saved OpenRouter connection, then code. Routes are detected from saved connection profiles with no approval step, and the on-phone model downloads by itself on Wi-Fi. A desktop setup guide lists the Ollama settings. [Desktop guide](docs/desktop-memory-guide.md)
- Options now return titled cards with Copy, Insert and Send in a results sheet that takes 40% of the screen by default (the Setup, Look slider sets 25% to 75%), scrolls at full text size and shrinks to fit fewer options. Insert keeps your draft and cursor, Send keeps the draft for later, separator fragments never reach the message box and an option that arrived without its text says Incomplete option. A re-tap on the same reply and settings reopens the saved options with no request; Generate again shows the Cost chip, and Cancel keeps the options already shown. The queue chip opens a queue sheet to edit, switch Private or Visible and Required or Optional, remove or clear everything queued for your next message. [B2 evidence](docs/ux-overhaul/tickets/B2.md)
- Added Setup, Presets. The selected preset is matched to its edition in the preset library, and each feature it also offers gets one Ours or Theirs switch, saved per edition with an optional pin for one chat; story state, emotions, relationships, dice and dialogue colors start on Ours, everything else on Theirs. Ours switches the preset's blocks for that feature off in a working copy for the length of each prompt, so the preset file never changes; Theirs sends none of the extension's text for it. Save as loadout writes a new preset named "<preset> + RI <name>" with the switches in its extension data, and selecting it anywhere, a Connection Profile included, restores them without a second working copy. The page also groups the preset's blocks under its own headings with counts, token estimates, Default, Lock and pick-one controls, a read-only document view and the regex scripts it carries. [B12 evidence](docs/ux-overhaul/tickets/B12.md)
- Rebuilt the menu shell. Five top tabs (Story, Direction, Quick actions, Review, Setup) sit over a nested row that scrolls sideways, so any page is two taps away; the header is 120 px Compact and 148 px Comfortable. Search finds pages, sections and single settings, knows SillyTavern words such as Author's Note, Impersonate and World Info, and lands on the control with its folds open. One Back names where it goes, sub-views show a breadcrumb row, and the menu reopens on the last page reached through the tabs. Every page opens with its icon, title, status and one line of help, with a Prompts row at its foot. Pages other tickets register appear in their nested tab. [B5 evidence](docs/ux-overhaul/tickets/B5.md)
- Replaced the scene header box, glance, Story state console, progress stack and separate cards under each reply with one reply tray. It opens as a one-line Strip under earlier replies and as Compact (one line per card) under the latest; Expanded shows one card at a time with a chip row. While a reply is written the Strip shows "Writing the reply" and then "Capturing", lights a chip per card as its values arrive, and ends resolved, failed with Read again, or stopped. A feature set to Theirs shows no card or Strip mark. The model now writes the scene header as the reply's first line (place in bold, time, weather, who is present, with Unicode symbols); after 3 misses in the last 10 replies a chat moves the header into the Strip, with "Try in the reply again". Setup, Look, Reply tray sets the views, where the tray shows, Card text and the scene header. [B10 evidence](docs/ux-overhaul/tickets/B10.md)
- Added route chains for background jobs. A call through a saved connection profile can carry a JSON schema, one forced tool and a reasoning effort; the Main API reads a schema answer from text with one repair request. Each tier tries the desktop, the NanoGPT plan, free tiers, paid routes and the Main API in order, skips a down route for 10 minutes and records every attempt. A monthly meter records paid background spend, warns at US$4 and pauses paid routes at US$5.
- Added Setup, Quick actions, Bar and Library. Bar pins, orders and unpins quick actions by single taps, switches between Global and This chat (This chat starts as a copy and replaces the global bar for that chat only), and previews which pins overflow into More at the current width. Library lists every quick action by kind with Pin, Edit, Duplicate, Delete, Import and Export; the editor has every field of the quick action table, a searchable grid of 60 icons and a cost line that follows the saved connection. Edit from the bar opens that editor. [B3 evidence](docs/ux-overhaul/tickets/B3.md)
- Replaced the bolt in the message row with a one-row quick action bar above the message box. One tap queues a direction, rolls an action check or opens What was sent; Options, Swipe, Continue and Impersonate open a small Generate sheet whose optional text joins the saved direction in the same request, and nothing is sent until Generate. Hold an icon to edit, move or unpin it; the bar folds to a 4 px strip, and `/ri-bar` shows or hides it. Setup, Look sets text, icon and touch-target sizes. Saved composer slots carry over. The bundled IBM Plex Mono face and the new color and size tokens are shared by later menu work. [B1 evidence](docs/ux-overhaul/tickets/B1.md)
- Fixed the newest chapter dropping out of the story so far once two long chapter summaries filled its budget. The newest chapter is placed first and an older kept chapter is shortened to the room left, in story order.
- Fixed Memory only sending no saved facts. A stored fact with an empty alias list was read as that list, so every fact was skipped; facts now reach the request when their subject is in the scene.
- Moved Quick actions to a collapsible rail above the composer. It remembers the display preference and gives direct access to steering and drafting. The draft editor shows choice and draft costs beside the direction field.
- Added 30-day fantasy calendar rollover from Deepwinter through Frostfall. The scene editor, reply header, and ordinary reply context use the named story date.
- Unified chat and panel navigation with Find a tool, page headings, contextual links and return focus. Added exact-reply review and scoped recovery for interrupted panel edits.
- Updated model settings and reply display destinations, grouped chapter controls in Context & Memory, and added searchable story records and request logs. Shared controls have larger touch targets and clearer focus.
- Put freeform direction entry first in Quick actions, keep queue confirmation and Undo visible, and show scope before saved-button editing. Historical corrections identify the reply and version and link to its receipt. [Extension UX verification](docs/extension-ux-verification.md)
- Added a composer Quick actions sheet with saved directions, one-use next-message delivery, guided swipes and continuations, and editable player drafts and choices.
- Added queue delivery on hosts with Chat Completion or Text Completion prompt hooks, draft-safe retries and per-swipe evidence for required directions. Phone-width editors include visible JSON file pickers and touch reordering.
- Added chat-local pins, source selection and rolls, standalone action editing, and reviewed library, lorebook and Keel imports. Added Fresh start for a single action or five accepted forward replies.
- Added a six-reply memory filing window, source repair, and local prose screening with optional same-reply evidence and one-use writing guidance.
- Added per-function model connections and execution receipts. Background model work requires a separate opt-in. Prompt and preset editors identify their restore sources and retain named variations. [Verification](docs/quick-replies-verification.md)

## 10.0.32

- Added nine individually editable commentator voices, including the original v9 Gremlin. Each keeps its own default and saved wording.
- Added native preset block editing, placement, ordering, per-block restoration and a four-way source selector beside matched extension modules.
- Added optional single-request comparison, manual pairings and configurable structured module instruction order. [Interactive audit](docs/ui-audit-10.0.32.md)

## 10.0.31

- Restored the complete v9 Gremlin voice and both original samples as the shared default for Structured and Legacy Roasts. The editor is labeled **Roast voice**. Existing custom voices keep their wording, including older edits that retained the original first line.

## 10.0.30

- Clarified which extension default a chat follows and which setting a reset restores in **Setup → Preset & Extension**.
- Setup refreshes when the host changes presets, including while a module selector has focus. The reply-plan control appears with the companion preset.
- Show the source selector before the extension module switch. A module managed by host prompt blocks shows their status and text. The extension switch appears when the extension can run the module. The source description now accounts for a module switched off in the chat.
- [Setup audit and phone screenshots](docs/ui-audit-10.0.30.md).

## 10.0.29

- The generating reply uses the saved cards’ layout. Character fields, scene details, emotion meters and story changes fill in as their sections arrive. Roast, planning and World Info keep their own positions. Once filing completes, the cards open into their saved details.
- On narrow screens the handoff keeps the end of the prose in view when the host has followed the reply to the bottom.
- [Phone-width verification and screenshots](docs/ui-audit-10.0.29.md).

## 10.0.28

- Added mobile section navigation to Story World and directions for selecting the companion in a fresh host. Clarified the instruction-set chooser, actor/target choices and book origins.
- Fixed accessible field names, mobile disclosure sizes, caption contrast, stray null text in the entry editor and stale minimum/maximum duration values in event and style editors.
- Fixed branch book creation with a previously reserved book name. Restored character cards from legacy profile fields and honored the separate scene and character tracking settings in the legacy display.
- [Interactive verification and evidence](docs/ui-audit-10.0.27.md).

## 10.0.27

- Advance weekdays and numbered month and day fields together, including at month and year boundaries. Recover the full date from saved rollover offsets so older replies and new requests use the same calendar date.

## 10.0.26

- Show the known weekday after a fictional midnight rollover and keep the last full date in the header tooltip and the next request.

## 10.0.25

- Recover established dates and weather through partial scene updates and placeholders. Read Sola chronology, Vexa headers, and Deus trackers. Carry supported dates through midnight and retain a last known date with the established day offset when a fictional calendar is unresolved.
- Give the scene header more room for dates and locations. Restyle the cast and story cards, and show emotion meters when that reply records actual scores.
- Show waiting sections in the streaming card and light each section as its data arrives. Keep the reduced-motion setting and the existing display controls.

## 10.0.24

- Show scene, cast and story-change previews beneath the newest reply. Each preview opens the matching section of Story State in one tap.
- Give Roast a standalone quotation layout with paragraphs and emphasis. Structured and Legacy replies now use the same editable commentator voice. Saved custom voices carry over, and the default reacts as an invested reader.
- Bring newly opened cards into view if they would fall behind the composer on a phone.

## 10.0.23

- Manage keyword source, chance, sticky duration and cooldown on Story World entries. An optional AI helper suggests trigger phrases for an entry and leaves the final selection in its editor.
- Set the protected conversation window and chapter threshold in estimated tokens. Reapply the window to saved chapters without a model request. Review confirmed World Info and structured record estimates in Context & Memory.
- Carry emotional recovery time and relationship notes into a new chapter. A chapter save checks that the accepted source history is still current before hiding covered messages.
- Edit and restore feature guidance for openings, story checks, record updates, corrections, opportunity rolls and catch-up. The companion preset offers optional physical, social, prose and continuity checks. The extension yields the matching check when the preset provides it.
- Link directly to the current chat’s editable book inventory and clarify where the extension module defaults come from.

## 10.0.22

- Advance the scene header and relative story clock from the same accepted timing. ISO dates and numbered days roll over automatically. A fictional date that cannot be calculated is marked unconfirmed until the story establishes it.
- Include the accepted clock and date in subsequent reply requests. New chapters and history rebuilds carry the clock through established intervals, and swipes use the timeline of the selected reply.
- Time and date edits can advance with the story by default. The scene editor still lets you protect a value from automatic changes.

## 10.0.21

- Apply a correction from one button. AI source tracing is optional, and the form counts the requests needed for the selected options. A successful streamed correction stays selected as the new swipe.
- Open the exact World Info entry and edit its settings from a reply receipt. What Was Sent shows whether story guidance was confirmed when exact text retention is off and links to the writing guidance.
- Find chat workflow setup from the empty Random Instructions page and jump from Random Story Events to the chat’s autonomous events setting.
- Preserve drafts when switching between inline and full-screen views. Warn before leaving changed forms and let users discard unsaved prompt text independently.

## 10.0.20

- Saving a story correction can immediately generate a guided swipe. The original swipe remains available. Failed generations preserve the correction and offer a retry.
- Correct sources with AI applies supported edits in one optional tracing request. Manual searching shows matching source passages and keeps edit controls inside the source card.
- Give unavailable Structured pages a direct path to workflow settings and give empty-chat pages instructions specific to their controls.
- Fix fullscreen keyboard navigation, the World Info handoff, narrow-phone swipe layout, misleading activation labels and Review reply numbers. Keep unsaved record edits until the player chooses to discard them.
- Make record IDs optional for new records, keep opening source labels in sync, and identify legacy controls and completed log entries accurately.

## 10.0.19

- Open Story State under a reply to inspect saved portrayals, emotion scores, relationships, character knowledge, facts and plot records. The viewer reads the book on demand and uses the saved history for earlier replies. Disabled modules stay out of the tab list.
- Report unavailable Roast or planning output in the reply console’s Notes tab as well as What Was Sent.

## 10.0.18

- Trace story corrections from the transcript and saved records through chapter summaries, character cards, and lorebooks. Review exact source edits, apply them, and save the accepted fact for future turns.
- Refresh managed story state and affected chapters after editing a reply or deleting from the middle of a chat. Branches and tail deletions reuse saved state when possible and rebuild missing state from the retained history.
- Remove an assigned World Info book from the current chat, hide a historical book card, or permanently delete the underlying book using the host.
- Keep imported odds and timing when bulk editing unrelated fields. Use readable number fields in World Info and Emotion tuning.

## 10.0.17

- Catch up unprocessed chat history or rebuild the full chat into a new Story World. Both use batches to write chapters and file supported story records. Rebuild keeps the previous book available and can carry authored entries and corrections into the replacement.
- Recognize versioned V10 companion preset names such as V10.3. Request the Roast in each structured story reply when enabled and report missing planning and commentary in What Was Sent.
- Recover time, date and weather from explicit legacy headers and combined fields. Carry the last established weather across location changes until the story supplies new conditions.

## 10.0.16

- Story notes prioritize the scene and recall a few relevant threads, off-screen activities and named details within the notes budget. Chapter text has its own limit, and a rollup suppresses the chapters it already covers.
- World Info receipts show native activation settings, distinguish Random Instructions from guidelines and identify entries delivered together in the Story notes block.
- A managed instruction set's per-chat switch also applies when its book is attached in World Info or assigned as a reusable book.

## 10.0.15

- Manage entries directly on guideline and reference book cards. Inspect full entry text, edit activation, chance, stickiness and cooldown, and delete one entry or a selection.
- Guideline chat-specific conditions appear on the corresponding entry alongside its shared World Info settings.
- Copy a guidelines book to an inactive Random Instructions set. Instructions can match text in the latest user message or previous model reply.
- Reusable book entries can opt into the host’s World Info vector search.

## 10.0.14

- Assign, batch-import, or create multiple Behavior & Guidelines and Knowledge & Reference books per chat. Manage each assignment under Story → Reusable Lorebooks.
- Add and edit entries in the extension. Use native chance, stickiness, and cooldown for random reminders, or choose keywords in recent chat, the latest user message, or the previous model reply.

## 10.0.13

- Delete an instruction and its versions directly from its list card. Story-event and writing-style sets can be deleted from their list cards or editors, including sets with a dedicated World Info book.
- Deleting a set removes its entries and keeps its World Info book. New instructions receive fresh IDs after a deletion so earlier replies cannot replay a deleted instruction by mistake.

## 10.0.12

- Pick several allowed actors or targets when writing random instruction versions with AI. The extension draws from the selected pairs and shows each assignment in the writer review.
- The story event writer can also draw from several allowed origins and save each item's origin for later event rolls.

## 10.0.11

- Edit shared writer prompts from inside individual instruction and category editors and in the corresponding AI writing dialogs. Each prompt shows its Default or Customized status and has its own restore control.
- In-chat instruction framing is editable beside its live preview. Event and style set editors also expose their in-chat templates beside the example.
- Random Instructions can address the model writing the reply or leave either participant unspecified. Model-directed guidance uses the regular reply request and skips story-action verification. The AI writer preserves character card macros in generated versions.

## 10.0.10

- Streamed replies preview complete scene, character, change, repair, and commentary sections as they arrive. Validation and saving still occur after the reply completes.
- The planning reader recovers the cases where an emitted wrapper leaked tags or an unfinished page absorbed adjacent prose. It still preserves well-formed plans as a separate disclosure.
- Structured play adds editable scene and character checks, grounded and heightened writing profiles, optional phrase and prose diagnostics, and targeted emotion notes. Known Vexa writing and Antithesis blocks yield to host ownership.

## 10.0.9

- Reusable Lorebooks lists physical books associated with the current chat, their roles, and earlier Story Worlds. Open a book in the host or edit, export and delete selected entries inside the extension.
- New chapter creates a separate native Story World, including when the source chat had none. The source book keeps its own summary. The continuation summary starts with a six-reply recall window and can be recalled by trigger or refreshed by chapter rollups.
- The chapter-opening draft has editable time, date, location and weather. The scene header separates recognized legacy fields packed into one timestamp.
- World Info recall can be set per entry or in batches. Native entries keep host trigger and timing semantics. Managed entries use reply-based activation, chance, and stickiness.

## 10.0.8

- Memory only lets the host preset control writing, mechanics, and rendering. Choose World Info recall, chapter summaries, and auto-hide independently for each chat. Turning off auto-hide or chapter summaries restores history hidden by the extension.
- Structured modules are grouped by writing and reply display, story and character continuity, and plot and mechanics.
- The companion preset adds editable prompts for decisive NPCs, recurring NPC creation, voice continuity, turn length and dialogue balance, and prose quality checks. Slow-burn pacing and player-limited viewpoint are optional host prompts.

## 10.0.7

- Replies show a responsive HTML scene header with the accepted time, date, location and weather above the prose. The story console stays collapsed by default. Progress lights follow the context, prose, update and saved stages and respect reduced-motion settings.
- Setup distinguishes the active host preset, its prompt blocks, the Roleplay Instructions extension and its modules. Module controls show On or Off for their scope and give changed settings a reset button with the resulting value.
- The companion preset restores five editable writing prompts covering viewpoint, cast and voice, scene pacing, prose and dialogue, and consequences. Reimport the updated companion preset to use them.
- Reusable guideline entries can be scoped by character, location or extension module. Chat facts can reference pinned Base World entries. Portrayals honor editable source baselines and scene-only facets. Temporary physical conditions expire unless established as durable.
- Plot history distinguishes recalled, eligible, offered and established developments. Agenda completion respects minimum travel time, and the reply update can preserve valid fields while reporting a rejected field.

## 10.0.6

- Replies use natural dialogue attribution. The extension colors identified quotations and asterisk-wrapped character thoughts, including multiple speakers in one paragraph. Earlier bracket labels are hidden in the chat display.

## 10.0.5

- Module rows show the preset default alongside the chat override. Known overlapping Chat Completion blocks have an instruction source selector with on/off status. V10 yields while related host blocks are enabled or their status is unavailable.
- Reply cards use distinct cool accents, readable scene and World Info chips, and clearer tabs. The loading card connects stages and checks each one off as it completes.

## 10.0.4

- Preset & Modules uses separate This chat and Preset defaults views. Each module explains its behavior and shows which setting controls it in the current chat.
- Reusable Lorebooks, Reply Display, and What Was Sent link directly to World Info visibility and review. Multiple prompt assembly passes retain the entry text needed for delivery confirmation.

## 10.0.3

- Upload and assign a native World Info JSON file directly from Story → Reusable Lorebooks. Duplicate filenames get a new name.
- Legacy story updates ignore CLEAR and RESOLVED as entry names while preserving field clearing.

## 10.0.2

- Grouped navigation gives opening setup, records, character tools, reply display, and prompt controls their own pages.
- The companion preset keeps a model-emitted planning prelude in a collapsed Reply planning disclosure. The extension separates it from editable prose, story state, and later prompts even if it arrives with incomplete wrappers.

## 10.0.1

- The story console lights up as context is prepared, the reply streams, and story state is updated. The temporary progress card clears on cancellation and honors reduced-motion settings.

## 10.0.0

- The companion preset enables V10 modules with preset defaults and chat overrides. Existing chats can opt in under V10 Story.
- Opening setup previews card greetings and drafts new ones with optional direction. Accepting an opener commits its validated state to the branch book.
- A pinned Base World and separately selected Behavior & Guidelines books feed World Info. The branch Story World stores editable Chat Facts and Plot Records, with protected corrections and validated history rollback.
- The ordinary reply carries a versioned state update, including scene time, character portrayal, knowledge, emotions, relationships and plot changes. Eligible repairs ride with the next ordinary reply. Optional plot opportunities share the existing pacing chance. Explicit action checks roll locally with no automatic per-turn dice.
- A collapsed scene and character console, a separate compact World Info receipt, and a separate opt-in Roast. The dialogue palette is editable per speaker and rendered with local contrast checks.

## 9.0.1

- Reply cards use independent, collapsed Scene, character and Roast drawers with clear headings, a responsive field layout and the extension's cool palette. Snapshot editing remains available inside each card; open cards stay open across refreshes and editing can be cancelled or saved without getting stuck.

## 9.0.0

- Context & Memory brings together chapter timing, covered-message hiding, protected recent messages and the story budgets. A slider previews the selected recent text and an estimate of the recent chapter interval.
- The last observed chat-completion request shows approximate recognized text for conversation, chapters, story notes, events and other instructions. Unmatched passages and non-text inputs are disclosed; only counts are retained in memory. No new model requests are made by the dashboard.

## 8.0.0

- Feature-local editors expose the extension's behavioral instructions and system messages, with individual save, restore and undo-restore controls. Required placeholders are validated; live data and output contracts remain managed by the extension.
- Customized wording stays separate from built-in defaults, and editors indicate when a newer installed default differs from the one originally customized. Editing and restoring make no AI request.

## 7.0.0

- Guide a swipe from the newest character reply with a one-time direction. Previous turn orders are optional; existing swipes remain available. Recorded world changes are rolled back with conflict checks before generation and restored on cancellation when safe.
- Thread clock and status timing now carry enough history to be reversed safely. Older records without that history require review.

## 6.0.0

- Deep branches mint a separate lorebook, rewind recorded future world changes and protected corrections, and leave the parent world alone. Extension world-editor changes are recorded for future branches. Existing or external world edits may lack history and should be reviewed.
- Bulk deletion defers rollback until later replies have been removed, then applies changes newest first. Editing a model reply withdraws dependent automatic state and world changes and offers a one-request, review-before-apply rebuild.

- A collapsed Story state view and editable Mind, Heart, Body, Psyche and scene fields. Protected edits are stored in chat metadata; historical snapshot edits can be kept separate from current state.
- The existing update block carries changes without an additional model call. Relevant current state is sent with the next reply under a configurable approximate budget. The previous roast is optional.
- Enduring character boundaries can be edited in Story World, and a current-state card can explicitly save a lasting fact to a character entry. Random story events can be filtered using explicit item tags.
- Existing v5 card data stays intact; compatible fields are read as v6 state. No post-hoc Will not judgment is promoted to a boundary.

## 5.11.1 (2026-11-16)

- The commentator's starting voice is Gremlin, from Sola V6: its own description, how it types, and its sample. A
  voice still at the 5.11.0 start is moved to it; a voice you edited is left alone.

## 5.11.0 (2026-11-16)

- Character profile cards and the roast, from the extension under any preset. Profiles are asked for in the same
  block as the scene lines: what is going on in each person now with every reply, and who they are once per person,
  filed in the story world (or carried from earlier cards in a chat with no world). The roast is written by a
  commentator voice set in Settings > Character cards, and the previous roast is sent with the next request. Both are
  drawn as cards under the reply and can be switched off. No extra AI request.
- Character entries have a new line, Orientation.

## 5.10.0 (2026-11-16)

- Scene lines: every reply is asked for who is present, where and when, with or without a story world, in the same
  block the extension already asks for. They are kept on the reply and read first for who is present, so the story
  notes, event conditions, the silent-character order and the dice work the same under any preset, and presets can
  be switched in the middle of a chat.
- A scene card under each reply (When, Where, Present), shown only under replies that have no tracker of their own
  unless set to always. Settings > Scene.

## 5.9.0 (2026-11-16)

- A branch gets its own copy of the story world the first time it is opened, named "(branch)" and kept where the
  original is. Its records are pointed at the copy, so what the branch files, and what swipes and deletes in the
  branch undo, changes only the copy. The chat it came from keeps the original. A setting turns this off. A new
  chapter in a new chat still shares the world on purpose.

## 5.8.0 (2026-11-16)

- Story events that work wherever the scene is: the AI writer gets rules and examples for each kind of list
  (Situation, Complication, Who drives it, Tone, What it puts at stake); the current scene is left out when items are
  written, unless you turn it on; the AI marks items that need a particular setting, and those start unticked; every
  event order says to keep what a part does to the people and change how it happens when the part does not fit.
- A new list "What it puts at stake" in new story event sets, with ten items that work anywhere, and a button that
  adds it to an older set.
- "Make these work anywhere": one AI request rewrites a list's items, and you choose which rewrites to keep.
- Dice: a stat can be any whole number from -20 to +20, and the total alone decides the outcome (six tiers, from
  "fails badly" at 2 or less to "succeeds brilliantly" at 22 or more). A natural 1 or 20 no longer decides by itself.
- A chapter is tied to the reply it ends on, so a branch keeps the chapters written before it branched and does not
  write them again.

## 5.7.0 (2026-11-16)

- Dice rolled in code: one d20 per reply for {{user}}, {{char}} and other characters (each can be switched off),
  with stat modifiers for {{char}} (kept with the character card) and {{user}} (kept with the persona). The total
  and the outcome of every stat are worked out in code; the AI uses a result only for an attempt with real stakes.
- Where an event comes from: items can be marked {{char}}, another character or the surroundings. The driver is
  rolled first and only fitting items are picked with it. "Write items with AI" can write items for one origin.
- When lists that retire their items run out at different times, a used-up side list is left out of later events,
  and the set stops when its main list is used up. You are told once per chat, the set card shows what is left of
  each list, and "Bring the used items back" starts the set again in that chat.
- Hide what a chapter covers: after a chapter, the messages it covers are hidden from the AI except the newest 30.
  Deleting or swiping away the chapter's reply shows them again. No extra AI request.
- "What the AI is sent from this chat" now counts the messages in the finished prompt, after every other extension,
  so a limiter such as Message Limit shows up there.
- "Start a new chapter in a new chat" is also at the top of What Was Sent.

## 5.6.0 (2026-11-16)

Version 5, last step: the close-out.

- Replies are counted from the chat itself, hidden messages included. Timing, story phases, thread clocks and
  chapters keep counting when older messages are hidden from the AI.
- Settings > What the AI is sent from this chat: how many messages the chat has, how many are hidden from the AI,
  how many were handed on with the last reply, and a note when another extension left messages out.
- The source of the 40-message window seen on a TauriTavern tablet: World Info counts the messages it is handed,
  after hidden messages are taken out and after other extensions have changed the outgoing chat. TauriTavern 2.4.0
  itself hands on the whole chat (its own windowed loading was removed before that version).
- A note on pairings of "who does it" and "who it happens to" that leave the AI little to work with, and one line
  of advice on a version that disagrees with "who does it". Both are notes, and saving stays allowed.
- The AI writer's "story so far" choice uses the extension's own chapters when the chat has them, and a summary
  kept by SillyTavern when it has none.
- README rewritten as one guide to Version 5, with a table of everything that makes an AI request.

## 5.5.0 (2026-11-16)

Version 5, sixth step: pacing and style.

- Story event items can wait: for an open thread, a kept secret or a plan in the story world, or for a number of
  characters in the scene. What the item waited for is written into it (`[thread]`, `[secret]`, `[plan]`). An item
  that waits for a thread gets the one that has gone longest without moving.
- A story event set can be marked big. After a big event has happened, nothing new starts for a set number of
  replies. An open thread coming to a head counts as big.
- With a story world, a character who has been in the scene for a set number of replies and is named in the story
  text of none of them is ordered to speak or act.
- Story phases by reply number (off to start with): each phase scales the chance that something new starts and can
  send one line of its own.
- A writing style item can add three things while it is the pick: a sentence for story events, a question about the
  reply that rides along with the check, and a note for the reply after it.
- Settings > What the AI writes for you: rules given to the AI writer in plain words, and a word list that flags
  unwanted words where you review text. Both are yours to change.
- The lists a new writing style set starts with were reworded in plain language.
- What Was Sent shows the story phase, why a reply was kept silent, and the answers to the style's questions.

## 5.4.0 (2026-11-16)

Version 5, fifth step: the story so far, a new chapter, and a starter world.

- The story so far is kept in chapters inside the story world. A chapter is written with one AI request when a scene
  ends, after a set number of replies, or when you press "Write a chapter now". The request is made after the reply
  has arrived and is listed in the Log tab.
- The story notes start with "The story so far": the newest chapters in full, older ones in short when someone or
  somewhere in them comes up, within room of its own. When chapters pile up, the older ones are combined into one
  account with one AI request.
- What is finished moves into the chapter: settled threads, secrets that came out, planted details that paid off and
  finished things elsewhere are written into it in one line each and turned off. This can be turned off.
- A chapter belongs to the last reply it covers. Deleting or swiping away that reply removes the chapter and turns
  back on what it had taken in.
- "Start a new chapter in a new chat": one AI request writes a very detailed summary and a first message, both shown
  for you to change. A new chat then opens that brings along the story world, the sets that are on, the goal with its
  finished steps, the pronouns, locked picks, what has already happened for good, the summary and the first message.
  The chat you were in is left as it was.
- "Fill this world from the character card": one AI request reads the card, your persona, the card's own lorebook and
  the opening message, and proposes entries. Nothing is added until you say so.
- A warning in the Story World tab when SillyTavern's own Summarize is also putting a summary into the prompt.
- In the Story World tab the chapters are listed last, right above their settings.

## 5.3.0 (2026-11-16)

Version 5, fourth step: the story world keeps itself up to date.

- With each reply the extension asks for one short block that records what the reply made true. The block is taken
  out of the reply and filed in the world: new people, places, groups, threads, secrets and planted details, what
  people now want, plan and know, threads that moved, secrets that came out. No extra AI request is made.
- The request lists the names on file, and a name that matches an entry is never added twice. In entries you wrote,
  only the lines that change with the story are kept current. Any entry can be set to stay as written.
- Everything filed is marked "Added automatically", listed in What Was Sent under the reply that caused it (with
  "Undo these changes"), and written to the Log tab. Swiping a reply away or deleting it undoes what it filed;
  swiping back files it again. A continued reply keeps what its first part filed. Out-of-character turns file
  nothing.
- Open threads build by themselves after a set number of replies with no movement.
- Now and then one ready thing is ordered into the scene: a thread about to come to a head, a planted detail,
  something going on elsewhere, or (off to start with) a kept secret. It counts as the one new thing per reply and is
  checked like any instruction. When it happens the entry moves on.
- Open threads have a new line, "What happened last".

## 5.2.0 (2026-11-16)

Version 5, third step: a story world, sent for who is present.

- Story World tab. A chat can have a story world with seven kinds of entry: characters, places, groups, open threads,
  secrets, planted details and things going on elsewhere. Entries are written by hand or with one AI request each.
- Story notes. Before each reply the extension reads who is in the scene from the newest reply (a scene header, a
  HUD, or a "Present:" line; with none of these, names in the last messages) and sends the entries that matter as
  one block. No AI request is made for this.
- Open threads and what is going on elsewhere are always sent. People in the scene are sent in full, then the place,
  their secrets, planted details and anything else the last messages name. A setting gives the notes a number of
  tokens; people are shortened and extras left out when room runs out.
- A kept secret is sent as one line, or in full with an order to keep it. A secret that is out is sent in full.
- The tab shows who was read as present and exactly what would be sent. What Was Sent shows it for every reply and
  lists people the scene named who have no entry yet.
- A world is a set like the others: it can live in the shared lorebook or in one of its own, and it can be moved.
  With the extension on, a world's entries go out only inside the notes block and only in the chat that uses it.
- Design note: TunnelVision's source code was read before this step. What it does with extra AI requests (retrieval,
  writing, maintenance) is done here in code or left for the model's own reply.

## 5.1.0 (2026-11-15)

Version 5, second step: one lorebook or many.

- Where your sets are kept. A new section in Settings. Every set can be kept inside one shared lorebook, or each in
  a lorebook of its own, and you choose set by set which ones share. Instruction sets, story event sets and writing
  style sets can all live in the same lorebook.
- A new install keeps everything in one lorebook named "Roleplay Instructions". An install that already has sets
  stays as it is until you change it.
- Move a set with one choice. Every entry is copied whole (versions, timing, notes), and each copy remembers the key
  it had before. Waits carry on, "only once" stays retired, used story event items stay used, versions keep taking
  turns, and a chat that had the set on still has it on. A lorebook the set leaves is left exactly as it was.
- Inside a shared lorebook each set is still turned on or off per chat, keeps its own per-reply limit, and counts
  toward "One thing per reply". Entries in that lorebook that belong to no set are left to World Info.
- Each set card says where the set is kept. Export gives one set as a lorebook file of its own. "Open a lorebook" on
  a shared lorebook adds every set kept inside it.
- With the extension off, a shared lorebook turned on in World Info works as an ordinary lorebook.

## 5.0.0 (2026-11-15)

Version 5, first step: one thing per reply, and burn after it happens.

- One thing per reply. A new setting, "How many new things can start in one reply", counts across every
  instruction set, every story event set and the goal task together. The default is 1. When more are ready, one is
  picked at random and the others wait for a later reply. Something already under way (kept for more replies, or
  sent again because it did not happen) uses up the room first. Writing style and the goal line are always sent,
  because they are how the reply is written. 0 turns the cap off.
- Only once per chat. A new choice on every instruction. Once it has happened in a chat it is retired and never sent
  again in that chat. With checking on, it retires when the check finds it happened; with checking off, when it is
  sent.
- Retire an item once it has happened. A new choice on every list in a story event set. A used item never comes back
  in that chat, and when a list is used up the event stops. New story event sets have it on for Situation and
  Complication.
- Both are worked out from the records on the replies that still exist, so deleting or branching away from the reply
  where something happened makes it available again.

## 4.1.2 (2026-11-15)

- Fixed: SillyTavern sometimes scans World Info a second time while a reply is being written, to count tokens for
  its prompt list. With a large preset (found with Sola V6) that second scan could arrive first or replace the
  state of the real reply. For that reply the extension stepped aside: lorebook entries went out as stored, with no
  limits, no picked version, no record in What Was Sent, and the line about {{user}}'s words on every note.
  Now only real generations are tracked, the first scan of a reply decides what is sent, and any later scan of the
  same reply gets exactly the same notes.

## 4.1.1 (2026-11-15)

- The line "{{user}}'s words, choices and thoughts are theirs to write." was added to every note, so a reply with
  several notes repeated it each time. It is now said once per reply, on the last note. What Was Sent shows the
  text exactly as it went out. Stored lorebook entries still each end with the line, so a set keeps working with
  the extension off.

## 4.1.0 (2026-11-15)

Flags instead of hard stops, a Log tab, and real reasons when AI writing fails. From tablet feedback.

- "Must fix" is gone for {{user}}. A version, item or task where {{user}} may be acting is marked "Check". It starts
  unticked in the AI review, you can tick it, and it saves. Only an empty version still stops a save.
- The check itself is much narrower. {{user}} is flagged only as the subject of the order (at the start of a
  sentence, or joined to the subject with "and"), when made to speak or decide, or when the order asks for
  {{user}}'s reply or thoughts to be written. "The bridge under {{user}} must crack", "{{char}} must ask what
  {{user}} wants" and "before {{user}} can react" are clean. Before, almost any {{user}} followed by a verb was
  flagged.
- In Random Story Events, a list that drives the event flagged every item that named {{user}}. Now only an item
  that is {{user}} themself is flagged; "{{user}}'s landlord" is clean.
- New Log tab: every request to the AI (versions, items, goals, the reply check) with the connection used, the room
  for the answer, how long it took, what was sent and what came back. Copy, save as a file, clear. Kept on the
  device, last 120 requests.
- Failure messages say what happened: an empty answer, a model that used its whole room on thinking, an answer that
  could not be read (with how it began), every version matching one you already have, or the connection's own error.
- SillyTavern reports an answer with no text as "No message generated". That is now treated as an empty answer and
  tried once more with more room. When the second try works, "Give the AI more room to answer" turns itself on in
  Settings, so later requests work the first time. The setting can also be turned on by hand for models that think
  before they answer.
- Thinking that was cut off before its closing tag is removed from answers.

## 4.0.0 (2026-11-15)

Version 4: Character Goals.

- New tab: one goal for the character per chat, one-time steps and repeatable actions.
- The goal goes with every reply. At most one task at a time, with the chance you set.
- One-time steps finish in any order and are ticked off when the check finds the words that show it. A step that
  was sent is sent again with every reply, as Overdue and then Final, until it happens.
- Repeatable actions are sent for one reply and then wait a number of replies. They are not checked.
- Write a goal with AI (goal, 5 steps, 5 actions), shown in full for review.
- Warnings keep tasks short and loose (8 words, no place, time or object).
- A list of saved goals to reuse in other chats; "start the next goal from my list" when a goal is done.
- What is done is read from the replies, so deletes and branches rewind it.

## 3.2.0 (2026-11-15)

- "What to show the AI" when it writes versions or items: character card, scenario, your persona, chat summary,
  the most recent chat messages (you choose how many). Tick any of them; the choice is remembered. Before, one
  switch sent the card, scenario and persona together and nothing from the chat.
- Who does it / Who it happens to: three new choices that leave "already in the story or new" open: any
  character, any female character, any male character (other than you). New story event sets offer the same
  three under "Who drives it".

## 3.1.0 (2026-11-15)

Everything that was left out of 2.0.0 and 3.0.0, for story events and writing style alike.

- "Never together": pairs of tags that are never picked in the same roll.
- Saved category settings under a name, with a per-chat choice of which one to use.
- "Chance to change once that time is over" for categories that keep a pick for a random time.
- What Was Sent: Pick again, Lock for this chat and Keep until I turn it off on every picked item.
- Rules checked without AI from `rule:` tags (no dialogue, mostly dialogue, sentences per paragraph, word count).
- Warning on writing style items that read like story happenings.

## 3.0.0 (2026-11-15)

Version 3: Random Writing Style.

- New tab with writing style sets. One style order is sent with every reply while a set is on for the chat.
- Eight starting categories: {{char}}'s mood, Prose style, In the manner of this author, Writing habits, Sense to
  lead with, Pacing, Rule for this reply, Point of view and tense (locked).
- Each category has its own timing in replies: keep one item, keep for a random number of replies, or new every
  time; plus a chance to sit out and a rest after each pick.
- "Words added after the pick" per category, used by mood to say how the mood applies.
- The style order carries a scope line (story prose only; formatted blocks keep their format) and "a required
  instruction wins over any style choice".
- Style is recorded in What Was Sent, is not checked by AI, keeps going while an instruction is overdue, and
  stays outside per-reply limits.
- Write items with AI for style categories, with a description of each starting category for the AI.

## 2.0.0 (2026-11-15)

Version 2: Random Story Events.

- New tab with story event sets: categories of short items, saved as a lorebook.
- Dice pick from every category that is on. Per category: new pick every time, keep for a random number of events,
  or keep one chosen item; items per pick; use every item before repeating; wait before an item returns; never
  use tagged items; always-include items; weights.
- Write items with AI for one category from a few words about the story.
- "Roll an example event" shows the exact text the AI would receive.
- Events use everything from Version 1: timing in replies, per-chat on and off, the check with re-sends, What Was
  Sent (now with what the dice picked), swipes repeat, deletes and branches rewind the rotation.
- The lorebook entry holds a `{{random}}` list per category, so a set still gives plain random events with the
  extension off.

## 1.1.0 (2026-11-15)

- Timing ("keep sending", "wait", "do not send before reply") is now done by the extension from the records on the
  replies. Found on a TauriTavern tablet: World Info was handed a fixed window of 40 messages, so its own sticky
  and cooldown counters never advanced. Timing now works in chats of any length and with any summarizer or
  context limit, and follows swipes, deletes and branches exactly.
- A reply that carried no instruction is recorded too, so swiping it sends nothing again.
- Tests run with and without a message window.

## 1.0.1 (2026-11-15)

- Deleting messages or opening a branch now brings the waiting list and the timers in line with the chat as it
  stands: re-sends that belonged to deleted replies are dropped, timers started by deleted replies are cleared,
  and the state of the newest remaining reply is restored.
- Editing the newest reply checks it again. New button: "Check this reply again".
- Swiping a reply after deleting later messages repeats that reply's own instructions.
- New button on the waiting note: "Do not send these again".

## 1.0.0 (2026-11-15)

First release. Version 1: Random Instructions.

- Instruction sets saved as ordinary lorebooks; open any existing lorebook as a set.
- Instruction editor: name, when it can be sent, chance, keep sending, wait, start reply, Only-one group,
  Send-together group, sent as, placement, who does it, who it happens to, versions, notes.
- Write versions with AI from one sentence, with review, name swapping and checks.
- Checks on every version: {{user}} acting (blocks saving), optional wording, figurative or vague wording, real
  names, matches for your regex scripts.
- Names and pronouns as placeholders, set per chat and remembered per character and persona.
- How many instructions can be sent per reply: no limit, one per reply, one Send-together group per reply, at
  most N per reply.
- Versions cycle without repeats. Swipes, regenerate and continue repeat the same instructions.
- Check that it happened, with the words from the reply that show it. Missed instructions are sent again with
  Overdue and then Final wording.
- What Was Sent tab, and an optional section under each reply (display only, or saved in the message).
- Blue and green colour scheme in the Neon Sola card style, with an accent colour setting.
