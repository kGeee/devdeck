---
id: skill-schema
kind: schema
---

# Skill schema

A skill is a shared markdown recipe. Any lane may run it. No personal names, no repo-specific secrets, no operator identity.

Path: `packs/skills/<slug>/SKILL.md`

```
---
name: <short title>
description: <one line on WHEN to use it>
---

# Steps
1. ...
```

## Rules

- `description` is the matcher. The loader injects the skill when that line fits the current task.
- Body is steps, not a persona. Skills do not override a lane's does/does-not.
- Generic: write "the operator" / "the repo", never a person's name.
- One skill, one job. Do not nest a second recipe inside.

## Loader

`lib/os/` glob `packs/skills/**/SKILL.md`. Parse YAML frontmatter. Index by `name` + `description`. Inject the body into the lane that needs it for this turn.

v1 seed skills live beside this schema. Adding a skill is a pack change, not a UI change.
