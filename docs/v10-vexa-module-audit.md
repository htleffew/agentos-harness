# Vexa v1.0 and Roleplay Instructions parity audit

This audit uses the attached **[ST] Vexa v1.0** export, the attached **Roleplay Instructions V10** export, and companion preset and extension code at commit `fec7e58` (extension 10.0.7). The attached companion export matches commit `104fdc3`. The newer companion preserves the same name and adds five writing blocks. The findings below describe the audited 10.0.7 release. Release 10.0.8 adds the Memory only workflow and the companion writing blocks listed in the changelog.

The [v10 verification](v10-verification.md) records the later changes to the extension and companion preset and the SillyTavern checks for the agreed design.

The Vexa export has **78 ordered slots**, **71 enabled** and **7 disabled**. Of the enabled slots, **48 contain raw text**. That includes macro and routing material. The enabled flag describes the saved export. It does not establish that every block runs in every request. Marker rows receive host data at assembly time. Character count or number of blocks cannot determine wire cost or prose quality.

The extension substantially covers story storage and selected controls. The clearest missing writing behaviors are decisive and source-faithful NPC portrayal, richer creation of recurring NPCs, a configurable narrative viewpoint, regular-turn length and dialogue balance, specific prose checks, and slow-burn pacing across a set of events. Rendering and motion also differ. The script audit below identifies the exact progressive-reveal gap.

Sources for the companion and extension behavior include the [companion preset](../presets/Roleplay%20Instructions%20V10.json), [module and update code](../src/v10.js), [generation assembly](../src/engine.js), [reply format](../src/reply-format.js), [reply display](../src/ui/sent.js), [progress display](../src/ui/reply-progress.js), [context budget](../src/context-budget.js), and [decision log](v10-vexa-decision-log.md). The assessment describes the source and saved settings. Prior mock-host checks establish selected assembly and persistence behaviors. Side-by-side prose output and TauriTavern behavior remain unverified.

## Every Vexa prompt slot in order

