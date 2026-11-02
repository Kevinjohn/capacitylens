# US-DAT-01 — Export the account to JSON

**Area:** Data management · **Persona:** Studio manager · **Linked E2E:** `e2e/crud.spec.ts`

**Documentation:** [Settings — Import and export](../../docs-src/using/settings.md#import-and-export)

## Goal

Download the current account as `capacitylens-data.json` for portability or inspection.

## Why

Managers need a portable copy of planning data for inspection, transfer, and disaster-recovery
preparation without exporting identity or authentication records.

## How (end-to-end)

**Precondition:** Seeded app open with **Wayne Enterprises** selected.

1. Open **Settings**, find **Data and support → Import and export**, expand it and click **Export JSON**.
2. Wait for `capacitylens-data.json` to download.
3. Open the downloaded file and inspect its top-level shape and scoped tables.

## Acceptance criteria

- ✅ The MIME type is JSON and the top level is `{ "format": "capacitylens-beta", "schemaVersion": 1, "completeness", "data" }`.
- ✅ The data contains exactly one company and all of its scoped entities, including activities and lifecycle fields, with stable IDs and supported settings.
- ✅ Auth, memberships, sessions and invitations are never exported.
- ✅ Export is not a replacement for server backups.

## Beta transfer contract

- ✅ The beta document uses `format: "capacitylens-beta"`, `schemaVersion: 1`,
  `completeness: "full" | "redacted"`, and `data: AppData`. This version is independent of the
  database schema and legacy export versions.
- ✅ `data` contains exactly one account and every scoped table. It preserves stable IDs,
  timestamps and settings, and excludes identity, sessions, memberships, roles, admission records
  and device preferences.
- ✅ Redacted exports preserve server-projected confidential values and cannot be restored as a
  full-completeness replacement.

Settings exports this format. A redacted export is for inspection only; only a full export can
replace company data through the Owner's import flow.
