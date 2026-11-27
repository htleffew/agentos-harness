# Bar

Chooses which Quick actions sit on the Quick action bar above the message box, and in what order. A Quick action is a saved Swipe, Continue, Direction or other action you run with one tap ([Words this guide uses](help:glossary)). Pressing and holding an icon on the bar offers the same choices.

## What it does

### Which bar to edit

**Global** and **This chat** switch between the two bars. The global bar shows in every chat that has no bar of its own. Tapping This chat gives the open chat its own bar, which starts as a copy of the global bar and replaces it in that chat only; **Use the global bar in this chat** goes back. With no chat open, only Global can be edited. A pill at the top counts the pins and says when you are editing This chat.

### Bar preview

The pinned icons as the bar draws them at its width right now, with a line such as "4 of 6 fit at this width; 2 go to the top of More". The bar keeps room for its status slot first.

### Pinned quick actions

Each pin shows its icon, name, kind and cost, with **Move up**, **Move down** and **Unpin**. A new install pins five; an Options action for a new NPC, a plain Swipe, a plain Continue, a Review that opens What was sent, and a Direction.

### Pin a quick action

A fold, headed with the count of actions not yet pinned, listing every other Quick action by kind with a **Pin** button. **Edit quick actions in the Library** opens [Quick actions, Library](page:quick-library).

## Model calls and cost

Editing the bar [runs in code](help:model-calls). Each pin shows what it costs when tapped. Options is 1 model call and carries the amber dot; Swipe, Continue and Impersonate ride SillyTavern's reply request; Action check, Review and Direction run in code.

## Why it works this way

- Every control is a single tap so the page works on a phone, and the preview shows the overflow at the width the bar has now.
- A chat bar starts as a copy of the global one, so giving a chat its own bar loses nothing.
