# US-DAT-01 — Export company data

As a company member, I want to export company data so that I can inspect or transfer a portable copy.

**Status:** Current
**Access:** Owner, Admin, Editor, Viewer
**Entry:** Settings → Data and support → Import and export → Export JSON
**Documentation:** [Settings](../../docs-src/using/settings.md#import-and-export)
**Source:** [ImportExport.tsx](../../apps/frontend/src/components/ImportExport.tsx)

## Acceptance criteria

- Export JSON downloads the selected company’s beta document.
- The export excludes identities, memberships, sessions, admission records and device preferences.

## User flow

```mermaid
flowchart TD
  open["Settings → Import and export"] --> export["Export JSON"]
  export --> download["Download capacitylens-data.json"]
  export --> error["Failed or incomplete server read: see an error notice"]
```

## Code flow

```mermaid
flowchart TD
  button["ImportExport Export JSON calls useExportAction.exportData"] --> mode["Server mode reads current data; demo uses page data"]
  mode --> fetch["Server may fetchInactiveSlice for full export"]
  fetch --> route["GET api.state reaches ExportsController.show and transformState"]
  mode --> build["buildBetaExport selects role-appropriate completeness"]
  route --> build
  build --> file["serializeBetaExport and downloadTextFile create the JSON download"]
```

**Code references:** [ImportExport.tsx](../../apps/frontend/src/components/ImportExport.tsx), [useExportAction.ts](../../apps/frontend/src/components/import-export/useExportAction.ts), [fetchInactiveSlice.ts](../../apps/frontend/src/data/fetchInactiveSlice.ts), [export_routes.ts](../../apps/backend/start/export_routes.ts), [exports_controller.ts](../../apps/backend/app/controllers/exports_controller.ts), [state_transformer.ts](../../apps/backend/app/transformers/state_transformer.ts), [betaTransfer.ts](../../packages/shared/src/data/betaTransfer.ts), [download.ts](../../apps/frontend/src/lib/download.ts)
