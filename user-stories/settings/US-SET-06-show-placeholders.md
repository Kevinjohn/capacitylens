# US-SET-06 — Show placeholders

As an Editor, I want to show or hide placeholders so that I can focus on the resources relevant to my plan.

**Status:** Current
**Access:** Editor and above; Viewers can read the setting.
**Entry:** Settings → Scheduling features → Show placeholders
**Documentation:** [Settings](../../docs-src/using/settings.md)
**Source:** [SettingsSchedulingSection.tsx](../../apps/frontend/src/components/settings/SettingsSchedulingSection.tsx)

## Acceptance criteria

| Field             | Control | Required/default/conditions                                       |
| ----------------- | ------- | ----------------------------------------------------------------- |
| Show placeholders | Switch  | Off for new companies; company-wide. Hidden records are retained. |

## User flow

```mermaid
flowchart TD
A["Open Settings: Show placeholders"] --> B["Choose the company setting"]
B --> C{"Change accepted?"}
C -->|yes| D["Show or hide placeholders in company views"]
C -->|no or uncertain| E["Read the visible error and resolve it before continuing"]
```

## Code flow

The persisted server path is shown; the temporary demo applies these planning commands in memory.

```mermaid
flowchart TD
  control["CompanyFeaturesSection calls updateSetting({ placeholdersEnabled })"] --> view["useSettingsViewController.updateSetting checks active company and catches failure"]
  view --> action["typedPlanningActions.updateAccount builds settings.update command"]
  action --> execute["allocationSlice.sendPlanningCommand executes PlanningCacheController command"]
  execute --> transport["planningTransport sends api.planning.settings.update"]
  transport --> route["PlanningController.settingsUpdate validates and calls mutatePlanning"]
  route --> reply["PlanningCacheController reconciles response into company projection"]
  reply --> read["store selectors.hasPlaceholdersEnabled reads the saved company setting"]
```

**Code references:** [SettingsSchedulingSection.tsx](../../apps/frontend/src/components/settings/SettingsSchedulingSection.tsx), [useSettingsViewController.ts](../../apps/frontend/src/components/settings/useSettingsViewController.ts), [typedPlanningActions.ts](../../apps/frontend/src/store/typedPlanningActions.ts), [allocationSlice.ts](../../apps/frontend/src/store/slices/allocationSlice.ts), [planningCacheController.ts](../../apps/frontend/src/data/planning/planningCacheController.ts), [planningTransport.ts](../../apps/frontend/src/data/planning/planningTransport.ts), [planning_routes.ts](../../apps/backend/start/planning_routes.ts), [planning_controller.ts](../../apps/backend/app/controllers/planning_controller.ts), [planning.ts](../../apps/backend/app/services/planning.ts), [selectors.ts](../../apps/frontend/src/store/selectors.ts)
