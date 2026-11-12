# US-DIS-02 — Edit a discipline

As an Editor, I want to edit a discipline name or colour so that schedule group labels stay current.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner)
**Entry:** Disciplines screen → discipline row → Edit
**Documentation:** [Guide](../../docs-src/using/disciplines.md)
**Source:** [DisciplineList.tsx](../../apps/frontend/src/components/disciplines/DisciplineList.tsx) · [DisciplineForm.tsx](../../apps/frontend/src/components/disciplines/DisciplineForm.tsx)

## Acceptance criteria

| Field  | Control         | Required/default/conditions       |
| ------ | --------------- | --------------------------------- |
| Name   | Text field      | Required; current value prefilled |
| Colour | Preset swatches | Current colour preselected        |

- **Save** updates the discipline and preserves its sort order. **Cancel** closes without saving.

## User flow

```mermaid
flowchart TD
  A["Disciplines screen"] --> B["Edit discipline"] --> C["Change Name or Colour"] --> D["Save"]
  D -->|valid| E["List and schedule group update"]
  D -->|Name missing| F["Form stays open with error"]
  C --> G["Cancel"] --> H["Dialog closes without saving"]

  D -->|server refuses save| X["Error stays visible in the form"]
```

## Code flow

```mermaid
flowchart TD
  A["DisciplineForm.DisciplineForm.submit"] --> B["useStore.updateDiscipline → createTypedPlanningActions.updateDiscipline"]
  B --> C["updateCatalogue → allocationSlice.send"]
  C --> D["createPlanningCacheController.execute"] --> E{"createStorePlanningTransport"}
  E -->|server| F["createPlanningTransport.sendOperation → api.planning.discipline.update"] --> G["PlanningController.disciplineUpdate → mutatePlanning begins the scoped transaction"]
  G --> H["executePlanningIntent applies intent → writeRow persists row"] --> K["mutatePlanning records revision/audit and commits"] --> J["acceptReceipt updates planning state; DisciplineList renders"]
  E -->|demo| I["createVolatilePlanningTransport.execute → apply in page memory"] --> J
```

**Code references:** [DisciplineForm.tsx](../../apps/frontend/src/components/disciplines/DisciplineForm.tsx) · [typedPlanningActions.ts](../../apps/frontend/src/store/typedPlanningActions.ts) · [allocationSlice.ts](../../apps/frontend/src/store/slices/allocationSlice.ts) · [planningCacheController.ts](../../apps/frontend/src/data/planning/planningCacheController.ts) · [storePlanningTransport.ts](../../apps/frontend/src/data/planning/storePlanningTransport.ts) · [planningTransport.ts](../../apps/frontend/src/data/planning/planningTransport.ts) · [volatilePlanningTransport.ts](../../apps/frontend/src/data/planning/volatilePlanningTransport.ts) · [planning_routes.ts](../../apps/backend/start/planning_routes.ts) · [planning_controller.ts](../../apps/backend/app/controllers/planning_controller.ts) · [planning.ts](../../apps/backend/app/services/planning.ts) · [execute.ts](../../apps/backend/app/services/planning/execute.ts) · [writer.ts](../../apps/backend/app/services/planning/writer.ts)