| Slot | Vexa block | Export | Coverage | Companion preset or extension behavior |
| ---: | --- | --- | --- | --- |
| 1 | ━Config | On | Structural | Empty section label for configuration. |
| 2 | DO NOT DISABLE - System Vars | On | Partial | The extension owns module flags, per-chat overrides and typed state. Vexa also initializes macro variables and configures optional template and plugin slots. Its macro/runtime controls have no compatibility layer. |
| 3 | Internal States Themes + Styling | On | Partial | The extension has a fixed cool palette, chips and one tabbed console. Vexa provides multiple theme and style selections through macros and regex CSS. Theme and style switching has no equivalent. |
| 4 | NPC↔NPC Tracking Toggle | Off | Design choice | Vexa's optional switch persists important NPC↔NPC pairs and directional filters as part of each turn. The extension supports brief pair notes for selected relationships. Automatic all-pair tracking was explicitly excluded. |
| 5 | ━System | On | Structural | Empty section label for system prompts. |
| 6 | Rigid Rules | On | Partial | The companion preserves player agency and a clear viewpoint, and the extension handles OOC routing. The Vexa reader persona, explicit knowledge/reader contract, NPC action cadence, and scene-specific authority rules have only broad or no coverage. This mixed block also contains behavior specific to Vexa's presentation and operating modes. |
| 7 | POV | On | Partial | The companion asks for one clear viewpoint and respects what each character can know. Vexa fixes the player as viewpoint, specifies sensory access, limits cutaways, and has explicit narration and sensation person rules. No equivalent POV selector or strict profile ships. |
| 8 | First Turn Init | On | Partial | Opening Setup supports primary and alternative greetings, optional direction, authoring guidance and accepted scene state. Vexa initializes a named cast, matching colors, per-pair state and map routes. The extension assigns colors as it identifies speakers. Pair matrices and Atlas setup were excluded. |
| 9 | Realistic Bold NPCs | On | Partial | Cast, Motives & Voice asks for independent plans, blind spots and recognizable decisions. The extension can supply established traits and scene facets. Vexa additionally asks for characters to act decisively even when fumbling or retreating, keep their own tastes and flaws as intimacy grows, and soften only for concrete, character-specific reasons. A dedicated equivalent is missing. |
| 10 | HQ NPC Creation | On | Partial | The companion gives new NPCs a purpose, identifying detail and voice. The extension can keep accepted portrayal. Vexa explicitly builds a person before demographics and name, with contrasting traits, habits or hobbies, an irritation, a sample line, a private detail, and visually or historically distinctive features. No richer recurring-NPC creation guidance or conditional profile ships. |
| 11 | ━Prose | On | Structural | Empty section label for prose prompts. |
| 12 | Anti-Parrot/Anti-Echo | On | Partial | The companion tells the model to respond to meaning without echo and preserve player agency. Vexa additionally rejects checklist replies, limits what the NPC responds to, and gives a worked example of moving the scene with a fresh action. |
| 13 | Prose Rules | On | Partial | The companion covers concrete prose, sensory detail, varied rhythm and ordinary dialogue. Vexa sets a more specific rhythmic style, readability, typographic emphasis, viewpoint access, comparisons, paragraph form and how far to interpret observable behavior. |
| 14 | NPC Voice | On | Partial | The companion gives a general voice rule and the extension supplies source portrayal and scene facets. Vexa specifies speaker-specific cadence, indirect speech, concealment, the generic-voice test, personal comfort by audience, and how emotion changes delivery while idiolect persists. |
| 15 | Prose Lint Functions | On | Partial | The extension flags exact repeated sentences and malformed legacy speaker lines on demand. Vexa also asks the model to check recent structural repetition, generic speech, chronology, causal knowledge, player-orbiting behavior and stock reactions before writing. Those checks have no equivalent as a model-facing routine. |
| 16 | Banned Vocab | On | Gap | The companion broadly discourages stock body language and ornamental comparisons. No live, editable equivalent lists specific constructions and what to do instead. The extension's authoring tools and repetition diagnostic do not apply a Vexa-like vocabulary policy to normal replies. |
| 17 | Output Length | On | Gap | Vexa targets 400–600 words with 1–2 spotlight NPCs, 500–700 with 3, 600–750 with 4, and 70% dialogue. It says a reply is one portion of a scene. The companion advises leaving a live beat. Opening Setup's 350–650-word target applies to drafted openings. There is no comparable regular-turn length or dialogue balance control. |
| 18 | Combat | On | Design choice | The companion asks for spatially readable action and proportionate consequences. Vexa opts for exaggerated impact, weapon clashes and alternating bursts and pauses. Tactical simulation was excluded. A distinct optional spectacle style has no equivalent. |
| 19 | ━World/Off-Screen | On | Structural | Empty section label for world and off-screen prompts. |
| 20 | Time Header | On | Replacement with differences | The extension renders an HTML header from accepted time, date, location and weather. Vexa requires a visible header every response with exact clock and date, midnight rollover, temperature and routine schedule cues. The extension can leave values unspecified or approximate, and it does not schedule meals and sleep. |
| 21 | World Sim | On | Replacement with differences | The extension offers optional autonomous developments through a chance check and plot eligibility. Random Instructions stay separate. Vexa maps a roll to hostile, mixed and beneficial intensity bands, also considering arc and event anchors. The extension has no equivalent band table. |
| 22 | World Turns | On | Partial | Extension agendas track selected characters, whereabouts, due time and travel constraints. Vexa evaluates the broader cast by elapsed time and checks reasons for actual scene entry, off-screen causality, and information transfer. The extension does not run a full-cast simulation each reply. |
| 23 | ━Aether Family | On | Structural | Empty section label for the Aether mechanics. |
| 24 | Aether Sola | On | Replacement with differences | The extension tracks tenderness, fury, dread and yearning on 0–10 scales with recovery and free-text outward presentation. Vexa uses a shorter scale, temperament baselines, evidence-based deltas and a separate numerical outward dial. |
| 25 | Aether Tide | On | Partial | The extension asks the model to consider mixed feelings and credible sudden shifts. Vexa requires per-target emotional classification, a positive and a friction path, layered emotion labels, and a compound reading. That per-target treatment has no equivalent. |
| 26 | Aether Matrix | On | Design choice | Vexa uses a multi-axis paired relationship matrix with drift and pressures. The agreed extension model uses short dynamics and optional one-sided perspective. |
| 27 | Aether Dam | On | Design choice | Vexa separately models directional emotional and verbal permission, filters and strain. The extension has no paired expression gates. Lightweight relationships were the agreed design. |
| 28 | ━Extras/Enhancements | On | Structural | Empty section label for optional presentation features. |
| 29 | GFX Engine | On | Design choice | Vexa asks for scene-triggered, model-generated HTML/CSS inside prose. The extension uses its own scene header and console. Freeform scene graphics were excluded. |
| 30 | Scene Expression | On | Design choice | Vexa supplies visual sound and impact treatment, dialogue kinetics and paragraph-level rhythm guidance. The companion covers paragraph and sentence rhythm. Kinetic effects and animated dialogue were excluded. |
| 31 | Readable Props | On | Design choice | Vexa can render messages, documents and notices through dedicated tags that the regex bundle styles. The extension leaves readable props in prose or Markdown. |
| 32 | Lore Definitions | On | Design choice | Vexa renders contextual expandable glossary references. The extension recalls World Info for the model and can show which entries were selected for a reply. Inline glossary disclosures in the story were excluded. |
| 33 | ╒══ PICK ONE ══╕ | On | Structural | Empty option-group label for dialogue formatting. |
| 34 | Colored Dialogue + Tone Tags (Regex Required) | On | Replacement with differences | The extension assigns persistent, editable colors locally for naturally attributable speech and italic thoughts. Vexa expects matching color-name tags and applies tone typography. The extension does not implement the tag palette or visual tone effects. |
| 35 | Colored Dialogue (LEGACY - No Regex Required) | Off | Optional alternative | This disabled Vexa alternative requests legacy HTML color markup. The extension's active path colors naturally attributed text in the UI. |
| 36 | ╘══════════════╛ | On | Structural | Empty option-group closing label. |
| 37 | ━Jailbreak | On | Structural | Empty section label for Vexa's provider and adult-mode options. |
| 38 | ╒══ PICK ONE ══╕ | On | Structural | Empty option-group label. |
| 39 | Realism Mode/Jailbreak | Off | Optional alternative | Disabled realism/adult mode with scene behavior and provider-bypass instructions. No matching mode ships. |
| 40 | Freaky Mode/Jailbreak | Off | Optional alternative | Disabled higher-intensity adult mode, related terminology and provider-bypass framing. No matching mode ships. |
| 41 | [Gemini] Freaky Mode/Jailbreak | Off | Optional alternative | Disabled Gemini-specific higher-intensity adult option. No matching provider preset or mode ships. |
| 42 | [Gemini] Realism NSFW/Jailbreak | On | Gap in parity | Enabled Gemini-specific adult realism block combines style rules, intimate-scene guidance and provider-bypass framing. The companion has no matching model-specific mode. The filename and enabled flag do not prove a provider applied it. |
| 43 | ╘══════════════╛ | On | Structural | Empty option-group closing label. |
| 44 | [Argon] Jailbreak (1,099 tokens) | Off | Optional alternative | Disabled Argon provider-targeted block. No matching model adapter ships. |
| 45 | [Carbon] JB (438 tokens) | On | Gap in parity | Enabled Carbon provider-targeted block. No equivalent ships. |
| 46 | ⛓️‍💥 Jailbreak Test ⛓️ | Off | Optional alternative | Disabled test variant for provider bypass. No equivalent ships. |
| 47 | Kinktionary | On | Gap in parity | Enabled specialized terminology and adult-scene guidance. The companion contains no corresponding terminology module. |
| 48 | ━Internal States | On | Structural | Empty section label for Vexa's state and mechanics. |
| 49 | ARC Engine | On | Replacement with differences | The extension stores arcs, milestones, evidence, and prerequisites. Vexa prescribes a four-act Kishōtenketsu shape, attached tracks, resolution rules, and long timing fuses. There is no default four-act structure or parallel track engine in the companion. |
| 50 | Chekhov's Gun | On | Replacement with differences | The extension stores seeds with prerequisite and relevance gates, optional scheduling and evidence-backed completion. Vexa also explicitly scans recent prose for plantable details, uses a recurring discovery/fire cadence and separates its chamber and firing rules. The extension does not run that exact planting routine. |
| 51 | 📒 GM's Notebook | On | Design choice | The extension uses Chat Facts, Plot Records, guidance and chapter summaries. It does not keep a separate typed GM scratchpad with reminder, thread and debug categories. |
| 52 | 🌍 Atlas | On | Design choice | The extension stores locations and travel as facts or agenda data. Vexa maintains connected maps, floors, room geometry, occupants, exits and available routes. Atlas and pathfinding were excluded. |
| 53 | D&D Sim | On | Replacement with differences | The extension rolls a real d20 in code for an explicitly queued action and sends the outcome. Vexa prompts for relevance, skill, fixed difficulty, who rolls, and potentially an NPC check based on knowledge. The extension has no automatic equivalent for opting into those checks from prose intent. |
| 54 | Internal States Template | On | Replacement with differences | The extension asks for one versioned update only when applicable, validates it and files accepted records. Vexa demands a fuller on/off-screen state block every reply, with memories, thoughts, inventories, pair filters, tracks and notes. No full per-reply snapshot parity. |
| 55 | ━Markers | On | Structural | Empty section label for host context markers. |
| 56 | World Info (Before) | On | Host equivalent | The companion keeps the host's World Info (before) marker. The extension can select and record additional relevant lore. |
| 57 | User Persona | On | Host equivalent | The companion keeps the Persona Description marker. |
| 58 | character_card | On | Gap in formatting | Vexa adds an opening character-card wrapper around host card material. The companion uses native card markers directly. |
| 59 | Char Description | On | Host equivalent | Both keep the native Char Description marker. |
| 60 | Char Personality | On | Host equivalent | Both keep the native Char Personality marker. |
| 61 | Scenario | On | Host equivalent | Both keep the native Scenario marker. |
| 62 | /character_card | On | Gap in formatting | Vexa closes the character-card wrapper. The companion uses native card markers directly. |
| 63 | World Info (After) | On | Host equivalent | Both keep World Info (after). |
| 64 | Example Messages | On | Host equivalent | Both keep the example-dialogue marker. |
| 65 | Chat History | On | Host equivalent | Both keep Chat History. The extension also manages the retained history window and chapter summaries. |
| 66 | ━Chain of Thought | On | Structural | Empty section label for the Antithesis prompts. |
| 67 | ╒══ ALL OF THIS IS COT ══╕ | On | Design choice | Vexa introduces its prompting and routing convention in a nonempty section heading. The extension has its own update contract and optional brief outline, with no equivalent visible planning transcript. |
| 68 | Antithesis - Boot | On | Partial | The extension prepares known cast and scene, clock, eligible records and active directives. Vexa's Boot explicitly considers scene entry, urgency, privacy, viewpoint, prior turn, opening state and user directions before routing. Many of those semantic checks are not separate extension behavior. |
| 69 | Antithesis - Mechanics | On | Partial | The extension selects relevant notes and eligible plot opportunities, with optional Roast feedback. Vexa checks its notebook, runs arc and seed routines on its cadence, advances the broader cast and evaluates World Sim as an ordered pass. |
| 70 | Antithesis - Router | On | Partial | The extension separates opening, quiet and guided turns and enabled modules. Vexa routes by first turn, combat, scene entry, solo/ensemble cast and optional plugin hooks. No equivalent route selector by content or spotlight count ships. |
| 71 | Antithesis - Helper Functions | On | Partial | Relevant character knowledge, state constraints and lore handling are in the extension. Vexa adds model-facing helper calls for knowledge access, scene entry and plugin flags. Its fine-grained semantic instructions and hook macros have no direct equivalent. |
| 72 | Antithesis - Pages | On | Partial | The extension sends profiles, cast knowledge, emotional state and relevant relationships. Vexa instructs the model to consider fidelity, knowledge, target, emotional expression and action for each spotlight character. Those prompts are richer and switch with solo versus ensemble routing. |
| 73 | Antithesis - Tail/Output | On | Partial | The companion gives prose and continuity guidance plus optional local diagnostics. Vexa explicitly preflights timeline, tempo, user-orbiting, originality, formatting, physical detail and prose entry/exit. No equivalent compact model-facing checklist ships. |
| 74 | ╘═════════════════╛ | On | Structural | Empty option-group closing label. |
| 75 | Gemini Pacing Nerf | On | Partial | The companion supports lingering in consequential moments and skipping routine. Vexa's Gemini pacing block specifically asks for playable everyday life, spaced-out planned events, pauses after milestones and avoidance of circular filler. The extension clock can constrain eligibility. There is no optional model-specific guidance with this depth. |
| 76 | 🎭 Card Fidelity 🃏 | On | Partial | The extension merges card examples, portrayal and protected edits. Vexa additionally defines how to restore lost quirks, carry the source's thought style, preserve awkwardness, distinguish comfort by audience and pace development through exceptions. That specificity is still missing from our prompt. |
| 77 | [Argon/Carbon] Braille JB | On | Gap in parity | Enabled additional Argon/Carbon provider-targeted framing. No equivalent ships. |
| 78 | Dice Rolls | On | Replacement with differences | Vexa consumes separate frontend dice and world simulation macro values. The extension resolves queued checks in code, sends a compact outcome and runs autonomous event chance separately. No shared roll-bundle contract. |

