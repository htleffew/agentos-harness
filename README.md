# Roleplay Instructions

A standalone SillyTavern / TauriTavern extension. Version 10 adds story tools and a companion preset alongside the existing modules.

| Part | What it does |
| --- | --- |
| **Random Instructions** | Orders for the next reply ("{{char}} must pay {{user}} a compliment"), sent at random with the chance and timing you set. |
| **Random Story Events** | Dice pick story ingredients from your lists, and the AI must make an event happen from them. |
| **Random Writing Style** | Changes how replies are written (mood, prose style, pacing) and leaves the events alone. |
| **Character Goals** | Something the character works toward in one chat, with one-time steps and repeatable actions. |
| **Story World** | What is true in one story: people, places, groups, open threads, secrets, planted details, and the story so far. It is sent for who is in the scene and keeps itself up to date. |

The per-reply cap controls how many new directions can start. The optional checker can revisit required instructions. Lorebooks store reusable instructions and world records, and chat metadata keeps per-reply history and overrides.

- Works with any preset, and you can switch presets in the middle of a chat: everything the extension tracks is
  asked for, kept and sent by the extension itself. Chat Completion. Needs SillyTavern 1.19 or later, or a TauriTavern
  build on 1.19.
- Depends on no other extension.
- The extension panel lives in the Extensions menu. A collapsed story console, World Info, Roast, and Guide a swipe can also appear under replies; What Was Sent is off under replies by default.
- The dice are the extension's own code. The AI is told the result and never rolls.

## Roleplay Instructions extension and companion preset

Import [Roleplay Instructions V10](presets/Roleplay%20Instructions%20V10.json) as a Chat Completion preset, then select it in the host. The **companion preset** supplies editable writing prompts. The **Roleplay Instructions extension** manages story state, lore selection, optional checks, reply display and the recent chat history retained through **Context & Memory**. Keep the preset’s **Chat History** block on so the host sends that recent history.

In **Setup → Preset & Extension**, inspect the active **Host preset** and its ordered prompt blocks. Select the **Structured story workflow** to use the newer extension modules with another preset. **This chat** changes individual extension modules for the current chat. **Module defaults by preset** sets their default behavior for any chat using the named preset. Reset a changed setting to resume following its default. If the host preset supplies a recognized set of overlapping instructions, the module’s **Instruction source** shows the exact host blocks and their settings. Select the extension as the source and turn the named blocks off in the host preset editor to use the extension’s version.

### Edit prompts where they are used

In an individual instruction, expand **Customize in-chat instruction wording** under **What it sends** to edit the framing and see it reflected in the preview. In **Versions**, expand **Customize Write with AI prompts** beside the writing controls. The same group is available inside **Write versions with AI**. In event and writing-style sets, open a category to find its writing prompts beside **Write items with AI** and inside the writer. Each prompt shows **Default** or **Customized**, and has **Save prompt**, **Restore default**, and **Undo restore**. These are shared feature templates. **Review → Log** shows the assembled writer request.

For a direction about how to write the reply, choose **The model (writing the reply)** as the **Actor** under **What it sends**. Set **Target or subject** to **Unspecified** if your wording already identifies the subject or you want to leave it open. Either field can be unspecified. With **System note**, the direction rides along with the regular reply request and skips the story-action check. You can use `{{personality}}` and `{{description}}` for the active character card fields. A direction to review earlier replies can use the history included in that request.

### Scene checks and live reply sections

The Structured workflow's **Scene and character checks** module adds a short checklist to the ordinary reply request. It uses the known cast to guide solo or ensemble scenes and can check viewpoint access, NPC independence, specific relationships, off-screen agendas and continuity before writing. Open **Direction → Writing Guidance** to edit the checks, select grounded or heightened portrayal, add stock phrases to avoid, or enable word and dialogue metrics. Known Antithesis blocks in the active host preset take ownership of the checklist. The companion preset also offers four optional prompt blocks in the host editor. Turn on Physical realism, Social realism, Prose and pacing pass, or Story route and continuity to have that preset provide the matching check. The other enabled extension checks continue to run.

With streaming enabled, the loading card lights up Scene, Characters, Story changes, earlier-state repairs, and Roast as complete sections arrive. They remain previews until the ordinary state validator accepts the reply. Turn the section display off in **Setup → Reply Display**. The animations respect the host browser's reduced-motion preference.

### World Info books and chapter continuations

Open **Story → Reusable Lorebooks → World Info books for this chat** to see the managed Story World, assigned Base World and guidelines, active set books, exposed host attachments, and earlier books tied to the chat. **Remove from this chat** detaches a book and suppresses its recall here. Detaching the managed Story World also restores messages hidden by its summaries. **Hide from list** hides a historical card. **Delete book everywhere** asks for confirmation before permanently deleting the shared book. Export JSON first if you want a copy. **Edit or delete entries** changes the physical book. Bulk edits apply only the fields you fill in. Actual entry selection for a specific turn remains available under **What Was Sent**.

Under **Guideline and reference books**, choose **Behavior & Guidelines** or **Knowledge & Reference**, then assign an existing book, upload one or more World Info JSON files, or create an empty book. You can pause or unassign each book in the current chat. A chapter continuation inherits these assignments. Open **Edit or delete entries** directly on each book’s card. Each entry shows its activation, chance, sticky duration and cooldown. Use **View full entry** to read it, **Edit** to change it, or **Delete** to remove it. **Chat-specific conditions** on a guideline entry can require a character, location, or extension module.

