# US-SET-22 — Enable disciplines

As a company Editor, I want to enable disciplines so that people can be grouped by their work area.

**Status:** Current
**Access:** Owner, Admin, Editor
**Entry:** Settings → Scheduling features → Use disciplines
**Documentation:** [Settings](../../docs-src/using/settings.md)
**Source:** [SettingsSchedulingSection.tsx](../../apps/frontend/src/components/settings/SettingsSchedulingSection.tsx)

## Acceptance criteria

| Field           | Control | Required/default/conditions                                                          |
| --------------- | ------- | ------------------------------------------------------------------------------------ |
| Use disciplines | Switch  | Company-wide; Off in a new company; on in the sample demo. Hiding preserves records. |

## User flow

```mermaid
flowchart TD
A["Open Settings: Use disciplines"] --> B["Choose the company setting"]
B --> C{"Change accepted?"}
C -->|yes| D["Show or hide discipline grouping"]
C -->|no or uncertain| E["Read the visible error and resolve it before continuing"]
```

## Code flow

```mermaid
flowchart TD
  control["CompanyFeaturesSection calls updateSetting({ disciplinesEnabled })"] --> view["useSettingsViewController.updateSetting checks active company and catches failure"]
  view --> action["typedPlanningActions.updateAccount builds settings.update command"]
  action --> execute["allocationSlice.sendPlanningCommand calls execute on the planning cache controller (createPlanningCacheController)"]
  execute --> transport["planningTransport sends api.planning.settings.update"]
  transport --> route["PlanningController.settingsUpdate validates and calls mutatePlanning"]
  route --> reply["Planning cache controller reconciles the response into the company projection"]
  reply --> read["store selectors.hasDisciplinesEnabled supplies setting to views"]
```

**Code references:** [SettingsSchedulingSection.tsx](../../apps/frontend/src/components/settings/SettingsSchedulingSection.tsx), [useSettingsViewController.ts](../../apps/frontend/src/components/settings/useSettingsViewController.ts), [typedPlanningActions.ts](../../apps/frontend/src/store/typedPlanningActions.ts), [allocationSlice.ts](../../apps/frontend/src/store/slices/allocationSlice.ts), [planningCacheController.ts](../../apps/frontend/src/data/planning/planningCacheController.ts), [planningTransport.ts](../../apps/frontend/src/data/planning/planningTransport.ts), [planning_routes.ts](../../apps/backend/start/planning_routes.ts), [planning_controller.ts](../../apps/backend/app/controllers/planning_controller.ts), [planning.ts](../../apps/backend/app/services/planning.ts), [selectors.ts](../../apps/frontend/src/store/selectors.ts)
