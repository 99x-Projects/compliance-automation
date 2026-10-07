# 8.1 Operational Planning and Control — Report Template

The `8-1-operational-planning-and-control` skill must follow this format exactly when writing `iso-9001-8.1-operational-planning-and-control.md`.

Fill every header field with concrete values — no `TBD`, no placeholders. Cite repository paths. Do not paste ISO standard wording.

---

## ISO 9001:2015 — 8.1 Operational planning and control

**Standard / control:** ISO 9001:2015, 8.1 Operational planning and control
**Repository:** `<owner/repo>` or local path
**Baseline:** `<branch>` @ `<short-sha>`
**Sources file:** [`--sources` / `.xianix/operation-sources.yaml` / `rule sources-config` / `implicit git-repo`]
**Git scope:** [`--scope` value, or `full repository`]
**Products / services in scope:** [named list]
**Processes in scope:** [named list]
**Report date:** `<YYYY-MM-DD>`
**Overall 8.1 status:** `Conform` | `Partial` | `Gap`

---

### Sources used

Every configured source must appear. `UNAVAILABLE` is not a silent skip.

| Id | Provider | Roles | Verdict | Artifacts | Notes |
|---|---|---|---|---|---|
| codebase | git-repo | process-control, … | ok | 12 | |
| qms-wiki | confluence | documented-information, … | UNAVAILABLE | 0 | ATLASSIAN-API-TOKEN missing |
| delivery | jira | product-service-requirements, … | ok | 18 | |

---

### Summary

[3–6 sentences: what the organization delivers, how operations are planned and controlled today, whether planning outputs are usable by operations, and the main gaps.]

---

### Obligation scores

Score each row from evidence in this run. Core obligations 1–7 drive overall status (worst of Conform / Partial / Gap; ignore N/A).

| # | Obligation | Verdict | Evidence (path or `not found`) | Gap to close |
|---|---|---|---|---|
| 1 | Product and service requirements determined | | | |
| 2 | Criteria for processes established | | | |
| 3 | Criteria for acceptance of products and services established | | | |
| 4 | Resources needed for conformity determined | | | |
| 5 | Processes controlled in accordance with the criteria | | | |
| 6 | Documented information for confidence that processes ran as planned | | | |
| 7 | Documented information demonstrating product/service conformity | | | |
| 8 | Planning outputs suitable for operations | | | |
| 9 | Planned changes controlled | | | |
| 10 | Unintended changes reviewed; adverse effects mitigated | | | |
| 11 | Outsourced processes identified (8.4 handoff only) | | | |

---

### Product and service requirements

[How requirements were determined. Table of requirement sources.]

| Product / service | Requirement source (locator) | Type (customer / statutory / internal) | Linked acceptance | Status |
|---|---|---|---|---|
| | `jira://delivery/APP-12` or `path` | | | determined / implicit / missing |

---

### Process criteria

[One subsection or table row per in-scope process.]

| Process | Owner | Entry conditions | Sequence / method | Measures / gates | Output | Criteria status |
|---|---|---|---|---|---|---|
| | | | | | | |

---

### Acceptance criteria

| Output (product / service) | Acceptance criterion | Who accepts | Record produced | Linked requirement | Status |
|---|---|---|---|---|---|
| | | | | | |

---

### Resources needed for conformity

| Resource | Kind (people / skill / tool / environment / information) | Process it supports | Evidence | Determined? |
|---|---|---|---|---|
| | | | | yes / no |

---

### Process control map

| Process | Criterion | Control that enforces it | Evidence (locator) | Verdict |
|---|---|---|---|---|
| | | pipeline / review / SOP / workflow / none | wiki URL, issue, or `path` | Conform / Partial / Gap |

---

### Documented information inventory

**Maintain** (current definitions, criteria, plans):

| Title | Purpose | Location | Owner | Status |
|---|---|---|---|---|
| | | | | present / missing |

**Retain** (records that a process ran as planned, and that output conformed):

| Record | Demonstrates (process planned / conformity) | Location | Retention (if stated) | Status |
|---|---|---|---|---|
| | | | | present / missing |

---

### Change control

**Planned changes**

[How intended operational changes are controlled. Cite RFC/ADR, release, pipeline, or `not found`.]

**Unintended changes**

[How unexpected changes are detected, reviewed, and mitigated. Cite incident/hotfix/rollback evidence or `not found`.]

---

### Outsourced processes (8.4 handoff)

> Not assessed under 8.4 in this report. Listed so a future 8.4 skill can take over.

| Process | Provider (if known) | Current control (if any) | Residual 8.4 work |
|---|---|---|---|
| | | | |

*(If none identified: "No outsourced processes identified in the scoped evidence.")*

---

### Recommended actions

Ordered by 8.1 impact. Each action must close a named gap in the obligation table, and every obligation scored Partial or Gap must be closed by at least one action (P3 for a minor one). Only Conform and N/A obligations may have none.

| Priority | Action | Closes obligation # | Suggested artifact |
|---|---|---|---|
| P0 | | | e.g. `compliance/iso-9001/8.1/process-criteria.md` |
| P1 | | | |

---

### Evidence assessed

List source locators used (wiki pages, issues, git paths). Note `--scope` misses and `UNAVAILABLE` sources without failing the run.