Use **Always eligible** and a chance below 100% for random reminders. Choose **Keyword triggered** to require a match, then pick the host’s recent chat scan, **Latest user message**, or **Previous model reply**. The two scoped sources scan the latest visible message of that role. They honor primary and secondary keys, regular expressions, and per-entry case and whole-word settings. The host handles chance, sticky duration and cooldown for native entries. The extension handles those settings in replies for managed Story World entries and starts a new interval when the entry reaches a request. In an entry editor, open **Help choosing triggers** to request suggestions from that entry’s title and text. Pick which phrases to add to the draft, then save the entry.

**Start a new chapter** prepares a separate native Story World containing the accepted recap and copied story records. The source chat keeps its book. You can review opening time, date, location, and weather before starting. The inherited recap is eligible for the first six replies by default, then returns on matching triggers. Later chapter rollups can incorporate it into a refreshed recap. Relationship notes carry over, and tracked moods keep the amount of recovery that has already occurred. Open its entry to change the window, triggers, chance or stickiness, choose always-on recall, or disable it. Native book entries use the host's message-based sticky setting. Managed Story World entries use replies.

### Use Vexa or another host preset with extension memory

Select the preset in the host. In **Setup → Preset & Extension → Story workflow for this chat**, choose **Memory only**. The active host preset controls writing, mechanics, and reply rendering. The extension can still add three components:

- **World Info recall** loads the pinned Base World using its host triggers and recalls relevant factual entries from the chat’s managed Story World. Host-selected lorebooks retain their own triggers.
- **Chapter summaries** writes and stores summaries and recalls them independently of World Info recall. A Story World is created for the chat when needed. In Memory only, set an interval in **Review → Context & Memory**, or write a chapter from **Story → Story World**. Automatic scene-end chapters depend on the extension’s story updates and are available in the full workflows.
- **Auto-hide summarized messages** hides successfully summarized older messages from the model while keeping them readable. Turning off this component or Chapter summaries restores messages hidden through the extension. Leave the host preset’s **Chat History** enabled to send the remaining recent messages.

These switches are saved per chat. Choose the **Structured story workflow** to regain the extension’s detailed writing, character, plot, and presentation modules. Reimport the updated companion preset to get its new editable writing blocks for decisive NPCs, recurring NPC creation, voice continuity, turn length, and same-reply quality checks. Optional slow-burn pacing and player-limited viewpoint prompts are available in the host’s prompt list.

- **Story → Opening** offers the character card's greetings or a new draft with optional direction. Review the prose and accept it when ready. The opening and live writing profiles have individual restores.
- **Story → Reusable Lorebooks** lets you choose an existing World Info book or upload a native World Info JSON export and assign it as Base World. Native triggers still apply, with an option to pin selected facts for the opening. Assign multiple guideline and reference books by role. **Chat Facts** and **Plot Records** share the managed Story World book, which is forked with the chat. Protect manual edits in the record editor.
- **Direction → Action Checks** rolls once for the selected actor, stat, difficulty and action. The next reply receives the resolved outcome. An ordinary swipe reuses the result, and the reroll control explicitly replaces it. Optional plot opportunities use the Story World chance and pacing settings. Enabled Random Instructions remain separate and can issue required directions.
- Each assistant reply shows its accepted **Time, Date, Location, and Weather** above the prose. The collapsed **Story state** console shows the selected reply's snapshot and recorded changes. **Setup → Reply Display → World Info under replies** controls the collapsed per-reply card. **Review → What Was Sent → World Info selections** lists the selected entries and source books independently of that display switch and labels entries confirmed in the assembled request. Base World keyword rules are edited in the host's World Info editor. Refresh the pinned copy in **Story → Reusable Lorebooks** to apply changes. Enable **Keep exact story guidance** to retain the confirmed extension guidance in **What Was Sent**. **Roast** has separate generation, display, and future-prompt settings. **Dialogue colors** shows saved choices and any contrast adjustments. The extension reads ordinary narration to color clearly attributed quotes and asterisk-wrapped thoughts.

The companion preset can put an emitted planning outline in the collapsed **Reply planning** disclosure. **Setup → Reply Display** controls its visibility. **Setup → Preset & Extension → Request a reply plan** optionally asks for a brief outline before the prose. The outline stays out of later prompts and does not update the world book.

Open **Story state** below a structured reply to inspect saved **Portrayal**, **Emotions**, **Relationships**, **Knowledge**, **Facts**, and **Plot**, alongside the scene, character snapshots, and changes for that reply. Emotion meters show the last recorded scores. Plot cards include saved status, prerequisites, travel, and outcomes where available. The extension reads these records on demand without a model request. Earlier replies use the saved world changes to recover the state at that point. If historical data is incomplete, the view flags that and shows the records it can verify. **Roast**, **Reply planning**, and **World Info** each retain their own disclosure.

Below the newest reply, scene, character state and story-change previews are visible as soon as the reply is filed. Tap a preview to open the matching detail directly. **Roast** opens independently to a formatted quotation. To change its voice, use **Setup → Reply Display → Customize Roast and feedback prompts → Commentator voice**. The same voice setting applies to Structured and Legacy replies, and Roast generation uses the normal reply request.

