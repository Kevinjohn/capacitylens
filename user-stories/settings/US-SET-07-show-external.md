# US-SET-07 — Show external resources

As an Editor, I want to show or hide external resources so that I can focus on the work my company manages.

**Status:** Current
**Access:** Editor and above; Viewers can read the setting.
**Entry:** Settings → Scheduling features → Show external resources
**Documentation:** [Settings](../../docs-src/using/settings.md)
**Source:** [SettingsSchedulingSection.tsx](../../apps/frontend/src/components/settings/SettingsSchedulingSection.tsx)

## Acceptance criteria

| Field                   | Control | Required/default/conditions                                       |
| ----------------------- | ------- | ----------------------------------------------------------------- |
| Show external resources | Switch  | Off for new companies; company-wide. Hidden records are retained. |

## User flow

```mermaid
flowchart TD
A["Open Settings: Show external resources"] --> B["Choose the company setting"]
B --> C{"Change accepted?"}
C -->|yes| D["Show or hide external parties in company views"]
C -->|no or uncertain| E["Read the visible error and resolve it before continuing"]
```

## Code flow

The [company setting write path](../REFERENCE.md#company-setting-writes) traces the common no-op, server commit, refusal and reconciliation branches.

```mermaid
flowchart TD
  flags["useSettingsViewModel reads hasExternalResourcesEnabled and canEdit"] --> switch["CompanyFeaturesSection renders the externalEnabled switch"]
  switch --> access{"Editable?"}
  access -->|no| disabled["Read-only control dispatches no request"]
  access -->|changed| command["updateSetting passes externalEnabled to the shared company setting write path"]
  command -->|accepted state| saved["hasExternalResourcesEnabled reads the accepted company setting"]
  saved --> grid["Schedule model includes or hides external lanes"]
  saved --> assignees["Assignee options follow enabled kinds and retain the currently selected resource"]
  saved --> resources["Resource list includes or hides external section"]
```

**Code references:** [useSettingsViewModel.ts:55](../../apps/frontend/src/components/settings/useSettingsViewModel.ts#L55) · [SettingsSchedulingSection.tsx:167](../../apps/frontend/src/components/settings/SettingsSchedulingSection.tsx#L167) · [selectors.ts:66](../../apps/frontend/src/store/selectors.ts#L66) · [useSchedulerGridModel.ts:155](../../apps/frontend/src/components/scheduler/useSchedulerGridModel.ts#L155) · [useAllocationDialogState.ts:85](../../apps/frontend/src/components/scheduler/useAllocationDialogState.ts#L85) · [useAllocationTargetState.ts:54](../../apps/frontend/src/components/scheduler/useAllocationTargetState.ts#L54) · [useResourceListModel.ts:55](../../apps/frontend/src/components/resources/useResourceListModel.ts#L55)
