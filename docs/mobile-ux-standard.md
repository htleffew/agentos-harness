# Mobile UX standard

Applies to Roleplay Instructions feature design, repairs, audits, cold interactive testing and QA. Baseline recorded November 2026. Use this standard in the design and review of each changed flow. Assess the interface in SillyTavern with one active preset and Roleplay Instructions as the sole active extension. Include TauriTavern when the change depends on host-specific behavior.

## Design and repair criteria

| Principle | What to check in the extension |
| --- | --- |
| Hick’s Law and progressive disclosure | Put the next likely action in reach. Group alternatives by task and reveal advanced parameters where they matter. Measure whether people find the right action and can predict the outcome without extra detours. |
| Jakob’s Law and recognition | Use familiar buttons, checkboxes, disclosures, sheet dismissal and back navigation. Match the host’s interaction conventions where they help. Give actions names that describe the result, such as **Draft my reply** and **Queue with my next message**. |
| Visibility of system status | Show pending, running, completed, failed or cancelled near the affected control. Use the same request indicators in previews, results and receipts. Preserve room for the result when a loading state changes to its final state. |
| User control and error recovery | Show whether a tap sends, applies, queues or opens a draft. Use inline errors with a recovery action. Keep drafts, selected cues and pending work recoverable through cancellation or failure. Make undo and restore scope clear. |
| Touch and accessibility | Design for one-handed use and a visible keyboard. Give standalone interactive targets at least 44 × 44 CSS pixels as a project target. Test reflow, focus, screen-reader names, contrast, reduced motion and interaction without hover. Use WCAG 2.2 AA as the accessibility baseline. |
| Visual hierarchy | Keep one obvious primary action in each task state. Use one shared indicator for a shared execution path rather than repeating it on each input. Use consistent placement and omit badges that add no new information. |

## Model request indicator

Use a familiar disclosure with a small execution symbol. Use a distinct shape and accessible name for each of **Runs in code**, **Uses the reply request**, and **Additional model request**. The proposed extra-request indicator is a small amber mark paired with a recognizable shape and a short visible label on the action that starts the request, such as **1 model call**. A dot may reinforce the cue. Its meaning must remain clear without color or motion. A selected cue can use the ordinary checked state while the shared action shows the request information.

Place detailed counts, triggers, saved or resolved connection, attempts and outcomes in the same tap-to-expand disclosure wherever execution appears. A quiet label identifies an explicitly configured background trigger beside its setting. Show the trigger conditions, budget and connection before enablement. A tap on execution details inspects the action. A tap on the labeled action runs it using the function’s saved connection. Keep those tap targets distinct.

An idle badge is static. If motion helps convey that a request has actually started, use a brief animation tied to that transition. Provide equivalent static text with reduced motion enabled. Screen readers announce relevant changes without moving focus. Avoid persistent pulsing or blinking indicators.

## Interactive QA

- Start with observed tasks and the user’s expected outcome. For a repair, reproduce the reported problem before the change when possible. After the change, exercise the same path and adjacent actions that could regress.
- Give a cold reviewer a goal and a phone-width touch interface. Record where they tap, what they expect, where they hesitate, and how they recover. Ask them to identify which action will call the model, what happens when they tap the indicator, and where they can change a saved connection. Reveal the intended path after the first attempt.
- Exercise the keyboard-open state, long or translated labels, small viewports, accessibility settings, and failed or missing connections. Check at least one code-only action, one same-reply operation, one extra-call action and one opted-in background trigger. Use fixtures or a request recorder to verify actual call counts and saved routes.
- Apply the [programmatic execution guideline](../AGENTS.md#prefer-programmatic-execution) to changed or audited flows. Verify that code-only steps make zero requests and that any separate request performs only work the programmatic or existing reply path cannot deliver.
- Compare the default view against the prior design using task completion, first-tap accuracy, accidental calls and need for explanation. Record the tested host and viewport, actual observations, fixes and verification gaps in the audit. Mark any untested device or assistive technology explicitly.

## References

- [Nielsen Norman Group usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/)
- [Jakob’s Law of Internet User Experience](https://www.nngroup.com/videos/jakobs-law-internet-ux/)
- [Hick’s Law](https://lawsofux.com/hicks-law/)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [Nielsen Norman Group moderated usability testing guide](https://www.nngroup.com/articles/usability-testing-101/)
