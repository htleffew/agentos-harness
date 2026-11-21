# Roleplay Instructions 10.0.21 usability review

A fresh reviewer used a disposable SillyTavern profile and a local synthetic model. The reviewer had no conversation history or product walkthrough. They tried setting up a chat, changing behavior for one chat, tracing a sent instruction, and correcting a reply at desktop and phone widths. They repeated the affected tasks after fixes.

| Usability finding | Change |
| --- | --- |
| The opening instructions page implied that a random set was required, and workflow setup sat below the preset inspector | The empty page says sets are optional and links directly to the chat’s workflow selector. The selector now comes first and states what following the active preset currently enables. |
| Random Story Events looked like the place to disable autonomous events | That page shows the chat’s current autonomous events setting and takes the user directly to its chat-scoped control. A second chat with the same preset verified that it kept its own setting. |
| What Was Sent could show an empty screen after a Structured reply | The receipt records whether the extension confirmed guidance in the request. Exact text remains opt-in. The receipt links to the open writing guidance editor and its retention setting. |
| A receipt identified the book or set but required a separate search to find the entry | World Info receipts jump to the recorded entry and its current settings. Managed entries open their Direction editors. Random instruction receipts show the configured eligibility, chance and timing recorded for the selection. |
| Corrections offered several actions with overlapping labels | One Apply correction action uses the chosen options. The form displays the model request count, and manual source editing stays behind a disclosure. |
| Streamed corrections could save a new swipe while returning the user to the previous one | Successful generations stay selected after the host reports the accepted reply. The swipe buttons have space below the correction card. |
| Switching the panel layout or leaving an editor made the state of a draft unclear | Fullscreen preserves the current form. Navigating away from a changed form asks before discarding it. Writing guidance labels its chat scope and shows whether it is customized. |
| A save notification covered Close on a phone, and Review showed structured changes as truncated JSON | Instruction saves report success in the list. Review describes an updated record using its story text. |

The browser tests exercise all 22 extension pages, reachable disclosures at 390 and 1280 pixels, module changes in both settings scopes, and the changed receipt, draft, and correction paths. The correction suite checks zero-, one-, and two-request paths, streaming, preservation of the original swipe, failure, and retry.

The review used Chromium with synthetic replies. Native TauriTavern WebViews, physical touch input, and live provider behavior were outside the verified coverage.