## Antithesis execution and dependencies

Slots 68–73 are six enabled **user-role depth-0 prompts**. Slot 67 is their enabled relative system heading and contains the author's routing rationale. Boot describes a forward-only route with calls to helper functions. Its requested artifact is a multi-page pre-prose planning sequence. This describes text the preset asks the model to generate. Some models or hosts may handle the surrounding wrappers differently. The attached export alone cannot establish what a provider returns in a separate reasoning field.

### Main route

| Page | What the prompt asks the model to do | Companion or extension coverage |
| --- | --- | --- |
| Boot, slot 68 | Establish the reader persona and recent activity. Form an optional pre-turn wish or critique. Collect turn count, location, time, nearest beat, privacy, crowd, urgency and POV. Define viewpoint and reader knowledge. Choose a one-line pulse and preserve action sequence. Review arc spoilers and drift, last state, and whether the previous reply merely reacted. Set scene-entry, off-screen message, target and content flags. Handle OOC. | The extension supplies accepted scene, clock, cast and relevant records. It does not calculate all these flags or request a pulse, prose initiative check, reader reaction, or explicit sequence of boot checks. |
| Mechanics, slot 69 | Recall notebook and story notes. Check for a payoff every third turn and scan the last turn for a new plant. Consider arc and parallel tracks, revisit the last critique, advance both present and off-screen NPCs, and run one world-simulation pass. | Relevance selection, gates, optional event scheduling, selective agendas, actual dice, and opt-in Roast feedback. No matching cadence, all-cast evaluation, required arc/track review, or ordered model mechanics pass. |
| Router, slot 70 | Count spotlight NPCs. Dispatch first-turn, combat, and the selected adult-mode function where applicable. Initialize missing state and run entry handling separately. Consult plugin hooks, then route to Solo for 0–1 spotlight NPCs or Ensemble for 2+. | The extension branches by generation type, enabled modules and available data. No genre- or cast-size-based branch, automatic Vexa-style initialization, or external route hooks. |
| Solo and Ensemble, slot 72 | For each spotlight NPC, check card fidelity, identity, habitual speech, prior feeling and evidence for knowledge. Identify conversation targets. For each target, consider feelings and actions, and whether the NPC initiates. Ensemble additionally requires an NPC-to-NPC exchange. | Effective profiles, individual knowledge records, short relationship notes and overall emotion axes inform the turn. No mandatory per-NPC or per-target pass and no required side conversation. |
| Tail, slot 73 | Run the 20 ordered checks summarized below before writing the scene. | Local validation covers structured updates and a small number of mechanical prose flags. General writing guidance covers some of the other goals without running a dedicated check. |
| Aux and Output, slot 73 | Finish any remaining preparation, start with the time header, write the scene within the requested format, and append a full Internal States block. | Optional short outline, HTML scene header rendered by the extension, and selective v2 story updates. This substitutes a different format and update policy. |