State extraction and eligible repair use the ordinary reply request. Drafting or reading an opener can use one setup request. The optional instruction checker and chapter summarizer have their own settings. See the [v10 decision log](docs/v10-vexa-decision-log.md) for the design and verification cases.

## Context and memory

Open **Review → Context & Memory** to adjust chapter timing, automatic hiding, and story notes budgets together. Protect the recent conversation by message count or estimated tokens. The opening and unsummarized messages remain available. The token window always preserves the newest two whole story messages. A chapter can be triggered by reply count, estimated tokens, or scene end. Choose **Apply to saved chapters now** for the new window to update chat visibility immediately. Turning auto-hide off restores messages hidden by the extension. The last-request breakdown estimates conversation, recalled World Info, story state, events and other extension guidance from observed prompt text.

Keep the preset's **Chat History** entry enabled: it supplies the conversation messages still available after hiding. Without a Story World, chapters cannot be written or hide covered messages. Automatic summaries each use an AI request; adjusting these controls and inspecting estimates do not. Defaults are a chapter every 20 model replies or at scene end, hiding on, and 30 protected recent messages; existing user settings are preserved.

Under **Review → Context & Memory → Catch up or rebuild this chat**, **Catch up this chat** writes missing chapters and files supported story details. It creates a managed Story World for a previously untracked chat. Each batch uses one model request, and a stopped or failed run can resume from its saved chapters. **Fresh rebuild options** reads all accepted replies and switches the chat to a new Story World after a successful rebuild. The prior book remains available. You can choose whether to carry forward authored entries and state corrections. Both actions respect chapter summaries, the auto-hide switch, and the protected recent-message window.

Use **Story → Corrections** or **Correct story facts** below the latest reply to describe what should be true, then select **Apply correction**. **Regenerate the latest reply** adds a guided swipe to the latest recorded reply. **Find and update sources with AI** adds an optional tracing request and applies supported replacements. The form shows the request count. **Find and edit source records** lets you inspect matching passages and choose exact changes manually. Corrections to character cards and shared lorebooks apply in the open chat. If a guided reply stops, the saved correction stays available to retry. Relevant corrections also carry forward into later prompts.

Saving an edited reply or removing messages from the middle of a chat automatically rolls back dependent managed records and rereads the affected history. A branch or tail deletion reuses valid state from the remaining replies and rereads the relevant portion if that state is missing. The extension updates the branch’s own Story World when one is created.

The last-request view estimates the assembled text observed in this session for the current chat. It recognizes exact passages for recent conversation, story notes, chapters, events, and other extension text. Preset or extension formatting may prevent recognition, so unmatched passages are reported as unknown and categories are partial rather than a complete sum. The host may modify a request after observation; non-text inputs and model-specific framing are not counted. Token figures use roughly four characters per token and can differ substantially by model and language. The breakdown is unavailable when the host does not expose the chat-completion prompt event; it starts fresh on reload and stores only counts in memory.

## Writing nudges and semantic lore recall

Use **Copy to Random Instructions** on an assigned guideline book to create a separate, inactive instruction set for review. The copy keeps the entry text, keywords and scheduling settings and treats each entry as guidance to the model. Once you turn the set on in **Direction → Random Instructions**, you can pause the original guideline book in this chat to send the guidance only through the new set.

To respond to a phrase such as “landed like” in the previous model reply, choose **Only when these words appear**, enter the phrase, set **Where to look** to **Previous model reply**, and choose **The model (writing the reply)** as Actor. Add a version with the correction you want sent on the next reply.

For reference lore without hand-written keyword lists, choose **Vector matching** on an entry and enable **Vector Storage → Enable for World Info** in a host that supports it. This uses the host’s configured embedding provider and retrieval settings. It can surface entries with related meaning, subject to the host’s World Info budget. Literal and regex triggers remain available for wording that needs a precise match.

## Delete instructions, events and writing styles

Choose **Delete** on an instruction card, or **Delete instruction** in its editor, and confirm. This removes the instruction and all its versions for chats that use the set.

On a story-event or writing-style set card or inside its editor, choose **Delete story event set** or **Delete writing style set**. This removes the set's entries and keeps the World Info book available. **Remove from this list** keeps the set and its entries in the book so they can be added again. To delete just a version, category or item, use its **Delete** control and save the editor.

## Customize AI instructions

Each feature has a collapsed **Customize AI instructions** section near its settings. Edit the instruction used for that feature and choose **Save instruction**. A **Customized** label shows which instructions differ from the installed default. Each instruction has its own **Restore default** button and an immediate **Undo restore** option. These settings apply across chats; saving or restoring does not make an AI request.

Placeholders such as `{parts}` and `{direction}` represent live information supplied by the extension. Keep the required placeholders shown by the editor; invalid or empty instructions cannot be saved. The extension assembles chat content, dynamic values and required output formats separately. It does not expose or change prompts supplied by your preset, the host application or other extensions.

Custom wording is stored separately from built-in defaults. If an update changes a default, your saved wording remains in use and the editor offers the current default for comparison. Restoring uses the default in the installed version. Existing writer-wide rules and the commentator's voice remain editable in their original settings.

## Install

1. **Extensions > Install extension**
2. Repository URL: `https://github.com/htleffew/agentos-harness`
3. Branch: `roleplay-instructions-v10`
4. Install, then reload the app.

## First use (2 minutes)

