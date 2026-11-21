# Quick actions and guided turns verification

The fresh checkout of `roleplay-instructions-v10` resolved to `ccd863a870609b667f3cf88a3cfadeb8a25171e0`. Git verified the handoff bundle against that prerequisite. The imported ref resolved to `3daacf917647be0d87e07bb3e26ec12d9f179167` before work started on `feature/quick-replies-guided-turns`.

## Evidence environments

| Environment | Evidence |
| --- | --- |
| Real host, emulated phone | SillyTavern 1.19.0 at `7e8663cd9c184a550b37238218bdd32c6efc68e9`, Chromium 156, touch input, 320–390 CSS px portrait. Test runs named below used one active preset. Integrated Quick actions, catalog, staged-memory, and screening runs disabled all bundled extensions. The mock received the real request after host prompt assembly. |
| Reduced visual viewport | Chromium viewport changes to 360–530 CSS px height with a form field focused. This covers reflow and the reachable touch targets. |
| Local host API fixture | Node tests exercise isolated serialized settings, chat metadata, version identities, book writes and request surfaces, including interrupted acknowledgments. |
| Physical phone and native webview | Unverified. No physical device, TauriTavern webview or native software keyboard was attached. |
| Live provider | Unverified. The environment exposed no configured live model connection. Mock responses cover transport, parsing, request content and state changes. Provider cache counters and live prose quality remain open. |
| Import files | Synthetic native books and a 23-entry Keel fixture based on the source inventory. The attached bundle supplied Git history. The original source JSON files were unavailable. |

## Test results

| Checkout and suite | Result |
| --- | --- |
| Pinned GitHub baseline unit command | 21 passed. |
| Pinned GitHub baseline host runs | Guided, history, corrections, native preset, reply cards, chapter and branch passed. The older panel audit timed out while revisiting a disclosure that re-rendered. |
| Integrated unit command | 55 passed, including the origin-draft, one-attempt dispatcher, staged filing interruption and prose evidence fixtures. |
| Integrated host request tests | Quick actions, guided turns and prose diagnostics passed on Default and companion. The two-card group swipe, catalog touch, staged memory, preset variations and native preset workspace passed on isolated host fixtures. |
| Existing host regressions | Guided swipes, historical edit/branch, corrections, reply cards, prompt editors, native preset controls, chapter, branch, context and memory passed. The native preset test passed on a clean dedicated fixture. A previously reused host timed out in the parity UI. |

Run `node --test tests/unit/*.mjs tests/unit/*.cjs` and the suites in the host setup instructions. Browser fixtures use their own loopback provider. [Host test setup](../tests/README.md)

## Request and state observations

- Local library authoring, browse, roll, exact source selection, import review, restore, pin changes and fact audit use code. The touch catalog test observed zero generation requests through a native file input, JSON download, and Keel inspection. It found one visible launcher and two automatic hooks. Only explicitly chosen translations became actions. [Catalog touch test](../tests/t_quick_action_catalog.js) · [Keel fixture](../tests/fixtures/quick-action-keel.cjs)
- Next-message delivery uses the ordinary request after the host assembles Chat Completion messages. The accepted request includes the current private instruction and visible OOC once. Visible OOC stays on its outgoing player message. The next captured request excludes both expired directions. Helper paths use their own input builders. [Integrated test](../tests/t_quick_actions.js) · [Default captures](audit-evidence-quick-actions/default.json) · [Companion captures](audit-evidence-quick-actions/companion.json)
- Native swipe and continuation use the ordinary host routes on supported latest replies. Older targets and unsupported native swipes use a disclosed, bounded helper. C1–C5 cover one native impersonation, one three-choice helper, a Fresh start swipe with early prose removed, exact continuation with Undo, and a Text Completion attempt with earlier prose retained. C6 covers selectable historical versions with later prose preserved. C7 captures explicit direct-helper recovery with the readable preset base and a preserved unsent slash command. The Text Completion tokenizer route has a separate encoder request outside the model generation count. [Guided route test](../tests/t_guided_quick_turns.js) · [Route captures](audit-evidence-quick-actions/guided-routes.json) · [Group touch test](../tests/t_guided_quick_group.js)
- Stable preset and persona material remains in the host's order on ordinary requests. Changing direction, output checks or story context changes the tail. Fresh start can remove identifiable older narrative turns after host assembly and adds explicit current context at the tail. Direct player requests keep the standing prompt separate from their scene, fragment and direction. Screening request pairs preserve 13 assembled prefix messages on Default and 23 on the companion after earlier revision changes are accounted for. The mock exposes no cache usage metrics. [Default screening captures](audit-evidence-quick-actions/prose-diagnostics.json) · [Companion screening captures](audit-evidence-quick-actions/prose-diagnostics-companion.json)
- Staging left the first accepted fact out of the physical book until reply 7. The real host had 19 filed replies at acceptance 25 and 20 at acceptance 26. D-ST-H1-26 was the first summary request. It covered 1–20, excluded 21–26, hid 22 covered messages after persistence, and kept the newest 30 messages visible. [Staged memory capture](audit-evidence-quick-actions/staged-memory.json)
- Added model work goes through one authorization and routing path. A missing named connection blocks the affected operation. Automatic chapter, instruction-check and replacement requests start off and use separately saved opt-ins. Guided context, selection, counters, world mutation, summary coverage boundaries and prose screening use code. An opt-in semantic note travels on the reply request. [Dispatcher tests](../tests/unit/quick_action_execution.mjs) · [Staged memory tests](../tests/unit/staged_memory.mjs)

