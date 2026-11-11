# US-SET-21 — Control Overview access

As an Owner or Admin, I want to control Overview access so that the page is available to the intended roles.

**Status:** Current
**Access:** Owner, Admin can change; all roles see configured access
**Entry:** Settings → Company setup → Overview access
**Documentation:** [Settings](../../docs-src/using/settings.md)
**Source:** [SettingsSchedulingSection.tsx](../../apps/frontend/src/components/settings/SettingsSchedulingSection.tsx)

## Acceptance criteria

| Field           | Control           | Required/default/conditions                                                             |
| --------------- | ----------------- | --------------------------------------------------------------------------------------- |
| Overview access | Segmented control | Admins, Admins & Editors, Everyone. Defaults to Admins; only Owner/Admin can change it. |

## User flow

```mermaid
flowchart TD
A["Open Settings: Overview access"] --> B["Choose the company setting"]
B --> C{"Change accepted?"}
C -->|yes| D["Apply the selected Overview page access"]
C -->|no or uncertain| E["Read the visible error and resolve it before continuing"]
```

## Code flow

The persisted server path is shown; the temporary demo applies these planning commands in memory.

```mermaid
flowchart TD
  control["CapacityOverviewAccessSection calls updateSetting({ capacityOverviewAccess })"] --> view["useSettingsViewController.updateSetting checks active company and catches failure"]
  view --> action["typedPlanningActions.updateAccount builds settings.update command"]
  action --> execute["allocationSlice.sendPlanningCommand calls execute on the planning cache controller (createPlanningCacheController)"]
  execute --> transport["planningTransport sends api.planning.settings.update"]
  transport --> route["PlanningController.settingsUpdate validates and calls mutatePlanning"]
  route --> reply["Planning cache controller reconciles the response into the company projection"]
  reply --> read["store selectors.resolveCapacityOverviewAccess supplies setting to views"]
```

**Code references:** [SettingsSchedulingSection.tsx](../../apps/frontend/src/components/settings/SettingsSchedulingSection.tsx), [useSettingsViewController.ts](../../apps/frontend/src/components/settings/useSettingsViewController.ts), [typedPlanningActions.ts](../../apps/frontend/src/store/typedPlanningActions.ts), [allocationSlice.ts](../../apps/frontend/src/store/slices/allocationSlice.ts), [planningCacheController.ts](../../apps/frontend/src/data/planning/planningCacheController.ts), [planningTransport.ts](../../apps/frontend/src/data/planning/planningTransport.ts), [planning_routes.ts](../../apps/backend/start/planning_routes.ts), [planning_controller.ts](../../apps/backend/app/controllers/planning_controller.ts), [planning.ts](../../apps/backend/app/services/planning.ts), [selectors.ts](../../apps/frontend/src/store/selectors.ts)
