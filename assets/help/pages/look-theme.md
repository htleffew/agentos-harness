# Theme

Theme dresses the extension's menus and controls. Three dark themes ship, and you can save your own variations, share them as files, bind one to a chat, or save a matching theme for SillyTavern itself. Story cards in the reply tray take their look from [Story style](page:look-story-style).

Open it to change the accent color of the menus or to make one chat look different from the rest.

## What it does

### Themes

A row of buttons lists Emerald (the start), Sapphire and Violet, then your saved variations, each with a color swatch. A tap makes that theme active everywhere. When the open chat is bound to a theme, a line names it.

Every theme keeps the same black surfaces and family colors (each top tab's color), so a color means the same thing in all of them; they differ in the accent of the menu's frame.

### Editing a variation

The controls start from the active theme. The built-in themes use Regular icons, Compact density and scanlines on.

- **Chrome accent** is a color picker for the frame accent. A color too dim to read on the menu is lightened until it reads, and a note names the color used.
- **Icon weight** is Regular or Heavy.
- **Density** is Compact or Comfortable.
- **Scanlines and grid** is On or Off. They show only on the full screen menu backdrop and switch off with reduced motion or higher contrast.

### Actions

- **Save as** asks for a name and saves your changes as a variation, which becomes active. A name already used is replaced; up to 24 variations are kept.
- **Export** downloads the active theme as a file.
- **Import** reads a theme file. A file holding anything besides a name, a base, a color and the three choices is refused whole.
- **Bind to this chat** (with a chat open) ties the active theme to this chat; tap again to release it.
- **Delete** (on a saved variation) removes it after you confirm.

### SillyTavern

**Save a matching SillyTavern theme** saves a SillyTavern theme named "Roleplay Instructions, " followed by the theme's name, with this theme's colors and your other current SillyTavern theme settings. Your current SillyTavern theme stays as it is; pick the new one in User Settings when you want it.

## Model calls and cost

Nothing on this page calls a model; every action runs in code and through SillyTavern's own theme save ([how model calls work](help:model-calls)).

## Why it works this way

- All themes share the black surfaces and family colors, so a color keeps its meaning whichever theme you pick.
- A saved theme holds colors and choices only, so an imported file cannot change anything else.
- One accent covers only the frame, so the family colors stay readable as what they mean.
- The matching SillyTavern theme is saved under a new name, so your own SillyTavern theme stays untouched.