## Acceptance results

**Pass** means the acceptance behavior was observed with the cited fixture. **Partial** lists an unverified portion of a larger exercise. **Deferred** identifies the handoff exclusion. Phone tests below mean emulated touch unless explicitly stated. QACT and C labels identify captured requests from the linked host tests.

| ID | Result | Observation and evidence |
| --- | --- | --- |
| A1 | Pass | Quick actions opened on Default and companion. C5 captured the Text Completion retained-history route. The Steer screen names its Chat Completion delivery requirement. |
| A2 | Pass, synthetic | Catalog unit fixture exposed eight instructions, a disabled desire, one event recipe and one enabled style category with shared and separate books. |
| A3 | Partial | Catalog tests exercise a particular Reanchor version and repeated local draws with the saved used-version list unchanged. Integrated send captures enforce one accepted delivery. The complete named Reanchor send trace is open. |
| A4 | Pass, synthetic | Recipe fixture held the chosen ingredient and rolled within the remaining eligible categories under story locks, with zero writes at preview. |
| A5 | Pass | Under Pending directions, edited the first item and cancelled a third. A host dry run made zero model requests and kept both remaining items. QACT-02 sent the edited private wording and the visible OOC once. |
| A6 | Pass | Rolled in Steer before sending. QACT-08/09 retained the draw through a 503 and explicit retry. QACT-ROLL verified Keep original roll kept its ID and Reroll d20 saved a new ID, with one roll instruction per captured request. |
| A7 | Partial | Catalog touch test restored a standalone baseline while keeping its variation. Catalog unit tests cover linked change checks and library export. No full two-built-in restore plus live linked-source edit trace. |
| A8 | Pass, mixed | C1 and QACT-01 preserve the composer and make one request each. A delayed helper fixture returned its result to the originating action with both chats and composers unmodified. |
| A9 | Partial | A queued required direction produces a receipt and needs accepted evidence before counting as a story fact. Historical rollback and event-state tests cover surviving revisions separately. No full force-event/replacement phone trace. |
| A10 | Pass, mixed | History and branch host regressions exercised older edit, bulk delete, branch isolation, new chapter and reopen. Staged-memory unit fixtures exercise these operations with pending slots. |
| A11 | Pass, synthetic | The catalog test inspected the launcher, two inert hooks and all 23 definitions, then chose an outfit translation in the native file workflow with Quick Reply disabled. |
| A12 | Pass, host | Native preset regression exercised pairing, four ownership combinations, per-block editing and restore. |
| A13 | Partial | Emulated composer and reply entry paths preserved value, selection and focus. A reduced viewport retained the primary action. Native keyboard and physical-device evidence are open. |
| A14 | Partial | The catalog rejects disabled sources, missing live links and unresolved macros. Provider failure and unavailable profile fixtures preserve work. Unsupported host capabilities have explicit previews. |
| A15 | Partial | Both presets covered by the integrated sheet and request tests. Standalone save, local source operations and memory have separate host fixtures. Full cold sequence on both presets is open. |
| A16 | Partial | Bounded context and stale-apply tests use a historical target. The player fixture excludes NPC-only knowledge. No single older-target host capture combines the future fact and untriggered book secret. |
| A17 | Partial | Choice parser tests cover JSON, lists, truncation and retained valid choices. QACT-07 has actual partial-choice transport. Mid-stream interruption is covered separately as a route limitation. |
| A18 | Deferred | Concealed delayed queues are outside the handoff. |
| A19 | Pass, mixed | QACT-02 through QACT-05 capture consumption once and omission from later ordinary and guided requests. The integrated edit/cancel flow and queue ownership fixture preserve independent queued work. |
| A20 | Pass | C3 and C4 produced a new alternate, then appended and undid a continuation. Guided regression revisited the original host swipe. |
| A21 | Pass | H4 and local phrase, echo, transition, metric and evidence tests. Screening made no additional requests. |
| A22 | Partial | Native and bounded paths reuse the host or selected card and recent exchange, without a casting call. C8 observed one native group request with the current player contribution and free-text direction once. The full four-case matrix and live model speaker choice are open. |
| A23 | Partial | QACT-06 and QACT-07 show one attempt on a 503, an explicit retry and valid partial choice recovery. A live streaming provider failure and native partial reply are open. |
| A24 | Partial | Cold and scripted touch runs queued a direct favorite, combined selected cues and free text, and used text alone. Full pinned-path coverage per family is open. |
| A25 | Partial | Catalog fixture exercises eligible pools and exact named version and recipe ingredient selection. Host touch covers version selection and pinning. No complete host trace for every scope. |
| A26 | Partial | QACT-02 and QACT-08/09 plus queue units exercise exact ordinary binding, preservation through failure and retry, and one visible OOC. No integrated required-event verification run with the same sequence. |
| A27 | Partial | C1 and unit fixtures supply player persona and fragment and omit NPC-only knowledge. Live prose for all six cues and a chosen twist remains open. |
| A28 | Partial | Local ambiguity and exact evidence outcomes plus host correction/swipe regression. The combined generic-fix and swipe-selection path is covered separately. |
| A29 | Partial | Synthetic catalog search, source pinning, authoring, restore and inert imports on the unrelated preset. No full large-library performance or physical touch run. |
| A30 | Partial | C1 observes the distinctive host base and single user direction. Both presets captured separately. Saved alternate-profile transport and preset switch with an in-flight draft use isolated checks. |
| A31 | Pass, fixture | Dispatcher and prompt tests distinguish blank, Instruct cue, readable host prompt and opaque source. |
| A32 | Partial | The 390 × 490 preset test saved two variations, moved a block, reloaded, applied, restored and undid. The shared Write with AI variation editor has fixture coverage. A dedicated Write with AI touch trace remains open. |
| A33 | Pass, synthetic | The preset touch test restored the local snapshot, explicitly attached and restored a distinct original JSON, and loaded the native utility default as its own source. The fixture used an unrelated preset. |
| A34 | Partial | At 390 × 490, created a voice, saved two variations, applied one, restored, and exported/reimported both variants with zero model requests. The preset regression captured edited stock voice wording on wire. A future Roast using the reimported custom voice remains open. |
| A35 | Partial | Staged-memory tests exercised the local no-text audit, contradictory and ambiguous facts, the mixed gate example and Undo. The hosted source repair fixed and undid an older filed fact without a model call. The complete combined replacement trace is open. |
| A36 | Partial | Host D-ST-H1-26 proves staging and the seven-reply promotion boundary. Fixture tests exercise append, edit and staged source changes. Full mixed sequence through real host reload is open. |
| A37 | Pass, fixture | The dependent key inventory and recall were reconciled from the edited evidence. An independent record and manual lock survived. Zero helper requests. |
| A38 | Pass, mixed | Staged branch, deletion, chapter selection and catch-up fixtures plus existing host regressions. Catch-up generated separate filed and pending batches. |
| A39 | Pass, fixture | Simulated interruption after the write and before journal acknowledgment. Reload and retry did one physical write, and an externally changed field triggered a conflict with recoverable pending state. |
| A40 | Partial | Migration preserves filed and manual entries in staged fixtures. D-ST-H3 applied a repair to an older filed source while later pending history survived. A migrated production chat remains open. |
| A41 | Partial | Four families support local standalones. The touch test created and recovered a standalone nudge offline. Full touch invocation after reload in all four menus is open. |
| A42 | Partial | Touch editor saved a variation, restored the creation baseline and removed/recovered the item. Persistence has fixture coverage. |
| A43 | Partial | Scoped restore and Undo retain library data. Pins use a chat-local persisted Undo identity, and queued directions use independent snapshots. The full reload and undo touch exercise is open. |
| A44 | Pass | QACT-CYOA covered blank, cues only, text only, and both. One request per batch, with each requested element once. |
| A45 | Partial | Touch tests toggled cues and used editable wording with draft recovery. Explicit expansion made one request. Full native-keyboard session persistence is open. |
| A46 | Partial | Player-only request context omitted the NPC secret and off-screen prose. Mock output checks first-person playable text. Live prose quality is open. |
| A47 | Pass, mixed | C4 on host and guided unit tests for stale-target rejection and exact prefix preservation. |
| A48 | Partial | Phone and fixture evidence covers the three execution stages and their costs across drafts, code and ordinary replies. A complete combined Roast and repair receipt comparison is open. |
| A49 | Partial | H1 host test plus chapter and dispatch tests cover off-by-default behavior and opted-in interactions. Full count/scene/token and missed-required-instruction matrix is open. |
| A50 | Partial | Function scope, Main API resolution and unavailable profile recovery tested in fixtures, with native Main API requests on both routes. End-to-end saved named profile routing on a real mobile host is open. |
| A51 | Partial | Provider error and explicit retry recorded. Blank responses and multi-batch catch-up exercised in focused fixtures. Real-host partial streaming recovery is open. |
| A52 | Partial | Reduced viewport tests cover the fixed header/footer, editor scrolling, reorder, and execution disclosure. Native software keyboard and screen reader verification are open. |
| A53 | Partial | Cold emulated mobile review exercised code-only, shared reply and extra-call actions. Real accessibility device and color-independent comparison are open. |
| A54 | Partial | QACT-03 and C3–C5 demonstrate ordinary, swipe and continuation reset assembly. Player context fixture excludes stale prose. Full four-family capture after a preset change is open. |
| A55 | Pass, mixed | QACT-03, QACT-08/09 and QACT-FRESH capture arming, failure, retry, exclusions for swipe/continuation/helpers, and expiry after the fifth acceptance. The ledger fixture exercises rollback, isolated branches and Stop. |
| H1 | Pass | D-ST-H1-26, real host recorder and physical book inspection. |
| H2 | Pass | C3 substituted and C5 retained, with actual routed requests and history receipts on both presets. |
| H3 | Pass | D-ST-H3 on the real host showed one dependent card before the historical replacement. The single bounded request removed the key state and kept later prose verbatim. The dependent card became uncertain. Repair facts only updated and locked the filed gate fact with zero further requests. [Capture](audit-evidence-quick-actions/historical-memory.json) |
| H4 | Pass | Six ordinary requests per preset. Request 4 stored three cited revisions. An older swipe change and edit left one supported. Request 5 sent one supported next-turn nudge. Request 6 contained no nudge. |

