# Emotions & relationships

Emotions & relationships holds how the characters of this chat feel and how they stand with each other. An emotion is scored on four axes (tenderness, fury, dread and yearning, each 0 to 10) with an outward behavior; a relationship is a short note on two people and what changed between them. The tuning at the top sets how long a feeling lasts before it eases.

## What it does

### Emotion tuning

Shown while the Emotions [Feature](help:glossary) is on in [Setup, Features](page:v10). The values are saved for this chat.

- **Baseline** is the resting level each axis eases back toward, from 0 to 10. It starts at 3.
- **Persistence in replies** is how many replies a recorded feeling holds at full strength, from 0 to 40. It starts at 3.
- **Recovery per reply** is how far each axis moves toward the baseline for every reply after that, from 0 to 10. It starts at 1.
- **Sensitivity** is flexible, subtle or responsive, and starts on flexible. The word goes out with each reply to say how readily characters react.

With the starting values, a fury of 9 holds at 9 for about three replies, then reads 8, 7, 6 and so on down to 3. The easing applies to what goes out with a reply; the saved record keeps its value.

### Emotions & Relationships

The records of this chat. **Search emotions & relationships** matches names, wording and status. **Add record** opens an empty record, and **Edit** opens an existing one.

- **Record type** is Emotion or Relationship; each shows while its Feature is on.
- **Record ID** is an optional short name for the record.
- **Subject** is the character's name and is required.
- **Record** is the text.
- **Protect this record from automatic changes** keeps the record as you wrote it. It starts ticked for a new record.

An Emotion record adds these fields.

- **Feeling toward** names who the feeling is about.
- **Coexisting feeling** is a second feeling held at the same time.
- A number box per axis, 0 to 10, left empty for an axis that does not apply.
- **Outward behavior** is how the feeling shows.

A Relationship record adds **Other character** and **One-sided perspective**, for a bond one person sees differently.

**Save record** saves your version; **Cancel** closes the editor.

### Customize emotion and relationship prompts

- **Using tracked emotions** goes out with each reply and carries the Sensitivity word.
- **Emotional continuity check** asks the reply to weigh a character's earlier feeling, the new friction and a positive or neutral feeling beside it.
- **Recording emotional state** and **Recording relationship dynamics** say what an emotion or relationship record holds.

Edits apply in every chat and show in [Setup, Prompts](page:prompts) at once.

## Model calls and cost

Nothing on this page makes a model call; the tuning, the easing and record edits [run in code](help:model-calls). The records that fit the scene go out in [Recall](help:glossary) inside SillyTavern's reply request, together with Using tracked emotions. The Emotional continuity check rides the same request while [Continuity guidance](help:glossary) and Emotions are both on. The two recording prompts go out with the opening request on [Story, Scene, First message](page:opening).

## Why it works this way

- The three numbers set the pace at which feelings fade, per chat, so a character can hold a grudge in one story and let it go quickly in another.
- The easing is worked out when a reply is sent, so it costs nothing and the recorded value stays available.
- An emotion names its target, so a character can be furious with one person and tender with another in the same scene.
