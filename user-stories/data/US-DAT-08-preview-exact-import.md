# US-DAT-08 — Confirm the exact import operation

As an Owner, I want to confirm the exact import operation so that my password cannot authorize a different replacement.

**Status:** Current
**Access:** Owner
**Entry:** Import preview → Replace data → password confirmation
**Documentation:** [Settings](../../docs-src/using/settings.md#import-and-export)
**Source:** [ImportExport.tsx](../../apps/frontend/src/components/ImportExport.tsx)

## Acceptance criteria

- Use the **Password** field in [Import company data](US-DAT-02-import-json.md). **Continue** confirms this previewed import; **Cancel** leaves the data unchanged.
