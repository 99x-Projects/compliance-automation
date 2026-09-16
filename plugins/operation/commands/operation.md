---
name: operation
description: Run ISO 9001:2015 Clause 8 Operation automation. Defaults to control 8.1 (operational planning and control). Later controls will be added as separate skills. Usage: /operation [8.1] [--scope <path>]
argument-hint: [8.1] [--scope <path>]
---

Run ISO 9001:2015 Clause 8 Operation automation for $ARGUMENTS.

## What This Does

This command dispatches to the skill for the requested **control**. One skill per control — do not merge later clauses into 8.1.

| Argument | Skill to follow |
|---|---|
| _(none)_ or `8.1` | `8-1-operational-planning-and-control` |
| `8.2`–`8.7` | Not implemented yet — stop with one error line naming the missing skill |

If `--scope <path>` is present, pass it through to the skill so discovery is limited to that directory / glob.

## How to Use

```
/operation
/operation 8.1
/operation 8.1 --scope docs/qms
```

## Output

For 8.1, follow `skills/8-1-operational-planning-and-control/SKILL.md` and write the report using `styles/report-template.md`.

---

Starting Operation control now...
