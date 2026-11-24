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
  entry["Export JSON in ImportExport calls useExportOperation.exportData"] --> request["Request the active company's server export"]
  request --> scope["CompanyExportsController.show uses withActor and resolvePlanningAccess"]
  scope -->|Verified effective reader| read["Read scoped rows in the transaction; members:manage includes inactive rows"]
  read --> exportDoc["transformState projects private fields; serialize version 2 as full for Owner or redacted for other roles"]
  exportDoc --> download["downloadTextFile saves capacitylens-data.json"]
  scope -->|Refusal| error["Show an export error notice"]
  request -->|Request failure| error
  exportDoc -->|Validation error| error
  download -->|Download failure| error
```

**Code references:** [useExportOperation.ts](../../apps/frontend/src/components/import-export/useExportOperation.ts#L17) · [company_exports_controller.ts](../../apps/backend/app/controllers/company_exports_controller.ts#L27) · [export_routes.ts](../../apps/backend/start/export_routes.ts#L7) · [state_repository_service.ts](../../apps/backend/app/services/state_repository_service.ts#L82) · [companyExport.ts](../../packages/shared/src/data/companyExport.ts#L14) · [company_export.spec.ts](../../apps/backend/tests/functional/company_export.spec.ts#L40) · [planning_access_service.ts](../../apps/backend/app/services/planning/planning_access_service.ts#L31)
