# Story rules

Rules that act when the story reaches a point you name. Each rule is one sentence built from pickers; when a card value, a [Pending thread](help:glossary) or the reply count meets its condition, the next reply carries a private Direction or an event item joins a roll. Use it to make the story answer to numbers the extension already tracks, such as a relationship level or the story clock.

[Story, Story rules](page:story-rules-link) has a link to this page, since many rules read character values.

## What it does

### Story rules

**Kept with** starts on This chat, which keeps the listed rules in the open chat. Picking a story event set keeps them with that set, so they work in every chat where the set is on; a set that is off in this chat is marked so. With This chat picked and no chat open, there is nothing to show until you open one.

When some rule would fire with the next reply, a note headed With the next reply lists it. **Add rule** adds a blank rule. Each rule card has an on switch beside its sentence, the pickers below, and **Remove rule**.

**When** picks the condition:

- A card value vs a number. Pick the **Value** (Tenderness, Fury, Dread, Yearning, Relationship level, Ego, Nerve, Body or Psyche), **Whose** or **Pair** (names from this chat's cards, or Anyone), **Compared** (is at least, is at most) and **Number**.
- A card value moves. The same value and whose, and a **Step**, a rise or fall in one reply of a chosen size (1 to 5) or more. Only the emotion values and the relationship level move in steps.
- A Pending thread falls due. **Due within** an amount of story time in minutes, hours or days, read from the thread's due time against the story clock.
- The reply count. A **Reply number**; the rule holds from that reply on.

**Then** picks the effect:

- Private direction, with its wording in **Direction**, up to 600 characters.
- Item in the next event roll, which lets a picked item join that set's next roll once.
- Event item available, which puts a picked item in the set's pool from then on.

For the two item effects you also pick a **Story event set** and an **Event item**; the item stays out of rolls until the rule fires.

**How often** offers Once in this chat, Each time it becomes true (it waits until the condition has been false once), and At most every N replies, with **Replies between**.

### How it works

Rules are checked after each reply is read into memory and again before each reply. A rule that fired is stored with its reply, per swipe, so a Swipe or a delete takes the firing back and a once-only rule can fire again. The receipt of each reply in [Review, Replies](page:sent) lists the rules that fired with it.

### Random instructions

Rules leave instruction sets alone; a rule's Direction goes out on its own with the reply it fires on.

### Random story events

The two item effects read the items of your story event sets, edited in [All sets](page:sets). Rules kept with a set travel with that set.

### Random writing style

Rules leave writing style sets alone.

## Model calls and cost

Nothing on this page calls a model. Rules [run in code](help:model-calls); a fired Direction rides SillyTavern's reply request, and a fired item joins a roll that also runs in code.

## Why it works this way

- Rules are built from pickers, plus one text box for a Direction's wording, so every rule is one code can read and check.
- Card values move in steps of -5 to +5 and stay between 0 and 10, which is what the Step condition reads.
- No rule switches a preset block or a World Info entry; rules add to a reply and leave the rest of your setup as it is.
- A firing stored with its reply follows the chat's history, the same way fired World Info entries do.
