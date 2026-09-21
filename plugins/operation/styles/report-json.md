# Structured report — `compliance-report.json`

Every control skill writes this file next to its Markdown report. It is the machine-readable twin of the Markdown: **same verdicts, same evidence, same actions** — never different content. The contract is [`contracts/schemas/compliance-report.v1.schema.json`](../../../contracts/schemas/compliance-report.v1.schema.json).

The publisher (`scripts/publish-aihub.mjs`) validates it, fills in provenance, removes secrets, and turns it into AI Hub events.

---

## Where

`compliance-report.json` in the same folder as the Markdown report.

If the file already exists **from this execution** (another control ran first), add your control to its `controls` array and keep everything else. If it exists from an earlier run, replace it.

## What you write, and what the publisher fills in

| Field | Who | Value |
|---|---|---|
| `schema` | you | `"compliance-report.v1"` |
| `standard`, `standardKey` | you | `"ISO 9001:2015"`, `"iso-9001-2015"` |
| `repository`, `baseline` | you (best effort) — **publisher overwrites** from git | `owner/repo`, `{ "ref": "<branch>", "commit": "<short sha>" }` |
| `runAt` | you | Current UTC time, `YYYY-MM-DDTHH:MM:SSZ`. Publisher sets it if missing. |
| `executionId`, `pluginVersion` | **publisher** | Write `"pending"` for both. Never invent values. |
| `scope` | you | `{ "sourcesMode": "declared" \| "implicit-git-repo", "sourcesFile": "<path, if any>", "gitScope": "<--scope or full repository>" }` |
| `sources` | you | One entry per row of **Sources used**: `id`, `provider`, `roles` (array), `verdict` (`ok` / `UNAVAILABLE` / `empty`), `artifacts` (number), optional `note` |
| `notAssessed` | you | What the audit knowingly could not see: undeclared systems referenced by evidence (e.g. a ticket key prefix), repository settings not visible in the clone, uncommitted changes. `[]` if none. |
| `controls` | you | One object per control — below |

## One control

| Field | Value |
|---|---|
| `control` / `controlTitle` / `controlGroup` | For 8.1: `"8.1"`, `"Operational planning and control"`, `"8"` — exactly as in the control catalogue |
| `overall` | The report's **Overall status** |
| `summary` | The **Summary** paragraph |
| `obligations` | One per row of **Obligation scores** — see below |
| `actions` | One per row of **Recommended actions**: `priority` (`P0`–`P3`), `text`, `closes` (obligation numbers as integers), optional `artifact` |
| `sections` | Every other table in the report, in order: `{ "id": "<kebab-case of the heading>", "title": "<heading>", "kind": "table", "columns": [...], "rows": [[...], ...] }`. Paragraph-only parts (e.g. **Change control**) as `{ "kind": "text", "text": "..." }`. Plain text in cells — no Markdown. |
| `reportMd` | The complete Markdown report. Don't paste it by hand: write `"@@REPORT_MD@@"`, then embed the file with `jq --rawfile md <report>.md '.controls[-1].reportMd = $md' compliance-report.json > tmp.json && mv tmp.json compliance-report.json` |

## One obligation

| Field | Value |
|---|---|
| `n` | Row number (integer) |
| `title` | Obligation text from the table |
| `core` | For 8.1: `true` for obligations 1–7, `false` for 8–11 |
| `verdict` | `Conform`, `Partial`, `Gap` or `N/A` — nothing else |
| `originalVerdict` | Only if you used other wording in the Markdown |
| `evidence` | One entry per locator in the **Evidence** cell — below. `[]` when the cell says `not found`. |
| `gap` | The **Gap to close** text; `""` when there is nothing to close |

## One evidence entry

| Field | Value |
|---|---|
| `provider` | The source's provider (`git-repo`, `jira`, `confluence`, …) |
| `sourceId` | The source `id` from `sources`. Must match one, unless `kind` is `external`. |
| `kind` | `path` (repo file, optionally `path:line`), `commit`, `command` (e.g. a `git log` query), `issue`, `page`, `url`, or `external` (a system you could not read, e.g. CI run history) |
| `locator` | What you cited, as written in the report |
| `url` | Optional, `https://` only |

---

## Rules

- **Same content as the Markdown.** If they disagree, the Markdown is wrong too — fix both.
- **No secrets.** Never copy tokens, passwords or connection strings into any field. The publisher redacts known formats, but do not rely on it.
- **No invented provenance.** `executionId` and `pluginVersion` stay `"pending"`.
- **Validate before you finish.** Run the publisher (see the `/operation` command). Exit code `2` means the JSON breaks the contract: read the errors, fix `compliance-report.json`, and run it once more.
