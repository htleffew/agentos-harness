# Presets

Presets builds what the next request sends for the selected Chat Completion preset. The bank lists every block you could send; the stack is the blocks that go out, in order. The page also shows the preset card, saves Loadouts (a stack saved as its own SillyTavern preset) and runs a conflict check when you ask. These terms are in [Words this guide uses](help:glossary).

Open it to put a block in or take one out, to try a block from another preset, to save the stack as its own preset, or to read what the preset sends as one document.

## What it does

When the Main API is not Chat Completion, or no preset is selected, the page says so and shows only the loadouts.

### Preset card

The card names the preset and how it is recognized (a family and edition, a loadout of a base, or the companion preset), with a match percentage. A line names the model profile that follows the selected model and what it sets, such as the context size, and marks it Edited when you changed that value since. Folds under it:

- **Overrides** lists the edition's overrides.
- **Model profiles** lists every profile stored on the preset, marking the one that follows the selected model.
- **Profiles in the preset family** lists the family's profiles with the models each one names.
- **What changes** says whether what is sent differs from the preset. A loadout is sent exactly as saved.
- **Save as loadout** takes a short **Loadout name** and writes a new SillyTavern preset named after the preset plus "+ RI" and your name. It holds the stack's blocks in your order and a hidden record of the stack and your versions. The new preset becomes the selected one; the original stays as it was.

Evening Truth presets carry a Distinct chip and stay one preset per model.

### Bank and stack

On a phone the two show one at a time behind **Stack** and **Bank** buttons; at 760 px and wider they sit side by side.

The bank holds every block of every Chat Completion preset loaded in SillyTavern, the extension's own cards, the companion preset, files you imported and your own versions. It updates when a preset is imported, saved or deleted. Search finds a block, preset or feature, and **By source** and **By feature** switch the view. A block that is not in the stack shows **Left out**.

The stack starts with everything on, and only your taps change it:

- the include switch on a card puts it in or takes it out
- **Move** then **Place here**, or **Up** and **Down**, reorder cards
- the batch buttons act on selected cards: Put in, Take out, Move, Compare
- **Take the new text** updates a card whose source changed
- the By feature shortcuts (Only RI, Only preset, All) show what would change until you tap **Apply**
- **Undo** reverses the last change; ten are kept
- **Pin to this chat** keeps a stack for the open chat alone

On a single block:

- **Edit** saves your wording as a version marked Yours beside the clean card; the preset file stays as it is.
- **Compare with clean**, **Reset to clean** and **Delete version** work on a version.
- A block whose source changed shows Changed in source and keeps its text until you tap Take the new text.
- **Placement** sends a card in the chat at a depth, as another role, or from a later reply.
- **Add to Compare** sets up to three cards side by side; underlined sentences appear in another compared card.

The cards Roleplay Instructions sends sit in their own group at the end of the request. When you save your own wording in [Setup, Prompts](page:prompts), it goes in as its own card, on, and the shipped card turns off, one tap from back on.

### Check list and conflict check

Under the stack, a check list shows notes found in code, each linking to the cards it names. **Check conflicts** reads the blocks that are on, in send order, and lists contradictions, duplications and overlaps that could make the reply worse, naming both blocks. It changes nothing. **Keep both** marks a pair as seen until either block changes. **Edit the conflict check prompt** holds the prompt Checking blocks for conflicts.

### Folds at the foot

- **Works alongside** lists preset blocks that complement the extension's features.
- **Document view of the working copy** shows the blocks that are on, in send order, as read-only text with macros unexpanded.
- **Regex scripts the preset carries** lists each script, whether it is on, and where it applies.
- **Loadouts** lists saved loadouts with Rename, Update (it writes the stack into the loadout while that loadout is selected) and Delete, which removes the preset file after you confirm.

## Model calls and cost

Only **Check conflicts** calls a model: 1 model call ([how model calls work](help:model-calls)). Its connection is set under Compare preset blocks and extension features in [Setup, Connections](page:settings), and by default it uses the routes of the Tidy job in [Setup, Background jobs](page:background-jobs). A paid route's call counts toward the monthly ceiling in [Setup, Connections, Spend](page:spend). Everything else on the page runs in code.

## Why it works this way

- Any extension feature and any block from any number of presets can be on together. The extension never switches a block off for looking like a duplicate; the conflict check reports, and you choose.
- Opening the page, switching views, comparing and previewing a shortcut leave the stack as it is. Saving your own wording in Setup, Prompts is the one change made without a tap here.
- Your edits are versions that name their source, so the clean block stays one tap away and a change upstream shows.
- A loadout carries a record of its stack, so selecting it is recognized and the stack is never applied twice.
