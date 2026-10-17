# Chance Rules — starter packs

Each `*.json` file here is one pack in Undercurrent's own format. `tools/sync-rulepacks.mjs` validates them and embeds them
in `extension/src/rulepacks.js` (run `node tools/sync-rulepacks.mjs` after any edit; the script refuses to write if a
pack breaks a rule below).

| File | Pack id | Default | What it does |
|---|---|---|---|
| `desire-impulses.json` | `desire_impulses` | on | Impulses drawn from each present character's own intimacy profile (`{{pref:any}}`, likes only). Runs only when attraction is live or the scene mode is in `@romance`. |
| `npc-initiative.json` | `npc_initiative` | on | Characters act on their own recorded wants (`{{want:any}}`) without waiting for `{{user}}`. |
| `ambient-world.json` | `ambient_world` | off | Weather, sound, light, passers-by. Quiet in `@intimate` and `@grief`. Off because the built-in Events engine already rolls ambient pulses. |
| `curiosity-hooks.json` | `curiosity_hooks` | off | Unexplained details, slips, unshared messages. Off because Events already has a curiosity roll. |
| `loop-breakers.json` | `loop_breakers` | on | Every N turns with a chance: hints to the hidden director (change place or time, an arrival, new information). |
| `intimate-craft.json` | `intimate_craft` | on | One-liners for `@intimate` scenes only: pacing, sound, specificity, power, consent as behavior, humor, aftercare. Cooldown 3, at most 2 per turn. |

## Format

```json
{
  "format": "undercurrent-rules",
  "version": 1,
  "pack": { "id": "my_pack", "name": "My pack", "description": "", "default_enabled": true, "max_per_turn": 2 },
  "rules": [
    {
      "id": "my_rule", "name": "Readable name", "enabled": true, "priority": 3, "logic": "all",
      "triggers": [ { "type": "scene_mode", "modes": ["@intimate"] }, { "type": "chance", "pct": 25 } ],
      "cooldown": 3, "sticky": 0, "max_fires": 0,
      "action": { "type": "inject", "pool": ["One line for the writer."], "pick": "random", "placement": "note" }
    }
  ]
}
```

- `priority` 1–5: higher priority wins the per-turn budget first (note lines, depth injections and director hints each
  have their own budget; see the Chance rules knobs).
- `logic`: `any` = one trigger is enough, `all` = every trigger must pass. Chance rolls are evaluated last under `all`.
- `cooldown`: rest turns after firing. `sticky`: extra turns the same text stays injected. `max_fires`: per chat, 0 = no cap.
- `action.type`: `inject` (a line in the hidden note, or a separate injection when `placement` is `depth`),
  `director_hint` (handed to the hidden director, never seen by the writer directly) or `set_var`
  (`var: {name, value, op: set|add|sub}`; any action may also carry `sets: [{kind: "var"|"switch", name, value, op}]`).
- `action.pick`: `random`, `cycle` (in order) or `shuffle` (each line once before repeats). `count` picks several lines.

### Triggers

Any trigger may carry `pct` (0–100) — an extra roll that must also pass.

| type | fields | passes when |
|---|---|---|
| `always` | | always |
| `chance` | `pct` | a roll under `pct` × the chance multiplier |
| `keyword` | `words[]`, `target` user/reply/both, `whole` | a word appears (whole words by default; `*` is a wildcard). The player's `*private thoughts*` are never read. |
| `regex` | `pattern`, `flags`, `target` | the pattern matches |
| `every_n` | `n`, `offset`, `min` | turn − offset is a multiple of n (and turn ≥ min) |
| `turn_min` / `turn_max` | `n` | turn ≥ n / turn ≤ n |
| `scene_mode` / `not_scene_mode` | `modes[]` | the scene mode is / is not listed. `@intimate`, `@romance`, `@grief`, `@argument`, `@action` expand to the mode lists set in the knobs. |
| `present` | `names[]`, `"char"` or `"any_npc"` | someone listed is present |
| `variable` | `name`, `op` (== != > >= < <= between contains exists not_exists), `value`, `value2`, `default` | chat variable comparison |
| `switch` | `name`, `state`, `default` | a rules switch (set by `sets`) is on/off |
| `attraction` | `who` any/char/any_npc | someone present has live, unacted attraction in their intimacy profile |
| `any_of` / `all_of` / `none_of` | `triggers[]` | nested logic |

### Pool tokens

Lines are expanded from the chat's live state, so packs adapt to whatever card and persona are loaded.

| token | becomes |
|---|---|
| `{{char}}`, `{{user}}` | left for SillyTavern to substitute |
| `{{random_present}}` | a character present (never `{{user}}`) |
| `{{random_npc}}` | a character present other than `{{char}}` |
| `{{pref:any}}`, `{{want:any}}`, `{{mood}}`, `{{limit}}` | that same character's like / open want / mood / hard limit |
| `{{pref:char}}`, `{{pref:<Name>}}` (also `want`, `mood`, `limit`) | a named character's |
| `{{place}}`, `{{time}}`, `{{weather}}` | the scene fields |
| `{{pick:a\|b\|c}}`, `{{roll:1d20}}` | a random choice / a dice roll |
| `{{var:name\|fallback}}` | a chat variable |

**Subject binding:** every `{{random_present}}`, `{{random_npc}}`, `{{subject}}` and un-named `pref/want/mood/limit` token
in one line refers to the same character, chosen among those who can fill all of them. `{{pref}}` only returns likes that
no hard limit or evidenced dislike covers.

A token that cannot be filled (nobody has a want yet, no weather recorded…) drops the whole line by default, so a broken
line is never injected (knob: `rules.unresolved`).

## Authoring rules (enforced by the sync script)

1. Never script `{{user}}`: no words, actions, thoughts, feelings, arousal or climax for `{{user}}`. Things may happen
   *to* `{{user}}`; conditional lines ("If `{{user}}` says no, …") are fine.
2. No printed trackers, footers, stamps, meters or stage ladders; no slow-burn or escalation mandates.
3. Nothing hard-coded about the cast: no names, no gendered pronouns (use "they" or none), no body types, specific kinks,
   orientations or relationships. Use the tokens above so the line comes from the character's own profile.
4. Narration is third person limited on `{{char}}`: only `{{char}}` gets private *thoughts*; everyone else shows desire
   and intent through behavior and speech.
5. One short, concrete, actionable line per pool entry.

The filter's check names (for the `rules.safety_skip` knob) are exported as `SAFETY_CHECKS` from `src/rules.js`.
