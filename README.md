# Roleplay Instructions: compatibility test (Step 0)

A small, throwaway SillyTavern / TauriTavern extension. It records how World Info behaves on your device so that
Version 1 of the Roleplay Instructions extension is built on facts. It changes nothing in your chats except adding
a test lorebook named `ri-compat-test`.

## Install

1. In SillyTavern or TauriTavern open **Extensions > Install extension**.
2. Repository URL: `https://github.com/htleffew/agentos-harness`
3. Branch: `roleplay-instructions-step0-test`
4. Install, then reload the app.

## Run the test (about 5 minutes)

Open a test chat with any character, then open **Extensions > Roleplay Instructions: compatibility test** and:

1. Press **1. Create the test lorebook**.
2. Press **2. Run automatic checks**.
3. Press **3. Test the AI connection** (sends 2 very short requests on your current connection).
4. Send 6 messages in the chat, waiting for each reply.
5. Swipe the last reply 5 times.
6. Delete the last reply, then send 1 more message.
7. Press **Copy the log** and paste it to Claude.

## What it tests

| # | Question | Where it shows in the log |
| --- | --- | --- |
| 1 | Can the extension add entries to a chat and change which entries are sent? | `entries-loaded` (TEST 1a), `scan-done final` (TEST 1b), `PROMPT SENT` |
| 2 | Does a swipe roll World Info chance again? | `GEN n start type=swipe` lines and their `fired=` lists |
| 3 | What happens to "keep sending" and "wait" timers on swipe and delete? | `timers before` / `timers after` |
| 4 | Do macros inside macros work in World Info? | `E text:` shows `nested-ok` or `plain` |
| 5 | Can the extension create, edit and save a lorebook? | `TEST 5` lines |

## Remove

Extensions > Manage extensions > delete "Roleplay Instructions: compatibility test". Delete the `ri-compat-test`
lorebook in World Info.

## Results

Desktop SillyTavern 1.19.0 results are in `results/desktop-sillytavern-1.19.0.txt`. TauriTavern (Android) results are summarised in `RESULTS.md`.
