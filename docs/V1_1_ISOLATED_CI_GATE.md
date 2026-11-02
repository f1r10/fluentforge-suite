# V1.1 isolated integration verification

This temporary CI branch is cut from V1.1 PR #15 to trigger the normal
`chatgpt/**` push workflow, independently of PR event scheduling.

Verification is **not** production or multi-teacher acceptance. Keep the
single-teacher safety constraint in place until all service-role paths, RLS,
media, imports, backups, and identity revocation pass adversarial two-tenant
tests.

Mandatory source checks:
- `bun run verify`
- Python processing-service tests
- production Docker build
- database security acceptance
- plain PostgreSQL/Chromium teacher and student acceptance
- original teacher PDF fixture review and isolated AWS restore outside CI

Any failed job blocks release. Do not merge this branch into main.
