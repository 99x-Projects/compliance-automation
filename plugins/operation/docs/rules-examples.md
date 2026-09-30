# Rules Configuration

Operation is **source-driven**. The Xianix rule clones the product repo, injects secrets, and tells the plugin which control to run. **Which Jira project, Confluence space, or ClickUp list** belongs in `.xianix/operation-sources.yaml` in that repo (or in a constant `sources-config` input).

Each block below belongs inside the `executions` array of a rule set. See [Rules Configuration](/agent-configuration/rules/) for full syntax.

---

## What the rule must do

| Concern | Rule field |
|---|---|
| Clone the product repo | `platform` + `repository` |
| Install this plugin | `use-plugins` |
| Tokens for configured providers | `with-envs` (`secrets.*`, `mandatory` only if that project always uses the vendor) |
| Optional pointer at the YAML | `use-inputs` `sources-file` constant |
| Invoke 8.1 | `execute-prompt` → `/operation 8.1` |

Do not auto-detect Jira vs ClickUp from `git remote`. `platform` is only the **git host** (github / azuredevops), not the QMS evidence host.

Mark a secret `mandatory: true` only when **every** run of that execution needs it. If some projects have Confluence and some do not, keep Atlassian tokens `mandatory: false` so git-only projects still start; the provider will mark Confluence `UNAVAILABLE` when the token is absent.

---

## GitHub + project YAML (typical)

Product repo contains `.xianix/operation-sources.yaml` listing git + Confluence + Jira.

```json
{
  "name": "iso-9001-8-1-operational-planning",
  "platform": "github",
  "repository": {
    "url": "repository.clone_url",
    "ref": "repository.default_branch"
  },
  "match-any": [
    {
      "name": "github-issue-label-8-1",
      "rule": "action==labeled&&label.name=='ai-dlc/iso/8.1'"
    }
  ],
  "use-inputs": [
    { "name": "issue-number", "value": "issue.number" },
    { "name": "issue-title", "value": "issue.title" },
    { "name": "control", "value": "8.1", "constant": true },
    { "name": "sources-file", "value": ".xianix/operation-sources.yaml", "constant": true }
  ],
  "use-plugins": [
    {
      "plugin-name": "operation@compliance-automation",
      "marketplace": "99x-Projects/compliance-automation"
    }
  ],
  "with-envs": [
    {
      "name": "GITHUB-TOKEN",
      "value": "secrets.GITHUB-TOKEN",
      "mandatory": true
    },
    {
      "name": "ATLASSIAN-EMAIL",
      "value": "secrets.ATLASSIAN-EMAIL",
      "mandatory": false
    },
    {
      "name": "ATLASSIAN-API-TOKEN",
      "value": "secrets.ATLASSIAN-API-TOKEN",
      "mandatory": false
    },
    {
      "name": "CLICKUP-TOKEN",
      "value": "secrets.CLICKUP-TOKEN",
      "mandatory": false
    }
  ],
  "execute-prompt": "Run ISO 9001:2015 control {{control}} for repository {{repository-name}} (issue #{{issue-number}}: {{issue-title}}).\n\nRead source declarations from {{sources-file}} in the clone. Fetch every enabled source using the Operation plugin providers. Do not guess extra systems.\n\nRun /operation 8.1 --sources {{sources-file}}"
}
```

---

## Azure DevOps git host, same YAML

Work items are not the evidence source unless `operation-sources.yaml` includes a Jira/ClickUp/generic source. ADO here is only where the repo lives.

```json
{
  "name": "iso-9001-8-1-operational-planning-ado",
  "platform": "azuredevops",
  "repository": {
    "url": "https://dev.azure.com/<org>/<project>/_git/<repo>",
    "ref": "main",
    "constant": true
  },
  "match-any": [
    {
      "name": "azuredevops-workitem-tagged-8-1",
      "rule": "eventType==workitem.updated&&resource.fields.System.Tags*='ai-dlc/iso/8.1'"
    }
  ],
  "use-inputs": [
    { "name": "workitem-id", "value": "resource.id" },
    { "name": "control", "value": "8.1", "constant": true },
    { "name": "sources-file", "value": ".xianix/operation-sources.yaml", "constant": true }
  ],
  "use-plugins": [
    {
      "plugin-name": "operation@compliance-automation",
      "marketplace": "99x-Projects/compliance-automation"
    }
  ],
  "with-envs": [
    {
      "name": "AZURE-DEVOPS-TOKEN",
      "value": "secrets.AZURE-DEVOPS-TOKEN",
      "mandatory": true
    },
    {
      "name": "ATLASSIAN-EMAIL",
      "value": "secrets.ATLASSIAN-EMAIL",
      "mandatory": false
    },
    {
      "name": "ATLASSIAN-API-TOKEN",
      "value": "secrets.ATLASSIAN-API-TOKEN",
      "mandatory": false
    }
  ],
  "execute-prompt": "Run ISO 9001:2015 control {{control}} for {{repository-name}}, triggered by work item #{{workitem-id}}.\n\nRead {{sources-file}} and run /operation 8.1 --sources {{sources-file}}"
}
```

:::note
Replace `<org>`, `<project>`, and `<repo>`. Change `ref` if the default branch is not `main`.
:::

---

## Rule-inline sources (no YAML in the product repo)

Use when QMS system pointers must stay in the tenant rule, not in the application repository. Keep the JSON/YAML in `use-inputs` as a constant — still a structured list, not prompt prose.

