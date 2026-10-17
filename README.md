# Undercurrent

A SillyTavern UI extension (frontend only) that runs a hidden layer underneath your roleplay:

- **Director.** A hidden showrunner pass reads the scene before the reply. It decides one concrete beat for this turn and the pacing (linger / advance / cut), what each character present wants and plans, what they don't know, and what off-screen people are doing. It keeps the world moving, breaks loops, prefers consequences over randomness, and never scripts your character.
- **NPC minds.** Every character has a mood, wants, plans, goals, a list of what they know and don't know, secrets, where they were last seen, and what they are doing off-screen. New characters get a short profile that includes their *ikigai* (reason for being) and goals.
- **Memory.** Facts, place, time and weather, plus arcs and planted "drivers". Facts are closed with an `until_turn` instead of being overwritten.
- **Intimacy profiles.** Each character's sexual personality is seeded once from their card: orientation, style, preferences and hard limits. After that, preferences change only on quoted in-story evidence. Limits change only by an explicit in-story choice, and negative evidence outranks any guess. There are no meters, scores or stage ladders.
- **Events.** Code-side dice for *pulse* (ambient life), *twist* (complication) and *curiosity* (a question planted), with cooldowns, scaled by your drama dial and by the preset's persona/tone/genre. Events are suppressed during intimate, grief and argument scenes. Code decides whether an event happens; the director decides what it is.
- **Goals & Tasks.** Author-set story goals broken into tasks that the world, NPCs or `{{char}}` work toward; completions need a verbatim quote from the story and are undone when that message is swiped, edited or deleted.
- **Chance rules.** Trigger → action rules (keywords, scene modes, intimate-scene phase, chances, cooldowns) that add short "sparks", director hints or separate injections; LoreBary plugins import here (their code is never run).
- **Native engines.** Six per-turn mechanics rebuilt as pure code: *intimate-scene continuity* (phase, activities, clothing, senses, worn-out phrasing, pacing, aftermath; limits restated while live), *desire pulse* (occasional, character-true impulses from evidenced preferences; limits always win), *psyche* (each character's appraisal of what happened: feelings that decay, lasting memories, insights, defenses under stress), *reply shape* (length matched to your turn, repeat vetoes, a spark when replies flatten), a *critic* (free code checks every reply: scripting your character, tense/POV slips, missing thoughts or dialogue; an optional hidden critic pass) and *drama cadence* (drama when replies go flat, a curiosity queue with payoff windows, a plot-beat menu). None of them has a meter, a stage ladder or a gate, and none decides anything for `{{user}}`.
- **Tic guard.** Code only, no extra model calls. It detects phrases repeated across recent replies, per-model slop, the reply parroting your words, characters reacting to your private `*thoughts*`, repeated openings, and stalls. Corrections are short and escalate if the tic persists.

All of this reaches the model as one short system note at chat depth 1, wrapped in `<undercurrent>…</undercurrent>` (about 350 words at most, plus a little room when goals or the native engines add lines). By default the note is the director's backstage **notebook**, written in the narrator persona's own voice so its register matches the preset; the story itself stays in clean prose. **Nothing is ever printed into the chat**: no trackers, no status blocks, no footers. If you want to look behind the curtain, turn on the optional *Behind the scenes* panel (`/uc-peek on`): a closed, screen-only panel under each reply that is never part of the message, the chat file or anything sent to the model. Every part of this is adjustable: see [Customization](#customization).

Requires SillyTavern **1.18.0** or newer, or TauriTavern built on it. Chat Completion is recommended.

## Install

**TauriTavern / SillyTavern, from a git URL:** Extensions panel → *Install extension* → paste the git URL of wherever you host this folder (your own repository or mirror) → Install.

**By copying the folder:** copy this `Undercurrent` folder into your user extensions directory:

- TauriTavern / SillyTavern: `data/<user>/extensions/Undercurrent`
- (older SillyTavern layouts: `public/scripts/extensions/third-party/Undercurrent`)

Then reload. **Undercurrent** appears in the Extensions panel (right column).

## Settings

The drawer keeps the **essentials**: Enabled, Mode (separate passes or in-reply), the settings **profile**, the **Drama** dial, the **Intimacy engine** and **Tic guard** switches, and buttons for **All settings**, the **State Inspector**, **Re-seed character** and **Clear chat state**. The **Goals & Tasks** and **Chance rules** panels sit underneath. Every other setting is in **All settings** (see [Customization](#customization)).

- **Mode.** *Separate passes* (default): the director runs before the reply, and a "scribe" pass reads each finished reply in the background and records what it established. *In-reply*: the main model appends a hidden `<!--uc {…} -->` record to its own reply; Undercurrent parses it into state and strips it from the message (one call fewer per turn). If the block is missing, the scribe runs instead.
- **Profile.** Loads a bundle of settings: *Balanced* (defaults), *Quiet & intimate*, *Chaotic*, *Cinematic thriller*, *Slice of life*, *Low latency*, or one you saved. "(modified)" appears once you change something the profile sets.
- **Drama.** 0 = no random events, 1 = default (pulse 12%, twist 10%, curiosity 8% per turn), 2 = twice as eventful.
- **Intimacy engine.** Seeds and maintains intimacy profiles. When off, no intimacy ops are accepted and no intimacy lines are injected.
- **Tic guard.** Repetition, slop, echo, mind-read and stall detection. The slop list follows the active model (DeepSeek V3/V4, DeepSeek R1, GLM 5, Kimi K2, MiMo 2.5, MiMo 2.6 Pro, or a common list), plus your own banned phrases.
- **State Inspector** opens this chat's hidden state as editable JSON (validated before saving). **Re-seed character** reads the card again for the intimacy profile, keeping in-story evidence. **Clear chat state** forgets everything Undercurrent knows about this chat; the chat itself and this chat's setting overrides are untouched.

## Customization

Undercurrent has no fixed behavior: every number, switch, list and prompt that changes what it does is a **setting** (a "knob"), changeable on the fly without touching code. There are about 290 built-in settings plus the Goals and Chance-rules ones; [KNOBS.md](KNOBS.md) lists every key with its type, default, range and effect (generated from the code, so it is always current).

### All settings

Open it from the drawer or with `/uc-knobs`. It is one column and touch-friendly (44 px targets, nothing hidden behind hover), so it works the same on TauriTavern for Android and iOS.

- **Search** filters by label, help text or key (e.g. `cooldown`, `word cap`, `inject.depth`). Advanced settings are hidden until you tick *Show advanced* or search for them; *Only changed* shows what differs from the defaults.
- Each setting shows its control, a help line, its key, a **Reset** button and a **This chat only** switch. Changed settings are highlighted; per-chat ones carry a "this chat" badge.
- Each group has **Reset this group**; the Profiles section has **Reset ALL** (tap twice).

### Groups

| Group | What you can change |
|---|---|
| Display | **Behind the scenes** peek: off (default) or a closed panel under each reply showing that turn's direction, characters, goals (hidden goals masked), fired rules and events, engine lines and corrections; screen only. Pop-up notices: only repeated failures and replies to your commands (default), or also background progress such as goal completions. |
| General | Enabled, mode, director cadence (every turn / 2 / 3 / only on stall, event or note), pre-reply vs background planning, global and per-chat pause, swipe plan reuse, failure warnings, debug logging. |
| Hidden passes | Connection profile, timeout, token budgets (all passes, or director / scribe / seed separately), how long the director waits for a running scribe, seed and director time budgets. |
| Note style | **Notebook** (default): the director writes a 60–140-word first-person backstage scribble in the narrator persona's own voice, matching the preset's register; the note carries it plus short follow lines (clock, intimacy, facts, tic corrections, goals, sparks). **Terse**: v1.0 labeled bullet lines. Lengths, follow lines and their casual labels. |
| Director | Prompt voice (persona-voiced or plain), extra instructions, preferred pacing, which inputs it sees (card, state, recent messages, goals, rule hints, used beats, tic notes, previous beat), persona/tone/genre taste, pronoun rule, plan sizes (characters, drivers, NPC moves, off-screen threads, avoid items) and text lengths. |
| Events | Drama and its ceiling, each kind on/off, base chance, cooldown and stall boost per kind, max chance, minimum gap, one-per-turn, lens biases, the scene modes that suppress events. |
| Injection | Placement (one note, or `{{uc_*}}` macros), word cap, depth, role, position, World Info scan, wrapper tag, bullet, every section on/off, **section order**, per-section priority (what is dropped first at the cap), caps (NPCs, facts, off-screen, avoid, tic lines), when intimacy lines appear, impersonation and continue behavior, and the wording of every label. |
| Scribe | Extra instructions, max ops per reply, what it may record (scene mode, place, time, weather, who is here, facts, off-screen threads, arcs, new characters, mood, profile fields, whereabouts, wants/plans/goals, knowledge, secrets, intimacy), quote verification, which inputs it sees, the in-reply instruction depth and role. |
| Intimacy | Engine on/off, seeding (on/off, attempts, examples and scenario), inferred-preference cap, whether evidence needs a quote, phase and attraction tracking, how long attraction stays live, likes shown, storage caps. Hard limits always outrank preferences, negative evidence always outranks guesses, and a limit is only dropped by an explicit in-story choice: those rules are not switches. |
| Tic guard | Each detector on/off, the slop list (auto from the model, a fixed model, or none) plus **your banned phrases** (`/regex/` allowed) and custom slop entries, stall threshold, compared replies, phrase lengths, repeat/echo/mind-read/opening thresholds, near-identical threshold, escalation steps and the wording of every correction. |
| Ports · Scene intimacy / Desire pulse / Psyche / Reply shape / Critic / Drama cadence | Each native engine's switch, cadence, windows, thresholds, lexicons, phrase lists, line templates and note priorities; the drama dial is per chat. The scribe gains switches to record the intimate scene, clothing, desire hints, events that matter to characters, and planted questions/beats. |
| Context budgets | How many messages and characters the director and scribe read; card, personality, scenario, persona and example budgets; whether each card part is included; state-summary sizes. |
| Memory limits | Facts, list sizes, threads, used-beat memory, characters, ledger, rollback snapshots, swipe cache, event history, ops per batch. |
| Prompt templates | The full text of every hidden prompt and fixed phrase (director, notebook spec, scribe, in-reply record, intimacy seed, event texts, stall lines, scene hints, tic corrections). Large editors, a list of the `{{uc_*}}` placeholders each one understands, a warning for unknown placeholders, and **Restore default**. An empty template means the built-in one. |
| Goals · … / Chance rules · … | The Goals & Tasks and Chance-rules engines' own settings (checks, urgency, injection, task generation, budgets, safety filter, scene-mode groups, LoreBary import). |

Template placeholders such as `{{uc_taste}}` are filled by Undercurrent; SillyTavern macros (`{{user}}`, `{{char}}`, `{{getvar::…}}`) pass through untouched. Nothing in the built-in text names or describes any character or player; the `{{user}}` pronoun line comes only from the preset's pronoun toggle.

### Profiles

A profile only sets setting values. Loading one resets every setting it does not mention to the default, except the sticky ones (Enabled, pauses, debug logging, hidden-pass connection). In **All settings → Profiles** you can load a built-in profile, **Save current as…** your own, delete it, **Export JSON** (a file download; where downloads do not work, such as TauriTavern mobile, the JSON opens in a copyable box), **Copy JSON**, and **Import** a file or pasted JSON. The format is `{"format":"undercurrent-settings","version":1,"name":"…","values":{key: value}}`; invalid values are skipped and reported, and settings for engines that are not loaded are kept.

### Per-chat overrides

Tick **This chat only** on any setting (or add `chat=true` to `/uc-set`) to give the current chat its own value. It is stored in the chat file (`chat_metadata.undercurrent.knob_overrides`) and wins over the global value; untick it to follow the global value again. A few settings are per chat by nature (e.g. *Paused in this chat*, the goal-check cadence, the Chance-rules multiplier).

### Macros placement

With **Injection → Placement = Macros**, Undercurrent does not inject its note. Instead your preset can place any of these SillyTavern macros in its own blocks: `{{uc_note}}` (the whole note), `{{uc_beat}}` (this turn's direction: the notebook, or the beat/event/NPC-move/avoid lines), `{{uc_minds}}`, `{{uc_intimacy}}`, `{{uc_facts}}`, `{{uc_scene}}` (clock, place, weather, who is here), `{{uc_tics}}`, `{{uc_goals}}`, `{{uc_sparks}}`, and the native engines' `{{uc_scene_intimacy}}`, `{{uc_desire}}`, `{{uc_psyche}}`, `{{uc_reply_shape}}`, `{{uc_critic}}`, `{{uc_drama}}`. In Note placement every one of them is empty, so nothing is ever sent twice.

The Undercurrent preset ships two optional blocks for this, off by default: *Macro · minds, facts, scene, intimacy* (`{{uc_scene}} {{uc_minds}} {{uc_facts}} {{uc_intimacy}}`) and *Macro · beat, goals, sparks, tics* (`{{uc_beat}} {{uc_goals}} {{uc_sparks}} {{uc_tics}}`). For the native engines, add a third block (suggested name *◇ Macro · engines*, role system, placed right after the beat block, after the chat history):

```
<undercurrent>
{{uc_scene_intimacy}}
{{uc_desire}}
{{uc_psyche}}
{{uc_drama}}
{{uc_reply_shape}}
{{uc_critic}}
</undercurrent>
```

Turn all three on together when you switch Placement to Macros, and off again when you switch back.

### Commands

- `/uc-knobs`: open All settings.
- `/uc-set <key> <value> [chat=true]`: change a setting. The key may be a unique ending (`/uc-set max_words 250`). Lists take commas or JSON. `/uc-set reset=true <key>` restores the default (`chat=true` drops this chat's override). Returns the new value, so it pipes.
- `/uc-get <key>`: show and return the effective value and where it comes from (default, global, this chat).
- `/uc-profile <name>`: load a profile; without a name, list them.
- `/uc-state`, `/uc-reset`, `/uc-direct <note>` (a one-shot note for the director, e.g. `/uc-direct a sibling calls during dinner`).
- `/uc-pause [chat=true]` and `/uc-resume`: stop and restart all hidden work (everywhere, or only in this chat).
- Goals: `/uc-goal add|list|done|undone|remove|pause|resume|hide|show …`, `/uc-tasks [goal] generate|more [n] | check`.
- Chance rules: `/uc-rules list | on <id> | off <id>`, `/uc-pack on|off <pack>`, `/uc-roll test`. Rules can trigger on the intimate-scene phase: `{"type":"intimacy_phase","phases":["foreplay","live"]}`.
- Drama and threads: `/uc-drama off|low|normal|high` (this chat's dial), `/uc-drama fire`, `/uc-drama hold <turns>`, `/uc-drama` (status); `/uc-beat add <text> in=N by=M | done <text> | drop <text> | list` (the plot-beat menu); `/uc-question <text> in=N by=M` (plant a question with a payoff window); `/uc-ask <character> <topic>` (something a character wants to ask about).
- Inspect (popups, nothing printed into the chat): `/uc-psyche` (feelings, memories, defenses, insights), `/uc-scene` (the intimate-scene tracker).
- `/uc-peek on|off`: the closed *Behind the scenes* panel under each reply in this chat (screen only).

## Pairing with the Undercurrent preset

The Undercurrent chat-completion preset tells the model that `<undercurrent>` notes are private director notes, to act on and never quote. Undercurrent reads which narrator, tone and genre toggles are enabled directly from the active preset each turn (so changes apply immediately, even before you save the preset), and falls back to these chat variables that the toggles also set:

- `uc_persona_id`: narrator persona (e.g. `vesper`, `rook`, `marigold`). Its sensibility and favored beat types flavor the director's taste. The persona never appears in the story.
- `uc_tone_id`: `grounded` (default), `harsh`, `warm` or `dark`.
- `uc_genre_id`: genre lens (e.g. `romance`, `mystery`, `regency`); `none` by default.

Each of these also scales the event dice; see `data/registry.json`. The preset sets the variables while the prompt is being built, so the extension picks up a change from the following turn on. Without the preset, the defaults apply and everything still works.

## How state stays correct

Undercurrent changes state only through small patch operations (`set`, `append`, `close`, `remove`) on an allow-listed set of paths. Each batch is recorded against the message it came from (index, swipe id and a hash of the text), along with a snapshot taken before it.

When you **swipe, edit or delete**, batches whose message no longer matches are undone: the state is restored from the snapshot and later, still-valid batches are replayed on top. Swiping back to an earlier swipe re-applies that swipe's batch. Rerolls and swipes reuse the plan already made for the same message of yours, so the director is not re-run. Continues keep the original batch.

Your character is never tracked as an NPC. Text in `*asterisks*` in your messages is marked as a private thought that no character can know.

## Privacy

Hidden passes go only to **your own connection**: the current API, or the Connection Manager profile you choose. They use the extension's own compact prompt: the character card (truncated), your persona description, a state summary and the last ~12 messages. The extension contacts no other server. State is stored in the chat file's metadata (`chat_metadata.undercurrent`).

## Notes

- In-reply mode with streaming: the hidden block can flash briefly at the end of the stream before it is stripped. If that bothers you, add a display-only regex that hides `<!--uc[\s\S]*?(-->|$)`.
- The first turn of a chat may take a moment longer while the character's intimacy profile is seeded. This happens once per chat.
- Group chats work: the character currently speaking is treated as `{{char}}`.

## Development

`src/` holds pure modules with no DOM or SillyTavern globals; `index.js` is wiring only. The data modules `src/registry.js` and `src/slop.js` are generated from `shared/registry.json` and `shared/slop.json` by `node tools/sync-registry.mjs` at the project root. Settings live in `src/knob-defs.js` (built-in knobs and profiles) and `src/knobs.js` (the registry: validation, coercion, resolve, profiles, migration); other engines add theirs with `registerKnobs(array)`. `node tools/gen-knobs-doc.mjs` regenerates [KNOBS.md](KNOBS.md) (a unit test fails when it is stale). Unit tests: `node --test "tests/unit/*.test.mjs"`.
