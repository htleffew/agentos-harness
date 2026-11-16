# Roleplay Instructions

A standalone SillyTavern / TauriTavern extension. Version 5 (in progress): **Random Instructions**, **Random Story
Events**, **Random Writing Style**, **Character Goals** and a **Story World**, kept in one lorebook or in several,
with at most one new thing started per reply.

You build *instruction sets*. Each instruction has several *versions* of the same order ("{{char}} must pay
{{user}} a compliment"). During a chat, an instruction is sent at random with the chance and timing you set, one
version at a time. The extension then checks whether it happened, and sends it again with firmer wording if it
did not.

Every set is saved in an ordinary lorebook, so SillyTavern's World Info does the chance and timing. All your sets
can share one lorebook, or each can have its own. The extension adds the easy editor, the AI writer, per-reply
limits, the check, and a record of exactly what was sent.

- Works with any preset. Chat Completion. Needs SillyTavern 1.19 or later, or a TauriTavern build on 1.19.
- Depends on no other extension.
- Everything lives in one panel in the Extensions menu. Nothing is added to the chat screen unless you turn on
  "Show what was sent under each reply".

## Install

1. **Extensions > Install extension**
2. Repository URL: `https://github.com/htleffew/agentos-harness`
3. Branch: `roleplay-instructions-v5`
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

## One lorebook or many (new in 5.1)

Settings > **Where your sets are kept** decides where sets are saved.

- **One shared lorebook.** Every set you add is kept inside one lorebook (named "Roleplay Instructions" unless you
  pick another name). Instruction sets, story event sets and writing style sets all live there, each as a named
  group of entries. This is how a new install starts.
- **A lorebook of its own for each set.** How Versions 1 to 4 worked. An install that already has sets stays this
  way until you change it.
- **Which ones share.** The same section lists every set with a choice of where it is kept, and a button that moves
  all of them into the shared lorebook. You can keep some sets shared and others apart.

Either way each set is turned on or off per chat, keeps its own per-reply limit, and "One thing per reply" counts
across all of them, so a reply is never handed an instruction, a story event and a goal task at once.

Moving a set copies every entry whole (versions, timing, notes). Each copy remembers the key it had before, so
what your chats recorded still counts: waits carry on, "only once" stays retired, used story event items stay
used, and a chat that had the set on still has it on. When a set leaves a lorebook of its own, that lorebook is
left exactly as it was, as a spare copy. Delete it in World Info when you no longer want it.

A shared lorebook can also hold your own entries that belong to no set. The extension leaves those alone.

## Story World (new in 5.2)

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

Every entry can be written by hand or with **Write this entry with AI** (one request, shown in the Log tab, nothing
saved until you press Save).

Before each reply the extension reads who is in the scene and sends the entries that matter as one block of story
notes. This makes no AI request.

- **Who is present** is read from the newest reply: a scene header with `present="..."`, a HUD with
  `Active Speakers:` and `Ambient NPCs:` lines or `<profile name="...">` cards, or a plain `Present:` line. When the
  reply has none of these, a character named in the last few messages counts as present. Other names of an entry
  count too.
- **What is sent, in this order:** open threads, what is going on elsewhere, the people in the scene in full, the
  place, the secrets of the people in the scene, planted details, then anything else the last messages name, in
  short form.
- **Room.** "Room for story notes" is a number of tokens (600 to start with). When room runs out, people in the
  scene are sent in short form and the extras are left out. When several named entries compete for the last of the
  room, the ones sent least lately go first.
- **Secrets.** A kept secret is sent as one line ("Hale has a secret.") so the AI cannot give away what it has not
  been told. You can choose to send the whole secret with an order to keep it. Once it is out in the open, the
  whole of it is sent.
- **Where the notes go.** In the chat a few messages up from the end (works with every preset), or with the
  preset's lorebook entries.
- The tab shows who was read as present and exactly what would be sent with the next reply. What Was Sent shows the
  same for every reply, and lists anyone the scene named who has no entry yet.

### The world keeps itself up to date (new in 5.3)

With "Keep the world up to date from each reply" on (it is on to start with), each reply is asked to end with one
short block that records what the reply made true. The extension takes the block out of the reply before it is
shown, checked or sent back, and files it in the world. This makes no extra AI request.

- **What gets filed.** New people, places and groups that have a name. What a person now wants, plans, knows,
  believes, suspects and is wrong about. New open threads, threads that moved or were settled. New secrets and
  secrets that came out. New planted details and ones that paid off. Things going on elsewhere.
- **Names on file.** The request lists the names already on file, so the same person is not added twice. A name
  that matches an entry, or another name of it, is never added again.
- **Your own entries.** In an entry you wrote, only the lines that change with the story are kept current (wants,
  plans, what they know, where a thread stands). Who a person is stays as you wrote it. "On, and leave my own
  entries alone" changes only entries the extension added. Any entry can be set to "keep it as I wrote it".
- **You can see and undo everything.** Entries added this way are marked "Added automatically". What Was Sent lists
  what each reply changed, with **Undo these changes**. The Log tab has the block and each change in plain words.
  Swiping a reply away or deleting it undoes what it filed, and swiping back files it again. Saving an automatic
  entry yourself makes it yours, and it is then kept.
- **Out of character.** A message that starts with OOC files nothing.

The world also moves by itself:

- **Open threads build.** A thread that has not moved for a number of replies (10 to start with) goes up one step,
  as far as "About to come to a head".
- **Something ready is ordered into the scene.** Each reply has a chance (20% to start with) that one ready thing
  becomes an order for that reply: an open thread that is about to come to a head, a planted detail, something
  going on elsewhere, or (off to start with) a kept secret of someone in the scene. The order counts as the one new
  thing per reply and is checked like any instruction. When it happens, the entry moves on: the thread is
  "Happening now", the detail is "Paid off", the secret is "Out in the open".

### The story so far, in chapters (new in 5.4)

A long chat stops fitting in what the AI is sent. The extension keeps the story so far for you, in chapters, inside
the story world.

- **What a chapter is.** A short account of one stretch of the story: what happened, when, who was in it, where, and
  what was settled. It is an entry in the story world like any other, so you can read it, change it, turn it off or
  write one by hand.
- **When one is written.** When the update block says the scene ended (the story moved to a new time or place) and
  the scene was at least 4 replies long. A scene that ends sooner is joined to the next chapter. In any case after 20
  replies with no chapter. Or when you press **Write a chapter now**. All three numbers are settings.
- **What it costs.** One AI request per chapter, made after the reply has arrived, so the reply is never kept
  waiting. It uses the connection chosen in Settings and is listed in the Log tab with the replies it covers.
- **What is sent.** The story notes start with "The story so far": the newest 2 chapters of this chat in full, and
  older chapters in short when someone or somewhere in them comes up. It has room of its own (800 tokens to start
  with), separate from the room for the rest of the notes.
- **When chapters pile up.** With more than 8 chapters in a chat, one AI request combines the older ones into a
  single account called "Before the latest chapters". The newest ones stay as they are. Chapters you saved yourself
  are switched off, and automatic ones are removed.
- **Swipe and delete.** A chapter belongs to the last reply it covers. Deleting or swiping away that reply removes
  the chapter.
- **SillyTavern's own Summarize.** When it is also putting a summary into the prompt, the tab says so. Use one of
  the two, so the story so far is sent once.

**A new chapter in a new chat.** When a chat has grown long, press **Start a new chapter in a new chat**. You can
say what you want for it ("the next morning, on the ship"). One AI request writes a very detailed summary and a
first message. Both are shown for you to change. Then a brand new chat opens for the same character, with your
first message in place of the greeting. It brings along the story world, the sets that are on, the goal with the
steps already done, the pronouns, locked picks, and what has already happened for good ("only once" instructions
and retired story event items). The summary is kept in the world as "The story before this chat" and sent with
every reply. With no story world, the summary is kept in the new chat itself and sent the same way. The chat you
were in stays exactly as it was. Both chats use the same world, so the world shows the story as it stands now.

**A starter world from the character card.** In a new world, press **Fill this world from the character card**. One
AI request reads the card (description, personality, scenario), your persona, the card's own lorebook and the
opening message of the chat, and proposes people, places, groups, open threads, secrets and planted details. You see
every line and untick what you do not want before anything is added.

A world is kept like any other set: inside the shared lorebook or in a lorebook of its own (Settings > Where your
sets are kept). While the extension is on, world entries only ever go out inside the notes block, and only for the
chat that uses that world. With the extension off they are ordinary lorebook entries, sent when their name appears,
and a shared lorebook turned on in World Info then sends from every world inside it.

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

## Character Goals (new in Version 4)

A goal gives the character something to work toward in one chat. Goals are only ever for the character.

1. Open the **Character Goals** tab in a chat. Type the goal as one loose sentence, or press **Write a goal
   with AI** (it can read the card, scenario, persona, chat summary and recent messages, as you tick them).
2. Add **one-time steps** (each happens once, in any order) and **repeatable actions** (sent again and again).
   Keep them short and loose: "compliment {{user}}" works better than a compliment about one thing in one place.
   Tasks over 8 words, or tied to a place, time or object, get a warning.
3. Turn the goal **On**.

What happens then:

| Part | When it is sent | When it is done |
| --- | --- | --- |
| The goal | With every reply (you can change that) | When every one-time step is done, or when you press "Mark the goal done". Then nothing more is sent. |
| A one-time step | Picked at random when a task is due. Once sent, it is sent again with every reply, as Overdue and then Final, until it happens. It never gives up. | When the check finds the words in a reply that show it. You can also press "Mark done" or "Undo done". |
| A repeatable action | Picked at random when a task is due, for one reply. Then it waits a number of replies (6 to 10 unless you change it). | Never. It is not checked. |

At most one task is sent at a time, and a task is due with the chance you set (35% of replies to start with).
What is done is read from the replies themselves, so deleting the reply that finished a step un-ticks it, and a
branch carries on from where it branched. The goal stands apart from per-reply limits and from instructions that
are waiting to be sent again. With checking turned off in Settings, steps are not ticked off on their own.

**Save this goal to my list** keeps a goal with its steps and actions for other chats. "When the goal is done"
can be set to start the next goal from that list.

## The tabs

| Tab | What it is for |
| --- | --- |
| Random Story Events | Your story event sets: categories, items, dice settings and when an event happens. |
| Random Writing Style | Your writing style sets: categories such as mood and prose style, each with its own timing. |
| Character Goals | This chat's goal for the character, its one-time steps and repeatable actions. |
| Story World | This chat's story world: its entries, the story so far in chapters, who was read as present, and what would be sent with the next reply. Start a new chapter in a new chat from here. |
| Random Instructions | Your instruction sets and the instructions inside them. Turn a set on or off for the open chat. Set how many instructions can be sent per reply. |
| What Was Sent | One card per reply: the exact text that was sent, why, and its status (Sent, Done with the words that show it, Overdue, Missed). Buttons: Send again, Undo done, Pick again. |
| Log | Every request made to the AI: what was sent, what came back, how long it took and, when it failed, why. Copy it or save it as a file. |
| Settings | Pronouns for this chat, which AI connection writes and checks, where your sets are kept, how many new things can start per reply, how checking and re-sending work, and the optional section under each reply. |

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
- **One thing per reply.** By default only one new thing starts in a reply, counted across every instruction set,
  every story event set and the goal task. Change the number in Settings; 0 turns it off. Writing style and the
  goal line are always sent.
- **Burn after it happens.** An instruction can be set to "Only once per chat". A list in a story event set can
  "Retire an item once it has happened". Both are retired for that chat only, and come back if you delete the reply
  where it happened.
- **{{user}} never acts.** A version where {{user}} is the subject of the order, is made to speak or decide, or
  has their reply or thoughts written is marked "Check". It is a flag: in the AI review it starts unticked, you can
  tick it, and it saves. {{user}} as the place or the target ("the bridge under {{user}} must crack") is clean.
- **When AI writing fails, the message says why**, and the Log tab holds the whole answer. Models that think before
  they answer can use up the room for the answer; "Give the AI more room to answer" in Settings fixes that, and it
  turns itself on when a second try with more room works.
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
- **With the extension off**, a set still works if you turn its lorebook on in World Info (a shared lorebook
  then sends from every set inside it): each entry holds a
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
is enough. If a set in a lorebook of its own is also turned on in World Info it is still sent only once, but it
then stays on wherever World Info has it on, whatever the panel switch says. A shared lorebook turned on in World
Info is different: the panel switch still decides for each set inside it, and entries that belong to no set are
sent as World Info decides.

## Where things are stored

| What | Where |
| --- | --- |
| Instructions and versions | In the lorebook file. Each entry has `extensions.ri` (versions, sent as, who does it, notes). In a shared lorebook the entry also carries its set's name (`extensions.ri.set`), and the file lists its sets (`extensions.ri.groups`). |
| Which sets exist and where each is kept, per-reply limits, settings | SillyTavern extension settings (`roleplay_instructions`). |
| Story world entries | In the lorebook file, as ordinary entries keyed by name. Each has `extensions.ri` with `type: "world"`, its kind, its lines and its status. |
| Which sets are on, which world the chat uses, pronouns, what is waiting to be sent again | In the chat file (chat metadata). |
| What was sent with each reply | On the message itself (`extra.roleplay_instructions`). |

## Tests

`tests/` holds the scripts used to check this version against a local SillyTavern 1.19.0 with a mock model:
sending and version cycling, checking and re-sends, swipes, per-reply limits, quiet requests, keep and wait
timing, the AI writer and its checks, the saved lorebook text, both "under each reply" modes, and a 50-reply
run. See `tests/README.md`.

## Roadmap

Version 5 is being built in steps. Done: one thing per reply and burn after it happens (5.0), one lorebook or many
(5.1), a story world sent for who is present (5.2), a world that keeps itself up to date (5.3), the story so far in chapters, a new chapter in a new chat and a starter
world from the character card (5.4). Next: pacing and style (5.5).

