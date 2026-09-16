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

Clause 8.1 is often a **recurring** control check, not a PR event. A schedule rule set uses literal `repository` fields and the same `with-envs`:

```json
{
  "name": "scheduled-iso-8-1",
  "platform": "github",
  "repository": {
    "url": "https://github.com/<org>/<repo>.git",
    "name": "<org>/<repo>",
    "ref": "main"
  },
  "use-plugins": [
    {
      "plugin-name": "operation@compliance-automation",
      "marketplace": "99x-Projects/compliance-automation"
    }
  ],
  "execute-prompt": "Run /operation 8.1 --sources .xianix/operation-sources.yaml"
}
```

Put Atlassian / ClickUp tokens on the **rule-set-level** `with-envs` so every schedule execution receives them.

---

## Credentials

| Env name in `with-envs` | Used by | Typical vault key |
|---|---|---|
| `GITHUB-TOKEN` / `AZURE-DEVOPS-TOKEN` | git clone / optional posting | git host PAT |
| `ATLASSIAN-EMAIL` | `jira`, `confluence` | Atlassian account email |
| `ATLASSIAN-API-TOKEN` | `jira`, `confluence` | Atlassian API token |
| `CLICKUP-TOKEN` | `clickup` | ClickUp API token |

:::warning Credentials
Never put tokens in `operation-sources.yaml` or in `execute-prompt`. If a configured provider's secret is missing and `mandatory` is false, the run still starts; that source is `UNAVAILABLE` in the report.
:::
