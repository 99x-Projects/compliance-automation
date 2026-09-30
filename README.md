# Compliance Automation

ISO 9001:2015 compliance automation plugins for Xianix. Each plugin maps to a clause family; each skill maps to one control so they can be added independently.

Evidence systems (Jira, ClickUp, Confluence, git, …) are **declared per consuming project**, not hard-coded in the plugin. See [plugins/operation/docs/sources.md](plugins/operation/docs/sources.md).

## Plugins

| Plugin | Clause | Status |
|---|---|---|
| [operation](plugins/operation) | 8 Operation | 8.1 skill available; multi-source providers; 8.2–8.7 planned |

## Contracts

Machine-readable report, event and control-catalogue schemas shared with 99x AI Hub live in [contracts/](contracts/README.md), with golden samples and contract checks (`tools/`, run in CI by `.github/workflows/contracts.yml`).

## Quick start

```bash
claude plugin marketplace add /path/to/compliance-automation
/plugin install operation@compliance-automation
/operation 8.1
```

For a recurring 8.1 check, merge [plugins/operation/docs/rules-schedule.json](plugins/operation/docs/rules-schedule.json) into the Xianix agent's `rules.json`. See [plugins/operation/docs/rules-schedule.md](plugins/operation/docs/rules-schedule.md).
