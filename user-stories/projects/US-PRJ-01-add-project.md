# US-PRJ-01 — Add a project (must belong to a client)

As an Editor, I want to add a project under a client so that it can be scheduled and filtered.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner)
**Entry:** Projects screen → Add project
**Documentation:** [Guide](../../docs-src/using/projects.md)
**Source:** [ProjectList.tsx](../../apps/frontend/src/components/projects/ProjectList.tsx) · [ProjectForm.tsx](../../apps/frontend/src/components/projects/ProjectForm.tsx)

## Acceptance criteria

| Field         | Control         | Required/default/conditions                                            |
| ------------- | --------------- | ---------------------------------------------------------------------- |
| Client        | Picker          | Required; no default; Internal first, then active clients by name      |
| Name          | Text field      | Required; initially blank                                              |
| Use code name | Switch          | Owner only; off by default                                             |
| Code name     | Text field      | Owner only; shown and required when Use code name is on                |
| Colour        | Preset swatches | Defaults to project colour #da2d92; hidden when the client is Internal |

- **Save** adds the project. Invalid required values keep the form open with an error. **Cancel** closes without saving.

## User flow

```mermaid
flowchart TD
  A["Projects screen"] --> B["Add project"] --> C["Enter Name and choose Client"] --> D["Save"]
  D -->|valid| E["Project appears in list and selectors"]
  D -->|missing Name or Client| F["Form stays open with error"]
  C --> G["Cancel"] --> H["Dialog closes without saving"]

  D -->|server refuses save| X["Error stays visible in the form"]
```

## Code flow

```mermaid
flowchart TD
  A["ProjectForm.useProjectSubmit"] --> B["useStore.addProject → createTypedPlanningActions.addProject"]
  B --> C["createCatalogue → allocationSlice.send"]
  C --> D["createPlanningCacheController.execute"] --> E{"createStorePlanningTransport"}
  E --> F["createPlanningTransport.sendOperation → api.planning.project.create"] --> G["PlanningController.projectCreate → mutatePlanning begins the scoped transaction"]
  G --> H["executePlanningIntent applies intent → writeRow persists row"] --> K["mutatePlanning records revision/audit and commits"] --> J["acceptReceipt updates planning state; ProjectList renders"]
```

**Code references:** [ProjectForm.tsx](../../apps/frontend/src/components/projects/ProjectForm.tsx) · [typedPlanningActions.ts](../../apps/frontend/src/store/typedPlanningActions.ts) · [allocationSlice.ts](../../apps/frontend/src/store/slices/allocationSlice.ts) · [planningCacheController.ts](../../apps/frontend/src/data/planning/planningCacheController.ts) · [storePlanningTransport.ts](../../apps/frontend/src/data/planning/storePlanningTransport.ts) · [planningTransport.ts](../../apps/frontend/src/data/planning/planningTransport.ts) · [planning_routes.ts](../../apps/backend/start/planning_routes.ts) · [planning_controller.ts](../../apps/backend/app/controllers/planning_controller.ts) · [planning.ts](../../apps/backend/app/services/planning.ts) · [execute.ts](../../apps/backend/app/services/planning/execute.ts) · [writer.ts](../../apps/backend/app/services/planning/writer.ts)
