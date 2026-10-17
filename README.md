# Undercurrent

A SillyTavern UI extension (frontend only) that runs a hidden layer underneath your roleplay:

- **Director.** A hidden showrunner pass reads the scene before the reply. It decides one concrete beat for this turn and the pacing (linger / advance / cut), what each character present wants and plans, what they don't know, and what off-screen people are doing. It keeps the world moving, breaks loops, prefers consequences over randomness, and never scripts your character.
- **NPC minds.** Every character has a mood, wants, plans, goals, a list of what they know and don't know, secrets, where they were last seen, and what they are doing off-screen. New characters get a short profile that includes their *ikigai* (reason for being) and goals.
- **Memory.** Facts, place, time and weather, plus arcs and planted "drivers". Facts are closed with an `until_turn` instead of being overwritten.
- **Intimacy profiles.** Each character's sexual personality is seeded once from their card: orientation, style, preferences and hard limits. After that, preferences change only on quoted in-story evidence. Limits change only by an explicit in-story choice, and negative evidence outranks any guess. There are no meters, scores or stage ladders.
- **Events.** Code-side dice for *pulse* (ambient life), *twist* (complication) and *curiosity* (a question planted), with cooldowns, scaled by your drama dial and by the preset's persona/tone/genre. Events are suppressed during intimate, grief and argument scenes. Code decides whether an event happens; the director decides what it is.
- **Tic guard.** Code only, no extra model calls. It detects phrases repeated across recent replies, per-model slop, the reply parroting your words, characters reacting to your private `*thoughts*`, repeated openings, and stalls. Corrections are short and escalate if the tic persists.

All of this reaches the model as one short system note at chat depth 1, wrapped in `<undercurrent>…</undercurrent>` (about 350 words at most). Nothing is ever printed into the chat.

Requires SillyTavern **1.18.0** or newer, or TauriTavern built on it. Chat Completion is recommended.

## Install

**TauriTavern / SillyTavern, from a git URL:** Extensions panel → *Install extension* → paste the git URL of wherever you host this folder (your own repository or mirror) → Install.

**By copying the folder:** copy this `Undercurrent` folder into your user extensions directory:

- TauriTavern / SillyTavern: `data/<user>/extensions/Undercurrent`
- (older SillyTavern layouts: `public/scripts/extensions/third-party/Undercurrent`)

Then reload. **Undercurrent** appears in the Extensions panel (right column).

## Settings

| Setting | What it does |
|---|---|
| Enabled | Master switch. Off clears the note immediately. |
| Mode | **Separate passes** (default): the director runs before the reply, and a "scribe" pass reads each finished reply in the background and records what it established. **In-reply**: the main model appends a hidden `<!--uc {…} -->` record to its own reply. Undercurrent parses it into state and strips it from the message, which saves one call per turn. If the block is missing, it falls back to the scribe. |
| Director cadence | Every player turn, every 2, every 3, or only on a stall, a due event or a `/uc-direct` note. |
| Run the director before the reply | On: the director sees your latest message, which adds latency up to the timeout. Off: the director plans the next turn in the background right after each reply, adding no latency. |
| Drama | 0 = no random events, 1 = default (pulse 12%, twist 10%, curiosity 8% per turn), 2 = twice as eventful. |
| Events | Toggle pulse, twist and curiosity individually. |
| Intimacy engine | Seeds and maintains intimacy profiles. When off, no intimacy ops are accepted and no intimacy lines are injected. |
| Tic guard | Repetition, slop, echo, mind-read and stall detection. The slop list follows the active model: DeepSeek V3/V4, DeepSeek R1, GLM 5, Kimi K2, MiMo 2.5, MiMo 2.6 Pro, or a common list for anything else. |
| Hidden-pass connection | Optional Connection Manager profile for the hidden passes, e.g. a cheaper or faster model. It is hidden when Connection Manager is unavailable. Empty = your current connection. |
| Hidden-pass timeout | Generation is never held up longer than this (default 45 s). On timeout, the last plan is used. |
| Hidden-pass max tokens | Response budget for the director, scribe and seed passes. |
| Stall after (turns) | How many turns without a new fact, place, time or character count as a stall. |
| Debug logging | Logs plans, ops, rejections and the final note to the browser console with the `[Undercurrent]` prefix. |
| State Inspector | Opens this chat's hidden state as editable JSON. It is validated before saving. |
| Re-seed character | Reads the card again for the intimacy profile. In-story evidence and story-made limits are kept. |
| Clear chat state | Forgets everything Undercurrent knows about this chat. The chat itself is untouched. |

## Commands

- `/uc-state`: open the State Inspector.
- `/uc-reset`: clear this chat's hidden state (asks first).
- `/uc-direct <note>`: a one-shot note for the director, merged into the next director pass and note. Example: `/uc-direct her sister calls during dinner`.
- `/uc-pause` and `/uc-resume`: stop and restart all hidden work.

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

`src/` holds pure modules with no DOM or SillyTavern globals; `index.js` is wiring only. The data modules `src/registry.js` and `src/slop.js` are generated from `shared/registry.json` and `shared/slop.json` by `node tools/sync-registry.mjs` at the project root. Unit tests: `node --test "tests/unit/*.test.mjs"`.
