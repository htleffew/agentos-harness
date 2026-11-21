# Preset blocks and commentator voices

Verified in local SillyTavern with Chromium and a disposable user directory. Generation checks used a local model endpoint that records the assembled messages and returns fixture responses.

## Saved preset and request composition

- Opened the extension, expanded Setup, opened a preset block, edited its instruction, saved, moved it, and restored it. The edited badge appeared after saving. SillyTavern’s active order and text returned to the original values on restore.
- Paired an imported Internal States Template block with Relationships. Sent four ordinary replies and inspected each received request. Both on included both instructions. Preset only included the host wording. Extension only included the relationship update contract. Both off omitted both.
- Added a system block and restored it. The added row disappeared. Set a block to fixed depth 2, priority 42 and swipe-only generation, then read those values from the host and restored the block.
- Requested an AI comparison, counted one model request, inspected the suggested association and accepted it. The new source selector appeared beside the block. The fixture verifies request count, parsing, acceptance and UI behavior. The quality of a live model’s judgment depends on its answer and the supplied excerpts.
- Changed a module’s position using the extension order controls and restored its position. An extension-only position applies within the structured guidance or update contract. In-chat preset blocks use SillyTavern’s native depth and priority.
- Selected the noir detective voice, saved custom wording and found it in the next generation request. Restored that voice independently. The original v9 voice retains both of its samples.

[Interactive regression](../tests/t_preset_workspace.js) · [Existing ownership regression](../tests/t_module_ownership.js)

## Reference preset inventories

Loaded the prompt definitions and prompt orders from the three supplied JSON files into disposable presets. Compared every displayed identifier in order with the corresponding source order and checked that each remaining definition was accessible. Provider settings, regex scripts and narrative quality were outside this inventory check.

| Supplied file | Ordered definitions | Supplied definitions accounted for |
| --- | ---: | ---: |
| Sola V4 Flame | 140 | 142 |
| Tavo Vexa v1.0 | 78 | 78 |
| Deus Ex Machina V4 | 179 | 179 |

## Independent first-use review

A reviewer with no project history started in the chat wand menu, then found the extension through the top Extensions drawer. They selected Cozy gamer, edited its text, switched to Scholar and back, and confirmed both the customized label and the saved text. They paired the native Default preset’s Main Prompt with Live writing guidance and verified the source status after selecting Preset only.

The review found three misleading labels or missing cues. The Random Instructions editor now names its scope. The reader reaction controls now explicitly name the commentator voice, and the display help directs users to the picker. Unmatched blocks now explain that saving a match reveals the source selector. The preset block editor appears directly beneath the workflow selector. Its name describes editing and pairing, and its add and compare actions precede the block list.

## Regression coverage

- The interactive navigation audit opened 22 pages and 220 reachable disclosures at each of 390 px and 1280 px. It exercised workflow switches, memory components, all twelve structured module controls and navigation to contextual editors.
- The preset workspace generation test checked that moving Dialogue colors earlier moved its instruction ahead of the scene checks in the received request.
- A save-failure and concurrency regression checks that a failed host write leaves the original intact, overlapping writes are rejected, restoring one block preserves a neighbor’s edits, and switching presets during a pending save preserves the newly active settings. It also checks that unrelated sampler values, vendor data and the other character’s prompt order survive.
- During verification, the Legacy card run exposed a duplicate local declaration in the preset-manager fallback. Corrected the declaration and checked the syntax of every changed JavaScript file. The independent-restore test also caught an ordering error after restoring a neighboring block. Restoration now considers all surviving neighbors on either side.

[Navigation audit](../tests/t_extension_ui_audit.js) · [Persistence tests](../tests/unit/preset_workbench.mjs)

The voice regression restored the prior commentator selection and checked the host’s saved settings file after its debounced write. This also isolates subsequent Legacy tests that expect the factory Gremlin voice.