### Helpers supplied by Antithesis and its other prompts

| Helper or prompt | Behavior and current coverage |
| --- | --- |
| Plugin flags and hooks, slots 2 and 71 | System Vars resets five hook slots, five flags, and optional template, arc, and dice slots. The router calls the hook checker. The export declares the flag helper. No enabled preset block populates the five hook slots beyond the defaults. Effects from external AetherKit configuration are outside the attachment. Roleplay Instructions has no corresponding plugin dispatch. |
| Scene entry, slots 70–71 and 52 | Resolve saved map and floor, promote a known room into the rendered view, fill missing adjacent areas through Atlas, and encounter NPCs mid-activity with a reason for paying attention. The extension can carry locations, scene boundaries and agendas. It lacks the entry procedure and Atlas routing. |
| Anchors, slot 71 | Pick exact opening and closing lines and the key moment before generating prose. The companion asks for a live opening and closing beat. It neither requests exact anchors nor checks reuse of recent openings. |
| Anti-sycophancy helper, slot 71 | Check if NPCs revolve around the player, whether someone else should handle an action, who could leave, and whether the scene still works without the player. The companion gives supporting characters independent plans. The explicit scene-level checks and Ensemble's required NPC-to-NPC interaction are missing. |
| Gossip, slots 21 and 71 | World Sim describes optional rumor planting and spread. Helpers specify aging, witness sets, location or relationship-based spread, triggers, and eventual memory or seed updates. Roleplay Instructions can store a rumor and who knows it, but has no propagation simulation. World Sim also names a message-reaction helper. The export supplies no definition under that name. |
| ARC and Chekhov, slots 49–50 | Arc generation, spoiler check, self-correction, parallel tracks, seed scan and firing are callable helpers. The extension provides gates, optional scheduling, stable records and completion evidence. It lacks the four-act story engine, spoiler/drift routine and the requested discovery cadence. |
| World and dice, slots 21–22, 53 and 78 | World Turns defines agenda advancement, pathfinding and an off-screen review. World Sim and D&D Sim populate macro values that Dice Rolls consumes. The extension advances selected records when established and calculates queued checks. The source export describes the macro wiring. It does not prove fairness or identical host execution. |
| Character fidelity, emotions, and axes, slots 25–27 and 76 | Aether Tide supplies per-target emotion and fidelity helpers. Matrix and Dam specify relationship actions and expression gates. Card Fidelity adds a separate depth-0 instruction on source precedence, quirks, thought style, awkwardness, and change. The extension gives some of the data to the model, with no equivalent behavior pass. |

### Tail checks, one by one

