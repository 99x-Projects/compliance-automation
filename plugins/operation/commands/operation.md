---
name: operation
description: Run ISO 9001:2015 Clause 8 Operation automation. Defaults to control 8.1. Evidence sources are declared per project (Jira, ClickUp, Confluence, git, …), not inferred from git remote. Usage: /operation [8.1] [--sources <path>] [--scope <path>]
argument-hint: [8.1] [--sources <path>] [--scope <path>]
---

Run ISO 9001:2015 Clause 8 Operation automation for $ARGUMENTS.

## What This Does

This command dispatches to the skill for the requested **control**. One skill per control — do not merge later clauses into 8.1.

| Argument | Skill to follow |
|---|---|
| _(none)_ or `8.1` | `8-1-operational-planning-and-control` |
| `8.2`–`8.7` | Not implemented yet — stop with one error line naming the missing skill |

Parse flags and pass them through:

| Flag | Purpose |
|---|---|
| `--sources <path>` | Project source file (YAML). See `providers/_source-contract.md`. |
| `--scope <path>` | Limit the `git-repo` provider (and fallback) to a directory / glob. Does not ignore Jira/Confluence/ClickUp sources. |

## How to Use

```
/operation
/operation 8.1
/operation 8.1 --sources .xianix/operation-sources.yaml
/operation 8.1 --sources .xianix/operation-sources.yaml --scope src
```

If the Xianix rule interpolated `{{sources-file}}` or `{{sources-config}}`, treat those as the source list even when the flag is omitted.

## Output

For 8.1, follow `skills/8-1-operational-planning-and-control/SKILL.md` and write the report using `styles/report-template.md`.

---

Starting Operation control now...
