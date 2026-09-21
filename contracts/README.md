# Compliance contracts

Machine-readable contracts between compliance skills (this repository) and 99x AI Hub. They are standard-agnostic: ISO 9001 clause 8.1 is the first user, but nothing in them is specific to it.

| Contract | File | Written by | Read by |
|---|---|---|---|
| Compliance report | [`schemas/compliance-report.v1.schema.json`](schemas/compliance-report.v1.schema.json) | A skill, as `report.json` next to its Markdown report. One execution may assess several controls. | The publisher |
| Compliance event | [`schemas/compliance-event.v1.schema.json`](schemas/compliance-event.v1.schema.json) | The publisher — one event per control assessed | AI Hub activity-scoped ingest (Hub event shape, blank mapping) |
| Control catalogue | [`schemas/control-catalog.v1.schema.json`](schemas/control-catalog.v1.schema.json) | Plugin releases (`catalogs/`) | AI Hub dashboards (planned controls, roll-ups) |
| Shared definitions | [`schemas/compliance-common.v1.schema.json`](schemas/compliance-common.v1.schema.json) | — | All of the above |

## Rules the contracts encode

- **One event per control assessed.** All events of one execution share `correlationId` (the execution id). `eventId` is `<standardKey>:<control>:<repository>:<executionId>`, so retries are de-duplicated.
- **Order by `runAt`**, the time the audit ran — never by ingest time.
- **Four-level verdict scale**: `Conform`, `Partial`, `Gap`, `N/A`. A skill that uses other wording keeps it in `originalVerdict`.
- **The skill owns the overall verdict and the `core` flags.** The Hub stores them as reported.
- **Queryable facts go in `dimensions`** (counts, `p0Actions`, source confidence, `controlGroup` for roll-ups). Everything else is payload for detail views.
- **Usage belongs to the execution**: `tokens` / `costUsd` sit on the first event only, so usage rollups never double count.
- **Report-specific tables are generic `sections`**, so a new control needs no UI code. `reportMd` (≤ 200 KB) is always there as a fallback.
- **Evidence has a `kind`** (path, commit, command, issue, page, url, external) and must cite a declared source unless it is `external`. Links are `http(s)` only.
- **Confidence is explicit**: `sourcesMode` (`declared` or `implicit-git-repo`), source verdicts, and `notAssessed`.

## Samples

| Sample | Why it's here |
|---|---|
| `samples/reports/iso-9001-2015--8.1--hub-service.json` | Real 8.1 run on `example-org/hub-service` — overall **Gap** |
| `samples/reports/iso-9001-2015--8.1--the-agent.json` | Real 8.1 run on `xianix-team/the-agent` — overall **Partial** |
| `samples/reports/iso-27001-2022--multi--synthetic.json` | Synthetic: a second standard, two controls in one execution, an unavailable source, `originalVerdict`, and usage placeholders |
| `samples/events/*.json` | Golden events — generated from the reports by the reference flattener and checked for drift |
| `samples/invalid/*.json` | Negative cases; `expectations.json` lists the reason each must be rejected for |

The two real samples came from local runs of the 8.1 skill on 2026-09-21 (implicit git-repo sources only). `catalogs/iso-27001-2022.sample.json` is test data (`coverage: sample`), not a real catalogue.

## Fitness functions

| Id | Guarantees | Where |
|---|---|---|
| F1 | Catalogues, reports and events satisfy the schemas and the semantic rules; golden events equal `flatten(report)`; every invalid sample is rejected for its expected reason | `npm run validate` |
| F2 | Released schemas are immutable: a change must ship as `…v2.schema.json`. On pull requests, lock entries from the base branch can't be edited or removed | `npm run schemas:check` |
| F3 | One event per control, shared `correlationId`, `runAt` present, usage on one event only; provenance comes from the environment and git, never from the skill | `npm test` |
| F4 | No secret leaves the run: secret-looking env values and known token formats are redacted from the events, the fallback comment and the logs | `npm test` |
| F14 (contract side) | A non-8.1 standard, other obligation counts and multi-control runs validate with no code changes | `npm test` |

## Publisher

`plugins/operation/scripts/publish-aihub.mjs` turns a skill's `compliance-report.json` into events: it fills provenance (execution id, plugin version, repository, commit), redacts secrets, validates against these contracts, writes `aihub-event.json`, and — with `AIHUB_PUBLISH=1` — POSTs to AI Hub with retry and a GitHub issue-comment fallback. It is **generated** from `tools/lib` and `tools/publisher-entry.mjs` by `npm run build:publisher`, as one dependency-free file (installed plugins carry no `node_modules`). CI fails if the committed bundle is out of date, and `test/bundle.test.mjs` runs the bundle itself against a local HTTP server.

## Working with the contracts

```bash
cd tools
npm ci
npm run ci                              # everything CI runs
npm run validate -- --update-golden     # after changing a sample report or the flattener
npm run schemas:lock                    # when a NEW schema file is ready to release
```

To change a released schema, copy it to the next version (`compliance-event.v2.schema.json`), update its `$id`, and lock it. Consumers route by `dimensions.schema`, so v1 and v2 events can coexist.
