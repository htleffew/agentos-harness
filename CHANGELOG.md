# Changelog

## Unreleased
- The Recording prompts go out with every capture (B60). The capture call after each reply, and a chapter call that files the replies it closes, now carry the Recording prompts of the modules that are on (story time and weather, facts, portrayal, relationships, knowledge, emotions, plot outcomes and scheduling), in the wording saved on the Prompts page, so an edit to one changes what capture files from the next reply on. A module that is off sends none of its prompts. The text sits with capture's fixed rules, so it changes the cached prefix only when a prompt is edited or a module switched. With every module on it adds about 500 tokens to each capture call; no new model call. The opening request is unchanged. `tests/t_recording_prompts.js` and `tests/t_recording_prompts_host.js` cover it.
- Suggest with a model in the story style picker (B61). The automatic story style suggestion stays word matching in code with no call. The picker on Setup, Look, Story style (This chat) and in the reply tray gains a Suggest with a model button (amber dot): one tap is 1 model call, sent through the capture route chain with the character card text, the chat's World Info book text (both capped) and the four style ids with their one-line faces. The answer shows as a suggestion with a Use button and changes nothing until you tap it; an answer that is not one of the four ids says the model gave no usable answer and leaves the style as it is. A paid route counts toward the monthly ceiling, and at the ceiling with no free or local route left the button sends nothing and shows the ceiling line while the word-matching suggestion stays. Nothing is sent when a chat loads or the picker opens. `tests/t_story_style_model.js` and `tests/t_story_style_model_host.js` cover it.
- Request stats on Setup, Connections, Spend (B62). Every model call the extension sends, free, local or paid, adds one entry with its job, route, model, tokens in and out, and cost when paid: background jobs, judgment calls (the desktop, each on-phone item and jev-1.13), the desktop warm-up, tapped functions and help questions. Token counts come from the provider when it reports them and are estimated from the text otherwise, marked with ~. A table lists each day, today first, with requests, tokens in and out and paid cost; tapping a day lists its jobs. A second table gives each job's requests, requests per day and median request size over the last 7 days. Clear stats asks first. The stats keep 31 days of daily totals and the newest 600 entries in the extension settings. Replies through SillyTavern itself are not counted.
- A tap is never lost to a background redraw (B63). When capture, upkeep or another background job finished while a finger or the mouse was down on the menu, the menu redrew the open page under it, so the press ended on a replaced button and a mouse click did nothing. The menu and the reply trays now wait until the press is released and its tap has run, and the open page also waits while you type in one of its fields; the update is then drawn once, with the scroll, open folds and focus kept. No model call. `tests/t_redraw_tap.js` covers it.
- Every paid model call counts toward the monthly spend ceiling, tapped or not (B59). Write a chapter now, Close the chapter here, Write the synopsis and start, Draft entries, help questions and a function fixed to the Main API or a Connection Profile now add their cost to Setup, Connections, Spend, and a paid answer that comes back unusable is billed too. At the ceiling a tap with no free or local route left sends nothing and says "The monthly spend ceiling is reached. Raise it in Setup, Connections, Spend."; a free or local route in the same list still answers. The help assistant's route list ends on the Main API, and a list saved in 10.0.51 gains it at the end once. The Spend page and the guide say that all paid calls count.
- A reference guide and a help assistant inside the extension (B58). Setup, Help holds one guide entry for every menu page and for each feature that spans pages (getting around, model calls and cost, reply tray cards, quick actions, background jobs, prompts, the glossary and the assistant), with a word search that finds an entry, a section or a single control by its label; Show opens the page with that control in view. Each entry lists the page's controls with their help line and starting value, read from the extension itself, so the guide names every control the code draws. Every page header has a Help link that opens its entry. Ask the help assistant opens a sheet: one question is 1 model call (the Ask button carries the amber dot), sent with the three best-matching entries on a route list you order in Help settings, which starts on the desktop model with the free routes after it and takes the Main API, other routes and any saved Connection Profile; a paid route counts toward the monthly ceiling, and a note says when an earlier route did not answer. Answers list the entries they came from, say so when the guide does not cover the question (with no call at all when no entry matches a word of it), and change no setting. A per-chat switch lets a question carry your settings and the active stack, with no chat or World Info text; the latest reply goes only when you tick it for that question.
- One set of words across the extension (B7). Every label and help line now uses the glossary: World Info book and World Info entry replace every lorebook wording, and the new terms read Generate sheet, Story style, Scene header, Loadout and Tracker World Info book. Some visible names changed: the Opening page is now First message, Host swipe is SillyTavern swipe, Player-only helper is Impersonate helper, "Steer these options" is "Add to these options", "Edit this snapshot" is "Edit this state", and the World Info entry settings use SillyTavern's own names (Constant, Normal, Trigger %, Sticky, Optional Filter). Help text is one or two sentences, with any mechanism under a How it works fold, and Shift-click and hover hints are gone. Search still finds a page by its old name. Text the model reads keeps its wording, and so does the story notes book name, so existing books stay linked. `tests/t_labels.js` fails on a retired name, a long help line, a hover hint or a screen name the menus do not list.
- A stack block is sent with every reply again. The stack's blocks were taken back out of the prompt as soon as any prompt finished building, so a token count or a background scene or state job that landed while a reply was being assembled could leave a block (for example an in-chat block at depth 2) out of that reply. The blocks now stay in place until the reply itself has built its prompt, and a stopped reply or a slash command no longer leaves them applied. `tests/t_preset_switch.js` and `tests/t_block_gates.js` cover it.
- A page keeps its place when a background job finishes. The panel redraw put the scroll position back before a long page such as Setup, Presets had drawn, so the page jumped to the top whenever a background job landed. It now restores the position once the page has drawn.
- Delivery controls for character speech (V2). On Story, Characters, Voices each voice's Delivery fold has three sliders over her King County settings: Expressiveness (Chatterbox's exaggeration, 0.30 to 1.00), Steadiness (temperature and cfg_weight together, two steps either way) and Pace (cfg_weight, which Chatterbox documents as changing pacing, and the pauses between lines; the server's speed control is never sent). Each slider has its own test line under Hear it, the card shows the values it sends, the A/B stays, and Reset to King County puts the sliders back (V1's Back to King County button was hidden by the menu's back-button rule; the rename fixes it). Presets save the three settings under a name ("Hale, angry") for use on any card. Read aloud now also opens the Play sheet: the reading's state, Stop or Play again, and More feeling, Calmer, Faster and Slower for that reply only, applied on top of each speaker's settings and held in memory for that reply and swipe, so the Voices page never changes. A new switch, off by default, gives a line a little more expressiveness for an exclamation, a word in capitals or a shout verb beside its quote, decided in code. Rendered lines are cached one by one under the reply, swipe, words, voice, seed, the three knobs and the line check, so a replay makes no call and a changed setting renders only the lines it changes. Voices saved by V1 keep their tuning, read back into the three settings. The receipt lists each line's knobs, the reply's change and any lift. No model call and no server change. `tests/t_voice_delivery.js` covers it.
- One copy of each record in the request (B13b). In a chat whose memory lives in chat data, the Structured turn's "Established records" list now leaves out every record the memory block carries or held out (a record that only repeats one of your World Info entries, a record outside the recall pool), so each fact reaches the model once. A chat whose memory has not moved keeps the list as it was.
- Dice in memory (MB14). Stat sheets are now Stat sheet records in the chat's memory log, so History lists every change with its source and Undo. The persona's and the character's sheets hang on the chat's first message, so every branch keeps them; an NPC described in World Info keeps its base sheet in its book (now listed in History as an addition, and not written at all when "Story may add to this book" is Off), with this chat's changes as records over it; an NPC who first appears in play gets a sheet that leaves with the reply where they appeared, on a delete or a swipe, and is inferred again at their next appearance. A new Person record from capture starts that NPC's sheet at their first appearance (at most two a reply, one call each on the capture routes, with Dice on). A stat you set is your own entry: no inference, level-up, rebuild or catch-up changes it, and giving it back lets inference set it again. Sheets saved by 10.0.48 move over once when the chat opens, your values kept as yours. Capture is now told each reply's rolls (who attempted what, the stat, the die, the difficulty and the degree), so what a roll caused is filed with that reply. No new model call besides the NPC sheets the design already counts. `tests/t_rolls.js` and `tests/t_stat_sheet_store.js` cover it.
- Cloned character voices on the desktop (V1). Story, Characters, Voices takes the desktop voice address (Chatterbox on her desktop, over Tailscale only: a 100.x address, or a ts.net name on a port Funnel cannot publish; a Funnel port, a LAN address or a public host is refused), its key, and one clip per character and per persona, recorded with the phone's microphone or uploaded. Code checks the clip (10 to 15 seconds from the first word to the last, mostly speech, loud enough, free of clipping and at least 20 dB above the background), trims it, sends it to the desktop and plays a short test line; Record again redoes it, and a refused clip says why. Delivery folds open for an A/B against her King County settings (three sliders; no speed control). Read aloud in each reply's message menu reads the words in double quotes, each quote in the voice of the character named by its speech verb or nearest in its line, an unattributed quote in the main character's voice; narration and thoughts are not read. Lines are one sentence or clause under 230 characters with numbers and abbreviations spelled out, a fixed seed per line, trimmed, faded, levelled and joined with her pauses, and the first plays while the rest render. With the line check on (the default), the desktop transcribes each line and renders a mismatch once more with a new seed. A reading is cached per reply and swipe, so a replay makes no call; a swipe, edit or deletion drops it. The request log keeps a receipt per reading with each line's voice, seed and check, any wait for the graphics card, and the names to judge by ear. With the desktop off, Read aloud says the voice is unavailable. No model call. The voice server's own changes (her defaults, per-request temperature, seed and steps, the line check, CORS, loopback or tailnet binding) are on branch `ri-v1` of `chatterbox-voice`. `tests/t_voice.js` covers it.
- The Legacy workflow and Memory only retire (B13). Structured is the one story workflow while the extension is on: the Story workflow select, the Legacy page branch and its LEGACY badge, the Scene and Character cards settings, the old Dice section, the Action checks page and its queue, the Legacy reply stack under replies, the state rebuild editor and the Legacy scene, profile, dice, rebuild and Story World update prompts are gone. Before anything was removed, the first start after the update saves one backup of every extension setting and custom prompt in SillyTavern's user files; Setup, Connections names it and has Save a backup file and Restore from a backup file. On its first open each chat converts once: a Legacy reply's profile block becomes the Mind, Heart, Body and Psyche state and the portrayal the Characters card reads, so old chats show their scene, characters and roast in the reply tray. Stats moved to Story, Characters, Stats, which shows the sheets saved per card and persona and holds the stat list. The Roast block of a Structured reply is still lifted out of the reply.
- Themes and story styles (B17). Setup, Look has a Theme page with three dark themes (Emerald, Sapphire, Violet), saved variations, Export, Import, Bind to this chat, and a button that saves a matching SillyTavern theme under "Roleplay Instructions, Emerald" (or the theme you picked) without switching your current one. A Story style page and the tray set how story cards look: Parchment, Noir, Sci-fi readout or Modern minimal. The first time a chat shows its tray, code reads the character card and the chat's World Info books for setting words and offers one style as a chip in the Strip; no model call is made. The choice is saved with the chat and Setup holds the default. The two new faces (EB Garamond and Courier Prime, about 85 KB) ship inside the extension.
- Dice detected from the story, with six degrees and per-chat stat sheets (B22). Before each reply one judgment call (MB8's routes: the desktop, the phone, Jev within the spend ceiling, then code) reads your message, the last reply and the scene and returns each uncertain attempt, yours or an NPC's, with its actor, stat, difficulty step and stance; a turn with no action by anyone sends no call. Code rolls a d20 plus the actor's stat modifier against the difficulty (stance moves the step one place) and the margin sets one of six degrees, from overwhelming success at +5 or more to overwhelming failure at -5 or less. The reply gets one verdict line per roll at depth 0 with the rule to keep dice out of the prose; the raw rolls stay in code. Each roll is stored in the reply's chat data with its swipe; a branch copies its rolls. The die button (Action check) now queues a named roll whose stat and difficulty replace detection for that attempt. Setup, Look, Reply tray has Dice display: One line (each roll as one line in the Roll card, ending with the die and the modifier) or Hidden (nothing in the tray; the verdict still goes and the roll stays in the Sent card, which shows the judgment call with "1 model call · extra request"). Stat sheets are per chat: one call at chat start infers the persona's and the character's sheets from the card; an NPC described in a World Info book gets a sheet inferred from that entry and stored in the book as one added, disabled "Stats: name" entry, her own entries left as written; an NPC who first acts in play gets a sheet stored with the chat. The Stats card and Story, Characters, Stats show and edit every stat, and a value you set is marked yours and kept through later inference. With Dice off, or on Theirs for the preset, nothing is judged or rolled and the die button leaves the bar and More. Replies saved before this keep their saved results. `tests/t_stat_sheets.js` and `tests/t_dice.js` cover it.
- Dice rulings (B22b). The Roll card starts Off for a new chat, as every card does. A swipe now runs the dice judgment and the roll again, like a new reply, and keeps the roll on that swipe only; swiping back shows the earlier swipe's roll in the Roll card and its verdict in the Sent card. A continue keeps the roll of the swipe it continues and makes no judgment call. A branch copies the rolls as before. A queued die-button roll applies to the swipe it was queued for, then clears. The Stats card draws under the latest reply only. A swipe now costs one dice judgment call (a turn with no action by anyone still sends none). `tests/t_dice.js` and `tests/t_stat_sheets.js` cover it.
- Loadouts keep block placement and gates (B57). A loadout saved from a stack now keeps each card role, in-chat position, depth and first reply on its block, so selecting it sends the same request as the stack, and a block with a first reply waits for that reply. The diagnostics log lists a card held back by its gate as left out, with the reply it opens at. Loadouts saved earlier send as before. No model call. `tests/t_loadouts.js` and `tests/t_loadout_gates.js` cover it.
- The block bank keeps reply-number gates and in-chat positions (B56). Importing a preset now keeps each block's in-chat position and depth, its reply types (for example continue only), its role, and a reply-number gate written as one `{{if {{getvar::turn}} >= N}}` around the whole block. The stack sends them through SillyTavern's own prompt manager: an in-chat block lands at its depth with its role, a gated block is left out until reply N (a swipe or continue counts as the reply it rewrites) and goes out without the gate macro. Stack cards show In the chat, depth N, As user or As assistant, and From reply N. A Placement button on a stack card sets where it goes, its role and its first reply, saved on that stack card only, with a line on what each placement costs the prompt cache; Use the source placement takes her values back. The import report now lists these fields only when RI cannot keep them (a depth written as text, a gate inside other text, a role outside system, user and assistant). Stacks and imports saved earlier send as before. No model call. `tests/t_block_gates.js` covers it at 390 px.
- Import report when something was lost (B46). After a preset, plugin, World Info book or Workbench file is imported into the block bank and the option banks, code compares what the file held with what was stored. When a field was approximated or left out (an unsupported role, a position in the chat, a reply-number gate, macros taken out of a value, skipped plugin actions and data), one sheet lists each affected block or value with what the file held and what RI kept, under Approximated and Left out. A clean import shows only the short confirmation. The report stays with the import and reopens from the imported group or the block bank file until the same file is imported again. No model call. `tests/t_import_report.js` and `tests/t_import_report_host.js` cover it.

- Background jobs on Setup, Connections (B55). The page now lists every background job with the routes it tries in order, free and local routes first. Up and Down reorder a job's routes, Reset to recommended restores them, and a job that shares another job's routes says which one it follows. Test on a route makes one request that lists its models (no model call, no cost) and shows the answer time and whether it is healthy; the on-phone model and a route with no saved connection make no request. Routing stays automatic. `tests/t_background_jobs_ui.js` covers it at 390 x 780.

- A long-range story outline (B52). Every 40 replies, after the reply is captured, one call reads the chat's records, its open threads with their "ends when" lines and your story rules, and writes 3 to 5 possible next chapters in the report register. It runs only on free routes (the desktop over Tailscale, the NanoGPT plan, the free tiers, or the Main API when it is a local server or the NanoGPT plan); with none it waits, retries after 10 minutes and spends nothing. The writer reads the outline only as lines of the Director's desk entry in the Tracker book. Direction, Goal, Story outline shows it with an on switch, a box to edit it, Clear, and Write the outline now, which opens the Generate sheet first. Your edit stays as you wrote it; you choose whether the next 40-reply run keeps it (no call) or rewrites it from your text. A failed answer keeps the old outline until the next run. `tests/t_story_outline.js` covers it.

- MB9 loose ends (MB9b). Clear this chat's memory asks which: Model-made only (keeps records you wrote or edited, locked records and stat sheets) or Everything. Each has one Undo that restores exactly, and clearing makes no model call. Catch-up now starts from one call in index.js at extension start, and the timer in the dashboard file is gone. The Story World page shows the catch-up status line. The old catch-up path in the chapters file (catchUpChatHistory, refreshEditedStory, historyCatchUpPreview and their helpers) and the prompt slots "Catching up chat history" and "History catch-up: system message" are removed; your saved custom text for them stays in settings and nothing reads it.

- Item weights replace the old Weight box (B51b). The hidden 1 to 20 weight on story event items no longer changes the odds and is dropped when a set is saved, so every item starts even until you set its -10 to +10 weight. Values in a shared option bank now carry the same -10 to +10 weight on the Pool sheet, saved in the RI Option banks book so every set that draws from that bank uses it.
- A note on a broken reply (B53). When a reply lands empty, as only an error line (for example "Error: 503 ..."), or as the same text as the reply before it, the composer bar shows an Empty reply, Error reply or Repeated reply note. Tap it for Regenerate, which runs SillyTavern's own regenerate, or Dismiss. Nothing regenerates by itself; a normal reply shows no note and makes no request. The check is code only, no model call. `tests/t_broken_reply.js` covers all three at 390 x 780 and 1006 x 909.
- Weights on option-bank and story-event items (B51). Each item row has a Weight control from -10 to +10, default 0. +10 makes the item about three times as likely to roll, -10 means it is never rolled, and the steps between scale smoothly. Items with no weight read 0 and nothing is rewritten. A story rule that holds an item still keeps it out whatever its weight. Code only, no model call. The control replaces the old 1 to 20 Weight number; an old value above 1 is kept and still multiplies the odds. `tests/t_item_weights.js` holds the odds over 10,000 seeded rolls and the control at 390 px.
- Diagnostics log for what was not sent (B47). Review, Context has a Diagnostics log switch, off by default. While it is on, each new reply keeps a short list of the stack blocks left out of its request (switched off, taken out, an extension card whose feature is off for the chat, or on but trimmed by size) and the World Info entries the scan considered and did not send (chance missed, cooldown, delay, lost to its inclusion group, budget reached, recursion stopped), with the reason; entries that matched no key appear only as a count. The reasons come from SillyTavern's own scan results (the reply's own scan only, with token-count dry runs left out) and the stack plan; no model is called and the request stays as it was. The log is stored per reply and swipe in chat data (at most 40 rows and 6,000 characters), leaves with its reply, shows on the reply's Sent card while the switch is on, and saves as a text file. `tests/t_diagnostics_log.js` covers it.
- Catch-up, Rebuild and Continue in a new chat are rebuilt on the chat-data memory (MB9). A chat that opens with 20 or more exchanges past its capture watermark checks the desktop, the NanoGPT plan and an on-phone model against five tests (reachable, proven, a context of 12,000 tokens or more, done within 30 minutes with the phone charging, under 5 percent of the weekly allowance) and starts by itself on the first that passes; otherwise it asks first with the route, the call count, the time and the cost, and names the test that failed. Code cuts the history at scene boundaries into chunks sized for the route; one map call per chunk carries a state digest and the stored records as an exclusion list and returns entries, chapters and the closing scene; code checks them with the capture and chapter checks and the report register before anything is filed. Every part is a saved job, so a closed app resumes at the next part with no duplicate record, and Cancel keeps what was filed. Rebuild retires every model-made record in one entry (your locked records and edits stay) and Undo is one tap. Continue in a new chat makes one Writer call, writes a carry-over book bound to the new chat that names the parent, and drops any sentence that shares a run of eight words with the parent's last 50 replies; the parent chat is not changed. New Setup, Memory switch: Catch up by itself on free routes (on by default).

- A reply's World Info receipt and its notes come from the reply's own scan (FIXRB). SillyTavern counts tokens with a dry run of the prompt after many changes. When a dry run loaded its entries just before you sent and finished its scan after the reply had started, the extension took that scan for the reply's: the Sent card and What was sent left out entries the request carried (a reusable World Info book's "User entry", for one), and the reply's notes were the dry run's. A scan now counts for a reply only when its entries were loaded for that reply. An open "Edit or delete entries" on a World Info book card also stays open when the panel redraws after a reply's memory capture; before, it closed a second or so after each reply. `tests/t_reusable_books.js` holds a dry run across a send and checks the receipt, and checks the open editor across the capture redraw.

