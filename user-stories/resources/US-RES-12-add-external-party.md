# US-RES-12 — Add an external party

As an Editor, I want to add an external party so that collaborators without capacity can be listed for the team.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner)
**Entry:** Resources screen → External section → Add external party
**Documentation:** [Resources guide](../../docs-src/using/resources.md)
**Source:** [ExternalResourceSection.tsx](../../apps/frontend/src/components/resources/ExternalResourceSection.tsx) · [ExternalForm.tsx](../../apps/frontend/src/components/external/ExternalForm.tsx)

## Acceptance criteria

| Field      | Control    | Required/default/conditions |
| ---------- | ---------- | --------------------------- |
| Company    | Text field | Required                    |
| Descriptor | Text field | Optional                    |

- **Save** adds the external party to the External section. External parties have no schedule capacity.

## User flow

```mermaid
flowchart TD
  A["Resources screen → External"] --> B["Add external party"] --> C["Enter required Company and optional Descriptor"] --> D["Save"]
  D -->|valid| E["External row appears without capacity"]
  D -->|Company missing| F["Form stays open with error"]
  C --> G["Cancel"] --> H["Form closes without saving"]

  D -->|server refuses save| X["Error stays visible in the form"]
```

## Code flow

```mermaid
flowchart TD
  A["ExternalForm.ExternalForm.submit"] --> B["useStore.addResource → createTypedPlanningActions.addResource"]
  B --> C["buildResourceCreate → allocationSlice.send"]
  C --> D["createPlanningCacheController.execute"] --> E{"createStorePlanningTransport"}
  E --> F["createPlanningTransport.sendOperation → api.planning.resource.create"] --> G["PlanningController.resourceCreate → mutatePlanning begins the scoped transaction"]
  G --> H["executePlanningIntent applies intent → writeRow persists row"] --> K["mutatePlanning records revision/audit and commits"] --> J["acceptReceipt updates planning state; ResourceList renders"]
```

**Code references:** [ExternalForm.tsx](../../apps/frontend/src/components/external/ExternalForm.tsx) · [ExternalResourceSection.tsx](../../apps/frontend/src/components/resources/ExternalResourceSection.tsx) · [typedPlanningActions.ts](../../apps/frontend/src/store/typedPlanningActions.ts) · [allocationSlice.ts](../../apps/frontend/src/store/slices/allocationSlice.ts) · [planningCacheController.ts](../../apps/frontend/src/data/planning/planningCacheController.ts) · [storePlanningTransport.ts](../../apps/frontend/src/data/planning/storePlanningTransport.ts) · [planningTransport.ts](../../apps/frontend/src/data/planning/planningTransport.ts) · [planning_routes.ts](../../apps/backend/start/planning_routes.ts) · [planning_controller.ts](../../apps/backend/app/controllers/planning_controller.ts) · [planning.ts](../../apps/backend/app/services/planning.ts) · [execute.ts](../../apps/backend/app/services/planning/execute.ts) · [writer.ts](../../apps/backend/app/services/planning/writer.ts)
