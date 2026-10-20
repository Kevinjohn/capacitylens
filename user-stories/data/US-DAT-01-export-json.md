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

- ✅ The MIME type is JSON and the top level is `{ "schemaVersion", "data" }`.
- ✅ The data contains the current scoped entities, including activities and lifecycle fields.
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

The current Settings controls still use the legacy importer/exporter. This slice adds the beta
format's shared validation/preparation and frontend preview; it does not activate the format in
those controls or establish privileged-auth proof. See the [accepted replacement map for issue
#1482](https://github.com/Kevinjohn/capacitylens/issues/1482#issuecomment-6276475651) and
[implementation issue #1520](https://github.com/Kevinjohn/capacitylens/issues/1520).