- Add record is back on Story, Facts and Story, Plot (FIXADD). When MB10 made those pages filters of Story World, the button to add a record by hand went with the old pages. Story World now has Add record on People, Facts, Plot, Secrets and All, with the same form and fields the old pages had (type, ID, subject, text, Protect, and each type's own fields such as aliases, Base World entry, status, parent arc, due minute and payoff), and Edit on each record that form covers. In a chat whose memory lives in chat data a save files your record there as you typed it, locked while Protect is on; the Portrayal and Emotions pages save the same way, and an edit no longer needs the record's Story World book entry. A chat whose memory has not moved yet keeps the old pages. On Story, Facts or Story, Plot another filter now opens Story World with that filter; before, the page snapped back to its own filter.

- Memory menu follow-ups (MB19). Tidy now, Catch up, Rebuild, Close the chapter here and Write a chapter now open the composer bar's Generate sheet first; Close and Back make no model call, and the sheet leaves out the text box because memory jobs take no direction. Setup, Memory, This chat gains "Memory on for this chat" (off stops capture, upkeep, recall and the chapter view for that chat only and keeps its records) and "Clear this chat's memory" with one Undo that puts the cleared records back exactly (the records are set aside in the chat, so Undo survives a reload) and rewrites the chat's Story World book. An Open threads row the saved records draw shows "Last moved by" with the quote that last moved the thread. `tests/t_memory_followups.js` covers it.
- Story event items that need an open thread, a kept secret or a plan roll in chats whose memory lives in chat data. The offer list read the older Story World entry kinds, and a chat with no Story World book offered nothing, so such an item never rolled and was never filled. The offers now come from the records already read for the reply: open threads that are neither done nor paused, with their ends-when line; secrets kept by someone the scene lists; plans of people present. Chats that read their book keep the older offers. No model call.
- The memory menu (MB10). Setup, Memory has seven sections: Status (each route with ready, down or over the ceiling, the waiting jobs and this month's paid spend), Recall (the books Recall manages, the search model and its state, Desktop booster), Budgets (the chat model size and the caps it sets), Chapters (newest chapters in full, 1, 2 or 3, and the close rules), Upkeep (Tidy automatically, capture after each reply or every five, Tidy now, How it works), This chat (Catch up and Rebuild) and the Review list, where an edit typed into the Story World book is filed as your edit or dismissed. The page header reads, for example, "ON · DESKTOP · US$0.40". Story, Story World is a record browser for a chat whose memory lives in chat data: filters People, Facts, Plot, Secrets, Chapters, Retired and Needs you, search, and on each record its history and sources with Undo, Lock, Pin and Restore; a person's meters can be set by hand (each then locks) and their temperament set from guarded to volatile; a thread's "ends when" line and its Paused switch are editable. The story so far lists the chapters and the condensed account with Close the chapter here, and the book section offers Open as World Info book and Export as World Info book (Leave secrets out, on by default; the chat's records are not changed). Story, Facts and Story, Plot became filters of Story World, so the menu has 19 pages. Story, World Info, Books and memory lists every book as Reference, Behavior, Generated or Carry-over with "Recall manages this book" (off for a behavior or generated book) and "Story may add to this book", plus Receive story events, New behavior book, Draft entries from a description, Export, and Delete for a generated book whose chat is gone. Review, Context, What was sent shows the next request and any past reply: the chapter view, each recalled record with its source reply and its relevance, recency and importance, what was held out and why, block sizes, the cache line, the Tracker book entries, the behavior entries that fired and the roll; a past reply shows the copy saved when its request was sent, per swipe, so a later edit or a chapter close leaves it as it was. SillyTavern's message menu gains Close the chapter here and Memory from this reply, the Sent card lists the story rules that fired and links to What was sent, and the tray's Plot card adds the quote that last moved each thread. Nothing here adds a model call; Tidy now, Draft entries and the chapter buttons carry the Cost chip. [MB10 notes](docs/ux-overhaul/tickets/MB10.md)

- Dialogue files like narration (MB18). A claim a character speaks files the same way as one the narration states, about the speaker or anyone else: a plain trait or fact with the speaker kept as its source and the line as evidence. The "said that" rewrite is retired. A claim the story exposes as a lie and a secret only some characters know use the secret and false-belief records, a later contradiction supersedes the record whether spoken or narrated (Undo restores it), and a feeling stated aloud moves the Emotions card and files no trait. Capture makes no extra call.
- Threads carry an "ends when" line and a paused state (B49). Capture writes the line when it opens a Plotline or Pending thread, checks it on each reply in the call it already makes, completes the thread when a reply meets it, and pauses or resumes it when the story sets it aside or returns. Paused threads stay on file and leave the pool story event items draw from.
- Every person record carries a temperament (B48): a speed from 0.5 (guarded) to 1.5 (volatile) for each emotion axis and for the relationship level, 1 when none is filed. Capture infers it once, in the call it already makes, when it first files the person, and each meter step is multiplied by it before the value is rounded and held between 0 and 10. Chats saved earlier read every person at 1.

- A typed time skip or scene break acts at once (B50). A line that starts "Time skip:" followed by an amount ("three days") moves the story clock forward by that amount before the reply is written, and marks the clock unknown when the amount cannot be read. A "Time skip:" line, a "Scene:" line or a line of *** also closes the open memory chapter at the newest reply, and a time skip lists the Pending events whose due time fell inside the skipped time for the next capture to rule on. Each effect has its own switch on Direction, Sets and pacing, all on. A marker inside a quotation, a code fence or a block quote does not count. No call of its own: the chapter is written the way "Close the chapter here" writes it.
- Story rules (B41), on Direction, Random sets beside the sets, with a link from Story, Characters. Each rule is one sentence built from pickers: when an emotion axis, a relationship level or a faculty is at least or at most a number, when an axis or level moves by a step of -5 to +5 in one reply, when a Pending thread is due within a story time, or when the reply count reaches a number, then send a private direction you write, add an event item to its set's next roll, or make an event item available; once in the chat, each time the condition turns true, or at most every N replies. An item a rule names stays out of rolls until the rule fires. Rules are kept with the chat or with a story event set (then they work in every chat where that set is on). Code checks them after each capture and before each reply; no rule makes a model call. A rule that fired is stored with its reply on that swipe, so a swipe away, a delete or a branch before it takes the firing back and a once-only rule can fire again. No rule switches a preset block or a World Info entry.
- Tests (FIXPW): `t_preset_workspace` failed about 6 runs in 10. The memory capture that follows each reply ends with a panel redraw about a second later, and the suite set the Commentator voice picker and the voice text on nodes that redraw had replaced, so the edit landed on the default voice or the Update button was never found. The suite now waits for the capture and a settled panel and uses Playwright actions. The Roast voice editor also keeps the editor under the picker on the voice the picker shows when the stored voice changes elsewhere.
- Switches stored before the Ours or Theirs switch retired no longer do anything (B36b). A stored Ours no longer turns a preset block off and a stored Theirs no longer hands a feature to the preset; the stack is what is sent. Loadouts saved earlier still open as a stack you can edit. The Roast card in the bank links to the commentator voice in Setup, Features, and both edit the same stored Roast prompt.
- The Ours, Theirs and Both switches and the block editor on Setup, Presets are gone (B36). Who supplies a feature is read from the stack: each feature page shows one chip, RI, Preset, Both or Off, and tapping it opens that feature in the bank's By feature view. Edit a block in the bank to make your own version; the preset file stays as it is. The Extension cards fold went with the editor, so the extension's cards are edited in the stack with Edit. Stored stacks are not touched.

- Emotion axes and relationship levels move in steps (B40). After each reply the model reports, for each axis and level, how far it moved (a whole number from -5 to +5, 0 when nothing moved) and a reason, a quote from the reply or something a character did. The extension adds the step to the value of the reply before, on the swipe you are reading, and keeps it between 0 and 10, so a value can no longer jump between two replies in which nothing happened; each swipe shows its own chain. A step of 0 shows no change chip. A value you set by hand stays and later steps start from it, and chats saved with whole numbers continue from their last value.
- Jev's judgment answers now have an unsure band (MB15). A yes-or-no score of 0.7 or more counts as yes and 0.3 or less as no; a score between them takes the question's default, which is no for attempt (no roll), aside (the message stays in the story) and changed (no fact change filed). The unsure answer is never sent to another route, so no extra call is made, and the result names the score and says the default applied. [MB15 notes](docs/ux-overhaul/tickets/MB15.md)
- The Tracker book's values are also set as chat variables (B44): ri_scene_place, ri_character_<name>_<field>, ri_emo_<name>_<field>, ri_rel_<pair>_level and ri_plan, so a preset block can read them with {{getvar::...}}. They follow the showing swipe, reset on a swipe, edit or delete before the next generation, and clear when a card or field is off.
- Tests (FIX44): the browser sweep stops before any suite when the running mock is older than `tests/mock.js`, since a stale mock answered MB12's Draft entries prompt as a chat reply. `t_quick_action_setup` checks overflow with every action pinned, now that the inner screen gets the phone layout (B45), and `t_shell_followups` waits for the restore's own save to be answered (within 700 ms, well inside SillyTavern's 1000 ms delayed save) before it reloads, since a reload aborts a save still in flight.

- Your own edits in the block editor on Setup, Presets reach the stack at once (B43). Saving a block, restoring its default or undoing the restore updates the card in the stack, so the next request carries the text you just wrote and no "Changed in source" chip appears. A change from outside the extension, such as a preset file imported again or a block edited in SillyTavern's prompt manager, still shows "Changed in source" and keeps sending the old text until you tap Take the new text.

- Every card, tracker and section of Vexa, Neon Sola, Deus Ex Machina and Pura's Director now has a home in the reply tray (B20). New cards: Map (the room as a text grid with a legend), Holding back, Inventory (items per character with Gained, Lost, Used, Broken or Given), New faces (a folded full sheet for a major character and one line for a minor one, with Copy and Add to Story World), Reputation (rising, falling or steady, with the reason), Achievements (rarity as a row of stars), Choices and Notebook (Narrator notes and Diaries). Cards drawn today gain sections: Knowledge and secrets (Secrets with who keeps them and who else knows, False beliefs with the truth, What each person remembers), Plot (Tracks and Pending events from the thread records, beside Open threads, Plotlines, Planted details and Elsewhere), Director's desk (Course, Pressure, Branches, Graded), Roast (a panel of up to three commentators), Emotions (Turn psychology), Relationships (Route) and Characters (Conditions with a severity mark and its word). Every new card and section starts off and asks capture for nothing until you switch it on in Setup, Look, Reply tray; switching a new card on turns its sections on with it. Choices runs one Options call after each reply only while its card is on; each move has Copy, Insert and Send, and the call shows in the Sent card as "1 model call · extra request" and counts toward the background spend ceiling. [B20 notes](docs/ux-overhaul/tickets/B20.md)
- SillyTavern uses its phone layout on every touch screen, however wide (B45). On the unfolded Fold (wider than 1000 CSS px) SillyTavern used to switch to its desktop layout, with the chat in a half-width column, the character panel and AI Response Configuration as narrow side strips and the other drawers squeezed into the middle. Now every drawer and the character panel opens full width, as on the folded phone, and the layout follows a fold, unfold or rotation with no reload. The extension does this by letting SillyTavern's own phone rules also match a touch screen, so the layout keeps up with SillyTavern updates. Mouse screens keep SillyTavern's own layout. Setup, Look, Phone layout on touch screens turns it off (on by default).
- Behavior books (MB12, memory design 7.6). A World Info book whose entries use chance, inclusion groups or timing fields counts as a behavior book, and its kind can be changed; it stays an ordinary SillyTavern book, and nothing of the extension's is stored inside it. SillyTavern's own scan keeps deciding what fires, and while a behavior entry is in the scan the extension's own entries (the Tracker and Story World books, its sets) take "Prevent further recursion" for that scan, so their text cannot trigger a keyword of your book. After each reply the ids of the entries that fired are stored with that swipe and sent to capture, so a reply that acts on an event files it as a Thread or Fact; a host that reports no fired entries falls back to the final prompt. New behavior book and Draft entries (one Writer call, reviewed before saving) make entries at depth 1 with the system role. Each chapter's event seeds become Random story event entries (chance 10 percent, group "Story events", cooldown 10 messages, keys from the places and people they name) after a check that every name is in the records and that no entry in the book already reads the same; they go to the book chosen under Receive story events (a book the extension made directly, a book of yours only at Keywords, lines and entries, otherwise the review list with Add to book and Dismiss), each with Undo, and leave again with their chapter. A one-shot event is disabled after it plays, with Undo. Export writes any book as a standard World Info file, the same bytes as SillyTavern's own Export. [MB12 evidence](docs/ux-overhaul/tickets/MB12.md)
- The More quick actions menu no longer closes by itself while you reach for a row. A background capture or chapter job that cleared a bar note nobody had opened also shut any open bar popover; now only the note's own popover closes with it.
- Opening or closing the Left out strip in the stack no longer raises a page error once the stack below it has been drawn.
- Setup, Presets is now built around the stack and the bank (B32). The bank lists every Chat Completion preset loaded in SillyTavern, the extension's cards, the companion preset, files read by Import options and your versions, with a search box, a By source view (base, extension and companion open at the top, other presets folded by family) and a By feature view. Every card shows its source, tokens and an include control; Edit saves a version marked Yours beside the clean card, with Compare with clean, Reset to clean and Delete version. Move with Place here, Up and Down, select several cards for Put in, Take out, Move or Compare, and Undo the last ten changes. Compare lays two or three cards side by side with shared sentences underlined; on a phone it is a sheet with a height slider. Only RI, Only preset and All in By feature show what they would change and apply only on Apply, with Undo. Hidden subtext and ambient pulse switch on from the bank and roll every reply on their own gates without their story event set rolling. Copies of one edition share one stack, and a row only one copy has shows In another copy. The check list sits at the foot of the stack and, for a selected loadout, notes blocks the prompt manager has on that the loadout leaves out. Nothing in the stack changes without your tap. The Ours or Theirs switches fold at the foot of the page until they retire. [B32 notes](docs/ux-overhaul/tickets/B32.md)
- Notes inside your message (B42). Write `[[OOC: plain words]]` anywhere in a message. The note is cut from the message before it is saved and shown, and goes out once, for that reply only, as a private direction that keeps its `OOC:` prefix, the same way a queued Private direction goes. Several notes go in the order you wrote them. The note is listed in the reply's Sent card, a swipe or regenerate of that reply sends it again, and editing the saved message does not bring the marker back. A message of notes only is refused with a short "Note alone" mark on the bar and nothing is sent. The bar gets three wrap buttons, `[[OOC: ]]`, `* *` and `" "`, in the status slot while it is idle (after the pins while it shows a status or a note). A tap with nothing selected puts the pair at the cursor and leaves the cursor between the marks; with text selected it wraps the selection and leaves the cursor after the closing mark. The message box keeps its focus, so the phone keyboard stays open. Direction, Notes inside your message has an On or Off for the marker and for each button, and pressing and holding a button offers Hide. [B42 notes](docs/ux-overhaul/tickets/B42.md)
- Save as loadout now saves the stack (B35). The loadout is a real preset with the base's settings, the stack's blocks in your order, cards from other presets under their own identifiers, your customized versions as blocks, and blocks you took out kept but switched off. Its hidden marker (version 2) records the stack, the extension's own cards and every customized version, so the loadout sends the same request as the stack it came from. Selecting a loadout puts its stack back exactly; Rename, Update and Delete keep it; an exported loadout imported on another host recreates your versions (a version id that already exists with other text is kept beside the imported one, named "(imported)"). A block turned on in the prompt manager that the loadout leaves out is a note in the check list. Version 1 loadouts still open and show their switches as a stack you can edit.
- Each chat now has a Tracker World Info book (B21), "RI Tracker, <chat name>", rewritten after each capture and after a swipe, an edit, a delete or a chat change. It holds the tracker values of the latest reply on its shown swipe as Constant entries at depth 1, after the recall block: one entry per card that is on, and one per present character for the character cards, within the Tracker book's size limit (the Director's desk drops first). The model reads these values from the book and recall leaves them out, so each value goes out once. A feature on Theirs and a field switched off put nothing in it. The book appears in Story, World Info as "Tracker book", in SillyTavern's World Info editor, and exports through SillyTavern's Export; its total size shows in Review, Context. Its disabled first entry says that edits made in the editor are replaced at the next rewrite and that a value is corrected with Correct a story fact. A branch gets its own book. The generated-book guard no longer removes the Tracker book's entries from a request. [B21 notes](docs/ux-overhaul/tickets/B21.md)

- Requests in a chat with memory follow one fixed layout (MB5, memory design 5). A memory note of about 85 tokens joins the end of the main prompt and never changes. The chapter view sits directly above the open chapter's history. The recall block is the one memory block, at depth 1, with World Info entries at depth 1 after it, and a two-rule reminder sits at depth 0. The story notes at depth 4 retire in a chat whose memory lives in chat data, so that chat sends one memory block; where notes remain they sit at depth 1, and so do the story phase line and new Story World entries. Before a request goes out, code checks that the chapter view and the recall block survived SillyTavern's trimming; when either was cut, the bar shows a red "Memory cut" note and Review, Context names the part, beside a new "Memory in the last request" section with each block's place, the first changed message and the tokens sent again uncached. With Story state on Theirs the recall block carries no scene line, and capture still files the feature's changes from the reply. While a Tracker book publishes a card, recall leaves that card's values (scene, emotions, relationships) to it. Recall also leaves out entries a "The story changed" answer replaced, records that only repeat one of your entries, and records outside the recall pool (MB7). Sizes follow the Chat Completion context size. Search changes: book entries found by meaning alone use their own cut of 0.35 and their own share of 200 tokens, the desktop booster list is off unless switched on, and MiniSearch is the only word index. For Claude routes, set `claude.cachingAtDepth: 1` in SillyTavern's config (desktop guide, section 5).

- Story memory now tidies itself (MB7). After each reply, code merges records whose text, kind, subject and attribute are identical and queues records that only look alike ("the shoe is loose" and "the shoe is no longer loose") for a model ruling. Tidy sends those clusters to the Cleanup routes in batches of 6 on the desktop, 12 on mid routes and 16 on frontier routes, with the full text of every record; a merged record must keep every name, number and detail of its sources and quote each one, or the records stay separate and linked. Background jobs only add to your World Info books, as each book's "Story may add to this book" allows (Off, Keywords only, or Keywords, lines and entries; books shared by many chats start at Keywords only), and an addition leaves again when the reply that caused it is deleted, swiped away or cut by a branch, unless you edited it. Clashes with your entries go to the review list with Edit my entry, Keep mine, The story changed and Dismiss. Every change shows in the tray's Story changes card with Undo, and Restore for a merged record, and both survive a reload. Story corrections now search and correct the records in chat data. [MB7 evidence](docs/ux-overhaul/tickets/MB7.md)
- The extension's own guidance is now a card per feature in the block stack (B31). A card's clean version is the shipped wording and the wording you saved on the Prompts page is a second card beside it, equal to that stored text; the stack's Roleplay Instructions group sends the clean card, your wording, or both (clean first), and nothing for a feature with neither card in. Saving a wording puts it in the stack as the card that goes out and leaves the clean card in the stack, off, one tap from back on, so each reply keeps carrying your wording. The order of the cards in the group is the order of feature guidance in the next request; Setup, Presets lists them as Extension cards with Take out, Put back, Move earlier and Move later, replacing the Extension prompt order fold. The old per-chat order is read once into the group and then ignored. The companion preset's blocks are a source of any base, and the companion as the base starts with every extension card that is on and its shipped-on blocks.
- Recall works again in a chat whose character or persona has a World Info book attached. Once any recall setting was saved (an item cap, the booster, the scene line), the per-book "Recall manages this book" record was missing and every recall turn stopped with an error, so no recall block was sent. Shipped in 10.0.41.
- Pacing reads who is in the scene from the scene itself, so in a chat whose memory lives in chat data (where story notes no longer go out) story event items that wait for a secret, a plan or a number of people, and the order to a character who has stopped speaking for a few replies, work again.
- Setup, Presets, Extension cards also lists a feature that has no card in the stack (one that was off when the stack was made). It shows Follows Features, since its Setup, Features switch decides whether it is sent, and keeps its prompts and the Roast voice link reachable.
- A reply deleted and sent again with the same words in the same minute is captured again. Its capture job had the same key and sources as the deleted reply's, and the queue's done record skipped it although that reply's records had left with it; a capture job now runs for every reply with no capture stamp.
- Story notes go out again under the smallest room for story notes (100 tokens). The guidance line at the top of the block had grown longer than that room, so no entry fit and the block was left out; the room now holds the entries, with the people in the scene in short form, and the guidance line no longer counts against it. Two browser suites read the real requests: the relationships module on Ours, Theirs and Both in the reply and capture requests, and the story notes block under a small room and each placement (B39).
- Added Check conflicts, the block bank's one model call (B34). It runs only when you tap it: it reads the blocks that are on in send order, with your edited text, and lists contradictions, duplications and overlaps that could cause a problem in the reply, each with both blocks, their sources, a quote from each, the reason and the problem it could cause. It applies nothing; Keep both marks a pair as seen until either block changes, and a list shows Stack changed since the check after any include, exclude, move or edit. The parity comparison, its stored prompt and the hand pairing of blocks to features are gone, and the prompt moved to Setup, Prompts as Checking blocks for conflicts.
- Random Story Events and Random Writing Style draw from option banks, copied on first use into the World Info book RI Option banks with each item credited to its source: every category has a pool you tick in a sheet, a pick count of 1 to 5 with a send rule, and saves both per set and in saved settings. Rolls are seeded, run in code with no model request, and save a roll record with the reply that Roll again with this seed reproduces. An optional polish step is off by default, and Import options from a preset or plugin file reads value lists from a file on the device into the banks.
- Replies are prose only: the request no longer asks the model for an update block. About a second after each reply, one background capture call reads the exchange and files its lasting changes, the tracker values of every card field that is on and the scene, with each quote copied from its message; a reply that changes nothing files nothing, a claim made only in dialogue is filed as what its speaker said, and weather from an earlier story day is no longer sent as current. The Strip says Capturing until it ends, and a reply still waiting shows "As of reply N" on its story cards.
- The block bank check list (B33) is computed in code with no model call: notes for the same text, near copies (noted at 80 percent word overlap, called a near duplicate at 95), P1 verdicts against an RI card that is also on, pick-one groups with two or more on, the ordered setvar and getvar pass, guard rows taken out, and a missing Chat History row. The notes are information only and change no card, order or request.
- Setup, Connections, Model request settings now gives every function an Automatic mode (the chain in order, each step labeled Local, Tailscale, Backup or Main, with the profile and the step that runs first today) or a Fixed mode (one saved connection or Main API that is never replaced, with a Fall back if this fails box that is off by default). Background functions start Automatic, tapped functions stay Fixed on Main API, a connection you saved stays, the older shared connection no longer fixes anything, and automatic chapter summaries, chapter combining and the directions check start on. Requests follow the mode you see: Automatic walks the chain with the desktop check and the spend ceiling, Fixed sends only to your pick, and the receipt names the route that answered.
- Each request now sends the block-bank stack of the selected preset (B30). At generation start the live prompt list switches off base blocks taken out of the stack, switches on base blocks put in that ship off, follows the stack's order once a base block is moved, and gains a copy of every other card that is on (blocks from other presets, the companion and customized versions) under an `ri-bank-` identifier; when the prompt is ready, or the generation ends or stops, SillyTavern's live arrays get back exactly what they held, and the saved preset files and the stored stack never change. A copy left behind by a crash is removed at the next start. The extension's own cards in the stack decide whether each feature runs, a loadout and a chat with the extension off send the preset as saved, and the interim Ours, Theirs and Both switch keeps working on top of the stack. [B30 evidence](docs/ux-overhaul/tickets/B30.md)
- The per-feature switch on Setup, Presets gains a third side, Both, and every feature starts on it: Both keeps each block the preset has on and also sends the extension's text, so nothing is switched off. Sides you saved and chat pins keep their value, loadouts save and restore Both (older loadouts still load), and the Modules page link names all three sides.
- Chapters now live in the chat's own data. A chapter closes at a scene end after 6 exchanges, at 20 exchanges, at its share of the request ceiling, or by hand; the Writer chain writes it from the messages with quoted evidence, code checks every quote and name with one repair retry, and a chapter that still fails stays open with Repair on the divider. Messages a valid chapter covers leave each request as it is sent, with the chapter view in their place, and no hidden flag is stored on any message; an edit, a delete, a swipe or a branch inside a chapter sends its messages in full until it is written again. From the third close the condensed account is rebuilt from the stored chapter records, and a thin divider in the chat marks where the open chapter begins. [MB6 evidence](docs/ux-overhaul/tickets/MB6.md)

- The block bank model (B29) indexes every Chat Completion preset in the list, the extension's feature cards and the companion preset, refreshes on preset events and on each open, keeps her customized versions of any block in extension settings beside the clean block, and saves a stack per edition that starts with everything on and changes only on her taps; the bank page and the working copy arrive with B30 to B32.
- Added search on the device (memory design 4). Each reply, Recall indexes the chat's records, the exchanges and chapter summaries of closed chapters (cut to 256 tokens or fewer by the model's own tokenizer, header included) and the entries of any World Info book switched to "Recall manages this book"; it scores them with a word index (MiniSearch, BM25), `all-MiniLM-L6-v2` meaning search computed in the page, an optional desktop booster list from `nomic-embed-text` and rank fusion, then sends up to 6 items in a recall block at depth 1, below the history. The model downloads once from Hugging Face and loads from the page database after that; transformers.js, its WebAssembly runtime, MiniSearch and the stemmer ship in `vendor/`. SillyTavern's own scan still decides which keyword entries fire in a managed book, and Recall moves the fired entries into the block within a 400-token share; books with chance, groups or timing fields are not offered the switch and keep their activation with the host. Thresholds are named by their measure and a self-test fails on a cosine setting used as a Dice setting.

