# US-RES-05 — Set a resource's working days

As an Editor, I want to set a person’s working days so that the schedule calculates capacity correctly.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner)
**Entry:** Resources screen → person row → Edit → Working days
**Documentation:** [Guide](../../docs-src/using/resources.md)
**Source:** [ResourceForm.tsx](../../apps/frontend/src/components/resources/ResourceForm.tsx) · [ResourceAvailabilityFields.tsx](../../apps/frontend/src/components/resources/ResourceAvailabilityFields.tsx)

## Acceptance criteria

| Field        | Control        | Required/default/conditions                                    |
| ------------ | -------------- | -------------------------------------------------------------- |
| Working days | Weekday picker | People only; at least one weekday must be Full day or Half day |

- **Save** retains valid values; invalid values keep the form open with an error.

## User flow

```mermaid
flowchart TD
  A["Resources screen"] --> B["Edit person"] --> C["Set each weekday Full day, Half day or Not working"] --> D["Save"]
  B --> Z["Cancel closes without saving"]
  D -->|at least one working day| E["Resource capacity reflects the pattern"]
  D -->|all days Not working| F["Form stays open with error"]

  D -->|server refuses save| X["Error stays visible in the form"]
```

## Code flow

```mermaid
flowchart TD
  A["ResourceForm (fields from ResourceAvailabilityFields) → useResourceSubmit.createSubmit"] --> B["useStore.updateResource → createTypedPlanningActions.updateResource"]
  B --> C["buildResourceUpdate → allocationSlice.send"]
  C --> D["createPlanningCacheController.execute"] --> E{"createStorePlanningTransport"}
  E -->|server| F["createPlanningTransport.sendOperation → api.planning.resource.update"] --> G["PlanningController.resourceUpdate → mutatePlanning begins the scoped transaction"]
  G --> H["executePlanningIntent applies intent → writeRow persists row"] --> K["mutatePlanning records revision/audit and commits"] --> J["acceptReceipt updates planning state; ResourceList renders"]
  E -->|demo| I["createVolatilePlanningTransport.execute → apply in page memory"] --> J
```

**Code references:** [ResourceForm.tsx](../../apps/frontend/src/components/resources/ResourceForm.tsx) · [ResourceAvailabilityFields.tsx](../../apps/frontend/src/components/resources/ResourceAvailabilityFields.tsx) · [typedPlanningActions.ts](../../apps/frontend/src/store/typedPlanningActions.ts) · [allocationSlice.ts](../../apps/frontend/src/store/slices/allocationSlice.ts) · [planningCacheController.ts](../../apps/frontend/src/data/planning/planningCacheController.ts) · [storePlanningTransport.ts](../../apps/frontend/src/data/planning/storePlanningTransport.ts) · [planningTransport.ts](../../apps/frontend/src/data/planning/planningTransport.ts) · [volatilePlanningTransport.ts](../../apps/frontend/src/data/planning/volatilePlanningTransport.ts) · [planning_routes.ts](../../apps/backend/start/planning_routes.ts) · [planning_controller.ts](../../apps/backend/app/controllers/planning_controller.ts) · [planning.ts](../../apps/backend/app/services/planning.ts) · [execute.ts](../../apps/backend/app/services/planning/execute.ts) · [writer.ts](../../apps/backend/app/services/planning/writer.ts) · [useResourceSubmit.ts](../../apps/frontend/src/components/resources/useResourceSubmit.ts)
