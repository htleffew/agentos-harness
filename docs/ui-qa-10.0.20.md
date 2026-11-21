# Roleplay Instructions 10.0.20 UI audit

## How it was tested

An independent reviewer started at SillyTavern’s welcome screen with fresh test data and a local synthetic model. The reviewer had no conversation history, feature walkthrough, source code, or list of known problems. They used Chromium at desktop width and touch emulation at 390 and 320 pixels.

The Playwright audit opens the extension from the host drawer, visits all 22 pages at 390 and 1280 pixels, opens and closes the reachable disclosures on those pages, and checks for panel overflow. It exercises Automatic, Structured, Legacy and Memory only, the three memory controls, and each of the 12 extension modules in both the chat and preset scopes. It also checks module reset, keyboard focus, and retaining record edits when the user cancels navigation.

## Findings addressed

| Cold review finding | Change |
| --- | --- |
| Inactive sets still said “On for this chat” | Instructions, events and style set labels follow the switch. |
| World Info opened beneath the fullscreen extension | The action closes fullscreen before opening the selected book in the host. |
| Fact creation with a blank ID failed, and navigation silently lost edits | New records can generate an ID. The editor identifies missing fields and asks before discarding unsaved changes. |
| Keyboard focus escaped fullscreen, and Escape did nothing | Fullscreen keeps keyboard focus inside the panel. Escape closes it and restores focus to Expand. |
| The guided-swipe form clipped controls at 320 pixels | The form and selector fit the reply’s available width. |
| Legacy controls appeared to contradict the Structured module settings | Settings identifies legacy defaults and links to the active Structured controls. Unavailable pages link to the workflow selector. |
| Generated openings retained the Main greeting label | The source selector follows the generated preview. |
| Review counted chat message indices as reply numbers, and completed log entries looked active | Review counts assistant replies. Log distinguishes no changes, partial updates and requests still running. |

## Workflow checks

- Corrections with exact matches and no matches, manual source edits, automatic AI source updates, save without a swipe, guided replacement, use from an older saved swipe, network failure and retry. The original swipe and accepted correction survive a failed request.
- Opening generation, editing and adoption, action checks and receipts, guided swipes, prompt overrides and restore, per-module ownership, separate history and lore recall, book import/edit/removal/deletion, chapter creation, auto-hide, catch-up, and branch isolation.
- Story State, Roast, planning, lore receipts and historical state in the reply cards. Structured and legacy instruction, event, style and goal flows use local synthetic replies.

The workflow suites and the navigation sweep use fixture states. They cover the listed routes and interactions, not every combination of settings or every possible model response. Physical TauriTavern WebViews, real provider responses and touch or keyboard behavior on the user’s device remain unverified.
