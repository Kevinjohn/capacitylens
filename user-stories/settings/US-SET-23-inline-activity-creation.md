# US-SET-23 — Create activities inline

As a company Editor, I want to enable inline activity creation so that I can add an activity while booking work.

**Status:** Current
**Access:** Owner, Admin, Editor
**Entry:** Settings → Scheduling features → Inline activity creation
**Documentation:** [Settings](../../docs-src/using/settings.md)
**Source:** [SettingsSchedulingSection.tsx](../../apps/frontend/src/components/settings/SettingsSchedulingSection.tsx)

## Acceptance criteria

| Field                    | Control | Required/default/conditions                                                |
| ------------------------ | ------- | -------------------------------------------------------------------------- |
| Inline activity creation | Switch  | Company-wide; Off by default; enables Add activity in the allocation form. |

## User flow

```mermaid
flowchart TD
A["Open Settings: Inline activity creation"] --> B["Choose the company setting"]
B --> C{"Change accepted?"}
C -->|yes| D["Show or hide Add activity in booking forms"]
C -->|no or uncertain| E["Read the visible error and resolve it before continuing"]
```

## Code flow

```mermaid
flowchart TD
  control["CompanyFeaturesSection calls updateSetting({ inlineActivityCreateEnabled })"] --> view["useSettingsViewController.updateSetting checks active company and catches failure"]
  view --> action["typedPlanningActions.updateAccount builds settings.update command"]
  action --> execute["allocationSlice.sendPlanningCommand calls execute on the planning cache controller (createPlanningCacheController)"]
  execute --> transport["planningTransport sends api.planning.settings.update"]
  transport --> route["PlanningController.settingsUpdate validates and calls mutatePlanning"]
  route --> reply["Planning cache controller reconciles the response into the company projection"]
  reply --> read["store selectors.canCreateInlineActivity supplies setting to views"]
```

**Code references:** [SettingsSchedulingSection.tsx](../../apps/frontend/src/components/settings/SettingsSchedulingSection.tsx), [useSettingsViewController.ts](../../apps/frontend/src/components/settings/useSettingsViewController.ts), [typedPlanningActions.ts](../../apps/frontend/src/store/typedPlanningActions.ts), [allocationSlice.ts](../../apps/frontend/src/store/slices/allocationSlice.ts), [planningCacheController.ts](../../apps/frontend/src/data/planning/planningCacheController.ts), [planningTransport.ts](../../apps/frontend/src/data/planning/planningTransport.ts), [planning_routes.ts](../../apps/backend/start/planning_routes.ts), [planning_controller.ts](../../apps/backend/app/controllers/planning_controller.ts), [planning.ts](../../apps/backend/app/services/planning.ts), [selectors.ts](../../apps/frontend/src/store/selectors.ts)
