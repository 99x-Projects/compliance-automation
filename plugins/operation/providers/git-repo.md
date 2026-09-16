# Provider: git-repo

Use for evidence that already lives in the cloned repository (SOPs, pipelines, tests, ADRs). Always available; no extra secret.

## Source fields

| Field | Required | Description |
|---|---|---|
| `scope` | No | Directory, glob, or comma-separated list relative to the repo root. Default: `.` (or the `/operation --scope` value). |
| `paths` | No | Explicit file list. If set, takes precedence over `scope`. |

Example:

```yaml
- id: codebase
  provider: git-repo
  roles:
    - process-control
    - acceptance-criteria
    - planned-changes
  scope: "."
```

## Fetch

Respect `scope` / `paths`. Ignore `node_modules/`, `dist/`, `build/`, `.git/`.

Map typical repo artifacts to roles:

| Role | Typical paths |
|---|---|
| `product-service-requirements` | `README*`, `docs/`, OpenAPI, product specs |
| `process-definitions` | `docs/`, `processes/`, `qms/`, `quality/`, runbooks |
| `process-criteria` | same as process-definitions, plus pipeline YAML |
| `acceptance-criteria` | tests, e2e, Definition of Done, PR templates |
| `resources` | `docs/ops/`, on-call, environment docs |
| `process-control` | `.github/workflows`, `azure-pipelines*`, `Jenkinsfile`, CODEOWNERS |
| `documented-information` | QMS folders, `compliance/` |
| `planned-changes` | `CHANGELOG*`, RFC/ADR, release docs |
| `unintended-changes` | incident/hotfix/rollback docs |
| `outsourced-processes` | `NOTICE`, `LICENSE*`, vendor folders, SaaS mentions |

Locator format: repo-relative path (optionally `path:line`).
