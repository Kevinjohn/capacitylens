# US-DAT-03 — Keep imported data outside undo history

As an Owner, I want imports to stay outside undo history so that an accidental undo cannot replace imported company data.

**Status:** Current
**Access:** Owner
**Entry:** After import → Undo/Redo
**Documentation:** [Settings](../../docs-src/using/settings.md#beta-import-contract)
**Source:** [ImportExport.tsx](../../apps/frontend/src/components/ImportExport.tsx)

## Acceptance criteria

- Completing an import clears the Undo and Redo history, so neither can reverse the import or any earlier change.

## User flow

```mermaid
flowchart TD
  import["Confirm and finish import"] --> replace["Imported data replaces the prior company data"]
  replace --> undo["Select Undo or Redo"]
  undo --> result["Imported data remains in place"]
```

## Code flow

```mermaid
flowchart TD
  submit["useServerImport sends the reviewed document, revision and proof"] --> tx["ImportsController.store checks the current Owner and consumes proof in the apply transaction"]
  tx --> check["applyCompanyImport checks base revision, destination and portable fingerprint"]
  check -->|Rejected| refused["Roll back; proof and history stay available"]
  check -->|Unchanged| noop["Commit proof spend and return existing revision without changing history"]
  noop --> resume["runSuspendedReplacement resumes writes without a replacement refresh"]
  check -->|Changed| remove["discardRestorationGroups and discardHistory for the company"]
  remove --> commit["Replace rows, write audit and advance planning revision"]
  commit --> refresh["runSuspendedReplacement requests a fresh planning read"]
  submit -->|Commit uncertain| refresh
  refresh -->|Read accepted| cache["planningCache uses server history availability for Undo and Redo"]
  refresh -->|Read failed| reload["Keep writes suspended and require reload"]
```

**Code references:** [useServerImport.ts](../../apps/frontend/src/components/import-export/useServerImport.ts#L46) · [imports_controller.ts](../../apps/backend/app/controllers/imports_controller.ts#L30) · [company_import_service.ts](../../apps/backend/app/services/company_import_service.ts#L145) · [suspendedReplacement.ts](../../apps/frontend/src/store/suspendedReplacement.ts#L101) · [planningCache.ts](../../apps/frontend/src/data/planning/planningCache.ts#L224) · [import_apply.spec.ts](../../apps/backend/tests/functional/import_apply.spec.ts#L194) · [import_apply.spec.ts](../../apps/backend/tests/functional/import_apply.spec.ts#L262)
