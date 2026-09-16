# Provider: confluence

Use for **Atlassian Wiki / Confluence** pages (process maps, SOPs, QMS manuals). This is the usual home for 8.1 documented information that is not in git.

## Source fields

| Field | Required | Description |
|---|---|---|
| `site` | Yes | Base URL, e.g. `https://acme.atlassian.net` |
| `space-key` | Yes | Confluence space key (e.g. `QUALITY`) |
| `cql` | No | CQL to further restrict pages. Default: `space = <space-key>` |
| `root-pages` | No | Page titles to start from; fetch children one level unless `depth` says otherwise |
| `depth` | No | Child depth from `root-pages` (default `1`) |
| `max-pages` | No | Cap (default `40`) |

Example:

```yaml
- id: qms-wiki
  provider: confluence
  roles:
    - process-definitions
    - process-criteria
    - documented-information
    - resources
  site: https://acme.atlassian.net
  space-key: QUALITY
  cql: "space = QUALITY AND type = page AND (title ~ \"process\" OR title ~ \"SOP\" OR title ~ \"operational\")"
  root-pages:
    - "Quality Management System"
```

## Auth

Same Atlassian token as Jira when the site is shared:

| Env | Purpose |
|---|---|
| `ATLASSIAN-EMAIL` / `ATLASSIAN_EMAIL` | Account email |
| `ATLASSIAN-API-TOKEN` / `ATLASSIAN_API_TOKEN` | API token |

Aliases: `CONFLUENCE-EMAIL`, `CONFLUENCE-API-TOKEN`. If unset, mark `UNAVAILABLE` and continue.

## Fetch

Cloud Confluence CQL search, then expand body storage for each page (cap `max-pages`):

```bash
SITE="<site>"
CQL="<cql>"
EMAIL="${ATLASSIAN_EMAIL:-${ATLASSIAN-EMAIL:-}}"
TOKEN="${ATLASSIAN_API_TOKEN:-${ATLASSIAN-API-TOKEN:-}}"

curl -sS -u "${EMAIL}:${TOKEN}" \
  -H "Accept: application/json" \
  "${SITE}/wiki/rest/api/content/search?cql=$(python -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' "${CQL}")&limit=25&expand=body.storage,space,version,ancestors"
```

On Data Center, drop `/wiki` from the path if the search 404s (`/rest/api/content/search`).

Prefer `root-pages` + children over an unbounded space crawl. Strip HTML to text for excerpts; do not dump entire page HTML into the 8.1 report.

Locator: page URL (`${SITE}/wiki${_links.webui}` or DC equivalent).

## Mapping hints

| Page signal | Likely role |
|---|---|
| Process landscape, turtle diagrams, SIPOC | `process-definitions` |
| SOP / work instruction | `process-criteria` |
| Quality manual, controlled documents | `documented-information` |
| Resource / competency / environment pages | `resources` |
| Change control procedure | `planned-changes` |
| Nonconformity / incident procedure | `unintended-changes` |
| Purchasing / supplier pages | `outsourced-processes` |
