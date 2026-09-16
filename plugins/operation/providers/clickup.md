# Provider: clickup

Use when the project tracks work in **ClickUp** instead of (or as well as) Jira.

## Source fields

| Field | Required | Description |
|---|---|---|
| `list-id` | One of list / folder / space | ClickUp list to read |
| `folder-id` | One of | Folder to read |
| `space-id` | One of | Space to read (prefer list or folder — spaces can be large) |
| `statuses` | No | Status names to include |
| `include-closed` | No | Default `false` |
| `max-results` | No | Cap (default `50`) |

Example:

```yaml
- id: ops-tasks
  provider: clickup
  roles:
    - product-service-requirements
    - process-control
  list-id: "123456789"
  include-closed: false
```

## Auth

| Env | Purpose |
|---|---|
| `CLICKUP-TOKEN` / `CLICKUP_TOKEN` | ClickUp personal or workspace token |

If unset, mark this source `UNAVAILABLE` and continue.

## Fetch

```bash
TOKEN="${CLICKUP_TOKEN:-${CLICKUP-TOKEN:-}}"
LIST_ID="<list-id>"

curl -sS -H "Authorization: ${TOKEN}" \
  "https://api.clickup.com/api/v2/list/${LIST_ID}/task?include_closed=false"
```

Use the folder or space task endpoints when `list-id` is absent. Do not page past `max-results`.

Locator: task URL from the payload (`url` field).

## Mapping hints

| ClickUp signal | Likely role |
|---|---|
| Task name + description in a product list | `product-service-requirements` |
| Custom field "Acceptance" / checklist | `acceptance-criteria` |
| Status workflow, required assignees | `process-control` |
| Docs attached to the list | `documented-information` (fetch via ClickUp Docs API only if linked) |
| Change / release lists | `planned-changes` |
