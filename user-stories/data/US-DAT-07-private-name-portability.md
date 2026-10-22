# US-DAT-07 — Export, import and upgrade private names safely

**Area:** Data management / privacy · **Persona:** Account owner and account administrator ·
**Coverage:** `apps/backend/tests/functional/auth/native_authorization.spec.ts` → owner-only import + redacted re-import tests;
`apps/backend/tests/functional/transfer_apply.spec.ts` → redaction refusal; `apps/frontend/src/components/ImportExport.test.tsx`;
`packages/shared/src/data/betaTransfer.test.ts` → privacy field validation

**Documentation:** [Settings — Import and export](../../docs-src/using/settings.md#import-and-export)

## Goal

Back up and restore private client/project identities without leaking real names to non-owners or
allowing a redacted export to overwrite the full-fidelity database.

## Why

Exports inherit the caller's visibility. An admin's valid export intentionally contains code names
instead of protected identities, so treating it as a complete replacement would turn projections
into stored real names. Imports accept only this product's own full export and refuse a malformed
private record rather than repairing it, so a real name is never exposed or invented.

## How (end-to-end)

**Precondition:** In a persisted server account, create the private client/project from
US-PRI-01. Have both the owner and an admin available.

1. Export as the owner and inspect the JSON; then export as the admin and compare the two slices.
2. As the admin, confirm **Import JSON** is absent and direct `POST /api/transfer/preview` and
   `POST /api/transfer/apply` return `403`.
3. Confirm the rejected request leaves the database—including both real names and code names—exactly
   unchanged.
4. As the owner, import a valid full-fidelity export and confirm the atomic replacement succeeds.
5. In the in-memory demo, preview a file containing a private row with no usable code name, then
   one marking the built-in Internal client private; confirm each is refused with a field error and
   nothing changes.
6. Preview a redacted (admin) export as the owner and confirm it cannot be applied.

## Acceptance criteria

- ✅ **DAT-PRIV-01 — One supported format.** Only a `capacitylens-beta` version `1` document is accepted. Optional `isPrivate`/`codeName`
  exist only on clients and projects; a row with neither field is public.
- ✅ **DAT-PRIV-02 — Role-safe export.** An owner export contains the real names and raw, unquoted code names needed for a lossless
  restore. Admin/editor/viewer exports contain only their server-projected quoted names and omit raw
  code names; auth tables, memberships, sessions and invitations remain excluded for every role.
- ✅ **DAT-PRIV-03 — Owner-only server import.** On a persisted server, whole-slice import is owner-only in both UI and API: **Import JSON** is
  hidden for admin/editor/viewer, their direct request is `403`, and no table changes. Export remains
  available at its existing role tiers.
- ✅ **DAT-PRIV-04 — Mode semantics.** An owner server import remains atomic and not undoable. The in-memory demo
  remains owner-equivalent. Scheduler Undo/Redo covers bookings only, so it does not reverse an import in
  any mode.
- ✅ **DAT-PRIV-05 — Fail-closed validation.** A private row in a full document needs `isPrivate === true` and a non-empty code name;
  a private row without one is refused with a field error. Nothing is repaired, and a real name is
  never substituted for a missing code name.
- ✅ **DAT-PRIV-06 — Internal stays public.** A document that marks the built-in **Internal** client private is refused.
- ✅ **DAT-PRIV-07 — Redacted-restore interlock.** A non-owner's redacted export can never be accepted as a server slice replacement, preventing
  quoted projections or fallback values from destroying the owner-confidential database identities.
- ✅ **Beta projection.** Beta exports preserve the server's confidential projection. A `redacted`
  document cannot be prepared as a full replacement, and preparation never reconstructs
  confidential names from projected values.

The Settings controls use this beta transfer end to end: preview, action-bound confirmation and
atomic replacement are described in US-DAT-02.