- Direction, Random sets now shows one list of every instruction, story event and writing style set, grouped by kind, with one Add set button; each set opens in its editor from the list and Back returns to it. The in-chat wording editors, the impersonation prompts and the Roast voice each have one home with link rows elsewhere, the Modules page links each feature to the Ours or Theirs switch in Setup, Presets (the Recheck button is retired), and the Sent card links to the new chapter control in Story World.
- Story memory now lives in the chat's own data. On the first open after the update, after one settings backup file, a chat's Story World book imports as change entries (records, chapters, the changes still staged on recent replies, and entries of every older kind); the book itself stays as it was. Each reply keeps its entries with its own swipe, so a swipe, a delete or a branch takes back only what that reply made, and an edited reply's entries wait until it is captured again. Record history, Revert, Restore and Lock survive a reload, and the Story World page and the request read the same records.

- Generated World Info books: one shared book writer writes the Story World book ("RI Story World, <chat name>") from the chat data in one whole-book save, with a disabled first entry that names the reply it reflects. A reply's capture never waits on it, an entry you type or change in the book goes to the review list before the next rewrite (File as my edit keeps it as a locked record), the book is left out of the request when attached to the chat, and Export as World Info book writes an enabled standalone copy with Leave secrets out on by default.

- The Characters card can pin characters: each row has Pin and Unpin, pins are saved per chat and survive a reload, and a pinned character stays on the card when absent from the reply, with its last values muted as "from reply N". The card shows up to 3 present characters plus every pinned one. Spend lists every fallback, back, warning and ceiling notice with its own Dismiss button, and a dismissal in Spend or in the bar clears both. Searching "prompt manager" in the menu lands on Setup, Prompts.

