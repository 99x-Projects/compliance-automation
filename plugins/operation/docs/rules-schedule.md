# Scheduled rule (ISO 9001 8.1)

Drop-in Xianix **schedule** rule set: [rules-schedule.json](rules-schedule.json).

Clause 8.1 is a recurring control check. A cron tick has **no payload**, so this file is a full `rules.json` array — not an execution block to paste under `webhook`.

Merge the object into the agent's `rules.json` (alongside webhook / chat rule sets), replace the placeholders, then **deactivate and reactivate** the agent so the scheduler reloads.

---

## Schedule constraints (do not copy webhook fields)

| Webhook field | On a schedule rule set |
|---|---|
| `match-any` | **Omit** — every execution runs on every tick |
| `use-inputs` | **Omit** — there is no payload to extract (`{{control}}` / `{{sources-file}}` will not exist) |
| `repository.url` / `ref` | **Plain literals** (not JSON paths, not `{ constant: true }` wrappers) |
| Secrets + source path | Rule-set-level `with-envs` |

Sources therefore cannot use webhook `use-inputs`. This file sets:

```json
{ "name": "OPERATION_SOURCES_FILE", "value": ".xianix/operation-sources.yaml", "constant": true }
```

The skill already resolves that env (see [source contract](../providers/_source-contract.md)). Keep the same path in `execute-prompt` as `--sources` so a local replay matches the cron run.

**Only when the repository has that file.** A path given by `--sources` or `OPERATION_SOURCES_FILE` is a declaration: if the file is missing, the run stops with one error line rather than silently auditing less. For a repository with no sources file, leave out both the env and `--sources` and run `/operation 8.1`: the plugin then searches the default locations and falls back to one implicit `git-repo` source over the whole repository (the report header says `Sources: implicit git-repo`).

Put Jira / ClickUp / Confluence **queries** in the product repo YAML, not in this rule file. Put **tokens** only in `with-envs`.

---

## What to change before installing

In [rules-schedule.json](rules-schedule.json):

| Field | Default | Change to |
|---|---|---|
| `cron` | `0 6 * * 1` | Monday 06:00. Use `0 6 1 * *` for monthly. |
| `timezone` | `UTC` | e.g. `Asia/Colombo` |
| `repository.url` | `https://github.com/<org>/<repo>.git` | Real clone URL |
| `repository.name` | `<org>/<repo>` | Display name for `{{repository-name}}` |
| `repository.ref` | `main` | Default branch |
| `platform` | `github` | `azuredevops` if the git host is ADO |
| `GITHUB-TOKEN` | mandatory | Swap for `AZURE-DEVOPS-TOKEN` on ADO (see below) |
| `OPERATION_SOURCES_FILE` | `.xianix/operation-sources.yaml` | Path in the clone, or omit and rely on default search |

Atlassian / ClickUp envs stay `mandatory: false` so a git-only project still starts.

---

## Azure DevOps git host

Same schedule object, with these substitutions:

```json
"platform": "azuredevops",
"repository": {
  "url": "https://dev.azure.com/<org>/<project>/_git/<repo>",
  "name": "<org>/<project>/<repo>",
  "ref": "main"
}
```

Replace the `GITHUB-TOKEN` `with-envs` entry with:

```json
{
  "name": "AZURE-DEVOPS-TOKEN",
  "value": "secrets.AZURE-DEVOPS-TOKEN",
  "mandatory": true
}
```

ADO work items are not the schedule trigger. They are evidence only if `.xianix/operation-sources.yaml` declares a Jira / ClickUp / generic source.

---

## Several product repos

Duplicate the **execution** block inside `executions` (one clone target per block). Share the rule-set-level `with-envs`. Each repo still needs its own `.xianix/operation-sources.yaml` (or a different `OPERATION_SOURCES_FILE` on that execution's `with-envs`).

---

## Install

1. Copy `.xianix/operation-sources.yaml` into the product repo from [operation-sources.example.yaml](operation-sources.example.yaml).
2. Merge [rules-schedule.json](rules-schedule.json) into the Xianix agent's `rules.json` array.
3. Store `GITHUB-TOKEN` / `ANTHROPIC-API-KEY` (and optional Atlassian / ClickUp secrets) in the tenant vault.
4. Deactivate the agent, then reactivate it — cron changes do not apply until restart.

Each tick clones `repository.ref`, installs `operation@compliance-automation`, and runs `/operation 8.1`. The report is `iso-9001-8.1-operational-planning-and-control.md`. The stock prompt does not open a PR.
