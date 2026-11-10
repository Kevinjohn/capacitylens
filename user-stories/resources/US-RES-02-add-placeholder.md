# US-RES-02 — Add a placeholder bound to a project

As an Editor, I want to add a placeholder bound to a project so that reserved capacity is visible before staffing.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner)
**Entry:** Resources screen → Placeholders → Add placeholder
**Documentation:** [Guide](../../docs-src/using/resources.md)
**Source:** [ResourceList.tsx](../../apps/frontend/src/components/resources/ResourceList.tsx) · [ResourceForm.tsx](../../apps/frontend/src/components/resources/ResourceForm.tsx)

## Acceptance criteria

| Field           | Control    | Required/default/conditions                                                |
| --------------- | ---------- | -------------------------------------------------------------------------- |
| Name (optional) | Text field | Optional; role may identify the placeholder                                |
| Role            | Text field | Optional                                                                   |
| Discipline      | Picker     | Shown when disciplines are enabled and at least one is available; optional |
| Bound project   | Picker     | Required; active projects                                                  |

- **Save** adds the placeholder to its project and the Placeholder section. Placeholders have no Engagement, availability-date or working-day controls.

## User flow

```mermaid
flowchart TD
  A["Resources screen → Placeholders"] --> B["Add placeholder"] --> C["Enter optional Name or Role"] --> D["Choose required Project"] --> E["Save"]
  B --> Z["Cancel closes without saving"]
  E -->|valid| F["Placeholder appears in project group"]
  E -->|missing Project| G["Form stays open with error"]

  E -->|server refuses save| X["Error stays visible in the form"]
```

## Code flow

```mermaid
flowchart TD
  A["ResourceForm.useResourceSubmit.createSubmit"] --> B["useStore.addResource → createTypedPlanningActions.addResource"]
  B --> C["buildResourceCreate → allocationSlice.send"]
  C --> D["createPlanningCacheController.execute"] --> E{"createStorePlanningTransport"}
  E -->|server| F["createPlanningTransport.sendOperation → api.planning.resource.create"] --> G["PlanningController.resourceCreate → mutatePlanning begins the scoped transaction"]
  G --> H["executePlanningIntent applies intent → writeRow persists row"] --> K["mutatePlanning records revision/audit and commits"] --> J["acceptReceipt updates planning state; ResourceList renders"]
  E -->|demo| I["createVolatilePlanningTransport.execute → apply in page memory"] --> J
```

**Code references:** [ResourceForm.tsx](../../apps/frontend/src/components/resources/ResourceForm.tsx) · [typedPlanningActions.ts](../../apps/frontend/src/store/typedPlanningActions.ts) · [allocationSlice.ts](../../apps/frontend/src/store/slices/allocationSlice.ts) · [planningCacheController.ts](../../apps/frontend/src/data/planning/planningCacheController.ts) · [storePlanningTransport.ts](../../apps/frontend/src/data/planning/storePlanningTransport.ts) · [planningTransport.ts](../../apps/frontend/src/data/planning/planningTransport.ts) · [volatilePlanningTransport.ts](../../apps/frontend/src/data/planning/volatilePlanningTransport.ts) · [planning_routes.ts](../../apps/backend/start/planning_routes.ts) · [planning_controller.ts](../../apps/backend/app/controllers/planning_controller.ts) · [planning.ts](../../apps/backend/app/services/planning.ts) · [execute.ts](../../apps/backend/app/services/planning/execute.ts) · [writer.ts](../../apps/backend/app/services/planning/writer.ts)
