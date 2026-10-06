---
name: 8-1-operational-planning-and-control
description: >-
  Assess and produce ISO 9001:2015 control 8.1 Operational planning and control
  evidence from configured project sources (git, Jira, ClickUp, Confluence/wiki,
  or generic URLs). Determines product and service requirements, process and
  acceptance criteria, resources, process controls, documented information,
  change control, and outsourced-process handoff. Use when the user asks for
  ISO 9001 8.1, operational planning and control, Clause 8 Operation, QMS
  process planning, or /operation 8.1.
argument-hint: "[--sources <path>] [--scope <path>]"
---

Assess **ISO 9001:2015 8.1 Operational planning and control** and write a planning-and-control report. This skill covers **8.1 only**. Do not assess 8.2–8.7 here; inventory outsourced work and point it at future 8.4.

Parse `$ARGUMENTS` for `--sources <path>` and `--scope <path>`. Also honor:

- Webhook interpolations `sources-file` / `sources-config` when present
- Env `OPERATION_SOURCES_FILE` or `OPERATION_SOURCES` (required on **scheduled** runs, which have no `use-inputs`)

**Do not treat `git remote` as the only evidence system.** 8.1 usually needs several sources at once (wiki + task tracker + git). Read `providers/_source-contract.md` first, resolve the source list, then fetch.

On a scheduled run there is no issue or work item. Do not wait for labels. Write the report; publishing to AI Hub follows the command's *Publishing to AI Hub* steps whenever `AIHUB_PUBLISH` (or `AIHUB-PUBLISH`) is `1`, whether or not the prompt mentions it. Never commit, push or open a pull request for the report.

Do not copy ISO standard text into the report. Use the assessment checklist below in your own words.

## What 8.1 requires (assessment lens)

Plan, implement, and control the processes needed to deliver products and services and to carry out Clause 6 actions (risks, opportunities, quality objectives), by checking that the organization:

1. **Product and service requirements** — requirements for what is delivered are determined.
2. **Process criteria** — criteria exist for how those processes run.
3. **Acceptance criteria** — criteria exist for accepting products and services.
4. **Resources** — resources needed for conformity are determined.
5. **Process control** — processes are controlled against those criteria.
6. **Documented information** — records are determined, maintained, and retained so the organization can:
   - be confident processes were carried out as planned
   - demonstrate product and service conformity
7. **Suitable planning outputs** — the plan is usable by operations (not a generic policy with no owners, criteria, or records).
8. **Planned changes** — intended changes to operations are controlled.
9. **Unintended changes** — consequences are reviewed and adverse effects are mitigated as needed.
10. **Outsourced processes** — processes performed by others are identified and flagged for 8.4 control (do not complete 8.4 in this skill).

Tie process discovery to QMS process thinking (Clause 4.4) and planning actions (Clause 6) only as context — do not run those clauses.

## Workflow

Copy and complete:

```
8.1 Progress:
- [ ] 0. Resolve and fetch evidence sources
- [ ] 1. Index the organization and process landscape
- [ ] 2. Determine product and service requirements
- [ ] 3. Establish process criteria
- [ ] 4. Establish acceptance criteria
- [ ] 5. Determine resources for conformity
- [ ] 6. Map process controls to criteria
- [ ] 7. Inventory documented information
- [ ] 8. Assess planned and unintended change handling
- [ ] 9. Inventory outsourced processes (8.4 handoff)
- [ ] 10. Score each obligation and write the report
- [ ] 11. Write compliance-report.json and run the publisher
```

### 0. Resolve and fetch evidence sources

Follow the resolution order and fetch rules in `providers/_source-contract.md`.

For each enabled source, read `providers/<provider>.md` and fetch. Merge artifacts **by role**. Cite locators as `provider://source-id/…` (issue URL, wiki URL, or repo path).

Record a source table for the report header: id, provider, roles, verdict (`ok` / `UNAVAILABLE` / `empty`), artifact count.

`--scope` applies only to `git-repo` (and to the implicit git fallback). It does not disable Jira, ClickUp, or Confluence sources.

### 1. Index the organization and process landscape

Build the landscape from **all fetched roles**, not only git.

When a `git-repo` source (or fallback) is in play, also look in the clone:

| Signal | Typical git locations (if that role is on git-repo) |
|---|---|
| Products / services | `README*`, `docs/`, product specs, API docs, package manifests |
| Process definitions | `docs/`, `processes/`, `qms/`, `quality/`, SOPs, runbooks |
| Process control in engineering | CI/CD (`.github/workflows`, `azure-pipelines*`, `Jenkinsfile`), CODEOWNERS, review templates |
| Acceptance | tests, e2e, QA checklists, Definition of Done |
| Resources | runbooks, on-call, capacity, `docs/ops/` |
| Change control | `CHANGELOG*`, RFC/ADR, release docs |
| Outsourcing | `vendor/`, `NOTICE`, `LICENSE*`, SaaS mentions |
| Clause 6 actions | risk registers, quality objectives |

