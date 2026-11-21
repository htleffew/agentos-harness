# Roleplay Instructions for SillyTavern and TauriTavern

Roleplay Instructions is an extension for running a continuing story in character chat. It can schedule writing directions and story events, keep a chat’s world facts and character state, summarize older messages into chapters, and help carry the story across swipes, branches, and new chats. The optional **Roleplay Instructions V10 companion preset** supplies writing and formatting prompts through the host’s Prompt Manager. The extension and preset can be installed, configured, and updated independently.

This guide describes the `roleplay-instructions-v10` branch and extension manifest version **10.0.32**. Control names follow the extension’s interface. **Host** means SillyTavern or TauriTavern. **Preset** means the host’s active AI response preset. **Module** means a functional part of the extension controlled in **Setup → Preset & Extension**. **Story World** with capitals means the extension-managed World Info book for the current chat. [Version history](CHANGELOG.md) · [Manifest](manifest.json) · [Interactive preset and extension audit](docs/ui-audit-10.0.27.md)

## Contents

- [Install and configure](#install-and-configure)
- [Quick actions](#quick-actions)
- [Interface map](#interface-map)
- [Workflow and prompt ownership](#workflow-and-prompt-ownership)
- [Response length and writing guidance](#response-length-and-writing-guidance)
- [Openings, scene state, and story time](#openings-scene-state-and-story-time)
- [Character continuity](#character-continuity)
- [Reply display, streaming, and the Roast](#reply-display-streaming-and-the-roast)
- [World Info books and recall](#world-info-books-and-recall)
- [Chapters, context, and historical catch-up](#chapters-context-and-historical-catch-up)
- [Corrections, swipes, edits, and branches](#corrections-swipes-edits-and-branches)
- [Random Instructions](#random-instructions)
- [Random Story Events](#random-story-events)
- [Random Writing Style](#random-writing-style)
- [Character Goals](#character-goals)
- [Pacing and dice](#pacing-and-dice)
- [Prompt editing and Write with AI](#prompt-editing-and-write-with-ai)
- [What Was Sent and the Log](#what-was-sent-and-the-log)
- [Runtime and persistence](#runtime-and-persistence)
- [Troubleshooting](#troubleshooting)
- [Source and verification](#source-and-verification)

## Install and configure

1. In the host, open **Extensions → Install extension**. Use repository URL `https://github.com/htleffew/agentos-harness` and branch `roleplay-instructions-v10`. Reload the host after installation. The manifest declares SillyTavern 1.19.0 as the minimum host version and lists no dependencies. Extension updates are manual by manifest setting.
2. Open a character chat and go to **Extensions → Roleplay Instructions**. Switch the extension on. Select **Expand** for the full-screen panel. The open chat supplies the character, persona, and chat-specific settings.
3. To use the companion, import [`Roleplay Instructions V10.json`](presets/Roleplay%20Instructions%20V10.json) in the host’s **AI Response Configuration** preset menu and select it for the Chat Completion API. Open **Setup → Preset & Extension** to confirm which preset and workflow the extension resolved.
4. To keep the writing, rendering, and other roleplay prompts of Vexa or another preset, select **Memory only** under **Story workflow for this chat**. Use the individual memory switches to choose recall, chapters, and hiding. See [workflow and prompt ownership](#workflow-and-prompt-ownership) for what continues to run.
5. For a new story, assign any existing lorebooks from **Story → Reusable Lorebooks**, then open **Story → Opening** if you want to select a character-card greeting or generate one. For an existing conversation whose prior messages need to be filed, open **Review → Context & Memory → Catch up or rebuild this chat**.
6. Send a normal chat message. Use **Review → What Was Sent** for the reply’s receipt. Select **Setup → Reply Display** to choose what appears beneath replies. To try a scheduled direction, open **Direction → Random Instructions → Add instruction set**, add and save an instruction with at least one version, and enable the set for this chat.

The extension requests and files generated story state only under the applicable workflow and modules. Installing the extension alone leaves existing replies without generated receipts. [Extension entry point](index.js) · [Memory components](src/components.js) · [Panel navigation](src/ui/panel.js)

## Quick actions

Open **Quick actions** beside the chat composer. The same sheet opens for a specific reply from **Generate an alternate reply** or **Continue this reply** below that reply. Use one active host preset. The companion and other presets enter through the same controls.

| Action | What it does | Requests |
| --- | --- | --- |
| **Steer the next reply** | Pick a saved direction, browse or roll from sources, or enter your own. Queue private guidance, visible OOC, or a required direction. Review exact wording in **Pending directions** before sending a player message. | Uses the next ordinary reply. |
| **Generate an alternate reply** | Select the reply and swipe, add optional cues or wording, and generate an alternate. **Fix world facts** checks supported source evidence. Use **Corrections** for manual edits, source history and Undo. | The latest supported reply uses a host swipe. An older reply uses one disclosed helper request. The local fact audit uses code. |
| **Continue this reply** | Append to the selected swipe and use **Undo continuation** to recover the earlier text and effects. | The latest supported reply uses a host continuation. An older reply uses one disclosed helper request. |
| **Draft my reply** | Inspect the impersonation prompt, draft your own contribution, or request three playable choices. Edit a result before placing it in the composer. **Recover previous composer draft** restores the prior text and selection. **Recent drafts and choices** reopens earlier results from this chat for editing. | One request per draft or choice batch. Expanding a choice is a separate request. Editing, restoring and using wording run in code. |

Use **Browse directions** for exact versions, scoped rolls, and source owners. Pin directions in a chat for quick access. **Customize** opens selection mode so a favorite can be combined with additional cues and free text. **Manage quick actions** opens button editing, ordering, named variations, import and export, restore, and Undo. A reviewed import can translate supported Keel definitions into extension actions. Other imported material remains available as data. Queue entries keep the wording chosen when queued. [Quick actions handoff](docs/quick-replies-implementation.md)

An ordinary reply consumes its bound directions once. If it fails, open **Pending directions** and retry that reply. The original player message keeps one copy of any visible OOC and a new composer draft stays available. The reply receipt shows which required directions were sent and whether it found matching prose evidence. Changing the accepted swipe also changes the evidence and story effects that are active.

**Fresh start** applies to an explicit action or the next five accepted forward story replies. Its disclosure describes whether the host replaces earlier story prose with factual context or retains it. The countdown lives in its chat and has a Stop control. **How it ran** shows route, attempts and outcome. Use **Setup → Settings → Model request settings** to save a connection for each function and opt in to any background work. Named profiles use the host’s Connection Manager service. When that service or a selected profile is unavailable, the affected action keeps its draft and links to its saved connection setting. [Prompt assembly standard](docs/prompt-assembly-standard.md)

The latest six story replies form the default editable memory window. They contribute to effective recall before their automatic changes are filed in the physical Story World. Existing filed material and manual locks survive migration. **Review → Context & Memory** shows filing state and controls. With an explicitly enabled 20-filed-reply chapter threshold, the first automatic summary qualifies at accepted reply 26 in a fresh chat. **Direction → Writing Guidance → Reply screening** controls optional same-reply findings. **Notes** shows current evidence and any one-use writing guidance without a separate screening request.

Chat Completion and Text Completion support queued delivery when the host exposes the outgoing player message and the assembled prompt. Text Completion reports retained prose where the host lacks request-local history replacement. Use **Choose JSON file** to open the host picker or **Paste JSON instead** for library imports. Native file picking and downloads depend on the browser or app. Preset restore identifies the stored source as an extension snapshot, a supplied original file, or a host default when exposed. See the verification record for device, provider and host coverage. [Quick actions verification](docs/quick-replies-verification.md)

## Interface map

The first panel visit opens **Current State** for an active chat or **Preset & Extension** without one. The page heading shows where you are. **Find a tool** searches task names and common terms such as “fix a fact,” “swipe,” and “connection.” **Back** returns to the previous task or to the chat control that opened the panel. From **Review this reply**, the panel opens that reply’s current version.

| Group | Page | Use it for |
| --- | --- | --- |
| Story | **Opening** | Select a primary or alternate greeting or write a guided opening with AI. Edit opening prompt guidance and inspect the story setup. |
| Story | **Current State** | Inspect and edit the active scene and character snapshots. Set event tag limits and inspect current story review state. |
| Story | **Corrections** | Record the corrected fact, inspect its sources, optionally ask AI to prepare targeted source edits, and regenerate a reply with the correction. |
| Story | **Reusable Lorebooks** | Assign imported or existing books by role, configure their eligibility, and manage entries and associated books. |
| Story | **Chat Facts** | Inspect structured facts and other durable records that describe the active chat’s world. |
| Story | **Plot Records** | Inspect arcs, seeds, agendas, events, their current status, and related state. |
| Story | **Story World** | Create or select the managed story book, edit native story entries, inspect upcoming recall, manage summaries, and start a new chapter. |
| Characters | **Portrayal & Knowledge** | Inspect and edit character profiles, fidelity guidance, and knowledge records. |
| Characters | **Emotions & Relationships** | Inspect and tune emotional dimensions and recovery and edit relationship records. |
| Characters | **Character Goals** | Set a character goal, one-time steps, recurring actions, and completion behavior for this chat. |
| Characters | **Dialogue Colors** | Inspect existing assignments and edit the color for each character. |
| Direction | **Random Instructions** | Schedule an instruction, set timing and text triggers, and write or edit its versions. |
| Direction | **Random Story Events** | Build weighted event lists, filter items, experiment with example rolls, and configure set pacing. |
| Direction | **Random Writing Style** | Assemble prose directions from rotating style categories. |
| Direction | **Writing Guidance** | Edit ongoing prose instructions and scene checks, choose a writing profile, and show prose measurements. |
| Direction | **Action Checks** | Queue or clear a one-shot action check in the structured workflow. |
| Review | **What Was Sent** | Inspect reply receipts, lore selections, injected text, checker results, and story changes. |
| Review | **Context & Memory** | Set summary intervals and retained raw context, catch up or rebuild, and inspect observed prompt size. |
| Review | **Log** | Inspect extension-initiated AI requests, diagnostics, and failures. Copy, export, or clear the log. |
| Setup | **Preset & Extension** | Inspect the active host preset, choose a workflow, and manage memory and module settings for this chat or preset. |
| Setup | **Reply Display** | Control extension overlays, header, story cards, progress, receipts, and Roast display and prompts. |
| Setup | **Settings** | Select AI connection, pronouns, set storage, writing defaults, checker, pacing, and legacy options. |

[Navigation source](src/ui/panel.js) · [Setup UI](src/ui/v10.js)

## Workflow and prompt ownership

| Workflow in **Preset & Extension** | Behavior |
| --- | --- |
| **Follow active preset** | On Chat Completion, a preset named `Roleplay Instructions V10` or `Roleplay Instructions V10` with numeric dot suffixes uses the structured workflow. Other preset names resolve to the legacy workflow in this setting. |
| **Structured story workflow** | Runs enabled extension story features through the V10 structured format. Selecting this explicitly allows a different preset name while keeping the structured extension workflow. Some integrations depend on the generation hooks the host exposes. |
| **Legacy story workflow** | Runs extension features using the pre-V10 scene, world-update, character-card, and optional dice formats. Useful with presets already configured around those formats. |
| **Memory only** | Runs the memory components you enable. The host preset owns the writing, planning, and rendering. Extension directions, action checks, state generation, and reply cards stay out of its story workflow. |

**World Info recall**, **Chapter summaries**, and **Auto-hide summarized messages** are separate memory switches. Auto-hide requires chapters to provide saved coverage. Turning it off restores messages the extension hid. The host’s World Info activation, prompt settings, context limits, and other installed extensions can still affect the request. [Workflow resolution](src/components.js) · [Structured workflow](src/v10.js)

**Extension modules** affect the structured workflow. A value saved in **This chat** takes precedence over an extension default under **Extension defaults for this preset**, which in turn takes precedence over the built-in extension default. Resetting a chat setting removes its override. The chat button **Use extension default for this preset** follows the extension settings for the active preset’s name. In the defaults view, **Use extension factory default** restores the value shipped with the extension. Host preset text has its own controls in Prompt Manager. [Module settings](src/v10.js) · [Setup interface](src/ui/v10.js)

| Module | Built-in structured default | What it changes |
| --- | --- | --- |
| Live writing guidance | On | Adds effective prose and pacing guidance. The companion has its own writing blocks, and paired defaults keep extension guidance shorter. |
| Scene and character checks | On | Adds the scene-specific continuity and craft checks the extension is responsible for. This runs in the response request. |
| Story, scene and character state | On | Requests and recalls scene, snapshots, profile, and fact data. |
| Character knowledge | On | Requests and recalls character-specific knowledge records. |
| NPC emotion scales | On | Requests and recalls emotional axes and associated behavior. |
| Relationships | On | Requests and recalls brief relationship changes. |
| Arcs, seeds and off-screen agendas | On | Requests and recalls plot records, prerequisites, timing, and progress. |
| Autonomous world events | On | Can schedule an optional opportunity. The reply must establish what actually occurs. |
| Explicit action checks | On | Resolves a queued check in code and supplies its outcome to the model. |
| Dialogue colors | On | Assigns and renders persistent character colors when the prose identifies a speaker or thinker. |
| Roast generation | Off | Requests a short commentary field in the normal story response. |
| Roast feedback in future prompts | Off | Includes recent Roast excerpts as writing guidance in later turns. |

### Edit the active preset and compare instruction sources

Open **Setup → Preset & Extension → Host preset → Edit preset blocks and pair extension modules**. The list follows SillyTavern’s active global Chat Completion prompt order (ID `100001`). **Find a preset block** filters by block or matched module name. **Available outside the prompt order** lists other definitions in the preset. Turning one on places it at the end of the active order. The edit controls save to the selected native preset, which is shared by every chat using that preset.

| Task | Control and effect |
| --- | --- |
| Edit a preset block | Expand its name, change **Preset instruction**, name or message role, then choose **Save preset block**. **Placement and generation triggers** controls relative placement or fixed message depth, priority and applicable generation types. At fixed depth, zero is after the newest message. An empty trigger selection allows all generation types. Host markers such as Chat History show their source and support activation and reordering. |
| Move or add | **Move up** and **Move down** change the native preset order. **Add a preset block** creates an enabled system instruction at the end. Use its editor to change its role or placement. |
| Restore a preset block | **Edited** identifies a block with a saved baseline. **Restore original preset block** returns that block to its wording, settings and relative place before its first extension edit. For an imported preset this gives you the version you started editing. Restoring an extension-added block removes it. Other blocks keep their edits. |
| Pair functions | Open the block’s **Choose matching extension modules**, select any counterparts and press **Save matches**. Known companion identifiers and names from the three reference presets supply initial matches. One preset block may cover several modules. A suggested match indicates related subject matter. Read the wording to judge coverage. |
| Choose what runs | In Structured workflow each matched module offers **Both off**, **Preset only**, **Extension only**, and **Both on**. The control sets the displayed host block for the shared preset and the entire extension module for the chat. Other host blocks that mention the same subject keep their individual settings. **Both on** explicitly permits overlap. Native depth, triggers, available context and module conditions still govern a particular reply. **Reset extension activation to default** resumes the extension’s usual ownership and inheritance. |
| Edit extension behavior | Open **Edit extension instructions** beside the pair. Edit and restore each template separately. A template badge shows **Default** or **Customized**. Templates apply across chats. The separately labeled live writing and scene-check guidance overrides apply to the current chat. The extension assembles required data fields, rolls, reads and writes in code. |
| Move extension guidance | **Extension instruction order** changes this chat’s ordering within the structured guidance and returned-field sections. **Restore module position** moves a module back to its built-in position. **Restore extension order** restores the original assembly order. Native preset placement and extension request assembly use separate order controls. |
| Ask for a comparison | **Compare preset and extension with AI → Compare with one model call** sends block names, excerpts and extension guidance to the current connection. Larger presets share an excerpt budget across the blocks. The result lists suggested matches and reasons. **Use this match** saves an association. You choose activation separately. The comparison instruction has its own editor and restore button. |

The older **Preferred instruction source** controls remain available in **Extension modules**. With automatic ownership, a recognized active Vexa block can suppress the corresponding extension module. Choosing the explicit four-way setting in a block lets you override that behavior. **Review → What Was Sent** shows evidence from the assembled request. [Preset editor](src/ui/preset-workbench.js) · [Native preset writes and comparison](src/preset-workbench.js) · [Extension order](src/module-layout.js)

The companion includes host markers for World Info, persona, character description and personality, scenario, examples, and Chat History. Its enabled craft blocks cover viewpoint and player agency, cast and motivation, scene pacing, prose, consequences, decisive NPCs, recurring NPC creation, voice continuity, length, and a same-reply quality pass. Its slow-burn profile, player-limited viewpoint, and four specialized checks are optional and initially off. Importing the companion does not import Vexa’s complete set of prompts or its rendering scripts. [Companion prompt order and text](presets/Roleplay%20Instructions%20V10.json)

## Response length and writing guidance

**The companion preset supplies the normal reply-length targets.** Open the extension’s preset block editor or the native Prompt Manager and edit **Turn length & dialogue balance** (`ri-craft-length`). It asks for 400–600 words with one or two spotlight characters, 500–700 with three, and 600–750 with four or more. Its dialogue target is about 70% when supported by the scene. These are instructions in natural language. The provider’s output budget and stop conditions determine how much can actually be generated. The companion import leaves **Max Response Length (tokens)** to the host settings. Keep enough output room for the visible prose and any enabled structured update. [Companion preset](presets/Roleplay%20Instructions%20V10.json)

| If you want to change | Edit or inspect |
| --- | --- |
| Ordinary reply word target or dialogue balance | Host Prompt Manager → **Turn length & dialogue balance** in the companion, or the corresponding block in your host preset. |
| Hard output-token limit on a normal reply | Host **AI Response Configuration → Max Response Length (tokens)**. The provider can impose a lower cap. |
| Extra guidance the extension adds about prose | **Direction → Writing Guidance**. Enable **Live writing guidance** to use it. |
| Visible word count and dialogue share of a reply | **Direction → Writing Guidance → Show turn length and dialogue share**. This measures rendered story prose and adds no generation step. |
| Generated first greeting | **Story → Opening → Opening message guidance**. Default approximately 350–650 words. Imported greetings keep their original text when selected. |
| Opening for a new-chapter chat | The new-chapter opening prompt. By default it asks for 150–300 words and a separate 300–500-word handoff summary. |
| An ordinary chapter summary or combined older summary | Chapter-writing prompts. The usual default is 80–160 words for one chapter and 200–350 for a combined summary. |

**Writing Guidance** can carry shared style wording and a realism profile. Grounded and heightened profiles adjust how plausibility, consequences, and scene intensity guide prose. Physical realism, social realism and character fidelity, pacing and prose, and information and continuity are individual checks. The scene router supplies guidance for one identifiable NPC, an ensemble, an unknown cast, or an opening. The guidance asks for player agency, character-specific speech and choices, ordinary recovery from brief setbacks, scene-dependent pacing, and an ending that leaves the story in motion. Configure subject-specific defaults in the extension where they are used and edit the companion’s craft blocks in the host. [Guidance and checks](src/v10.js) · [Editable prompt templates](src/prompts.js)

## Openings, scene state, and story time

### Choose or generate a greeting

Open **Story → Opening** in a new character chat. **Greeting source** offers the primary character-card greeting and available alternatives. Selecting a greeting fills the preview with its prose. **Read state from selected greeting** asks the model to extract scene data from the greeting without composing a different opening. **Use this opening** applies the selected text and can also read its state if it has not already been prepared. To make a new greeting, enter an optional direction and choose **Generate opening**. Leaving the direction blank lets the model choose the situation within your character, persona, and established world. Review the draft before applying it. The opening prompt can specify viewpoint, tense, narrative density, word target, speech, and asterisk-wrapped NPC thoughts. Its default leaves the player’s speech, decisions, and thoughts to the player. **Allow the generated opening to write my character’s internal thoughts** is an explicit opening-only exception. [Opening generation](src/v10.js) · [Opening controls](src/ui/v10.js)

### Track and edit a scene

**Story → Current State** shows the current location, time, date, weather, cast, environment, and scene-relevant character snapshots wherever those fields are known. Edit a field here to change the current story state. A protected field carries forward as a user correction until you unprotect it. An unprotected edit follows the reply it is attached to. A historical reply’s snapshot can be edited with **Edit this scene snapshot** where offered. Choose whether the change applies to the historical snapshot alone or also to current state. For a change to actual story prose or durable facts, use the host editor or **Correct a fact**. [Snapshot implementation](src/state.js) · [Current State interface](src/ui/state.js)

### How time, date, and weather move

- The structured update can supply separate `where`, `when`, `time`, `date`, `weather`, `present`, and `environment` fields plus `elapsed` or `minutes`. The timeline keeps the story’s elapsed minutes separately from display text. Use a time skip in the prose or guided direction when time should move substantially. The prompt allows short advances for moment-by-moment scenes and longer advances for travel, sleep, or an uneventful period.
- When the previous scene provides a usable time or date anchor, the clock works from that anchor and the accepted update. In supported calendars it advances the numeric date and weekday together, including across midnight and month boundaries. For example, `Wednesday, Month 7, Day 14` rolls to `Thursday, Month 7, Day 15` after midnight. ISO/Gregorian and supported written date formats have their own parsing. Numbered yearless months use the standard month lengths with a 28-day February. With an unfamiliar fictional calendar, the extension retains the date anchor and records elapsed days so the model can continue that calendar. Set an explicit scene date if your world uses different calendar rules.
- Structured scene context feeds known time, date, location, and weather into later requests. On older scenes the formatter can recover date or weather from recognized Vexa, Sola, or Deus Ex Machina trackers and supported combined date/time/weather lines. It also preserves established fields through partial updates. A blank or vague newly generated timestamp cannot supply a precise date that the story never established. Edit the snapshot once to establish the missing anchor.
- The header is extension-rendered HTML showing **Time**, **Story date**, **Location**, and **Weather**. It can show an unknown or pending date when the source has no usable date. If a new chapter starts from a dated prior scene, the handoff carries the known anchor, and any new explicit chapter date takes precedence when allowed. [Clock arithmetic](src/story-clock.js) · [Reply format](src/reply-format.js) · [Chapter handoff](src/chapters.js)

## Character continuity

### What the extension remembers

| Record | Scope and use |
| --- | --- |
| **Scene snapshot** | Current conditions and present cast. Per-reply snapshots let you see the state as it was then. |
| **Mind / Heart / Body / Psyche** | Immediate focus, felt emotion, physical condition, and salient inner tension. Omitted fields keep relevant prior state. In structured mode a `null` update can clear a transient condition, and `bodyLasting: true` marks a durable condition. In legacy updates `CLEAR` clears applicable fields. |
| **Portrayal** | Durable aspects of a character such as voice, role, traits, motives, and established development. Structured character fields can retain their source baseline and offer **Restore source** where available. |
| **Knowledge** | Who knows or believes a particular thing. Structured basis values are `observed`, `reported`, `rumor`, and `belief`. Knowledge defaults to private. A character’s belief can differ from the story’s facts. |
| **Emotion** | Tenderness, fury, dread, and yearning on a 0–10 scale. A record can add the target, outward behavior, and a counterweight. Missing axes are allowed. |
| **Relationship** | A short description from one person’s perspective about another and changes that matter to a scene. The record is intentionally brief. |
| **Durable fact** | Something established in the story. A fact can link to a plot record and reference how it extends or updates the present application of a known Base World entry. |
| **Plot record** | An arc, seed, off-screen agenda, or event. Items can record status and when applicable prerequisites, parent arc, timing, location, payoff, or an established travel leg. |

Open **Characters → Portrayal & Knowledge** or **Characters → Emotions & Relationships** to inspect existing records and edit them. Use **Story → Chat Facts** and **Story → Plot Records** for the corresponding durable data. The manual record editor lets you add supported records and attaches an authored override to saved edits. When an authored field and an automatic proposal disagree, protection and baseline handling keep the user’s edit in effect until the user changes it or restores the available source. Short-lived snapshot edits and lasting facts have different lifetimes. In Current State, **Save a lasting fact to Story World** writes a chosen field of an existing character entry and asks before replacing existing text. [Record editor](src/ui/v10.js) · [Snapshots](src/state.js) · [Structured records](src/v10.js)

### Emotion tuning and recovery

**Characters → Emotions & Relationships → Emotion tuning** exposes **Baseline** (0–10, default 3), **Persistence in replies** (0–40, default 3), **Recovery per reply** (0–10, default 1), and **Sensitivity** (`flexible`, `subtle`, or `responsive`). The extension computes the prompt’s aged emotion values in reply units. Persistence controls how long values are carried before moving toward baseline. Sensitivity provides wording about the scale of change. A scene can still establish a sharp emotional turn. Brief physical setbacks have separate recovery behavior, and durable physical conditions are explicitly marked. A chapter handoff carries emotion ages so the move to a new chat does not reset all the decay counters. [Emotion and body state](src/v10.js) · [Chapter carry-over](src/chapters.js)

### Character color and narrative attribution

Open **Characters → Dialogue Colors** to inspect any assigned character and edit their color. Assignments follow a stable extension-side palette and can be overridden by the user. The extension uses ordinary dialogue such as `“You’re late,” Mara said.` and italic NPC thoughts with nearby attribution. It colors the attributable text in the rendered message using the saved character color. Narration keeps the host’s normal styling, and unclear attribution can keep the host’s default quote or italics style. New prose uses natural speaker attribution. The **Customize speaker attribution prompt** editor explains how the model can make attribution legible with ordinary narrative beats. This is a lightweight attribution heuristic, so editing ambiguous prose can produce more reliable results than changing the palette. [Attribution](src/dialogue.js) · [Color settings and rendering](src/ui/v10.js)

### Plot and autonomous opportunities

Plot records can store scheduling weight, spacing in replies, dependencies, an absolute story minute, and circumstances that need to hold before a payoff. A travel leg can carry origin, destination, departure minute, and a minimum duration if the story established them. The selector uses current story state and eligible records before passing an optional opportunity to the model. That choice is a candidate. An accepted update needs exact prose evidence to file a real outcome. Explicitly configured **Random Story Events** and **Random Instructions** can still issue a required direction under their own timing rules. [Structured scheduling and validation](src/v10.js) · [Random event engine](src/events.js)

## Reply display, streaming, and the Roast

**Setup → Reply Display** controls how extension data is shown. The extension renders each HTML card beside the editable message from a separate saved record. Use regular message edit for prose, the snapshot edit controls for scene fields, and the corresponding character or lore editors for lasting records.

| Surface | Content and controls |
| --- | --- |
| **Scene header** | Time, story date, location, and weather. Uses the known snapshot for the reply. |
| **Story state** | A collapsed reply console with the scene and available character/world records. Use **Auto**, **Always**, or **Off**. Auto is sensitive to existing trackers and available state. |
| **Preview and chips** | Summarize accepted changes and highlight available sections. Use the chips to jump directly to the associated view. |
| **Internal detail** | The console can show Scene, Portrayal, Emotions, Relationships, Knowledge, Facts, Plot, Changes, Notes, and character detail where data exists. It builds detailed content when opened. Existing replies can only display records available at that point in the timeline. |
| **Show arriving story sections** | Shows the reply cards taking shape during generation. The character fields, scene, emotions and story changes use the saved layout. Turn this off to keep only the Story state status line during generation. |
| **Show Reply planning** | Shows a collapsed disclosure for an emitted outline that the extension recognized. **Request a reply plan** under **Preset & Extension** governs the optional plan request with the companion. |
| **Show Roast cards** | Shows the separate, collapsed Roast when the accepted reply has commentary. Uses formatted text for supported emphasis and paragraphs. |
| **World Info under replies** | Shows the compact entry-selection receipt independently of prompt injection. |
| **Keep exact story guidance** | Retains observed extension guidance for inspection in What Was Sent. Affects diagnostic storage for future replies. |

A timestamp header or collapsed card can use the last known scene field. A card that never existed for the reply cannot be populated with a model-generated answer just by enabling its display. Older replies can have a partial view if their source records were never saved or cannot be reconstructed. The progress view moves through context, waiting, writing, receiving, filing, and ready. Blank bars mark fields waiting for content. A lit dot marks a section received from the current reply. The extension checks evidence and files the accepted reply before the cards become tappable. Optional sections can disappear if the model omits them or their contents fail validation. With streaming off, placeholders give way to the accepted cards when the response arrives. Reduced-motion displays retain status without the full animation. [Reply rendering](src/ui/reply-cards.js) · [Historical world view](src/reply-world.js) · [Streaming parser](src/stream-update.js) · [Progress UI](src/ui/reply-progress.js) · [Phone-width screenshots and interaction audit](docs/ui-audit-10.0.29.md)

**Roast controls are independent.** Turn on **Roast generation** to ask for a `roast` field using the normal response request. Turn on **Show Roast cards** to display any saved Roast. Enable **Roast feedback in future prompts** only when you want short excerpts from recent Roasts to influence future prose. Display alone sends no Roast text. **Roast** is the card. **Commentator voice** selects who reacts inside it. Under **Setup → Reply Display → Roast commentator voice and feedback**, choose Gremlin (the original v9 default), Velvet, Riot, Mystic, Scholar, Mad-scientist reader, Noir detective, Golden Age screenwriter or Cozy gamer. Expand the selected voice to read or edit its wording. **Customized** also appears in the picker. **Restore default** applies to this voice alone. The selection applies across chats to future Structured and Legacy Roasts. Legacy users can also reach the chooser under **Setup → Settings → Character cards**. The comparison, voice selection and feedback instructions have independent settings. A host model can omit or truncate the field. Its absence leaves the card empty, and the extension does not make a retry solely to fill it. [Roast prompt contract](src/v10.js) · [Roast templates](src/prompts.js)

**Plan handling.** The optional plan is a brief public outline emitted as part of the text response, separate from any provider reasoning channel. The extension recognizes its supported tags, removes the serialized outline and update data from ordinary prose, and handles recognized older tracker formats for import and presentation. There is no guarantee an arbitrary third-party tag or unclosed block can be separated without loss. [Reply extraction](src/reply-format.js) · [Generation integration](src/engine.js)

## World Info books and recall

With a Story World selected, use **Story → Story World → Jump to section** to focus a record category, the next-reply preview, or the chapter, recall, and update settings. **See this chat’s World Info books** opens the book inventory for removal, deletion and export. **Direction → Random Instructions → Use a lorebook as an instruction set** opens the separate instruction-set chooser.

### Book roles

| Role | Purpose and scope |
| --- | --- |
| **Base World** | One pinned snapshot of a selected or imported host book per chat. Use it for pre-story history, established people and places, world rules, or shared canon. Pinning preserves the source’s native trigger configuration. Automatic filing targets the Story World rather than the pinned source. |
| **Behavior & Guidelines** | Multiple reusable books for writing guidance, behavioral rules, and nudges. Each assignment has a chat-level enable switch and can use extra module, character, and location scopes. |
| **Knowledge & Reference** | Multiple reusable books for categories of facts such as locations, people, politics, or customs. Each book can carry its own native entry activation settings. |
| **Story World** | The managed book associated with this chat. Holds confirmed new facts, character and place entries, chapters, and plot state. Open separate views for chat facts and plot records without needing multiple manual copies of that book. |
| **Instruction, event, and writing-style sets** | Shared or individual lorebooks that store the extension’s scheduled sets. Their extension timing controls are managed in the matching Direction page. |
| **Other associated books** | Host-selected, earlier chapter, branch, or previously associated books can appear in the inventory when the host or saved receipts expose them. A historical receipt records past selection, while current assignments govern eligibility. |

[Book inventory](src/chat-books.js) · [Assignments and Base World](src/v10.js) · [Story World storage](src/world.js)

### Assign, edit, and remove books

1. Open **Story → Reusable Lorebooks**. Under **Base World**, choose an existing book or **Upload and assign Base World** from a native JSON export. **Refresh pinned copy** re-reads the source. Clear the assignment by removing it from this chat.
2. Under **Guideline and reference books**, select the role and use **Assign book**, **Upload and assign books**, or **Create and assign**. Each assigned book has an enable/pause control and an **Unassign** action. **Copy to Random Instructions** is offered for guideline books. It copies usable entries into editable scheduled instructions and leaves the source book available. Pause or unassign the source if the scheduled versions should be the only route.
3. Find **World Info books for this chat** under the lorebook management pages. Open a book in the host, export JSON, or expand **Edit or delete entries**. In an entry you can review or edit its content and supported recall settings. Select entries for bulk changes or deletion. Blank chance, sticky, and cooldown fields in the bulk form preserve the existing values. Per-entry summaries are the place to verify actual imported timing.
4. Use **Remove from this chat** to detach an active association. The inventory can suppress host recall of a removed book for this chat when applicable. **Allow host recall again** clears that exception. **Hide from list** and **Show hidden books** affect the inventory only. **Delete book everywhere** removes the shared host book and requires confirmation. That action can affect every chat that uses it. Export first when you want a copy.

Direct entry edits operate on the physical book and apply in other chats that read that version. Chat-local correction overlays, pause, scopes, and detaches have their own scope. Update the pinned Base World explicitly if you intend to adopt later source changes. [Book actions](src/ui/chat-books.js) · [Entry and bulk editor](src/ui/book-entry-editor.js) · [Reusable book setup](src/ui/v10.js)

### Trigger sources, chance, and timing

**Native Base World and reusable entries** use native properties such as `constant`, `disable`, primary and secondary keys, case and whole-word settings, probability, sticky, and cooldown. Native timing is expressed in host messages. Set **Keyword source** to the normal host scan, the latest eligible user message, or the latest eligible assistant reply. Role-specific matching uses the extension bridge to present the match to the host’s scanner and requires host macro support. Secondary trigger logic can require any of the terms, all of them, at least one term absent, or all absent. Native activation still depends on that host’s priorities, scan configuration, budget, and timing. An entry marked always eligible still uses its enabled probability setting. If a native export declares `useProbability: false`, its stored percentage is not an active probability gate. [Native matching](src/book-triggers.js) · [Entry editor](src/ui/book-entry-editor.js)

**Managed Story World entries** can use the built-in relevance rule, **Always eligible**, **Keyword triggered**, a limited opening window followed by keyword activation, or **Off**. Their explicit rules can set separate trigger terms, the source, chance, sticky duration, and cooldown. A plain phrase uses normalized word matching, and a `/pattern/flags` key uses a regular expression. Managed timing counts accepted model replies. A successful new send anchors subsequent sticky and cooldown checks. Saving an explicit rule overrides ordinary category relevance for that entry. An eligible record still competes for the applicable notes budget. The default initial window is six replies. The editor exposes 0–100% chance, 0–100 sticky replies, and 0–1,000 cooldown replies. Advanced record edits preserve the existing ID and kind. [Managed recall rules](src/recall.js) · [Story notes assembly](src/world.js)

For a style nudge against a repeated phrase, use **Direction → Random Instructions** with a phrase or pattern trigger, set **Where to look** to **Previous model reply**, and set chance to 100% if it should always fire when eligible. Example trigger `landed like`. Write a version that asks for plain, direct phrasing in the next turn. Use a cooldown if the same phrase could otherwise prompt repeated nudges. This workflow needs no auxiliary request. [Instruction timing](src/engine.js) · [Direction editor](src/ui/editor.js)

A book can use literal terms, regex, and activation scopes without a separate vector service. **Help choosing triggers → Suggest trigger phrases with AI** can draft terms from the entry’s title and text as an optional auxiliary request. Review and save the terms yourself. This feature generates candidate keywords for later deterministic matching. It does not send each lookup to an embedding model. Vector retrieval, if enabled through another host extension, is configured separately in the host. [Keyword assistance](src/book-keywords.js) · [Trigger sources](src/book-triggers.js)

### What is selected, observed, and sent

The extension can assemble compact story notes using the scene, cast, place, latest relevant mentions, chapter summaries, and eligible plot and fact records. It manages separate budgets for story notes, chapters, and structured state. Known people or places can be included by the extension’s Story World relevance rules even when a native keyword would not fire. Entries that belong only in a narrow situation can use an explicit managed recall rule. Native selections and records included in Story World notes are reported as distinct sources. An entry selected by the host scanner can still be omitted by its selected budget or by later host configuration.

In **Review → What Was Sent**, expand the reply and open **World Info selections**. Read the source book, role, and available reason. **Confirmed in prompt** means the extension found matching text in the assembled request it observed. **Selected** means a selection was reported and delivery was not confirmed by the observed text. This is a local inspection of assembly, and can include text matched in a combined Story World notes block. The status describes local prompt assembly. Open the compact in-chat receipt if you only want entry titles and sources. Use the expanded receipt when you want actual guidance text, estimates, or changes. [Story bridge](src/engine.js) · [Receipt UI](src/ui/sent.js) · [Context dashboard](src/ui/context-dashboard.js)

## Chapters, context, and historical catch-up

### Ordinary summaries

Open **Review → Context & Memory → Conversation and memory**. Enable **Keep the story so far in chapters**. A reply is one accepted model message, distinct from the raw message unit used for the retention window. A chapter normally starts after 20 uncovered replies or at an eligible scene end after at least four. The **Summarize at estimated tokens** threshold is optional and defaults to 0, which disables it. Whichever enabled threshold is reached first can start the next chapter. **Write a chapter now** initiates one manually from Story World. A chapter records the relevant message range and is saved before its covered messages can be hidden.

Each chapter is one auxiliary request. The active story usually recalls the latest two chapter summaries in full when budget permits, with older relevant chapters using shorter recall. A separate chapter budget defaults to 800 estimated tokens. The Story World notes budget defaults to 600. Once chapters reach the roll-up threshold, a separate call can combine older ones and keep newer ones individual. With retirement enabled, finished threads, revealed secrets, paid-off details, and finished off-screen activities move into chapter history and stop acting as open entries. Undoing that chapter can undo its retirements where safe. [Chapter file and roll-up](src/chapters.js) · [Recall assembly](src/world.js)

### Raw message window and the host Chat History block

Keep the host preset’s **Chat History** block enabled when you want the model to receive the remaining visible conversation. The extension summarizes and hides covered messages through host history semantics. The host assembles full-text chat history from eligible messages. Turning the block off can omit even the newest conversation, while extension summaries and lore continue via their injection paths.

| Control | What it changes |
| --- | --- |
| **Hide messages covered by a chapter** | Marks covered messages hidden from model history after a successful save. They remain readable in the chat. The extension tracks what it hid and can restore those messages. |
| **Protect recent history by → Message count** | Retains the newest configured number of story messages in full. Default 30. |
| **Protect recent history by → Estimated tokens** | Retains whole messages within the estimated token budget, with the newest two story messages protected. Default token value 8,000 when switching to this unit. |
| **Apply to saved chapters now** | Reapplies the chosen window to already saved chapter coverage without a model request. |
| **Story World notes budget / Chapter notes budget** | Controls separate approximate budgets for selected story facts and summary recall. |
| **Last observed request** | Counts the history and available prompt categories observed at the host assembly hook. It can show extension story notes, chapters, directions, state, and other prompt material that can be recognized. |

The window protects the greeting and uncovered recent history. The slider target applies to history with saved coverage. The host may still trim the request for its context limit. Token sizes are text estimates, approximately one token per four characters. Provider tokenization, request wrappers, and other extensions may change the final size. The dashboard identifies what it can observe. It cannot provide billing or cache-hit counts. If both the host’s summary extension and this extension are active, inspect both configurations and the receipt before assuming there is only one recap in context. [Coverage and hiding](src/chapters.js) · [Hide ownership](src/hide.js) · [Context estimates](src/context-budget.js) · [Dashboard](src/ui/context-dashboard.js)

### Catch up or rebuild any chat

Open **Review → Context & Memory → Catch up or rebuild this chat**. Enable Chapter summaries first. The tools can work on an older untracked chat or one that already has extension books and chapters.

1. Choose **Catch up this chat** to fill uncovered history and keep valid existing chapters. The extension reads accepted replies in historical order and checkpoints batches. Existing coverage governs where it resumes.
2. To start a fresh managed history, open **Fresh rebuild options** and choose **Rebuild from all chat history**. **Keep my authored entries and state corrections** controls whether to carry those items into the new managed copy. Review the active books before choosing to leave authored material out of that copy.
3. Each batch submits selected historical messages for one auxiliary request and files a supported result. Structured story data is collected when its modules are active. Chapter-only workflows can file summaries with fewer structured fields. **Stop after the current request** lets the run stop without discarding an already saved batch.
4. A rebuild stages its work and switches to its new book after successful preparation. The previous world stays available as a backup. New hiding applies after saved coverage. Review the result in Story World, Current State, the inventory, and the Log.

The catch-up code batches by reply interval and text size, checks the source messages did not change during the request, and can stop with a readable diagnostic if a batch cannot be filed safely. It can extract supported facts from an existing story. It cannot manufacture missing state reliably or guarantee the model will report every historical fact. Original messages and backup books are the places to check ambiguous history. [Catch-up transactions](src/chapters.js) · [Source fingerprints](src/history-source.js)

### Start a new chapter in a new chat

Use **Start a new chapter in a new chat** in **What Was Sent** or **Story World**. Enter an optional direction for the opening, as for a time skip or change of location. One auxiliary request drafts a handoff summary and first message. Review or edit those fields, including the new scene and recall settings where offered. Confirm to create a new chat for the same character. The approved first message replaces the ordinary greeting.

The new chat receives a separate continuation Story World, checked before the host switches chats. It carries forward established facts, plot state, portrayal, knowledge, emotion and relationship records, protected corrections, pronouns, active sets, timers and locks where applicable, and completed goal progress. The source chat and source book remain available. The opening preserves the previous clock/date/weather anchor where meaningful, and the new opening can set a new value. Emotion age is carried forward. Earlier chapter entries in the cloned book are archived rather than pulled alongside the new opening summary by default.

**The story before this chat** is a real entry in the new book. By default it is eligible for the first six replies and then switches to trigger keys, initially drawn from the opening’s place and cast when known. Edit its activation, keyword source, chance, sticky duration, and cooldown the same way as other managed entries. Later chapters build the new chat’s recap. A change to the older handoff is an explicit entry edit or correction. [New-chapter UI](src/ui/world.js) · [Draft and handoff](src/chapters.js) · [Opening windows](src/recall.js)

## Corrections, swipes, edits, and branches

### Correct a fact and the reply it affected

Open **Story → Corrections** or **Correct a fact** beneath an eligible reply. Write the desired canon as a concrete statement. For example, `Mara never sold the observatory. Iven leased part of it for the winter.` The extension stores this as a chat-local correction. Recent corrections and older corrections whose terms match the current story context are eligible for future continuity guidance. Recording canon alone can be done without a separate tracing request.

- **Find and update sources with AI** asks one auxiliary request to trace likely origins and propose narrowly targeted changes, then applies supported proposals in the correction flow. The editor validates that proposals refer to supplied candidates and where possible to the original source text. Enter the incorrect wording if you know it. The current correction still saves when an optional trace cannot safely update a source.
- **Find and edit source records** expands manual controls. **Find source matches** searches locally. **Trace and draft with AI** lets you review AI proposals before applying selected source edits. Open relevant matches to see their text and provenance. One saved fact can have more than one origin, and a suggested source can be a character-card field, lore entry, prior message, or managed story record. Shared lore and character-card corrections can be represented as a local override. That keeps other chats from silently inheriting this chat’s correction.
- **Regenerate the latest reply** runs guided regeneration when a valid latest reply is available. It uses the correction for a replacement normal response. If tracing is selected, the trace and the replacement are separate requests. When the corrected canon is saved and its replacement fails, the editor can offer **Retry guided regeneration** on the eligible message.

The audit trail records the accepted correction and its affected sources. A correction only changes prose that is regenerated or explicitly edited. Read a historical message separately if you want its text changed. [Correction matching and source updates](src/corrections.js) · [Correction UI](src/ui/corrections.js) · [Matching rules](src/correction-rules.js)

### Guide a swipe

Open **Generate an alternate reply** on the newest eligible model reply. Enter a direction to fix something, introduce a fact, change an event, adjust the prose, change pacing, or try a different story direction. Select **Generate guided swipe**. The one-time direction is saved in the replacement’s receipt. Existing swipes stay accessible.

Before generation, the extension reverses the outgoing reply’s tracked world changes when those changes can be safely undone. The replacement sees the earlier accepted story and supported protected corrections. Use **Repeat the previous turn’s orders** if you want the same random instruction or event again. Direction guidance itself applies only to the requested replacement. The normal checker may still run if applicable. If generation is canceled or fails, the extension attempts to restore the outgoing state. A conflicting intervening edit can require review. When a manual change must be kept, use the offered review and preservation controls. Start the new swipe from the latest saved swipe if prompted. [Guided generation UI](src/ui/guided.js) · [Generation transactions](src/engine.js) · [World rollback](src/worldflow.js)

### What ordinary chat actions do

| Chat action | What the extension does |
| --- | --- |
| Edit the newest model reply | Invalidates generated state from that reply, reverses supported automatic world changes, and schedules story repair where enabled. The checker can also reassess eligible instruction compliance. |
| Edit an older model reply | Invalidates generated state from that point forward. Replayable derived world changes and overlapping summaries are marked or withdrawn. A repair reads the affected surviving story in batches when needed. Authored information and protected corrections keep their own provenance. |
| Delete the last few messages | Drops records tied to deleted messages, reconciles the world and timing, and repairs the surviving tail if its state needs reconstruction. |
| Delete a range in the middle | Coalesces host deletion events and finds the earliest changed point. Subsequent derived state can be invalidated and rebuilt from the replies that remain. |
| Ordinary swipe or regenerate | Uses the previous turn’s planned instruction, style, or dice choices where applicable. Changing the accepted swipe reconciles stored snapshots and supported world side effects. **Pick again** explicitly asks for new random choices. |
| Branch at an earlier point | Carries settings and available records up to that point. Structured mode isolates its branch book. In Legacy mode, with copy-on-branch enabled, the extension also makes a separate Story World and rewinds recorded post-branch changes on the copy. A branch whose parent had no managed book can receive an empty one. Explicitly removing the book from its parent carries that choice into the branch. |
| Branch creation or rollback fails | The extension reports an error. If the branch cannot safely attach a copied world, it can detach the unsafe parent reference so the branch cannot file into the parent accidentally. Unsupported historical or manual changes can require review. |
| Start a new chapter chat | Creates a new continuation book and seeds the new timeline from the approved handoff, as described above. |

Automatic repair depends on the active story and memory components, the host’s edit and deletion events, and usable audit records. Simple rollback can complete without AI. Extracting revised historical state or rewriting an overlapping summary can require one request per affected batch. A legacy chat that predates recorded provenance can leave changes for **Current State** review or a fresh historical rebuild. [Refresh coordinator](src/story-refresh.js) · [World synchronization](src/worldflow.js) · [Repair jobs](src/chapters.js)

## Random Instructions

An instruction set holds instructions. Each instruction has several *versions* of the same order. During a chat an
instruction is sent with the chance and timing you set, one version at a time.

| Setting | What it does |
| --- | --- |
| When it is allowed | Always, only when certain words appear in the recent chat, or only when a pattern matches. |
| Chance to send each reply | 100 sends it every time it is allowed. 10 sends it about once in 10 replies. |
| Keep sending for | After it is sent, it is sent again with this many more replies. |
| Wait before sending again | After it is sent, it cannot be sent for this many replies. |
| Do not send before reply number | Holds it back at the start of a chat. |
| Only-one group and weight | Instructions with the same group name compete for one slot per reply. The weight changes the chance of winning that slot. |
| Send-together group | When the set limits a reply to one Send-together group, instructions with the same group name can go out together. |
| Only once per chat | A story action is retired once it happens. A model direction is retired when it is sent. |
| Sent as | A system note, an out-of-character note, a line spoken by the character, or exactly as written. |
| Where it is placed | Send before or after the character’s description, or at a configured message depth. Depth 0 goes after the newest message, and depth 1 goes immediately before it. |
| Actor, Target or subject | Check one or more options to limit the draws for **Write with AI**. The model is its own actor mode. |

- **Versions do not repeat** until every version of that instruction has been used once. When writing new versions with AI, the extension assigns one checked actor and target pair to each version before sending the batch. Edits to the checklists apply to future writing batches. For story events, **Where these events come from** works the same way and saves the assigned origin on each item.
- **In-scene actors.** Besides the character, someone who is present, someone new, or the surroundings, you can pick
  "any character", "any female character" or "any male character", each "already in the story or new". The AI
  then uses someone who is there, or brings someone in, so the order can always be carried out.
- **Notes on your choices.** A pairing of actor and target that leaves the AI little to work
  with gets a note (for example the character acting on themself, or two new people at once). A version that
  disagrees with the chosen actor gets one line of advice. Both are notes: you can keep things as they are.
- **Names and pronouns** are placeholders. Tap the name and pronoun buttons while editing. Set pronouns once per
  chat in Settings. One instruction set then works with any character and persona.
- **{{user}} never acts.** A version where {{user}} is the subject of the order, is made to speak or decide, or has
  their reply or thoughts written is marked "Check". It is a flag: in the AI review it starts unticked, you can
  tick it, and it saves. {{user}} as the place or the target ("the bridge under {{user}} must crack") is clean.
- **How often.** Each set shows how many replies will start a new instruction. This estimate is calculated before waits and limits. Seven independent 5% chances give about a 30% chance of at least one eligible draw.

[Instruction timing and injection](src/engine.js) · [Instruction form](src/ui/editor.js) · [Set management](src/ui/sets.js)

## Random Story Events

A story event set holds ingredients sorted into categories such as Situation, Complication, Who drives it, and Tone. When an event fires, dice pick one item from each category that is on, and the AI gets one
order: an event must happen in this reply, built from those parts, fitted to what the story has established.

1. Open the **Random Story Events** tab and press **Add story event set**.
2. Tap a category to open it. Type items, or press **Write items with AI** and give it a few words about the
   kind of story.
3. Press **Roll an example event** to see exactly what the AI would receive. Press it again to see items rotate.
4. Set the chance and the wait at the top, press **Save story event set**, and turn on **On for this chat**.

Set-level fields control chance per reply, an earliest reply number, keep and wait durations, big-event status, and delivery as a system or out-of-character note. Each category also has independent settings.

| Setting | What it does |
| --- | --- |
| How it changes | New pick every time, Keep for a random number of events, or Keep until I turn it off (you choose the item). |
| Items per pick | How many items from the category go into one event. |
| Keep range and chance to change | A random keep draws between the configured minimum and maximum events. A lower chance to change can keep the same pick after that range expires. |
| Retire an item once it has happened | An item that has happened in a chat never comes back in that chat. See "When lists run out" below. |
| Use every item before repeating | No item comes back until all the others have had a turn. |
| Wait before an item can return | A just-used item sits out this many events. |
| Never use items tagged | Leaves out items that carry any of these tags. |
| Always include (on an item) | The item is in every fresh pick. The dice fill the rest. |
| Weight (on an item) | A higher weight is picked more often. |
| Never together (on the set) | Pairs of tags, written `past+future, calm+frantic`. When one is picked, items with the other tag are left out of that roll. |
| Saved category settings (on the set) | Save how the categories are set up under a name, such as "Slow burn", and choose one per chat. |

**Events that work wherever the scene is.** An event can fire at any moment, so its items say what happens and
to whom, and leave out where and how. "A shocking event places {{user}} in immediate danger" works in a camp, a keep
or on a ship. A collapsing bridge requires an established or plausible bridge.

- **The AI writer is told this for every list**, with examples for its kind. Situation says what happens and who it
  reaches, Complication how things get harder, Who drives it names a role rather than a person tied to one place,
  Tone names a feeling rather than a place or the weather, and What it puts at stake says what is at stake and for
  whom. A list's kind is read from its name.
- **The current scene is left out** when items are written for a story event list, so they do not lean toward where
  the story is right now. "Let the AI read where the story is now" in the AI box turns it back on.
- **The AI marks items that need a particular setting.** In the review, those start unticked with a note.
- **Every event order says** that when a part names something that is not in the scene, the AI keeps what the part
  does to the people and changes how it happens. So an older, specific item still fires sensibly.
- **What it puts at stake.** A new set has this list, with ten items that work anywhere, such as "{{user}} is in
  immediate mortal danger" and "something {{char}} believes about themself is challenged". An older set gets a
  button to add it.
- **Make these work anywhere.** A button on each list. One AI request rewrites the items so each works in any
  setting and keeps what it does to the people. You see each change, with what it was, and tick the ones to keep.

**When lists run out.** Lists that retire their items can be different lengths. The first list that retires its
items is the main list (Situation, to start with). When the main list is used up, the set sends no more events in
that chat. A message on screen, a line in What Was Sent, and "Used up in this chat" on the set's
card report this. Any other list that is used up first is simply left out of the events that follow, so a set with 20 situations
and 8 complications gives 20 events, the last 12 with no complication. The set's card shows how many items of each
list are left in the open chat. **Bring the used items back** lets the set pick them again in that chat. Earlier replies keep their records.

**Where an event comes from.** Every item can be marked with where its event comes from: {{char}}, another
character, or the surroundings. The "Who drives it" items of a new set are marked already, and the drivers of an
older set are read from their words. When an event rolls, the dice pick who drives it first, and then only pick
items that fit that driver (an unmarked item fits every driver). A storm is then never driven by {{char}}, and a
driver is only offered when its lists have something that fits. In **Write items with AI**, choose "Where these
events come from" and every item is written to start there, and is marked with it. Press Edit on an item to change
its mark.

**Items that wait.** Press Edit on an item to choose when the dice may use it.

- *There is an open thread.* The item waits for an open thread in this chat's story world. The thread that has gone
  longest without moving is written into it. Write `[thread]` where it belongs, for example "`[thread]` comes up
  again". This is how an ignored thread comes back.
- *Someone in the scene keeps a secret.* The item gets a kept secret of someone in the scene, and the AI is told
  what it is. Write `[secret]` where it belongs, for example "someone nearly finds out `[secret]`".
- *Someone in the scene has a plan.* The item gets that plan. Write `[plan]` where it belongs.
- *Characters in the scene, at least.* The item waits until the scene header, the HUD or a "Present:" line of the
  newest reply names that many people other than you.

While what an item waits for is missing, the dice leave it out. When every item of a category is waiting, the event
waits too. The "Roll an example" button ignores the conditions.

**Big events.** A set can be marked "Events from this set are big". After a big event has happened, nothing new
starts for a number of replies (see Pacing).

In **What Was Sent**, every picked item has three buttons: **Pick again** (a different item for that category
only, with a new reply), **Lock for this chat** (use this pick for the rest of the chat), and **Keep until I turn
it off** (change the set so that category always uses this item). `{{user}}` can never be the one who drives an
event.

[Event and style selection](src/events.js) · [Category editor](src/ui/events.js)

## Random Writing Style

A writing style set changes how replies are written and leaves the events of the story alone. While a set is on
for a chat, one style order goes out with every reply, built from the categories that are on.

1. Open the **Random Writing Style** tab and press **Add writing style set**. It comes with eight categories:
   **{{char}}’s mood** and **Prose style** are on. **In the manner of this author**, **Writing habits**, **Sense to lead with**, **Pacing**, and **Rule for this reply** start off. **Point of view and tense** starts locked.
2. Open a category to set how long its pick lasts, counted in replies: keep one item until you turn it off, keep a
   pick for a random number of replies (for example 4 to 8), or pick new every time. A category can also sit out
   by chance, and rest after each pick.
3. Press **Roll the next reply's style** a few times to see what stays and what changes.
4. Save, and turn on **On for this chat**.

The style order says that it applies to the story prose only, that tagged or formatted blocks keep their exact
format and position, that events, facts and choices stay as they would otherwise be, and that a required
instruction wins over any style choice. Writing style is recorded in What Was Sent and is not checked by AI. It
keeps going while an instruction is overdue, and it does not count toward per-reply limits.

**What an item can add while it is the pick.** Press Edit on an item. Three optional lines:

- *Added to every story event.* One sentence that says how events are to go while this style is in use.
- *Question asked about the reply.* It rides along with the check that runs anyway and is shown in What Was Sent
  with its answer. It never makes an AI request of its own, so it is skipped on replies where nothing is checked.
- *Note sent with the reply after it.* Sent once with the next reply.

**Rules that can be counted** are checked against each reply without AI and shown in What Was Sent as "Followed" or
"Not followed". Give an item one of these tags: `rule:no-dialogue`, `rule:mostly-dialogue`, `rule:max-sentences-2`
(per paragraph), `rule:max-words-200` (any number works).

[Style categories and deterministic checks](src/events.js) · [Style editor](src/ui/events.js)

## Character Goals

A goal gives the character something to work toward in one chat. Goals are only ever for the character.

1. Open the **Character Goals** tab in a chat. Type the goal as one loose sentence, or press **Write a goal with
   AI**.
2. Add **one-time steps** (each happens once, in any order) and **repeatable actions** (sent again and again).
   A flexible task such as `compliment {{user}}` can fit different scenes.
3. Turn the goal **On**.

| Part | When it is sent | When it is done |
| --- | --- | --- |
| The goal | With every reply (you can change that) | When every one-time step is done, or when you press "Mark the goal done". |
| A one-time step | Picked at random when a task is due. Once sent, it is sent again with every reply, as Overdue and then Final, until it happens. | When the check finds the words in a reply that show it. You can also press "Mark done" or "Undo done". |
| A repeatable action | Picked at random when a task is due, for one reply. Then it waits a number of replies. | Never. It is not checked. |

At most one task is sent at a time, and a task is due with the chance you set (35% of replies to start with).
What is done is read from the replies themselves, so deleting the reply that finished a step un-ticks it, and a
branch carries on from where it branched. **Save this goal to my list** keeps a goal for other chats, and "When
the goal is done" can start the next goal from that list.

[Goal progress and storage](src/goals.js) · [Goal controls](src/ui/goals.js)

## Pacing and dice

### Pacing settings

- **How many new things can start in one reply** caps new instructions, random story events, goal tasks, and eligible Story World orders. The default is one. A value of zero removes the global cap. Set-level limits, group weights, and timing rules still apply. Ongoing writing directions, goal reminders, and factual recall have separate handling.
- **Quiet after a big event** defaults to two replies. A qualifying big event holds back new developments for the configured interval. Work already under way can continue. **What Was Sent** explains a quiet selection when recorded.
- **Order a character who has gone quiet** defaults to four replies in the applicable Story World workflow. It is based on scene presence and mentions in prose. A value of zero turns it off.
- **Story phases** are off by default. Each phase starts at a reply number and can supply a chance multiplier and an optional prompt line. The initial examples are Opening 50% from reply 1, Rising 100% from reply 11, and Long run 125% from reply 41. A multiplier of zero prevents new starts during that phase.
- **Story event limits** in Current State exclude exact user-supplied tags across fresh, repeated, and rerolled event items where applicable. Categories with untagged entries remain eligible. Free-text boundaries and style preferences still require interpretation by the model.

Reply timers are evaluated using the chat’s accepted replies, including replies hidden from model history. Native host World Info timers use the host’s scanned message timing, so the same numerical settings can behave differently across those systems. [Settings defaults](src/store.js) · [Pacing](src/pacing.js) · [Selection engine](src/engine.js)

### Which system rolls what

| Mechanism | What triggers it | Result supplied to the model |
| --- | --- | --- |
| **Structured explicit action check** | A user queues a check from **Direction → Action Checks**. Ordinary replies need no manual roll. | One action, actor, relevant stat, d20 result, modifier, total, difficulty, and success or failure. |
| **Autonomous world event** | A code-side draw can run on an eligible normal structured turn with its module enabled. | An optional narrative opportunity. An outcome exists only when the accepted story establishes it. |
| **Random Story Events / Random Instructions** | The item or set’s timing, eligibility, chance, and weight controls. | Selected directions or parts of a required story event. These numbers select content. |
| **Legacy dice** | With legacy dice enabled, the extension rolls before an eligible reply for each enabled side. | The precomputed outcomes of one die per side, with that same natural roll applied to all of that side’s stat modifiers. |

For a structured check, choose the user or character, enter the action, choose a stat, and set a difficulty from 1 to 40. Select **Roll for next reply**, then send your next message normally. **Clear queued check** discards the waiting result, and the UI can offer a reroll that replaces the latest applicable reply. The code uses one d20, adds the saved stat modifier, and returns success if the total is at least the difficulty. Suggested phrasings and results are the only data the AI needs for the check. [Structured action checks](src/v10.js) · [Action check UI](src/ui/v10.js)

The legacy default stats are Strength, Agility, Wits, Charm, Will, and Senses. Values range from −20 to +20. Character sheets are keyed to the character or group and user sheets to the persona. Legacy dice rolls one shared unmodified die for the supporting cast if that side is enabled. Natural results can therefore repeat across the displayed stat rows because the rows share a die. The legacy result bands by total are 2 or less (fails badly), 3–7 (fails), 8–11 (partly succeeds), 12–16 (succeeds), 17–21 (succeeds well), and 22 or more (succeeds brilliantly). The legacy prompt asks the model to apply a result only to a meaningful uncertain action. Regular swipes usually retain the original draw. Code uses `crypto.getRandomValues` with rejection sampling, falling back to `Math.random` if the host does not expose it. [Legacy dice](src/dice.js) · [Random primitive](src/books.js)

## Prompt editing and Write with AI

### Edit and restore a prompt

Look for a **Customize … prompts** disclosure where the action is used. Open the named prompt, edit the wording, and save it. A status identifies customized text. **Restore default** clears that one override and loads the built-in wording of the installed extension. Some chat-local guidance fields label this action **Restore default** alongside **Discard draft**. Installed defaults can change while existing custom text stays in use. Extension template overrides are saved separately from individual event items and instructions.

Prompt editors expose the relevant prose, system message, and writer guidance by name when available. The application still assembles runtime data, role, placement, schema, and user input. For example, the chapter template supplies the wording for the summary and the code supplies the historical message range and expected JSON shape. Template overrides must be nonempty, can be up to 12,000 characters, and must retain required single-brace variables such as `{parts}`, `{direction}`, `{instruction}`, and `{order}`. Double braces preserve host macros for later expansion. [Template registry](src/prompts.js) · [Editor and change status](src/ui/prompts.js)

| Feature | Where to look for its prompt editors |
| --- | --- |
| Instruction versions and system message | **Direction → Random Instructions**, in the instructions list and beside **Write versions with AI** in the editor. The model-directed actor has its own version guidance. |
| Live framing of random instructions, player agency, overdue/final phrasing | **Direction → Random Instructions → Customize in-chat instruction wording**. |
| Story event wording, item writing, role-specific item guidance, rewriting to work anywhere | **Direction → Random Story Events**, at the set page and inside category writing or rewrite actions. |
| Writing style order and style item authoring | **Direction → Random Writing Style**, at the set page and inside writing actions. |
| Goal, goal tasks, and AI goal writer | **Characters → Character Goals**. |
| Entry writer, starter world, ordinary chapters, roll-ups, new-chapter handoffs, and legacy Story World opportunities | **Story → Story World**. |
| Keyword suggestions | **Story → Reusable Lorebooks**, inside the relevant book’s entry editor. |
| Historical and token-triggered chapter guidance | **Review → Context & Memory → Customize catch-up and rebuild guidance**. |
| Scene timing and repair | **Story → Current State → Customize scene timing and rebuild prompts**. |
| Opening prose, opening system message, reading a greeting, and player-thought guidance | **Story → Opening → Opening setup**. |
| Live style, realism, scene routing, individual checks, stock phrases | **Direction → Writing Guidance**. |
| Fact capture and repair | **Story → Chat Facts**. |
| Plot outcomes, prerequisites, schedules, and optional opportunities | **Story → Plot Records**. |
| Portrayal, character knowledge, emotions, and relationships | The respective pages under **Characters**. |
| Speaker attribution and action-check wording | **Characters → Dialogue Colors** and **Direction → Action Checks**, respectively. |
| Planning, prose-first handling, commentary voice, Roast formatting and feedback | **Setup → Reply Display**. |
| Correction tracing, stored correction canon, and regeneration | **Story → Corrections**, or the correction disclosure on an eligible reply. |
| Guided swipe framing | Beneath an eligible reply in **Generate an alternate reply**, or under **Setup → Settings**. |
| Legacy scene, character-state instructions, dice, and separate compliance checker | **Setup → Settings**, according to the active workflow. |

### Macros, actor and target choices, and AI authoring

| Macro | Meaning |
| --- | --- |
| `{{char}}` / `{{user}}` | Active character and persona names. |
| `{{description}}` / `{{charDescription}}` | Character-card description, where supported by the host macro system. |
| `{{personality}}` / `{{charPersonality}}` | Character-card personality. |
| `{{scenario}}` / `{{charScenario}}` | Character-card scenario. |
| `{{persona}}` | Active user persona description. |
| `{{mesExamples}}` / `{{mesExamplesRaw}}` | Host character-card dialogue example macros. |
| `{{char.they}}`, `{{char.them}}`, `{{char.their}}`, `{{char.theirs}}`, `{{char.themself}}` | Pronoun forms resolved from the extension’s chat settings. The five equivalent `{{user.…}}` forms are available. |

The writer temporarily represents known macros as `[[personality]]` or `[[char]]` in its authoring request, then normalizes the returned text back to double-brace macros. This helps preserve reusable placeholders. Some stock prompts use `[thread]`, `[secret]`, and `[plan]` for different purposes. Those are replaced by eligible Story World data in conditional story event items. [Placeholder handling](src/writer.js) · [Pronoun storage](src/store.js)

The actor and target checkboxes constrain **Write with AI**. Choose one or several allowed values. **The model (writing the reply)** is an exclusive actor choice for instructions such as reviewing the last five replies and anchoring speech to `{{personality}}`. Model-directed instructions skip the separate story-action check. Use the unspecified actor and target choices for a draft with no fixed in-story participant. A selection can include the character, existing NPCs, new NPCs, or the surroundings according to the available field. The writer assigns allowed pairs to the requested variants and validates the returned batch length when the draw needs positional matching. Saved version text determines what the scheduled instruction actually says. [Actor and target definitions](src/books.js) · [Version writer](src/writer.js)

Each AI authoring dialog can reveal what contextual material the writer may read, including a character card, scenario, persona, chapter recap, recent messages, or the current event scene. Writer-wide rules and the flagged word list are under **Setup → Settings → What the AI writes for you**. The word list screens model-written drafts locally. A trailing `*` on a word stem matches longer endings. Review flags for duplicates, player agency, actor mismatch, context dependence, or unwanted words. Check the variants or items you want, add them, then save the containing instruction or set. Existing hand-written versions are editable through the same editor. [Writer context](src/writer.js) · [Validation](src/validate.js) · [Writer settings](src/ui/settings.js)

### Managing scheduled sets

The relevant Direction page lets you edit, reorder, copy, and delete instructions or items and manage their sets. Use the item and set delete actions, review their confirmations, and keep an export if you want a backup. A disabled set remains available while inactive. A retired item has already been consumed by this chat’s timing. These states have different scopes.

**Setup → Settings → Where your sets are kept** controls how newly added sets are written. A new installation defaults to a shared `Roleplay Instructions` World Info book. Existing installations can retain one physical book per set. A shared book stores independent named groups and can contain unrelated native entries. Moving a set transfers its definitions, versions, notes, and timing, and maps existing chat records to the relocated set. Moving a set out of its own book can leave the old book as a spare copy. A whole-book export is useful for portability. Enable the set in the current chat through the extension rather than manually activating these storage books in native World Info. When the extension is disabled, a natively activated exported set relies on host lore triggers and its stored random macros. [Set storage and movement](src/books.js) · [Sets UI](src/ui/sets.js)

## What Was Sent and the Log

### What Was Sent

Open **Review → What Was Sent** and expand a reply. Receipts are tied to the accepted reply or its swipe. What you can inspect depends on whether the host exposed the generation hooks and which data was captured when that reply was made.

| Receipt section or action | What it means |
| --- | --- |
| **Selected order, event items, or style** | Shows the selected version, category items, placement and reason, phase, due state, or modifiers when available. |
| **World Info selections** | Titles, source books, roles, and observed delivery. An entry can appear here as part of a combined notes block. |
| **Story notes** | Text of the assembled facts, selected cast and place, and approximate prompt size. |
| **Exact story guidance** | The stored extension wording when **Keep exact story guidance** was enabled and assembly was observed. |
| **Story world changes** | File changes, evidence or status where recorded, and **Undo these changes** when reversible. |
| **Send again / Do not send again** | Controls an outstanding order or retires a waiting reminder. |
| **Pick again and write a new reply** | Replaces the reply with new applicable random selections. Use **Generate an alternate reply** for user-written direction. |
| **Check this reply again** | Runs the checker for eligible instructions again. This is an auxiliary model request. |

**Setup → Settings → Show what was sent under each reply** has an Off setting, a display-only option, and a legacy saved-text option. Use display-only for user-facing receipts with no additional response prose. The saved-text option uses a marked block and may require the host-side exclusion described in its UI. The compact **World Info under replies** setting in Reply Display is independent of this larger receipt. All receipts can be inspected through Review when available. [Receipt rendering and actions](src/ui/sent.js) · [Receipt generation](src/engine.js)

### Checking and reminders

Under **Setup → Settings → Check that it happened**, enable checking to have one auxiliary request inspect a reply with an eligible order. The checker looks for supporting words in the reply. A failed or unproven task can be sent again with progressively firmer wording, normally first **Overdue** and then **Final**. A setting caps retries and can hold new tasks while an order is overdue. Optional automatic regeneration can try a new reply once after a miss. Checker evidence, optional player-agency flags, and style questions appear in the receipt when applicable. Local measurable style rules run without an auxiliary request. An instruction aimed at the model’s writing can use its own completion handling. [Instruction checks](src/engine.js) · [Checker settings](src/ui/settings.js) · [Validation](src/validate.js)

### Log and AI connection

**Review → Log** records auxiliary requests initiated by the extension and related diagnostics. Look at the job name, request text, response, success or failure, and the parser’s notes. Copy or save the log when debugging. The log is stored on this device in browser storage, holds up to 120 entries, and clips each request and answer to 6,000 characters. Log entries can contain story text and prompts. The assembled story response is described by **What Was Sent** and **Last observed request**. [Log storage](src/log.js) · [Log UI](src/ui/log.js)

**Setup → Settings → AI connection for writing and checking** selects a host connection profile for supported auxiliary calls. The active chat connection is used when no alternate profile is selected. The bridge uses the host’s profile request service where supported and its raw generation path otherwise. The service can retry certain empty answers with a larger output room. That calculation is `min(8000, 3 × requested tokens + 1500)`. A successful larger retry can enable **Give the AI more room to answer** for later requests. [AI requests](src/ai.js) · [Host bridge](src/st.js)

### Requests and token costs

| Operation | Typical separate model calls |
| --- | --- |
| Scheduled choices, pacing and dice, deterministic lookups, coloring, receipt display, streaming progress and auto-hide | 0 |
| Structured state, tracking, requested outline, automatic opportunity, writing guidance, or Roast produced with a normal reply | 0 beyond the normal story generation. Enabled prompt text consumes input tokens and emitted metadata consumes output tokens. |
| One-shot guided replacement or reroll of an eligible reply | A normal generation for the replacement. The eligible checker can run afterward. |
| Optional order compliance check | 1 per eligible check. |
| Ordinary chapter, manual chapter, combined older chapters | 1 per job. |
| Historical catch-up, rebuild, and repairs needing re-extraction | 1 per eligible batch. Deterministic rollbacks can avoid calls. |
| Draft a greeting, read an existing greeting into scene state, or draft a new chapter opening and handoff | 1 each when requested. |
| Write with AI, rewrite event items, fill a starter world, suggest keywords, or trace a correction using AI | 1 per requested job under normal conditions. |
| Record correction text, search locally for source matches, or edit a field by hand | 0. An optional guided regeneration or trace is separate. |

Some auxiliary jobs support an empty-answer retry. A particular API or model can return incomplete or malformed data. Check the job in the Log to distinguish the next action from a hidden or missing display card.

## Runtime and persistence

### One turn from assembly to filing

1. **Initialize.** [`index.js`](index.js) waits for the host context, mounts the panel, initializes the engine, and subscribes to available host events. The extension uses the host’s JavaScript context, its current character and persona, native book APIs, and its generation and save services. Missing integration hooks can limit particular features. They do not install a separate server.
2. **Prepare.** `GENERATION_STARTED` records the generation type and applicable queued check. Dry-run token previews do not advance the real turn. `GENERATION_AFTER_COMMANDS` can flush pending deletion work, ensure a Story World exists, and wait up to 20 seconds for a previous in-flight compliance check when its result can affect the next order.
3. **Gather.** `WORLDINFO_ENTRIES_LOADED` can add assigned books, apply scope and exclusions, and make relevant extension-managed material available to the scanner. `WORLDINFO_SCAN_DONE` handles the extension selection paths, deduplication, and scheduled injection. The selector reads accepted reply records when deciding what is new, sticky, overdue, already used, or due again. It treats swipes or continuations according to the turn being replaced or continued.
4. **Observe.** `CHAT_COMPLETION_PROMPT_READY` gives the extension an assembled request to inspect. It reconciles selections against observed text, records approximate size, and applies supported reply-artifact handling. The extension identifies its own background requests so these do not replace the last observed story request. Impersonation and quiet/background generations are excluded from ordinary direction selection and should not consume a story timer.
5. **Stream.** When available, `STREAM_TOKEN_RECEIVED` updates the progress view and finds complete JSON sections. Draft progress is held in memory. The host’s acceptance event is the point where the extension can file the reply.
6. **Validate and save.** `MESSAGE_RECEIVED` separates supported metadata and prose, checks eligibility and evidence, saves the accepted reply and swipe receipt, and applies a serializable world update. It can then queue a compliance check or chapter job. Cancellation and unsaved guided swipes have separate cleanup. OOC turns skip normal filing where detected.
7. **Reconcile.** `MESSAGE_SWIPED`, `MESSAGE_EDITED`, `MESSAGE_DELETED`, and `CHAT_CHANGED` feed synchronization and rebuild paths. The extension replays or reverses attributable state using recorded changes. Shared or manually modified material that cannot be reverted exactly can trigger a review instead of a destructive overwrite.

[Lifecycle and injection](src/engine.js) · [Host bridge](src/st.js) · [World transactions](src/worldflow.js) · [Refresh coordinator](src/story-refresh.js)

### Versioned same-reply update

Structured mode asks for one `<story_update v="2">` block after the prose when applicable. Its body is JSON with `"v": 2`. The fields requested vary by enabled modules. The host’s response contains the visible prose and the update in a single generation. The extension lifts the update out before subsequent display and normal story-history use. It saves parsed state and a receipt, so later prompts can select compact current data from a record instead of repeatedly copying the raw block.

An illustrative raw reply follows. The evidence repeats a sentence that appears in the accepted prose.

```text
Mara handed Iven the observatory key. “You have the west stair until dawn.”

<story_update v="2">
{"v":2,"scene":{"where":"Observatory","present":"Mara, Iven","elapsed":2,"ended":false},"changes":[{"kind":"fact","id":"iven-observatory-key","subject":"Iven","text":"Iven received the observatory key from Mara.","evidence":"Mara handed Iven the observatory key."}]}
</story_update>
```

| Field | Acceptance rules |
| --- | --- |
| `scene` | Object with supported bounded text fields. `elapsed` and `minutes` must be valid nonnegative integers in their accepted ranges. `ended` is boolean. |
| `characters` | Up to eight previewed snapshots per update in the parser. A named character needs a quote from the prose and a changed supported field. Player snapshot generation is restricted to permitted cases. |
| `changes` | Up to 12 proposals. A record uses a stable slug, a supported kind, text, and evidentiary quote. Relationship, knowledge, emotion, and plot records add kind-specific fields. Existing IDs should be reused. |
| `roast` | Optional text for the separate commentary card, clipped to 1,000 characters in structured extraction. |
| `repair` and `repairChanges` | Can refer to an eligible earlier accepted reply and supply up to four recovery proposals, with evidence from the earlier prose. |

The parser rejects malformed outer blocks and unsupported values. Filing then checks enabled modules, quote presence with normalization, and additional kind-specific support. For example, a payoff must honor prerequisites and an established outcome. Manual protections and saved baseline fields affect what can be replaced. If a previous accepted reply has an invalid update and qualifies for recovery, a later normal request can include a narrowly scoped repair instruction. This recovery piggybacks on the next story reply. Explicit historical rebuilds and the ordinary reply-checking system have their own costs. [Parser and validation](src/v10.js) · [World filing](src/worldflow.js) · [Stream preview](src/stream-update.js)

### Legacy world and reply formats

In the legacy workflow, **Setup → Settings → Scene** controls the request for scene fields and the placement of legacy state cards. **Character cards** controls tracking, maximum generated profiles per reply, current-state prompt budget, and the legacy commentator. A model can supply scene lines in its reply. The extension can also read known scene headers and HUD fields, falling back to recent names for recall. Unchanged profile fields may be omitted, and `CLEAR` can explicitly clear a field. Very old saved Thinks, Feels, and Keeps private values can render under Mind, Heart, and Psyche. The older “Will not” field does not become a new durable boundary automatically. Use a character’s actual Story World record to save an enduring boundary. [Legacy state](src/state.js) · [Legacy settings](src/ui/settings.js)

**Story World** can hold native managed entry kinds for Character, Place, Group, Open thread, Secret, Planted detail, Going on elsewhere, and Chapter. A character record can carry role, voice, actions, motives, and known, believed, suspected, or mistaken information. Places can store layout and typical occupants. Groups can store leaders, members, and intentions. Chapters are historical. The other entries are candidates for context based on the scene and eligibility. A kept secret can be recalled in abbreviated form, with explicit inclusion of contents controlled separately. The legacy notes budget prioritizes chapters, open threads, off-screen activity, and scene-relevant people, place, secrets, and planted details before less relevant matches.

In **Story World**, use **Make a new story world**, then add entries manually or **Write this entry with AI**. **Fill this world from the character card** drafts a proposed starter set from available card fields, persona, selected card lore, and the opening. Review and accept the items you want saved. For continuing legacy tracking, choose whether automatic world changes affect all eligible entries, only automatically added ones, or neither. An entry can be locked to keep authored data. The engine can move an unmoving open thread forward from its saved status and make ready developments eligible as a required order. Initial settings are 10 replies for building, 20% chance of a ready order, and a six-reply age for applicable planted details or activity. Threads, seeds, and off-screen activity are initially permitted for those orders. Secrets require explicit enabling. [World entry types and recall](src/world.js) · [Legacy update flow](src/worldflow.js) · [World interface](src/ui/world.js)

### Storage and scope

| Scope | Storage | Examples |
| --- | --- | --- |
| App or installation | `extensionSettings.roleplay_instructions` via host settings | Set catalog and physical book mapping, cross-chat defaults, prompt overrides, connection selection, writer rules, dice sheets, and display configuration. |
| Chat | `chatMetadata.roleplay_instructions` | Workflow and chat overrides, pinned Base World snapshot and reusable assignments, active Story World, timers and locks, pronouns, goals, scene seeds, protection, corrections, and story clock data. |
| Message and accepted swipe | `message.extra.roleplay_instructions` and the applicable `swipe_info` extra entry | Sent items, raw choices and checks, scene or character snapshot, World Info receipt, recorded file updates, and guided direction. |
| Host World Info file | Entry fields and `extensions.ri` metadata. Shared sets use the book’s `extensions.ri.groups` and each entry’s `extensions.ri.set`. | Reusable versions, timing, event items, story facts, chapters, record kinds and provenance. Managed entries use `extensions.ri.type: "world"`. Structured records are stored as JSON in `extensions.ri.fields.data`. |
| Browser or webview | `localStorage.roleplay_instructions_log` | Capped local log of requests and diagnostics. |

A native book contains data the host can export. The chat file contains the linkage to that book and the reply-level audit history. Back up both when you need to move an ongoing story. A standalone book export cannot recreate the exact accepted swipe, timers, or protected chat fields. Shared books can be written through the host’s normal APIs. Copies used for historical inspection and new chapters have separate ownership and lifetimes. [Settings and migrations](src/store.js) · [Book persistence](src/books.js) · [World records](src/world.js) · [Host file bridge](src/st.js)

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Companion selected and structured settings missing | Check the exact active host preset name and API mode in **Setup → Preset & Extension**. Check the installed branch and reload. An explicitly selected workflow overrides automatic name detection. |
| Instructions from both a preset and the extension | Inspect the host preset prompt blocks and extension module ownership for this chat. Choose **Memory only** when you want the host to own ordinary story behavior. |
| The model receives too much lore | Expand **World Info selections** and compare native selections with the separate story notes block. Inspect the entry’s native or managed activation, source and probability, any parallel role assignment, and the applicable note budget. |
| Imported entries seem to show 100% chance | Check the individual entry, including its enabled native probability field, rather than reading a new bulk edit form as existing entry settings. |
| Date or weather missing | Check the accepted **Current State** and edit a known date or weather anchor. For a chapter opening inspect the approved scene fields and continuation record. A blank provider field on its own cannot establish new weather or chronology. |
| Wrong weekday after a fictional time skip | Verify the prior full date and elapsed time. Check whether your calendar is one supported by the clock’s rollover or needs an explicit date in the scene update. |
| Roast configured but missing | Check **Roast generation**, **Show Roast cards**, the resolved workflow, and whether the accepted reply returned a parseable Roast. Older turns need an existing commentary field. |
| Reply planner text visible in prose | Inspect the host prompt combination and emitted markup. Paired requests use a supported `<reply_plan>` outline format, and recognized Vexa page formats have fallback parsing. |
| Too many or too few words | Compare the active preset’s length block, the extension’s live writing guidance, and the host output token setting. The notes measurement applies to prose and estimates dialogue share from quotes. |
| Context stays high after lowering the history slider | Check whether the expected range is covered by saved chapters and whether **Apply to saved chapters now** is needed. The protected greeting and uncovered messages remain available. Compare the last request rather than the number of messages displayed in the chat. |
| A branch appears to be using the parent’s book | Check **A branch gets its own copy of the world** and the associated books. Inspect any copy or history warning. Older records can lack the provenance needed to rewind all changes. |
| A source match or historical record cannot be repaired | Check the exact wording and source quote, the Log’s validation result, and any manual lock. Add the chat-local correction or use catch-up/rebuild when supported. |
| Write with AI returns an empty result | Check the selected connection and the Log. Look for transport errors, output-token limits, malformed JSON, all-duplicate items, or a variant count mismatch. |

## Source and verification

- The [extension-wide UX specification](docs/extension-ux-spec.md) tracks proposed navigation, interaction and accessibility improvements across chat and the extension panel.
- [`src/engine.js`](src/engine.js), [`src/st.js`](src/st.js), and [`src/components.js`](src/components.js) cover host events, request assembly, and component selection.
- [`src/v10.js`](src/v10.js), [`src/state.js`](src/state.js), [`src/story-clock.js`](src/story-clock.js), and [`src/worldflow.js`](src/worldflow.js) cover story state, structured validation, time, and world transactions.
- [`src/chapters.js`](src/chapters.js), [`src/recall.js`](src/recall.js), [`src/book-triggers.js`](src/book-triggers.js), and [`src/context-budget.js`](src/context-budget.js) cover memory and recall.
- [`src/books.js`](src/books.js), [`src/events.js`](src/events.js), [`src/goals.js`](src/goals.js), and [`src/pacing.js`](src/pacing.js) cover scheduled choices and their state.
- [`src/prompts.js`](src/prompts.js), [`src/writer.js`](src/writer.js), and [`src/ui/prompts.js`](src/ui/prompts.js) cover editable prompt components and AI authoring.
- [`tests/README.md`](tests/README.md) explains the host fixture, mock service, browser configuration, and coverage. The focused suite can run with `node --test tests/unit/*.mjs tests/unit/*.cjs`. Host interaction tests exercise representative flows in SillyTavern using a mock model. Provider behavior and native mobile host behavior can differ.
- [`docs/v10-verification.md`](docs/v10-verification.md), [`docs/v10-vexa-module-audit.md`](docs/v10-vexa-module-audit.md), and [`docs/v10-vexa-decision-log.md`](docs/v10-vexa-decision-log.md) preserve prior verification, preset comparisons, and design decisions for this branch.
