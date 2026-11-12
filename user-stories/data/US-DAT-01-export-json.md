# US-DAT-01 — Export company data

As a company member, I want to export company data so that I can inspect or transfer a portable copy.

**Status:** Current
**Access:** Owner, Admin, Editor, Viewer
**Entry:** Settings → Data and support → Import and export → Export JSON
**Documentation:** [Settings](../../docs-src/using/settings.md#import-and-export)
**Source:** [ImportExport.tsx](../../apps/frontend/src/components/ImportExport.tsx)

## Acceptance criteria

- **Export JSON** downloads `capacitylens-data.json`, a beta export of the selected company.
- On a server, Owner and Admin exports reload the company including archived records; Editor and Viewer exports contain the active records already loaded in the page. Owners get real private names; other roles get the code names they see.
- The export excludes identities, memberships, sessions, admission records and device preferences.

## User flow

```mermaid
flowchart TD
  open["Settings → Data and support → Import and export"] --> export["Export JSON"]
  export --> download["Download capacitylens-data.json"]
  export --> error["Failed or incomplete server read: see an error notice"]
```

## Code flow

```mermaid
flowchart TD
  button["ImportExport Export JSON calls useExportAction.exportData"] --> mode["useExportAction chooses the source: page data for Editor or Viewer"]
  mode --> fetch["Owner or Admin on a server: fetchInactiveSlice reads archived rows too"]
  fetch --> route["GET api.state reaches ExportsController.show and transformState"]
  mode --> build["buildBetaExport selects role-appropriate completeness"]
  route --> build
  build --> file["serializeBetaExport and downloadTextFile create the JSON download"]
```

**Code references:** [ImportExport.tsx](../../apps/frontend/src/components/ImportExport.tsx), [useExportAction.ts](../../apps/frontend/src/components/import-export/useExportAction.ts), [fetchInactiveSlice.ts](../../apps/frontend/src/data/fetchInactiveSlice.ts), [export_routes.ts](../../apps/backend/start/export_routes.ts), [exports_controller.ts](../../apps/backend/app/controllers/exports_controller.ts), [state_transformer.ts](../../apps/backend/app/transformers/state_transformer.ts), [betaTransfer.ts](../../packages/shared/src/data/betaTransfer.ts), [download.ts](../../apps/frontend/src/lib/download.ts)
