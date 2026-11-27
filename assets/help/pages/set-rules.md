# Sets and pacing

The rules every set shares: how many new things may start in one reply, where sets are saved, pacing, what a typed time skip does, the Follow-through check, the world orders and the event tags to skip. Use it when the story feels crowded or empty, or when instructions are being ignored. These settings apply to every chat.

## What it does

### New things in one reply

**How many new things can start in one reply** starts at 1, up to 5; 0 turns the limit off. It counts across every instruction set, story event set, the goal and the world orders. When more are ready, one is picked at random and the others wait. Anything already under way (kept for more replies, or sent again because it did not happen) uses the room first. Writing style and the goal line always go out.

### Where your sets are kept

**New sets are kept in** chooses where a set you add from now on is saved. The choices are one shared World Info book (named "Roleplay Instructions" on a new install), a shared book with another name, or a World Info book of its own for each set. When some sets sit outside the shared book, a button moves them all into it.

**Where each set is kept** lists every set with its own picker, folded shut when there are more than 8. Moving a set copies every entry whole with its versions, timing and notes, and the book it leaves is kept as a spare copy.

### Pacing

- **Calm after a big event (replies)** starts at 2; 0 turns it off. After a big event (from a story event set marked big, or an open thread of the [Story World](help:glossary) coming to a head), nothing new starts for this many replies.
- **Order a character who has gone silent (replies)** starts at 4 and needs a Story World. A character in the scene who has gone this many replies without being named in the story text is ordered to speak or act; the order is that reply's one new thing.
- **Story phases** starts Off. On, a list of phases appears; each has **Name of the phase**, **Starts at reply number**, a chance that something new starts (as a percentage of the usual chance), and an optional line sent with every reply of the phase. Three phases come ready (Opening from reply 1 at 50%, Rising from 11 at 100%, Long run from 41 at 125%).

### Time skips and scene breaks

All three start On.

- **Move the story clock** reads a line in your message that starts with `Time skip:` and an amount such as "three days", and moves the clock forward before the reply is written.
- **Close the chapter** closes the open chapter at the newest reply when your message has a `Time skip:` line, a `Scene:` line or a line of `***`.
- **List Pending events that fell due** lists the Pending events whose due time falls inside the skipped time.

### Follow-through checks

A Follow-through check reads a reply that carried an instruction and looks for evidence that it happened.

- **Check each reply that was sent an instruction** starts On. Off ends the checks, and with them the Done and Overdue marks and the resending below.
- **Instruction check connection & permission** opens that check's row in [Setup, Connections](page:settings).
- **Send again if it did not happen** starts at 2, from 0 to 5 more times, with firmer wording each time.
- **While one is waiting to be sent again, hold back new instructions** starts On, so the overdue instruction goes alone.
- **Regenerate when an instruction did not happen** starts Off. On, with automatic replacement permitted, a missed instruction gets one extra Swipe.
- **Automatic swipe connection & permission** opens that Swipe's row in Setup, Connections.
- **Check that the reply did not write for you** starts on Show a warning in What was sent; the other choices are Off, and Show a warning and write a new reply.

**Customize checking instructions** holds **Instruction checker guidance** and **Checker: system message**.

### World orders

World orders bring things your Story World tracks into the scene. They share the one-new-thing budget with sets and the goal.

- **An open thread builds by itself after (replies)** starts at 10; a thread that has not moved for that long goes up one step, as far as about to come to a head. 0 leaves the steps to the story and to you.
- **Chance that something ready is ordered into the scene (%)** starts at 20.
- **Replies before a planted detail or a thing going on elsewhere can be ordered in** starts at 6.
- **An open thread that is about to come to a head** starts On.
- **A planted detail** starts On.
- **Something going on elsewhere** starts On.
- **A kept secret of someone in the scene** starts Off, so secrets come out only when you or the story decide.

**Customize world order instructions** holds the wording of each order:

- **Story World event wording**
- the order for a character who has gone silent
- **Open thread order**
- **Planted detail order**
- **Off-scene activity order**
- **Secret revelation order**

### Tags to skip

A box of tags separated by commas, with **Save event limits**. Random event items with any of these exact tags are skipped; prose and other instructions are left as they are.

### Random instructions, Random story events and Random writing style

The three set editors in [All sets](page:sets) follow these rules. The per-reply budget and the Follow-through check apply to instructions, a story event set marked big starts the calm, and a writing style set is always sent.

## Model calls and cost

Each Follow-through check is 1 model call ([how model calls work](help:model-calls)), made after a reply that carried an instruction to check. It starts on Automatic, which tries the free and local routes in [Setup, Background jobs](page:background-jobs) first and ends on the Main API, or it uses a Connection Profile you fix in Setup, Connections. The call is metered, so a paid route counts toward the ceiling in [Setup, Spend](page:spend). **Check that the reply did not write for you** rides the same call. **Regenerate when an instruction did not happen** and the write-a-new-reply choice make one more Swipe, which is SillyTavern's reply request. A chapter closed by a time skip costs the same call as closing a chapter by hand. Everything else here runs in code.

## Why it works this way

- One new thing per reply keeps the model from juggling several orders at once, and an order the reply missed goes again before anything new.
- Sets live in World Info books, so they work with the extension off; one shared book keeps them together.
- A typed time skip or scene break acts at once, and each of its three effects has its own switch.
- Secrets start out of the world orders, so the story keeps them until you choose otherwise.
