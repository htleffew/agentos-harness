# Books and memory

Books and memory lists every World Info book in SillyTavern with its kind and two switches that decide how the story's memory treats it. It also holds the tools for behavior books (random events, writing styles and chance instructions) and the books the extension writes for each chat. The list works with no chat open; the per-chat choices need one.

## What it does

The story may add keywords, lines or entries to a book of yours, and each addition can be undone. The **How it works** fold adds that [Recall](help:glossary), the records and entries chosen for each reply, sends a Reference book's entries when they fire.

### Books

Every World Info book, sorted Reference, Carry-over, Behavior, then Generated. Each card shows the name, its kind and a count of its entries and of those that roll a chance, sit in groups, are timed or are Constant.

- **Kind** switches a book between Reference (facts to look up) and Behavior (entries that roll, group or time themselves). A book starts as Behavior when its entries use chance, inclusion groups or timing, and as Reference otherwise. Carry-over books (made when a story continues in a new chat) and Generated books show their kind without a switch.
- **Recall manages this book** starts off. Turned on, the entries of a Reference or Carry-over book that fire go out inside Recall. It is unavailable for Behavior books, whose entries keep their chance, groups and timing with SillyTavern, and for Generated books.
- **Story may add to this book** is Off, Keywords only, or Keywords, lines and entries. Books shared by many chats (global, character and persona books) start at Keywords only; books tied to one chat start at Keywords, lines and entries. It is unavailable for Generated books.
- **Export** downloads the book as a standard World Info file.

Each addition remembers the reply it came from. When that reply leaves the chat (deleted, swiped away, or cut off by a branch), the addition is removed with it. An addition you have edited since counts as your text and stays.

### Behavior books

- **Receive story events** picks the one behavior book in this chat that takes the story events chapters propose. It starts on none. Each event waits on the review list in [Setup, Memory](page:memory) first.
- **New behavior book** asks for a name and makes an empty behavior book.

### Draft entries from a description

- **Book** picks the behavior book the entries go to.
- **Kind** is Random story event, Writing style or Chance instruction. It starts on Random story event.
- **What the entries should do** is a sentence, for example "rival smugglers turn up at the docks now and then".
- **Draft entries** writes a draft list. Each entry shows its title, text and chips for its chance, its group and Plays once.
- **Add the ticked entries** adds the entries left ticked to the book.
- **Drop the draft** discards the list.

A drafted story event starts at a 10 percent chance in the group Story events, with a cooldown of 10 messages. A writing style entry is Constant in the group Style. A chance instruction that names no chance starts at 25 percent.

### Generated books

The extension writes two books for each chat from its records, the Story World book and the [Tracker book](page:tracker-book), each named after the chat. A book whose chat no longer exists is marked so and offers **Delete**, which needs a confirmation and cannot be undone.

## Model calls and cost

**Draft entries** is [1 model call](help:model-calls), marked with the amber dot; a draft that fails its checks is asked for once more. It uses the route order for behavior book drafts in [Setup, Background jobs](page:background-jobs). A paid route's cost counts toward the monthly ceiling in [Setup, Connections, Spend](page:spend); at the ceiling a free or local route still drafts, and with none left the button says the ceiling is reached. The switches, Export and the additions themselves run in code; additions come from records the story has already filed.

## Why it works this way

- Your books stay ordinary World Info books. The story only adds to them, and your own text, keywords and settings stay as you wrote them.
- Behavior books keep SillyTavern's chance, groups and timing, so Recall leaves them to SillyTavern.
- Every addition is tied to its reply, so a swipe or a delete takes it back.
