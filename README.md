# Roleplay Instructions

A standalone SillyTavern / TauriTavern extension. Version 3: **Random Instructions**, **Random Story Events** and
**Random Writing Style**.

You build *instruction sets*. Each instruction has several *versions* of the same order ("{{char}} must pay
{{user}} a compliment"). During a chat, an instruction is sent at random with the chance and timing you set, one
version at a time. The extension then checks whether it happened, and sends it again with firmer wording if it
did not.

Every instruction set is an ordinary lorebook, so SillyTavern's World Info does the chance and timing. The
extension adds the easy editor, the AI writer, per-reply limits, the check, and a record of exactly what was sent.

- Works with any preset. Chat Completion. Needs SillyTavern 1.19 or later, or a TauriTavern build on 1.19.
- Depends on no other extension.
- Everything lives in one panel in the Extensions menu. Nothing is added to the chat screen unless you turn on
  "Show what was sent under each reply".

## Install

1. **Extensions > Install extension**
2. Repository URL: `https://github.com/htleffew/agentos-harness`
3. Branch: `roleplay-instructions-v3`
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

## Random Story Events (new in Version 2)

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
| Items per pick | How many items from the category go into one event. One category with 3 items per pick works as a classic mixed premise list. |
| Use every item before repeating | No item comes back until all the others have had a turn. |
| Wait before an item can return | A just-used item sits out this many events. |
| Never use items tagged | Leaves out items that carry any of these tags. |
| Always include (on an item) | That item is in every fresh pick; the dice fill the rest. |
| Weight (on an item) | A higher weight is picked more often. |
| Chance to change once that time is over | For "Keep for a random number": 100 changes the pick as soon as the time is up; a lower number lets it stay on a little longer. |
| Never together (on the set) | Pairs of tags, written `past+future, calm+frantic`. When one is picked, items with the other tag are left out of that roll. |
| Saved category settings (on the set) | Save how the categories are set up under a name, such as "Slow burn", and choose one per chat while the set itself stays as it is. |

In **What Was Sent**, every picked item has three buttons: **Pick again** (a different item for that category
only, with a new reply), **Lock for this chat** (use this pick for the rest of the chat), and **Keep until I turn
it off** (change the set so that category always uses this item). These settings and buttons work the same way
for Random Writing Style.

The dice are the extension's own. The AI never chooses the items. What was picked is shown in What Was Sent, the
event is checked like any instruction, and the state of every category is kept on the reply, so swipes repeat the
same event and deleting or branching rewinds the rotation correctly. `{{user}}` can never be the one who drives
an event.

## Random Writing Style (new in Version 3)

A writing style set changes how replies are written and leaves the events of the story alone. While a set is on
for a chat, one style order goes out with every reply, built from the categories that are on.

1. Open the **Random Writing Style** tab and press **Add writing style set**. It comes with eight categories:
   {{char}}'s mood (17 temperaments) and Prose style are on; In the manner of this author, Writing habits, Sense to
   lead with, Pacing and Rule for this reply are off until you turn them on; Point of view and tense is locked so
   your preset's point of view is never changed by accident.
2. Open a category to set how long its pick lasts. Each category has its own timing, counted in replies:
   keep one item until you turn it off, keep a pick for a random number of replies (for example 4 to 8), or pick
   new every time. A category can also sit out by chance, and rest after each pick ("Rule for this reply" rests
   1 reply, so a rule is never used twice in a row).
3. Press **Roll the next reply's style** a few times to see what stays and what changes.
4. Save, and turn on **On for this chat**.

The style order says that it applies to the story prose only, that tagged or formatted blocks keep their exact
format and position, that events, facts and choices stay as they would otherwise be, and that a required
instruction wins over any style choice. Writing style is recorded in What Was Sent and is not checked by AI,
since it is sent again with every reply anyway. It keeps going while an instruction is overdue, and it does not
count toward per-reply limits. "Write items with AI" works for every category, including author names.

Rules that can be counted are checked against each reply without AI and shown in What Was Sent as "Followed" or
"Not followed". Give an item one of these tags: `rule:no-dialogue`, `rule:mostly-dialogue`, `rule:max-sentences-2`
(per paragraph), `rule:max-words-200` (any number works). A style item that reads like a story happening gets a
warning that it belongs in Random Story Events.

## The tabs

| Tab | What it is for |
| --- | --- |
| Random Story Events | Your story event sets: categories, items, dice settings and when an event happens. |
| Random Writing Style | Your writing style sets: categories such as mood and prose style, each with its own timing. |
| Random Instructions | Your instruction sets and the instructions inside them. Turn a set on or off for the open chat. Set how many instructions can be sent per reply. |
| What Was Sent | One card per reply: the exact text that was sent, why, and its status (Sent, Done with the words that show it, Overdue, Missed). Buttons: Send again, Undo done, Pick again. |
| Settings | Pronouns for this chat, which AI connection writes and checks, how checking and re-sending work, and the optional section under each reply. |

## Things worth knowing

- **Timing is counted in replies, by the extension.** "Keep sending for 2 replies" and "Wait 5 replies" mean
  exactly that. The extension reads what was sent from the record on each reply, so timing stays right after
  swipes, deletes and branches, and in long chats where a summarizer or context limit hands World Info only the
  most recent messages. (World Info's own sticky and cooldown count the messages it is handed; when that is a
  fixed window, they freeze. This was seen on a TauriTavern tablet.) The same numbers are still saved in the
  lorebook as `sticky` and `cooldown` for use with the extension off.
- **How often.** Each set shows how many replies will start a new instruction. Around 35% feels lively; over
  55% feels crowded. Seven instructions at 5% each is about 30%.
- **Swipes and regenerate** send the same instructions and versions again. Press **Pick again** in What Was
  Sent to roll fresh ones.
- **Versions do not repeat** until every version of that instruction has been used once.
- **{{user}} never acts.** A version where {{user}} acts, speaks, decides, thinks or feels is marked "Must fix"
  and cannot be saved.
- **What the AI writer can read.** When you write versions or items with AI, tick what it may read: character
  card, scenario, your persona, chat summary, the most recent chat messages. That is how it writes things that
  fit where your story is right now.
- **Who does it.** Besides the character, someone who is present, someone new, or the surroundings, you can pick
  "any character", "any female character" or "any male character", each "already in the story or new". The AI
  then uses someone who is there, or brings someone in, so the order can always be carried out.
- **Names and pronouns** are placeholders. Tap the name and pronoun buttons while editing. Set pronouns once
  per chat in Settings. One instruction set then works with any character and persona.
- **Checking** uses one short AI request after each reply that carried an instruction. Pick a small, cheap
  model for it in Settings > AI connection for writing and checking. If you send your next message while a check
  is still running, the extension waits for it (20 seconds at most) so a missed instruction can go out again.
- **Background requests** (summaries, impersonate) never carry instructions and never use up timers.
- **With the extension off**, a set still works if you turn the lorebook on in World Info: each entry holds a
  `{{random::...}}` list of its versions. Per-reply limits, the no-repeat cycle, checking and What Was Sent need
  the extension. Timing then comes from World Info's own counters, which stop working in chats longer than the
  window of messages your setup sends.

## Editing, deleting, branching

The record of what was sent lives on each reply, so it follows the reply wherever it goes.

| You do this | What happens |
| --- | --- |
| Edit the newest reply | It is checked again. If your edit made the instruction happen, it shows Done and is taken off the waiting list. |
| Edit an older message | Nothing changes. Old replies are never re-checked on their own. |
| Delete messages | Their records go with them. Anything waiting to be sent again because of a deleted reply is dropped. "Keep sending" and "wait" timers started by deleted replies are cleared. The chat carries on from the state of the newest reply that is left. |
| Delete only the reply that carried a reminder | You are back one step: the earlier reminder is waiting again. |
| Swipe or regenerate any newest reply | The same instructions and versions are sent again, also after you deleted later messages. |
| Branch a chat | The branch keeps which sets are on, your pronouns, and the records up to the branch point, and continues from the state at that reply. The original chat is untouched. |

You do not need to assign instruction sets in SillyTavern's World Info selector. "On for this chat" in the panel
is enough. If a set is also turned on in World Info it is still sent only once, but it then stays on wherever
World Info has it on, whatever the panel switch says.

## Where things are stored

| What | Where |
| --- | --- |
| Instructions and versions | In the lorebook file. Each entry has `extensions.ri` (versions, sent as, who does it, notes). |
| Which lorebooks are instruction sets, per-reply limits, settings | SillyTavern extension settings (`roleplay_instructions`). |
| Which sets are on, pronouns, what is waiting to be sent again | In the chat file (chat metadata). |
| What was sent with each reply | On the message itself (`extra.roleplay_instructions`). |

## Tests

`tests/` holds the scripts used to check this version against a local SillyTavern 1.19.0 with a mock model:
sending and version cycling, checking and re-sends, swipes, per-reply limits, quiet requests, keep and wait
timing, the AI writer and its checks, the saved lorebook text, both "under each reply" modes, and a 50-reply
run. See `tests/README.md`.

## Roadmap

Version 4 adds Character Goals, on its own branch.
