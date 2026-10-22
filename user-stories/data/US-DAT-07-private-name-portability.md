# US-DAT-07 — Export, import and upgrade private names safely

**Area:** Data management / privacy · **Persona:** Account owner and account administrator ·
**Coverage:** `apps/backend/tests/functional/auth/native_authorization.spec.ts` → owner-only import + redacted re-import tests;
`apps/frontend/src/components/ImportExport.test.tsx`; `packages/shared/src/lib/sanitizeImport.test.ts`; migration criterion
`DAT-PRIV-01` → `packages/shared/src/data/betaTransfer.test.ts`

**Documentation:** [Settings — Import and export](../../docs-src/using/settings.md#import-and-export)

## Goal

Back up and restore private client/project identities without leaking real names to non-owners or
allowing a redacted export to overwrite the full-fidelity database.

## Why

Exports inherit the caller's visibility. An admin's valid export intentionally contains code names
instead of protected identities, so treating it as a complete replacement would turn projections
into stored real names. Imports also need deterministic repair for legacy or hand-edited files so a
malformed private record fails closed rather than exposing its real name.

## How (end-to-end)

**Precondition:** In a persisted server account, create the private client/project from
US-PRI-01. Have both the owner and an admin available.

1. Export as the owner and inspect the JSON; then export as the admin and compare the two slices.
2. As the admin, confirm **Import JSON** is absent and direct `POST /api/import` returns `403`.
3. Confirm the rejected request leaves the database—including both real names and code names—exactly
   unchanged.
4. As the owner, import a valid full-fidelity export and confirm the atomic replacement succeeds.
5. In the in-memory demo, import a file containing quoted code names, public rows with stale
   privacy fields, a malformed private row with no usable code name, and a private built-in Internal
   client.
6. Load a schema-v6 export with no privacy fields and confirm migration to v7 leaves all existing
   clients/projects public.

## Acceptance criteria

- ✅ **DAT-PRIV-01 — Backwards-compatible schema.** Schema v7 adds optional `isPrivate`/`codeName` only to clients and projects. Migrating a v6 (or
  older) row with neither field leaves it public; absence is the backwards-compatible default.
- ✅ **DAT-PRIV-02 — Role-safe export.** An owner export contains the real names and raw, unquoted code names needed for a lossless
  restore. Admin/editor/viewer exports contain only their server-projected quoted names and omit raw
  code names; auth tables, memberships, sessions and invitations remain excluded for every role.
- ✅ **DAT-PRIV-03 — Owner-only server import.** On a persisted server, whole-slice import is owner-only in both UI and API: **Import JSON** is
  hidden for admin/editor/viewer, their direct request is `403`, and no table changes. Export remains
  available at its existing role tiers.
- ✅ **DAT-PRIV-04 — Mode semantics.** An owner server import remains atomic and not undoable. The in-memory demo
  remains owner-equivalent. Scheduler Undo/Redo covers bookings only, so it does not reverse an import in
  any mode.
- ✅ **DAT-PRIV-05 — Fail-closed repair.** Import sanitisation accepts privacy only when `isPrivate === true`; otherwise it removes both
  optional fields. Valid code names are cleaned and de-quoted. A private row whose code name becomes
  empty is repaired to neutral code name `Confidential`, never to the real name.
- ✅ **DAT-PRIV-06 — Internal repair.** Import sanitisation always strips privacy from the built-in **Internal** client, even if a
  hand-edited file attempts to set it.
- ✅ **DAT-PRIV-07 — Redacted-restore interlock.** A non-owner's redacted export can never be accepted as a server slice replacement, preventing
  quoted projections or fallback values from destroying the owner-confidential database identities.
- ✅ **Beta projection.** Beta exports preserve the server's confidential projection. A `redacted`
  document cannot be prepared as a full replacement, and preparation never reconstructs
  confidential names from projected values.

The current Settings controls use Beta transfer preparation and the native authenticated import
route. Server import is owner-only and atomic; demo import remains local to the browser session.
