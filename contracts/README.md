# Compliance contracts

Machine-readable contracts between compliance skills (this repository) and 99x AI Hub. They are standard-agnostic: ISO 9001 clause 8.1 is the first user, but nothing in them is specific to it.

| Contract | File | Written by | Read by |
|---|---|---|---|
| Compliance report | [`schemas/compliance-report.v1.schema.json`](schemas/compliance-report.v1.schema.json) | A skill, as `report.json` next to its Markdown report. One execution may assess several controls. | The publisher |
| Compliance event | [`schemas/compliance-event.v2.schema.json`](schemas/compliance-event.v2.schema.json) (`dimensions.schema: "compliance.v2"`) | The publisher — one **summary** event per control assessed | AI Hub activity-scoped ingest (Hub event shape, blank mapping) |
| Detailed report | One Markdown report per control, stored as an **AI Hub artifact** (kind `report`, key = the control's `eventId`). With `COMPLIANCE_DETAIL_STORE=github` instead: `audits/<standardKey>/<runAt>--<executionId>/` on the `compliance-audits` branch, holding the full `compliance-report.json` plus `<control>.md` | The publisher | People, through the link in each event's `detail` |
| Control catalogue | [`schemas/control-catalog.v1.schema.json`](schemas/control-catalog.v1.schema.json) | Plugin releases (`catalogs/`) | AI Hub dashboards (planned controls, roll-ups) |
| Shared definitions | [`schemas/compliance-common.v1.schema.json`](schemas/compliance-common.v1.schema.json) | — | All of the above |

## Rules the contracts encode

- **Events are the summary; the detailed report is stored beside them.** An event carries what dashboards need — verdict counts, per-obligation verdicts with a gap line (≤ 300 characters) and an evidence count, actions, source status. The Markdown report, with its evidence, is uploaded to AI Hub as a write-once artifact and linked by `detail`: the artifact id plus the SHA-256 of the stored bytes. It is readable by whoever can read the team's events, and never edited or deleted. Nothing is written to the audited repository, which is usually the customer's; `COMPLIANCE_DETAIL_STORE=github` opts in to committing the report to a repository instead, linked by commit permalink. If storing fails, `detail.status` says so (`failed`, `disabled`, or `issue-comment` for the repository store) and the summary is still delivered.
- **Every event says how many the run sends** (`dimensions.runEvents`). AI Hub treats a run as incomplete until that many have arrived, so a half-delivered run is never shown as the latest one.
- **Each event stays under 16 KB.**
- **One event per control assessed.** All events of one execution share `correlationId` (the execution id). `eventId` is `<standardKey>:<control>:<repository>:<executionId>`, so retries are de-duplicated.
- **Order by `runAt`**, the time the audit ran — never by ingest time.
- **Four-level verdict scale**: `Conform`, `Partial`, `Gap`, `N/A`. A skill that uses other wording keeps it in `originalVerdict`.
- **The skill owns the overall verdict and the `core` flags.** The Hub stores them as reported.
- **Queryable facts go in `dimensions`** (counts, `p0Actions`, source confidence, `controlGroup` for roll-ups). Everything else is payload for detail views.
- **Usage belongs to the execution**: `tokens` / `costUsd` sit on the first event only, so usage rollups never double count.
- **Report-specific tables are generic `sections`** in the report, so a new control needs no new code. `reportMd` (≤ 200 KB) is always there.
- **Evidence has a `kind`** (path, commit, command, issue, page, url, external) and must cite a declared source unless it is `external`. Links are `http(s)` only.
- **Confidence is explicit**: `sourcesMode` (`declared` or `implicit-git-repo`), source verdicts, and `notAssessed`.

## Samples

| Sample | Why it's here |
|---|---|
| `samples/reports/iso-9001-2015--8.1--hub-service.json` | A real 8.1 run, anonymised: the product is renamed to `example-org/hub-service` and its paths, features, history and providers are made generic. Overall **Gap** |
| `samples/reports/iso-9001-2015--8.1--the-agent.json` | Real 8.1 run on `xianix-team/the-agent` — overall **Partial** |
| `samples/reports/iso-27001-2022--multi--synthetic.json` | Synthetic: a second standard, two controls in one execution, an unavailable source, `originalVerdict`, and usage placeholders |
| `samples/events/*.json` | Golden events — generated from the reports by the reference flattener and checked for drift. `legacy-v1--*.json` is a released v1 event, kept to prove old events still validate |
| `samples/invalid/*.json` | Negative cases; `expectations.json` lists the reason each must be rejected for |

The two real samples came from local runs of the 8.1 skill on 2026-09-21 (implicit git-repo sources only). `catalogs/iso-27001-2022.sample.json` is test data (`coverage: sample`), not a real catalogue.

## Fitness functions

| Id | Guarantees | Where |
|---|---|---|
| F1 | Catalogues, reports and events satisfy the schemas and the semantic rules; golden events equal `flatten(report)`; every invalid sample is rejected for its expected reason | `npm run validate` |
| F2 | Released schemas are immutable: a change must ship as `…v2.schema.json`. On pull requests, lock entries from the base branch can't be edited or removed | `npm run schemas:check` |
| F3 | One event per control, shared `correlationId`, `runAt` present, usage on one event only; provenance comes from the environment and git, never from the skill | `npm test` |
| F4 | No secret leaves the run: secret-looking env values and known token formats are redacted from the events, the stored detailed report (uploaded or committed), the fallback comments and the logs | `npm test` |
| F17 | Events are summaries: no evidence, sections or Markdown, and each event is under 16 KB | `npm run validate`, `npm test` |
| F18 | A stored detail names exactly one document and carries the SHA-256 of its bytes: an AI Hub artifact id, confirmed against the hash AI Hub returns — or, for the repository store, a commit permalink (never a branch) to the control's own file. An invalid report is never stored | `npm run validate`, `npm test` |
| F14 (contract side) | A non-8.1 standard, other obligation counts and multi-control runs validate with no code changes | `npm test` |

## Publisher

`plugins/operation/scripts/publish-aihub.mjs` turns a skill's `compliance-report.json` into events: it fills provenance (execution id, plugin version, repository, commit), redacts secrets, validates against these contracts, writes `aihub-event.json`, and — with `AIHUB_PUBLISH=1` — uploads each control's report to AI Hub's artifact store (idempotent by key, so a re-run stores nothing twice), then POSTs the summary to AI Hub with retry. With `COMPLIANCE_DETAIL_STORE=github` the report is committed through the GitHub Git Data API instead (new commit on `compliance-audits`, never forced, retried if another run moved the branch). If the summary cannot be delivered and a fallback issue is configured, it is preserved there as a comment. It is **generated** from `tools/lib` and `tools/publisher-entry.mjs` by `npm run build:publisher`, as one dependency-free file (installed plugins carry no `node_modules`). CI fails if the committed bundle is out of date, and `test/bundle.test.mjs` runs the bundle itself against a local HTTP server.

## Working with the contracts

```bash
cd tools
npm ci
npm run ci                              # everything CI runs
npm run validate -- --update-golden     # after changing a sample report or the flattener
npm run schemas:lock                    # when a NEW schema file is ready to release
```

To change a released schema, copy it to the next version (`compliance-event.v3.schema.json`), update its `$id`, and lock it. Consumers route by `dimensions.schema`, so events of different versions can coexist.

### Versions

| Event schema | `dimensions.schema` | What changed |
|---|---|---|
| `compliance-event.v1` | `compliance.v1` | First release. `detail` can only point at a repository commit |
| `compliance-event.v2` | `compliance.v2` | `dimensions.runEvents` is required; `detail.provider` may be `aihub` (an artifact id) as well as `github`. Everything else is unchanged |

The publisher writes v2. It still accepts v1 when re-sending events saved by an earlier version (`--from-file`, `--from-issue`); `samples/events/legacy-v1--*.json` keeps that path tested.
