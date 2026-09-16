# Evidence sources

The Operation plugin is installed into **existing Xianix projects**. Each project names its own evidence systems. The plugin does not assume Jira, ClickUp, or Confluence — it only knows how to talk to them **if the project (or the rule) says so**.

```
Project YAML or rule  →  roles + provider ids
Plugin providers/     →  how to fetch
Rule with-envs        →  tokens
Skill                 →  merge by role, score 8.1
```

Full contract: [../providers/_source-contract.md](../providers/_source-contract.md).

---

## What to put where

| Put this | Here | Why |
|---|---|---|
| Jira site, JQL, Confluence space, ClickUp list id, git scope | **Project file** `.xianix/operation-sources.yaml` | Versioned with the product, reviewable, different per repo |
| Same structure, when the product repo must not hold QMS pointers | **Xianix rule** `use-inputs` `sources-config` (constant YAML/JSON) | Tenant-level override |
| API tokens, Atlassian email | **Xianix rule** `with-envs` → `secrets.*` | Never committed |
| How to call Jira / ClickUp / Confluence | **This plugin** `providers/` | Shared; add a vendor once |

Do **not** put source URLs only in `execute-prompt` prose. The skill cannot reliably parse free text, and two projects will drift.

---

## Project file (preferred)

In the consuming repository:

```text
.xianix/operation-sources.yaml
```

Start from [operation-sources.example.yaml](operation-sources.example.yaml). Enable only the sources that project actually uses (`enabled: false` to keep a template row).

A project that has Confluence + Jira + git typically declares **three** sources. A project that only has git omits the file; the skill falls back to `git-repo`.

---

## Rule-level sources (optional)

When the YAML cannot live in the product repo, pass it as a constant input (schedule and webhook both support `constant: true`):

```json
{
  "name": "sources-file",
  "value": ".xianix/operation-sources.yaml",
  "constant": true
}
```

Or inline JSON in `sources-config` (same schema as the YAML `sources` array). Inline config is harder to review — prefer the file.

See [rules-examples.md](rules-examples.md) for a full execution block.

---

## Multiple sources for one skill

That is the normal case. Example 8.1 split:

| Role | Typical source |
|---|---|
| Product/service requirements | Jira or ClickUp |
| Process definitions and documented information | Confluence (Atlassian Wiki) |
| Process control and acceptance gates | git-repo (CI, tests) |
| Planned changes | Jira change tickets **and/or** git ADRs |

The skill **merges** evidence per role. A gap is only a gap if **no** configured source could supply that role, or every source that declared the role was `UNAVAILABLE` / empty.

If Confluence is configured but the token is missing, score documented-information from git if git also has that role; otherwise mark the Confluence source `UNAVAILABLE` and the obligation **Partial** or **Gap** with that reason.

---

## Adding a vendor later

1. Add `providers/<vendor>.md` (auth env, source fields, fetch, locators).
2. Point a source at `provider: <vendor>`.
3. No change to 8.1 skill logic beyond "read the provider file".
