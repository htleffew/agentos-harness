# Help

Setup, Help holds this guide and the help assistant. The guide has one entry for every page of the menu and one for each feature that spans several pages. The assistant answers a question from those entries and links to the page where you make the change.

## What it does

### Ask the help assistant

**Ask the help assistant** opens a sheet at the bottom of the screen; opening it sends nothing. You type a question in **Your question** and tap **Ask**, and the answer appears in the sheet with the guide entries it came from and a **Show** button that opens the page with the matching control in view. The [help assistant entry](help:help-assistant) explains what each question sends and what it costs.

### Search the guide

**Search the guide** finds entries, sections and single controls by the words in them.

- A control result has **Show**, which opens its page with the control in view, and **Read the guide**, which opens the entry that describes it.
- An entry result opens that entry here.
- With the field empty, the page lists every entry by top tab, then the feature entries.

### An entry

Each entry starts with where the page sits in the menu and a button that opens it. The text that follows describes the page. Under it, **Controls on this page** lists every section, setting and prompt the page shows, each with its help line and what it starts as. The list is read from the extension itself, so a control added in a later version appears in it with its own label.

Every page header in the menu has a **Help** link beside its status; it opens that page's entry here.

### Help settings

**Help settings** holds the routes a question tries, in order. A route is a way to reach a model, such as the desktop model over Tailscale (your own computer, reached from the phone through Tailscale) or a saved Connection Profile; [how model calls work](help:model-calls) explains each one. The list starts with the desktop model, then the NanoGPT plan (a subscription that costs nothing per call), the free OpenRouter model and last the Main API. A route with no saved connection on this device is skipped.

- **Add a route** lists the named routes (Desktop over Tailscale, NanoGPT plan, OpenRouter free model, Google AI Studio free tier, OpenRouter paid, Main API) and each saved Connection Profile by its name. **Add** puts the choice at the end of the list.
- **Up** and **Down** move a route. **Remove** takes it out; the only route left cannot be removed.
- **Reset to recommended** appears once you change the list and puts the starting list back.

## Model calls and cost

Search, the entries, the links and the list of entries make no model call. A question is 1 model call, and the **Ask** button carries the amber dot that marks a tap which can start one. The question goes to the first route in Help settings that answers; when an earlier route does not answer, a note under the answer says which route did. The list starts with the desktop model, the NanoGPT plan, the free OpenRouter model and last the Main API. A paid route, the Main API on a paid provider included, counts toward your monthly ceiling in [Setup, Connections, Spend](page:spend), and once the ceiling is reached a paid route is skipped.

## Why it works this way

- The guide ships inside the extension, so it matches the version you run and works without a connection.
- The routes are yours to order. The list starts on the local desktop model, which costs nothing, with free routes after it; the Main API comes last, and you can add your Connection Profiles.
- The assistant reads and explains; you make every change, and each answer links to the control.
- A question costs one call, and a question no guide entry matches is answered at once with no call.
