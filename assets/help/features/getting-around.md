# Getting around the menu

The menu has five top tabs, each with a row of nested tabs under it, so any page is two taps away.

- **Story**: the scene, the characters, Story World (the lasting records of the chat) and World Info.
- **Direction**: random sets, goals and writing guidance.
- **Quick actions**: the bar above the message box and the library of saved quick actions.
- **Review**: what was sent, the context and the request log.
- **Setup**: features, presets, memory, connections, the look, prompts and this guide.

## What it does

### The header

The first row holds the switch that turns the whole extension on or off, Back when there is somewhere to go back to, the search button and the full screen button. The second row holds the five top tabs and the third the nested tabs of the open top tab; the nested row scrolls sideways and keeps the open tab in view. A top tab always opens its first nested tab.

### A page

Every page starts the same way:

- its icon and title;
- a status pill, such as ON, OFF, NO CHAT, or a count like 3 ON for how many features on the page are on;
- a **Help** link that opens its entry in [Setup, Help](page:help);
- one line of help.

A nested tab that holds several pages shows them as a row of sections under the help line. A feature's settings appear under its switch only while it is on, and a page lists its own prompts at its foot, with a link to [Setup, Prompts](page:prompts).

### Search

The search button opens one field that finds pages, sections and single settings by their words. It knows SillyTavern's own words too; Author's Note, impersonate, summarize, World Info, pronouns and budget each lead to the place that holds them here. A result opens its page, unfolds its section and puts the control in view.

### Back and reopening

Back appears after you follow a link from one page to another, or arrive from the chat, and names where it goes ("Back to chat"). The menu reopens on the last page you reached through the tabs.

## Model calls and cost

Moving around the menu, search and Back make no model call.

## Why it works this way

- Every page is two taps away, and the nested row always shows, so nothing hides behind an extra menu.
- Five top tabs fit a phone screen with readable labels.
- Screens are named the same way everywhere, for example "Setup, Prompts", so a name in a help line matches the tabs you tap.
- A page folds at most two levels deep, a section and one item inside it, so settings stay findable on a small screen.