1. Open a chat. Open **Extensions > Roleplay Instructions**. Press **Expand** for a full-screen panel.
2. Press **Add instruction set** and give it a name. Or press **Open a lorebook** to use one you already have
   (for example `char_feelings_bank`).
3. Press **Add instruction**. Give it a name.
4. Press **Write versions with AI**, type one sentence about what should happen, press **Write the versions**,
   tick the ones you like, press **Add the ticked versions**. Or press **Add a version yourself**.
5. Press **Save instruction**. Turn on **On for this chat**. Send a message.
6. Look at the **What Was Sent** tab to see what was sent with each reply and whether it happened.

## The tabs

| Tab | What it is for |
| --- | --- |
| Random Instructions | Your instruction sets and the instructions inside them. Turn a set on or off for the open chat. Set how many instructions can be sent per reply. |
| Random Story Events | Your story event sets: categories, items, dice settings and when an event happens. |
| Random Writing Style | Your writing style sets: categories such as mood and prose style, each with its own timing. |
| Character Goals | This chat's goal for the character, its one-time steps and repeatable actions. |
| Story World | This chat's story world: its entries, the story so far in chapters, who was read as present, and what would be sent with the next reply. Start a new chapter in a new chat from here. |
| What Was Sent | One card per reply: the exact text that was sent, why, and its status (Sent, Done with the words that show it, Overdue, Missed). Buttons: Send again, Undo done, Pick again. |
| Context & Memory | Chapter and hiding controls, a protected-recent-message slider with a text estimate, and the last observed request breakdown. |
| Log | Every request made to the AI: what was sent, what came back, how long it took and, when it failed, why. Copy it or save it as a file. |
| Settings | Pronouns, the AI connection, where sets are kept, one thing per reply, pacing, the rules for the AI writer and your word list, checking, the section under each reply, and links to the conversation and memory controls. |

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
| Only-one group | Instructions with the same group name compete, and one of them is sent per reply. |
| Only once per chat | A story action is retired once it happens. A model direction is retired when it is sent. |
| Sent as | A system note, an out-of-character note, a line spoken by the character, or exactly as written. |
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
- **How often.** Each set shows how many replies will start a new instruction. Around 35% feels lively; over 55%
  feels crowded. Seven instructions at 5% each is about 30%.

## Random Story Events

A story event set holds lists of story ingredients sorted into categories, for example Situation, Complication,
Who drives it, Tone. When an event fires, dice pick one item from each category that is on, and the AI gets one
order: an event must happen in this reply, built from those parts, fitted to what the story has established.

1. Open the **Random Story Events** tab and press **Add story event set**.
2. Tap a category to open it. Type items, or press **Write items with AI** and give it a few words about the
   kind of story.
3. Press **Roll an example event** to see exactly what the AI would receive. Press it again to see items rotate.
4. Set the chance and the wait at the top, press **Save story event set**, and turn on **On for this chat**.

Each category has its own settings:

| Setting | What it does |
| --- | --- |
| How it changes | New pick every time, Keep for a random number of events, or Keep until I turn it off (you choose the item). |
| Items per pick | How many items from the category go into one event. |
| Retire an item once it has happened | An item that has happened in a chat never comes back in that chat. See "When lists run out" below. |
| Use every item before repeating | No item comes back until all the others have had a turn. |
| Wait before an item can return | A just-used item sits out this many events. |
| Never use items tagged | Leaves out items that carry any of these tags. |
| Always include (on an item) | That item is in every fresh pick; the dice fill the rest. |
| Weight (on an item) | A higher weight is picked more often. |
| Never together (on the set) | Pairs of tags, written `past+future, calm+frantic`. When one is picked, items with the other tag are left out of that roll. |
| Saved category settings (on the set) | Save how the categories are set up under a name, such as "Slow burn", and choose one per chat. |

**Events that work wherever the scene is.** An event can fire at any moment, so its items say what happens and
to whom, and leave out where and how. "A shocking event places {{user}} in immediate danger" works in a camp, a keep
or on a ship; "a bridge collapses under the column" only works where there is a bridge and a column.

- **The AI writer is told this for every list**, with examples for its kind: Situation says what happens and who it
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
that chat, and you are told: a message on screen, a line in What Was Sent, and "Used up in this chat" on the set's
card. Any other list that is used up first is simply left out of the events that follow, so a set with 20 situations
and 8 complications gives 20 events, the last 12 with no complication. The set's card shows how many items of each
list are left in the open chat. **Bring the used items back** lets the set pick them again in that chat; earlier
replies keep their record.

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

## Random Writing Style

A writing style set changes how replies are written and leaves the events of the story alone. While a set is on
for a chat, one style order goes out with every reply, built from the categories that are on.

1. Open the **Random Writing Style** tab and press **Add writing style set**. It comes with eight categories:
   {{char}}'s mood and Prose style are on; In the manner of this author, Writing habits, Sense to lead with, Pacing
   and Rule for this reply are off until you turn them on; Point of view and tense is locked so your preset's
   point of view is never changed by accident.
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

## Character Goals

A goal gives the character something to work toward in one chat. Goals are only ever for the character.

1. Open the **Character Goals** tab in a chat. Type the goal as one loose sentence, or press **Write a goal with
   AI**.
2. Add **one-time steps** (each happens once, in any order) and **repeatable actions** (sent again and again).
   Keep them short and loose: "compliment {{user}}" works better than a compliment about one thing in one place.
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

