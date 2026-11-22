# US-DAT-04 — Reject invalid import files

As a company member, I want invalid import files rejected so that an accidental selection cannot replace my data.

**Status:** Current
**Access:** Owner
**Entry:** Settings → Data and support → Import and export → Import JSON
**Documentation:** [Settings](../../docs-src/using/settings.md#import-and-export)
**Source:** [ImportExport.tsx](../../apps/frontend/src/components/ImportExport.tsx)

## Acceptance criteria

- The importer accepts only a full (not redacted) `capacitylens-beta` schema version 2 export whose records all pass validation.
- A file that is not valid JSON or fails these checks is refused with an error before anything is replaced; current company data remains intact.

## User flow

```mermaid
flowchart TD
  choose["Import JSON → Choose a file"] --> check["Check the CapacityLens beta export format"]
  check --> invalid["Invalid or foreign file: see an error; current data remains"]
  check --> valid["Valid file: review the preview before replacement"]
```

## Code flow

```mermaid
flowchart TD
  file["usePendingImport.readFile reads selected file"] --> json{"JSON?"}
  json -->|"no"| notice["ImportExport reports invalid JSON before any request"]
  json -->|"yes"| request["ImportPreviewsController.store calls readRequestDocument"]
  request --> validate["previewCompanyImport prepares the full import contract"]
  validate -->|"invalid"| refused["ImportPreview shows the server's reason; nothing changes"]
  validate -->|"valid"| preview["ImportPreview shows the summary; apply validates the document again"]
```

**Code references:** [ImportExport.tsx](../../apps/frontend/src/components/ImportExport.tsx), [usePendingImport.ts](../../apps/frontend/src/components/import-export/usePendingImport.ts), [ImportPreview.tsx](../../apps/frontend/src/components/import-export/ImportPreview.tsx), [companyDocument.ts](../../packages/shared/src/data/companyDocument.ts), [import_previews_controller.ts](../../apps/backend/app/controllers/import_previews_controller.ts), [company_import.ts](../../apps/backend/app/services/company_import.ts)
