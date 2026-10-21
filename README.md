# Undercurrent 2

A roleplay suite for **SillyTavern 1.18 / TauriTavern** (Chat Completion; nano-gpt, OpenRouter or any OpenAI-compatible
source). It is two parts that work together:

- **a preset** (one per model family): a short skeleton of `[[uc_…]]` slots plus the regex scripts that hide the
  hidden state;
- **an extension** that fills those slots on every request, keeps the story state, and draws the panel.

One request per turn. The model writes its reply and, at the end, a small hidden `<UC>` section (scene, minds, facts,
new characters, intimacy evidence, a tracker). The extension reads that section back out of the chat, so the story
state always matches the chat as it stands: swipes, edits, deletes and reloads just work. Nothing extra shows in the
chat unless you turn it on.

> **The preset requires the extension.** Without it, SillyTavern sends the raw `[[uc_identity]]`, `[[uc_law]]` …
> placeholders to the model instead of the rules. Install both.

## Install

### 1. The extension

Pick one:

- **Copy the folder.** Copy `extension/` (from the release zip or this repository) into your user data:
  `data/default-user/extensions/<any-folder-name>/` so that `manifest.json` sits directly inside that folder
  (for example `data/default-user/extensions/undercurrent2/manifest.json`). On TauriTavern use the same
  `data/default-user/extensions/` folder inside the app's data directory. Reload the app. The folder name does not
  matter.
- **Install from git.** SillyTavern's *Extensions → Install extension* clones a repository whose root holds
  `manifest.json`. In this repository the extension lives under `extension/`, so publish it as its own branch once:
  `git subtree split --prefix=extension -b st-extension` and push that branch. Then install with the repository's
  HTTPS URL and, in the dialog's branch field, `st-extension`. TauriTavern installs it into a folder named after the
  repository; any name works.

Check: *Extensions* panel shows an **Undercurrent 2** drawer, and a small water-drop button floats at the right edge of
the chat.

### 2. The preset

1. *AI Response Configuration* (left panel) → Chat Completion presets → **Import preset** → choose the file for your
   model from `presets/` (release zip) or `preset/out/` (repository):
   `Undercurrent 2 - DeepSeek V4.json`, `- DeepSeek R1`, `- GLM 5.x`, `- Kimi K2.x`, `- MiMo 2.5`, `- MiMo 2.6 Pro`.
2. When SillyTavern asks **"This preset has embedded regex script(s). Would you like to allow using them?" → allow.**
   They hide the `<UC>` section in the chat, strip old ones from the prompt, and fold `<think>` blocks.
3. Select the preset. It carries samplers and prompts only, never connection settings, so your API, key and model
   stay as they are.

The presets differ only in samplers and the model note; the extension auto-detects the model family from the
connected model id (override: Writing tab → Model family).

## First run

1. Open a chat with any character. Make sure your persona (*Persona Management*) has a name and, ideally, a
   description; pronouns are read from it (or set them in Writing → {{user}} pronouns).
2. Open the panel: the floating button, the wand menu → *Undercurrent*, the *Extensions* drawer, or type `/uc`.
3. Optional: choose a narrator persona (Narrator tab), a tone and genre (Story tab), a reply length (Writing tab).
   Changes save immediately; *Save & Close* just closes.
4. Write as usual. Your rules are built in: the model never writes {{user}}'s words, actions, thoughts or feelings;
   `*asterisks*` in your messages are private thoughts nobody can hear; only `"quoted"` text is spoken.

**Per character or global.** Each tab has a *Global* switch in the header. Story Config is per character by default
(the switch shows the character's name); the other tabs are global. Turning Global on for a tab makes the current
character's values everyone's. **Reset** puts the current tab back to the defaults for the current scope.

## What is on by default

| On | Off |
|---|---|
| Narrator persona **Vesper**, loud rule voice, OOC replies in persona | Showrunner (background job) |
| Writing: medium length (300–600 words), heavy dialogue, standard thoughts, pronouns auto, reasoning auto | Memory |
| Story: grounded tone, explicit content rating, everything else from the card | Seeding the main character's profile from the card |
| Director: story events (drama dial 1), chance rules with four starter packs, compact hidden state | "Behind the scenes" card under replies |
| Characters: minds of present characters and intimacy profiles in the per-turn block | |

With these defaults every turn is exactly **one** request to the model. Nothing runs before a reply.

## Optional background jobs

Background jobs run only **after** a reply, one at a time, never delay a reply, and step aside the moment you send.
Each is one short extra request (through *Advanced → Connection profile for background jobs* if you want a cheaper
model, otherwise the current connection).

- **Showrunner**: Director tab → *Showrunner (background job)*. After each reply it plans the next beat in the
  narrator's voice; the note is used in your next turn only, and swiping the reply discards it.
- **Memory**: Memory tab → *Long-chat memory*. The newest messages (working window, default 30) stay as written;
  older ones leave the prompt in chunks (default 10) and come back as short summaries (*Summaries*, a background job)
  and as recalled passages that match your newest message (keywords, or SillyTavern's vectors when *Recall* is set to
  semantic). The Memory tab shows how many messages are archived and roughly how many tokens that saves.
- **Seed the main character**: Characters tab → *Seed the main character from the card*: one job reads the card once
  and notes its stated likes, limits and history.

*Advanced → Background jobs* has run-now buttons for all three.

## Commands

| Command | What it does |
|---|---|
| `/uc` | Open the panel. |
| `/uc-direct <note>` | A one-off director note for the next reply only (and its swipes). `/uc-direct` alone clears it. |
| `/uc-state` | Show the current derived story state. |
| `/uc-off` / `/uc-on` | Pause / resume the suite. Paused: the rules stay, the per-turn block is left out, no jobs run. |
| `/uc-reset-chat` | Clear Undercurrent's data for this chat (seed, edits on the Characters tab, memory, notes). The chat itself is untouched. |

## Good to know

- The text above the chat history stays byte-identical from turn to turn while your settings stay the same, so
  providers that cache prompt prefixes can reuse it. Everything that changes per turn sits in one block right before
  your newest message. (Lorebook entries triggered by keywords also sit above the history and do change that text;
  that is SillyTavern's behavior, not the suite's.)
- The Characters tab shows every character the story has met, with their current mind and intimacy profile; edits
  there override what the model recorded until you clear them.
- The Rules tab lists the chance-rule packs; you can switch packs off or import LoreBary / SillyTavern lorebook packs
  (only static text is imported; no code runs).
- Dev: *Advanced → Payload preview* builds the real outgoing prompt with a dry run (nothing is sent).

## Credits

- [SillyTavern](https://github.com/SillyTavern/SillyTavern) and TauriTavern, whose extension and preset systems this
  builds on.
- **Megumin Suite**, whose slot-based preset, single-call design and panel were studied closely for this rewrite
  (study notes in `docs/MEGUMIN_DOSSIER.md`); no text or code was copied.
- **LoreBary**, whose chance-rule plugin format the importer reads.
- Undercurrent v1, the original suite this one replaces.

All prompt text and code here are original.