## Cold touch review

Recorded separately from automated tests. The reviewer started with task goals and an unbriefed phone interface. The initial findings included ambiguous pinned actions, results below the visible CYOA controls, a reused Add form route, and source search blocked when the correction was blank. Follow-up changes added action verbs to favorites, brought received choices into view, reopened Add in its own editor state, kept focused fields in the reduced viewport, and allowed exact source searches before entering a replacement.

| Task | Cold actions and outcome | Follow-up evidence |
| --- | --- | --- |
| Discover and steer | Composer → Quick actions → Steer the next reply → type → Queue. Added a nudge, pinned and invoked it, then chose available directions. Three items pending, zero model requests. | Immediate actions gained verbs and normal selection gained a pressed state. The Add editor now keeps its own route. [Reduced-height screenshot](audit-evidence-quick-actions/cold-steer-530.png) |
| Create and use choices | Draft my reply → Give me choices. One request returned three editable options. Edited Choice 1 → Use this wording. Zero additional requests for using the result. | Captured follow-up verifies the first choice is in the visible area when the request completes and recovers the previous composer selection. [Integrated captures](audit-evidence-quick-actions/default.json) |
| Repair a fact | Latest reply → Correct story facts → Find and edit source records → exact old wording → Edit this source → Use my correction text → Apply. One reviewed source saved without generation. | D-ST-source-repair retested blank-correction search, exact source preservation, apply and Undo. [Cold repair](audit-evidence-quick-actions/cold-fact-repair.png) · [Retest](audit-evidence-quick-actions/staged-memory.json) |
| Restore a prompt | Quick actions → Prompt and preset tools → Impersonation prompt → Player choices instruction → Save instruction → Restore default. Exact baseline and Undo available with zero requests. | [Cold restore](audit-evidence-quick-actions/cold-prompt-restore.png) |
| Recover a failure | Switched to the extension draft instruction after native verification stopped the action. One 503, one explicit retry, and an editable result. The chat composer stayed intact. The emulated native picker required keys for this run. | The failure is brought into view, retries disclose cost, and the explicit direct-helper recovery keeps the readable host base. [Cold retry](audit-evidence-quick-actions/cold-retry.png) · [C7 capture](audit-evidence-quick-actions/guided-routes.json) |

## Release gate

The audit distinguishes transport and state evidence from live model evaluation and native phone acceptance. The physical-phone touch gate and the Partial acceptance exercises above remain open. The mock 503 intentionally surfaced the host's Service Unavailable error during the ordinary send. The same bound message retried successfully with its visible OOC present once. The branch has no release or publication change.
