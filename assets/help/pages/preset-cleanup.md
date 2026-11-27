# Cleanup

Cleanup shrinks the preset list in three steps. It retires presets that are exact copies of a base, merges Evening Truth presets that differ only in their context size, and keeps each retired preset's context size as a model profile on the preset that stays. A model profile sets values such as the context size when you switch to the model it names; see [Setup, Presets](page:presets).

Open it once after importing many presets, or to put the list back from a backup.

## What it does

A status line at the top reports the last step. When the Main API is not Chat Completion, the page says so and shows nothing else.

### 1. Back up

**Back up** (with the number of presets) saves every Chat Completion preset into one file. A copy goes into SillyTavern's user files, read back to check it, and a download starts on this device. The card then shows Backed up and the file name, with **Back up again** and **Download again**. If neither the copy nor the download works, nothing changes.

### 2. Review

**Copies of a base** lists the known copies, out of 14, each with an arrow to its base and both context sizes. A copy has the same prompt blocks and sampler values as its base. A copy marked Retires becomes a model profile on its base; one marked Stays has a note saying why.

**Evening Truth groups** lists each group of Evening Truth presets that match apart from their context size. One preset in each group stays; the others retire and their context sizes become model profiles on it. Every other Evening Truth preset stays as it is.

### 3. Confirm

The confirm button names the work, for example "Retire 3 copies, merge 2 ET groups". It stays off until a backup of the current list exists. Tapping it retires the listed presets and writes their context sizes onto the presets that stay; the status line reports how many retired, how many now carry profiles, and any that could not be deleted.

### Restore a backup

**Restore from a file** reads a backup file you choose. The last five copies saved in SillyTavern's user files are listed too, each with **Restore this copy**. A confirm box first says how many presets would come back or be rewritten. Restoring puts every preset back as the backup holds it, in one step; presets made after the backup stay.

## Model calls and cost

Nothing on this page calls a model; every step runs in code and through SillyTavern's own preset and file saves ([how model calls work](help:model-calls)).

## Why it works this way

- Exact copies and context-size twins add length to the preset list without adding anything to send, so they retire.
- The context size moves into a model profile, so the preset that stays still switches to the right size when the model changes.
- Evening Truth presets that differ in more than context size stay distinct, one per model.
- Nothing changes until you tap the confirm button, and the button waits for a backup, so every change can be undone in one step.