Ignore `node_modules/`, `dist/`, `build/`, `.git/`.

Record: products/services, in-scope processes, owners if named, and which **source locators** evidence each.

### 2. Determine product and service requirements

Extract **what** the organization delivers and the requirements those outputs must meet (functional, statutory/regulatory if present, customer, internal).

Cite locators (wiki page, Jira/ClickUp issue, or file). If requirements are implicit (README + tests only), mark **Partial** and list what is missing (named requirement set, version, acceptance linkage).

### 3. Establish process criteria

For each in-scope process, capture criteria such as:

- entry / start conditions
- sequence or workflow
- roles / responsibilities
- methods, tools, or environments
- measures or thresholds (cycle time, defect rate, coverage gates) when they exist
- output of the process

If a process exists only as tribal knowledge or a pipeline with no written criteria, mark **Gap** or **Partial**.

### 4. Establish acceptance criteria

Capture how products and services are accepted before delivery / release:

- Definition of Done, PR checks, test gates, QA sign-off, customer acceptance
- Who accepts, against which requirement, with which record

Link each acceptance criterion to a product/service requirement from step 2 when possible.

### 5. Determine resources for conformity

List people, skills, infrastructure, tools, environments, and information needed so outputs can conform. Use wiki/SOP sources, git ops docs, and what the processes actually depend on (CI runners, staging, licenses). Flag undetermined resources as **Gap**.

### 6. Map process controls to criteria

For each process criterion, find the **control** that enforces it (pipeline job, required review, SOP step, checklist, environment protection).

Verdict:

- **Conform** — criterion exists and a control enforces it
- **Partial** — criterion or control exists, but they are not aligned
- **Gap** — process runs without criteria or without control
- **N/A** — process is out of scope with a one-line reason

### 7. Inventory documented information

Determine what must be **maintained** (current process definitions, criteria, plans) and **retained** (records that a run happened and that output conformed).

For each item: title, purpose (confidence in process **or** conformity evidence), location, owner if known, retention if stated, gap if missing.

The plan is only complete if operations can actually use it: named processes, criteria, controls, records, and owners — not a restatement of the clause.

### 8. Assess planned and unintended change handling

**Planned changes:** RFC/ADR, change tickets, release process, feature flags, pipeline changes with review.

**Unintended changes:** incident review, hotfix process, rollback, post-incident actions, monitoring that detects drift.

Score whether planned changes are controlled, and whether unintended changes are reviewed with mitigation. Missing both is a **Gap**.

### 9. Inventory outsourced processes (8.4 handoff)

List processes performed outside the organization (cloud, payroll, contract development, managed services, critical SaaS). For each: process, provider if known, what is controlled today, residual 8.4 work. Do **not** produce an 8.4 assessment.

### 10. Score and write the report

Read `styles/report-template.md` and write:

`iso-9001-8.1-operational-planning-and-control.md`

at the repository root (or under `--scope` if that path is a docs/QMS tree the user is clearly using as the QMS). Follow the template exactly.

Scoring:

| Verdict | Meaning |
|---|---|
| Conform | Evidence exists and meets the obligation |
| Partial | Some evidence; missing criteria, control, owner, or record |
| Gap | Obligation not evidenced |
| N/A | Not applicable, with reason |

Overall 8.1 status = worst of obligations 1–9, except N/A is ignored. If any core obligation (1–7) is Gap, overall is Gap.

### 11. Write the structured report and run the publisher

Read `styles/report-json.md` and write `compliance-report.json` next to the Markdown report: the same verdicts, evidence and actions, as JSON. Obligations 1–7 are `core: true`. Leave `executionId` and `pluginVersion` as `"pending"`.

Then run the publisher as described in the `/operation` command (**Publishing to AI Hub**). It validates the JSON against the contract every time, and sends it to AI Hub only when publishing is enabled. On exit code `2`, fix `compliance-report.json` from the printed errors and run it once more.

## Invariants

- 8.1 only — no 8.2–8.7 scoring.
- Every finding cites a source locator (or `not found`).
- Do not invent metrics, owners, or ISO certificates.
- Do not paste copyrighted standard wording.
- Do not put secrets in the report or in git. Do not commit or push the report yourself; the publisher stores it.
- Do not crawl undeclared systems (no extra Jira projects or wiki spaces).
- Do not modify product source to "become compliant". Report and optional stubs under `compliance/iso-9001/8.1/` only if the user asked to create QMS files or that tree already exists.
- Missing optional provider secrets → that source `UNAVAILABLE`, continue.
- If no source file exists, use implicit `git-repo` and say so in the header.
- `compliance-report.json` must match the Markdown report exactly; never invent `executionId`, `pluginVersion`, commit or repository values.

## Output

Write the report and `compliance-report.json`, run the publisher, then one confirmation line:

```
8.1 operational planning and control report: <path> — overall <Conform|Partial|Gap> — AI Hub: <delivered | preserved in <issue comment URL> | not sent (publishing off) | failed: <reason>>
```
