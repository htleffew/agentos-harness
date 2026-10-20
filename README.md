# SuperObjective Enhanced

A fork of [ST-SuperObjective](https://github.com/ForgottenGlory/ST-SuperObjective) by **ForgottenGlory**
(itself an expansion of SillyTavern's original Objective extension) that adds several objectives per chat,
objectives that unlock each other, a freeform mode, dice injection and a configurable completion-check scope.

All upstream features are kept: task generation and "Generate More Tasks", automatic and manual completion
checks, branching (sub-tasks), drag-and-drop reordering, task durations, recently completed / upcoming task
injection, task templates, custom prompt sets with import/export, statistics, task export/import, hide tasks,
prompt role, injection frequency and the pop-out panel.

Licensed under AGPL-3.0, like upstream (see `LICENSE`).

## Install

**Remove the original Objective and SuperObjective extensions first.** All three use the same chat data
(`chat_metadata.objective`) and the same element ids, so running two of them at once breaks both.
(SillyTavern 1.18 no longer ships Objective built in; older versions do: disable it in Manage Extensions.)

### From a git URL (SillyTavern or TauriTavern)

1. Open **Extensions** → **Install extension**.
2. Paste the repository URL of this fork. If the code is not on the default branch, enter the branch name
   in the branch field.
3. Install for the current user or for all users, then reload the page.

The folder is named after the repository, whatever that name is. The extension finds its own files from the
URL it was loaded from, so the folder name does not matter.

### By copying the folder

Copy this folder to `data/<user>/extensions/<any-folder-name>/` (for example
`data/default-user/extensions/SuperObjective-Enhanced/`) and reload. For an install shared by all users, use
`public/scripts/extensions/third-party/<any-folder-name>/` instead.

### Uninstall

Extensions → Manage Extensions → delete "SuperObjective Enhanced". The objectives stay in each chat's
metadata; reinstalling brings them back.

## Existing chats

A chat saved by Objective/SuperObjective (a single objective) opens as one objective with its whole task tree,
including sub-tasks, completion state and durations. It is named after its objective text. The chat is saved in
the new format the first time it is opened. The upstream keys (`taskTree`, `currentObjectiveId`, ...) are still
written and always hold the selected objective, so upstream SuperObjective can still read that objective.

## The controls

### Objective cards: New, Edit, Delete

Each chat has its own list of objectives, saved in the chat (switching chats or reloading keeps them, and they
never carry over to other chats). Click a card (or focus it and press Enter) to select that objective: its task
list, objective text and settings replace the current ones. The selected card has a highlighted border; the
badge shows its status (`active`, `locked`, `completed`) and mode, and the card shows how many top-level tasks
are done.

Only the selected objective is injected into the prompt and checked for completion.

- **New** asks for a name and which objectives it waits for. The selected objective is pre-ticked, so by
  default the new objective is **locked** until the current one is completed. Untick everything for an
  objective that is active right away. The new objective starts with an empty task list and becomes the
  selected one, so you can type its objective and generate its tasks straight away.
- **Edit** renames the selected objective and changes what it waits for. Objectives that already wait for
  this one cannot be chosen (no circular dependencies).
- **Delete** removes the selected objective and all its tasks after a confirmation. The last objective cannot
  be deleted (use Clear Tasks instead). Objectives that were waiting only for the deleted one unlock.

### Status: active, locked, completed

- **active**: injected and checked as usual.
- **locked**: waits for other objectives. While a locked objective is selected, nothing is injected and no
  completion check runs; you can still write its objective, generate and edit tasks. The banner names what it
  waits for and has an **Unlock now** button that unlocks it by hand.
- **completed**: set when every top-level task of the objective is done (a parent task is done when all of
  its sub-tasks are). Nothing is injected for it. Adding a task or un-ticking one makes it active again.

When an objective is completed, every locked objective whose dependencies are now all completed unlocks
(with a notification), and the first one becomes the selected objective so the story continues with it.

### Mode

- **Sequential** (default, upstream behaviour): one current task at a time, in list order. The completion
  check looks at the current task only. Dice Injection and Check Scope are greyed out.
- **Freeform**: tasks may be completed in any order. Dice Injection and Check Scope apply. A task the check
  confirms is marked done even if it is not the highlighted current task.

### Dice Injection (freeform)

When ticked, every injection picks the given number of incomplete tasks at random (tasks without sub-tasks,
anywhere in the tree) and injects them with the **Dice Injection Prompt** instead of the single current task.
A new sample is drawn each time an injection is due, so the **Task Injection Frequency** setting still
controls how often that happens. Recently completed / upcoming tasks and the prompt role and position work as
before. The dice button rerolls the sample immediately. The injected tasks are remembered for Check Scope
"Injected tasks" and their message counts advance for task durations.

### Check Scope (freeform)

- **Focus (current task)**: the upstream check of the current task with the Completion Check Prompt.
- **Injected tasks**: the tasks injected most recently (the dice sample, or the current task without dice).
- **All incomplete**: every incomplete task without sub-tasks.

With one task in scope the normal Completion Check Prompt is used, so custom prompt sets keep working. With
more, the **Multi-task Check Prompt** lists the tasks as a numbered list (`{{taskList}}`) and asks for a
reply such as `COMPLETED: 2, 3` or `COMPLETED: none`; exactly the confirmed tasks are completed. Tasks whose
duration has not been reached yet are not completed (you get the "duration not met" warning instead).
`/taskcheck` and the Manual Task Check menu item use the same scope.

### Prompts

Manage Prompts has two new fields, stored in custom prompt sets like the others: **Multi-task Check Prompt**
(`{{taskList}}`) and **Dice Injection Prompt** (`{{tasks}}`). Prompt sets saved before this version use the
defaults for the new fields.

### Hidden requests (task generation and completion checks)

Upstream sent these through `generateQuietPrompt`, which builds the full roleplay prompt with your preset
(system prompts, chain-of-thought blocks, a large token budget). This fork sends a short request of its own
through `generateRaw`: a system message with the character card (description, personality, scenario) and your
persona description, then the last few chat messages and the instruction from your prompt templates. It works
the same with any preset, chat-completion or text-completion API.

- **Recent messages sent** (default 8), **Check max tokens** (default 400) and **Generation max tokens**
  (default 800) are at the bottom of the panel. They are global, not per chat.
- Nothing is sent before a reply. Checks run right after a reply arrives, only when the Task Check Frequency
  counter is due. There is no generation interceptor.
- Only one of these requests runs at a time; a check that comes up while another request is running is skipped
  (it runs again at the next due message).
- Answers are validated strictly. A single-task check must answer exactly `true` or `false`; a multi-task check
  must answer `COMPLETED: <numbers>` or `COMPLETED: none`. Anything else (for example roleplay text because
  another extension replaced the request) is ignored and never completes a task. Task generation must return a
  numbered list; otherwise your existing tasks are kept and you get a warning.

### Injection

The task is injected in the chat at depth 1 (right before the last message) as a system message by default
(Position in Chat and Task Prompt Role change that, as in upstream). The default text is a short director's note:

```
<Story_Objective>Objective: {{objective}}. Current focus: {{task}}. Steer the world, {{char}} and other characters
toward it naturally when it fits the scene; never mention it; never write {{user}}'s words, actions, thoughts or
decisions to reach it.</Story_Objective>
```

Recently completed and upcoming tasks, when enabled, go inside the tag. Reasoning tags, `[[...]]`, `[promptN]`
markers and runs of blank lines are removed from the injected text. Chats and prompt sets that still use the
upstream default wording get the new defaults; anything you edited is kept. If another extension removes the
injection from the final request, a warning is written to the browser console (the request is not changed).

The default task-generation prompt asks for short outcome milestones about what the world and the characters do,
never about what {{user}} says, does or decides. The default check prompts judge whether the outcome happened,
not the exact wording, and ignore {{user}}'s private *asterisk* thoughts.

## Fixes over upstream

- The completion-check prompt now contains the task (`{{task}}` was sent to the model unreplaced).
- After an automatic check completed a task, the finished task stayed the current task; the next one is
  selected now.
- The prompt role is saved with the chat (it was lost on the next save) and follows chat switches.
- New chats no longer share one settings object (completion history and statistics could leak between chats).
- Task text, template previews and history are inserted as text, not HTML.
- Duration progress survives a reload.
- No `TypeError` after generating tasks.
- "Task completed" notifications name the task that was completed (upstream named the next one).

## Credits

- Original Objective extension: the SillyTavern team.
- SuperObjective: ForgottenGlory, <https://github.com/ForgottenGlory/ST-SuperObjective>.
- Multiple objectives, modes, dice injection and check scope: this fork.