## Story World

A story world holds what is true in one story. One chat uses one world. Open the **Story World** tab, press
**Make a new story world**, and add entries:

| Kind | What it holds |
| --- | --- |
| Character | Role, who they are, strength, flaw, how they talk, what they want, what they plan, and what they know, believe, suspect and are wrong about. |
| Place | What it is, how it is laid out, who is usually there, what goes on there. |
| Group | What it is, what it wants, who leads it, who belongs. |
| Open thread | A matter the story has raised and not settled, with a status from Quiet to Finished. |
| Secret | The secret in full, whose it is, who else knows, and whether it is still kept. |
| Planted detail | Something small the story showed that can matter later. |
| Going on elsewhere | What someone is doing away from the scene. At most three are sent. |
| Chapter | A short account of one stretch of the story. Written for you as you play. |

Every entry can be written by hand or with **Write this entry with AI** (one request, shown in the Log tab, nothing
saved until you press Save).

**A starter world from the character card.** In a new world, press **Fill this world from the character card**. One
AI request reads the card (description, personality, scenario), your persona, the card's own lorebook and the
opening message of the chat, and proposes entries. You see every line and untick what you do not want before
anything is added.

### Story notes: what is sent

Before each reply the extension reads who is in the scene and sends the entries that matter as one block of story
notes. This makes no AI request.

- **Who is present** comes first from the reply's own scene lines (see "Scene" below), which the extension asks for
  itself, so it works under any preset. Without them it is read from a scene header with `present="..."`, a HUD with
  `Active Speakers:` and `Ambient NPCs:` lines or `<profile name="...">` cards, or a plain `Present:` line. When the
  reply has none of these, a character named in the last few messages counts as present.
- **What is sent, in this order:** the story so far, open threads, what is going on elsewhere, the people in the
  scene in full, the place, the secrets of the people in the scene, planted details, then anything else the last
  messages name, in short form.
- **Room.** "Room for story notes" is a number of tokens (600 to start with). When room runs out, people in the
  scene are sent in short form and the extras are left out.
- **Secrets.** A kept secret is sent as one line ("Hale has a secret.") so the AI cannot give away what it has not
  been told. You can choose to send the whole secret with an order to keep it. Once it is out in the open, the
  whole of it is sent.
- The tab shows who was read as present and exactly what would be sent with the next reply. What Was Sent shows the
  same for every reply, and lists anyone the scene named who has no entry yet.

### The world keeps itself up to date

With "Keep the world up to date from each reply" on (it is on to start with), each reply is asked to end with one
short block that records what the reply made true. The extension takes the block out of the reply before it is
shown, checked or sent back, and files it in the world. This makes no extra AI request.

- **What gets filed.** New people, places and groups that have a name. What a person now wants, plans, knows,
  believes, suspects and is wrong about. New open threads, threads that moved or were settled. New secrets and
  secrets that came out. New planted details and ones that paid off. Things going on elsewhere.
- **Names on file.** The request lists the names already on file, so the same person is not added twice.
- **Your own entries.** In an entry you wrote, only the lines that change with the story are kept current. Who a
  person is stays as you wrote it. Any entry can be set to "keep it as I wrote it".
- **You can see and undo everything.** Entries added this way are marked "Added automatically". What Was Sent lists
  what each reply changed, with **Undo these changes**. Swiping a reply away or deleting it undoes what it filed,
  and swiping back files it again.
- **Out of character.** A message that starts with OOC files nothing.

The world also moves by itself:

- **Open threads build.** A thread that has not moved for a number of replies (10 to start with) goes up one step,
  as far as "About to come to a head".
- **Something ready is ordered into the scene.** Each reply has a chance (20% to start with) that one ready thing
  becomes an order for that reply: an open thread that is about to come to a head, a planted detail, something
  going on elsewhere, or (off to start with) a kept secret of someone in the scene. The order counts as the one new
  thing per reply and is checked like any instruction. When it happens, the entry moves on.

### The story so far, in chapters

A long chat stops fitting in what the AI is sent. The extension keeps the story so far in chapters inside the story
world.

- **When a chapter is written.** When the update block says the scene ended and the scene was at least 4 replies
  long. In any case after 20 replies with no chapter. Or when you press **Write a chapter now**. All three numbers
  are settings.
- **What it costs.** One AI request per chapter, made after the reply has arrived, so the reply is never kept
  waiting.
- **What is sent.** The story notes start with "The story so far": the newest 2 chapters of this chat in full, and
  older chapters in short when someone or somewhere in them comes up. It has room of its own (800 tokens to start
  with).
- **When chapters pile up.** With more than 8 chapters in a chat, one AI request combines the older ones into a
  single account. The newest ones stay as they are.
- **What is finished moves into the chapter.** Threads that were settled, secrets that came out, planted details
  that paid off and things elsewhere that finished are written into the chapter in one line each and turned off, so
  the world holds what is still open. This can be turned off.
- **Hide what a chapter covers** (on to start with). When a chapter is written, the messages it covers are hidden
  from the AI, the same as the `/hide` command, except the newest 30 messages. They stay in your chat and you can
  still read them. This keeps a long chat short for the AI with no extra AI request, so Message Limit, SillyTavern's
  Summarize and TunnelVision's autohide can all be turned off.
