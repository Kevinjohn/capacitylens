# US-RES-11 — Set a person's availability dates

As an Editor, I want to set a person’s availability dates so that capacity is zero outside their available period.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner)
**Entry:** Resources screen → person row → Edit → Start date / End date
**Documentation:** [Guide](../../docs-src/using/resources.md)
**Source:** [ResourceForm.tsx](../../apps/frontend/src/components/resources/ResourceForm.tsx) · [ResourceAvailabilityFields.tsx](../../apps/frontend/src/components/resources/ResourceAvailabilityFields.tsx)

## Acceptance criteria

| Field      | Control    | Required/default/conditions         |
| ---------- | ---------- | ----------------------------------- |
| Start date | Date field | People only; optional and inclusive |
| End date   | Date field | People only; optional and inclusive |

- **Save** retains valid values; invalid values keep the form open with an error.

## User flow

```mermaid
flowchart TD
  A["Resources screen"] --> B["Edit person"] --> C["Set optional Start date and End date"] --> D["Save"]
  B --> Z["Cancel closes without saving"]
  D -->|valid dates| E["Capacity is zero outside inclusive range"]
  D -->|invalid or reversed range| F["Form stays open with error"]

  D -->|server refuses save| X["Error stays visible in the form"]
```

## Code flow

```mermaid
flowchart TD
  A["ResourceForm (fields from ResourceAvailabilityFields) → useResourceSubmit.createSubmit"] --> B["useStore.updateResource → createTypedPlanningActions.updateResource"]
  B --> C["buildResourceUpdate → allocationSlice.send"]
  C --> D["createPlanningCacheController.execute"] --> E{"createStorePlanningTransport"}
  E --> F["createPlanningTransport.sendOperation → api.planning.resource.update"] --> G["PlanningController.resourceUpdate → mutatePlanning begins the scoped transaction"]
  G --> H["executePlanningIntent applies intent → writeRow persists row"] --> K["mutatePlanning records revision/audit and commits"] --> J["acceptReceipt updates planning state; ResourceList renders"]
```

**Code references:** [ResourceForm.tsx](../../apps/frontend/src/components/resources/ResourceForm.tsx) · [ResourceAvailabilityFields.tsx](../../apps/frontend/src/components/resources/ResourceAvailabilityFields.tsx) · [typedPlanningActions.ts](../../apps/frontend/src/store/typedPlanningActions.ts) · [allocationSlice.ts](../../apps/frontend/src/store/slices/allocationSlice.ts) · [planningCacheController.ts](../../apps/frontend/src/data/planning/planningCacheController.ts) · [storePlanningTransport.ts](../../apps/frontend/src/data/planning/storePlanningTransport.ts) · [planningTransport.ts](../../apps/frontend/src/data/planning/planningTransport.ts) · [planning_routes.ts](../../apps/backend/start/planning_routes.ts) · [planning_controller.ts](../../apps/backend/app/controllers/planning_controller.ts) · [planning.ts](../../apps/backend/app/services/planning.ts) · [execute.ts](../../apps/backend/app/services/planning/execute.ts) · [writer.ts](../../apps/backend/app/services/planning/writer.ts) · [useResourceSubmit.ts](../../apps/frontend/src/components/resources/useResourceSubmit.ts)
