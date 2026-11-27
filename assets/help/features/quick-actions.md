# Quick actions

A quick action is a saved tap. The quick action bar above the message box holds the ones you pin, and [Quick actions, Library](page:quick-library) holds every saved one by kind. Pins are edited in [Quick actions, Bar](page:quick-bar).

## What it does

### Kinds

- **Options** writes a set of options for your next move and shows them in a sheet; it is 1 model call, extra request, and its icon carries the amber dot ([how model calls work](help:model-calls)).
- **Swipe**, **Continue** and **Impersonate** run SillyTavern's reply request with the saved Direction inside it. A tap opens the Generate sheet first, where you can add words for this one run.
- **Direction** adds its saved words to the next reply and runs in code.
- **Action check** rolls a die for an attempt and runs in code. It leaves the bar while the Dice feature is off in [Setup, Features](page:v10).
- **Review** opens what was sent with the newest reply and runs in code.

### The bar to start with

The bar starts with NPC options, Swipe, Continue, Review and Bring in conflict. Impersonate and Action check are also built in for the bar.

### Built-in quick actions

- Dress me, a Direction that describes the outfit you wear for the scene.
- For Swipe and for Continue: More emotional, More romantic, Bring in conflict, Add a plot twist, Back to character and Fix world facts. Fix world facts also repairs the facts a reply got wrong.
- For Impersonate: Respond naturally as me, Do something bold, Introduce an NPC, Initiate an intimate moment, Continue an intimate moment, Introduce a plot twist and Make it more dramatic.
- NPC options, an Options quick action that offers four new people who could enter the scene.

A built-in can be edited; Restore default prompt puts its shipped wording back, and hiding one keeps it out of the lists until you show it again.

### Press and hold

Press and hold on a bar icon shows what it runs, its cost words and its connection, with Edit. A tap opens the Generate sheet ([Words this guide uses](help:glossary)) for Options, Swipe, Continue and Impersonate, and runs Action check, Review and Direction at once.

## Model calls and cost

Only Options makes an extra request. Swipe, Continue and Impersonate ride SillyTavern's reply request. The Action check, Review and Direction kinds run in code. When an Options sheet already holds results for the same reply and settings, it reopens them and makes no call.

## Why it works this way

- A tap on an icon that can call a model opens a sheet first, so a stray tap never spends a request.
- The amber dot marks only the kinds that can start an extra call.
- The bar holds a few pins and More holds the rest, so the bar stays one row on the phone.
