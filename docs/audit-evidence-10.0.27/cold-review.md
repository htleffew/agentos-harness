# Roleplay Instructions cold usability review

## Environment and method

Started SillyTavern 1.19.0 (7e8663c) on loopback port 8131 with a fresh data root at /tmp/ri-cold-user. Installed the workspace extension and bundled V10 Chat Completion preset before first launch. Used Playwright and Chromium on a 1360 × 900 desktop and fresh 390 × 844 touch-emulated browser contexts. Used only what the product showed for discovery. The host, chat, character and receipt were real. A private OpenAI-compatible server on port 18131 returned a deterministic plain-prose reply. No real provider or shared mock was used.

## First run and verified tasks

- Entered a persona at the host welcome dialog, chose Character Management → Seraphina, opened Extensions → Roleplay Instructions, and followed “Set up this chat.” Selected Structured story workflow in the chat dropdown. The help text distinguishes Structured, Memory only and Legacy.
- The initial screen opens Direction → Random Instructions even with no sets. The first button gets the user to setup. “Open a lorebook” on that screen opens a chooser to use a book **as an instruction set**. Story → Reusable Lorebooks is the route for browsing and assigning ordinary lore. The chooser explains the distinction when opened, and Cancel left the book untouched.
- Edited Direction → Random Instructions → Customize AI instructions → Instruction framing. Removing the required placeholder displayed “Keep the required placeholder: {instruction}.” Preserving it showed Customized and Saved. The global framing persisted in a new mobile browser context. Separately, edited Live writing guidance under Direction → Writing Guidance. Attempting to leave with unsaved text showed a discard confirmation, and choosing No preserved the draft. The saved guidance was labeled “Saved for this chat” and persisted after reloading.
- Connected a private endpoint through the host's API Connections → Chat Completion → Custom (OpenAI-compatible), then chose Roleplay Instructions V10 under AI Response Configuration. Created Story World “Lantern Court” through Story → Story World, added place “Copper Bridge” and entered “A covered bridge with a brass bell.” Sent a normal chat message mentioning Copper Bridge. The reply card showed “1 entry” and “1 confirmed in prompt.” Its World Info disclosure showed Copper Bridge, the book and world names, and “Story notes block.” The actual outbound messages contained the authored fact.
- Review → What Was Sent → Reply 1 displayed the exact story notes, place, approximate size and reason it was sent. World Info selections → View entry settings opened the entry and Back to What Was Sent returned to the receipt. A separate mobile session recovered the same receipt. Guidance receipt settings correctly opened the display preference for retaining exact guidance on future replies.
- Desktop Escape dismissed full screen. On mobile the expanded interface occupied exactly 390 × 844 CSS pixels, with no horizontal overflow on the receipt. All five top-level navigation buttons measured 70 × 40 CSS pixels and were reachable by touch. The seven-page Story navigation leaves 578 pixels for the scrollable content on this viewport. With one place, the Story World overview was 6796 pixels tall. Its extensive settings made this the longest path to scan.
- At first launch, the Reusable Lorebooks card for host-attached Eldoria showed the redundant origin “Host character attachment · Host character attachment · last scan.” The book name and controls were clear. The follow-up below verifies the corrected origin after activation.

## Defects reproduced and verified after fixes

1. **Unclear next step with no active Chat Completion preset.** Initially, under the default AI Horde connection, Setup → Preset & Extension reported that the host had no active preset and exposed no ordered list. The screen gave no route to the installed companion. After copying the updated source and returning the host to AI Horde, this area named API Connections → Chat Completion and AI Response Configuration → Roleplay Instructions V10, with JSON import directions for a missing preset. Verified the names against the host controls used in the desktop flow.
2. **Three literal null strings in the World Info editor.** On the populated receipt, opened World Info selections → View entry settings for Copper Bridge. Before the fix, three separate “null” strings appeared after Enabled, initial-window settings and the payload fields. Each was an actual rendered 26 × 20 pixel text node. After syncing the fix and opening this same persisted receipt in a new browser context, the editor contained zero null lines. The source and activation evidence remained visible.
3. **Unnamed controls in the new-place editor.** Story → Story World → Add a place initially exposed four unnamed detail textboxes, an aliases input named “None” by its placeholder, and an unnamed auto-update combobox. After syncing the field helper and opening the same path from a fresh browser context, all four detail controls had their displayed names, the aliases input was named “Other names,” and the combobox was named “Let the extension keep this entry up to date.” The post-fix accessibility tree was saved.

## Limits

One default character, one roleplay turn, one authored place, one desktop browser, and one emulated touch size. Evaluated discovery, data entry, confirmations, receipt inspection and navigation. No physical mobile device or assistive-technology session. The plain fixture reply did not produce model-authored structured sections. This review does not assess real model adherence, generation quality, all editor types, swipe/branch continuity, import/export coverage, or compatibility with other host versions.

# Mobile follow-up verification

Reopened the existing Seraphina chat and Lantern Court Story World in a fresh 390 × 844 touch-emulated Chromium context. The local SillyTavern fixture used port 8131, the updated workspace source and styles, and a private deterministic completion endpoint. The prior receipt and Copper Bridge entry were still present.

## Jump to section

On Story → Story World, tapped the native selector and chose each of its twelve destinations. Checked the actual focused element, the rendered heading bounds, and the result of a hit test on the heading after each selection. Each focused the corresponding section, exposed its heading below the fixed navigation, and reset the control to Choose a section.

| Option | Focused section heading | Heading top (CSS pixels) |
|---|---|---:|
| The story so far | The story so far (0) | 268.7 |
| Characters | Characters (0) | 268.5 |
| Places | Places (1) | 268.7 |
| Groups | Groups (0) | 268.5 |
| Open threads | Open threads (0) | 269.0 |
| Secrets | Secrets (0) | 268.9 |
| Planted details | Planted details (0) | 268.7 |
| Going on elsewhere | Going on elsewhere (0) | 268.9 |
| Next reply preview | What would be sent with the next reply | 256.3 |
| Chapter and summary settings | Keeping the story so far | 268.9 |
| Story note settings | How story notes are sent | 268.8 |
| Automatic world updates | Keeping the world up to date | 268.6 |

Selecting Automatic world updates twice in succession worked. The selector itself scrolls out of view after every jump. Scrolling the content back to the top restores it at y = 287.6 px. Tapping the already active Story World subtab kept the existing scroll position. This distinction matters for someone jumping between distant sections.

## Host-attached book after a scan

Before generating, the Eldoria card showed “Host character attachment.” Sent messages that mentioned its published keywords through the private endpoint. The default 25% World Info budget left the matched Eldoria entry out on the default host preset. Raised the budget to 100% for this isolated fixture and generated a reply to “What is Eldoria, and where is its glade?” The host scan log records successful prompt inclusion for Eldoria entries 0, 2, 1 and 3. Story → Reusable Lorebooks then showed “Host character attachment · Appears in reply receipts” with exactly one occurrence of the source.

## Instruction-set chooser

Direction → Random Instructions showed one button named “Use a lorebook as an instruction set.” Tapping it opened “Lorebook to open as an instruction set” with Eldoria and Roleplay Instructions available. Changed the selected book, then tapped Cancel. The exact original panel text returned, no set appeared, and SHA-256 checks of both lorebook files matched their pre-chooser values.
