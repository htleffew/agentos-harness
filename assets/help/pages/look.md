# Look

Look sets the size of the extension's text, icons and touch targets, the height of the results sheet, and whether SillyTavern uses its phone layout on a touch screen. The same tab holds [Reply display](page:display), [Theme](page:look-theme), [Story style](page:look-story-style) and [Reply tray](page:reply-tray).

Open it when text reads too small on the phone, when buttons are hard to hit, or when SillyTavern's drawers open too narrow on a wide touch screen.

## What it does

### Sizes

Each of the first three has Compact and Comfortable buttons and a **Scale** slider that multiplies the size. All start at Compact and 100 percent.

- **Text size** is 12 to 14 px in Compact and 13 to 16 px in Comfortable; Scale runs from 100 to 130 percent.
- **Icon size** is 16 px in Compact and 20 px in Comfortable for the bar, the tabs and the tray; Scale runs from 85 to 130 percent.
- **Touch targets** are 32 px in Compact and 44 px in Comfortable for the bar and sheets, with a floor of 24 px; Scale runs from 85 to 130 percent.
- **Results sheet height** is the share of the screen the results sheet takes, from 25 to 75 percent, starting at 40.

Each change applies at once.

### Phone layout on touch screens

On (the start) makes SillyTavern use its phone layout on any touch screen, however wide, so every drawer and the character panel open full width. Mouse screens keep SillyTavern's own layout. Turning it off lets SillyTavern pick its layout by width alone, so a screen wider than 1000 px gets the desktop layout with narrow side panels.

### Restore Compact defaults

Puts the four sizes back to Compact, 100 percent and a 40 percent sheet. The phone layout switch keeps its setting.

## Model calls and cost

Nothing on this page calls a model; every setting runs in code ([how model calls work](help:model-calls)).

## Why it works this way

- Compact fits more on a phone screen, and Comfortable and the scale sliders enlarge text and targets when you want them larger; 44 px targets meet the comfortable touch size.
- An unfolded Fold is wider than SillyTavern's 1000 px phone breakpoint and gets the cramped desktop layout; the phone layout switch applies SillyTavern's own phone rules on any touch screen.