| Step | Vexa check | Current coverage |
| ---: | --- | --- |
| 1 | Structure, length, dialogue balance, and where the beat stops | General scene pacing. No regular-turn range, dialogue share, or structure check. |
| 2 | Timeline, paths by which NPCs learned things, and travel | Accepted clock, evidence checks, scoped knowledge and travel constraints. No semantic audit of every prose claim. |
| 3 | Player-orbiting and NPC agency | General independent motives. No scene-level anti-sycophancy pass. |
| 4 | State presence, selected changes, and continuity | Optional v2 update with validation and one possible repair in a later ordinary reply. No required complete snapshot. |
| 5 | Generic prose habits and lazy characterization shortcuts | Broad prose guidance and exact-repeat flags. No equivalent semantic check. |
| 6 | Check broader cast and off-screen progress | Relevant or due agendas only. |
| 7 | Exact opening line, key moment, and closing line | Guidance for a live beat. No mandated anchors. |
| 8 | Review prior violations and avoid repeating narrative structure | Exact repeated sentences and malformed legacy speaker lines. No equivalent prior-turn review. |
| 9 | Register and emotional tone | General editorial guidance. No separate tone check. |
| 10 | Concrete physical detail and recent continuity | General sensory guidance and accepted location/time data. No matching checklist. |
| 11 | A singled-out vocabulary exclusion | No default equivalent. |
| 12 | Wider banned constructions | Broad anti-stock-language guidance and optional legacy word diagnostics. No shipped live Vexa list or replacement examples. |
| 13 | Decide whether a graphic fits, vary its style and preserve viewpoint | Inline generated graphics were excluded. The extension renders its own UI. |
| 14 | Resist ending a beat due to discomfort and allow parallel tracks | General lingering guidance. No equivalent anti-resolution routine or parallel-track engine. |
| 15 | Reassert the requested prose style | Companion prose blocks and live guidance cover some of the intent. No separate last-minute recheck. |
| 16 | Name two expected state changes and check Atlas references | The extension records changes the prose establishes. No change quota or Atlas. |
| 17 | Confirm speaker colors and tone effects | The extension assigns color locally. It has no visual tone tag path. |
| 18 | Reconsider an easy plot shortcut | No dedicated model instruction to reconsider a shortcut. |
| 19 | Check whether recent replies habitually end on questions | The companion discourages formulaic endings and allows a genuine in-world question. No recent-ending check. |
| 20 | Detect repeated graphics style | Inline graphics were excluded. |

### Realism, adult-mode toggles, and neighboring blocks

Vexa has several kinds of realism guidance. **Rigid Rules**, **Realistic Bold NPCs**, **POV**, **NPC Voice**, **Card Fidelity**, and **Gemini Pacing Nerf** are independently enabled in this export. The adult-mode switches below change a specific scene route as well as adding their own guidance. Enabling a named preset block is separate from selecting a provider or model.

| Slot | Export setting | Role and dependency |
| ---: | --- | --- |
| 2 | System Vars on | Resets the shared adult-mode dispatch slot. |
| 39 | Realism Mode off | Relative system block. Sets the scene dispatch and defines an intimacy function for grounded pacing, credible reactions, agency, and consequences. References a realism variable with no populated value elsewhere in the attached preset. |
| 40 | Freaky Mode off | Depth-0 system block. Sets the same dispatch and defines a more heightened alternative with its own scene instructions and terminology. |
| 41 | Gemini Freaky off | Relative system block. Defines the heightened alternative with Gemini-specific framing and sets the same shared dispatch. |
| 42 | Gemini Realism on | Relative system block. Defines the grounded alternative and sets that shared dispatch. The Router calls its selected helper when the scene invokes the corresponding content route. |
| 44–46 | Argon off, Carbon on, test block off | Separate provider-targeted and test prompts. They are distinct from the four switches that write the shared dispatch slot. |
| 47 | Kinktionary on | Separate user-role depth-0 glossary and scene guidance. Enabled independently of the realism and provider blocks. |
| 70 | Router on | Reads the dispatch slot at depth 0. The four modes write the same slot and define the same helper name. Enabling several can create competing instructions. The final variable value would depend on host assembly and macro evaluation. |
| 75–77 | Gemini pacing, Card Fidelity, and Argon/Carbon helper on | Additional depth-0 system blocks. Pacing and source fidelity are separate behavioral layers. The Argon/Carbon helper is provider-targeted and does not control the shared scene dispatch. |

The companion has general realism, player-agency, prose and recovery guidance, and the extension has scoped writing guidance. There is no corresponding Realism/Freaky selector, automatic scene dispatch, provider-specific bundle, or terminology module. For a design decision, isolate the portable writing goals such as physical continuity, grounded reactions, earned changes in behavior, and pacing from any provider-specific framing.

### What happens if the planning text appears in a reply

The companion can optionally request a short `<reply_plan>`. This is authored output in the ordinary reply, and **Show Reply planning** controls the collapsed disclosure. The paired parser also recognizes some Vexa-style page tags and bare `IDENTITY:` starts. This is display and history handling. It neither executes the Antithesis route nor imports Vexa's state into the extension's v2 records.

Synthetic probes against the paired parser at the audited commit show four concrete results.

- A simple tagged plan or a blank-line-delimited bare `IDENTITY:` list is separated from the next prose paragraph.
- A literal `<think>` wrapper surrounding recognized page tags can remain in editable prose as empty tags.
- An unclosed auxiliary page followed immediately by prose can swallow that prose into the planning disclosure.
- Recognized Vexa state tags are removed from prose. The parser does not convert their contents to canonical story records. A v2 story update is passed through to the existing v2 reader.

The Vexa export also bundles a regex that looks for the Boot-to-Output prefix across display and prompt paths, plus separate scripts for pruning old state and commentary. A regex match is evidence of intended cleanup, with actual coverage dependent on the emitted format. No live provider reasoning or host rendering was inspected for this audit. [Paired parser](../src/reply-format.js)

## Rendering, animations and prompt cleanup

All 143 regex scripts in the attached Vexa export are enabled in the export. Several run for display only, while others change the carried prompt at selected depths. The current companion ships zero regex scripts. Some of their jobs are handled by extension code and others have no counterpart.