- **Swipe and delete.** A chapter belongs to the last reply it covers. Deleting or swiping away that reply removes
  the chapter, turns back on what the chapter had taken in, and shows again the messages it hid.
- **SillyTavern's own Summarize.** When it is also putting a summary into the prompt, the tab says so. Use one of
  the two, so the story so far is sent once.

**A new chapter in a new chat.** With chapters and hiding on, a chat can stay shorter for the AI, so this is
optional. Use it for a clean break, a time skip, or when a very long chat file loads slowly. The button is at the top
of the What Was Sent tab and at the bottom of the Story World tab. Press **Start a new chapter in a new chat**. You can
say what you want for it ("the next morning, on the ship"). One AI request writes a very detailed summary and a
first message. Both are shown for you to change. Then a brand new chat opens for the same character, with your
first message in place of the greeting. It brings along the story world, the sets that are on, the goal with the
steps already done, the pronouns, locked picks, and what has already happened for good. The summary is kept in the
world as "The story before this chat" and sent with every reply. With no story world, the summary is kept in the
new chat itself and sent the same way. The chat you were in stays exactly as it was. Both chats use the same world,
so the world shows the story as it stands now. A new chapter is never copied the way a branch is.

## Pacing

- **One thing per reply.** Only one new thing starts in a reply, counted across every instruction set, every story
  event set, the goal task and the story world's own orders. When more are ready, one is picked at random and the
  others wait. Change the number in Settings; 0 turns it off. Writing style, the goal line and story notes are
  always sent.
- **Burn after it happens.** An instruction can be set to "Only once per chat". A list in a story event set can
  "Retire an item once it has happened". Both are retired for that chat only, and come back if you delete the reply
  where it happened.
- **Quiet after a big event.** After a big event has happened, nothing new starts for a number of replies (2 to
  start with). What is already under way carries on. Big events are story event sets marked big, and an open thread
  of the story world coming to a head. What Was Sent says when a reply was kept quiet and why.
- **A character who has gone quiet.** With a story world: a character of the world who has been in the scene for 4
  replies and is named in the story text of none of them is ordered to speak or act. The number is in Settings; 0
  turns it off.
- **Story phases.** Off to start with. A phase starts at a reply number and lasts until the next one starts. Each
  phase has a percentage of the usual chance that something new starts (50 halves every chance, 150 raises it by
  half, 0 starts nothing new) and, if you want, one line that is sent with every reply of the phase.

## Scene: who is present, where and when

Every reply is asked for who is present, where the scene is, and the day, time of day and weather, plus important continuing environmental conditions when they change. With a story world they are part of the one update block; without one they are asked
for on their own. The extension takes them out of the reply and keeps them on it. This adds no AI request.

- The story notes, story event items that need a number of people or someone's secret or plan, the order for a
  character who has gone quiet, and the dice all use these lines, so they work the same whatever preset is on.
- **Story state.** Separate collapsed cards under each reply show the scene and relevant character state. To start with it is only shown under
  a reply that has no scene tracker of its own, so with a preset that draws its own HUD (such as Sola V6 Slim)
  nothing is shown twice. It can be set to always or off in Settings > Scene.
- An out-of-character message is not asked for the lines.

## Story state and the roast

The extension asks for changes to a character's **Mind**, **Heart**, **Body**, and **Psyche** in the same update block as the world changes. Unchanged fields can be omitted; `CLEAR` resolves a field. The resulting state is kept with the chat, and a compact selection for the current scene is included in future prompts. This makes no separate model request, although generated updates use output tokens. The approximate prompt budget is adjustable in Settings > Character cards; story-world and chapter budgets remain separate.

- **Current State** in the extension panel shows and edits scene and character state. An edited field is protected from automatic changes until you uncheck protection. Protected corrections are kept in chat metadata, so replacing or deleting the reply that was newest when you edited does not remove them. Their recorded history lets a branch retain earlier corrections while leaving out later ones. Unprotected edits follow the reply where they were made.
- Separate **Scene** and character cards under each reply show the state after that reply; each opens independently and starts collapsed. Edit a historical card to correct that snapshot alone, or also apply the changes to the current state. Neither action rewrites subsequent story text. Settings > Scene controls visibility and whether a preset's tracker hides it. What Was Sent remains off under replies by default.
- **Story World** still owns durable facts, wants, plans, secrets, and threads. Its character editor has an enduring boundaries field. Use **Save a lasting fact to Story World** on a current character card to explicitly write a fact to an existing character entry; the chosen field is replaced after confirmation if it already contains text. Current state does not silently overwrite those entries.
- **Story event limits** in Current State filters random event items by exact user-supplied tags. It also checks repeated and rerolled items. Untagged items, other instructions and automatic world orders are not filtered. Free-text boundaries and conditions are included as prompt guidance; the extension cannot reliably determine semantic conflicts in arbitrary text.
- The optional roast is collapsed. Settings > Character cards controls whether the previous roast is included in the next prompt; this is off by default. Tracking, showing state and displaying What Was Sent are separate choices.
- Editing a model reply marks its card and dependent later state as out of date, withdraws their automatic world changes, and asks you to review. Current State can draft a reviewable update using one extra AI request; applying it is optional. Manually edited facts and summaries need your review. Overlapping chapter summaries are withheld from future prompts until you mark the story reviewed. An out-of-character message is not asked for an update. Branches can only rewind changes that were recorded; review old chats and edits made outside this extension, which may lack a complete history. If the branch book cannot be created, the extension disconnects the parent world and reports the error so that the branch cannot silently write into it.
- Existing v5 cards remain intact. When an old card has no v6 updates, its Thinks, Feels and Keeps private values are read as Mind, Heart and Psyche; the old Will not judgment is not imported as a boundary. Historical cards remain snapshots.

