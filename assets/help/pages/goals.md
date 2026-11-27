# Character goals

One goal for the character in the open chat, with the small tasks that move it forward. The goal goes with every reply, and now and then one task joins it as an order. Goals are for the character only; your Persona has none. The page needs an open chat.

## What it does

### How it works

A task is a repeatable action or a one-time step. One-time steps can happen in any order and are ticked off when a reply shows them.

**Turn the goal on or off for this chat** is the switch on the top card; a new chat starts with it Off. Turning it off stops the goal and its tasks from being sent and keeps everything you typed. With it on and no goal typed, nothing is sent.

### The goal

**What the character is working toward** is one plain sentence, kept loose, for example "{{char}} wants {{user}} to trust {{char.them}}". A chip shows No goal yet, In progress, Turned off, or Done.

- **Write a goal with AI** opens a box with an optional "What the goal is about" line and the choices of what the writer may read. **Write the goal** shows the goal, steps and actions it wrote; nothing changes until you press **Use this goal**, **Add the steps and actions to my goal**, **Write another** or **Cancel**.
- **Mark the goal done** stops the goal; the button then reads **Start this goal again**.
- **Save this goal to my list** keeps the goal, its actions and its steps under a name for other chats.
- **Start a goal from my list** appears once your list has a goal. It replaces this chat's goal, and its steps start as not done.

### One-time steps (each happens once, in any order)

Type a step and press **Add this step**. Each step has:

- a tick that lets it be sent;
- a chip reading Not done yet, Sent and waiting for it to happen, or Done;
- **Mark done** or **Undo done**, **Move up**, **Move down**, **Edit** and **Remove**.

A step that was sent goes again with every reply until a reply shows it happened; then it is ticked off with the words that show it. With the Follow-through check off in [Direction, Sets and pacing](page:set-rules), only you tick steps off.

Each step and action is checked as you type. A line longer than 8 words, or one tied to a place, time or object, gets a warning.

### Repeatable actions (sent again and again)

Type an action and press **Add this action**. An action is sent for one reply and then rests for a while; actions are not checked. Each one shows Not sent yet, Ready to be sent again, or how many replies it still waits.

### How often

- **Send the goal with every reply** starts On. Off sends the goal only together with a task.
- **Chance to add a task each reply (%)** starts at 35, about 1 reply in 3. At most one task goes out at a time.
- **A repeatable action waits at least (replies)** starts at 6.
- **A repeatable action waits at most (replies)** starts at 10. After an action is sent, it rests for a number of replies between the two.
- **The goal is done when every one-time step is done** starts On. Off keeps the goal in progress until you press Mark the goal done.
- **When the goal is done** starts on Stop sending. Start the next goal from my list moves to the goal after this one in your list.

**Clear this chat's goal** removes the goal, actions and steps from this chat; your saved list is kept.

### Customize goal prompts

- **Goal task wording** frames a task as an order.
- **Ongoing goal wording** is the line that keeps the goal in view.
- **Writing goal actions and steps** and **Goal writer: system message** are what Write a goal with AI sends.

## Model calls and cost

The goal line and its tasks ride SillyTavern's reply request, and picking a task [runs in code](help:model-calls). **Write the goal** is 1 model call, marked with the amber dot. It starts on Automatic, which tries the free and local routes in [Setup, Background jobs](page:background-jobs) first and ends on the Main API, or it uses a Connection Profile you fix in [Setup, Connections](page:settings); the call is metered, so a paid route counts toward the ceiling in [Setup, Connections, Spend](page:spend). Ticking off a step uses the Follow-through check, 1 model call after a reply that carried a step.

## Why it works this way

- Tasks stay short and loose so they fit any scene; a task tied to one place or object can wait a long time for its moment.
- One task at a time, inside the one-new-thing budget of Direction, Sets and pacing, keeps the goal from crowding the story.
- A step goes again until a reply shows it, so a step the model skipped is not lost.
