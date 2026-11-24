# US-SET-22 — Enable disciplines

As a company Editor, I want to enable disciplines so that people can be grouped by their work area.

**Status:** Current
**Access:** Owner, Admin, Editor
**Entry:** Settings → Scheduling features → Use disciplines
**Documentation:** [Settings](../../docs-src/using/settings.md)
**Source:** [SettingsSchedulingSection.tsx](../../apps/frontend/src/components/settings/SettingsSchedulingSection.tsx)

## Acceptance criteria

| Field           | Control | Required/default/conditions                                                   |
| --------------- | ------- | ----------------------------------------------------------------------------- |
| Use disciplines | Switch  | Company-wide; Off in a new company; on in the demo. Hiding preserves records. |

## User flow

```mermaid
flowchart TD
A["Open Settings: Use disciplines"] --> B["Choose the company setting"]
B --> C{"Change accepted?"}
C -->|yes| D["Show or hide discipline grouping"]
C -->|no or uncertain| E["Read the visible error and resolve it before continuing"]
```

## Code flow

The [company setting write path](../REFERENCE.md#company-setting-writes) traces the common no-op, server commit, refusal and reconciliation branches.

```mermaid
flowchart TD
  flags["useSettingsViewModel reads hasDisciplinesEnabled and canEdit"] --> switch["CompanyFeaturesSection renders the disciplinesEnabled switch"]
  switch --> access{"Editable?"}
  access -->|no| disabled["Read-only control dispatches no request"]
  access -->|changed| command["updateSetting passes disciplinesEnabled to the shared company setting write path"]
  command -->|accepted state| saved["hasDisciplinesEnabled reads the accepted company setting"]
  saved --> route["useVisibleRoutes hides the route link when disabled; DisciplineRoute redirects direct entry"]
  saved --> form["ResourceForm shows Discipline only when the flag is on and options exist"]
  saved --> grid["Schedule model uses or skips discipline grouping"]
```

**Code references:** [useSettingsViewModel.ts:55](../../apps/frontend/src/components/settings/useSettingsViewModel.ts#L55) · [SettingsSchedulingSection.tsx:151](../../apps/frontend/src/components/settings/SettingsSchedulingSection.tsx#L151) · [selectors.ts:40](../../apps/frontend/src/store/selectors.ts#L40) · [initial_company_defaults_service.ts:34](../../apps/backend/app/services/initial_company_defaults_service.ts#L34) · [router.tsx:113](../../apps/frontend/src/router.tsx#L113) · [ResourceForm.tsx:96](../../apps/frontend/src/components/resources/ResourceForm.tsx#L96) · [ResourceForm.tsx:207](../../apps/frontend/src/components/resources/ResourceForm.tsx#L207) · [useSchedulerGridModel.ts:159](../../apps/frontend/src/components/scheduler/useSchedulerGridModel.ts#L159)