## Guide a swipe

Under the newest recorded character reply, open **Guide a swipe**, write the direction for its replacement, and choose **Generate guided swipe**. The direction is sent with that replacement only, not added to the story text or later prompts. The direction is kept in the replacement's extension record. This uses the normal swipe generation; it adds no separate model request. If instruction checking is enabled, the existing checker may still make its usual additional request.

By default, the previous turn's random events and instructions are left out; its long-running style and goal settings remain available. Choose **Repeat the previous turn’s orders** when you want them again. Earlier established story facts and protected corrections from before the replaced reply remain available. The model is asked to follow the direction, but a model may not obey it perfectly.

The extension rolls back the replaced reply's recorded Story World changes before generating, and files what the replacement establishes. It does not rewrite unrelated lorebooks, preset instructions, or facts modified outside its records. A guided swipe is stopped before generation if the world cannot be reversed safely, the reply has protected corrections or manually edited world facts attached to it, or old timing/chapter changes lack enough rollback information. Review those changes first; the extension does not overwrite them. To deliberately retain manual world edits, select the corresponding checkbox after reviewing them. If an edit conflicts with an automatic rollback, resolve the conflict in Story World first. To generate a new swipe while viewing an older saved swipe, first move to the newest existing swipe.

If generation is stopped or fails, the extension attempts to restore the prior world; if that world was independently edited in the meantime, it leaves the newer edit alone and asks you to review. Existing swipes remain available. The guidance does not change permanent instructions or settings.

## Dice

The extension rolls the dice in code. The AI is told the results and never rolls or adds.

- Before every reply, one d20 is rolled for each side that is on: {{user}} (for what you attempt in your message),
  {{char}}, and any other character (one shared roll, with no stats).
- **Stats.** Six to start with: Strength, Agility, Wits, Charm, Will, Senses. Each is a whole number from -20 to +20, set in
  Settings > Dice. {{char}}'s stats are kept with the character card and yours with your persona. You can rename,
  add or delete stats.
- **Outcome**, worked out in code for every stat from the total (the d20 plus the stat) alone: 2 or less fails badly,
  3 to 7 fails, 8 to 11 partly succeeds, 12 to 16 succeeds, 17 to 21 succeeds well, 22 or more succeeds brilliantly.
  0 is average and +1 to +5 is ordinary skill. At +20 the lowest total is 21, so the attempt cannot fail.
- **When it is used.** The AI is told to use a result only when someone attempts something with real stakes and a
  real chance of failing, to pick the stat that fits, and to ignore the dice otherwise. When a reply is checked
  anyway, the check also asks whether the reply used a result, and What Was Sent shows the answer.
- A swipe keeps the same roll. "Pick again and write a new reply" rolls again. An out-of-character message gets no
  dice. Dice are not a "new thing" and do not count toward one thing per reply.

## Checking, and What Was Sent

- **Checking** uses one short AI request after each reply that carried an order. It finds the words in the reply
  that show the order happened. An order that did not happen is sent again as Overdue and then as Final, and then
  it stops. Pick a small, cheap model for it in Settings > AI connection for writing and checking.
- **Swipes and regenerate** send the same instructions and versions again. Press **Pick again** in What Was Sent
  to roll fresh ones.
- **What Was Sent** has one card per reply with the exact text, why it was sent, its status, what the dice picked,
  what the reply changed in the story world, the story phase, and the answers to the writing style's questions.
- **The Log** holds every request made to the AI, with the whole answer and the reason when one failed. Models that
  think before they answer can use up the room for the answer; "Give the AI more room to answer" in Settings fixes
  that, and it turns itself on when a second try with more room works.
- **Background requests** (summaries, impersonate) never carry instructions and never use up timers.

## What the AI writes for you

- **What the AI writer can read.** When you write versions, items, goals or entries with AI, tick what it may read:
  the character card, the scenario, your persona, the story so far (your chapters, or a summary kept by
  SillyTavern), and the most recent chat messages.
- **Rules given to the AI writer** (Settings). A short list in plain words, added to every writing request. The
  starting rules ask for plain literal wording and named feelings, for events that come from what people want,
  feel, find out and choose, and they keep out lasting bodily states (injury, pain, tiredness, cold, hunger) and
  prices, debts, ownership, records, paperwork and officials. The rules are yours to change.
- **Your word list** (Settings). Words you do not want. Text that uses one gets the line "On your word list" where
  you review it. It is a flag, so you can always keep the text. A star at the end of a word stands for any ending.
  The list can also be sent to the AI writer so fewer of these words come back.

## Where your sets are kept: one lorebook or many

Settings > **Where your sets are kept** decides where sets are saved.

- **One shared lorebook.** Every set you add is kept inside one lorebook (named "Roleplay Instructions" unless you
  pick another name), each as a named group of entries. This is how a new install starts.
- **A lorebook of its own for each set.** An install that already has sets from Versions 1 to 4 stays this way
  until you change it.