- Model profiles now apply. When the selected model or preset changes, the profile that names the model (the exact model first, then its family) sets its context size and kept image settings in the live settings, and the preset file is never rewritten. A model with no profile returns those values to the preset's own; a context size you change by hand stays until the next model change. The Presets card shows the active profile and lists every profile on the preset. Blocks added to a recognised preset under names the library knows (Default with "Dice Rolls" and "Prose Rules" added) now get an Ours or Theirs switch too. [B23 evidence](docs/ux-overhaul/tickets/B23.md)

- Fixed three follow-ups from the integration pass. The fold handle steps sideways when another extension's bar, such as Pathweaver's, sits on it, so each handle takes its own tap. A chat change leaves the menu on the page it shows, a cross-linked page included, and the next open still returns to the last tab page. Folding the bar and restoring a quick action save at once, so a reload right after keeps them. [B25 evidence](docs/ux-overhaul/tickets/B25.md)
- Added Setup, Connections, Spend and Background jobs. Spend shows this month's calls and cost per route against a US$5 ceiling (warning at US$4), each route's health, and jobs paused at the ceiling; a route that stops answering shows one dismissible note in the bar's status slot per outage and a back note when it returns, with no polling. Background jobs holds the masked OpenRouter key for jev-1.13 (the Jev step calls it on OpenRouter's decisions endpoint and falls back to jev-router), the on-phone model row and the desktop guide link.
- Rebuilt the menu's components on one short set in the new `src/ui/components.css`: Button (Primary, Secondary, Text, Danger), Icon button, Tab, Switch row, Field, Card, Chip, one Disclosure chevron, Note, Sheet, Popover and Toast, all with zero radius, the Plex Mono type roles with a 12 px floor, the 2 px violet focus ring, 60 ms steps and instant motion under reduced motion, plus more-contrast and forced-colors states. Every color in the stylesheets now comes from a token, the host-theme color bridge is gone, and the old accent picker is removed from Setup.

