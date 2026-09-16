# Provider: jira

Use when the project tracks operational work, requirements, or change tickets in **Jira Cloud** (or Jira Data Center with the same REST shape).

## Source fields

| Field | Required | Description |
|---|---|---|
| `site` | Yes | Base URL, e.g. `https://acme.atlassian.net` |
| `jql` | Yes | Restricting JQL. Never search the whole site. |
| `fields` | No | Extra Jira fields to request. Default: summary, description, status, issuetype, labels, acceptance criteria if present. |
| `max-results` | No | Cap (default `50`). |

Example:

```yaml
- id: delivery
  provider: jira
  roles:
    - product-service-requirements
    - acceptance-criteria
    - process-control
    - planned-changes
  site: https://acme.atlassian.net
  jql: "project = APP AND labels = qms AND statusCategory != Done"
```

## Auth

Required (either hyphen or underscore form):

| Env | Purpose |
|---|---|
| `ATLASSIAN-EMAIL` / `ATLASSIAN_EMAIL` | Atlassian account email |
| `ATLASSIAN-API-TOKEN` / `ATLASSIAN_API_TOKEN` | API token |

Optional aliases: `JIRA-EMAIL`, `JIRA-API-TOKEN`. If none are set, mark this source `UNAVAILABLE` and continue.

Do not print the token. Use HTTP basic auth (`email:token`).

## Fetch

Jira Cloud search (POST). Adjust the path if the site is Data Center (`/rest/api/2/search`).

```bash
SITE="<site>"
JQL="<jql>"
EMAIL="${ATLASSIAN_EMAIL:-${ATLASSIAN-EMAIL:-}}"
TOKEN="${ATLASSIAN_API_TOKEN:-${ATLASSIAN-API-TOKEN:-}}"

curl -sS -u "${EMAIL}:${TOKEN}" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -X POST "${SITE}/rest/api/3/search/jql" \
  -d "{\"jql\":\"${JQL}\",\"maxResults\":50,\"fields\":[\"summary\",\"description\",\"status\",\"issuetype\",\"labels\"]}"
```

For each issue, emit one artifact per mapped role that the issue actually supports (a Story with acceptance criteria fills `product-service-requirements` and `acceptance-criteria`; a Change ticket fills `planned-changes`).

Locator: issue URL (`${SITE}/browse/${KEY}`).

## Mapping hints

| Jira signal | Likely role |
|---|---|
| Story / Requirement / Epic | `product-service-requirements` |
| Acceptance Criteria field, BDD text | `acceptance-criteria` |
| Workflow, required checks, definition of done | `process-control` / `process-criteria` |
| Change / RFC issue type | `planned-changes` |
| Incident / Problem | `unintended-changes` |
| Vendor / procurement labels | `outsourced-processes` |