- **Which ones share.** The same section lists every set with a choice of where it is kept, and a button that moves
  all of them into the shared lorebook.

Moving a set copies every entry whole (versions, timing, notes). What your chats recorded still counts: waits carry
on, "only once" stays retired, and a chat that had the set on still has it on. When a set leaves a lorebook of its
own, that lorebook is left exactly as it was, as a spare copy. A shared lorebook can also hold your own entries
that belong to no set. The extension leaves those alone.

## When the extension makes an AI request

| What | Requests |
| --- | --- |
| Sending instructions, events, style, the goal, story notes, dice | None |
| Hiding what a chapter covers | None |
| Keeping the story world up to date from each reply | None (the block is part of the reply) |
| Checking that an order happened | 1 per reply that carried an order |
| A chapter of the story so far | 1 per chapter |
| Combining older chapters | 1, when a chat has more than 8 chapters |
| Write with AI (versions, items, a goal, a story world entry) | 1 each time you press the button |
| Fill a world from the character card | 1 |
| Start a new chapter in a new chat | 1 |

Every request is listed in the Log tab.

## Things worth knowing

- **Timing is counted in replies, by the extension.** "Keep sending for 2 replies" and "Wait 5 replies" mean
  exactly that. The extension reads what was sent from the record on each reply, so timing stays right after
  swipes, deletes and branches.
- **Hidden messages still count.** SillyTavern's own World Info timers count the messages they are handed. When
  older messages are hidden from the AI, or another extension leaves messages out, that number stops growing and
  those timers stop working. This was seen on a TauriTavern tablet, where World Info was handed 40 messages however
  long the chat grew. Message Limit does exactly this: it drops the oldest messages from what is sent, with no
  summary of them, until the limit is reached. This extension counts replies from the chat itself, hidden ones
  included, so timing, story phases, thread clocks and chapters keep counting. Context & Memory counts the messages in the finished prompt of the last reply, after every other extension, so it shows
  how many messages were really sent and whether another extension left any out.
- **Other extensions that overlap.** With chapters on, turn off SillyTavern's Summarize (the story so far would be
  sent twice). With "Hide what a chapter covers" on, Message Limit and TunnelVision's autohide are not needed.
- **With the extension off**, a set still works if you turn its lorebook on in World Info (a shared lorebook then
  sends from every set inside it): each entry holds a `{{random::...}}` list of its versions. Per-reply limits, the
  no-repeat cycle, checking and What Was Sent need the extension. Story world entries are then ordinary lorebook
  entries, sent when their name appears.
- **You do not need World Info's selector.** "On for this chat" in the panel is enough. If a set in a lorebook of
  its own is also turned on in World Info it is still sent only once.

## Editing, deleting, branching

The record of what was sent lives on each reply, so it follows the reply wherever it goes.

| You do this | What happens |
| --- | --- |
| Edit the newest reply | Its generated state and automatic world changes are withdrawn and marked for review. If checking is on, its instructions may also be checked again. Current State can draft an update for review with one AI request. |
| Edit an older model reply | Generated state and automatic world changes from that reply onward are marked stale and withdrawn, newest first. Protected corrections remain. Current State offers a reviewable rebuild; check manually edited world entries and chapters too. |
| Delete messages | Their records go with them. Anything waiting to be sent again because of a deleted reply is dropped, timers started by deleted replies are cleared, and what those replies filed in the story world is undone. |
| Swipe or regenerate the newest reply | An ordinary swipe repeats the same instructions and versions. Guide a swipe can instead include a one-time direction and leave those orders out. The extension rolls back recorded world changes from the replaced reply when it can do so safely. |
| Branch a chat | The branch keeps which sets are on, your pronouns, the goal, the story world it uses, and the records up to the branch point. Chapters written before the branch point are the branch's chapters too, and messages hidden by them stay hidden. The first time the branch is opened it gets a separate lorebook named "(branch)". Recorded changes after the branch point are undone on that copy, and the parent world is left alone. A branch of a chat with no world gets a new empty book. The original chat and its world are untouched. "A branch gets its own copy of the world" in the Story World tab turns this off. |

## Where things are stored

| What | Where |
| --- | --- |
| Instructions and versions | In the lorebook file. Each entry has `extensions.ri` (versions, sent as, who does it, notes). In a shared lorebook the entry also carries its set's name (`extensions.ri.set`), and the file lists its sets (`extensions.ri.groups`). |
| Story world entries and chapters | In the lorebook file, as ordinary entries keyed by name. Each has `extensions.ri` with `type: "world"`, its kind, its lines and its status. |
| Which sets exist and where each is kept, per-reply limits, pacing, the word list, settings | SillyTavern extension settings (`roleplay_instructions`). |
| Which sets are on, which world the chat uses, pronouns, the goal, what is waiting to be sent again | In the chat file (chat metadata). |
| What was sent with each reply, and what it changed in the story world | On the message itself (`extra.roleplay_instructions`). |

## Tests, and what they do not cover

`tests/` holds the scripts used to check this version against a local SillyTavern 1.19.0 with a mock model. See
`tests/README.md`. They do not cover real models, the TauriTavern tablet app, or group chats. With a real model
the open questions are whether the model writes the update block with every reply, whether it marks the end of a
scene, and whether it keeps to the forms asked for when a chapter or a new first message is written. The Log tab
shows every case where an answer could not be read.
