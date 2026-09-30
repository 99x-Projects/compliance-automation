# Source contract

ISO 9001 8.1 evidence rarely lives in one system. A project may keep process docs in Confluence, delivery work in Jira or ClickUp, and process controls in git. The plugin therefore **does not auto-detect a single platform from `git remote`**.

Split of ownership:

| Layer | Who owns it | What it contains |
|---|---|---|
| **Roles** | this plugin | What 8.1 needs (requirements, criteria, records, …) |
| **Providers** | this plugin (`providers/<name>.md`) | How to authenticate and fetch from a vendor |
| **Sources** | the consuming **project** (YAML) or the **Xianix rule** | Which systems this project uses, queries, and which roles they fill |
| **Secrets** | the **Xianix rule** `with-envs` | Tokens only — never in YAML |

Read this file before any provider. Every configured source must satisfy this contract.

---

## Evidence roles (vendor-agnostic)

A source declares one or more **roles**. Skills merge all sources that share a role.

| Role | What the skill expects from it |
|---|---|
| `product-service-requirements` | What is delivered and the requirements those outputs must meet |
| `process-definitions` | Named operational processes (Clause 4.4 landscape) |
| `process-criteria` | How each process is supposed to run (entry, sequence, measures) |
| `acceptance-criteria` | How products/services are accepted |
| `resources` | People, skills, tools, environments, information needed for conformity |
| `process-control` | Controls that enforce process criteria (workflows, gates, reviews) |
| `documented-information` | Maintained definitions and retained records |
| `planned-changes` | How intended operational changes are controlled |
| `unintended-changes` | How unexpected changes are reviewed and mitigated |
| `outsourced-processes` | Work performed outside the organization (8.4 handoff) |

Unknown roles are ignored with a one-line notice. Duplicate roles across sources are **merged**, not last-write-wins.

---

## Source object

Each source in the project YAML (or the rule JSON) has this shape:

```yaml
id: qms-wiki                 # unique within the file
provider: confluence         # must match a file in providers/
roles:                       # one or more evidence roles
  - process-definitions
  - documented-information
enabled: true                # optional, default true
# provider-specific fields follow (site, jql, space-key, …)
```

`id` is the citation prefix in the report (`confluence://qms-wiki/…`, `jira://delivery/APP-12`).

---

## Resolution order

The skill resolves the source list once, then fetches. First match wins:

1. `--sources <path>` on `/operation`
2. **Webhook only:** rule / prompt input `sources-file` or `sources-config` (JSON or YAML text). Schedule rule sets have no payload — they **must omit `use-inputs`**.
3. Env `OPERATION_SOURCES_FILE` (path in the clone) or `OPERATION_SOURCES` (JSON). This is the schedule-rule path: set them as `with-envs` constants.
4. File in the cloned repo, first that exists:
   - `.xianix/operation-sources.yaml`
   - `.xianix/operation-sources.yml`
   - `compliance/operation-sources.yaml`
5. **Fallback:** a single implicit source `{ id: codebase, provider: git-repo, roles: [all], scope: < --scope or . > }`

If a declared file is missing, emit one error line and stop. If the fallback is used, say so in the report header (`Sources: implicit git-repo`).

---

## Fetch rules

For each **enabled** source:

1. Read `providers/<provider>.md`. If that file does not exist, mark the source `UNAVAILABLE` (`unknown provider`) and continue.
2. Check the provider's required env vars. If a required secret is missing, mark `UNAVAILABLE` and continue — do not fail the whole 8.1 run.
3. Fetch only what the declared **roles** and queries need. Do not crawl the entire Jira site or wiki.
4. Normalize each artifact to:

```text
source-id: <id>
provider: <provider>
role: <role>
title: <human title>
locator: <URL or repo path>
excerpt: <short text used as evidence>
fetched-at: <ISO-8601>
```

5. If a source errors after auth succeeded, mark `UNAVAILABLE` with the error, keep the other sources.

Never write tokens into the report, YAML, or git.

---

## Built-in providers

| Provider | File | Typical 8.1 roles |
|---|---|---|
| `git-repo` | [git-repo.md](git-repo.md) | process-control, acceptance-criteria |
| `jira` | [jira.md](jira.md) | product-service-requirements, process-control, planned-changes |
| `clickup` | [clickup.md](clickup.md) | product-service-requirements, process-control |
| `confluence` | [confluence.md](confluence.md) | process-definitions, documented-information |
| `generic` | [generic.md](generic.md) | any — local files, pasted URLs, unknown tools |

Add a new vendor by adding `providers/<name>.md` and pointing a source at `provider: <name>`. Skills do not change.

Project authors copy [../docs/operation-sources.example.yaml](../docs/operation-sources.example.yaml) into `.xianix/operation-sources.yaml`. Webhook wiring: [../docs/rules-examples.md](../docs/rules-examples.md). Scheduled (cron) drop-in: [../docs/rules-schedule.json](../docs/rules-schedule.json) / [../docs/rules-schedule.md](../docs/rules-schedule.md).
