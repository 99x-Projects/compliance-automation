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

For 8.1, follow `skills/8-1-operational-planning-and-control/SKILL.md` and write the report using `styles/report-template.md`, plus `compliance-report.json` using `styles/report-json.md`.

## Publishing to AI Hub

The publisher is `scripts/publish-aihub.mjs` in this plugin — a single Node file with no dependencies. Find it once:

```bash
PUBLISHER="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/publish-aihub.mjs}"
[ -f "$PUBLISHER" ] || PUBLISHER="$(find "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins" -path '*operation*/scripts/publish-aihub.mjs' 2>/dev/null | head -1)"
```

1. **Before the audit**, only when `AIHUB_PUBLISH` (or `AIHUB-PUBLISH`) is `1`: run `node "$PUBLISHER" --check`. Exit code `3` means the publishing configuration is wrong — stop and report the printed errors. Any other result: continue. An unreachable AI Hub is only a warning.
2. **After writing `compliance-report.json`**, always run it from the folder that holds the report:

   ```bash
   node "$PUBLISHER"
   ```

   If the prompt names a fallback issue (for example `owner/repo#123`), pass it: `AIHUB_FALLBACK_ISSUE=owner/repo#123 node "$PUBLISHER"`.

| Exit code | Meaning | Do |
|---|---|---|
| `0` | Validated. Delivered, preserved in the fallback issue comment, or publishing is off. A detailed report that could not be committed is only a warning (`⚠`) | Report the outcome line it printed |
| `2` | `compliance-report.json` breaks the contract | Fix the JSON from the printed errors; run once more |
| `3` | Publishing configuration is wrong | Report the errors; do not retry |
| `4` | Delivery and the fallback both failed | Report it; do not retry |

Never print or echo `AIHUB_API_KEY` or `GITHUB_TOKEN`, and never pass them on the command line — the publisher reads them from the environment.

The publisher commits the detailed report (`compliance-report.json` and the Markdown report) to the `compliance-audits` branch itself, through the GitHub API. Do not commit, push or open a PR for these files yourself, and do not switch branches.

---

Starting Operation control now...