| Vexa script positions | Feature | Result |
| --- | --- | --- |
| 1,97 | Prompt cleanup | Vexa removes older internal state blocks from prompt history at its configured depth. The extension removes its own update from editable text, stores accepted changes, and selects relevant records for later prompts. |
| 2 | Display transform | Vexa includes a display deobfuscation pass. The companion exports no corresponding script or transformation. |
| 3,6,8,9,95,128,142,143 | Console framing and styles | Vexa normalizes state markup, builds the shell, binds navigation identity, defaults to collapsed, cleans codeblock artifacts, and applies optional and deferred styles. The extension renders its own collapsed tabbed shell, snapshot controls and palette. Multiple Vexa themes and style profiles are absent. |
| 4-5 | Streaming reveal and motion | Vexa detects completed state tags and updates individual section indicators with motion. The extension tracks actual Context, Prose, Update, and Saved phases and honors reduced motion. Section-by-section live reveal is missing. |
| 7,84,86,89,91,93-94,96,98-106 | Palette and voice rendering | Vexa resolves named palette tags and their colors. The extension assigns and edits persistent speaker colors locally and can color attributable thoughts. It has a separate palette and rendering path. |
| 10,17-57 | Atlas and locations | Vexa renders maps, floors, layouts, positioning, markers, navigation and popouts. The extension presents the accepted current location and stores location facts. A map renderer was excluded. |
| 11-16 | World, on-screen and off-screen tabs | Vexa renders dedicated world and cast panels, including off-screen agendas and color dots. The extension presents scene and character snapshots, with selected plot records. Off-screen roles do not receive equivalent live panels. |
| 58-63 | Entity memory, entity state and thoughts | Vexa has dedicated tabs and entry rendering for each. The extension uses branch facts, character knowledge and selected character snapshots, with locally styled prose thoughts. There is no equivalent standalone thought inventory or memory tab. |
| 64-68 | Directional expression and pairs | Vexa renders expression filters and per-pair scores. The extension shows short relationship notes. Matrix and filter displays were excluded. |
| 69-74,83,85,87-88,90,92 | Tracks, arcs and Chekhov records | Vexa shows track history, arc beats, fallback beats and chambered plot details. The extension shows its plot audit, record status, prerequisites and outcomes. Dedicated tracks and arc-stage panels are absent. |
| 75-80 | Inventory, notes and notebook | Vexa renders independent inventory, notes and notebook lists. The extension stores significant items and notes as normal facts and plot records. Dedicated views were excluded. |
| 81-82,122 | Vent | Vexa shows a dedicated Vent section and processes it separately for the prompt. The extension offers a collapsed Roast card and a separate opt-in for sending recent feedback. |
| 107-119,129-132 | Tone and kinetic typography | Vexa has named tone styles, standalone tone spans, and animated stretch, heavy, echo and fracture effects. The extension colors attributable speech and preserves italics. Tone and kinetic typography were excluded. |
| 120 | Planning cleanup | Vexa strips its planning-page sequence from display and prompt paths. The companion asks to start at prose by default. Its reply-format parser separates optional outlines and recognized prelude markup from prose. |
| 121 | Graphics cleanup | Vexa strips older matched graphics from prompt history. The extension creates its own cards as UI, separate from message text. The paired design does not use generated interstitial graphics. |
| 123-127 | Structured prompt pruning | Vexa trims fired seeds, caps chamber and per-character memory, and orders and caps notebook entries. The extension selects relevant evidence-backed records within a bounded turn packet. It does not emulate Vexa's per-section prune rules. |
| 133-141 | Props and lore rendering | Vexa renders multiple message and document styles, inline lore disclosures, and dialogue/paragraph continuity around those tags. The extension uses ordinary prose and Markdown and provides an independent World Info selection receipt. |

The practical animation difference is visible inside the loading card. Vexa's **Streaming Guard** detects which state subsections have closed. **Streaming Motion** animates those section indicators. Roleplay Instructions lights global generation milestones and then shows the accepted console. It has no animation that responds separately to the arrival of the scene, cast, or plot data. That work belongs in the extension's streamed-reply renderer and can use the same generation request.

<details>
<summary>All 143 regex scripts in export order</summary>

