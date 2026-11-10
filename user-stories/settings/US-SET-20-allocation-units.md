# US-SET-20 — Choose scheduling units

As a company Editor, I want to choose scheduling units so that bookings use the company’s preferred measure.

**Status:** Current
**Access:** Owner, Admin, Editor
**Entry:** Settings → Company setup → Allocation units
**Documentation:** [Settings](../../docs-src/using/settings.md)
**Source:** [SettingsSchedulingSection.tsx](../../apps/frontend/src/components/settings/SettingsSchedulingSection.tsx)

## Acceptance criteria

| Field            | Control           | Required/default/conditions                                 |
| ---------------- | ----------------- | ----------------------------------------------------------- |
| Scheduling input | Segmented control | Hours, Days or Blocks; company-wide, read-only for Viewers. |

## User flow

```mermaid
flowchart TD
A["Open Settings: Scheduling input: Hours, Days or Blocks"] --> B["Choose the company setting"]
B --> C{"Change accepted?"}
C -->|yes| D["Use the selected allocation inputs"]
C -->|no or uncertain| E["Read the visible error and resolve it before continuing"]
```

## Code flow

The persisted server path is shown; the temporary demo applies these planning commands in memory.

```mermaid
flowchart TD
  control["SchedulingModeSection calls updateSetting({ schedulingMode })"] --> view["useSettingsViewController.updateSetting checks active company and catches failure"]
  view --> action["typedPlanningActions.updateAccount builds settings.update command"]
  action --> execute["allocationSlice.sendPlanningCommand executes PlanningCacheController command"]
  execute --> transport["planningTransport sends api.planning.settings.update"]
  transport --> route["PlanningController.settingsUpdate validates and calls mutatePlanning"]
  route --> reply["PlanningCacheController reconciles response into company projection"]
  reply --> read["store selectors.resolveSchedulingMode supplies setting to views"]
```

**Code references:** [SettingsSchedulingSection.tsx](../../apps/frontend/src/components/settings/SettingsSchedulingSection.tsx), [useSettingsViewController.ts](../../apps/frontend/src/components/settings/useSettingsViewController.ts), [typedPlanningActions.ts](../../apps/frontend/src/store/typedPlanningActions.ts), [allocationSlice.ts](../../apps/frontend/src/store/slices/allocationSlice.ts), [planningCacheController.ts](../../apps/frontend/src/data/planning/planningCacheController.ts), [planningTransport.ts](../../apps/frontend/src/data/planning/planningTransport.ts), [planning_routes.ts](../../apps/backend/start/planning_routes.ts), [planning_controller.ts](../../apps/backend/app/controllers/planning_controller.ts), [planning.ts](../../apps/backend/app/services/planning.ts), [selectors.ts](../../apps/frontend/src/store/selectors.ts)
