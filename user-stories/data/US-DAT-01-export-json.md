# US-DAT-01 — Export the account to JSON

**Area:** Data management · **Persona:** Studio manager · **Linked E2E:** `e2e/crud.spec.ts`

## Goal

Download the current account as `capacitylens-data.json` for portability or inspection.

## Steps

1. Click **Export JSON** in the sidebar Data section.
2. Open the downloaded file.

## Acceptance

- The MIME type is JSON and the top level is `{ "schemaVersion", "data" }`.
- The data contains the current scoped entities, including activities and lifecycle fields.
- Auth, memberships, sessions and invitations are never exported.
- Export is not a replacement for server backups.
