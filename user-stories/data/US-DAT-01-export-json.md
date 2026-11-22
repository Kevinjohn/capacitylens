# US-DAT-01 — Export company data

As a company member, I want to export company data so that I can inspect or move a portable copy.

**Status:** Current
**Access:** Owner, Admin, Editor, Viewer
**Entry:** Settings → Data and support → Import and export → Export JSON
**Documentation:** [Settings](../../docs-src/using/settings.md#import-and-export)
**Source:** [ImportExport.tsx](../../apps/frontend/src/components/ImportExport.tsx)

## Acceptance criteria

- **Export JSON** downloads `capacitylens-data.json`, a beta export of the selected company.
- The server builds the file for the reader's role. Owner and Admin exports include archived records; Editor and Viewer exports contain the active records. Owners get real private names; other roles get the code names they see.
- The export excludes identities, memberships, sessions, admission records and device preferences.

## User flow

```mermaid
flowchart TD
  open["Settings → Data and support → Import and export"] --> export["Export JSON"]
  export --> download["Download capacitylens-data.json"]
  export --> error["Refused or failed export: see an error notice"]
```

## Code flow

```mermaid
flowchart TD
  button["ImportExport Export JSON calls useExportOperation.exportData"] --> fetch["useExportOperation fetches api.company_exports.show"]
  fetch --> route["CompanyExportsController.show projects rows and sets completeness"]
  route --> file["downloadTextFile saves the server's file"]
```

**Code references:** [ImportExport.tsx](../../apps/frontend/src/components/ImportExport.tsx), [useExportOperation.ts](../../apps/frontend/src/components/import-export/useExportOperation.ts), [export_routes.ts](../../apps/backend/start/export_routes.ts), [company_exports_controller.ts](../../apps/backend/app/controllers/company_exports_controller.ts), [state_transformer.ts](../../apps/backend/app/transformers/state_transformer.ts), [companyDocument.ts](../../packages/shared/src/data/companyDocument.ts), [download.ts](../../apps/frontend/src/lib/download.ts)
