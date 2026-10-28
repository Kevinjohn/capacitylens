# US-DAT-04 — Reject a non-CapacityLens file safely

**Area:** Data management · **Persona:** Studio manager · **Linked E2E:** `e2e/data.spec.ts` → "rejects a non-CapacityLens file with a notice and preserves existing data"

**Documentation:** [Settings — Import and export](../../docs-src/using/settings.md#import-and-export)

## Goal

Pick the wrong file and have CapacityLens refuse it with a clear notice, leaving the current data exactly as it was — never a silent wipe.

## Why

Import replaces everything, so feeding it a random JSON or a non-CapacityLens file must be a no-op, not a catastrophe. A guard checks the file actually looks like CapacityLens data before doing anything; if it doesn't, the manager gets a plain explanation and keeps their work.

## How (end-to-end)

**Precondition:** Prepare unrelated JSON or a beta transfer with a deliberately unsupported schema
version or invalid table set. A different supported product release may still produce a valid file
and is not a rejection fixture.

1. Note the current data (e.g. Clients shows _Queen Consolidated_ and _LexCorp_; the Schedule has the seed bars).
2. Open **Settings** → **Import and export**, expand it, click **Import JSON** and choose the
   unsupported file.
3. Observe the specific validation notice. The importer does not prepare a replacement or open
   the confirmation step.

## Acceptance criteria

- ✅ An unsupported schema or table set is rejected with the reason supplied by validation; malformed or invalid data is not silently repaired. No replacement confirmation appears.
- ✅ The current dataset is fully preserved — no entities are removed or changed (the Clients list still shows _Queen Consolidated_ and _LexCorp_; the seed schedule is intact). There is no silent wipe.
- ✅ A subsequent valid import still works normally (the failed attempt doesn't leave the import flow stuck).

For the beta preparation contract, unsupported format/schema versions, malformed values,
duplicate IDs, invalid references and incorrect scope fail before a replacement can be prepared.
The parser does not guess a legacy format, remap IDs or repair invalid rows. See the [accepted
replacement map for issue #1482](https://github.com/Kevinjohn/capacitylens/issues/1482#issuecomment-6276475651)
and [implementation issue #1520](https://github.com/Kevinjohn/capacitylens/issues/1520).
