# Preset & Extension setup audit

The 10.0.28 review fixed the first-run route to the companion preset and exercised module settings at both scopes. The 10.0.29 release changed the reply cards. This follow-up checked **Setup → Preset & Extension** in SillyTavern with the companion and a second preset containing recognizable overlapping blocks.

| Confusing behavior | What the user now sees |
| --- | --- |
| “Reset to preset setting” implied that the value came from the host's prompt JSON. | **Extension defaults for this preset** sets the default stored by the extension. **This chat** can override it. A reset button names the default the user will follow and shows its On or Off value. |
| The source description could say the extension supplied a feature even when its module was turned off. A disabled On/Off selector also appeared beside the source choice when the host controlled the feature. | **Preferred instruction source** records the choice. When a recognized host block is enabled, the row reads **Host block on · Extension off**, names the matching block, and exposes its available prompt text. Selecting the extension shows the required host action and a **Recheck these host blocks** button. The module switch appears once the extension can run it. |
| A focused selector could leave Setup displaying the previous host preset after a switch. | Setup refreshes its name, matching prompts and settings together when the host reports a new preset. |
| Another preset could display a switch for requesting the companion’s reply plan. | The companion shows the working switch. Other structured presets show how to select the companion for that feature. |

## What was exercised

- In a 390 × 820 Chromium viewport, a first-time reviewer changed the default for **Relationships** to Off, switched to **This chat**, verified the inherited Off setting, and changed it to On for the chat. The reset button showed Off before being pressed. [Chat override](audit-evidence-10.0.30/chat-override.png)
- With focus on the module field, the reviewer switched to a preset containing **Internal States Template**. The page identified that preset and its enabled host block. Selecting the extension while the block was still on displayed the waiting state. The reviewer's first pass uncovered the ambiguity between the requested and effective source. [Host owns the feature](audit-evidence-10.0.30/host-owner.png) · [Extension requested while host block is on](audit-evidence-10.0.30/owner-requested.png)
- The ownership regression captured nine outgoing requests. With the recognized host block on, the request contained one host rule and zero extension rules, including after selecting the extension. Disabling the host block and rechecking produced one extension rule and zero host rules. Turning the extension module off at that point produced zero of both. The regression also exercised chat overrides, restore, preset defaults and companion check-level overlap. [Request assertions](../tests/t_module_ownership.js)
- The interactive page audit exercised the twelve module switches in both scopes, restored each, changed workflows, and checked the chapter and auto-hide dependency. [UI exercise](../tests/t_extension_ui_audit.js)

The overlap check uses known block identities and the status the host exposes. An arbitrary custom prompt can duplicate instructions without being recognized. The host controls the actual prompt blocks. Verification used a local test endpoint and the SillyTavern UI.
