# Reply tray

Reply tray sets how the tray under each reply opens, where it shows, how large its card text is, and where the scene header lives. Below that is the list of every card the tray can draw, each with its sections and fields; the cards are described in [Reply cards](help:reply-cards). Open it to add or remove a card, to trim what each reply's filing asks for, or to make one chat's tray behave differently.

## What it does

### Tray settings

- **Scene header** is In the reply, with fallback (the start) or In the tray. The scene header is a line of place, time, weather and who is present. In the reply, the model writes it as the reply's first line; after 3 misses in the last 10 replies the chat moves it into the tray.
- **Latest reply opens in** starts at Compact. Strip is one line of marks, Compact adds one line per card, and Expanded shows one card at a time with chips to switch.
- **Earlier replies open in** starts at Strip.
- **Tray shows under** is Every reply (the start), Latest reply only or None.
- **Card text** is Compact (12 px labels, 13 px values) or Comfortable, with a **Scale** from 100 to 130 percent.

### Settings for this chat

Shown while a chat is open, under the heading This chat. Latest reply, Earlier replies and Tray shows under can differ for this chat; Default follows the settings above.

### Cards

**Dice display** is One line (the start), which shows each roll as one line in the Roll card, or Hidden, which shows nothing in the tray while the roll still decides the attempt and stays in the Sent card.

Each card row has its family, one line on what it shows, Move up and Move down, and three buttons: Off, Strip only (its marks on the Strip, no card) and In the tray. A card that is not built yet says so and stays off. While a card is on, **Sections and fields** opens a switch for each section and, under a section with several fields, each field. A field nothing asks for shows "Not requested" on its card.

The cards that start In the tray, with these sections on to start:

- Scene: **Where and when** (Place, Story date and time, Weather), **Surroundings** and **Who is there** (Present). **Ambient people**, **Observable facts**, **Known places** and **World detail** start off.
- Characters: **Inner life** (Mind, Heart, Body, Psyche) and **Portrayal** (Who they are, Facet, Voice). **Right now**, Thoughts, Outfit, Holding, **Faculty set** and **Conditions** start off.
- Emotions: **Emotional axes** (Axes, Outward behavior, Coexisting feeling). **Turn psychology** starts off.
- Relationships: **Pairs** (Pair). Level, Change and reason, and **Route** start off.
- Knowledge and secrets: **Who knows what**. **Secrets**, **False beliefs** and **What each person remembers** start off.
- Plot: **Open threads**, **Plotlines**, **Elsewhere** and **Planted details**. **Tracks** and **Pending events** start off.
- Story changes: **Filed this reply** and **Facts on record**. **Threads closed** starts off.
- World Info: **Entries used**.
- Director's desk: **Plan**. **Course**, **Pressure**, **Branches** and **Graded** start off.
- Roast: **One voice**. **Panel** starts off.
- Sent and Notes, each with one section of the same name.

Map, Holding back, Inventory, New faces, Reputation, Achievements, Choices, Stats, Roll and Notebook start Off; switching one on turns on its sections.

**Restore card defaults** and **Restore tray defaults** put each list back.

## Model calls and cost

Nothing on this page calls a model, but the cards decide what later calls carry ([how model calls work](help:model-calls)).

- The cards' values come from the call that files each reply into memory, a background call on the routes in [Setup, Background jobs](page:background-jobs). A card, section or field switched off is left out of that call.
- The Choices card adds 1 model call after each reply while it is on, an Options call that counts as background spend.
- A paid route's calls count toward the monthly ceiling in [Setup, Connections, Spend](page:spend).
- The scene header rides SillyTavern's reply request; checking it and drawing the tray run in code.

## Why it works this way

- Every card and section is its own switch, so the tray shows what you want and nothing else.
- New cards start off, so the tray stays as you know it until you switch one on.
- The latest reply opens in Compact and earlier ones in Strip, so the chat stays readable.
- Each switch also trims the filing call, so a section you turn off costs nothing.