| Position | Script | Scope in this export | Feature |
| ---: | --- | --- | --- |
| 1 | Internal States Prompt Cleaner (depth @ 3) | Prompt | Prompt cleanup |
| 2 | ShieldGemma deobfuscation | Display | Display transform |
| 3 | 00 - Normalize State Tag Spacing | Display | Console framing and styles |
| 4 | 01 - Streaming Guard | Display | Streaming reveal and motion |
| 5 | 02 - Streaming Motion | Display | Streaming reveal and motion |
| 6 | 03 - Wrapper | Display | Console framing and styles |
| 7 | 69a - Resolve Custom Palette Early | Display | Palette and voice rendering |
| 8 | 05 - Voice: Tag Close | Display | Console framing and styles |
| 9 | Bind console navigation identity | Display | Console framing and styles |
| 10 | 05a - Maps - User Position | Display | Atlas and locations |
| 11 | 06 - Tabs - World | Display | World, on-screen and off-screen tabs |
| 12 | 07 - Tabs - On-Screen | Display | World, on-screen and off-screen tabs |
| 13 | 08 - Contents - On-Screen | Display | World, on-screen and off-screen tabs |
| 14 | 09 - Tabs - Off-Screen | Display | World, on-screen and off-screen tabs |
| 15 | 10 - Contents - Off-Screen | Display | World, on-screen and off-screen tabs |
| 16 | 10 - Off-Screen - Identity Dot Colors | Display | World, on-screen and off-screen tabs |
| 17 | 10a - Tabs - Locations | Display | Atlas and locations |
| 18 | 10a1 - Atlas - Active Map | Display | Atlas and locations |
| 19 | 10a2 - Atlas - Active Floor | Display | Atlas and locations |
| 20 | 10a3 - Atlas - Registry Controls | Display | Atlas and locations |
| 21 | 10a4 - Atlas - Map Panels | Display | Atlas and locations |
| 22 | 10a5 - Atlas - Map Options | Display | Atlas and locations |
| 23 | 10a6 - Atlas - Floor Panels | Display | Atlas and locations |
| 24 | 10a7 - Atlas - Floor Options | Display | Atlas and locations |
| 25 | Atlas - Select floor records | Display | Atlas and locations |
| 26 | 10a8 - Atlas - Positioned Rooms | Display | Atlas and locations |
| 27 | 10a9 - Atlas - Unscaled Rooms | Display | Atlas and locations |
| 28 | 10a9b - Atlas - Occupant Markers | Display | Atlas and locations |
| 29 | 10a9b1 - Atlas - Roster Object Sources | Display | Atlas and locations |
| 30 | 10a10 - Atlas - Filter Other Floors | Display | Atlas and locations |
| 31 | 10a11 - Atlas - Room References | Display | Atlas and locations |
| 32 | 10a12 - Atlas - Registered References | Display | Atlas and locations |
| 33 | 10a13 - Atlas - Consume Sources | Display | Atlas and locations |
| 34 | 10a14 - Atlas - Invalid Registry Text | Display | Atlas and locations |
| 35 | 10a15 - Atlas - Registry Text Fields | Display | Atlas and locations |
| 36 | 10a16 - Atlas - Unwrap Pipeline Markers | Display | Atlas and locations |
| 37 | 10a17 - Atlas - Popout Identifier | Display | Atlas and locations |
| 38 | 10a18 - Atlas - Native Popout | Display | Atlas and locations |
| 39 | 10a1 - Locations - Filter Rendered List | Display | Atlas and locations |
| 40 | 10a2 - Locations - Filter Loaded List | Display | Atlas and locations |
| 41 | 10b - Contents - Locations | Display | Atlas and locations |
| 42 | 10b1 - Contents - Loaded Locations | Display | Atlas and locations |
| 43 | 10b2 - Locations - Blueprint Dimensions | Display | Atlas and locations |
| 44 | 10b3 - Locations - Room Popout Identifier | Display | Atlas and locations |
| 45 | 10b4 - Locations - Native Room Popout | Display | Atlas and locations |
| 46 | 10b5 - Atlas - Open Room Maps | Display | Atlas and locations |
| 47 | 10a9c - Atlas - Object Tokens | Display | Atlas and locations |
| 48 | 10a9d - Atlas - Wall Footprints | Display | Atlas and locations |
| 49 | 10a9e - Atlas - Object Sources | Display | Atlas and locations |
| 50 | 10c - Locations - Compass | Display | Atlas and locations |
| 51 | 10d0 - Locations - Empty Occupants | Display | Atlas and locations |
| 52 | 10d1 - Locations - Parse Occupants | Display | Atlas and locations |
| 53 | 10d1a - Maps - User Marker | Display | Atlas and locations |
| 54 | 10d2 - Locations - Occupant Identity Colors | Display | Atlas and locations |
| 55 | 10d3 - Locations - Exit Origins | Display | Atlas and locations |
| 56 | 10d4 - Locations - Doorway Markers | Display | Atlas and locations |
| 57 | 10d5 - Atlas - Main Exit Marker | Display | Atlas and locations |
| 58 | 12 - Tabs - Entity Memory | Display | Entity memory, entity state and thoughts |
| 59 | 14 - Contents - Entity Memory | Display | Entity memory, entity state and thoughts |
| 60 | 15 - Entries - Entity Memory | Display | Entity memory, entity state and thoughts |
| 61 | 16 - Tabs - Entity State | Display | Entity memory, entity state and thoughts |
| 62 | 18 - Contents - Entity State | Display | Entity memory, entity state and thoughts |
| 63 | 19 - Tabs - Thoughts | Display | Entity memory, entity state and thoughts |
| 64 | 21 - Contents - Thoughts | Display | Directional expression and pairs |
| 65 | 22 - Tabs - Dam | Display | Directional expression and pairs |
| 66 | 24 - Contents - Dam | Display | Directional expression and pairs |
| 67 | 25 - Tabs - Pair | Display | Directional expression and pairs |
| 68 | 27 - Contents - Pair | Display | Directional expression and pairs |
| 69 | 31 - Tabs - Tracks | Display | Tracks, arcs and Chekhov records |
| 70 | 33 - Contents - Tracks | Display | Tracks, arcs and Chekhov records |
| 71 | 34 - Tabs - ARC | Display | Tracks, arcs and Chekhov records |
| 72 | 36 - Contents - Arc | Display | Tracks, arcs and Chekhov records |
| 73 | 37 - Tabs - Chekhov | Display | Tracks, arcs and Chekhov records |
| 74 | 39 - Contents - Chekhov | Display | Tracks, arcs and Chekhov records |
| 75 | 40 - Tabs - Inv | Display | Inventory, notes and notebook |
| 76 | 42 - Contents - Inventory | Display | Inventory, notes and notebook |
| 77 | 43 - Tabs - Story Notes | Display | Inventory, notes and notebook |
| 78 | 45 - Contents - Story Notes | Display | Inventory, notes and notebook |
| 79 | 46 - Tabs - Notebook | Display | Inventory, notes and notebook |
| 80 | 48 - Contents - Notebook Entry | Display | Inventory, notes and notebook |
| 81 | 49 - Tabs - Vent | Display | Vent |
| 82 | 51 - Contents - Vent | Display | Vent |
| 83 | 55 - Entries - Tracks | Display | Tracks, arcs and Chekhov records |
| 84 | 11 - Voice: Cornflower | Display | Palette and voice rendering |
| 85 | 57 - History - Tracks | Display | Tracks, arcs and Chekhov records |
| 86 | 13 - Voice: Marigold | Display | Palette and voice rendering |
| 87 | 59 - Beats - Arc | Display | Tracks, arcs and Chekhov records |
| 88 | 61 - Bullets - Chekhov | Display | Tracks, arcs and Chekhov records |
| 89 | 17 - Voice: Jade | Display | Palette and voice rendering |
| 90 | 63 - Current Beat - Arc | Display | Tracks, arcs and Chekhov records |
| 91 | 20 - Voice: Orchid | Display | Palette and voice rendering |
| 92 | 65 - Fallback Beats - Arc | Display | Tracks, arcs and Chekhov records |
| 93 | 23 - Voice: Rust | Display | Palette and voice rendering |
| 94 | 26 - Voice: Citrine | Display | Palette and voice rendering |
| 95 | 70 - Default Collapse | Display | Console framing and styles |
| 96 | 29 - Voice: Lilac | Display | Palette and voice rendering |
| 97 | 71 - Internal States Prompt Cleaner | Prompt | Prompt cleanup |
| 98 | 32 - Voice: Seafoam | Display | Palette and voice rendering |
| 99 | 35 - Voice: Peach | Display | Palette and voice rendering |
| 100 | 38 - Voice: Coral | Display | Palette and voice rendering |
| 101 | 41 - Voice: Matcha | Display | Palette and voice rendering |
| 102 | 44 - Voice: Electric | Display | Palette and voice rendering |
| 103 | 47 - Voice: Periwinkle | Display | Palette and voice rendering |
| 104 | 50 - Voice: Fuchsia | Display | Palette and voice rendering |
| 105 | 52 - Voice: Mint | Display | Palette and voice rendering |
| 106 | 54 - Voice: Blush | Display | Palette and voice rendering |
| 107 | 56 - Tone: Whisper | Display | Tone and kinetic typography |
| 108 | 58 - Tone: Tremble | Display | Tone and kinetic typography |
| 109 | 60 - Tone: Bite | Display | Tone and kinetic typography |
| 110 | Vexa - Kinetic Voice heavy | Display | Tone and kinetic typography |
| 111 | Vexa - Kinetic Voice stretch | Display | Tone and kinetic typography |
| 112 | Vexa - Kinetic Voice echo | Display | Tone and kinetic typography |
| 113 | Vexa - Kinetic Voice fracture | Display | Tone and kinetic typography |
| 114 | 62 - Tone: Steady & Default | Display | Tone and kinetic typography |
| 115 | 64 - Tone: Standalone Whisper | Display | Tone and kinetic typography |
| 116 | 66 - Tone: Standalone Tremble | Display | Tone and kinetic typography |
| 117 | 67 - Tone: Standalone Bite | Display | Tone and kinetic typography |
| 118 | 68 - Tone: Standalone Steady | Display | Tone and kinetic typography |
| 119 | 69 - Tone: Standalone Tag Close | Display | Tone and kinetic typography |
| 120 | FrankenSIM Force Reasoning Delete | Display and prompt | Planning cleanup |
| 121 | FF5 - GFX Stripper | Prompt | Graphics cleanup |
| 122 | Vent prompt cleaner | Prompt | Vent |
| 123 | Chekhov - Clear Fired (depth 0) | Prompt | Structured prompt pruning |
| 124 | Chekhov - Cap Chamber | Prompt | Structured prompt pruning |
| 125 | Notebook - Order R T D | Prompt | Structured prompt pruning |
| 126 | Notebook - Cap Entries | Prompt | Structured prompt pruning |
| 127 | Entity Memory - Cap Per Character | Prompt | Structured prompt pruning |
| 128 | Old Codeblock Cleaner | Display | Console framing and styles |
| 129 | Vexa - Kinetic Standalone heavy | Display | Tone and kinetic typography |
| 130 | Vexa - Kinetic Standalone stretch | Display | Tone and kinetic typography |
| 131 | Vexa - Kinetic Standalone echo | Display | Tone and kinetic typography |
| 132 | Vexa - Kinetic Standalone fracture | Display | Tone and kinetic typography |
| 133 | Vexa - Prop Message | Display | Props and lore rendering |
| 134 | Vexa - Prop sms | Display | Props and lore rendering |
| 135 | Vexa - Prop discord | Display | Props and lore rendering |
| 136 | Vexa - Prop parchment | Display | Props and lore rendering |
| 137 | Vexa - Prop terminal | Display | Props and lore rendering |
| 138 | Vexa - Prop notification | Display | Props and lore rendering |
| 139 | Vexa - Lore Disclosure | Display | Props and lore rendering |
| 140 | Vexa - Lore Dialogue Continuity | Display | Props and lore rendering |
| 141 | Vexa - Lore Paragraph Island | Display | Props and lore rendering |
| 142 | Vexa HUD - Optional CSS companion | Display | Console framing and styles |
| 143 | 69 - Deferred Wrapper Styles | Display | Console framing and styles |

