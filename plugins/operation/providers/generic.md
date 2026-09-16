# Provider: generic

Use when evidence is a **local path**, a **public URL**, or a tool this plugin does not wrap yet (SharePoint, Notion, GitLab issues, Azure DevOps Wiki, …).

## Source fields

| Field | Required | Description |
|---|---|---|
| `paths` | One of paths / urls / notes | Files in the clone |
| `urls` | One of | HTTP(S) URLs the agent may GET without extra auth |
| `notes` | One of | Literal operator-supplied text (from the rule prompt) — last resort |
| `auth-env` | No | Name of an extra bearer token env var if `urls` need it |

Example:

```yaml
- id: sharepoint-qms
  provider: generic
  roles:
    - documented-information
  urls:
    - "https://intranet.example.com/qms/operational-planning.pdf"
  notes: "Controlled copy; treat as maintained documented information."
```

## Fetch

- `paths` — `Read` those files (must exist in the clone).
- `urls` — GET only if the URL is in the source list. Do not follow arbitrary links. If `auth-env` is set and empty, mark `UNAVAILABLE`.
- `notes` — treat as operator evidence; cite `generic://<id>/notes`.

If a new vendor is used in more than one project, promote it to a first-class `providers/<name>.md` instead of growing `generic` notes.