```json
{
  "name": "sources-config",
  "value": "version: 1\ncontrol: \"8.1\"\nsources:\n  - id: codebase\n    provider: git-repo\n    roles: [process-control, acceptance-criteria]\n    scope: \".\"\n  - id: qms-wiki\n    provider: confluence\n    roles: [process-definitions, documented-information]\n    site: https://acme.atlassian.net\n    space-key: QUALITY\n  - id: delivery\n    provider: jira\n    roles: [product-service-requirements, planned-changes]\n    site: https://acme.atlassian.net\n    jql: \"project = APP AND labels = qms\"\n",
  "constant": true
}
```

Then: `Run /operation 8.1` and tell the prompt to parse `{{sources-config}}` as the source list (resolution order step 2 in the [source contract](../providers/_source-contract.md)).

---

## Schedule (periodic 8.1 check)

Do not paste a webhook execution under `schedule`. Cron ticks have no payload: omit `match-any` and `use-inputs`, use literal `repository` fields, and pass the sources path via `OPERATION_SOURCES_FILE` in rule-set-level `with-envs`.

Copy the drop-in file [rules-schedule.json](rules-schedule.json) into the agent's `rules.json`. Setup notes: [rules-schedule.md](rules-schedule.md).

After changing `cron` or `timezone`, deactivate and reactivate the agent so the scheduler reloads.

---

## Publish results to AI Hub (pilot)

Adds AI Hub delivery to the GitHub example above. The publisher runs inside the executor. It first uploads each control's detailed report to AI Hub as a write-once artifact, then POSTs one summary event per control assessed to the team's `compliance-audit` activity, linking to that artifact by id and SHA-256. Both use the same API key, and nothing is written to the audited repository. Get the node and activity ids from AI Hub (**Compliance → Enable compliance**, or the activity's **Webhooks** tab, API-key option).

Add to `with-envs`:

```json
{ "name": "AIHUB-PUBLISH", "value": "1", "constant": true },
{ "name": "AIHUB-URL", "value": "https://ai-hub-api.99x.io", "constant": true },
{ "name": "AIHUB-NODE-ID", "value": "nd_XXXXXXXXXX", "constant": true },
{ "name": "AIHUB-ACTIVITY-ID", "value": "na_XXXXXXXXXX", "constant": true },
{ "name": "AIHUB-API-KEY", "value": "secrets.AIHUB-API-KEY", "mandatory": true }
```

`COMPLIANCE-DETAIL-STORE` chooses where the detailed report goes:

| Value | Detailed report |
|---|---|
| `aihub` (default) | Uploaded to AI Hub, beside the summary. Readable by whoever can read the team's events there. If an upload fails, the event says why and the summary is still delivered |
| `github` | Committed to a repository — see below. **Opt-in**: the audited repository is usually the customer's, and findings committed there are visible to them |
| `off` | Not stored; AI Hub gets the summary only |

For `github`, the publisher uses the `GITHUB-TOKEN` the rule already has; it needs **Contents: write** on the target repository:

```json
{ "name": "COMPLIANCE-DETAIL-STORE", "value": "github", "constant": true },
{ "name": "COMPLIANCE-DETAIL-REPO", "value": "org/audit-records", "constant": true },
{ "name": "COMPLIANCE-DETAIL-BRANCH", "value": "compliance-audits", "constant": true }
```

`COMPLIANCE-DETAIL-REPO` sends every team's reports to one records repository (default: the audited repository). The branch shares no history with the code: it doesn't trigger CI, isn't under branch protection, and isn't read back as evidence by the next audit. Each run adds one commit under `audits/<standard>/<run time>--<execution id>/`; nothing is ever force-pushed. If the commit fails and a fallback issue is set, the report goes there instead and AI Hub links to it.

Optionally block web search for the audit run (providers use `curl`, the `generic` provider may use web fetch):

```json
"disallowed-tools": "WebSearch"
```

Optionally end `execute-prompt` with a fallback issue, so undelivered results land somewhere durable. The summary is posted there as a comment, so choose an issue in a repository the customer cannot read:

```text
…Run /operation 8.1 --sources {{sources-file}}

When publishing, set AIHUB_FALLBACK_ISSUE=org/audit-records#1 for the publisher.
```

:::caution Pilot security
In this setup the API key is in the executor's environment, so the audit agent could read it. Use a **dedicated team key** for the pilot, pilot with internal teams only, and revoke the key when delivery moves to Xianix `raise-events` (the key then stays in the Xianix vault). Never use the `whs_…` secret-in-URL option: full URLs are logged.
:::

The publisher always validates `compliance-report.json`. With `AIHUB-PUBLISH` unset it only writes `aihub-event.json` and commits nothing — useful for local runs.

---

## Credentials

| Env name in `with-envs` | Used by | Typical vault key |
|---|---|---|
| `GITHUB-TOKEN` / `AZURE-DEVOPS-TOKEN` | git clone / optional posting; with `COMPLIANCE-DETAIL-STORE=github`, the publisher commits the detailed report (Contents: write) | git host PAT |
| `ATLASSIAN-EMAIL` | `jira`, `confluence` | Atlassian account email |
| `ATLASSIAN-API-TOKEN` | `jira`, `confluence` | Atlassian API token |
| `CLICKUP-TOKEN` | `clickup` | ClickUp API token |
| `AIHUB-API-KEY` | publisher (AI Hub delivery) | dedicated AI Hub team key (`ah_tm_…`) |
| `OPERATION_SOURCES_FILE` | schedule runs (constant path) | not a secret — path in the clone |

:::warning Credentials
Never put tokens in `operation-sources.yaml` or in `execute-prompt`. If a configured provider's secret is missing and `mandatory` is false, the run still starts; that source is `UNAVAILABLE` in the report.
:::