</details>

## Host settings and request order

Vexa exports streaming, model sampling settings, a 128,000-token context setting, a 90,978-token output setting, host nudge and prefill fields, and multiple prompts positioned at or near the active turn. The companion exports a prompt layout and lets host or connection settings govern sampling, limits and streaming. The extension can add current story guidance, but the tested presence of that guidance does not recreate Vexa's order or prompt weights. Compare the two presets with the same model, connection settings, character card, lore and recent history when evaluating prose.

## What preset recognition actually covers

Setup can preview the host's configured prompt blocks. Ownership recognition has a narrower scope. It uses known block names, not a reading of their instruction text. The extension currently recognizes Vexa's **Prose Rules**, **D&D Sim**, **Dice Rolls**, **World Sim**, **Internal States Template**, and the two **Colored Dialogue** block names. A single match can affect several extension modules. For example, **Internal States Template** affects state, knowledge, emotions, relationships and plots. **Realistic Bold NPCs**, **HQ NPC Creation**, **NPC Voice**, **Prose Lint Functions**, **Banned Vocab**, **Output Length**, **World Turns**, **Card Fidelity** and **Gemini Pacing Nerf** are outside that name list. Pairing the full Vexa preset with the extension can therefore leave overlap that Setup does not flag automatically. [Ownership code](../src/v10.js#L55)

## Where the missing behaviors belong

| Behavior | Implementation surface |
| --- | --- |
| Bold, source-faithful NPC actions, audience-specific voice, earned softening, and fidelity to flaws | An editable companion prompt. The extension already supplies source portrayal and current facets. |
| Richer creation for a new recurring NPC | Conditional same-reply writing guidance. Save only the useful details the reply establishes into existing portrayal fields. |
| Viewpoint, turn length, dialogue balance, pacing and grounded versus heightened action | Editable companion controls or prompt profiles. Keep opening and regular-turn targets separate. |
| Semantic quality checks | Short instructions in the normal generation for knowledge access, voice, recurring reply shape, and continuity. Mechanical word count or repeated text can be checked locally. |
| Section-by-section streaming reveal | The extension's renderer. Show a section preview once parseable and visually mark accepted content after validation. |
| Chosen differences such as lightweight relationships, selective memory and plain-text props | Keep the decisions in the log. Reopen each individually if desired. |