- Removed the action card under every reply. SillyTavern's message menu on each AI reply now has What was sent (opens Review, Replies on that reply) and Correct a story fact (opens Story, Scene with that reply selected); the bar's Swipe, Continue and Review quick actions cover the newest reply, and a reply's execution details and the directions sent with it show in the Sent card of its reply tray.
- Added Setup, Prompts and the mirrored prompt editor. Setup, Prompts lists every prompt once by family with a Customized chip and its variation count, and each page's foot row opens it filtered to that page. The editor beside a feature and the one on Prompts are two views of one stored prompt, so an edit in either shows in the other at once. Both use SillyTavern's verbs (Update, Save as, Rename, Delete, Import, Export, Restore default prompt) and pick variations from a list; a slot naming an unknown prompt shows a Problem note.
- Added the card catalog and shared card templates. Every card, section and field of the four reference presets is one entry in src/cards/catalog.js, and Setup, Look, Reply tray lists each card with Off, Strip only or In the tray, an order, and a switch per section and field; a switch that is off leaves the field out of what each reply asks for. Scene, Characters, Emotions, Relationships, Plot, Story changes, Director's desk and Roast draw from label and value rows, block meters, gauges, chips and timelines in the chat's story style, show carried values with their source reply, and fold long text in place. Cards the tray drew before keep their setting; every new card, section and field starts off.
- Moved every menu section to its page and gave each duplicated control one home with links elsewhere. Setup, Memory is new (Recall, Budgets, Upkeep and a "This chat" block for catch-up and rebuild); Direction, Random sets gains Sets and pacing (set storage, pacing, follow-through checks, world orders, tags to skip); Story, World Info holds the one Story World section (create, export, delete); the Story World page keeps the entries and The story so far; pronouns open Characters; Review, Context shows the next reply preview; Setup, Features and Connections shed what moved. Facts and Plot stay separate tabs, and all story records now go through one record adapter (src/records.js) with no change in behavior. Each prompt shown beside a feature is marked with its stored prompt's id.

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
